// ============================================================
// graph-engine.test.ts · v1.2.2 P4 Graph Engine 基础设施测试
// ============================================================
//
// 覆盖（对照任务书 9 条验收用例）：
//   1. Planner 分解：复杂任务 → subtasks 非空 + 每条有 id/description/status
//   2. 降级链 0→1：第 2 次 audit FAIL → degradationLevel=1 + [降级 L1] 提示词注入
//   3. 降级链 1→2：第 3 次 audit FAIL → degradationLevel=2 + 继续（不 blocked）
//   4. 降级链超限：degradationLevel=2 且 retryCount 耗尽 → 路由 human_confirm
//   5. decide 云端路由：public 数据 → ModelRouter → cloud-fast/cloud-strong
//   6. decide 本地路由：restricted 数据 → ModelRouter → local-executor
//   7. execute 确定性：相同 decide JSON → 相同文件编辑结果（dryRun 无副作用）
//   8. decide JSON schema 校验失败：非法 JSON → parseEngineerDecide 返回 null（走降级链）
//   9. Dashboard Graph 区块：graph-state.json 存在 → 字段完整可渲染
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { emptyArtifacts, type LoopGraphState } from '../loop/state';
import { routeAfterAudit, runLoopGraph } from '../loop/graph';
// QA-FIX(v1.2.2 回归): LoopGraphDeps/AuditOutcome 定义并导出于 ../loop/nodes，
// graph.ts 未再导出——按 qa-verify-nodes.test.ts 的既有约定修正导入来源（tsc TS2459/TS2305）
import type { LoopGraphDeps, AuditOutcome } from '../loop/nodes';
import { FileCheckpointer } from '../graph/checkpoint';
import {
  makePlanNode,
  parsePlanDecide,
  extractJsonBlock,
  writeGraphState,
  type PlanNodeDeps,
} from '../loop/plan-node';
import {
  buildDecidePrompt,
  parseEngineerDecide,
  extractDecideJson,
  engineerDecide,
  type EngineerDecideDeps,
} from '../loop/engineer-decide';
import {
  engineerExecute,
  computeResultContent,
  type EngineerExecuteDeps,
} from '../loop/engineer-execute';
import { createDefaultRouter } from '../model-router';
import { END } from '@langchain/langgraph';

// ════════════════════════════════════════
// Helper
// ════════════════════════════════════════

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-p4-'));
}

function sampleState(overrides: Partial<LoopGraphState> = {}): LoopGraphState {
  return {
    currentNode: 'engineer',
    auditResult: null,
    retryCount: 0,
    checkpointId: 'test-p4',
    artifacts: emptyArtifacts('P4 测试任务'),
    finalStatus: 'running',
    resumeFrom: null,
    degradationLevel: 0,
    ...overrides,
  };
}

// ════════════════════════════════════════
// 用例 1：Planner 分解
// ════════════════════════════════════════

describe('Planner 节点（plan-node）', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

  it('复杂任务输入 → subtasks 数组非空，每条有 id/description/status', async () => {
    const llmOutput = JSON.stringify({
      subtasks: [
        { id: 'subtask-1', description: '读取现有代码结构' },
        { id: 'subtask-2', description: '实现核心逻辑' },
        { id: 'subtask-3', description: '补充单元测试' },
      ],
      rationale: '按读-改-测三步走',
    });
    const deps: PlanNodeDeps = {
      runPlannerDecide: async () => llmOutput,
      log: () => {},
      dataDir: dir,
    };
    const node = makePlanNode(deps);
    const update = await node(sampleState());

    const subtasks = update.artifacts.subtasks;
    expect(Array.isArray(subtasks)).toBe(true);
    expect(subtasks.length).toBe(3);
    for (const s of subtasks) {
      expect(typeof s.id).toBe('string');
      expect(s.id.length).toBeGreaterThan(0);
      expect(typeof s.description).toBe('string');
      expect(s.description.length).toBeGreaterThan(0);
      expect(s.status).toBe('pending');
    }
    expect(update.currentNode).toBe('plan');
  });

  it('LLM 输出带 ```json 围栏也能解析', () => {
    const raw = '好的，分解如下：\n```json\n{"subtasks":[{"id":"s1","description":"做A"}],"rationale":"r"}\n```\n以上。';
    const subtasks = parsePlanDecide(raw);
    expect(subtasks).not.toBeNull();
    expect(subtasks!.length).toBe(1);
    expect(subtasks![0]!.id).toBe('s1');
  });

  it('LLM 输出非法 JSON → 兜底单条子任务（原始任务直通，不阻断流程）', async () => {
    const deps: PlanNodeDeps = {
      runPlannerDecide: async () => '这不是 JSON',
      log: () => {},
      dataDir: dir,
    };
    const node = makePlanNode(deps);
    const update = await node(sampleState());
    expect(update.artifacts.subtasks.length).toBe(1);
    expect(update.artifacts.subtasks[0]!.description).toBe('P4 测试任务');
  });

  it('extractJsonBlock：裸 JSON / 围栏 JSON / 无 JSON', () => {
    expect(extractJsonBlock('{"a":1}')).toBe('{"a":1}');
    expect(extractJsonBlock('前缀```json\n{"a":1}\n```后缀')).toBe('{"a":1}');
    expect(extractJsonBlock('无 JSON')).toBe('无 JSON');
  });

  it('plan 节点写 graph-state.json（plan completed + engineer running，v1.2.3 完整控制图）', async () => {
    const deps: PlanNodeDeps = {
      runPlannerDecide: async () => JSON.stringify({
        subtasks: [{ id: 's1', description: 'A' }, { id: 's2', description: 'B' }],
        rationale: '',
      }),
      log: () => {},
      dataDir: dir,
    };
    await makePlanNode(deps)(sampleState());
    const stateFile = path.join(dir, 'dashboard', 'graph-state.json');
    expect(fs.existsSync(stateFile)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    // v1.2.3：plan 完成 → 活跃节点前移为 engineer（旧字段保留）
    expect(parsed.activeNode).toBe('engineer');
    expect(parsed.workGraphTasks).toBe(2);
    expect(typeof parsed.updatedAt).toBe('string');
    // 新控制图结构
    expect(parsed.nodes).toHaveLength(5);
    expect(parsed.nodes[0]).toMatchObject({ id: 'plan', type: 'planner', status: 'completed' });
    expect(parsed.nodes[1]).toMatchObject({ id: 'engineer-1', type: 'engineer', status: 'running' });
    expect(parsed.nodes[1].subtasks).toHaveLength(2);
    expect(parsed.nodes[2]).toMatchObject({ id: 'audit-1', status: 'pending' });
    expect(parsed.edges).toHaveLength(4);
    expect(parsed.edges[0]).toEqual({ from: 'plan', to: 'engineer-1', type: 'data-flow' });
    expect(parsed.wave).toBe(1);
    expect(parsed.degradationLevel).toBe(0);
  });
});

// ════════════════════════════════════════
// 用例 2-4：降级路由链
// ════════════════════════════════════════

describe('降级路由链（routeAfterAudit + makeAuditNode 集成）', () => {
  interface MockCall { type: string }
  function mockDepsForDegradation(
    callLog: MockCall[],
    auditOutcomes: AuditOutcome[],
    humanDecisions: Array<'y' | 'n' | 'abort'> = ['y'],
  ): LoopGraphDeps {
    let ai = 0;
    let hi = 0;
    const dir = tmpDir();
    return {
      runEngineer: async () => { callLog.push({ type: 'engineer' }); return 'output'; },
      runAudit: async () => { callLog.push({ type: 'audit' }); return auditOutcomes[ai++] ?? auditOutcomes[auditOutcomes.length - 1]!; },
      runReviewer: async () => { callLog.push({ type: 'reviewer' }); return 'IS_PASS: YES'; },
      confirmHuman: async () => { callLog.push({ type: 'human_confirm' }); return humanDecisions[hi++] ?? 'y'; },
      recordBlocked: async () => { callLog.push({ type: 'blocked' }); },
      checkpointer: new FileCheckpointer(dir) as never,
      maxRetries: 3,
      log: () => {},
      degradationChainEnabled: true,
    };
  }

  it('用例 2：第 2 次 audit FAIL → degradationLevel=1 + [降级 L1] 提示词注入', async () => {
    const log: MockCall[] = [];
    const deps = mockDepsForDegradation(log, [
      { verdict: 'FAIL', report: 'fail1' },
      { verdict: 'FAIL', report: 'fail2' },
      { verdict: 'PASS', report: 'pass' },
    ]);
    try {
      const result = await runLoopGraph('任务', { deps, silent: true });
      expect(result.finalStatus).toBe('completed');
      // 第 2 次 FAIL 后 degradationLevel=1
      expect(result.state.degradationLevel).toBe(1);
      // auditReport 头部注入 [降级 L1]
      const l1Report = result.state.artifacts.auditReports.find((r) => r.includes('[降级 L1]'));
      expect(l1Report).toBeDefined();
      expect(l1Report!.indexOf('[降级 L1]')).toBe(0);
      expect(l1Report!).toContain('最小可行版本');
    } finally {
      try { fs.rmSync(deps.checkpointer.dir, { recursive: true, force: true }); } catch { /* */ }
    }
  });

  it('用例 3：第 3 次 audit FAIL → degradationLevel=2 + 继续流转（不 blocked）', async () => {
    const log: MockCall[] = [];
    const deps = mockDepsForDegradation(log, [
      { verdict: 'FAIL', report: 'fail1' },
      { verdict: 'FAIL', report: 'fail2' },
      { verdict: 'FAIL', report: 'fail3' },
    ]);
    try {
      const result = await runLoopGraph('任务', { deps, silent: true });
      // L2 低可信 → 放行 reviewer → human(y) → completed（不 blocked）
      expect(result.finalStatus).toBe('completed');
      expect(result.state.degradationLevel).toBe(2);
      expect(log.some((c) => c.type === 'reviewer')).toBe(true);
      expect(log.some((c) => c.type === 'blocked')).toBe(false);
      // [降级 L2] 注入
      const l2Report = result.state.artifacts.auditReports.find((r) => r.includes('[降级 L2]'));
      expect(l2Report).toBeDefined();
    } finally {
      try { fs.rmSync(deps.checkpointer.dir, { recursive: true, force: true }); } catch { /* */ }
    }
  });

  it('用例 4：降级链超限（degradationLevel=2 且 retryCount>=3 仍 FAIL）→ routeAfterAudit 路由 human_confirm', () => {
    // 纯路由函数断言（不跑全图）：构造超限状态
    const state = sampleState({
      auditResult: 'FAIL',
      retryCount: 3,
      degradationLevel: 2,
      finalStatus: 'running',
    });
    expect(routeAfterAudit(state)).toBe('human_confirm');
  });

  it('路由矩阵：L2 未超限 FAIL → checker；L0/L1 FAIL → engineer；blocked → END', () => {
    // L2 低可信（retryCount 未超限）→ checker 继续流转（v1.2.4 P2b：先过 checker 再进 reviewer）
    expect(routeAfterAudit(sampleState({ auditResult: 'FAIL', retryCount: 1, degradationLevel: 2 }))).toBe('checker');
    // L0 正常 FAIL → engineer
    expect(routeAfterAudit(sampleState({ auditResult: 'FAIL', retryCount: 0, degradationLevel: 0 }))).toBe('engineer');
    // L1 降级 FAIL → engineer
    expect(routeAfterAudit(sampleState({ auditResult: 'FAIL', retryCount: 1, degradationLevel: 1 }))).toBe('engineer');
    // blocked → END
    expect(routeAfterAudit(sampleState({ auditResult: 'FAIL', finalStatus: 'blocked' }))).toBe(END);
    // PASS → checker（v1.2.4 P2b）
    expect(routeAfterAudit(sampleState({ auditResult: 'PASS' }))).toBe('checker');
  });
});

// ════════════════════════════════════════
// 用例 5-6 + 8：decide 层（路由 + schema 校验）
// ════════════════════════════════════════

describe('engineer decide 层', () => {
  it('用例 5：public 数据 → ModelRouter 路由到云端（cloud-fast）', async () => {
    // frontmatter 显式标 public；任务含「翻译」关键词 → simple → cloud-fast
    const router = createDefaultRouter();
    const route = router.route('翻译这个 README', { frontmatter: { sensitivity: 'public' } });
    expect(route.target).toBe('cloud-fast');
    expect(route.sensitivity).toBe('public');

    // engineerDecide 全链路：callLLM mock 验证收到了云端路由
    let seenTarget = '';
    const deps: EngineerDecideDeps = {
      callLLM: async (_p, r) => { seenTarget = r.target; return validDecideJson(); },
      router,
      log: () => {},
    };
    const result = await engineerDecide({ task: '翻译这个 README' }, deps);
    // public 任务经 frontmatter 判定 —— 此处 task 无 frontmatter，默认 internal×simple → cloud-fast
    expect(result).not.toBeNull();
    expect(seenTarget === 'cloud-fast' || seenTarget === 'cloud-strong').toBe(true);
  });

  it('用例 6：restricted 数据（含手机号 PII）→ ModelRouter 路由到 local-executor', async () => {
    const router = createDefaultRouter();
    let seenTarget = '';
    const deps: EngineerDecideDeps = {
      callLLM: async (_p, r) => { seenTarget = r.target; return validDecideJson(); },
      router,
      log: () => {},
    };
    // PII 正则命中（中国大陆手机号）→ restricted → local-executor
    const result = await engineerDecide({ task: '修改用户 13812345678 的配置文件' }, deps);
    expect(result).not.toBeNull();
    expect(seenTarget).toBe('local-executor');
  });

  it('用例 8：decide JSON schema 校验失败（非法 JSON / 缺字段 / action 非法）→ 返回 null 走降级链', async () => {
    // 非法 JSON
    expect(parseEngineerDecide('这根本不是 JSON')).toBeNull();
    // 缺 changes 字段
    expect(parseEngineerDecide('{"rationale":"x"}')).toBeNull();
    // action 非法枚举值
    expect(parseEngineerDecide(JSON.stringify({
      changes: [{ file: 'a.ts', action: 'delete', description: 'x', diffHint: '' }],
      rationale: '',
    }))).toBeNull();
    // changes 空数组（min(1) 约束）
    expect(parseEngineerDecide(JSON.stringify({ changes: [], rationale: '' }))).toBeNull();

    // engineerDecide 全链路：LLM 返回非法 JSON → null
    const deps: EngineerDecideDeps = {
      callLLM: async () => '垃圾输出',
      router: createDefaultRouter(),
      log: () => {},
    };
    const result = await engineerDecide({ task: '做个功能' }, deps);
    expect(result).toBeNull();
  });

  it('decide prompt：降级等级注入 [降级 L1] / [降级 L2]', () => {
    expect(buildDecidePrompt({ task: 'T', degradationLevel: 1 })).toContain('[降级 L1]');
    expect(buildDecidePrompt({ task: 'T', degradationLevel: 2 })).toContain('[降级 L2]');
    expect(buildDecidePrompt({ task: 'T', degradationLevel: 0 })).not.toContain('[降级');
    // 子任务与反馈拼入
    const p = buildDecidePrompt({ task: 'T', subtask: '子任务A', feedback: '修复B' });
    expect(p).toContain('子任务A');
    expect(p).toContain('修复B');
  });

  it('extractDecideJson：围栏与裸 JSON', () => {
    expect(extractDecideJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractDecideJson('前缀{"a":1}后缀')).toBe('{"a":1}');
  });

  it('block 路由（confidential 超复杂）→ engineerDecide 返回 null 且不调 LLM', async () => {
    const router = createDefaultRouter();
    // 先确认路由矩阵：confidential + super-complex → block
    const blockRoute = router.route('跨文件 多步workflow 重构', {
      frontmatter: { sensitivity: 'confidential' },
    });
    expect(blockRoute.target).toBe('block');

    // engineerDecide 全链路：构造 confidential 任务（frontmatter 无法直接透传——
    // 用 PII 让敏感度评估命中 restricted 走 local-executor，再验证 block 路径用 route 直测）。
    // block 分支在 engineerDecide 内部以 route.target==='block' 短路——此处通过
    // 注入一个 route() 永远返回 block 的 mock router 验证该分支。
    const mockRouter = {
      route: () => ({
        target: 'block' as const,
        reason: 'insufficient-local-capacity' as const,
        sensitivity: 'confidential' as const,
        blockReason: '本地能力不足',
      }),
    };
    let llmCalled = false;
    const deps = {
      callLLM: async () => { llmCalled = true; return ''; },
      router: mockRouter as never,
      log: () => {},
    };
    const result = await engineerDecide({ task: '任意任务' }, deps);
    expect(result).toBeNull();
    expect(llmCalled).toBe(false);
  });
});

// ════════════════════════════════════════
// 用例 7：execute 确定性
// ════════════════════════════════════════

function validDecideJson(): string {
  return JSON.stringify({
    changes: [
      { file: 'src/foo.ts', action: 'create', description: '新建 foo 模块', diffHint: 'export const foo = 1;\n' },
      { file: 'README.md', action: 'edit', description: '追加说明', diffHint: '## 新增章节\n' },
    ],
    rationale: '最小变更实现',
  });
}

describe('engineer execute 层', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

  it('用例 7：相同 decide JSON → 相同文件编辑结果（dryRun 无副作用）', async () => {
    const decide = parseEngineerDecide(validDecideJson())!;
    const deps: EngineerExecuteDeps = { cwd: dir, dryRun: true, log: () => {} };

    const r1 = await engineerExecute(decide, deps);
    const r2 = await engineerExecute(decide, deps);

    // 确定性：两次结果逐字段一致
    expect(r1.allSuccess).toBe(true);
    expect(r1.changes).toEqual(r2.changes);
    expect(r1.diff).toBe(r2.diff);
    // dryRun 无副作用：目标文件不存在
    expect(fs.existsSync(path.join(dir, 'src/foo.ts'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'README.md'))).toBe(false);
  });

  it('真实写盘（dryRun=false）：create 写全文 + edit 追加，git 不可用降级摘要', async () => {
    const decide = parseEngineerDecide(validDecideJson())!;
    const deps: EngineerExecuteDeps = { cwd: dir, dryRun: false, log: () => {} };
    const result = await engineerExecute(decide, deps);
    expect(result.allSuccess).toBe(true);
    // create：diffHint 即全文
    expect(fs.readFileSync(path.join(dir, 'src/foo.ts'), 'utf-8')).toBe('export const foo = 1;\n');
    // edit（文件不存在 → 等价 create）
    expect(fs.readFileSync(path.join(dir, 'README.md'), 'utf-8')).toBe('## 新增章节\n');
    // 非 git 仓库 → diff 降级摘要（不 throw）
    expect(result.diff).toContain('git 不可用');
  });

  it('computeResultContent：edit 已存在文件 → 尾部追加带分隔注释', () => {
    const target = path.join(dir, 'exist.ts');
    fs.writeFileSync(target, 'const a = 1;\n', 'utf-8');
    const out = computeResultContent(target, 'edit', 'const b = 2;');
    expect(out).toContain('const a = 1;');
    expect(out).toContain('sofagent execute 变更');
    expect(out).toContain('const b = 2;');
    // create 覆盖语义
    expect(computeResultContent(target, 'create', 'NEW')).toBe('NEW');
  });

  it('decide/execute 接口契约：parseEngineerDecide 输出可直接喂给 engineerExecute', async () => {
    const decide = parseEngineerDecide(validDecideJson())!;
    expect(decide.changes.length).toBe(2);
    expect(decide.changes[0]!.action).toBe('create');
    expect(decide.rationale).toBe('最小变更实现');
    const result = await engineerExecute(decide, { cwd: dir, dryRun: true });
    expect(result.summary).toContain('rationale');
  });
});

// ════════════════════════════════════════
// 用例 9：Dashboard Graph 区块数据源
// ════════════════════════════════════════

describe('graph-state.json（Dashboard Graph Engine 区块数据源）', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

  it('用例 9：writeGraphState 落盘 → 完整控制图结构 + 旧三字段保留（向后兼容）', () => {
    writeGraphState(dir, {
      activeNode: 'engineer',
      retryCount: 0,
      subtasks: [
        { id: 'st-1', description: '实现 worktree 隔离', status: 'done' },
        { id: 'st-2', description: '实现 merge gate', status: 'pending' },
      ],
    });
    const file = path.join(dir, 'dashboard', 'graph-state.json');
    expect(fs.existsSync(file)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));

    // ── 旧三字段保留（Dashboard bash v1.2.2 jq // 兜底读侧不崩溃）──
    expect(parsed.activeNode).toBe('engineer');
    expect(parsed.workGraphTasks).toBe(2);
    // ISO 8601 可解析
    expect(Number.isNaN(Date.parse(parsed.updatedAt))).toBe(false);

    // ── 新控制图结构（v1.2.3）──
    expect(Array.isArray(parsed.nodes)).toBe(true);
    expect(parsed.nodes).toHaveLength(5);
    expect(parsed.nodes.map((n: { id: string }) => n.id)).toEqual([
      'plan', 'engineer-1', 'audit-1', 'reviewer-1', 'human-1',
    ]);
    // engineer running → plan completed，audit/reviewer/human pending
    expect(parsed.nodes[0].status).toBe('completed');
    expect(parsed.nodes[1].status).toBe('running');
    expect(parsed.nodes[2].status).toBe('pending');
    // engineer 子任务进度
    expect(parsed.nodes[1].subtasks).toEqual([
      { id: 'st-1', desc: '实现 worktree 隔离', status: 'done' },
      { id: 'st-2', desc: '实现 merge gate', status: 'pending' },
    ]);
    // 边：拓扑序 4 条 data-flow
    expect(parsed.edges).toHaveLength(4);
    expect(parsed.edges[1]).toEqual({ from: 'engineer-1', to: 'audit-1', type: 'data-flow' });
    // wave = retryCount + 1；degradationLevel 缺省 0
    expect(parsed.wave).toBe(1);
    expect(parsed.degradationLevel).toBe(0);
  });

  it('wave 语义 = retryCount + 1；degradationLevel 透传', () => {
    writeGraphState(dir, { activeNode: 'engineer', retryCount: 2, degradationLevel: 1 });
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, 'dashboard', 'graph-state.json'), 'utf-8'));
    expect(parsed.wave).toBe(3);
    expect(parsed.degradationLevel).toBe(1);
  });

  it('auditResult 回写：FAIL → audit 节点 failed；PASS → completed', () => {
    writeGraphState(dir, { activeNode: 'audit', auditResult: 'FAIL' });
    let parsed = JSON.parse(fs.readFileSync(path.join(dir, 'dashboard', 'graph-state.json'), 'utf-8'));
    expect(parsed.nodes[2]).toMatchObject({ id: 'audit-1', status: 'failed' });

    writeGraphState(dir, { activeNode: 'audit', auditResult: 'PASS' });
    parsed = JSON.parse(fs.readFileSync(path.join(dir, 'dashboard', 'graph-state.json'), 'utf-8'));
    expect(parsed.nodes[2]).toMatchObject({ id: 'audit-1', status: 'completed' });
  });

  it('finalStatus=completed → 全部节点 completed；blocked → 活跃节点 failed', () => {
    writeGraphState(dir, { activeNode: 'human_confirm', finalStatus: 'completed' });
    let parsed = JSON.parse(fs.readFileSync(path.join(dir, 'dashboard', 'graph-state.json'), 'utf-8'));
    expect(parsed.nodes.every((n: { status: string }) => n.status === 'completed')).toBe(true);

    writeGraphState(dir, { activeNode: 'audit', finalStatus: 'blocked' });
    parsed = JSON.parse(fs.readFileSync(path.join(dir, 'dashboard', 'graph-state.json'), 'utf-8'));
    expect(parsed.nodes[2].status).toBe('failed');
    expect(parsed.nodes[3].status).toBe('pending');
  });

  it('目录不存在时自动创建；重复写覆盖（Dashboard 读最新）', () => {
    writeGraphState(dir, { activeNode: 'plan' });
    writeGraphState(dir, { activeNode: 'audit' });
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, 'dashboard', 'graph-state.json'), 'utf-8'));
    expect(parsed.activeNode).toBe('audit');
  });

  it('写失败静默（非法路径不 throw）', () => {
    // 传入文件路径作为 dir（mkdir 必失败）→ 静默
    const fileAsDir = path.join(dir, 'a-file');
    fs.writeFileSync(fileAsDir, 'x', 'utf-8');
    expect(() => writeGraphState(fileAsDir, { activeNode: 'plan' })).not.toThrow();
  });
});

// ════════════════════════════════════════
// 补充：subtasks 在 engineer 节点的消费
// ════════════════════════════════════════

describe('engineer 节点消费 subtasks（plan → engineer 串联）', () => {
  it('plan 产出 subtasks → engineer 执行后当前 pending 子任务标记 done', async () => {
    const dir = tmpDir();
    const callLog: string[] = [];
    const deps: LoopGraphDeps = {
      runPlannerDecide: async () => JSON.stringify({
        subtasks: [{ id: 's1', description: '第一步' }, { id: 's2', description: '第二步' }],
        rationale: '',
      }),
      runEngineer: async (task: string) => { callLog.push(task); return 'done'; },
      runAudit: async () => ({ verdict: 'PASS', report: 'ok' }),
      runReviewer: async () => 'IS_PASS: YES',
      confirmHuman: async () => 'y',
      recordBlocked: async () => {},
      checkpointer: new FileCheckpointer(dir) as never,
      maxRetries: 3,
      log: () => {},
      dataDir: dir,
      // v1.2.3 AD-2：显式注入 dashboardDir（否则 defaultDeps 注入真实 $SOFAGENT_HOME/data）
      dashboardDir: dir,
      degradationChainEnabled: true,
    };
    try {
      const result = await runLoopGraph('复合任务', { deps, silent: true });
      expect(result.finalStatus).toBe('completed');
      // engineer 收到的任务包含当前子任务上下文
      expect(callLog[0]).toContain('当前子任务');
      expect(callLog[0]).toContain('第一步');
      // s1 被标记 done，s2 仍 pending
      const subs = result.state.artifacts.subtasks;
      expect(subs.find((s) => s.id === 's1')!.status).toBe('done');
      expect(subs.find((s) => s.id === 's2')!.status).toBe('pending');
      // graph-state.json 被 plan/engineer 更新过
      expect(fs.existsSync(path.join(dir, 'dashboard', 'graph-state.json'))).toBe(true);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
    }
  });

  it('dashboardDir 注点优先于 dataDir（AD-2 路径修复）', async () => {
    const dataDir = tmpDir();
    const dashDir = tmpDir();
    const deps: LoopGraphDeps = {
      runPlannerDecide: async () => JSON.stringify({
        subtasks: [{ id: 's1', description: '唯一子任务' }],
        rationale: '',
      }),
      runEngineer: async () => 'done',
      runAudit: async () => ({ verdict: 'PASS', report: 'ok' }),
      runReviewer: async () => 'IS_PASS: YES',
      confirmHuman: async () => 'y',
      recordBlocked: async () => {},
      checkpointer: new FileCheckpointer(tmpDir()) as never,
      maxRetries: 3,
      log: () => {},
      dataDir,
      dashboardDir: dashDir,
      degradationChainEnabled: true,
    };
    try {
      const result = await runLoopGraph('路径修复验证任务', { deps, silent: true });
      expect(result.finalStatus).toBe('completed');
      // graph-state.json 写到 dashboardDir/dashboard/，不是 dataDir/dashboard/
      const stateFile = path.join(dashDir, 'dashboard', 'graph-state.json');
      expect(fs.existsSync(stateFile)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      // 终态：audit PASS 后写 audit completed
      expect(parsed.nodes).toHaveLength(5);
      expect(Number.isNaN(Date.parse(parsed.updatedAt))).toBe(false);
    } finally {
      try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
      try { fs.rmSync(dashDir, { recursive: true, force: true }); } catch { /* */ }
    }
  });
});
