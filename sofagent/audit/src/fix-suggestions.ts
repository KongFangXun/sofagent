// ============================================================
// fix-suggestions.ts · 审计违规修复建议
// v1.0 新增：每条违规/警告带「怎么修」建议
// ============================================================
// 11 条规则各自的修复建议字符串（≤80 字，一行说完）
// printResults 输出时在 detail 行后追加「怎么修」行
// ============================================================

/**
 * 规则修复建议映射表
 * key = 规则名称（与 rules/index.ts 的 name 字段一致）
 * value = 修复建议字符串
 */
const FIX_SUGGESTIONS: Record<string, string> = {
  'A1 不碰敏感': '.env 不应提交。如确认无敏感数据，在 commit message 中说明原因',
  'A2 不泄密钥': '将密钥写入 .env -> .gitignore 加 .env -> 重新提交',
  'A3 不改越界': '拆分提交，只提交与当前任务相关的文件，无关改动单独提交',
  'A4 不删配置': '确认是否为有意删除。如是，在 commit message 中说明原因',
  'A5 不瞒真相': '用 Conventional Commits 格式描述具体改动（如 fix: 修复登录页 token 过期）',
  'A6 不坏构建': '确认构建配置变更不会破坏构建，本地跑一次 npm run build 验证',
  'A7 不存盲改': '修改文件前先 Read 目标文件。Agent 日志记录在 .sofagent/task/logs/',
  'A8 不逃验证': '变更后跑 npm test 或 npm run build，日志记录在 .sofagent/task/logs/',
  'A9 不纳注入': '移除 diff 中的 prompt injection 模式（如 "ignore" + "previous" + "instructions"）',
  'A10 不引毒源': '改用官方 npm registry（npm config set registry https://registry.npmjs.org）',
  'A11 不滥资源': '拆分为多个小提交，每次只做一件事',
  // 扩展规则
  'E1 不落测试': '测试文件不应进入生产提交，分离到 dev 分支或加 .gitignore',
  'E2 不空标记': 'TODO 必须关联 issue 编号（如 TODO(#123)）或直接解决',
  'E3 不滥删除': '确认删除范围，使用保守修剪原则：只删纯 UI，保留结构性模块',
  'E4 不低注释': '补充函数注释，目标注释率 >= 10%',
};

/**
 * 获取规则修复建议
 * @param ruleName 规则名称
 * @returns 修复建议字符串，无匹配时返回 null
 */
export function getFixSuggestion(ruleName: string): string | null {
  return FIX_SUGGESTIONS[ruleName] ?? null;
}
