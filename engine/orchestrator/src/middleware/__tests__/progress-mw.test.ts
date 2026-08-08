// ============================================================
// progress-mw.test.ts · ProgressMiddleware 单元测试（v1.2.9 · P2b）
//
// 覆盖：
//   1. 写出路径与 jsonl schema（timestamp/role/kind/toolName/target/
//      resultSummary/tokenCount 字段齐全）
//   2. 4 种 kind 枚举：node-start / tool-call / llm-heartbeat / node-end
//   3. llm-heartbeat 3s 节流（窗口内跳过、窗口外写入、不同 role 独立节流）
//   4. 注入正确性：defaultDeps() 后 getLoopProgressMw 单例可用、
//      setLoopProgressMwForTest 可替换 / 重置
//   5. 写入失败静默（目录不可写时绝不 throw）
//   6. taskName / resultSummary 截断（防超长行）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { ProgressMiddleware, HEARTBEAT_THROTTLE_MS, type ProgressEvent } from '../progress-mw';
import {
  getLoopProgressMw,
  setLoopProgressMwForTest,
  defaultDeps,
} from '../../loop/nodes';
import type { FileCheckpointer } from '../../graph/checkpoint';

// ════════════════════════════════════════
// Helper
// ════════════════════════════════════════

let tmpHome: string;

/** 读取 sub-progress-{role}.jsonl 全部事件 */
function readEvents(role: string): ProgressEvent[] {
  const file = path.join(tmpHome, 'data', 'audit', `sub-progress-${role}.jsonl`);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ProgressEvent);
}

beforeEach(() => {
  // 隔离：fake SOFAGENT_HOME 指向临时目录
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-progress-mw-'));
  process.env.SOFAGENT_HOME = tmpHome;
  setLoopProgressMwForTest(null);
});

afterEach(() => {
  delete process.env.SOFAGENT_HOME;
  setLoopProgressMwForTest(null);
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

// ════════════════════════════════════════
// 1. jsonl schema 与写出路径
// ════════════════════════════════════════

describe('ProgressMiddleware · jsonl schema', () => {
  it('tool-call 事件字段齐全（对齐架构师定义 schema）', () => {
    const mw = new ProgressMiddleware(tmpHome);
    mw.toolCall('engineer', {
      toolName: 'sf_read',
      target: 'src/foo.ts',
      resultSummary: 'ok · 142 行',
      tokenCount: 1200,
    });

    const events = readEvents('engineer');
    expect(events).toHaveLength(1);
    const e = events[0]!;
    // schema 字段一字不差
    expect(e.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(e.role).toBe('engineer');
    expect(e.kind).toBe('tool-call');
    expect(e.toolName).toBe('sf_read');
    expect(e.target).toBe('src/foo.ts');
    expect(e.resultSummary).toBe('ok · 142 行');
    expect(e.tokenCount).toBe(1200);
  });

  it('写出路径为 data/audit/sub-progress-{role}.jsonl', () => {
    const mw = new ProgressMiddleware(tmpHome);
    expect(mw.resolveLogPath('engineer')).toBe(
      path.join(tmpHome, 'data', 'audit', 'sub-progress-engineer.jsonl'),
    );
    expect(mw.resolveLogPath('reviewer')).toBe(
      path.join(tmpHome, 'data', 'audit', 'sub-progress-reviewer.jsonl'),
    );
  });

  it('audit 目录不存在时自动创建', () => {
    const mw = new ProgressMiddleware(tmpHome);
    expect(fs.existsSync(path.join(tmpHome, 'data', 'audit'))).toBe(false);
    mw.nodeStart('plan', 'test task');
    expect(fs.existsSync(path.join(tmpHome, 'data', 'audit'))).toBe(true);
    expect(readEvents('plan')).toHaveLength(1);
  });
});

// ════════════════════════════════════════
// 2. 4 种 kind 枚举
// ════════════════════════════════════════

describe('ProgressMiddleware · kind 枚举', () => {
  it('node-start 携带 taskName', () => {
    const mw = new ProgressMiddleware(tmpHome);
    mw.nodeStart('engineer', '实现登录页');
    const e = readEvents('engineer')[0]!;
    expect(e.kind).toBe('node-start');
    expect(e.taskName).toBe('实现登录页');
  });

  it('node-end 携带 durationMs / success / tokenCount', () => {
    const mw = new ProgressMiddleware(tmpHome);
    mw.nodeStart('engineer', 'task');
    mw.nodeEnd('engineer', { durationMs: 1500, success: true, tokenCount: 3200 });
    const events = readEvents('engineer');
    expect(events).toHaveLength(2);
    const e = events[1]!;
    expect(e.kind).toBe('node-end');
    expect(e.durationMs).toBe(1500);
    expect(e.success).toBe(true);
    expect(e.tokenCount).toBe(3200);
  });

  it('llm-heartbeat 写入 kind=llm-heartbeat', () => {
    const mw = new ProgressMiddleware(tmpHome);
    const written = mw.heartbeat('engineer', 500);
    expect(written).toBe(true);
    const e = readEvents('engineer')[0]!;
    expect(e.kind).toBe('llm-heartbeat');
    expect(e.tokenCount).toBe(500);
  });

  it('node-start 后 getCurrentTask 返回任务名', () => {
    const mw = new ProgressMiddleware(tmpHome);
    mw.nodeStart('reviewer', '审查 PR #42');
    expect(mw.getCurrentTask('reviewer')).toBe('审查 PR #42');
    expect(mw.getCurrentTask('engineer')).toBeUndefined();
  });
});

// ════════════════════════════════════════
// 3. llm-heartbeat 3s 节流
// ════════════════════════════════════════

describe('ProgressMiddleware · heartbeat 节流', () => {
  it('节流窗口内跳过，窗口外写入', () => {
    const mw = new ProgressMiddleware(tmpHome);
    const t0 = 1_000_000;

    expect(mw.heartbeat('engineer', undefined, t0)).toBe(true);   // 首次必写
    expect(mw.heartbeat('engineer', undefined, t0 + 1000)).toBe(false); // +1s 节流
    expect(mw.heartbeat('engineer', undefined, t0 + 2999)).toBe(false); // 窗口内
    expect(mw.heartbeat('engineer', undefined, t0 + 3000)).toBe(true);  // 满 3s 放行
    expect(mw.heartbeat('engineer', undefined, t0 + 6100)).toBe(true);  // 窗口外

    const heartbeats = readEvents('engineer').filter((e) => e.kind === 'llm-heartbeat');
    expect(heartbeats).toHaveLength(3);
  });

  it('节流间隔常量为 3000ms（Dashboard 5s 黄 / 10s 红阈值不误报）', () => {
    expect(HEARTBEAT_THROTTLE_MS).toBe(3000);
  });

  it('不同 role 独立节流互不影响', () => {
    const mw = new ProgressMiddleware(tmpHome);
    const t0 = 1_000_000;
    expect(mw.heartbeat('engineer', undefined, t0)).toBe(true);
    expect(mw.heartbeat('reviewer', undefined, t0 + 100)).toBe(true); // reviewer 首次独立放行
    expect(mw.heartbeat('engineer', undefined, t0 + 100)).toBe(false); // engineer 仍节流
  });
});

// ════════════════════════════════════════
// 4. 注入正确性（nodes.ts 接线）
// ════════════════════════════════════════

describe('ProgressMiddleware · nodes.ts 接线', () => {
  it('getLoopProgressMw 返回单例', () => {
    const a = getLoopProgressMw();
    const b = getLoopProgressMw();
    expect(a).toBe(b);
    expect(a).toBeInstanceOf(ProgressMiddleware);
  });

  it('setLoopProgressMwForTest 可替换单例', () => {
    const fake = new ProgressMiddleware(tmpHome);
    setLoopProgressMwForTest(fake);
    expect(getLoopProgressMw()).toBe(fake);
    setLoopProgressMwForTest(null);
    expect(getLoopProgressMw()).not.toBe(fake);
  });

  it('defaultDeps() 接线后 progress middleware 可用（与 runEngineer 同一模块作用域）', () => {
    // defaultDeps 不直接持有 progressMw（与 runEngineer 内部 getLoopProgressMw 一致），
    // 此处验证 defaultDeps 构建成功且 progressMw 单例仍可解析
    const fakeCheckpointer = {
      save: async () => undefined,
      load: async () => null,
    } as unknown as FileCheckpointer;
    const deps = defaultDeps(fakeCheckpointer, true);
    expect(deps.runEngineer).toBeDefined();
    expect(deps.runReviewer).toBeDefined();
    expect(getLoopProgressMw()).toBeInstanceOf(ProgressMiddleware);
  });
});

// ════════════════════════════════════════
// 5. 失败静默
// ════════════════════════════════════════

describe('ProgressMiddleware · 写入失败静默', () => {
  it('audit 目录不可写时绝不 throw', () => {
    // 构造一个文件占据 audit 目录路径 → mkdir 必然失败
    const blocker = path.join(tmpHome, 'data');
    fs.writeFileSync(blocker, 'not-a-dir', 'utf-8');
    const mw = new ProgressMiddleware(tmpHome);
    expect(() => {
      mw.nodeStart('engineer', 'task');
      mw.toolCall('engineer', { toolName: 'sf_read' });
      mw.nodeEnd('engineer', { success: true });
    }).not.toThrow();
  });
});

// ════════════════════════════════════════
// 6. 截断
// ════════════════════════════════════════

describe('ProgressMiddleware · 字段截断', () => {
  it('taskName 截断到 120 字符', () => {
    const mw = new ProgressMiddleware(tmpHome);
    mw.nodeStart('engineer', 'x'.repeat(300));
    const e = readEvents('engineer')[0]!;
    expect(e.taskName).toHaveLength(120);
  });

  it('resultSummary 截断到 120 字符 / target 截断到 200 字符', () => {
    const mw = new ProgressMiddleware(tmpHome);
    mw.toolCall('engineer', {
      toolName: 'run_bash',
      target: 'y'.repeat(300),
      resultSummary: 'z'.repeat(300),
    });
    const e = readEvents('engineer')[0]!;
    expect(e.target).toHaveLength(200);
    expect(e.resultSummary).toHaveLength(120);
  });
});
