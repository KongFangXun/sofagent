// ============================================================
// doctor-refresh.test.ts · v1.5.3 章四 doctor --refresh 回归锁
// ============================================================
// 三段验收（备份 → 重置默认 → diff 报告）+ 备份保留（最近 N 份）+ 留痕。
// 全程沙箱：mkdtempSync 临时项目目录，绝不触碰真实仓库/真实 ~/.sofagent。
// 回滚演练：refresh 两轮 → 断言旧备份超保留数被清理 → 拷回即回滚（模拟验证）。
// ============================================================
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runDoctorRefresh, type DoctorRefreshResult } from '../doctor';
import { CONFIG_TEMPLATE } from '../config-template';

const SANDBOXES: string[] = [];

/** 新建沙箱项目目录（含/不含既有 config.yml 可选） */
function sandbox(withConfig = true, configBody = '# 旧配置\naudit:\n  lowRiskPatterns:\n    - legacy.lock\n'): string {
  const dir = mkdtempSync(join(tmpdir(), 'sofagent-refresh-test-'));
  SANDBOXES.push(dir);
  if (withConfig) {
    mkdirSync(join(dir, '.sofagent'), { recursive: true });
    writeFileSync(join(dir, '.sofagent', 'config.yml'), configBody, 'utf-8');
  }
  return dir;
}

afterEach(() => {
  while (SANDBOXES.length) {
    const d = SANDBOXES.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

/** 固定时钟（备份名时间戳可断言） */
const FIXED_NOW = () => new Date('2026-09-26T08:00:00.000Z');

/** 收集留痕的注入面（避免测试触真实 decision-log） */
function collectDecisions(): { entries: Array<{ ts: string; why: string; evidence: string[] }>; write: (e: { ts: string; why: string; evidence: string[] }) => void } {
  const entries: Array<{ ts: string; why: string; evidence: string[] }> = [];
  return { entries, write: (e) => { entries.push(e); } };
}

describe('doctor --refresh（v1.5.3 章四 · 三段闭环）', () => {
  it('① 备份段：既有 config.yml 被备份到时间戳文件（原文逐字节可回读）', () => {
    const dir = sandbox(true, '# my precious\naudit:\n  carefulModifyThreshold: 0.9\n');
    const { entries, write } = collectDecisions();
    const r = runDoctorRefresh(dir, { now: FIXED_NOW, writeDecision: write });
    expect(r.backupPath).toBeTruthy();
    expect(r.backupPath && existsSync(r.backupPath)).toBe(true);
    // 备份内容 = 旧配置原文（回滚演练的信任基础）
    expect(readFileSync(r.backupPath!, 'utf-8')).toBe('# my precious\naudit:\n  carefulModifyThreshold: 0.9\n');
    // 留痕：注入面收到 CONFIG_CHANGE 记录（why + evidence 含备份路径）
    expect(entries.length).toBe(1);
    expect(entries[0]!.evidence.join(' ')).toContain(r.backupPath!);
    expect(r.decisionTs).toBe(FIXED_NOW().toISOString());
  });

  it('② 重置段：config.yml 被覆写为 CONFIG_TEMPLATE（与 --init 同源模板）', () => {
    const dir = sandbox(true, '# 完全不同的旧内容\n');
    const r = runDoctorRefresh(dir, { now: FIXED_NOW, writeDecision: collectDecisions().write });
    expect(readFileSync(join(dir, '.sofagent', 'config.yml'), 'utf-8')).toBe(CONFIG_TEMPLATE);
    expect(r.configPath).toBe(join(dir, '.sofagent', 'config.yml'));
  });

  it('③ 报告段：diff 统计旧→新（旧行计 removed、模板行计 added）', () => {
    const dir = sandbox(true, '# 旧配置\naudit:\n  lowRiskPatterns:\n    - legacy.lock\n');
    const r = runDoctorRefresh(dir, { now: FIXED_NOW, writeDecision: collectDecisions().write });
    // 旧配置 4 行（含末尾空行）中至少 1 行不在模板里 ⇒ removed ≥ 1
    expect(r.diff.removed).toBeGreaterThanOrEqual(1);
    // 模板 106 行远多于旧配置 ⇒ added 应大量出现
    expect(r.diff.added).toBeGreaterThan(10);
  });

  it('首次初始化形态（无既有配置）：跳过备份段、直接生成默认配置', () => {
    const dir = sandbox(false);
    const r = runDoctorRefresh(dir, { now: FIXED_NOW, writeDecision: collectDecisions().write });
    expect(r.backupPath).toBeNull();
    expect(existsSync(join(dir, '.sofagent', 'config.yml'))).toBe(true);
    expect(readFileSync(join(dir, '.sofagent', 'config.yml'), 'utf-8')).toBe(CONFIG_TEMPLATE);
  });

  it('备份保留：连跑 5 轮（keep=3）→ 只留最近 3 份，最旧 2 份被清理', () => {
    const dir = sandbox(true);
    let minute = 0;
    const tick = () => { minute += 1; return new Date(2026, 8, 26, 8, minute, 0); };
    for (let i = 0; i < 5; i++) {
      runDoctorRefresh(dir, { now: tick, writeDecision: collectDecisions().write });
    }
    const backupDir = join(dir, '.sofagent', 'backups', 'config');
    const backups = readdirSync(backupDir).filter((f) => f.startsWith('config-'));
    expect(backups.length).toBe(3);
    // 字典序 = 时间序：留的是最晚 3 份（tick 从分钟 1 起，第 5 轮 = 08:05；文件名 HHMMSS）
    expect(backups).toEqual([
      'config-20260926-080300.yml',
      'config-20260926-080400.yml',
      'config-20260926-080500.yml',
    ]);
  });

  it('回滚演练：refresh 后把备份拷回 → config.yml 恢复旧原文（备份即回滚介质）', () => {
    const dir = sandbox(true, '# ORIGINAL-CONFIG-BODY\naudit: {}\n');
    const r: DoctorRefreshResult = runDoctorRefresh(dir, { now: FIXED_NOW, writeDecision: collectDecisions().write });
    // 重置后已非旧内容
    expect(readFileSync(join(dir, '.sofagent', 'config.yml'), 'utf-8')).not.toContain('ORIGINAL-CONFIG-BODY');
    // 回滚 = 拷回备份（refresh 报告中给出的回滚命令语义）
    copyFileSync(r.backupPath!, join(dir, '.sofagent', 'config.yml'));
    expect(readFileSync(join(dir, '.sofagent', 'config.yml'), 'utf-8')).toBe('# ORIGINAL-CONFIG-BODY\naudit: {}\n');
  });

  it('SOFAGENT_REFRESH_KEEP 覆盖保留份数（keep=1 → 5 轮后只剩最新 1 份）', () => {
    const dir = sandbox(true);
    const savedKeep = process.env.SOFAGENT_REFRESH_KEEP;
    try {
      process.env.SOFAGENT_REFRESH_KEEP = '1';
      let minute = 0;
      const tick = () => { minute += 1; return new Date(2026, 8, 26, 9, minute, 0); };
      for (let i = 0; i < 5; i++) {
        runDoctorRefresh(dir, { now: tick, writeDecision: collectDecisions().write });
      }
      const backups = readdirSync(join(dir, '.sofagent', 'backups', 'config')).filter((f) => f.startsWith('config-'));
      expect(backups).toEqual(['config-20260926-090500.yml']);
    } finally {
      if (savedKeep === undefined) delete process.env.SOFAGENT_REFRESH_KEEP;
      else process.env.SOFAGENT_REFRESH_KEEP = savedKeep;
    }
  });

  it('留痕失败不阻断 refresh（注入面抛错 → decisionTs=null 但 ok=true）', () => {
    const dir = sandbox(true);
    const boom = () => { throw new Error('decision-log 不可用'); };
    const r = runDoctorRefresh(dir, { now: FIXED_NOW, writeDecision: boom });
    expect(r.ok).toBe(true);
    expect(r.decisionTs).toBeNull();
    expect(existsSync(join(dir, '.sofagent', 'config.yml'))).toBe(true);
  });
});
