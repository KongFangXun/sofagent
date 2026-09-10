// cli-start-crypto.test.ts · 章十四 静态加密 daemon start 接线测试
//
// 验证 cli.ts start 路径的 initDataEncryption 接线行为：
//   ① 交互环境（TTY）→ 生成密钥 + initialized 标记 + ok
//   ② 非交互环境 → WARN 不 FAIL（跳过生成——明文兼容）
//   ③ 幂等：已有密钥再调 → already-initialized ok
//   ④ 密钥就绪后 appendHistory 密文落盘（SOFAGENT-AGE-V1）
//   ⑤ 既有明文历史可读（读侧 auto-detect 不回填）
//
// fake 注入：SOFAGENT_HOME 指向 tmp 目录（零真实 ~/.sofagent 触碰）。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-crypto-cli-'));

// 隔离环境：SOFAGENT_HOME 指向 tmp（resolveHomeDir 消费此 env）
process.env.SOFAGENT_HOME = tmpHome;

const { initDataEncryption } = await import('../crypto-init');
const { generateDataKey, loadDataKey, isInitialized } = await import('@sofagent/core');

beforeEach(() => {
  fs.rmSync(path.join(tmpHome, 'keys'), { recursive: true, force: true });
  fs.rmSync(path.join(tmpHome, '.sofagent-initialized'), { force: true });
});

afterEach(() => {
  fs.rmSync(path.join(tmpHome, 'keys'), { recursive: true, force: true });
  fs.rmSync(path.join(tmpHome, '.sofagent-initialized'), { force: true });
});

describe('章十四：daemon start 加密引导接线（initDataEncryption）', () => {
  it('① 交互环境 → 生成密钥 + initialized 标记 + ok', () => {
    const r = initDataEncryption(tmpHome, { interactive: true });
    expect(r.status).toBe('ok');
    expect(r.action).toBe('generated');
    expect(r.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    // 密钥落盘 + 标记落盘
    expect(loadDataKey(tmpHome)).not.toBeNull();
    expect(isInitialized(tmpHome)).toBe(true);
  });

  it('② 非交互环境 → WARN 不 FAIL（跳过生成——明文兼容）', () => {
    const r = initDataEncryption(tmpHome, { interactive: false });
    expect(r.status).toBe('warn');
    expect(r.action).toBe('skipped-non-interactive');
    // 无密钥无标记（不半初始化）
    expect(loadDataKey(tmpHome)).toBeNull();
    expect(isInitialized(tmpHome)).toBe(false);
  });

  it('③ 幂等：已有密钥再调 → already-initialized ok', () => {
    initDataEncryption(tmpHome, { interactive: true });
    const again = initDataEncryption(tmpHome, { interactive: true });
    expect(again.status).toBe('ok');
    expect(again.action).toBe('already-initialized');
  });

  it('④ 密钥就绪后 appendHistory 密文落盘（SOFAGENT-AGE-V1 前缀）', async () => {
    // 生成密钥（激活加密）
    initDataEncryption(tmpHome, { interactive: true });
    const { appendHistory } = await import('@sofagent/audit');
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-crypto-data-'));
    try {
      appendHistory(
        {
          timestamp: new Date().toISOString(),
          diffRange: 'HEAD~1..HEAD',
          exitCode: 0,
          ruleResults: [],
          diffFileCount: 1,
        },
        dataDir,
      );
      const content = fs.readFileSync(path.join(dataDir, 'audit', 'history.jsonl'), 'utf-8');
      expect(content).toContain('SOFAGENT-AGE-V1');
      // 明文 JSON 不在文件中（密文落盘）
      expect(content).not.toContain('"diffRange"');
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('⑤ 既有明文历史可读（读侧 auto-detect 不回填）', async () => {
    initDataEncryption(tmpHome, { interactive: true });
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-crypto-plain-'));
    try {
      // 先写一条明文历史（模拟加密激活前的旧记录）
      const histPath = path.join(dataDir, 'audit', 'history.jsonl');
      fs.mkdirSync(path.dirname(histPath), { recursive: true });
      const legacy = {
        timestamp: '2026-01-01T00:00:00Z',
        diffRange: 'HEAD~2..HEAD~1',
        exitCode: 0,
        ruleResults: [],
        diffFileCount: 3,
      };
      fs.writeFileSync(histPath, JSON.stringify(legacy) + '\n', 'utf-8');

      const { loadHistory } = await import('@sofagent/audit');
      const entries = loadHistory(10, dataDir);
      // 明文旧记录在密钥激活态下仍可读（auto-detect）
      expect(entries.length).toBe(1);
      expect(entries[0].diffRange).toBe('HEAD~2..HEAD~1');
      // 读侧不回填（文件内容不变——仍明文）
      const after = fs.readFileSync(histPath, 'utf-8');
      expect(after).not.toContain('SOFAGENT-AGE-V1');
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
