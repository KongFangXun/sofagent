#!/usr/bin/env bash
# check-review-system.sh — 审查体系一致性校验（阶段七执行体）
# ============================================================
# 职责：把 SOP 阶段七「审查体系最终确认」的两大步做成确定性检查——
#   ① 状态一致性：checklist / acceptance / fresh-eyes 三份文档的
#      「声称值 vs 实际值」逐一对账（维度数 / 编号连续性 / 行数警戒线 /
#      场景数 / 头部自校验段同步）
#   ② 覆盖闭环：checklist 新增维度引用的 S 场景号在 acceptance 中真实
#      存在；check-version 的「检查通过 X/Y 项」分母与实际检查项数一致
#
# 本脚本是「清单核对器」不是「判断器」——只报事实，修复归人工/阶段五。
#
# 用法:
#   bash tools/check-review-system.sh          # 人读输出
#   bash tools/check-review-system.sh --quiet  # 只输出 OK / FAIL
# 退出码（与工具脚本纪律三一致——脚本自身错误与检查失败区分）:
#   0 = 全部通过
#   1 = 有 FAIL（会列出具体文件+声称值 vs 实际值）
#   2 = 脚本自身错误（文件缺失 / 结构无法解析）
# ============================================================

set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

QUIET=false
for _arg in "$@"; do
  case "$_arg" in
    --quiet) QUIET=true ;;
    --help|-h)
      echo "check-review-system.sh — 审查体系一致性校验（阶段七）"
      echo "  --quiet   只输出 OK / FAIL"
      echo "  --help    显示此帮助"
      exit 0 ;;
    *) echo "未知参数: $_arg"; exit 2 ;;
  esac
done

# ── 颜色 ──
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; CYAN='\033[0;36m'; NC='\033[0m'

# ── 检查对象 ──
CHECKLIST="FORGE/playbook/regression-checklist.md"
ACCEPTANCE="FORGE/playbook/acceptance-test.sh"
FRESH_EYES="FORGE/playbook/fresh-eyes-review.md"
RELEASING5="docs/changelog/releasing/05-review-system.md"

for _f in "$CHECKLIST" "$ACCEPTANCE" "$FRESH_EYES" "$RELEASING5"; do
  if [ ! -f "$_f" ]; then
    echo "❌ 文件缺失: ${_f}（脚本无法执行）" >&2
    exit 2
  fi
done

PASS=0
FAIL=0
WARN=0

ok()   { [ "$QUIET" = false ] && echo -e "  ${GREEN}✅${NC} $1"; PASS=$((PASS + 1)); return 0; }
bad()  { echo -e "  ${RED}❌${NC} $1"; [ -n "${2:-}" ] && echo -e "    $2"; FAIL=$((FAIL + 1)); return 0; }
warn() { [ "$QUIET" = false ] && echo -e "  ${YELLOW}⚠️${NC} $1"; WARN=$((WARN + 1)); return 0; }

# ============================================================
# 一、regression-checklist.md 状态一致性
# ============================================================
[ "$QUIET" = false ] && echo -e "\n${BOLD}${CYAN}── ① checklist 状态一致性 ──${NC}"

# 1a. 头部「当前 N 维」vs 实际 #### 维度数
HEAD_DIM=$(grep -oE '当前 [0-9]+ 维' "$CHECKLIST" | head -1 | grep -oE '[0-9]+' || echo "")
ACTUAL_DIM=$(grep -c "^#### " "$CHECKLIST" || true)
if [ -z "$HEAD_DIM" ]; then
  bad "checklist 头部未找到「当前 N 维」声称" "    修复：头部维护公约处补「当前 N 维」"
elif [ "$HEAD_DIM" = "$ACTUAL_DIM" ]; then
  ok "维度数一致：声称 $HEAD_DIM = 实际 $ACTUAL_DIM"
else
  bad "checklist 维度数漂移：头部声称 $HEAD_DIM 维 ≠ 实际 $ACTUAL_DIM 维" "    文件：${CHECKLIST}（头部维护公约段）"
fi

# 1b. 正文维度声称（「审查维度（N 维」）vs 实际
BODY_DIM=$(grep -oE '审查维度（[0-9]+ 维' "$CHECKLIST" | head -1 | grep -oE '[0-9]+' || echo "")
if [ -n "$BODY_DIM" ]; then
  if [ "$BODY_DIM" = "$ACTUAL_DIM" ]; then
    ok "正文维度声称一致：$BODY_DIM"
  else
    bad "checklist 正文声称 $BODY_DIM 维 ≠ 实际 $ACTUAL_DIM 维" "    文件：${CHECKLIST}（「你的身份」段标题）"
  fi
else
  warn "checklist 未找到「审查维度（N 维」正文声称（可能格式变化，人工确认）"
fi

# 1c. 维度编号查重（同编号两用 = 维度 107 事故防复发）
DUP_IDS=$(grep -E "^#### " "$CHECKLIST" | grep -oE "^#### [0-9]+" | grep -oE "[0-9]+" | sort -n | uniq -d || true)
if [ -z "$DUP_IDS" ]; then
  ok "维度编号无重复"
else
  bad "维度编号重复占用：$(echo "$DUP_IDS" | tr '\n' ' ')" "    修复：新维度编号必须 = 当前最大 +1（维护公约）"
fi

# 1d. 行数警戒线（从 checklist 头部动态提取当前警戒线，禁写死——铁律 2）
LIMIT_CHK=$(grep -oE 'regression-checklist\.md`? ≤ ?[0-9]+' "$CHECKLIST" | head -1 | grep -oE '[0-9]+' || echo "")
LIMIT_ACC=$(grep -oE 'acceptance-test\.sh`? ≤ ?[0-9]+' "$CHECKLIST" | head -1 | grep -oE '[0-9]+' || echo "")
WC_CHK=$(wc -l < "$CHECKLIST" | tr -d ' ')
WC_ACC=$(wc -l < "$ACCEPTANCE" | tr -d ' ')
if [ -n "$LIMIT_CHK" ]; then
  if [ "$WC_CHK" -le "$LIMIT_CHK" ]; then
    ok "checklist 行数 $WC_CHK ≤ 警戒线 $LIMIT_CHK"
  else
    bad "checklist 行数 $WC_CHK 超警戒线 $LIMIT_CHK" "    处置：走阶段五三判据（真实归并或上调记录）"
  fi
else
  warn "checklist 头部未提取到自身警戒线（格式变化？人工确认）"
fi
if [ -n "$LIMIT_ACC" ]; then
  if [ "$WC_ACC" -le "$LIMIT_ACC" ]; then
    ok "acceptance 行数 $WC_ACC ≤ 警戒线 $LIMIT_ACC"
  else
    bad "acceptance 行数 $WC_ACC 超警戒线 $LIMIT_ACC" "    处置：走阶段五三判据（真实归并或上调记录）"
  fi
else
  warn "checklist 头部未提取到 acceptance 警戒线（格式变化？人工确认）"
fi

# 1e. checklist 自校验段的警戒线数字与头部声明同步（v1.3.7 实案：
#     头部上调 1580/2640 但自校验段残留 1540/2600——同一文档两套线）
# 提取正则兼容带引号比较形态："$WC_CHK" -le 1540（grep 未命中 = FAIL，禁止静默跳过）
SELF_CHK=$(grep -oE 'WC_CHK"? -le [0-9]+' "$CHECKLIST" | head -1 | grep -oE '[0-9]+' || echo "")
SELF_ACC=$(grep -oE 'WC_ACC"? -le [0-9]+' "$CHECKLIST" | head -1 | grep -oE '[0-9]+' || echo "")
if [ -z "$SELF_CHK" ] || [ -z "$SELF_ACC" ]; then
  bad "checklist 自校验段未找到警戒线比较行（提取正则失配 → FAIL，禁止静默跳过）" "    确认自校验段存在 WC_CHK/WC_ACC -le 比较；若格式已改，同步更新本提取正则"
else
  if [ "$SELF_CHK" = "$LIMIT_CHK" ]; then
    ok "checklist 自校验段警戒线与头部一致（${SELF_CHK}）"
  else
    bad "checklist 内部两套警戒线：头部 $LIMIT_CHK ≠ 自校验段 $SELF_CHK" "    修复：自校验段命令同步头部当前值（遗漏即旧线假绿/误报）"
  fi
  if [ "$SELF_ACC" = "$LIMIT_ACC" ]; then
    ok "acceptance 自校验段警戒线与头部一致（${SELF_ACC}）"
  else
    bad "acceptance 警戒线两套：头部 $LIMIT_ACC ≠ 自校验段 $SELF_ACC" "    修复：同上"
  fi
fi

# ============================================================
# 二、acceptance-test.sh 场景对账
# ============================================================
[ "$QUIET" = false ] && echo -e "\n${BOLD}${CYAN}── ② acceptance 场景对账 ──${NC}"

# 2a. 头部声称场景数 vs 实际 scenario N " 计数
HEAD_SCN=$(grep -m1 -oE '场景数：[0-9]+ 个场景' "$ACCEPTANCE" | grep -oE '[0-9]+' || echo "")
ACTUAL_SCN=$(grep -cE 'scenario [0-9]+ "' "$ACCEPTANCE" || true)
if [ -z "$HEAD_SCN" ]; then
  warn "acceptance 头部未找到「场景数：N 个场景」声称（人工确认）"
elif [ "$HEAD_SCN" = "$ACTUAL_SCN" ]; then
  ok "acceptance 场景数一致：声称 $HEAD_SCN = 实际 $ACTUAL_SCN"
else
  bad "acceptance 场景数漂移：头部声称 $HEAD_SCN ≠ 实际 $ACTUAL_SCN" "    文件：${ACCEPTANCE}（头部注释行）"
fi

# 2b. 场景编号唯一性（scenario N 重复 = 计数器事故）
DUP_SCN=$(grep -oE 'scenario [0-9]+ "' "$ACCEPTANCE" | grep -oE '[0-9]+' | sort -n | uniq -d || true)
if [ -z "$DUP_SCN" ]; then
  ok "场景编号无重复"
else
  bad "场景编号重复：$(echo "$DUP_SCN" | tr '\n' ' ')" "    修复：新场景编号 = 当前最大 +1"
fi

# ============================================================
# 三、S 编号交叉引用闭环（checklist 引的 S 场景必须真实存在）
# ============================================================
[ "$QUIET" = false ] && echo -e "\n${BOLD}${CYAN}── ③ S 编号闭环：checklist → acceptance ──${NC}"

# acceptance 实际存在的 S 编号全集（scenario N + 行内 S2xx 标记双口径）
declare -a S_DEFINED=()
S_DEFINED_RAW=$( (grep -oE 'scenario [0-9]+ "' "$ACCEPTANCE" | grep -oE '[0-9]+'; grep -oE '\bS2[0-9]{2}\b' "$ACCEPTANCE" | sed 's/S//') | sort -n | uniq || true)

REF_MISSING=0
while IFS= read -r sref; do
  [ -z "$sref" ] && continue
  if ! echo "$S_DEFINED_RAW" | grep -qx "$sref"; then
    bad "checklist 引用的 S$sref 在 acceptance 中不存在" "    checklist 中 grep S$sref 定位引用点，核对场景编号"
    REF_MISSING=$((REF_MISSING + 1))
  fi
done <<EOF
$(grep -oE '\bS2[0-9]{2}\b' "$CHECKLIST" | sed 's/S//' | sort -n | uniq)
EOF
[ "$REF_MISSING" -eq 0 ] && ok "checklist 引用的 S 场景号全部存在于 acceptance"

# ============================================================
# 四、fresh-eyes-review.md 守护
# ============================================================
[ "$QUIET" = false ] && echo -e "\n${BOLD}${CYAN}── ④ fresh-eyes-review 守护 ──${NC}"

WC_FE=$(wc -l < "$FRESH_EYES" | tr -d ' ')
# 警戒线从 releasing 阶段五动态提取（「不超过 N 行」）；提取不到回退 checklist 维度表引用
LIMIT_FE=$(grep -oE '不超过 [0-9]+ 行' "$RELEASING5" | head -1 | grep -oE '[0-9]+' || echo "")
if [ -z "$LIMIT_FE" ]; then
  LIMIT_FE=$(grep -oE 'fresh-eyes[^|]*≤ ?[0-9]+' "$CHECKLIST" | head -1 | grep -oE '[0-9]+' || echo "")
fi
if [ -n "$LIMIT_FE" ]; then
  if [ "$WC_FE" -le "$LIMIT_FE" ]; then
    ok "fresh-eyes-review 行数 $WC_FE ≤ 警戒线 $LIMIT_FE"
  else
    bad "fresh-eyes-review 行数 $WC_FE 超警戒线 $LIMIT_FE" "    处置：阶段五校准段做紧凑化（保语义压行数，不删视角）"
  fi
else
  warn "未提取到 fresh-eyes 警戒线（检查 $RELEASING5 格式）"
fi

# ============================================================
# 五、check-version.sh 分母自洽
# ============================================================
[ "$QUIET" = false ] && echo -e "\n${BOLD}${CYAN}── ⑤ check-version 分母自洽 ──${NC}"

CV_SCRIPT="tools/check-version.sh"
CV_DENOM=$(grep -oE 'TOTAL=\$\(\(CHECKS \+ ERRORS\)\)' "$CV_SCRIPT" | head -1 || echo "")
if [ -n "$CV_DENOM" ]; then
  ok "check-version 分母为动态计算（CHECKS+ERRORS），无写死分母"
else
  # 若实现改写死分母（TOTAL=N），报 WARN 让人工确认
  if grep -qE 'TOTAL=[0-9]+' "$CV_SCRIPT"; then
    warn "check-version 存在写死 TOTAL=N——版本演进必漂（维度脚本铁律 2），确认是否动态化"
  else
    warn "check-version TOTAL 计算方式未识别（人工确认）"
  fi
fi

# ============================================================
# 六、交付关键词覆盖率对账（阶段五步骤 3 脚本化 · 零遗漏验证）
# ============================================================
# 源：CHANGELOG.md 主索引当前版本行的加粗交付名 + devlog 交付章标题核心词
# 目标：每个交付关键词在 checklist / acceptance 至少出现一次（SOP 阶段五
# 步骤 3「grep 确认 CHANGELOG 每个交付关键词在审查文档中至少出现一次」）
# 词形差异（如 devlog「SubAgent 完整沙箱」vs checklist「沙箱五件套」）由
# 豁免清单处理：FORGE/playbook/.coverage-exempt 每行一个关键词，命中的不报
[ "$QUIET" = false ] && echo -e "\n${BOLD}${CYAN}── ⑥ 交付关键词覆盖率（阶段五零遗漏） ──${NC}"

CUR_VER=$(node -p "require('./engine/audit/package.json').version" 2>/dev/null || echo "")
EXEMPT_FILE="FORGE/playbook/.coverage-exempt"
EXEMPTED=$(cat "$EXEMPT_FILE" 2>/dev/null || echo "")

if [ -z "$CUR_VER" ]; then
  warn "无法读取当前版本号，跳过覆盖率对账（人工确认）"
else
  # 交付章标题核心词（devlog ## N、 标题，去编号/括号注释）+ CHANGELOG 版本行 `**加粗**` 交付短语
  DEVLOG_KW=$(grep -E "^## [一二三四五六七八九十]+、" "docs/changelog/v1.${CUR_VER#1.}/v${CUR_VER}.md" 2>/dev/null | sed -E 's/^## [一二三四五六七八九十一点五]+、//; s/（.*//; s/\(.*//' || true)
  CHANGELOG_KW=$(grep -E "^\- \*\*v${CUR_VER}\*\*" CHANGELOG.md 2>/dev/null | head -1 | grep -oE '\*\*[^*]+\*\*' | sed 's/\*\*//g' | sed -E 's/[（(].*//' || true)
  ALL_KW=$(printf '%s\n%s\n' "$DEVLOG_KW" "$CHANGELOG_KW" | grep -vE '^\s*$' | sort -u || true)

  if [ -z "$ALL_KW" ]; then
    warn "当前版本（v${CUR_VER}）未提取到交付关键词——devlog 章标题/CHANGELOG 版本行格式变化？人工确认"
  else
    COV_MISS=0
    while IFS= read -r _kw; do
      [ -z "$_kw" ] && continue
      # 豁免清单命中（精确行匹配）→ 已知词形差异，不报
      if echo "$EXEMPTED" | grep -qxF "$_kw"; then continue; fi
      # 命中判定：完整短语 或 任一 ≥4 字核心名词子串（放宽到关键组件名）
      _hit_cl=$(grep -c "$_kw" "$CHECKLIST" 2>/dev/null || true)
      _hit_ac=$(grep -c "$_kw" "$ACCEPTANCE" 2>/dev/null || true)
      if [ "${_hit_cl:-0}" -eq 0 ] && [ "${_hit_ac:-0}" -eq 0 ]; then
        # 双零 → 拆词重试（取短语中的核心名词段：≥4 连续 CJK 或 ≥4 连续拉丁字符）
        _sub_hit=0
        while IFS= read -r _seg; do
          [ -z "$_seg" ] && continue
          _n=$( (grep -c "$_seg" "$CHECKLIST" 2>/dev/null || true; grep -c "$_seg" "$ACCEPTANCE" 2>/dev/null || true) | awk '{s+=$1} END {print s}')
          [ "${_n:-0}" -gt 0 ] && { _sub_hit=1; break; }
        done <<EOF
$(echo "$_kw" | grep -oE '[一-龥]{4,}|[A-Za-z][A-Za-z-]{3,}' || true)
EOF
        if [ "$_sub_hit" -eq 0 ]; then
          bad "交付关键词「${_kw}」在 checklist/acceptance 均零命中" "    处置三选一：① 审查文档补该审查面（阶段五 A 类分发）② 词形不同 → 加进 $EXEMPT_FILE ③ 非交付性章节（背景/依赖）→ 豁免"
          COV_MISS=$((COV_MISS + 1))
        fi
      fi
    done <<EOF
$ALL_KW
EOF
    [ "$COV_MISS" -eq 0 ] && ok "当前版本（v${CUR_VER}）交付关键词审查覆盖零遗漏"
  fi
fi

# ============================================================
# 七、同主题维度聚簇提示（阶段五三判据②重叠判据的脚本化）
# ============================================================
# 原理：维度标题先清洗（去编号/去括号注释/去分隔符）→ 抽「≥2 字 CJK 连续段」+
# 「≥4 字符拉丁词（排除版本号）」作主题词 → 同一主题词命中 ≥3 个维度 = 强归并候选
# （三判据②原文语义）。只报不判——归并决策是人。
# 精度依据（v1.3.7 实测 89 维）：清洗前噪声 8 组全是垃圾（「·」×292/「新增」×41——
# 括号注释里的版本标记）；清洗后真聚簇仅 5 组（tool×5/FORGE×5/完整性×3/vs×3/hook×3），
# 无一真归并候选——干净时低信号正是本检查该有的行为。
# 实现注意：CJK 切分必须 awk 逐字符（LC_ALL=C 下 grep 字符类按字节切会出乱码字对）。
[ "$QUIET" = false ] && echo -e "\n${BOLD}${CYAN}── ⑦ 同主题维度聚簇（归并候选提示） ──${NC}"

CLUSTER_MIN=3   # 三判据②：≥3 个同类 = 强归并候选
CLUSTER_COUNT=0
# 清洗：去编号、去（括号注释——版本标记/归并记录都在里面）、去 · + ≠ 等符号
DIM_TITLES_CLEAN=$(grep -E "^#### " "$CHECKLIST" | sed 's/^#### [0-9]*\. //; s/（[^）]*）//g; s/[·+≠=]/ /g')
# 主题词提取（perl \p{Han} 精确汉字类）+ 计数排序，全程单管道落临时文件——
# 不经 shell 变量中转（调试实录：命令替换捕获值偶发含上游残留，机制未定位，
# 数据流单向化根治）。展示循环只读文件，变量全部独立前缀。
CLUSTER_TMP=$(mktemp /tmp/crs-cluster-XXXX)
printf '%s\n' "$DIM_TITLES_CLEAN" | LC_ALL="${LC_ALL_UTF8:-en_US.UTF-8}" perl -CSD -ne 'while (/([\p{Han}]{2,}|[A-Za-z]{4,})/g) { my $w = $1; next if $w =~ /^[vV]\d/; print "$w\n" }' 2>/dev/null | sort | uniq -c | sort -rn | awk -v min="$CLUSTER_MIN" '$1 >= min {print $1, $2}' > "$CLUSTER_TMP" || true

if [ -s "$CLUSTER_TMP" ]; then
  while IFS= read -r c7_line; do
    [ -z "$c7_line" ] && continue
    c7_n=$(echo "$c7_line" | awk '{print $1}')
    c7_gram=$(echo "$c7_line" | cut -d' ' -f2-)
    [ -z "$c7_gram" ] && continue
    # 数学闸：一个词至多命中全部维度各一次——计数 > 维度总数 = 注入异常行，跳过
    [ "$c7_n" -gt "${ACTUAL_DIM:-999}" ] && continue
    c7_dims=$(grep -E "^#### " "$CHECKLIST" | grep -F "$c7_gram" | grep -oE '^#### [0-9]+' | grep -oE '[0-9]+' | sort -n | tr '\n' ' ')
    echo -e "  ${YELLOW}ℹ️${NC} 「${c7_gram}」×${c7_n} → 维度 ${c7_dims}（人工裁决是否归并）"
    CLUSTER_COUNT=$((CLUSTER_COUNT + 1))
    [ "$CLUSTER_COUNT" -ge 8 ] && { [ "$QUIET" = false ] && echo "  …（更多聚簇组省略）"; break; }
  done < "$CLUSTER_TMP"
  # 数学闸：维度总数 ACTUAL_DIM 已在①段求得——任何主题词计数 > 维度总数即异常行，滤除
  if [ "$CLUSTER_COUNT" -gt 0 ]; then
    [ "$QUIET" = false ] && echo -e "  ↳ 提示非 FAIL：聚簇=归并候选（三判据②），归并/保留人工裁决；「tool/完整性」类通用词多为假信号"
  fi
else
  if [ -n "$DIM_TITLES_CLEAN" ]; then
    # 标题非空但聚簇结果空 = perl 提取失败（如 C locale 退化），不误报"干净"
    warn "聚簇提取结果为空但维度标题非空——perl 提取可能失败（locale？），人工确认"
  else
    ok "无 ≥${CLUSTER_MIN} 维同主题聚簇（暂无归并候选）"
  fi
fi
rm -f "$CLUSTER_TMP"

# ============================================================
# 汇总
# ============================================================
[ "$QUIET" = false ] && echo -e "\n${BOLD}═══════════════════════════════════════════════${NC}"
if [ "$FAIL" -gt 0 ]; then
  [ "$QUIET" = false ] && echo -e "  ${RED}审查体系一致性 FAIL：${FAIL} 项不通过（${WARN} 警告）${NC}"
  [ "$QUIET" = true ] && echo "FAIL"
  exit 1
else
  [ "$QUIET" = false ] && echo -e "  ${GREEN}审查体系一致性全通过（${PASS} 项 ✅ · ${WARN} 警告）${NC}"
  [ "$QUIET" = true ] && echo "OK"
  exit 0
fi
