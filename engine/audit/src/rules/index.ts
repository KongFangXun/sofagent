// ============================================================
// index.ts · 规则注册表
// reporter 从此导入规则数组，循环调用——不再硬编码 import 每条规则
// v0.97：铁律与审计分离——defaultRules (A1-A11) + extendedRules (E1-E4)
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
import { checkRuleA9 } from './rule-a9-no-injection';
import { checkRuleA10 } from './rule-a10-no-poison';
import { checkRuleA11 } from './rule-a11-no-abuse';
import { checkRuleA14 } from './rule-a14-kb-cross-domain';
import { checkRuleA15 } from './rule-a15-action-constraint';
import { checkRuleA16 } from './rule-a16-unauthorized-change';
import { checkRuleA17 } from './rule-a17-bulk-change';
import { checkRuleA18 } from './rule-a18-junk-file';
import { checkRuleA19 } from './rule-a19-commit-msg-quality';
import { checkRuleA20 } from './rule-a20-network-exfiltration';
import { checkRuleA21 } from './rule-a21-persistence';
import { checkRuleA22 } from './rule-a22-privilege-escalation';
import { checkRuleA23 } from './rule-a23-path-traversal';
import { checkRuleE1 } from './rule-e1-no-test-files';
import { checkRuleE2 } from './rule-e2-todo-undeclared';
// E3 已在 v1.2.5 并入 A11（行数维度），不再独立存在
import { checkRuleE4 } from './rule-e4-low-comment-ratio';

/** 默认规则（A1-A11 + A18/A19）——始终生效
 * v1.1.5: A18 从 extendedRules 提升为 defaultRules
 *        评估：在 sofagent 自身仓库根目录跑 A18（排除 node_modules/.git/dist/.workbuddy/docs/archive）
 *        扫描 513 个文件 → 误报 0 个 < 阈值 3 → 提升为基线能力
 *
 * v1.3.3 #11: priority 字段单源化——runner.ts 从规则定义读优先级分组，
 *      不再维护独立 AUDIT_PRIORITY。新增规则只需在此填 priority。
 *      priority 取值：critical（安全红线 fast-fail）/ warning（业务底线）/ crutch（拐杖）/ extended（扩展） */
export const defaultRules: Rule[] = [
  { name: 'A1 不碰敏感', number: 1, evidenceMode: 'git-diff', ruleClass: '业务底线', priority: 'critical', ruleType: 'diff', check: checkRuleA1 },
  { name: 'A2 不泄密钥', number: 2, evidenceMode: 'git-diff', ruleClass: '业务底线', priority: 'critical', ruleType: 'diff', check: checkRuleA2 },
  { name: 'A3 不改越界', number: 3, evidenceMode: 'git-diff', ruleClass: '能力拐杖', priority: 'warning', ruleType: 'diff', check: checkRuleA3 }, // A3: 启发式检测误报率高，不适合硬拦截，归为「能力拐杖」
  { name: 'A4 不删配置', number: 4, evidenceMode: 'git-diff', ruleClass: '业务底线', priority: 'warning', ruleType: 'diff', check: checkRuleA4 },
  { name: 'A5 不瞒真相', number: 5, evidenceMode: 'git-diff', ruleClass: '业务底线', priority: 'warning', ruleType: 'diff', check: checkRuleA5 },
  { name: 'A6 不坏构建', number: 6, evidenceMode: 'git-diff', ruleClass: '能力拐杖', priority: 'crutch', ruleType: 'diff', check: checkRuleA6 },
  { name: 'A7 不存盲改', number: 7, evidenceMode: 'hybrid', ruleClass: '能力拐杖', priority: 'crutch', ruleType: 'diff', check: checkRuleA7 },
  { name: 'A8 不逃验证', number: 8, evidenceMode: 'hybrid', ruleClass: '能力拐杖', priority: 'crutch', ruleType: 'diff', check: checkRuleA8 },
  { name: 'A9 不纳注入', number: 9, evidenceMode: 'git-diff', ruleClass: '业务底线', priority: 'critical', ruleType: 'diff', check: checkRuleA9 },
  { name: 'A10 不引毒源', number: 10, evidenceMode: 'git-diff', ruleClass: '业务底线', priority: 'critical', ruleType: 'diff', check: checkRuleA10 },
  { name: 'A11 不滥资源', number: 11, evidenceMode: 'git-diff', ruleClass: '业务底线', priority: 'warning', ruleType: 'diff', check: checkRuleA11 },
  // A12-A17 为预留/扩展编号：A12（供应链安全）和 A13（文件权限）已永久跳号——v0.99.4 合并入 A11（不滥资源），语义有重叠但不完全等价，A12/A13 独立规则留待未来版本恢复；A14-A17 见 extendedRules
  { name: 'A18 垃圾文件', number: 18, evidenceMode: 'git-diff', ruleClass: '能力拐杖', priority: 'crutch', ruleType: 'diff', check: checkRuleA18 },
  // v1.2.5: A19 ruleClass 从 '业务底线' 改为 '工程规范'（msg 质量是工程规范，不是安全红线）
  { name: 'A19 msg 质量', number: 19, evidenceMode: 'git-diff', ruleClass: '工程规范', priority: 'warning', ruleType: 'diff', check: checkRuleA19 },
  // v1.2.5 新增：A20-A23 四条安全红线规则（必须在 defaultRules，不能放 extendedRules）
  { name: 'A20 不泄外联', number: 20, evidenceMode: 'git-diff', ruleClass: '业务底线', priority: 'critical', ruleType: 'diff', check: checkRuleA20 },
  { name: 'A21 不植后门', number: 21, evidenceMode: 'git-diff', ruleClass: '业务底线', priority: 'critical', ruleType: 'diff', check: checkRuleA21 },
  { name: 'A22 不越权限', number: 22, evidenceMode: 'git-diff', ruleClass: '业务底线', priority: 'critical', ruleType: 'diff', check: checkRuleA22 },
  { name: 'A23 不逃路径', number: 23, evidenceMode: 'git-diff', ruleClass: '业务底线', priority: 'critical', ruleType: 'diff', check: checkRuleA23 },
];

/** 扩展规则（E1-E4 + A14-A17）——默认不生效，需 config.extendedRulesEnabled = true
 *
 * 编号规则：
 * - A14-A17：行为类扩展规则（沿用 A 系列编号，number = 规则号，与 defaultRules 同 namespace 但 A12-A13 已永久跳号，合并入 A11（语义部分重叠但不完全等价））
 * - E1-E4：引擎增强类扩展规则（E 系列，number = 200 + 序号，避免与 A 系列冲突）
 * v1.3.3 #11: priority 统一为 'extended'（扩展规则层） */
export const extendedRules: Rule[] = [
  { name: 'E1 不落测试', number: 201, evidenceMode: 'git-diff', ruleClass: '能力拐杖', priority: 'extended', ruleType: 'diff', check: checkRuleE1 },
  { name: 'E2 不空标记', number: 202, evidenceMode: 'git-diff', ruleClass: '能力拐杖', priority: 'extended', ruleType: 'diff', check: checkRuleE2 },
  // E3 已在 v1.2.5 并入 A11（行数维度），编号跳号
  { name: 'E4 不低注释', number: 204, evidenceMode: 'git-diff', ruleClass: '能力拐杖', priority: 'extended', ruleType: 'diff', check: checkRuleE4 },
  { name: 'A14 知识库越权', number: 14, evidenceMode: 'hybrid', ruleClass: '能力拐杖', priority: 'extended', ruleType: 'diff', check: checkRuleA14 },
  { name: 'A15 不盲动', number: 15, evidenceMode: 'hybrid', ruleClass: '能力拐杖', priority: 'extended', ruleType: 'diff', check: checkRuleA15 },
  { name: 'A16 非授权文件变更', number: 16, evidenceMode: 'git-diff', ruleClass: '工程规范', priority: 'extended', ruleType: 'diff', check: checkRuleA16, description: '检测敏感目录/文件类型的非授权变更' },
  { name: 'A17 异常批量变更', number: 17, evidenceMode: 'filesystem', ruleClass: '工程规范', priority: 'extended', ruleType: 'diff', check: checkRuleA17, description: '检测短时间内大量文件变更' },
];

/** 全部规则——reporter 默认使用此数组（含 default + extended） */
export const rules: Rule[] = [...defaultRules, ...extendedRules];
