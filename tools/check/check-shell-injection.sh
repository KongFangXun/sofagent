#!/bin/bash
# check-shell-injection.sh — 命令注入静态扫（engine + tools + FORGE 源码面）
# ============================================================
# 职责：拦住「外部输入流进 shell 命令行」的写法复活。
#
# 为什么需要它（真实案，非假想）：
#   v1.4.3 安全修复批前，engine 里有 6 处形如
#     execSync(`git checkout -- "${file}"`, { stdio: 'pipe' })
#   的写法——双引号拦不住 `$(...)` 与反引号，因为 execSync 走 /bin/sh。
#   其中 fix-applier.ts 的 `target` 直出 LLM JSON，实测
#   `x$(touch PWNED_MARK).md` 真的执行了 touch（写盘路径亦无校验，
#   绝对路径与 ../ 均可落盘）。6 处全靠人工扫出来——没有自动防线，
#   下次还会长出来。
#
# 检测分两档：
#   ERROR（阻断）：单行模板插值 / 字符串拼接——已确证的注入形态
#   WARN （观察）：execSync/exec/spawn 后跟模板字符串——可能是跨行
#                  模板（本脚本逐行扫，跨行插值漏检），提示人工确认
#
# 正确写法（放行）：
#   execFileSync('git', ['checkout', '--', file], { cwd, stdio: 'pipe' })
#   参数数组不经 /bin/sh，文件名里的 $ ` ; | 都只是普通字符。
#   路径另需过 path-guard.ts 的 resolveWithinRoot 锚定。
#
# 用法：
#   bash tools/check/check-shell-injection.sh
#
# 退出码：0=全绿 / 1=有 ERROR / 2=脚本自身错误
#
# 设计纪律：
#   - 与 check-guards.sh 同款语言与结构（check 系家族风格）
#   - 只读静态扫，零副作用
#   - macOS bash 3.2 兼容（无 mapfile/declare -A）
#   - BSD grep 兼容：只用 ERE（-E），不用 \s \d 等 GNU 扩展
# ============================================================

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2

for _arg in "$@"; do
  case "$_arg" in
    --help|-h)
      echo "check-shell-injection.sh — 命令注入静态扫（engine + tools + FORGE 源码面）"
      echo "  (无参数)   扫 engine/*/src 的 .ts + tools/FORGE 的 .mjs 下的 execSync/exec/spawn 注入形态"
      echo "             ERROR 阻断（单行模板插值 / 字符串拼接）"
            echo "             WARN  观察（模板字符串，可能跨行——需人工确认）"
      exit 0 ;;
    *) echo "未知参数：${_arg}（本脚本不接受参数，仅 --help）"; exit 2 ;;
  esac
done

ERRS=0
WARNS=0

echo "=== check-shell-injection · 命令注入静态扫 ==="

# ── 扫描范围 ──
# 排除：node_modules / dist / __tests__ / .d.ts（测试与产物不受此约束）
# v1.7.x 批：FORGE 并入扫描面——SEC-9 教训，内部工具链同样吃外部输入。
#   SEC-9 实案：FORGE/src/disk-backend.mjs 的 grep 拼模板字符串注入存活数月，
#   原因就是本门禁只扫 engine——洞在 FORGE，门禁对它恒绿。
# 文件口径（find 谓词三选一，各目录按自身布局命中）：
#   - engine：*/src/* 下的 .ts（engine/*/src 布局，与原口径一致）
#   - FORGE：*/src/* 下的 .mjs（FORGE/src 全 .mjs——find *.ts 一发命中为零）
#   - tools：顶层 .mjs（tools/ 无 src/ 子目录布局，check-*.mjs/gen-*.mjs 平铺）
# 可用环境变量覆盖：SCAN_DIRS（空格分隔，如 "engine tools FORGE"）。
SCAN_DIRS="${SCAN_DIRS:-engine tools FORGE}"
# shellcheck disable=SC2086  # 刻意不加引号：SCAN_DIRS 是空格分隔的多目录（如
# "engine tools FORGE"），加引号会被 find 当成单个路径名；与 check-guards.sh 同款约定
SRC_FILES=$(find ${SCAN_DIRS} -type f \
  \( \( -path "*/src/*" -name "*.ts" \) -o \( -path "*/src/*" -name "*.mjs" \) -o -name "*.mjs" \) \
  ! -name "*.d.ts" ! -path "*/node_modules/*" ! -path "*/dist/*" \
  ! -path "*/__tests__/*" ! -name "*.test.ts" ! -name "*.test.mjs" 2>/dev/null | sort)

FILE_COUNT=$(echo "${SRC_FILES}" | grep -c . || true)
echo "  扫描源码文件：${FILE_COUNT} 个（${SCAN_DIRS}——engine/*/src .ts + FORGE/tools 全部 .mjs，已排除测试与产物）"
# 🔴 守卫不得空转：目录布局漂移（如 FORGE 改用 .ts）会让 find 命中归零而门禁
# 恒绿（SEC-13 反向教训——扫描面对新增代码形态失明比发现违规更坏）。
if [ "${FILE_COUNT}" -eq 0 ]; then
  echo "  ✗ 扫描面为空——find 文件口径与 ${SCAN_DIRS} 目录布局不再匹配，请更新本脚本"
  exit 2
fi

# ── ERROR ①：单行模板字符串插值 ──
# 形态：execSync(`...${var}...` / exec(`...${var}...` / spawn(`...${var}...`
# BSD grep ERE 兼容：字面反引号与 ${ 均按字面匹配（\$ 转义 $）
echo ""
echo "── ① 命令执行 + 单行模板插值（ERROR）──"
# shellcheck disable=SC2016
HIT1=$(echo "${SRC_FILES}" | while read -r f; do
  [ -f "${f}" ] || continue
  grep -nE '(execSync|execFileSync|exec|spawn|fork)\(\s*`[^`]*\$\{' "${f}" 2>/dev/null \
    | grep -vE '^\s*[0-9]+:\s*(\*|//|/\*)' | sed "s|^|${f}:|"
done || true)

if [ -n "${HIT1}" ]; then
  echo "${HIT1}" | while read -r line; do echo "  ✗ ${line}"; done
  ERRS=$((ERRS + $(echo "${HIT1}" | grep -c . || true)))
else
  echo "  ✓ 零命中"
fi

# ── ERROR ②：命令执行 + 字符串拼接 ──
# 形态：execSync('git add ' + file) / execSync("..." + var)
echo ""
echo "── ② 命令执行 + 字符串拼接（ERROR）──"
# shellcheck disable=SC2016
HIT2=$(echo "${SRC_FILES}" | while read -r f; do
  [ -f "${f}" ] || continue
  grep -nE "(execSync|execFileSync|exec|spawn|fork)\(\s*['\"][^'\"]*['\"]\s*\+" "${f}" 2>/dev/null \
    | grep -vE '^\s*[0-9]+:\s*(\*|//|/\*)' | sed "s|^|${f}:|"
done || true)

if [ -n "${HIT2}" ]; then
  echo "${HIT2}" | while read -r line; do echo "  ✗ ${line}"; done
  ERRS=$((ERRS + $(echo "${HIT2}" | grep -c . || true)))
else
  echo "  ✓ 零命中"
fi

# ── WARN ③：命令执行 + 模板字符串（未在同行检到插值，可能跨行）──
echo ""
echo "── ③ 命令执行 + 模板字符串（WARN：跨行插值本脚本漏检，需人工确认）──"
# shellcheck disable=SC2016
HIT3=$(echo "${SRC_FILES}" | while read -r f; do
  [ -f "${f}" ] || continue
  grep -nE '(execSync|execFileSync|exec|spawn|fork)\(\s*`' "${f}" 2>/dev/null \
    | grep -vE '\$\{' \
    | grep -vE '^\s*[0-9]+:\s*(\*|//|/\*)' | sed "s|^|${f}:|"
done || true)

if [ -n "${HIT3}" ]; then
  echo "${HIT3}" | while read -r line; do echo "  ⚠ ${line}"; done
  WARNS=$((WARNS + $(echo "${HIT3}" | grep -c . || true)))
else
  echo "  ✓ 零命中"
fi

# ── 汇总 ──
echo ""
echo "═══════════════════════════════════════"
if [ "${ERRS}" -gt 0 ]; then
  echo "  ✗ ${ERRS} 处命令注入形态（WARN ${WARNS} 处）"
  echo ""
  echo "  修法：改用 execFileSync + 参数数组，例如"
  echo "    execFileSync('git', ['checkout', '--', file], { cwd: rootDir, stdio: 'pipe' })"
  echo "  路径另需过 path-guard.ts 的 resolveWithinRoot / isPathWithinRoot 锚定。"
  exit 1
fi
echo "  ✓ 零命令注入形态（WARN ${WARNS} 处——人工确认后可忽略）"
exit 0
