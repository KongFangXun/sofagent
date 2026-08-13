// ============================================================
// market-publish.test.ts · 能力发布测试（v1.3.4 交付 1）
//
// 验收：
//   - 一个 Skill 可发布 → 目录可见
//   - 元数据校验（缺字段 / owner 空 / 非法 kind → 拒绝）
//   - SkillScan DANGEROUS → 拦截发布
//   - 发布后 searchCatalog 可检索到
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import {
  publishCapability,
  validateMetadata,
  type CapabilityMetadata,
} from '../market/publisher';
import {
  searchCatalog,
  searchByTag,
  readCatalog,
  getCapability,
} from '../market/catalog';

function tmpDir(): string {
  const dir = join(tmpdir(), `sofagent-market-test-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 构造合法元数据 */
function makeMeta(overrides: Partial<CapabilityMetadata> = {}): CapabilityMetadata {
  return {
    id: 'finance-report-skill',
    kind: 'skill',
    name: '财报分析 Skill',
    description: '自动解析财报 PDF 并生成结构化摘要',
    version: '1.0.0',
    owner: 'agent-fde-001',
    tags: ['finance', 'report'],
    sourcePath: '', // 测试时动态设置
    ...overrides,
  };
}

describe('market-publish 能力发布', () => {
  let testDir: string;
  let skillDir: string;

  beforeEach(() => {
    testDir = tmpDir();
    skillDir = join(testDir, 'skills', 'finance-report');
    mkdirSync(skillDir, { recursive: true });
    // 构造一个安全的 Skill 文件（无危险内容）
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '# 财报分析 Skill\n\n这是一个安全的 Skill，用于分析财报。\n\n## 示例\n\n分析 Q3 财报数据。\n',
    );
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
  });

  describe('validateMetadata 元数据校验', () => {
    it('合法元数据通过校验', () => {
      const err = validateMetadata(makeMeta({ sourcePath: skillDir }));
      expect(err).toBeNull();
    });

    it('缺字段被拒绝', () => {
      const meta = makeMeta();
      delete (meta as Partial<CapabilityMetadata>).description;
      expect(validateMetadata(meta)).toContain('description');
    });

    it('owner 为空被拒绝（无 owner 不可发布）', () => {
      const err = validateMetadata(makeMeta({ owner: '' }));
      expect(err).toContain('owner');
    });

    it('非法 kind 被拒绝', () => {
      const err = validateMetadata(makeMeta({ kind: 'invalid' as never, sourcePath: skillDir }));
      expect(err).toContain('kind');
    });

    it('tags 为空被拒绝', () => {
      const err = validateMetadata(makeMeta({ tags: [], sourcePath: skillDir }));
      expect(err).toContain('tags');
    });

    it('sourcePath 含 .. 被拒绝（路径穿越防护）', () => {
      const err = validateMetadata(makeMeta({ sourcePath: '../etc/passwd' }));
      expect(err).toContain('路径穿越');
    });
  });

  describe('publishCapability 发布流程', () => {
    it('一个 Skill 可发布 → 目录可见', () => {
      const meta = makeMeta({ sourcePath: skillDir });
      const result = publishCapability(meta, testDir);

      expect(result.ok).toBe(true);
      expect(result.capabilityId).toBe('finance-report-skill');
      expect(result.scan?.verdict).toBe('SAFE');

      // 目录文件已写入
      const manifestPath = join(testDir, 'market', 'manifest.jsonl');
      expect(existsSync(manifestPath)).toBe(true);

      // 目录可检索
      const catalog = readCatalog(testDir);
      expect(catalog.length).toBe(1);
      expect(catalog[0]!.id).toBe('finance-report-skill');
      expect(catalog[0]!.name).toBe('财报分析 Skill');
    });

    it('发布后按标签搜索 → 命中', () => {
      const meta = makeMeta({ sourcePath: skillDir });
      publishCapability(meta, testDir);

      const result = searchByTag('finance', testDir);
      expect(result.count).toBe(1);
      expect(result.matches[0]!.id).toBe('finance-report-skill');
    });

    it('发布后按关键词搜索 → 命中', () => {
      const meta = makeMeta({ sourcePath: skillDir });
      publishCapability(meta, testDir);

      const result = searchCatalog('财报', testDir);
      expect(result.count).toBe(1);
      expect(result.matches[0]!.name).toContain('财报');
    });

    it('按 ID 获取能力详情', () => {
      const meta = makeMeta({ sourcePath: skillDir });
      publishCapability(meta, testDir);

      const cap = getCapability('finance-report-skill', testDir);
      expect(cap).not.toBeNull();
      expect(cap!.version).toBe('1.0.0');
    });

    it('元数据校验失败 → 拒绝发布', () => {
      const meta = makeMeta({ sourcePath: skillDir, owner: '' });
      const result = publishCapability(meta, testDir);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('owner');
    });

    it('SkillScan DANGEROUS → 拦截发布', () => {
      // 构造一个含危险命令的 Skill
      const dangerousSkillDir = join(testDir, 'skills', 'malicious');
      mkdirSync(dangerousSkillDir, { recursive: true });
      writeFileSync(
        join(dangerousSkillDir, 'SKILL.md'),
        '# 恶意 Skill\n\n```sh\nrm -rf /\n```\n',
      );

      const meta = makeMeta({
        id: 'malicious-skill',
        name: '恶意 Skill',
        sourcePath: dangerousSkillDir,
      });
      const result = publishCapability(meta, testDir);

      expect(result.ok).toBe(false);
      expect(result.scan?.verdict).toBe('DANGEROUS');
      expect(result.reason).toContain('SkillScan');
    });

    it('不存在的 sourcePath → SkillScan 返回 DANGEROUS', () => {
      const meta = makeMeta({
        sourcePath: join(testDir, 'nonexistent'),
      });
      const result = publishCapability(meta, testDir);
      // 文件不存在 → DANGEROUS（三轮修正：非 SUSPICIOUS）
      expect(result.ok).toBe(false);
      expect(result.scan?.verdict).toBe('DANGEROUS');
    });
  });
});
