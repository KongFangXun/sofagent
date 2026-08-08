// ============================================================
// hitl-channel.test.ts · Storage-backed HITL 异步人工确认测试
// v1.2.9 P3b 新增
//
// 覆盖（≥5 用例）：
// 1. 异步模式写请求——writeHITLRequest 落盘 + schema 字段完整
// 2. 异步模式读响应——writeHITLResponse 后 readHITLResponse 返回正确 decision
// 3. 异步模式全流程——runLoopGraph 挂起 awaiting_human → 外部信号 → resume → completed
// 4. CLI 降级模式——无 hitl/pending/ 目录 → shouldUseAsyncHITL=false → 走 confirmHuman stdin 路径
// 5. daemon 续跑——写请求 → 模拟进程重启（新 FileCheckpointer 实例）→ resume 从 checkpoint 恢复
// 6. --resolve 语义——writeHITLResponse(approve) + resumeLoopGraph → 验证 completed 落盘 + humanFeedback
// 7. 无响应时 resume 幂等——awaiting_human 但 resolved/ 为空 → 返回原状态仍在等待
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomBytes } from 'crypto';

import {
  HITL_OPTIONS,
  shouldUseAsyncHITL,
  writeHITLRequest,
  readHITLResponse,
  writeHITLResponse,
  type HITLRequest,
  type HITLResponse,
} from '../hitl';

import { FileCheckpointer } from '../graph/checkpoint';
import { runLoopGraph, resumeLoopGraph } from '../loop/graph';
// QA-FIX(v1.2.2 回归): LoopGraphDeps/AuditOutcome 定义并导出于 ../loop/nodes，
// graph.ts 未再导出——修正导入来源（tsc TS2459/TS2305）
import type { LoopGraphDeps, AuditOutcome } from '../loop/nodes';

// ════════════════════════════════════════
// Helper
// ════════════════════════════════════════

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-hitl-'));
}

function rmDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 清理失败忽略 */
  }
}

/** 构造一个会立即到达 human_confirm 的 mock deps（engineer/audit/reviewer 直通） */
function makeDeps(dataDir: string, overrides: Partial<LoopGraphDeps> = {}): Partial<LoopGraphDeps> {
  const checkpointer = new FileCheckpointer(path.join(dataDir, 'checkpoint'));
  return {
    runEngineer: async () => 'engineer 产出：已完成任务',
    runAudit: async (): Promise<AuditOutcome> => ({ verdict: 'PASS', report: '审计 PASS' }),
    runReviewer: async () => 'reviewer 审查报告：IS_PASS: YES',
    // CLI 同步模式的 stdin 路径——异步模式下不应被调用
    confirmHuman: async () => {
      throw new Error('异步模式下不应走到 confirmHuman');
    },
    recordBlocked: async () => undefined,
    checkpointer,
    maxRetries: 3,
    log: () => undefined,
    dataDir,
    ...overrides,
  };
}

/** 从 checkpoint 目录读 latest 的 checkpointId（供 resume 断言） */
function latestCheckpointId(dataDir: string): string {
  const cp = new FileCheckpointer(path.join(dataDir, 'checkpoint'));
  const record = cp.loadLatest();
  if (!record) throw new Error('latest checkpoint 不存在');
  return record.checkpointId;
}

// ════════════════════════════════════════
// 用例 1 · 异步模式写请求：schema 完整
// ════════════════════════════════════════

describe('writeHITLRequest（异步模式写请求）', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpDir();
    fs.mkdirSync(path.join(dir, 'hitl', 'pending'), { recursive: true });
  });
  afterEach(() => rmDir(dir));

  it('pending/{checkpointId}.json 落盘且字段与 P3b schema 一致', () => {
    const checkpointId = `loop-test-${randomBytes(3).toString('hex')}`;
    const request: HITLRequest = {
      checkpointId,
      createdAt: '2026-07-28T14:30:00Z',
      task: '实现 Storage-backed HITL',
      reviewReport: 'reviewer 产出摘要：IS_PASS: YES',
      auditResult: 'PASS',
      retryCount: 0,
      options: [...HITL_OPTIONS],
    };
    writeHITLRequest(dir, request);

    const filePath = path.join(dir, 'hitl', 'pending', `${checkpointId}.json`);
    expect(fs.existsSync(filePath)).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    expect(parsed.checkpointId).toBe(checkpointId);
    expect(parsed.createdAt).toBe('2026-07-28T14:30:00Z');
    expect(parsed.task).toBe('实现 Storage-backed HITL');
    expect(parsed.reviewReport).toContain('IS_PASS');
    expect(parsed.auditResult).toBe('PASS');
    expect(parsed.retryCount).toBe(0);
    expect(parsed.options).toEqual(['approve', 'reject', 'aborted']);
  });
});

// ════════════════════════════════════════
// 用例 2 · 读响应：decision 正确解析
// ════════════════════════════════════════

describe('readHITLResponse（异步模式读响应）', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpDir();
    fs.mkdirSync(path.join(dir, 'hitl', 'resolved'), { recursive: true });
  });
  afterEach(() => rmDir(dir));

  it('写入 resolved 文件后返回正确 decision；无文件返回 null', () => {
    const checkpointId = `loop-test-${randomBytes(3).toString('hex')}`;
    // 无文件 → null
    expect(readHITLResponse(dir, checkpointId)).toBeNull();

    const response: HITLResponse = {
      checkpointId,
      decision: 'reject',
      resolvedAt: new Date().toISOString(),
      comment: '请修复命名规范',
    };
    writeHITLResponse(dir, response);

    const read = readHITLResponse(dir, checkpointId);
    expect(read).not.toBeNull();
    expect(read!.decision).toBe('reject');
    expect(read!.comment).toBe('请修复命名规范');
    expect(read!.checkpointId).toBe(checkpointId);
  });

  it('非法 decision 文件返回 null（schema 校验）', () => {
    const checkpointId = `loop-test-${randomBytes(3).toString('hex')}`;
    const filePath = path.join(dir, 'hitl', 'resolved', `${checkpointId}.json`);
    fs.writeFileSync(
      filePath,
      JSON.stringify({ checkpointId, decision: 'hack', resolvedAt: new Date().toISOString() }),
      'utf-8',
    );
    expect(readHITLResponse(dir, checkpointId)).toBeNull();
  });
});

// ════════════════════════════════════════
// 用例 3 · 异步模式全流程：挂起 → 外部信号 → resume → completed
// ════════════════════════════════════════

describe('异步 HITL 全流程（挂起 → approve → resume）', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpDir();
    fs.mkdirSync(path.join(dir, 'hitl', 'pending'), { recursive: true });
  });
  afterEach(() => rmDir(dir));

  it('runLoopGraph 返回 awaiting_human → writeHITLResponse(approve) → resume → completed', async () => {
    const deps = makeDeps(dir);
    // confirmHuman 在异步模式下不应被调用（makeDeps 内已 throw）

    // ① 首次运行——到达 human_confirm 应挂起
    const first = await runLoopGraph('修复登录页样式', { deps });
    expect(first.finalStatus).toBe('awaiting_human');
    expect(first.state.finalStatus).toBe('awaiting_human');

    // ② HITL 请求文件已落盘
    const checkpointId = first.checkpointId;
    const pendingFile = path.join(dir, 'hitl', 'pending', `${checkpointId}.json`);
    expect(fs.existsSync(pendingFile)).toBe(true);
    const pending = JSON.parse(fs.readFileSync(pendingFile, 'utf-8')) as HITLRequest;
    expect(pending.task).toBe('修复登录页样式');
    expect(pending.options).toEqual(['approve', 'reject', 'aborted']);

    // ③ 模拟外部信号（Dashboard/CLI --resolve）：写 approve 响应
    writeHITLResponse(dir, {
      checkpointId,
      decision: 'approve',
      resolvedAt: new Date().toISOString(),
    });

    // ④ resume → 应按 decision 走到 completed
    const resumed = await resumeLoopGraph({ deps: makeDeps(dir) });
    expect(resumed).not.toBeNull();
    expect(resumed!.finalStatus).toBe('completed');
    expect(resumed!.state.artifacts.humanFeedback).toBe('approved');

    // ⑤ completed 已写回 checkpoint（下次 resume 不再重复执行）
    const cp = new FileCheckpointer(path.join(dir, 'checkpoint'));
    const latest = cp.loadLatest();
    expect(latest!.state.finalStatus).toBe('completed');
  });

  it('reject 且未超限时 resume 回 engineer 重跑一轮', async () => {
    let engineerCalls = 0;
    const deps = makeDeps(dir, {
      runEngineer: async () => {
        engineerCalls += 1;
        return `engineer 产出 第${engineerCalls}轮`;
      },
      // 第二轮 run 到 human_confirm 时直接 approve（第二次运行改成同步 approve 响应预写）
    });

    // ① 首轮挂起
    const first = await runLoopGraph('实现用户登录', { deps });
    expect(first.finalStatus).toBe('awaiting_human');
    expect(engineerCalls).toBe(1);
    const checkpointId = first.checkpointId;

    // ② 预写第二轮的 approve 响应会在 resume 前被覆盖——先写 reject
    writeHITLResponse(dir, {
      checkpointId,
      decision: 'reject',
      resolvedAt: new Date().toISOString(),
      comment: '边界条件未处理',
    });

    // ③ resume → reject → engineer 重跑 → human_confirm 再次挂起
    //   （第二轮 human_confirm 走异步模式：resolved 文件已被第一轮消费，
    //    但节点会重写 pending 并再次返回 awaiting_human）
    const resumed = await resumeLoopGraph({ deps });
    expect(engineerCalls).toBe(2);
    expect(resumed!.retryCount).toBe(1);
    // 第二轮 human_confirm 又写 pending 并挂起（无新响应 → awaiting_human）
    expect(resumed!.finalStatus).toBe('awaiting_human');
    expect(resumed!.state.artifacts.humanFeedback).toBe('reject: 边界条件未处理');

    // ④ 再写 approve → 第二次 resume → completed
    writeHITLResponse(dir, {
      checkpointId,
      decision: 'approve',
      resolvedAt: new Date().toISOString(),
    });
    const second = await resumeLoopGraph({ deps });
    expect(second!.finalStatus).toBe('completed');
  });
});

// ════════════════════════════════════════
// 用例 4 · CLI 降级模式：无 pending/ 目录走 stdin 路径
// ════════════════════════════════════════

describe('CLI 同步降级模式（无 hitl/pending/ 目录）', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpDir();
    // 注意：不创建 hitl/pending/ 目录——shouldUseAsyncHITL 应返回 false
  });
  afterEach(() => rmDir(dir));

  it('shouldUseAsyncHITL 返回 false → 走 confirmHuman stdin 路径（mock y → completed）', async () => {
    expect(shouldUseAsyncHITL(dir)).toBe(false);

    let confirmCalled = 0;
    const deps = makeDeps(dir, {
      confirmHuman: async () => {
        confirmCalled += 1;
        return 'y'; // 模拟终端输入 y
      },
    });

    const result = await runLoopGraph('CLI 模式任务', { deps });
    expect(confirmCalled).toBe(1);
    expect(result.finalStatus).toBe('completed');
    expect(result.state.artifacts.humanFeedback).toBe('approved');

    // CLI 模式下不写 pending/ 文件
    expect(fs.existsSync(path.join(dir, 'hitl', 'pending'))).toBe(false);
  });

  it('CLI 模式 n → 驳回回 engineer，重试后 y → completed', async () => {
    let engineerCalls = 0;
    let confirmCalls = 0;
    const deps = makeDeps(dir, {
      runEngineer: async () => {
        engineerCalls += 1;
        return `产出 第${engineerCalls}轮`;
      },
      confirmHuman: async () => {
        confirmCalls += 1;
        return confirmCalls === 1 ? 'n' : 'y';
      },
    });

    const result = await runLoopGraph('CLI 驳回重试任务', { deps });
    expect(engineerCalls).toBe(2);
    expect(confirmCalls).toBe(2);
    expect(result.finalStatus).toBe('completed');
    expect(result.retryCount).toBe(1);
  });
});

// ════════════════════════════════════════
// 用例 5 · daemon 续跑：模拟进程重启后从 checkpoint 恢复
// ════════════════════════════════════════

describe('daemon 续跑（进程重启场景）', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpDir();
    fs.mkdirSync(path.join(dir, 'hitl', 'pending'), { recursive: true });
  });
  afterEach(() => rmDir(dir));

  it('进程重启（新 FileCheckpointer 实例）→ resume 从 checkpoint 恢复', async () => {
    // ① 第一个"进程"：跑到挂起
    const depsProc1 = makeDeps(dir);
    const first = await runLoopGraph('daemon 场景任务', { deps: depsProc1 });
    expect(first.finalStatus).toBe('awaiting_human');
    const checkpointId = first.checkpointId;

    // ② 外部信号到达（Dashboard 在进程退出期间写入）
    writeHITLResponse(dir, {
      checkpointId,
      decision: 'approve',
      resolvedAt: new Date().toISOString(),
    });

    // ③ 模拟进程重启：全新 FileCheckpointer + 全新 deps（不共享内存状态）
    const depsProc2 = makeDeps(dir);
    const resumed = await resumeLoopGraph({ deps: depsProc2 });
    expect(resumed).not.toBeNull();
    expect(resumed!.finalStatus).toBe('completed');
    expect(resumed!.checkpointId).toBe(checkpointId);

    // ④ latest checkpoint 的 id 与首轮一致（同一次 LOOP 运行）
    expect(latestCheckpointId(dir)).toBe(checkpointId);
  });

  it('无外部信号时 resume 幂等返回 awaiting_human（仍在等待）', async () => {
    const first = await runLoopGraph('无信号幂等任务', { deps: makeDeps(dir) });
    expect(first.finalStatus).toBe('awaiting_human');

    // 不写 resolved → resume 应保持 awaiting_human，不抛错、不推进
    const resumed = await resumeLoopGraph({ deps: makeDeps(dir) });
    expect(resumed).not.toBeNull();
    expect(resumed!.finalStatus).toBe('awaiting_human');
    expect(resumed!.checkpointId).toBe(first.checkpointId);
  });
});

// ════════════════════════════════════════
// 用例 6 · --resolve 语义（CLI 侧核心逻辑：写响应 + resume）
// ════════════════════════════════════════

describe('--resolve 语义（writeHITLResponse + resumeLoopGraph）', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpDir();
    fs.mkdirSync(path.join(dir, 'hitl', 'pending'), { recursive: true });
  });
  afterEach(() => rmDir(dir));

  it('decision=reject 且重试超限 → blocked 终态 + recordBlocked 被调用', async () => {
    // 构造 retryCount 已达上限的状态：先把 checkpoint 写成 human_confirm/awaiting_human + retryCount=3
    const deps = makeDeps(dir);
    const checkpointer = new FileCheckpointer(path.join(dir, 'checkpoint'));
    const checkpointId = FileCheckpointer.newCheckpointId();
    checkpointer.save(
      {
        currentNode: 'human_confirm',
        auditResult: 'PASS',
        retryCount: 3, // 已达上限
        checkpointId,
        artifacts: {
          task: '超限任务',
          engineerOutput: '产出',
          engineerOutputs: ['产出'],
          auditReport: 'PASS',
          auditReports: ['PASS'],
          reviewReport: '报告',
          reviewReports: ['报告'],
          humanFeedback: '',
        },
        finalStatus: 'awaiting_human',
        resumeFrom: null,
      },
      'human_confirm',
      'before',
    );

    let blockedCalled = 0;
    const depsWithBlock = makeDeps(dir, {
      recordBlocked: async () => {
        blockedCalled += 1;
      },
      checkpointer,
    });

    // --resolve approve|reject → 此处 reject 且超限 → blocked
    writeHITLResponse(dir, {
      checkpointId,
      decision: 'reject',
      resolvedAt: new Date().toISOString(),
    });
    const result = await resumeLoopGraph({ deps: depsWithBlock });
    expect(result).not.toBeNull();
    expect(result!.finalStatus).toBe('blocked');
    expect(blockedCalled).toBe(1);
    expect(result!.state.artifacts.humanFeedback).toBe('rejected');
  });

  it('decision=aborted → aborted 终态，humanFeedback=aborted', async () => {
    const deps = makeDeps(dir);
    const first = await runLoopGraph('abort 场景任务', { deps });
    expect(first.finalStatus).toBe('awaiting_human');

    writeHITLResponse(dir, {
      checkpointId: first.checkpointId,
      decision: 'aborted',
      resolvedAt: new Date().toISOString(),
    });
    const result = await resumeLoopGraph({ deps: makeDeps(dir) });
    expect(result!.finalStatus).toBe('aborted');
    expect(result!.state.artifacts.humanFeedback).toBe('aborted');
  });
});
