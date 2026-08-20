# 阶段八：开发日志定稿 + 文档收尾

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

### 质量循环
- [ ] fresh-eyes-loop verdict=PASS（或 clean stop）
- [ ] release-gate-loop verdict=PASS

### 版本号
- [ ] SSOT 版本号，N+ 文件同步
- [ ] 文档头日期统一
- [ ] ROADMAP 版本头更新
- [ ] 🔴 发版状态三件套核对（v1.3.6 新增 · fresh-eyes B19 根因）：`docs/WIKI.md` 状态表「当前版本/下一版」+ 尾部维护规则行、`docs/ROADMAP.md`「现在在哪」节、`docs/HANDBOOK.md`「近期版本新功能速览」节——三处版本号与 SSOT 一致，无旧版残留（历史叙述除外）。v1.3.5 教训：发版只更新了 WIKI 头部，状态表和尾注漏更，同文档三处版本打架

## Release Notes（GitHub Release 发布用）

> 面向用户的发布说明——开发日志正文给开发者看，Release Notes（本段 + GitHub Release body）给用户看。
> **标准范本：v1.3.7 实际发布物（唯一锚点）**——[GitHub v1.3.7 Release](https://github.com/KongFangXun/sofagent/releases/tag/v1.3.7)。2026-08-20 实证：v1.3.0/1.3.1/1.3.7 三版同构（定位句 + H2 分节 + 质量验证表 + 尾链）；SOP 08 曾误写「简洁三段式」→ v1.3.8 发布时漏质量验证表与标题主题短语，被作者两次退回。
> 🔴 **铁律：发布时禁止把 changelog 内嵌段直接复制当 GitHub body**——本段是格式规范源头，GitHub body 由 [11-publish.md 5.0 三道工序](./11-publish.md) 生成；两处同源同构，但生成动作在阶段十一，此段只定义标准。

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
| N8 | **changelog 内嵌「## Release Notes」段 = GitHub body 同源**——阶段八写入，阶段十一发布时按 11-publish.md 5.0 工序生成并自检（title 主题/定位句/H2 骨架/7 项表/尾链五对照），发布前禁止凭记忆手写简化（v1.3.8 教训：生成 prompt 手写 `--title "v1.3.8"` 丢主题） | 发布物与开发日志同步 |

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
| 一 | **开发日志定稿**：按上方骨架归位，发布检查清单全部打勾 | 结构完整 + 清单打勾 |
| 二 | **CHANGELOG 索引**：根 CHANGELOG.md 新增本版本索引条目（目录非详情） | 索引条目存在 |
| 三 | **发版日期同步**（详见下方脚本） | `bash tools/check/check-version.sh` 全绿 |
| 四 | **测试数一致性**：`bash tools/check/check-test-count.sh --quiet` 确认声称数与实际一致。**禁止手动报数——必须跑脚本** | 全绿 |
| 五 | **ROADMAP 同步**（详见 [08-roadmap-sync.md](./08-roadmap-sync.md)）：本版移出规划表→进迭代表；探索方向表清理已交付/已排期条目；版本号+日期更新；迭代表瘦身（老版本合并）。⚠️ **每次发版后还要做 ROADMAP 体检**（重复表/散落章节/死链/模糊版本号）——详见子文档「体检清单」 | ROADMAP 更新 |
| 六 | **全项目版本号扫描**：所有 package.json + 文档头版本号一致 | check-version.sh 全绿 |
| 七 | **文档同步闭环**：changelog 每个功能点 → 对应项目文档有覆盖（详见下方按需文档表） | D6 清单零遗漏 |
| 八 | **changelog 文件命名一致性**：`ls docs/changelog/**/*.md \| grep -v -E 'v[0-9]+\.[0-9]+\.[0-9]+\.md'` 期望无输出（全三段式） | 无输出 |

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
# 检查 docs/changelog/ 下所有文件名都是三段式 vX.Y.Z.md
ls docs/changelog/*.md | grep -v -E 'v[0-9]+\.[0-9]+\.[0-9]+\.md'
# 期望：无输出（所有文件都是三段式）
```
