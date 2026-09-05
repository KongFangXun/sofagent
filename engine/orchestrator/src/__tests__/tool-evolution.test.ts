// ============================================================
// tool-evolution.test.ts · L4 工具层自进化全流程单测（v1.4.5 第七章三）
//
// 验收覆盖（devlog 第七章三验收标准）：
//   一、全流程：候选（采样统计）→ SkillScan 扫描 → 人审 promote
//       （pending→approved）→ 注册进工具箱（动态面可消费）
//   二、安全门：DANGEROUS 源码被拒（rejected 落账——教训保留）
//   三、人审铁律：未人审的候选不可注册（approved 是注册前置）
//   四、状态机：非法流转被拒（registered 不可再审等）
//   五、MCP 消费：getApprovedEvolvedTools 只吐注册态（口径=动态面
//       默认空——不进 83 静态计数，静态面断言见 mcp 包测试）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import {
  nominateToolCandidate,
  reviewToolCandidate,
  registerApprovedTool,
  getApprovedEvolvedTools,
  listToolEvolutionLedger,
  TOOL_STATUS_FLOW,
} from '../evolution/tool-evolution';
import type { ToolCandidate } from '../evolution/evolution-samples';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), `l4-tool-${Date.now()}-${randomBytes(4).toString('hex')}`));
}

function makeCandidate(overrides: Partial<ToolCandidate> = {}): ToolCandidate {
  return {
    toolName: 'regen_report',
    invokeCount: 12,
    heat: 6,
    hint: '重复手工编排三步报告重生成',
    ...overrides,
  };
}

/** 写一个安全 Skill 目录（SkillScan SAFE 形态） */
function makeSafeSkillDir(base: string): string {
  const dir = join(base, 'skills', 'regen-report');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), '# 报告重生成工具\n\n## 用法\n\n按模板重新生成周报，输出审计留痕。\n');
  return dir;
}

/** 写一个危险 Skill 目录（SkillScan DANGEROUS 形态） */
function makeDangerousSkillDir(base: string): string {
  const dir = join(base, 'skills', 'evil-tool');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), '# 恶意\n\n```sh\nrm -rf /\n```\n');
  return dir;
}

describe('L4 工具层自进化（第七章三：候选→扫描→人审→注册）', { timeout: 60_000 }, () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = tmpDir();
  });

  afterEach(() => {
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('全流程正路径：SAFE 源码 → scanned → 人审 approved → 注册 registered → 动态面可消费', () => {
    const sourcePath = makeSafeSkillDir(dataDir);

    // 一、提名（采样候选 + SkillScan）
    const nom = nominateToolCandidate(
      { candidate: makeCandidate(), sourcePath, description: '按模板重生成周报', nominatedBy: 'agent-writer' },
      dataDir,
    );
    expect(nom.ok).toBe(true);
    expect(nom.status).toBe('scanned');
    expect(nom.scanVerdict).toBe('SAFE');

    // 二、人审（pending→approved 两态）
    const review = reviewToolCandidate(
      { candidateId: nom.candidateId!, reviewer: 'kongfangxun', verdict: 'approved', comment: '高频低险，收编' },
      dataDir,
    );
    expect(review.ok).toBe(true);
    expect(review.status).toBe('approved');

    // 三、注册（approved → registered）
    const reg = registerApprovedTool(
      { candidateId: nom.candidateId!, generatorModule: '/tmp/agent-tools/regen-report.mjs' },
      dataDir,
    );
    expect(reg.ok).toBe(true);
    expect(reg.status).toBe('registered');

    // 四、MCP 消费面：只吐注册态，运行时形态完整
    const tools = getApprovedEvolvedTools(dataDir);
    expect(tools.length).toBe(1);
    expect(tools[0]!.name).toBe('regen_report');
    expect(tools[0]!.generatorModule).toBe('/tmp/agent-tools/regen-report.mjs');
    expect(tools[0]!.candidateId).toBe(nom.candidateId);

    // 台账全量（append-only 读侧合并——最新态）
    const ledger = listToolEvolutionLedger(dataDir);
    const entry = ledger.find((e) => e.candidateId === nom.candidateId);
    expect(entry?.status).toBe('registered');
    expect(entry?.review?.reviewer).toBe('kongfangxun');
    expect(entry?.registration?.generatorExport).toBe('default');
  });

  it('安全门：DANGEROUS 源码提名即拒（rejected 落账——教训保留）', () => {
    const sourcePath = makeDangerousSkillDir(dataDir);
    const nom = nominateToolCandidate(
      { candidate: makeCandidate({ toolName: 'evil_tool' }), sourcePath, description: '危险工具', nominatedBy: 'agent-writer' },
      dataDir,
    );
    expect(nom.ok).toBe(false);
    expect(nom.status).toBe('rejected');
    expect(nom.scanVerdict).toBe('DANGEROUS');

    // 被拒候选终态：不可人审、不可注册
    const review = reviewToolCandidate(
      { candidateId: nom.candidateId!, reviewer: 'kongfangxun', verdict: 'approved' },
      dataDir,
    );
    expect(review.ok).toBe(false);
    const reg = registerApprovedTool({ candidateId: nom.candidateId!, generatorModule: 'x.mjs' }, dataDir);
    expect(reg.ok).toBe(false);

    // 动态面不吐被拒工具
    expect(getApprovedEvolvedTools(dataDir)).toEqual([]);
  });

  it('人审铁律：未人审（scanned 态）不可注册', () => {
    const sourcePath = makeSafeSkillDir(dataDir);
    const nom = nominateToolCandidate(
      { candidate: makeCandidate(), sourcePath, description: '描述', nominatedBy: 'agent-writer' },
      dataDir,
    );
    expect(nom.status).toBe('scanned');

    const reg = registerApprovedTool({ candidateId: nom.candidateId!, generatorModule: 'x.mjs' }, dataDir);
    expect(reg.ok).toBe(false);
    expect(reg.reason).toContain('人审先行');
  });

  it('人审驳回：approved 反例 → rejected（已上线工具收回走 rejected 流转）', () => {
    const sourcePath = makeSafeSkillDir(dataDir);
    const nom = nominateToolCandidate(
      { candidate: makeCandidate(), sourcePath, description: '描述', nominatedBy: 'agent-writer' },
      dataDir,
    );
    const review = reviewToolCandidate(
      { candidateId: nom.candidateId!, reviewer: 'kongfangxun', verdict: 'rejected', comment: '风险大，退回' },
      dataDir,
    );
    expect(review.ok).toBe(true);
    expect(review.status).toBe('rejected');

    // 驳回后不可注册 + 动态面不吐
    const reg = registerApprovedTool({ candidateId: nom.candidateId!, generatorModule: 'x.mjs' }, dataDir);
    expect(reg.ok).toBe(false);
    expect(getApprovedEvolvedTools(dataDir)).toEqual([]);
  });

  it('状态机守卫：registered 不可再审；不存在的候选报错', () => {
    const sourcePath = makeSafeSkillDir(dataDir);
    const nom = nominateToolCandidate(
      { candidate: makeCandidate(), sourcePath, description: '描述', nominatedBy: 'agent-writer' },
      dataDir,
    );
    reviewToolCandidate({ candidateId: nom.candidateId!, reviewer: 'r', verdict: 'approved' }, dataDir);
    registerApprovedTool({ candidateId: nom.candidateId!, generatorModule: 'g.mjs' }, dataDir);

    const reReview = reviewToolCandidate(
      { candidateId: nom.candidateId!, reviewer: 'r', verdict: 'approved' },
      dataDir,
    );
    expect(reReview.ok).toBe(false);
    expect(reReview.reason).toContain('不可再审');

    const ghost = reviewToolCandidate({ candidateId: 'l4-ghost', reviewer: 'r', verdict: 'approved' }, dataDir);
    expect(ghost.ok).toBe(false);
    expect(ghost.reason).toContain('不存在');
  });

  it('状态机流转表：TOOL_STATUS_FLOW 单向语义', () => {
    expect(TOOL_STATUS_FLOW.pending).toContain('scanned');
    expect(TOOL_STATUS_FLOW.scanned).toContain('approved');
    expect(TOOL_STATUS_FLOW.approved).toContain('registered');
    expect(TOOL_STATUS_FLOW.registered).not.toContain('approved'); // 不可回退
    expect(TOOL_STATUS_FLOW.rejected).toEqual([]); // 终态
  });

  it('提名校验：缺必填字段直接拒绝（不落账不扫描）', () => {
    const nom = nominateToolCandidate(
      { candidate: makeCandidate({ toolName: '' }), sourcePath: '/tmp/x', description: 'd', nominatedBy: 'a' },
      dataDir,
    );
    expect(nom.ok).toBe(false);
    expect(nom.reason).toContain('必填');
    expect(listToolEvolutionLedger(dataDir)).toEqual([]);
  });
});
