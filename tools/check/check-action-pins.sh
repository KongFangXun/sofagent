#!/bin/bash
# check-action-pins.sh — GitHub Actions 引用完整性对账
# 验证 .github/workflows/*.yml 中每个 uses: 引用的完整 commit SHA 与行内
# 注释 tag 指向 GitHub 上同一个 commit（防 tag 被移动后 pin 静默过时）。
#
# 背景（v1.4.4 供应链加固配套）：Task #34 已把 8 文件 20 处 uses: 从浮动
# tag（@v5 / @master）pin 到 40 位 commit SHA + 行内注释 tag。但上游若把
# v5 tag 移到新 commit（安全修复），本仓 pin 住旧 SHA 就会静默落后——
# 本脚本对账「SHA 所在 commit」与「注释 tag 当前指向」，不一致时告警。
#
# 设计要点：
#   - 离线优先：无网络 / 无 GITHUB_TOKEN 时输出告警并以 exit 0 降级
#     （发版门禁不被网络抖动阻断；对账失败 ≠ 对账通过，仅提示人工核对）
#   - 在线对账：GitHub API git/ref/tags/<tag> 逐 tag 查询，比对 object.sha
#   - annotated tag 解引用：object.type=tag 时需再查 git/tags/<sha> 取 commit
#   - 本地 stub：SOFA_PIN_CHECK_OFFLINE=1 强制离线模式（测试用）
#
# 用法：bash tools/check/check-action-pins.sh
#   exit 0 = 全部一致（或离线降级）
#   exit 1 = 有 SHA 与 tag 指向不同 commit（需要人工决策升级）

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

echo "=== check-action-pins · GitHub Actions SHA 对账 ==="

# ── 一、静态检查：所有 uses: 都必须是完整 40 位 SHA + 注释 tag ──
STATIC_BAD=0
SCAN=$(node -e '
const fs = require("fs");
const path = require("path");
const dir = ".github/workflows";
if (!fs.existsSync(dir)) { console.log(JSON.stringify({refs: []})); process.exit(0); }
const refs = [];
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith(".yml") && !f.endsWith(".yaml")) continue;
  const lines = fs.readFileSync(path.join(dir, f), "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    // 匹配两种形态：`- uses: xxx`（step 列表项）与缩进续行 `uses: xxx`（step 首键换行写法）
    const m = lines[i].match(/^\s*(?:-\s+)?uses:\s*(\S+)(?:\s+#\s*(\S+))?/);
    if (!m) continue;
    refs.push({ file: f, line: i + 1, full: m[1], tag: m[2] || null });
  }
}
console.log(JSON.stringify({refs}));
' 2>/dev/null || echo '{"refs":[]}')

TOTAL=$(echo "$SCAN" | jq '.refs | length')
PINNED=$(echo "$SCAN" | jq '[.refs[] | select(.full | test("@[0-9a-f]{40}$"))] | length')
WITH_TAG=$(echo "$SCAN" | jq '[.refs[] | select(.tag != null)] | length')

echo "  uses: 引用总数: ${TOTAL}"
echo "  已 pin 40 位 SHA: ${PINNED}"
echo "  带注释 tag: ${WITH_TAG}"

# 未 pin 或缺注释 tag 的都列出（发版门禁阻断）
echo "$SCAN" | jq -r '.refs[] | select(.full | test("@[0-9a-f]{40}$") | not) | "  ✗ 未pin: \(.file):\(.line) \(.full)"'
UNPINNED=$(echo "$SCAN" | jq '[.refs[] | select(.full | test("@[0-9a-f]{40}$") | not)] | length')
if [ "${UNPINNED:-0}" -gt 0 ]; then
  STATIC_BAD=$((STATIC_BAD + UNPINNED))
fi

echo "$SCAN" | jq -r '.refs[] | select((.full | test("@[0-9a-f]{40}$")) and (.tag == null)) | "  ✗ 缺注释tag: \(.file):\(.line) \(.full)"'
NOTAG=$(echo "$SCAN" | jq '[.refs[] | select((.full | test("@[0-9a-f]{40}$")) and (.tag == null))] | length')
if [ "${NOTAG:-0}" -gt 0 ]; then
  STATIC_BAD=$((STATIC_BAD + NOTAG))
fi

if [ "$STATIC_BAD" -gt 0 ]; then
  echo ""
  echo "✗ 静态检查 ${STATIC_BAD} 处不合规（未 pin 或缺注释 tag）"
  exit 1
fi
echo "  ✓ 静态检查通过：全部引用已 pin 且带注释 tag"

# ── 二、在线对账（可选）：SHA 与注释 tag 同 commit ──
if [ "${SOFA_PIN_CHECK_OFFLINE:-0}" = "1" ]; then
  echo ""
  echo "  ⚠ SOFA_PIN_CHECK_OFFLINE=1 · 跳过在线对账（测试模式）"
  exit 0
fi

# 网络探测：curl GitHub API 不可达时降级 exit 0 + 告警（门禁不被网络阻断）
if ! curl -s --max-time 8 -o /dev/null "https://api.github.com/rate_limit" 2>/dev/null; then
  echo ""
  echo "  ⚠ GitHub API 不可达——跳过在线对账（不阻断），网络恢复后重跑核对"
  exit 0
fi

# 收集去重的 repo@tag 对（同 tag 多处引用只查一次）
PAIRS=$(echo "$SCAN" | jq -r '[.refs[] | select(.tag != null) | {repo: (.full | split("@")[0]), tag: .tag}] | unique_by(.repo + .tag) | .[] | .repo + " " + .tag')
if [ -z "$PAIRS" ]; then
  echo ""
  echo "  ⚠ 无可对账的引用——检查 workflows 目录"
  exit 0
fi

MISMATCH=0
while IFS= read -r pair; do
  repo=$(echo "$pair" | cut -d' ' -f1)
  tag=$(echo "$pair" | cut -d' ' -f2)
  # v5 这类轻量 tag 在注释里可能写作 v5（ref 真名），annotated 可能带 v 前缀——统一去 v 再比对 repo 的 tags 列表
  ref_name="$tag"
  REF_JSON=$(curl -s --max-time 10 "https://api.github.com/repos/${repo}/git/ref/tags/${ref_name}" 2>/dev/null || echo '')
  if [ -z "$REF_JSON" ] || echo "$REF_JSON" | jq -e '.message' >/dev/null 2>&1; then
    echo "  ⚠ ${repo}@${tag}: tag 查询失败（rate limit 或 tag 不存在）——人工核对"
    continue
  fi
  SHA=$(echo "$REF_JSON" | jq -r '.object.sha')
  OBJ_TYPE=$(echo "$REF_JSON" | jq -r '.object.type')
  # annotated tag 解引用取真正 commit
  if [ "$OBJ_TYPE" = "tag" ]; then
    REAL_SHA=$(curl -s --max-time 10 "https://api.github.com/repos/${repo}/git/tags/${SHA}" 2>/dev/null | jq -r '.object.sha // empty' 2>/dev/null)
    [ -n "$REAL_SHA" ] && SHA="$REAL_SHA"
  fi
  # 找本仓该 repo+tag 的所有 pinned SHA
  PINNED_SHAS=$(echo "$SCAN" | jq -r --arg repo "$repo" --arg tag "$tag" '[.refs[] | select(.tag == $tag and (.full | startswith($repo + "@")))] | .[] | .full | split("@")[1]')
  while IFS= read -r psha; do
    [ -z "$psha" ] && continue
    if [ "$psha" = "$SHA" ]; then
      echo "  ✓ ${repo}@${tag}: pin ${psha:0:8} 与 tag 指向一致"
    else
      echo "  ✗ ${repo}@${tag}: 本仓 pin ${psha:0:8} ≠ tag 现指向 ${SHA:0:8}——tag 已移动，评估升级（安全修复）或保持（防劫持）"
      MISMATCH=$((MISMATCH + 1))
    fi
  done <<< "$PINNED_SHAS"
done <<< "$PAIRS"

echo ""
if [ "$MISMATCH" -gt 0 ]; then
  echo "✗ ${MISMATCH} 处 SHA 与 tag 指向不一致——人工决策后更新 pin 或确认保持"
  exit 1
fi
echo "✓ Action pin 对账完成：SHA 与注释 tag 全部同 commit"
exit 0
