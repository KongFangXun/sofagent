# sofagent 版本开发 SOP

> v0.95 实践沉淀。**十一阶段**：审查→开发→自测→代码审核→**回归清单验证**→回归检查→审查体系维护→文档收尾→确认关口→发布→发布后。
> 🔴 v0.95 起，版本号操作用 `bump-version.sh` + `check-version.sh`，禁止手动 grep/sed。
> 🔴 v1.0.3 起，文档预算分层检查（A 用户文档 / B 开发者参考 / C 审查体系 / D 设计 / E 指南），见 `check-docs.sh`。
> 🔴 回归检查已升格为**独立阶段**（阶段六）——需要全新 session，不再作为"审核"的子步骤。

---

## 阶段一：审查 → 开发日志

上一版本发布后，由陌生视角审查（fresh-eyes-review.md）驱动新版本的开发方向。

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
| 6 | 审查体系更新 | 工程师 | 随修复同步更新：① 回归清单追加检查项（编号递增）② 陌生视角 prompt 补充新盲区视角/任务。**不要等到阶段五和阶段七才做——开发时记忆最新，随修随记** |

**🔴 开发铁律（v1.0.3 教训）**：
- **开发完后再 bump 版本号**——不要在开发过程中提前 bump。工程师可能写了目标版本号而非当前 SSOT
- 对 optional dependency（如 deepagents）的类型断言统一用 `as unknown as` 双重转换——本地编译通过不代表 CI 通过

---

## 阶段三：自测

开发完成后、交审核之前，工程师先自己跑一轮。

> 🔴 **v1.1.0 教训·CLI 迁移门**：步骤 9（shellcheck）和步骤 12（acceptance-test）依赖当前版本的 CLI 命令名。如果本版本涉及 CLI 命令迁移（如旧命令改名、上帝包子命令拆到新包二进制），shellcheck 和 acceptance-test **跳过本阶段**，延后到阶段八文档收尾全部完成之后补跑——那时文档引用和脚本命令名都已更新完毕，跑出来才是真实结果。build + test（步骤 7/8）不受影响，正常执行。

| # | 步骤 | 验证方式 |
|:--:|------|------|
| 7 | `npm run build` | exit 0 |
| 8 | `npm test` | 全部通过 |
| 9 | `shellcheck sofagent/scripts/*.sh tools/*.sh FDE/fde-install.sh` | 零 error。⚠️ 涉及 CLI 命令迁移时跳过，延后到阶段八之后 |
| 10 | 改动清单核对 | diff 确认只改了 changelog 规定的文件 |
| 11 | dist 与 src 同步验证（v1.0.4 教训）<br>`diff <(grep "关键命令" src/index.ts) <(grep "关键命令" dist/index.js)` | 无实质差异（排除编译格式化） |
| 12 | `bash tools/acceptance-test.sh` — 28 个端到端场景：Fresh install → --init → --doctor → 正常 commit → 违规拦截 → --json → --ci → 首次提交 → hook 破坏 → --no-verify 检测 → config rules 过滤 → A2/A3/A4/A5/A6/A9/A10/A11 → E1-E4 扩展规则 → --strict exit code=2 → hook 迁移 → post-commit → hashVersion 混合格式 → history.jsonl 写入 → --json 违规输出 → post-commit 安装+丢失检测 | 全部 PASS。⚠️ 涉及 CLI 命令迁移时跳过，延后到阶段八之后 |
| 13 | **OpenClaw 综合验证**：执行 `docs/verification/openclaw-acceptance-test.md`（28 场景：审计管道全规则 + hook 机制 + hashVersion 混合格式 + SkillOpt 自净化 + DeepAgents Sub Agent + optional 依赖降级 + config rules 过滤） | 全部通过 |

---

## 阶段四：代码审核

在当前 session 中，拿着 changelog 当核对表，逐项确认每个改动存在且正确。核心价值不是"换模型"，而是"拿 changelog 当 checklist 逐项验证代码"——代码就在磁盘上，读 diff 验证不需要换脑子。真正的独立性验证交给阶段六。

| # | 步骤 | 谁做 | 验证方式 |
|:--:|------|:--:|------|
| 14 | 逐项核对 changelog 每一项 | 当前 session | 逐文件读源码/diff，逐项确认改动存在且正确，标记 PASS/FAIL |
| 15 | FAIL 项修复 | 当前 session（切回开发者角色） | build + test 全绿 |
| 16 | 二次复核确认全部到位 | 当前 session | changelog 所有项 PASS |

---

## 🔴 阶段五：审查体系合并更新（回归清单 + 陌生视角，一步完成）

> ⚠️ 本版本已开发完成，遇到的问题和情况都已清楚——**回归清单维度**和**陌生视角审查**在**同一步骤**一并更新，不要拆成两步。趁记忆最新，把"修过什么"和"下次从什么角度能一眼看出"同时写进去。

所有 P0/P1/P2 开发修复完毕、自测和代码审核全部通过后，执行以下步骤：

| # | 步骤 | 谁做 | 验证方式 |
|:--:|------|:--:|------|
| 17 | **合并更新两份审查文档**：① 汇总本版本所有修复项，抽象为回归检查维度（编号递增）写入 `regression-checklist.md`；② 同步把本版本暴露的新盲区 / 新视角 / 新攻击面写入 `fresh-eyes-review.md`。两项一并完成，不要留到后面 | 当前 session | `git diff` 显示两份文档均有新增；新增维度 ≥ 本版本修复数 |
| 18 | **当前 session 逐项验证**：每条新增回归维度跑一遍命令确认可执行；确认 `fresh-eyes-review.md` 新视角与回归维度互相印证、无矛盾 | 当前 session | 所有新增维度可执行 + 两份文档互相印证 |

> ✅ 完成 步骤 17 → 18 后，**开发 session 的文档工作已一气呵成**——回归清单 + 陌生视角审查全部在当前 session 更新完。接下来只有**阶段六需要开新 session 控制 OpenClaw**，到那时才停。

---

## 🔴 阶段六：OpenClaw 全面检查（开新 session 控制 OpenClaw）

**操作模式**：开一个**全新的 Agent session**（不要从开发 session 继续），在其中控制 OpenClaw 执行全面检查。OpenClaw 有 Bash tool 跑 grep/shellcheck/npm test，也有审计环境跑验收场景。

### OpenClaw 检查 Prompt（直接复制给新 session）

> 这份 prompt 已内嵌在 SOP 中，开新 session 时直接整段复制粘贴即可，无需重新生成。把 `vX.Y` 替换为下一个待发布的实际版本号。

```
# sofagent vX.Y 阶段六：OpenClaw 全面检查（独立 Session 执行）

## 你的角色
你是 sofagent vX.Y 的**独立发版审查者**。你对 vX.Y 的开发过程**一无所知**——没看过开发对话、dev-prompt、开发报告或审查记录。你只相信代码和文档的当前真实状态，以及亲手跑出来的命令结果。

## 执行步骤
1. 工作目录：/Users/kongfangxun/Workbuddy/sofagent（后续相对路径均基于此）
2. 读取 docs/verification/regression-checklist.md（重点看本版本新增维度）
3. 读取 docs/verification/openclaw-acceptance-test.md（端到端验收场景）
3.5 【v1.0.8 优化】构建审计包：在跑任何依赖 dist/ 的检查前，先 `cd sofagent/audit && npm run build`。否则 --version / --help banner / `ontology view` / `compose` 等基于 dist 的回归维度（#248 #251）与验收场景会命中 stale dist 误报 FAIL
4. 控制 OpenClaw 一次性执行两份报告：
   【报告一：回归检查】读 regression-checklist.md，用 Bash 跑全部维度验证命令，逐项输出 PASS/FAIL/SKIP。完成后将完整报告保存为 `~/Desktop/vX.Y-regression-report.md`
   【报告二：OpenClaw 验收】读 openclaw-acceptance-test.md，按场景逐一验证，逐项输出 PASS/FAIL/SKIP。完成后将完整报告保存为 `~/Desktop/vX.Y-acceptance-report.md`
5. 时序注意：
   - 标注「发布后验证」的项（如 npm latest 版本号）必然不满足 → 标 SKIP，不标 FAIL
   - 不在 OpenClaw 环境时，按验收文件降级说明跳过相应场景 → 标 SKIP，不标 FAIL
   - 任何 FAIL 必须是真实跑命令得到的失败，不凭猜测
6. 判定：两份报告全 PASS（或 SKIP 合理、无 FAIL）→ 回复"vX.Y 阶段六通过"。任何 FAIL → 不自行改代码，整理失败清单（维度/场景编号、现象、命令、期望vs实际）回复开发侧修复。

## 纪律
- 不创建/不修改任何代码或文档，只验证 + 生成报告
- 任何模糊、跑不通、对不上的维度如实标 FAIL 或写疑问，绝不因"应该没问题"放行
- 报告严格以对话形式执行验证，但最终报告必须保存到桌面文件——项目负责人在桌面上直接查看两份报告
```

### 判定与循环

| 结果 | 下一步 |
|------|--------|
| **全 PASS** | 进阶段七（最终确认两份审查文档） |
| **有 FAIL** | 你把两份报告带回开发 session → **回阶段五**（根据问题优化 `regression-checklist.md` + `fresh-eyes-review.md` 两个文档）→ 再开新 session 重跑本阶段 |

> 🔴 **循环测试机制**：阶段六任何 FAIL → 回**阶段五**（优化回归清单 `regression-checklist.md` + 陌生视角 `fresh-eyes-review.md` 两个文档）→ 再开新 session 控制 OpenClaw 重查。全部改完、阶段六全 PASS 后，进阶段七。最多循环 2 轮；2 轮仍不过则在报告中标注遗留问题，交开发侧决策。

**时序注意**：
- 回归清单中标注「发布后验证」的检查项（如 npm latest 版本号），在检查阶段必然不满足——这是正常的，不要标 FAIL
- OpenClaw 验收需要 OpenClaw 环境——如果当前 session 不在 OpenClaw 中，部分场景可跳过（prompt 中有降级说明）

---

## 阶段七：审查体系最终确认

> 本阶段在**开发 session** 中执行，更新文档，不需要新 session。

阶段五已合并更新两份审查文档，此处做**最终确认**：确认 `regression-checklist.md` 与 `fresh-eyes-review.md` 状态一致、无遗漏，本版本新盲区均已落档。若阶段六循环修复中暴露了新盲区，在此补充。

| # | 步骤 | 验证方式 |
|:--:|------|------|
| 21 | **最终确认两份审查文档**：regression 维度与 fresh-eyes 视角互相印证，循环修复中暴露的新盲区已补入 | 两份文档最终状态见于文件 diff |

**审查体系闭环**（v1.0.4 教训）：审查文档自身也会过时——每次发版后审视审查 prompt 的数字、路径、视角是否还有效。

---

## 阶段八：文档收尾（🔴 v0.92 踩坑最密集）

### 开发日志自更新

- 补上本轮 `npm test` / `acceptance-test` / `shellcheck` / `check-version` 的实际结果（不要留占位符）
- 开发日志是活文档，代码改完立刻回写，不要等
- 发布检查清单全部打 `[x]`（在阶段九确认关口之后）

### 测试数字一致性（v1.0.4 教训）

CHANGELOG/ROADMAP 中声称的测试数必须与实际 `npm test` 输出一致。v1.0.4 曾写 455 但实际 465。

```bash
# 获取实际测试数
actual=$(cd sofagent/audit && npm test 2>&1 | grep 'Tests' | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+')
echo "实际测试数: $actual"

# 检查 CHANGELOG/ROADMAP 中写的数字
grep "$actual" CHANGELOG.md
grep "$actual" ROADMAP.md
# 如果 grep 不到 = 文档写错了
```

### 全项目版本号扫描（🔴 v0.95 起用脚本，禁止手动 grep）

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
13. FDE/package.json + LOOP/package.json（v1.0.3 起）

**不碰**：正文中的历史引用（如 "v0.94 新增"）。这是正确设计。

#### Step 2: 一致性校验

```bash
./tools/check-version.sh
```

从 `package.json` 读 SSOT 版本号，逐项比对全项目 13 类位置。任何不一致 → 红字报错 + exit 1。

#### 同步 package-lock.json（🔴 v1.0.3 教训）

bump-version.sh 改了 `package.json` 但不会自动同步 `package-lock.json`。必须手动执行：

```bash
npm install --package-lock-only
# 验证
grep -A3 '"sofagent/audit":' package-lock.json | grep '"version"'
grep -A3 '"sofagent/mcp":' package-lock.json | grep '"version"'
# 两个都应该是新版本号
```

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
| `ARCHITECTURE.md` 正文"当前 vX.Y" | 正文引用，不是版本头格式 | bump 后 grep `当前 v` 检查并手动更新 |
| `package-lock.json` | bump-version.sh 不覆盖 | 「同步 package-lock.json」小节用 `npm install --package-lock-only` 同步 |
| 正文中的历史引用 | "v0.94 新增"是溯源标记，不改 | 永远不改 |

#### 🔴 版本重编号全局 grep（v1.0.2 教训）

版本重编号时（如 v1.0.x 系列内部跳号），只改规划版本表是不够的——ROADMAP 的详情表、HANDBOOK、DEVELOPMENT、THANKS 中的版本引用也要跟着改。必须全局 grep 所有 `vX.Y.x` 引用，区分"历史引用"（不改）和"未来规划引用"（必须改）。

```bash
# 搜所有含版本号的引用
grep -rn "v1\.0\.[0-9]" --include="*.md" . | grep -v "docs/changelog/" | grep -v "node_modules"
# 逐一判断哪些是"未来规划引用"（要改），哪些是"历史引用"（不改）
```

#### 新增 SKILL.md 覆盖检查（🔴 v1.0.3 教训）

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
- [ ] 🔴 README「当前版本」= 本次 git tag（文档版本号不得领先未打 tag 的版本；v1.1.0 起固化此核对项）
- [ ] 前置依赖表——新增工具是否需要新依赖？
- [ ] 英文版（README.en / EVIDENCE.en）内容是否与中文版同步？
- [ ] COMMUNITY.md 实验状态、contributor 数是否为当前实际状态？

#### 文档日期检查（🔴 v1.0.2 教训）

bump-version.sh 只改版本号**不改日期**。每次 bump 后必须手动检查：

```bash
# 检查所有 MD 文件头日期——把 DATE 替换为实际发版日期
DATE="$(date +%Y-%m-%d)"  # 或手动指定
grep -rn "$DATE" *.md docs/design/*.md | grep -v "docs/changelog/" | grep -v "docs/evidence/"
# 期望：主要文档都匹配到当天日期
# 排除 changelog 历史（里面记的是发版当天日期，不该改）和 evidence 案例日期
```

重点检查（bump-version.sh 不覆盖的）：
- `LIMITATIONS.md` 文件头日期
- `docs/design/audit-design.md` 文件头日期
- `docs/design/daemon-design.md` 文件头日期
- `HANDBOOK.md` 依赖表日期
- `DEVELOPMENT.md` 依赖表日期
- `THANKS.md` 致谢日期

#### changelog 文件命名一致性（🔴 v1.0.3 教训）

changelog 文件命名统一为 `vX.Y.Z.md`（三段式）。曾经 `v1.0.md` 是两段式，其他版本都是三段式，导致引用混乱。

```bash
# 检查 docs/changelog/ 下所有文件名都是三段式 vX.Y.Z.md
ls docs/changelog/*.md | grep -v -E 'v[0-9]+\.[0-9]+\.[0-9]+\.md'
# 期望：无输出（所有文件都是三段式）
```

### CHANGELOG 两步

- [ ] 新增版本条目（摘要一句话 + 链接到 `docs/changelog/vX.Y.Z.md`）
- [ ] 索引列表按时间倒序排列，版本号与日期正确
- [ ] 🔴 **只写产品变更**——不含审查元信息（维度编号、模型名、轮次、视角数等）。这些属于内部过程，外部用户不关心

### ROADMAP 三步

- [ ] 文件头版本号更新（keep 当前已发布版本，不是目标版本）
- [ ] 「现在在哪」替换为当前版本简表，旧内容迁移到「迭代历程」
- [ ] 「未来去哪」删掉已完成版本，TOC 同步

### 按需文档

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

### 🔴 CLI 迁移版本回归闸（v1.1.0 教训）

> 如果本版本涉及 CLI 命令迁移（旧命令改名、上帝包子命令拆到新包二进制），阶段三跳过的 shellcheck（步骤 9）和 acceptance-test（步骤 12）在**此处补跑**——文档收尾已完成，所有引用已更新，跑出来是真实结果。

```bash
# 补跑 shellcheck
shellcheck sofagent/scripts/*.sh tools/*.sh FDE/fde-install.sh   # 期望：零 error

# 补跑 acceptance-test
bash tools/acceptance-test.sh                                      # 期望：全部 PASS
```

> 如果 shellcheck/acceptance-test 因脚本未适配新命令而大量 FAIL，标注为已知遗留并写入下版本的 Wave 5 适配计划。

---

## 阶段九：确认关口

文档全部收尾后，**必须**让作者过一遍改动，确认没问题再交接给项目负责人发版。v0.92 的教训：文档收尾完直接发布，没人确认，导致遗留问题。

| # | 步骤 | 验证方式 |
|:--:|------|------|
| 22 | 展示全部改动清单 | `git diff --stat` |
| 23 | 作者逐项确认 | 重点看版本号、ROADMAP、CHANGELOG |
| 24 | 确认通过后，开发日志「发布检查清单」打 `[x]` | 不在文档收尾前打勾 |
| 25 | **AI 生成发布 prompt，交接给项目负责人**——发版命令由 AI 准备但绝不执行 | AI 输出完整的发布 prompt（含 npm publish / git tag / gh release / Skill 分发 / 发布后验证），项目负责人亲手跑 |

---

## 阶段十：发布（🔴 项目负责人根据 AI 生成的发布 prompt 亲手执行）

> AI 在阶段九确认关口生成一份完整的发布 prompt（含所有命令），项目负责人（孔放勋）拿到后亲手逐条执行。npm publish、git tag、gh release create 涉及凭证和权限，AI 绝不代劳。

### 发布前检查（npm 包洁净度 + 推前预检）

```bash
# 🔴 v0.99.1 起铁律：推前预检必须全绿
bash tools/pre-push-check.sh            # 14/14 全绿（v1.1.0 起全量 workspace）
bash tools/check-docs.sh                # 文档死链 + 预算 + Skill 行数

# 全部 12 包 .js.map 泄露检查 + 类型检查
for pkg in harness ontology eval core audit think mcp orchestrator daemon ab-test work模板市场 skillopt; do
  echo "=== $pkg ==="
  (cd sofagent/$pkg && npm pack --dry-run 2>&1 | grep -c '\.js\.map')  # 期望: 0
  (cd sofagent/$pkg && npx tsc --noEmit && echo "✅ tsc")
done
```

### 执行发布

**npm 先行策略**（v0.99.7 起推荐）：先手动发布 npm 全部包（按依赖顺序），再 git tag + push。即使 CI 失败，npm 包已就位。

> 🔴 v1.1.0 教训：12 包按依赖层分批发布——叶子包先发，消费方后发，npm workspace symlink 在 publish 时不生效，必须在 npm registry 上有真实包。

```
── Step 1: 全量 workspace build（拓扑序） ──
npm run build
# 根 package.json 按拓扑序链式构建，不用 --workspaces（不保证顺序）

── Step 2: 按依赖层分批 publish ──

🔴 第一层·叶子包（零 @sofagent 依赖，可并行）：
1. cd sofagent/harness   && npm publish --access public
2. cd ../ontology        && npm publish --access public
3. cd ../eval            && npm publish --access public
4. cd ../core            && npm publish --access public

🔴 第二层·依赖第一层（audit/orchestrator/skillopt 可并行）：
5. cd ../audit           && npm publish --access public
6. cd ../orchestrator    && npm publish --access public
7. cd ../skillopt        && npm publish --access public

🔴 第三层·依赖第二层（think/daemon 可并行）：
8. cd ../think           && npm publish --access public
9. cd ../daemon          && npm publish --access public

🔴 第四层·依赖第二+三层（ab-test/work模板市场 可并行）：
10. cd ../ab-test        && npm publish --access public
11. cd ../work模板市场   && npm publish --access public

🔴 第五层·收官（mcp 依赖 audit+orchestrator+think）：
12. cd ../mcp            && npm publish --access public

── Step 3: 验证全部 12 包 ──
for pkg in harness ontology eval core audit think mcp orchestrator daemon ab-test work模板市场 skillopt; do
  ver=$(npm view "@sofagent/$pkg" version 2>/dev/null)
  echo "@sofagent/$pkg: $ver"
done
# 期望：全部 = 新版本号

── Step 4: git tag + push ──
13. git tag vX.Y.Z + git push origin vX.Y.Z
14. gh release create vX.Y.Z
   🔴 Release body **必须**包含开发日志链接：
   📖 [详细开发日志](./docs/changelog/vX.Y.Z.md)

   🔴 Release Notes 标准格式：

   **Title**: `vX.Y.Z — {核心变更摘要} 🔧`（≤60 字，逗号分隔 2-4 个要点；末尾固定 🔧 表示工具更新，正式版里程碑用 🎉）

   **Body 结构**（分节制，每节用 `##` 标题，**节标题和表格带 emoji**）：

   ```markdown
   ## 🔨 核心变更

   ### {功能领域}（如"编排引擎"🔧 / "安全加固"🛡️ / "审计规则"🔍）
   - {一句话描述变更}

   ## ✅ 质量验证

   | 检查项 | 结果 |
   |------|:--:|
   | npm test | {N} tests 全绿 ✅ |
   | acceptance-test | {N}/{N} 全绿 ✅ |
   | OpenClaw 验收 | {N}/{N} 全绿 ✅ |
   | shellcheck | 零 error ✅ |
   | pre-push-check | {N}/{N} 全绿 ✅ |
   | 回归检查 | {N}/{N} 全绿 ✅ |

   📖 [详细开发日志](./docs/changelog/vX.Y.Z.md)
   ```

   **Emoji 规范**：
   - 标题末尾：🔧（常规版本）/ 🎉（里程碑，如 vX.Y.0 正式版）
   - 核心变更节：`## 🔨 核心变更`
   - 功能领域 emoji 按类型选：🔧 功能 / 🛡️ 安全 / 📝 文档 / 🔍 审查 / 🆕 新建
   - 质量验证节：`## ✅ 质量验证`，表格结果列每项带 ✅
   - 开发日志链接：`📖`

   **规范细则**：
   - 功能领域按变更重要性降序排列，安全修复优先于文档修复
   - 每个变更点用 `-` 列表，一句话说清楚做了什么（不写"为什么"——那在开发日志里）
   - 质量验证表格**固定 6 项**：npm test / acceptance-test / OpenClaw 验收 / shellcheck / pre-push-check / 回归检查
   - 测试数字写**实际值**（从 `npm test 2>&1 | tail -5` 获取），不写约数
   - 末尾**必须有**开发日志链接
   - **不含**审查元信息（模型名、审查轮次、P0/P1 标签）——那是内部过程

── Step 5: Skill 分发 + 本机升级 ──
🔴 v1.0.9 教训：skillhub CLI 语法与 clawhub 不同——`skillhub publish <path> --version X`（无 `skill` 子命令，无 --slug/--owner）
🔴 v1.0.9 教训：FDE 发布到 ClawHub 时 slug "fde" 冲突——必须用 --slug sofagent-fde

15. clawhub skill publish ./sofagent/skill --slug sofagent --owner KongFangXun
16. skillhub publish ./sofagent/skill --version vX.Y.Z
17. clawhub skill publish ./FDE --slug sofagent-fde --owner KongFangXun
18. skillhub publish ./FDE --version vX.Y.Z
19. **🔴 本机全局升级**（v1.0.7 教训——忘了更新本机安装，导致 QA 测试时跑的是旧版本）：
    npm install -g @sofagent/audit@latest
    sofagent-audit --version                    # 验证版本号
    sofagent-audit --doctor                     # 验证功能正常
20. 本地 Skill 同步：
    cp -r sofagent/skill/* ~/.workbuddy/skills/sofagent/
    cp -r sofagent/skill/* ~/.openclaw/skills/sofagent/
    cp FDE/SKILL.md ~/.workbuddy/skills/sofagent-fde/
    # v1.0.7 新增：Agent Skill（@sofagent-fde / @sofagent-audit）
    cp -r agents/SKILL/sofagent-fde/ ~/.workbuddy/skills/sofagent-fde/
    cp -r agents/SKILL/sofagent-audit/ ~/.workbuddy/skills/sofagent-audit/
    cp -r agents/SKILL/sofagent-fde/ ~/.openclaw/skills/sofagent-fde/
    cp -r agents/SKILL/sofagent-audit/ ~/.openclaw/skills/sofagent-audit/
```

> **💡 WorkBuddy Skill 自动同步说明**：作者的 WorkBuddy 已安装 sofagent skill。每次 sofagent skill 文件更新并 cp 到 `~/.workbuddy/skills/sofagent/` 后，WorkBuddy 客户端会自动同步本地 skill 内容——这是作者自己开发环境内的同步，**不影响 ClawHub/SkillHub 发布流程**。ClawHub（`clawhub skill publish`）和 SkillHub 仍然是每次发版必须执行的发布渠道，一个都不能少。

### 发布后验证

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

### 常见发布故障

| 故障 | 现象 | 解决 |
|------|------|------|
| mcp 版本落后 | `npm view @sofagent/mcp version` 显示旧版本 | mcp job 独立于 audit job，版本号需手动同步 |
| .js.map 泄露 | `npm pack --dry-run` 显示 .js.map | 检查 package.json `files` 是否包含排除模式 |
| README 空白 | npm 页面无 README | 检查 package.json `files` 是否引用了不存在的 README.md |
| npm publish 403 | `npm publish` E403 | 版本号已存在或 NPM_TOKEN 过期 |
| npm ENOTEMPTY（v1.0.9） | `npm install -g` 报 ENOTEMPTY rename 失败 | 清理全局 `node_modules/@sofagent/.audit-*` 残留目录后重试 |
| gh release TLS timeout（v1.0.9） | `gh release create` 报 TLS handshake timeout | 加 `--repo KongFangXun/sofagent` flag 重试 |
| ClawHub slug 冲突（v1.0.9） | `clawhub skill publish ./FDE` 报 Ambiguous slug | 加 `--slug sofagent-fde` |
| skillhub 语法错误（v1.0.9） | `skillhub skill publish` 报 invalid choice | skillhub 无 `skill` 子命令，直接 `skillhub publish <path> --version X` |
| A9 测试文件误报（v1.0.9） | commit-msg hook 拦截：测试文件中的注入向量被误报 | A9 已在 v1.0.9+post-release 跳过 `.test.`/`__tests__/`/`.fixture`；旧版本用 `--no-verify` |
| 全局二进制版本落后 | `sofagent-audit --version` 显示旧版本号 | npm registry 已更新但本地未重装。`npm install -g @sofagent/audit@latest` |

---

## 阶段十一：发布后

| # | 步骤 |
|:--:|------|
| 26 | **npm 双包验证**：`npm view @sofagent/audit version` + `npm view @sofagent/mcp version` 必须都是最新版本号。不信任自动化 |
| 27 | npm README 验证：`npm view @sofagent/audit readme` + `npm view @sofagent/mcp readme` 均有内容 |
| 28 | 如果本次迭代暴露了新的流程漏洞，**直接吸收进本 SOP 对应阶段**——不要存到单独章节。每条新规则标注版本号（如 `vX.Y 教训`）以便追溯 |
| 29 | **🔴 审查闭环——发布后陌生视角审查**：<br>① **全新 session**：开一个对开发过程完全不知情的 Agent session，让它读取 `docs/verification/fresh-eyes-review.md`（已在本版本阶段七中更新），对已发布版本做独立审查<br>② **产出审查报告**：报告中的问题不阻塞当前版本——它们进入**下一版本的阶段一**，作为驱动下一版开发方向的 P0/P1/P2 清单<br>③ **如果发现新问题** → 自动成为下一版 releasing 的输入（回到阶段一开始新的迭代）<br>④ **审查体系持续自我进化**：每版积累"下轮会更锋利"的视角和检查项 |
| 30 | **SOP 自我进化**（FDE 提议 → 作者确认）：FDE 发版后自动跑一轮，生成 releasing.md 更新建议（diff 格式），作者确认后 apply。检查项：<br>① 本版本发布过程中遇到的流程漏洞 → 直接吸收进对应阶段，标注版本号<br>② 检查本 SOP 中的数字是否过期（维度数、检查项数、doctor 项数等）<br>③ 本版本新增的工具/脚本是否已纳入对应阶段（如 pre-push-check.sh、check-docs.sh）<br>④ 把更新后的 releasing.md 同步到 LOOP.md 的映射表<br>⑤ 如果 FDE 未发现需更新项，输出"无需更新"报告——零变更也是有效结果 |
| 31 | **生成「下一版本开发 Prompt」到桌面**：综合 `ROADMAP.md`（未来规划）+ `CHANGELOG.md` + 下一版本 `docs/changelog/vX.Y.md`（若存在），生成开发 prompt 落盘 `~/Desktop/vX.Y-dev-prompt.md`。<br>**若下一版本 changelog 尚未创建**：先 ① 写新版本需求并产出 `docs/changelog/vX.Y.md`；再 ② 生成桌面开发 prompt |
| 32 | **🔴 输出「下一版本陌生视角审查 Prompt」**：本阶段结束前，必须输出一份可直接粘贴到**新 session** 的审查 prompt（模板见下方「下一版本审查 Prompt 模板」）。因为本版本已全部提交，需开新 session 运行该 prompt → 读 `fresh-eyes-review.md` → 对已发布版本做全新审查 → 产出驱动下一版本的 P0/P1/P2 清单，从而开启下一个版本的迭代 |

### 下一版本开发 Prompt 生成说明（步骤 31）

> 来源：下一版本的「开发日志」——在 `docs/changelog/` 中查找（若不存在则先按下方流程补建）。辅助输入：`ROADMAP.md`（未来去哪 / 规划）+ `CHANGELOG.md`（版本索引）。

**生成流程**：
1. 读 `ROADMAP.md` 的「未来去哪」节，提取下一版本规划方向
2. 读 `CHANGELOG.md` 确认下一版本号与索引条目
3. 读 `docs/changelog/vX.Y.md`（下一版本开发日志，若存在）—— 这是开发 prompt 的主体来源
4. 综合上述，生成开发 prompt 落盘 `~/Desktop/vX.Y-dev-prompt.md`（结构：问题描述 → 修复方案 → 验证方式 → 发布检查清单）

**若下一版本 changelog 尚未创建**（开发到下一版本时文件还不存在）：
1. 先写新版本需求，产出 `docs/changelog/vX.Y.md`（含问题描述 → 修复方案 → 验证方式 → 发布检查清单）
2. 再执行上方「生成流程」生成桌面开发 prompt

### 下一版本审查 Prompt 模板（步骤 32 输出，直接复制给新 session）

> 这份 prompt 已内嵌在 SOP 中，开新 session 时直接整段复制粘贴即可，无需重新生成。

```
# sofagent 下一版本陌生视角审查（独立 Session 执行）

## 你的角色
你是 sofagent 的**独立陌生视角审查者**。你对刚发布版本的开发过程一无所知，只基于审查体系文档做全新审视。

## 执行步骤
1. 工作目录：/Users/kongfangxun/Workbuddy/sofagent
2. 读取 docs/verification/fresh-eyes-review.md（陌生视角审查体系，已在本版本阶段七更新）
3. 按 prompt 中的视角 / 任务 / 攻击面，对已发布版本做独立审查，不依赖任何开发记忆
4. 产出审查报告：P0/P1/P2 问题清单，每个问题含「现象 + 复现 + 期望 vs 实际」
5. 报告直接在对话中输出：P0/P1/P2 问题清单逐项写在 session 回复里，**不落盘桌面文件**——项目负责人在 session 中直接读取

## 纪律
- 不修改任何代码 / 文档，只审查 + 生成报告
- 任何模糊 / 对不上的项如实标注，绝不因「应该没问题」放行
- 报告中的问题进入下一版本阶段一，作为驱动开发的清单
```

---

## 阶段速查表

| 阶段 | 名称 | 谁做 | 需要新 session？ | 产出 |
|:--:|------|:--:|:--:|------|
| 一 | 审查 → 开发日志 | 作者 | 是（陌生视角审查） | 审查报告 + 开发日志 |
| 二 | 开发 | 工程师 | 否 | 代码 + 随修随记的回归维度 |
| 三 | 自测 | 工程师 | 否 | build/test 全绿。涉及 CLI 迁移时 shellcheck/acceptance 延后到阶段八 |
| 四 | 代码审核 | 当前 session | 否 | 逐项 PASS 或 FAIL→修复 |
| **五** | **回归清单验证** | **当前 session** | **否** | **新增检查项全部 PASS** |
| **六** | **OpenClaw 全面检查（开新 session）** | **审核者控制 OpenClaw** | **🔴 是（全新认知；SOP 已内嵌检查 prompt；FAIL 回阶段五循环）** | **两份报告均全 PASS** |
| 七 | 审查体系最终确认 | 作者 | 否 | 两份审查文档状态一致、无遗漏（初版已在阶段五写入） |
| 八 | 文档收尾 | 作者 | 否 | CHANGELOG/ROADMAP/版本号/日期对齐。CLI 迁移版本在此处补跑 shellcheck/acceptance |
| 九 | 确认关口 | AI → **生成发布 prompt 交接** | 否 | git diff 确认 → 检查清单打勾 → 生成发布 prompt 交给负责人 |
| 十 | 发布 | **🔴 项目负责人亲手执行** | 否 | 按 AI 生成的发布 prompt 逐条执行：npm 双包 + git tag + gh release + Skill 分发 |
| 十一 | 发布后 | 作者 | 是（步骤 32 开新 session 审查） | npm 验证 + 陌生视角审查 → 生成下版本开发 prompt 到桌面（步骤 31）+ 输出审查 prompt（步骤 32）→ 自动进入下版本阶段一 |

---

