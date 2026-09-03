// ============================================================
// rules/index.ts · 官方示范规则集注册表
// v1.4.4（一）：10 条示范规则（8 条代码 AST + 2 条 OWASP 语义）
// 社区照这个结构写自己的 sofagent-ruleset-* 引擎
// ============================================================

import type { AstRule } from '../types';
import { noEvalRule } from './no-eval';
import { noHardcodedSecretRule } from './no-hardcoded-secret';
import { noChildProcessShellRule } from './no-child-process-shell';
import { noDynamicRequireRule } from './no-dynamic-require';
import { noInsecureUrlRule } from './no-insecure-url';
import { noDebuggerRule } from './no-debugger';
import { noSqlStringConcatRule } from './no-sql-string-concat';
import { noEmptyCatchRule } from './no-empty-catch';
import { asi01PromptInjectionRule } from './asi01-prompt-injection';
import { asi04SbomRule } from './asi04-sbom';

/** 内置示范规则集（10 条：7 FAIL / 3 WARN） */
export const builtinAstRules: readonly AstRule[] = [
  noEvalRule,                 // 禁止 eval() / new Function()
  noHardcodedSecretRule,      // 禁止硬编码密钥（AST 语义级）
  noDynamicRequireRule,       // 禁止动态 require（ASI04 关联）
  noDebuggerRule,             // 禁止 debugger 语句
  noChildProcessShellRule,    // child_process shell 执行管控
  noSqlStringConcatRule,      // 禁止 SQL 字符串拼接
  noInsecureUrlRule,          // 禁止 http:// 明文端点
  noEmptyCatchRule,           // 禁止空 catch 块
  asi01PromptInjectionRule,   // OWASP ASI01 目标劫持
  asi04SbomRule,              // OWASP ASI04 供应链 SBOM
];

/** 按规则 ID 导出（规则集 JSON 生成与单测引用） */
export const astRuleById: ReadonlyMap<string, AstRule> = new Map(
  builtinAstRules.map((r) => [r.id, r])
);
