// ============================================================
// native-gate.test.ts · 自研 gate 验证器测试（v1.4.8 ⑩）
// 无 Python 依赖端到端——验证命令是纯 node/bash。
// ============================================================
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runNativeGate } from '../native-gate';

const TMP = path.join(os.tmpdir(), `sofagent-native-gate-${process.pid}`);

beforeEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  // 正式位技能文件 + staging 候选
  fs.writeFileSync(path.join(TMP, 'SKILL.md'), '# 技能 v1\n原有内容\n');
  fs.mkdirSync(path.join(TMP, 'staging'));
  fs.writeFileSync(path.join(TMP, 'staging', 'SKILL.md'), '# 技能 v2\n候选内容\n');
  // 验证命令：staging 内跑一个输出分数的 node 一行流
  fs.writeFileSync(path.join(TMP, 'staging', 'eval.sh'), 'echo "score: 0.87"\n');
  fs.chmodSync(path.join(TMP, 'staging', 'eval.sh'), 0o755);
});
afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe('⑩ · 自研 gate 验证器（无 Python 依赖）', () => {
  it('首跑（无历史）→ adopt（任何有效分数 > -Inf）', () => {
    const v = runNativeGate({
      workDir: TMP,
      candidateDir: path.join(TMP, 'staging', 'SKILL.md'),
      targetDir: path.join(TMP, 'SKILL.md'),
      verifyCommand: 'echo "score: 0.87"',
    });
    expect(v.action).toBe('adopt');
    expect(v.score).toBe(0.87);
    // 候选已就位正式位
    expect(fs.readFileSync(path.join(TMP, 'SKILL.md'), 'utf-8')).toContain('候选内容');
  });

  it('分数优于历史 → adopt 且历史更新', () => {
    fs.writeFileSync(path.join(TMP, '.gate-history.json'), JSON.stringify({ bestScore: 0.8, updatedAt: '', adopted: 1, reverted: 0 }));
    const v = runNativeGate({
      workDir: TMP,
      candidateDir: path.join(TMP, 'staging', 'SKILL.md'),
      targetDir: path.join(TMP, 'SKILL.md'),
      verifyCommand: 'echo "score: 0.87"',
    });
    expect(v.action).toBe('adopt');
    const h = JSON.parse(fs.readFileSync(path.join(TMP, '.gate-history.json'), 'utf-8'));
    expect(h.bestScore).toBe(0.87);
    expect(h.adopted).toBe(2);
  });

  it('分数不优于历史 → revert（正式位保持旧内容）', () => {
    fs.writeFileSync(path.join(TMP, '.gate-history.json'), JSON.stringify({ bestScore: 0.9, updatedAt: '', adopted: 1, reverted: 0 }));
    const v = runNativeGate({
      workDir: TMP,
      candidateDir: path.join(TMP, 'staging', 'SKILL.md'),
      targetDir: path.join(TMP, 'SKILL.md'),
      verifyCommand: 'echo "score: 0.87"',
    });
    expect(v.action).toBe('revert');
    expect(v.basis).toContain('回滚');
    // 正式位还是旧内容
    expect(fs.readFileSync(path.join(TMP, 'SKILL.md'), 'utf-8')).toContain('原有内容');
  });

  it('验证命令失败 → fail-closed revert（不接受未验证技能）', () => {
    const v = runNativeGate({
      workDir: TMP,
      candidateDir: path.join(TMP, 'staging', 'SKILL.md'),
      targetDir: path.join(TMP, 'SKILL.md'),
      verifyCommand: 'exit 1',
    });
    expect(v.action).toBe('revert');
    expect(v.basis).toContain('fail-closed');
  });

  // ── v1.4.9 G-17 回归锁：adopt 必须无损 ──

  it('candidateDir === targetDir（自指）⇒ 不得删掉 live 文件', () => {
    // 旧实现：rmSync(targetDir) 先删掉 live（它同时就是 candidate），
    // 再 copyFileSync(candidateDir, targetDir) 拿已删的源拷贝 ⇒ ENOENT + live 永久丢失。
    const live = path.join(TMP, 'SKILL.md');
    const before = fs.readFileSync(live, 'utf-8');
    const v = runNativeGate({
      workDir: TMP,
      candidateDir: live, // 自指（旧实害入口）
      targetDir: live,
      verifyCommand: 'echo "score: 0.99"',
    });
    expect(v.action).toBe('adopt');
    expect(fs.existsSync(live)).toBe(true); // 旧实现此处为 false
    expect(fs.readFileSync(live, 'utf-8')).toBe(before);
  });

  it('adopt 后不留 .gate-tmp-* 临时文件（无损替换收尾干净）', () => {
    runNativeGate({
      workDir: TMP,
      candidateDir: path.join(TMP, 'staging', 'SKILL.md'),
      targetDir: path.join(TMP, 'SKILL.md'),
      verifyCommand: 'echo "score: 0.99"',
    });
    expect(fs.readdirSync(TMP).filter((f) => f.includes('gate-tmp'))).toEqual([]);
  });
});
