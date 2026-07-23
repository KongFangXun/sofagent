// ============================================================
// trust-grading.test.ts · 知识可信分级（层 5）测试
// v1.1.8 新增
//
// 覆盖用例（共 5 case）：
//   1. web + restricted 组合直接丢弃；其余组合全部可用（正交矩阵）
//   2. RAG 召回按 trust 排序（official > internal > user > web），稳定排序
//   3. web 内容进 prompt 前自动加 <untrusted> 标签；user 同样包裹
//   4. official / internal 内容不包裹，但 internal 仍走脱敏
//   5. trust×sensitivity 正交组合（public+web / internal+official / restricted+user…）
//      各自正确处理
// ============================================================

import { describe, it, expect } from 'vitest';

import {
  isTrustEntryUsable,
  sortByTrust,
  prepareForPrompt,
  type TrustTagged,
} from '../trust-grading';
import { RESTRICTED_PLACEHOLDER } from '../prompt-sanitizer';
import type { Sensitivity, Trust } from '../../memory-contract';

interface Entry extends TrustTagged {
  id: string;
}

describe('层 5 · trust×sensitivity 正交矩阵', () => {
  // 用例 1：web+restricted 丢弃，其余 11 种组合全部可用
  it('web+restricted 直接丢弃；其余 trust×sensitivity 组合全部可用', () => {
    const trusts: Trust[] = ['official', 'internal', 'user', 'web'];
    const sens: Sensitivity[] = ['public', 'internal', 'restricted'];
    const usable: string[] = [];
    const dropped: string[] = [];
    for (const t of trusts) {
      for (const s of sens) {
        const key = `${t}+${s}`;
        if (isTrustEntryUsable({ trust: t, sensitivity: s })) usable.push(key);
        else dropped.push(key);
      }
    }
    expect(dropped).toEqual(['web+restricted']);
    expect(usable.length).toBe(11);
  });

  // 用例 2：按 trust 排序（稳定）
  it('RAG 召回按 trust 降序：official > internal > user > web（同級稳定）', () => {
    const entries: Entry[] = [
      { id: 'w1', trust: 'web', sensitivity: 'public' },
      { id: 'o1', trust: 'official', sensitivity: 'public' },
      { id: 'u1', trust: 'user', sensitivity: 'public' },
      { id: 'i1', trust: 'internal', sensitivity: 'public' },
      { id: 'o2', trust: 'official', sensitivity: 'internal' },
    ];
    const sorted = sortByTrust(entries);
    expect(sorted.map((e) => e.id)).toEqual(['o1', 'o2', 'i1', 'u1', 'w1']);
    // 原数组不被修改
    expect(entries[0].id).toBe('w1');
  });
});

describe('层 5 · 进 prompt 前的一站式处理', () => {
  // 用例 3：web/user 自动包裹
  it('web 内容进 prompt 前自动加 <untrusted source="web">；user 加 source="user"', () => {
    const webOut = prepareForPrompt('网页抓取的段落', { trust: 'web', sensitivity: 'public' });
    expect(webOut).toContain('<untrusted source="web">');
    expect(webOut).toContain('网页抓取的段落');
    const userOut = prepareForPrompt('用户上传的笔记', { trust: 'user', sensitivity: 'public' });
    expect(userOut).toContain('<untrusted source="user">');
    // 调用方可覆盖来源（如 federation peer 内容）
    const fedOut = prepareForPrompt('联邦内容', { trust: 'user', sensitivity: 'public' }, 'federation');
    expect(fedOut).toContain('<untrusted source="federation">');
  });

  // 用例 4：official/internal 不包裹，internal 仍脱敏
  it('official / internal 不包裹；internal 内容仍走层 4 脱敏', () => {
    const officialOut = prepareForPrompt('官方文档段落 sk-abcdef1234567890', {
      trust: 'official',
      sensitivity: 'public',
    });
    // official 不包裹，但密钥照脱敏（脱敏与包裹正交）
    expect(officialOut).not.toContain('<untrusted');
    expect(officialOut).toContain('sk-****7890');
    const internalOut = prepareForPrompt('内部沉淀，联系 13812345678', {
      trust: 'internal',
      sensitivity: 'internal',
    });
    expect(internalOut).not.toContain('<untrusted');
    expect(internalOut).toContain('138****5678');
  });

  // 用例 5：正交组合各自正确处理
  it('public+web 包裹不脱敏占位；restricted+user 占位且仍包裹；internal+official 直通', () => {
    // public+web：包裹，内容原样（无敏感串可脱）
    const pw = prepareForPrompt('公开网页内容', { trust: 'web', sensitivity: 'public' });
    expect(pw).toContain('<untrusted source="web">');
    expect(pw).toContain('公开网页内容');
    // restricted+user：层 4 占位串 + 层 1 仍包裹（双防线各自独立）
    const ru = prepareForPrompt('用户传的机密 sk-topsecret123456', {
      trust: 'user',
      sensitivity: 'restricted',
    });
    expect(ru).toContain('<untrusted source="user">');
    expect(ru).toContain(RESTRICTED_PLACEHOLDER);
    expect(ru).not.toContain('topsecret');
    // internal+official：直通（不包裹，仅脱敏）
    const io = prepareForPrompt('内部官方流程', { trust: 'official', sensitivity: 'internal' });
    expect(io).toBe('内部官方流程');
  });
});
