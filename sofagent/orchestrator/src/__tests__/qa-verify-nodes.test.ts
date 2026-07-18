// ============================================================
// qa-verify-nodes.test.ts · nodes.ts WARN 标注 + 条件路由验证（v1.1.4）
// 由 QA 工程师编写，验证 audit 节点 WARN 标注 + blocked 终态
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomBytes } from 'crypto';

import { emptyArtifacts } from '../loop/state';
import type { LoopGraphState, LoopArtifacts } from '../loop/state';
import {
  FileCheckpointer,
} from '../graph/checkpoint';
import {
  makeEngineerNode,
  makeAuditNode,
  makeReviewerNode,
  makeHumanConfirmNode,
  defaultDeps,
  type LoopGraphDeps,
  DEFAULT_MAX_RETRIES,
  DEFAULT_AGENT_MAX_TURNS,
} from '../loop/nodes';

// ════════════════════════════════════════
// Helper
// ════════════════════════════════════════

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-qa-nodes-'));
}

function sampleState(overrides: Partial<LoopGraphState> = {}): LoopGraphState {
  return {
    currentNode: 'audit',
    auditResult: null,
    retryCount: 0,
    checkpointId: `qa-${randomBytes(4).toString('hex')}`,
    artifacts: emptyArtifacts('QA 测试任务'),
    finalStatus: 'running',
    resumeFrom: null,
    ...overrides,
  };
}

function makeMockDeps(cp: FileCheckpointer, overrides: Partial<LoopGraphDeps> = {}): LoopGraphDeps {
  return {
    ...defaultDeps(cp, true),
    runEngineer: async () => 'mock engineer output',
    runAudit: async () => ({ verdict: 'PASS' as const, report: 'mock audit pass' }),
    runReviewer: async () => 'mock reviewer pass',
    confirmHuman: async () => 'y' as const,
    recordBlocked: async () => {},
    ...overrides,
  };
}

// ════════════════════════════════════════
// Tests
// ════════════════════════════════════════

describe('nodes.ts QA 验证 · audit WARN 标注', () => {
  let cpDir: string;
  let cp: FileCheckpointer;

  beforeEach(() => {
    cpDir = tmpDir();
    cp = new FileCheckpointer(cpDir);
  });

  // 测试：audit 判定 WARN 时，auditReport 应加 [审计告警] 前缀
  it('audit verdict=WARN → auditReport 含 [审计告警] 前缀', async () => {
    const deps = makeMockDeps(cp, {
      runAudit: async () => ({ verdict: 'WARN', report: '发现轻微问题' }),
    });
    const state = sampleState({ currentNode: 'audit' });
    const auditNode = makeAuditNode(deps);
    const result = await auditNode(state);
    expect(result.artifacts.auditReport).toContain('[审计告警]');
    expect(result.artifacts.auditReport).toContain('发现轻微问题');
    expect(result.auditResult).toBe('WARN');
  });

  // 测试：audit 判定 PASS 时，auditReport 不加 [审计告警] 前缀
  it('audit verdict=PASS → auditReport 不含 [审计告警]', async () => {
    const deps = makeMockDeps(cp, {
      runAudit: async () => ({ verdict: 'PASS', report: '全部通过' }),
    });
    const state = sampleState({ currentNode: 'audit' });
    const auditNode = makeAuditNode(deps);
    const result = await auditNode(state);
    expect(result.artifacts.auditReport).not.toContain('[审计告警]');
    expect(result.artifacts.auditReport).toContain('全部通过');
  });

  // 测试：audit 判定 FAIL 且未达重试上限 → retryCount 递增，回 engineer
  it('audit FAIL + retryCount < max → retryCount+1', async () => {
    const deps = makeMockDeps(cp, {
      runAudit: async () => ({ verdict: 'FAIL', report: '严重违规' }),
    });
    const state = sampleState({ currentNode: 'audit', retryCount: 0 });
    const auditNode = makeAuditNode(deps);
    const result = await auditNode(state);
    expect(result.retryCount).toBe(1);
    expect(result.finalStatus).toBeUndefined(); // 非 blocked
  });

  // 测试：audit FAIL 且重试已达上限 → blocked 终态
  it('audit FAIL + retryCount ≥ max → finalStatus=blocked', async () => {
    let recorded = false;
    const deps = makeMockDeps(cp, {
      runAudit: async () => ({ verdict: 'FAIL', report: '严重违规' }),
      recordBlocked: async () => { recorded = true; },
    });
    const state = sampleState({ currentNode: 'audit', retryCount: DEFAULT_MAX_RETRIES });
    const auditNode = makeAuditNode(deps);
    const result = await auditNode(state);
    expect(result.finalStatus).toBe('blocked');
    expect(recorded).toBe(true);
  });

  // 测试：WARN 时正常流转（不阻断），finalStatus 不设为 blocked
  it('audit WARN → 不阻断，继续流转', async () => {
    const deps = makeMockDeps(cp, {
      runAudit: async () => ({ verdict: 'WARN', report: 'WARN 提示' }),
    });
    const state = sampleState({ currentNode: 'audit' });
    const auditNode = makeAuditNode(deps);
    const result = await auditNode(state);
    expect(result.finalStatus).toBeUndefined();
    expect(result.retryCount).toBeUndefined(); // 不递增
  });
});

describe('nodes.ts QA 验证 · engineer/reviewer 节点', () => {
  let cpDir: string;
  let cp: FileCheckpointer;

  beforeEach(() => {
    cpDir = tmpDir();
    cp = new FileCheckpointer(cpDir);
  });

  // 测试：engineer 节点应将产出写入 artifacts.engineerOutput
  it('engineer 节点输出写入 engineerOutput', async () => {
    const deps = makeMockDeps(cp, {
      runEngineer: async () => '工程师产出内容',
    });
    const state = sampleState({ currentNode: 'engineer', retryCount: 0 });
    const engineerNode = makeEngineerNode(deps);
    const result = await engineerNode(state);
    expect(result.artifacts.engineerOutput).toBe('工程师产出内容');
  });

  // 测试：reviewer 节点应将产出写入 artifacts.reviewReport
  it('reviewer 节点输出写入 reviewReport', async () => {
    const deps = makeMockDeps(cp, {
      runReviewer: async () => '审查报告内容',
    });
    const state = sampleState({ currentNode: 'reviewer' });
    const reviewerNode = makeReviewerNode(deps);
    const result = await reviewerNode(state);
    expect(result.artifacts.reviewReport).toBe('审查报告内容');
  });
});

describe('nodes.ts QA 验证 · human_confirm 节点', () => {
  let cpDir: string;
  let cp: FileCheckpointer;

  beforeEach(() => {
    cpDir = tmpDir();
    cp = new FileCheckpointer(cpDir);
  });

  // 测试：人工确认 y → completed
  it('human_confirm y → completed', async () => {
    const deps = makeMockDeps(cp, {
      confirmHuman: async () => 'y',
    });
    const state = sampleState({ currentNode: 'human_confirm' });
    const humanNode = makeHumanConfirmNode(deps);
    const result = await humanNode(state);
    expect(result.finalStatus).toBe('completed');
  });

  // 测试：人工确认 abort → aborted
  it('human_confirm abort → aborted', async () => {
    const deps = makeMockDeps(cp, {
      confirmHuman: async () => 'abort',
    });
    const state = sampleState({ currentNode: 'human_confirm' });
    const humanNode = makeHumanConfirmNode(deps);
    const result = await humanNode(state);
    expect(result.finalStatus).toBe('aborted');
  });

  // 测试：人工驳回 n + 未达上限 → 回 engineer 重试
  it('human_confirm n + retryCount < max → retryCount+1', async () => {
    const deps = makeMockDeps(cp, {
      confirmHuman: async () => 'n',
    });
    const state = sampleState({ currentNode: 'human_confirm', retryCount: 1 });
    const humanNode = makeHumanConfirmNode(deps);
    const result = await humanNode(state);
    expect(result.retryCount).toBe(2);
    expect(result.finalStatus).toBeUndefined();
  });

  // 测试：人工驳回 n + 达上限 → blocked
  it('human_confirm n + retryCount ≥ max → blocked', async () => {
    let recorded = false;
    const deps = makeMockDeps(cp, {
      confirmHuman: async () => 'n',
      recordBlocked: async () => { recorded = true; },
    });
    const state = sampleState({ currentNode: 'human_confirm', retryCount: DEFAULT_MAX_RETRIES });
    const humanNode = makeHumanConfirmNode(deps);
    const result = await humanNode(state);
    expect(result.finalStatus).toBe('blocked');
    expect(recorded).toBe(true);
  });
});

describe('nodes.ts QA 验证 · 默认重试上限', () => {
  // 测试：DEFAULT_MAX_RETRIES = 3
  it('DEFAULT_MAX_RETRIES 应为 3', () => {
    expect(DEFAULT_MAX_RETRIES).toBe(3);
  });
});

describe('nodes.ts QA 验证 · v1.1.4 审查修复', () => {
  // 测试：DEFAULT_AGENT_MAX_TURNS = 20（PRD Q1 决策落地）
  it('DEFAULT_AGENT_MAX_TURNS 应为 20（PRD Q1 决策）', () => {
    expect(DEFAULT_AGENT_MAX_TURNS).toBe(20);
  });

  // 测试：常量已导出（非 undefined）
  it('DEFAULT_AGENT_MAX_TURNS 已导出且为数字类型', () => {
    expect(typeof DEFAULT_AGENT_MAX_TURNS).toBe('number');
    expect(DEFAULT_AGENT_MAX_TURNS).toBeDefined();
  });
});
