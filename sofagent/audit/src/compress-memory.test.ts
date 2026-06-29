// ============================================================
// compress-memory.test.ts · 压缩/归档/摘要测试
// v0.97 新增
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { archiveOldEntries, rotateBackups, extractSummary } from './compress-memory';

function tmpDir(): string {
  const dir = join(tmpdir(), `sofagent-test-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('compress-memory', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = tmpDir();
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
  });

  describe('archiveOldEntries', () => {
    it('think.md 不存在时返回 0', () => {
      expect(archiveOldEntries(testDir)).toBe(0);
    });

    it('think.md 存在但无旧条目时返回 0', () => {
      const content = '## 2026-06-28\n- #超时 新问题\n';
      writeFileSync(join(testDir, 'think.md'), content);
      expect(archiveOldEntries(testDir)).toBe(0);
    });

    it('60 天前的条目被正确归档', () => {
      const sixtyDaysAgo = new Date(Date.now() - 61 * 24 * 3600 * 1000);
      const oldDate = sixtyDaysAgo.toISOString().slice(0, 10);
      const content = `## ${oldDate}\n- #超时 旧问题\n\n## 2026-06-28\n- #权限 新问题\n`;
      writeFileSync(join(testDir, 'think.md'), content);

      const moved = archiveOldEntries(testDir);
      expect(moved).toBeGreaterThanOrEqual(1);

      // 检查归档文件
      const archivePath = join(testDir, 'think.archive.md');
      expect(existsSync(archivePath)).toBe(true);
      const archiveContent = readFileSync(archivePath, 'utf-8');
      expect(archiveContent).toContain('#超时');

      // 活跃文件不应包含旧条目
      const activeContent = readFileSync(join(testDir, 'think.md'), 'utf-8');
      expect(activeContent).not.toContain(oldDate);
      expect(activeContent).toContain('2026-06-28');
    });
  });

  describe('rotateBackups', () => {
    it('think.md 不存在时返回 null', () => {
      expect(rotateBackups(testDir)).toBeNull();
    });

    it('创建新的备份文件', () => {
      writeFileSync(join(testDir, 'think.md'), '# test content');
      const backup = rotateBackups(testDir);
      expect(backup).not.toBeNull();
      expect(existsSync(backup!)).toBe(true);
      const dateStr = new Date().toISOString().slice(0, 10);
      expect(backup).toContain(dateStr);
    });

    it('超过 3 份备份时删除最旧的', () => {
      writeFileSync(join(testDir, 'think.md'), '# test content');

      // 创建 4 份旧备份
      for (let i = 1; i <= 4; i++) {
        writeFileSync(join(testDir, `think.2026-06-0${i}.bak`), `backup ${i}`);
      }

      const backup = rotateBackups(testDir);
      expect(backup).not.toBeNull();

      // 应有 3 份备份 + 最新
      const files = require('fs').readdirSync(testDir).filter((f: string) => f.startsWith('think.') && f.endsWith('.bak'));
      expect(files.length).toBeLessThanOrEqual(4); // 3 old + 1 new
    });
  });

  describe('extractSummary', () => {
    it('think.md 不存在时返回空数组', () => {
      expect(extractSummary(testDir)).toEqual([]);
    });

    it('提取最近条目的标签和结论', () => {
      const content = '## 2026-06-28\n- #超时 任务超时问题，下次需要加长超时时间\n\n## 2026-06-27\n- #权限 文件权限问题\n';
      writeFileSync(join(testDir, 'think.md'), content);

      const summary = extractSummary(testDir, 2);
      expect(summary.length).toBe(2);
      expect(summary[0]!.label).toBe('#超时');
    });

    it('无标签的条目默认为"未分类"', () => {
      const content = '## 2026-06-28\n没有标签的条目\n';
      writeFileSync(join(testDir, 'think.md'), content);

      const summary = extractSummary(testDir);
      expect(summary.length).toBe(1);
      expect(summary[0]!.label).toBe('未分类');
    });

    it('limit 参数限制返回数量', () => {
      let content = '';
      for (let i = 1; i <= 5; i++) {
        content += `## 2026-06-0${i}\n- #标签${i} 结论${i}\n\n`;
      }
      writeFileSync(join(testDir, 'think.md'), content);

      expect(extractSummary(testDir, 3).length).toBe(3);
      expect(extractSummary(testDir, 10).length).toBe(5);
    });
  });
});
