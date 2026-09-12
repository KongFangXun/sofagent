#!/usr/bin/env bash
# ============================================================
# dependency-direction.sh · 依赖方向架构测试（v1.4.8 第七章/第〇批）
# ============================================================
# 用法: bash tools/check/dependency-direction.sh
#
# 读 tools/check/dependency-direction.yml（包边界 SSOT）+ 各包 package.json
# 的 dependencies/devDependencies，比对实际依赖边是否在允许清单内。
# 违规 FAIL 并列出违规边（包 → 非法依赖）。
#
# 口径：只断言 build 序列包（不含 umbrella/插件家族）——见 yml 头注。
# 包数由 yml 的 packages 段长度动态得出（v1.4.8 第 7 批：原写死「13 包」文案，
# train 拆包后失真——改为动态，防下次加包再漂）。
#
# 退出码: 0 = 全部合法 / 1 = 有违规边 / 2 = 清单或 package.json 解析失败
# ============================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
YML="$SCRIPT_DIR/dependency-direction.yml"
RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'

[ -f "$YML" ] || { echo -e "${RED}❌ 边界清单缺失: $YML${NC}"; exit 2; }

# 用 node 解析 yml（js-yaml 在根 node_modules——审计模块既有依赖）+ 逐包读 package.json
node -e '
const fs = require("fs");
const path = require("path");
const ROOT = process.argv[1];
let yaml;
try { yaml = require("js-yaml"); } catch { yaml = require(path.join(ROOT, "node_modules/js-yaml")); }
const spec = yaml.load(fs.readFileSync(process.argv[2], "utf8"));
if (!spec || !spec.packages) { console.error("❌ yml 缺 packages 段"); process.exit(2); }
const pkgs = spec.packages;
const name2key = {}; // @sofagent/xxx → key
for (const [key, info] of Object.entries(pkgs)) {
  const pkgJson = path.join(ROOT, info.path, "package.json");
  if (!fs.existsSync(pkgJson)) { console.error(`❌ 清单包目录无 package.json: ${info.path}`); process.exit(2); }
  const name = JSON.parse(fs.readFileSync(pkgJson, "utf8")).name;
  name2key[name] = key;
}
let violations = 0;
for (const [key, info] of Object.entries(pkgs)) {
  const pkgJson = JSON.parse(fs.readFileSync(path.join(ROOT, info.path, "package.json"), "utf8"));
  const deps = Object.keys(pkgJson.dependencies || {}).concat(Object.keys(pkgJson.devDependencies || {}));
  for (const dep of deps) {
    if (!dep.startsWith("@sofagent/")) continue;
    const target = name2key[dep];
    if (target === undefined) continue; // 非清单内包（如 umbrella）不在本门禁口径
    if (!info.allow.includes(target)) {
      console.error(`  ❌ 违规边: ${key}(${info.path}) → ${dep}（目标层 ${pkgs[target].layer} > 允许清单 ${JSON.stringify(info.allow)}）`);
      violations++;
    } else if (pkgs[target].layer > info.layer) {
      console.error(`  ❌ 反向依赖: ${key}(L${info.layer}) → ${target}(L${pkgs[target].layer})——只允许依赖同层或更低层`);
      violations++;
    }
  }
}
if (violations > 0) { console.error(`\n共 ${violations} 条违规依赖边`); process.exit(1); }
console.log(`  ✓ ${Object.keys(pkgs).length} 包依赖方向全部合法（清单: tools/check/dependency-direction.yml）`);
' "$ROOT" "$YML"
EXIT=$?
if [ $EXIT -ne 0 ]; then
  echo -e "${RED}❌ dependency-direction 检查未通过${NC}"
  exit $EXIT
fi
echo -e "${GREEN}✅ 依赖方向架构测试通过${NC}"
exit 0
