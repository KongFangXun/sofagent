#!/usr/bin/env bash
# ============================================================
# sofagent-dashboard.sh · FDE Dashboard 终端三栏（v1.2.4）
# ============================================================

# 依赖检查
if ! command -v jq &> /dev/null; then
  echo "❌ sofagent Dashboard 需要 jq（JSON 处理工具）"
  echo ""
  echo "安装方法："
  echo "  macOS:  brew install jq"
  echo "  Ubuntu: sudo apt install jq"
  echo "  CentOS: sudo yum install jq"
  exit 1
fi
#
# 零前端依赖：bash + jq + tput。图表从 JSONL 实时渲染，绝不读 MD 报告
# （MD 是人读备份）。
#
# 用法：
#   sofagent-dashboard              跑一次看完关掉——核心视图（数据主权 + 规则审计 + 工作状态）
#   sofagent-dashboard --watch      2s 自动刷新
#   sofagent-dashboard --full       显示完整视图（追加编排控制图 / FORGE 审查 / 最近变更）
#   sofagent-dashboard --technical  状态词用技术术语（默认用户可读，交付六）
#
# 数据源：
#   数据主权  $SOFAGENT_HOME/data/audit/data-sovereignty/{年}/{月}/*.jsonl
#   规则审计  $SOFAGENT_HOME/data/audit/history.jsonl
#   工作状态  $SOFAGENT_HOME/data/audit/sub-progress-*.jsonl（自动发现）
#            $SOFAGENT_HOME/data/dashboard/daemon-health.json
#   Graph引擎 $SOFAGENT_HOME/data/dashboard/graph-state.json（v1.2.3 完整控制图）
#   FORGE    $SOFAGENT_HOME/data/forge-runs/fresh-eyes-loop/latest.json（交付三）
#   最近变更  $SOFAGENT_HOME/data/dashboard/workspace-changes.jsonl（交付五）
#   最近报告  $SOFAGENT_HOME/data/{企业名}/审计报告/（fde-profile.json 定企业名）
#
# 环境变量：
#   SOFAGENT_HOME   数据根目录（默认 ~/.sofagent；测试可指向 fixture）
#   SOFAGENT_DASHBOARD_NO_COLOR=1   关闭颜色（测试断言友好）
#   SOFAGENT_DASHBOARD_RECENT_N     最近变更面板条数（默认 5）
#
# 工程规范：不用 set -e + glob（铁律：glob 无匹配即崩），错误显式判断。
# bash 兼容：macOS 自带 bash 3.2——不用 declare -A / mapfile 等 4.x 特性。
# ============================================================

set -u
set -o pipefail

# ────────────────────────────────
# 参数与全局
# ────────────────────────────────

WATCH=0
# 交付六：--technical 切回技术状态词（默认用户可读）
TECHNICAL=0
# --full：显示全部区块（默认仅核心三栏）
FULL=0
# --trend：历史趋势模式（周对比 / 月趋势 / 任务统计）
TREND=0
for arg in "$@"; do
  case "$arg" in
    --watch) WATCH=1 ;;
    --technical) TECHNICAL=1 ;;
    --full) FULL=1 ;;
    --trend) TREND=1 ;;
  esac
done

# 非 watch 模式输出到临时文件再一次性 cat——便于测试捕获 + 避免半屏残留
BUFFER_FILE="$(mktemp -t sofagent-dashboard.XXXXXX)"
trap 'rm -f "$BUFFER_FILE"; if [ "$WATCH" = "1" ]; then tput cnorm 2>/dev/null || true; fi' EXIT

DATA_ROOT="${SOFAGENT_HOME:-$HOME/.sofagent}/data"
AUDIT_DIR="$DATA_ROOT/audit"
SOVEREIGNTY_DIR="$AUDIT_DIR/data-sovereignty"
HISTORY_FILE="$AUDIT_DIR/history.jsonl"
DAEMON_HEALTH="$DATA_ROOT/dashboard/daemon-health.json"
GRAPH_STATE="$DATA_ROOT/dashboard/graph-state.json"
# 交付三：FORGE latest.json 指针（driver 原子维护，Q4）
FORGE_LATEST="$DATA_ROOT/forge-runs/fresh-eyes-loop/latest.json"
# 交付五：workspace 变更摘要（daemon workspace-summary 写入）
WORKSPACE_CHANGES="$DATA_ROOT/dashboard/workspace-changes.jsonl"
# 最近变更面板条数（默认 5，可配）
RECENT_N="${SOFAGENT_DASHBOARD_RECENT_N:-5}"
case "$RECENT_N" in ''|*[!0-9]*) RECENT_N=5 ;; esac
REFRESH_INTERVAL=2

# 依赖检查
if ! command -v jq >/dev/null 2>&1; then
  echo "错误：sofagent-dashboard 依赖 jq，请先安装（brew install jq / apt install jq）" >&2
  exit 1
fi

# 数据文件预检查：全新安装用户友好引导（v1.4.3 第九章——空数据给「先做什么」
# 引导文案替代直接退出；仅主入口执行，LIB_ONLY 模式跳过）
# --trend 模式有自己的数据检查（weekly-*.json 不存在时优雅降级），跳过此预检
# Data pre-check only runs in main entry, not when sourced as library
if [ "${SOFAGENT_DASHBOARD_LIB_ONLY:-}" != "1" ] && [ "$TREND" != "1" ]; then
  if [ ! -f "$DAEMON_HEALTH" ] && [ ! -f "$GRAPH_STATE" ]; then
    echo ""
    echo "  ℹ️  Dashboard 尚无数据——这不是故障，是还没跑过任务。"
    echo ""
    echo "  按你想做的事选一条（10 分钟内出数据）："
    echo ""
    echo "  ① 想看审计/治理数据：先跑一次审计"
    echo "     sofagent-audit --diff"
    echo "     （跑完再执行本命令即可看到审计分析/近况）"
    echo ""
    echo "  ② 想让数据持续积累：启动 daemon 常驻采集"
    echo "     sofagent-daemon start"
    echo ""
    echo "  ③ 想看训练任务（v1.4.3 新增区块）：先提交一个训练任务"
    echo "     环境准备：bash tools/train-env-init.sh"
    echo "     任务提交：MCP train_submit（进度/健康度自动落盘）"
    echo ""
    echo "  指南：docs/HANDBOOK.md「新功能入口导览」表（三条产品线的入口与前置）"
    echo ""
    exit 0
  fi
fi

# ────────────────────────────────
# 颜色与符号（SOFAGENT_DASHBOARD_NO_COLOR=1 时全关）
# ────────────────────────────────

if [ "${SOFAGENT_DASHBOARD_NO_COLOR:-}" = "1" ] || [ ! -t 1 ]; then
  C_RESET=""; C_BOLD=""; C_DIM=""; C_CYAN=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_BLUE=""; C_MAGENTA=""
else
  C_RESET="$(tput sgr0)"; C_BOLD="$(tput bold)"; C_DIM="$(tput dim)"
  C_CYAN="$(tput setaf 6)"; C_GREEN="$(tput setaf 2)"; C_YELLOW="$(tput setaf 3)"
  C_RED="$(tput setaf 1)"; C_BLUE="$(tput setaf 4)"; C_MAGENTA="$(tput setaf 5)"
fi

# ────────────────────────────────
# 终端尺寸与布局
# ────────────────────────────────

# 终端尺寸：优先 COLUMNS/LINES（环境变量），tput 兜底（非 tty 下 tput 返回 0）
TERM_COLS="${COLUMNS:-$(tput cols 2>/dev/null || echo 0)}"  # guards-allow: 显示层降级（非 SSOT）
TERM_ROWS="${LINES:-$(tput lines 2>/dev/null || echo 0)}"  # guards-allow: 显示层降级（非 SSOT）
case "$TERM_COLS" in ''|*[!0-9]*) TERM_COLS=0 ;; esac
case "$TERM_ROWS" in ''|*[!0-9]*) TERM_ROWS=0 ;; esac
if [ "$TERM_COLS" -le 0 ]; then TERM_COLS=120; fi
if [ "$TERM_ROWS" -le 0 ]; then TERM_ROWS=30; fi
# 宽度阈值：>=110 三栏并排，否则堆叠
STACKED=0
if [ "$TERM_COLS" -lt 110 ]; then
  STACKED=1
fi
COL_W=$(( TERM_COLS / 3 - 2 ))
if [ "$COL_W" -lt 20 ]; then COL_W=20; fi

# ────────────────────────────────
# 小工具函数
# ────────────────────────────────

# 截断字符串到指定显示宽度（中文按 2 宽处理过于复杂，此处按字符数近似截断）
trunc() {
  local s="$1" w="$2"
  if [ "${#s}" -gt "$w" ]; then
    printf '%s…' "${s:0:$((w - 1))}"
  else
    printf '%s' "$s"
  fi
}

# 渲染横向小柱状条：bar <值> <最大值> <宽度>
bar() {
  local val="$1" max="$2" width="$3"
  local filled=0
  if [ "$max" -gt 0 ]; then
    filled=$(( val * width / max ))
  fi
  if [ "$filled" -gt "$width" ]; then filled="$width"; fi
  local i out=""
  for ((i = 0; i < width; i++)); do
    if [ "$i" -lt "$filled" ]; then out="${out}█"; else out="${out}░"; fi
  done
  printf '%s' "$out"
}

# sparkline：sparkline <逗号分隔的 7 个数值>
SPARK_CHARS=(▁ ▂ ▃ ▄ ▅ ▆ ▇ █)
sparkline() {
  local csv="$1" max=0 n
  local out=""
  local old_ifs="$IFS"
  IFS=','
  # 第一遍取最大值
  for n in $csv; do
    if [ "$n" -gt "$max" ] 2>/dev/null; then max="$n"; fi
  done
  for n in $csv; do
    local idx=0
    if [ "$max" -gt 0 ]; then
      idx=$(( n * 7 / max ))
    fi
    if [ "$idx" -gt 7 ] 2>/dev/null; then idx=7; fi
    out="${out}${SPARK_CHARS[$idx]}"
  done
  IFS="$old_ifs"
  printf '%s' "$out"
}

# 秒数 → 人类可读（如 "3s 前" / "2m 前" / "1h 前"）
ago() {
  local secs="$1"
  if [ "$secs" -lt 60 ]; then printf '%ds 前' "$secs"
  elif [ "$secs" -lt 3600 ]; then printf '%dm 前' $((secs / 60))
  elif [ "$secs" -lt 86400 ]; then printf '%dh 前' $((secs / 3600))
  else printf '%dd 前' $((secs / 86400)); fi
}

# ISO 8601 → epoch 秒（优先 gdate/date -d，macOS BSD date 兜底）
iso_to_epoch() {
  local iso="$1"
  local epoch
  epoch="$(date -j -u -f '%Y-%m-%dT%H:%M:%S' "${iso%%.*}" '+%s' 2>/dev/null)" && { printf '%s' "$epoch"; return 0; }
  epoch="$(date -u -d "$iso" '+%s' 2>/dev/null)" && { printf '%s' "$epoch"; return 0; }
  printf '0'
}

# 输出一行到缓冲区
emit() {
  printf '%s\n' "$1" >> "$BUFFER_FILE"
}

# ────────────────────────────────
# 交付六：humanize_status——技术术语 → 用户可读语言
#
# 映射表（与架构 spec 一致；用 case 实现而非 declare -A 关联数组——
# macOS 自带 bash 3.2 不支持 declare -A，运行时必崩）：
#   running→正在执行  completed→已完成  awaiting_human→等待你的确认
#   pending→等待中    failed→失败      skipped→已跳过
#   audit FAIL→审计未通过  audit PASS→审计通过  audit WARN→审计有警告
#   worktree→隔离工作区  sub-progress→子任务进度
#   degradationLevel:0→正常  :1→已简化任务范围（核心功能优先）
#   :2→低可信度（结果需人工复核）
#   idle→空闲（spec 映射表扩展——FORGE agent 步骤间隙态）
#
# 只翻状态词，不碰 A1-A21 规则名（架构师裁决 Q5）。
# --technical 时原样返回技术状态。
# ────────────────────────────────
humanize_status() {
  local key="$1"
  if [ "$TECHNICAL" = "1" ]; then
    printf '%s' "$key"
    return 0
  fi
  case "$key" in
    running)            printf '正在执行' ;;
    completed)          printf '已完成' ;;
    awaiting_human)     printf '等待你的确认' ;;
    pending)            printf '等待中' ;;
    idle)               printf '空闲' ;;
    failed)             printf '失败' ;;
    skipped)            printf '已跳过' ;;
    "audit FAIL")       printf '审计未通过' ;;
    "audit PASS")       printf '审计通过' ;;
    "audit WARN")       printf '审计有警告' ;;
    worktree)           printf '隔离工作区' ;;
    sub-progress)       printf '子任务进度' ;;
    degradationLevel:0) printf '正常' ;;
    degradationLevel:1) printf '已简化任务范围（核心功能优先）' ;;
    degradationLevel:2) printf '低可信度（结果需人工复核）' ;;
    *)                  printf '%s' "$key" ;;
  esac
}

# 节点状态 → 图标（graph 控制图 / FORGE 面板共用，5 种状态一一对应）
status_icon() {
  case "$1" in
    completed) printf '✅' ;;
    running)   printf '🔵' ;;
    failed)    printf '🔴' ;;
    skipped)   printf '⏭️' ;;
    *)         printf '⏳' ;;   # pending 兜底
  esac
}

# ────────────────────────────────
# 栏 1：数据主权（data-sovereignty/*.jsonl）
# ────────────────────────────────

render_sovereignty() {
  local w="$1"
  emit "${C_BOLD}${C_CYAN}▌ 数据主权（数据去哪了）${C_RESET}"
  # P1-23: 首次显示加解释行——以下数据均在本地存储，未上传任何远端
  emit "  ${C_DIM}以下数据均在本地存储，未上传任何远端${C_RESET}"

  # 聚合近 7 天：云端 / 本地 / 流出 / 敏感记录数
  local summary
  summary="$(
    find "$SOVEREIGNTY_DIR" -name '*.jsonl' -type f 2>/dev/null | while read -r f; do cat "$f"; done \
    | jq -r -s '
        def is_sensitive: .dataFlow.sensitivity == "restricted" or .dataFlow.sensitivity == "confidential";
        def is_cloud: .dataFlow.destination == "cloud-api";
        def is_out: .dataFlow.direction == "outbound";
        {
          total: length,
          cloud: ([.[] | select(is_cloud)] | length),
          local: ([.[] | select(is_cloud | not)] | length),
          outbound: ([.[] | select(is_out)] | length),
          sensitive: ([.[] | select(is_sensitive)] | length)
        } | "\(.total) \(.cloud) \(.local) \(.outbound) \(.sensitive)"' 2>/dev/null
  )"
  local total=0 cloud=0 local_n=0 outbound=0 sensitive=0
  if [ -n "$summary" ]; then
    read -r total cloud local_n outbound sensitive <<< "$summary"
  fi

  # 概览卡片（等宽三格，中文按 2 列宽计算）
  local inner=$(( w - 6 ))
  local cell=$(( inner / 3 ))
  local hr
  hr="$(printf '%*s' "$cell" '' | tr ' ' '─')"
  emit "  ┌${hr}┬${hr}┬${hr}┐"
  # 中文标签 2 字 = 4 列宽，padding 减 4
  emit "  │ 云端$(printf '%*s' $((cell - 5)) '')│ 本地$(printf '%*s' $((cell - 5)) '')│ 流出$(printf '%*s' $((cell - 5)) '')│"
  emit "  │ ${C_BLUE}${cloud}$(printf '%*s' $((cell - ${#cloud} - 1)) '')${C_RESET}│ ${C_GREEN}${local_n}$(printf '%*s' $((cell - ${#local_n} - 1)) '')${C_RESET}│ ${C_YELLOW}${outbound}$(printf '%*s' $((cell - ${#outbound} - 1)) '')${C_RESET}│"
  emit "  └${hr}┴${hr}┴${hr}┘"

  # 本地化率（P1-23：原"敏感度百分比 100%"措辞引发恐慌——575/575 实际含义是
  # "数据全部留在本地未外传"（好消息），改为直接说数据本地留存的措辞）
  local local_rate=0
  if [ "$total" -gt 0 ]; then
    local_rate=$(( local_n * 100 / total ))
  fi
  emit "  本地化率 $(bar "$local_rate" 100 $((w / 2))) ${local_rate}%（${local_n}/${total}）"

  # 近 7 天流向（按天聚合云端 / 本地）
  emit "  ${C_DIM}近 7 天流向${C_RESET}"
  local day_rows
  day_rows="$(
    find "$SOVEREIGNTY_DIR" -name '*.jsonl' -type f 2>/dev/null | while read -r f; do cat "$f"; done \
    | jq -r -s '
        group_by(.cloudCall.timestamp[0:10])
        | map({
            day: .[0].cloudCall.timestamp[0:10],
            cloud: ([.[] | select(.dataFlow.destination == "cloud-api")] | length),
            local: ([.[] | select(.dataFlow.destination != "cloud-api")] | length)
          })
        | sort_by(.day) | .[-7:][]
        | "\(.day) \(.cloud) \(.local)"' 2>/dev/null
  )"
  if [ -n "$day_rows" ]; then
    # 取最大值用于柱宽归一
    local day_max=1
    while read -r _day c l; do
      local s=$((c + l))
      if [ "$s" -gt "$day_max" ]; then day_max="$s"; fi
    done <<< "$day_rows"
    while read -r day c l; do
      local barw=$(( w - 22 ))
      if [ "$barw" -lt 6 ]; then barw=6; fi
      emit "  ${C_DIM}${day#*-}${C_RESET} $(bar $((c + l)) "$day_max" "$barw") 云${c} 本${l}"
    done <<< "$day_rows"
  else
    emit "  ${C_DIM}（暂无数据主权记录）${C_RESET}"
  fi

  # 最近记录表（最近 5 条：时间 / provider / 目的地 / 结果）
  emit "  ${C_DIM}最近记录${C_RESET}"
  local recent
  recent="$(
    find "$SOVEREIGNTY_DIR" -name '*.jsonl' -type f 2>/dev/null | while read -r f; do cat "$f"; done \
    | jq -r -s '
        sort_by(.cloudCall.timestamp) | .[-5:] | reverse[]
        | "\(.cloudCall.timestamp[11:19]) \(.cloudCall.provider) → \(.dataFlow.destination) [\(.localAction.auditResult)]"' 2>/dev/null
  )"
  if [ -n "$recent" ]; then
    while read -r line; do
      emit "  ${C_DIM}$(trunc "$line" $((w - 4)))${C_RESET}"
    done <<< "$recent"
  else
    emit "  ${C_DIM}（暂无记录）${C_RESET}"
  fi

  render_recent_reports "$w"
}

# 「最近报告」卡片——读 {企业名}/审计报告/ MD 文件列表（帮助用户快速跳转）
render_recent_reports() {
  local w="$1"
  emit "  ${C_DIM}最近报告${C_RESET}"

  # 企业名来自 data/config/fde-profile.json；缺省降级 data/reports
  local report_root="$DATA_ROOT/reports"
  local profile="$DATA_ROOT/config/fde-profile.json"
  if [ -f "$profile" ]; then
    local company
    company="$(jq -r '.company // empty' "$profile" 2>/dev/null)"
    if [ -n "$company" ]; then
      report_root="$DATA_ROOT/$company"
    fi
  fi

  local reports
  reports="$(
    find "$report_root" -path '*审计报告*' -name '*.md' -type f 2>/dev/null \
    | while read -r f; do printf '%s %s\n' "$(stat -f '%m' "$f" 2>/dev/null || stat -c '%Y' "$f" 2>/dev/null || echo 0)" "$f"; done \  # guards-allow: stat 双格式兜底显示层
    | sort -rn | head -5
  )"
  if [ -n "$reports" ]; then
    while read -r _mtime path; do
      emit "  ${C_DIM}📄 $(trunc "${path#"$DATA_ROOT"/}" $((w - 6)))${C_RESET}"
    done <<< "$reports"
  else
    emit "  ${C_DIM}（暂无报告）${C_RESET}"
  fi
}

# ────────────────────────────────
# 栏 2：规则审计（history.jsonl）
# ────────────────────────────────

render_rules() {
  local w="$1"
  emit "${C_BOLD}${C_MAGENTA}▌ 规则审计（Agent 犯规了吗）${C_RESET}"

  if [ ! -f "$HISTORY_FILE" ]; then
    emit "  ${C_DIM}（暂无审计历史：$HISTORY_FILE 不存在）${C_RESET}"
    return 0
  fi

  # 21 条规则通过率（统计最近 100 次审计中出现的规则）
  local pass_fail
  pass_fail="$(
    jq -r -s '
      [.[] | .ruleResults[]? | select(.status != "SKIPPED")] as $all
      | {
          pass: ([$all[] | select(.status == "PASS")] | length),
          warn: ([$all[] | select(.status == "WARN")] | length),
          fail: ([$all[] | select(.status == "FAIL")] | length)
        } | "\(.pass) \(.warn) \(.fail)"' "$HISTORY_FILE" 2>/dev/null
  )"
  local npass=0 nwarn=0 nfail=0
  if [ -n "$pass_fail" ]; then
    read -r npass nwarn nfail <<< "$pass_fail"
  fi
  local ntotal=$((npass + nwarn + nfail))
  local prate=0
  if [ "$ntotal" -gt 0 ]; then
    prate=$(( npass * 100 / ntotal ))
  fi
  emit "  通过率 $(bar "$prate" 100 $((w / 2))) ${prate}%（PASS ${npass} / WARN ${nwarn} / FAIL ${nfail}）"

  # 本周违规 TOP3（近 7 天 FAIL/WARN 规则按次数排序）
  emit "  ${C_DIM}本周违规 TOP3${C_RESET}"
  local week_ago
  week_ago="$(date -u -v-7d '+%Y-%m-%dT%H:%M:%S' 2>/dev/null || date -u -d '7 days ago' '+%Y-%m-%dT%H:%M:%S' 2>/dev/null || echo '')"
  # name 字段本身已含编码前缀（形如 "A3 不改越界"）：在 jq 内剥离前缀得到纯中文名，
  # 并由 number 单独派生编码；用制表符分隔输出，避免中文名内空格导致 bash 按空格切分错位。
  local top3
  top3="$(
    jq -r -s --arg since "$week_ago" '
      [.[] | select(.timestamp >= $since) | .ruleResults[]? | select(.status == "FAIL" or .status == "WARN")]
      | group_by(.number)
      | map({
          code: ("A" + (.[0].number | tostring)),
          name: (.[0].name | sub("^A[0-9]+[ ]+"; "")),
          count: length
        })
      | sort_by(-.count) | .[0:3][]
      | "\(.name)\t\(.code)\t\(.count)"' "$HISTORY_FILE" 2>/dev/null
  )"
  if [ -n "$top3" ]; then
    local i=1
    while IFS=$'\t' read -r zhname code count; do
      emit "  ${C_YELLOW}${i}.${C_RESET} $(trunc "$zhname" $((w - 20)))${C_DIM}（${code}）${C_RESET}${C_RED}· ${count} 次${C_RESET}"
      i=$((i + 1))
    done <<< "$top3"
  else
    emit "  ${C_GREEN}本周无违规 🎉${C_RESET}"
  fi

  # 最近审计记录（最近 5 次：时间 / 判定 / 任务摘要）
  emit "  ${C_DIM}最近审计记录${C_RESET}"
  local verdict_mark
  jq -r -s '
    sort_by(.timestamp) | .[-5:] | reverse[]
    | "\(.timestamp[5:16]) \(.exitCode) \((.task // .commitMsg // "")[0:40])"' "$HISTORY_FILE" 2>/dev/null \
  | while read -r ts code task; do
      case "$code" in
        0) verdict_mark="${C_GREEN}PASS${C_RESET}" ;;
        1) verdict_mark="${C_YELLOW}WARN${C_RESET}" ;;
        *) verdict_mark="${C_RED}FAIL${C_RESET}" ;;
      esac
      emit "  ${C_DIM}${ts}${C_RESET} ${verdict_mark} $(trunc "$task" $((w - 22)))"
    done
}

# ────────────────────────────────
# 栏 3：工作状态（仅 --watch）· SubAgent 面板（P2b）
# ────────────────────────────────

# 渲染单张 SubAgent 卡
# 参数：$1=role $2=文件路径 $3=栏宽 $4=当前 epoch
render_subagent_card() {
  local role="$1" file="$2" w="$3" now="$4"

  # 最近一条事件（任意 kind）→ 心跳检测
  local last_ts last_kind
  last_ts="$(tail -1 "$file" 2>/dev/null | jq -r '.timestamp // empty' 2>/dev/null)"
  last_kind="$(tail -1 "$file" 2>/dev/null | jq -r '.kind // empty' 2>/dev/null)"

  local status_icon="○" status_color="$C_DIM" status_text="空闲"
  local idle_secs=999999
  if [ -n "$last_ts" ]; then
    local last_epoch
    last_epoch="$(iso_to_epoch "$last_ts")"
    idle_secs=$(( now - last_epoch ))
    if [ "$idle_secs" -lt 0 ]; then idle_secs=0; fi
    if [ "$last_kind" = "node-end" ]; then
      status_icon="○"; status_color="$C_DIM"; status_text="空闲（上次 $(ago "$idle_secs")）"
    elif [ "$idle_secs" -ge 10 ]; then
      status_icon="●"; status_color="$C_RED"; status_text="疑似挂起（$(ago "$idle_secs")无事件）"
    elif [ "$idle_secs" -ge 5 ]; then
      status_icon="●"; status_color="$C_YELLOW"; status_text="运行中（心跳延迟 $(ago "$idle_secs")）"
    else
      status_icon="●"; status_color="$C_GREEN"; status_text="运行中（$(ago "$idle_secs")）"
    fi
  fi

  # 当前任务名：最近一条 node-start
  local task_name
  task_name="$(jq -r 'select(.kind == "node-start") | .taskName // empty' "$file" 2>/dev/null | tail -1)"
  if [ -z "$task_name" ]; then task_name="(未上报任务)"; fi

  # 本轮统计：最近 node-start 之后的 node-end 成功率 / 平均耗时 / token
  local stats
  stats="$(
    jq -r -s '
      [.[] | select(.kind == "node-end")] as $ends
      | {
          total: ($ends | length),
          ok: ([$ends[] | select(.success == true)] | length),
          avgMs: (if ($ends | length) > 0 then ([$ends[] | .durationMs // 0] | add / ($ends | length) | floor) else 0 end),
          tokens: ([$ends[] | .tokenCount // 0] | add)
        } | "\(.total) \(.ok) \(.avgMs) \(.tokens)"' "$file" 2>/dev/null
  )"
  local n_total=0 n_ok=0 avg_ms=0 tokens=0
  if [ -n "$stats" ]; then
    read -r n_total n_ok avg_ms tokens <<< "$stats"
  fi
  local succ_rate=0
  if [ "$n_total" -gt 0 ]; then
    succ_rate=$(( n_ok * 100 / n_total ))
  fi

  local inner=$(( w - 4 ))
  emit "  ┌─ ${C_BOLD}${role}${C_RESET} $(printf '%*s' "$((inner - ${#role} - 2))" '' | tr ' ' '─')┐"
  emit "  │ ${status_color}${status_icon} ${status_text}${C_RESET}"
  emit "  │ 任务: $(trunc "$task_name" $((inner - 8)))"
  emit "  │ 成功率 ${succ_rate}%（${n_ok}/${n_total}） · 均耗时 ${avg_ms}ms · ${tokens} tok"

  # 工具调用流（最近 5 条）
  local tool_flow
  tool_flow="$(
    jq -r -s '
      [.[] | select(.kind == "tool-call")] | .[-5:][]
      | "→ \(.toolName // "?") \((.target // "")[0:30]) \((.resultSummary // "")[0:20])"' "$file" 2>/dev/null
  )"
  if [ -n "$tool_flow" ]; then
    while read -r line; do
      emit "  │ ${C_DIM}$(trunc "$line" $((inner - 2)))${C_RESET}"
    done <<< "$tool_flow"
  fi

  # 成本曲线：近 7 天每日 token 总量 sparkline
  local spark
  spark="$(
    jq -r -s '
      def daykey: .timestamp[0:10];
      ([.[] | select(.tokenCount != null) | {d: daykey, t: .tokenCount}]
       | group_by(.d)
       | map({d: .[0].d, total: ([.[] | .t] | add)})) as $days
      | [(range(6; -1; -1)) as $i
         | ((now - ($i * 86400)) | strftime("%Y-%m-%d")) as $want
         | ([$days[] | select(.d == $want) | .total] | add) // 0]
      | join(",")' "$file" 2>/dev/null
  )"
  if [ -n "$spark" ]; then
    emit "  │ 成本: ${C_BLUE}$(sparkline "$spark")${C_RESET}（7 天）"
  fi
  emit "  └$(printf '%*s' "$((inner + 2))" '' | tr ' ' '─')┘"
}

render_status() {
  local w="$1"
  local now
  now="$(date '+%s')"
  emit "${C_BOLD}${C_GREEN}▌ 工作状态（SubAgent 面板）${C_RESET}"

  # 自动发现：glob sub-progress-*.jsonl，不硬编码 A/B
  local files=()
  local f
  for f in "$AUDIT_DIR"/sub-progress-*.jsonl; do
    if [ -f "$f" ]; then
      files+=("$f")
    fi
  done

  if [ "${#files[@]}" -eq 0 ]; then
    emit "  ${C_DIM}（暂无 SubAgent 进度文件：$AUDIT_DIR/sub-progress-*.jsonl）${C_RESET}"
  else
    # 折叠策略：每张卡约占 9 行；超出可容纳行数时按活跃/空闲分组
    local card_h=9
    local avail_rows=$(( TERM_ROWS - 14 ))
    if [ "$avail_rows" -lt "$card_h" ]; then avail_rows="$card_h"; fi
    local max_cards=$(( avail_rows / card_h ))

    # 分组：活跃（5s 内有事件且非 node-end）/ 空闲
    local active=() idle=()
    for f in "${files[@]}"; do
      local role
      role="$(basename "$f" .jsonl)"; role="${role#sub-progress-}"
      local last_ts last_kind last_epoch idle_secs
      last_ts="$(tail -1 "$f" 2>/dev/null | jq -r '.timestamp // empty' 2>/dev/null)"
      last_kind="$(tail -1 "$f" 2>/dev/null | jq -r '.kind // empty' 2>/dev/null)"
      last_epoch="$(iso_to_epoch "${last_ts:-1970-01-01T00:00:00Z}")"
      idle_secs=$(( now - last_epoch ))
      if [ "$last_kind" != "node-end" ] && [ "$idle_secs" -lt 5 ]; then
        active+=("$f")
      else
        idle+=("$f")
      fi
    done

    local shown=0
    if [ "${#active[@]}" -gt 0 ]; then
      emit "  ${C_DIM}── 活跃（${#active[@]}）${C_RESET}"
      for f in "${active[@]}"; do
        if [ "$shown" -ge "$max_cards" ]; then break; fi
        local role
        role="$(basename "$f" .jsonl)"; role="${role#sub-progress-}"
        render_subagent_card "$role" "$f" "$w" "$now"
        shown=$((shown + 1))
      done
    fi
    if [ "${#idle[@]}" -gt 0 ]; then
      if [ "$shown" -lt "$max_cards" ]; then
        emit "  ${C_DIM}── 空闲（${#idle[@]}）${C_RESET}"
        for f in "${idle[@]}"; do
          if [ "$shown" -ge "$max_cards" ]; then break; fi
          local role
          role="$(basename "$f" .jsonl)"; role="${role#sub-progress-}"
          render_subagent_card "$role" "$f" "$w" "$now"
          shown=$((shown + 1))
        done
      else
        emit "  ${C_DIM}── 空闲 ${#idle[@]} 个已折叠 ──${C_RESET}"
      fi
    fi
    local overflow=$(( ${#files[@]} - shown ))
    if [ "$overflow" -gt 0 ]; then
      emit "  ${C_DIM}… 另有 ${overflow} 个 SubAgent 已折叠（调高终端行数展开）${C_RESET}"
    fi
  fi

  # daemon 底部状态行（勘误#1：daemon-health.json 在 data/dashboard/）
  if [ -f "$DAEMON_HEALTH" ]; then
    local dh
    dh="$(jq -r '"\(.status // "unknown") \(.recentAlerts // 0) \(.uptime // "?")"' "$DAEMON_HEALTH" 2>/dev/null)"
    local dh_status dh_alerts dh_uptime dh_icon dh_color
    read -r dh_status dh_alerts dh_uptime <<< "$dh"
    case "$dh_status" in
      ok) dh_icon="●"; dh_color="$C_GREEN" ;;
      degraded) dh_icon="●"; dh_color="$C_YELLOW" ;;
      *) dh_icon="●"; dh_color="$C_RED" ;;
    esac
    emit "  daemon ${dh_color}${dh_icon} ${dh_status}${C_RESET} · ${dh_alerts} 告警 · uptime ${dh_uptime}"
  else
    emit "  ${C_DIM}daemon ○ 无健康数据（$DAEMON_HEALTH 不存在）${C_RESET}"
  fi
}

# ────────────────────────────────
# 区块 4：Graph Engine 控制图（v1.2.3 · 交付二 bash）
# 数据源：data/dashboard/graph-state.json
#   v1.2.3 新格式：nodes/edges/wave/degradationLevel + 旧三字段
#   v1.2.2 旧格式：activeNode/workGraphTasks/updatedAt（jq // 兜底不崩溃）
# 拓扑写死 5 节点链（plan → engineer → audit → reviewer → confirm）——
# 简化 bash 复杂度，不渲染动态节点数。
# ────────────────────────────────

# 状态行辅助：图标 + 用户可读（或 --technical 技术词）
graph_node_status_text() {
  local st="$1"
  printf '%s %s' "$(status_icon "$st")" "$(humanize_status "$st")"
}

render_graph_engine() {
  local w="$1"
  emit "${C_BOLD}${C_BLUE}▌ 编排状态（工作流控制图）${C_RESET}"

  if [ ! -f "$GRAPH_STATE" ]; then
    emit "  ${C_DIM}控制图数据不可用（编排引擎未运行）${C_RESET}"
    return 0
  fi

  # 新格式判定：nodes 是非空数组 → v1.2.3 控制图；否则旧三字段兜底
  local has_nodes
  has_nodes="$(jq -r 'if (.nodes? | type) == "array" and (.nodes | length) > 0 then "1" else "0" end' "$GRAPH_STATE" 2>/dev/null)"
  if [ "$has_nodes" = "1" ]; then
    render_graph_engine_v2 "$w"
  else
    render_graph_engine_legacy "$w"
  fi
}

# v1.2.3 完整控制图渲染
render_graph_engine_v2() {
  local w="$1"

  # 一次性 jq 提取：id → status 映射行（TSV）
  local nodes_tsv
  nodes_tsv="$(jq -r '.nodes[] | "\(.id)\t\(.status // "pending")"' "$GRAPH_STATE" 2>/dev/null)"

  local st_plan="pending" st_eng="pending" st_aud="pending" st_rev="pending" st_hum="pending"
  local nid nst
  while IFS=$'\t' read -r nid nst; do
    case "$nid" in
      plan)        st_plan="$nst" ;;
      engineer-1)  st_eng="$nst" ;;
      audit-1)     st_aud="$nst" ;;
      reviewer-1)  st_rev="$nst" ;;
      human-1)     st_hum="$nst" ;;
    esac
  done <<< "$nodes_tsv"

  # 链式流转图（拓扑写死，confirm = human_confirm 缩写）
  emit "  ${C_DIM}[plan] ──→ [engineer] ──→ [audit] ──→ [reviewer] ──→ [confirm]${C_RESET}"
  # 状态行：图标 + 可读状态（--technical 时为英文技术词）
  emit "  $(graph_node_status_text "$st_plan") plan · $(graph_node_status_text "$st_eng") engineer · $(graph_node_status_text "$st_aud") audit · $(graph_node_status_text "$st_rev") reviewer · $(graph_node_status_text "$st_hum") confirm"

  # engineer 子任务列表（有则展开）
  local subtasks
  subtasks="$(jq -r '.nodes[] | select(.id == "engineer-1") | .subtasks[]? | "\(.id)\t\(.status // "pending")\t\(.desc // "")"' "$GRAPH_STATE" 2>/dev/null)"
  if [ -n "$subtasks" ]; then
    local sub_count sub_line_num=0
    sub_count="$(printf '%s\n' "$subtasks" | wc -l | tr -d ' ')"
    local sid sst sdesc branch
    while IFS=$'\t' read -r sid sst sdesc; do
      sub_line_num=$((sub_line_num + 1))
      branch="├─"
      if [ "$sub_line_num" = "$sub_count" ]; then branch="└─"; fi
      emit "  ${branch} ${sid} $(status_icon "$sst") $(trunc "$sdesc" $((w - 16)))"
    done <<< "$subtasks"
  fi

  # 降级等级 + wave + 新鲜度
  local wave dlevel updated_at
  wave="$(jq -r '.wave // 1' "$GRAPH_STATE" 2>/dev/null)"
  dlevel="$(jq -r '.degradationLevel // 0' "$GRAPH_STATE" 2>/dev/null)"
  updated_at="$(jq -r '.updatedAt // ""' "$GRAPH_STATE" 2>/dev/null)"

  local age_text=""
  local updated_epoch age_secs
  updated_epoch="$(iso_to_epoch "$updated_at")"
  if [ "$updated_epoch" -gt 0 ]; then
    age_secs=$(( $(date '+%s') - updated_epoch ))
    if [ "$age_secs" -lt 0 ]; then age_secs=0; fi
    age_text=" · $(ago "$age_secs")更新"
  fi

  # degradationLevel > 0 时附人类可读说明（--technical 只给 L 等级）
  local deg_text="L${dlevel}"
  if [ "$TECHNICAL" != "1" ]; then
    deg_text="L${dlevel}（$(humanize_status "degradationLevel:${dlevel}")）"
  fi
  emit "  降级: ${deg_text} · Wave: ${wave}${C_DIM}${age_text}${C_RESET}"
}

# v1.2.2 旧三字段格式兜底渲染（向后兼容）
render_graph_engine_legacy() {
  local w="$1"
  local gs
  gs="$(jq -r '"\(.activeNode // "unknown") \(.workGraphTasks // 0) \(.updatedAt // "")"' "$GRAPH_STATE" 2>/dev/null)"
  local active_node="unknown" task_count="0" updated_at=""
  if [ -n "$gs" ]; then
    read -r active_node task_count updated_at <<< "$gs"
  fi

  # 数据新鲜度（updatedAt 距今）
  local now_epoch updated_epoch age_secs age_text=""
  now_epoch="$(date '+%s')"
  updated_epoch="$(iso_to_epoch "$updated_at")"
  if [ "$updated_epoch" -gt 0 ]; then
    age_secs=$(( now_epoch - updated_epoch ))
    if [ "$age_secs" -lt 0 ]; then age_secs=0; fi
    age_text="（$(ago "$age_secs")更新）"
  fi

  # ASCII 节点流转图：当前活跃节点用 [ ] 高亮，其余裸名
  local n_plan="plan" n_eng="engineer" n_aud="audit" n_rev="reviewer" n_hitl="human_confirm"
  case "$active_node" in
    plan)          n_plan="[${C_GREEN}plan${C_RESET}]" ;;
    engineer)      n_eng="[${C_GREEN}engineer${C_RESET}]" ;;
    audit)         n_aud="[${C_GREEN}audit${C_RESET}]" ;;
    reviewer)      n_rev="[${C_GREEN}reviewer${C_RESET}]" ;;
    human_confirm) n_hitl="[${C_GREEN}human_confirm${C_RESET}]" ;;
  esac

  emit "  活跃节点: ${C_BOLD}${active_node}${C_RESET} ${C_DIM}${age_text}${C_RESET}"
  emit "  Work Graph 任务数: ${C_BOLD}${task_count}${C_RESET}"
  emit "  ${n_plan} → ${n_eng} → ${n_aud} → ${n_rev} → ${n_hitl}"
}

# ────────────────────────────────
# 区块 5：FORGE 审查进度（v1.2.3 · 交付三）
# 数据源：data/forge-runs/fresh-eyes-loop/latest.json（driver 原子维护，Q4）
#   + 当前轮 round 目录的 sub-progress-A/B.jsonl（v1.2.1 L2 schema）取当前文件
# Dashboard 只读不写。
# ────────────────────────────────

# 取 agent 当前审查文件：当前轮 sub-progress-<role>.jsonl 最后一条带 target
# 的事件 → basename；取不到回退 latest.json 的 currentFile 字段
forge_current_file() {
  local round_dir="$1" role="$2" fallback="$3"
  local progress_file="$round_dir/sub-progress-${role}.jsonl"
  local target=""
  if [ -f "$progress_file" ]; then
    target="$(
      jq -r 'select(.target != null) | .target' "$progress_file" 2>/dev/null | tail -1
    )"
    if [ -n "$target" ]; then
      target="$(basename "$target")"
    fi
  fi
  if [ -z "$target" ]; then target="$fallback"; fi
  printf '%s' "${target:--}"
}

# agent 行渲染：图标 + 状态 + 当前文件 + 本轮发现 + 累计
# 统计 stall 事件数量（从 sub-progress-*.jsonl 中读取）
# 参数: $1=round_dir, $2=role (A/B)
# 返回: stall 事件数量
count_stall_events() {
  local round_dir="$1" role="$2"
  local progress_file="$round_dir/sub-progress-${role}.jsonl"
  if [ ! -f "$progress_file" ]; then
    echo "0"
    return
  fi
  # 统计 event=stall-detected 的行数
  jq -c 'select(.event == "stall-detected")' "$progress_file" 2>/dev/null | wc -l | tr -d ' '
}

render_forge_agent_line() {
  local label="$1" role="$2" w="$3" round_dir="$4"
  local status findings cumulative last_file
  status="$(jq -r ".agent${role}.status // \"idle\"" "$FORGE_LATEST" 2>/dev/null)"
  findings="$(jq -r ".agent${role}.findings // 0" "$FORGE_LATEST" 2>/dev/null)"
  cumulative="$(jq -r ".agent${role}.cumulative // \"P0×0 P1×0\"" "$FORGE_LATEST" 2>/dev/null)"
  last_file="$(jq -r ".agent${role}.currentFile // \"\"" "$FORGE_LATEST" 2>/dev/null)"
  local cur_file
  cur_file="$(forge_current_file "$round_dir" "$role" "$last_file")"

  # 统计 stall 事件
  local stall_count
  stall_count="$(count_stall_events "$round_dir" "$role")"

  # 构建输出行
  local output
  output="  ${label} $(status_icon "$status") $(humanize_status "$status") · 当前: $(trunc "$cur_file" $((w - 40))) · 本轮发现: ${findings} · 累计: ${cumulative}"

  # 如果有 stall 事件，添加警告标记
  if [ "$stall_count" -gt 0 ] 2>/dev/null; then
    output="${output} · ${C_RED}⚠️ stall×${stall_count}${C_RESET}"
  fi

  emit "$output"
}

render_forge_progress() {
  local w="$1"
  emit "${C_BOLD}${C_MAGENTA}▌ 质量审查（Fresh-Eyes 双盲审查）${C_RESET}"

  if [ ! -f "$FORGE_LATEST" ]; then
    emit "  ${C_DIM}无正在运行的 FORGE 审查${C_RESET}"
    return 0
  fi

  # latest.json 解析（jq // 兜底——半截/旧版字段缺失不崩溃）
  local run_dir_rel round total updated_at stop_reason
  run_dir_rel="$(jq -r '.runDir // ""' "$FORGE_LATEST" 2>/dev/null)"
  round="$(jq -r '.round // 0' "$FORGE_LATEST" 2>/dev/null)"
  total="$(jq -r '.totalRounds // 0' "$FORGE_LATEST" 2>/dev/null)"
  updated_at="$(jq -r '.updatedAt // ""' "$FORGE_LATEST" 2>/dev/null)"
  stop_reason="$(jq -r '.stopReason // ""' "$FORGE_LATEST" 2>/dev/null)"

  # 读取 stall 状态（v1.2.4 新增）
  local stall_count stall_last_time stall_last_gap
  stall_count="$(jq -r '.stallCount // 0' "$FORGE_LATEST" 2>/dev/null)"
  stall_last_time="$(jq -r '.stallLastTime // ""' "$FORGE_LATEST" 2>/dev/null)"
  stall_last_gap="$(jq -r '.stallLastGap // 0' "$FORGE_LATEST" 2>/dev/null)"

  # run 标识：run-NN → #NN（runDir 相对 data/ 根；绝对路径也兼容）
  local run_tag="fresh-eyes-loop"
  local run_base
  run_base="$(basename "$run_dir_rel")"
  case "$run_base" in
    run-*) run_tag="fresh-eyes-loop #${run_base#run-}" ;;
  esac

  # 新鲜度
  local age_text=""
  local updated_epoch age_secs
  updated_epoch="$(iso_to_epoch "$updated_at")"
  if [ "$updated_epoch" -gt 0 ]; then
    age_secs=$(( $(date '+%s') - updated_epoch ))
    if [ "$age_secs" -lt 0 ]; then age_secs=0; fi
    age_text=" · $(ago "$age_secs")更新"
  fi

  emit "  ${run_tag} · 第 ${round} 轮 / 共 ${total} 轮${C_DIM}${age_text}${C_RESET}"

  # 如果有 stall 事件，显示警告
  if [ "$stall_count" -gt 0 ] 2>/dev/null; then
    local stall_warn="  ${C_RED}⚠️ 检测到 ${stall_count} 次事件循环冻结（stall）"
    if [ -n "$stall_last_time" ] && [ "$stall_last_gap" -gt 0 ] 2>/dev/null; then
      stall_warn="${stall_warn} · 最近一次: ${stall_last_gap}ms @ ${stall_last_time}"
    fi
    stall_warn="${stall_warn}${C_RESET}"
    emit "$stall_warn"
  fi

  # 当前轮 round 目录（round-NN，NN 两位补齐）
  local round_dir=""
  if [ -n "$run_dir_rel" ] && [ "$round" -gt 0 ] 2>/dev/null; then
    local abs_run_dir="$run_dir_rel"
    case "$run_dir_rel" in
      /*) abs_run_dir="$run_dir_rel" ;;
      *)  abs_run_dir="$DATA_ROOT/$run_dir_rel" ;;
    esac
    round_dir="$(printf '%s/round-%02d' "$abs_run_dir" "$round")"
  fi

  render_forge_agent_line "Agent A（审查模型）" "A" "$w" "$round_dir"
  render_forge_agent_line "Agent B（工程模型）" "B" "$w" "$round_dir"

  # 双盲状态行：双 running = 双盲审查中；单 running = 单方执行；其余按终态
  local a_status b_status
  a_status="$(jq -r '.agentA.status // "idle"' "$FORGE_LATEST" 2>/dev/null)"
  b_status="$(jq -r '.agentB.status // "idle"' "$FORGE_LATEST" 2>/dev/null)"
  local phase_text="已完成"
  if [ -n "$stop_reason" ] && [ "$stop_reason" != "null" ]; then
    phase_text="已完成（${stop_reason}）"
  fi
  if [ "$a_status" = "running" ] && [ "$b_status" = "running" ]; then
    phase_text="A/B 双盲中（互不可见）"
  elif [ "$a_status" = "running" ] || [ "$b_status" = "running" ]; then
    phase_text="单方执行中"
  fi
  emit "  状态: ${phase_text}"

  # Stall 状态行（v1.2.4 新增）
  if [ -n "$stall_last_time" ] && [ "$stall_count" -gt 0 ] 2>/dev/null; then
    local stall_info="  ${C_RED}⚠️ 最近一次停顿: ${stall_last_gap}ms @ ${stall_last_time}${C_RESET}"
    emit "$stall_info"
  fi
}

# ────────────────────────────────
# 区块 6：最近变更（v1.2.3 · 交付五 bash）
# 数据源：data/dashboard/workspace-changes.jsonl（daemon workspace-summary）
# 显示最近 N 次（SOFAGENT_DASHBOARD_RECENT_N，默认 5）
# ────────────────────────────────

render_workspace_changes() {
  local w="$1"
  emit "${C_BOLD}${C_YELLOW}▌ 最近变更（workspace）${C_RESET}"

  if [ ! -f "$WORKSPACE_CHANGES" ]; then
    emit "  ${C_DIM}无变更记录${C_RESET}"
    return 0
  fi

  # 取最后 N 条（倒序：最新在前；jq -s reverse——macOS 无 tac）
  local rows
  rows="$(
    tail -n "$RECENT_N" "$WORKSPACE_CHANGES" 2>/dev/null \
    | jq -r -s 'reverse | .[] | "\(.runId // "?")\t\((.created // []) | length)\t\((.modified // []) | length)\t\((.deleted // []) | length)\t\(.timestamp // "")"' 2>/dev/null
  )"
  if [ -z "$rows" ]; then
    emit "  ${C_DIM}无变更记录${C_RESET}"
    return 0
  fi

  local run_id n_created n_modified n_deleted ts
  while IFS=$'\t' read -r run_id n_created n_modified n_deleted ts; do
    local age_text=""
    local epoch age_secs
    epoch="$(iso_to_epoch "$ts")"
    if [ "$epoch" -gt 0 ]; then
      age_secs=$(( $(date '+%s') - epoch ))
      if [ "$age_secs" -lt 0 ]; then age_secs=0; fi
      age_text=" · $(ago "$age_secs")"
    fi
    emit "  run: $(trunc "$run_id" $((w - 10)))"
    emit "  ✚ 新建 ${n_created} 个文件 · ✎ 修改 ${n_modified} 个文件 · ✗ 删除 ${n_deleted} 个文件${C_DIM}${age_text}${C_RESET}"
  done <<< "$rows"
}

# ────────────────────────────────
# 整帧渲染
# ────────────────────────────────

render_frame() {
  : > "$BUFFER_FILE"

  local now_str
  now_str="$(date '+%Y-%m-%d %H:%M:%S')"
  local mode_tag="单次"
  if [ "$WATCH" = "1" ]; then mode_tag="--watch ${REFRESH_INTERVAL}s"; fi
  emit "${C_BOLD}sofagent Dashboard · ${now_str}${C_RESET}  [${mode_tag}]  数据: $DATA_ROOT"

  if [ "$STACKED" = "1" ]; then
    # 堆叠布局（终端宽度不足）
    emit "$(printf '%*s' "$TERM_COLS" '' | tr ' ' '─')"
    render_sovereignty "$TERM_COLS"
    emit "$(printf '%*s' "$TERM_COLS" '' | tr ' ' '─')"
    render_rules "$TERM_COLS"
    if [ "$WATCH" = "1" ]; then
      emit "$(printf '%*s' "$TERM_COLS" '' | tr ' ' '─')"
      render_status "$TERM_COLS"
    fi
  else
    # 并排布局：逐行生成各栏后 paste 拼接
    local f1 f2 f3
    f1="$(mktemp -t sofagent-dash-col1.XXXXXX)"
    f2="$(mktemp -t sofagent-dash-col2.XXXXXX)"
    f3="$(mktemp -t sofagent-dash-col3.XXXXXX)"
    local saved_buffer="$BUFFER_FILE"
    BUFFER_FILE="$f1"; render_sovereignty "$COL_W"
    BUFFER_FILE="$f2"; render_rules "$COL_W"
    : > "$f3"
    if [ "$WATCH" = "1" ]; then
      BUFFER_FILE="$f3"; render_status "$COL_W"
    fi
    BUFFER_FILE="$saved_buffer"

    emit "$(printf '%*s' "$TERM_COLS" '' | tr ' ' '─')"
    # 逐栏 strip ANSI 后定宽填充，再拼接（保留颜色会破坏列对齐，拼接栏去色定宽）
    local strip1 strip2 strip3
    strip1="$(mktemp -t sofagent-dash-s1.XXXXXX)"
    strip2="$(mktemp -t sofagent-dash-s2.XXXXXX)"
    strip3="$(mktemp -t sofagent-dash-s3.XXXXXX)"
    sed $'s/\033\[[0-9;]*m//g' "$f1" | cut -c1-"$COL_W" > "$strip1"
    sed $'s/\033\[[0-9;]*m//g' "$f2" | cut -c1-"$COL_W" > "$strip2"
    sed $'s/\033\[[0-9;]*m//g' "$f3" | cut -c1-"$COL_W" > "$strip3"
    paste "$strip1" "$strip2" "$strip3" | while IFS=$'\t' read -r c1 c2 c3; do
      if [ "$WATCH" = "1" ]; then
        printf '%-'$COL_W's │ %-'$COL_W's │ %s\n' "$(trunc "$c1" "$COL_W")" "$(trunc "$c2" "$COL_W")" "$c3" >> "$BUFFER_FILE"
      else
        printf '%-'$COL_W's │ %-'$COL_W's\n' "$(trunc "$c1" "$COL_W")" "$(trunc "$c2" "$COL_W")" >> "$BUFFER_FILE"
      fi
    done
    rm -f "$f1" "$f2" "$f3" "$strip1" "$strip2" "$strip3"
  fi

  # 区块 4/5/6：仅 --full 模式显示
  if [ "$FULL" = "1" ]; then
    # 区块 4：Graph Engine 控制图（v1.2.3）——三栏/堆叠布局之外追加的整宽区块
    emit "$(printf '%*s' "$TERM_COLS" '' | tr ' ' '─')"
    render_graph_engine "$TERM_COLS"

    # 区块 5：FORGE 审查进度（v1.2.3 · 交付三）
    emit "$(printf '%*s' "$TERM_COLS" '' | tr ' ' '─')"
    render_forge_progress "$TERM_COLS"

    # 区块 6：最近变更（v1.2.3 · 交付五 bash）
    emit "$(printf '%*s' "$TERM_COLS" '' | tr ' ' '─')"
    render_workspace_changes "$TERM_COLS"
  fi

  emit "$(printf '%*s' "$TERM_COLS" '' | tr ' ' '─')"
  if [ "$WATCH" = "1" ]; then
    emit "${C_DIM}Ctrl+C 退出 · 每 ${REFRESH_INTERVAL}s 刷新${C_RESET}"
  fi
}

# ────────────────────────────────
# v1.2.4 P1b：--trend 模式（历史趋势 + 任务统计）
# ────────────────────────────────

# 找到最新的 weekly-*.json
find_latest_weekly() {
  local dir="$DATA_ROOT/dashboard"
  if [ ! -d "$dir" ]; then return; fi
  ls -1 "$dir"/weekly-*.json 2>/dev/null | sort -r | head -1
}

# 找到最新的 task-stats-*.json
find_latest_task_stats() {
  local dir="$DATA_ROOT/dashboard"
  if [ ! -d "$dir" ]; then return; fi
  ls -1 "$dir"/task-stats-*.json 2>/dev/null | sort -r | head -1
}

render_trend() {
  local width="${1:-$TERM_COLS}"

  emit ""
  emit "${C_BOLD}${C_CYAN}═══════════════════════════════════════════${C_RESET}"
  emit "${C_BOLD}${C_CYAN}  📊 历史趋势（v1.2.4 P1b）${C_RESET}"
  emit "${C_BOLD}${C_CYAN}═══════════════════════════════════════════${C_RESET}"
  emit ""

  # ── 周对比 ──
  local weekly_file
  weekly_file=$(find_latest_weekly)
  if [ -n "$weekly_file" ] && [ -f "$weekly_file" ]; then
    local week_label this_violations last_violations this_tasks last_tasks trend delta_v
    week_label=$(jq -r '.weekLabel // "N/A"' "$weekly_file" 2>/dev/null)
    this_tasks=$(jq -r '.thisWeek.taskCount // 0' "$weekly_file" 2>/dev/null)
    this_violations=$(jq -r '.thisWeek.violations // 0' "$weekly_file" 2>/dev/null)
    last_tasks=$(jq -r '.lastWeek.taskCount // "N/A"' "$weekly_file" 2>/dev/null)
    last_violations=$(jq -r '.lastWeek.violations // "N/A"' "$weekly_file" 2>/dev/null)
    trend=$(jq -r '.trend // "stable"' "$weekly_file" 2>/dev/null)
    delta_v=$(jq -r '.delta.violations // "N/A"' "$weekly_file" 2>/dev/null)

    local trend_icon="➡️"
    local trend_label="持平"
    if [ "$trend" = "improving" ]; then trend_icon="📉"; trend_label="改善"
    elif [ "$trend" = "degrading" ]; then trend_icon="📈"; trend_label="恶化"; fi

    emit "  ${C_BOLD}周对比（${week_label}）${C_RESET} ${trend_icon} ${trend_label}"
    emit ""
    printf "  %-12s %12s %12s\n" "" "${C_BOLD}本周${C_RESET}" "${C_BOLD}上周${C_RESET}"
    printf "  %-12s %12s %12s\n" "任务数" "$this_tasks" "$last_tasks"
    printf "  %-12s %12s %12s\n" "违规数" "$this_violations" "$last_violations"
    if [ "$delta_v" != "null" ] && [ "$delta_v" != "N/A" ]; then
      local delta_sign=""
      if [ "$delta_v" -gt 0 ] 2>/dev/null; then delta_sign="+"; fi
      emit ""
      emit "  违规变化：${delta_sign}${delta_v}（${trend_label}）"
    fi
    emit ""

    # TOP5 违规规则
    local top5
    top5=$(jq -r '.violationTop5[]? | "  \(.rule): \(.count) 次"' "$weekly_file" 2>/dev/null)
    if [ -n "$top5" ]; then
      emit "  ${C_DIM}最常违规 TOP5：${C_RESET}"
      echo "$top5" >> "$BUFFER_FILE"
      emit ""
    fi
  else
    emit "  ${C_DIM}暂无周趋势数据（需等待 trend-aggregator 产出 weekly-*.json）${C_RESET}"
    emit ""
  fi

  # ── 任务统计 ──
  local stats_file
  stats_file=$(find_latest_task_stats)
  if [ -n "$stats_file" ] && [ -f "$stats_file" ]; then
    local stats_date total pass_rate warn_rate fail_rate fail_count
    stats_date=$(jq -r '.date // "N/A"' "$stats_file" 2>/dev/null)
    total=$(jq -r '.totalTasks // 0' "$stats_file" 2>/dev/null)
    pass_rate=$(jq -r '.passRate // 0' "$stats_file" 2>/dev/null)
    warn_rate=$(jq -r '.warnRate // 0' "$stats_file" 2>/dev/null)
    fail_rate=$(jq -r '.failRate // 0' "$stats_file" 2>/dev/null)
    fail_count=$(jq -r '.failedTasks | length' "$stats_file" 2>/dev/null)

    emit "  ${C_BOLD}任务统计（${stats_date}）${C_RESET}"
    emit ""
    printf "  %-12s %8s\n" "总任务" "$total"
    printf "  %-12s %8s%%\n" "通过率" "$pass_rate"
    printf "  %-12s %8s%%\n" "警告率" "$warn_rate"
    printf "  %-12s %8s%%\n" "失败率" "$fail_rate"
    if [ "$fail_count" != "0" ] && [ -n "$fail_count" ]; then
      emit ""
      emit "  ${C_YELLOW}失败任务 ${fail_count} 条：${C_RESET}"
      jq -r '.failedTasks[]? | "    - \(.task | .[0:60])"' "$stats_file" 2>/dev/null >> "$BUFFER_FILE"
    fi
  else
    emit "  ${C_DIM}暂无任务统计数据${C_RESET}"
  fi

  emit ""
  emit "${C_DIM}数据源：dashboard/daily-*.json + history.jsonl · 刷新：@daily/@weekly${C_RESET}"
}

# ────────────────────────────────
# --trend 模式主入口
# ────────────────────────────────

if [ "${SOFAGENT_DASHBOARD_LIB_ONLY:-}" != "1" ]; then
  if [ "$TREND" = "1" ]; then
    render_trend "$TERM_COLS"
    cat "$BUFFER_FILE"
  elif [ "$WATCH" = "1" ]; then
    # --watch 模式：tput cup 光标定位重绘（不清屏，防闪烁）
    tput civis 2>/dev/null || true
    first=1
    while true; do
      render_frame
      if [ "$first" = "1" ]; then
        clear
        first=0
      fi
      tput cup 0 0 2>/dev/null || true
      cat "$BUFFER_FILE"
      # 清掉上一帧可能比本帧长的残留行
      tput ed 2>/dev/null || true
      sleep "$REFRESH_INTERVAL"
    done
  else
    render_frame
    cat "$BUFFER_FILE"
  fi
fi
