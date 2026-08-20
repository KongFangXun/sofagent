// ============================================================
// config-template.ts · .sofagent/config.yml 配置模板
// v1.3 新增：--init 命令使用此模板生成项目级配置文件
// ============================================================
// 带注释的 YAML 模板，用户跑 --init 后可直接编辑
// ============================================================

import { VERSION } from './shared/constants';

export const CONFIG_TEMPLATE = `# sofagent 审计配置
# 文档: https://github.com/KongFangXun/sofagent#配置
# 生成方式: sofagent-audit --init
#
# sofagent 审计只检查进入 staging 的文件。
# .gitignore 排除的文件不会被审计——这是 git 设计，不是审计缺陷。
# 如果 Agent 用 git add -f 强制添加被忽略的文件，审计仍然会检测到。
#
# ⚠️ quick 模式（npx sofagent-audit，无参数）不读取本配置文件——
# 它只做只读快速审计（最近一次 commit），不加载 config.yml、不应用
# lowRiskPatterns / rules / extendedRulesEnabled 等配置项。
# 本配置仅在完整模式（sofagent-audit-full / git hook / --init 生成的项目级配置）下生效。

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
  # 可用 key: a1-a23, e1-e4
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

# v1.1.6: 感知层配置已移除（v1.3.1 #42）——perception.enabled 为死配置（全代码库零读取点）。
# 如需 webhook 推送，使用 audit.webhook 配置项（见下方）。

# ── 配置防篡改签名（可选）──
# 如需防止 Agent 篡改本配置文件，可对 config.yml 签名：
#   1. 创建密钥（仅一次）：openssl rand -hex 32 > ~/.sofagent-key && chmod 600 ~/.sofagent-key
#   2. 颁发签名：node tools/release/sign-config.mjs .sofagent/config.yml
# 签名后 config.yml 顶层会多出 signature: <hex> 字段。
# 加载时若签名不匹配会告警（不阻断启动）。
# 修改配置后需重新签名。
`;

/**
 * commit-msg hook 模板内容
 * 与 hooks/commit-msg 保持一致（含 v1.0 无声失败保护）
 */
export const HOOK_TEMPLATE = `#!/bin/bash
# sofagent commit-msg hook v${VERSION}
# 安装：sofagent-audit --init 或 sofagent-audit --install-hook
# commit-msg hook 接收 $1 = commit message 文件路径

# 0. 内部旁路已移除（v1.3.1 #2）——原 SOFAGENT_INTERNAL_INIT 环境变量可被任何进程设置，
#    构成审计绕过路径。init 流程改用 git -c core.hooksPath=/dev/null commit（Git 原生旁路）。

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

# 2. sofagent-audit 检测（v1.2.8: 只加载全局安装，不读仓库本地 dist——审计工具不能被审计对象篡改）
# v1.3.4 P1-7: 无 dist + 无全局安装时输出显著提示（不静默 exit），告知用户如何修复
if command -v sofagent-audit &>/dev/null; then
  AUDIT_CMD=(sofagent-audit)
else
  # v1.3.4 P1-7: clone 用户没 build dist 也没全局安装——显著提示而非只报错
  echo ""
  echo "  ╔════════════════════════════════════════════════════╗"
  echo "  ║  ⚠️ [sofagent] 审计引擎未找到                       ║"
  echo "  ║  未检测到 dist 构建产物且未全局安装 sofagent-audit  ║"
  echo "  ╠════════════════════════════════════════════════════╣"
  echo "  ║  解决方案（任选其一）：                              ║"
  echo "  ║  1. 本地构建：npm install && npm run build          ║"
  echo "  ║  2. 全局安装：npm install -g @sofagent/audit        ║"
  echo "  ╚════════════════════════════════════════════════════╝"
  echo ""
  echo "  ❌ commit 已阻止——请安装审计引擎后重新提交。"
  exit 1
fi

# 2.1 P1-A2: dist 完整性校验——防止本地覆写 dist 致审计失效
#     全局安装场景下比对其 dist 的 SHA-256 与安装时记录的基准哈希。
#     基准哈希存储在 ~/.sofagent/internal/audit-hash.txt（--doctor 首次运行时记录）。
SOFAGENT_HOME="\${SOFAGENT_HOME:-\$HOME/.sofagent}"
HASH_RECORD="$SOFAGENT_HOME/internal/audit-hash.txt"
GLOBAL_DIST=$(node -e "try{const p=require('path');const idx=require.resolve('sofagent-audit');const d=p.dirname(p.dirname(idx));process.stdout.write(p.join(d,'dist','index.js'))}catch{process.stdout.write('')}" 2>/dev/null)
# v1.3.1 #5: 基准哈希文件不存在时改为醒目警告（不再静默跳过完整性校验）
if [ -n "$GLOBAL_DIST" ] && [ -f "$GLOBAL_DIST" ] && [ ! -f "$HASH_RECORD" ]; then
  echo "⚠️ [sofagent] 首次运行——基准哈希未记录，已跳过完整性校验"
  echo "   运行 sofagent-audit --doctor 会自动记录基准哈希（后续运行将比对）"
elif [ -n "$GLOBAL_DIST" ] && [ -f "$GLOBAL_DIST" ] && [ -f "$HASH_RECORD" ]; then
  CURRENT_HASH=$(node -e "const c=require('crypto'),f=require('fs');process.stdout.write(c.createHash('sha256').update(f.readFileSync(process.argv[1])).digest('hex'))" "$GLOBAL_DIST" 2>/dev/null)
  RECORDED_HASH=$(cat "$HASH_RECORD" 2>/dev/null | tr -d '[:space:]')
  if [ -n "$CURRENT_HASH" ] && [ -n "$RECORDED_HASH" ] && [ "$CURRENT_HASH" != "$RECORDED_HASH" ]; then
    echo "🔴 [sofagent] 审计引擎完整性校验失败（dist 哈希不匹配）"
    echo "   审计引擎可能被替换（影子审计器劫持风险）。"
    echo "   如需恢复：npm install -g @sofagent/audit@latest"
    echo "   如为故意重建：sofagent-audit --doctor（会更新基准哈希）"
    exit 1
  fi
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

# 成功回声（可感知性）：一行轻提示让用户知道审计在保护——与 FAIL 横幅/WARN 提示对齐
if [ $EXIT_CODE -eq 0 ]; then
  echo "✓ [sofagent] 审计通过"
fi

exit 0
`;
