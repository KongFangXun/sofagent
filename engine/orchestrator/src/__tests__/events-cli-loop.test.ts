// ============================================================
// events-cli-loop.test.ts · 真实节点循环的事件触发集成测试（v1.5.1 第一章接线）
// ============================================================
//
// 与 events-bus.test.ts / error-bus.test.ts 的**层级差异**：
//   那两个文件是**单元级**（直接构造 EventBus / 直接调 emitCompletion）；
//   本文件是**集成级**——spawn 真实 CLI（`dist/cli.js run-enterprise`），
//   走真实节点循环 + 真实 node-executor，只对**落盘产物**断言。
//
// 断言目标（两件事，缺一不可）：
//   ① 真实节点循环会发出 completion——event-queue.jsonl 里出现节点产出的
//      `workflow.node.completed`（不是测试自己 publish 的）。
//   ② 「上游节点产出 → 下游节点被触发」在真实 runner 上闭环——下游节点的
//      产出事件 `causationId` 指向**上游节点的产出事件 id**、共享同一
//      correlationId、`metadata.chainDepth = 1`；且下游节点**只执行一次**
//      （拓扑循环不重复跑已被事件触发的节点）。
//
// 前置：`dist/cli.js` 必须已构建（CI 顺序 = npm run build → npm test）。
// 缺失即 fail-loud 报错并给出修复命令——不静默 skip（静默 skip 会让
// 「集成测试通过」变成一句无证据的书面声称）。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CLI = path.resolve(__dirname, '..', '..', 'dist', 'cli.js');

/** 事件队列条目（只声明断言用到的字段） */
interface QueuedEvent {
  id: string;
  type: string;
  ts: string;
  correlationId: string;
  causationId?: string;
  workflowId?: string;
  payload: { workflowId?: string; nodeId?: string; output?: string; success?: boolean };
  metadata?: Record<string, unknown>;
}

let workDir: string;
let dataDir: string;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-evt-cli-'));
  // SOFAGENT_DATA 只在目录**已存在**时生效（core config-loader 判 existsSync）——
  // 不预建目录会让落盘悄悄跑到默认数据目录，测试就测不到自己的产物。
  dataDir = path.join(workDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
});

afterEach(() => {
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {
    // 临时目录由 OS 回收
  }
});

/** 跑真实 CLI（cwd 锁在临时工程目录，避免污染仓库） */
function runCli(workflowFile: string): { status: number; stdout: string } {
  if (!fs.existsSync(CLI)) {
    throw new Error(
      `集成测试需要已构建的 ${CLI}——先跑 \`npm run build --workspace=engine/orchestrator\`（CI 顺序：build → test）`,
    );
  }
  const r = spawnSync(process.execPath, [CLI, 'run-enterprise', '--workflow', workflowFile], {
    cwd: workDir,
    encoding: 'utf-8',
    env: { ...process.env, SOFAGENT_DATA: dataDir },
    timeout: 60_000,
  });
  return { status: r.status ?? -1, stdout: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** 写一个 workflow.yml 到临时工程目录 */
function writeWorkflow(fileName: string, body: string): string {
  const p = path.join(workDir, fileName);
  fs.writeFileSync(p, body, 'utf-8');
  return p;
}

/** 读事件队列（每行一 JSON） */
function readQueue(): QueuedEvent[] {
  const p = path.join(dataDir, 'events', 'event-queue.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, 'utf-8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as QueuedEvent);
}

/** 读投递留痕（每行一 JSON） */
function readTrail(): Array<Record<string, unknown>> {
  const p = path.join(dataDir, 'events', 'delivery-trail.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, 'utf-8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** 节点执行留痕文件名（execution-log.<nodeId>.<ts>.yml） */
function executedNodeIds(): string[] {
  const dir = path.join(dataDir, 'ontology', 'entities');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('execution-log.') && f.endsWith('.yml'))
    .map((f) => f.replace(/^execution-log\./, '').replace(/\.\d+\.yml$/, ''))
    .sort();
}

// ════════════════════════════════════════
// ① 真实节点循环发 completion + 下游被事件触发（闭环）
// ════════════════════════════════════════

describe('真实节点循环：事件链路闭环', () => {
  it('上游节点产出事件 → 下游节点被触发执行（causationId 连线 + 不重复执行）', () => {
    const wf = writeWorkflow(
      'wf-on.yml',
      [
        'workflow:',
        '  name: cli-loop-on',
        '  nodes:',
        '    - id: intake',
        '      agent: developer',
        '      task: 接单',
        '    - id: followup',
        '      agent: qa-engineer',
        '      task: 跟进',
        '      on:',
        '        event: workflow.node.completed',
        '        from: intake',
        '',
      ].join('\n'),
    );

    const { status, stdout } = runCli(wf);
    expect(status).toBe(0);

    // ── ① 真实节点循环发出了 completion（队列里的 intake 事件由循环产出）──
    const queue = readQueue();
    const nodeEvents = queue.filter((e) => e.type === 'workflow.node.completed');
    const intakeEvent = nodeEvents.find((e) => e.payload.nodeId === 'intake');
    const followupEvent = nodeEvents.find((e) => e.payload.nodeId === 'followup');
    expect(intakeEvent, '真实循环未发出 intake 的 workflow.node.completed').toBeDefined();
    expect(followupEvent, '下游 followup 未产出事件（事件链未闭环）').toBeDefined();

    // 循环发出的根事件：自己是链条根（correlationId = 自身 id），无 causationId
    expect(intakeEvent!.correlationId).toBe(intakeEvent!.id);
    expect(intakeEvent!.causationId).toBeUndefined();
    expect(intakeEvent!.workflowId).toBe('cli-loop-on');

    // ── ② 下游事件挂在同一因果链上（causationId 指向 intake 事件）──
    expect(followupEvent!.correlationId).toBe(intakeEvent!.id);
    expect(followupEvent!.causationId).toBe(intakeEvent!.id);
    expect(followupEvent!.metadata?.chainDepth).toBe(1);

    // 投递全程留痕：两个事件都 DELIVERED
    const delivered = readTrail().filter((d) => d.kind === 'DELIVERED');
    expect(delivered.length).toBeGreaterThanOrEqual(2);
    expect(delivered.some((d) => d.correlationId === intakeEvent!.id)).toBe(true);

    // ── 真实 runner 上的执行证据 ──
    // intake 由拓扑循环跑；followup 由**事件触发**跑（不是拓扑循环）
    expect(stdout).toContain('▶️  执行节点 intake');
    expect(stdout).toContain('▶️  [事件触发] 执行节点 followup');
    // 下游节点只执行一次（拓扑循环跳过已被事件触发的节点）——每个节点各 1 条留痕
    expect(executedNodeIds()).toEqual(['followup', 'intake']);
  });

  it('三条 on: 链上游产出 → 中游 → 下游逐级触发（链深递增）', () => {
    const wf = writeWorkflow(
      'wf-chain.yml',
      [
        'workflow:',
        '  name: cli-loop-chain',
        '  nodes:',
        '    - id: a',
        '      agent: developer',
        '      task: 第一跳',
        '    - id: b',
        '      agent: qa-engineer',
        '      task: 第二跳',
        '      on:',
        '        event: workflow.node.completed',
        '        from: a',
        '    - id: c',
        '      agent: researcher',
        '      task: 第三跳',
        '      on:',
        '        event: workflow.node.completed',
        '        from: b',
        '',
      ].join('\n'),
    );

    const { status } = runCli(wf);
    expect(status).toBe(0);

    const evts = readQueue().filter((e) => e.type === 'workflow.node.completed');
    const byNode = (id: string) => evts.find((e) => e.payload.nodeId === id);
    const [a, b, c] = ['a', 'b', 'c'].map(byNode);
    expect(a && b && c).toBeTruthy();

    // 同一条触发链：三者共享 correlationId = a.id，逐级 causationId 相连
    expect(new Set(evts.map((e) => e.correlationId)).size).toBe(1);
    expect(b!.causationId).toBe(a!.id);
    expect(c!.causationId).toBe(b!.id);
    expect([a!.metadata?.chainDepth, b!.metadata?.chainDepth, c!.metadata?.chainDepth]).toEqual([
      undefined,
      1,
      2,
    ]);
    // 三级各执行一次（无重复）
    expect(executedNodeIds()).toEqual(['a', 'b', 'c']);
  });
});

// ════════════════════════════════════════
// ② 零行为变化守卫（无 on: 声明的既有 workflow）
// ════════════════════════════════════════

describe('零行为变化守卫：workflow 无 on: 声明', () => {
  it('不产生任何 events/ 落盘、不触发事件路径、仍按拓扑顺序跑完两个节点', () => {
    const wf = writeWorkflow(
      'wf-no-on.yml',
      [
        'workflow:',
        '  name: cli-loop-no-on',
        '  nodes:',
        '    - id: a',
        '      agent: developer',
        '      task: 一',
        '      depends_on: []',
        '    - id: b',
        '      agent: qa-engineer',
        '      task: 二',
        '      depends_on: [a]',
        '',
      ].join('\n'),
    );

    const { status, stdout } = runCli(wf);
    expect(status).toBe(0);

    // 既有行为：两个节点按拓扑顺序跑完，输出与接线前同形
    expect(stdout).toContain('▶️  执行节点 a');
    expect(stdout).toContain('▶️  执行节点 b');
    expect(stdout).toContain('✅ 所有节点执行完成');
    expect(executedNodeIds()).toEqual(['a', 'b']);

    // 守卫生效：完全没碰事件面
    expect(stdout).not.toContain('[事件触发]');
    expect(fs.existsSync(path.join(dataDir, 'events'))).toBe(false);
    expect(readQueue()).toEqual([]);
    expect(readTrail()).toEqual([]);
    // 也没有事件路由决策留痕
    expect(fs.existsSync(path.join(dataDir, 'audit', 'decision-log.jsonl'))).toBe(false);
  });
});
