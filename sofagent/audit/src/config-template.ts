// ============================================================
// config-template.ts · .sofagent/config.yml 配置模板
// v1.0 新增：--init 命令使用此模板生成项目级配置文件
// ============================================================
// 带注释的 YAML 模板，用户跑 --init 后可直接编辑
// ============================================================

export const CONFIG_TEMPLATE = `# sofagent 审计配置
# 文档: https://github.com/KongFangXun/sofagent#配置
# 生成方式: sofagent-audit --init

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

  # 扩展规则（E1-E4），默认关闭，按需启用
  extendedRulesEnabled: false
`;

/**
 * pre-commit hook 模板内容
 * 与 hooks/pre-commit 保持一致（含 v1.0 无声失败保护）
 */
export const HOOK_TEMPLATE = `#!/bin/bash
# sofagent pre-commit hook v1.0
# 安装：sofagent-audit --init 或 sofagent-audit --install-hook

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

# 3. 正常运行审计
$AUDIT_CMD --diff HEAD --silent --ci --task "$(cat .git/COMMIT_EDITMSG 2>/dev/null || echo 'pre-commit audit')"
EXIT_CODE=$?

if [ $EXIT_CODE -eq 2 ]; then
  echo ""
  echo "❌ sofagent audit: 检测到违规（A1/A2），commit 已阻止。"
  echo "   如需跳过，使用 git commit --no-verify（不推荐）。"
  exit 1
fi

if [ $EXIT_CODE -eq 1 ]; then
  echo ""
  echo "⚠️  sofagent audit: 检测到警告，但允许 commit。"
fi

exit 0
`;
