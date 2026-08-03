// ============================================================
// config-template.ts · .sofagent/config.yml 配置模板
// v1.2 新增：--init 命令使用此模板生成项目级配置文件
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
  # 可用 key: a1-a17, e1-e4
  # 显式 false 禁用，未列或 true 表示启用
  # rules:
  #   a3: false  # 禁用「不改越界」检查
  #   e1: true   # 显式启用 E1（需同时设 extendedRulesEnabled: true）

# v1.0.9: A16 非授权文件变更
A16:
  enabled: true
  protected_dirs:
    - "config/"
    - ".env"
    - "secrets/"
    - ".sofagent/config.yml"
  sensitive_types:
    - ".xlsx"
    - ".docx"
    - ".pdf"
    - ".db"
    - ".sqlite"
    - ".pem"
    - ".key"

# v1.0.9: A17 异常批量变更
A17:
  enabled: true
  bulk_threshold: 50
  bulk_window_ms: 300000

# v1.1.6: 感知层配置——控制 sofagent 输出签名与品牌可见性
perception:
  # 所有输出是否带 [sofagent] 签名（审计报告/webhook 推送/MCP tool 返回）
  enabled: true
  # 推送目标（可多个）：webhook://钉钉/飞书/企微 URL
  # push_target:
  #   - webhook://https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx

# ── 配置防篡改签名（可选）──
# 如需防止 Agent 篡改本配置文件，可对 config.yml 签名：
#   1. 创建密钥（仅一次）：openssl rand -hex 32 > ~/.sofagent-key && chmod 600 ~/.sofagent-key
#   2. 颁发签名：node tools/sign-config.mjs .sofagent/config.yml
# 签名后 config.yml 顶层会多出 signature: <hex> 字段。
# 加载时若签名不匹配会告警（不阻断启动）。
# 修改配置后需重新签名。
`;

/**
 * commit-msg hook 模板内容
 * 与 hooks/commit-msg 保持一致（含 v1.0 无声失败保护）
 */
export const HOOK_TEMPLATE = `#!/bin/bash
# sofagent commit-msg hook v1.2.5
# 安装：sofagent-audit --init 或 sofagent-audit --install-hook
# commit-msg hook 接收 $1 = commit message 文件路径

# 0a. 环境变量旁路——init/acceptance-test 等内部流程设置此变量时跳过 hook
if [ -n "$SOFAGENT_SKIP_HOOK" ]; then
  exit 0
fi

# 0b. 读取 commit message（commit-msg hook 独有优势）
#    - subject（第一行）：A3 越界检查依赖此参数
#    - 完整 message：A9 注入检查依赖此参数（body 里的注入 payload 不能漏检）
COMMIT_MSG_FILE="$1"
COMMIT_SUBJECT=""
COMMIT_FULL_MSG=""
if [ -f "$COMMIT_MSG_FILE" ]; then
  COMMIT_SUBJECT=$(head -1 "$COMMIT_MSG_FILE")
  COMMIT_FULL_MSG=$(cat "$COMMIT_MSG_FILE")
fi

DIFF=$(git diff --cached --name-only)
if [ -z "$DIFF" ]; then
  exit 0
fi

# 1. Node.js 检测
if ! command -v node &>/dev/null; then
  echo "❌ sofagent 提示：你的环境中未找到 Node.js，审计无法运行"
  echo "   请安装 Node.js >= 18: https://nodejs.org"
  exit 1
fi

# 2. sofagent-audit 检测（优先用仓库本地 engine/audit/dist/，避免全局旧版版本漂移）
if [ -f "engine/audit/dist/index.js" ]; then
  AUDIT_CMD=(node "engine/audit/dist/index.js")
elif command -v sofagent-audit &>/dev/null; then
  AUDIT_CMD=(sofagent-audit)
else
  echo "❌ sofagent 提示：未找到 sofagent-audit 命令，审计无法运行"
  echo "   请运行: npm install -g @sofagent/audit"
  exit 1
fi

# 3. 用 --cached 只审计暂存区（避免扫到工作树未 staged 的改动导致 A3 误报）
# 统一用 --cached——审计引擎自带首次提交空 HEAD 兼容
AUDIT_DIFF_ARG="--cached"

# 4. 正常运行审计
# --task 传 subject（A3 越界检查用）
# --commit-msg 传完整 message（A9 注入检查用）——两个参数都传
# AUDIT_CMD 用 bash 数组——仓库路径含空格时（如 /Users/foo/my repo/）不炸
if [ -n "$COMMIT_SUBJECT" ]; then
  "\${AUDIT_CMD[@]}" --diff "$AUDIT_DIFF_ARG" --silent --ci --task "$COMMIT_SUBJECT" --commit-msg "$COMMIT_FULL_MSG"
else
  "\${AUDIT_CMD[@]}" --diff "$AUDIT_DIFF_ARG" --silent --ci
fi
EXIT_CODE=$?

if [ $EXIT_CODE -eq 2 ]; then
  echo ""
  echo "❌ sofagent 发现违规，commit 已阻止。"
  echo "   请修复下列问题后重新提交。"
  echo ""
  echo "⚠️  如需临时跳过，请咨询安全管理员并在 CI 侧补审（企业场景建议 CI 侧 sofagent-audit --diff 兜底）"
  exit 1
fi

if [ $EXIT_CODE -eq 1 ]; then
  echo ""
  echo "⚠️  sofagent 发现警告（不阻止 commit）。"
fi

exit 0
`;
