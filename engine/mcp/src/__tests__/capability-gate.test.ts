// ============================================================
// capability-gate.test.ts · 主干能力关档硬线测试（v1.5.7 章五）
// ============================================================
// 落点说明：本文件落在 engine/mcp/src/__tests__/——三个被测档位中两个
// （SOFAGENT_PERMISSION_GUARD / SOFAGENT_USAGE_TRACKING）的判定面在
// engine/mcp（tools/call 前置守卫与遥测写入），第三个
// （SOFAGENT_MCP_ROLES 收窄面）也在 mcp 的 tool-roles.ts——载体包即本包。
// 与 plugin-kit 侧既有 featureGates 硬线（settings 档位 → 工具不注册）
// 互补：那条测插件侧，本文件测**主干侧**（env 形态档位）。
//
// 验收硬线（每档三断言，缺一即返工）：
//   ① 关档后「该判定确实不发生」
//   ② 其余能力不受影响（关 A 不连带关 B）
//   ③ 关档**响亮告警不静默**（状态可观测——非零可见面）
//
// 档位选型（代表性三档，env 注入开关——见 docs/DEVELOPMENT.md 分流表）：
//   · SOFAGENT_PERMISSION_GUARD=1（opt-in 门：tools/call 前置权限守卫）
//   · SOFAGENT_USAGE_TRACKING=0（opt-out 门：工具使用率遥测）
//   · SOFAGENT_MCP_ROLES=<role>（L2 收窄档：专职工具面）
// ============================================================

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { isPermissionGuardEnabled } from '../tools/permission-guard';
import { isUsageTrackingEnabled, recordToolUsage, resolveToolUsagePath } from '../usage-tracker';
import { getActiveRoles, ROLES_ENV } from '../tool-roles';
import { existsSync, readFileSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ── env 沙箱：测试前后清干净被测档位，防宿主环境渗入 ──────────
const GATE_ENVS = ['SOFAGENT_PERMISSION_GUARD', 'SOFAGENT_USAGE_TRACKING', ROLES_ENV, 'SOFAGENT_MCP_ROLES_STRICT'] as const;

function snapshotGates(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of GATE_ENVS) out[k] = process.env[k];
  return out;
}
function restoreGates(snap: Record<string, string | undefined>): void {
  for (const k of GATE_ENVS) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
}

// ── 遥测落盘隔离：SOFAGENT_DATA 指到临时目录 ──────────────────
let tmpDataDir: string;

describe('capability-gate（主干能力关档硬线 · v1.5.7 章五）', () => {
  let envSnap: Record<string, string | undefined>;
  let dataSnap: string | undefined;

  beforeEach(() => {
    envSnap = snapshotGates();
    dataSnap = process.env.SOFAGENT_DATA;
    tmpDataDir = mkdtempSync(join(tmpdir(), 'capability-gate-test-'));
    process.env.SOFAGENT_DATA = tmpDataDir;
  });

  afterEach(() => {
    restoreGates(envSnap);
    if (dataSnap === undefined) delete process.env.SOFAGENT_DATA;
    else process.env.SOFAGENT_DATA = dataSnap;
    rmSync(tmpDataDir, { recursive: true, force: true });
  });

  // ══════════════════════════════════════════
  // 档位一：SOFAGENT_PERMISSION_GUARD（opt-in=1 启用）
  // ══════════════════════════════════════════
  describe('档位 SOFAGENT_PERMISSION_GUARD（权限守卫 opt-in 门）', () => {
    it('🔴 关档（未设/=0）：守卫判定确实不发生——isPermissionGuardEnabled() = false', () => {
      delete process.env.SOFAGENT_PERMISSION_GUARD;
      expect(isPermissionGuardEnabled()).toBe(false);
      process.env.SOFAGENT_PERMISSION_GUARD = '0';
      expect(isPermissionGuardEnabled()).toBe(false);
    });

    it('🔴 关档不影响其余能力：遥测与角色收窄两档照常解析（关 A 不连带关 B）', () => {
      delete process.env.SOFAGENT_PERMISSION_GUARD;
      process.env.SOFAGENT_USAGE_TRACKING = '1';
      process.env[ROLES_ENV] = 'fde';
      // 守卫关档的同时：遥测开、收窄生效——两档判定面照常发生
      expect(isUsageTrackingEnabled()).toBe(true);
      expect(getActiveRoles() ?? []).toContain('fde');
    });

    it('🔴 开关状态单点可观测（响亮不静默）：开档值唯一 =1，读数即部署形态声明', () => {
      process.env.SOFAGENT_PERMISSION_GUARD = '1';
      expect(isPermissionGuardEnabled()).toBe(true);
      // 非 '1' 值一律视为关——不存在「半开」静默态
      process.env.SOFAGENT_PERMISSION_GUARD = 'true';
      expect(isPermissionGuardEnabled()).toBe(false);
    });
  });

  // ══════════════════════════════════════════
  // 档位二：SOFAGENT_USAGE_TRACKING（opt-out=0 关闭）
  // ══════════════════════════════════════════
  describe('档位 SOFAGENT_USAGE_TRACKING（使用率遥测 opt-out 门）', () => {
    it('🔴 关档（=0）：遥测写入确实不发生——recordToolUsage 零落盘', () => {
      process.env.SOFAGENT_USAGE_TRACKING = '0';
      expect(isUsageTrackingEnabled()).toBe(false);
      recordToolUsage('list_capabilities', 'gate-test-session');
      expect(existsSync(resolveToolUsagePath())).toBe(false);
    });

    it('🔴 关档不影响其余能力：权限守卫与角色收窄照常（关遥测不连带关守卫）', () => {
      process.env.SOFAGENT_USAGE_TRACKING = '0';
      process.env.SOFAGENT_PERMISSION_GUARD = '1';
      process.env[ROLES_ENV] = 'audit';
      expect(isPermissionGuardEnabled()).toBe(true);
      expect(getActiveRoles() ?? []).toContain('audit');
    });

    it('🔴 开档落盘可见（默认开 = 遥测在工作）：recordToolUsage 产生一行且不含参数内容', () => {
      delete process.env.SOFAGENT_USAGE_TRACKING;
      expect(isUsageTrackingEnabled()).toBe(true);
      recordToolUsage('list_capabilities', 'gate-test-session');
      const p = resolveToolUsagePath();
      expect(existsSync(p)).toBe(true);
      const line = JSON.parse(readFileSync(p, 'utf-8').trim()) as Record<string, unknown>;
      // 四字段隐私边界：tool/sessionId/ts/schemaVersion——无参数无内容
      expect(line['tool']).toBe('list_capabilities');
      expect(line['sessionId']).toBe('gate-test-session');
      expect(Object.keys(line).some((k) => /args|params|content|result/i.test(k))).toBe(false);
    });
  });

  // ══════════════════════════════════════════
  // 档位三：SOFAGENT_MCP_ROLES（L2 收窄档）
  // ══════════════════════════════════════════
  describe('档位 SOFAGENT_MCP_ROLES（专职工具面收窄）', () => {
    it('🔴 收窄确实发生：roles=fde ⇒ 活动角色集不含 audit/ops（判定面收窄实证）', () => {
      process.env[ROLES_ENV] = 'fde';
      const roles = getActiveRoles() ?? [];
      expect(roles).toContain('fde');
      expect(roles).not.toContain('audit');
      expect(roles).not.toContain('ops');
    });

    it('🔴 收窄不影响其余能力：守卫与遥测两档照常解析（收窄面与门控面互不牵连）', () => {
      process.env[ROLES_ENV] = 'audit';
      process.env.SOFAGENT_PERMISSION_GUARD = '1';
      delete process.env.SOFAGENT_USAGE_TRACKING;
      expect(isPermissionGuardEnabled()).toBe(true);
      expect(isUsageTrackingEnabled()).toBe(true);
    });

    it('🔴 关档回全量响亮不静默：未设 ⇒ 全量暴露（null 态）；配错值 ⇒ stderr 警告 + 回退全量（可见降级）', () => {
      // 未设 = 全量（null 语义：能力不缺席，只是不收窄——状态可观测）
      delete process.env[ROLES_ENV];
      expect(getActiveRoles()).toBeNull();
      // 配错值：非法角色名触发 stderr 告警后回退全量（错误消息含 env 名——降级可见）
      const errSpy: string[] = [];
      const origErr = console.error;
      console.error = (...a: unknown[]) => {
        errSpy.push(a.map(String).join(' '));
      };
      try {
        process.env[ROLES_ENV] = 'not-a-real-role';
        expect(getActiveRoles()).toBeNull(); // 回退全量（不静默空集）
        expect(errSpy.some((s) => s.includes(ROLES_ENV))).toBe(true); // 告警含档位名
      } finally {
        console.error = origErr;
      }
    });
  });

  // ══════════════════════════════════════════
  // 交叉断言：三档正交（capabilities.json 的级联声明在此实证）
  // ══════════════════════════════════════════
  it('🔴 三档正交：全关遥测+关守卫+收窄 audit ⇒ 各自判定面独立生效、互不连带', () => {
    process.env.SOFAGENT_USAGE_TRACKING = '0';
    delete process.env.SOFAGENT_PERMISSION_GUARD;
    process.env[ROLES_ENV] = 'audit';
    expect(isUsageTrackingEnabled()).toBe(false); // 遥测判定不发生
    expect(isPermissionGuardEnabled()).toBe(false); // 守卫判定不发生
    const roles = getActiveRoles() ?? [];
    expect(roles).toContain('audit'); // 收窄判定发生
    expect(roles).not.toContain('fde');
  });
});
