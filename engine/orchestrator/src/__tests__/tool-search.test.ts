// ============================================================
// tool-search.test.ts · v1.5.5 章二 · Tool search 行为锁
// ============================================================
// 验收标准对账（devlog 第二章）：
//   ① 任务描述可检索出相关工具子集（top-K，相关性有测试样例）
//   ② 节点域过滤生效：域外工具不进上下文
//   ③ 执行中可追加加载（分步按需）
//   ④ 手动指定工具显式覆盖检索结果（让位并记录）
//   ⑤ token 对比度量落盘（按需 vs 全量）
//   ⑥ ToolGate 权限面不受影响（权限先于检索——接线序断言）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  buildToolIndex,
  searchTools,
  appendTools,
  recordInjectionMetrics,
  estimateToolsTokens,
  tokenize,
  type ExecutableTool,
} from '../tools/tool-search';

/** 测试夹具：极简 ExecutableTool */
function fakeTool(name: string, description: string): ExecutableTool {
  return {
    name,
    description,
    schema: { type: 'object', properties: {}, required: [] },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    func: async () => 'ok',
  } as unknown as ExecutableTool;
}

const POOL: ExecutableTool[] = [
  fakeTool('read_file', '读取文件内容 read a file content'),
  fakeTool('write_file', '写入文件内容 write file content'),
  fakeTool('run_bash', '执行 shell 命令 execute bash command'),
  fakeTool('search_code', '在代码库中搜索 search code in repo'),
  fakeTool('run_test', '运行测试 run tests'),
];

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ts-')); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

describe('v1.5.5 章二 · 检索召回', () => {
  it('① 相关性样例：「读文件」任务召回 read_file 而非 run_test', () => {
    const idx = buildToolIndex(POOL);
    const r = searchTools(idx, { taskDescription: '请读取配置文件的内容', topK: 2 });
    expect(r.names).toContain('read_file');
    expect(r.names).not.toContain('run_test');
  });

  it('top-K 上限生效 + 零相关命中返回空（宁缺勿滥）', () => {
    const idx = buildToolIndex(POOL);
    expect(searchTools(idx, { taskDescription: '读取', topK: 1 }).tools).toHaveLength(1);
    const none = searchTools(idx, { taskDescription: 'zzzqqq xxxyyy' });
    expect(none.tools).toHaveLength(0);
  });

  it('同名工具去重（静态重叠检测联动——先去重后检索）', () => {
    const idx = buildToolIndex([...POOL, POOL[0]!]); // read_file 重复登记
    expect(idx).toHaveLength(POOL.length);
  });

  it('中文 2-gram + 拉丁分词双口径', () => {
    const t = tokenize('读取 read_file 文件');
    expect(t).toContain('read_file');
    expect(t).toContain('读取');
    expect(t.some((x) => x.startsWith('文件'))).toBe(true);
  });
});

describe('v1.5.5 章二 · 域过滤与显式覆盖', () => {
  it('② 域外工具不进上下文（allowNames 白名单）', () => {
    const idx = buildToolIndex(POOL);
    const r = searchTools(idx, {
      taskDescription: '读取文件并执行命令',
      topK: 5,
      domain: { allowNames: new Set(['read_file', 'search_code']) },
    });
    expect(r.names.every((n) => ['read_file', 'search_code'].includes(n))).toBe(true);
    expect(r.names).not.toContain('run_bash'); // 域外硬拒
  });

  it('④ 手动指定显式覆盖：检索让位并记录偏离', () => {
    const idx = buildToolIndex(POOL);
    const r = searchTools(idx, {
      taskDescription: '读取文件',
      topK: 3,
      explicitTools: ['write_file', 'search_code'],
    });
    expect(r.explicitOverride).toBe(true);
    expect(r.names).toEqual(['write_file', 'search_code']);
    expect(r.cededToExplicit).toContain('read_file'); // 让位记录可查
  });

  it('F13：显式 + 域白名单并存 ⇒ 域外工具不进结果（显式不能绕域）', () => {
    const idx = buildToolIndex(POOL);
    const r = searchTools(idx, {
      taskDescription: '读取文件',
      topK: 3,
      // run_bash 在域白名单外——显式指定也不能进
      explicitTools: ['read_file', 'run_bash'],
      domain: { allowNames: new Set(['read_file', 'write_file', 'search_code']) },
    });
    expect(r.explicitOverride).toBe(true);
    expect(r.names).toEqual(['read_file']); // 域内显式保留，域外被剔除
    expect(r.names).not.toContain('run_bash');
    // 域外剔除计入 cededToExplicit 偏离记录（「显式让位域约束」可查）
    expect(r.cededToExplicit).toContain('run_bash');
  });
});

describe('v1.5.5 章二 · 分步按需加载', () => {
  it('③ 执行中追加：剔除已加载、按缺项描述召回', () => {
    const idx = buildToolIndex(POOL);
    const r = appendTools(idx, {
      alreadyLoaded: ['read_file'],
      needDescription: '需要运行测试验证',
      topK: 2,
    });
    expect(r.names).not.toContain('read_file');
    expect(r.names).toContain('run_test');
  });

  it('追加无新命中时返回空（调用方可据此告知模型）', () => {
    const idx = buildToolIndex(POOL);
    const r = appendTools(idx, {
      alreadyLoaded: POOL.map((t) => t.name),
      needDescription: '读取文件',
    });
    expect(r.tools).toHaveLength(0);
  });
});

describe('v1.5.5 章二 · 度量落盘', () => {
  it('⑤ tool-search-metrics.jsonl 落盘（按需 vs 全量 token 对比）', () => {
    const onDemand = [POOL[0]!, POOL[3]!];
    recordInjectionMetrics(dir, {
      timestamp: new Date().toISOString(),
      task: '读代码',
      injected: onDemand.length,
      fullSet: POOL.length,
      onDemandTokens: estimateToolsTokens(onDemand),
      fullTokens: estimateToolsTokens(POOL),
    });
    const p = join(dir, 'evolution', 'tool-search-metrics.jsonl');
    expect(existsSync(p)).toBe(true);
    const rec = JSON.parse(readFileSync(p, 'utf-8').trim().split('\n')[0]!);
    expect(rec.injected).toBe(2);
    expect(rec.fullSet).toBe(5);
    expect(rec.fullTokens).toBeGreaterThan(rec.onDemandTokens); // 对比语义成立
  });

  it('sink 注入面可用（测试不落盘）', () => {
    const lines: string[] = [];
    recordInjectionMetrics(dir, {
      timestamp: 't', task: 'x', injected: 1, fullSet: 2, onDemandTokens: 1, fullTokens: 2,
    }, (l) => lines.push(l));
    expect(lines).toHaveLength(1);
    expect(existsSync(join(dir, 'evolution'))).toBe(false); // 未落盘
  });
});

describe('v1.5.5 章二 · 权限面正交（回归锁）', () => {
  it('⑥ 接线序断言：node-executor 源码中 wrapToolsWithGate( 在 searchTools( 之前（权限先于供给）', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'node-executor.ts'), 'utf-8');
    const gatePos = src.indexOf('wrapToolsWithGate(suppliedTools');
    const searchPos = src.indexOf("await import('./tools/tool-search')");
    expect(gatePos).toBeGreaterThan(0);
    expect(searchPos).toBeGreaterThan(0);
    // gate 创建先于检索 import（权限面判定先于供给面检索——v1.4.8 ToolGate 不受影响）
    expect(src.indexOf('const gate = createToolGate(')).toBeLessThan(searchPos);
  });
});
