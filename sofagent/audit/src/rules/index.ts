// ============================================================
// index.ts · 规则注册表
// reporter 从此导入规则数组，循环调用——不再硬编码 import 每条规则
// v0.95：铁律与审计分离——defaultRules (A1-A8) + extendedRules (E1-E4)
// ============================================================

import type { Rule } from './types';
import { checkRuleA1 } from './rule-a1-sensitive-files';
import { checkRuleA2 } from './rule-a2-secret-leak';
import { checkRuleA3 } from './rule-a3-careful-modify';
import { checkRuleA4 } from './rule-a4-config-deleted';
import { checkRuleA5 } from './rule-a5-honest-report';
import { checkRuleA6 } from './rule-a6-build-broken';
import { checkRuleA7 } from './rule-a7-read-before-write';
import { checkRuleA8 } from './rule-a8-verify-before-continue';
import { checkRuleE1 } from './rule-e1-no-test-files';
import { checkRuleE2 } from './rule-e2-todo-undeclared';
import { checkRuleE3 } from './rule-e3-large-deletion';
import { checkRuleE4 } from './rule-e4-low-comment-ratio';

/** 默认规则（A1-A8）——始终生效 */
export const defaultRules: Rule[] = [
  { name: 'A1 不碰敏感', number: 1, evidenceMode: 'git-diff', ruleClass: '业务底线', check: checkRuleA1 },
  { name: 'A2 不泄密钥', number: 2, evidenceMode: 'git-diff', ruleClass: '业务底线', check: checkRuleA2 },
  { name: 'A3 不改越界', number: 3, evidenceMode: 'git-diff', ruleClass: '业务底线', check: checkRuleA3 },
  { name: 'A4 不删配置', number: 4, evidenceMode: 'git-diff', ruleClass: '能力拐杖', check: checkRuleA4 },
  { name: 'A5 不瞒真相', number: 5, evidenceMode: 'git-diff', ruleClass: '业务底线', check: checkRuleA5 },
  { name: 'A6 不坏构建', number: 6, evidenceMode: 'git-diff', ruleClass: '能力拐杖', check: checkRuleA6 },
  { name: 'A7 不存盲改', number: 7, evidenceMode: 'hybrid', ruleClass: '能力拐杖', check: checkRuleA7 },
  { name: 'A8 不逃验证', number: 8, evidenceMode: 'hybrid', ruleClass: '能力拐杖', check: checkRuleA8 },
];

/** 扩展规则（E1-E4）——默认不生效，需 config.extendedRulesEnabled = true */
export const extendedRules: Rule[] = [
  { name: 'E1 不落测试', number: 201, evidenceMode: 'git-diff', ruleClass: '能力拐杖', check: checkRuleE1 },
  { name: 'E2 不空标记', number: 202, evidenceMode: 'git-diff', ruleClass: '能力拐杖', check: checkRuleE2 },
  { name: 'E3 不滥删除', number: 203, evidenceMode: 'git-diff', ruleClass: '能力拐杖', check: checkRuleE3 },
  { name: 'E4 不低注释', number: 204, evidenceMode: 'git-diff', ruleClass: '能力拐杖', check: checkRuleE4 },
];

/** 全部规则——reporter 默认使用此数组（含 default + extended） */
export const rules: Rule[] = [...defaultRules, ...extendedRules];
