// ============================================================
// detector-regex.ts · v1.4.9 T8 · L0 内置正则检测器（插槽化原位升级）
// ============================================================
//
// 在现有 REDACTION_PATTERNS 15 条脱敏表（shared/secret-patterns.ts——
// 13 密钥族 + 手机号 PII + sk- 宽族）+ sorting-gate SENSITIVE_PATTERNS
// 五标签上插槽化——**禁止回退 9 族旧表**（v1.3.9 九族对齐是已修复的
// 不对称洞，顺序不可逆）。
//
// L0 是零依赖默认档：注册进 DetectorRegistry 即开箱可用，
// L1/L2 不可用时单独兜底（fail-closed 降级的落点）。
//
// ⚠️ 宽度铁律继承：检测正则宽度 ⊆ REDACTION_PATTERNS 脱敏宽度
// （宁多脱敏勿漏——L0 检测出的 span 由 redactor 消费时按
// REDACTION_PATTERNS 宽口径替换，本检测器的 start/end 仅作
// 高置信定位与审计留痕）。
// ============================================================

import { REDACTION_PATTERNS } from '../shared/secret-patterns';
import {
  type Detector,
  type SensitiveSpan,
} from './detector-registry';
import { toPresidioType } from './detector-presidio-schema';

/** L0 检测器名（注册表键） */
export const L0_REGEX_DETECTOR_NAME = 'l0-regex';

/** 密钥族标签（与 REDACTION_PATTERNS 顺序对齐——索引即族号） */
const L0_LABELS: readonly string[] = [
  'aws-key', // 1. AKIA
  'pem-block', // 2. PEM 私钥块
  'anthropic-key', // 3. sk-ant-
  'openai-project', // 4. sk-proj-
  'openai-svcacct', // 5. sk-svcacct-
  'openai-admin', // 6. sk-admin-
  'sk-generic', // 7. 通用 sk-（宽口径）
  'github-token', // 8. gh[ps]_
  'stripe-key', // 9. sk_live_/sk_test_
  'phone', // 10. PII 手机号
  'google-key', // 11. AIza
  'slack-token', // 12. xox
  'jwt-token', // 13. eyJ
  'bare-base64', // 14. 裸 40 位（负向环视排纯 hex）
];

/**
 * L0 内置正则检测器（零依赖默认档）。
 *
 * 正则来源：REDACTION_PATTERNS 逐条执行（全局标志保留——exec 循环扫描）。
 * 置信度：密钥族固定 0.95（格式锚定——前缀特征唯一）；手机号 PII 0.8
 * （格式强但存在合法展示形态）；裸 40 位 0.5（无前缀锚——低置信只标记档）。
 */
export function createL0RegexDetector(): Detector {
  return {
    name: L0_REGEX_DETECTOR_NAME,
    layer: 'L0',
    detect(text: string): SensitiveSpan[] {
      const out: SensitiveSpan[] = [];
      for (let i = 0; i < REDACTION_PATTERNS.length && i < L0_LABELS.length; i++) {
        const { pattern } = REDACTION_PATTERNS[i]!;
        const label = L0_LABELS[i]!;
        const score = label === 'phone' ? 0.8 : label === 'bare-base64' ? 0.5 : 0.95;
        // 每条 pattern 自带 g 标志（REDACTION_PATTERNS 构造保证）——exec 循环前复位
        pattern.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = pattern.exec(text)) !== null) {
          out.push({
            start: m.index,
            end: m.index + m[0].length,
            text: m[0],
            label,
            entityType: toPresidioType(label),
            score,
            detector: L0_REGEX_DETECTOR_NAME,
            layer: 'L0',
          });
          // 零长匹配防护（理论不发生——防御式）
          if (m[0].length === 0) pattern.lastIndex += 1;
        }
      }
      return out;
    },
  };
}

/**
 * sorting-gate 敏感模式 L0 化（五标签：手机号/身份证号/银行卡号/金额/邮箱）。
 *
 * 与 sorting-gate.SENSITIVE_PATTERNS 同源（正则字面量复制——sorting-gate
 * 属 train 包，core 不能反向 import train；两处正则由
 * sorting-gate 的回归测试锁住同步，见 sorting-gate.test.ts）。
 * 置信度 0.7（中置信——单检测器命中，替换+记审计档）。
 */
export const L0_SENSITIVE_PATTERN_SPECS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: '手机号', pattern: /1[3-9]\d{9}/g },
  { label: '身份证号', pattern: /\b\d{17}[\dXx]\b/g },
  { label: '银行卡号', pattern: /\b\d{16,19}\b/g },
  { label: '金额', pattern: /(?:¥|￥)\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:元|万元|亿)/g },
  { label: '邮箱', pattern: /[\w.+-]+@[\w-]+\.[\w.-]+/g },
];

/** L0 敏感模式检测器（sorting-gate 五标签——sensitivity-classifier 消费） */
export function createL0SensitiveDetector(): Detector {
  return {
    name: 'l0-sensitive',
    layer: 'L0',
    detect(text: string): SensitiveSpan[] {
      const out: SensitiveSpan[] = [];
      for (const { label, pattern } of L0_SENSITIVE_PATTERN_SPECS) {
        pattern.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = pattern.exec(text)) !== null) {
          out.push({
            start: m.index,
            end: m.index + m[0].length,
            text: m[0],
            label,
            entityType: toPresidioType(label),
            score: 0.7,
            detector: 'l0-sensitive',
            layer: 'L0',
          });
          if (m[0].length === 0) pattern.lastIndex += 1;
        }
      }
      return out;
    },
  };
}
