#!/usr/bin/env bash
# ============================================================
# sofagent-dashboard.sh · FDE Dashboard 终端三栏（v1.2.2 · P2+P2b）
# ============================================================
#
# 零前端依赖：bash + jq + tput。图表从 JSONL 实时渲染，绝不读 MD 报告
# （MD 是人读备份）。
#
# 两种模式：
#   sofagent-dashboard           跑一次看完关掉——两栏（数据主权 + 规则审计）
#   sofagent-dashboard --watch   2s 自动刷新——三栏（追加工作状态栏）
#
# 数据源：
#   数据主权  $SOFAGENT_HOME/data/audit/data-sovereignty/{年}/{月}/*.jsonl
#   规则审计  $SOFAGENT_HOME/data/audit/history.jsonl
#   工作状态  $SOFAGENT_HOME/data/audit/sub-progress-*.jsonl（自动发现）
#            $SOFAGENT_HOME/data/dashboard/daemon-health.json
#   Graph引擎 $SOFAGENT_HOME/data/dashboard/graph-state.json（v1.2.2 P4）
#   最近报告  $SOFAGENT_HOME/data/{企业名}/审计报告/（fde-profile.json 定企业名）
#
# 环境变量：
#   SOFAGENT_HOME   数据根目录（默认 ~/.sofagent；测试可指向 fixture）
#   SOFAGENT_DASHBOARD_NO_COLOR=1   关闭颜色（测试断言友好）
#
# 工程规范：不用 set -e + glob（铁律：glob 无匹配即崩），错误显式判断。
# ============================================================

set -u
set -o pipefail

# ────────────────────────────────
# 参数与全局
# ────────────────────────────────

WATCH=0
if [ "${1:-}" = "--watch" ]; then
  WATCH=1
fi

# 非 watch 模式输出到临时文件再一次性 cat——便于测试捕获 + 避免半屏残留
BUFFER_FILE="$(mktemp -t sofagent-dashboard.XXXXXX)"
trap 'rm -f "$BUFFER_FILE"; if [ "$WATCH" = "1" ]; then tput cnorm 2>/dev/null || true; fi' EXIT

DATA_ROOT="${SOFAGENT_HOME:-$HOME/.sofagent}/data"
AUDIT_DIR="$DATA_ROOT/audit"
SOVEREIGNTY_DIR="$AUDIT_DIR/data-sovereignty"
HISTORY_FILE="$AUDIT_DIR/history.jsonl"
DAEMON_HEALTH="$DATA_ROOT/dashboard/daemon-health.json"
GRAPH_STATE="$DATA_ROOT/dashboard/graph-state.json"
REFRESH_INTERVAL=5

# 依赖检查
if ! command -v jq >/dev/null 2>&1; then
  echo "错误：sofagent-dashboard 依赖 jq，请先安装（brew install jq / apt install jq）" >&2
  exit 1
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
TERM_COLS="${COLUMNS:-$(tput cols 2>/dev/null || echo 0)}"
TERM_ROWS="${LINES:-$(tput lines 2>/dev/null || echo 0)}"
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
# 栏 1：数据主权（data-sovereignty/*.jsonl）
# ────────────────────────────────

render_sovereignty() {
  local w="$1"
  emit "${C_BOLD}${C_CYAN}▌ 数据主权（数据去哪了）${C_RESET}"

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

  # 敏感数据率
  local rate=0
  if [ "$total" -gt 0 ]; then
    rate=$(( sensitive * 100 / total ))
  fi
  emit "  敏感率 $(bar "$rate" 100 $((w / 2))) ${rate}%（${sensitive}/${total}）"

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
    | while read -r f; do printf '%s %s\n' "$(stat -f '%m' "$f" 2>/dev/null || stat -c '%Y' "$f" 2>/dev/null || echo 0)" "$f"; done \
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
  local top3
  top3="$(
    jq -r -s --arg since "$week_ago" '
      [.[] | select(.timestamp >= $since) | .ruleResults[]? | select(.status == "FAIL" or .status == "WARN")]
      | group_by(.number)
      | map({num: .[0].number, name: .[0].name, count: length})
      | sort_by(-.count) | .[0:3][]
      | "\(.num) \(.name) \(.count)"' "$HISTORY_FILE" 2>/dev/null
  )"
  if [ -n "$top3" ]; then
    local i=1
    while read -r num name count; do
      emit "  ${C_YELLOW}${i}.${C_RESET} A${num} $(trunc "$name" $((w - 14))) ${C_RED}${count}次${C_RESET}"
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
# 区块 4：Graph Engine 状态（v1.2.2 · P4）
# 数据源：data/dashboard/graph-state.json（plan/engineer 节点执行时写入）
# 渲染：当前活跃节点名（ASCII 节点流转图高亮）+ Work Graph 任务数
# ────────────────────────────────

render_graph_engine() {
  local w="$1"
  emit "${C_BOLD}${C_BLUE}▌ Graph Engine（编排图状态）${C_RESET}"

  if [ ! -f "$GRAPH_STATE" ]; then
    emit "  ${C_DIM}（暂无 Graph 状态：$GRAPH_STATE 不存在）${C_RESET}"
    emit "  ${C_DIM}plan → engineer → audit → reviewer → human_confirm${C_RESET}"
    return 0
  fi

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

  # 区块 4：Graph Engine 状态（v1.2.2 P4）——三栏/堆叠布局之外追加的整宽区块
  emit "$(printf '%*s' "$TERM_COLS" '' | tr ' ' '─')"
  render_graph_engine "$TERM_COLS"

  emit "$(printf '%*s' "$TERM_COLS" '' | tr ' ' '─')"
  if [ "$WATCH" = "1" ]; then
    emit "${C_DIM}Ctrl+C 退出 · 每 ${REFRESH_INTERVAL}s 刷新${C_RESET}"
  fi
}

# ────────────────────────────────
# 主入口
# ────────────────────────────────

if [ "$WATCH" = "1" ]; then
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
