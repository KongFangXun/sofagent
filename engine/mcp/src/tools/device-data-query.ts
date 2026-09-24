// ============================================================
// device-data-query.ts · MCP tool：设备侧数据面授权读取（v1.5.2 G10 · T2）
// ============================================================
//
// 平台从设备「拉」数据的受控入口：设备门禁 → 白名单校验 → 读取 →
// 脱敏 → 审计留痕 → 计量进账 → 结构化返回。
//
// 形态照抄 device-register.ts：text 首行 [sofagent] 前缀 + data
// 结构化；实现经 @sofagent/daemon 的 gateDevice（lazy import
// optionalDependencies 模式）+ @sofagent/core 的策略/脱敏面。
//
// 链路顺序（每一步 fail-closed——前一步不通过后一步不执行）：
//   1. gateDevice 闸门（未注册 / 吊销 / 验签失败 → 拒绝）
//   2. authorizeDeviceRead 白名单判定（空策略全拒 / 路径越界拒绝）
//   3. 读文件（不存在 → not-found；读失败 → read-failed）
//   4. redact 脱敏（敏感字段不出设备——验收 ③）
//   5. verifyNoLeak 自检（实体名 0 命中——脱敏有效性的双保险）
//   6. emitDecision 审计留痕（谁/何时/读了什么/依据什么授权——
//      decision-log 进 worklog 聚合三源，读取动作天然进计量视野）
//
// 「不落原始路径」（changelog 二章交付表）：返回体的 path 字段做
// 相对化脱壳（只保留 basename——目录结构是设备侧拓扑信息）。
// ============================================================

import {
  authorizeDeviceRead,
  redact,
  verifyNoLeak,
  loadRedactRules,
  getDataDir,
} from '@sofagent/core';
import * as fs from 'fs';
import * as path from 'path';

/** 查询结果（结构化） */
export interface DeviceDataQueryResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  data: {
    ok: boolean;
    reason?:
      | 'not-registered' | 'revoked' | 'invalid-identity' | 'daemon-unavailable'
      | 'empty-policy' | 'device-not-in-policy' | 'path-not-allowed' | 'invalid-params'
      | 'not-found' | 'read-failed';
    message: string;
    /** 脱敏后内容（ok=true 时有值） */
    content?: string;
    /** 依据的白名单目录（ok=true 时有值——授权依据回显） */
    allowedDir?: string;
    /** 脱敏命中统计 */
    redactHits?: number;
    /** 审计留痕是否成功 */
    auditLogged: boolean;
  };
}

/**
 * 设备数据面授权读取（G10）。
 *
 * @param args.identity 设备身份码（AgentIdentity JSON——过 gateDevice 闸门）
 * @param args.path 请求读取的文件路径（设备侧绝对路径）
 * @param args.maxBytes 读取上限（缺省 64KB——防超大文件打爆返回体）
 */
export async function deviceDataQuery(args: {
  identity: Record<string, unknown>;
  path: string;
  maxBytes?: number;
}): Promise<DeviceDataQueryResult> {
  // ── 参数校验 ──
  if (!args.identity || typeof args.identity !== 'object' || !args.path || typeof args.path !== 'string') {
    return {
      text: '[sofagent] 设备数据读取失败：参数缺失（identity / path）',
      data: { ok: false, reason: 'invalid-params', message: '参数缺失（identity / path）', auditLogged: false },
    };
  }

  // ── 1. 设备门禁（lazy import @sofagent/daemon）──
  let gate: { ok: boolean; reason?: string; message: string; record?: { identity: { agentId: string } } };
  try {
    const daemon = (await import('@sofagent/daemon')) as Record<string, unknown>;
    const fn = daemon.gateDevice;
    if (typeof fn !== 'function') throw new Error('gateDevice 不可用');
    gate = fn(args.identity as never, undefined) as typeof gate;
  } catch {
    return {
      text: '[sofagent] 设备数据读取失败：@sofagent/daemon 未安装或不可用',
      data: { ok: false, reason: 'daemon-unavailable', message: '@sofagent/daemon 未安装或不可用', auditLogged: false },
    };
  }
  if (!gate.ok) {
    return {
      text: `[sofagent] 设备数据读取拒绝：${gate.message}`,
      data: { ok: false, reason: gate.reason as DeviceDataQueryResult['data']['reason'], message: gate.message, auditLogged: false },
    };
  }
  const deviceId = gate.record!.identity.agentId;

  // ── 2. 白名单判定（core 策略面）──
  const auth = authorizeDeviceRead(deviceId, args.path, undefined);
  if (!auth.ok) {
    return {
      text: `[sofagent] 设备数据读取拒绝：${auth.message}`,
      data: { ok: false, reason: auth.reason, message: auth.message, auditLogged: false },
    };
  }

  // ── 3. 读取文件 ──
  if (!fs.existsSync(args.path) || !fs.statSync(args.path).isFile()) {
    return {
      text: `[sofagent] 设备数据读取失败：文件不存在（${path.basename(args.path)}）`,
      data: { ok: false, reason: 'not-found', message: '文件不存在或不是普通文件', auditLogged: false },
    };
  }
  const maxBytes = typeof args.maxBytes === 'number' && args.maxBytes > 0 ? Math.floor(args.maxBytes) : 64 * 1024;
  let raw: string;
  try {
    const buf = fs.readFileSync(args.path);
    raw = buf.subarray(0, maxBytes).toString('utf-8');
  } catch (err) {
    return {
      text: `[sofagent] 设备数据读取失败：读取异常（${err instanceof Error ? err.message : String(err)}）`,
      data: { ok: false, reason: 'read-failed', message: err instanceof Error ? err.message : String(err), auditLogged: false },
    };
  }

  // ── 4. 脱敏（redact 管线——格式类内置 + 企业规则）──
  const rules = loadRedactRules(getDataDir(undefined));
  const redacted = redact(raw, rules);

  // ── 5. 实体名泄漏自检（双保险）──
  const entities = (rules.entities ?? []).map((e) => e.pattern).filter(Boolean);
  const leakCheck = verifyNoLeak(redacted.text, entities);
  if (!leakCheck.clean) {
    return {
      text: `[sofagent] 设备数据读取拦截：脱敏后仍检出实体名泄漏（${leakCheck.leaked.length} 个）——内容不出设备`,
      data: { ok: false, reason: 'path-not-allowed', message: `脱敏自检失败：${leakCheck.leaked.join(', ')}`, auditLogged: false },
    };
  }

  // ── 6. 审计留痕（emitDecision——decision-log 进 worklog 三源）──
  let auditLogged = false;
  try {
    const { emitDecision } = await import('@sofagent/audit');
    emitDecision({
      agentId: `device-${deviceId.slice(0, 8)}`,
      sessionId: `device-data-query-${Date.now()}`,
      kind: 'ARTIFACT_EDIT',
      moment: 'ACT',
      category: 'select',
      why: `device_data_query 读取 ${path.basename(args.path)}（${Buffer.byteLength(raw, 'utf-8')}B → 脱敏 ${redacted.totalHits} 处）——依据白名单 ${auth.allowedDir}`,
      artifactRef: `device-data/${deviceId.slice(0, 8)}/${path.basename(args.path)}`,
      evidence: [
        `path=${path.basename(args.path)}`,
        `allowedDir=${auth.allowedDir}`,
        `bytes=${Buffer.byteLength(raw, 'utf-8')}`,
        `redactHits=${redacted.totalHits}`,
      ],
    });
    auditLogged = true;
  } catch {
    auditLogged = false; // best-effort 显式标注（同 data-push-tool 纪律）
  }

  return {
    text: `[sofagent] ✅ 设备数据读取（${path.basename(args.path)} · 脱敏 ${redacted.totalHits} 处 · ${Buffer.byteLength(redacted.text, 'utf-8')}B）`,
    data: {
      ok: true,
      message: '读取成功（已脱敏）',
      content: redacted.text,
      allowedDir: auth.allowedDir,
      redactHits: redacted.totalHits,
      auditLogged,
    },
  };
}
