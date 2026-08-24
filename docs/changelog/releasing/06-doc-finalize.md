# 阶段六：开发日志定稿 + 文档收尾

> 🔴 **前置闸门（v1.4.0 补 · 防跳阶段）**：阶段六开工前必须确认**阶段三~五已按 SOP 完成**——
> - 阶段三（fresh-eyes-loop 质量循环）：草稿产物存在 / driver verdict 产出（若应跑）——见 [03-quality-loop.md](./03-quality-loop.md) 步骤完成判据
> - 阶段四（审查体系合并更新）：本轮 finding 已按 A/B/C 分类并入四份审查文档——见 [04-review-system.md](./04-review-system.md)
> - 阶段五（release-gate 闸门）：**verdict=PASS**——见 [05-release-gate.md](./05-release-gate.md)
>
> 2026-08-23 v1.4.0 实证：跳阶段三~五直接进阶段六 → README.en 误删 46 行 + 测试数口径三处打架 + 返工补跑三阶段。**任一未完成 → 先回去补，禁止带病进文档收尾**。

---

## 开发日志标准结构

> **章节顺序铁律**（阶段一~二起遵守，定稿时复核）：合并版本（新功能 + BugFix 同版）时**新功能在前、BugFix 在后**。用户读 changelog 第一眼看到的应该是「这个版本带来了什么新价值」，不是「修了哪些坑」。BugFix 放前面会让用户觉得这只是个补丁版，掩盖了新功能的价值传达。背景段的两行概述同理——先写新功能一句话，再写 BugFix。

定稿时照抄以下骨架（开发期间作为活文档持续追加，此时归位）：

```markdown
# vX.Y.Z 开发日志 — {一句话主题}（{启发来源}）

> ✅ 已开发 · {交付日期}
> 前置依赖：{上一版本能力}
> 交付：{N 项} · **{M} tests across {K} packages 全绿** · {其他门禁全绿项}
> {设计文档/灵感来源链接，可选}

## 背景

{两行概述：本版主线 + 交付件协同关系}

### 交付清单速览

| # | 优先级 | 交付 | 一句话 | 详见 |
|---|:---:|------|--------|------|
| 一 | P0 | {交付名} | {一句话} | §一 |
| 二 | P1 | ... | ... | §二 |

> P0 = 核心承诺；P1 = 能力深化；P2 = 体验优化

---

## 一、{交付名}（P0 · {副标题}）

### 问题诊断 / 痛点
{为什么要有这个交付——当前缺什么}

### 实现 / 交付
{怎么做的——核心机制 + Mermaid/表格}

### 涉及文件
| 文件 | 改动 | 说明 |

### 验收标准
- [x] {可测量的完成条件}

---

## 二、{下一交付}（P1 · ...）

...

## 待明确事项
## 依赖
## 与后续版本的依赖

## 实现纪要（{交付日期} · {N 波次}）
{波次拆分 + 测试数明细表}

## 发布检查清单（汇总）

> 发版门禁总表——与各交付章节内的「验收标准」是两个层次：
> - **验收标准**（章节内）= 功能层面：这个交付件做没做到
> - **发布检查清单**（此处）= 发布层面：能不能发版（npm test / check-version / npm publish / git tag）

### 通用
- [ ] `npm run build` exit 0
- [ ] `npm test` 全绿（{M} 测试）
- [ ] `check-version.sh` 全绿
- [ ] `check-test-count.sh` 全绿
- [ ] `acceptance-test.sh` 全绿
- [ ] `check-docs.sh` 全绿 + 各层余量核对（超标先查分层口径/冗余，再上调预算——机制见下方「文档精简与优化机制」节）

### 质量循环
- [ ] fresh-eyes-loop verdict=PASS（或 clean stop）
- [ ] release-gate-loop verdict=PASS

### 版本号
- [ ] SSOT 版本号，N+ 文件同步
- [ ] 文档头日期统一
- [ ] ROADMAP 版本头更新
- [ ] 🔴 发版状态三件套核对（v1.3.6 新增 · fresh-eyes B19 根因）：`docs/WIKI.md` 状态表「当前版本/下一版」+ 尾部维护规则行、`docs/ROADMAP.md`「现在在哪」节、`docs/HANDBOOK.md`「近期版本新功能速览」节——三处版本号与 SSOT 一致，无旧版残留（历史叙述除外）。v1.3.5 教训：发版只更新了 WIKI 头部，状态表和尾注漏更，同文档三处版本打架

## 文档精简与优化机制（check-docs 相关）

> 🔴 **超标处理三原则（v1.3.9+ 分层修正 · 2026-08-22）**：`check-docs.sh` 任何层超标时，**先查口径、再查冗余、最后才上调预算**——禁止无脑上调。2026-08-22 实证：A 层余量曾只剩 11 行，根因是分层错位（包级 README 764 行 + tools/README 84 行混入用户文档层），修正口径后余量回到 845，无需上调预算。

**① 先查分层错位（最常见根因）**：统计口径是否混入"性质不符"的文档——
- 包级开发者文档（`engine/*/README.md`、`tools/README.md`）不应占 A 层（用户文档）预算——A 层 find 已排除，新增目录文档时先判断归属
- 持续增长型文档（`FORGE/lessons/` 经验沉淀）不应设硬上限——已排除出 B 层，由 F 软检查约束
- 判定标准：这份文档的读者是「用户」还是「开发者/内部」？后者 → 从用户层移出（改 check-docs.sh 的 find 排除并加注释）

**② 再查冗余（内容层）**：
- 活文档历史版本新能力段堆叠（check-docs 3b 自动检查，警告项）——「新能力段只留最新版，旧版去 CHANGELOG」（HANDBOOK 曾堆叠 v1.3.1~v1.3.8 六段漏网，2026-08-22 修复 + 3b 自动化）
- 跨文档重复主题 / 完全相同句（用 dup-check 脚本扫 >40 字符相同句）
- 已闭环的占位桩 / 历史 stub 泄漏到公共 API（scanSkillSafetyStub 案例，v1.3.9 清理——grep `stub|占位|TODO.*交付` 排查）

**③ 最后才上调预算（铁律）**：确属真实内容增长（非错位非冗余）→ 上调 LIMIT_* 并在注释记录「为什么涨 + 涨多少」（超标上调不删内容，但必须给理由，不留模糊地带）

**F 软检查配套（只提示不阻断，不计 ERRORS）**：
- `F-lessons`：FORGE/lessons 总量 >3000 行 → 提示整理。触发点：F 提示 或 **每 3 个发版周期（季度级）**。整理动作：归并同根因（只留一条 + 互相引用）/ 归档已泛化条目至 `FORGE/lessons/archive/` / 教训去考古（去日期去 run 编号）——详见 [FORGE/lessons/index.md 维护公约](../../../FORGE/lessons/index.md)
- `F-pkg`：包级 README 合计 >1500 行 → 提示精简

**发版时必做**：`check-docs.sh` 全绿 + 目测各层余量——**A/B 层余量 <100 行时预警**（下一版大概率继续加文档，提前规划精简或口径修正，避免发版中途被预算卡住）

## Release Notes（GitHub Release 发布用）

> 面向用户的发布说明——开发日志正文给开发者看，Release Notes（本段 + GitHub Release body）给用户看。
> **标准范本：v1.3.7 实际发布物（唯一锚点）**——[GitHub v1.3.7 Release](https://github.com/KongFangXun/sofagent/releases/tag/v1.3.7)。2026-08-20 实证：v1.3.0/1.3.1/1.3.7 三版同构（定位句 + H2 分节 + 质量验证表 + 尾链）；SOP 08 曾误写「简洁三段式」→ v1.3.8 发布时漏质量验证表与标题主题短语，被作者两次退回。
> 🔴 **铁律：发布时禁止把 changelog 内嵌段直接复制当 GitHub body**——本段是格式规范源头，GitHub body 由 [10-publish.md 5.0 三道工序](./10-publish.md) 生成；两处同源同构，但生成动作在阶段十，此段只定义标准。

### 格式规范（对照 v1.3.7 逐要素）

**① Title（release name）**：`vX.Y.Z — {emoji 主题短语}`
- 1-2 个核心交付的 emoji + 名词短语（v1.3.7：`v1.3.7 — 🏰 SubAgent 完整沙箱与场景驱动权限`）
- 主题短语与 body 首行定位句呼应（v1.3.7：title「沙箱与权限」↔ 首行「第一次在真正隔离的环境里」）
- ❌ 禁止裸版本号 `v1.3.8`（v1.3.8 教训，历版 8/8 均为「版本号 — 主题」惯例）

**② Body 五要素**（v1.3.7 逐项，缺一不可）：

```
{首行定位句：一句话故事，承接上版讲本版主线 + 1 个类比锚点。无标题行，直接开始}

## 🔨 核心变更
### {emoji} {功能领域 1}
- {变更点 1}（含技术锚点：tool 名/API 名/机制名）
- {变更点 2}
### {emoji} {功能领域 2}
- ...
### 🔒 BugFix（上版遗留）        ← 有 bugfix 时必加末节
- {P0/P1 修复要点}

## ⚠️ 破坏性变更
- {真实列出：MCP 工具数变化（列新 tool 名）/ 枚举扩展 / Schema 变化}
- {确实没有才写「无」——工具数变化和枚举扩展不算「无」，必须列出}

## ✅ 质量验证
| 检查项 | 结果 |
|------|:--:|
| npm test | {N} tests 全绿 ✅ |
| acceptance-test | {N}/{N} 场景全绿 ✅ |
| shellcheck | 零 error ✅ |
| check-version | {N}/{N} 全绿 ✅ |
| 回归检查 | {N} 维度 ✅ |
| release-gate | verdict=PASS ✅ |
| fresh-eyes | {N} 视角审查闭环 ✅ |

📖 [详细开发日志](./docs/changelog/vX.Y.Z/vX.Y.Z.md)
```

**v1.3.7 范本实测数据**（2026-08-20 实测，生成时对照）：title 主题短语 2 个 emoji 词 · 首行定位句 1 段 · H2 共 3 个（核心变更/破坏性变更/质量验证）· H3 小节 8 个（7 功能 + 1 BugFix）· 每小节 2-3 条 bullet · 质量表 7 行（表头 1 + 数据 7）· 尾链相对路径 `./docs/changelog/v1.3/v1.3.7.md` · body 总行 59 行。

### Release Notes 体例铁律（以 v1.3.7 为标准校准，仅约束此段与 GitHub body）

| # | 铁律 | 说明 |
|---|------|------|
| N1 | **Title + Body 五要素齐备**：title 主题短语 → 首行定位句 → H2 核心变更（分 H3 功能小节）→ H2 破坏性变更 → H2 质量验证表 → 尾链。缺一不可（v1.3.8 教训：漏质量验证表 + 漏标题主题短语，被作者两次退回） | 用户能扫到故事/变更/验证三要素 |
| N2 | **H3 小节内 bullet 单层**——每节 2-3 条，禁止三级展开；body 总长 ≤ 60 行 | 细节属于开发日志正文 |
| N3 | **破坏性变更禁止轻率写「无」**——MCP 工具数变化 / 枚举扩展 / 新导出必须列出（v1.3.4 教训：42→48 写了「无」） | 用户升级靠这个 |
| N4 | **首行定位句是故事不是功能列表**——承接上版 + 本版主线 + 一个类比锚点；功能细节放 H3 小节 | 用户秒懂本版干了什么 |
| N5 | **H3 小节标题带功能领域 emoji**（`### 🏰 SubAgent 完整沙箱`）——emoji 在领域名最前，语义化（🛡️ 安全/🔐 权限/⚙️ 基建/📊 计量/🔒 bugfix） | v1.3.7 八节全带 emoji |
| N6 | **标题三层不重复**——changelog H1（动词化故事，不带 emoji）≠ release title（名词化主题短语，带 emoji）≠ H3 小节（交付名，带 emoji）。同一交付名只出现在 H3 小节标题，不逐项罗列进 H1/title | v1.3.3 教训：H1 与 note 同 6 项逐字复读 |
| N7 | **质量验证表固定 7 项**（npm test / acceptance-test / shellcheck / check-version / 回归检查 / release-gate / fresh-eyes）——不可增减、顺序固定（v1.3.0/1.3.1 缺 release-gate/fresh-eyes 的教训） | 信任信号标准化 |
| N8 | **changelog 内嵌「## Release Notes」段 = GitHub body 同源**——本阶段（六）写入，阶段十一发布时按 10-publish.md 5.0 工序生成并自检（title 主题/定位句/H2 骨架/7 项表/尾链五对照），发布前禁止凭记忆手写简化（v1.3.8 教训：生成 prompt 手写 `--title "v1.3.8"` 丢主题） | 发布物与开发日志同步 |
| N9 | **定位句长度带硬上限**——首行定位句 ≤ 220 字符（含 emoji 与空格；六版实测：v1.3.5=142 / v1.3.4=144 / v1.3.9=157 / v1.3.6=207 / v1.3.7=236 / v1.3.8=259，后两版超线属于「多主线版」特例，常规版 140-210 区间）。生成后必跑 `gh release view vX.Y.Z --json body -q '.body' \| head -1 \| awk '{print length($0)}'` 实测，超 220 拆 H3 小节承载，不允许首行堆三个主句（v1.4.0 曾 321 字符被退回重写为 145） | 首行扫一眼能读完 |
| N10 | **BugFix 节标题逐字固定**——`### 🔒 BugFix（上版遗留）`，括号补语不可省（v1.4.0/v1.3.9 曾双版简写漂移为 `### 🔒 BugFix`，同批修复）。内嵌段与 GitHub body 双处同查：`grep -E "^### 🔒" changelog 与 gh release body`，任一处缺补语即视为漂移 | 读者知道这是补账不是本版功能 |
| N11 | **里程碑 🎉 前缀仅限 vX.Y.0**——`🎉 vX.Y.Z — ...` 格式只有次版本位为 0 的里程碑版可用，且 emoji 前缀在版本号前（不在短语尾部）；常规版一律 `vX.Y.Z — {emoji 短语}`，尾部不加装饰后缀。混用即漂移（v1.4.0 曾误加尾部 🎉 后修正为 `🎉 v1.4.0 — 🧩 ...` 里程碑格式） | 版本等级一眼可辨 |

### 体例铁律（防止跨版本漂移）

| # | 铁律 | 反例（禁止） |
|---|------|------------|
| 一 | **标题一句话主题**——不罗列功能清单 | `v1.3.1 — Ontology + 并行 + 身份码 + Onboard + Benchmark + 审批 + Trace + 错误 + MergeQueue + L4`（10 项罗列） |
| 二 | **开头 blockquote ≤ 4 行**——只放状态/前置/交付数+测试数/来源链接，不塞实现进度 | 开头 5-15 行把波次拆分/包级测试数全搬上来（与文末实现纪要重复） |
| 三 | **交付清单速览表必须有**——让读者一眼看到全貌 + 优先级 + 章节跳转 | 17 个章节平铺，无速览表，读者要扫完全文才知道交付了什么 |
| 四 | **章节带优先级前缀**（P0/P1/P2）——读者一眼看出核心 vs 配套 | `## 一、Ontology`（无优先级，不知是不是核心） |
| 五 | **每个交付都必须有验收标准**——用 `- [x]` 勾选格式，100% 覆盖 | 一半章节有验收、一半没有（体例分裂） |
| 六 | **子段按「问题诊断/实现/涉及文件/验收」四段式**——按需用，不用的不强行加，但顺序固定 | 交付 A 用四段式、交付 B 只有「实现」、交付 C 裸文字（同文档三种体例） |
| 七 | **规则口径单一事实源**——A1-A23 + E1/E2/E4 共 26 条注册（E3 并入 A11），生效 24 条（17 默认 + 7 扩展）。全文用同一套口径 | `共 21 条 + A20-A23 共 24 条`（21 和 24 双重计数，读者不知该信哪个） |
| 八 | **BugFix 表格独立成段**——不套「问题诊断/实现」四段式 | BugFix 用 Bug/处理方式两列表格即可，不硬套 |
| 九 | **emoji 风格全版本统一**——速览表与章节标题的 emoji 必须一致（同名同 emoji）；一个版本内要么全带要么全不带，不允许混用；emoji 放交付名最前面（`## 一、🔧 Ontology` 非 `## 一、Ontology 🔧`） | 交付 A/B/C 有 emoji、交付 D/E 没 emoji（同版本混用，扫目录视觉断裂） |
| 十 | **发布检查清单段必须有**——发版门禁总表（npm test / check-version / acceptance-test / npm publish / git tag），与章节内「验收标准」是两个层次 | 只有章节内功能验收，没有发版门禁总表（读者不知这版能不能发） |
| 十一 | **Release Notes 段必须有**——面向用户的发布说明（核心变更 / 新功能 / 破坏性变更），与开发日志正文（给开发者）是两个读者层 | 开发日志写得很细，但用户升级时看不到「这版破坏性变更是什么」 |

**强制项**：文件命名三段式 `vX.Y.Z.md` · 速览表不可省 · 验收标准 100% 覆盖 · 发布检查清单段不可省 · Release Notes 段不可省 · 测试数与 CHANGELOG/ROADMAP/LIMITATIONS/evidence 一致 · 规则口径全文统一。

---

## 操作步骤

| # | 步骤 | 验证方式 |
|:--:|------|------|
| 一 | **开发日志定稿**：按上方骨架归位，发布检查清单全部打勾。🔴 **定稿必须含「## Release Notes」段**（08 铁律十一——v1.3.9 发布前才发现该段缺失，补写后才进 gh release；缺该段 = 定稿不完整，打回） | 结构完整 + 清单打勾 + `grep -q "## Release Notes"` 开发日志 |
| 二 | **CHANGELOG 索引**：根 CHANGELOG.md 新增本版本索引条目（目录非详情） | 索引条目存在 |
| 三 | **发版日期同步**（详见下方脚本） | `bash tools/check/check-version.sh` 全绿 |
| 四 | **测试数一致性**：`bash tools/check/check-test-count.sh --quiet` 确认声称数与实际一致。**禁止手动报数——必须跑脚本** | 全绿 |
| 五 | **ROADMAP 同步**（详见 [07-roadmap-sync.md](./07-roadmap-sync.md)）：本版移出规划表→进迭代表；探索方向表清理已交付/已排期条目；版本号+日期更新；迭代表瘦身（老版本合并）。⚠️ **每次发版后还要做 ROADMAP 体检**（重复表/散落章节/死链/模糊版本号）——详见子文档「体检清单」 | ROADMAP 更新 |
| 六 | **全项目版本号扫描**：所有 package.json + 文档头版本号一致。🔴 **bump 中断恢复清单（v1.4.0 补 · 2026-08-23 实证）**：`bump-version.sh` 可能 EXIT 137 中断（后置步骤被杀），核心版本号已改但部分位置残留——**bump 后必须跑 check-version.sh 抓残留，命中后按以下清单补漏**：① 全量扫 `package.json`（根 + engine/* + FDE + FORGE）的 **4 个 section**（dependencies/devDependencies/peerDependencies/**optionalDependencies**——脚本只扫 3 个，mcp 的 @sofagent/daemon 在 optional 漏过）② `action.yml` 的 npm 包@版本格式（`@sofagent/audit@1.3.9`，正则 `@sofagent/[a-z-]*@[0-9]`）③ 文档头日期批量同步（14 文档 `· 2026-08-XX`，bump 只改版本不改日期）④ WIKI 状态表/尾部维护规则 + FORGE/FDE 文档日期 ⑤ package-lock.json version 字段 | check-version.sh 全绿 |
| 七 | **文档同步闭环**：changelog 每个功能点 → 对应项目文档有覆盖（详见下方按需文档表） | D6 清单零遗漏 |
| 八 | **changelog 文件命名一致性**：`ls docs/changelog/*/v*.md \| grep -v -E 'v[0-9]+\.[0-9]+\.[0-9]+\.md'` 期望无输出（全三段式）——**限定版本日志目录**（v1.3.9 修正：原 `docs/changelog/**/*.md` 会把 releasing/ 子目录的 SOP 文件误报为不合规，版本日志才是检查对象） | 无输出 |
| 九 | **文档预算确认**：`bash tools/check/check-docs.sh` 全绿——本阶段文档收尾会新增内容（README 新能力段/ROADMAP 迭代表行/HANDBOOK bullet 等）推高行数可能超 LIMIT；此处先跑提前暴露（v1.3.9 教训：阶段十 pre-push 才发现 B 层 9363>9300 超标，回阶段六补上调） | check-docs RC=0 |

---

## 发版日期同步脚本（步骤三）

```bash
TODAY=$(date -u +%Y-%m-%d)

# 1. 找到 bump 写入的旧日期（从 package.json 的首次提交日期推断）
OLD_DATE=$(git log --format="%ci" -1 --diff-filter=A -- package.json | grep -oE "[0-9]{4}-[0-9]{2}-[0-9]{2}" | head -1)
# 如果找不到，手动指定：OLD_DATE="2026-08-09"

# 2. check-version.sh 的 EXPECTED_DOC_DATE 改为今天
sed -i '' "s/EXPECTED_DOC_DATE=\"[0-9-]*\"/EXPECTED_DOC_DATE=\"$TODAY\"/" tools/check/check-version.sh

# 3. 批量更新文档头日期（旧日期 → 今天，只改 > vX.Y 开头的文档头行）
grep -rl "^> v[0-9].*· ${OLD_DATE}" --include="*.md" . \
  | grep -v "docs/changelog/" \
  | grep -v "docs/evidence/" \
  | xargs sed -i '' "s/· ${OLD_DATE}/· ${TODAY}/g" 2>/dev/null || true

# 4. 验证
bash tools/check/check-version.sh   # 期望：日期一致项全绿
```

> bump 详细指南（13 类位置 + package-lock 同步 + npm 铁律）见 [FORGE/playbook/version-bump.md](../../../FORGE/playbook/version-bump.md)。
> 文档同步详细指南（LIMITATIONS 覆盖 + 归属原则 + D6 闭环）见 [FORGE/playbook/doc-sync.md](../../../FORGE/playbook/doc-sync.md)。

---

## 按需文档

| 文档 | 什么时候更新 |
|------|------|
| `README.md` | FDE 完成度变化、效果证据更新、**新功能入口（新增能力段 + changelog 链接）** · **新能力段只留最新版本——旧版直接删不堆叠** · 每版开发完成后顺手优化 README 表达/结构/视觉 |
| `README.en.md` | **与 README.md 同步**——badge 自动改，但新能力段 + 测试数 + 规则数需手动同步（英文版易漏）· 同样只留最新版本新能力段 |

> **README 新能力段写入后必须语义交叉核对**（v1.3.9 起由阶段五移入本阶段——核对紧贴写入时机）：逐项对照 README.md/README.en.md「vX.Y 新能力」段与 CHANGELOG/changelog/vX.Y/vX.Y.Z.md 交付清单——新能力段每项都是**本版本真实交付**（非上版本残留），且本版本所有核心交付**均已出现在新能力段**。check-version.sh 只校验版本号字面一致，无法检测语义错配（如 v1.3.2 段写 v1.3.1 内容）——此项必须人工执行。
>
> 🔴 **README 新能力段替换安全步骤（v1.4.0 补 · 防误删）**——2026-08-23 实证：用脚本按「`## v1.3.9 新能力` 到 `## 为什么选`」范围替换时，**删除范围超预期**导致 README.en.md 误删 46 行（Why sofagent / Evidence / Docs 导航表整段消失，262→216 行）。替换必须三步走：
> ① **替换前 diff 预览删除范围**：`python3 -c` 定位起止 index 后先打印将删除的段落（或 `git diff --stat` 前后对比），确认边界正确（起止锚点要精确到「目标段结尾的下一节标题」，不是任意 ## 标题）
> ② **替换后验证关键段存在**：`grep -c "关键段标题"` 逐个确认（README: 为什么选/Why choose、Evidence、Docs 导航表、LICENSE 等结构段不能被吞）
> ③ **中英结构对称检查**：`grep -c "^## " README.md README.en.md` 两侧标题数一致（v1.4.0 实测 11:11 对称——不对称 = 有段被误删/误加）
>
> **测试数口径规则（v1.4.0 补 · 防三处打架）**：所有文档写测试数必须**带口径标注**——`workspace 口径`（引擎 12 包，check-test-count SSOT）vs `全量口径`（引擎 + DSH 插件 + OpenClaw 插件）。2026-08-23 实证：WIKI「2915/12 包」、ROADMAP「2903→2959」、changelog「2915+27+17」三处打架。写法统一：`全量 N（workspace M/12 包）`（如 ROADMAP 已改「2959 全量（workspace 2915/12 包）」）；纯 engine 语境用 workspace 口径并写清「12 包」。
| `ARCHITECTURE.md` | 架构决策或设计思路有变更 · 13/12 包口径一致性（13=npm 发布总数，12=有 test script） |
| `DEVELOPMENT.md` | 开发流程有变更 · 正文测试数声称同步（grep `XX 测试`，bump 后数字会过时） |
| `LIMITATIONS.md` | 新发现的局限或旧局限被消除 · 已知问题标注修复版本落点（写具体 v1.3.x，不写「未来版本」） |
| `HANDBOOK.md` | 用户使用习惯、FAQ 有变化 · 「已经能替你干的事」版本号 + 新能力列表 · 「现在还干不了的事」移除本版交付项 |
| `ROADMAP.md` | 五步更新（见上） |
| `CHANGELOG.md` | 新增版本索引条目（版本历史唯一权威入口） |
| `THANKS.md` / `docs/evidence/` | 效果证据与案例更新时——**证据强度分级标注**：公开可查（PR/issue/复现命令可验证）> 用户自报（脱敏第三方报告）> 自测自报（作者环境实测），标注跟着案例走；只维护最强少数案例，弱证据不进入对外叙事（防止自测当实证） |

### 防屎山规则（新增脚本/文档前必读）

| 规则 | 触发时机 |
|------|---------|
| **新增前置 grep** | 新增检查项/生成器/脚本/文档前，先 `grep -rn <功能关键词> tools/ engine/scripts/ docs/` 确认无同类实现；有则增量扩展，不新建 |
| **同类即抽** | 同类文件 ≥3 个时必须抽公共库（现状：tools/gen-* 系列 → `tools/gen/gen-draft-lib.mjs` 已抽） |

---

## 文档日期检查

bump-version.sh 只改版本号**不改日期**。每次 bump 后必须检查文档头日期：

```bash
DATE="$(date +%Y-%m-%d)"
grep -rn "$DATE" *.md docs/archive/design/*.md | grep -v "docs/changelog/" | grep -v "docs/evidence/"
# 期望：主要文档都匹配到当天日期
# 排除 changelog 历史（里面记的是发版当天日期，不该改）和 evidence 案例日期
```

## changelog 文件命名一致性

```bash
# 检查 docs/changelog/ 下所有版本日志文件名都是三段式 vX.Y.Z.md（限定版本目录，releasing/ 子目录 SOP 文件不属检查对象）
ls docs/changelog/*/v*.md | grep -v -E 'v[0-9]+\.[0-9]+\.[0-9]+\.md'
# 期望：无输出（所有文件都是三段式）
```
