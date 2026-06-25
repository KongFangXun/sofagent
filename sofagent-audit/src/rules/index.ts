// ============================================================
// index.ts · 规则注册表
// reporter 从此导入 rules 数组，循环调用——不再硬编码 import 每条规则
// 新增铁律：实现 Rule 接口 → 在此数组中追加即可
// ============================================================

import type { Rule } from './types';
import { checkRule01 } from './rule-01-read-before-write';
import { checkRule03 } from './rule-03-verify-before-continue';
import { checkRule07 } from './rule-07-careful-modify';
import { checkRule10 } from './rule-10-honest-report';

export const rules: Rule[] = [
  { name: '铁律 #1 先读再用', number: 1, check: checkRule01 },
  { name: '铁律 #3 验证再干', number: 3, check: checkRule03 },
  { name: '铁律 #7 谨慎修改', number: 7, check: checkRule07 },
  { name: '铁律 #10 如实汇报', number: 10, check: checkRule10 },
];
