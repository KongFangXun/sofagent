// ============================================================
// dist-hash.test.ts · 聚合法单一性守护（v1.5.4 #14/#28）
// ============================================================
// 为什么需要本测试：dist 聚合哈希有**两处实现**——
//   ① `engine/core/src/dist-hash.ts`（TS 版：doctor / hook 安装建立全局锚时用）
//   ② `engine/audit/hooks/commit-msg` 内联的 bash 版（hook 必须在**不执行任何被审仓
//      代码**的前提下自证，故自带实现，不可删）
// 两处若漂移 ⇒ 「安装时建立的锚」与「hook 校验的哈希」不同源 ⇒ 全局用户每次 commit
// 都被判「哈希不匹配（可能被投毒）」。本测试从 hook 文件里**提取真实函数体**执行，
// 与 TS 版比对**同结果**——提取失败即红（不静默）。
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { computeDistAggregateHash, resolveGlobalAuditDistRoot } from '../dist-hash';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');

describe('dist 聚合哈希 · TS 版与 hook 内联版同结果', () => {
  it('同一 dist 下：computeDistAggregateHash(dist) === hook 内联 _aggregate_dist_hash(dist)', () => {
    const dist = join(repoRoot, 'engine', 'audit', 'dist');
    const tsHash = computeDistAggregateHash(dist);
    expect(tsHash).toMatch(/^[0-9a-f]{64}$/);

    // 从 hook 文件提取内联实现（bash 函数体），在 bash 里执行——测的是**真实 hook 代码**
    const hookPath = join(repoRoot, 'engine', 'audit', 'hooks', 'commit-msg');
    const hook = readFileSync(hookPath, 'utf8');
    const m = hook.match(/_aggregate_dist_hash\(\) \{[\s\S]*?\n\}/);
    expect(m, '未能从 commit-msg 提取 _aggregate_dist_hash 函数体（hook 结构已变——本测试须同步更新）').not.toBeNull();

    const out = execFileSync('bash', ['-c', `${m![0]}\n_aggregate_dist_hash "$1"`, '--', dist], {
      encoding: 'utf8',
    }).trim();

    expect(out).toBe(tsHash);
  });

  it('dist 不存在 / 无 .js ⇒ 返回 null（「算不出 ≠ 一致」——调用方不得当一致处理）', () => {
    const empty = mkdtempSync(join(tmpdir(), 'sof-disthash-'));
    try {
      expect(computeDistAggregateHash(join(empty, 'nope'))).toBeNull();
      mkdirSync(join(empty, 'd'));
      expect(computeDistAggregateHash(join(empty, 'd'))).toBeNull(); // 目录存在但无 .js
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('内容变化 ⇒ 哈希变化（聚合对任一 .js 敏感）', () => {
    const d = mkdtempSync(join(tmpdir(), 'sof-disthash2-'));
    try {
      writeFileSync(join(d, 'a.js'), 'const a=1;');
      const h1 = computeDistAggregateHash(d);
      writeFileSync(join(d, 'b.js'), 'const b=2;');
      const h2 = computeDistAggregateHash(d);
      expect(h1).not.toBe(h2);
      // 排序稳定性：文件名序不影响结果（同一集合多次计算结果恒定）
      expect(computeDistAggregateHash(d)).toBe(h2);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it('resolveGlobalAuditDistRoot：解析不到时返回 null（不抛错——调用方据此走「不适用」分支）', () => {
    const r = resolveGlobalAuditDistRoot();
    if (r !== null) {
      expect(r.endsWith('/dist') || r.endsWith('\\dist')).toBe(true);
    } else {
      expect(r).toBeNull();
    }
  });
});
