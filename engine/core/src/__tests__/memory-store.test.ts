// ============================================================
// memory-store.test.ts · 事实级记忆存储测试（v1.2.8 功能①）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { createMemoryStore } from '../memory-store';

function tmpDir(): string {
  const dir = join(tmpdir(), `sofagent-mem-test-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('memory-store', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = tmpDir();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('set + get', () => {
    it('写入新事实后能读取回来', () => {
      const store = createMemoryStore(testDir);
      const id = store.set({
        key: '用户偏好.前端框架',
        value: 'React',
        source: 'session-1',
        confidence: 0.9,
        tags: ['前端', '框架'],
      });

      expect(id).toBeTruthy();
      const fact = store.get('用户偏好.前端框架');
      expect(fact).not.toBeNull();
      expect(fact!.value).toBe('React');
      expect(fact!.source).toBe('session-1');
      expect(fact!.confidence).toBe(0.9);
      expect(fact!.tags).toEqual(['前端', '框架']);
      expect(fact!.createdAt).toBeTruthy();
      expect(fact!.updatedAt).toBeTruthy();
    });

    it('同 key 再次写入为更新（不新建 id）', () => {
      const store = createMemoryStore(testDir);
      const id1 = store.set({
        key: 'config.timeout',
        value: '30s',
        source: 'init',
        confidence: 1,
        tags: [],
      });
      const id2 = store.set({
        key: 'config.timeout',
        value: '60s',
        source: 'update',
        confidence: 1,
        tags: ['timeout'],
      });

      expect(id2).toBe(id1);
      const fact = store.get('config.timeout');
      expect(fact!.value).toBe('60s');
      expect(fact!.tags).toEqual(['timeout']);
    });

    it('不存在的 key 返回 null', () => {
      const store = createMemoryStore(testDir);
      expect(store.get('不存在.key')).toBeNull();
    });
  });

  describe('list', () => {
    it('列出全部事实', () => {
      const store = createMemoryStore(testDir);
      store.set({ key: 'a.1', value: 'v1', source: 's', confidence: 1, tags: [] });
      store.set({ key: 'b.2', value: 'v2', source: 's', confidence: 1, tags: [] });
      store.set({ key: 'a.3', value: 'v3', source: 's', confidence: 1, tags: [] });

      const all = store.list();
      expect(all.length).toBe(3);

      const aOnly = store.list('a.');
      expect(aOnly.length).toBe(2);
      expect(aOnly.every((f) => f.key.startsWith('a.'))).toBe(true);
    });

    it('空存储返回空数组', () => {
      const store = createMemoryStore(testDir);
      expect(store.list().length).toBe(0);
    });
  });

  describe('delete', () => {
    it('删除存在的事实返回 true', () => {
      const store = createMemoryStore(testDir);
      store.set({ key: 'del.me', value: 'gone', source: 's', confidence: 1, tags: [] });
      expect(store.delete('del.me')).toBe(true);
      expect(store.get('del.me')).toBeNull();
    });

    it('删除不存在的事实返回 false', () => {
      const store = createMemoryStore(testDir);
      expect(store.delete('nope')).toBe(false);
    });
  });

  describe('search', () => {
    it('按 value 全文搜索', () => {
      const store = createMemoryStore(testDir);
      store.set({ key: 'note.1', value: 'Hello World React', source: 's', confidence: 1, tags: ['react'] });
      store.set({ key: 'note.2', value: 'Vue is also good', source: 's', confidence: 1, tags: ['vue'] });

      const results = store.search('react');
      expect(results.length).toBe(1);
      expect(results[0]!.key).toBe('note.1');
    });

    it('按 tag 搜索', () => {
      const store = createMemoryStore(testDir);
      store.set({ key: 'x.1', value: 'foo', source: 's', confidence: 1, tags: ['urgent'] });
      store.set({ key: 'x.2', value: 'bar', source: 's', confidence: 1, tags: ['normal'] });

      const results = store.search('urgent');
      expect(results.length).toBe(1);
      expect(results[0]!.key).toBe('x.1');
    });

    it('大小写不敏感搜索', () => {
      const store = createMemoryStore(testDir);
      store.set({ key: 'x.1', value: 'TypeScript', source: 's', confidence: 1, tags: [] });
      expect(store.search('typescript').length).toBe(1);
    });
  });

  describe('存储格式', () => {
    it('事实以 Markdown 单文件存储', () => {
      const store = createMemoryStore(testDir);
      const id = store.set({
        key: 'fmt.test',
        value: 'some content',
        source: 'unit-test',
        confidence: 0.8,
        tags: ['test'],
      });

      // Markdown 文件在 data/memory/__default__/ 或 data/memory/fmt/
      const memoryRoot = join(testDir, 'memory');
      // key "fmt.test" → bucket = "fmt"
      const factPath = join(memoryRoot, 'fmt', `${id}.md`);
      expect(existsSync(factPath)).toBe(true);

      const content = readFileSync(factPath, 'utf-8');
      // YAML frontmatter
      expect(content).toContain('---');
      expect(content).toContain(`id: ${id}`);
      expect(content).toContain('key: "fmt.test"');
      expect(content).toContain('confidence: 0.8');
      // 正文
      expect(content).toContain('some content');
    });

    it('memory.json 索引文件存在且正确', () => {
      const store = createMemoryStore(testDir);
      store.set({ key: 'idx.1', value: 'v', source: 's', confidence: 1, tags: [] });

      const indexPath = join(testDir, 'memory', 'memory.json');
      expect(existsSync(indexPath)).toBe(true);
      const index = JSON.parse(readFileSync(indexPath, 'utf-8'));
      expect(index['idx.1']).toBeTruthy();
    });

    it('无点号的 key 归入 __default__ 桶', () => {
      const store = createMemoryStore(testDir);
      const id = store.set({
        key: 'plainkey',
        value: 'v',
        source: 's',
        confidence: 1,
        tags: [],
      });

      const factPath = join(testDir, 'memory', '__default__', `${id}.md`);
      expect(existsSync(factPath)).toBe(true);
    });
  });

  describe('持久化', () => {
    it('重新创建 store 实例后数据仍在', () => {
      const store1 = createMemoryStore(testDir);
      store1.set({ key: 'persist.me', value: 'survive', source: 's', confidence: 1, tags: ['p'] });

      const store2 = createMemoryStore(testDir);
      const fact = store2.get('persist.me');
      expect(fact).not.toBeNull();
      expect(fact!.value).toBe('survive');
      expect(fact!.tags).toEqual(['p']);
    });
  });
});
