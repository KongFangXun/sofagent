#!/bin/bash
# ============================================================
# sofagent 3 层加载链 · Harness Loader
# ============================================================
# 用途：OpenClaw before_prompt_build Hook 脚本（仅 OpenClaw 平台使用）
# 由 DeepSeek V4 Pro 辅助生成。
#       从 $OPENCLAW_STATE_DIR 读取 sofagent 宪法文件，
#       从 .sofagent/ 读取数据文件，拼接约束块 + SKILL 强制执行
#       + SHA-256 缓存，注入到系统 prompt 末尾。
#
# OpenClaw 已经自己读的文件（不需要重复注入）：
#   SOUL.md（大写）/ IDENTITY.md / MEMORY.md / USER.md
#
# sofagent 需要 Hook 注入的文件（OpenClaw 不认识）：
#   sofagent.md → think.md → rules.md
#
# 加载顺序：sofagent → think → rules → SKILL 强制执行（rules 最后加载，优先级最高）
#
# 用法：
#   load-chain.sh          正常模式，输出拼接后的约束块
#   load-chain.sh --check  仅检查缓存状态，输出 hit/miss，不产生输出
#   load-chain.sh --version  输出版本号
#   load-chain.sh --help     显示此帮助
#   SOFAGENT_DEBUG=1 load-chain.sh  调试模式，stderr 输出缓存状态
# ============================================================

set -euo pipefail
VERSION="1.0.0"

# ── 参数解析 ──
CHECK_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --check)   CHECK_ONLY=true ;;
    --version) echo "sofagent-load-chain v${VERSION}"; exit 0 ;;
    --help)
      echo "sofagent 3 层加载链 v${VERSION}"
      echo "  正常模式        输出拼接后的约束块"
      echo "  --check         仅检查 SHA-256 缓存状态（hit/miss）"
      echo "  --version       输出版本号"
      echo "  --help          显示此帮助"
      echo "环境变量:"
      echo "  SOFAGENT_DEBUG=1  启用调试日志（输出到 stderr）"
      echo "  OPENCLAW_STATE_DIR  指定 OpenClaw 状态目录"
      exit 0
      ;;
  esac
done

# ── 调试输出 ──
debug() { [ "${SOFAGENT_DEBUG:-0}" = "1" ] && echo "[sofagent-loader] $1" >&2 || true; }

# --- 路径配置 ---
OPENCLAW_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
CACHE_DIR="${TMPDIR:-/tmp}"
CACHE_FILE="${CACHE_DIR}/sofagent-loadchain-output.txt"
CACHE_HASH="${CACHE_DIR}/sofagent-loadchain-hash.txt"

# trap: 退出时清理临时文件
trap 'rm -f "${CACHE_TMP:-}"' EXIT

SOFAGENT_FILE="${OPENCLAW_DIR}/sofagent.md"
RULES_FILE="${OPENCLAW_DIR}/rules.md"

# think.md / orchestrator 在 .sofagent/ 下，不在 ~/.openclaw/
SOFAGENT_DATA="${SOFAGENT_DATA:-${PWD}/.sofagent}"
THINK_FILE="${SOFAGENT_DATA}/think.md"
ORCHESTRATOR_FILE="${SOFAGENT_DATA}/orchestrator/_index.md"

# ============================================================
# SKILL 强制执行（硬编码注入，Agent 绕不过去）
# ============================================================
SKILL_ENFORCEMENT='
<!-- ===== SOFAGENT SKILL 强制执行 ===== -->
**启动指令：在回复用户之前，必须先全文读取并执行 SKILL.md 中的入口流程。如果 .sofagent/ 数据目录不存在，先执行初始化。**
'

# ============================================================
# SHA-256 计算（macOS + Linux 兼容）
# ============================================================
calc_hash() {
  local combined=""
  local files=("$@")
  for f in "${files[@]}"; do
    if [ -f "$f" ]; then
      # macOS: shasum -a 256 / Linux: sha256sum
      combined+=$(shasum -a 256 "$f" 2>/dev/null || sha256sum "$f" 2>/dev/null || echo "")
    fi
  done
  # 加上 SKILL 强制执行的 hash（内容不变，但参与缓存判断）
  combined+=$(echo "$SKILL_ENFORCEMENT" | shasum -a 256 2>/dev/null || sha256sum 2>/dev/null || echo "")
  echo "$combined" | shasum -a 256 2>/dev/null | cut -d' ' -f1 || sha256sum 2>/dev/null | cut -d' ' -f1 || echo "nocache"
}

# ============================================================
# 反思降权处理（P0-5 真实现）
# - 含 [LLM自评] 的行：行尾动态追加降权提示
# - [已验证] / [用户确认] / 无标记行：原样输出
# - 不写回 think.md 文件——只在输出时追加
# - SHA-256 缓存按 think.md 原文计算（见 calc_hash），降权提示不参与缓存
# ============================================================
DOWNGRADE_SUFFIX="（⚠️ 权重×0.5，LLM自评未经外部验证，仅供参考）"

emit_think_downgraded() {
  local file="$1"
  # 用 awk 处理：UTF-8 友好，macOS/Linux 通用
  # 匹配含 [LLM自评 的行，在行尾拼接降权提示
  awk -v suffix="${DOWNGRADE_SUFFIX}" '
    /\[LLM自评/ { print $0 suffix; next }
    { print }
  ' "$file"
}

# ============================================================
# 缓存判断
# ============================================================
FILES_TO_MONITOR=("$SOFAGENT_FILE" "$RULES_FILE" "$THINK_FILE")
NEW_HASH=$(calc_hash "${FILES_TO_MONITOR[@]}")

if [ -f "$CACHE_HASH" ] && [ -f "$CACHE_FILE" ]; then
  OLD_HASH=$(cat "$CACHE_HASH" 2>/dev/null || echo "")
  if [ "$NEW_HASH" = "$OLD_HASH" ] && [ -n "$NEW_HASH" ]; then
    debug "cache hit (hash=${NEW_HASH:0:8}...)"
    if [ "$CHECK_ONLY" = true ]; then
      echo "hit"
      exit 0
    fi
    cat "$CACHE_FILE"
    exit 0
  fi
fi

if [ "$CHECK_ONLY" = true ]; then
  debug "cache miss (hash changed or no cache)"
  echo "miss"
  exit 0
fi

debug "cache miss, rebuilding..."

# ============================================================
# 重建缓存：读取 3 个文件 → 拼接 → 追加 SOUL 底线
# ============================================================
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# 先写到临时文件，再原子 mv（防止并发写入导致读半截）
CACHE_TMP="${CACHE_FILE}.tmp.$$"

{
  echo "<!-- sofagent · 3 层约束块 · ${TIMESTAMP} -->"
  echo

  # ── 第 1 层：契约层（sofagent.md）──
  if [ -f "$SOFAGENT_FILE" ]; then
    echo "<!-- ===== 第 1 层：契約層（sofagent.md）===== -->"
    cat "$SOFAGENT_FILE"
    echo
  else
    echo "<!-- ⚠️ sofagent.md 未找到，契约层缺失 -->"
  fi

  # ── 第 2 层：反思（think.md）──
  # [LLM自评] 条目降权：动态追加提示，不写回原文件
  # SHA-256 缓存按 think.md 原文计算，降权提示不参与缓存判断
  if [ -f "$THINK_FILE" ]; then
    echo "<!-- ===== 第 2 层：反思（think.md）===== -->"
    emit_think_downgraded "$THINK_FILE"
    echo
  fi

  # ── 第 3 层：执行层（rules.md）──
  if [ -f "$RULES_FILE" ]; then
    echo "<!-- ===== 第 3 层：執行層（rules.md）===== -->"
    cat "$RULES_FILE"
    echo
  fi

  # ── orchestrator/ 不在此处加载——由 SKILL.md 按需触发 ──

  # ── SKILL 强制执行（硬编码，最后加载 = 最高优先级）──
  echo "$SKILL_ENFORCEMENT"

} > "$CACHE_TMP"

# 原子写入：先写 hash → 再 mv 缓存文件
echo "$NEW_HASH" > "$CACHE_HASH"
mv "$CACHE_TMP" "$CACHE_FILE"

cat "$CACHE_FILE"
