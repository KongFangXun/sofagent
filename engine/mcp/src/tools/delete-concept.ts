// ============================================================
// delete-concept.ts · MCP tool：删除 concept 页（v1.3.7 交付 5）
// ============================================================
//
// 破坏性操作——强制人审确认（human-confirm 语义），与 delete-entity 同模式：
//   confirmed=false / 缺省 → 不执行，返回提示（要求显式传 confirmed:true）
//   confirmed=true → 执行删除 + D1-D5 审计留痕（diffDataChange + runDataRules
//   + generateDataThink + data-change-log.jsonl 追加）
//
// D1-D5 审计流程与 create/update 同源：FAIL → 拒绝删除（防误删保护）。
// ============================================================

import { existsSync, readFileSync, appendFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { load as yamlLoad } from 'js-yaml';
import {type DataChange,
  diffDataChange,
  runDataRules,
  type DataAuditResult, getDataDir } from '@sofagent/core';
import { generateDataThink } from '@sofagent/think';

// ============================================================
// 类型定义
// ============================================================

export interface DeleteConceptArgs {
  /** concept 名称（不含 .md 后缀） */
  name: string;
  /** 人工确认标志——必须显式 true 才执行删除 */
  confirmed: boolean;
}

export interface DeleteConceptResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  /** 结构化数据 */
  data: {
    action: 'delete';
    path: string;
    confirmed: boolean;
    executed: boolean;
    warnings?: DataAuditResult['violations'];
    auditVerdict: 'PASS' | 'WARN' | 'FAIL';
    isError: boolean;
  };
}

// ============================================================
// 辅助函数
// ============================================================

/** 获取知识库根目录 */
function getKnowledgeDir(): string {
  return join(getDataDir(), 'knowledge');
}

/** 获取数据根目录 */
/**
 * 从 Markdown 内容中解析 frontmatter
 */
function parseFrontmatter(content: string): Record<string, unknown> | null {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---/);
  if (!match || !match[1]) return null;
  try {
    return yamlLoad(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * 追加数据变更日志到 data/audit/data-change-log.jsonl
 */
function appendDataChangeLog(change: DataChange, auditResult: DataAuditResult): void {
  const logDir = join(getDataDir(), 'audit');
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
  const logPath = join(logDir, 'data-change-log.jsonl');
  const entry = {
    timestamp: change.timestamp,
    type: change.type,
    name: change.name,
    action: change.action,
    auditVerdict: auditResult.hasFail ? 'FAIL' : auditResult.hasWarn ? 'WARN' : 'PASS',
    violations: auditResult.violations.map((v) => ({ rule: v.rule, detail: v.detail })),
  };
  try {
    appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    // 非致命
  }
}

// ============================================================
// 主函数
// ============================================================

/**
 * 删除 concept（v1.3.1 交付 5）——强制人审确认。
 *
 * @param args 删除参数（name + confirmed）
 * @returns 结构化结果（text + data）
 */
export function deleteConcept(args: DeleteConceptArgs): DeleteConceptResult {
  const { name, confirmed } = args;

  // 防路径穿越
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    return {
      text: '[sofagent] concept 名称不合法：不得包含路径分隔符',
      data: { action: 'delete', path: '', confirmed: confirmed === true, executed: false, auditVerdict: 'FAIL', isError: true },
    };
  }

  const conceptsDir = join(getKnowledgeDir(), 'concepts');
  const filePath = join(conceptsDir, `${name}.md`);

  // 人审确认——confirmed !== true 一律不执行
  if (confirmed !== true) {
    return {
      text: `[sofagent] 删除 concept "${name}" 需要人工确认：请显式传 confirmed:true 后才执行（破坏性操作，D1-D5 全程留痕）`,
      data: {
        action: 'delete',
        path: filePath,
        confirmed: false,
        executed: false,
        auditVerdict: 'PASS',
        isError: false,
      },
    };
  }

  // 1. 读取 before（删除审计需要变更前内容）
  if (!existsSync(filePath)) {
    return {
      text: `[sofagent] concept "${name}" 不存在，无法删除`,
      data: { action: 'delete', path: filePath, confirmed: true, executed: false, auditVerdict: 'FAIL', isError: true },
    };
  }
  let before: Record<string, unknown> | undefined;
  try {
    const content = readFileSync(filePath, 'utf-8');
    const fm = parseFrontmatter(content) ?? {};
    before = { ...fm, _content: content };
  } catch {
    before = undefined;
  }
  if (!before) {
    return {
      text: `[sofagent] concept "${name}" 内容解析失败，已中止删除（保护性拒绝）`,
      data: { action: 'delete', path: filePath, confirmed: true, executed: false, auditVerdict: 'FAIL', isError: true },
    };
  }

  // 2. 构造变更记录（delete：after = undefined）
  const change = diffDataChange('concept', name, before, undefined);
  const auditResult = runDataRules([change]);

  // 3. FAIL → 拒绝删除（数据审计保护）
  if (auditResult.hasFail) {
    const failSummary = auditResult.violations
      .filter((v) => v.severity === 'FAIL')
      .map((v) => `${v.rule}: ${v.detail}`)
      .join('; ');
    return {
      text: `[sofagent] 数据审计拦截（FAIL）· concept "${name}" 未删除\n  ${failSummary}`,
      data: { action: 'delete', path: filePath, confirmed: true, executed: false, auditVerdict: 'FAIL', isError: true },
    };
  }

  // 4. 执行删除
  rmSync(filePath, { force: true });

  // 5. 数据变更回溯（静默写入 think.md）
  try {
    generateDataThink([change], auditResult, `delete_concept: ${name}`);
  } catch {
    // 非致命
  }

  // 6. 追加数据变更日志
  appendDataChangeLog(change, auditResult);

  // 7. 构造返回值
  const hasWarn = auditResult.hasWarn;
  const warnList = auditResult.violations.filter((v) => v.severity === 'WARN');

  let text = `[sofagent] concept "${name}" 已删除（人工确认）`;
  if (hasWarn) {
    text += `（有 ${warnList.length} 项警告）`;
    for (const w of warnList) {
      text += `\n  ⚠️ ${w.rule}: ${w.detail}`;
    }
  }

  return {
    text,
    data: {
      action: 'delete',
      path: filePath,
      confirmed: true,
      executed: true,
      auditVerdict: hasWarn ? 'WARN' : 'PASS',
      isError: false,
      ...(warnList.length > 0 ? { warnings: warnList } : {}),
    },
  };
}
