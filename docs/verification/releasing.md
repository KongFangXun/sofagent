# sofagent 版本开发 SOP

> v0.95 实践沉淀。八阶段：审查→开发→自测→审核→文档收尾→确认关口→发布→发布后。
> 🔴 v0.95 起，版本号操作用 `bump-version.sh` + `check-version.sh`，禁止手动 grep/sed。
> 🔴 v1.0.3 起，文档预算分层检查（A 用户文档 / B 开发者参考 / C 审查体系 / D 设计 / E 指南），见 `check-docs.sh`。

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
| 3 | P0 安全硬伤 | 工程师 | 必须修，阻塞发布。**每修完一个 P0/P1，顺手在回归清单追加检查项——趁记忆新鲜，不要等到发版前才回忆。** |
| 4 | P1 工程欠债 | 工程师 | 应该修 |
| 5 | P2 改进 | 工程师 | 不阻塞发布 |
| 5.5 | 审查体系更新 | 工程师 | 随修复同步更新：① 回归清单追加检查项（编号递增）② 陌生视角 prompt 补充新盲区视角/任务。**不要等到阶段四才做——开发时记忆最新，随修随记** |

---

## 阶段三：自测

开发完成后、交审核之前，工程师先自己跑一轮：

| # | 步骤 | 验证方式 |
|:--:|------|------|
| 6 | `npm run build` | exit 0 |
| 7 | `npm test` | 全部通过 |
| 8 | `shellcheck sofagent/scripts/*.sh tools/*.sh FDE/fde-install.sh` | 零 error |
| 8.5 | 改动清单核对 | diff 确认只改了 changelog 规定的文件 |
| 8.6 | dist 与 src 同步验证（v1.0.4 教训）<br>`diff <(grep "关键命令" src/index.ts) <(grep "关键命令" dist/index.js)` | 无实质差异（排除编译格式化） |

---

## 阶段四：审核

| # | 步骤 | 谁做 | 验证方式 |
|:--:|------|:--:|------|
| 9 | 独立审核者逐项核对 changelog 每一项 | 审核者 | 逐文件读源码 |
| 9.5 | FAIL 项修复 | 工程师 | build + test 全绿 |
| 10 | 二次复核确认全部到位 | 审核者 | changelog 所有项 PASS |
| 10.5 | 回归检查：用回归清单逐项核对（当前维度数见清单文件头）<br>🔴 **必须开全新 session**——老 session 有上下文记忆，审查者知道"这东西是我修的"，会跳过怀疑。全新 session = 空白认知 | 审核者 | 全 PASS。发现回退→修复后重跑。新问题→追加检查项 |
| 10.6 | **审查体系维护**（本步骤在开发 session 中执行，不需要新 session——这是在更新文档，不是在审查）——基于本版本整个迭代的开发经验，更新两套审查体系：<br>① **回归清单**：把本版本修过的 P0/P1 抽象为检查项追加到清单。开发过程中已随修随记，本步骤做最后核对——有没有遗漏？<br>② **陌生视角 prompt**：本版本暴露了哪些新盲区？把新视角/任务/攻击面补进 prompt。更新后的 prompt 下版本发布后用于独立审查 | 审核者/作者 | 回归清单检查项数 ≥ 上一版；陌生视角 prompt 新增任务/视角见于文件 diff |

---

## 阶段五：文档收尾（🔴 v0.92 踩坑最密集）

### 5.1 开发日志自更新

- 「质量验证」节补上本轮 `npm test` / `check-version` / `verify` / `npm pack` 的实际跑分结果（不要留占位符）
- 开发日志是活文档，代码改完立刻回写，不要等
- 独立审核的「发布检查清单」（`[x]` 格式）可放在 changelog 末尾，也可用「质量验证」命令输出替代——二者功能等价，不必重复

### 5.1.1 测试数字一致性（v1.0.4 教训）

CHANGELOG/ROADMAP 中声称的测试数必须与实际 `npm test` 输出一致。v1.0.4 曾写 455 但实际 465。

```bash
# 获取实际测试数
actual=$(npm test 2>&1 | grep 'Tests' | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+')
echo "实际测试数: $actual"

# 检查 CHANGELOG/ROADMAP 中写的数字
grep "$actual" CHANGELOG.md
grep "$actual" ROADMAP.md
# 如果 grep 不到 = 文档写错了
```

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

#### Step 2.5: 同步 package-lock.json（🔴 v1.0.3 教训）

bump-version.sh 改了 `package.json` 但不会自动同步 `package-lock.json`。必须手动执行：

```bash
npm install --package-lock-only
# 验证
grep -A3 '"sofagent/audit":' package-lock.json | grep '"version"'
grep -A3 '"sofagent/mcp":' package-lock.json | grep '"version"'
# 两个都应该是新版本号
```

#### Step 2.6: 手动排查（脚本未覆盖的边缘情况）

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
| `ARCHITECTURE.md` 正文"当前 vX.Y" | 正文引用，不是版本头格式 | bump 后 grep `当前 v` 检查并手动更新 |
| `package-lock.json` | bump-version.sh 不覆盖 | Step 2.5 用 `npm install --package-lock-only` 同步 |
| 正文中的历史引用 | "v0.94 新增"是溯源标记，不改 | 永远不改 |

#### Step 2.7: 新增 SKILL.md 覆盖检查（🔴 v1.0.3 教训）

新增 SKILL.md 文件（如 `LOOP/SKILL.md`）时，确认 check-version.sh 能检测到它。check-version.sh 用 `find -name 'SKILL.md'` 动态扫描，理论上自动覆盖——但 SKILL.md 的 version 字段必须用 3 段格式（如 `1.0.3`），否则 2 段比对会漏检 patch 差异。

```bash
# 验证所有 SKILL.md 被 check-version 覆盖
bash tools/check-version.sh 2>&1 | grep 'SKILL.md'
# 期望：所有 SKILL.md 文件都出现在列表中
```

#### 内容新鲜度检查

版本号更新不代表内容没变质。每次发布前逐项核对：

- [ ] 效果证据表——数据是否包含最新版本？
- [ ] 「vX.Y 不修 / 待修」的局限标注——是否已经修了但标注没动？
- [ ] 「尚无第三方实测数据」「尚无 ≥1 周样本」等事实断言——是否已经变了？
- [ ] README FDE 完成度——是否与交付层数匹配？
- [ ] 前置依赖表——新增工具是否需要新依赖？
- [ ] 英文版（README.en / EVIDENCE.en）内容是否与中文版同步？
- [ ] COMMUNITY.md 实验状态、contributor 数是否为当前实际状态？

#### 5.2.1 文档日期检查（🔴 v1.0.2 教训）

bump-version.sh 只改版本号**不改日期**。每次 bump 后必须手动检查：

```bash
# 检查所有 MD 文件头日期是否与当前发版日期一致
grep -rn '2026-07-' *.md docs/design/*.md | grep -v "docs/changelog/" | grep -v "docs/evidence/"
# 排除 changelog 历史（里面记的是发版当天日期，不该改）和 evidence 案例日期
```

重点检查（bump-version.sh 不覆盖的）：
- `LIMITATIONS.md` 文件头日期
- `docs/design/audit-design.md` 文件头日期
- `docs/design/daemon-design.md` 文件头日期
- `HANDBOOK.md` 依赖表日期
- `DEVELOPMENT.md` 依赖表日期
- `THANKS.md` 致谢日期

#### 5.2.2 changelog 文件命名一致性（🔴 v1.0.3 教训）

changelog 文件命名统一为 `vX.Y.Z.md`（三段式）。曾经 `v1.0.md` 是两段式，其他版本都是三段式，导致引用混乱。

```bash
# 检查 docs/changelog/ 下所有文件名都是三段式 vX.Y.Z.md
ls docs/changelog/*.md | grep -v -E 'v[0-9]+\.[0-9]+\.[0-9]+\.md'
# 期望：无输出（所有文件都是三段式）
```

### 5.3 CHANGELOG 两步

- [ ] 新增版本条目（摘要一句话 + 链接到 `docs/changelog/vX.Y.Z.md`）
- [ ] 索引列表按时间倒序排列，版本号与日期正确
- [ ] 🔴 **只写产品变更**——不含审查元信息（维度编号、模型名、轮次、视角数等）。这些属于内部过程，外部用户不关心

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

### 7.1 发布前检查（npm 包洁净度 + 推前预检）

```bash
# 🔴 v0.99.1 起铁律：推前预检必须全绿
bash tools/pre-push-check.sh            # 7/7 全绿（--quick 跳过 npm test/build，--audit-only 只跑审计）
bash tools/check-docs.sh                # 文档死链 + 预算 + Skill 行数

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
🔴 publish 前必须 build——npm publish 上传的是 dist/ 目录，如果不 build 直接 publish，npm 上是旧 dist

1. cd sofagent/audit && npm run build && npm publish --access public
2. cd ../mcp && npm publish --access public（mcp 依赖 audit，audit 已 publish 到 registry）
3. npm view @sofagent/audit version   # 验证：必须是新版本号
4. npm view @sofagent/mcp version     # 验证：必须是新版本号

── Step 2: git tag + push ──
5. git tag vX.Y.Z + git push origin vX.Y.Z
6. gh release create vX.Y.Z
   🔴 Release body **必须**包含开发日志链接：
   📖 [详细开发日志](./docs/changelog/vX.Y.Z.md)
   🔴 Release body 结构（参考上一版 Release，保持一致性）：
   - 一句话摘要（核心变更）
   - 分节：架构新增 / 审查修复 / 工具链 / 质量验证（视版本内容调整）
   - 质量验证用表格（检查项 + 结果）
   - 末尾开发日志链接

── Step 3: Skill 分发 ──
7. openclaw skills publish ./skill
8. openclaw skills publish ./FDE
9. openclaw skills publish ./LOOP（如果 LOOP/ 有变更）
10. clawhub skill publish ./skill && clawhub skill publish ./FDE
    # ClawHub 和 SkillHub 共享命名空间，推 ClawHub 即可，不需要额外推 SkillHub
11. 本地安装：
    cp skill/* ~/.workbuddy/skills/sofagent/
    cp skill/* ~/.openclaw/skills/sofagent/
    cp FDE/SKILL.md ~/.workbuddy/skills/sofagent-fde/
    cp LOOP/SKILL.md ~/.workbuddy/skills/sofagent-loop/（如果 LOOP/ 有变更）
12. iCloud 同步（可选）：cp FDE/* ~/Library/Mobile\ Documents/com~apple~CloudDocs/FDE工具包/
```

### 7.3 发布后验证

```bash
# Git
git tag -l | grep vX.Y.Z
gh release view vX.Y.Z

# 🔴 Release Notes 完整性检查（v1.0.3 教训）
# 1. body 不为空
# 2. 包含 📖 [详细开发日志](./docs/changelog/vX.Y.Z.md) 链接
# 3. 不是 Draft 状态
gh release view vX.Y.Z --json isDraft,body -q '.body | length'  # 期望 > 100
gh release view vX.Y.Z --json body -q '.body | contains("详细开发日志")'  # 期望: true

# npm
npm view @sofagent/audit version
npm view @sofagent/mcp version

# 🔴 关键：更新全局安装——npm publish 成功后 npm registry 已更新，
# 但开发者本地二进制仍是旧版本。不更新会导致 --version 输出旧版本号，
# 且测试时拿到的是旧功能（如 doctor 少检查项、A14 不存在等）
npm install -g @sofagent/audit@latest
sofagent-audit --version                    # 期望：vX.Y.Z（与 SSOT 一致）
sofagent-audit --doctor                     # 期望：与当前版本 doctor 项数一致

# 本地安装验证
bash tools/check-version.sh             # 期望: 全绿（含第 13 项 npm 二进制版本检查）
```

### 7.4 常见发布故障

| 故障 | 现象 | 解决 |
|------|------|------|
| mcp 版本落后 | `npm view @sofagent/mcp version` 显示旧版本 | mcp job 独立于 audit job，版本号需手动同步 |
| .js.map 泄露 | `npm pack --dry-run` 显示 .js.map | 检查 package.json `files` 是否包含排除模式 |
| README 空白 | npm 页面无 README | 检查 package.json `files` 是否引用了不存在的 README.md |
| npm publish 403 | `npm publish` E403 | 版本号已存在或 NPM_TOKEN 过期 |
| 全局二进制版本落后 | `sofagent-audit --version` 显示旧版本号 | npm registry 已更新但本地未重装。`npm install -g @sofagent/audit@latest` |

---

## 阶段八：发布后

| # | 步骤 |
|:--:|------|
| 15 | **npm 双包验证**：`npm view @sofagent/audit version` + `npm view @sofagent/mcp version` 必须都是最新版本号。不信任自动化 |
| 16 | npm README 验证：`npm view @sofagent/audit readme` + `npm view @sofagent/mcp readme` 均有内容 |
| 17 | 如果本次迭代暴露了新的流程漏洞，沉淀到本 SOP 的「历史教训」区 |
| 18 | **审查闭环**：① 发版后在**全新 session**（无任何开发上下文记忆）中用陌生视角 prompt 对已发布版本做独立审查 → 产出报告。🔴 **必须全新 session**——有开发记忆的审查者不是"陌生人"，zero-knowledge 是整个 prompt 的前提 ② 审查发现的新问题 → 下版本修复 → 修复后回到步骤 10.6 更新审查体系 ③ 审查体系持续自我进化——每版积累"下次审查会更锋利"的视角和检查项 |
| 19 | **SOP 自我进化**（FDE 提议 → 作者确认）：FDE 发版后自动跑一轮，生成 releasing.md 更新建议（diff 格式），作者确认后 apply。检查项：<br>① 本版本发布过程中遇到的流程漏洞 → 沉淀到「历史教训」区<br>② 检查本 SOP 中的数字是否过期（维度数、检查项数、doctor 项数等）<br>③ 本版本新增的工具/脚本是否已纳入对应阶段（如 pre-push-check.sh、check-docs.sh）<br>④ 把更新后的 releasing.md 同步到 LOOP.md 的映射表<br>⑤ 如果 FDE 未发现需更新项，输出"无需更新"报告——零变更也是有效结果 |

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

## v1.0.2 教训（日期 + 重编号 + CHANGELOG 纯度）

| 问题 | 根因 | 规则 |
|------|------|------|
| 4 份文档日期仍为 v1.0.1 的 07-04 | bump-version.sh 只改版本号不改日期 | 5.2.1 文档日期检查——bump 后手动检查所有文档头日期 |
| ROADMAP 3 个详情表 12 处 + HANDBOOK/DEVELOPMENT/THANKS 6 处版本引用未跟随重编号 | 版本重编号时只改了规划版本表，漏了详情表 | 版本重编号需全局 grep 所有 vX.Y.x 引用，区分"历史引用"（不改）和"未来规划引用"（必须改） |
| CHANGELOG 索引条目含"回归清单 138→143 维度"等审查元信息 | 发版时把审查体系更新混入了 CHANGELOG | 5.3 CHANGELOG 只写产品变更，不含审查元信息 |
| npx @sofagent/audit 不可用 | bin 名与包名不匹配 | bin 字段增加与包名同名的别名，或 README 给 npx -p 备选路径 |

## v1.0.3 教训（package-lock + check-version 范围对齐 + 文档分层）

| 问题 | 根因 | 规则 |
|------|------|------|
| package-lock.json 版本号未同步 | bump-version.sh 改 package.json 但不碰 lock 文件 | Step 2.5：bump 后 `npm install --package-lock-only` 同步 |
| check-version.sh 检测 LOOP/SKILL.md 用 2 段比对漏检 patch 差异 | SKILL.md 的 `found_2seg vs SSOT_2SEG` 在 v1.0.x 系列无法区分 patch 号 | check-version.sh SKILL.md 改为 3 段精确比对 |
| check-version.sh TS 文件头注释扫全文件，误报代码中的历史标注 | `grep -m2` 扫全文件，而 bump-version 只改前 10 行 | check-version 的 TS 头注释检测改为 `head -10 \| grep`，与 bump-version 范围对齐 |
| 文档总量 4922 行接近 5000 上限，一刀切预算无法区分用户文档和开发者文档 | check-docs.sh 用单一 TOTAL 统计所有未排除的 .md | 文档分层预算：A 用户文档(3600) + B 开发者参考(1500) + C 审查体系(3500) + D 设计(500) + E 指南(500)，A+B ≤ 5000 |
| LOOP/SKILL.md 版本号写 1.0.3 但 SSOT 还是 1.0.2 | DeepSeek 开发时写了目标版本号而非当前 SSOT | 开发 prompt 明确："不要 bump 版本号——开发完后再 bump" |
| launcher.ts 的 `as` 类型断言本地编译通过但 CI 失败 | CI 环境（Windows/Ubuntu）TS 类型检查比本地严格，`createDeepAgent` 的泛型无法直接 `as` 转换 | 对 optional dependency 的类型断言统一用 `as unknown as` 双重转换；本地 build 通过不代表 CI 通过，推前需在干净环境验证 |
| 发版后发现 CI 失败，tag 指向修复前的 commit | tag 在代码修复前就打了，Release workflow checkout 的是旧代码 | 修 CI 后必须移 tag 到修复 commit：`git tag -d vX.Y && git tag vX.Y <fix-commit> && git push origin :refs/tags/vX.Y && git push origin vX.Y` |
| FDE/package.json 版本号没被 bump-version.sh 覆盖 | bump-version.sh 只处理 audit/mcp 两个 package.json，漏了 FDE/LOOP | bump-version.sh 新增 [2b/13] 步骤处理 FDE/LOOP package.json；check-version.sh 新增对应检查项 |
| 回归检查清单维度 77 在发版前误报 npm latest != SSOT | 维度 77 检查 npm latest = SSOT，但发版前 npm 还没 publish，必然不等 | 维度 77 标注为「发布后验证」项；回归清单加时序说明节，明确发版前 npm latest = 旧版本是正常的 |
| v1.0.3 Release Notes 缺少开发日志链接、内容简略，与 v1.0.2 质量标准不一致 | `gh release create` 时 notes 写得仓促，SOP 7.2 Step 6 只写了「必须包含开发日志链接」但没有发布后验证检查 | 7.3 发布后验证新增 Release Notes 完整性检查项（见下文） |
| changelog 文件命名 `v1.0.md` 与其他版本 `v1.0.X.md` 不一致 | v1.0.0 发布时文件名只写了 `v1.0.md`（两段式），后续版本统一为 `v1.0.X.md`（三段式） | changelog 文件命名统一为 `vX.Y.Z.md`（三段式），禁止两段式 `vX.Y.md`；5.2.6 新增命名一致性检查 |

## v1.0.4 教训（测试数字一致性 + dist 同步 + 跨模块路径）

| 问题 | 根因 | 规则 |
|------|------|------|
| CHANGELOG/ROADMAP 写"455 测试全绿"但实际 465 | 文档写测试数时凭记忆而非实际 npm test 输出 | 5.1.1 测试数字一致性——发版前 grep 文档中的测试数 vs npm test 实际输出 |
| dist 与 src 不同步——新增 CLI 命令在 dist 中不存在 | 开发后忘了 npm run build，dist 仍是旧编译结果 | 阶段三 Step 8.6 新增 dist 同步验证步骤 |
| daemon.sh 读 `${SOFAGENT_DATA}/../skill/data/scoring.md` 与 doctor.ts 读 `join(dataDir, 'scoring.md')` 路径不一致 | shell 脚本和 TS 代码用不同方式拼接路径，没有交叉验证 | 回归维度 196：跨模块路径引用一致性——shell `${SOFAGENT_DATA}` 与 TS `dataDir` 拼接的路径必须一致 |
| 审查体系三份文档自身有死路径/数字不一致/编号重复 | 审查文档和被审查代码同步演化，但没有对审查文档自身的维护流程 | SOP 步骤 19 审查体系闭环——每次发版后审视审查 prompt 自身的数字、路径、视角是否过时 |
