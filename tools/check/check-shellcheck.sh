#!/usr/bin/env bash
# check-shellcheck.sh · 本仓 shellcheck 门禁（**CI 同口径**）
#
# 为什么需要它（v1.4.8 实锤）：
#   CI 的 `ludeeus/action-shellcheck` **没有配 ignore_paths** ⇒ 它按 **shebang** 扫**全仓**，
#   包括 `engine/audit/hooks/{pre-commit,commit-msg,post-commit}` 这类**无 .sh 扩展名**的脚本。
#   而本仓此前**没有对应的本地门禁**：人工核 shellcheck 时按 `find -name '*.sh'` 扫，
#   天然漏掉无扩展名脚本 ⇒ 本地全绿、CI 却红（v1.4.8 首轮 push 的 shellcheck 红即此因，
#   真凶是存量 `hooks/post-commit` 的 `git rev-parse HEAD^{tree}` 判 SC1083）。
#
# 扫描面口径（与 CI 对齐，改任一处必须同步另一处）：
#   范围 = git 跟踪的全部文件里，**首行含 shebang** 的文件（不限扩展名）
#   参数 = -s bash -S warning -e SC2034 -e SC1090 -e SC1091（与 .github/workflows/shellcheck.yml
#          的 SHELLCHECK_OPTS 逐字一致）
#
# 退出码：0=全绿 / 1=有违规 / 2=脚本自身错误（shellcheck 缺失 = 工具死了，非「没问题」）
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SELF_DIR/../.." && pwd)"
cd "$PROJECT_ROOT" || { echo "❌ 无法进入仓库根：$PROJECT_ROOT"; exit 2; }

if ! command -v shellcheck >/dev/null 2>&1; then
  echo "❌ shellcheck 未安装——本门禁无法执行（工具死了 ≠ 零违规）"
  echo "   安装：brew install shellcheck（或 apt-get install -y shellcheck）"
  exit 2
fi

SHELLCHECK_ARGS=(-s bash -S warning -e SC2034 -e SC1090 -e SC1091)

# 扫描面：git 跟踪文件 ∩ 首行 shebang（与 CI 的 action-shellcheck 同语义）
SCANNED=0
HITS=0
while IFS= read -r f; do
  [ -f "$f" ] || continue
  # 仅认 **shell** shebang（与 CI 的 action-shellcheck 同语义）——`#!/usr/bin/env node` 的
  # .mjs / `.js` 不是 shell 脚本，纳入会把 FORGE 的 JS 驱动全误报（v1.4.8 实测 46 处假红）。
  head -1 "$f" 2>/dev/null | grep -qE '^#!.*\b(ba|z|k)?sh\b' || continue
  SCANNED=$((SCANNED + 1))
  out=$(shellcheck "${SHELLCHECK_ARGS[@]}" -f gcc "$f" 2>&1 || true)
  if [ -n "$out" ]; then
    HITS=$((HITS + 1))
    echo "  ❌ $f"
    printf '%s\n' "$out" | head -3 | sed 's/^/      /'
  fi
done < <(git ls-files)

# 🔴 守卫不得空转：扫到 0 个文件说明 glob/发现逻辑失效（曾因目录重组静默失效）
if [ "$SCANNED" -eq 0 ]; then
  echo "❌ 扫描面为空——git ls-files × shebang 发现逻辑失效（守卫空转，比发现违规更坏）"
  exit 1
fi

echo ""
if [ "$HITS" -eq 0 ]; then
  echo "✅ shellcheck 全绿（$SCANNED 个带 shebang 的文件 · CI 同口径：-s bash -S warning -e SC2034/SC1090/SC1091）"
  exit 0
fi
echo "❌ shellcheck 发现 $HITS 个文件有违规（扫描 $SCANNED 个文件）"
exit 1
