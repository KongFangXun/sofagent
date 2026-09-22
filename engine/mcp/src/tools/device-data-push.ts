// ============================================================
// device-data-push.ts · MCP tool：数据上行通道（v1.5.1 G11 · T3）
// ============================================================
//
// 设备向平台「推」数据的受控入口：设备门禁 → 采集声明校验 → 脱敏 →
// 加密入队（WAL 暂存）→ 尝试上行（游标续传）→ 审计留痕 → 计量进账。
//
// 链路顺序（fail-closed 逐层）：
//   1. gateDevice 闸门（未注册 / 吊销 / 验签失败 → 拒绝）
//   2. authorizeDeviceUpload 采集声明判定（空声明全拒 / 类别未声明拒绝）
//   3. redact 脱敏（原始数据不出设备——验收 ④ 前半）
//   4. enqueueUpload 加密入队（AES-256-GCM——验收 ④ 后半 + ③ 断网暂存）
//   5. flushUploads 传输回调（注入式——真实网络面归调用方；本 tool
//      的传输层是「回调收到密文条目返回 ack 语义」，daemon/skill 侧
//      接线 HTTP/ssh 推送。回调失败 → 条目留在 WAL 等下轮——不丢）
//   6. emitDecision 审计 + 计量（数据量/次数经 evidence 进 worklog/cost）
//
// 默认传输回调：未注入时只入队不发送（返回 queued 状态——手动/定时
// 触发面可先入队后批量冲；这本身就是「断网暂存」的常态语义）。
//
// v1.5.1 第六章接线：第 3 步「脱敏」由既有脱敏管线升级为
// **三层敏感检测插槽管线**（L0 正则 → L1 词典 → L2 外挂 NER，判定本体零
// 改动）——见本文件「T8/T9 生产管线接线」段。既有链路顺序、门禁、声明
// 判定、加密入队、游标续传、审计计量**保持原样**，只在脱敏步换管线。
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import {
  authorizeDeviceUpload,
  redact,
  loadRedactRules,
  getDataDir,
  DetectorRegistry,
  classifySensitivity,
  createL0RegexDetector,
  createGlossaryDetector,
  buildGlossaryFromEntityNames,
  prefetchRemoteSpans,
  createPrefetchedRemoteDetector,
  createRemoteDetector,
  type RedactRulesConfig,
  type RemoteDetectorConfig,
  type SensitivityDecision,
} from '@sofagent/core';
import {
  canaryRouteRequest,
  runCanaryCheck,
  type ArmMetrics,
  type CanaryConfig,
  type RollbackOutcome,
  type RollbackWeightsFn,
  type RouteVerdict,
} from '@sofagent/train';

/** 传输回调（注入式传输层——收密文条目，返回是否送达） */
export type UploadTransport = (entry: {
  seq: number;
  deviceId: string;
  category: string;
  destination?: string;
  ciphertext: string;
  iv: string;
  tag: string;
}) => boolean;

/** 推送结果（结构化） */
export interface DeviceDataPushResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  data: {
    isError: boolean;
    ok: boolean;
    reason?:
      | 'not-registered' | 'revoked' | 'invalid-identity' | 'daemon-unavailable'
      | 'empty-policy' | 'device-not-in-policy' | 'category-not-declared' | 'destination-mismatch' | 'invalid-params'
      | 'no-aes-key';
    message: string;
    /** 入队序号（ok=true 时有值） */
    seq?: number;
    /** 本次上行送达状态：sent 已送达并 ack / queued 暂存待传 / partial 部分送达 */
    delivery?: 'sent' | 'queued' | 'partial';
    /** 待传条目数（冲账后仍留在 WAL 的） */
    pending?: number;
    auditLogged: boolean;
  };
}

// ══════════════════════════════════════════════════════════
// v1.5.1 第六章 · T8/T9 生产管线接线（复用 core/train 既有件）
// ══════════════════════════════════════════════════════════
//
// 接线对象：本 tool（设备数据上行）与 router-session-push（router 过站
// session 上行）两条既有上行通道——v1.4.9 交付的 T8 三层插槽与 T9 灰度
// AB 此前是 SDK 面先行（零生产消费），本段把两条通道接进插槽管线。
//
// 三层检测（逐层降漏——判定本体零改动，只做调用点接线）：
//   L0 正则  createL0RegexDetector()——内置零依赖默认档
//   L1 词典  createGlossaryDetector()——词条取自既有 redact-rules.json 的
//            entities（redactor.ts:172 明示「插槽态下 entities 不再二次
//            替换」，故必须并入 L1 词典注册，否则既有实体脱敏面静默丢失）
//   L2 外挂  prefetchRemoteSpans() + createPrefetchedRemoteDetector()
//            ——异步面先 await 预取，再包成同步检测器注册
//
// fail-closed（语义沿用 v1.4.9 detector-remote 定义，未放宽）：L2 端点
// 不可达 / 超时 / 响应不合法 → 预取上抛 → 改注册 createRemoteDetector
// （detect 上抛型）→ 由 DetectorRegistry.runPipeline 登记 degraded
// （留痕事实）+ L0/L1 继续检测；**不静默放行**。
//
// 灰度分流（T9）：canaryRouteRequest 按分流键稳定 hash 分流（同键恒定同
// 臂——判定本体零改动），分流依据（臂 + routeReason）随 evidence 入审计链。
//
// 挂载点（默认配置下即生效，非静默）：
//   - L2 端点：env `SOFAGENT_L2_NER_ENDPOINT`（未设 = 不注册 L2，两层兜底）
//   - L1 词典：`<dataDir>/config/redact-rules.json` 的 entities（既有配置项）
//   - 灰度配置：`<dataDir>/config/weight-canary.json`（不存在 = 不灰度，
//     行为零变化）
// ══════════════════════════════════════════════════════════

/** L2 外挂 NER 端点 env（未设 → 不注册 L2，插槽退化为 L0+L1 两层） */
export const L2_NER_ENDPOINT_ENV = 'SOFAGENT_L2_NER_ENDPOINT';

/** L2 外挂 NER 超时 env（毫秒——缺省沿用 detector-remote 的 3000） */
export const L2_NER_TIMEOUT_ENV = 'SOFAGENT_L2_NER_TIMEOUT_MS';

/** 灰度配置文件相对路径（<dataDir>/config/weight-canary.json） */
export const WEIGHT_CANARY_FILE = 'config/weight-canary.json';

/**
 * 读灰度配置（<dataDir>/config/weight-canary.json）。
 *
 * 不存在 / 损坏 / 字段非法 → undefined（不灰度——全量旧臂，行为零变化）。
 * 与 device-upload-policy 同纪律：坏配置发声不崩（`console.warn`）。
 */
export function loadWeightCanaryConfig(dataDir: string): CanaryConfig | undefined {
  const p = join(dataDir, WEIGHT_CANARY_FILE);
  if (!existsSync(p)) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(p, 'utf-8'));
  } catch (err) {
    console.warn(
      `[weight-canary] 配置损坏（${p}）：${err instanceof Error ? err.message : String(err)}——按未配置灰度处理（全量旧臂）`,
    );
    return undefined;
  }
  const cfg = raw as Partial<CanaryConfig> | null;
  if (
    !cfg ||
    typeof cfg.modelName !== 'string' ||
    typeof cfg.oldAdapter !== 'string' ||
    typeof cfg.newAdapter !== 'string' ||
    typeof cfg.newWeightPercent !== 'number'
  ) {
    console.warn(`[weight-canary] 配置字段非法（${p}）——按未配置灰度处理（全量旧臂）`);
    return undefined;
  }
  return {
    modelName: cfg.modelName,
    oldAdapter: cfg.oldAdapter,
    newAdapter: cfg.newAdapter,
    newWeightPercent: cfg.newWeightPercent,
  };
}

/** 三层检测插槽接线选项（缺省从配置面解析——装配/测试可注入覆盖） */
export interface UpstreamPipelineOptions {
  /** L2 外挂 NER 端点覆盖（缺省读 env `SOFAGENT_L2_NER_ENDPOINT`） */
  l2Endpoint?: string;
  /** L2 超时覆盖（毫秒） */
  l2TimeoutMs?: number;
}

/** 上行管线接线结果（三层检测 + 脱敏） */
export interface UpstreamPipelineResult {
  /** 脱敏后文本（命中项已走既有脱敏管线——可安全落盘/上行） */
  text: string;
  /** 脱敏命中计数（替代旧 redact().totalHits 入审计计量） */
  redactHits: number;
  /** 敏感度判定本体结果（routeReason 为判定本体原样输出） */
  decision: SensitivityDecision;
  /** 入审计链用的 routeReason——已过 L0+L1 脱敏（见下「标签二次泄漏」注） */
  routeReasonSanitized: string;
  /** 管道降级登记（L2 外挂不可用等——fail-closed 留痕，不静默） */
  degraded: Array<{ detector: string; reason: string }>;
  /** L2 预取失败原因（不可达/超时/响应不合法——真实故障因，随 evidence 入链） */
  l2PrefetchError?: string;
  /** 参与调度的检测器清单（L0/L1/L2 接线自证） */
  detectors: Array<{ name: string; layer: string }>;
  /** L1 词典窄化统计（只做可见化——见 GlossaryNarrowing 注） */
  glossaryNarrowed: GlossaryNarrowing;
  /** 审计 evidence 行（追加进既有 evidence 数组） */
  evidence: string[];
}

/** 灰度分流接线选项 */
export interface UpstreamCanaryOptions {
  /** 灰度配置覆盖（缺省读 `<dataDir>/config/weight-canary.json`） */
  canary?: CanaryConfig;
  /** 两臂指标（提供时执行劣化判定 + 回退编排——daemon 装配/巡检注入） */
  metrics?: { old: ArmMetrics; new: ArmMetrics };
  /** 回退执行面（复用 rollback-weights 语义——runCanaryCheck 消费） */
  rollbackWeights?: RollbackWeightsFn;
  /** 回退留痕签名密钥（缺省无签名） */
  hmacKey?: string;
}

/** 灰度分流接线结果 */
export interface UpstreamCanaryResult {
  /** 分流判定（未配置灰度时 undefined） */
  canary?: RouteVerdict;
  /** 分流依据（人读可解释——随 evidence 入审计链） */
  routeReason?: string;
  /** 劣化回退编排结果（注入两臂指标时给出） */
  rollback?: RollbackOutcome;
  /** 审计 evidence 行 */
  evidence: string[];
}

/** 上行接线总选项（三层检测插槽 + 灰度分流——两段各取自己的字段） */
export interface UpstreamWiringOptions extends UpstreamPipelineOptions, UpstreamCanaryOptions {}

/** 词条短标识（sha256 前 8 位——审计链上可指代词条但不落原文） */
function termTag(term: string): string {
  return createHash('sha256').update(term).digest('hex').slice(0, 8);
}

/**
 * L1 词典窄化统计（**只做可见化，不改脱敏能力**）。
 *
 * 插槽态下 `redact-rules.json` 的 entities 由 L1 词典承载，而 v1.4.9 词典件
 * 自带两条**收窄**语义（本批不动 core，故只能让它可见）：
 *   ① 空 / 单字符词条被 `buildGlossaryFromEntityNames` 拒收（<2 字符门槛）
 *   ② 纯 ASCII 词条在 `termToRegex` 加两侧非字母数字断言（子串匹配 → 整词匹配）
 * 二者都会让实际脱敏口径**比配置窄**。安全能力的收窄属最需显式披露的一类，
 * 故统计配置侧窄化量，并在本次文本**确实落在窄化缺口上**时逐条登记
 * （词条以 sha256 前 8 位指代——与 routeReason 止损同一条「链上不留原文」纪律）。
 */
export interface GlossaryNarrowing {
  /** 被词典拒收的词条数（当前实现 = <2 字符 / 空词条） */
  droppedShort: number;
  /** 纯 ASCII 词条数（整词边界语义——子串匹配面收窄） */
  asciiWordBoundary: number;
  /** 本次文本确实落入窄化缺口的词条（未脱敏即可能出盘——必须可见） */
  missed: Array<{ category: 'droppedShort' | 'asciiWordBoundary'; tag: string }>;
}

/**
 * 上行敏感检测管线（三层插槽——两条上行通道共用）。
 *
 * ⚠️ 本函数只做**调用点接线**：`classifySensitivity` / `DetectorRegistry` /
 * `prefetchRemoteSpans` 的内部实现一行未改。
 *
 * @param args.text 待检测文本（上行明文）
 * @param args.rules 既有脱敏规则（`loadRedactRules` 产物——插槽态下其
 *        entities 并入 L1 词典，格式类/结构类仍由 redact 原位处置）
 */
export async function runUpstreamSensitivityPipeline(args: {
  text: string;
  rules: RedactRulesConfig;
  dataDir: string;
  opts?: UpstreamPipelineOptions;
}): Promise<UpstreamPipelineResult> {
  const registry = new DetectorRegistry();
  // routeReason 入链前的脱敏面（仅 L0+L1——理由见下「标签二次泄漏」注）
  const reasonRegistry = new DetectorRegistry();

  // ⚠️ 偏移一致性纪律（接线要点）：redact 的插槽路径是在「格式类 + 结构类已
  // 脱敏」的中间文本上跑 runPipeline（redactor.ts:133-153），而非原文。L2
  // 预取 span 的偏移绑定待检文本——若对原文预取却由 redact 在中间文本上套
  // 用，偏移必然错位（错位既漏脱敏又串改文本）。故先用同一纯函数前置步骤
  // 复现该中间文本（redact(text, {fields}) —— 只跑格式类 + 结构类，不含
  // 语义类），检测与 L2 预取都在中间文本上进行，偏移面与 redact 内部一致。
  // 🔴 已知耦合（core 侧若改则本行须同步）：本行隐式依赖 redactor 的内部步骤
  // 顺序（格式类 → 结构类 → 插槽）与「格式/结构类只吃 fields 配置」这一事实。
  // 置换取舍：多一次纯函数调用（无 I/O、无网络）< 接受错位套用。core 侧若把
  // 中间文本对外导出（或在 redact 内改序），本行必须跟着改——已列入交接建议。
  const detectText = redact(args.text, {
    ...(args.rules.fields && args.rules.fields.length > 0 ? { fields: args.rules.fields } : {}),
  }).text;

  // ── L0 正则（内置零依赖默认档）──
  registry.register(createL0RegexDetector());
  reasonRegistry.register(createL0RegexDetector());

  // ── L1 词典（企业专名——既有 entities 并入，防插槽态下语义脱敏面丢失）──
  // 窄化统计（可见化，不改能力）：registered 取词典实际收录集，
  // configured − registered = 被词典拒收集（当前实现为 <2 字符/空词条）；
  // 收录集里纯 ASCII 者按 termToRegex 走整词边界语义（子串匹配面收窄）。
  const configuredTerms = (args.rules.entities ?? []).map((e) => e.pattern);
  const glossary = buildGlossaryFromEntityNames(configuredTerms);
  const registered = new Set(glossary.entries.map((e) => e.term));
  const droppedShort = configuredTerms.filter((t) => t.trim() !== '' && !registered.has(t.trim()));
  const asciiWordBoundary = glossary.entries.filter((e) => /^[\x20-\x7e]+$/.test(e.term)).map((e) => e.term);
  if (glossary.entries.length > 0) {
    registry.register(createGlossaryDetector(glossary.entries));
    reasonRegistry.register(createGlossaryDetector(glossary.entries));
  }

  // ── L2 外挂 NER（fail-closed：不可用降级 L0+L1 并留痕）──
  const epRaw = args.opts?.l2Endpoint ?? process.env[L2_NER_ENDPOINT_ENV];
  const endpoint = typeof epRaw === 'string' && epRaw.trim() !== '' ? epRaw : undefined;
  let l2PrefetchError: string | undefined;
  if (endpoint) {
    const envTimeout = Number(process.env[L2_NER_TIMEOUT_ENV]);
    const timeoutMs =
      args.opts?.l2TimeoutMs ?? (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : undefined);
    const l2Cfg: RemoteDetectorConfig = { endpoint, ...(timeoutMs !== undefined ? { timeoutMs } : {}) };
    try {
      // 异步面预取（不可达/超时/响应不合法三形态上抛——detector-remote 内建语义）
      const spans = await prefetchRemoteSpans(detectText, l2Cfg);
      registry.register(createPrefetchedRemoteDetector(spans));
    } catch (err) {
      // fail-closed：预取失败 → 注册上抛型检测器；RunPipeline 捕获后登记 degraded
      // （降级事实留痕）+ L0/L1 继续检测——不静默放行（语义沿用 v1.4.9，未放宽）
      // 真实故障因（不可达/超时/响应不合法）另随 evidence 入链——createRemoteDetector
      // 的 detect 上抛文案是「异步面不兼容」的固定文案，不足以还原降级原因
      l2PrefetchError = err instanceof Error ? err.message : String(err);
      registry.register(createRemoteDetector(l2Cfg));
    }
  }

  // 降级登记来源（classifySensitivity 不透出 degraded，故直取管线结果；
  // 检测器均为纯函数 / L2 已预取不再触网，重复调度无副作用）
  const pipeline = registry.runPipeline(detectText);
  const decision = classifySensitivity(detectText, registry);
  const redacted = redact(args.text, args.rules, { detectorRegistry: registry });

  // ⚠️ 标签二次泄漏（接线发现的既有缺口，本版只做**止损不改判定**）：
  // sensitivity-classifier 的 routeReason/matchedLabels 承诺「不含命中原文」，
  // 但 L1 词典检测器的 label 即企业专名原文（detector-glossary.ts:139），
  // 且 audit 侧 sanitizeWhy 只过 A2 格式族、evidence 完全不过脱敏——
  // 原样入链会把企业专名写进 decision-log。故入链前过 L0+L1 脱敏
  // （不注册 L2：预取 span 的偏移属待检文本，跨文本复用会串位）。
  const routeReasonSanitized = redact(decision.routeReason, args.rules, {
    detectorRegistry: reasonRegistry,
  }).text;

  // 窄化缺口实检（**不得默默通过**）：本次文本里真出现窄化缺口 → 显式登记。
  //   - 被拒收词条：只要在文本中出现即缺口（管线永不会命中它）
  //   - ASCII 词条：按整词边界正则扫全部出现位置，未被任何 span 覆盖的即缺口
  //     （在 detectText 上比对——与 span 偏移同一文本空间，逐位精确）
  const missed: GlossaryNarrowing['missed'] = [];
  for (const t of droppedShort) {
    if (args.text.includes(t)) missed.push({ category: 'droppedShort', tag: termTag(t) });
  }
  for (const t of asciiWordBoundary) {
    let idx = detectText.indexOf(t);
    while (idx !== -1) {
      const covered = pipeline.spans.some((s) => s.start === idx && s.end === idx + t.length);
      if (!covered) {
        missed.push({ category: 'asciiWordBoundary', tag: termTag(t) });
        break;
      }
      idx = detectText.indexOf(t, idx + 1);
    }
  }
  const glossaryNarrowed: GlossaryNarrowing = {
    droppedShort: droppedShort.length,
    asciiWordBoundary: asciiWordBoundary.length,
    missed,
  };

  const evidence: string[] = [
    `redactHits=${redacted.totalHits}`,
    `sensitivityLevel=${decision.level}`,
    `sensitivityDecidedBy=${decision.decidedBy}`,
    `sensitivityHitCount=${decision.hitCount}`,
    `sensitivityRouteReason=${routeReasonSanitized}`,
    `detectors=${registry.list().map((d) => `${d.name}:${d.layer}`).join('|')}`,
    `l2Degraded=${pipeline.degraded.length > 0 ? pipeline.degraded.map((d) => `${d.detector}：${d.reason}`).join('|') : 'none'}`,
    `glossaryNarrowed=${
      droppedShort.length > 0 || asciiWordBoundary.length > 0
        ? `droppedShort:${droppedShort.length};asciiWordBoundary:${asciiWordBoundary.length}`
        : 'none'
    }`,
    `glossaryNarrowedMiss=${missed.length > 0 ? missed.map((m) => `${m.category}@${m.tag}`).join('|') : 'none'}`,
  ];
  if (l2PrefetchError) evidence.push(`l2DegradedReason=${l2PrefetchError}`);

  return {
    text: redacted.text,
    redactHits: redacted.totalHits,
    decision,
    routeReasonSanitized,
    degraded: pipeline.degraded,
    ...(l2PrefetchError ? { l2PrefetchError } : {}),
    detectors: registry.list(),
    glossaryNarrowed,
    evidence,
  };
}

/**
 * 灰度分流接线（T9——canary hash 稳定分流 + 劣化回退编排）。
 *
 * ⚠️ 判定本体 `canaryRouteRequest` / `runCanaryCheck` 内部实现一行未改。
 * 与检测管线分列的原因：session 上行按字段逐次过检测管线，若分流内联在
 * 检测管线里，一次推送会重复触发 `runCanaryCheck`（劣化回退被重复执行）。
 *
 * @param args.routeKey 分流键（设备上行 = deviceId；session 上行 =
 *        sessionId——同键恒定同臂，防同会话在两臂间抖动）
 */
export async function resolveUpstreamCanaryRoute(args: {
  routeKey: string;
  dataDir: string;
  opts?: UpstreamCanaryOptions;
}): Promise<UpstreamCanaryResult> {
  const config = args.opts?.canary ?? loadWeightCanaryConfig(args.dataDir);
  if (!config) return { evidence: [] };

  const canary = canaryRouteRequest(args.routeKey, config);
  const routeReason =
    `canary hash 稳定分流（分流键 ${args.routeKey} → 臂 ${canary.adapter}）——` +
    `${canary.isNew ? '命中灰度新权重' : '维持生产旧权重'}，新权重流量 ${config.newWeightPercent}%，同键恒定同臂`;

  const evidence: string[] = [
    `canaryAdapter=${canary.adapter}`,
    `canaryIsNew=${canary.isNew}`,
    `canaryRouteReason=${routeReason}`,
  ];

  // 劣化判定 + 回退编排（注入两臂指标时执行；未注入 = 不判不扰）
  let rollback: RollbackOutcome | undefined;
  if (args.opts?.metrics) {
    rollback = await runCanaryCheck(config, args.opts.metrics.old, args.opts.metrics.new, {
      ...(args.opts.rollbackWeights ? { rollbackWeights: args.opts.rollbackWeights } : {}),
      ...(args.opts.hmacKey ? { hmacKey: args.opts.hmacKey } : {}),
    });
    evidence.push(
      `canaryRollback=rolledBack:${rollback.rolledBack};rollbackOk:${rollback.rollbackOk};message:${rollback.message}`,
    );
    if (rollback.auditSignature) evidence.push(`canaryRollbackSig=${rollback.auditSignature}`);
  }

  return { canary, routeReason, ...(rollback ? { rollback } : {}), evidence };
}

/**
 * 数据上行（G11）。
 *
 * @param args.identity 设备身份码（过 gateDevice 闸门）
 * @param args.category 数据类别（采集声明内的 category）
 * @param args.payload 上行内容（明文——入队前脱敏 + 加密）
 * @param args.destination 目的地（与声明核对）
 * @param args.transport 传输回调（缺省只入队不发送）
 * @param args.wiring 三层检测插槽 / 灰度分流接线选项（缺省从配置面解析——
 *        非必填：MCP 入参面不变，装配侧可注入 L2 端点 / 灰度配置覆盖）
 */
export async function deviceDataPush(args: {
  identity: Record<string, unknown>;
  category: string;
  payload: string;
  destination?: string;
  transport?: UploadTransport;
  wiring?: UpstreamWiringOptions;
}): Promise<DeviceDataPushResult> {
  // ── 参数校验 ──
  if (!args.identity || typeof args.identity !== 'object') {
    return {
      text: '[sofagent] 数据上行失败：参数缺失（identity）',
      data: { isError: true, ok: false, reason: 'invalid-params', message: '参数缺失（identity）', auditLogged: false },
    };
  }
  if (!args.category || typeof args.category !== 'string' || typeof args.payload !== 'string') {
    return {
      text: '[sofagent] 数据上行失败：参数缺失（category / payload）',
      data: { isError: true, ok: false, reason: 'invalid-params', message: '参数缺失（category / payload）', auditLogged: false },
    };
  }

  // ── 1. 设备门禁 ──
  let gate: { ok: boolean; reason?: string; message: string; record?: { identity: { agentId: string } } };
  try {
    const daemon = (await import('@sofagent/daemon')) as Record<string, unknown>;
    const fn = daemon.gateDevice;
    if (typeof fn !== 'function') throw new Error('gateDevice 不可用');
    gate = fn(args.identity as never, undefined) as typeof gate;
  } catch {
    return {
      text: '[sofagent] 数据上行失败：@sofagent/daemon 未安装或不可用',
      data: { isError: true, ok: false, reason: 'daemon-unavailable', message: '@sofagent/daemon 未安装或不可用', auditLogged: false },
    };
  }
  if (!gate.ok) {
    return {
      text: `[sofagent] 数据上行拒绝：${gate.message}`,
      data: { isError: true, ok: false, reason: gate.reason as DeviceDataPushResult['data']['reason'], message: gate.message, auditLogged: false },
    };
  }
  const deviceId = gate.record!.identity.agentId;

  // ── 2. 采集声明判定 ──
  const auth = authorizeDeviceUpload(deviceId, args.category, {
    ...(args.destination ? { destination: args.destination } : {}),
  });
  if (!auth.ok) {
    return {
      text: `[sofagent] 数据上行拒绝：${auth.message}`,
      data: { isError: true, ok: false, reason: auth.reason, message: auth.message, auditLogged: false },
    };
  }

  // ── 3. 三层敏感检测插槽 + 脱敏（v1.5.1 第六章接线——判定本体零改动）──
  // L0 正则 → L1 词典 → L2 外挂 NER 逐层降漏；命中项走既有脱敏管线
  // （redact(detectorRegistry)）后入队——原始敏感值不出设备。
  const dataDir = getDataDir(undefined);
  const rules = loadRedactRules(dataDir);
  const pipeline = await runUpstreamSensitivityPipeline({
    text: args.payload,
    rules,
    dataDir,
    ...(args.wiring ? { opts: args.wiring } : {}),
  });
  const redacted = { text: pipeline.text, totalHits: pipeline.redactHits };

  // ── 3b. 灰度分流（T9——上行采样数据经 canary hash 稳定分流）──
  // 分流键 = 设备标识（同设备恒定同臂——对齐 weight-canary「同键不抖动」语义）
  const canaryRoute = await resolveUpstreamCanaryRoute({
    routeKey: `device:${deviceId}`,
    dataDir,
    ...(args.wiring ? { opts: args.wiring } : {}),
  });

  // ── 4. 加密入队（WAL 暂存——AES-256-GCM，明文不落盘）──
  let wal: {
    enqueueUpload: (deviceId: string, category: string, payload: string, opts?: Record<string, unknown>) => { ok: boolean; seq?: number; reason?: string; message: string };
    pendingUploads: () => Array<{ seq: number; deviceId: string; category: string; destination?: string; ciphertext: string; iv: string; tag: string }>;
    ackUpload: (ackedSeq: number, opts?: Record<string, unknown>) => { ok: boolean; message: string };
    failUpload: (seq: number, reason: string, opts?: Record<string, unknown>) => void;
  };
  try {
    wal = (await import('@sofagent/daemon')) as unknown as typeof wal;
    if (typeof wal.enqueueUpload !== 'function') throw new Error('upload-wal 面不可用');
  } catch {
    return {
      text: '[sofagent] 数据上行失败：upload-wal 面不可用（@sofagent/daemon）',
      data: { isError: true, ok: false, reason: 'daemon-unavailable', message: 'upload-wal 面不可用（@sofagent/daemon）', auditLogged: false },
    };
  }
  const enq = wal.enqueueUpload(deviceId, args.category, redacted.text, {
    redactHits: redacted.totalHits,
    ...(args.destination ? { destination: args.destination } : {}),
  });
  if (!enq.ok) {
    return {
      text: `[sofagent] 数据上行失败：${enq.message}`,
      data: { isError: true, ok: false, reason: enq.reason as DeviceDataPushResult['data']['reason'], message: enq.message, auditLogged: false },
    };
  }

  // ── 5. 传输（注入回调——缺省只入队）──
  let delivery: 'sent' | 'queued' | 'partial' = 'queued';
  let lastAcked = 0;
  if (args.transport) {
    const pending = wal.pendingUploads();
    let sent = 0;
    for (const entry of pending) {
      const delivered = args.transport(entry);
      if (delivered) {
        lastAcked = Math.max(lastAcked, entry.seq);
        sent += 1;
      } else {
        wal.failUpload(entry.seq, '传输回调未送达', { deviceId });
      }
    }
    if (sent > 0 && sent === pending.length) {
      wal.ackUpload(lastAcked, { deviceId });
      delivery = 'sent';
    } else if (sent > 0) {
      wal.ackUpload(lastAcked, { deviceId });
      delivery = 'partial';
    } else {
      delivery = 'queued';
    }
  }

  // ── 6. 审计 + 计量 ──
  let auditLogged = false;
  try {
    const { emitDecision } = await import('@sofagent/audit');
    emitDecision({
      agentId: `device-${deviceId.slice(0, 8)}`,
      sessionId: `device-data-push-${Date.now()}`,
      kind: 'ARTIFACT_EDIT',
      moment: 'ACT',
      category: 'select',
      why: `device_data_push 上行 ${args.category}（${Buffer.byteLength(args.payload, 'utf-8')}B → 脱敏 ${redacted.totalHits} 处 → 加密入队 seq=${enq.seq}，delivery=${delivery}）——依据声明 ${auth.declaration!.category}；敏感档 ${pipeline.decision.level}（${pipeline.routeReasonSanitized}）${canaryRoute.routeReason ? `；${canaryRoute.routeReason}` : ''}`,
      artifactRef: `device-upload/${deviceId.slice(0, 8)}/${args.category}`,
      evidence: [
        `category=${args.category}`,
        `payloadBytes=${Buffer.byteLength(args.payload, 'utf-8')}`,
        ...pipeline.evidence,
        ...canaryRoute.evidence,
        `seq=${enq.seq}`,
        `delivery=${delivery}`,
        `pending=${wal.pendingUploads().length}`,
      ],
    });
    auditLogged = true;
  } catch {
    auditLogged = false; // best-effort 显式标注
  }

  const pendingNow = wal.pendingUploads().length;
  return {
    text: `[sofagent] ✅ 数据上行入队（${args.category} · seq=${enq.seq} · 脱敏 ${redacted.totalHits} 处 · ${delivery === 'sent' ? '已送达' : delivery === 'partial' ? '部分送达' : '暂存待传'}）`,
    data: {
      isError: false,
      ok: true,
      message: `已入队（seq=${enq.seq}，${delivery}）`,
      seq: enq.seq,
      delivery,
      pending: pendingNow,
      auditLogged,
    },
  };
}
