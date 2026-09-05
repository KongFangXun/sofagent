// ============================================================
// audit-history.ts · 审计历史持久化
// v1.4.4 env fingerprint: hash chain 加环境指纹防 Agent 重算整链
// ============================================================
//
// ⚠️ 双副本说明（勿混淆）：本仓库有两份同名 audit-history.ts，职责不同、**不可合并**：
//   - 【本文件】engine/audit/src/audit-history.ts —— 业务「审计历史持久化」层。
//     提供 AuditHistoryEntry 类型 + appendHistory/loadHistory/clearHistory/
//     isHmacKeyConfigured，依赖 audit 域的规则结果类型与 sanitize 管道；
//     并 re-export core 的哈希链原语（见下方 import/export）。
//   - engine/core/src/audit-history.ts —— 底层「哈希链完整性」原语层（零上层依赖）：
//     getHistoryFilePath / getEnvFingerprint / getHmacKey / stableStringify /
//     checkHistoryChainDetailed / checkHistoryChainIntegrity / validateHmacKey。
//   依赖方向单向：audit → core（core 绝不反向依赖 audit）。业务持久化含 audit 规则
//   结果域类型，不能下沉到 core 底座（会违反 core「零上层依赖」分层契约），故保持两份。
//
// 并发安全说明（v1.3.8 后实态）：appendHistory 已走 atomicAppendSync（@sofagent/core
// SSOT 原语，内置文件锁互斥），早于 v1.3.2 时代「appendFileSync 无文件锁/可能行交错」
// 的旧限制已在写路径收口（见下方 appendHistory 实现与 LIMITATIONS 并发写入披露）。
// v1.3.1 #44 披露的并发写风险：WAL 写在网关层单 writer 模式消除（详见 docs/LIMITATIONS.md）。
// daemon 文件监控 + Agent commit 并发写 history.jsonl 的历史担忧已由上述两层解决。
//
// 每次 sofagent-audit 运行后，把结果追加到
// ${SOFAGENT_DATA}/audit/history.jsonl（JSONL 格式；v1.2.2 起默认 data/audit/history.jsonl）。
// 用于根因分析（audit-root-cause）和回归验证（audit-regression）。
//
// JSONL 格式：每行一个 JSON 对象，\n 分隔。
// 最小运行时依赖：仅 js-yaml（YAML 配置解析），其余用 Node.js 内置模块。
//
// v1.0.6 安全加固：hash chain 加入环境指纹（hostname+username+git 路径）。
// Agent 重算整链时如果不含指纹，--doctor 校验会不一致。旧格式（无 hashVersion）
// 向后兼容——不做指纹校验，只做链完整性校验。
// ============================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, statSync } from 'fs';
import { dirname } from 'path';
import { createHash, createHmac } from 'crypto';
import { loadEnvConfig, resolveHomeDir } from '@sofagent/core';
import { atomicAppendSync, atomicWriteSync } from '@sofagent/core';
import { REDACTION_PATTERNS } from '@sofagent/core';
// v1.3.8 交付二：数据静态加密（age 纯 TS + 密钥管理，均来自 @sofagent/core）
import {
  encryptWithAge,
  decryptWithAge,
  isAgePayload,
  loadDataKey,
  isInitialized,
  keysDirPath,
  DATA_KEY_RECOVERY_HINT,
} from '@sofagent/core';
import type { RuleCheck, ActionGovernance } from './rules/types';

// v1.2.0: checkHistoryChainIntegrity + helpers sunk to core;
// import for internal use (appendHistory/loadHistory/clearHistory still need them),
// re-export for external backward compat.
import { getHistoryFilePath, getEnvFingerprint, getHmacKey, stableStringify, validateHmacKey } from '@sofagent/core';
export { checkHistoryChainIntegrity, checkHistoryChainDetailed, getHistoryFilePath, getHmacKey, validateHmacKey } from '@sofagent/core';

/**
 * 对 ruleResult 做脱敏处理——避免审计工具自身成为第二泄漏点。
 * A2（密钥泄漏，number=2）和 A9（prompt injection，number=9）的 details
 * 移除命中行原文，替换为脱敏占位文本。
 * 只在规则真正命中（details 非空）时覆写——此前无条件覆写导致
 *   干净提交也被标"检测到密钥泄漏"（1589 条假告警，SIEM 噪声 100%）。
 */
function sanitizeRuleResult(rule: RuleCheck): RuleCheck {
  if (rule.details.length === 0) return rule; // 未命中 → 原样保留（不写假告警）
  if (rule.number === 2) {
    return {
      ...rule,
      details: [`检测到密钥泄漏（命中行已脱敏）`],
    };
  }
  if (rule.number === 9) {
    return {
      ...rule,
      details: rule.details.map(() => `检测到 prompt injection 模式（命中行已脱敏）`),
    };
  }
  return rule;
}

/**
 * 对自由文本字段（commitMsg/task）做脱敏——
 * 此前 sanitize 只覆盖 ruleResults，message 里密钥全文落盘 history.jsonl，
 * 审计工具自身成为第二泄漏点。用 @sofagent/core 的 REDACTION_PATTERNS
 * （与 A9 sanitizeDetailLine 同一套脱敏正则，单一事实源）。
 *
 * audit.md（audit-log.ts）落盘路径同样接此函数——审计双持久化路径
 * （history.jsonl + audit.md）必须同口径脱敏，不能一岸有堤一岸裸奔。
 */
export function sanitizeFreeText(text: string | undefined): string | undefined {
  if (!text) return text;
  let cleaned = text;
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    cleaned = cleaned.replace(pattern, replacement);
  }
  return cleaned;
}

/**
 * 深度脱敏自由文本（S2 写入字段脱敏策略强制声明的运行时守卫）。
 *
 * 背景：baseSanitized 的 ...entry 展开只显式处理顶层 commitMsg/task 与
 * ruleResults——嵌套对象（如 actionGovernance.context）不在展开面内，
 * 「新字段裸奔」曾是 P0-2 的同类根因（beforeAfter 已在构建侧修，context
 * 依赖本函数兜底）。策略：递归遍历 entry 全部字符串叶子，凡命中
 * REDACTION_PATTERNS 的即脱敏——白名单跳过结构化/签名/链字段（脱敏会
 * 破坏验签或篡改语义）。这是兜底层，字段级显式声明（types.ts 注释）
 * 仍是第一防线；两层叠加把「先脱敏再签名」从纪律变成机制。
 *
 * 白名单原则：只豁免「值不可能含用户自由文本」的字段——
 *   - hmacSig/envFingerprint/prevHash/hashVersion/hmacAlgo/chainStatus：
 *     签名与链字段，脱敏即破坏验签语义（它们本就不含明文敏感面）；
 *   - timestamp/diffRange/exitCode/diffFileCount/engine/commitSha/parentSha/
 *     commitPhase/agentId：结构化枚举值（SANITIZE N/A）。
 * 其余字符串叶子（含未来新增字段）一律过管道——新字段未声明策略时
 * 默认按自由文本处理（fail-safe），命中即脱敏并计数。
 */
const SANITIZE_EXEMPT_KEYS = new Set<string>([
  // 签名/链字段——脱敏破坏验签或链语义
  'hmacSig', 'envFingerprint', 'prevHash', 'hashVersion', 'hmacAlgo', 'chainStatus',
  // 结构化枚举值——不含自由文本
  'timestamp', 'diffRange', 'exitCode', 'diffFileCount', 'engine', 'commitSha',
  'parentSha', 'commitPhase', 'agentId',
]);

/** 深扫脱敏：递归处理对象/数组中的字符串叶子，返回 [处理后对象, 命中次数] */
function deepSanitizeFreeText(node: unknown, hitsRef: { count: number }): unknown {
  if (typeof node === 'string') {
    const cleaned = sanitizeFreeText(node);
    if (cleaned !== node) hitsRef.count++;
    return cleaned;
  }
  if (Array.isArray(node)) return node.map((item) => deepSanitizeFreeText(item, hitsRef));
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      // 豁免只对「字符串叶子」有意义且须值形可证（shouldExempt）——对象/数组值
      // 不论其 key 是否碰白名单同名，一律继续递归（防「嵌套结构字段同名却持自由文本」）。
      out[key] = typeof value === 'string' && shouldExempt(key, value)
        ? value
        : deepSanitizeFreeText(value, hitsRef);
    }
    return out;
  }
  return node;
}

/**
 * 豁免判定收窄为「值维」（path 维静态度不可得，读侧无 schema——递归时只拿到 key×value，
 * 无运行时可校验的记录 schema）。
 *
 * 漏洞形态 (P1)：SANITIZE_EXEMPT_KEYS 用裸 key 名在每一层递归里整键豁免——若某嵌套
 * 对象的字段恰好与白名单同名（engine/agentId 这些通用短词）却持 secret/自由文本，
 * 整棵子树被跳过深扫 → 明文被 HMAC 固化。真正要豁免的只是「值确为结构化/短码」的叶子：
 *   - 非字符串值本就不被字符串脱敏触碰，白名单外也一样递归处理（无泄漏面，恒安全）；
 *   - 字符串值仅在「是紧致短码 + 经 sanitizeFreeText 无操作」时才豁免——真实
 *     hmacSig/prevHash/commitSha/envFingerprint 等为紧凑 hex/枚举，脱敏是无操作，
 *     豁免仅为免去伪命中计数噪声（不损验签：见 deepSanitizeFreeText 头注释）；
 *   - 含空白（句子/折行）、或超长（sk-/AKIA…/长段落）、或可真命中 REDACTION 任一
 *     模式的串——即使裸 key 同名也不豁免，走正常脱敏分支被自动打码。
 */
function shouldExempt(key: string, value: string): boolean {
  if (!SANITIZE_EXEMPT_KEYS.has(key)) return false;
  if (/\s/.test(value)) return false; // 含空白 = 自由文本形态 → 不豁免
  if (value.length > 64) return false; // 超长 = code 面不可能（secret token 常无空白）→ 不豁免
  // 紧致短码还需确认不会可真命中脱敏（对真实 hex/enum 是 no-op，豁免只省一次计数器）
  return sanitizeFreeText(value) === value;
}

/**
 * 单条审计历史记录
 */
export interface AuditHistoryEntry {
  /** ISO 8601 时间戳 */
  timestamp: string;
  /** git diff 范围，如 "HEAD~1..HEAD" */
  diffRange: string;
  /** --task 参数传入的任务描述 */
  task?: string;
  /** 退出码：0=PASS / 1=WARN / 2=FAIL */
  exitCode: number;
  /** 每条规则的判定结果 */
  ruleResults: RuleCheck[];
  /** 变更文件数 */
  diffFileCount: number;
  /** commit message */
  commitMsg?: string;
  /** 前一条记录的 hash，用于链完整性验证 */
  prevHash?: string;
  /** 本次审计对应的 commit SHA（doctor #8 追溯用） */
  commitSha?: string;
  /**
   * v1.2.9 commit-msg hook 场景（commit 对象尚未生成）记录的父提交 SHA
   * （= 审计运行时的 HEAD）。--verify-commit 精确 commitSha 未命中时，
   * 对 commitPhase='pre-commit' 的记录按 parentSha fallback 匹配。
   * 旧记录无此字段时 fallback 不生效（向后兼容）。
   */
  parentSha?: string;
  /**
   * v1.2.9 审计所处阶段标记。'pre-commit' = commit-msg hook 场景
   * （审计在 commit 对象生成前运行，commitSha 未知，仅记 parentSha）。
   * 手动 --diff <range> 场景无此字段（保持旧语义）。
   */
  commitPhase?: 'pre-commit';
  /**
   * D-5 (v1.4.4)：链状态显式标记。'broken' = 本条 prevHash 取 'unknown'
   * （上一行解密/JSON 解析失败）——写入不阻断（审计可用性优先），但读侧/
   * 下游消费方可据此优先展示链断裂，不再依赖对 prevHash 字面值的隐式判断。
   */
  chainStatus?: 'broken';
  /** hash 算法版本：1 = 无指纹（v1.0.5 及以前），2 = 环境指纹（v1.0.6+） */
  hashVersion?: number;
  /** v1.1.8+: HMAC-SHA256 签名（密钥来自 ~/.sofagent-key，chmod 600）。无密钥时缺省（降级 SHA-256，向后兼容）。用于强防篡改。 */
  hmacSig?: string;
  /** v1.2.5 写入时记录的环境指纹——读侧 HMAC 不匹配时用它区分「真篡改（指纹一致）」与「环境漂移（指纹不一致）」 */
  envFingerprint?: string;
  /** v1.1.3+: 审计引擎标识，用于追溯记录来源 */
  engine?: string;
  /**
   * v1.3.1 交付 6: 审计记录关联的 Agent 身份码（AgentIdentity.agentId）。
   * 可选字段——旧记录无此字段时读侧/验链侧全部向后兼容
   *（HMAC 链校验只依赖链字段，新增业务字段天然兼容，先脱敏再签名语义不变）。
   */
  agentId?: string;
  /** Action Governance 审计 5 字段 schema + 决策溯源组（A4 研读落地）。可选项——旧记录无此字段时向后兼容。 */
  actionGovernance?: ActionGovernance;
}

/** 是否已配置 HMAC 密钥（供 --doctor 提示完整性校验强度用） */
export function isHmacKeyConfigured(): boolean {
  return getHmacKey() !== null;
}

// ────────────────────────────────────────────
// v1.3.8 交付二：静态加密挂点（age 纯 TS）
//
// 语义：密钥存在且初始化完成 → 落盘前整行加密；读侧按前缀识别解密，
// 明文旧行（无 SOFAGENT-AGE-V1 前缀）按原逻辑解析（向后兼容）。
// 无密钥（未初始化）→ 完全走旧明文路径（现有行为零破坏）。
//
// 加密范围（本版）：data/audit/ 主链（本文件）。
// 后续接线点（暂不挂——避免一次改四个包爆回归面）：
//   · data/forge-runs/（FORGE 审查运行数据）
//   · data/checkpoint/（graph checkpoint——见 orchestrator durable/checkpoint-manager.ts）
//   · data/model-registry/（模型注册表——含内部 endpoint 地址，见 orchestrator model-registry.ts）
// ────────────────────────────────────────────

/** 解析 SOFAGENT_HOME（收敛到 core resolveHomeDir——单一事实源；v1.3.9 十四消灭 ~/.sofagent 字面直拼） */
function resolveSofagentHome(): string {
  return resolveHomeDir();
}

/**
 * 数据加密是否激活：密钥存在 + initialized 标记存在。
 * 任一缺失都按「未启用」处理（明文路径）——半初始化状态不加密，
 * 防止「密钥丢失但标记还在」导致写入全部失败的死局。
 */
function isDataEncryptionActive(): boolean {
  const home = resolveSofagentHome();
  // 半初始化状态不加密——防止「密钥丢失但标记还在」导致写入全部失败的死局
  if (!isInitialized(home)) return false;
  return loadDataKey(home) !== null;
}

/** 取激活态密钥（isDataEncryptionActive() === true 时调用必有值） */
function getActiveDataKey(): Buffer {
  const key = loadDataKey(resolveSofagentHome());
  if (key === null) {
    throw new Error(`数据加密密钥读取失败：${keysDirPath(resolveSofagentHome())}/data.key`);
  }
  return key;
}

/**
 * 追加一条审计记录到历史文件
 * 文件不存在时自动创建目录和文件
 * @param entry 审计历史条目
 * @param dataDir 可选的数据目录覆盖（用于测试）
 */
export function appendHistory(entry: AuditHistoryEntry, dataDir?: string): void {
  const filePath = getHistoryFilePath(dataDir);
  const dir = dirname(filePath);
  const fileExists = existsSync(filePath);

  if (!existsSync(dir)) {
    // 权限收紧为 0o700（仅当前用户可读写），防止同机其他用户读取审计日志
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  // v1.0.6: 加入环境指纹——Agent 重算整链时不包含指纹则校验不一致
  const fingerprint = getEnvFingerprint(dataDir);

  // 计算 prevHash（上一行的 hash）
  let prevHash = 'genesis';
  // D-5 (v1.4.4)：链断裂标记——prevHash 落 'unknown' 时置 true，写入条目带 chainStatus
  let chainBroken = false;
  if (existsSync(filePath)) {
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
    if (lines.length > 0) {
      const lastLine = lines[lines.length - 1]!;
      try {
        // v1.3.8 交付二：上一行可能是 age 加密行——先按前缀解密再参与链计算
        //（链基于明文记录内容，加密不改变链语义；解密失败走 JSON 解析失败同路径 prevHash='unknown'）
        const lastPlain = isAgePayload(lastLine)
          ? decryptWithAge(lastLine, getActiveDataKey())
          : lastLine;
        const lastEntry = JSON.parse(lastPlain);
        const lastRecordForHash = { ...lastEntry, prevHash: undefined, hashVersion: undefined };
        prevHash = createHash('sha256')
          .update(JSON.stringify(lastRecordForHash) + '|' + fingerprint)
          .digest('hex').slice(0, 16);
      } catch (e) {
        console.error(`[sofagent] 审计历史 JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`);
        prevHash = 'unknown';
        // D-5 (v1.4.4)：链断裂显式化——① baseSanitized 落盘时带 chainStatus:'broken'
        // 标记（读侧/下游优先展示，见 AuditHistoryEntry.chainStatus 注释）；
        // ② 连续 ≥2 条 unknown 升级 console.warn（首条 console.error 已提示）。
        // 设计红线：不阻断写入——审计写入被阻断比链断更危险（fail-open 取舍见 LIMITATIONS）。
        chainBroken = true;
        // 连续断裂探测：倒数第二行若也是 broken/unknown，说明链问题非单次抖动
        try {
          if (lines.length > 1) {
            const prevLine = isAgePayload(lines[lines.length - 2]!)
              ? decryptWithAge(lines[lines.length - 2]!, getActiveDataKey())
              : lines[lines.length - 2]!;
            const prevEntry = JSON.parse(prevLine);
            if (prevEntry.chainStatus === 'broken' || prevEntry.prevHash === 'unknown') {
              console.warn('⚠️ [sofagent] 审计历史链连续断裂（≥2 条 unknown）——上一条记录已是断裂态，请检查 history.jsonl 完整性（--doctor 可跑链校验）');
            }
          }
        } catch {
          // 倒数第二行也解不开——本身就是「连续断裂」的证据
          console.warn('⚠️ [sofagent] 审计历史链连续断裂（≥2 条 unknown）——请检查 history.jsonl 完整性（--doctor 可跑链校验）');
        }
      }
    }
  }

  // v1.1.8: HMAC-SHA256 签名（密钥来自 ~/.sofagent-key，chmod 600）。
  // 有密钥时签名整条记录（防 Agent 重算整链）；无密钥时降级 SHA-256（不写 hmacSig，向后兼容）。
  // 修复（含回归修复）：必须先脱敏再签名——HMAC 基于【已脱敏的 baseSanitized】计算，
  // 而非原始 entry.ruleResults。原因：落盘记录经过 sanitizeRuleResult()，它对 A2(number=2)/A9(number=9)
  // 的 details 强制脱敏覆盖；读侧 checkHistoryChainIntegrity 校验的正是「脱敏后」记录。若写侧用 raw
  // ruleResults 签名，含 A2/A9 的条目 HMAC 永远与读侧不匹配，被 hmacAlgo:'stable' 判为篡改 →
  // 干净链误报链断裂（run-09 回归 false-positive）。先脱敏再签名后，写/读两侧 HMAC 输入完全一致。
  const hmacKey = getHmacKey();

  // HMAC 密钥强度校验——弱密钥（空 / <16 字节）时明确告警，
  // 不静默用弱密钥签名稀释强校验能力。仍照常签名（优于无密钥），但醒目提示。
  const keyStatus = validateHmacKey();
  if (keyStatus.configured && !keyStatus.strong) {
    console.warn(`⚠️ HMAC 密钥强度不足（${keyStatus.reason ?? ''}）——仍使用弱密钥签名审计日志，建议重新生成 ≥16 字节强密钥（如：openssl rand -hex 32 > ~/.sofagent-key && chmod 600 ~/.sofagent-key）`);
  }

  const baseSanitized = {
    ...entry,
    prevHash,
    hashVersion: 2,
    // D-5 (v1.4.4)：链断裂显式标记——读侧按此字段优先展示（黄→更显眼），
    // 不再依赖对 prevHash='unknown' 字面值的隐式判断
    chainStatus: chainBroken ? 'broken' : undefined,
    // (2026-08-02 复核修正): 记录写入时的环境指纹——读侧 HMAC 不匹配时
    // 用它区分「真篡改（指纹一致）」与「环境漂移（指纹不一致）」。
    envFingerprint: fingerprint,
    // 标记写入侧用 stableStringify 签名（新条目）。读侧据此区分
    // 「旧条目 key 顺序不可复现（HMAC 不匹配不判篡改）」与「新条目被篡改（判链断裂）」。
    hmacAlgo: hmacKey ? 'stable' : undefined,
    ruleResults: entry.ruleResults.map(sanitizeRuleResult),
    // v1.3.8 P1-A1：commitMsg/task 为自由文本（用户输入），密钥可能混入——
    // 与 ruleResults 同等对待，写盘前用 REDACTION_PATTERNS 脱敏（在签名之前，
    // 与「先脱敏再签名」既有原则一致——读侧验签的就是脱敏后文本）。
    commitMsg: sanitizeFreeText(entry.commitMsg),
    task: sanitizeFreeText(entry.task),
  };

  // S2 写入字段脱敏策略强制声明——运行时兜底守卫（v1.4.5）：
  // baseSanitized 显式面只覆盖 ruleResults/commitMsg/task，嵌套对象
  //（actionGovernance.context 等）靠这一层深扫兜底。签名输入 = 深扫后
  // 的记录（「先脱敏再签名」语义延伸到嵌套面）；命中计数 >0 说明有
  // 字段携带了可脱敏内容——字段级声明（types.ts 🔐 注释）漏了，打 WARN
  // 提示补声明（不阻断写入，与链断裂同取舍：审计可用性优先）。
  const deepHits = { count: 0 };
  const deepSanitized = deepSanitizeFreeText(baseSanitized, deepHits) as typeof baseSanitized;
  if (deepHits.count > 0) {
    console.warn(
      `⚠️ [sofagent] appendHistory 深扫脱敏命中 ${deepHits.count} 处（嵌套字段携带可脱敏内容已自动打码）——` +
      `该字段类型面缺 🔐 脱敏策略声明，请在 AuditHistoryEntry/ActionGovernance（rules/types.ts）补声明`
    );
  }

  // 签名输入排除 prevHash/hashVersion/hmacSig/hmacAlgo（与读侧 recordForSig 一致）；
  // 用 stableStringify（递归按 key 字典序排序）消除 key 顺序敏感。
  const recordForSig = { ...deepSanitized, prevHash: undefined, hashVersion: undefined, hmacSig: undefined, hmacAlgo: undefined };
  // HMAC-SHA256 完整输出 64 hex（256bit），此处 .slice(0, 32) 截断到 128bit。
  // 截断理由：① 每条 history.jsonl 记录都存 hmacSig，截断省约一半存储空间；
  // ② 128bit 防篡改强度充分（伪造需 2^128 次尝试，远超可行算力）；
  // ③ 写侧（此处）与读侧（core/audit-history.ts recordForSig 验签）必须用**同一**
  //    截断长度，否则验签恒不匹配——两侧统一 slice(0, 32)。
  const hmacSig = hmacKey
    ? createHmac('sha256', hmacKey).update(stableStringify(recordForSig) + '|' + fingerprint).digest('hex').slice(0, 32)
    : undefined;

  const sanitizedEntry = { ...deepSanitized, hmacSig: hmacSig ?? undefined };
  // v1.0.5: 使用原子追加（先读+追加+原子写），避免并发写入导致的行交错
  // v1.2.5 atomicAppendSync 已内置文件锁互斥（O_EXCL + 过期回收），
  //   读-改-写跨进程串行化——不再需要 busy-wait 重试循环（原 189-206 行已移除）。
  // v1.3.8 交付二：静态加密挂点——密钥激活时整行加密后 append（落盘无明文）；
  // 无密钥按旧明文路径（现有行为零破坏）。prevHash 链计算在内存中完成
  //（基于上一行解密后的内容），链语义与加密前完全一致。
  const jsonLine = isDataEncryptionActive()
    ? encryptWithAge(JSON.stringify(sanitizedEntry), getActiveDataKey())
    : JSON.stringify(sanitizedEntry);
  atomicAppendSync(filePath, jsonLine);
  // 单次读回校验（best-effort——锁已保证互斥，最后一行必然完整；校验失败仅告警）
  // v1.3.9 修复：加密激活态最后一行是 SOFAGENT-AGE-V1 密文，直接 JSON.parse 必抛异常
  // → 每次写入都假警「读回校验失败」，且校验对象是密文而非明文（校验失效）。
  // 现检测前缀 → 复用同文件 decryptWithAge 先解密再 JSON.parse，读回校验真实校验明文。
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    if (lines.length > 0) {
      const lastLine = lines[lines.length - 1]!;
      const lastPlain = isAgePayload(lastLine)
        ? decryptWithAge(lastLine, getActiveDataKey())
        : lastLine;
      JSON.parse(lastPlain);
    }
  } catch {
    console.warn('[sofagent] 审计历史最后一行读回校验失败（请检查 history.jsonl 完整性）');
  }

  // P1-B1: 每次写入后确保文件权限为 0o600（不仅首次创建时收紧）
  // 此前只在 !fileExists 时 chmodSync，后续追加写入不校验权限——
  // 如果文件被外部改为 644（如手动 chmod / 恢复备份），权限会保持 644 不收紧。
  // 每次 appendHistory 后都 chmodSync(filePath, 0o600) 确保权限恒为 0600。
  // D-5 (v1.4.4)：chmod 失败读回 statSync 验证实际权限——实际 ≤0o600 放行
  // （false alarm，如 chmod 不支持但 umask 已保证收紧），实际 >0o600 输出
  // 显式安全告警（含修复命令）。不阻断写入（设计红线：审计可用性优先）。
  try {
    chmodSync(filePath, 0o600);
  } catch (e) {
    // 读回验证：chmod 抛错不代表权限真的宽——看 statSync 实态
    try {
      const actualMode = statSync(filePath).mode & 0o777;
      if (actualMode & 0o077) {
        // group/other 位有读或写——真实宽松权限，显式告警
        console.warn(
          `⚠️ [sofagent] 审计历史文件权限宽松（实际 ${actualMode.toString(8)}，应 600）且 chmod 失败：` +
          `${e instanceof Error ? e.message : String(e)}——审计数据以宽权限落盘，` +
          `请手动执行 chmod 600 ${filePath}`
        );
      }
      // 实际 ≤0o600：false alarm（chmod 语义受限但权限已收紧）——静默放行
    } catch {
      console.error(`[sofagent] 审计历史文件权限设置失败且无法读回验证: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/**
 * 加载审计历史
 * 读取 history.jsonl，返回按时间倒序的数组
 * @param limit 返回最近 N 条（默认 100）
 * @param dataDir 可选的数据目录覆盖（用于测试）
 */
export function loadHistory(limit?: number, dataDir?: string): AuditHistoryEntry[] {
  const maxLimit = limit ?? 100;
  const filePath = getHistoryFilePath(dataDir);

  if (!existsSync(filePath)) {
    return [];
  }

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (e) {
    console.error(`[sofagent] 审计历史文件读取失败: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }

  const entries: AuditHistoryEntry[] = [];
  const lines = content.split('\n');

  // v1.3.8 交付二：读侧透明解密。
  //  - SOFAGENT-AGE-V1 前缀行 → decryptWithAge（密钥激活时）
  //  - 无前缀行 → 明文旧格式，按原逻辑解析（向后兼容）
  //  - 密钥丢失但存在加密行 → 明确抛错（含恢复指引），不静默跳过
  //    （静默跳过会让用户误以为历史被清空，掩盖密钥事故）
  let sawAgeLine = false;
  // undefined = 未探测；探测后必非 null（null 分支直接 throw——密钥丢失报错在先）
  let keyCache: Buffer | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    let plainLine = trimmed;
    if (isAgePayload(trimmed)) {
      sawAgeLine = true;
      if (keyCache === undefined) {
        const key = loadDataKey(resolveSofagentHome());
        if (key === null) {
          throw new Error(
            `检测到加密审计记录但数据加密密钥不可用（${keysDirPath(resolveSofagentHome())}/data.key 缺失或非法）。` +
            `解密不可继续。${DATA_KEY_RECOVERY_HINT}`,
          );
        }
        keyCache = key;
      }
      plainLine = decryptWithAge(trimmed, keyCache); // 上方已保证非 null（null 分支已 throw）
    }

    try {
      const parsed = JSON.parse(plainLine) as AuditHistoryEntry;
      entries.push(parsed);
    } catch (e) {
      console.error(`[sofagent] 审计历史行解析失败（跳过${sawAgeLine ? '，前置加密行已解密' : ''}）: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 修复：过滤无 timestamp 的条目后再排序
  const validEntries = entries.filter(
    (e) => e && typeof e.timestamp === 'string' && e.timestamp.length > 0
  );
  validEntries.sort((a, b) => {
    return b.timestamp.localeCompare(a.timestamp);
  });

  return validEntries.slice(0, maxLimit);
}

/**
 * 清空审计历史文件（用于测试）
 * @param dataDir 可选的数据目录覆盖（用于测试）
 */
export function clearHistory(dataDir?: string): void {
  const filePath = getHistoryFilePath(dataDir);

  if (!existsSync(filePath)) {
    return;
  }

  writeFileSync(filePath, '', 'utf-8');
}
