// ============================================================
// instinct.test.ts · instinct→skill 自动进化单测（v1.3.5 交付 3）
// ============================================================
//
// 覆盖四件各至少一 case：
//   1. 提取器：think.md + decision-log → instinct 模式
//   2. 评分器：出现次数 × 通过率，≥0.7 注入
//   3. 聚合器：相关 instinct → SKILL.md 写入运行时目录（非仓库 SKILL/）
//   4. 错题本：独立于 think.md，负样本单独加权
//
// 🔴 测试隔离纪律（dev-prompt 铁律）：
//   - vi.stubEnv('HOME', tmpdir) + SOFAGENT_DATA 指向 tmpdir
//   - 禁写真实 ~/.sofagent
//   - 不假设 HOME 路径形态（不用 homedir() 拼期望值）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  extractInstincts,
  parseThinkSections,
  normalizePattern,
  patternId,
} from '../instinct/extractor';
import {
  scoreInstinct,
  selectForInjection,
  renderInjectionBlock,
  DEFAULT_CONFIDENCE_THRESHOLD,
} from '../instinct/scorer';
import { evolveInstincts, resolveCustomSkillDir } from '../instinct/evolver';
import {
  appendFailure,
  readFailureLog,
  aggregateFailurePatterns,
  failureLogPath,
} from '../instinct/failure-log';

let tmpHome: string;
let tmpDataDir: string;
let tmpSkillDir: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-instinct-home-'));
  tmpDataDir = path.join(tmpHome, 'data');
  tmpSkillDir = path.join(tmpHome, 'skill', 'custom');
  fs.mkdirSync(tmpDataDir, { recursive: true });
  vi.stubEnv('HOME', tmpHome);
  vi.stubEnv('SOFAGENT_HOME', tmpHome);
  vi.stubEnv('SOFAGENT_DATA', tmpDataDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* */ }
});

// ────────────────────────────────────────────────────────────
// 1. 提取器
// ────────────────────────────────────────────────────────────

describe('instinct/extractor · 模式提取', () => {
  it('从 think.md 的 #教训 行提取模式，并按同节审计结局计 PASS/FAIL', () => {
    const thinkMd = [
      '## 2026-08-15 10:00 任务: 修复登录 bug',
      '- #审计结果(sofagent-audit v1.3.4): PASS — 0 条规则触发',
      '- #改动范围: 改了 2 个文件（a.ts, b.ts）',
      '- #教训: 改接口前先读调用方；本次改动符合规范',
      '',
      '## 2026-08-15 11:00 任务: 重构支付模块',
      '- #审计结果(sofagent-audit v1.3.4): FAIL — 2 条规则触发',
      '- #改动范围: 改了 5 个文件（c.ts）',
      '- #教训: 改接口前先读调用方',
      '',
      '## 2026-08-15 12:00 任务: 补测试',
      '- #审计结果(sofagent-audit v1.3.4): PASS — 0 条规则触发',
      '- #改动范围: 改了 1 个文件（d.ts）',
      '- #教训: 改接口前先读调用方',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(tmpDataDir, 'think.md'), thinkMd, 'utf-8');

    const items = extractInstincts({ dataDir: tmpDataDir });
    const target = items.find((i) => i.pattern === '改接口前先读调用方');
    expect(target).toBeDefined();
    expect(target!.occurrences).toBe(3);
    expect(target!.passCount).toBe(2);
    expect(target!.failCount).toBe(1);
    expect(target!.source).toBe('think');
  });

  it('从 decision-log.jsonl 提取决策模式（why.text）', () => {
    const logDir = path.join(tmpDataDir, 'audit');
    fs.mkdirSync(logDir, { recursive: true });
    const lines = [
      JSON.stringify({ kind: 'ORCHESTRATION', ts: '2026-08-15T10:00:00Z', why: { text: '高峰期禁止全量重建索引' } }),
      JSON.stringify({ kind: 'EVOLUTION', ts: '2026-08-15T11:00:00Z', why: { text: '高峰期禁止全量重建索引' } }),
      '{broken json line',
    ];
    fs.writeFileSync(path.join(logDir, 'decision-log.jsonl'), lines.join('\n') + '\n', 'utf-8');

    const items = extractInstincts({ dataDir: tmpDataDir });
    const target = items.find((i) => i.pattern === '高峰期禁止全量重建索引');
    expect(target).toBeDefined();
    expect(target!.occurrences).toBe(2);
    expect(target!.source).toBe('decision');
  });

  it('parseThinkSections 解析节结构与审计结局', () => {
    const sections = parseThinkSections(
      '## 2026-08-15 10:00 任务: 任务A\n- #审计结果(v1.3.4): WARN — 1 条规则触发\n- #教训: 先写日志\n',
    );
    expect(sections).toHaveLength(1);
    expect(sections[0]!.task).toBe('任务A');
    expect(sections[0]!.auditVerdict).toBe('WARN');
    expect(sections[0]!.lessons).toEqual(['先写日志']);
  });

  it('normalizePattern + patternId 稳定指纹（空白/标点差异归一）', () => {
    expect(normalizePattern('  先写日志 。 ')).toBe('先写日志');
    expect(normalizePattern('先写日志。')).toBe('先写日志');
    expect(patternId(normalizePattern('先写日志。'))).toBe(patternId(normalizePattern('先写日志')));
    expect(patternId('先写日志')).not.toBe(patternId('先写测试'));
  });
});

// ────────────────────────────────────────────────────────────
// 2. 评分器
// ────────────────────────────────────────────────────────────

describe('instinct/scorer · 置信度评分', () => {
  it('置信度 = 出现次数饱和 × 通过率，≥0.7 才入选注入', () => {
    // 3 次 PASS → coverage=1, passRate=1, confidence=1 → 注入
    const strong = { id: 'a', pattern: '强模式', source: 'think' as const, occurrences: 3, passCount: 3, failCount: 0, lastSeen: 't' };
    // 3 次全 FAIL → confidence=0 → 不注入
    const bad = { id: 'b', pattern: '坏模式', source: 'think' as const, occurrences: 3, passCount: 0, failCount: 3, lastSeen: 't' };
    // 1 次 PASS → coverage=1/3, passRate=1 → confidence≈0.33 → 不注入
    const weak = { id: 'c', pattern: '弱模式', source: 'think' as const, occurrences: 1, passCount: 1, failCount: 0, lastSeen: 't' };

    const selected = selectForInjection([strong, bad, weak]);
    expect(selected.map((s) => s.id)).toEqual(['a']);

    const scored = scoreInstinct(strong);
    expect(scored.confidence).toBeCloseTo(1.0, 5);
    expect(scored.coverage).toBe(1);
    expect(scored.passRate).toBe(1);
  });

  it('无 PASS/FAIL 结局的 decision 来源按中性 0.5 通过率处理', () => {
    const decisionOnly = { id: 'd', pattern: '决策', source: 'decision' as const, occurrences: 3, passCount: 0, failCount: 0, lastSeen: 't' };
    const scored = scoreInstinct(decisionOnly);
    expect(scored.passRate).toBe(0.5);
    expect(scored.confidence).toBeCloseTo(0.5, 5);
    // 0.5 < 0.7 → 不注入
    expect(selectForInjection([decisionOnly])).toHaveLength(0);
  });

  it('renderInjectionBlock 输出 Markdown 段（空列表空串）', () => {
    expect(renderInjectionBlock([])).toBe('');
    const selected = selectForInjection([
      { id: 'a', pattern: '强模式', source: 'think', occurrences: 3, passCount: 3, failCount: 0, lastSeen: 't' },
    ]);
    const block = renderInjectionBlock(selected);
    expect(block).toContain('## Instinct');
    expect(block).toContain('强模式');
    expect(block).toContain('100%');
    expect(DEFAULT_CONFIDENCE_THRESHOLD).toBe(0.7);
  });
});

// ────────────────────────────────────────────────────────────
// 3. 聚合器（/evolve）
// ────────────────────────────────────────────────────────────

describe('instinct/evolver · 聚合为 skill', () => {
  it('相关 instinct 聚合成 SKILL.md 写入运行时目录（tmpdir 注入，非仓库 SKILL/）', () => {
    const items = [
      { id: 'a', pattern: '改接口前先读调用方', source: 'think' as const, occurrences: 3, passCount: 3, failCount: 0, lastSeen: 't' },
      { id: 'b', pattern: '改接口前先写接口测试', source: 'think' as const, occurrences: 3, passCount: 3, failCount: 0, lastSeen: 't' },
      { id: 'c', pattern: '高峰期禁止全量重建索引', source: 'decision' as const, occurrences: 3, passCount: 3, failCount: 0, lastSeen: 't' },
    ];
    const result = evolveInstincts(items, { skillDir: tmpSkillDir, now: new Date('2026-08-15T00:00:00Z') });

    // 至少一个 skill（a/b 共享「接口」2-gram 成组；c 独立成组但 1 条 < minGroupSize=2 → leftover）
    expect(result.skills.length).toBeGreaterThanOrEqual(1);
    const main = result.skills[0]!;
    expect(main.instinctCount).toBe(2);

    // 三产物齐：SKILL.md + plugin.mjs + overrides
    expect(fs.existsSync(main.skillMdPath)).toBe(true);
    expect(fs.existsSync(main.pluginPath)).toBe(true);
    expect(fs.existsSync(main.overridesPath)).toBe(true);

    const skillMd = fs.readFileSync(main.skillMdPath, 'utf-8');
    expect(skillMd).toContain('改接口前先读调用方');
    expect(skillMd).toContain('判断模式');

    // DSH 插件形态预留：apply(ctx) 包装
    const plugin = fs.readFileSync(main.pluginPath, 'utf-8');
    expect(plugin).toContain('async apply(ctx)');
    expect(plugin).toContain('ctx.tools.register');

    // 🔴 写入路径必须是传入的运行时目录，不触达仓库 SKILL/
    expect(main.skillMdPath.startsWith(tmpSkillDir)).toBe(true);
    expect(main.skillMdPath).not.toContain(path.join('sofagent', 'SKILL'));

    // 单条组留在 leftover
    expect(result.leftover.map((l) => l.id)).toContain('c');
  });

  it('resolveCustomSkillDir 缺省走 SOFAGENT_HOME（隔离环境下不碰真实 home）', () => {
    const dir = resolveCustomSkillDir();
    expect(dir.startsWith(tmpHome)).toBe(true);
    expect(dir).toBe(path.join(tmpHome, 'skill', 'custom'));
  });
});

// ────────────────────────────────────────────────────────────
// 4. 错题本
// ────────────────────────────────────────────────────────────

describe('instinct/failure-log · 错题本', () => {
  it('append-only 追加 + 读回聚合，且独立于 think.md', () => {
    // think.md 存在且有正向内容——错题本必须独立存放在 instinct/failure-log.jsonl
    fs.writeFileSync(path.join(tmpDataDir, 'think.md'), '## t 任务: x\n- #教训: 正向经验\n', 'utf-8');

    appendFailure(tmpDataDir, {
      pattern: '盲改配置文件导致审计 FAIL',
      source: 'audit',
      context: 'A7 不存盲改',
      timestamp: '2026-08-15T10:00:00Z',
    });
    appendFailure(tmpDataDir, {
      pattern: '盲改配置文件导致审计 FAIL',
      source: 'refine',
      context: 'Refine 第 2 轮修复失败',
      timestamp: '2026-08-15T12:00:00Z',
    });

    const lines = readFailureLog(tmpDataDir);
    expect(lines).toHaveLength(2);

    const aggregated = aggregateFailurePatterns(tmpDataDir);
    expect(aggregated).toHaveLength(1);
    expect(aggregated[0]!.occurrences).toBe(2);
    expect(aggregated[0]!.lastSeen).toBe('2026-08-15T12:00:00Z');
    expect(aggregated[0]!.contexts).toContain('A7 不存盲改');

    // 独立性：错题本路径在 instinct/ 下，不在 think.md 路径上
    expect(failureLogPath(tmpDataDir)).toBe(path.join(tmpDataDir, 'instinct', 'failure-log.jsonl'));
  });

  it('负样本进提取器后 fail ×2 加权（拉低该模式置信度）', () => {
    // 同一模式：正向 3 次 PASS（confidence 本应 1.0）
    fs.writeFileSync(
      path.join(tmpDataDir, 'think.md'),
      [
        '## t1 任务: a\n- #审计结果(v1): PASS — 0 条规则触发\n- #教训: 部署前先跑冒烟\n',
        '## t2 任务: b\n- #审计结果(v1): PASS — 0 条规则触发\n- #教训: 部署前先跑冒烟\n',
        '## t3 任务: c\n- #审计结果(v1): PASS — 0 条规则触发\n- #教训: 部署前先跑冒烟\n',
      ].join('\n'),
      'utf-8',
    );
    // 错题本 1 条同 pattern 负样本 → failCount +2
    appendFailure(tmpDataDir, {
      pattern: '部署前先跑冒烟',
      source: 'refine',
      context: '冒烟脚本失效未拦截',
      timestamp: '2026-08-15T10:00:00Z',
    });

    const items = extractInstincts({ dataDir: tmpDataDir });
    const target = items.find((i) => i.pattern === '部署前先跑冒烟')!;
    expect(target.failCount).toBe(2); // 负样本加权 ×2
    const scored = scoreInstinct(target);
    // coverage=1, passRate=3/5=0.6 → confidence 0.6 < 0.7 → 被拉下注入线
    expect(scored.confidence).toBeCloseTo(0.6, 5);
    expect(selectForInjection(items).map((i) => i.id)).not.toContain(target.id);
  });
});
