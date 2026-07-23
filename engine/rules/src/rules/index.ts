// ============================================================
// rules/index.ts · 默认规则注册表
// v1.2.0：P3 编排引擎内嵌——默认 tool 规则集合
// ============================================================

import type { ToolRule } from '../types';
import { toolSensitiveFile } from './tool-sensitive-file';
import { toolSecretLeak } from './tool-secret-leak';
import { toolInjection } from './tool-injection';

/**
 * 默认 tool 规则集合
 * 移植自 audit 的 A1（敏感文件）/ A2（密钥泄漏）/ A9（注入检测）
 */
export const defaultToolRules: ToolRule[] = [
  toolSensitiveFile,
  toolSecretLeak,
  toolInjection,
];
