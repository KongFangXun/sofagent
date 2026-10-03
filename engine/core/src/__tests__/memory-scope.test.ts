// ============================================================
// memory-scope.test.ts · v1.5.6 章二：沉淀记忆项目作用域
//
// 覆盖：
//   ① resolveMemoryScope：git 仓内 → project:<8hex>；非 git 目录 → global
//   ② 隔离：默认只见「当前 scope + global」，不泄漏其它项目；allScopes 可跨项目查
//   ③ 零回归：无 scope 字段的旧事实任意 scope 均可见
//   ④ 审批门：importFacts(approve:false) 抛错；approve:true 导入且血缘可查
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createMemoryStore, resolveMemoryScope } from '../memory-store';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'sofagent-mem-scope-'));
}

describe('§v1.5.6 章二 · 沉淀记忆项目作用域', () => {
  const dirs: string[] = [];

  function newDir(): string {
    const d = tmpDir();
    dirs.push(d);
    return d;
  }

  beforeEach(() => {
    dirs.length = 0;
  });

  afterEach(() => {
    while (dirs.length) {
      const d = dirs.pop();
      if (d) {
        try {
          rmSync(d, { recursive: true, force: true });
        } catch {
          // 清理失败不阻断
        }
      }
    }
  });

  it('① resolveMemoryScope：本仓 project:<8hex>；非 git 目录 global', () => {
    expect(resolveMemoryScope(process.cwd())).toMatch(/^project:[0-9a-f]{8}$/);
    expect(resolveMemoryScope(tmpdir())).toBe('global');
  });

  it('② 隔离：默认只见「当前 scope + global」，allScopes 可跨项目', () => {
    const dir = newDir();
    const a = createMemoryStore(dir, { scope: 'project:aaaaaaaa' });
    a.set({ key: 'p.fact', value: 'A 项目机密', source: 's', confidence: 1, tags: [] });

    const b = createMemoryStore(dir, { scope: 'project:bbbbbbbb' });
    // 默认不可见（不泄漏其它项目）
    expect(b.get('p.fact')).toBeNull();
    expect(b.list().map((f) => f.key)).not.toContain('p.fact');
    expect(b.search('机密').length).toBe(0);

    // 显式跨项目可查
    expect(b.get('p.fact', { allScopes: true })).not.toBeNull();
    expect(b.list(undefined, { allScopes: true }).map((f) => f.key)).toContain('p.fact');
  });

  it('③ 零回归：无 scope 字段的旧事实任意 scope 均可见', () => {
    const dir = newDir();
    const bucketDir = join(dir, 'memory', 'legacy');
    mkdirSync(bucketDir, { recursive: true });
    const id = 'legacy-id-0001';
    const md = [
      '---',
      `id: ${id}`,
      'key: legacy.k',
      'source: old',
      'confidence: 1',
      'createdAt: 2026-01-01T00:00:00.000Z',
      'updatedAt: 2026-01-01T00:00:00.000Z',
      'tags: []',
      '---',
      '旧事实值',
      '',
    ].join('\n');
    writeFileSync(join(bucketDir, `${id}.md`), md, 'utf-8');
    writeFileSync(
      join(dir, 'memory', 'memory.json'),
      JSON.stringify({ 'legacy.k': id }, null, 2) + '\n',
      'utf-8',
    );

    const s = createMemoryStore(dir, { scope: 'project:cccccccc' });
    expect(s.get('legacy.k')?.value).toBe('旧事实值');
  });

  it('④ 审批门：approve!==true 抛错；approve:true 导入且血缘可查', () => {
    const dir = newDir();
    const a = createMemoryStore(dir, { scope: 'project:aaaa1111' });
    a.set({ key: 'share.k', value: '共享值', source: 's', confidence: 0.9, tags: ['t'] });

    const bundle = a.exportFacts(['share.k']);
    expect(bundle.version).toBe(1);
    expect(bundle.sourceScope).toBe('project:aaaa1111');
    expect(bundle.sourceRepo).toMatch(/^(project:[0-9a-f]{8}|global)$/);
    expect(bundle.facts.length).toBe(1);

    const b = createMemoryStore(dir, { scope: 'project:bbbb2222' });
    // fail-closed：未批准直接抛错
    expect(() => b.importFacts(bundle, { approve: false })).toThrow();

    // 批准后导入成功，写入目标 scope
    const res = b.importFacts(bundle, { approve: true });
    expect(res.imported).toBe(1);
    expect(res.rejected).toBe(0);

    const got = b.get('share.k');
    expect(got).not.toBeNull();
    expect(got!.scope).toBe('project:bbbb2222');
    // 血缘可查（tags 携带来源 scope / 来源仓 / 导出时刻）
    expect(got!.tags).toContain('imported-from:project:aaaa1111');
    expect(got!.tags.some((t) => t.startsWith('imported-repo:'))).toBe(true);
    expect(got!.tags.some((t) => t.startsWith('imported-at:'))).toBe(true);
  });
});
