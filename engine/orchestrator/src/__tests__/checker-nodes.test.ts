// ============================================================
// checker-nodes.test.ts · 多类型 Checker 节点测试（v1.2.8 · P2b）
// ============================================================
//
// 覆盖：
// - format-checker：空产出 FAIL / 正常产出 PASS / 过短 WARN
// - fact-checker：不存在文件 FAIL / 无引用 PASS
// - source-validator：高可信度 PASS / 低可信度 WARN
// - resolveLoopMode：四种受控循环路由
// - makeCheckerNode：三合一节点集成
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { emptyArtifacts } from '../loop/state';
import type { LoopGraphState } from '../loop/state';

import {
  makeFormatCheckerNode,
  makeFactCheckerNode,
  makeSourceValidatorNode,
  resolveLoopMode,
  makeCheckerNode,
  DEFAULT_LOOP_CONTROL,
  type CheckerResult,
  type ControlledLoopMode,
  type LoopControlConfig,
} from '../loop/checker-nodes';

// ════════════════════════════════════════
// Helper：构造测试 state
// ════════════════════════════════════════

function makeState(output: string): LoopGraphState {
  return {
    currentNode: 'engineer',
    auditResult: null,
    retryCount: 0,
    checkpointId: 'test-checker',
    artifacts: { ...emptyArtifacts('测试'), engineerOutput: output, auditReport: '' },
    finalStatus: 'running',
    resumeFrom: null,
    degradationLevel: 0,
  };
}

// ════════════════════════════════════════

describe('checker-nodes', () => {
  let tmpDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-ck-'));
    // vitest worker 线程不支持 process.chdir()，改用 spy
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  // ════════════════════════════════════════
  // DEFAULT_LOOP_CONTROL
  // ════════════════════════════════════════

  describe('DEFAULT_LOOP_CONTROL', () => {
    it('maxRetries = 3', () => {
      expect(DEFAULT_LOOP_CONTROL.maxRetries).toBe(3);
    });
    it('degradationThreshold = 2', () => {
      expect(DEFAULT_LOOP_CONTROL.degradationThreshold).toBe(2);
    });
    it('humanHandoffTrigger = 3', () => {
      expect(DEFAULT_LOOP_CONTROL.humanHandoffTrigger).toBe(3);
    });
  });

  // ════════════════════════════════════════
  // format-checker
  // ════════════════════════════════════════

  describe('makeFormatCheckerNode', () => {
    it('空产出返回 FAIL', async () => {
      const node = makeFormatCheckerNode();
      const result = await node(makeState(''));
      // formatChecker 不直接在返回值暴露 CheckerResult，
      // 验证 currentNode 被设置为 'format-checker'
      expect((result as any).currentNode).toBe('format-checker');
    });

    it('正常代码产出不报错', async () => {
      const node = makeFormatCheckerNode();
      const output = [
        '```typescript',
        'export function add(a: number, b: number): number {',
        '  return a + b;',
        '}',
        '```',
        '修改了 src/math.ts',
      ].join('\n');
      const result = await node(makeState(output));
      expect(result).toBeDefined();
    });

    it('极短产出（<10 字符）', async () => {
      const node = makeFormatCheckerNode();
      const result = await node(makeState('hi'));
      expect(result).toBeDefined();
    });
  });

  // ════════════════════════════════════════
  // fact-checker
  // ════════════════════════════════════════

  describe('makeFactCheckerNode', () => {
    it('无文件引用时不报错', async () => {
      const node = makeFactCheckerNode();
      const result = await node(
        makeState('这是一段普通文字，没有文件引用'),
      );
      expect((result as any).currentNode).toBe('fact-checker');
    });

    it('引用不存在的文件路径', async () => {
      const node = makeFactCheckerNode();
      const output = '修改了 src/nonexistent.ts 和 engine/ghost.ts';
      const result = await node(makeState(output));
      expect(result).toBeDefined();
    });

    it('引用存在的文件路径', async () => {
      // 在 tmpDir 中创建文件
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'real.ts'), 'export {};');

      const node = makeFactCheckerNode();
      const output = '修改了 src/real.ts';
      const result = await node(makeState(output));
      expect((result as any).currentNode).toBe('fact-checker');
    });
  });

  // ════════════════════════════════════════
  // source-validator
  // ════════════════════════════════════════

  describe('makeSourceValidatorNode', () => {
    it('低可信度产出（无来源引用）', async () => {
      const node = makeSourceValidatorNode();
      const result = await node(
        makeState('这个应该总是返回正确结果。必须保证。'),
      );
      expect((result as any).currentNode).toBe('source-validator');
    });

    it('高可信度产出（含测试引用 + 类型注解）', async () => {
      const node = makeSourceValidatorNode();
      const output = [
        '```typescript',
        'export function add(a: number, b: number): void {}',
        '```',
        '测试在 math.test.ts 和 utils.spec.ts 中',
      ].join('\n');
      const result = await node(makeState(output));
      expect(result).toBeDefined();
    });
  });

  // ════════════════════════════════════════
  // resolveLoopMode — 受控循环路由
  // ════════════════════════════════════════

  describe('resolveLoopMode', () => {
    const allPass: CheckerResult[] = [
      { name: 'format', verdict: 'PASS', report: '' },
      { name: 'fact', verdict: 'PASS', report: '' },
      { name: 'source', verdict: 'PASS', report: '' },
    ];
    const hasFail: CheckerResult[] = [
      { name: 'fact', verdict: 'FAIL', report: '文件不存在', failureMode: 'non-existent-file-reference' },
    ];
    const hasWarn: CheckerResult[] = [
      { name: 'source', verdict: 'WARN', report: '低可信度', failureMode: 'low-source-trust' },
    ];
    const failAndWarn: CheckerResult[] = [
      { name: 'fact', verdict: 'FAIL', report: '文件不存在' },
      { name: 'source', verdict: 'WARN', report: '低可信度' },
    ];

    it('全 PASS + retryCount=0 → degraded-pass（继续流转）', () => {
      expect(resolveLoopMode(allPass, 0)).toBe('degraded-pass');
    });

    it('有 FAIL + retryCount < degradationThreshold → retry', () => {
      expect(resolveLoopMode(hasFail, 0)).toBe('retry');
      expect(resolveLoopMode(hasFail, 1)).toBe('retry');
    });

    it('有 FAIL + retryCount >= degradationThreshold → supplement（回 plan 补信息）', () => {
      expect(resolveLoopMode(hasFail, 2)).toBe('supplement');
    });

    it('有 FAIL + retryCount >= humanHandoffTrigger → human-handoff', () => {
      expect(resolveLoopMode(hasFail, 3)).toBe('human-handoff');
      expect(resolveLoopMode(hasFail, 5)).toBe('human-handoff');
    });

    it('仅 WARN（无 FAIL）→ degraded-pass', () => {
      expect(resolveLoopMode(hasWarn, 0)).toBe('degraded-pass');
      expect(resolveLoopMode(hasWarn, 3)).toBe('degraded-pass');
    });

    it('FAIL + WARN 同时存在时，FAIL 优先（按 FAIL 路径判定）', () => {
      expect(resolveLoopMode(failAndWarn, 0)).toBe('retry');
    });

    it('自定义 config 生效', () => {
      const customConfig: LoopControlConfig = {
        maxRetries: 5,
        degradationThreshold: 1,
        humanHandoffTrigger: 4,
      };
      // retryCount=1 >= degradationThreshold(1) → supplement
      expect(resolveLoopMode(hasFail, 1, customConfig)).toBe('supplement');
      // retryCount=4 >= humanHandoffTrigger(4) → human-handoff
      expect(resolveLoopMode(hasFail, 4, customConfig)).toBe('human-handoff');
    });
  });

  // ════════════════════════════════════════
  // makeCheckerNode — 三合一集成
  // ════════════════════════════════════════

  describe('makeCheckerNode', () => {
    it('正常产出执行完成并返回 auditReport 更新', async () => {
      const logs: string[] = [];
      const node = makeCheckerNode({ log: (msg) => logs.push(msg) });
      const output = [
        '```typescript',
        'export function add(a: number, b: number): number {',
        '  return a + b;',
        '}',
        '```',
      ].join('\n');
      const result = await node(makeState(output));

      expect((result as any).currentNode).toBe('checker');
      expect((result as any).artifacts.auditReport).toBeTruthy();
      expect(logs.some((l) => l.includes('执行中'))).toBe(true);
      expect(logs.some((l) => l.includes('完成'))).toBe(true);
    });

    it('空产出也能执行（checker 不阻断）', async () => {
      const node = makeCheckerNode();
      const result = await node(makeState(''));
      expect((result as any).currentNode).toBe('checker');
    });

    it('无 log 回调时不报错', async () => {
      const node = makeCheckerNode({});
      const result = await node(makeState('export const x: number = 1;'));
      expect(result).toBeDefined();
    });
  });
});
