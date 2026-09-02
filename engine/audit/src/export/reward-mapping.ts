// ============================================================
// reward-mapping.ts · v1.4.4 第一章 · reward 骨架 + verifiers 清单
//
// 规则 → reward 映射的最后一公里（2026-08-26 补）：
// 三件套导出了「什么行为被判 FAIL/PASS」（样本），RL 训练还需要
// 「用什么函数给行为打分」（reward 定义）。sofagent 的天然优势：
// 审计规则的判定逻辑本身就是机器可执行的 verifier。
//
// 三桶分桶（训练管线按清单接线，不混用）：
//   - machine-judgeable：可直接当 reward 函数接线（判定纯函数可执行）
//   - human-review：只能当训练后验收（判定依赖业务语义/任务上下文）
//   - heuristic：可当弱 reward 或采样人审（可执行但阈值敏感）
// ============================================================

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getHmacKey } from '@sofagent/core';
import { defaultRules, extendedRules } from '../rules/index';
import { allRuleSlots, inferVerifiability, severityWeightOf, signatureOf, type Verifiability } from './rule-schema';
import { signBody } from './exporter';

/** verifiers.json 清单条目 */
export interface VerifierEntry {
  code: string;
  name: string;
  /** 三桶归属 */
  verifiability: Verifiability;
  /** reward 骨架签名 */
  signature: string;
  /** 严重度权重 */
  severityWeight: number;
}

/** verifiers.json 主体 */
export interface VerifiersManifestBody {
  schemaVersion: 'v1';
  /** 生成时间 */
  generatedAt: string;
  /** 三桶分组 */
  buckets: {
    /** 机器可判——可直接当 reward 函数接线 */
    machineJudgeable: VerifierEntry[];
    /** 需人审——只能当训练后验收 */
    humanReview: VerifierEntry[];
    /** 启发式——可当弱 reward 或采样人审 */
    heuristic: VerifierEntry[];
  };
  /** 接线指引（训练管线消费说明） */
  wiring: {
    machineJudgeable: '可直接挂进训练循环当 reward 函数（判定输入=工具调用序列/产物文本）';
    humanReview: '仅作训练后验收基准（golden set）——判定依赖业务语义，机器接线会引入标签噪声';
    heuristic: '可当弱 reward（低权重）或触发采样人审——阈值敏感，误报率不可忽略';
  };
}

/** 完整 verifiers 清单（body + HMAC） */
export interface VerifiersManifest {
  body: VerifiersManifestBody;
  hmac: string;
}

/** 构造 verifiers 清单主体（24 实现 + 3 占位全量分桶） */
export function buildVerifiersManifest(): VerifiersManifestBody {
  const all = [...defaultRules, ...extendedRules];
  const entries = allRuleSlots(all);
  const toEntry = (e: (typeof entries)[number]): VerifierEntry => ({
    code: e.code,
    name: e.name,
    verifiability: e.reward_hint.verifiability,
    signature: e.reward_hint.signature,
    severityWeight: e.reward_hint.severityWeight,
  });
  const bucketOf = (v: Verifiability) => entries.filter((e) => e.reward_hint.verifiability === v).map(toEntry);
  return {
    schemaVersion: 'v1',
    generatedAt: new Date().toISOString(),
    buckets: {
      machineJudgeable: bucketOf('machine-judgeable'),
      humanReview: bucketOf('human-review'),
      heuristic: bucketOf('heuristic'),
    },
    wiring: {
      machineJudgeable: '可直接挂进训练循环当 reward 函数（判定输入=工具调用序列/产物文本）',
      humanReview: '仅作训练后验收基准（golden set）——判定依赖业务语义，机器接线会引入标签噪声',
      heuristic: '可当弱 reward（低权重）或触发采样人审——阈值敏感，误报率不可忽略',
    },
  };
}

/** 生成 verifiers.json（签名 + 可选落盘） */
export function generateVerifiers(outDir?: string): VerifiersManifest & { files: string[] } {
  const body = buildVerifiersManifest();
  const key = getHmacKey();
  const hmac = key ? signBody(body, key) : '';
  const files: string[] = [];
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    const p = join(outDir, 'verifiers.json');
    writeFileSync(p, JSON.stringify({ body, hmac }, null, 2), 'utf-8');
    files.push(p);
  }
  return { body, hmac, files };
}

// ════════════════════════════════════════
// 覆写支持（骨架标注非最终裁定——人工可调）
// ════════════════════════════════════════

/** 可判定性覆写表（code → 覆写值——生成 verifiers.json 前应用） */
export type VerifiabilityOverride = Record<string, Verifiability>;

/** 应用覆写后再分桶（人工拍板某条规则的实际可判定性时用） */
export function buildVerifiersWithOverrides(overrides: VerifiabilityOverride): VerifiersManifestBody {
  const all = [...defaultRules, ...extendedRules];
  const base = allRuleSlots(all);
  // 先覆写再分桶——inferVerifiability 只对无覆写条目生效
  const patched = base.map((e) => {
    const ov = overrides[e.code];
    if (!ov) return e;
    return { ...e, reward_hint: { ...e.reward_hint, verifiability: ov } };
  });
  const entries = patched;
  const toEntry = (e: (typeof entries)[number]): VerifierEntry => ({
    code: e.code,
    name: e.name,
    verifiability: e.reward_hint.verifiability,
    signature: e.reward_hint.signature,
    severityWeight: e.reward_hint.severityWeight,
  });
  const bucketOf = (v: Verifiability) => entries.filter((e) => e.reward_hint.verifiability === v).map(toEntry);
  return {
    schemaVersion: 'v1',
    generatedAt: new Date().toISOString(),
    buckets: {
      machineJudgeable: bucketOf('machine-judgeable'),
      humanReview: bucketOf('human-review'),
      heuristic: bucketOf('heuristic'),
    },
    wiring: {
      machineJudgeable: '可直接挂进训练循环当 reward 函数（判定输入=工具调用序列/产物文本）',
      humanReview: '仅作训练后验收基准（golden set）——判定依赖业务语义，机器接线会引入标签噪声',
      heuristic: '可当弱 reward（低权重）或触发采样人审——阈值敏感，误报率不可忽略',
    },
  };
}

// 消除未使用 import 告警（inferVerifiability/signatureOf/severityWeightOf 供外部消费）
export { inferVerifiability, signatureOf, severityWeightOf };
