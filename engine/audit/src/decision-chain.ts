// ============================================================
// decision-chain.ts · 决策日志链完整性校验（v1.3.0 交付 6 T02）
//
// mirror core/audit-history.ts 的 checkHistoryChainDetailed 范式——
// 校验 decision-log.jsonl 的 HMAC 哈希链，区分三类异常：
//   'tampered'      真篡改（红）：指纹一致但 HMAC 不匹配 / 无指纹旧算法 prevHash 不匹配
//   'unverifiable'  不可复验（黄）：环境指纹漂移（密钥轮换 / hostname / git 路径变化）
//   'insufficient'  历史不足（灰）：不存在或不足 2 条
//   'ok'            链完整
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { createHash, createHmac } from 'crypto';
import { getDecisionLogPath, getEnvFingerprint, getHmacKey, stableStringify } from '@sofagent/core';
import type { DecisionLogEntry } from './decision-schema';

/** 链校验结果状态（与 core ChainCheckStatus 同构） */
export type DecisionChainCheckStatus = 'ok' | 'tampered' | 'unverifiable' | 'insufficient';

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
 * 与 checkHistoryChainDetailed 完全同构——决策日志与审计历史共用
 * 同一 HMAC 签名链语义（同密钥、同 stableStringify、同指纹判定）。
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
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      const parsed = JSON.parse(trimmed) as ChainEntry;
      entries.push(parsed);
    } catch (err) {
      console.error('[decision-chain] 解析决策条目 JSON 失败:', err);
    }
  }

  if (entries.length <= 1) {
    return { status: 'insufficient', detail: '决策日志不足 2 条，无法构成可验证的防篡改链' };
  }

  const fingerprint = getEnvFingerprint(dataDir);
  const hmacKey = getHmacKey();
  const keyAvailable = hmacKey !== null;

  let foundUnverifiable = false;

  // 创世条目独立验签（与 history 链一致）
  const genesisEntry = entries[0]!;
  if (
    genesisEntry &&
    typeof genesisEntry.hmacSig === 'string' &&
    genesisEntry.hmacSig &&
    keyAvailable &&
    hmacKey
  ) {
    const genesisUseFingerprint = genesisEntry.hashVersion === 2;
    const genesisRecordForSig = {
      ...genesisEntry,
      prevHash: undefined,
      hashVersion: undefined,
      hmacSig: undefined,
      hmacAlgo: undefined,
    };
    const genesisHashInput = genesisUseFingerprint
      ? stableStringify(genesisRecordForSig) + '|' + fingerprint
      : stableStringify(genesisRecordForSig);
    const genesisExpectedHmac = createHmac('sha256', hmacKey)
      .update(genesisHashInput)
      .digest('hex')
      .slice(0, 32);
    if (genesisEntry.hmacSig !== genesisExpectedHmac) {
      if (genesisEntry.hmacAlgo === 'stable' && !genesisUseFingerprint) {
        return { status: 'tampered', index: 0, detail: `决策创世条目（索引 0）HMAC 签名不匹配（stable 条目，无环境指纹），疑似内容被篡改` };
      }
      foundUnverifiable = true;
    }
  }

  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1]!;
    const curr = entries[i]!;

    const currUseFingerprint = curr.hashVersion === 2;

    // 1) prevHash 链校验
    if (curr.prevHash == null || curr.prevHash === 'unknown') continue;

    const recordForHash = { ...prev, prevHash: undefined, hashVersion: undefined };
    const hashInput = currUseFingerprint
      ? JSON.stringify(recordForHash) + '|' + fingerprint
      : JSON.stringify(recordForHash);
    const expectedPrevHash = createHash('sha256')
      .update(hashInput)
      .digest('hex').slice(0, 16);

    if (curr.prevHash !== expectedPrevHash) {
      if (currUseFingerprint) {
        foundUnverifiable = true;
      } else {
        return { status: 'tampered', index: i, detail: `决策条目 ${i} prevHash 不匹配（旧算法，环境无关），疑似内容被篡改` };
      }
      continue;
    }

    // 2) HMAC 验签
    if (curr.hmacSig && keyAvailable && hmacKey) {
      const recordForSig = { ...curr, prevHash: undefined, hashVersion: undefined, hmacSig: undefined, hmacAlgo: undefined };
      const expectedHmac = createHmac('sha256', hmacKey)
        .update(stableStringify(recordForSig) + '|' + fingerprint)
        .digest('hex').slice(0, 32);
      if (curr.hmacSig !== expectedHmac) {
        if (curr.hmacAlgo === 'stable') {
          if (currUseFingerprint) {
            const recordedFingerprint = curr.envFingerprint;
            if (typeof recordedFingerprint === 'string' && recordedFingerprint.length > 0) {
              if (recordedFingerprint === fingerprint) {
                return { status: 'tampered', index: i, detail: `决策条目 ${i} HMAC 签名不匹配（环境指纹一致，确为内容被篡改）` };
              }
              foundUnverifiable = true;
            } else {
              foundUnverifiable = true;
            }
          } else {
            return { status: 'tampered', index: i, detail: `决策条目 ${i} HMAC 签名不匹配（stable 条目，无环境指纹），疑似内容被篡改` };
          }
        } else {
          foundUnverifiable = true;
        }
      }
    }
  }

  if (foundUnverifiable) {
    return {
      status: 'unverifiable',
      detail: '部分决策段（v2 含环境指纹条目）因 ~/.sofagent-key 或环境指纹漂移无法复验，属历史证据不可复验，非篡改',
    };
  }

  return { status: 'ok' };
}
