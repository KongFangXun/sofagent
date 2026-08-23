// ============================================================
// gateway/gateway-audit.ts · 代理网关审计 JSONL 写入 + 脱敏
// v1.4.0 十三：从 proxy-gateway.ts 抽出（单一职责拆分）
// ============================================================
//
// 抽出原因：proxy-gateway.ts 504 行含判定链 + 审计 + HITL + 限速四块职责，
// v1.4.0 校准笔记已预警「下版网关系新功能前置条件 = 先拆 audit 出去」。
// 本模块只负责「审计条目的安全序列化 + append 落盘」；判定链编排仍留在
// proxy-gateway.ts（依赖方向单向：gateway → audit，绝不反向）。
//
// 审计：所有请求 + 判定 + 结果落 {dataDir}/gateway/audit.jsonl
//   （append-only JSONL，写入前密钥脱敏：sk-* / AKIA* / password= 等打码）
//
// 说明：`import type` 仅引用 proxy-gateway 的请求/风险类型（编译期擦除），
// 不产生运行时循环依赖——本模块运行时零依赖 proxy-gateway。
// ============================================================

import { appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

import type { ProxyRequest, ProxyRisk, ProxyDecision } from './proxy-gateway';

/** 审计条目（append-only JSONL 每行一条） */
export interface AuditEntry {
  ts: string;
  event: 'request' | 'hitl-resolve';
  agentId: string;
  decision?: ProxyDecision;
  reason?: string;
  risk?: ProxyRisk;
  /** hitl-resolve 事件关联的 checkpoint ID */
  checkpointId?: string;
  request?: ProxyRequest;
}

/** 审计文件相对路径：{dataDir}/gateway/audit.jsonl */
export const GATEWAY_AUDIT_REL = 'gateway/audit.jsonl';

/** 密钥打码正则（简单 regex——sk-* / AKIA* / password= 三族，覆盖常见泄漏面）
 *  ⚠️ 值字符类排除 " 与 \——打码作用于 JSON 序列化后的整行，吞掉结尾引号
 *     会破坏单行 JSON 结构（脱敏不能自己制造注入面——sanitize 的自反性要求）。 */
const SECRET_REDACT_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  { pattern: /sk-[a-zA-Z0-9_\-]{8,}/g, replacement: 'sk-***REDACTED***' },
  { pattern: /AKIA[0-9A-Z]{16}/g, replacement: 'AKIA***REDACTED***' },
  { pattern: /(password|passwd|pwd|secret|token)\s*[=:]\s*[^"\\\s,;]+/gi, replacement: '$1=***REDACTED***' },
];

/**
 * 审计安全序列化——防日志注入 + 密钥脱敏。
 *
 * 1. 先 JSON.stringify 成单行（天然转义 \n \r——注入的换行伪造不出新审计行）
 * 2. 再对整行做密钥打码（regex 替换）——打码发生在字符串层，
 *    序列化后的转义形态（如 \u0041）不逃逸打码
 */
export function sanitizeForAudit(value: unknown): string {
  let line = JSON.stringify(value) ?? 'null';
  for (const { pattern, replacement } of SECRET_REDACT_PATTERNS) {
    line = line.replace(pattern, replacement);
  }
  return line;
}

/**
 * 追加一条审计条目（sanitize + 建目录 + appendFileSync）。
 *
 * 容错策略：写入失败向上抛出——由调用方（proxy-gateway）决定 fail-closed
 * （置 integrity.ok=false 进入拒绝服务态）。本函数不吞错、不静默。
 *
 * @param auditFilePath 审计文件绝对路径（{dataDir}/gateway/audit.jsonl）
 * @param entry 审计条目
 */
export function appendAuditLine(auditFilePath: string, entry: AuditEntry): void {
  const line = sanitizeForAudit(entry);
  mkdirSync(dirname(auditFilePath), { recursive: true });
  appendFileSync(auditFilePath, line + '\n', 'utf-8');
}

/**
 * 组装审计文件绝对路径（供 proxy-gateway / 测试复用）。
 *
 * @param dataDir 网关数据目录
 */
export function resolveAuditFilePath(dataDir: string): string {
  return join(dataDir, GATEWAY_AUDIT_REL);
}
