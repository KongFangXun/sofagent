#!/usr/bin/env bash
# ============================================================
# publish-packages.sh · npm 分批发布（依赖拓扑序）
# ============================================================
# 用法: bash tools/release/publish-packages.sh <版本号>
#   例:  bash tools/release/publish-packages.sh 1.3.2
#
# 🔴 真实覆盖范围（如实收窄，勿再声称「全仓包自动纳入」）：
#   本脚本发**两类**，其余发版物**不归本脚本**：
#     ① `@sofagent/*` scope 包 —— 从 npm ls --all --json 取以 `@sofagent/` 开头的
#        依赖，按依赖拓扑分层（目录映射 `@sofagent/x` → `engine/x`；load-chain 特例
#        `engine/hooks/sofagent-load-chain`）。
#     ② 七款 DSH 插件 `cordis-plugin-sofagent-*`（v1.5.2 章九起）—— 数据源是
#        `engine/dsh-plugins/plugins.json`，目录 `engine/dsh-plugins/<id>`，
#        原子款先发、suite 聚合款最后发。
#     **不在本脚本内**：裸名总包 `sofagent`（`engine/umbrella/`，无 scope、目录名
#     与包名不符）——发版 SOP 步骤八单独段发布；`@sofagent/load-chain` 已由 ① 的
#     目录特例覆盖。故包数对账口径一律以发版 SOP 步骤八为准，不以本脚本为准。
#   ⚠️ 为什么 ② 必须单独一段：① 只筛 `@sofagent/` 前缀，而七款插件**既不带该前缀、
#     目录也不在 `engine/<pkg>` 布局**——只靠 ① 会静默跳过这七款却仍打印
#     「✅ 全部包已发布」。这正是本仓最痛恨的假绿形态，故按清单 SSOT 显式驱动。
#
# 功能:
#   1. `@sofagent/*` 包列表从 npm ls --all --json 动态读；七款插件列表从 plugins.json 读
#      （两处都非硬编码包名——新增/改名款由数据源自动纳入或目录缺失即报红）
#   2. 从 npm ls --all --json 算依赖拓扑，按层分批 publish
#   3. 验证全部包（含七款插件）版本号与目标版本一致（只 echo 不判 FAIL 是虚假绿色）
#
# 前置条件:
#   - 已 npm login（npm whoami 有输出）
#   - 已 npm run build（dist 产物就绪）
#   - 版本号已 bump（check-version.sh 全绿）
#
# 退出码:
#   0 = 全部发布成功 + 版本验证一致
#   1 = 发布失败 或 版本验证不一致
# ============================================================
set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "用法: bash tools/release/publish-packages.sh <版本号>"
  echo "  例: bash tools/release/publish-packages.sh 1.3.2"
  exit 1
fi

cd "$(dirname "$0")/../.."

# ── 前置检查 ──────────────────────────────────────────────

echo "=== 前置检查 ==="

if ! npm whoami >/dev/null 2>&1; then
  echo "❌ 未登录 npm，请先 npm login"
  exit 1
fi
echo "  ✓ npm 已登录: $(npm whoami)"

if [ ! -d engine/audit/dist ]; then
  echo "❌ dist 产物不存在，请先 npm run build"
  exit 1
fi
echo "  ✓ dist 产物就绪"

# 重新 build 确保最新（bump 后/修复后 dist 可能过期）
echo "  重新 build（确保 dist 与 src 同步）..."
npm run build 2>&1 | tail -1

# ── 动态读包列表 + 算拓扑序 ─────────────────────────────────

echo ""
echo "=== 依赖拓扑分层 ==="

# 用 node 从 npm ls --all --json 算拓扑分层（Kahn 算法）
LAYERS_JSON=$(npm ls --all --json 2>/dev/null | node -e '
const data = JSON.parse(require("fs").readFileSync("/dev/stdin","utf8"));
const deps = data.dependencies || {};

// 只取 @sofagent/* 包
const pkgs = {};
for (const [name, info] of Object.entries(deps)) {
  if (!name.startsWith("@sofagent/")) continue;
  const internal = Object.keys(info.dependencies || {}).filter(d => d.startsWith("@sofagent/"));
  pkgs[name] = internal;
}

// Kahn 拓扑排序：分层输出
const layers = [];
const published = new Set();
const remaining = new Set(Object.keys(pkgs));

while (remaining.size > 0) {
  const layer = [];
  for (const pkg of remaining) {
    const deps = pkgs[pkg];
    if (deps.every(d => published.has(d))) {
      layer.push(pkg);
    }
  }
  if (layer.length === 0) {
    // 剩余包互相依赖（如 daemon↔orchestrator），放同一层一起发布
    // npm publish 不要求依赖已在 registry（workspace 本地 symlink 可用）
    layer.push(...remaining);
    if (remaining.size > 0) {
      console.error("⚠️ 检测到互相依赖的包（放同一层）: " + [...remaining].join(", "));
    }
  }
  layers.push(layer);
  for (const pkg of layer) {
    published.add(pkg);
    remaining.delete(pkg);
  }
}

console.log(JSON.stringify(layers));
')

echo "$LAYERS_JSON" | node -e '
const layers = JSON.parse(require("fs").readFileSync("/dev/stdin","utf8"));
layers.forEach((layer, i) => {
  console.log(`  第${i+1}层: ${layer.join(", ")}`);
});
'

# ── 分批 publish ──────────────────────────────────────────

echo ""
echo "=== 开始发布（按依赖层分批）==="

LAYERS=$(echo "$LAYERS_JSON" | node -e '
const layers = JSON.parse(require("fs").readFileSync("/dev/stdin","utf8"));
layers.forEach((layer, i) => {
  console.log(`LAYER:${i+1}:${layer.join(",")}`);
});
')

# 发版失败标记文件（管道子 shell 变量不传递，用文件标记）
PUBLISH_FAIL=$(mktemp)
VERSION_FAIL=$(mktemp)

echo "$LAYERS" | while IFS=: read -r _ num pkgs_str; do
  echo ""
  echo "── 第${num}层 ──"
  echo "$pkgs_str" | tr ',' '\n' | while read -r pkg; do
    # @sofagent/xxx → engine/xxx（去掉 @sofagent/ 前缀）
    dir="engine/${pkg#@sofagent/}"
    # load-chain 特殊处理（在 engine/hooks/ 子目录）
    if [ "$pkg" = "@sofagent/load-chain" ]; then
      dir="engine/hooks/sofagent-load-chain"
    fi

    if [ ! -d "$dir" ]; then
      echo "  ❌ 目录不存在: ${dir}（包 ${pkg}）"
      echo "1" > "$PUBLISH_FAIL"
      continue
    fi

    echo "  发布 $pkg ..."
    # 临时关 set -e（npm publish 失败不退出，进入 else 分支记录失败）
    set +e
    publish_output=$(cd "$dir" && npm publish --access public 2>&1)
    publish_rc=$?
    set -e
    if [ $publish_rc -eq 0 ]; then
      echo "$publish_output" | tail -1
    else
      echo "  ❌ 发布失败: ${pkg}（exit ${publish_rc}）"
      echo "$publish_output" | tail -3
      echo "1" > "$PUBLISH_FAIL"
    fi
  done
done

# ── DSH 插件七款发布（v1.5.2 章九 · 覆盖范围见文件头「真实覆盖范围」）──────
# 🔴 为何必须单独一段：上方循环只筛 `@sofagent/` 前缀，而七款
#    `cordis-plugin-sofagent-*` 既不带该前缀、目录也不在 `engine/<pkg>` 布局——
#    只靠上方循环会**静默跳过这七款却仍打印「✅ 全部包已发布」**（假绿）。
#    故此处按清单 SSOT 显式驱动：款式取自 plugins.json，代码里不硬编码任何包名
#    ⇒ 新增/改名款自动纳入、目录缺失即报红，不会静默漏发。
# 顺序：原子款先发，suite 聚合款最后发（其 optionalDependencies 引用六个原子款）。
echo ""
echo "=== DSH 插件发布（engine/dsh-plugins/ · 款式由 plugins.json 驱动）==="

DSH_ORDER=$(node -e '
const fs = require("fs");
const doc = JSON.parse(fs.readFileSync("engine/dsh-plugins/plugins.json", "utf8"));
const ids = doc.plugins.map((p) => p.id);
const suite = doc.plugins.filter((p) => p.kind === "suite").map((p) => p.id);
if (ids.length === 0) { console.error("plugins.json 无任何插件条目"); process.exit(1); }
// 聚合款识别失败（kind 字段被改名/删除）会让「suite 最后发」静默失效 ⇒ fail-loud。
// 不校验恰为 1 款：多聚合款时同样全部置后（顺序不变式仍成立），检小于 1 即可。
if (suite.length < 1) { console.error("plugins.json 未识别到聚合款（kind=suite）——suite 置后发规则将失效"); process.exit(1); }
console.log([...ids.filter((id) => !suite.includes(id)), ...suite].join("\n"));
') || { echo "❌ 无法从 engine/dsh-plugins/plugins.json 解析插件清单——发布面数据源失效，拒绝继续"; exit 1; }
echo "  待发款式: $(echo "$DSH_ORDER" | tr '\n' ' ')"

DSH_PUBLISH_FAIL=$(mktemp)
echo "$DSH_ORDER" | while read -r pkg; do
  if [ -z "$pkg" ]; then continue; fi
  dir="engine/dsh-plugins/${pkg}"

  if [ ! -d "$dir" ]; then
    echo "  ❌ 目录不存在: ${dir}（包 ${pkg}）"
    echo "1" > "$DSH_PUBLISH_FAIL"
    continue
  fi

  echo "  发布 $pkg ..."
  set +e
  publish_output=$(cd "$dir" && npm publish --access public 2>&1)
  publish_rc=$?
  set -e
  if [ $publish_rc -eq 0 ]; then
    echo "$publish_output" | tail -1
  else
    echo "  ❌ 发布失败: ${pkg}（exit ${publish_rc}）"
    echo "$publish_output" | tail -3
    echo "1" > "$DSH_PUBLISH_FAIL"
  fi
done
if [ -s "$DSH_PUBLISH_FAIL" ]; then
  echo "1" > "$PUBLISH_FAIL"
fi
rm -f "$DSH_PUBLISH_FAIL"

# ── 验证全部版本一致 ──────────────────────────────────────

echo ""
echo "=== 版本验证 ==="

echo "$LAYERS" | while IFS=: read -r _ num pkgs_str; do
  echo "$pkgs_str" | tr ',' '\n' | while read -r pkg; do
    ver=$(npm view "$pkg" version 2>/dev/null || echo "NOT_FOUND")
    if [ "$ver" = "$VERSION" ]; then
      echo "  ✓ $pkg@$ver"
    else
      echo "  ❌ ${pkg}@${ver}（期望 ${VERSION}）"
      echo "1" > "$VERSION_FAIL"
    fi
  done
done

# ── 版本验证：DSH 插件七款（同口径；不纳入则「发成功了没」仍是盲区）──
echo ""
echo "=== 版本验证（DSH 插件七款）==="

echo "$DSH_ORDER" | while read -r pkg; do
  if [ -z "$pkg" ]; then continue; fi
  ver=$(npm view "$pkg" version 2>/dev/null || echo "NOT_FOUND")
  if [ "$ver" = "$VERSION" ]; then
    echo "  ✓ $pkg@$ver"
  else
    echo "  ❌ ${pkg}@${ver}（期望 ${VERSION}）"
    echo "1" > "$VERSION_FAIL"
  fi
done

# 检查标记文件
RESULT=0
[ -s "$PUBLISH_FAIL" ] && { echo ""; echo "❌ 部分包发布失败"; RESULT=1; }
[ -s "$VERSION_FAIL" ] && { echo ""; echo "❌ 版本验证失败，部分包未更新到 $VERSION"; RESULT=1; }
rm -f "$PUBLISH_FAIL" "$VERSION_FAIL"

if [ "$RESULT" -eq 0 ]; then
  echo ""
  echo "✅ 全部包已发布到 $VERSION"
fi

exit $RESULT
