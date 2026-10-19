#!/usr/bin/env bash
# ============================================================
# install-hooks.sh · 家族钩子安装器（唯一实现 · R5 / R6）
# ============================================================
# 装什么：pre-commit → 文档债务门禁（八类判据）
#         commit-msg  → 提交信息格式（中文 conventional，仓规 AGENTS.md「完成即提交」）
# 为什么：本家族各仓「永不 push」⇒ 没有 CI 兜底 ⇒ 本地钩子是门禁的唯一天然落点。
#         门禁存在但不被调用 = 睡着的门禁；本安装器就是叫醒它的那只手。
#
# 口径住实现（R5）：本文件是唯一安装器；各仓 tools/install-hooks.sh 只做一行转调。
#
# R6 两条：
#   ① 幂等 —— 连跑两次产物逐字相同（钩子内容为常量，不带时间戳/路径哈希）
#   ② 跨形态 —— clone / worktree / submodule 都可用：钩子目录一律由
#      `git rev-parse --git-path hooks` 求得（**禁止**拼 $ROOT/.git/hooks——
#      worktree 里 .git 是**文件**不是目录，拼接必然 mkdir 失败）
#
# 逃生口：SKIP_DOC_DEBT=1（显式跳过，日志留痕自担）· SKIP_COMMIT_LINT=1
set -euo pipefail

# 本仓（工具仓）根 = 本文件所在目录的上一级；被装的仓 = 参数 1（缺省 = 工具仓自己）
TOOLS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CALLER="$(cd "${1:-$TOOLS_ROOT}" && pwd)"

if ! git -C "$CALLER" rev-parse --git-dir >/dev/null 2>&1; then
  echo "❌ $CALLER 不是 git 仓（或 git 不可用）——拒绝安装（R3：失灵可见）" >&2
  exit 2
fi

# R6② 跨形态：由 git 自己回答钩子目录在哪（clone / worktree / submodule 通吃）
HOOKS="$(git -C "$CALLER" rev-parse --git-path hooks)"
case "$HOOKS" in /*) ;; *) HOOKS="$CALLER/$HOOKS" ;; esac
mkdir -p "$HOOKS"

# 实现路径：从调用方看过去的相对路径（软引用，定稿 §四 既定范式）
IMPL="$TOOLS_ROOT/check/check-doc-debt.mjs"
if [ ! -f "$IMPL" ]; then
  echo "❌ 实现不可得：$IMPL 不存在——拒绝安装指向空物的钩子" >&2
  exit 2
fi
ABS_IMPL="$IMPL"
REL_IMPL="$(cd "$CALLER" && node -e 'const p=require("path"),f=require("fs");process.stdout.write(p.relative(process.cwd(),process.argv[1]))' "$IMPL")"

# ── pre-commit（常量正文 ⇒ 幂等）─────────────────────────────
# 实现定位两条腿（R6 跨形态）：① 按家族同级布局 `$ROOT/../sofagent-tools/check/`（可随仓搬迁）
#   ② 回落安装时的绝对路径（任意 worktree / 非同级布局下仍可用）。两条都失效 → exit 2 报明缺什么。
cat > "$HOOKS/pre-commit" <<EOF
#!/usr/bin/env bash
# 由 sofagent-tools/check/install-hooks.sh 生成——勿手改；改门禁请改实现文件
set -uo pipefail
[ "\${SKIP_DOC_DEBT:-0}" = "1" ] && { echo "[doc-debt] 已按 SKIP_DOC_DEBT=1 跳过"; exit 0; }
ROOT="\$(git rev-parse --show-toplevel)"
cd "\$ROOT"
IMPL="\$ROOT/../sofagent-tools/check/check-doc-debt.mjs"
[ -f "\$IMPL" ] || IMPL="$ABS_IMPL"
if [ ! -f "\$IMPL" ]; then
  echo "❌ 门禁实现不可得——试过：\$ROOT/../sofagent-tools/check/ 与 $ABS_IMPL" >&2
  echo "   （按 R3 失灵可见：拒绝静默放行。跳过请显式 SKIP_DOC_DEBT=1）" >&2
  exit 2
fi
SF="\${SOFAGENT_ROOT:-\$ROOT/../sofagent}"
if [ -f "\$SF/package.json" ]; then
  node "\$IMPL" --sofagent "\$SF"
else
  node "\$IMPL"
fi
rc=\$?
if [ "\$rc" -ne 0 ]; then
  echo ""
  echo "❌ 文档债务门禁未通过（rc=\${rc}）——提交被拦。按明细修；正当提及须写入 tools/doc-debt-exempt.json 台账。"
  echo "   （本次跳过：SKIP_DOC_DEBT=1 git commit ...）"
fi
exit \$rc
EOF

# ── commit-msg（中文 conventional：type(scope): 主题）──────────
cat > "$HOOKS/commit-msg" <<'EOF'
#!/usr/bin/env bash
# 由 sofagent-tools/check/install-hooks.sh 生成——勿手改
# 判据（仓规 AGENTS.md「完成即提交：中文 conventional 提交信息」）：
#   首行形如 type(scope): 主题 / type: 主题 / type(scope)!: 主题
#   type ∈ feat fix docs refactor test chore perf build ci style revert
#   放行：Merge / Revert / fixup! / squash! / 以 # 开头的注释行
set -uo pipefail
[ "${SKIP_COMMIT_LINT:-0}" = "1" ] && exit 0
MSG_FILE="$1"
FIRST="$(grep -v '^#' "$MSG_FILE" | sed -n '1p')"
[ -z "$FIRST" ] && exit 0
case "$FIRST" in
  Merge*|Revert*|fixup!*|squash!*) exit 0 ;;
esac
if printf '%s' "$FIRST" | grep -qE '^(feat|fix|docs|refactor|test|chore|perf|build|ci|style|revert)(\([^)]+\))?!?: .+'; then
  exit 0
fi
echo "" >&2
echo "❌ 提交信息格式不合规（commit-msg 钩子）：" >&2
echo "   实际首行：$FIRST" >&2
echo "   要求：type(scope): 中文主题——type ∈ feat fix docs refactor test chore perf build ci style revert" >&2
echo "   例：docs(口径): v0.2.0 声称作废——内容随分仓迁入" >&2
echo "   （本次跳过：SKIP_COMMIT_LINT=1 git commit ...）" >&2
exit 1
EOF

chmod +x "$HOOKS/pre-commit" "$HOOKS/commit-msg"
echo "✓ 已安装（跨形态 · 幂等）：$HOOKS"
echo "  pre-commit  → node $REL_IMPL"
echo "  commit-msg  → 中文 conventional 格式校验"
