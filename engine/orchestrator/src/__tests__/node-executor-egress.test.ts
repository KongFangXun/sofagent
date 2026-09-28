// ============================================================
// node-executor-egress.test.ts · v1.5.5 · 沙箱出口装配「生产路径可达」自证
// ============================================================
//
// 背景（P1-1/P1-2）：v1.5.4 章三/章七的沙箱出口凭证注入 + 对账虽在
//   createSandboxHandle 层可测（sandbox-egress-credential.test.ts 的 ⑥），
//   但生产装配点 node-executor.ts 此前**未把对账面开关透传**——
//   `createSandboxHandle({ dataDir, sandbox: true })` 缺 credentialReconcile
//   ⇒ wrap.ts 的 `enabled: options.credentialReconcile === true` 恒 false
//   ⇒ 对账在**生产路径上永不可达**（测试 ⑥ 直调 createSandboxHandle，是「测试是唯一观众」）。
//
// 本文件补「经 executeNode 的生产路径」两态自证（**非**直调 createSandboxHandle）：
//   P1-1 ① 配置开闸：config.yml `audit.credentialReconcile: true`
//            → createSandboxHandle 收到 credentialReconcile:true → 对账记录入 decision-log
//   P1-1 ② 缺省关：`credentialReconcile: false` → 收到 false → 零对账记录（L1 语义）
//   P1-2 ③ 出口分支接线：SOFAGENT_SANDBOX_EGRESS=1 → wrapTools 被调用（有 secret → 凭证注入面在位）
//   P1-2 ④ 无 secret 两态：出口仍装配（wrapTools 调用）但零签发（无对账记录）
//   P1-2 ⑤ 缺省关：SOFAGENT_SANDBOX_EGRESS≠1 → 出口分支不装配（零行为变化）
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getDecisionLogPath } from '@sofagent/core';

// 监视 harness-sdk 装配点：断言 executeNode 的出口分支真实调用 createSandboxHandle / wrapTools。
// vi.mock 对**动态 import** 同样生效（node-executor `await import('./harness-sdk')` 与
// 本文件的 `../harness-sdk` 解析到同一模块 id）。
vi.mock('../harness-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../harness-sdk')>();
  return {
    ...actual,
    createSandboxHandle: vi.fn(actual.createSandboxHandle),
    wrapTools: vi.fn(actual.wrapTools),
  };
});

import { createSandboxHandle, wrapTools } from '../harness-sdk';
import { executeNode, type NodeExecutionContext } from '../node-executor';
import type { SubAgentConfig } from '../workflow-parser';

const mockCreateSandboxHandle = vi.mocked(createSandboxHandle);
const mockWrapTools = vi.mocked(wrapTools);

// 合成假密钥：拆串拼接（避免以连续 sk- 明文形态入库——对齐既有测试对 A2 密钥规则的口径）
const SECRET = ['sk-egress-', 'secret'].join('');

/** 受控环境变量白名单（save/restore——防跨用例串台） */
const ENV_KEYS = ['SOFAGENT_CONFIG', 'SOFAGENT_SANDBOX_EGRESS', 'SOFAGENT_EGRESS_SECRET', 'SOFAGENT_KEY_PATH'] as const;

let dataDir: string;
let savedEnv: Record<string, string | undefined>;

/** 构造节点执行上下文（engineer 节点——绕过 HITL fail-fast，直接进工具装配段） */
function makeCtx(root: string): NodeExecutionContext {
  const agentConfig: SubAgentConfig = {
    name: 'egress-agent',
    description: '沙箱出口测试 Agent',
    systemPrompt: '你是沙箱出口测试 Agent',
    tools: [],
    modelName: null,
    hitl: false,
  };
  return {
    agentName: 'egress-agent',
    agentConfig,
    node: { id: 'egress-node', agent: 'engineer', task: '出口凭证注入', depends_on: [] },
    dataDir: root,
    projectRoot: root,
  };
}

/** 写项目级配置文件并经 SOFAGENT_CONFIG 指向（隔离 ~/.sofagent/config.yml，防串台） */
function writeProjectConfig(root: string, credentialReconcile: boolean): void {
  const cfgPath = join(root, 'config.yml');
  writeFileSync(cfgPath, `audit:\n  credentialReconcile: ${credentialReconcile ? 'true' : 'false'}\n`, 'utf-8');
  process.env.SOFAGENT_CONFIG = cfgPath;
}

/** 读 decision-log 的 kind 序列（无文件 = 空） */
function readDecisionKinds(root: string): string[] {
  const p = getDecisionLogPath(root);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf-8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => (JSON.parse(l) as Record<string, unknown>)['kind'] as string);
}

/** 执行一次节点（注入 resolveModel=null 走降级——出口装配在降级判定之前，副作用已发生） */
async function runOnce(root: string): Promise<void> {
  await executeNode(makeCtx(root), {
    resolveModel: async () => null,
    buildSystemPrompt: (_r, cfg) => cfg.systemPrompt,
  });
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-node-egress-'));
  // 对账留痕需 HMAC 密钥（emitDecision → decision-log）；指到临时目录，防污染真实 ~/.sofagent-key
  writeFileSync(join(dataDir, 'hmac-key'), 'test-hmac-key-0123456789abcdef', 'utf-8');
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.SOFAGENT_KEY_PATH = join(dataDir, 'hmac-key');
  vi.clearAllMocks();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = savedEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* 沙箱清理失败可接受 */ }
});

describe('executeNode · 沙箱出口装配生产可达（v1.5.5 P1-1/P1-2）', () => {
  it('P1-1 ① 配置开闸：audit.credentialReconcile:true → createSandboxHandle 收到 true + 对账入 decision-log', async () => {
    process.env.SOFAGENT_SANDBOX_EGRESS = '1';
    process.env.SOFAGENT_EGRESS_SECRET = SECRET;
    writeProjectConfig(dataDir, true);

    await runOnce(dataDir);

    expect(mockCreateSandboxHandle).toHaveBeenCalledTimes(1);
    expect(mockCreateSandboxHandle).toHaveBeenCalledWith(
      expect.objectContaining({ credentialReconcile: true }),
    );
    // 开闸 ⇒ 签发处产出范围声明并交章七对账 ⇒ 结论挂 decision-log（kind=CREDENTIAL_RECONCILE）
    expect(readDecisionKinds(dataDir)).toContain('CREDENTIAL_RECONCILE');
  });

  it('P1-1 ② 缺省关：audit.credentialReconcile:false → 收到 false + 零对账记录（L1 语义）', async () => {
    process.env.SOFAGENT_SANDBOX_EGRESS = '1';
    process.env.SOFAGENT_EGRESS_SECRET = SECRET;
    writeProjectConfig(dataDir, false);

    await runOnce(dataDir);

    expect(mockCreateSandboxHandle).toHaveBeenCalledWith(
      expect.objectContaining({ credentialReconcile: false }),
    );
    expect(readDecisionKinds(dataDir)).not.toContain('CREDENTIAL_RECONCILE');
  });

  it('P1-2 ③ 出口分支接线：SOFAGENT_SANDBOX_EGRESS=1 → wrapTools 被调用（有 secret → 凭证注入面在位）', async () => {
    process.env.SOFAGENT_SANDBOX_EGRESS = '1';
    process.env.SOFAGENT_EGRESS_SECRET = SECRET;
    writeProjectConfig(dataDir, true);

    await runOnce(dataDir);

    expect(mockWrapTools).toHaveBeenCalledTimes(1);
    const opts = mockWrapTools.mock.calls[0]![1] as Record<string, unknown>;
    expect(opts).toMatchObject({ sandbox: true });
    // 有 secret ⇒ issueCredential 已登记凭证 ⇒ wrapTools 收到虚拟 key（沙箱层④注入面）
    expect(typeof opts['credentialVirtualKey']).toBe('string');
    expect(readDecisionKinds(dataDir)).toContain('CREDENTIAL_RECONCILE');
  });

  it('P1-2 ④ 无 secret：出口仍装配（wrapTools 调用）但零签发（无对账记录）', async () => {
    process.env.SOFAGENT_SANDBOX_EGRESS = '1';
    delete process.env.SOFAGENT_EGRESS_SECRET;
    writeProjectConfig(dataDir, true);

    await runOnce(dataDir);

    expect(mockCreateSandboxHandle).toHaveBeenCalledTimes(1);
    expect(mockWrapTools).toHaveBeenCalledTimes(1);
    const opts = mockWrapTools.mock.calls[0]![1] as Record<string, unknown>;
    // 无 secret ⇒ 不签发 ⇒ 无虚拟 key，即便对账开闸也无声明可对 ⇒ 零记录
    expect(opts['credentialVirtualKey']).toBeUndefined();
    expect(readDecisionKinds(dataDir)).not.toContain('CREDENTIAL_RECONCILE');
  });

  it('P1-2 ⑤ 缺省关：SOFAGENT_SANDBOX_EGRESS≠1 → 出口分支不装配（零行为变化）', async () => {
    delete process.env.SOFAGENT_SANDBOX_EGRESS;
    writeProjectConfig(dataDir, true);

    await runOnce(dataDir);

    expect(mockCreateSandboxHandle).not.toHaveBeenCalled();
    expect(mockWrapTools).not.toHaveBeenCalled();
  });
});
