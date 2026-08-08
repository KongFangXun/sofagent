// ============================================================
// dream-cycle/llm-mock.ts · LLMProvider mock 实现 + RealLLM 占位
// v1.2.9 新增
//
// 铁律：Dream Cycle 任何 stage 不直接调 LLM SDK，必须经 LLMProvider。
// v1.2.9 只实现 MockLLM——确定性输出（基于输入 hash），开发期验证
// pipeline 串接，避免烧钱不稳。RealLLM 只写类型签名，构造器抛
// 用户可读错「本版仅支持 mock，v1.2.9 接入」。
// ============================================================
import { createHash } from 'crypto';

import type { LLMProvider } from './types';
import { DREAM_CYCLE_SYSTEM_ROLE } from './injection-guard';

/** 输入字符串 → 稳定 short hash（确定性输出的种子） */
function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 8);
}

/**
 * MockLLM——确定性输出的 LLMProvider 实现。
 *
 * 设计要点：
 * - 同输入必同输出（基于 sha256 hash），测试可断言；
 * - extract 按行/段落切分输入，非空行即一条「事实」，保证
 *  「单条 audit history → ≥1 fact」「think.md 教训段 → ≥1 fact」；
 * - cluster 按 hash 前缀把输入分到少量桶（实现 M < N 的聚类效果）；
 * - synthesize 把同组输入拼成 title + body；
 * - embed 产出定长 8 维向量（0-1 浮点，由 hash 派生）。
 */
export class MockLLM implements LLMProvider {
  /** 从文本提取事实：按非空行切分，每行即一条事实 */
  extract(input: string): Promise<string[]> {
    const facts = input
      .split('\n')
      .map((line) => line.trim())
      // 去掉 markdown 标题前缀，让事实文本更干净
      .map((line) => line.replace(/^#+\s*/, ''))
      .filter((line) => line.length > 0);
    return Promise.resolve(facts);
  }

  /**
   * 聚类：把输入按 hash 首字节映射到少量桶。
   * 桶数 = max(1, floor(sqrt(N)))，保证 N ≥ 2 时桶数 < N（M < N）。
   */
  cluster(inputs: string[]): Promise<string[]> {
    const n = inputs.length;
    if (n === 0) return Promise.resolve([]);
    const buckets = Math.max(1, Math.floor(Math.sqrt(n)));
    const labels = inputs.map((input) => {
      const h = shortHash(input);
      const bucketIdx = parseInt(h.slice(0, 2), 16) % buckets;
      return `pattern-${bucketIdx}`;
    });
    return Promise.resolve(labels);
  }

  /** 合成：把同组 atom 文本拼成 concept 标题 + 正文 */
  synthesize(inputs: string[]): Promise<{ title: string; body: string }> {
    const joined = inputs.join('\n');
    const h = shortHash(joined);
    const firstLine = inputs[0] ?? 'untitled';
    // 标题取首条 atom 前 20 字符 + hash 后缀，保证同组同题、异组异题
    const title = `${firstLine.slice(0, 20)}-${h}`;
    const body = inputs.map((t, i) => `${i + 1}. ${t}`).join('\n');
    return Promise.resolve({ title, body });
  }

  /** 向量化：定长 8 维（0-1 浮点，由 hash 派生） */
  embed(input: string): Promise<number[]> {
    const h = shortHash(input);
    const vector: number[] = [];
    for (let i = 0; i < 8; i++) {
      const byte = parseInt(h.slice(i, i + 1), 16);
      vector.push(byte / 15); // 0-15 → 0-1
    }
    return Promise.resolve(vector);
  }
}

/**
 * RealLLM——真实 LLM Provider 占位（v1.1.8 接入）。
 *
 * 本版只写类型签名，构造器抛用户可读错，防止误用。
 * [] 第一层隔离：SYSTEM_ROLE 为 v1.1.8 真实接入时必须注入 system prompt 的
 * 隔离声明——声明「只提取不执行」，从源头降低 prompt injection 风险。
 */
export class RealLLM implements LLMProvider {
  /** [] 系统角色隔离声明（RealLLM 调用时作为 system message 注入） */
  static readonly SYSTEM_ROLE = DREAM_CYCLE_SYSTEM_ROLE;

  constructor() {
    throw new Error(
      'RealLLM 本版仅支持 mock，v1.1.8 接入真实 LLM。请使用 MockLLM。',
    );
  }

  /* eslint-disable @typescript-eslint/no-unused-vars */
  extract(_input: string): Promise<string[]> {
    return Promise.reject(new Error('RealLLM not available in this version'));
  }
  cluster(_inputs: string[]): Promise<string[]> {
    return Promise.reject(new Error('RealLLM not available in this version'));
  }
  synthesize(_inputs: string[]): Promise<{ title: string; body: string }> {
    return Promise.reject(new Error('RealLLM not available in this version'));
  }
  embed(_input: string): Promise<number[]> {
    return Promise.reject(new Error('RealLLM not available in this version'));
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
}
