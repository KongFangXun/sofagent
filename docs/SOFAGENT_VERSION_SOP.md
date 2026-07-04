# sofagent 版本开发 SOP

> v0.95 实践沉淀。八阶段：审查→开发→自测→审核→文档收尾→确认关口→发布→发布后。
> 🔴 v0.95 起，版本号操作用 `bump-version.sh` + `check-version.sh`，禁止手动 grep/sed。

---

## 阶段一：审查 → 开发日志

| # | 步骤 | 谁做 | 产物 |
|:--:|------|:--:|------|
| 1 | 上一版本接受独立审查（GLM + DeepSeek），产出 P0/P1/P2 清单 | 作者 | 审查报告 |
| 2 | 写 `docs/changelog/vX.Y.md`，含：问题描述 → 修复方案 → 验证方式 → 发布检查清单 | 作者 | 开发日志 |

---

## 阶段二：开发

按优先级分三批，每批独立派发/回报/核实，禁止合并批次。

| # | 优先级 | 谁做 | 说明 |
|:--:|:--:|:--:|------|
| 3 | P0 安全硬伤 | 工程师 | 必须修，阻塞发布 |
| 4 | P1 工程欠债 | 工程师 | 应该修 |
| 5 | P2 改进 | 工程师 | 不阻塞发布 |

---

## 阶段三：自测

开发完成后、交审核之前，工程师先自己跑一轮：

| # | 步骤 | 验证方式 |
|:--:|------|------|
| 6 | `npm run build` | exit 0 |
| 7 | `npm test` | 全部通过 |
| 8 | `shellcheck sofagent/scripts/*.sh tools/*.sh FDE/fde-install.sh` | 零 error（warning 不阻塞，但 P0 级 error 必须清零。v0.97 起要求） |
| 9 | 改动清单核对 | diff 确认只改了 changelog 规定的文件 |

---

## 阶段四：审核

| # | 步骤 | 谁做 | 验证方式 |
|:--:|------|:--:|------|
| 9 | 独立审核者逐项核对 changelog 每一项 | 审核者 | 逐文件读源码 |
| 9 | FAIL 项修复 | 工程师 | build + test 全绿 |
| 10 | 二次复核确认全部到位 | 审核者 | changelog 所有项 PASS |

---

## 阶段五：文档收尾（🔴 v0.92 踩坑最密集）

### 5.1 开发日志自更新

- 「质量验证」节补上本轮 `npm test` / `check-version` / `verify` / `npm pack` 的实际跑分结果（不要留占位符）
- 开发日志是活文档，代码改完立刻回写，不要等
- 独立审核的「发布检查清单」（`[x]` 格式）可放在 changelog 末尾，也可用「质量验证」命令输出替代——二者功能等价，不必重复

### 5.2 全项目版本号扫描（🔴 v0.95 起用脚本，禁止手动 grep）

> **每次发版必须用两个脚本，不要手动 sed/grep 改版本号。**

#### Step 1: 一键升级

```bash
# 先 dry-run 看会影响哪些文件
./tools/bump-version.sh <旧版本> <新版本> --dry-run

# 确认后实际替换
./tools/bump-version.sh <旧版本> <新版本>
```

**脚本覆盖 13 类位置**（全自动扫描，新增 .ts/.sh/.ps1 文件自动发现）：
1. `sofagent/audit/package.json` version（SSOT）
2. `sofagent/mcp/package.json` version
3. `const VERSION = 'x.y'`（动态扫描 `audit/src/` + `mcp/src/` 全目录）
4. .ts 文件头注释中的 `— vX.Y.Z` 格式
5. `index.ts` 版本引用
6. `VERSION="x.y"`（扫描 `scripts/*.sh`）+ .sh 文件头注释中的 `（vX.Y.Z）` 格式
7. `$VERSION = "x.y"`（扫描 `scripts/windows/*.ps1`）
8. MD 文件头 `> vX.Y ·`（排除 `docs/changelog/`）+ ROADMAP「现在在哪」节标题
9. README badge `version-vX.Y`（大小写不敏感）
10. SKILL.md frontmatter `version: x.y`（含 `skill/` 和 `FDE/` 两个 SKILL.md）
11. MD tail signature `> *vX.Y*`
12. SECURITY.md 状态标注 `**当前状态（vX.Y）**`

**不碰**：正文中的历史引用（如 "v0.94 新增"）。这是正确设计。

#### Step 2: 一致性校验

```bash
./tools/check-version.sh
```

从 `package.json` 读 SSOT 版本号，逐项比对全项目 13 类位置。任何不一致 → 红字报错 + exit 1。

#### 手动排查（脚本未覆盖的边缘情况）

如果脚本显示全绿但你怀疑有遗漏，用这条兜底：

```bash
# 全项目搜旧版本号（排除 changelog 历史 + node_modules + 安装副本）
grep -rn "v0\.旧版本" --include="*.md" --include="*.ts" --include="*.sh" . \
  | grep -v "docs/changelog/" | grep -v "node_modules" | grep -v ".workbuddy/memory"
```

> **注意**：手动 grep 的结果会包含大量"合理的历史引用"（如 "v0.94 新增"、"v0.94 前的设计"）。这些**不改**——它们是变更溯源标记，告诉读者这个改动是哪个版本引入的。

#### 必改版本号（脚本自动覆盖，无需手动）

脚本会自动处理以下所有位置。**你不需要手动改这些文件**：

| 类别 | 脚本覆盖的文件 |
|------|------|
| 入口 | `README.md` / `README.en.md`（badge + MD 头） |
| 核心文档 | `HANDBOOK.md` / `ARCHITECTURE.md` / `DEVELOPMENT.md` / `LIMITATIONS.md` / `COMMUNITY.md` / `SECURITY.md`（MD 头） |
| 部署产物 | `skill/*.md`（10 个 Skill 文件，含 SKILL.md frontmatter + 标题版本号）+ `FDE/SKILL.md`（frontmatter） |
| 工具 | `sofagent/audit/src/**/*.ts` + `sofagent/mcp/src/**/*.ts`（const VERSION + index.ts 引用） |
| 脚本 | `sofagent/scripts/*.sh`（VERSION= 字段）+ `scripts/windows/*.ps1` |
| 索引 | `CHANGELOG.md` 条目（**手动写**，脚本不碰） |
| 路线 | `ROADMAP.md` 三步更新（**手动写**，脚本只改文件头） |

#### 脚本不覆盖（必须手动）

| 文件 | 为什么脚本不碰 | 什么时候改 |
|------|------|------|
| `CHANGELOG.md` 条目 | 内容性更新，不是纯版本号替换 | 每次发版手动写摘要 + 版本说明 |
| `ROADMAP.md` 三步更新 | 结构性改动（删节/迁移），不是纯替换 | 每次发版手动做三步 |
| 正文中的历史引用 | "v0.94 新增"是溯源标记，不改 | 永远不改 |

#### 5.2.1 内容新鲜度检查

版本号更新不代表内容没变质。每次发布前逐项核对（工程师自测时跑）：

- [ ] 效果证据表——数据是否包含最新版本？
- [ ] 「vX.Y 不修 / 待修」的局限标注——是否已经修了但标注没动？
- [ ] 「尚无第三方实测数据」「尚无 ≥1 周样本」等事实断言——是否已经变了？
- [ ] README FDE 完成度（2/5 → 3/5 等）——是否与交付层数匹配？
- [ ] 前置依赖表——新增工具是否需要新依赖（如审计工具需要 Node.js）？
- [ ] 英文版（README.en / EVIDENCE.en）内容是否与中文版同步？
- [ ] COMMUNITY.md 实验状态、contributor 数是否为当前实际状态？

### 5.3 CHANGELOG 两步

- [ ] 新增版本条目（摘要一句话 + 链接到 `docs/changelog/vX.Y.md`）
- [ ] 索引列表按时间倒序排列，版本号与日期正确

### 5.4 ROADMAP 三步

- [ ] 文件头版本号更新
- [ ] 「现在在哪」替换为当前版本简表，旧内容迁移到「迭代历程」
- [ ] 「未来去哪」删掉已完成版本，TOC 同步

### 5.5 按需文档

| 文档 | 什么时候更新 |
|------|------|
| `README.md` | FDE 完成度变化、效果证据更新、新功能入口 |
| `ARCHITECTURE.md` | 架构决策或设计思路有变更 |
| `DEVELOPMENT.md` | 开发流程有变更 |
| `LIMITATIONS.md` | 新发现的局限或旧局限被消除 |
| `HANDBOOK.md` | 用户使用习惯、FAQ 有变化 |
| `COMMUNITY.md` | contributor 数据、社区状态有变化 |
| `ROADMAP.md` | 三步更新（文件头/现在在哪/迭代历程）。**不要**在「现在在哪」堆积历史版本详细表——那是 CHANGELOG 的职责。只留当前版本一句话 + v1.0 准入进度。「未来去哪」删掉已完成的版本 |
| `CHANGELOG.md` | 新增版本索引条目（一句话摘要 + changelog 链接）。索引按时间倒序排列。这是版本历史的**唯一权威入口**——ROADMAP 不再重复版本细节 |
| `docs/changelog/vX.Y.md` | 完整开发日志：问题背景 + 逐项修复方案 + 质量验证数据 + 发布检查清单。发版前写完，发版后补充审查发现 |

---

## 阶段六：确认关口

文档全部收尾后，**必须**让作者过一遍改动，确认没问题再进发布。

| # | 步骤 | 验证方式 |
|:--:|------|------|
| 12 | 展示全部改动清单 | `git diff --stat` |
| 13 | 作者逐项确认 | 重点看版本号、ROADMAP、CHANGELOG |
| 14 | 确认通过后，开发日志「发布检查清单」才打 `[x]` | 不在文档收尾前打勾 |

---

## 阶段七：发布

### 7.1 发布前检查（npm 包洁净度）

```bash
# audit 包检查
cd sofagent/audit && npm pack --dry-run 2>&1 | grep '\.js\.map' | wc -l    # 期望: 0
npm pack --dry-run 2>&1 | grep 'total files'                                # 期望: 87

# mcp 包检查
cd ../mcp && npm pack --dry-run 2>&1 | grep '\.js\.map' | wc -l             # 期望: 0
npm pack --dry-run 2>&1 | grep 'total files'                                # 期望: ~5

# 类型检查（两个包）
cd ../audit && npx tsc --noEmit && echo "audit tsc: OK"
cd ../mcp && npx tsc --noEmit && echo "mcp tsc: OK"
```

> ⚠️ `npm pack --dry-run` **不会触发** prepublishOnly，因此如果 mcp 依赖 prepublishOnly 的 `find ... -delete` 清理 .js.map，dry-run 仍会显示。确保 package.json 的 `files` 字段包含 `"!dist/**/*.js.map"` 和 `"!dist/**/*.d.ts.map"` 作为双重保险。

### 7.2 执行发布

> **npm 先行策略**（v0.99.7 起推荐）：先手动发布 npm 双包，再 git tag + push。即使 CI 失败，npm 包已就位。CI 加了版本存在性检查，手动发完后 CI 自动 skip publish，不会冲突。

```
── Step 1: 手动发布 npm 双包（npm 先行）──
1. cd sofagent/audit && npm run build && npm publish --access public
2. cd ../mcp && npm publish --access public   # prepublishOnly 自动 build
3. npm view @sofagent/audit version   # 验证：必须是新版本号
4. npm view @sofagent/mcp version     # 验证：必须是新版本号

── Step 2: git tag + push ──
5. git tag vX.XX + git push origin vX.XX
6. 🔴 gh release create vX.XX
   → 自动触发 .github/workflows/release.yml
   → CI 检测版本已发布，自动 skip npm publish（P0-1 修复验证点）
   → 🔴 Release body 必须包含开发日志链接：
      📖 [详细开发日志](./docs/changelog/v0.XX.md)

── Step 3: Skill 分发 ──
7. clawhub skill publish ./skill --slug sofagent --version 0.XX.0
8. clawhub skill publish ./FDE --slug sofagent-fde --version 0.XX.0
9. cp -r skill/ → ~/.workbuddy/skills/sofagent/
10. cp -r skill/ → ~/.openclaw/skills/sofagent/
11. cp -r FDE/ → ~/.workbuddy/skills/sofagent-fde/
```

### 7.3 发布后验证

```bash
# Git
git tag -l | grep v0.XX
gh release view v0.XX

# npm（npm 先行策略下已在发布前验证，这里确认 CI skip 正常）
npm view @sofagent/audit version        # 期望: 0.XX.X
npm view @sofagent/mcp version          # 期望: 0.XX.X

# 本地安装
bash sofagent/scripts/verify.sh --quiet # 期望: 41/41
bash tools/check-version.sh             # 期望: 30/30
bash tools/check-docs.sh                # 期望: 全部通过
```

> 💡 **NPM_TOKEN 认证**：release.yml 使用 `NODE_AUTH_TOKEN: secrets.NPM_TOKEN` 发布到 npm。NPM_TOKEN 需要在 GitHub 仓库 Secrets 中配置（Automation Access Token，已配置 2FA bypass）。如果 npm 发布失败，检查 NPM_TOKEN 是否过期或权限不足。CI 会自动检查版本是否已发布，已发布则跳过（不会因 E403 失败）。

### 7.4 常见发布故障

| 故障 | 现象 | 解决 |
|------|------|------|
| mcp 版本落后 | `npm view @sofagent/mcp version` 显示旧版本 | mcp job 独立于 audit job（不依赖 needs），版本号需手动同步。手动 `gh workflow run release.yml` |
| .js.map 泄露 | `npm pack --dry-run` 显示 .js.map | 检查 package.json `files` 是否包含排除模式，`.npmignore` 模式是否与 audit 对齐 |
| README 空白 | npm 页面无 README | 检查 package.json `files` 是否引用了不存在的 README.md |
| npm publish 403 | `npm publish` E403 | ① 版本号已存在——CI 会自动跳过，本地手动发需先 `npm view @sofagent/audit@版本` 确认；② NPM_TOKEN 过期——在 npm 前往 Access Tokens 重新生成 |

---

## 阶段八：发布后

| # | 步骤 |
|:--:|------|
| 15 | 🔴 **npm 双包验证**：`npm view @sofagent/audit version` + `npm view @sofagent/mcp version` 必须都是最新版本号。**不要信任自动化——必须亲自确认** |
| 16 | npm README 验证：`npm view @sofagent/audit readme` + `npm view @sofagent/mcp readme` 均有内容 |
| 17 | 更新 `.workbuddy/memory/` 日志，记录版本完成 |
| 18 | 如果本次迭代暴露了新的流程漏洞，沉淀到 MEMORY.md 或本 SOP |

---

## v0.92 教训（本 SOP 的由来）

| 问题 | 根因 | 规则 |
|------|------|------|
| CHANGELOG 版本说明停在 v0.81，后面 8 个版本无人续写 | 没有明确责任 + 与目录索引定位冲突 | v0.99.5 起压缩为索引（详细在 docs/changelog/），每次新增版本条目 + 索引列表排序即可 |
| ROADMAP 「现在在哪」标题 v0.92 内容是 v0.91 的 | 改了标题没换内容 | 版本完成时三步更新（文件头/现在在哪/未来去哪） |
| 8 个 MD + 15 个脚本 + audit README 残留旧版本号 | 没有全量扫描 | 发布前 grep 全项目版本号 |
| 开发日志说「5 项没打勾」但实际已干完 | 代码改完没回头更新日志 | 开发日志是活文档，随改随写 |
| 开发直交审核，没自测 | 跳了一步 | 工程师必须自测 build+test 后再交审核 |
| 文档收尾完直接发布，没人确认 | 缺一个关口 | 发布前作者必须确认改动清单 |

## v0.99.5 教训（npm 发布链路 + 文档分工）

| 问题 | 根因 | 规则 |
|------|------|------|
| @sofagent/mcp 发布后 npm 上仍为 0.99.4 | 自动化链路未端到端验证——audit 成功、mcp 断裂。信任自动化但没亲自核实 | 🔴 **发布后必须 `npm view` 两个包确认版本号**（见阶段八新增步骤 15-16） |
| mcp 包 .npmignore 模式与 audit 不一致（`**/*.js.map` vs `dist/*.js.map`） | 两个包独立维护，没有对齐检查 | 🔴 两个 npm 包的 `.npmignore` 和 `package.json` files 字段必须对齐。files 字段加 `"!dist/**/*.js.map"` 作为双重保险（比 .npmignore 更可靠——不依赖 prepublishOnly） |
| `npm pack --dry-run` 显示 mcp 有 .js.map，但实际 publish 干净 | prepublishOnly 在 dry-run 时不触发，造成假阳性 | ⚠️ 验证 npm 打包洁净度不能只看 dry-run，必须以 `files` 字段排除为准 |
| npm README（audit 包）写"5 个命令"实际 8 个 bin | 改了 bin 没同步改 README | 🔴 bin 数量变动必须在 README 中同步更新。不在 README 中写死数字——写「安装后获得以下命令」 |
| audit README 表格列出 sofagent-mcp（跨包命令） | 两个包的 README 没有按包边界隔离 | ⚠️ 每个包的 README 只列自己包的 bin。跨包命令标注来源 |
| changelog v0.99.5.md 写"mcp 3 文件"与实际 pack 不符 | 写了 prepublishOnly 后的发布结果，但标注为 pack --dry-run 结果 | ⚠️ changelog 中 pack 数据必须区分 dry-run 结果和发布结果 |
| Case 018 蔓嘉电商时间线「~2 周」和「不到1个月」同框 | 同一行两个口径，没有统一表述 | ⚠️ evidence 数据统一口径，标注截止日期（如「~3 周（截至 2026-07-04）」） |
| ROADMAP「未来去哪」残留 v0.98-v0.99 已发布版本 | 「现在在哪」更新了但「未来去哪」没同步删 | 🔴 ROADMAP 三步更新第 3 步必须做：删掉「未来去哪」中已完成的版本 |
| ROADMAP「现在在哪」堆积 7 个版本的 P0/P1/P2 详细表 | 版本历史细节放错了位置——应该是 CHANGELOG 的职责 | 🔴 ROADMAP 只答「现在在哪/未来去哪/不要什么」。版本历史归 CHANGELOG + docs/changelog/。迭代历程表保留（一行一版本） |
| v0.99.5 已打 tag，修复涉及源码修改 | 不能 amend 已发布版本，npm 也不允许同版本号覆盖 | 🔴 涉及源码修改 + npm 重新发布的修复 → 必须出新版本号。不在已发布版本上修补 |
| 发版后未做独立审查 | 发版 = 结束，没有「发版后 QA」环节 | ⚠️ 建议：重大版本发版后跑一轮独立审查（15 维度），发现问题纳入下个版本 |
