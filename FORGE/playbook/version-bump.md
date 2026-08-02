# 版本号 bump 操作手册

> 发版时全项目版本号升级的操作手册。releasing.md 阶段八引用本文件。

### 全项目版本号扫描（用脚本，禁止手动 grep）

#### Step 1: 一键升级

```bash
# 先 dry-run 看会影响哪些文件
./tools/bump-version.sh <旧版本> <新版本> --dry-run

# 确认后实际替换
./tools/bump-version.sh <旧版本> <新版本>
```

**脚本覆盖 13 类位置**（全自动扫描，新增 .ts/.sh/.ps1 文件自动发现）：
1. `engine/audit/package.json` version（SSOT）
2. `engine/mcp/package.json` version
3. `const VERSION = 'x.y'`（动态扫描 `audit/src/` + `mcp/src/` 全目录）
4. .ts 文件头注释中的 `— vX.Y.Z` 格式
5. `index.ts` 版本引用
6. `VERSION="x.y"`（扫描 `scripts/*.sh`）+ .sh 文件头注释中的 `（vX.Y.Z）` 格式
7. `$VERSION = "x.y"`（扫描 `scripts/windows/*.ps1`）
8. MD 文件头 `> vX.Y ·`（排除 `docs/changelog/`）+ ROADMAP「现在在哪」节标题
9. README badge `version-vX.Y`（大小写不敏感）
10. SKILL.md frontmatter `version: x.y`（含 `SKILL/` 和 `FDE/` 下的 SKILL.md）
11. MD tail signature `> *vX.Y*`
12. SECURITY.md 状态标注 `**当前状态（vX.Y）**`
13. `engine/*/package.json` 全 12 包 + `engine/hooks/sofagent-load-chain/package.json` + `FDE/package.json`（共 14 包，v1.0.3 起）

**不碰**：正文中的历史引用（如 "v1.0 新增"）。这是正确设计。

#### Step 2: 一致性校验

```bash
./tools/check-version.sh
```

从 `package.json` 读 SSOT 版本号，逐项比对全项目 13 类位置。任何不一致 → 红字报错 + exit 1。

#### 同步 package-lock.json（🔴 v1.0.3 + v1.1.3 教训）

bump-version.sh 改了 `package.json` 但不会自动同步 `package-lock.json`。必须手动执行：

```bash
npm install --package-lock-only
# 验证（engine/audit 是 SSOT）
grep -A3 '"engine/audit":' package-lock.json | grep '"version"'
# 应该是新版本号
```

**🔴 v1.1.3 铁律**：**禁止用 `sed` 直接改 `package-lock.json`**——全局替换 `1.1.0→1.1.3` 会把外部包（如 `reusify@1.1.0`）也污染为不存在的版本（`reusify@1.1.3`），导致 CI 全平台 `npm ci` 崩溃。只能用 `npm install --package-lock-only` 重新生成锁文件。

#### 🔴 v1.1.3 npm 发布铁律：版本号永久锁死（详见 releasing.md 索引段）

> 🔴 v1.1.3 教训：npm 版本号 publish 后永久封存，unpublish 无法复写。发之前确认一切就绪 → 一次性批量发布。

```bash
# ❌ 永远不要：publish→unpublish→re-publish（报 400 Cannot publish over）
# ✅ 正确：确认就绪 → 一次性批量发布 → 发完即锁定
```

#### 手动排查（脚本未覆盖的边缘情况）

```bash
# 全项目搜旧版本号（排除 changelog 历史 + node_modules）
grep -rn "vX\.Y\.旧" --include="*.md" --include="*.ts" --include="*.sh" . \
  | grep -v "docs/changelog/" | grep -v "node_modules"
```

> 手动 grep 的结果会包含大量"合理的历史引用"（如 "v1.0 新增"）。这些**不改**——它们是变更溯源标记。

#### 脚本不覆盖（必须手动）

| 文件 | 为什么脚本不碰 | 什么时候改 |
|------|------|------|
| `CHANGELOG.md` 条目 | 内容性更新，不是纯版本号替换 | 每次发版手动写摘要 + 版本说明 |
| `ROADMAP.md` 五步更新 | 结构性改动（删节/迁移），不是纯替换 | 每次发版手动做五步（详见 releasing.md 阶段八） |
| `ARCHITECTURE.md` 正文"当前 vX.Y" | 正文引用，不是版本头格式 | bump 后 grep `当前 v` 检查并手动更新 |
| `package-lock.json` | bump-version.sh 不覆盖 | 「同步 package-lock.json」小节用 `npm install --package-lock-only` 同步 |
| 正文中的历史引用 | "v1.0 新增"是溯源标记，不改 | 永远不改 |

#### 🔴 版本重编号全局 grep（v1.0.2 教训）

版本重编号时（如 v1.0.x 系列内部跳号），只改规划版本表是不够的——ROADMAP 的详情表、HANDBOOK、DEVELOPMENT、THANKS 中的版本引用也要跟着改。必须全局 grep 所有 `vX.Y.x` 引用，区分"历史引用"（不改）和"未来规划引用"（必须改）。

```bash
# 搜所有含版本号的引用
grep -rn "v1\.0\.[0-9]" --include="*.md" . | grep -v "docs/changelog/" | grep -v "node_modules"
# 逐一判断哪些是"未来规划引用"（要改），哪些是"历史引用"（不改）
```

#### 新增 SKILL.md 覆盖检查（🔴 v1.0.3 教训）

新增 SKILL.md 文件时，确认 check-version.sh 能检测到它。check-version.sh 用 `find -name 'SKILL.md'` 动态扫描，理论上自动覆盖——但 SKILL.md 的 version 字段必须用 3 段格式（如 `1.0.3`），否则 2 段比对会漏检 patch 差异。

```bash
# 验证所有 SKILL.md 被 check-version 覆盖
bash tools/check-version.sh 2>&1 | grep 'SKILL.md'
# 期望：所有 SKILL.md 文件都出现在列表中
```
