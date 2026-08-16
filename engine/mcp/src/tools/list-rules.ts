// ============================================================
// list-rules.ts · list_rules MCP tool（v1.3.5 交付 4）
//
// 规则透明化——列出所有运行时/提交时审计规则清单（只读）。
// type='tool' → engine/rules defaultToolRules（运行时 tool-gate 规则）
// type='diff' → engine/audit rules（git-diff 级 A/E 规则）
// type='all'（默认）→ 合并列出
//
// ⚠️ 安全边界：只列规则清单（名称/编号/等级/ruleType/启停），
// 不暴露规则实现逻辑（check 函数体）。harness 是纯内部装配层，永不 MCP 化。
// ============================================================

import { defaultToolRules } from '@sofagent/rules';
import { defaultRules, extendedRules } from '@sofagent/audit';
import type { ToolResult } from './audit-tools';

/** 规则清单条目（只读，不暴露实现） */
export interface RuleListEntry {
  name: string;
  number: number;
  ruleClass?: string;
  ruleType: 'tool' | 'diff';
  /** 启停状态：diff 默认规则/扩展规则，tool 规则恒启用 */
  enabled: boolean;
}

/** list_rules 入参 */
export interface ListRulesArgs {
  type?: 'tool' | 'diff' | 'all';
}

/**
 * 列出规则清单（只读）。
 * @param args type: 'tool' | 'diff' | 'all'（默认 all）
 */
export function listRules(args: ListRulesArgs = {}): ToolResult {
  const type = args.type ?? 'all';
  const entries: RuleListEntry[] = [];

  if (type === 'tool' || type === 'all') {
    for (const r of defaultToolRules) {
      entries.push({
        name: r.name,
        number: r.number,
        ruleClass: r.ruleClass,
        ruleType: 'tool',
        enabled: true,
      });
    }
  }

  if (type === 'diff' || type === 'all') {
    for (const r of defaultRules) {
      entries.push({
        name: r.name,
        number: r.number,
        ruleClass: r.ruleClass,
        ruleType: 'diff',
        enabled: true,
      });
    }
    for (const r of extendedRules) {
      entries.push({
        name: r.name,
        number: r.number,
        ruleClass: r.ruleClass,
        ruleType: 'diff',
        enabled: false, // 扩展规则缺省关闭（仅 --extended 启用）
      });
    }
  }

  return {
    text: `共 ${entries.length} 条规则（${type}）`,
    data: { rules: entries },
  };
}
