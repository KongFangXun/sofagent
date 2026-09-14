// ============================================================
// skill-snapshot.test.ts · T10 第三项：执行时 skill 快照单测
// ============================================================
//
// 覆盖面（changelog 十章验收 + 铁律 8 故障注入）：
//   1. collectSkillFiles：正常收集（含子目录，字典序）/ 目录不存在 → 空数组
//      / 非 .md 文件排除
//   2. snapshotSkills：打包落盘（文件复制保相对路径）/ 清单条目
//      （name + mtime 版本 + sha256 前 16 位）/ manifest 落盘可读 /
//      审计锚点进 decision-log（evidence 逐条 name@version sha256）
//   3. cleanupSnapshot：执行后清理零残留（文件系统断言）/ 幂等（重复清理安全）/
//      只删本会话不动兄弟会话
//   4. 版本可证（验收 ③）：两次执行间更新 skill → 第二次快照 sha256 变化
//   5. readSnapshotManifest：清理前可读 / 清理后 null / 损坏 manifest → null
//   6. 空 skillRoot：空清单照样走完流程（审计记录「当时无 skill 资产」）
//
// 测试隔离：mkdtemp 临时 dataDir + skillRoot；SOFAGENT_KEY_PATH 指向
// 临时密钥（emitDecision HMAC 路径，不触碰真实 ~/.sofagent-key）。
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getDecisionLogPath } from '@sofagent/core';
import {
  collectSkillFiles,
  snapshotSkills,
  cleanupSnapshot,
  readSnapshotManifest,
} from '../exec/skill-snapshot';

const tmpDirs: string[] = [];

function mkDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

/** 造一棵最小 skill 树（harness/x.md + skills/y.md + rules/z.md + 一个非 md 文件） */
function mkSkillRoot(): string {
  const root = mkDir('sofagent-skill-root-');
  fs.mkdirSync(path.join(root, 'harness'), { recursive: true });
  fs.mkdirSync(path.join(root, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(root, 'rules'), { recursive: true });
  fs.mkdirSync(path.join(root, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(root, 'harness', 'installer.md'), '# Installer v1\n内容甲\n', 'utf-8');
  fs.writeFileSync(path.join(root, 'skills', '01-entry.md'), '# Entry\n内容乙\n', 'utf-8');
  fs.writeFileSync(path.join(root, 'SKILL.md'), '# Skill 主文件\n', 'utf-8');
  fs.writeFileSync(path.join(root, 'rules', 'core-rules.md'), '# Rules\n内容丙\n', 'utf-8');
  fs.writeFileSync(path.join(root, 'agents', 'ignored.txt'), '非 md 不进快照\n', 'utf-8');
  return root;
}

describe('T10 第三项 · 执行时 skill 快照（skill-snapshot）', () => {
  beforeAll(() => {
    const keyDir = mkDir('sofagent-key-snap-');
    const keyPath = path.join(keyDir, '.sofagent-key');
    fs.writeFileSync(keyPath, 'test-hmac-key-snapshot-0123456', 'utf-8');
    process.env.SOFAGENT_KEY_PATH = keyPath;
  });

  afterAll(() => {
    delete process.env.SOFAGENT_KEY_PATH;
    for (const d of tmpDirs) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });

  // ── 1. 收集 ──
  describe('collectSkillFiles', () => {
    it('正常收集：递归含子目录、字典序、排除非 .md', () => {
      const root = mkSkillRoot();
      const files = collectSkillFiles(root);
      expect(files).toEqual(['SKILL.md', 'harness/installer.md', 'rules/core-rules.md', 'skills/01-entry.md']);
    });

    it('目录不存在 → 空数组（base-only 裸安装合法形态）', () => {
      expect(collectSkillFiles(path.join(os.tmpdir(), 'definitely-not-exist-' + Date.now()))).toEqual([]);
    });
  });

  // ── 2. 打包 ──
  describe('snapshotSkills（打包 + 清单 + 审计锚点）', () => {
    it('打包落盘：文件复制保相对路径，清单条目带 sha256 前 16 位', () => {
      const dataDir = mkDir('sofagent-snap-data-');
      const skillRoot = mkSkillRoot();
      const r = snapshotSkills({ skillRoot, sessionId: 'sess-pack-1', dataDir, agentId: 'agent-snap-1' });

      expect(r.packages).toHaveLength(4);
      const installer = r.packages.find((p) => p.name === 'harness/installer.md')!;
      expect(installer.sha256).toMatch(/^[0-9a-f]{16}$/);
      // 快照文件系统侧：复制保相对路径
      const copied = fs.readFileSync(path.join(r.snapshotDir, 'harness', 'installer.md'), 'utf-8');
      expect(copied).toBe('# Installer v1\n内容甲\n');
      // manifest 落盘可读
      const manifest = readSnapshotManifest(dataDir, 'sess-pack-1')!;
      expect(manifest.sessionId).toBe('sess-pack-1');
      expect(manifest.packages).toHaveLength(4);
    });

    it('审计锚点：decision-log 有对应记录，evidence 逐条 name@version sha256', () => {
      const dataDir = mkDir('sofagent-snap-data-');
      const skillRoot = mkSkillRoot();
      const r = snapshotSkills({ skillRoot, sessionId: 'sess-audit-1', dataDir, agentId: 'agent-snap-2' });

      const lines = fs.readFileSync(getDecisionLogPath(dataDir), 'utf-8').trim().split('\n');
      const entry = lines.map((l) => JSON.parse(l)).find((e: { ts: string }) => e.ts === r.decisionTs) as {
        kind: string;
        sessionId: string;
        evidence: string[];
        engine: string;
      };
      expect(entry).toBeDefined();
      expect(entry.kind).toBe('ORCHESTRATION');
      expect(entry.sessionId).toBe('sess-audit-1');
      expect(entry.engine).toBe('sofagent-orchestrator/skill-snapshot');
      expect(entry.evidence).toHaveLength(4);
      const ev = entry.evidence.find((e: string) => e.startsWith('harness/installer.md@'))!;
      expect(ev).toContain(`sha256=${r.packages.find((p) => p.name === 'harness/installer.md')!.sha256}`);
    });

    it('两次执行间更新 skill → 第二次快照 sha256 变化（验收 ③ 版本可证）', () => {
      const dataDir = mkDir('sofagent-snap-data-');
      const skillRoot = mkSkillRoot();
      const first = snapshotSkills({ skillRoot, sessionId: 'sess-v1', dataDir, agentId: 'agent-snap-3' });
      // 更新一个 skill 文件（版本演进）
      fs.writeFileSync(path.join(skillRoot, 'harness', 'installer.md'), '# Installer v2\n内容甲已改\n', 'utf-8');
      const second = snapshotSkills({ skillRoot, sessionId: 'sess-v2', dataDir, agentId: 'agent-snap-3' });

      const firstSha = first.packages.find((p) => p.name === 'harness/installer.md')!.sha256;
      const secondSha = second.packages.find((p) => p.name === 'harness/installer.md')!.sha256;
      expect(firstSha).not.toBe(secondSha); // 第二次执行用的是新版本（快照清单可证）
      // 未变的文件 sha 稳定（快照可复现性）
      expect(first.packages.find((p) => p.name === 'skills/01-entry.md')!.sha256)
        .toBe(second.packages.find((p) => p.name === 'skills/01-entry.md')!.sha256);
    });

    it('空 skillRoot → 空清单照样走完流程（审计记录「无 skill 资产」事实）', () => {
      const dataDir = mkDir('sofagent-snap-data-');
      const emptyRoot = mkDir('sofagent-skill-empty-'); // 存在但空
      const r = snapshotSkills({ skillRoot: emptyRoot, sessionId: 'sess-empty', dataDir, agentId: 'agent-snap-4' });
      expect(r.packages).toEqual([]);
      const lines = fs.readFileSync(getDecisionLogPath(dataDir), 'utf-8').trim().split('\n');
      const entry = lines.map((l) => JSON.parse(l)).find((e: { ts: string }) => e.ts === r.decisionTs) as { evidence: string[] };
      expect(entry.evidence).toEqual([]);
    });
  });

  // ── 3. 清理 ──
  describe('cleanupSnapshot（执行后零残留）', () => {
    it('清理后文件系统断言零残留（验收 ②）', () => {
      const dataDir = mkDir('sofagent-snap-data-');
      const skillRoot = mkSkillRoot();
      const r = snapshotSkills({ skillRoot, sessionId: 'sess-clean-1', dataDir, agentId: 'agent-snap-5' });
      expect(fs.existsSync(r.snapshotDir)).toBe(true);
      cleanupSnapshot(dataDir, 'sess-clean-1');
      expect(fs.existsSync(r.snapshotDir)).toBe(false); // 零残留
      // skill-snapshots 父目录保留（其他会话可能还在）但本会话目录消失
      expect(readSnapshotManifest(dataDir, 'sess-clean-1')).toBeNull();
    });

    it('幂等：重复清理安全（不抛错）', () => {
      const dataDir = mkDir('sofagent-snap-data-');
      cleanupSnapshot(dataDir, 'never-existed'); // 目录不存在 → 无操作
      cleanupSnapshot(dataDir, 'never-existed'); // 再来一次也不炸
      expect(fs.existsSync(path.join(dataDir, 'skill-snapshots'))).toBe(false);
    });

    it('只删本会话目录，不动兄弟会话', () => {
      const dataDir = mkDir('sofagent-snap-data-');
      const skillRoot = mkSkillRoot();
      const a = snapshotSkills({ skillRoot, sessionId: 'sess-sib-a', dataDir, agentId: 'agent-snap-6' });
      snapshotSkills({ skillRoot, sessionId: 'sess-sib-b', dataDir, agentId: 'agent-snap-6' });
      cleanupSnapshot(dataDir, 'sess-sib-a');
      expect(fs.existsSync(a.snapshotDir)).toBe(false);
      expect(readSnapshotManifest(dataDir, 'sess-sib-b')).not.toBeNull(); // 兄弟会话完好
    });
  });

  // ── 4. manifest 读侧 ──
  describe('readSnapshotManifest（读侧与故障注入）', () => {
    it('损坏 manifest（非法 JSON）→ null（观测面不抛错）', () => {
      const dataDir = mkDir('sofagent-snap-data-');
      const dir = path.join(dataDir, 'skill-snapshots', 'sess-broken');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'snapshot-manifest.json'), '{broken!!', 'utf-8');
      expect(readSnapshotManifest(dataDir, 'sess-broken')).toBeNull();
    });

    it('清理后读 → null（审计链 evidence 才是持久证据）', () => {
      const dataDir = mkDir('sofagent-snap-data-');
      const skillRoot = mkSkillRoot();
      const r = snapshotSkills({ skillRoot, sessionId: 'sess-read-1', dataDir, agentId: 'agent-snap-7' });
      expect(readSnapshotManifest(dataDir, 'sess-read-1')).not.toBeNull();
      cleanupSnapshot(dataDir, 'sess-read-1');
      expect(readSnapshotManifest(dataDir, 'sess-read-1')).toBeNull();
      // 但决策日志仍在（回放可查）
      const lines = fs.readFileSync(getDecisionLogPath(dataDir), 'utf-8').trim().split('\n');
      expect(lines.some((l) => JSON.parse(l).ts === r.decisionTs)).toBe(true);
    });
  });
});
