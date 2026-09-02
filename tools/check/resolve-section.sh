#!/usr/bin/env bash
# resolve-section.sh — 行号 → markdown 段落归属解析器
# Resolve a line number to its owning markdown section (heading).
#
# 用途（Purpose）:
#   防止「行号冒充归属（line-number-as-attribution）」——把 grep 得到的行号
#   直接当成段落级结论的证据。凡报告中出现「第 N 行 + 段落级结论」，
#   先用本工具解析归属再落笔。
#   Guards against citing a bare line number as evidence for a section-level
#   claim: resolve the owning heading BEFORE writing the conclusion.
#
# 用法（Usage）:
#   bash tools/check/resolve-section.sh <file> <line> [--chain]
#     --chain   显示完整标题链（## 章 > ### 节），默认只显示最近一级
#
# 退出码（Exit codes）:
#   0  成功解析（含"无归属标题"这一合法结果）
#   1  用法错误 / 文件不存在 / 行号非法或越界
#
# 设计约束（Design notes）:
#   - 排障工具，不是门禁：不接入 check-guards / CI。做成自动检查会变成
#     「扫描面为 0 也不报错」的死分支——正是 v1.4.4 从 check-review-system.sh
#     删掉的那一类。Deliberately NOT a gate: an automated version of this
#     would silently pass on an empty scan, the exact dead-branch pattern
#     removed from check-review-system.sh in v1.4.4.
#   - bash 3.2 兼容（macOS 自带）：不用 declare -A / mapfile / ${var^^}。

set -uo pipefail

FILE="${1:-}"
LINE="${2:-}"
MODE="${3:-}"

# ── 参数校验（Argument validation）────────────────────────────────
if [ -z "$FILE" ] || [ -z "$LINE" ]; then
  echo "用法: bash tools/check/resolve-section.sh <file> <line> [--chain]" >&2
  echo "  --chain  显示完整标题链（## 章 > ### 节）" >&2
  exit 1
fi

if [ ! -f "$FILE" ]; then
  echo "错误: 文件不存在: ${FILE}" >&2
  exit 1
fi

# 行号须为正整数（positive integer only）
if ! printf '%s' "$LINE" | grep -qE '^[0-9]+$'; then
  echo "错误: 行号必须为正整数: ${LINE}" >&2
  exit 1
fi

# wc -l 输出含前导空格，tr 去之（strip padding from wc output）
TOTAL=$(wc -l < "$FILE" | tr -d ' ')
if [ "$LINE" -lt 1 ] || [ "$LINE" -gt "$TOTAL" ]; then
  echo "错误: 行号 ${LINE} 越界（文件共 ${TOTAL} 行）" >&2
  exit 1
fi

# ── 取目标行之前的全部标题（Collect headings above the target line）──
# sed 截取 1..N 行，grep -n 保留行号，形如 "123:## 审查视角"
# 命令替换加 || true：grep 零命中 exit 1 会在 set -e 下杀掉脚本
HEADINGS=$(sed -n "1,${LINE}p" "$FILE" | grep -nE '^#{1,6} ' || true)

if [ -z "$HEADINGS" ]; then
  echo "${FILE}:${LINE} → （无归属标题：该行之前没有 markdown 标题）"
  exit 0
fi

# ── 默认模式：最近一级标题（Nearest enclosing heading）─────────────
# cut -d: -f1 取行号，-f2- 取标题（标题内可能含冒号，故用 -f2- 而非 -f2）
LAST=$(printf '%s\n' "$HEADINGS" | tail -1)
LAST_LINE=$(printf '%s' "$LAST" | cut -d: -f1)
LAST_TITLE=$(printf '%s' "$LAST" | cut -d: -f2-)

if [ "$MODE" != "--chain" ]; then
  echo "${FILE}:${LINE} → 归属段落: ${LAST_TITLE}  (标题在 ${LAST_LINE} 行)"
  exit 0
fi

# ── --chain 模式：逐级取最近标题，拼成标题链（Closest heading per level）──
CHAIN=""
LVL=1
while [ "$LVL" -le 6 ]; do
  # 构造 N 个 #（build N hashes without bash-4-only features）
  HASHES=""
  I=0
  while [ "$I" -lt "$LVL" ]; do
    HASHES="${HASHES}#"
    I=$((I + 1))
  done
  # ## 后必须紧跟空格，否则 ### 会被 ## 误匹配
  # (a trailing space is required so ### never matches ##)
  MATCH=$(printf '%s\n' "$HEADINGS" | grep -E "^[0-9]+:${HASHES} " | tail -1 || true)
  if [ -n "$MATCH" ]; then
    TITLE=$(printf '%s' "$MATCH" | cut -d: -f2-)
    if [ -z "$CHAIN" ]; then
      CHAIN="${TITLE}"
    else
      CHAIN="${CHAIN} > ${TITLE}"
    fi
  fi
  LVL=$((LVL + 1))
done

echo "${FILE}:${LINE} → 标题链: ${CHAIN}"
exit 0
