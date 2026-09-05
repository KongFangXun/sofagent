// ============================================================
// skill-evolution/__tests__/skill-evolution.test.ts · 台账/门控/隔离测试
// v1.4.5 第七章四新增
//
// 覆盖用例（共 10 case）：
//   一、台账程序化落账：提案→diff→验证分→接受全记录 append-only
//   二、被拒提案不丢教训：rejected 落账带原因，可查询
//   三、eval 门控：首提案（无历史）过门控收编
//   四、eval 门控：不超历史最优即回滚（rejected + 原因落账）
//   五、eval 门控：超历史最优收编 + 历史最优线推进
//   六、eval 门控 fail-safe：空验证集拒绝
//   七、solves 字段：frontmatter 解析（列表/行内两种形态）
//   八、solves 字段：无 frontmatter 不加
//   九、隔离告警：executor 读进化知识库 → 告警落盘 + 拒绝
//   十、隔离告警：evolver 离线读合法（无告警）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  appendSkillImpactEntry,
  readSkillImpactLedger,
  readRejectedProposals,
  historicalBestScore,
  skillImpactLedgerPath,
} from '../skill-impact-ledger';
import { runEvalGate } from '../eval-gate';
import { guardKnowledgeAccess, readIsolationViolations, isolationViolationsPath } from '../isolation-guard';
import { parseSolvesField, ensureSolvesField } from '../solves-frontmatter';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-skill-evo-'));
}

describe('skill-impact 台账（程序化落账）', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = tmpDir();
    process.env.SOFAGENT_DATA = dataDir;
  });

  afterEach(() => {
    delete process.env.SOFAGENT_DATA;
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* 清理失败不阻断 */ }
  });

  // 用例一：提案全记录 append-only
  it('提案→diff→验证分→接受 全记录落账（JSONL append-only）', () => {
    appendSkillImpactEntry(dataDir, {
      proposalId: 'proposal-20260905-0001',
      ts: '2026-09-05T00:00:00.000Z',
      skillPath: 'SKILL/SKILL.md',
      slug: 'sofagent',
      solvesPattern: 'agent 行为失控',
      unifiedDiff: '--- a/SKILL/SKILL.md\n+++ b/SKILL/SKILL.md\n@@ -1,3 +1,4 @@\n+新增约束条目',
      evalScore: 82,
      historicalBest: null,
      verdict: 'accepted',
      actor: 'test',
    });
    const entries = readSkillImpactLedger(dataDir);
    expect(entries.length).toBe(1);
    expect(entries[0]!.proposalId).toBe('proposal-20260905-0001');
    expect(entries[0]!.unifiedDiff).toContain('@@ -1,3 +1,4 @@');
    expect(entries[0]!.verdict).toBe('accepted');
    expect(fs.existsSync(skillImpactLedgerPath(dataDir))).toBe(true);
  });

  // 用例二：被拒提案不丢教训
  it('rejected 提案落账带原因，readRejectedProposals 可查询', () => {
    appendSkillImpactEntry(dataDir, {
      proposalId: 'p1',
      ts: '2026-09-05T00:00:00.000Z',
      skillPath: 'SKILL/agents/reviewer/SKILL.md',
      slug: 'sofagent-reviewer',
      solvesPattern: '审查范围蔓延',
      unifiedDiff: 'diff --git',
      evalScore: 71,
      historicalBest: 80,
      verdict: 'rejected',
      rejectReason: 'eval=71 未超历史最优 80——回滚',
      actor: 'test',
    });
    const rejected = readRejectedProposals(dataDir, 'SKILL/agents/reviewer/SKILL.md');
    expect(rejected.length).toBe(1);
    expect(rejected[0]!.rejectReason).toContain('未超历史最优');
  });
});

describe('eval 门控（不超历史最优即回滚）', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = tmpDir();
    process.env.SOFAGENT_DATA = dataDir;
  });

  afterEach(() => {
    delete process.env.SOFAGENT_DATA;
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* 清理失败不阻断 */ }
  });

  const gateInput = (overwrites: Partial<Parameters<typeof runEvalGate>[0]> = {}) => ({
    dataDir,
    skillPath: 'SKILL/SKILL.md',
    slug: 'sofagent',
    solvesPattern: 'agent 行为失控',
    unifiedDiff: 'diff --git a/SKILL/SKILL.md',
    benchmarkId: 'bench-skill-evo',
    caseScores: [
      { caseId: 'CASE-001', score: 80 },
      { caseId: 'CASE-002', score: 84 },
    ],
    actor: 'test',
    ...overwrites,
  });

  // 用例三：首提案过门控
  it('首提案（无历史对照线）→ 过门控收编，台账 verdict=accepted', () => {
    const result = runEvalGate(gateInput());
    expect(result.passed).toBe(true);
    expect(result.evalScore).toBe(82); // (80+84)/2
    expect(result.historicalBest).toBeNull();
    const entries = readSkillImpactLedger(dataDir);
    expect(entries[0]!.verdict).toBe('accepted');
  });

  // 用例四：不超历史最优即回滚
  it('第二轮低于历史最优（82）→ 回滚 rejected + 原因落账', () => {
    runEvalGate(gateInput()); // 首轮 82 收编
    const result = runEvalGate(gateInput({ caseScores: [{ caseId: 'CASE-001', score: 70 }] }));
    expect(result.passed).toBe(false);
    expect(result.evalScore).toBe(70);
    expect(result.historicalBest).toBe(82);
    expect(result.reason).toContain('回滚');
    const rejected = readRejectedProposals(dataDir);
    expect(rejected.length).toBe(1);
    expect(rejected[0]!.rejectReason).toContain('未超历史最优');
  });

  // 用例五：超历史最优收编 + 对照线推进
  it('第三轮超历史最优 → 收编，historicalBestScore 推进到新值', () => {
    runEvalGate(gateInput()); // 82
    runEvalGate(gateInput({ caseScores: [{ caseId: 'CASE-001', score: 90 }, { caseId: 'CASE-002', score: 92 }] })); // 91
    const best = historicalBestScore(dataDir, 'SKILL/SKILL.md');
    expect(best).toBe(91);
  });

  // 用例六：fail-safe 空验证集
  it('空验证集 → fail-safe 拒绝（无验证不收编）', () => {
    const result = runEvalGate(gateInput({ caseScores: [] }));
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('fail-safe');
  });
});

describe('solves: 溯源字段（frontmatter）', () => {
  // 用例七：两种形态解析
  it('parseSolvesField：列表形态与行内数组形态都解析', () => {
    const listForm = '---\nname: a\nsolves:\n  - pattern-x\n  - pattern-y\n---\n\n# body\n';
    const inlineForm = '---\nname: b\nsolves: [p1, p2]\n---\n\n# body\n';
    const listParsed = parseSolvesField(listForm);
    const inlineParsed = parseSolvesField(inlineForm);
    expect(listParsed.solves).toEqual(['pattern-x', 'pattern-y']);
    expect(inlineParsed.solves).toEqual(['p1', 'p2']);
  });

  // 用例八：无 frontmatter 不加
  it('ensureSolvesField：无 frontmatter 的文档不加字段', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'no-frontmatter.md');
    fs.writeFileSync(file, '# 知识文档（无 frontmatter）\n\n正文\n', 'utf-8');
    const result = ensureSolvesField(file, ['pattern-x']);
    expect(result.changed).toBe(false);
    expect(result.reason).toContain('无 frontmatter');
    const after = fs.readFileSync(file, 'utf-8');
    expect(after).not.toContain('solves:');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('ensureSolvesField：有 frontmatter 无 solves → 插入且幂等', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'with-frontmatter.md');
    fs.writeFileSync(file, '---\nname: test\nversion: 1.4.4\n---\n\n# 正文\n', 'utf-8');
    const first = ensureSolvesField(file, ['pattern-x', 'pattern-y']);
    expect(first.changed).toBe(true);
    const content = fs.readFileSync(file, 'utf-8');
    const parsed = parseSolvesField(content);
    expect(parsed.solves).toEqual(['pattern-x', 'pattern-y']);
    // 幂等：再跑不重写
    const second = ensureSolvesField(file, ['pattern-z']);
    expect(second.changed).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('执行/进化上下文隔离（rollout 期禁查 Wiki）', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = tmpDir();
    process.env.SOFAGENT_DATA = dataDir;
  });

  afterEach(() => {
    delete process.env.SOFAGENT_DATA;
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* 清理失败不阻断 */ }
  });

  // 用例九：executor 读进化知识库 → 告警 + 拒绝
  it('executor 运行期读 knowledge/entities → 审计告警落盘 + 访问拒绝', () => {
    const allowed = guardKnowledgeAccess(
      dataDir,
      'executor',
      '/home/u/.sofagent/data/knowledge/entities/concept-x.md',
      'read',
      'task-123',
    );
    expect(allowed).toBe(false);
    const violations = readIsolationViolations(dataDir);
    expect(violations.length).toBe(1);
    expect(violations[0]!.role).toBe('executor');
    expect(violations[0]!.taskId).toBe('task-123');
    expect(violations[0]!.message).toContain('隔离违反');
    expect(fs.existsSync(isolationViolationsPath(dataDir))).toBe(true);
  });

  // 用例十：evolver 离线读合法
  it('evolver 离线读进化知识库合法（无告警）', () => {
    const allowed = guardKnowledgeAccess(
      dataDir,
      'evolver',
      '/home/u/.sofagent/data/knowledge/entities/concept-x.md',
      'read',
    );
    expect(allowed).toBe(true);
    expect(readIsolationViolations(dataDir).length).toBe(0);
  });

  it('executor 读普通路径（非进化知识）合法', () => {
    const allowed = guardKnowledgeAccess(dataDir, 'executor', '/project/src/main.ts', 'read', 'task-1');
    expect(allowed).toBe(true);
    expect(readIsolationViolations(dataDir).length).toBe(0);
  });
});
