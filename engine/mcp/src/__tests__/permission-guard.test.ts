// ============================================================
// permission-guard.test.ts · tools/call 前置权限守卫接线测试（v1.5.0 TASK-26）
//
// 覆盖场景：
//   1. opt-in 语义：SOFAGENT_PERMISSION_GUARD 未设/设 0 → 直通（零行为变化）
//   2. 启用态：低风险工具（未列表缺省 read/public）→ allow 放行
//   3. 启用态：高危工具（corpus_export = export/user-data → critical）→
//      policy-engine 判 human-approval/deny → 拦截（allowed=false + blockReason）
//   4. MCP server 全链路：启用守卫后 tools/call 高危工具被 sendError 拦截
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { resolve } from 'path';

const MCP_SERVER_DIST = resolve(__dirname, '../../dist/mcp-server.js');

async function callGuard(toolName: string): Promise<{ allowed: boolean; blockReason?: string }> {
  const { guardToolCall, resetPermissionGuard } = await import('../tools/permission-guard');
  resetPermissionGuard();
  return guardToolCall(toolName);
}

describe('权限守卫 opt-in 语义（v1.5.0 TASK-26）', () => {
  const prevGuard = process.env.SOFAGENT_PERMISSION_GUARD;
  const prevAgent = process.env.SOFAGENT_AGENT_ID;

  afterEach(() => {
    if (prevGuard === undefined) delete process.env.SOFAGENT_PERMISSION_GUARD; else process.env.SOFAGENT_PERMISSION_GUARD = prevGuard;
    if (prevAgent === undefined) delete process.env.SOFAGENT_AGENT_ID; else process.env.SOFAGENT_AGENT_ID = prevAgent;
  });

  it('未启用（缺省）→ 直通：allowed=true 零行为变化', async () => {
    delete process.env.SOFAGENT_PERMISSION_GUARD;
    const v = await callGuard('run_audit');
    expect(v.allowed).toBe(true);
    expect(v.blockReason).toBeUndefined();
  });

  it('启用 + 低风险工具 → policy-engine allow 放行', async () => {
    process.env.SOFAGENT_PERMISSION_GUARD = '1';
    process.env.SOFAGENT_AGENT_ID = 'agent-test-001';
    // 未列表工具缺省 read/public——判定链允许（code-development 场景覆盖 public 读）
    const v = await callGuard('list_rules');
    expect(v.allowed).toBe(true);
  });

  it('启用 + 高危工具（export/user-data → critical）→ 拦截且 blockReason 含判定依据', async () => {
    process.env.SOFAGENT_PERMISSION_GUARD = '1';
    process.env.SOFAGENT_AGENT_ID = 'agent-test-001';
    const v = await callGuard('corpus_export');
    expect(v.allowed).toBe(false);
    expect(v.blockReason).toContain('权限守卫拦截');
    expect(v.blockReason).toContain('corpus_export');
  });

  it('启用 + 审计数据写面（run_audit → critical）→ 拦截（防篡改审计域）', async () => {
    process.env.SOFAGENT_PERMISSION_GUARD = '1';
    process.env.SOFAGENT_AGENT_ID = 'agent-test-001';
    const v = await callGuard('run_audit');
    expect(v.allowed).toBe(false);
  });
});

describe('权限守卫 MCP server 全链路（v1.5.0 TASK-26）', () => {
  const prevGuard = process.env.SOFAGENT_PERMISSION_GUARD;

  afterEach(() => {
    if (prevGuard === undefined) delete process.env.SOFAGENT_PERMISSION_GUARD; else process.env.SOFAGENT_PERMISSION_GUARD = prevGuard;
  });

  it('启用守卫：tools/call 高危工具被拦截（error 响应）；低风险工具照常执行', async () => {
    const resp = await new Promise<{ id: number; result?: { content?: Array<{ text: string }> }; error?: { message: string } }[]>((resolve, reject) => {
      const child = spawn(process.execPath, [MCP_SERVER_DIST], {
        env: {
          ...process.env,
          SOFAGENT_PERMISSION_GUARD: '1',
          SOFAGENT_AGENT_ID: 'agent-e2e-001',
        },
      });
      const lines: string[] = [];
      const timer = setTimeout(() => { child.kill(); reject(new Error('超时')); }, 20000);
      child.stdout.on('data', (c) => {
        lines.push(...c.toString().split('\n'));
        // 等 id:3（第二个 tools/call）响应
        const responses = lines.filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        const resp3 = responses.find((r: { id?: number }) => r.id === 3);
        if (resp3) {
          clearTimeout(timer);
          child.kill();
          resolve(responses);
        }
      });
      child.stderr.on('data', () => { /* 吞启动日志 */ });
      child.on('error', reject);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'corpus_export', arguments: {} } }) + '\n');
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_rules', arguments: {} } }) + '\n');
    });

    const resp2 = resp.find((r) => r.id === 2);
    const resp3 = resp.find((r) => r.id === 3);
    // 高危工具被守卫拦截（error 响应含拦截原因）
    expect(resp2?.error).toBeDefined();
    expect(resp2!.error!.message).toContain('权限守卫拦截');
    // 低风险工具照常执行（result 响应——不被守卫误伤）
    expect(resp3?.error).toBeUndefined();
    expect(resp3?.result).toBeDefined();
  }, 30000);
});
