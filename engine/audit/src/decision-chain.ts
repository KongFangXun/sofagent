// ============================================================
// decision-chain.ts · 决策日志链完整性校验（v1.3.7 交付 6 T02）
//
// mirror core/audit-history.ts 的 checkHistoryChainDetailed 范式——
// 校验 decision-log.jsonl 的 HMAC 哈希链，区分三类异常：
//   'tampered'      真篡改（红）：指纹一致但 HMAC 不匹配 / 无指纹旧算法 prevHash 不匹配
//   'unverifiable'  不可复验（黄）：环境指纹漂移（密钥轮换 / hostname / git 路径变化）
//   'insufficient'  历史不足（灰）：不存在或不足 2 条
//   'ok'            链完整
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { getDecisionLogPath, getEnvFingerprint, getHmacKey } from '@sofagent/core';
import { verifyChain, type ChainCheckStatus } from './chain-kernel';
import type { DecisionLogEntry } from './decision-schema';

/** 链校验结果状态（与 core ChainCheckStatus 同构；判定逻辑收口在 chain-kernel） */
export type DecisionChainCheckStatus = ChainCheckStatus;

export interface DecisionChainCheckResult {
  status: DecisionChainCheckStatus;
  /** 人类可读说明（doctor 输出用） */
  detail?: string;
  /** 首个异常条目下标（调试用） */
  index?: number;
}

/** 链校验使用的轻量条目类型——仅含校验所需字段 */
interface ChainEntry {
  prevHash?: unknown;
  hashVersion?: unknown;
  hmacSig?: unknown;
  hmacAlgo?: unknown;
  envFingerprint?: unknown;
}

/**
 * 校验 decision-log.jsonl 的 hash chain 完整性（详细判定版）
 *
 * 判定逻辑收口至 chain-kernel.verifyChain（单一事实源）——与 train-audit 的
 * audit.jsonl 链共用同一实现（分叉的历史复刻已消除）。本函数只负责
 * 「定位文件 + 读取 + JSONL 解析 + 注入环境值」。
 *
 * @param dataDir 可选的数据目录覆盖
 * @returns ChainCheckResult
 */
export function checkDecisionChainDetailed(dataDir?: string): DecisionChainCheckResult {
  const filePath = getDecisionLogPath(dataDir);

  if (!existsSync(filePath)) {
    return { status: 'insufficient', detail: '决策日志文件不存在，无法验证防篡改链' };
  }

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.error('[decision-chain] 读取决策日志文件失败:', err);
    return { status: 'tampered', detail: 'decision-log.jsonl 读取失败（疑似权限/损坏）' };
  }

  const entries: ChainEntry[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      entries.push(JSON.parse(trimmed) as ChainEntry);
    } catch (err) {
      console.error('[decision-chain] 解析决策条目 JSON 失败:', err);
    }
  }

  // subject='决策' → detail 文案与收口前逐字一致
  return verifyChain(entries, {
    key: getHmacKey(),
    fingerprint: getEnvFingerprint(dataDir),
    subject: '决策',
  });
}
