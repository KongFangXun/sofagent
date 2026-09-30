#!/usr/bin/env bash
# ============================================================
# npm-publish-with-retry.sh · npm publish 单点（含重复发布豁免判定）
# v1.5.5 阶段三 F 项：从 .github/workflows/release.yml 两个 job 各自内联的
# 「E409 + E404 形态豁免 + registry 二次确认」逻辑收口而来——此前两段逐字
# 重复（publish-audit 与 publish-mcp 各一份），改一处漏一处。
#
# 用法（在待发布包目录内执行，需已带 NODE_AUTH_TOKEN）:
#   bash ../../tools/release/npm-publish-with-retry.sh
#
# 豁免判定（单一定义处，勿在 workflow 里另抄一份）:
#   1. E409 / already published / Cannot publish over previously staged
#      → 判为已发布，exit 0
#   2. 🔴 平台契约（v1.5.5 实测登记）：npm 对「版本已在 registry」的重复发布，
#      经本渠道实测返回的是 **E404**（报错文本含 "is not in this registry"），
#      而 **不是** E409。判为「已发布」前必须二次确认该版本确实存在于
#      registry——防把真实 404（包名/版本确不存在、token 无权限）误判为
#      已发布而吞掉真失败。
#   3. 其余失败 → 原样透传 npm 退出码
# ============================================================
set -uo pipefail

# 机械对账锚：release.yml 的两处 Publish step 应 source 本脚本而非内联判定。
# 对账命令（两处 grep 计数应为 0——判定文本只在本文件定义）:
#   grep -c "is not in this registry" .github/workflows/release.yml

OUT=$(npm publish --access public 2>&1); RC=$?
echo "$OUT"

if [ $RC -ne 0 ] && echo "$OUT" | grep -qE "E409|already published|Cannot publish over previously staged"; then
  echo "✅ 先行发布已在 registry 传播（E409 = 版本已存在）——视为已发布，跳过"
  exit 0
fi

if [ $RC -ne 0 ] && echo "$OUT" | grep -q "is not in this registry"; then
  VER=$(node -p "require('./package.json').version")
  NAME=$(node -p "require('./package.json').name")
  if npm view "${NAME}@${VER}" version >/dev/null 2>&1; then
    echo "✅ registry 二次确认 ${NAME}@${VER} 已存在——判为已发布，跳过"
    exit 0
  fi
  echo "❌ E404 且 registry 二次确认该版本不存在——真实发布失败，不豁免"
fi

exit $RC
