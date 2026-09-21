// ============================================================
// upgrade-executor.ts · G12 设备 OTA 升级执行器（v1.5.1 第四章）
// ============================================================
//
// 设备卖出去后引擎要能升级（发新版 / 打补丁 / 规则更新）——不掌握升级通道的
// 设备会脱管。本文件是**执行侧**：拉取 → 验签 → 灰度 → 回滚 → 版本清单上报。
//
// 链路（fail-closed 逐层，任一层不过即拒绝且留痕）：
//   1. 已注册闸门——gateDevice（未注册 / 吊销 / 身份验签失败 → rejected）
//   2. 心跳在线判定——离线 → 挂起（suspend: offline，上线后 resume 补升）
//   3. 截止窗口——已过 deadline → 挂起（suspend: deadline-exceeded）
//   4. 升级策略——窗口外 / 待人工确认 / 策略非法 → 挂起（upgrade-policy.ts）
//   5. 拉取——逐组件拉制品（注入通道；缺省取 payload 内联内容）
//   6. 验签——Ed25519 交付签名信封，fail-closed（**复用 G9 验签链，不重写密码学**）
//   7. 灰度——非核心组件先升 → 健康探针 → 通过再升核心（rollout.batchSize 分批）
//   8. 回滚——任一安装失败 / 探针不过 → 已升组件全部回滚到前一版本（设备可继续服务）
//   9. 版本清单上报——**成功分支末尾**经注入的 G11 `device_data_push` 端口回传
//
// ── 验签为何这样复用（不重写密码学）──────────────────────────
// 复用 @sofagent/core 的 G9 Ed25519 链三件套：buildSignaturePayload /
// signIdentityPayload / verifyAgentIdentity。交付签名的**载荷位**用
// `responsibility` 承载交付摘要（'<label>|sha256=<digest>'）、`constraintVersion`
// 承载签名者版本号——签名与验证两侧都走同一 buildSignaturePayload，故
// verifyAgentIdentity 一调即知「摘要是否由该公钥签出」。零自研签验实现。
//
// ── 注册点 / 挂载点（自查第 2 条）────────────────────────────
// 本文件只出执行函数（executeDeviceUpgrade / resumeSuspendedUpgrades），
// **不自注册**；订阅登记见 `engine/daemon/src/ota/subscriptions.ts` 的
// `DEVICE_OTA_SUBSCRIPTIONS` 数组 + `registerDeviceOtaSubscriptions(bus, opts)` 入口。
//
// ── 已知边界（诚实披露）──────────────────────────────────────
// · 版本清单上报端口 `pushVersionManifest` 由 **MCP 侧注入**（
//   engine/mcp/src/tools/device-register.ts 用 `deviceDataPush` 实现）——
//   daemon 包不得 import @sofagent/mcp（mcp 反向 optionalDepend daemon，硬依赖
//   会成包循环）。缺省未注入 → `manifestReported=false` 且审计证据记
//   `manifestPush=no-pusher`，**不静默**。
// · 真实网络拉取 / 安装动作为注入端口（制品库 / npm registry / 设备安装脚本）；
//   缺省安装 = 落盘 `<dataDir>/ota/components/<name>.json`（可测、确定性）。
// · **本版无签名者信任锚**：`verifyDeliverySignature` 只证「摘要由信封**自带的那个
//   公钥**签出」这一**自洽性**——平台公钥 pin / principal 白名单 / 设备注册表绑定
//   均**不在本版落点**（本目录下无 trusted/allowlist/pinned 任何一处）。
//   ⇒ 验签挡得住**篡改与传输损坏**，**挡不住持自洽密钥对的伪造签名者**。
// ============================================================

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  getDataDir,
  buildSignaturePayload,
  signIdentityPayload,
  verifyAgentIdentity,
  type AgentIdentity,
} from '@sofagent/core';
import { emitDecision } from '@sofagent/audit';
import { gateDevice, isOnline, listDevices } from '../device-registry';
import { buildHealthVerdict, collectHealthChecks, type HealthCheckItem } from '../health-endpoint';
import {
  clearSuspendedUpgrade,
  getDeviceVersions,
  listSuspendedUpgrades,
  loadUpgradePolicy,
  recordDeviceVersions,
  suspendUpgrade,
  evaluateUpgradePolicy,
  type SuspensionReason,
  type UpgradePolicy,
} from './upgrade-policy';

// ────────────────────────────────────────────────────────────
// 常量 / 类型
// ────────────────────────────────────────────────────────────

// ── 交付/升级面类型：**不在本地定义**（契约单一事实源）──────────
// 唯一定义处 = @sofagent/orchestrator 的 events/types.ts（v1.5.1 收口①）。
// 同一契约两处定义 = 两侧漂移后类型仍能通过编译的静默失效，故此处只做
// **别名再导出**：`DeviceXxx as Xxx` 保住执行侧既有引用名——本文件读写法、
// barrel 与 daemon 根导出面**零改动**。
import type {
  DeviceDeliverySignature as DeliverySignature,
  DeviceUpgradeComponent as UpgradeComponent,
  DeviceUpgradePayload,
  DeviceUpgradeRollout as UpgradeRollout,
  DeviceUpgradeTier as UpgradeTier,
} from '@sofagent/orchestrator';

export type { DeliverySignature, DeviceUpgradePayload, UpgradeComponent, UpgradeRollout, UpgradeTier };

/** 组件名合法词法（文件名主键——防路径穿越） */
const COMPONENT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** 升级结果分类 */
export type UpgradeOutcome = 'upgraded' | 'rolled-back' | 'rejected' | 'suspended';

/** 升级拒绝原因（fail-closed 分支显式化） */
export type UpgradeRejectReason =
  | 'invalid-params'
  | 'not-registered'
  | 'revoked'
  | 'invalid-identity'
  | 'pull-failed'
  | 'missing-signature'
  | 'digest-mismatch'
  | 'invalid-signature';

/** 拉取结果 */
export type PullResult = { ok: true; content: string } | { ok: false; error: string };

/** 安装 / 回滚结果 */
export interface ComponentOpResult {
  ok: boolean;
  error?: string;
}

/** 健康探针结果 */
export interface ProbeResult {
  ok: boolean;
  detail: string;
}

/** 版本清单（上报体） */
export interface VersionManifest {
  deviceId: string;
  targetVersion: string;
  /** 升级后的组件版本清单 */
  components: Record<string, string>;
  /** 升级结果（成功 → upgraded） */
  outcome: string;
  at: string;
  /** 组件升级次序（灰度次序证据） */
  order: string[];
}

/** 版本清单上报端口（实现由 MCP 侧绑定为 G11 `device_data_push`） */
export type VersionManifestPusher = (
  manifest: VersionManifest,
) => Promise<{ ok: boolean; seq?: number; message?: string }>;

/** 升级执行结果 */
export interface UpgradeResult {
  outcome: UpgradeOutcome;
  message: string;
  /** 目标版本 */
  targetVersion?: string;
  /** 拒绝原因（outcome=rejected 时有值） */
  reason?: UpgradeRejectReason;
  /** 挂起原因（outcome=suspended 时有值） */
  suspendedReason?: SuspensionReason;
  /** 实际执行次序（灰度次序证据——非核心在前） */
  order?: string[];
  /** 每批次的探针结果 */
  probes?: Array<{ stage: string; ok: boolean; detail: string }>;
  /** 升级前版本清单 */
  previousVersions?: Record<string, string>;
  /** 升级后版本清单 */
  currentVersions?: Record<string, string>;
  /** 交付摘要（验签通过时的包摘要） */
  digest?: string;
  /** 审计是否落链（decision-log HMAC 链） */
  auditLogged: boolean;
  /** 版本清单是否上报成功 */
  manifestReported: boolean;
  /** 上报入队序号（上报成功且有值时） */
  manifestSeq?: number;
  /** 上报未达原因（'no-pusher' / 端口返回失败 / 端口抛错） */
  manifestPushNote?: string;
}

/** 执行器选项 */
export interface UpgradeExecutorOptions {
  /** 设备身份（过 G9 gateDevice 闸门） */
  identity: AgentIdentity;
  /** 数据目录（测试隔离） */
  dataDir?: string;
  /** 当前时刻（测试注入） */
  nowMs?: number;
  /** 当前时刻 ISO（测试注入） */
  nowIso?: string;
  /** 策略覆盖（测试注入；缺省读 <dataDir>/ota-policy.json） */
  policy?: UpgradePolicy;
  /** 设备侧人工确认结果（HITL——手动确认模式的放行依据） */
  manualConfirmed?: boolean;
  /** 制品拉取通道（缺省：组件内联 content） */
  pullArtifact?: (component: UpgradeComponent) => PullResult;
  /** 安装动作（缺省：落盘 <dataDir>/ota/components/<name>.json + 备份前一版本） */
  installComponent?: (ctx: { component: UpgradeComponent; content: string; dataDir?: string }) => ComponentOpResult;
  /** 回滚动作（缺省：从 <dataDir>/ota/backup/<name>.json 恢复） */
  rollbackComponent?: (ctx: {
    component: UpgradeComponent;
    previousVersion?: string;
    dataDir?: string;
  }) => ComponentOpResult;
  /** 健康探针（缺省：daemon /health 三态巡检 collectHealthChecks + buildHealthVerdict） */
  healthProbe?: (ctx: { stage: string; dataDir?: string }) => ProbeResult;
  /** 版本清单上报端口（MCP 侧绑定 device_data_push） */
  pushVersionManifest?: VersionManifestPusher;
  /**
   * 触发本升级的总线事件追溯键（第一章事件流水的 correlationId）——
   * 进审计证据，使「事件 → 升级」链条在审计链上可对齐。
   */
  correlationId?: string;
}

// ────────────────────────────────────────────────────────────
// 摘要与交付签名（G9 Ed25519 链复用——不自研密码学）
// ────────────────────────────────────────────────────────────

/** sha256 hex（交付摘要 / 内容指纹） */
export function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * 计算交付摘要（确定性——组件按名排序，绑定目标版本 + 层级 + 制品内容指纹）。
 *
 * 这是被签名的对象：签名者签 `label|sha256=<本摘要>`，验签侧用**实际拉取到
 * 的内容**重算同一摘要——内容被换、层级被改、版本被改，摘要即变，验签必败。
 */
export function computeUpgradeDigest(
  targetVersion: string,
  components: UpgradeComponent[],
  contents: Record<string, string>,
): string {
  const canonical = JSON.stringify({
    targetVersion,
    components: [...components]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((c) => ({
        name: c.name,
        version: c.version,
        tier: c.tier,
        sha256: sha256Hex(contents[c.name] ?? ''),
      })),
  });
  return sha256Hex(canonical);
}

/** 交付摘要载荷位（签名方与验签方共用同一构造——两侧一致性由本函数保证） */
export function buildDeliveryResponsibility(label: string, digest: string): string {
  return `${label}|sha256=${digest}`;
}

/**
 * 签发交付签名信封（平台侧 / 测试构造合法包）。
 *
 * ⚠️ **平台（发布）侧签名器——本版只出执行侧（任务书章四第 152 行「验签判定留主干，
 * 本版只出执行侧」），设备端只验签不签名，故本符号在设备侧生产代码零调用点**。
 * 因此在 daemon 根导出面（`src/index.ts`）标注为 @internal，不对本版对外承诺
 * （详见该处注释）；仓内经 ota 子路径仍可用。平台发布侧落地时再提回 @public。
 *
 * 复用 G9 链：buildSignaturePayload + signIdentityPayload（core）。
 *
 * @param args.publicKey 签名者公钥（hex，SPKI/DER）
 * @param args.privateKey 签名者私钥（hex，PKCS8/DER）
 * @param args.principal 签名者委托人标识
 * @param args.constraintVersion 约束版本（缺省 1——与 buildSignaturePayload 缺省一致）
 * @param args.label 交付标签（如 `upgrade-package|version=1.6.0`）
 * @param args.digest 交付摘要（computeUpgradeDigest 产物）
 */
export function signDelivery(args: {
  publicKey: string;
  privateKey: string;
  principal: string;
  constraintVersion?: number;
  label: string;
  digest: string;
}): DeliverySignature {
  const responsibility = buildDeliveryResponsibility(args.label, args.digest);
  const payload = buildSignaturePayload({
    principal: args.principal,
    ...(args.constraintVersion !== undefined ? { constraintVersion: args.constraintVersion } : {}),
    responsibility,
  });
  return {
    principal: args.principal,
    publicKey: args.publicKey,
    signature: signIdentityPayload(payload, args.privateKey),
    ...(args.constraintVersion !== undefined ? { constraintVersion: args.constraintVersion } : {}),
    responsibility,
  };
}

/** 把交付签名信封装成 G9 身份码形态（verifyAgentIdentity 的入参契约） */
function asSignerIdentity(sig: DeliverySignature): AgentIdentity {
  return {
    agentId: 'ota-delivery-signer',
    displayName: 'ota-delivery-signer',
    principal: sig.principal,
    constraints: [],
    createdAt: '1970-01-01T00:00:00.000Z',
    fingerprint: 'ota-delivery-signer',
    shortCode: 'ota',
    publicKey: sig.publicKey,
    signature: sig.signature,
    ...(sig.constraintVersion !== undefined ? { constraintVersion: sig.constraintVersion } : {}),
    responsibility: sig.responsibility,
  };
}

/**
 * 验交付签名（fail-closed——铁律 4）。
 *
 * 三步判据，任一不过即拒：
 *   1. 信封缺失 → missing-signature（不「无签名视为可信」）；
 *   2. 载荷位摘要 ≠ 实际内容重算摘要 → digest-mismatch（内容被换 / 传输损坏）；
 *   3. verifyAgentIdentity 不过 → invalid-signature（换公钥 / 改载荷后未重签）。
 *
 * ⚠️ 第 3 步的**真实含义**：它只证明「摘要由**信封自带的那把公钥**签出」这一
 * **自洽性**——**不证明签名者可信**。本版全链**无签名者信任锚**（无平台公钥 pin /
 * 无 principal 白名单 / 无设备注册表绑定，见文件头「已知边界」）。
 * ⇒ 本函数挡得住**篡改类伪造**（改 payload / 改 principal / 换公钥而不重签），
 *   **挡不住**「自带一对自洽密钥、自己签自己」的外来伪造签名者。
 */
export function verifyDeliverySignature(
  sig: DeliverySignature | undefined,
  label: string,
  digest: string,
): { ok: boolean; reason?: 'missing-signature' | 'digest-mismatch' | 'invalid-signature'; message: string } {
  if (!sig || typeof sig !== 'object') {
    return { ok: false, reason: 'missing-signature', message: '交付包缺签名信封（fail-closed 拒绝）' };
  }
  if (typeof sig.publicKey !== 'string' || typeof sig.signature !== 'string' || typeof sig.responsibility !== 'string') {
    return { ok: false, reason: 'missing-signature', message: '签名信封字段不完整（publicKey / signature / responsibility）' };
  }
  if (sig.responsibility !== buildDeliveryResponsibility(label, digest)) {
    return {
      ok: false,
      reason: 'digest-mismatch',
      message: '签名载荷摘要与实际制品内容不符（包被篡改或传输损坏）',
    };
  }
  if (!verifyAgentIdentity(asSignerIdentity(sig))) {
    return { ok: false, reason: 'invalid-signature', message: 'Ed25519 验签失败（伪造签名 / 公钥被换 / 载荷被改）' };
  }
  return { ok: true, message: '验签通过' };
}

// ────────────────────────────────────────────────────────────
// 默认端口实现（可测、确定性；生产可整体注入替换）
// ────────────────────────────────────────────────────────────

/** 默认拉取：组件内联内容（事件总线小包）；未内联 → 明确失败（不静默） */
function defaultPullArtifact(component: UpgradeComponent): PullResult {
  if (typeof component.content === 'string') return { ok: true, content: component.content };
  return {
    ok: false,
    error: `组件「${component.name}」未内联内容且未注入制品拉取通道（生产接线请注入 pullArtifact：npm registry / 制品库）`,
  };
}

/** 组件落盘路径（<dataDir>/ota/components/<name>.json） */
export function componentPath(name: string, dataDir?: string): string {
  return path.join(getDataDir(dataDir), 'ota', 'components', `${name}.json`);
}

/** 组件备份路径（<dataDir>/ota/backup/<name>.json） */
export function componentBackupPath(name: string, dataDir?: string): string {
  return path.join(getDataDir(dataDir), 'ota', 'backup', `${name}.json`);
}

/** 目录准备（0o700） */
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/** 默认安装：备份前一版本 → 落盘新版本记录 */
function defaultInstall(ctx: {
  component: UpgradeComponent;
  content: string;
  dataDir?: string;
}): ComponentOpResult {
  const { component, content, dataDir } = ctx;
  try {
    const target = componentPath(component.name, dataDir);
    const backup = componentBackupPath(component.name, dataDir);
    ensureDir(path.dirname(target));
    ensureDir(path.dirname(backup));
    // 备份前一版本（回滚素材）——无旧版本时写 absent 标记（回滚 = 删除已装件）
    if (fs.existsSync(target)) {
      fs.copyFileSync(target, backup);
    } else if (!fs.existsSync(backup)) {
      fs.writeFileSync(backup, JSON.stringify({ absent: true }), 'utf-8');
    }
    fs.writeFileSync(
      target,
      JSON.stringify(
        {
          name: component.name,
          version: component.version,
          tier: component.tier,
          artifact: component.artifact ?? null,
          contentSha256: sha256Hex(content),
          installedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf-8',
    );
    fs.chmodSync(target, 0o600);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 默认回滚：从备份恢复（备份为 absent 标记 → 删除已装件 = 版本回退到「未装」） */
function defaultRollback(ctx: {
  component: UpgradeComponent;
  previousVersion?: string;
  dataDir?: string;
}): ComponentOpResult {
  const { component, previousVersion, dataDir } = ctx;
  try {
    const target = componentPath(component.name, dataDir);
    const backup = componentBackupPath(component.name, dataDir);
    if (fs.existsSync(backup)) {
      const raw = JSON.parse(fs.readFileSync(backup, 'utf-8')) as { absent?: boolean };
      if (raw.absent === true) {
        if (fs.existsSync(target)) fs.rmSync(target);
      } else {
        fs.copyFileSync(backup, target);
      }
    } else if (fs.existsSync(target)) {
      fs.rmSync(target);
    }
    // 版本号以 state 记录的前一版本为准（备份内容不含版本语义时仍可回退）
    void previousVersion;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 默认健康探针：复用 daemon /health 三态巡检（healthy 才算通过——degraded 亦不过） */
function defaultHealthProbe(ctx: { stage: string; dataDir?: string }): ProbeResult {
  const items: HealthCheckItem[] = collectHealthChecks({ dataDir: ctx.dataDir });
  const verdict = buildHealthVerdict(items);
  return { ok: verdict.status === 'healthy', detail: `${verdict.status}：${verdict.summary}` };
}

// ────────────────────────────────────────────────────────────
// 执行器
// ────────────────────────────────────────────────────────────

/** 分批（按层级内 batchSize 切块；缺省每层一批） */
function batchComponents(components: UpgradeComponent[], batchSize?: number): UpgradeComponent[][] {
  if (!batchSize || batchSize <= 0 || batchSize >= components.length) {
    return components.length > 0 ? [components] : [];
  }
  const out: UpgradeComponent[][] = [];
  for (let i = 0; i < components.length; i += batchSize) {
    out.push(components.slice(i, i + batchSize));
  }
  return out;
}

/**
 * 设备 OTA 审计落链（decision-log HMAC 链——复用 @sofagent/audit 公共 API）。
 *
 * kind 取 `EVOLUTION`（decision-schema 合法值之一，语义「进化动作（…/ 回滚）」）
 * ——本版**不新增 kind**（任务书第四章边界：不新增审计规则 / 不改判定逻辑）。
 * 审计不可用（链损坏 / 无权限）时**不阻断升级主流程**，返回 false 由调用方显式标注。
 *
 * 链可验性：`checkDecisionChainDetailed(dataDir)`（@sofagent/audit 公共 API）
 * 即验 HMAC 链完整性——升级全程留痕可追溯。
 */
export function emitDeviceAudit(args: {
  deviceId: string;
  outcome: string;
  why: string;
  evidence: string[];
  targetVersion?: string;
  dataDir?: string;
  /** 事件时刻（ISO 8601——进证据，便于链上回放对齐本地时钟） */
  nowIso?: string;
}): boolean {
  try {
    emitDecision(
      {
        agentId: `device-ota-${args.deviceId.slice(0, 8)}`,
        sessionId: `device-ota-${args.deviceId.slice(0, 8)}-${args.targetVersion ?? 'deploy'}-${process.hrtime.bigint().toString()}`,
        kind: 'EVOLUTION',
        moment: 'ACT',
        category: 'select',
        why: args.why,
        artifactRef: `device-ota/${args.deviceId.slice(0, 8)}/${args.targetVersion ?? 'deploy'}`,
        evidence: [...args.evidence, ...(args.nowIso ? [`at=${args.nowIso}`] : [])],
      },
      args.dataDir,
    );
    return true;
  } catch {
    return false; // best-effort 显式标注（审计不可用不阻断升级）
  }
}

/** 内部便捷包装：带上执行器选项中的 dataDir */
function auditUpgrade(
  opts: UpgradeExecutorOptions,
  payload: { targetVersion?: string; outcome: string; why: string; evidence: string[]; deviceId: string },
): boolean {
  return emitDeviceAudit({
    ...payload,
    evidence: [
      ...payload.evidence,
      ...(opts.correlationId !== undefined ? [`correlationId=${opts.correlationId}`] : []),
    ],
    ...(opts.dataDir !== undefined ? { dataDir: opts.dataDir } : {}),
  });
}

/** 组建设备升降级所需的公共上下文（闸门 + 在线 + 策略） */
function resolvePreconditions(
  payload: DeviceUpgradePayload,
  opts: UpgradeExecutorOptions,
): { ok: true; nowIso: string; previousVersions: Record<string, string> } | { ok: false; result: UpgradeResult } {
  const deviceId = opts.identity?.agentId ?? 'unknown';
  const nowIso = opts.nowIso ?? new Date().toISOString();
  const nowMs = opts.nowMs ?? Date.now();
  const base = { auditLogged: false, manifestReported: false } as const;

  // ── 参数校验（fail-closed：组件为空 / 名非法 / tier 非法 → 拒绝）──
  if (!payload || typeof payload !== 'object' || typeof payload.targetVersion !== 'string' || payload.targetVersion.trim() === '') {
    return {
      ok: false,
      result: { ...base, outcome: 'rejected', reason: 'invalid-params', message: '升级指令缺 targetVersion', auditLogged: false, manifestReported: false },
    };
  }
  if (!Array.isArray(payload.components) || payload.components.length === 0) {
    const auditLogged = auditUpgrade(opts, {
      targetVersion: payload.targetVersion,
      outcome: 'rejected',
      deviceId,
      why: `设备 OTA 升级拒绝：组件清单为空（fail-closed）`,
      evidence: [`targetVersion=${payload.targetVersion}`, `reason=invalid-params`],
    });
    return {
      ok: false,
      result: { ...base, outcome: 'rejected', reason: 'invalid-params', targetVersion: payload.targetVersion, message: '升级指令组件清单为空', auditLogged, manifestReported: false },
    };
  }
  const bad = payload.components.find(
    (c) => !c || !COMPONENT_NAME_PATTERN.test(String(c.name)) || (c.tier !== 'core' && c.tier !== 'non-core') || typeof c.version !== 'string',
  );
  if (bad) {
    const auditLogged = auditUpgrade(opts, {
      targetVersion: payload.targetVersion,
      outcome: 'rejected',
      deviceId,
      why: `设备 OTA 升级拒绝：组件声明非法（${String(bad.name)} tier=${String(bad.tier)}）`,
      evidence: [`targetVersion=${payload.targetVersion}`, `component=${String(bad.name)}`, `reason=invalid-params`],
    });
    return {
      ok: false,
      result: { ...base, outcome: 'rejected', reason: 'invalid-params', targetVersion: payload.targetVersion, message: `组件声明非法：${String(bad.name)}（tier 须 core/non-core，名须文件名词法）`, auditLogged, manifestReported: false },
    };
  }

  // ── 1. 已注册设备闸门（G9——未注册 / 吊销 / 验签失败一律拒绝）──
  const gate = gateDevice(opts.identity, opts.dataDir);
  if (!gate.ok) {
    const auditLogged = auditUpgrade(opts, {
      targetVersion: payload.targetVersion,
      outcome: 'rejected',
      deviceId,
      why: `设备 OTA 升级拒绝：${gate.message}（升级面只面向已注册设备）`,
      evidence: [`targetVersion=${payload.targetVersion}`, `gateReason=${gate.reason ?? 'unknown'}`],
    });
    return {
      ok: false,
      result: {
        ...base,
        outcome: 'rejected',
        targetVersion: payload.targetVersion,
        reason: (gate.reason === 'not-registered' || gate.reason === 'revoked' ? gate.reason : 'invalid-identity'),
        message: gate.message,
        auditLogged,
        manifestReported: false,
      },
    };
  }

  // ── 2. 心跳在线判定（离线 → 挂起等待，上线后 resume 补升）──
  const record = listDevices(opts.dataDir, { nowMs }).find((d) => d.identity.agentId === deviceId);
  const lastMs = record?.lastHeartbeatAt ? new Date(record.lastHeartbeatAt).getTime() : null;
  if (!isOnline(lastMs, nowMs)) {
    suspendUpgrade({ deviceId, targetVersion: payload.targetVersion, payload, reason: 'offline', suspendedAt: nowIso }, opts.dataDir);
    const auditLogged = auditUpgrade(opts, {
      targetVersion: payload.targetVersion,
      outcome: 'suspended',
      deviceId,
      why: `设备 OTA 升级挂起：设备心跳离线（最后心跳 ${record?.lastHeartbeatAt ?? '从未心跳'}），上线后自动补升`,
      evidence: [`targetVersion=${payload.targetVersion}`, 'suspendedReason=offline', `components=${payload.components.length}`],
    });
    return {
      ok: false,
      result: { ...base, outcome: 'suspended', suspendedReason: 'offline', targetVersion: payload.targetVersion, message: '设备离线，升级挂起等待上线补升', auditLogged, manifestReported: false },
    };
  }

  // ── 3. 截止窗口（已过 → 挂起等待人工处置）──
  if (typeof payload.deadline === 'string' && payload.deadline.trim() !== '') {
    const deadlineMs = Date.parse(payload.deadline);
    if (Number.isFinite(deadlineMs) && nowMs > deadlineMs) {
      suspendUpgrade({ deviceId, targetVersion: payload.targetVersion, payload, reason: 'deadline-exceeded', suspendedAt: nowIso }, opts.dataDir);
      const auditLogged = auditUpgrade(opts, {
        targetVersion: payload.targetVersion,
        outcome: 'suspended',
        deviceId,
        why: `设备 OTA 升级挂起：已过截止窗口（${payload.deadline}），等待人工处置`,
        evidence: [`targetVersion=${payload.targetVersion}`, 'suspendedReason=deadline-exceeded', `deadline=${payload.deadline}`],
      });
      return {
        ok: false,
        result: { ...base, outcome: 'suspended', suspendedReason: 'deadline-exceeded', targetVersion: payload.targetVersion, message: `已过截止窗口 ${payload.deadline}，挂起等待人工处置`, auditLogged, manifestReported: false },
      };
    }
  }

  // ── 4. 升级窗口 / 手动确认策略 ──
  const policy = opts.policy ?? loadUpgradePolicy(opts.dataDir);
  const verdict = evaluateUpgradePolicy(policy, {
    now: new Date(nowMs),
    targetVersion: payload.targetVersion,
    ...(opts.manualConfirmed !== undefined ? { manualConfirmed: opts.manualConfirmed } : {}),
  });
  if (!verdict.allowed) {
    const reason: SuspensionReason =
      verdict.reason === 'out-of-window'
        ? 'out-of-window'
        : verdict.reason === 'manual-confirm-required'
          ? 'manual-confirm-required'
          : 'policy-invalid';
    suspendUpgrade({ deviceId, targetVersion: payload.targetVersion, payload, reason, suspendedAt: nowIso }, opts.dataDir);
    const auditLogged = auditUpgrade(opts, {
      targetVersion: payload.targetVersion,
      outcome: 'suspended',
      deviceId,
      why: `设备 OTA 升级挂起：${verdict.message}`,
      evidence: [`targetVersion=${payload.targetVersion}`, `suspendedReason=${reason}`, `policyReason=${verdict.reason}`],
    });
    return {
      ok: false,
      result: { ...base, outcome: 'suspended', suspendedReason: reason, targetVersion: payload.targetVersion, message: verdict.message, auditLogged, manifestReported: false },
    };
  }

  return { ok: true, nowIso, previousVersions: getDeviceVersions(deviceId, opts.dataDir) };
}

/**
 * 执行设备 OTA 升级（第四章主入口）。
 *
 * @param payload `device.upgrade` 事件 payload（目标版本 + 组件清单 + 灰度策略 + 截止窗口）
 * @param opts 执行器选项（身份 / 数据目录 / 注入端口）
 */
export async function executeDeviceUpgrade(
  payload: DeviceUpgradePayload,
  opts: UpgradeExecutorOptions,
): Promise<UpgradeResult> {
  const deviceId = opts.identity?.agentId ?? 'unknown';
  const nowIso = opts.nowIso ?? new Date().toISOString();
  const pre = resolvePreconditions(payload, opts);
  if (!pre.ok) return pre.result;
  const previousVersions = pre.previousVersions;

  const pull = opts.pullArtifact ?? defaultPullArtifact;
  const install = opts.installComponent ?? defaultInstall;
  const rollback = opts.rollbackComponent ?? defaultRollback;
  const probe = opts.healthProbe ?? defaultHealthProbe;

  // ── 5. 拉取（逐组件——拉取不落盘安装；失败即拒，不进入验签）──
  const contents: Record<string, string> = {};
  for (const c of payload.components) {
    const r = pull(c);
    if (!r.ok) {
      const auditLogged = auditUpgrade(opts, {
        targetVersion: payload.targetVersion,
        outcome: 'rejected',
        deviceId,
        why: `设备 OTA 升级拒绝：制品拉取失败（${c.name}）`,
        evidence: [`targetVersion=${payload.targetVersion}`, `component=${c.name}`, `reason=pull-failed`, `error=${r.error}`],
      });
      return {
        outcome: 'rejected',
        reason: 'pull-failed',
        targetVersion: payload.targetVersion,
        message: `制品拉取失败（${c.name}）：${r.error}`,
        auditLogged,
        manifestReported: false,
      };
    }
    contents[c.name] = r.content;
  }

  // ── 6. 验签（fail-closed——摘要重算 + Ed25519 验签，两者皆过才放行安装）──
  const digest = computeUpgradeDigest(payload.targetVersion, payload.components, contents);
  const verify = verifyDeliverySignature(
    payload.signature,
    `upgrade-package|version=${payload.targetVersion}`,
    digest,
  );
  if (!verify.ok) {
    const auditLogged = auditUpgrade(opts, {
      targetVersion: payload.targetVersion,
      outcome: 'rejected',
      deviceId,
      why: `设备 OTA 升级拒绝：${verify.message}（fail-closed——伪造签名升级包被拒）`,
      evidence: [
        `targetVersion=${payload.targetVersion}`,
        `reason=${verify.reason ?? 'invalid-signature'}`,
        `digest=${digest}`,
        `components=${payload.components.length}`,
      ],
    });
    // 验签失败的挂起项不再保留（重试无意义——同一包永远验不过）
    clearSuspendedUpgrade(deviceId, payload.targetVersion, opts.dataDir);
    return {
      outcome: 'rejected',
      reason: verify.reason ?? 'invalid-signature',
      targetVersion: payload.targetVersion,
      message: verify.message,
      digest,
      auditLogged,
      manifestReported: false,
    };
  }

  // ── 7. 灰度执行：非核心组件先升 → 探针 → 核心组件 ──
  const nonCore = payload.components.filter((c) => c.tier === 'non-core');
  const core = payload.components.filter((c) => c.tier === 'core');
  const order = [...nonCore, ...core].map((c) => c.name);
  const batches: Array<{ stage: string; items: UpgradeComponent[] }> = [
    ...batchComponents(nonCore, payload.rollout?.batchSize).map((items, i) => ({ stage: `non-core-${i + 1}`, items })),
    ...batchComponents(core, payload.rollout?.batchSize).map((items, i) => ({ stage: `core-${i + 1}`, items })),
  ];

  const installed: UpgradeComponent[] = [];
  const probes: Array<{ stage: string; ok: boolean; detail: string }> = [];
  let failure: string | null = null;

  for (const batch of batches) {
    for (const c of batch.items) {
      const r = install({ component: c, content: contents[c.name] ?? '', dataDir: opts.dataDir });
      if (!r.ok) {
        failure = `组件「${c.name}」安装失败：${r.error ?? '未知错误'}`;
        break;
      }
      installed.push(c);
    }
    if (failure) break;
    const p = probe({ stage: batch.stage, dataDir: opts.dataDir });
    probes.push({ stage: batch.stage, ok: p.ok, detail: p.detail });
    if (!p.ok) {
      failure = `健康探针未通过（${batch.stage}）：${p.detail}`;
      break;
    }
  }

  // ── 8. 失败 → 回滚到前一版本（设备可继续服务）──
  if (failure) {
    const rollbackErrors: string[] = [];
    for (const c of [...installed].reverse()) {
      const r = rollback({
        component: c,
        ...(previousVersions[c.name] !== undefined ? { previousVersion: previousVersions[c.name] } : {}),
        dataDir: opts.dataDir,
      });
      if (!r.ok) rollbackErrors.push(`${c.name}: ${r.error ?? '未知错误'}`);
    }
    recordDeviceVersions(
      deviceId,
      previousVersions,
      { outcome: 'rolled-back', targetVersion: payload.targetVersion, at: nowIso },
      opts.dataDir,
    );
    clearSuspendedUpgrade(deviceId, payload.targetVersion, opts.dataDir);
    const auditLogged = auditUpgrade(opts, {
      targetVersion: payload.targetVersion,
      outcome: 'rolled-back',
      deviceId,
      why: `设备 OTA 升级失败已回滚：${failure}`,
      evidence: [
        `targetVersion=${payload.targetVersion}`,
        `digest=${digest}`,
        `order=${order.join('>')}`,
        `failure=${failure}`,
        `rolledBack=${installed.map((c) => c.name).join(',')}`,
        `rollbackErrors=${rollbackErrors.length > 0 ? rollbackErrors.join('|') : 'none'}`,
        `restoredVersions=${JSON.stringify(previousVersions)}`,
      ],
    });
    return {
      outcome: 'rolled-back',
      targetVersion: payload.targetVersion,
      message: `${failure}——已回滚到前一版本（设备可继续服务）`,
      digest,
      order,
      probes,
      previousVersions,
      currentVersions: previousVersions,
      auditLogged,
      manifestReported: false,
    };
  }

  // ── 9. 成功：记录版本清单 → **成功分支末尾**上报 G11 版本清单 ──
  const currentVersions: Record<string, string> = { ...previousVersions };
  for (const c of payload.components) currentVersions[c.name] = c.version;
  recordDeviceVersions(
    deviceId,
    currentVersions,
    { outcome: 'upgraded', targetVersion: payload.targetVersion, at: nowIso },
    opts.dataDir,
  );
  clearSuspendedUpgrade(deviceId, payload.targetVersion, opts.dataDir);

  const manifest: VersionManifest = {
    deviceId,
    targetVersion: payload.targetVersion,
    components: currentVersions,
    outcome: 'upgraded',
    at: nowIso,
    order,
  };
  let manifestReported = false;
  let manifestSeq: number | undefined;
  let manifestPushNote: string | undefined;
  if (opts.pushVersionManifest) {
    try {
      const r = await opts.pushVersionManifest(manifest);
      manifestReported = r.ok === true;
      if (typeof r.seq === 'number') manifestSeq = r.seq;
      if (!r.ok) manifestPushNote = r.message ?? '端口返回失败';
    } catch (err) {
      manifestPushNote = `端口抛错：${err instanceof Error ? err.message : String(err)}`;
    }
  } else {
    // 不静默：未注入上报端口 → 明确记录原因（生产由 MCP 侧订阅登记时注入 device_data_push 实现）
    manifestPushNote = 'no-pusher';
  }

  const auditLogged = auditUpgrade(opts, {
    targetVersion: payload.targetVersion,
    outcome: 'upgraded',
    deviceId,
    why: `设备 OTA 升级成功：${payload.targetVersion}（${order.length} 组件，灰度次序 ${order.join('>')}）`,
    evidence: [
      `targetVersion=${payload.targetVersion}`,
      `digest=${digest}`,
      `order=${order.join('>')}`,
      `previousVersions=${JSON.stringify(previousVersions)}`,
      `currentVersions=${JSON.stringify(currentVersions)}`,
      `probes=${probes.map((p) => `${p.stage}:${p.ok ? 'ok' : 'fail'}`).join(',')}`,
      ...(payload.rollout?.percentage !== undefined ? [`rolloutPercentage=${payload.rollout.percentage}`] : []),
      `manifestPush=${manifestReported ? `sent:${manifestSeq ?? 'na'}` : `failed:${manifestPushNote ?? 'unknown'}`}`,
    ],
  });

  return {
    outcome: 'upgraded',
    targetVersion: payload.targetVersion,
    message: `升级完成（${order.length} 组件 · 非核心→核心）`,
    digest,
    order,
    probes,
    previousVersions,
    currentVersions,
    auditLogged,
    manifestReported,
    ...(manifestSeq !== undefined ? { manifestSeq } : {}),
    ...(manifestPushNote !== undefined ? { manifestPushNote } : {}),
  };
}

/**
 * 恢复挂起中的升级（窗口外 / 离线 / 待确认的设备恢复后自动补升）。
 *
 * 逐条重跑 executeDeviceUpgrade——仍不满足前置条件的条目会再次挂起
 * （挂起队列按「设备 + 目标版本」去重，不会膨胀）。
 */
export async function resumeSuspendedUpgrades(opts: UpgradeExecutorOptions): Promise<UpgradeResult[]> {
  const deviceId = opts.identity?.agentId ?? 'unknown';
  const pending = listSuspendedUpgrades(deviceId, opts.dataDir);
  const results: UpgradeResult[] = [];
  for (const entry of pending) {
    results.push(await executeDeviceUpgrade(entry.payload, opts));
  }
  return results;
}
