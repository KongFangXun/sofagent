// ============================================================
// merge.ts · 联邦结果合并（Automerge CRDT + 去重排序）
// v1.2.0 新增
// ============================================================
//
// 合并策略（架构师定稿 + 主理人裁决 #3）：
//   - 用 Automerge CRDT 合并各来源文档——不手写三路合并（v1.0.5 教训）
//   - 同名条目冲突收敛规则：trust 优先于 mtime（裁决 #3）；
//     裁决在写入 CRDT 前预计算（change 回调内不读其他文档——Automerge
//     代理只允许访问自身 draft），CRDT 保证多来源并发收敛
//   - 最终排序：trust 降序 → mtime 降序

import * as Automerge from 'automerge';
import { TRUST_ORDER, type Trust } from '@sofagent/core';
import type { FederationResult, KnowledgeQueryResult } from './query-router';

/** 合并后的知识条目（带来源标注） */
export interface MergedKnowledge extends KnowledgeQueryResult {
  /** 来源：'local' 或 peerId */
  source: string;
  /** 归一化后的 trust（必有值） */
  trust: Trust;
}

/** Automerge 文档形态：{ entries: { [id]: KnowledgeQueryResult } } */
interface MergeDoc {
  entries: Record<string, KnowledgeQueryResult>;
}

/**
 * 裁决规则（#3：trust 优先于 mtime）——同 id 两个版本选胜者
 */
export function pickWinner(a: KnowledgeQueryResult, b: KnowledgeQueryResult): KnowledgeQueryResult {
  const trustA = TRUST_ORDER[a.trust ?? 'internal'];
  const trustB = TRUST_ORDER[b.trust ?? 'internal'];
  if (trustA !== trustB) return trustA > trustB ? a : b;
  const mtimeA = a.mtime ?? 0;
  const mtimeB = b.mtime ?? 0;
  return mtimeA >= mtimeB ? a : b;
}

/**
 * 合并本地 + 联邦结果：CRDT 收敛 + 去重 + trust/mtime 排序
 *
 * P0-9: peer 结果覆盖本地条目时触发 onPeerOverride 告警。
 * 「默认不覆盖」由 trust 排序天然保证：本地知识缺省 internal（trust=2），
 * 远端 peer 缺省 user（trust=1，见 query-router getLocalPeerTrust）——
 * 同 id 冲突时 pickWinner 按 trust 优先，本地 internal 恒胜远端 user，
 * 除非本地显式把 peer 提升为 internal/official 或本地条目本身是 user/web。
 *
 * @param local 本地 knowledge 查询结果（source 标 'local'）
 * @param remote 各 peer 的返回（已经过 query-router 双重校验）
 * @param onPeerOverride 可选告警回调（peerId, id, localTrust, peerTrust）
 * @returns 合并去重后的条目，按 trust 降序 → mtime 降序排列
 */
export function mergeFederationResults(
  local: KnowledgeQueryResult[],
  remote: FederationResult[],
  onPeerOverride?: (peerId: string, id: string, localTrust: Trust, peerTrust: Trust) => void,
): MergedKnowledge[] {
  // 1. 裁决预计算（change 回调外）：id → 胜出版本 + 来源
  const winners = new Map<string, KnowledgeQueryResult>();
  const sourceOf = new Map<string, string>();
  for (const item of local) {
    winners.set(item.id, item);
    sourceOf.set(item.id, 'local');
  }
  for (const fedResult of remote) {
    for (const item of fedResult.results) {
      const existing = winners.get(item.id);
      const winner = existing ? pickWinner(existing, item) : item;
      winners.set(item.id, winner);
      if (winner === item) {
        // P0-9: 远端结果覆盖了本地条目 → 告警（trust 排序已保证默认不覆盖，走到这里是显式配置了高信任或本地低信任）
        if (sourceOf.get(item.id) === 'local') {
          onPeerOverride?.(
            fedResult.peerId,
            item.id,
            existing?.trust ?? 'internal',
            item.trust ?? 'user',
          );
        }
        sourceOf.set(item.id, fedResult.peerId);
      }
    }
  }

  // 2. 本地文档（基础文档）
  let doc = Automerge.init<MergeDoc>();
  doc = Automerge.change(doc, (d) => {
    d.entries = {};
    for (const item of local) {
      d.entries[item.id] = winners.get(item.id) ?? item;
    }
  });

  // 3. 每个 peer 从当前合并文档分叉（clone）写入自身条目后 merge 回来——
  //    共享版本史的 CRDT 合并才能完整收敛（独立 init 的文档无共同祖先，
  //    Automerge 按 LWW 语义收敛时会丢弃无祖先覆盖的 key）
  for (const fedResult of remote) {
    let peerDoc = Automerge.clone(doc);
    peerDoc = Automerge.change(peerDoc, (d) => {
      for (const item of fedResult.results) {
        d.entries[item.id] = winners.get(item.id) ?? item;
      }
    });
    doc = Automerge.merge(doc, peerDoc);
  }

  // 4. 展开为数组 + source 标注 + 排序（trust 降 → mtime 降）
  const out: MergedKnowledge[] = Object.values(doc.entries).map((raw) => {
    const item = raw as KnowledgeQueryResult;
    return {
      ...item,
      source: sourceOf.get(item.id) ?? 'local',
      trust: item.trust ?? 'internal',
    };
  });
  out.sort((a, b) => {
    const trustDiff = TRUST_ORDER[b.trust] - TRUST_ORDER[a.trust];
    if (trustDiff !== 0) return trustDiff;
    return (b.mtime ?? 0) - (a.mtime ?? 0);
  });
  return out;
}
