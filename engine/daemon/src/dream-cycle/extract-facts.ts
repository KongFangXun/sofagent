// ============================================================
// dream-cycle/extract-facts.ts · Stage 1 — 从 Ledger 提取原始事实
// v1.2.9 新增
//
// 输入：Ledger（think.md 全文 + audit history 条目）
// 输出：Fact[]（每条事实带稳定 id + 来源回指）
// 铁律：不直接调 LLM SDK，必须经 LLMProvider.extract。
// ============================================================

import { createHash } from 'crypto';

import type { Fact, Ledger, LLMProvider } from './types';
import { validateExtractOutput, scanInjection } from './injection-guard';
// v1.2.9 功能①：事实抽取后自动写入事实级记忆存储
import { createMemoryStore } from '@sofagent/core';

/** 文本 → 稳定 fact id（内容 hash 前 12 位） */
function factId(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

/**
 * Stage 1：从 Ledger 提取事实。
 *
 * - think.md：经 llm.extract 按行切分，非空行即一条事实，source='think.md'
 * - audit history：每条的 message/rule 拼成一条事实，source='audit:<rule>'
 * - 空 Ledger → 空数组（pipeline 空转不报错）
 */
export async function extractFacts(ledger: Ledger, llm: LLMProvider): Promise<Fact[]> {
  const facts: Fact[] = [];

  // v1.2.9 功能①：事实级记忆存储——提取后自动写入
  const memoryStore = createMemoryStore();

  // think.md 事实
  if (ledger.thinkContent.trim().length > 0) {
    // [] 第三层隔离：A9 注入扫描标记 think.md 潜在注入，隔离于提取结果
    const { marked } = scanInjection(ledger.thinkContent);
    // [] 第二层隔离：校验 llm.extract() 返回 schema，非法时回退按行切分
    const raw = await llm.extract(marked);
    const texts = validateExtractOutput(raw, marked);
    for (const text of texts) {
      const fact: Fact = { id: factId(`think:${text}`), text, source: 'think.md' };
      facts.push(fact);
      // v1.2.9：写入事实级记忆存储
      try {
        memoryStore.set({
          key: `think.${fact.id}`,
          value: text,
          source: 'think.md',
          confidence: 0.8,
          tags: ['dream-cycle', 'think'],
        });
      } catch {
        // 记忆存储写入失败不阻塞 pipeline
      }
    }
  }

  // audit history 事实
  for (const entry of ledger.auditEntries) {
    const rule = typeof entry.rule === 'string' ? entry.rule : 'unknown';
    const message =
      typeof entry.message === 'string'
        ? entry.message
        : typeof entry.status === 'string'
          ? `${rule}:${entry.status}`
          : rule;
    const text = `${rule} — ${message}`;
    const fact: Fact = { id: factId(`audit:${JSON.stringify(entry)}`), text, source: `audit:${rule}` };
    facts.push(fact);
    // v1.2.9：写入事实级记忆存储
    try {
      memoryStore.set({
        key: `audit.${rule}.${fact.id}`,
        value: text,
        source: `audit:${rule}`,
        confidence: 0.9,
        tags: ['dream-cycle', 'audit', rule],
      });
    } catch {
      // 记忆存储写入失败不阻塞 pipeline
    }
  }

  return facts;
}
