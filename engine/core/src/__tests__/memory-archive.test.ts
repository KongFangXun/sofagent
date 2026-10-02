// ============================================================
// memory-archive.test.ts · v1.5.6 章二：memory 二级分层 + 归档轮转 + 读侧兼容
//
// 覆盖：
//   ① 二级分层落盘（桶内按 factId 前 2 字符分片）——单目录文件数不再线性堆积
//   ② 读侧兼容：二级分层前写入的旧扁平布局事实**零回归可读**
//   ③ 归档轮转：冷数据移入 archive/，退出主索引（不进 list/search）、显式 listArchived 可查
//   ④ 幂等：重复 archive 不重复迁移
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createMemoryStore } from '../memory-store';

describe('§v1.5.6 章二 · memory 二级分层与归档轮转', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sofagent-memory-archive-'));
  });

  afterEach(() => {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // 清理失败不阻断
    }
  });

  it('① 二级分层：事实落在 <bucket>/<前2字符>/<factId>.md', () => {
    const store = createMemoryStore(dataDir);
    const id = store.set({ key: '用户偏好.前端框架', value: 'React', tags: ['pref'], source: 'test' });
    const shardDir = join(dataDir, 'memory', '用户偏好', id.slice(0, 2));
    expect(existsSync(join(shardDir, `${id}.md`))).toBe(true);
    // 桶根目录本身不再直接堆事实文件
    const bucketRoot = join(dataDir, 'memory', '用户偏好');
    const flatMd = readdirSync(bucketRoot).filter((f) => f.endsWith('.md'));
    expect(flatMd.length).toBe(0);
  });

  it('② 读侧兼容：旧扁平布局（分层前写入）仍可读', () => {
    const bucketDir = join(dataDir, 'memory', '用户偏好');
    mkdirSync(bucketDir, { recursive: true });
    const legacyId = 'legacy-fact-id';
    const legacyMd = [
      '---',
      `id: ${legacyId}`,
      'key: 用户偏好.老事实',
      'tags: []',
      'source: legacy',
      'createdAt: 2026-01-01T00:00:00.000Z',
      'updatedAt: 2026-01-01T00:00:00.000Z',
      '---',
      '旧扁平布局的值',
      '',
    ].join('\n');
    writeFileSync(join(bucketDir, `${legacyId}.md`), legacyMd, 'utf-8');
    writeFileSync(
      join(dataDir, 'memory', 'memory.json'),
      JSON.stringify({ '用户偏好.老事实': legacyId }, null, 2) + '\n',
      'utf-8'
    );

    const store = createMemoryStore(dataDir);
    const got = store.get('用户偏好.老事实');
    expect(got).not.toBeNull();
    expect(got?.value).toBe('旧扁平布局的值');
  });

  it('③ 归档轮转：冷数据移出主索引、不进常规检索、显式可查', () => {
    const store = createMemoryStore(dataDir);
    store.set({ key: 'b.hot', value: '热', tags: [], source: 'test' });
    const coldId = store.set({ key: 'b.cold', value: '冷', tags: [], source: 'test' });

    // 构造「90 天未更新」态：直接改文件的 updatedAt
    const coldPath = join(dataDir, 'memory', 'b', coldId.slice(0, 2), `${coldId}.md`);
    const t = readFileSync(coldPath, 'utf-8').replace(/updatedAt: .*/, 'updatedAt: 2020-01-01T00:00:00.000Z');
    writeFileSync(coldPath, t, 'utf-8');

    const moved = store.archive({ days: 30 });
    expect(moved).toBe(1);

    // 主检索面：只剩热的
    const keys = store.list().map((f) => f.key);
    expect(keys).toContain('b.hot');
    expect(keys).not.toContain('b.cold');
    expect(store.search('冷').length).toBe(0);

    // 显式归档面可查
    const archived = store.listArchived();
    expect(archived.map((f) => f.key)).toContain('b.cold');

    // 归档文件物理落点
    expect(existsSync(join(dataDir, 'memory', 'b', 'archive', coldId.slice(0, 2), `${coldId}.md`))).toBe(true);
  });

  it('④ 幂等：重复 archive 不重复迁移', () => {
    const store = createMemoryStore(dataDir);
    const id = store.set({ key: 'b.x', value: 'v', tags: [], source: 'test' });
    const p = join(dataDir, 'memory', 'b', id.slice(0, 2), `${id}.md`);
    writeFileSync(p, readFileSync(p, 'utf-8').replace(/updatedAt: .*/, 'updatedAt: 2020-01-01T00:00:00.000Z'), 'utf-8');

    expect(store.archive({ days: 30 })).toBe(1);
    expect(store.archive({ days: 30 })).toBe(0);
  });
});
