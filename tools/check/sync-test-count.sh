#!/usr/bin/env bash
# sync-test-count.sh · 测试数五文档一键同步（v1.4.3 复核轮交付）
#
# 用法：
#   bash tools/check/sync-test-count.sh            # 同步模式：实跑计数并更新文档
#   bash tools/check/sync-test-count.sh --dry-run  # 预览模式：只显示将要做的改动
#
# 背景：测试数硬编码在多处文档（README 双语 / LIMITATIONS / WIKI 等，
#       以 check-test-count.sh 实际校验处为准）。多 session 并行加测试时，
#       漏同步任一处 → check-test-count 门禁红。本脚本把「手动修多处」
#       变成「跑一条命令」。
#
# 退出码：0 = 同步成功（或本已一致无改动）/ 1 = 取数失败或门禁复验未过
#
# 纪律（与 test-count.sh 一致）：
#   - 本脚本只改「文档声称值」，不改任何测试代码；
#   - 同步后自动跑 check-test-count.sh 复验，红了即失败（不产出半同步态）；
#   - 历史冻结快照（v1.2.x changelog 等）不是同步目标——门禁对它们只做
#     内部自洽校验，不做当前值比对；
#   - 谁加测试谁同步（归属原则）：并发 session 收尾前慎跑同步模式，
#     以免把在途改动固化成中间值——优先 --dry-run 预览。

set -euo pipefail

DRY_RUN=0
TOTAL=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) echo "未知参数: $arg （支持 --dry-run）"; exit 1 ;;
  esac
done

echo "═══ sync-test-count · 测试数文档同步 ═══"
if [ "$DRY_RUN" = "1" ]; then echo "（预览模式——只显示差异，不落盘）"; fi

# ── 一、取实际数（单一事实源 = test-count.sh 实跑，不做本地重算）──────────
echo "→ 实跑 tools/check/test-count.sh 获取实际数..."
TC_OUT=$(bash tools/check/test-count.sh 2>/dev/null | tail -30 || true)
TOTAL=$(printf '%s' "$TC_OUT" | grep -oE 'TOTAL_TESTS=[0-9]+' | head -1 | cut -d= -f2 || true)

if [ -z "$TOTAL" ] || [ "$TOTAL" = "0" ]; then
  echo "❌ 未取到有效 TOTAL_TESTS（空或 0）——test-count.sh 输出异常，中止（保守失败，不猜数）"
  exit 1
fi
echo "  实际 workspace 总数 = $TOTAL"

# ── 二、逐文档同步（node 承担正则替换——JS 正则与 sed 转义双重易碎，统一到单实现）──
# 替换策略（行级护栏，防误伤无关数字）：
#   仅处理同时满足「含 测试/tests + 含 3-4 位数字」的行，且只把
#   「数字 紧跟 测试/tests」的声称值改为实际值；行内其他数字不动。
sync_one() {
  node - "$1" "$2" "$TOTAL" "$DRY_RUN" <<'NODEEOF'
const fs = require('fs');
const [file, desc, total, dry] = process.argv.slice(2);
if (!fs.existsSync(file)) { console.log(`  ⏭️ ${desc}：文件不存在，跳过`); process.exit(0); }
const before = fs.readFileSync(file, 'utf8');
const lines = before.split('\n');
let hits = 0;
for (let i = 0; i < lines.length; i++) {
  const L = lines[i];
  // 行级护栏：必须是「数字+测试/tests」声称形态（覆盖中英文），否则跳过
  if (!/[0-9]{3,4}[ \t]*(测试|tests)/.test(L)) continue;
  const updated = L.replace(/([0-9]{3,4})(?=[ \t]*(测试|tests))/g, (m, num) =>
    num === total ? m : total);
  if (updated !== L) { lines[i] = updated; hits++; }
}
if (hits === 0) { console.log(`  ✓ ${desc}：本已一致（或无可匹配行），无改动`); process.exit(0); }
const label = dry === '1' ? '🔍' : '✏️';
console.log(`  ${label} ${desc}：${hits} 行声称值 → ${total}${dry === '1' ? '（预览未落盘）' : ''}`);
if (dry !== '1') fs.writeFileSync(file, lines.join('\n'));
NODEEOF
}

sync_one "README.md"            "README.md（工程可信度行）"
sync_one "README.en.md"         "README.en.md（Engineering credibility 行）"
sync_one "docs/LIMITATIONS.md"  "LIMITATIONS.md（workspace/audit 声称行）"
sync_one "docs/WIKI.md"         "WIKI.md（测试覆盖行）"

# ── 三、复验（同步后必须门禁绿，否则声明失败）────────────────────────────
if [ "$DRY_RUN" = "1" ]; then
  echo "→ 预览模式跳过落盘与复验（本次未改任何文件）"
  echo "═══ 预览完成 ═══"
  exit 0
fi
echo "→ 复验 check-test-count.sh ..."
if bash tools/check/check-test-count.sh > /tmp/sync-tc-verify.log 2>&1; then
  echo "✅ 复验通过：15 处校验全绿"
  echo "═══ 完成：门禁绿 ═══"
  exit 0
else
  echo "❌ 复验未过——详见 /tmp/sync-tc-verify.log"
  echo "   保守处置：git diff 检查误替换行，git checkout -- <file> 还原后手查"
  exit 1
fi
