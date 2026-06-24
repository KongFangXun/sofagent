#!/bin/bash
# ============================================================
# sofagent skill-safety-check.sh · Skill 安全审查（确定性正则快筛）
# ============================================================
# 扫描 Skill 文件中的安全威胁——恶意命令/密钥泄露/危险API/Prompt注入/数据外泄。
# 纯 bash + grep，零外部依赖，Agent 不可绕过。
# 由 DeepSeek V4 Pro 和 GLM-5.2 配合生成。
#
# 用法：
#   skill-safety-check.sh <skill-file-or-dir>     # 扫描单个文件或目录
#   skill-safety-check.sh --json <path>            # JSON 输出（CI/CD）
#   skill-safety-check.sh --help
#
# 退出码：
#   0 = 未发现威胁（SAFE）
#   1 = 发现高危威胁（DANGEROUS）— 正则命中，直接拦截
#   2 = 发现可疑内容（SUSPICIOUS）— 需人工/LLM 复查
# ============================================================

set -uo pipefail

VERSION="0.91"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# -------------------------------------------
# 颜色函数（兼容无 tty 场景）
# -------------------------------------------
if [ -t 1 ]; then
  RED='\033[0;31m'
  YELLOW='\033[0;33m'
  GREEN='\033[0;32m'
  BOLD='\033[1m'
  NC='\033[0m'
else
  RED='' YELLOW='' GREEN='' BOLD='' NC=''
fi

info()  { printf "${BOLD}[sofagent]${NC} %s\n" "$*"; }
ok()    { printf "${GREEN}  ✓${NC} %s\n" "$*"; }
warn()  { printf "${YELLOW}  ⚠${NC} %s\n" "$*"; }
err()   { printf "${RED}  ✗${NC} %s\n" "$*"; }

# -------------------------------------------
# 帮助
# -------------------------------------------
show_help() {
  cat <<EOF
sofagent skill-safety-check.sh v${VERSION} · Skill 安全审查

用法：
  $0 <skill-file-or-dir>      扫描单个文件或目录
  $0 --json <path>            JSON 输出（CI/CD）
  $0 --quiet <path>           仅输出 verdict + exit code（管道友好）
  $0 --help                   显示此帮助

退出码：
  0 = SAFE       未发现威胁
  1 = DANGEROUS  发现高危威胁，建议直接拦截
  2 = SUSPICIOUS 发现可疑内容，需人工/LLM 复查
EOF
  exit 0
}

# -------------------------------------------
# 参数解析
# -------------------------------------------
OUTPUT_MODE="terminal"
TARGET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h) show_help ;;
    --json)    OUTPUT_MODE="json"; shift ;;
    --quiet)   OUTPUT_MODE="quiet"; shift ;;
    --version) echo "skill-safety-check.sh v${VERSION}"; exit 0 ;;
    *)         TARGET="$1"; shift ;;
  esac
done

if [ -z "$TARGET" ]; then
  echo "错误：缺少扫描目标。用法：$0 <file-or-dir>" >&2
  exit 2
fi

if [ ! -e "$TARGET" ]; then
  echo "错误：目标不存在：$TARGET" >&2
  exit 2
fi

# -------------------------------------------
# 正则模式表（5 类，~20 条）
# 用 tab 分隔字段，避免与正则中的 | 冲突
# -------------------------------------------
# shellcheck disable=SC2034
TAB=$'\t'

# 每条规则：pattern TAB category TAB severity TAB description
RULES=()

# === 恶意命令 ===
RULES+=("(^|[^a-zA-Z0-9_])rm[[:space:]]+-rf[[:space:]]+/${TAB}恶意命令${TAB}DANGEROUS${TAB}rm -rf / 危险删除")
RULES+=("curl.*\|.*bash${TAB}恶意命令${TAB}DANGEROUS${TAB}curl 管道执行 bash")
RULES+=("curl.*\|.*sh(${TAB}恶意命令${TAB}DANGEROUS${TAB}curl 管道执行 sh")
RULES+=("wget.*\|.*sh${TAB}恶意命令${TAB}DANGEROUS${TAB}wget 管道执行 sh")
RULES+=("wget.*\|.*bash${TAB}恶意命令${TAB}DANGEROUS${TAB}wget 管道执行 bash")
RULES+=("chmod[[:space:]]+777[[:space:]]+/${TAB}恶意命令${TAB}DANGEROUS${TAB}chmod 777 / 全局可写")
RULES+=("mkfs\.${TAB}恶意命令${TAB}DANGEROUS${TAB}mkfs 格式化磁盘")
RULES+=("dd[[:space:]]+if=.*of=/dev/${TAB}恶意命令${TAB}DANGEROUS${TAB}dd 磁盘覆写")

# === 密钥泄露 ===
RULES+=("AKIA[0-9A-Z]{16}${TAB}密钥泄露${TAB}DANGEROUS${TAB}AWS Access Key")
RULES+=("sk-[a-zA-Z0-9]{20,}${TAB}密钥泄露${TAB}DANGEROUS${TAB}OpenAI API Key")
RULES+=("gh[pousr]_[A-Za-z0-9]{36}${TAB}密钥泄露${TAB}DANGEROUS${TAB}GitHub Token")
RULES+=("-----BEGIN.*PRIVATE KEY-----${TAB}密钥泄露${TAB}DANGEROUS${TAB}PEM 私钥头")

# === 危险调用 ===
RULES+=("eval\(.*[^0-9\"'].*\)${TAB}危险调用${TAB}SUSPICIOUS${TAB}eval() 非常量参数")
RULES+=("os\.system\(${TAB}危险调用${TAB}SUSPICIOUS${TAB}os.system() 系统调用")
RULES+=("child_process\.exec${TAB}危险调用${TAB}SUSPICIOUS${TAB}child_process.exec 命令执行")
RULES+=("subprocess\.call${TAB}危险调用${TAB}SUSPICIOUS${TAB}subprocess.call 命令执行")
RULES+=("new[[:space:]]+Function\(${TAB}危险调用${TAB}SUSPICIOUS${TAB}new Function() 动态执行")

# === 注入攻击 / 数据外泄 ===
RULES+=("(^|[^a-zA-Z])(ignore|forget|disregard)[[:space:]](previous|all|above)[[:space:]]*(instructions|prompts|rules)${TAB}注入攻击${TAB}SUSPICIOUS${TAB}ignore previous instructions 注入")
RULES+=("webhook\.site|requestbin|pipedream${TAB}注入攻击${TAB}SUSPICIOUS${TAB}数据外泄端点")

# === 混淆代码 ===
RULES+=("base64[[:space:]].*decode${TAB}混淆代码${TAB}SUSPICIOUS${TAB}Base64 解码（可能混淆载荷）")
RULES+=("eval\(atob\(${TAB}混淆代码${TAB}DANGEROUS${TAB}eval(atob()) Base64 混淆执行")

# -------------------------------------------
# 扫描函数
# -------------------------------------------

# 找出所有需扫描的文件
find_files() {
  local target="$1"
  if [ -f "$target" ]; then
    echo "$target"
  elif [ -d "$target" ]; then
    find "$target" -type f \( \
      -name '*.md' -o -name '*.js' -o -name '*.ts' -o \
      -name '*.py' -o -name '*.sh' -o -name '*.json' -o \
      -name '*.yaml' -o -name '*.yml' \
    \) 2>/dev/null
  fi
}

# 扫描单个文件，返回命中列表（每行：file TAB line TAB category TAB severity TAB pattern TAB description）
scan_file() {
  local file="$1"
  local hits=""
  for rule in "${RULES[@]}"; do
    # 用 tab 作为 IFS 来解析规则
    local pattern category severity description
    IFS="$TAB" read -r pattern category severity description <<< "$rule"
    # 用 grep -nE 匹配，提取行号
    local matches
    matches=$(grep -nE "$pattern" "$file" 2>/dev/null)
    if [ -n "$matches" ]; then
      while IFS=':' read -r line_num _rest; do
        hits+="${file}${TAB}${line_num}${TAB}${category}${TAB}${severity}${TAB}${pattern}${TAB}${description}"$'\n'
      done <<< "$matches"
    fi
  done
  echo "$hits"
}

# -------------------------------------------
# 主流程
# -------------------------------------------

SCAN_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
RESULTS=()
FILES_SCANNED=0
SAFE_COUNT=0
DANGEROUS_COUNT=0
SUSPICIOUS_COUNT=0
OVERALL_VERDICT="SAFE"

# 收集文件列表
FILES=()
while IFS= read -r file; do
  FILES+=("$file")
done < <(find_files "$TARGET")
FILES_SCANNED=${#FILES[@]}

for file in "${FILES[@]}"; do
  hits=$(scan_file "$file")

  # 统计命中数（非空行数）
  if [ -z "$hits" ] || [ "$(echo "$hits" | tr -d '[:space:]')" = "" ]; then
    hit_count=0
  else
    hit_count=$(echo "$hits" | sed '/^$/d' | wc -l | tr -d ' ')
  fi

  file_hits_json="[]"

  if [ "$hit_count" -eq 0 ]; then
    verdict="SAFE"
    ((SAFE_COUNT++))
    if [ "$OUTPUT_MODE" = "terminal" ]; then
      ok "SAFE — $file"
    fi
  else
    # 判断 verdict
    if echo "$hits" | grep -q "${TAB}DANGEROUS${TAB}"; then
      verdict="DANGEROUS"
      ((DANGEROUS_COUNT++))
      OVERALL_VERDICT="DANGEROUS"
    else
      verdict="SUSPICIOUS"
      ((SUSPICIOUS_COUNT++))
      if [ "$OVERALL_VERDICT" != "DANGEROUS" ]; then
        OVERALL_VERDICT="SUSPICIOUS"
      fi
    fi

    if [ "$OUTPUT_MODE" = "terminal" ]; then
      if [ "$verdict" = "DANGEROUS" ]; then
        err "DANGEROUS — $file ($hit_count hits)"
      else
        warn "SUSPICIOUS — $file ($hit_count hits)"
      fi
      # 逐条展示命中
      while IFS="$TAB" read -r f line category severity pattern description; do
        [ -z "$f" ] && continue
        if [ "$severity" = "DANGEROUS" ]; then
          err "  L$line: 🚫 $category — $description"
        else
          warn "  L$line: ⚠️  $category — $description"
        fi
      done <<< "$hits"
    fi

    # JSON 格式构建
    if [ "$OUTPUT_MODE" = "json" ]; then
      file_hits_json="["
      first=1
      while IFS="$TAB" read -r f line category severity pattern description; do
        [ -z "$f" ] && continue
        [ $first -eq 0 ] && file_hits_json+=","
        json_pattern=$(echo "$pattern" | sed 's/\\/\\\\/g; s/"/\\"/g')
        json_desc=$(echo "$description" | sed 's/\\/\\\\/g; s/"/\\"/g')
        file_hits_json+="{\"line\":$((line)),\"category\":\"$category\",\"severity\":\"$severity\",\"pattern\":\"$json_pattern\",\"description\":\"$json_desc\"}"
        first=0
      done <<< "$hits"
      file_hits_json+="]"
    fi
  fi

  RESULTS+=("{\"file\":\"$file\",\"verdict\":\"$verdict\",\"hits\":$file_hits_json}")
done

# 确定退出码
if [ "$OVERALL_VERDICT" = "DANGEROUS" ]; then
  EXIT_CODE=1
elif [ "$OVERALL_VERDICT" = "SUSPICIOUS" ]; then
  EXIT_CODE=2
else
  EXIT_CODE=0
fi

# -------------------------------------------
# 输出
# -------------------------------------------
if [ "$OUTPUT_MODE" = "json" ]; then
  echo "{"
  echo "  \"version\": \"$VERSION\","
  echo "  \"scanned_at\": \"$SCAN_TIME\","
  echo "  \"files_scanned\": $FILES_SCANNED,"
  echo "  \"verdict\": \"$OVERALL_VERDICT\","
  echo "  \"exit_code\": $EXIT_CODE,"
  echo "  \"results\": ["
  first_result=1
  for result in "${RESULTS[@]}"; do
    [ $first_result -eq 0 ] && echo ","
    echo -n "    $result"
    first_result=0
  done
  echo ""
  echo "  ]"
  echo "}"
elif [ "$OUTPUT_MODE" = "terminal" ]; then
  echo ""
  info "Skill 安全审查 · 扫描 $FILES_SCANNED 个文件"
  echo ""
  printf "  结果: ${GREEN}${SAFE_COUNT} SAFE${NC} / ${RED}${DANGEROUS_COUNT} DANGEROUS${NC} / ${YELLOW}${SUSPICIOUS_COUNT} SUSPICIOUS${NC}\n"
  printf "  退出码: $EXIT_CODE "
  case $EXIT_CODE in
    0) echo "(SAFE)" ;;
    1) echo "(DANGEROUS — 建议直接拦截)" ;;
    2) echo "(SUSPICIOUS — 需人工/LLM 复查)" ;;
  esac
  echo ""
elif [ "$OUTPUT_MODE" = "quiet" ]; then
  echo "$OVERALL_VERDICT"
fi

exit $EXIT_CODE
