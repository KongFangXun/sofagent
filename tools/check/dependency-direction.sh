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
# ⑵ 包集合卫生（v1.4.8 补）：另断言 node_modules/@sofagent/ 下无「非 workspace 包」
# ——改名 / 删包后的 extraneous 残留会污染 `npm ls` 闭包统计、误导人工判断。
#
# 口径：依赖边只断言 build 序列包（不含 umbrella/插件家族）——见 yml 头注；
# 包集合卫生改用根 workspaces（范围更全，含插件与 hooks 包）。
# 包数由 yml 的 packages 段长度动态得出（v1.4.8 第 7 批：原写死「13 包」文案，
# train 拆包后失真——改为动态，防下次加包再漂）。
#
# 🔴 判据面（如实声明）：本门禁**只断言 package.json 的声明依赖**，**不扫源码 import**——
#   因此「未在 package.json 声明、运行时却能解析到」的软依赖不在判据面内。已知实例：
#   engine/core/src/doctor.ts 的 require.resolve('@sofagent/audit')（L0→L2 运行时向上依赖；
#   该代码本身可接受——软依赖 + 显式兜底，缺的是门禁看不见它）。补源码 import 扫描为待裁定方向。
#
# 退出码: 0 = 全部合法（含包集合卫生）/ 1 = 有违规边或 extraneous 残留 / 2 = 清单或 package.json 解析失败
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

// ⑵ 包集合卫生（v1.4.8 补）：node_modules/@sofagent/ 下不得出现「非 workspace 包」。
//    改名 / 删包后的 extraneous 残留会污染 `npm ls` 闭包统计、误导人工判断——
//    实例：@sofagent/skillopt 在 v1.4.8 改名 evolve 后作为 extraneous 残留存活一整版，
//    使「伞包闭包 14 项」的统计里混入僵尸项（旧守卫只查 package.json，见回归清单）。
//    口径：以根 package.json 的 workspaces 为准（比 dependency-direction.yml 的 14 包更全，
//    含插件与 hooks 包；只校验 @sofagent/ scope——插件包不在该 scope 下）。
const wsNames = new Set();
for (const ws of JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).workspaces) {
  const pj = path.join(ROOT, ws, "package.json");
  if (fs.existsSync(pj)) wsNames.add(JSON.parse(fs.readFileSync(pj, "utf8")).name);
}
const nmScope = path.join(ROOT, "node_modules/@sofagent");
const extraneous = [];
if (fs.existsSync(nmScope)) {
  for (const e of fs.readdirSync(nmScope, { withFileTypes: true })) {
    const full = `@sofagent/${e.name}`;
    if (!wsNames.has(full)) extraneous.push(full);
  }
}
if (extraneous.length > 0) {
  console.error(`  ❌ node_modules/@sofagent 下有非 workspace 包（extraneous 残留）: ${extraneous.join(", ")}`);
  console.error(`     处置：npm prune（或删除对应目录）——改名 / 删包后必须清理，否则污染 npm ls 闭包统计`);
  violations += extraneous.length;
} else {
  console.log(`  ✓ 包集合卫生：node_modules/@sofagent 无 extraneous 残留（对照 ${wsNames.size} 个 workspace 包名）`);
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
