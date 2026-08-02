// ============================================================
// shared/secret-patterns.ts · 密钥检测正则单一事实源
// v1.2.5 P1-27: A2（engine/audit rule-a2）与 ToolGate（engine/rules
//   tool-secret-leak）此前各持一份正则且漂移——ToolGate 用严格 48 位
//   sk- 模式导致 32-47 位密钥被放行，运行时洞与提交时洞错开互补。
//   现抽共享常量，两处 import 同一来源。
// ============================================================

/** 密钥泄漏检测正则模式（权威集——以 audit A2 的宽口径为准） */
export const SECRET_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /AKIA[A-Z0-9]{16}/, label: 'AWS Access Key' },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'Private Key' },
  { pattern: /sk-ant-(api03|api04)-[A-Za-z0-9_-]{40,}/, label: 'Anthropic API Key' },
  { pattern: /sk-proj-[a-zA-Z0-9_]{40,}/, label: 'OpenAI Project Key' },
  { pattern: /sk-svcacct-[a-zA-Z0-9_]{40,}/, label: 'OpenAI Service Account Key' },
  { pattern: /sk-admin-[a-zA-Z0-9_]{40,}/, label: 'OpenAI Admin Key' },
  // 通用 sk- key（48 位匹配 OpenAI，32-47 位匹配 DeepSeek 等短 key 厂商）——
  // ⚠️ 必须保持 32+ 宽口径，勿改回严格 48（P1-27 修复：ToolGate 曾放行 32-47 位）
  { pattern: /sk-[a-zA-Z0-9]{32,}/, label: 'Possible API Key (OpenAI/DeepSeek)' },
  { pattern: /gh[ps]_[A-Za-z0-9]{36}/, label: 'GitHub Token' },
];
