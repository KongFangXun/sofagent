// ============================================================
// config-template.ts · .sofagent/config.yml 配置模板
// v1.0 新增：--init 命令使用此模板生成项目级配置文件
// ============================================================
// 带注释的 YAML 模板，用户跑 --init 后可直接编辑
// ============================================================

export const CONFIG_TEMPLATE = `# sofagent 审计配置
# 文档: https://github.com/KongFangXun/sofagent#配置
# 生成方式: sofagent-audit --init
#
# sofagent 审计只检查进入 staging 的文件。
# .gitignore 排除的文件不会被审计——这是 git 设计，不是审计缺陷。
# 如果 Agent 用 git add -f 强制添加被忽略的文件，审计仍然会检测到。

audit:
  # 低风险文件模式（不计入 A3「不改越界」检查）
  lowRiskPatterns:
    - package-lock.json
    - yarn.lock
    - "*.log"
    - docs/**

  # 测试/构建命令模式（A8「不逃验证」规则匹配）
  testPatterns:
    - npm test
    - npm run test
    - pytest
    - go test

  # A3「不改越界」阈值——不相关文件占比超过此值时 WARN
  carefulModifyThreshold: 0.2

  # 扩展规则（E1-E4 + A14），默认关闭，按需启用
  extendedRulesEnabled: false

  # loop-check 绝对轮次上限——超过自动 closure 交还人类（默认 20）
  # loopCheckMaxRounds: 20

  # 按规则名禁用——取消注释即可关闭指定规则
  # 可用 key: a1-a15, e1-e4
  # 显式 false 禁用，未列或 true 表示启用
  # rules:
  #   a3: false  # 禁用「不改越界」检查
  #   e1: true   # 显式启用 E1（需同时设 extendedRulesEnabled: true）
`;

/**
 * commit-msg hook 模板内容
 * 与 hooks/commit-msg 保持一致（含 v1.0 无声失败保护）
 */
export const HOOK_TEMPLATE = `#!/bin/bash
# sofagent commit-msg hook v1.0.5
# 安装：sofagent-audit --init 或 sofagent-audit --install-hook
# commit-msg hook 接收 $1 = commit message 文件路径

# 0. 读取 commit message（commit-msg hook 独有优势——A3 越界检查依赖此参数）
COMMIT_MSG_FILE="$1"
COMMIT_SUBJECT=""
if [ -f "$COMMIT_MSG_FILE" ]; then
  COMMIT_SUBJECT=$(head -1 "$COMMIT_MSG_FILE")
fi

DIFF=$(git diff --cached --name-only)
if [ -z "$DIFF" ]; then
  exit 0
fi

# 1. Node.js 检测
if ! command -v node &>/dev/null; then
  echo "❌ sofagent-audit: Node.js 未找到，审计未运行"
  echo "   请安装 Node.js >= 18: https://nodejs.org"
  exit 1
fi

# 2. sofagent-audit 检测
if command -v sofagent-audit &>/dev/null; then
  AUDIT_CMD="sofagent-audit"
elif [ -f "sofagent/audit/dist/index.js" ]; then
  AUDIT_CMD="node sofagent/audit/dist/index.js"
else
  echo "❌ sofagent-audit 未安装，审计未运行"
  echo "   请运行: npm install -g @sofagent/audit"
  exit 1
fi

# 3. 检测是否首次提交——无 HEAD 时用 --cached 模式扫描 staged 文件
if git rev-parse --verify HEAD &>/dev/null; then
  AUDIT_DIFF_ARG="HEAD"
else
  AUDIT_DIFF_ARG="--cached"
fi

# 4. 正常运行审计
# commit-msg hook 可读取 commit message，传 --task 使 A3 越界检查生效
if [ -n "$COMMIT_SUBJECT" ]; then
  $AUDIT_CMD --diff "$AUDIT_DIFF_ARG" --silent --ci --task "$COMMIT_SUBJECT"
else
  $AUDIT_CMD --diff "$AUDIT_DIFF_ARG" --silent --ci
fi
EXIT_CODE=$?

if [ $EXIT_CODE -eq 2 ]; then
  echo ""
  echo "❌ sofagent audit: 检测到违规，commit 已阻止。"
  echo "   请修复违规项后重新提交。"
  exit 1
fi

if [ $EXIT_CODE -eq 1 ]; then
  echo ""
  echo "⚠️  sofagent audit: 检测到警告，但允许 commit。"
fi

exit 0
`;
