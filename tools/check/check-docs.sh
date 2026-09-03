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

cd "$(dirname "$0")/../.." || exit 1

# v1.3.6 B11: 并发防护——mkdir 原子锁（macOS/Linux 兼容）。已有实例运行时第二个实例
# 报错退出，防止双实例互相覆盖日志（审查期间曾实测发现双残留实例）。
LOCK_DIR="/tmp/check-docs.lock"
if mkdir "${LOCK_DIR}" 2>/dev/null; then
  trap 'rmdir "${LOCK_DIR}" 2>/dev/null || true' EXIT
else
  echo "[ERROR] check-docs.sh already running (lock ${LOCK_DIR}) - wait for previous instance"
  exit 2
fi

ERRORS=0

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
  echo "  ❌ 死链扫描器自身故障（node 输出不可解析）——结果不可信，按失败处理"
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
# "4 底线" "7 铁律" 是当前正确结构，不算过时
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
  echo "  ❌ 活文档残留旧四能力表述 ${CAP5_COUNT} 处（现行口径：注入·审计·回溯·沉淀·进化）"
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
  echo "  ❌ 活文档存在 U+FFFD（编码损坏）${FFFD_COUNT} 行"
  printf "%s\n" "$FFFD_HITS" | grep "." | head -20
  ERRORS=$((ERRORS + 1))
else
  echo "=== 2b. U+FFFD 扫描：活文档零命中 ✓ ==="
fi

# 2c. 商业名脱敏断言（开源脱敏规范——GrapHub/FlowHub 全词匹配 FAIL；
#     AIR 不进断言：三字母大写英文语境误报率不可控，维持人工自查）
LEAK_HITS=$(grep -nwE "GrapHub|FlowHub" README.md README.en.md docs/*.md docs/guides/*.md SKILL/SKILL.md SKILL/rules/*.md FDE/GUIDE.md engine/hooks/*/HOOK.md engine/openclaw-plugins/*/README.md install.sh tools/dashboard/dashboard.html 2>/dev/null || true)
if [ -n "$LEAK_HITS" ]; then
  echo "  ❌ 活文档存在商业产品名（GrapHub/FlowHub）——开源脱敏规范违规"
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
  # fallback：ROADMAP 迭代表第一个「📋 规划中」行（| **vX.Y.Z** | 📋 规划中 |）
  ROADMAP_NEXT_V=$(grep -m1 -E '^\| \*\*v[0-9]+\.[0-9]+\.[0-9]+\*\* \| 📋 规划中' docs/ROADMAP.md 2>/dev/null | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1)
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
  echo "  ✓ WIKI 状态表「下一版」$WIKI_NEXT_V 与 ROADMAP 一致"
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
  echo "  ✓ 活文档无历史版本新能力段堆叠（新能力段只留最新版）"
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
# 排除：B/C/D/E 层目录 + 公共排除
# v1.3.9+ 分层修正（2026-08-22）：engine/*/README.md + tools/README.md 是包级开发者文档，
# 从 A 层（用户文档）移出——由 F 软检查（只提示不阻断）约束，不再占用户文档预算
LAYER_A=$(find . -name "*.md" \
  -not -path "*/node_modules/*" \
  -not -path "*/.workbuddy/*" \
  -not -path "*/.sofagent/*" \
  -not -path "*/docs/changelog/*" \
  -not -path "*/docs/evidence/*" \
  -not -path "*/SKILL/*" \
  -not -path "*/FDE/*" \
  -not -path "*/FORGE/*" \
  -not -path "*/docs/guides/*" \
  -not -path "*/docs/architecture/*" \
  -not -path "*/docs/prd/*" \
  -not -path "*/agents/*" \
  -not -path "*/.github/*" \
  -not -path "*/engine/hooks/*" \
  -not -path "*/commercial/*" \
  -not -path "*/docs/DEVELOPMENT.md" \
  -not -path "*/docs/archive/*" \
  -not -path "*/data/*" \
  -not -path "*/engine/*/README.md" \
  -not -path "*/tools/README.md" \
  -print0 2>/dev/null | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1+0}')
LAYER_A=${LAYER_A:-0}

# B 层：开发者参考（FORGE/ + agents/ + .github/ + hooks/HOOK.md + DEVELOPMENT.md）
# v1.2.1: 排除 fresh-eyes runs/ 运行时产物（check/findings/result.md 是审查轮输出，
# 已被 .gitignore 忽略，不是开发者参考文档——不计入文档预算）
# v1.2.1: 排除 data/forge-runs/（同属审查轮运行时产物，数据重构后从 .sofagent/ 迁来）
# v1.3.9+ 分层修正（2026-08-22）：FORGE/lessons/ 是内部经验沉淀（每轮审查持续增长，
# 设硬上限不合理）——移出 B 层预算，由 F 软检查（只提示不阻断）触发定期整理
LAYER_B=$(find ./FORGE ./agents ./.github ./engine/hooks ./docs/DEVELOPMENT.md \
  -name "*.md" \
  -not -path "*/node_modules/*" \
  -not -path "*/fresh-eyes-loop/runs/*" \
  -not -path "*/FORGE/lessons/*" \
  -print0 2>/dev/null | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1+0}')
LAYER_B=${LAYER_B:-0}

# C 层：审查体系（FORGE/playbook/，原 FORGE/releaser/ 已拆散）
LAYER_C=$(find ./FORGE/SKILL/fresh-eyes-loop/specs -name "*.md" -print0 2>/dev/null | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1+0}')
LAYER_C=${LAYER_C:-0}

# D 层：设计文档（docs/architecture/ + docs/prd/）
# 注：部分子目录可能暂不存在，find 会报错但 stderr 已抑制；用 `{ ...; } 2>/dev/null || true` 防止 pipefail 传播
LAYER_D=$({ find ./docs/architecture ./docs/prd -name "*.md" -print0 2>/dev/null | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1+0}'; } || true)
LAYER_D=${LAYER_D:-0}

# E 层：运维指南（docs/guides/）
LAYER_E=$(find ./docs/guides -name "*.md" -print0 2>/dev/null | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1+0}')
LAYER_E=${LAYER_E:-0}

# 上限定义
LIMIT_A=7000  # v1.3.9 行业笔记落盘（6936>6900+36：VALIDATION 新增 4 节——947 测量者转型/红杉专家判断力工程化/Palantir Red Loop+KLMLoop Engineering 四层循环，均系行业印证真实内容；按铁律超标上调不删内容）  # v1.3.9 bugfix 67 项文档批：A 层 6761>6650 正当上调——诚实边界声明（task/logs 明文+单机单用户定位）/术语表 4 条/导读句/论证表等均系独立审查修复要求新增，非冗余；此前 v1.3.8 轮询语义修正 6642>6600 上调至 6650
LIMIT_B=9500  # v1.3.9 发版后审查批（9434>9400+34：2026-08-22 审查轮新增——VALIDATION 行业笔记 4 节/PHILOSOPHY 拆章节/v1.4.0 排期 4 件收口（MLflow+Browser+联邦E2E+bash3.2）117 行/6+1 文档优化/WIKI 规划目录说明；按铁律超标上调不删内容）；此前 9400（9269>9220+49：A/B/C/D/E 文档批新增 79 行——meta-harness 19/MLflow 13/agentic-browser 18/tools 分目录 22/SKILL.md 工具表+1/banner 重生成说明+6；按铁律超标上调不删内容） ⚠️ 三项修复：checklist 49/94/101 注释 +9 行（run-06 零信任复验——dim49 环境误报标注/dim94 人工核对语义/dim101 LIMIT 解析 bug 根因记录，检查器侧修正非删内容）；此前 rules/ 收敛重构 +26→9190；v1.3.9 阶段十一发布前（9363>9300+63：阶段八文档收尾 B 层新增——ROADMAP v1.3.9 迭代表行+现在在哪段+13 行/HANDBOOK v1.3.9 能力 bullet/README 双语新能力段等；铁律超标上调不删内容）
# v1.3.7: B 层 8945（交付⑥⑨测试数对账+memory_sync 文档），铁律上调 8940→8950；v1.3.6: 8901（累计 8880→8910→8940）
LIMIT_C=6300  # v1.1.3: 审查体系维度固化 + Harness 可见性视角 + releasing.md tag 门禁；内容增长上调 5800→6300 + 5% 余量
LIMIT_D=2000  # v1.1.9: D 层纳入口径修正——docs/architecture（v1.1.9 设计 876 行）+ docs/prd（193 行）从 A 层归入 D 层（工程文档与设计文档同语义），700→2000 容纳
LIMIT_E=3900  # v1.2.5: E 层 2905 行（新增 dashboard-html-dev.md 219 行 + enterprise-deploy 扩展），上调 2700→3100 留余量；v1.4.0: multi-device-sync 补远程 API 通道 → 3110>3100，按铁律超标上调不删内容 3100→3200 留余量；v1.4.1: 训练引擎地基新增 train-stack.md（双栈契约）+ train-security.md（安全基线），先压缩旧指南 3327→3252 后仍超 → 2026-08-25 拍板上调 3200→3300（不放宽到 3400）；v1.4.2: ARCHITECTURE §二 FORGE 段 193 行迁入 loop-development.md（E 层 3300→3484）→ 按铁律超标上调不删内容 3300→3600；v1.4.3: 新增 github-pr-playbook.md 157 行（三轮实战 15 条 PR 经验沉淀）+ 四指南微调 → 3725>3600，按铁律超标上调不删内容 3600→3800；v1.4.4: github-pr-playbook 台账扩容（在投 20→29 条 + 坑位 2 条 + 流量基线 5.3.1 + 第七节曝光渠道）→ 3811>3800，按铁律超标上调不删内容 3800→3900
LIMIT_TOTAL=16500  # v1.3.9 发版后审查批（A+B 16423>16400+23 随 B 层上调——2026-08-22 审查轮新增，见 LIMIT_B 记录；铁律超标上调不删内容）  # v1.3.9 行业笔记落盘（A+B 16301>16300+1 随 A 层上调——VALIDATION 新增 4 节；铁律超标上调不删内容）  # v1.3.9 bugfix 67 项文档批：A+B 15968>15860 随 A 层上调（B 层 9207<9220 未超）；此前 v1.3.8 regression 修复连带 15830→15860；v1.3.9 阶段十一发布前（A+B 16208>16200 随 B 层上调——阶段八文档收尾新增，见 LIMIT_B 记录）

# 输出各层
echo "  A 用户文档:     ${LAYER_A} 行 / ${LIMIT_A} 上限"
echo "  B 开发者参考:   ${LAYER_B} 行 / ${LIMIT_B} 上限"
echo "  C 审查体系:     ${LAYER_C} 行 / ${LIMIT_C} 上限"
echo "  D 设计文档:     ${LAYER_D} 行 / ${LIMIT_D} 上限"
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
  echo "  ✓ F-lessons 经验沉淀 ${LESSONS_LINES} 行（≤3000 软警戒，定期整理机制见 index.md）"
fi
if [ "$PKG_README_LINES" -gt 1500 ]; then
  echo "  ⚠️ F-pkg 包级 README 合计 ${PKG_README_LINES} 行 > 1500 软警戒——建议精简"
else
  echo "  ✓ F-pkg 包级 README 合计 ${PKG_README_LINES} 行（≤1500 软警戒）"
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
check_layer "C 审查体系" "$LAYER_C" "$LIMIT_C"
check_layer "D 设计文档" "$LAYER_D" "$LIMIT_D"
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
  echo "  ❌ audit/README ($AUDIT_README_COUNT) ≠ index.ts ($INDEX_TS_COUNT)"
  MISMATCH=$((MISMATCH + 1))
fi
if [ "$MAIN_README_COUNT" != "0" ] && [ "$MAIN_README_COUNT" != "$INDEX_TS_COUNT" ]; then
  echo "  ❌ 主 README ($MAIN_README_COUNT) ≠ index.ts ($INDEX_TS_COUNT)"
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
      echo "  ✓ $doc River 比喻 ${RIVER_COUNT} 处"
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
    echo "  ❌ 底线数不一致: 标题 ${BOTTOM_CLAIMED} vs 实际 ${BOTTOM_ACTUAL}"
    ERRORS=$((ERRORS + 1))
  fi
  if [ "${IRON_CLAIMED:-0}" != "${IRON_ACTUAL}" ] 2>/dev/null; then
    echo "  ❌ 铁律数不一致: 标题 ${IRON_CLAIMED} vs 实际 ${IRON_ACTUAL}"
    ERRORS=$((ERRORS + 1))
  fi
  if [ "${BOTTOM_CLAIMED:-0}" = "${BOTTOM_ACTUAL}" ] && [ "${IRON_CLAIMED:-0}" = "${IRON_ACTUAL}" ] 2>/dev/null; then
    echo "  ✓ 底线/铁律数一致"
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
  echo "  ⏭️ 跳过（SKIP_ANCHOR_SCAN=1）——锚点检查由 check-anchors.mjs 覆盖（pre-push 第 4 步）"
else
  ANCHOR_OUTPUT=$(node tools/check/check-anchors.mjs 2>&1); ANCHOR_RC=$?
  if [ "$ANCHOR_RC" -eq 0 ]; then
    echo "  ✓ 跨文档锚点无死链"
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
  echo "  ✓ 全量表与 registry 一致（${TOOL_TABLE_CHECK#OK } tools）"
elif [ "$TOOL_TABLE_CHECK" = "PATTERN_MISS" ]; then
  echo "  ⚠ AGENTS.md 未找到「MCP 全量工具表」小节，跳过"
else
  echo "  ❌ 全量表与 registry 漂移："
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
#   2026-08-29 首条：静态加密——SECURITY.md 若声称「已交付」，initDataEncryption
#   必须有生产调用（当前降级为「接线未启用」态，声称侧不命中即天然通过；
#   未来 v1.4.7 真接线后若把声称改回「已交付」，本断言自动生效防再虚报）。
#   2026-08-30 次条：AgentShield——双语 README 都当核心能力宣传，createAgentShield 必须有生产调用
#   （v1.3.7 实现 + 有测试但长期零调用点，同批已补 agent-shield CLI 子命令接线）。
WIRING_FAIL=0
WIRING_CLAIMS=(
  "SECURITY.md|静态加密（v1.3.8 交付）|initDataEncryption|静态加密（SECURITY.md:50 声称族）"
  "README.md|AgentShield 五类配置面静态扫描|createAgentShield|AgentShield（README 核心能力声称）"
  "README.en.md|AgentShield five-face static config scanning|createAgentShield|AgentShield（README.en 核心能力声称）"
  "CHANGELOG.md|train compare|submitCompareJobs|多基座对比训练（CHANGELOG v1.4.4 交付④——CLI 接线防断链）"
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
      echo "  ❌ [${claim_desc}] ${claim_file} 命中「${claim_re}」但 ${entry_fn}() 在 engine/ 生产代码零调用——声称与接线断链"
      WIRING_FAIL=$((WIRING_FAIL + 1))
    else
      echo "  ✓ [${claim_desc}] ${entry_fn}() 生产调用 ${call_count} 处（声称与接线一致）"
    fi
  else
    echo "  ⏭️ [${claim_desc}] ${claim_file} 未命中声称「${claim_re}」——断言未触发（天然通过）"
  fi
done
if [ "$WIRING_FAIL" -gt 0 ]; then
  ERRORS=$((ERRORS + WIRING_FAIL))
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
    echo "  ⏭️ $pmf 不存在——跳过"
    continue
  fi
  PM_CLAIMED=$(grep -oE '[0-9]+ 个 tool' "$pmf" 2>/dev/null | head -1 | grep -oE '[0-9]+' || true)
  if [ -z "$PM_CLAIMED" ]; then
    echo "  ❌ $pmf 未找到「N 个 tool」声称——数字门禁盲区（守卫不空转：有挂载描述就该有数字且对账）"
    ERRORS=$((ERRORS + 1))
  elif [ "$PM_CLAIMED" != "$MCP_REG_COUNT" ]; then
    echo "  ❌ ${pmf}：声称 ${PM_CLAIMED} 个 tool ≠ registry 实际 ${MCP_REG_COUNT}"
    ERRORS=$((ERRORS + 1))
  else
    echo "  ✓ ${pmf}：${PM_CLAIMED} 个 tool 与 registry 一致"
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
  echo "  ❌ registry 实数提取失败——对账无法进行（检查 tool-registry.ts 路径）"
  ERRORS=$((ERRORS + 1))
elif [ -z "$TOOL_CLAIM_SCAN" ]; then
  echo "  ✓ 全仓「N 个 tool(s)」声称与 registry（${TOOL_CLAIM_REG}）全部一致"
else
  echo "  ❌ 全仓工具数声称漂移："
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
REVERSE_FAIL=0
REVERSE_CLAIMS=(
  "CHANGELOG.md|静态加密|CHANGELOG v1.3.8 行"
  "docs/ARCHITECTURE.md|静态加密|ARCHITECTURE v1.3.8 行"
)
for rclaim in "${REVERSE_CLAIMS[@]}"; do
  r_file="${rclaim%%|*}"; r_rest="${rclaim#*|}"
  r_lit="${r_rest%%|*}"; r_desc="${r_rest#*|}"
  # 命中「静态加密」且不含「接线未启用」的行（排除含「能力已实现，接线未启用」的合规表述——该表述本身含限定词）
  bad_lines=$(grep -n "$r_lit" "$r_file" 2>/dev/null | grep -cv "接线未启用" || true)
  bad_lines=${bad_lines:-0}
  if [ "$bad_lines" -gt 0 ]; then
    echo "  ❌ [${r_desc}] ${r_file} 存在「${r_lit}」且同行缺「接线未启用」限定的行 ×${bad_lines}——能力级声称必须带限定词（见 SECURITY 口径）"
    grep -n "$r_lit" "$r_file" 2>/dev/null | grep -v "接线未启用" | sed 's/^/    /' | head -5
    REVERSE_FAIL=$((REVERSE_FAIL + 1))
  else
    echo "  ✓ [${r_desc}] ${r_file} 全部「${r_lit}」声称均带「接线未启用」限定（与 SECURITY 口径一致）"
  fi
done
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
      echo "  ❌ [到期] ${LOC} 承诺 v${PROMISED} 移除（当前 v${CURRENT_VERSION}）——shim 仍在，兑现移除或改承诺"
      STALE_FAIL=$((STALE_FAIL + 1))
    else
      echo "  ✓ [未到期] ${LOC} 承诺 v${PROMISED} 移除（当前 v${CURRENT_VERSION}）"
    fi
  done <<EOF
$STALE_PROMISES
EOF
else
  echo "  ✓ engine/ 源码无「将在 vX.Y.Z 移除」承诺（无可盯防对象）"
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
  echo "  ✓ docs/API.md：${API_COUNT} 个 tool 与 registry（${REGISTRY_COUNT}）一致"
else
  echo "  ❌ docs/API.md 工具数漂移：文档 ${API_COUNT} ≠ registry ${REGISTRY_COUNT}——跑 node tools/gen/gen-api-tools.mjs 重生成"
  ERRORS=$((ERRORS + 1))
fi

if [ "$ERRORS" -gt 0 ]; then
  echo "发现 ${ERRORS} 个问题"
  exit 1
else
  echo "全部通过"
  exit 0
fi
