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
| 8 | `shellcheck sofagent/scripts/*.sh tools/*.sh FDE/fde-install.sh` | 零 error |
| 9 | 改动清单核对 | diff 确认只改了 changelog 规定的文件 |

---

## 阶段四：审核

| # | 步骤 | 谁做 | 验证方式 |
|:--:|------|:--:|------|
| 9 | 独立审核者逐项核对 changelog 每一项 | 审核者 | 逐文件读源码 |
| 9 | FAIL 项修复 | 工程师 | build + test 全绿 |
| 10 | 二次复核确认全部到位 | 审核者 | changelog 所有项 PASS |
| 10.5 | 回归检查：用 106 维度回归清单逐项核对（维护者本地文件，新贡献者可跳过） | 审核者 | 全 PASS。发现回退→修复后重跑。新问题→追加检查项（从 107 开始编号） |

---

## 阶段五：文档收尾（🔴 v0.92 踩坑最密集）

### 5.1 开发日志自更新

- 「质量验证」节补上本轮 `npm test` / `check-version` / `verify` / `npm pack` 的实际跑分结果（不要留占位符）
- 开发日志是活文档，代码改完立刻回写，不要等
- 独立审核的「发布检查清单」（`[x]` 格式）可放在 changelog 末尾，也可用「质量验证」命令输出替代——二者功能等价，不必重复

### 5.2 全项目版本号扫描（🔴 v0.95 起用脚本，禁止手动 grep）

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

```bash
# 全项目搜旧版本号（排除 changelog 历史 + node_modules）
grep -rn "v0\.旧版本" --include="*.md" --include="*.ts" --include="*.sh" . \
  | grep -v "docs/changelog/" | grep -v "node_modules"
```

> 手动 grep 的结果会包含大量"合理的历史引用"（如 "v0.94 新增"）。这些**不改**——它们是变更溯源标记。

#### 脚本不覆盖（必须手动）

| 文件 | 为什么脚本不碰 | 什么时候改 |
|------|------|------|
| `CHANGELOG.md` 条目 | 内容性更新，不是纯版本号替换 | 每次发版手动写摘要 + 版本说明 |
| `ROADMAP.md` 三步更新 | 结构性改动（删节/迁移），不是纯替换 | 每次发版手动做三步 |
| 正文中的历史引用 | "v0.94 新增"是溯源标记，不改 | 永远不改 |

#### 内容新鲜度检查

版本号更新不代表内容没变质。每次发布前逐项核对：

- [ ] 效果证据表——数据是否包含最新版本？
- [ ] 「vX.Y 不修 / 待修」的局限标注——是否已经修了但标注没动？
- [ ] 「尚无第三方实测数据」「尚无 ≥1 周样本」等事实断言——是否已经变了？
- [ ] README FDE 完成度——是否与交付层数匹配？
- [ ] 前置依赖表——新增工具是否需要新依赖？
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
| `ROADMAP.md` | 三步更新。不要在「现在在哪」堆积历史版本详细表 |
| `CHANGELOG.md` | 新增版本索引条目。版本历史的**唯一权威入口** |
| `docs/changelog/vX.Y.md` | 完整开发日志：问题背景 + 逐项修复方案 + 质量验证数据 + 发布检查清单 |

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
npm pack --dry-run 2>&1 | grep 'total files'

# mcp 包检查
cd ../mcp && npm pack --dry-run 2>&1 | grep '\.js\.map' | wc -l             # 期望: 0
npm pack --dry-run 2>&1 | grep 'total files'

# 类型检查（两个包）
cd ../audit && npx tsc --noEmit && echo "audit tsc: OK"
cd ../mcp && npx tsc --noEmit && echo "mcp tsc: OK"
```

### 7.2 执行发布

**npm 先行策略**（v0.99.7 起推荐）：先手动发布 npm 双包，再 git tag + push。即使 CI 失败，npm 包已就位。

```
── Step 1: 手动发布 npm 双包 ──
1. cd sofagent/audit && npm run build && npm publish --access public
2. cd ../mcp && npm publish --access public
3. npm view @sofagent/audit version   # 验证：必须是新版本号
4. npm view @sofagent/mcp version     # 验证：必须是新版本号

── Step 2: git tag + push ──
5. git tag vX.Y.Z + git push origin vX.Y.Z
6. gh release create vX.Y.Z
   Release body 必须包含开发日志链接：
   📖 [详细开发日志](./docs/changelog/vX.Y.Z.md)

── Step 3: Skill 分发 ──
7. openclaw skills publish ./skill
8. openclaw skills publish ./FDE
9. 本地安装（用你 Agent 平台的安装命令，如 `skill install` / `openclaw skills install` / 直接 cp 到 skills 目录）
```

### 7.3 发布后验证

```bash
# Git
git tag -l | grep vX.Y.Z
gh release view vX.Y.Z

# npm
npm view @sofagent/audit version
npm view @sofagent/mcp version

# 本地安装
bash tools/check-version.sh             # 期望: 33/33
bash tools/check-docs.sh                # 期望: 全部通过
```

### 7.4 常见发布故障

| 故障 | 现象 | 解决 |
|------|------|------|
| mcp 版本落后 | `npm view @sofagent/mcp version` 显示旧版本 | mcp job 独立于 audit job，版本号需手动同步 |
| .js.map 泄露 | `npm pack --dry-run` 显示 .js.map | 检查 package.json `files` 是否包含排除模式 |
| README 空白 | npm 页面无 README | 检查 package.json `files` 是否引用了不存在的 README.md |
| npm publish 403 | `npm publish` E403 | 版本号已存在或 NPM_TOKEN 过期 |

---

## 阶段八：发布后

| # | 步骤 |
|:--:|------|
| 15 | **npm 双包验证**：`npm view @sofagent/audit version` + `npm view @sofagent/mcp version` 必须都是最新版本号。不信任自动化 |
| 16 | npm README 验证：`npm view @sofagent/audit readme` + `npm view @sofagent/mcp readme` 均有内容 |
| 17 | 如果本次迭代暴露了新的流程漏洞，沉淀到本 SOP 的「历史教训」区 |
| 18 | **审查体系维护**：审视审查 prompt 是否需要更新——① 有没有通用检查点要加到回归清单？② 新问题类别有没有要加到陌生视角审查的？③ 审查 prompt 本身有没有过时的角色或问题？ |

---

## v0.92 教训（本 SOP 的由来）

| 问题 | 根因 | 规则 |
|------|------|------|
| CHANGELOG 版本说明停在 v0.81，后面 8 个版本无人续写 | 没有明确责任 | v0.99.5 起压缩为索引（详细在 docs/changelog/） |
| ROADMAP 「现在在哪」标题内容是旧版本的 | 改了标题没换内容 | 版本完成时三步更新 |
| 8 个 MD + 15 个脚本残留旧版本号 | 没有全量扫描 | 发布前 grep 全项目版本号 |
| 开发日志说「5 项没打勾」但实际已干完 | 代码改完没回头更新日志 | 开发日志是活文档，随改随写 |
| 开发直交审核，没自测 | 跳了一步 | 工程师必须自测 build+test 后再交审核 |
| 文档收尾完直接发布，没人确认 | 缺一个关口 | 发布前作者必须确认改动清单 |

## v0.99.5 教训（npm 发布链路 + 文档分工）

| 问题 | 根因 | 规则 |
|------|------|------|
| @sofagent/mcp 发布后 npm 上仍为旧版本 | 自动化链路未端到端验证 | 发布后必须 `npm view` 两个包确认版本号 |
| mcp 包 .npmignore 模式与 audit 不一致 | 两个包独立维护，没有对齐检查 | 两个包的 `.npmignore` 和 `files` 字段必须对齐 |
| `npm pack --dry-run` 显示 mcp 有 .js.map，但实际发布干净 | prepublishOnly 在 dry-run 时不触发 | 验证 npm 打包洁净度不能只看 dry-run |
| ROADMAP「未来去哪」残留已发布版本 | 「现在在哪」更新了但「未来去哪」没同步删 | ROADMAP 三步更新第 3 步必须做 |
| ROADMAP「现在在哪」堆积多个版本的详细表 | 版本历史细节放错了位置 | 版本历史归 CHANGELOG，迭代历程表保留（一行一版本） |
| 已打 tag 后发现需修改源码 | 不能 amend 已发布版本 | 涉及源码修改必须出新版本号 |
