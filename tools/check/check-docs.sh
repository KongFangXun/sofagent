#!/usr/bin/env bash
# 文档一致性自动化检查
# v1.3.9: 补 locale export——CI/sandbox 默认 LANG=C 会把含中文的文件
# 判成二进制（BSD grep 误判 .md 为 binary），文档扫描静默失效（v1.3.1 run-10 阻塞复发防御）。
export LANG="${LANG:-en_US.UTF-8}"
export LC_ALL="${LC_ALL:-en_US.UTF-8}"
set -uo pipefail
shopt -s nullglob

# 颜色变量（set -u 下必须初始化——v1.4.0 修复：3a 段 RED 未定义导致 unbound 崩溃）
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

# ── 覆盖度行范式（v1.4.9 G-2②）──
# 必须在 cd 之前取自身目录（cd 后 $(dirname "$0") 的相对路径失效）。
_SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "${_SELF_DIR}/lib/coverage-line.sh"

cd "$(dirname "$0")/../.." || exit 1

# v1.3.6 B11: 并发防护——mkdir 原子锁（macOS/Linux 兼容）。已有实例运行时第二个实例
# 报错退出，防止双实例互相覆盖日志（审查期间曾实测发现双残留实例）。
#
# 锁粒度 = 本仓库根。早先锁名硬编码 /tmp/check-docs.lock，导致**同一台机上不同副本
# 互相阻塞**——实测多副本并行验证（如 /tmp 下的隔离副本）时第二个副本被误判为
# 「already running」（exit 2），把并发环境问题伪装成门禁红。现把仓库根路径净化后
# 拼进锁名：同一副本内仍严格串行，不同副本互不干扰。
# 陈旧锁自愈：锁目录内记持锁 PID，进程已退出即回收（防崩溃留下永久锁）。
#
# 退出码：0 = 全部通过 · 1 = 有检查项失败 · 2 = 另一实例正在运行（锁被占且持锁进程存活）
REPO_ROOT_FOR_LOCK=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
LOCK_TAG=$(printf '%s' "${REPO_ROOT_FOR_LOCK}" | tr -c 'A-Za-z0-9' '_')
TMP_BASE="${TMPDIR:-/tmp}"
TMP_BASE="${TMP_BASE%/}"
LOCK_DIR="${TMP_BASE}/check-docs${LOCK_TAG}.lock"
LOCK_PID_FILE="${LOCK_DIR}/pid"
LOCK_ACQUIRED=false
if mkdir "${LOCK_DIR}" 2>/dev/null; then
  LOCK_ACQUIRED=true
else
  HELD_PID=$(cat "${LOCK_PID_FILE}" 2>/dev/null || echo "")
  if [ -n "${HELD_PID}" ] && kill -0 "${HELD_PID}" 2>/dev/null; then
    echo "[ERROR] check-docs.sh already running (lock ${LOCK_DIR}, holder pid ${HELD_PID}) - wait for previous instance"
    exit 2
  fi
  # 陈旧锁：持锁进程已不在（或未记录 PID）→ 回收后重试一次
  rm -f "${LOCK_PID_FILE}" 2>/dev/null || true
  rmdir "${LOCK_DIR}" 2>/dev/null || true
  if mkdir "${LOCK_DIR}" 2>/dev/null; then
    LOCK_ACQUIRED=true
  else
    echo "[ERROR] check-docs.sh lock contention (lock ${LOCK_DIR}) - another instance raced us; retry"
    exit 2
  fi
fi
if [ "${LOCK_ACQUIRED}" = true ]; then
  printf '%s' "$$" > "${LOCK_PID_FILE}"
  trap 'rm -f "${LOCK_PID_FILE}" 2>/dev/null || true; rmdir "${LOCK_DIR}" 2>/dev/null || true' EXIT
fi

ERRORS=0
# 覆盖度计数器（v1.4.9 G-2②）——口径见 tools/check/lib/coverage-line.sh：
#   ASSERTS = 本轮结果行数（`  ✓` + `  ❌`；在每处结果 echo 前统一插桩）
#   SKIPS   = 显式跳过项数（`  ⏭️`）——跳得过不是绿，必须打印出来供 SOP 逐条裁决
ASSERTS=0
SKIPS=0

echo "=== 1. 死链检查 ==="
# 检查所有 .md 中**指向 rules.md 的 markdown 链接**是否死链。
# 注意：仅匹配真正的链接形式 ](...rules.md)，不匹配散文里的 "rules.md" 字样
# （散文描述不计入死链）。通用相对路径死链已由维度 306（第 1b 节）全量扫描覆盖。
RULES_DEAD=$(grep -rnE '\]\([^)]*rules\.md\)' --include="*.md" . 2>/dev/null | grep -v "docs/changelog/" | grep -v "CHANGELOG.md" | grep -v "node_modules" | grep -v ".workbuddy/" | grep -v ".sofagent/" | grep -c "" || true)
RULES_DEAD=${RULES_DEAD:-0}
if [ "$RULES_DEAD" -gt 0 ] 2>/dev/null; then
  echo "  rules.md 死链: ${RULES_DEAD} 处"
  ERRORS=$((ERRORS + 1))
else
  echo "  rules.md 死链: 0"
fi

echo ""
echo "=== 1b. 全仓相对路径死链扫描（维度 306）==="
# 遍历所有 .md，提取 markdown 链接并校验目标文件是否存在。
# 排除项说明：
#   - 本段是"全仓死链扫描"（阻断），排除的是【不产出文档链接的目录】：
#     node_modules/.workbuddy/.sofagent/（非文档）、docs/changelog（历史冻结）、
#     docs/archive + FORGE/archive（归档·冻结历史，改由下方"归档区告警扫描"非阻断覆盖）、commercial（商务）
#   - 🔴 v1.2.5 P0-13/P0-14：docs/evidence 不再排除！此前 evidence/ 的 12 条死链
#     因排除而漏检（假绿根因之一）。evidence/ 是核心证据文档，链接必须纳入检查。
#   - SKILL/harness 排除：harness 模板含运行时动态路径占位（非真实链接）
#   - 🔴 v1.2.4 P4：FDE/ 不再排除！FDE/GUIDE.md + FDE/README.md + FDE/templates/
#     是核心人读文档，链接必须纳入自动检查（此前整目录排除 = 死链盲区）。
#     ⚠️ 注意：section 4 文档预算仍排除 FDE（预算口径，FDE 目录行数单独管理），
#     与本段死链检查的排除解耦——此处只考虑"链接有效性"，不考虑"预算归属"。
DEAD_LINKS=0
DEAD_DETAIL=""
EXCLUDE=(-not -path "*/node_modules/*" -not -path "*/.workbuddy/*" -not -path "*/.sofagent/*" -not -path "*/docs/changelog/*" -not -path "*/SKILL/harness/*" -not -path "*/docs/archive/*" -not -path "*/FORGE/archive/*" -not -path "*/commercial/*")
# v1.3.6 B11 性能迁移：逐行 bash 循环 + 每链接 fork subshell（cd+pwd）是全脚本第二瓶颈。
# 改 node 一次性完成主仓 + 归档区两遍扫描（判定语义与原实现一致：围栏跳过、
# 协议/占位符豁免、路径归一化后 existsSync）。输出死链清单，计数回填 bash 变量。
DEAD_SCAN=$(node -e '
const fs = require("fs");
const path = require("path");
const EXCLUDE = [/node_modules/, /(^|[\/\\])\.workbuddy[\/\\]/, /(^|[\/\\])\.sofagent[\/\\]/, /(^|[\/\\])docs[\/\\]changelog[\/\\]/, /(^|[\/\\])SKILL[\/\\]harness[\/\\]/, /(^|[\/\\])docs[\/\\]archive[\/\\]/, /(^|[\/\\])FORGE[\/\\]archive[\/\\]/, /(^|[\/\\])commercial[\/\\]/];
function walk(dir, out, excludes) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      if (!excludes.some(re => re.test(p + "/"))) walk(p, out, excludes);
    } else if (f.endsWith(".md")) out.push(p);
  }
}
function scan(files) {
  const dead = [];
  for (const mdfile of files) {
    let inFence = false;
    const lines = fs.readFileSync(mdfile, "utf-8").split("\n");
    for (const line of lines) {
      if (/^\s*```|^\s*~~~/.test(line)) { inFence = !inFence; continue; }
      if (inFence) continue;
      const matches = line.match(/\]\(([^)]+)\)/g) || [];
      for (const m of matches) {
        const target = m.slice(2, -1);
        if (target === "" || target.startsWith("#") || target.startsWith("http://") || target.startsWith("https://") || target.startsWith("mailto:")) continue;
        const pathPart = target.split("#")[0];
        if (!pathPart) continue;
        if (/:\/\//.test(pathPart) || /\/vX\.Y/.test(pathPart) || /vX\.Y\.Z/.test(pathPart) || /vX\.Y\.md/.test(pathPart)) continue;
        const resolved0 = pathPart.startsWith("/") ? "." + pathPart : path.join(path.dirname(mdfile), pathPart);
        const resolved = path.resolve(resolved0.replace(/\/+$/, ""));
        if (!fs.existsSync(resolved)) dead.push("  " + mdfile + ": " + target);
      }
    }
  }
  return dead;
}
const mainFiles = [];
walk(".", mainFiles, EXCLUDE);
const mainDead = scan(mainFiles);
// 归档区扫描用去掉了 archive 排除项的规则集——否则 walk 起点 docs/archive 自身会被排除
const ARCHIVE_EXCLUDE = EXCLUDE.filter(re => !re.source.includes("archive"));
const archiveFiles = [];
for (const d of ["docs/archive", "FORGE/archive"]) { if (fs.existsSync(d)) walk(d, archiveFiles, ARCHIVE_EXCLUDE); }
const archiveDead = scan(archiveFiles);
process.stdout.write(JSON.stringify({ mainDead, archiveDead }));
' 2>/dev/null || echo '{"parseError":true}')
# parseError 标记：node 扫描器自身崩溃时不得伪造空结果（空结果=0 死链=假绿——
# run-10 教训家族：检查器故障必须显式 FAIL，不能静默降级为「全绿」）
DEAD_LINKS=$(node -e "const d=JSON.parse(process.argv[1]);if(d.parseError)process.exit(1);console.log(d.mainDead.length)" "$DEAD_SCAN" 2>/dev/null || echo "SCAN_FAIL")
ARCHIVE_DEAD=$(node -e "const d=JSON.parse(process.argv[1]);if(d.parseError)process.exit(1);console.log(d.archiveDead.length)" "$DEAD_SCAN" 2>/dev/null || echo "SCAN_FAIL")
if [ "$DEAD_LINKS" = "SCAN_FAIL" ] || [ "$ARCHIVE_DEAD" = "SCAN_FAIL" ]; then
  ASSERTS=$((ASSERTS + 1)); echo "  ❌ 死链扫描器自身故障（node 输出不可解析）——结果不可信，按失败处理"
  ERRORS=$((ERRORS + 1))
  DEAD_LINKS=0
  ARCHIVE_DEAD=0
fi
DEAD_DETAIL=$(node -e "const d=JSON.parse(process.argv[1]);console.log(d.mainDead.join('\n'))" "$DEAD_SCAN" 2>/dev/null)

if [ "${DEAD_LINKS:-0}" -gt 0 ]; then
  echo "  全仓相对路径死链: ${DEAD_LINKS} 处"
  printf "%b" "$DEAD_DETAIL"
  printf "\n"
  ERRORS=$((ERRORS + 1))
else
  echo "  全仓相对路径死链: 0"
fi

# 归档区告警扫描（非阻断）——docs/archive + FORGE/archive 是冻结历史，链接腐烂不阻断发版，
# 但必须可见。v1.2.5 教训：archive 排除 = 死链盲区（planning 文件指向已删的 ROADMAP 锚点
# CI 永远抓不到）。此处只告警不计 ERRORS，保持归档冻结性的同时消除盲区。
if [ "${ARCHIVE_DEAD:-0}" -gt 0 ]; then
  echo "  ⚠ 归档区死链: ${ARCHIVE_DEAD} 处（冻结历史，不阻断发版，仅供参考）"
else
  echo "  归档区死链: 0"
fi

echo ""
echo "=== 2. 术语一致性检查 ==="
# 检查三处关键文件的铁律编号
# v1.1.4 起仅 A1-A14 / A1-A11 是过时编号（早期规则数）；
# "4 底线" "9 铁律" 是当前正确结构，不算过时
for file in SKILL/SKILL.md HANDBOOK.md DEVELOPMENT.md; do
  if [ -f "$file" ]; then
    COUNT=$(grep -cE "A1-A14|A1-A11" "$file" 2>/dev/null || true)
    COUNT=${COUNT:-0}
    echo "  $file: 过时术语出现 $COUNT 处"
  fi
done

echo ""

# 2a. 五能力术语断言（v1.4.4 新增——约束层从四能力升级为五能力「注入·审计·回溯·沉淀·进化」，
#     活文档残留旧四能力表述即 FAIL。防复发机械化：以后任何术语升级只需改本断言规则本体。
#     范围覆盖施工面：入口/文档/分发/装载（README 双语、docs 主文档+guides、SKILL、FDE/GUIDE、
#     HOOK.md、插件 README、install.sh、dashboard.html、SVG）。排除历史快照（changelog 已发布版、
#     archive）与 engine/ 源码（API 面）。
#     豁免：ARCHITECTURE.md 旧名兼容注——该行是 v1.2.9→v1.4.4 术语沿革的历史陈述，
#     「约束层四种能力」作为旧称引用属合法；豁免方式 = 行内容白名单（豁免行固定不随版本漂移）。
CAP5_FILES=$(grep -rl "" README.md README.en.md docs/*.md docs/guides/*.md SKILL/SKILL.md FDE/GUIDE.md engine/hooks/*/HOOK.md engine/openclaw-plugins/*/README.md install.sh tools/dashboard/dashboard.html docs/assets/*.svg 2>/dev/null || true)
CAP5_HITS=""
for f in $CAP5_FILES; do
  while IFS= read -r line; do
    # 行级白名单：ARCHITECTURE.md 旧名兼容注（术语沿革历史陈述，引用旧称合法）
    case "$line" in
      *"v1.2.9 统一为「约束层四种能力」"*) continue ;;
    esac
    CAP5_HITS="$CAP5_HITS
$line"
  done <<EOF
$(grep -nE "四种能力|四能力|一个层四种能力|注入·审计·回溯·进化|注入 · 审计 · 回溯 · 进化|inject · audit · rollback · evolve|four capabilities|注入 / 审计 / 回溯 / 进化|inject / audit / rollback / evolve|4 capabilities" "$f" 2>/dev/null || true)
EOF
done
CAP5_COUNT=$(printf "%s" "$CAP5_HITS" | grep -c "." || true)
CAP5_COUNT=${CAP5_COUNT:-0}
if [ "$CAP5_COUNT" -gt 0 ]; then
  echo "=== 2a. 五能力术语断言 ==="
  ASSERTS=$((ASSERTS + 1)); echo "  ❌ 活文档残留旧四能力表述 ${CAP5_COUNT} 处（现行口径：注入·审计·回溯·沉淀·进化）"
  printf "%s\n" "$CAP5_HITS" | grep "." | head -20
  ERRORS=$((ERRORS + 1))
else
  echo "=== 2a. 五能力术语断言：活文档零残留 ✓ ==="
fi

# 2b. U+FFFD 扫描（零豁免——替换字符在任何正常中文文档都不该出现，出现即编码损坏；
#     检测用 UTF-8 字节序列 ef bf bd，避免 BSD grep 对 ANSI-C 引用 $'\uFFFD' 的兼容差异）
FFFD_FILES=$(grep -rl "" README.md README.en.md docs/*.md docs/guides/*.md SKILL/SKILL.md FDE/GUIDE.md engine/hooks/*/HOOK.md engine/openclaw-plugins/*/README.md install.sh tools/dashboard/dashboard.html docs/assets/*.svg 2>/dev/null || true)
FFFD_HITS=""
for f in $FFFD_FILES; do
  HIT=$(LC_ALL=C grep -n $'\xef\xbf\xbd' "$f" 2>/dev/null || true)
  if [ -n "$HIT" ]; then
    FFFD_HITS="$FFFD_HITS
$f: $HIT"
  fi
done
FFFD_COUNT=$(printf "%s" "$FFFD_HITS" | grep -c "." || true)
FFFD_COUNT=${FFFD_COUNT:-0}
if [ "$FFFD_COUNT" -gt 0 ]; then
  ASSERTS=$((ASSERTS + 1)); echo "  ❌ 活文档存在 U+FFFD（编码损坏）${FFFD_COUNT} 行"
  printf "%s\n" "$FFFD_HITS" | grep "." | head -20
  ERRORS=$((ERRORS + 1))
else
  echo "=== 2b. U+FFFD 扫描：活文档零命中 ✓ ==="
fi

# 2c. 商业名脱敏断言（开源脱敏规范——GrapHub/FlowHub/AIR 全词匹配 FAIL；
#     AIR 断言限定文档活文档面：中文文档语境中独立词 AIR 只可能是私有代号泄漏，
#     源码层（三字母英文常量名）误报不可控、维持人工自查——本断言面为文档白名单）
LEAK_HITS=$(grep -nwE "GrapHub|FlowHub|AIR" README.md README.en.md docs/*.md docs/guides/*.md SKILL/SKILL.md SKILL/rules/*.md FDE/GUIDE.md engine/hooks/*/HOOK.md engine/openclaw-plugins/*/README.md install.sh tools/dashboard/dashboard.html 2>/dev/null || true)
if [ -n "$LEAK_HITS" ]; then
  ASSERTS=$((ASSERTS + 1)); echo "  ❌ 活文档存在商业产品名（GrapHub/FlowHub/AIR）——开源脱敏规范违规"
  echo "$LEAK_HITS" | head -20
  ERRORS=$((ERRORS + 1))
else
  echo "=== 2c. 商业名脱敏断言：活文档零命中 ✓ ==="
fi

echo ""
echo "=== 3. 版本号同步检查 ==="
VERSION_PKG=$(node -e "console.log(require('./engine/audit/package.json').version)" 2>/dev/null || echo "N/A")
echo "  package.json: $VERSION_PKG"

# 3a. WIKI 状态表「下一版」语义声称 vs ROADMAP（2026-08-22 新增——上轮发现 WIKI 曾写
#     「下一版 v1.3.9」但 v1.3.9 已交付、应为 v1.4.0；check-version 只查格式声称查不到语义声称，
#     这是人工维护盲区。此处比对 WIKI 状态表「下一版」与 ROADMAP 顶部「下一版」一致性）
# v1.4.3 F-16 补检查项（2026-08-29）：ROADMAP 无「下一版 vX.Y.Z」字面文本时（现行 ROADMAP
#     用迭代表「📋 规划中」标记），旧逻辑 ROADMAP_NEXT_V 为空 → elif 分支静默跳过 = 守卫空转
#     （WIKI 曾写「下一版 v1.4.2」而 v1.4.2 已交付，恰因此漏检）。补 fallback：取 ROADMAP
#     迭代表中第一个「📋 规划中」版本号作为下一版基准；两头都取不到时升为阻断（守卫空转比没有守卫危险）。
WIKI_NEXT=$(grep -m1 "下一版" docs/WIKI.md 2>/dev/null | sed -E 's/.*下一版[|｜][^|]*\*\*([^)]*)\*\*.*/\1/' )
WIKI_NEXT_V=$(echo "$WIKI_NEXT" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1)
ROADMAP_NEXT_V=$(head -30 docs/ROADMAP.md 2>/dev/null | grep -oE '下一版 v[0-9]+\.[0-9]+\.[0-9]+' | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if [ -z "$ROADMAP_NEXT_V" ]; then
  # fallback：ROADMAP 迭代表第一个「📋 规划中」或「✅ 开发完成」行（| **vX.Y.Z** | ... |）
  # v1.4.6（2026-09-07，fresh-eyes round-01 finding-10）：开发完成的版本停在「规划中」违反
  # 本文件口径，改为「✅ 开发完成」（「待发版」字样按 F6 门禁只留在 CHANGELOG 索引行）；
  # fallback 须同步识别该态，否则基准跳到下一行 → 与 WIKI「下一版」误报漂移
  ROADMAP_NEXT_V=$(grep -m1 -E '^\| \*\*v[0-9]+\.[0-9]+\.[0-9]+\*\* \| (📋 规划中|✅ 开发完成)' docs/ROADMAP.md 2>/dev/null | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1)
fi
if [ -z "$WIKI_NEXT_V" ]; then
  echo "  ${RED}✗ WIKI 状态表未找到「下一版」版本号——人工检查项升为阻断（守卫不得空转）${NC}"
  ERRORS=$((ERRORS + 1))
elif [ -z "$ROADMAP_NEXT_V" ]; then
  echo "  ${RED}✗ ROADMAP 未找到「下一版」基准（无「下一版 vX.Y.Z」文本且无「📋 规划中」行）——版本语义声称漂移检查失效${NC}"
  ERRORS=$((ERRORS + 1))
elif [ "$WIKI_NEXT_V" != "$ROADMAP_NEXT_V" ]; then
  echo "  ${RED}✗ WIKI 状态表「下一版」=$WIKI_NEXT_V ≠ ROADMAP「下一版」=$ROADMAP_NEXT_V —— 版本语义声称漂移${NC}"
  ERRORS=$((ERRORS + 1))
else
  ASSERTS=$((ASSERTS + 1)); echo "  ✓ WIKI 状态表「下一版」$WIKI_NEXT_V 与 ROADMAP 一致"
fi

# 3b. 新能力段版本堆叠检查（2026-08-22 新增——上轮发现 HANDBOOK 堆叠 v1.3.1~v1.3.8 六段历史能力，
#     违反「新能力段只留最新版本」铁律；README 合规但 HANDBOOK 漏网。此处扫活文档中
#     独立的新能力段标题（列表项 + 加粗 emoji 版本号 + 「新增」，如 `- **🧠 v1.3.1 新增**：`），
#     排除句中/段首历史引用（LIMITATIONS 的「v1.0.9 新增的 A16 规则」是历史说明非堆叠段）；
#     排除 CHANGELOG/archive（历史快照本就该有）+ 排除当前版本 v1.3.9））
STACKED=$(grep -rnE '^[[:space:]]*[-*][[:space:]]+\*{1,2}[^ ]*v[0-9]+\.[0-9]+\.[1-9][0-9]*[[:space:]]+新增' README.md README.en.md docs/ --include="*.md" 2>/dev/null | grep -v "docs/changelog" | grep -v "docs/archive" | grep -v "v1.3.9" | head -5)
if [ -n "$STACKED" ]; then
  echo "  ⚠️ 活文档存在历史版本新能力段堆叠（新能力段应只留最新版，旧版去 CHANGELOG）"
  echo "$STACKED" | while read -r line; do echo "    $line" | cut -c1-100; done
  echo "  （警告非阻断——历史段可能是有意的版本追溯对照表，人工裁决）"
else
  ASSERTS=$((ASSERTS + 1)); echo "  ✓ 活文档无历史版本新能力段堆叠（新能力段只留最新版）"
fi

echo ""
echo "=== 4. 文档分层预算 ==="

# 公共排除条件（所有分层都排除的目录，手动展开到各层 find 命令）
# ⚠️ P0-13 排除理由（明确化，非静默漏洞）：
#   - docs/changelog + docs/archive + docs/evidence：历史冻结文档（发版后不再改），
#     预算约束的是「当前维护中的活文档」体量——历史文档只增不减，纳入预算会让
#     预算随版本累积线性爆炸，失去约束意义。archive/changelog 的体量由
#     releasing.md 阶段五的归档瘦身流程单独管理。
#   - SKILL/harness：模板目录，行数在 section 5 单独预算。
#   - FDE：独立产品目录，行数由 FDE 侧单独管理。
# shellcheck disable=SC2034  # 变量供文档参考，实际展开在各 LAYER find 命令中
COMMON_EXCLUDE='node_modules .workbuddy .sofagent docs/changelog docs/evidence SKILL/harness FDE'

# 计算函数：count_md <find_args>
count_md() {
  find . -name "*.md" "$@" -print0 2>/dev/null | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1+0}'
}

# A 层：用户文档（根目录 *.md + docs/ 主文档）
# 排除：B/E 层目录 + 公共排除（C/D 层已退役，见下方各层说明；原 C/D 层排除项已同步清理）
# v1.3.9+ 分层修正（2026-08-22）：engine/*/README.md + tools/README.md 是包级开发者文档，
# 从 A 层（用户文档）移出，不再占用户文档预算（见下方对应 -not -path 排除项）。
# 承接约束 = 本脚本 §4 尾部的 **F 软检查**（只提示不阻断、不计 ERRORS）：
#   「F-pkg 包级 README 合计」= find ./engine ./tools -name README.md，>1500 行软警戒——
#   与上面移出的两个位置**逐一对上**（原注释写「由 F 软检查约束」是对的）。
# ⚠️ 收面批复核记录：本条曾被误判为「悬空承诺（写了 F 软检查却无实现）」，复核结论是
#   **实现确实存在**（§4 尾部 F-lessons / F-pkg 两段在脚本内实跑并打印）。误判成因：按
#   「F 层 / LAYER_F / F 软」等字样检索，而该段标题写作「F 检查」、输出前缀写作
#   F-lessons / F-pkg，字样对不上 → 检索式比代码更早下结论。故把指针写进本注释，
#   下次直接对照，不再靠字样猜（这是本批「承诺↔落地物」核对的一个反例教训）。
# 另：tools/README.md 的**收录完整性**（工具是否漏登记）由 tools/check/check-tool-health.sh
#   单独对账，与本处行数预算属两个面。
LAYER_A=$(find . -name "*.md" \
  -not -path "*/node_modules/*" \
  -not -path "*/.workbuddy/*" \
  -not -path "*/.sofagent/*" \
  -not -path "*/docs/changelog/*" \
  -not -path "*/docs/evidence/*" \
  -not -path "*/SKILL/*" \
  -not -path "*/FDE/*" \
  -not -path "*/FORGE/*" \
  -not -path "*/playbook/*" \
  -not -path "*/docs/guides/*" \
  -not -path "*/agents/*" \
  -not -path "*/.github/*" \
  -not -path "*/engine/hooks/*" \
  -not -path "*/commercial/*" \
  -not -path "*/docs/DEVELOPMENT.md" \
  -not -path "*/docs/archive/*" \
  -not -path "*/data/*" \
  -not -path "*/engine/*/README.md" \
  -not -path "*/engine/dsh-plugins/*.md" \
  -not -path "*/engine/orchestrator/src/sandbox/*.md" \
  -not -path "*/tools/README.md" \
  -print0 2>/dev/null | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1+0}')
LAYER_A=${LAYER_A:-0}

# B 层：开发者参考（playbook/ + FORGE/ + agents/ + .github/ + hooks/HOOK.md + DEVELOPMENT.md）
# v1.2.1: 排除 fresh-eyes runs/ 运行时产物（check/findings/result.md 是审查轮输出，
# 已被 .gitignore 忽略，不是开发者参考文档——不计入文档预算）
# v1.2.1: 排除 data/forge-runs/（同属审查轮运行时产物，数据重构后从 .sofagent/ 迁来）
# v1.3.9+ 分层修正（2026-08-22）：FORGE/lessons/ 是内部经验沉淀（每轮审查持续增长，
# 设硬上限不合理）——移出 B 层预算，由 F 软检查（只提示不阻断）触发定期整理
# ⚠️ 排除理由（明确化，非静默漏洞）：playbook/vendor/ 是第三方 vendored 上游原文
# （MIT，钉 commit，路径 1:1 保留供 diff -r 升级，清单见
# vendor/improve-codebase-architecture/PROVENANCE.md）。预算约束的是「自研文档」体量——
# 把第三方原文计入，会让「换 pin 升级」直接撞预算墙而被迫删上游内容，把升级能力和预算
# 变成互斥项。自研侧不因此脱管：适配层 deep-module-review.md 留在 playbook/ 根下正常计账，
# 上游 pin 由 PROVENANCE 单独管，不靠行数预算兜。
# 🔴 playbook/ 归 B 层：它与 FORGE/ 同属开发者参考面（证据与门禁文档），故与 FORGE/ 一并
# 计入 B 层预算，LIMIT_B 覆盖二者合计。反向必查：A 层 find 是全仓扫，必须显式排除
# */playbook/*，否则 playbook/ 下的 *.md 会被 A 层二次计账。两层互斥：既无重复计账，
# 也无覆盖盲区。
LAYER_B=$(find ./FORGE ./playbook ./agents ./.github ./engine/hooks ./docs/DEVELOPMENT.md \
  -name "*.md" \
  -not -path "*/node_modules/*" \
  -not -path "*/fresh-eyes-loop/runs/*" \
  -not -path "*/FORGE/lessons/*" \
  -not -path "*/playbook/vendor/*" \
  -print0 2>/dev/null | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1+0}')
LAYER_B=${LAYER_B:-0}

# 🔴 C 层已删除（2026-09-12 收面批）：原 find 指向 ./FORGE/SKILL/fresh-eyes-loop/specs，
# 该目录在仓库中不存在（find 全仓无 specs 目录）且无替代物 → 该层恒为「0 / 6300」，
# 是永不触发的免费绿灯（假绿）。层本体与 LIMIT_C 上限一并移除，不留空转预算。
# 审查体系文档的去向：playbook/*.md 已被 B 层（find ./FORGE ./playbook）正常计账，
# 体系一致性另有 tools/check/check-review-system.sh 维度对账——不存在检查盲区。

# 🔴 D 层已删除（2026-09-12 收面批，与 C 层同款缺陷族第二实例）：原 find 指向
# ./docs/architecture 与 ./docs/prd，两个目录在当前仓库**均不存在** → 该层恒为
# 「0 / 2000」，是永不触发的免费绿灯（假绿），层本体与 LIMIT_D 一并移除。
# 【原口径】LIMIT_D 注释记载：v1.1.9 把 docs/architecture（设计 876 行）+ docs/prd
# （193 行）从 A 层移入 D 层，形成「工程文档 vs 设计文档」的分层。
# 【内容去向·删层前提（已核验，非猜测）】
#   ① 设计文档现收敛为单文件 docs/ARCHITECTURE.md（1313 行）——已被 A 层真实计入：
#      它出现在 LAYER_A 的 find 结果中，且 LAYER_A 实算值与 §4 输出逐数吻合，
#      数学闭合 → 删 D 层不丢覆盖（B 层 find 目录列表不含它，无重复计账）。
#   ② docs/prd/ 的 193 行 PRD 内容在当前仓库**不存在任何形态**（无 docs/prd/、
#      无 docs/PRD.md、无其它 *prd* 文件；git 全历史 2851 提交内两条路径零命中）
#      → 无内容可丢，不存在「删掉就丢覆盖」的风险。
# 【后人若要重建 D 层】find 路径必须指向**真实存在**的目录，并同步登记 LIMIT_D；
#   不得再指向 docs/architecture/ / docs/prd/ 这两个历史路径。
# 【配套清理·已处置】LAYER_A 里原为本次「A→D 拆分」而设、现已空转的两条排除项
#   `-not -path "*/docs/architecture/*"` 与 `-not -path "*/docs/prd/*"` **已一并删除**
#   （no-op 自证：删前/删后 A 层实算值均为 7120，差值 0——两目录不存在，排除零文件）。
#   保留它们的唯一后果是陷阱：将来谁重建同名目录，内容会被静默挤出 A 层且不进任何层，
#   正是本批要消灭的「覆盖盲区」缺陷。通道已清，重建 D 层时不会有残留排除项干扰。

# E 层：运维指南（docs/guides/）
LAYER_E=$(find ./docs/guides -name "*.md" -print0 2>/dev/null | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1+0}')
LAYER_E=${LAYER_E:-0}

# 上限定义
LIMIT_A=7680  # 归层修正批（2026-09-19）：engine/dsh-plugins/*.md 与 engine/orchestrator/src/sandbox/*.md 移出 A 层（前者是门禁 check-seam-contract.mjs 直接解析的 seam 词汇表 SSOT、后者是沙箱实现位置对照表——均属开发者参考面，与既有 engine/*/README.md、engine/hooks/* 排除先例同类）；同时修正「批注自身记载过该缺口却以抬上限代替归层修正」的累积——此前 SEAMS.md 加入时（7020→7200 批）已记「LAYER_A 的排除项未含 engine/dsh-plugins/** 故这批内容计入本层」，其后 A 层六次上调（7200→7470→7520→7600→7620→7680）部分由此挤占。归层后 A 层实测 7089（回收 518 行 = SEAMS.md 291 + engine/dsh-plugins/*/SKILL.md 七插件 181 + sandbox/ATTACK-SURFACE.md 46——排除模式 `*/engine/dsh-plugins/*.md` 的 * 含斜杠故连插件级 SKILL.md 一并归位，与既有 `*/SKILL/*` 排除同理），余 591。 # v1.5.0 发版前排期预留余量（实测 7607，前值 7620 仅余 13 行——并发 session 的 A 层改动即引爆门禁；前批已实际发生一次碰撞：并发 README 重构使 A 层 7559→7585 计 +26。本批预留三项：并发批碰撞量 ~26 + 阶段十一发版后翻牌批双语 README 能力段替换 ~30 + 安全裕度。属排期预留非超标上调，前值 7620）# 排期预留余量：墙式段落与表格单格拆解后实测 7598，上一值 7600 仅余 2 行（任何 A 层文档改动即引爆门禁——本批已实际发生一次：并发 README 重构使 A 层 7559→7585）——按排期预留余量上调（非超标上调，前值 7600）  # 文档体系修复批：墙式段落拆解（12 处 >=500 字符的段落/表格单格改分点结构，零信息删除）+ CONTRIBUTING 补目录与版本头 + SECURITY 承接 Dashboard 服务面核验节（归属调整）——按铁律超标上调不删内容（前值 7520）  # v1.5.0 章十 DSH 插件事件接线批（7506>7470+36：SEAMS.md 增「接线面三处对账」硬规则（漏接线/幽灵订阅专名）与事件位验证步；§1 词表修两处缺陷——被合并的表格行致门禁对某条失明、hook-protocol 载荷类型误登记为可挂事件——并新增 session/event 行；§6 表改「声明 + 实现」。探针完整脚本 + 两个必踩的坑 + 实测输出落 Case 022（docs/evidence/ 不计入本层），SEAMS.md 只留指针。均系本章真实交付物，按铁律超标上调不删内容） # 前值 7470 = v1.4.9 bugfix 批超标上调（7458>7450+8：CHANGELOG 破坏性变更公告块 +5——cleanupOnRecord 移除/canaryRouteRequest 更名双声明、LIMITATIONS 诚实披露 +4——SOFAGENT_CLEANUP_ON_RECORD 移除说明、WIKI 同名导出消歧矩阵 +2、ARCHITECTURE train 独立测试行 +1，均系 bugfix 批正当交付物，按铁律超标上调不删内容）# v1.4.9 G5b/G1 连接器与模板批超标上调（7405>7400+5：AGENTS.md 补 connector_register/connector_list/workflow_export/workflow_import 四表行 + ARCHITECTURE 五域图 C7 连接器注册面条目与 A3 模板面扩容——均系 103 tools 真实落点，按铁律超标上调不删内容）# v1.5.0 命名债务清扫**排期预留余量**（前值 7200 仅余 19 行＝7181/7200，不足以承载改名牵动的 ARCHITECTURE/WIKI/双语 README 同步，及本批 SEAMS.md §2b 宿主 profile 挂载差异 +9 行）——属排期预留非超标上调，实测值见 check-docs 输出 # 前值 7200：seam 契约批新增 engine/dsh-plugins/SEAMS.md（182 行：宿主真实挂载点词汇表 + 非 seam 接入形态登记）+ 9 个 DSH 插件 SKILL.md 措辞同步；LAYER_A 的排除项未含 engine/dsh-plugins/** 故这批内容计入本层——按铁律超标上调不删内容 7020→7200 # v1.4.7 后知识库落盘批（7015>7000+15：ARCHITECTURE 新增「约束同源：一份定义，多端消费」节——四源行业印证+双规则引擎 v1.5.2 内部对位，系知识库 P1 落盘真实内容；另含并行 README 批 +1；按铁律超标上调不删内容） # v1.3.9 行业笔记落盘（6936>6900+36：VALIDATION 新增 4 节——947 测量者转型/红杉专家判断力工程化/Palantir Red Loop+KLMLoop Engineering 四层循环，均系行业印证真实内容；按铁律超标上调不删内容）  # v1.3.9 bugfix 67 项文档批：A 层 6761>6650 正当上调——诚实边界声明（task/logs 明文+单机单用户定位）/术语表 4 条/导读句/论证表等均系独立审查修复要求新增，非冗余；此前 v1.3.8 轮询语义修正 6642>6600 上调至 6650
LIMIT_B=9600  # v1.5.0 文档审查修复批（9544>9500+44：r2/r3 两轮独立审查修复——GUIDE 章节归正/索引修正/ARCHITECTURE 治理面与导航/DEVELOPMENT 章节正序化+维护者口径迁入/guides 若干路径与事实修正；铁律超标上调不删内容） # v1.3.9 发版后审查批（9434>9400+34：2026-08-22 审查轮新增——VALIDATION 行业笔记 4 节/PHILOSOPHY 拆章节/v1.4.0 排期 4 件收口（MLflow+Browser+联邦E2E+bash3.2）117 行/6+1 文档优化/WIKI 规划目录说明；按铁律超标上调不删内容）；此前 9400（9269>9220+49：A/B/C/D/E 文档批新增 79 行——meta-harness 19/MLflow 13/agentic-browser 18/tools 分目录 22/SKILL.md 工具表+1/banner 重生成说明+6；按铁律超标上调不删内容） ⚠️ 三项修复：checklist 49/94/101 注释 +9 行（run-06 零信任复验——dim49 环境误报标注/dim94 人工核对语义/dim101 LIMIT 解析 bug 根因记录，检查器侧修正非删内容）；此前 rules/ 收敛重构 +26→9190；v1.3.9 阶段十一发布前（9363>9300+63：阶段八文档收尾 B 层新增——ROADMAP v1.3.9 迭代表行+现在在哪段+13 行/HANDBOOK v1.3.9 能力 bullet/README 双语新能力段等；铁律超标上调不删内容）
# v1.3.7: B 层 8945（交付⑥⑨测试数对账+memory_sync 文档），铁律上调 8940→8950；v1.3.6: 8901（累计 8880→8910→8940）
LIMIT_E=4000  # v1.2.5: E 层 2905 行（新增 dashboard-html-dev.md 219 行 + enterprise-deploy 扩展），上调 2700→3100 留余量；v1.4.0: multi-device-sync 补远程 API 通道 → 3110>3100，按铁律超标上调不删内容 3100→3200 留余量；v1.4.1: 后训模块地基新增 train-stack.md（双栈契约）+ train-security.md（安全基线），先压缩旧指南 3327→3252 后仍超 → 2026-08-25 拍板上调 3200→3300（不放宽到 3400）；v1.4.2: ARCHITECTURE §二 FORGE 段 193 行迁入 loop-development.md（E 层 3300→3484）→ 按铁律超标上调不删内容 3300→3600；v1.4.3: 新增 github-pr-playbook.md 157 行（三轮实战 15 条 PR 经验沉淀）+ 四指南微调 → 3725>3600，按铁律超标上调不删内容 3600→3800；v1.4.4: github-pr-playbook 台账扩容（在投 20→29 条 + 坑位 2 条 + 流量基线 5.3.1 + 第七节曝光渠道）→ 3811>3800，按铁律超标上调不删内容 3800→3900；v1.4.5: 新增 train-quickstart.md 153 行 → 4047>3900 曾上调 3900→4200，2026-09-05 孔老师拍板回收紧 4200→4000——三大指南纯冗余压缩 101 行（loop-development 坑1/坑3 与 §3.4/§3.6 重复代码块改交叉引用、spawnWorker 全码块收为一行模式引用；fde-activation-chain activate 七步伪码收为签名+步骤摘要；team-collaboration automerge 三段样板收为一句）后 3947/4000，零信息删除；v1.4.6: github-pr-playbook.md 移出公开仓（星数博弈内容对开源形象损害大于收益，四轮审查 P1-⑨ 拍板）→ E 层回落
LIMIT_TOTAL=17280  # v1.5.0 发版前随 LIMIT_A 同步（7680+9600=17280，须 >= A 与 B 上限之和；实测 A+B 17162）（前值 17220） # 随 LIMIT_B 同步（7620+9600=17220，须 >= A 与 B 上限之和；实测 A+B 17120）（前值 17120） # 随 LIMIT_A 同步（7620+9500=17120，须 >= A 与 B 上限之和；实测 A+B 17032）（前值 17100）  # 随 LIMIT_A 同步（7600+9500=17100，须 >= A 与 B 上限之和；实测 A+B 16993）（前值 17020）  # v1.5.0 随 LIMIT_A 同步（7520+9500=17020，A+B 共享计数故须 ≥ A 与 B 上限之和；实测 A+B 16866）+ v1.5.0 章十上调见 LIMIT_A 记录 # 前值 17000（v1.5.0 随 LIMIT_A 预留同步 7400+9500=16900 ≤ 17000） # 前值 16500：v1.3.9 发版后审查批（A+B 16423>16400+23 随 B 层上调——2026-08-22 审查轮新增，见 LIMIT_B 记录；铁律超标上调不删内容）  # v1.3.9 行业笔记落盘（A+B 16301>16300+1 随 A 层上调——VALIDATION 新增 4 节；铁律超标上调不删内容）  # v1.3.9 bugfix 67 项文档批：A+B 15968>15860 随 A 层上调（B 层 9207<9220 未超）；此前 v1.3.8 regression 修复连带 15830→15860；v1.3.9 阶段十一发布前（A+B 16208>16200 随 B 层上调——阶段八文档收尾新增，见 LIMIT_B 记录）

# 输出各层
echo "  A 用户文档:     ${LAYER_A} 行 / ${LIMIT_A} 上限"
echo "  B 开发者参考:   ${LAYER_B} 行 / ${LIMIT_B} 上限"
echo "  E 运维指南:     ${LAYER_E} 行 / ${LIMIT_E} 上限"

# F 检查（软提示非阻断 · v1.3.9+ 分层修正配套）：lessons 经验沉淀 + 包级 README
# 只提示不阻断（不增加 ERRORS）；超软警戒线 → 提示触发定期整理（机制见 FORGE/lessons/index.md 维护公约）
LESSONS_LINES=$(find ./FORGE/lessons -name "*.md" -print0 2>/dev/null | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1+0}')
LESSONS_LINES=${LESSONS_LINES:-0}
PKG_README_LINES=$(find ./engine ./tools -name "README.md" -not -path "*/node_modules/*" -not -path "*/dist/*" -print0 2>/dev/null | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1+0}')
PKG_README_LINES=${PKG_README_LINES:-0}
if [ "$LESSONS_LINES" -gt 3000 ]; then
  echo "  ⚠️ F-lessons 经验沉淀 ${LESSONS_LINES} 行 > 3000 软警戒——建议整理（归并重复/归档已泛化条目，见 FORGE/lessons/index.md 维护公约）"
else
  ASSERTS=$((ASSERTS + 1)); echo "  ✓ F-lessons 经验沉淀 ${LESSONS_LINES} 行（≤3000 软警戒，定期整理机制见 index.md）"
fi
if [ "$PKG_README_LINES" -gt 1500 ]; then
  echo "  ⚠️ F-pkg 包级 README 合计 ${PKG_README_LINES} 行 > 1500 软警戒——建议精简"
else
  ASSERTS=$((ASSERTS + 1)); echo "  ✓ F-pkg 包级 README 合计 ${PKG_README_LINES} 行（≤1500 软警戒）"
fi

echo "  ─────────────────────────"
AB_TOTAL=$(( ${LAYER_A:-0} + ${LAYER_B:-0} ))
echo "  A+B 合计:       ${AB_TOTAL} 行 / ${LIMIT_TOTAL} 上限"

# 检查各层
check_layer() {
  local name="$1" lines="$2" limit="$3"
  if [ "${lines:-0}" -gt "$limit" ]; then
    echo "  ${name} 超标！${lines} > ${limit}"
    ERRORS=$((ERRORS + 1))
  fi
}

check_layer "A 用户文档" "$LAYER_A" "$LIMIT_A"
check_layer "B 开发者参考" "$LAYER_B" "$LIMIT_B"
check_layer "E 运维指南" "$LAYER_E" "$LIMIT_E"
check_layer "A+B 合计" "$AB_TOTAL" "$LIMIT_TOTAL"

if [ "$ERRORS" -eq 0 ] || [ $((ERRORS)) -eq 0 ]; then
  echo "  未超标"
fi

echo ""
echo "=== 5. Skill 文件行数检查 ==="
for f in SKILL/harness/*.md; do
  LINES=$(wc -l < "$f" | tr -d ' ')
  STATUS=""
  if [ "$LINES" -gt 200 ]; then
    STATUS="超标"
    ERRORS=$((ERRORS + 1))
  else
    STATUS="OK"
  fi
  echo "    ${STATUS} $(basename "$f"): ${LINES} 行 (上限 200)"
done
# v1.2.4 P4: 子 Skill 包 80-120 行/个
for f in SKILL/skills/*.md; do
  [ -f "$f" ] || continue
  LINES=$(wc -l < "$f" | tr -d ' ')
  STATUS=""
  if [ "$LINES" -lt 80 ] || [ "$LINES" -gt 120 ]; then
    STATUS="超标"
    ERRORS=$((ERRORS + 1))
  else
    STATUS="OK"
  fi
  echo "    ${STATUS} $(basename "$f"): ${LINES} 行 (预算 80-120)"
done

echo ""
echo "=== 6. 铁律措辞检查 ==="
IRON_FAIL=0
for f in SKILL/harness/*.md SKILL/skills/*.md; do
  if [ -f "$f" ]; then
    WEAK=$(grep -n '建议\|应该\|尽量' "$f" 2>/dev/null | grep -v 'not_when\|Gotcha\|场景\|如果\|注\|说明\|这不是\|给用户看\|咨询式\|FDE Harness\|人工确认\|用户拍板\|展示推导\|辅助\|LLM' || true)
    if [ -n "$WEAK" ]; then
      echo "  $(basename "$f") 有弱措辞残留:"
      echo "$WEAK" | sed 's/^/     /'
      IRON_FAIL=$((IRON_FAIL + 1))
    fi
  fi
done
if [ "$IRON_FAIL" -gt 0 ]; then
  echo "  共 ${IRON_FAIL} 个文件有弱措辞残留"
  ERRORS=$((ERRORS + IRON_FAIL))
else
  echo "  全部 Skill 文件铁律措辞合格"
fi

echo ""
echo "=== 7. 规则数跨文档对照（v1.1.5 审-9 新增）==="
# 比对三个来源的规则数：
#   A. engine/audit/README.md 规则表行数（A 类 + E 类）
#   B. engine/audit/src/rules/index.ts 注册规则数
#   C. 主 README.md 声称的 "N 条规则"
# 三者不一致即告警——避免审-1（A18/A19 漂移）类问题再次出现

# A. audit/README 规则表行数（数 | A* 或 | E* 开头的表行）
# 用 node 替代 grep（BSD grep 对多字节 UTF-8 中文 .md 有二进制误判 bug）
AUDIT_README_COUNT=$(node -e '
const s = require("fs").readFileSync("engine/audit/README.md", "utf8");
console.log(s.split("\n").filter(l => /^\| (A|E)[0-9]+ /.test(l)).length);
' 2>/dev/null || echo "0")
AUDIT_README_COUNT=$(echo "$AUDIT_README_COUNT" | tr -d '[:space:]')

# B. rules/index.ts 注册规则数（数 { name: 'A* 或 'E* 开头的对象）
INDEX_TS_COUNT=$(grep -cE "^[[:space:]]+\{ name: '(A|E)[0-9]+" engine/audit/src/rules/index.ts 2>/dev/null || true)
INDEX_TS_COUNT=${INDEX_TS_COUNT:-0}
INDEX_TS_COUNT=$(echo "$INDEX_TS_COUNT" | tr -d '[:space:]')

# C. 主 README 声称的规则数（从 "24 条规则" 这种措辞提取；run-02 P1-5 口径勘误：注释示例 21→24）
MAIN_README_COUNT=$(grep -oE "[0-9]+ 条规则" README.md 2>/dev/null | head -1 | grep -oE "^[0-9]+" || true)
MAIN_README_COUNT=${MAIN_README_COUNT:-0}
MAIN_README_COUNT=$(echo "$MAIN_README_COUNT" | tr -d '[:space:]')

echo "  audit/README.md 规则表行数: $AUDIT_README_COUNT"
echo "  rules/index.ts 注册规则数:   $INDEX_TS_COUNT"
echo "  主 README.md 声称规则数:     $MAIN_README_COUNT"

MISMATCH=0
if [ "$AUDIT_README_COUNT" != "$INDEX_TS_COUNT" ]; then
  ASSERTS=$((ASSERTS + 1)); echo "  ❌ audit/README ($AUDIT_README_COUNT) ≠ index.ts ($INDEX_TS_COUNT)"
  MISMATCH=$((MISMATCH + 1))
fi
if [ "$MAIN_README_COUNT" != "0" ] && [ "$MAIN_README_COUNT" != "$INDEX_TS_COUNT" ]; then
  ASSERTS=$((ASSERTS + 1)); echo "  ❌ 主 README ($MAIN_README_COUNT) ≠ index.ts ($INDEX_TS_COUNT)"
  MISMATCH=$((MISMATCH + 1))
fi
if [ "$MISMATCH" -eq 0 ]; then
  echo "  ✅ 三者一致"
else
  ERRORS=$((ERRORS + MISMATCH))
fi

echo ""
echo "=== 8. audit/README 规则表 ruleClass 完整性（v1.1.6 回归追加）==="
# 注意：macOS BSD grep 对含多字节 UTF-8 中文的 .md 文件有二进制误判 bug
# （file 命令报 data，grep 输出 "Binary file matches"），改用 node 做文本检查
MISSING_CLASS=$(node -e '
const fs = require("fs");
const content = fs.readFileSync("engine/audit/README.md", "utf8");
const lines = content.split("\n");
const classes = ["业务底线", "能力拐杖", "工程规范"];
let errs = 0;

// A. 每个规则表行必须含合法 ruleClass
for (const line of lines) {
  if (/^\| (A|E)[0-9]+ .+ \|/.test(line)) {
    const hasClass = classes.some(c => line.includes(c));
    if (!hasClass) {
      console.log("  ❌ " + line.trim() + " （缺少合法 ruleClass）");
      errs++;
    }
  }
}

// B. 三个 ruleClass 关键词必须都在文件里定义过
for (const cls of classes) {
  if (!content.includes(cls)) {
    console.log("  ❌ audit/README.md 未定义 ruleClass: " + cls);
    errs++;
  }
}
console.log(errs === 0 ? "  [OK] 规则表 ruleClass 完整且定义齐全" : "");
process.exit(errs > 0 ? 1 : 0);
' 2>&1)
NODE_RC=$?
echo "$MISSING_CLASS"
if [ "$NODE_RC" -ne 0 ]; then
  ERRORS=$((ERRORS + 1))
fi

echo ""
echo "=== 9. River 比喻跨文档计数（F-09）==="
# River 比喻词（堤坝/自来水厂/管网）在非 README 文档中应 ≤4 处
# README.md 是锚点，不限制
RIVER_DOCS="docs/ARCHITECTURE.md docs/PHILOSOPHY.md docs/VALIDATION.md FDE/GUIDE.md"
RIVER_WARN=0
for doc in $RIVER_DOCS; do
  if [ -f "$doc" ]; then
    # 🔴 v1.2.5 修复整数比较 bug：grep -c 无匹配时输出 "0" 且退出码 1，
    #    原 `|| echo "0"` 会再补一个 "0" 使 RIVER_COUNT="0\n0"，
    #    导致下方 `[ -gt ]` 报 "integer expression expected"。
    #    改用 `|| true`（只稳退出码、不追加输出）+ 默认值兜底文件不可读(exit 2)的空值。
    RIVER_COUNT=$(grep -c "堤坝\|自来水厂\|管网" "$doc" 2>/dev/null || true)
    RIVER_COUNT=${RIVER_COUNT:-0}
    if [ "$RIVER_COUNT" -gt 4 ]; then
      echo "  ⚠ $doc River 比喻 ${RIVER_COUNT} 处（建议 ≤4）"
      RIVER_WARN=$((RIVER_WARN + 1))
    else
      ASSERTS=$((ASSERTS + 1)); echo "  ✓ $doc River 比喻 ${RIVER_COUNT} 处"
    fi
  fi
done
if [ "$RIVER_WARN" -gt 0 ]; then
  echo "  共 ${RIVER_WARN} 个文档超标"
else
  echo "  全部在阈值内"
fi

echo ""
echo "=== 10. SKILL.md 底线/铁律数一致性（F-19）==="
SKILL_FILE="SKILL/SKILL.md"
if [ -f "$SKILL_FILE" ]; then
  # 提取标题声称的底线数
  BOTTOM_CLAIMED=$(grep -oE "### ([0-9]+) 底线" "$SKILL_FILE" | grep -oE "[0-9]+" | head -1)
  # 提取标题声称的铁律数
  IRON_CLAIMED=$(grep -oE "### ([0-9]+) 则铁律" "$SKILL_FILE" | grep -oE "[0-9]+" | head -1)
  # 提取实际底线条数（### N 底线 到下一个 ### 之间的 - 开头行）
  if [ -n "$BOTTOM_CLAIMED" ]; then
    BOTTOM_ACTUAL=$(sed -n "/^### ${BOTTOM_CLAIMED} 底线/,/^### /p" "$SKILL_FILE" | grep -cE "^[0-9]+\. |^- " || true)
    BOTTOM_ACTUAL=${BOTTOM_ACTUAL:-0}
  else
    BOTTOM_ACTUAL=0
  fi
  if [ -n "$IRON_CLAIMED" ]; then
    IRON_ACTUAL=$(sed -n "/^### ${IRON_CLAIMED} 则铁律/,/^### /p" "$SKILL_FILE" | grep -cE "^[0-9]+\. |^- " || true)
    IRON_ACTUAL=${IRON_ACTUAL:-0}
  else
    IRON_ACTUAL=0
  fi
  echo "  底线: 标题声称 ${BOTTOM_CLAIMED:-N/A} 条，实际 ${BOTTOM_ACTUAL} 条"
  echo "  铁律: 标题声称 ${IRON_CLAIMED:-N/A} 条，实际 ${IRON_ACTUAL} 条"
  if [ "${BOTTOM_CLAIMED:-0}" != "${BOTTOM_ACTUAL}" ] 2>/dev/null; then
    ASSERTS=$((ASSERTS + 1)); echo "  ❌ 底线数不一致: 标题 ${BOTTOM_CLAIMED} vs 实际 ${BOTTOM_ACTUAL}"
    ERRORS=$((ERRORS + 1))
  fi
  if [ "${IRON_CLAIMED:-0}" != "${IRON_ACTUAL}" ] 2>/dev/null; then
    ASSERTS=$((ASSERTS + 1)); echo "  ❌ 铁律数不一致: 标题 ${IRON_CLAIMED} vs 实际 ${IRON_ACTUAL}"
    ERRORS=$((ERRORS + 1))
  fi
  if [ "${BOTTOM_CLAIMED:-0}" = "${BOTTOM_ACTUAL}" ] && [ "${IRON_CLAIMED:-0}" = "${IRON_ACTUAL}" ] 2>/dev/null; then
    ASSERTS=$((ASSERTS + 1)); echo "  ✓ 底线/铁律数一致"
  fi
else
  echo "  ⚠ SKILL.md 不存在: $SKILL_FILE"
fi

echo ""
echo "=== 11. 跨文档 #锚点 死链扫描（F-20 · P0-13 起纳入 ERRORS）==="
# v1.3.6 B11: bash 逐行实现迁移到 node 版 check-anchors.mjs——此前本项是全脚本性能瓶颈
#（实测 26m42s，bash 每行 fork node 归一化标题；node 版几秒完成同等工作）。
# 判定语义不变：锚点过时计入 ERRORS 阻断（文件断链由第 1/1b 节死链检查负责，本项只看锚点）。
if [ "${SKIP_ANCHOR_SCAN:-0}" = "1" ]; then
  SKIPS=$((SKIPS + 1)); echo "  ⏭️ 跳过（SKIP_ANCHOR_SCAN=1）——锚点检查由 check-anchors.mjs 覆盖（pre-push 第 4 步）"
else
  ANCHOR_OUTPUT=$(node tools/check/check-anchors.mjs 2>&1); ANCHOR_RC=$?
  if [ "$ANCHOR_RC" -eq 0 ]; then
    ASSERTS=$((ASSERTS + 1)); echo "  ✓ 跨文档锚点无死链"
  else
    echo "  锚点过时（已计入 ERRORS）："
    printf '%s\n' "$ANCHOR_OUTPUT" | grep -E '✗|锚点过时' | head -12
    ERRORS=$((ERRORS + 1))
  fi
fi

echo ""
echo "=== 12. AGENTS.md MCP 全量工具表与 tool-registry 一致性 ==="
# 门禁目的：防速查表漂移——registry 新增/删除工具而 AGENTS.md 全量表未同步时阻断。
# 校验面：AGENTS.md「MCP 全量工具表」小节内的 \`tool_name\` 集合 vs tool-registry.ts 注册名集合，双向差集均须为空。
# 实现注：node 内嵌正则用 [\x60]（反引号）字符类，避开 bash 双引号内 backtick 转义地狱。
TOOL_TABLE_CHECK=$(node -e "
const fs = require('fs');
const agents = fs.readFileSync('SKILL/AGENTS.md', 'utf8');
const section = (agents.split('## MCP 全量工具表')[1] || '').split('\n## ')[0];
const bt = String.fromCharCode(96);
const re = new RegExp(bt + '([a-z_]+)' + bt, 'g');
const tableTools = new Set([...section.matchAll(re)].map(m => m[1]));
const regSrc = fs.readFileSync('engine/mcp/src/tool-registry.ts', 'utf8');
const regTools = new Set([...regSrc.matchAll(/name:\\s*'([a-z_]+)',/g)].map(m => m[1]));
const missInTable = [...regTools].filter(t => !tableTools.has(t)).sort();
const extraInTable = [...tableTools].filter(t => !regTools.has(t)).sort();
if (missInTable.length === 0 && extraInTable.length === 0) {
  console.log('OK ' + regTools.size);
  process.exit(0);
}
if (missInTable.length) console.log('MISSING ' + missInTable.join(','));
if (extraInTable.length) console.log('EXTRA ' + extraInTable.join(','));
process.exit(1);
" 2>&1); TOOL_TABLE_RC=$?
if [ "$TOOL_TABLE_RC" -eq 0 ]; then
  ASSERTS=$((ASSERTS + 1)); echo "  ✓ 全量表与 registry 一致（${TOOL_TABLE_CHECK#OK } tools）"
elif [ "$TOOL_TABLE_CHECK" = "PATTERN_MISS" ]; then
  echo "  ⚠ AGENTS.md 未找到「MCP 全量工具表」小节，跳过"
else
  ASSERTS=$((ASSERTS + 1)); echo "  ❌ 全量表与 registry 漂移："
  printf '%s\n' "$TOOL_TABLE_CHECK" | sed 's/^/    /'
  ERRORS=$((ERRORS + 1))
fi

echo ""
echo "=== 13. 接线存在性断言（v1.4.3 任务十一 · 声称「已交付」的能力必须有生产调用点）==="
# 门禁目的：门禁能测「数字对不对」，测不到「声称的事做没做」——本节补这个盲区。
# 规则：凡被查文档出现「已交付/核心能力」级能力声称（按 claims 列表逐项），
#       对应入口函数必须在 engine/ 生产代码（排除定义/测试/dist/类型声明）中 ≥1 处调用，
#       否则 fail（防「文档虚报已交付、代码零接线」——v1.4.3 P0 加密接线断链同源防御）。
# 可扩展结构：新检查项只需往 WIRING_CLAIMS 追加一行
#   「文档路径|文档声称字面量|入口函数名|说明」
#   ——文档路径按条指定：声称散落在不同文档（SECURITY.md / 双语 README）时各查各的，
#     避免「只查一个文件」形成新盲区（AgentShield 声称在 README 却只查 SECURITY.md 的前车之鉴）。
#   🔴 v1.4.9 G-1 修复（守卫空转根治）：**锚定串未命中 = FAIL，不再「天然通过」**。
#     旧实现把「文档里找不到锚定串」当「断言不适用」打 ⏭️ 放行——实测事故：SECURITY.md
#     措辞从「静态加密（v1.3.8 交付）」演化为「静态加密已接线（daemon start 路径）」后，
#     锚定串失配 ⇒ 该断言永久空转（本节注释原文自陈「未来 v1.4.7 真接线后本断言自动生效
#     防再虚报」——而正该生效时它没在跑）。根因不是设计而是遗漏：锚定串过期 = 文档措辞
#     漂移 = 锚点必须跟着走，属**必须当场报红**的信号，与 §14「未找到声称 → fail
#     （守卫不空转）」、check-storefront.sh 同款纪律。
#     修复口径：任一条 claim 未命中 ⇒ 计入 WIRING_STALE 并 FAIL，提示「更新锚定串或
#     从 WIRING_CLAIMS 移除该声称」——两条路都必须留痕，禁止静默流放声称。
#   2026-08-29 首条：静态加密——SECURITY.md 声称「静态加密已接线」，initDataEncryption
#   必须有生产调用（v1.4.7 真接线后本断言生效防再虚报）。
#   2026-08-30 次条：AgentShield——双语 README 都当核心能力宣传，createAgentShield 必须有生产调用
#   （v1.3.7 实现 + 有测试但长期零调用点，同批已补 agent-shield CLI 子命令接线）。
#   2026-09-14 补漏（第 3 份审查报告点名族）：HANDBOOK 承诺「部署后自动收到」审计报告，
#   交付机制 pushAuditReport 必须有生产调用。⚠️ 本断言只判「机制是否接线」；「档位于
#   runtime 是否真按 weekly/monthly 触发」属保真度问题，不在本节判定面。
#   —— 补漏原则：声称族按「文档里能 grep 到的承诺句」逐族登记，不靠人工记忆。
#   2026-09-14 v1.4.9 P2-16 同步（本条**正是 G-1 抓到的第一个实例**）：HANDBOOK 的承诺句
#   被降级为如实——日报实装 / 周·月·季报排期中 / 扩容预警未实现——原锚定串
#   「部署后你会自动收到这些」随之过期，本断言当场报红（未静默空转，G-1 设计生效）。
#   现锚定串同步为现行措辞「部署后可自动收到这些」。⚠️ 因措辞已如实降级，本族判定面
#   **只**是「pushAuditReport 是否仍接线」，不再蕴含「四个报告档位都已实装」——
#   该保真度问题已由 P2-16 的措辞侧如实化处置（见 docs/HANDBOOK.md:130）。
WIRING_FAIL=0
WIRING_STALE=0
WIRING_CLAIMS=(
  "SECURITY.md|静态加密已接线|initDataEncryption|静态加密（SECURITY.md:65 声称族）"
  "README.md|AgentShield 五类配置面静态扫描|createAgentShield|AgentShield（README 核心能力声称）"
  "README.en.md|AgentShield static scanning across five config surfaces|createAgentShield|AgentShield（README.en 核心能力声称）"
  "CHANGELOG.md|train compare|submitCompareJobs|多基座对比训练（CHANGELOG v1.4.4 交付④——CLI 接线防断链）"
  "docs/HANDBOOK.md|部署后可自动收到这些|pushAuditReport|审计报告自动推送（HANDBOOK「部署后可自动收到这些（日报实装，周/月/季报排期中，扩容预警未实现）」承诺族——v1.4.9 P2-16 措辞如实化后同步锚定串）"
)
for claim in "${WIRING_CLAIMS[@]}"; do
  claim_file="${claim%%|*}"; rest1="${claim#*|}"
  claim_re="${rest1%%|*}"; rest2="${rest1#*|}"
  entry_fn="${rest2%%|*}"; claim_desc="${rest2#*|}"
  if grep -qF "$claim_re" "$claim_file" 2>/dev/null; then
    # 声称命中 → 断言入口函数在 engine/ 生产代码（排除定义行/测试/dist/.d.ts）至少 1 处调用
    call_count=$(grep -rn "$entry_fn(" engine/ --include="*.ts" --include="*.mjs" 2>/dev/null \
      | grep -v "/node_modules/" | grep -v "/dist/" | grep -v "\.test\." | grep -v "\.d\.ts" \
      | grep -v "export function $entry_fn" | grep -v "export declare function $entry_fn" \
      | grep -cv "function $entry_fn(" || true)
    call_count=${call_count:-0}
    if [ "$call_count" -eq 0 ] 2>/dev/null; then
      ASSERTS=$((ASSERTS + 1)); echo "  ❌ [${claim_desc}] ${claim_file} 命中「${claim_re}」但 ${entry_fn}() 在 engine/ 生产代码零调用——声称与接线断链"
      WIRING_FAIL=$((WIRING_FAIL + 1))
    else
      ASSERTS=$((ASSERTS + 1)); echo "  ✓ [${claim_desc}] ${entry_fn}() 生产调用 ${call_count} 处（声称与接线一致）"
    fi
  else
    # 🔴 v1.4.9 G-1：锚定串未命中 = 文档措辞漂移 = 断言空转 → FAIL（不再是「天然通过」）
    ASSERTS=$((ASSERTS + 1)); echo "  ❌ [${claim_desc}] ${claim_file} 未命中锚定串「${claim_re}」——锚定串过期（文档措辞漂移），不是「天然通过」："
    echo "      修法：① 把锚定串更新为现行措辞（见 ${claim_file} 实际文案）；② 或从 WIRING_CLAIMS 移除该声称（须留痕说明为何不再适用）"
    WIRING_STALE=$((WIRING_STALE + 1))
  fi
done
if [ "$WIRING_FAIL" -gt 0 ]; then
  ERRORS=$((ERRORS + WIRING_FAIL))
fi
if [ "$WIRING_STALE" -gt 0 ]; then
  ASSERTS=$((ASSERTS + 1)); echo "  ❌ §13 守卫空转：${WIRING_STALE} 条声称的锚定串已过期——守卫没在看（v1.4.9 G-1 起此处阻断）"
  ERRORS=$((ERRORS + WIRING_STALE))
fi

echo ""
echo "=== 14. 平台挂载文件 MCP 工具数对账（v1.4.3 F-16 同源盲区补查）==="
# 门禁目的：GEMINI.md / .cursor/rules/sofagent.mdc 属平台挂载文件，游离在既有数字门禁外
# （AGENTS.md 有第 12 节对账，这两个文件此前无人查——2026-08-29 实测 61 vs 实际 76 漂移两个版本）。
# 规则：文件中「N 个 tool」声称值必须与 tool-registry.ts 注册数一致；未找到声称 → fail（守卫不空转）。
MCP_REG_COUNT=$(node -e "
const fs = require('fs');
const regSrc = fs.readFileSync('engine/mcp/src/tool-registry.ts', 'utf8');
const regTools = new Set([...regSrc.matchAll(/name:\s*'([a-z_]+)',/g)].map(m => m[1]));
console.log(regTools.size);
" 2>/dev/null || true)
PM_CLAIMED=${PM_CLAIMED:-0}
PLATFORM_MOUNT_FILES="GEMINI.md .cursor/rules/sofagent.mdc"
for pmf in $PLATFORM_MOUNT_FILES; do
  if [ ! -f "$pmf" ]; then
    SKIPS=$((SKIPS + 1)); echo "  ⏭️ $pmf 不存在——跳过"
    continue
  fi
  PM_CLAIMED=$(grep -oE '[0-9]+ 个 tool' "$pmf" 2>/dev/null | head -1 | grep -oE '[0-9]+' || true)
  if [ -z "$PM_CLAIMED" ]; then
    ASSERTS=$((ASSERTS + 1)); echo "  ❌ $pmf 未找到「N 个 tool」声称——数字门禁盲区（守卫不空转：有挂载描述就该有数字且对账）"
    ERRORS=$((ERRORS + 1))
  elif [ "$PM_CLAIMED" != "$MCP_REG_COUNT" ]; then
    ASSERTS=$((ASSERTS + 1)); echo "  ❌ ${pmf}：声称 ${PM_CLAIMED} 个 tool ≠ registry 实际 ${MCP_REG_COUNT}"
    ERRORS=$((ERRORS + 1))
  else
    ASSERTS=$((ASSERTS + 1)); echo "  ✓ ${pmf}：${PM_CLAIMED} 个 tool 与 registry 一致"
  fi
done

echo ""

# ── 15. 全仓工具数声称对账（防新文件成数字门禁盲区）──────────────
# 门禁目的：§12/§14 只对账登记在册的文件（AGENTS/GEMINI/.cursor/README 等），
# 新增文档写「N 个 tool」时无人查——八处漂移曾连发三次的根因就是声称点散落。
# 本节全仓扫「N 个 tool(s)」声称，与 tool-registry.ts 实数对账：
#   - 排除面：changelog/ 历史快照、archive 归档、node_modules、engine 源码内的
#     泛型文案（如「N 个 tools 数组」非工具数声称）
#   - 豁免规则：演进链行（含 v1.x 且含「后为/起/新增」——历史事实行）；
#     「训练 N tools」等带前缀限定的行（非全局工具数声称）
#   - 其余声称 ≠ 实数 → fail（新声称点自动进对账面，零登记）
echo "=== 15. 全仓工具数声称对账（防新文件成盲区）==="
TOOL_CLAIM_SCAN=$(node -e "
const fs = require('fs');
const path = require('path');
// 排除面与 1b 死链扫描同口径 + engine 源码（内部文案非文档声称）
const EXCLUDE = [/node_modules/, /\.git/, /\.workbuddy/, /\.sofagent/, /docs\/changelog\//, /docs\/archive\//, /FORGE\/archive\//, /^engine\//, /^FORGE\/runs\//, /commercial/];
const regSrc = fs.readFileSync('engine/mcp/src/tool-registry.ts', 'utf8');
const regCount = new Set([...regSrc.matchAll(/name:\s*'([a-z_]+)',/g)].map(m => m[1])).size;
const results = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!EXCLUDE.some(re => re.test(p))) walk(p); continue; }
    if (!e.name.endsWith('.md') && !e.name.endsWith('.mdc')) continue;
    if (EXCLUDE.some(re => re.test(p))) continue;
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // 「N 个 tool」「N 个 tools」声称（含 badge/表格/散文各形态）
      const m = line.match(/([0-9]+) 个 tools?\b/g);
      if (!m) return;
      for (const claim of m) {
        const n = parseInt(claim, 10);
        // 豁免：演进链历史行（含 vX.Y 且含「后为/起」——HANDBOOK 441 行形态）
        if (/v[0-9]+\.[0-9]/.test(line) && /(后为|起)/.test(line)) continue;
        // 豁免：带前缀限定的非全局声称（训练 N tools / N tools 数组等）
        if (/训练|数组|监控/.test(line.slice(Math.max(0, line.indexOf(claim) - 6), line.indexOf(claim)))) continue;
        if (n !== regCount) results.push(p.replace(/^\.\//, '') + ':' + (i + 1) + ' 声称 ' + n + ' ≠ registry ' + regCount + ' ｜ ' + line.trim().slice(0, 80));
      }
    });
  }
}
walk('.');
console.log(results.length ? results.join('\n') : '');
console.error('REG=' + regCount);
" 2>/tmp/guards-reg.log)
TOOL_CLAIM_REG=$(grep -oE 'REG=[0-9]+' /tmp/guards-reg.log 2>/dev/null | grep -oE '[0-9]+' || true)
TOOL_CLAIM_REG=${TOOL_CLAIM_REG:-0}
if [ "$TOOL_CLAIM_REG" -eq 0 ]; then
  ASSERTS=$((ASSERTS + 1)); echo "  ❌ registry 实数提取失败——对账无法进行（检查 tool-registry.ts 路径）"
  ERRORS=$((ERRORS + 1))
elif [ -z "$TOOL_CLAIM_SCAN" ]; then
  ASSERTS=$((ASSERTS + 1)); echo "  ✓ 全仓「N 个 tool(s)」声称与 registry（${TOOL_CLAIM_REG}）全部一致"
else
  ASSERTS=$((ASSERTS + 1)); echo "  ❌ 全仓工具数声称漂移："
  echo "$TOOL_CLAIM_SCAN" | sed 's/^/    /'
  ERRORS=$((ERRORS + $(echo "$TOOL_CLAIM_SCAN" | wc -l | tr -d ' ')))
fi
rm -f /tmp/guards-reg.log

echo ""
echo "=== 13b. 声称限定词反向断言（v1.4.4 D-2 · 「能力交付」级措辞必须带「接线未启用」限定）==="
# 门禁目的：§13 正向断言防「文档虚报已交付、代码零接线」；本节反向断言防对称面——
#   历史版本行声称某「能力交付」但实际接线未启用时，若限定词被删掉，读者会把「能力」
#   误读为「全量交付」（v1.4.4 审查实证：CHANGELOG/ARCHITECTURE 的 v1.3.8 行曾无此限定，
#   与 SECURITY「接线未启用」直接冲突且正向断言天然盲绿）。
# 规则：凡被查文档出现「能力交付」字面 + 同行不含「接线未启用」限定词 → FAIL。
#   grep -F 锚定字面量组合判定，避免正则复杂化；v1.4.7 真接线时本节随 §13 同步改
#   （接线完成后「能力交付」措辞应升级为「已交付」，届时本节条目同步移除）。
# 状态：静态加密 daemon 接线已于 v1.4.7 落地（daemon start 调 initDataEncryption，
#   v1.3.8 行措辞已升级「daemon 接线 v1.4.7 收口」）——条目移除，断言关闭。
# 若未来出现新的「能力交付级」声称，按同款模式登记条目 + 限定词断言。
REVERSE_FAIL=0
REVERSE_CLAIMS=()
# 空数组守卫（set -u 下空数组展开 unbound）——当前无登记条目时直接零通过
if [ "${#REVERSE_CLAIMS[@]}" -gt 0 ]; then
for rclaim in "${REVERSE_CLAIMS[@]}"; do
  r_file="${rclaim%%|*}"; r_rest="${rclaim#*|}"
  r_lit="${r_rest%%|*}"; r_desc="${r_rest#*|}"
  # 命中「静态加密」且不含「接线未启用」的行（排除含「能力已实现，接线未启用」的合规表述——该表述本身含限定词）
  bad_lines=$(grep -n "$r_lit" "$r_file" 2>/dev/null | grep -cv "接线未启用" || true)
  bad_lines=${bad_lines:-0}
  if [ "$bad_lines" -gt 0 ]; then
    ASSERTS=$((ASSERTS + 1)); echo "  ❌ [${r_desc}] ${r_file} 存在「${r_lit}」且同行缺「接线未启用」限定的行 ×${bad_lines}——能力级声称必须带限定词（见 SECURITY 口径）"
    grep -n "$r_lit" "$r_file" 2>/dev/null | grep -v "接线未启用" | sed 's/^/    /' | head -5
    REVERSE_FAIL=$((REVERSE_FAIL + 1))
  else
    ASSERTS=$((ASSERTS + 1)); echo "  ✓ [${r_desc}] ${r_file} 全部「${r_lit}」声称均带「接线未启用」限定（与 SECURITY 口径一致）"
  fi
done
fi
if [ "$REVERSE_FAIL" -gt 0 ]; then
  ERRORS=$((ERRORS + REVERSE_FAIL))
fi

echo ""

# ── 16. 过期承诺限时检查（「将在 vX.Y.Z 移除」到期盯防 · v1.4.4 第七章·八）──
# 门禁目的：弃用 shim 的移除承诺只活在注释里，到期无人盯防即静默过期
#   （v1.4.4 第六章 TODO(v1.4.0) 拖两版本才收口是同款事故）。
# 规则：扫 engine/ 源码（不含 dist/）的「将在 vX.Y.Z 移除」承诺，解析承诺版本；
#   承诺版本 ≤ 当前版本 → 到期告警（承诺该兑现了）；承诺版本 > 当前版本 → ✓ 未到期。
#   「已按计划移除」（grep 不再命中）自然不进本节视野——本节只盯「承诺仍在且已到期」。
echo "=== 16. 过期承诺限时检查（「将在 vX.Y.Z 移除」到期盯防）==="
CURRENT_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")
STALE_PROMISES=$(grep -rn "将在 v[0-9.]* 移除" engine/ --include="*.ts" 2>/dev/null | grep -v "/dist/" || true)
STALE_FAIL=0
if [ -n "$STALE_PROMISES" ]; then
  while IFS= read -r line; do
    # 抓「将在 vX.Y.Z 移除」紧贴的承诺版本（而非行内首个 vX.Y.Z——那可能是
    # 「v1.0.8 已弃用的子命令」这类弃用起始版本的历史陈述）
    PROMISED=$(echo "$line" | grep -oE "将在 v[0-9]+\.[0-9]+\.[0-9]+ 移除" | grep -oE "[0-9]+\.[0-9]+\.[0-9]+" | head -1)
    if [ -z "$PROMISED" ]; then continue; fi
    # 版本比较：承诺 ≤ 当前 → 到期
    EXPIRED=$(node -e "
const cur = '${CURRENT_VERSION}'.split('.').map(Number);
const pro = '${PROMISED}'.split('.').map(Number);
for (let i = 0; i < 3; i++) {
  const c = cur[i] || 0, p = pro[i] || 0;
  if (p < c) { console.log('EXPIRED'); process.exit(0); }
  if (p > c) { process.exit(0); }
}
console.log('EXPIRED'); // 相等 = 到期
" 2>/dev/null || echo "")
    LOC=$(echo "$line" | cut -d: -f1-2)
    if [ "$EXPIRED" = "EXPIRED" ]; then
      ASSERTS=$((ASSERTS + 1)); echo "  ❌ [到期] ${LOC} 承诺 v${PROMISED} 移除（当前 v${CURRENT_VERSION}）——shim 仍在，兑现移除或改承诺"
      STALE_FAIL=$((STALE_FAIL + 1))
    else
      ASSERTS=$((ASSERTS + 1)); echo "  ✓ [未到期] ${LOC} 承诺 v${PROMISED} 移除（当前 v${CURRENT_VERSION}）"
    fi
  done <<EOF
$STALE_PROMISES
EOF
else
  ASSERTS=$((ASSERTS + 1)); echo "  ✓ engine/ 源码无「将在 vX.Y.Z 移除」承诺（无可盯防对象）"
fi
if [ "$STALE_FAIL" -gt 0 ]; then
  ERRORS=$((ERRORS + STALE_FAIL))
fi

echo ""

# ── 17. API.md 工具数对账（防文档-代码漂移）──
echo "=== 17. API.md 工具数对账（文档 tool 数 == registry 实数）==="
REGISTRY_COUNT=$(grep -c "name: '" engine/mcp/src/tool-registry.ts || true)
API_COUNT=$(grep -c '^| `' docs/API.md || true)
if [ "$REGISTRY_COUNT" = "$API_COUNT" ]; then
  ASSERTS=$((ASSERTS + 1)); echo "  ✓ docs/API.md：${API_COUNT} 个 tool 与 registry（${REGISTRY_COUNT}）一致"
else
  ASSERTS=$((ASSERTS + 1)); echo "  ❌ docs/API.md 工具数漂移：文档 ${API_COUNT} ≠ registry ${REGISTRY_COUNT}——跑 node tools/gen/gen-api-tools.mjs 重生成"
  ERRORS=$((ERRORS + 1))
fi

# ── 18. 知识库旧路径残留断言（v1.4.9 P1-14）──
# 门禁目的：v1.2.1「数据目录重构」把知识库从 `.sofagent/knowledge/` 迁到
#   `data/knowledge/`（真值 SSOT = engine/core/src/data-paths.ts 的 resolveKnowledgeDir），
#   但收口漏网——多处引擎代码仍按旧路径手拼字符串 ⇒ 生产恒读不到真实知识库，
#   knowledge 系巡检长期静默哑火（「机制在跑、结果永远 info」）。本步把「旧路径零残留」
#   从人工记忆升级为可执行约束。
# 🔴 双形态覆盖：旧路径有**连写**（`.sofagent/knowledge`）与**分离**
#   （`join(dir, '.sofagent', 'knowledge')`）两种书写；只查第一种就是本仓反复出现的
#   「语义盲区」缺陷（P1-14 实测：分离形态漏 12 处）。本断言两种同面覆盖。
# 🔴 扫描面 = `git ls-files`（tracked 文件）——`.sofagent/`（含 .git-shadow 快照）与
#   `.workbuddy/` 是 git-ignored 的本地产物，不是仓库内容；以工作区遍历会把快照里的
#   历史文本读成活区命中（实测单 snapshots.json 产生 32 处噪声）。
# 🔴 判定面分两面（口径详见该脚本头部）：
#   · Face 1 非注释面（活代码路径构造 + 活文档用户可见路径）→ 集合须与豁免台账
#     tools/check/knowledge-legacy-path-exempt.json 逐文件逐计数**相等**（增/减/漂移皆红）。
#   · Face 2 注释面（源码里引述旧路径的历史沿革说明）→ **可见但不阻塞**（逐条打印）。
#   · 历史冻结区 docs/changelog、docs/archive、evidence → 豁免（历史事实，改之=篡改）。
# 退出码：0 = 绿（可含可见 SKIP）/ 1 = 未登记命中或台账漂移 / 2 = 检查器失明
#   （tracked 面为空或 SSOT 缺失 ⇒ 拒绝把「读不到」当成「零违规」）。
echo ""
echo "=== 18. 知识库旧路径残留断言（v1.4.9 P1-14 · 连写 + 分离双形态）==="
KLP_OUTPUT=$(node tools/check/check-legacy-knowledge-path.mjs 2>&1); KLP_RC=$?
if [ "$KLP_RC" -eq 0 ]; then
  ASSERTS=$((ASSERTS + 1)); echo "  ✓ 知识库旧路径非注释面命中与豁免台账一致"
  printf '%s\n' "$KLP_OUTPUT" | sed 's/^/    /'
else
  ASSERTS=$((ASSERTS + 1))
  if [ "$KLP_RC" -eq 2 ]; then
    echo "  ❌ 知识库旧路径检查器失明（exit 2）——扫描面/SSOT 结构缺失，拒绝假绿"
  else
    echo "  ❌ 知识库旧路径残留与豁免台账不一致（exit ${KLP_RC}）"
  fi
  printf '%s\n' "$KLP_OUTPUT" | sed 's/^/    /'
  ERRORS=$((ERRORS + 1))
fi

# ── §19 README 双语「最新能力段」版本 == 根 package.json version（v1.4.9 P1-6 回归锁）──
# 背景（P1-6 根因）：发版 SOP 的「新能力段替换」是**人工步骤**，v1.4.8 发版时被跳过——
#   `git log -S'## v1.4.8' -- README.md README.en.md` 零命中（从未写过），能力段停在
#   v1.4.7 一整版。既有三处守卫都看不到它：§14 只校验**文档头日期**、check-readme-parity
#   只比双语**结构**、§3b 只查「历史段堆叠」——没有任何断言看「能力段版本有没有跟上 SSOT」
#   ⇒ 第三个盲区（P1-6「零露出」）。
# 判据：README.md / README.en.md 中**最后一个** `## vN.N.N` 标题的版本号 == 根
#   package.json 的 version（SSOT）。双语各判一次（一侧漏改即红）。
# 发版窗口白名单（对齐 check-version §26「待发版窗口态」先例）：当能力段版本 ≠ SSOT，但
#   **同时**满足「该版本在 ROADMAP 迭代表中标 📋 规划中」**且**「对应开发日志
#   docs/changelog/vX.Y/vX.Y.Z.md 已存在」时，判为待发版窗口（能力段按下一版预写），
#   打印可见 ⏏️ 行放行。两条必须同时成立——单条件不放行，禁止用白名单洗白真漂移。
# 声称提取为空（文件里没有 `## vN.N.N` 标题）⇒ FAIL：守卫空转比没有守卫更危险。
echo ""
echo "=== 19. README 双语「最新能力段」版本 == 根 package.json version（v1.4.9 P1-6）==="
PJ_VERSION=$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "")
if [ -z "$PJ_VERSION" ]; then
  ASSERTS=$((ASSERTS + 1))
  echo "  ❌ 根 package.json 版本读取失败——能力段版本对账失明（拒绝假绿）"
  ERRORS=$((ERRORS + 1))
else
  for _rd in README.md README.en.md; do
    _rd_v=$(grep -oE '^## v[0-9]+\.[0-9]+\.[0-9]+' "$_rd" 2>/dev/null | tail -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || true)
    ASSERTS=$((ASSERTS + 1))
    if [ -z "$_rd_v" ]; then
      echo "  ❌ ${_rd} 未找到「## vN.N.N」最新能力段标题——声称缺失（措辞漂移或段被删），判 FAIL"
      ERRORS=$((ERRORS + 1))
    elif [ "$_rd_v" = "$PJ_VERSION" ]; then
      echo "  ✓ ${_rd} 最新能力段 v${_rd_v} = 根 package.json ${PJ_VERSION}"
    else
      # 待发版窗口白名单：两条同时成立才放行
      _rd_mm=$(echo "$_rd_v" | cut -d. -f1-2)
      # 状态列可能带粗体包裹（翻牌态 **✅ 开发完成（⏳ 待发版）**）——\*\* 可选前缀，防粗体形态漏配
      _win_roadmap=$(grep -cE "^\| \*\*v${_rd_v}\*\* \| (📋 规划中|✅ 开发完成|\*\*(📋 规划中|✅ 开发完成))" docs/ROADMAP.md 2>/dev/null || true)
      _win_devlog=0
      [ -f "docs/changelog/v${_rd_mm}/v${_rd_v}.md" ] && _win_devlog=1
      if [ "${_win_roadmap:-0}" -ge 1 ] && [ "$_win_devlog" -eq 1 ]; then
        SKIPS=$((SKIPS + 1))
        echo "  ⏏️ ${_rd} 最新能力段 v${_rd_v} ≠ SSOT ${PJ_VERSION}——待发版窗口（ROADMAP 标 📋 规划中 + 开发日志已存在），按预写放行"
      else
        echo "  ❌ ${_rd} 最新能力段 v${_rd_v} ≠ 根 package.json ${PJ_VERSION}（SSOT）——能力段未跟上版本（发版 SOP 的「新能力段替换」人工步骤漏做）"
        ERRORS=$((ERRORS + 1))
      fi
    fi
  done
fi

# ── 20. ARCHITECTURE 五域分桶自洽（v1.4.9 P2-17）──
# 门禁目的：ARCHITECTURE 的「MCP 工具五域一环」图题声称 N tools，五域 subgraph 题号之和
#   应当 = N = registry 实数。
# 改前实测（本项修复的现场）：图题**95**，而五域题号为 16/15/17/17/15 之和 **80**（差 15），
#   且子项「后训模块 ×8」与实数 `train_*` = **12** 不符 —— 即该图是个「看起来在报数、
#   实际三处互不相等」的自洽幻觉，而**没有任何门禁在看它**（与 G 系列同款：
#   声明的数 ⊆ 实际的数，差集无人可见）。
# 🔴 守卫空转防护（G-1 纪律，本段的重点）：域题号提取数为 0 或图题数字提取为空 ⇒ 判红，
#   不许把「读不到」当成「自洽」——否则本轮重算完，下轮改坏图题仍会静默通过。
echo ""
echo "=== 20. ARCHITECTURE 五域分桶自洽（v1.4.9 P2-17）==="
_arch_file="docs/ARCHITECTURE.md"
_arch_domains=$(sed -n '/^```mermaid/,/^```$/p' "$_arch_file" 2>/dev/null \
  | grep -o 'subgraph D[0-9]\["[^"]*' | grep -o '（[0-9]\+）' | tr -dc '0-9\n' || true)
_arch_domain_n=$(printf '%s\n' "$_arch_domains" | grep -c '[0-9]' || true)
_arch_domain_n=${_arch_domain_n:-0}
_arch_sum=0
if [ "$_arch_domain_n" -gt 0 ]; then
  _arch_sum=$(printf '%s\n' "$_arch_domains" | awk '{s+=$1} END {print s+0}')
fi
_arch_title=$(grep -o 'MCP 工具五域一环（[0-9]\+ tools）' "$_arch_file" 2>/dev/null \
  | grep -o '[0-9]\+' | head -1 || true)
_arch_registry=$(grep -c "name: '" engine/mcp/src/tool-registry.ts 2>/dev/null || true)
_arch_registry=${_arch_registry:-0}
if [ "$_arch_domain_n" -ne 5 ] || [ -z "${_arch_title:-}" ] || [ "$_arch_registry" -eq 0 ]; then
  # 提取面残缺 ⇒ 拒绝假绿（G-1：守卫读不到 ≠ 没问题）
  ASSERTS=$((ASSERTS + 1))
  echo "  ❌ 五域分桶提取残缺：域题号 ${_arch_domain_n} 个（应 5）/ 图题数字「${_arch_title:-空}」/ registry ${_arch_registry}——提取逻辑或图结构已变，拒绝把「读不到」当成「自洽」"
  ERRORS=$((ERRORS + 1))
elif [ "$_arch_sum" = "$_arch_title" ] && [ "$_arch_title" = "$_arch_registry" ]; then
  ASSERTS=$((ASSERTS + 1))
  echo "  ✓ 五域分桶自洽：${_arch_domains//$'\n'/ + } = ${_arch_sum} = 图题 ${_arch_title} = registry ${_arch_registry}"
else
  ASSERTS=$((ASSERTS + 1))
  echo "  ❌ 五域分桶失谐：域和 ${_arch_sum} ≠ 图题 ${_arch_title} ≠ registry ${_arch_registry}——改了工具面请同批重算五域题号（分桶依据见 ARCHITECTURE 图下「数字口径」注）"
  ERRORS=$((ERRORS + 1))
fi


# ── 20b. 五域**域内子项**自洽（§20 只校验五域之和；域内子项失谐同样抓不住）──
# 病根：曾出现「域题号之和 = registry = 95」通过，但某域的子项 ×N 之和 ≠ 该域题号
#   （实测 D5 题号 16 而子项 5+3+6=14）——§20 的口径看不见这类失谐，故补本断言。
# 判定：逐域解析该域体内「×N」并求和，须 == 域题号；域数≠5 或某域零子项 ⇒ FAIL（守卫空转防御）。
_arch_break=$(node -e '
const fs=require("fs");
const s=fs.readFileSync("docs/ARCHITECTURE.md","utf8");
const i=s.indexOf("subgraph D1"), j=s.indexOf("```", i);
if(i<0||j<0){console.log("EXTRACT_FAIL");process.exit(0);}
const seg=s.slice(i,j);
const doms=[...seg.matchAll(/subgraph D(\d)\["[^"]*?（(\d+)）/g)].map(m=>({d:+m[1],n:+m[2]}));
if(doms.length!==5){console.log("EXTRACT_FAIL");process.exit(0);}
const bad=[];
for(const d of doms){
  const st=seg.indexOf("subgraph D"+d.d), en=seg.indexOf("subgraph D"+(d.d+1));
  const body=seg.slice(st, en>0?en:seg.length);
  const subs=[...body.matchAll(/×(\d+)/g)].map(m=>+m[1]);
  if(subs.length===0){console.log("EXTRACT_FAIL");process.exit(0);}
  const sum=subs.reduce((a,b)=>a+b,0);
  if(sum!==d.n) bad.push("D"+d.d+" 题号 "+d.n+" ≠ 子项和 "+sum+"（"+subs.join("+")+"）");
}
console.log(bad.length? ("BAD="+bad.join(" | ")) : "OK");
' 2>/dev/null || true)
case "$_arch_break" in
  OK) ASSERTS=$((ASSERTS + 1)); echo "  ✓ 五域域内子项自洽：每域「×N」之和 == 该域题号" ;;
  EXTRACT_FAIL|"") ASSERTS=$((ASSERTS + 1)); echo "  ❌ 五域域内子项提取残缺——拒绝把「读不到」当成「自洽」"; ERRORS=$((ERRORS + 1)) ;;
  BAD=*) ASSERTS=$((ASSERTS + 1)); echo "  ❌ 五域域内失谐：${_arch_break#BAD=}"; ERRORS=$((ERRORS + 1)) ;;
esac

# ── 21. 文档视角数声称自洽（v1.4.9 收口 · 防「N 视角」口径漂移）──
echo "=== 21. 文档视角数声称自洽（声称 ∈ {常规发版, 全量基线}）==="
# 门禁目的：公开文档对 fresh-eyes 视角数的声称，曾出现既非「常规发版」也非「全量基线」的
#   中间态数字（16）——读者无从判断该信哪个。本步把「声称 ∈ 两个合法口径」从人工记忆
#   升级为可执行约束。
# 🔴 两个口径**动态提取**，禁写死（维度脚本铁律 2——写死计数必随版本演进漂）：
#   FE_TOTAL   = playbook/fresh-eyes-review.md 的真视角标题数（「### …视角N [n]：」形态）
#   FE_REGULAR = 同文件分层表的「常规发版（1-N）」
# 🔴 扫描面口径：只判**同时含 `fresh-eyes` 与「N 视角」**的行——不含 fresh-eyes 的
#   「N 视角」是别的东西（如 Dashboard 面板数），纳入即成假阳性。
# 🔴 守卫空转防御（本仓反复出现的缺陷形态）：口径任一提取为空、或全仓零条声称被读到
#   ⇒ FAIL——「读不到」不等于「零违规」，静默通过比没有这道守卫更危险。
FE_TOTAL=$(grep -cE '^### .*视角[一二三四五六七八九十]+ \[' playbook/fresh-eyes-review.md 2>/dev/null || true)
FE_REGULAR=$(grep -oE '常规发版（1-[0-9]+）' playbook/fresh-eyes-review.md 2>/dev/null | head -1 | sed -E 's/.*1-([0-9]+).*/\1/' || true)
FE_RAW=$(node -e '
const fs=require("fs"),cp=require("child_process");
const total=process.argv[1], regular=process.argv[2];
let files=[];
try{ files=cp.execSync("git ls-files \"*.md\"").toString().trim().split("\n"); }catch(e){ console.log("SCAN_FAIL"); process.exit(0); }
files=files.filter(f=>f && (/^[^\/]+\.md$/.test(f) || /^docs\//.test(f)) && !/^(docs\/(changelog|archive|evidence)\/|CONTRIBUTING\.md$)/.test(f));
let claims=0; const viol=[];
for(const f of files){
  let inf=false;
  for(const [i,l] of fs.readFileSync(f,"utf8").split("\n").entries()){
    if(/^\s*```/.test(l)){inf=!inf;continue;} if(inf)continue;
    if(!/fresh-eyes/.test(l))continue;
    for(const m of (l.match(/(\d+)\s*视角/g)||[])){
      const n=m.match(/[0-9]+/)[0]; claims++;
      if(n!==total && n!==regular) viol.push(f+":"+(i+1)+" 声称 "+n+" 视角");
    }
  }
}
console.log("CLAIMS="+claims); viol.forEach(v=>console.log("VIOL="+v));
' "$FE_TOTAL" "$FE_REGULAR" 2>/dev/null || true)
FE_N=$(printf '%s\n' "$FE_RAW" | sed -n 's/^CLAIMS=//p')
FE_VIOL=$(printf '%s\n' "$FE_RAW" | sed -n 's/^VIOL=//p')
if [ -z "$FE_TOTAL" ] || [ -z "$FE_REGULAR" ] || [ -z "$FE_N" ]; then
  ASSERTS=$((ASSERTS + 1)); echo "  ❌ §21 口径基线/扫描提取失败（TOTAL='${FE_TOTAL}' REGULAR='${FE_REGULAR}'）——守卫空转，拒绝静默通过"
  ERRORS=$((ERRORS + 1))
elif [ "$FE_N" -eq 0 ]; then
  ASSERTS=$((ASSERTS + 1)); echo "  ❌ §21 扫描面失效：全仓零条 fresh-eyes 视角声称被读到——守卫空转，拒绝静默通过"
  ERRORS=$((ERRORS + 1))
elif [ -n "$FE_VIOL" ]; then
  ASSERTS=$((ASSERTS + 1)); echo "  ❌ §21 视角数口径漂移（合法口径仅：常规 ${FE_REGULAR} / 全量 ${FE_TOTAL}）——"
  printf '%s\n' "$FE_VIOL" | sed 's/^/     /'
  ERRORS=$((ERRORS + 1))
else
  ASSERTS=$((ASSERTS + 1)); echo "  ✓ §21 全仓 ${FE_N} 条 fresh-eyes 视角声称，均 ∈ {常规 ${FE_REGULAR}, 全量 ${FE_TOTAL}}"
fi

if [ "$ERRORS" -gt 0 ]; then
  echo "发现 ${ERRORS} 个问题"
else
  echo "全部通过"
fi

# ── 覆盖度行（v1.4.9 G-2② · 范式见 tools/check/lib/coverage-line.sh）──
# covered 口径：仓内 tracked `.md` 文件数（本脚本的文档扫描面；不含 node_modules——非 tracked）。
# 🔴 skipped > 0 不阻断退出码（合法跳过由发版 SOP「SKIP 数逐条裁决」步骤裁定），但必须打印。
COVERED=$(git ls-files '*.md' 2>/dev/null | wc -l | tr -d ' ')
COVERED=${COVERED:-0}
emit_coverage_line "check-docs" "${ASSERTS}" "${COVERED}" "${SKIPS}"

if [ "$ERRORS" -gt 0 ]; then
  exit 1
else
  exit 0
fi
