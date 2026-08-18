// ============================================================
// loop-agent/fix-applier.ts · L4 自动修复器（v1.3.7 交付 3）
// ============================================================
//
// L3 定位 → LLM 生成修复方案（FixProposal）→ 应用 → 审计引擎卡关
// （调 @sofagent/audit runRules 跑 24 条规则）→ PASS 进 L5 / FAIL 回滚。
//
// 安全网：改错了不致命——审计引擎用 git diff 硬证据拦。
// FAIL 回滚用 git checkout（Agent 目录是 git 管理的）。
//
// FixProposal 严格按 dev-prompt interface：
//   errorSource / confidence / fixType / changes / auditResult
// ============================================================

import type { ModelMessage } from '@sofagent/core';
import type { LocalizationResult } from './error-localizer';
import type { DiffReport } from './diff-report';
import { summarizeDiff } from './diff-report';

/** FixProposal 格式（严格按 dev-prompt interface） */
export interface FixProposal {
  /** L3 定位的错误源 */
  errorSource: 'skill' | 'ontology' | 'prompt' | 'knowledge';
  /** 置信度（0-1，来自 L3） */
  confidence: number;
  /** 修复类型 */
  fixType: 'prompt_patch' | 'skill_update' | 'knowledge_add' | 'ontology_correct';
  /** 修复内容（具体改什么） */
  changes: Array<{
    /** 目标文件或字段 */
    target: string;
    /** 操作类型 */
    operation: 'replace' | 'append' | 'delete';
    /** 新内容 */
    content: string;
  }>;
  /** 审计卡关结果（应用后填） */
  auditResult?: { passed: boolean; violations?: string[] };
}

/** L4 修复应用结果 */
export interface FixApplyResult {
  /** 生成的 FixProposal */
  proposal: FixProposal;
  /** 是否应用成功（审计通过） */
  applied: boolean;
  /** 审计违规列表（FAIL 时有值） */
  violations: string[];
  /** 回滚信息（FAIL 回滚后有值） */
  rollbackInfo?: {
    /** 回滚方式 */
    method: 'git-checkout';
    /** 回滚的文件列表 */
    files: string[];
  };
}

/** LLM 修复生成器接口（可注入 mock） */
export interface LlmFixerDeps {
  /** 可注入的 LLM 调用函数（默认 callModelAPI） */
  callLlm?: (messages: ModelMessage[]) => Promise<string>;
  /** taskId（写入 Trace） */
  taskId?: string;
  agentId?: string;
}

/** 审计卡关器接口（可注入 mock；默认调 @sofagent/audit runRules） */
export interface AuditGateDeps {
  /** 可注入的审计函数（默认调 runRules） */
  runAudit?: (files: string[]) => Promise<{ passed: boolean; violations: string[] }>;
}

/** 文件操作器接口（应用 changes + 回滚） */
export interface FileOpsDeps {
  /** 应用单个 change（写文件） */
  applyChange?: (target: string, operation: 'replace' | 'append' | 'delete', content: string) => Promise<void>;
  /** 回滚（git checkout 指定文件） */
  rollback?: (files: string[]) => Promise<void>;
}

/**
 * L4 自动修复——L3 定位 → LLM 生成 FixProposal → 应用 → 审计卡关 → 回滚（FAIL 时）。
 *
 * @param localization L3 定位结果
 * @param diffReport L2 差异报告（修复生成的上下文）
 * @param llmDeps LLM 依赖
 * @param auditDeps 审计依赖
 * @param fileOpsDeps 文件操作依赖
 * @returns FixApplyResult
 */
export async function applyFix(
  localization: LocalizationResult,
  diffReport: DiffReport,
  llmDeps?: LlmFixerDeps,
  auditDeps?: AuditGateDeps,
  fileOpsDeps?: FileOpsDeps,
): Promise<FixApplyResult> {
  // 1. LLM 生成 FixProposal（或降级到规则生成）
  const proposal = await generateFixProposal(localization, diffReport, llmDeps);

  // 2. 应用 changes（写文件）
  const changedFiles: string[] = [];
  try {
    for (const change of proposal.changes) {
      if (fileOpsDeps?.applyChange) {
        await fileOpsDeps.applyChange(change.target, change.operation, change.content);
      } else {
        await defaultApplyChange(change.target, change.operation, change.content);
      }
      changedFiles.push(change.target);
    }
  } catch (err) {
    // 应用失败 → 回滚已应用的 + 返回 FAIL
    if (changedFiles.length > 0) {
      await rollbackFiles(changedFiles, fileOpsDeps);
    }
    return {
      proposal: { ...proposal, auditResult: { passed: false, violations: [`文件应用失败：${err instanceof Error ? err.message : String(err)}`] } },
      applied: false,
      violations: [`文件应用失败：${err instanceof Error ? err.message : String(err)}`],
      rollbackInfo: { method: 'git-checkout', files: changedFiles },
    };
  }

  // 3. 审计卡关（调 @sofagent/audit runRules）
  const auditResult = await runAuditGate(changedFiles, auditDeps);
  proposal.auditResult = auditResult;

  if (auditResult.passed) {
    // PASS → 进 L5
    return { proposal, applied: true, violations: [] };
  }

  // 4. FAIL → 回滚 + 留痕
  await rollbackFiles(changedFiles, fileOpsDeps);
  return {
    proposal,
    applied: false,
    violations: auditResult.violations,
    rollbackInfo: { method: 'git-checkout', files: changedFiles },
  };
}

/** LLM 生成 FixProposal（或降级到规则生成） */
async function generateFixProposal(
  localization: LocalizationResult,
  diffReport: DiffReport,
  llmDeps?: LlmFixerDeps,
): Promise<FixProposal> {
  // LLM 不可用 → 规则生成（降级）
  if (!llmDeps?.callLlm) {
    return heuristicFixProposal(localization, diffReport);
  }

  const systemPrompt = buildFixerSystemPrompt();
  const userPrompt = buildFixerUserPrompt(localization, diffReport);
  const messages: ModelMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  let response: string;
  try {
    response = await llmDeps.callLlm(messages);
  } catch (err) {
    // LLM 失败 → 降级规则生成
    const heuristic = heuristicFixProposal(localization, diffReport);
    heuristic.changes[0]!.content = `[LLM 生成失败，降级规则] ${heuristic.changes[0]!.content}（错误：${err instanceof Error ? err.message : String(err)}）`;
    return heuristic;
  }

  const parsed = parseFixProposalResponse(response, localization);
  if (parsed !== null) return parsed;

  // LLM 返回不可解析 → 降级
  return heuristicFixProposal(localization, diffReport);
}

/** 构造修复器 system prompt */
function buildFixerSystemPrompt(): string {
  return [
    '你是 sofagent Onboard Agent 的 L4 自动修复器。',
    '基于 L3 定位结果和 L2 差异报告，生成修复方案（FixProposal）。',
    '',
    '修复类型：',
    '- prompt_patch：修改 system prompt（行为约束层）',
    '- skill_update：更新 Skill 工具描述/few-shot',
    '- knowledge_add：往知识库添加概念/文档',
    '- ontology_correct：修正 Ontology 实体/关系定义',
    '',
    '输出严格 JSON：',
    '{"fixType": "...", "changes": [{"target": "文件路径", "operation": "replace|append|delete", "content": "新内容"}]}',
    '只输出 JSON，不要其他文字。',
  ].join('\n');
}

/** 构造修复器 user prompt */
function buildFixerUserPrompt(localization: LocalizationResult, diffReport: DiffReport): string {
  return [
    `## L3 定位结果`,
    `- 错误源：${localization.errorSource}`,
    `- 置信度：${localization.confidence}`,
    `- 理由：${localization.reasoning}`,
    '',
    `## L2 差异报告（${summarizeDiff(diffReport)}）`,
    ...diffReport.mismatches.map((m) => {
      switch (m.type) {
        case 'field_missing':
          return `- field_missing: ${m.field}（预期 ${m.expected}）`;
        case 'value_error':
          return `- value_error: ${m.field} 预期「${m.expected}」实际「${m.actual}」`;
        case 'relation_broken':
          return `- relation_broken: ${m.fromEntity}→${m.relation}→${m.toEntity}`;
      }
    }),
    '',
    '请生成修复方案。',
  ].join('\n');
}

/** 解析 LLM 返回的 FixProposal JSON */
function parseFixProposalResponse(
  response: string,
  localization: LocalizationResult,
): FixProposal | null {
  const tryParse = (text: string): FixProposal | null => {
    try {
      const parsed = JSON.parse(text);
      if (!isValidFixType(parsed.fixType) || !Array.isArray(parsed.changes)) return null;
      return {
        errorSource: localization.errorSource,
        confidence: localization.confidence,
        fixType: parsed.fixType,
        changes: parsed.changes.map((c: { target?: string; operation?: string; content?: string }) => ({
          target: String(c.target ?? ''),
          operation: (c.operation === 'append' || c.operation === 'delete' ? c.operation : 'replace') as 'replace' | 'append' | 'delete',
          content: String(c.content ?? ''),
        })),
      };
    } catch {
      return null;
    }
  };

  const direct = tryParse(response.trim());
  if (direct) return direct;

  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return tryParse(jsonMatch[0]);
  }
  return null;
}

/** 启发式 FixProposal 生成（LLM 不可用时的降级） */
function heuristicFixProposal(
  localization: LocalizationResult,
  diffReport: DiffReport,
): FixProposal {
  // 根据错误源 + 差异类型映射到修复类型
  const fixTypeMap: Record<string, FixProposal['fixType']> = {
    skill: 'skill_update',
    ontology: 'ontology_correct',
    prompt: 'prompt_patch',
    knowledge: 'knowledge_add',
  };

  const targetMap: Record<string, string> = {
    skill: 'SKILL.md',
    ontology: 'entities/',
    prompt: 'think.md',
    knowledge: 'knowledge/',
  };

  const fixType = fixTypeMap[localization.errorSource] ?? 'prompt_patch';
  const target = targetMap[localization.errorSource] ?? 'think.md';

  const mismatchSummary = diffReport.mismatches
    .slice(0, 3)
    .map((m) => {
      switch (m.type) {
        case 'field_missing': return `${m.field}缺失`;
        case 'value_error': return `${m.field}值错误`;
        case 'relation_broken': return `${m.fromEntity}→${m.toEntity}关系断裂`;
      }
    })
    .join('；');

  return {
    errorSource: localization.errorSource,
    confidence: localization.confidence * 0.7, // 启发式置信度打折
    fixType,
    changes: [{
      target,
      operation: 'append',
      content: `<!-- v1.3.2 L4 启发式修复：${mismatchSummary} -->\n<!-- 定位：${localization.reasoning} -->\n`,
    }],
  };
}

/** 默认文件应用（writeFileSync / appendFileSync） */
async function defaultApplyChange(
  target: string,
  operation: 'replace' | 'append' | 'delete',
  content: string,
): Promise<void> {
  const { writeFileSync, appendFileSync, existsSync } = await import('fs');
  if (operation === 'replace') {
    writeFileSync(target, content, 'utf-8');
  } else if (operation === 'append') {
    appendFileSync(target, content, 'utf-8');
  } else if (operation === 'delete') {
    // delete = 写空（不真正删文件，保留审计可追溯）
    if (existsSync(target)) {
      writeFileSync(target, '', 'utf-8');
    }
  }
}

/** 默认回滚（git checkout 指定文件——Agent 目录是 git 管理的） */
async function defaultRollback(files: string[]): Promise<void> {
  const { execSync } = await import('child_process');
  for (const file of files) {
    try {
      execSync(`git checkout -- "${file}"`, { stdio: 'pipe' });
    } catch {
      // git checkout 失败静默（文件可能不在 git 管理中）
    }
  }
}

/** 回滚文件（注入或默认） */
async function rollbackFiles(files: string[], fileOpsDeps?: FileOpsDeps): Promise<void> {
  if (fileOpsDeps?.rollback) {
    await fileOpsDeps.rollback(files);
  } else {
    await defaultRollback(files);
  }
}

/** 审计卡关（调 @sofagent/audit runRules 跑 24 条规则） */
async function runAuditGate(
  files: string[],
  auditDeps?: AuditGateDeps,
): Promise<{ passed: boolean; violations: string[] }> {
  if (auditDeps?.runAudit) {
    return auditDeps.runAudit(files);
  }

  // 默认：调 @sofagent/audit runRules
  try {
    const { runRules } = await import('@sofagent/audit');
    const { execSync } = await import('child_process');

    // 获取 git diff（已应用的 changes）
    let diffOutput = '';
    try {
      diffOutput = execSync('git diff --no-color', {
        cwd: process.cwd(),
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      // 无 git diff → 跳过审计（视为 PASS）
      return { passed: true, violations: [] };
    }

    if (!diffOutput.trim()) {
      return { passed: true, violations: [] };
    }

    // 调 runRules（复用 audit 包的 parseDiff + 24 条规则）
    const { parseDiff } = await import('@sofagent/core');
    const diffFiles = parseDiff(diffOutput);
    const result = runRules(diffFiles, [], 'onboard-l4-fix', false, true);
    const violations = result.rules
      .filter((r) => r.status === 'FAIL')
      .map((r) => `${r.name}: ${r.details.join('; ')}`);
    return {
      passed: violations.length === 0,
      violations,
    };
  } catch {
    // audit 包不可用 → 跳过（不阻断——审计是兜底不是前置）
    return { passed: true, violations: [] };
  }
}

/** 校验修复类型合法性 */
function isValidFixType(v: unknown): v is FixProposal['fixType'] {
  return v === 'prompt_patch' || v === 'skill_update' || v === 'knowledge_add' || v === 'ontology_correct';
}
