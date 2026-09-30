// ============================================================
// execution-state.test.ts · v1.5.5 章一 · SKILL.state 协议行为锁
// ============================================================
// 验收标准逐条对账（devlog 第一章）：
//   ① 协议六要素（P 恒定/Σt 唯一记忆/ot 仅最新/ΔΣt 代码合并校验/Rt 即弃/降级开关）
//   ② 节点 schema 注册表（基础六字段 + 四类领域扩展 + 通用长任务第五形态）
//   ③ 审计摘要先于轨迹丢弃（动作 + 状态补丁可溯）
//   ④ executionMode 降级双路径（单节点自动降级 + 全局一键回退）
//   ⑤ 度量落盘（stateful-metrics.jsonl）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  getSchema,
  listNodeKinds,
  initialState,
  applyPatch,
  step,
  resolveExecutionMode,
  shouldAutoDegrade,
  fileSink,
  estimateTokens,
  emitAuditDigest,
  setAuditSink,
  type StatePatch,
} from '../execution-state';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exec-state-'));
});
afterEach(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
});

describe('v1.5.5 章一 · schema 注册表', () => {
  it('五类节点形态全部注册（含「通用长任务」第五行——devlog 勿漏项）', () => {
    expect(listNodeKinds().sort()).toEqual(
      ['checker', 'engineer', 'long-task', 'refine-agent', 'reviewer'],
    );
  });

  it('基础六字段全节点在位（goal/done/todo/facts/files/blockers）', () => {
    for (const kind of listNodeKinds()) {
      const names = getSchema(kind).base.map((f) => f.name);
      expect(names, `${kind} 基础六字段`).toEqual(
        ['goal', 'done', 'todo', 'facts', 'files', 'blockers'],
      );
    }
  });

  it('四类领域扩展字段与 devlog 表逐条对应', () => {
    expect(getSchema('engineer').domain.map((f) => f.name)).toEqual(['tests', 'reviewComments']);
    expect(getSchema('checker').domain.map((f) => f.name)).toEqual(['checkRuns', 'falsePositives']);
    expect(getSchema('reviewer').domain.map((f) => f.name)).toEqual(['issuesBySeverity', 'coveredFiles']);
    expect(getSchema('refine-agent').domain.map((f) => f.name)).toEqual(['qualityScores', 'triedStrategies']);
    expect(getSchema('long-task').domain).toEqual([]); // 通用形态仅六字段
  });

  it('未注册类型 fail-closed（抛错列合法值，不静默回退）', () => {
    // @ts-expect-error 故意传非法值
    expect(() => getSchema('nonexistent')).toThrow(/未注册的节点类型/);
  });

  it('Σ0 初始化：六字段 + 领域字段空态，goal 直写', () => {
    const s0 = initialState('engineer', '修复登录 bug');
    expect(s0['goal']).toBe('修复登录 bug');
    expect(s0['todo']).toEqual([]);
    expect(s0['tests']).toEqual({});
    expect(s0['reviewComments']).toEqual([]);
  });
});

describe('v1.5.5 章一 · ΔΣt 代码合并（fail-closed）', () => {
  it('合法 add 补丁：数组追加语义', () => {
    const s = initialState('long-task', 'g');
    const r = applyPatch('long-task', s, [
      { op: 'add', path: 'done', value: ['step1'] },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state['done']).toEqual(['step1']);
  });

  it('类型非法补丁被拒（整个补丁不部分应用）', () => {
    const s = initialState('long-task', 'g');
    const r = applyPatch('long-task', s, [
      { op: 'update', path: 'todo', value: 'not-an-array' },
      { op: 'add', path: 'done', value: ['ok'] },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('todo');
  });

  it('未知字段拒绝（防状态面膨胀）+ 基础字段不可 remove', () => {
    const s = initialState('long-task', 'g');
    expect(applyPatch('long-task', s, [{ op: 'add', path: 'evilField', value: 1 }]).ok).toBe(false);
    expect(applyPatch('long-task', s, [{ op: 'remove', path: 'goal' }]).ok).toBe(false);
  });

  it('remove 无 value 必须被拒（领域数组字段缺 value = 静默 no-op 缺口，fail-closed）', () => {
    const s = initialState('engineer', 'g');
    const seeded = applyPatch('engineer', s, [
      { op: 'update', path: 'reviewComments', value: [{ file: 'a.ts', line: 1, status: 'open' }] },
    ]);
    expect(seeded.ok).toBe(true);
    if (seeded.ok) {
      const r = applyPatch('engineer', seeded.state, [
        { op: 'remove', path: 'reviewComments' }, // 领域数组字段、无 value → 两分支均不命中
      ]);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toContain('remove 需合法 value');
        expect(r.rejectedPath).toBe('reviewComments');
      }
    }
  });

  it('remove 合法形态仍生效（string[] 领域数组按值剔除）；对象 value 非 string 同样拒绝', () => {
    const s = initialState('checker', 'g');
    const seeded = applyPatch('checker', s, [
      { op: 'update', path: 'falsePositives', value: ['a-rule', 'b-rule'] },
    ]);
    expect(seeded.ok).toBe(true);
    if (seeded.ok) {
      const r = applyPatch('checker', seeded.state, [
        { op: 'remove', path: 'falsePositives', value: 'a-rule' },
      ]);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.state['falsePositives']).toEqual(['b-rule']);
    }
    // 对象字段 + 非 string value → 同一 fail-closed 分支
    const es = initialState('engineer', 'g');
    const et = applyPatch('engineer', es, [{ op: 'remove', path: 'tests', value: 42 }]);
    expect(et.ok).toBe(false);
    if (!et.ok) expect(et.reason).toContain('remove 需合法 value');
  });

  it('领域字段 validator 生效（engineer.tests 形状校验）', () => {
    const s = initialState('engineer', 'g');
    const bad = applyPatch('engineer', s, [{ op: 'update', path: 'tests', value: { pass: 'x' } }]);
    expect(bad.ok).toBe(false);
    const good = applyPatch('engineer', s, [{ op: 'update', path: 'tests', value: { pass: 1, fail: 0, skipped: 0 } }]);
    expect(good.ok).toBe(true);
  });

  it('step()：Rt 不进产出——digest 只含动作与补丁（不含 reasoning）', () => {
    const s = initialState('reviewer', 'g');
    const { result, digest } = step('reviewer', s, {
      reasoning: '机密推理轨迹……',
      patch: [{ op: 'update', path: 'issuesBySeverity', value: { p0: 0, p1: 2, p2: 1 } }],
      action: '审查了 3 个文件',
    }, 0);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(digest)).not.toContain('机密推理轨迹');
    expect(digest.action).toBe('审查了 3 个文件');
    expect(digest.causalEdges).toHaveLength(1);
  });
});

describe('v1.5.5 章一 · 降级双路径', () => {
  afterEach(() => { delete process.env.SOFAGENT_STATEFUL_EXEC; });

  it('SOFAGENT_STATEFUL_EXEC=off 全局一键回退 legacy', () => {
    process.env.SOFAGENT_STATEFUL_EXEC = 'off';
    expect(resolveExecutionMode('engineer')).toBe('legacy');
    expect(resolveExecutionMode('refine-agent')).toBe('legacy');
  });

  it('缺省 stateful + 节点级配置可覆盖', () => {
    expect(resolveExecutionMode('engineer')).toBe('stateful');
    expect(resolveExecutionMode('engineer', { executionMode: 'legacy' })).toBe('legacy');
  });

  it('连续补丁失败自动降级阈值（默认 3 次）', () => {
    expect(shouldAutoDegrade(2)).toBe(false);
    expect(shouldAutoDegrade(3)).toBe(true);
    expect(shouldAutoDegrade(4, 5)).toBe(false); // 阈值未达
    expect(shouldAutoDegrade(5, 5)).toBe(true); // 恰达阈值
  });
});

describe('v1.5.5 章一 · 度量与审计', () => {
  it('stateful-metrics.jsonl 落盘（Dashboard 消费通道 data/evolution/）', () => {
    const sink = fileSink(dir);
    sink.write({
      timestamp: new Date().toISOString(), node: 'n1', kind: 'engineer', mode: 'stateful',
      autoDegraded: false, stepTokens: [100, 105, 102], steps: 3, patchRejections: 0,
      success: true, durationMs: 42,
    });
    const p = join(dir, 'evolution', 'stateful-metrics.jsonl');
    expect(existsSync(p)).toBe(true);
    const lines = readFileSync(p, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).node).toBe('n1');
  });

  it('审计摘要：emitAuditDigest 经 sink 收到（轨迹可弃、行为可溯）', () => {
    const got: unknown[] = [];
    setAuditSink((line) => got.push(line));
    emitAuditDigest(
      { kind: 'engineer', action: '跑测试', patch: [{ op: 'add', path: 'done', value: ['t'] }], causalEdges: [{ action: '跑测试', field: 'done' }], step: 2, timestamp: new Date().toISOString() },
      'agent-a', 'node-1',
    );
    setAuditSink(null);
    expect(got).toHaveLength(1);
    const line = got[0] as { entry: { type: string; action: string; step: number } };
    expect(line.entry.type).toBe('execution-state-digest');
    expect(line.entry.action).toBe('跑测试');
    expect(line.entry.step).toBe(2);
  });

  it('token 估算：CJK 与拉丁词双口径', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('四个中文字')).toBe(5); // 五个 CJK 字符
    expect(estimateTokens('hello world')).toBeGreaterThanOrEqual(2);
  });
});
