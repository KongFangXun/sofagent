// ============================================================
// index.ts · 规则注册表
// reporter 从此导入 rules 数组，循环调用——不再硬编码 import 每条规则
// 新增铁律：实现 Rule 接口 → 在此数组中追加即可
// v0.94：新增 7 条纯 diff 规则（R1-R5, R11, R12）
// ============================================================

import type { Rule } from './types';
import { checkRule01 } from './rule-01-read-before-write';
import { checkRule03 } from './rule-03-verify-before-continue';
import { checkRule07 } from './rule-07-careful-modify';
import { checkRule10 } from './rule-10-honest-report';
import { checkRuleR1 } from './rule-r1-unrelated-files';
import { checkRuleR2 } from './rule-r2-no-test-files';
import { checkRuleR3 } from './rule-r3-todo-undeclared';
import { checkRuleR4 } from './rule-r4-large-deletion';
import { checkRuleR5 } from './rule-r5-commit-placeholder';
import { checkRuleR11 } from './rule-r11-sensitive-files';
import { checkRuleR12 } from './rule-r12-low-comment-ratio';

export const rules: Rule[] = [
  { name: '铁律 #1 先读再用', number: 1, evidenceMode: 'hybrid', check: checkRule01 },
  { name: '铁律 #3 验证再干', number: 3, evidenceMode: 'hybrid', check: checkRule03 },
  { name: '铁律 #7 谨慎修改', number: 7, evidenceMode: 'git-diff', check: checkRule07 },
  { name: '铁律 #10 如实汇报', number: 10, evidenceMode: 'git-diff', check: checkRule10 },
  { name: 'R1 无关文件', number: 101, evidenceMode: 'git-diff', check: checkRuleR1 },
  { name: 'R2 测试缺失', number: 102, evidenceMode: 'git-diff', check: checkRuleR2 },
  { name: 'R3 TODO 未声明', number: 103, evidenceMode: 'git-diff', check: checkRuleR3 },
  { name: 'R4 大量删除', number: 104, evidenceMode: 'git-diff', check: checkRuleR4 },
  { name: 'R5 占位 commit', number: 105, evidenceMode: 'git-diff', check: checkRuleR5 },
  { name: 'R11 敏感文件', number: 111, evidenceMode: 'git-diff', check: checkRuleR11 },
  { name: 'R12 低注释率', number: 112, evidenceMode: 'git-diff', check: checkRuleR12 },
];
