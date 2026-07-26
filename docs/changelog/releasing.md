# sofagent 版本开发 SOP

> **十二阶段**：审查→开发→自测→代码审核→审查体系合并更新（含瘦身检查）→OpenClaw 全面检查→审查体系最终确认→文档收尾→工具脚本健康检查→确认关口→发布（含本地安装）→发布后。
> 🔴 版本号操作用 `bump-version.sh` + `check-version.sh`，禁止手动 grep/sed。
> 🔴 文档预算分层检查（A 用户文档 / B 开发者参考 / C 审查体系 / E 指南），见 `check-docs.sh`。
> 🔴 回归检查已升格为**独立阶段**（阶段六）——需要全新 session，不再作为"审核"的子步骤。

---

## 阶段一：审查（上一版本发布后问题收敛）

上一版本发布后，由发布后审查（fresh-eyes-review.md）驱动新版本的开发方向。**本阶段只做审查，不写开发日志**——开发日志的正式定稿移到阶段八（开发完、审查完、测试完之后），因为开发/审查/测试过程中会涌现大量 bug 修复，提前写必然漏。开发期间 changelog 作为活文档随改随记（见阶段八），但定稿与「发布检查清单打勾」统一在阶段八完成。

| # | 步骤 | 谁做 | 产物 |
|:--:|------|:--:|------|
| 1 | 上一版本接受独立审查（审查模型 + 工程模型），产出 P0/P1/P2 清单 | 作者 | 审查报告（→ 本版本 BugFix 批次来源） |

> **🔴 changelog 章节顺序铁律（v1.1.7 教训）**：合并版本（新功能 + BugFix 同版）时，**新功能在前、BugFix 在后**。用户读 changelog 第一眼看到的应该是「这个版本带来了什么新价值」，而不是「修了上个版本的哪些坑」。BugFix 放前面会让用户觉得这只是个补丁版，掩盖了新功能的价值传达。背景段的两行概述同理——先写新功能一句话，再写 BugFix。

### 开发日志标准结构（v1.1.8 起固化 · v1.2.0 校验补强）

阶段八定稿时照抄以下骨架（开发期间作为活文档持续追加，定稿时归位到该结构），避免 v1.1.7（交付 `###` 嵌套在 `## 背景` 里结构混乱）→ v1.1.8（确立实现纪要表）→ v1.1.9（编号顺序与铁律冲突）的演进漂移：

```markdown
# vX.Y.Z 开发日志 — {新功能一句话} + {BugFix 概要}

> 状态：已发布（tag vX.Y.Z）· 作者 · 日期
> 前置依赖：{上一版本能力}
>
> 开发完成快照：{交付数 + 测试数 + 版本 bump 状态}

## 实现纪要
| 交付 | 落点 | 说明 |
|------|------|------|
| 一 · {新功能A} | {文件} | {一句话} |
| … | … | … |
| 阶段一 · {上一版 BugFix 批次} | {N 条} | 先于新功能完成，按铁律记录置后 |

> 阶段一 = {上一版} BugFix 批次（{N} 条，P0×a·P1×b·P2×c）

## 背景
{两行概述：先新功能、后 BugFix（守铁律）}

## 交付一：{新功能A}（优先级）
### 问题诊断 / 实现 / 测试 / 明确不做（按需）
### 发布检查清单

## 交付二：{新功能B}
…

## BugFix 批次（阶段一 · {上一版} 发布后审查 N 项 · 🔧）
### 问题模式 / P0 清单 / 执行顺序 / 发布检查清单

## 发布检查清单（汇总）
### {新功能A} / {新功能B} / … / {BugFix 批次} / 通用
```

**强制项**：
1. 文件命名 `vX.Y.Z.md`（三段式，🔴 v1.0.3 教训）
2. 头部引用块：状态 + 前置依赖 + 开发完成快照
3. `## 实现纪要` 表格（v1.1.8 起标准，不可省）
4. 章节顺序铁律：新功能交付（一~N）在前，`## BugFix 批次` 独立章置后（**不编号为零**——编号零会误导为"应排最前"，与铁律冲突）
5. 每个交付含：问题 → 方案 → 验证 → 发布检查清单（L17 四要素）
6. 末尾 `## 发布检查清单` 汇总，按"新功能 → BugFix → 通用"排列
7. 测试数与 CHANGELOG/ROADMAP/LIMITATIONS/evidence 一致（D2 闸门）
8. 头部标注版本号状态（D5 闸门）

---

## 阶段二：开发

按优先级分三批，每批独立派发/回报/核实，禁止合并批次。

| # | 优先级 | 谁做 | 说明 |
|:--:|:--:|:--:|------|
| 3 | P0 安全硬伤 | 工程师 | 必须修，阻塞发布。**每修完一个 P0/P1，顺手在回归清单追加检查项——趁记忆新鲜，不要等到发版前才回忆。** |
| 4 | P1 工程欠债 | 工程师 | 应该修 |
| 5 | P2 改进 | 工程师 | 不阻塞发布 |
| 6 | 审查体系更新 | 工程师 | 随修复同步更新：① 回归清单追加检查项（编号递增）② 发布后审查文档（`fresh-eyes-review.md`）补充新盲区维度/任务。**不要等到阶段五和阶段八才做——开发时记忆最新，随修随记** |
| 7 | 版本号前置 bump | 工程师 | 开发完成后、自测前：`./tools/bump-version.sh <旧> <新>` → `./tools/check-version.sh` 全绿。npm 不动。**⚠️ 跨 session 场景**：如果开发 session 和发版 session 分离，版本号 bump 可留到发版 session 阶段三执行——开发 session 只需确保代码实现完成 + changelog 写好 |

**🔴 开发铁律（v1.0.3 教训）**：
- **🔴 版本号前置（v1.1.3 流程优化）**：开发完成后、进入自测（阶段三）之前，先跑 `bump-version.sh <旧版本> <新版本>` 把 13 类位置全部更新到目标版本号。然后跑 `check-version.sh` 确认全绿。这样测试阶段所有版本号已统一，不会出现「全局 v1.1.2 vs SSOT v1.1.3」的漂移。npm publish 仍在阶段十一，版本号一致性 ≠ 发布。
- 对 optional dependency（如 deepagents）的类型断言统一用 `as unknown as` 双重转换——本地编译通过不代表 CI 通过

### 🔴 开发 session 交付物清单闸门（v1.1.8 流程优化 · [详见索引](#附历史教训索引按版本倒序)）

> 🔴 v1.1.8 教训：开发 session 与发版 session 经常分离，发版 session 接手时不知道前面做到哪一步。交付前必须过这个闸门。

开发 session 交付代码时，**必须**确认以下交付物全部就绪：

| # | 交付物 | 验证方式 | 谁负责 |
|:--:|------|---------|:--:|
| D1 | **代码实现完成** | `npm run build` exit 0 + `npm test` 全绿 | 工程师 |
| D2 | **changelog 草稿持续更新** | `docs/changelog/vX.Y.md` 在开发期间随功能点 + 新增测试数持续追加（活文档）；**最终定稿在阶段八**，不在阶段一写 | 工程师 |
| D3 | **acceptance-test 补场景** | 按 changelog 功能点逐条 grep `FORGE/playbook/acceptance-test.sh`，零覆盖 = 未交付。**Step D 覆盖率闭环判定三项全 PASS** | 工程师 |
| D4 | **审查体系已更新** | `regression-checklist.md` 追加本版本新维度 + `fresh-eyes-review.md` 补充新盲区。**可留发版 session 阶段五补做**，但开发 session 须标注「待补」 | 工程师 |
| D5 | **版本号状态标注** | changelog 头部标注「开发期 SSOT 仍为 vX.Y.Z，版本号 bump 留发版 SOP」或已 bump 完成 | 工程师 |
| D6 | **项目文档同步清单**（v1.1.9 新增） | 从 `docs/changelog/vX.Y.md`「核心变更/交付」提取所有新功能关键词，列出「功能点 → 应在哪个文档出现」对照表。**归属原则**：详细机制写到权威文档（FDE.md / DEVELOPMENT.md / ARCHITECTURE.md），其他文档（HANDBOOK / README / PHILOSOPHY）一句话 + 链接引用，不重复展开。可留发版 session 阶段八执行，但开发 session 须产出清单 | 工程师 |

> **发版 session 接手检查**：D3/D4/D6 标「待补」→ 先补完才能进自测。绝不能跳过 D3（零覆盖新功能跑出全绿是假象）或 D6（文档零提及 = 用户不知道有这功能）。

---

## 阶段三：自测

开发完成后、交审核之前，工程师先自己跑一轮。

> 🔴 **v1.0.9 教训**：步骤 10（shellcheck）依赖当前版本的 CLI 命令名。如果本版本涉及 CLI 命令迁移（如旧命令改名、上帝包子命令拆到新包二进制），shellcheck **跳过本阶段**，延后到阶段八文档收尾全部完成之后补跑——那时文档引用和脚本命令名都已更新完毕，跑出来才是真实结果。build + test（步骤 8/9）不受影响，正常执行。acceptance-test 已挪到阶段6新 session 跑，不在本阶段执行。

> 🔴 **v1.1.3 教训**：每版本发版后，验收测试文件自身的功能也会过时——**场景数落后于代码实现、新增功能零覆盖**。在跑验收测试之前，必须先审查并更新 `FORGE/playbook/acceptance-test.sh`，确保本版本新增的每条功能都有对应的验收场景。

| # | 步骤 | 验证方式 |
|:--:|------|------|
| 8 | `npm run build` | exit 0 |
| 9 | `npm test` | 全部通过 |
| 10 | `shellcheck engine/scripts/*.sh tools/*.sh install.sh` | 零 error。⚠️ 涉及 CLI 命令迁移时跳过，延后到阶段八之后 |
| 11 | 改动清单核对 | diff 确认只改了 changelog 规定的文件 |
| 12 | dist 与 src 同步验证（v1.0.4 教训）<br>`diff <(grep "关键命令" src/index.ts) <(grep "关键命令" dist/index.js)` | 无实质差异（排除编译格式化） |
| 13 | **🔴 更新 `FORGE/playbook/acceptance-test.sh`**<br><br>**Step A — 对照 changelog 找出缺口**：<br>① 读本版本 `docs/changelog/vX.Y.md`，列出所有新增/变更的功能点<br>② 逐条 grep `FORGE/playbook/acceptance-test.sh`，确认每条功能有对应场景——**只新增场景，不改现有场景编号**<br><br>**Step B — 更新 `FORGE/playbook/acceptance-test.sh`**：<br>① 在最后一个场景与总结段之间追加新场景（用 `scenario N "描述"` 格式）<br>② 更新文件头第 4 行：场景总数 + 功能描述<br>③ 新场景使用已有辅助函数（`pass`/`fail`/`git_log_has`），遵守 pipefail 安全约定<br>④ 改后跑 `bash -n FORGE/playbook/acceptance-test.sh` 确认语法<br><br>**Step C — 同步 `FORGE/playbook/regression-checklist.md`**：<br>如果新场景暴露了之前遗漏的检查维度，追加到回归检查清单（编号递增）<br><br>**🔴 Step D — 覆盖率闭环判定**：<br>① **场景数声称 vs 实际对齐**：`DECLARED=$(head -5 FORGE/playbook/acceptance-test.sh \| grep -oE "[0-9]+ 个端到端" \| grep -oE "[0-9]+"); ACTUAL=$(grep -c "^scenario " FORGE/playbook/acceptance-test.sh); [ "$DECLARED" = "$ACTUAL" ]` 不一致 = P0<br>② **功能点逐条对照**：从 changelog「核心变更/交付」提取功能关键词，逐条 grep `FORGE/playbook/acceptance-test.sh`——零覆盖 = P0（回归测试无法发现该功能退化）<br>③ **失效场景清理**：`grep -rn "sofagent-audit --daemon" FORGE/playbook/acceptance-test.sh` 期望零命中 | `bash -n FORGE/playbook/acceptance-test.sh` 通过；**Step D 三项判定全 PASS** |

---

## 阶段四：代码审核

在当前 session 中，拿着 changelog（开发期活文档草稿）当核对表，逐项确认每个改动存在且正确。核心价值不是"换模型"，而是"拿 changelog 当 checklist 逐项验证代码"——代码就在磁盘上，读 diff 验证不需要换脑子。真正的独立性验证交给阶段六。最终定稿见阶段八。

| # | 步骤 | 谁做 | 验证方式 |
|:--:|------|:--:|------|
| 14 | 逐项核对 changelog 每一项 | 当前 session | 逐文件读源码/diff，逐项确认改动存在且正确，标记 PASS/FAIL |
| 15 | FAIL 项修复 | 当前 session（切回开发者角色） | build + test 全绿 |

---

## 🔴 阶段五：审查体系合并更新（回归清单 + 发布后审查 + 验收测试，一步完成）

> ⚠️ 本版本已开发完成，遇到的问题和情况都已清楚——**回归清单维度**、**发布后审查**和**验收测试场景**在**同一步骤**一并更新，不要拆成多步。趁记忆最新，把"修过什么"和"下次从什么角度能一眼看出"和"下次怎么能自动检出"同时写进去。

所有 P0/P1/P2 开发修复完毕、自测和代码审核全部通过后，执行以下步骤：

| # | 步骤 | 谁做 | 验证方式 |
|:--:|------|:--:|------|
| 16 | **合并更新三份审查文档（三份逻辑不同，区分对待）**：<br>**① regression-checklist.md（加法）**：汇总本版本所有修复项，抽象为回归检查维度（编号递增）写入。每发现一个问题加一条——这是精确清单，膨胀靠瘦身控制<br>**② fresh-eyes-review.md（校准，不是加法）**：按下方「fresh-eyes-review 升级优化」决策树处理本版本审查中的预料外发现。**⚠️ 不要往 fresh-eyes-review 里加精确检查项**——它是留白式的直觉审查，加检查项会让它退化成第二个 regression-checklist（v1.2.0 刚从 826 行砍到 274 行修复了这个问题）<br>**③ acceptance-test.sh（可自动化验证的发现）**：如果 fresh eyes 审查报告中的 P0/P1 问题可以通过 CLI 命令/grep/bash 自动化验证，**同步追加到 `FORGE/playbook/acceptance-test.sh`**（追加场景，编号递增）。手法与阶段三·步骤 13 Step B 相同——`scenario` 编号 + 中文注释 + 断言。**为什么需要这一步**：regression-checklist 是人工巡检用的，acceptance-test 是机器跑的——如果一个 bug 可以被自动化检出，把它只放在 regression-checklist 里等于每次发版都要人工跑一遍。让它进 acceptance-test 才能让机器替你记住。 | 当前 session | `git diff` 显示三份文档均有更新（fresh-eyes 可能无变更，见下说明）；regression 新增维度 + acceptance-test 新增场景 ≥ 本版本修复数 |
| 17 | **当前 session 逐项验证**：每条新增回归维度跑一遍命令确认可执行；确认 `fresh-eyes-review.md` 新维度与回归维度互相印证、无矛盾 | 当前 session | 所有新增维度可执行 + 两份文档互相印证 |

> ✅ 完成 步骤 16 → 17 后，**开发 session 的文档工作已一气呵成**——回归清单 + 发布后审查全部在当前 session 更新完。接下来只有**阶段六需要开新 session 控制 OpenClaw**，到那时才停。

> 🔴 **防膨胀自检 + 瘦身检查（v1.1.7 起，覆盖回归清单 + 验收脚本两份验证文件，每版本执行）**：两份验证文件历史上都曾严重膨胀——回归清单曾达 288 维度（3686 行，2026-07-18 治理归并），验收脚本 `FORGE/playbook/acceptance-test.sh` 在 v1.1.7 优化前达 3207 行。为防止"每次单纯堆砌、几版就不可维护"，**每版本发版都做一轮瘦身**（既然每版都做，单次瘦身量小、负担可控）。流程：先跑轻量自检看两个数，再对越线或冗余处做深度瘦身。

**Tier 1 — 防膨胀轻量自检（每版本，步骤 16-17 之后立即跑）**

| # | 步骤 | 谁做 | 验证方式 |
|:--:|------|:--:|------|
| 18 | **🔴 防膨胀轻量自检（每版本）**：更新完两份审查文档 + acceptance-test.sh 后，立即跑以下自检：<br>**① 行数警戒线**：`WC_CHK=$(wc -l < FORGE/playbook/regression-checklist.md)` 超 1000 → 触发深度瘦身；`WC_ACC=$(wc -l < FORGE/playbook/acceptance-test.sh)` 超 1500 → 触发深度瘦身<br>**② 声称一致性**（复用阶段三步骤13 Step D①）：regression-checklist 标题声称维度数 = 实际 `#### ` 数（当前 38）；acceptance-test.sh 文件头声称场景数 = 实际 `^scenario ` 数（当前 102）；不一致 = P0<br>**③ 公共函数复用**：acceptance-test.sh 中同一段 git 脚手架 / node -e 内联 / 多行 if-else 重复 ≥3 次且可抽为函数 → 标 P2 待瘦身 | 当前 session | 两份文件行数均在警戒线内 + 两项声称一致 |

**Tier 2 — 深度瘦身（每版本，步骤 18 之后）**

| # | 步骤 | 谁做 | 验证方式 |
|:--:|------|:--:|------|
| 19 | **深度瘦身——逐维度/逐场景过检查项**：<br>**回归清单（regression-checklist.md）**：① **工具覆盖？**该维度是否已被 pre-push-check.sh / check-docs.sh / acceptance-test.sh 全量覆盖 → 移除（标 `[vX.Y.Z 移除: 被XX工具覆盖]`）② **命令还跑得通？**引用的路径/CLI 名/grep 模式是否仍有效，失效 >2 版 → 移除，小修可用 → 更新 ③ **与其它维度重叠？**关键词 grep 同 section ≥50% 目标文件重叠 → 归并，主编号保留、其余降为 `# 子项:`，空闲编号回收<br>**验收脚本（FORGE/playbook/acceptance-test.sh）**：④ **重复可抽？**同一段 git 脚手架 / dist 检查 / node -e 内联 / 多行 if-else 重复 ≥3 次 → 抽为公共函数（如 `mktmp_repo`/`require_dist`/`assert_js`/`assert_rc`/`assert_grep`），场景改单行调用 ⑤ **场景可并？**相邻场景是否在做同一能力正常/异常触发 → 合并为一个场景内多断言，减场景总数膨胀 | 当前 session | 清单 ≤1000 行；脚本 ≤1500 行；归并维度有 `> 归并自：` 注释；移除维度有 `[vX.Y.Z 移除]` 标注 |
| 20 | **瘦身自验证**：① 跑维护公约自校验脚本确认标题声称数 = 实际 `#### ` 数 ② `bash -n FORGE/playbook/acceptance-test.sh` 语法通过 ③ 跑 `bash FORGE/playbook/acceptance-test.sh` 确认场景数不变、全 PASS | 当前 session | 三项全 PASS |

> 💡 **节奏**：每版本必跑 Tier 1（步骤18）+ Tier 2（步骤19-20）。因为每版都做，单次瘦身量小、负担可控——这也是 v1.1.7 的教训：验证文件一旦放任堆积，几版就会回到 3000+ 行不可维护状态。

**Tier 3 — fresh-eyes-review 升级优化（每版本，v1.2.0 起）**

> 🔴 **核心认知**：fresh-eyes-review 和 regression-checklist 的更新逻辑**根本不同**。regression-checklist 是精确清单（加法：每发现一个问题加一条检查项）。fresh-eyes-review 是留白式的直觉审查（校准：每发现一个问题校准视角敏感度，不是加检查项）。过去十几个版本把两者混为一谈——每发现一个 bug 就往 fresh-eyes 对应维度加一条检查项，导致它从"凭直觉发现问题"膨胀成"第二个 regression-checklist"（826 行）。v1.2.0 重写为 274 行才修复。本 Tier 守住这条底线。

本版本审查（阶段四代码审核 + 阶段六 OpenClaw 检查 + 上一版阶段十二 fresh-eyes 审查报告）中如果产生了**预料外的发现**（不在 regression-checklist 已有维度覆盖范围内、审查者凭直觉/意外发现的），走以下决策树：

```
预料外发现
    │
    ├─ 是可精确描述的具体问题模式？
    │   │
    │   ├─ 可通过 CLI 命令/grep/bash 自动化验证？
    │   │   └─ ✅ 写进 regression-checklist（加新维度，编号递增）
    │   │       ✅ 写进 acceptance-test.sh（加新场景，编号递增）
    │   │       不动 fresh-eyes-review
    │   │
    │   └─ 不可自动化验证（需人工判断上下文）？
    │       └─ ✅ 写进 regression-checklist（加新维度，编号递增）
    │          不动 fresh-eyes-review
    │
    ├─ 是"审查者凭直觉嗅到、但无法写成精确检查项"的系统性盲区？
    │   └─ 走 fresh-eyes-review 三选一升级（见下）
    │
    └─ 是偶发问题、无规律？
        └─ ❌ 不动任何审查文档（记在 changelog 即可）
```

**fresh-eyes-review 三选一升级**（当发现属于"直觉可感但无法精确化"时）：

| 动作 | 什么时候用 | 怎么做 | ⚠️ 禁忌 |
|------|-----------|--------|---------|
| **A. 新增视角** | 预料外发现属于一个全新的审查角度，现有 12 个视角都没覆盖 | 新增一个视角（角色+心态+举例），给审查者自由发挥的空间 | ❌ 不要写成检查清单（"检查 X 是否 Y"）。✅ 写成"你是一个 X，你会注意到……" |
| **B. 校准现有视角** | 预料外发现属于现有某视角的覆盖范围，但该视角对这类问题敏感度不足 | 在该视角的"你可能会关注的方向"举例区补一条，或者微调心态描述 | ❌ 不要把举例区变成必查清单。✅ 保持"举例，不是清单"的措辞 |
| **C. 更新历史教训** | 预料外发现是一个反复出现的系统性问题模式（≥2 个版本） | 在末尾「附：历史教训」补一条经验提醒 | ❌ 不要写成检查项。✅ 写成"过去在 X 出过问题，保持敏感" |

| # | 步骤 | 谁做 | 验证方式 |
|:--:|------|:--:|------|
| 21 | **fresh-eyes-review 升级优化**：① 回顾本版本所有预料外发现，逐一走决策树分类 ② 需要升级的走三选一（A/B/C）③ **风格守护自检**（见下）④ 确认本版本审查中「可自动化验证的发现」已同步追加到 `acceptance-test.sh`（`grep -c "关键词" FORGE/playbook/acceptance-test.sh` ≥ 1） | 当前 session | `git diff fresh-eyes-review.md` 显示有更新（或确认本版本无需更新）；风格守护自检全 PASS；acceptance-test 关键词可 grep |

**风格守护自检**（每次更新 fresh-eyes-review 后必跑，防止退化）：

```bash
# 1. 行数守护：不超过 350 行（v1.2.0 重写后基线 274 行，留 76 行弹性空间）
WC=$(wc -l < FORGE/playbook/fresh-eyes-review.md)
[ "$WC" -gt 350 ] && echo "🔴 行数膨胀（$WC > 350）——检查是否在加精确检查项" || echo "✅ 行数正常（$WC）"

# 2. 反清单化守护：不应出现精确检查命令（grep/命令式断言应为 0 或极少）
#    fresh-eyes 的举例应该是"你可能会注意到……"，不是"跑 grep X 确认 Y"
CMD_COUNT=$(grep -cE '(grep|bash|npm|wc -l|test -)' FORGE/playbook/fresh-eyes-review.md || echo 0)
[ "$CMD_COUNT" -gt 5 ] && echo "🟡 命令引用偏多（$CMD_COUNT 处）——确认都是举例而非检查项" || echo "✅ 命令引用适度（$CMD_COUNT 处）"

# 3. 视角数守护：当前 12 个视角，新增需谨慎（每个视角增加审查者一轮工作）
VIEWS=$(grep -c '^### ' FORGE/playbook/fresh-eyes-review.md)
[ "$VIEWS" -ne 12 ] && echo "🟡 视角数变化（当前 $VIEWS，基线 12）——确认是刻意调整" || echo "✅ 视角数稳定（$VIEWS）"
```

> 💡 **什么时候 `git diff` 显示无变更也是正常的**：如果本版本审查中所有预料外发现都属于"可精确描述的具体问题模式"，它们全部进了 regression-checklist，fresh-eyes-review 本版本无需更新。零变更 = 审查体系稳定，不是遗漏。

---

## 🔴 阶段六：OpenClaw 全面检查（开新 session 控制 OpenClaw）

**操作模式**：开一个**全新的 Agent session**（不要从开发 session 继续），在其中控制 OpenClaw 执行全面检查。OpenClaw 有 Bash tool 跑 grep/shellcheck/npm test，也有审计环境跑验收场景。

> **统一执行入口**（v1.1.5 更新）：本阶段在一个全新 session 里**顺序跑完 acceptance-test + regression-checklist 两份检查**——先跑 acceptance-test.sh（端到端全场景），再跑 regression-checklist.md（文档级回归）。两检查串行有依赖：regression-checklist 的维度24（检查 acceptance-test 健康度）可以引用前一步的真实结果做对照，而不是干 grep。acceptance-test 不在开发 session 跑（避免确认偏差），统一在本阶段由独立审查者执行。

### OpenClaw 检查 Prompt（直接复制给新 session）

> 这份 prompt 已内嵌在 SOP 中，开新 session 时直接整段复制粘贴即可，无需重新生成。把 `vX.Y` 替换为下一个待发布的实际版本号。

```
# sofagent vX.Y 阶段六：OpenClaw 全面检查（独立 Session 执行）

## 你的角色
你是 sofagent vX.Y 的**独立发版审查者**。你对 vX.Y 的开发过程**一无所知**——没看过开发对话、dev-prompt、开发报告或审查记录。你只相信代码和文档的当前真实状态，以及亲手跑出来的命令结果。

## 执行步骤（一个 session 顺序跑完，不拆分）
1. 工作目录：/Users/kongfangxun/Workbuddy/sofagent（后续相对路径均基于此）
2. 【v1.0.8 优化】构建审计包：在跑任何依赖 dist/ 的检查前，先 `cd engine/audit && npm run build`。否则 --version / --help banner / `ontology view` / `compose` 等基于 dist 的回归维度与验收场景会命中 stale dist 误报 FAIL
3. **🔴 端到端验收测试** —— `bash FORGE/playbook/acceptance-test.sh`，跑完全部场景。记录结果：场景数 / 通过数 / 失败数 / 失败场景编号清单。⚠️ 涉及 CLI 命令迁移时 acceptance-test 可能大量 FAIL——如果是因为脚本引用了已废弃命令（如 `sofagent-audit --daemon`），标 SKIP 并说明原因，不算真 FAIL
4. **回归检查** —— 读 `FORGE/playbook/regression-checklist.md`，用 Bash 跑全部维度验证命令，逐项输出 PASS/FAIL/SKIP。**维度24（验收测试覆盖率）此时可引用步骤3 acceptance-test 的真实结果做对照**，而不是干 grep。**维度 50（文档乱码扫描）必须跑**——v1.2.0 发版中在多个文档反复发现 UTF-8 损坏（U+FFFD/mojibake），这是编码系统性问题，不跑就发现不了
5. **🔴 覆盖率交叉检查（v1.1.4 教训——acceptance-test 对新功能零覆盖）** —— 读 `docs/changelog/vX.Y.md`「核心变更/交付」章节，提取每条功能关键词（如新规则号 A18/A19、新模块 FORGE/USB/工具注入等）。逐条 grep `FORGE/playbook/acceptance-test.sh`，确认每条功能都有对应场景。**零覆盖 = FAIL**（回归测试无法发现该功能退化）
6. 时序注意：
   - regression-checklist 头部「⏰ 时序说明」标记的检查项（git tag / npm registry / 全局二进制版本），发版前必然不满足 → 标 ⏳（待发版），不标 FAIL
   - 不在 OpenClaw 环境时，按验收文件降级说明跳过相应场景 → 标 SKIP，不标 FAIL
   - 任何 FAIL 必须是真实跑命令得到的失败，不凭猜测
7. **生成合并报告** —— 将步骤 3-5 的结果合并保存为 `~/Desktop/vX.Y-stage6-report.md`，分三节：① acceptance-test 结果 ② regression-checklist 结果 ③ 覆盖率交叉检查结果。综合判定：三项全 PASS（或 ⏳/SKIP 合理、无 FAIL）→ 回复"vX.Y 阶段六通过"。任何 FAIL → 不自行改代码，整理失败清单（维度/场景编号、现象、命令、期望vs实际）回复开发侧修复

## 纪律
- 不创建/不修改任何代码或文档，只验证 + 生成报告
- 任何模糊、跑不通、对不上的维度如实标 FAIL 或写疑问，绝不因"应该没问题"放行
- 报告严格以对话形式执行验证，但最终报告必须保存到桌面文件——项目负责人在桌面上直接查看报告
```

### 判定与循环

| 结果 | 下一步 |
|------|--------|
| **全 PASS**（acceptance-test + regression-checklist + 覆盖率交叉） | 进阶段七（最终确认两份审查文档） |
| **有 FAIL** | 你把 stage6 合并报告带回开发 session → **回阶段五**（根据问题优化 `regression-checklist.md` + `fresh-eyes-review.md` 两个文档）→ 再开新 session 重跑本阶段 |

> 🔴 **循环测试机制**：阶段六任何 FAIL → 回**阶段五**（优化回归清单 `regression-checklist.md` + 发布后审查 `fresh-eyes-review.md` 两个文档）→ 再开新 session 控制 OpenClaw 重查。全部改完、阶段六全 PASS 后，进阶段七。最多循环 2 轮；2 轮仍不过则在报告中标注遗留问题，交开发侧决策。

> 时序说明已内嵌在 prompt 的步骤 5——回归清单中标注「⏰ 待发版」的检查项（git tag / npm registry / 全局二进制版本）在检查阶段必然不满足，这是正常的，不标 FAIL。

---

## 阶段七：审查体系最终确认

> 本阶段在**开发 session** 中执行，更新文档，不需要新 session。

阶段五已合并更新两份审查文档，此处做**最终确认**：确认 `regression-checklist.md` 与 `fresh-eyes-review.md` 状态一致、无遗漏，本版本新盲区均已落档。若阶段六循环修复中暴露了新盲区，在此补充。

| # | 步骤 | 验证方式 |
|:--:|------|------|
| 20 | **最终确认两份审查文档**：regression 维度与 fresh-eyes 维度互相印证，循环修复中暴露的新盲区已补入 | 两份文档最终状态见于文件 diff |
| 21 | **🔴 确认 acceptance test 的审查维度已同步**（v1.1.4 教训）：`regression-checklist.md` 维度 24「验收测试覆盖率与时效性」+ `fresh-eyes-review.md` 维度八任务 30「验收测试场景覆盖率与功能对齐」——两处都必须覆盖本版本新功能的验收场景缺口 | grep 两份审查文档含本版本新功能关键词 |

**审查体系闭环**（v1.0.4 教训）：审查文档自身也会过时——每次发版后审视 `fresh-eyes-review.md` 和 `regression-checklist.md` 的数字、路径、维度是否还有效。**验收测试同理**（v1.1.4 教训）——`acceptance-test.sh` 的场景数和覆盖范围必须与 changelog 功能点对齐，否则回归测试形同虚设。

---

## 阶段八：开发日志定稿 + 文档收尾

### 开发日志定稿（🔴 本版本核心文档动作，原在阶段一，现移至此处）

开发/审查/测试全部完成后，在此**正式定稿** `docs/changelog/vX.Y.md`：

- 把开发期活文档草稿（阶段二~三随写的功能点 + 测试数）与**阶段四/五/六审查中涌现的全部 bug 修复**汇总归位到「开发日志标准结构」骨架
- 补上本轮 `npm test` / `acceptance-test` / `shellcheck` / `check-version` 的实际结果（不要留占位符）
- **发布检查清单全部打 `[x]`**——定稿与打勾在此一步完成（阶段十确认关口只复核，不再打勾）
- 守「章节顺序铁律」：新功能在前、BugFix 批次置后

> 开发期间 changelog 是活文档（代码改完立刻回写，不要等）；但正式的「写全 + 归位 + 打勾」统一在阶段八，避免提前写漏掉后期 bug 修复。

### 根 CHANGELOG.md 索引维护（目录，非详情）

根 `CHANGELOG.md` 是 `docs/changelog/` 的**纯目录索引**，每个版本只占一行，不重复「核心变更 / 质量验证」等细节（那些在 `docs/changelog/vX.Y.Z.md`）。

索引条目固定格式（一句话摘要 + 日期 + 链接，**不写状态**）：

```
- **vX.Y.Z** — 一句话摘要 · 2026-07-22 · [开发日志](./docs/changelog/vX.Y.Z.md)
```

发版时（阶段八）动作：
- 本版本若还在「规划中」章节，将其条目**移至「正式版」章节**（去掉「规划中」字样，只留日期）
- 若索引里还没有本版本条目，按上面格式补一条
- 不改写条目内容细节——详情永远在 `docs/changelog/vX.Y.Z.md`

> 约定来源：2026-07-23 定，用户要求根 CHANGELOG.md 只做目录索引，避免与 docs/changelog/ 内容重复。

### 发版日期同步（🔴 v1.1.8 教训）

bump-version.sh 在开发期写入日期（如 `2026-07-21`），但实际发版可能跨天（`2026-07-22`）。check-version.sh 第 14 项 `EXPECTED_DOC_DATE` 硬编码了这个日期，跨天会导致所有文档头漂移报错。

**发版时（阶段八或阶段十一 Step 0）必须执行**：

```bash
# 1. 把 check-version.sh 的 EXPECTED_DOC_DATE 改为今天
TODAY=$(date -u +%Y-%m-%d)
sed -i '' "s/EXPECTED_DOC_DATE=\"[0-9-]*\"/EXPECTED_DOC_DATE=\"$TODAY\"/" tools/check-version.sh

# 2. 批量更新文档头日期（bump-version.sh 写入的旧日期 → 今天）
# 只改 > vX.Y 开头的文档头行，不改正文中的历史日期引用
OLD_DATE=$(git log --format="%ci" -1 --diff-filter=A -- package.json | grep -oE "[0-9]{4}-[0-9]{2}-[0-9]{2}" | head -1)
# 如果 bump 日期和今天不同，批量替换
if [ -n "$OLD_DATE" ] && [ "$OLD_DATE" != "$TODAY" ]; then
  grep -rl "^> v[0-9].*· ${OLD_DATE}" --include="*.md" . \
    | grep -v "docs/changelog/" | grep -v "node_modules/" | grep -v ".workbuddy/" \
    | xargs sed -i '' "s/· ${OLD_DATE}（UTC）/· ${TODAY}（UTC）/"
fi

# 3. 验证
bash tools/check-version.sh  # 期望：第 14 项 ✓ 文档头日期一致
```

### 测试数字一致性（🔴 v1.1.7 起用脚本自动校验）

CHANGELOG/ROADMAP/LIMITATIONS/evidence.md 中声称的测试数必须与实际 `test-count.sh` 输出一致。v1.0.4 曾写 455 但实际 465；v1.1.7 再次漂移（773→781），根因是 commit 自身新增了测试用例但文档没跟着改。

**v1.1.7 起有门禁脚本**，禁止手动 grep：

```bash
# 一键校验所有文档声称数 vs 实际值
bash tools/check-test-count.sh
# 输出示例：
#   ✓ CHANGELOG.md：781
#   ✓ ROADMAP.md：781
#   ✓ LIMITATIONS.md：audit 413 / workspace 781
#   ✓ evidence.md：audit 413 / workspace 781
# 任一不一致 → 红字报具体声称值 vs 实际值 + exit 1
```

脚本自动跑 `test-count.sh --quiet` 拿 SSOT 真值，再逐文档 grep 最新版本段声称的数字。**如果漂移**：打开脚本指出的文件+行号，把旧数字改成脚本输出中的实际值。

### 全项目版本号扫描

详见 [FORGE/playbook/version-bump.md](../../FORGE/playbook/version-bump.md)——bump-version.sh 13 类位置、package-lock 同步、npm 铁律、手动排查。

核心三步：① `./tools/bump-version.sh <旧> <新>` ② `./tools/check-version.sh` ③ `npm install --package-lock-only`

### 文档同步 + LIMITATIONS + 内容新鲜度

详见 [FORGE/playbook/doc-sync.md](../../FORGE/playbook/doc-sync.md)——LIMITATIONS 覆盖、归属原则表、D6 四步闭环、覆盖率判定矩阵。

核心要求：① 每条新功能在权威文档有详细说明 ② 引用文档有提及 ③ 零覆盖 = P0

#### 文档日期检查（🔴 v1.0.2 教训）

bump-version.sh 只改版本号**不改日期**。每次 bump 后必须手动检查：

```bash
# 检查所有 MD 文件头日期——把 DATE 替换为实际发版日期
DATE="$(date +%Y-%m-%d)"  # 或手动指定
grep -rn "$DATE" *.md docs/archive/design/*.md | grep -v "docs/changelog/" | grep -v "docs/evidence/"
# 期望：主要文档都匹配到当天日期
# 排除 changelog 历史（里面记的是发版当天日期，不该改）和 evidence 案例日期
```

重点检查（bump-version.sh 不覆盖的）：
- `LIMITATIONS.md` 文件头日期
- `docs/archive/design/audit-design.md` 文件头日期
- `docs/archive/design/daemon-design.md` 文件头日期
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
- [ ] 🔴 **只写产品变更**——不含审查元信息（维度编号、模型名、轮次、维度数等）。这些属于内部过程，外部用户不关心

### ROADMAP 五步（v1.1.3 重构后）

> ROADMAP.md 现在分四块：头部定位 → 迭代历程 → 未来去哪 → 历史架构演进。每次发版后必须更新前三块。

- [ ] **①「现在在哪」→ 迭代历程**：把「现在在哪」节的本版本内容凝练为一行移入「迭代历程」表（倒序插入顶部），然后将「现在在哪」替换为**下一版本**的简要描述（如 v1.1.4 规划内容）。不要同时写两个版本
- [ ] **②「规划版本」表去完成**：把本版本从「规划版本」表里删掉（它已经进了迭代历程）——「规划版本」表**只留 📋 规划中的版本**，不能出现 ✅ 已完成
- [ ] **③「未来去哪」各节版本号同步**：如果本版本实现了 v1.2.0 / v1.2.x / v1.3.0 详细节中的某项能力，移除对应文本中的「规划中」「探索」标注，或在相关节中注明「已在 vX.Y 实现」
- [ ] **④ 文件头版本号 + emoji + 日期**：`> vX.Y · 2026-XX-XX（UTC）· 核心交付摘要`——版本号、日期、emoji 三者必须与 `package.json` 一致
- [ ] **⑤ 不碰「历史架构演进」**：「编排引擎升级」「Ontology 渐进构建」「外部框架对齐」等已完成的历史上下文**每次发版不需要更新**——它们是静态存档。只有在本版本实现了新的架构范式转换（如从 DeepAgents 换到自研运行时）时才追加

> **为什么是五步不是三步**：v1.1.3 之前的 ROADMAP 结构简单（表+叙述），三步够。v1.1.3 重组后分成了四块，「规划版本」表的清理和「未来去哪」各节的版本号同步被显式拆成了两步，加上不碰历史存档的约束——一共五步。

### 按需文档

| 文档 | 什么时候更新 |
|------|------|
| `README.md` | FDE 完成度变化、效果证据更新、新功能入口 |
| `ARCHITECTURE.md` | 架构决策或设计思路有变更 |
| `DEVELOPMENT.md` | 开发流程有变更 |
| `LIMITATIONS.md` | 新发现的局限或旧局限被消除 |
| `HANDBOOK.md` | 用户使用习惯、FAQ 有变化 |
| `COMMUNITY.md` | contributor 数据、社区状态有变化 |
| `ROADMAP.md` | 五步更新（见上）。不要在「现在在哪」堆积历史版本详细表 |
| `CHANGELOG.md` | 新增版本索引条目。版本历史的**唯一权威入口** |
| `docs/changelog/vX.Y.md` | 完整开发日志：问题背景 + 逐项修复方案 + 质量验证数据 + 发布检查清单 |

### 🔴 CLI 迁移版本回归闸（v1.1.0 教训）

> 如果本版本涉及 CLI 命令迁移（旧命令改名、上帝包子命令拆到新包二进制），阶段四跳过的 shellcheck（步骤 10）在**此处补跑**——文档收尾已完成，所有引用已更新，跑出来是真实结果。acceptance-test 不在此处补跑——它已挪到阶段6新 session 跑（由独立审查者执行）。

```bash
# 补跑 shellcheck
shellcheck engine/scripts/*.sh tools/*.sh install.sh   # 期望：零 error
```

> 如果 shellcheck 因脚本未适配新命令而大量 FAIL，标注为已知遗留并写入下版本的 Wave 5 适配计划。acceptance-test 同理——在阶段6新 session 跑时如因 CLI 迁移大量 FAIL，标注为已知遗留。

---

## 阶段九：发布前质量闸门 + 工具脚本健康检查（v1.1.3 教训）

> 工具脚本和产品代码同步演进，不要等脚本报错才发现缺口。每次发版前过一遍——这一步防止「check 能查但 bump 不改」「新增目录没进排除规则」「regression-checklist 路径过时」三类结构性盲区。

| # | 步骤 | 验证方式 |
|:--:|------|------|
| 22 | **🔴 运行 fresh-eyes-loop（发布前质量闸门）**：在**全新 session** 中启动 Node driver——`node FORGE/src/fresh-eyes-driver.mjs --target <本版本号> --max-rounds 10`。driver 用 LangGraph createReactAgent 编排 A（审查模型）双盲并行审查 + B（工程模型）修复 + A 验证，连续 2 轮 findings 无 P0/P1 即停（机制详见 `FORGE/SKILL/fresh-eyes-loop/SKILL.md`）。**Session 监控协议**：启动 driver 后按 SKILL.md「Session 监控协议」每 5 分钟轮询 `<runDir>/status.json`，只在 phase 变化时一句话汇报——用户从 session 的 working 转圈状态直接感知后台在跑。🔴 修复提交本地、不 push（发版步骤才统一推） | driver 跑完，`status.json` 显示 phase=completed 且无未推送提交被误 push |
| 23 | **🔴 人工核对 changelog 并打勾（human-in-the-loop）**：loop（步骤 22）跑完后，用户以 `fresh-eyes-review.md` 方法论为参考**人肉**复核，① **汇总 fresh-eyes-loop**：汇总步骤 22 所有的 bug 修改，并整合到这一版的 changelog 开发日志（`docs/changelog/vX.Y.Z.md`）里面；② 将 loop 全部修复计入**本版本** changelog 并打勾——此时所有修复仍本地未推，这是设计内正确状态 | 本版本 changelog 的「发布检查清单」含 loop 全部修复项且全部 `[x]`，开发日志已整合 loop 全部 bug 修改 |
| 24 | **新增文件类型/目录排查**<br><br>① 本版本有没有新增文件类型（如 `.yaml`/`.toml`/`.json5`）？→ `check-version.sh` 是否需要加对应检查项？`bump-version.sh` 是否需要加对应 bump 步骤？<br>② 本版本有没有新增目录（如 `FORGE/`/`agents/`/`docs/new-section/`）？→ `bump-version.sh` 和 `check-version.sh` 的 `find` 排除规则是否需要更新（`_archive`/`docs/archive`/`node_modules`/`dist`）？<br>③ 本版本有没有文件迁移（如 `audit/src/` → `core/src/`）？→ `regression-checklist.md` 中的路径是否需要更新？跑 `grep -rn "旧路径" FORGE/playbook/regression-checklist.md` 确认<br>④ **🔴 v1.1.4 教训：孤儿配置文件排查**——`pnpm-workspace.yaml` 是上个版本的残留配置（项目用 npm workspace，文件不被任何工具读取）。本步追加：扫根目录有无不属于本项目技术栈的配置文件（`pnpm-workspace.yaml`/`yarn.lock`/`.ruby-version` 等），有则确认是否需要删除<br>⑤ **🔴 v1.1.6 教训：shellcheck 扫描范围与 CI 一致性**——本版本有没有新增含 `.sh` 的目录？→ `pre-push-check.sh` 的 shellcheck `find` 命令是否覆盖了所有含 `.sh` 的目录？对比 CI 的 `.github/workflows/shellcheck.yml` 确保一致（CI 扫全仓，本地也必须全扫）。v1.1.6 教训：`FORGE/` 有 `.sh` 但 pre-push-check 的 find 没扫它——CI 抓住了，本地门禁放行。另外检查本地 shellcheck 版本 ≥0.11.0（与 CI 对齐），低于则 warning 提示升级——v0.10.0 对 SC2155 等 warning 判定宽松（exit 0），v0.11.0 更严格（exit 1），版本差会导致本地过了 CI 挂了 | 五项逐一确认，有变更则更新对应脚本；④ 额外扫孤儿配置；⑤ `grep "find.*\.sh" tools/pre-push-check.sh` 抓当前扫描目录，与 CI shellcheck.yml 的 files 配置对照 |
| 25 | **三脚本对照检查**<br><br>① `check-version.sh` 检查的每一类文件，`bump-version.sh` 是否都有对应的 bump 步骤？（缺口 = check 能发现但不自动修复——如 v1.1.3 发现的 10 个 workspace 子包 version 字段）<br>② `pre-push-check.sh` 的检查项数量是否和 CHANGELOG/ROADMAP 声明的一致？（v1.1.3 教训：声明 13 通过，实际 15 通过/16 项）<br>③ `check-version.sh` 的检查项编号分母是否和实际检查项数一致？（v1.1.3 教训：`[1/13]~[12/13]+[13/14]+[14/14]` 分母跳变） | ① 跑 `./tools/check-version.sh` 看末尾「检查通过: N/N 项」，再跑 `./tools/bump-version.sh --dry-run` 对照 bump 步骤数，两者覆盖范围应一致<br>② `./tools/pre-push-check.sh 2>&1 \| grep '结果:'` 的数字和 CHANGELOG 质量验证段对比<br>③ `grep '── \[' tools/check-version.sh` 看实际打印的分母是否全一致（注释中的引用不算） |
| 26 | **过时检查清理**<br><br>**机制**（v1.1.4 重构——从版本专用硬编码升级为通用框架）：<br><br>**Step A — 从 SSOT changelog 推导检测模式**：<br>读 `docs/changelog/v{SSOT}.md`，从「核心变更」「缺陷修复」章节提取本版本涉及的废弃/变更项。按以下模板生成检测关键词：<br>　· 新增规则 → 搜索旧规则数（如 v1.1.4 新增 A18/A19 → 搜索 `19 条规则`）<br>　· 废弃命令/入口 → 搜索旧命令（如 `sofagent-audit --daemon`）<br>　· 测试数变化 → 搜索旧测试数（如 `343` → 388）<br>　· 术语更名 → 搜索旧术语（如 `回溯引擎` → `回溯能力`）<br>　· 删除的标志/功能 → 搜索删除项（如 `verify.js --list`）<br>　· **🔴 目录更名（v1.1.4 教训）→ 搜索旧目录名**（如 `workflow-hub` → `FLOWHUB`，这种更名会留下 markdown 相对路径死链——`./workflow-hub/` 在 README 里变成死链。grep 搜索旧目录名 + 跑 `bash tools/check-docs.sh` 维度 1b「全仓相对路径死链扫描」）<br><br>**Step B — 运行检测**：`grep -rn '<模式>' docs/ *.md --include='*.md' \| grep -v 'docs/changelog/\|.workbuddy/\|node_modules/'` + `bash tools/check-docs.sh`（特别是维度 1b 死链扫描）<br><br>**Step C — 判定与分类**：<br>　· 历史记录（changelog 正文、审查盲区描述）→ 保留，不标过时<br>　· 当前文档（README/ARCHITECTURE/LIMITATIONS/指南）→ **必须更新**<br>　· 检查模式自身（regression-checklist 中的 grep 命令）→ 保留<br><br>**Step D — 历史存档**：将本版本新增的废弃项追加到下面的「历史废弃项」表，供后续版本回溯——**不要替换**，累积追加。<br><br>**硬规**：检测结果中，除 changelog 历史记录和检查模式自身外，**零残留**。<br><br>── 历史废弃项（按版本累积，只追加不替换）──<br><br>**v1.1.4 废弃/变更项**（SSOT 1.1.3→1.1.4）：<br>· `sofagent-audit --daemon` → `sofagent-daemon`（daemon 独立 CLI）<br>· `19 条规则` → `21 条`（A18/A19 新增）<br>· `343` tests → `388`（audit）/ `558` → `660`（全 workspace）<br>· `回溯引擎` → `回溯能力`（v1.1.3 更名，v1.1.4 继续清理残留）<br>· `verify.js --list` → 删除（标志不存在）<br>· pre-push-check 数字：`14/14` → 去硬编码<br>· `workflow-hub/` → `FLOWHUB/`（目录更名，README 4 处死链）<br>· `engineering-*` → `sofagent-*`（Skill 命名统一） | 除 changelog 历史 + 检查模式自身外，**零残留**（0 处） |

---

## 阶段十：确认关口

文档全部收尾后，**必须**让作者过一遍改动，确认没问题再交接给项目负责人发版。

| # | 步骤 | 验证方式 |
|:--:|------|------|
| 27 | 展示全部改动清单 | `git diff --stat` |
| 28 | 作者逐项确认 | 重点看版本号、ROADMAP、CHANGELOG |
| 29 | 确认开发日志「发布检查清单」已全部 `[x]`（应在阶段八定稿时完成，此处只复核） | 打勾动作在阶段八，不在确认关口 |
| 30 | **AI 生成发布 prompt，交接给项目负责人**——发版命令由 AI 准备，项目负责人可亲手执行或授权 AI 代执行 | AI 输出完整的发布 prompt（含 npm publish / git tag / gh release / Skill 分发 / 发布后验证）。项目负责人可选择亲手跑，或说「交给你了」授权 AI 在已登录环境代执行 |

---

## 阶段十一：发布（🔴 项目负责人亲手执行，或授权 AI 代执行）

> AI 在阶段十确认关口生成一份完整的发布 prompt（含所有命令），项目负责人（孔放勋）拿到后可亲手逐条执行。
>
> **🔴 AI 代执行边界（v1.1.8 决策）**：如果项目负责人说「交给你了」明确授权，AI 可以在项目负责人已登录的环境代执行发布命令（npm publish / git tag / gh release / Skill 分发）。但：
> - npm 凭证必须在项目负责人已登录的终端中使用，**AI 不得自行 `npm login` 或操作凭证**
> - 每一步执行后立即报告结果，遇到报错暂停并请示
> - 不可逆操作（npm publish / git push --force）前确认环境无误
> - 这里的核心是：**授权 AI 跑命令 ≠ 授权 AI 管凭证**——凭证始终在人的控制下

### 本地安装（自己吃自己的狗粮）

> v1.1.3 教训：发版后才想起本机装的还是旧版本。**全部验证通过、准备发布时，先把最新版装到本机**——全局 npm 和本地 Skill 同步。这是发布前的最后一块狗粮，确认本机能正常跑新版本。

```bash
# 1. 全局安装最新 audit 包（从本地源码构建安装，不需要等 npm publish）
cd engine/audit
npm run build && npm install -g .
cd ../..

# 2. 验证版本号
sofagent-audit --version  # 应显示当前开发版本号

# 3. 本地 Skill 同步（WorkBuddy + OpenClaw 双平台）
cp -r SKILL/harness/* ~/.workbuddy/skills/sofagent/
cp -r SKILL/harness/* ~/.openclaw/skills/sofagent/
cp SKILL/SKILL.md ~/.workbuddy/skills/sofagent-fde/
cp -r SKILL/agents/fde/ ~/.workbuddy/skills/sofagent-fde/
cp -r SKILL/agents/audit/ ~/.workbuddy/skills/sofagent-audit/
cp -r SKILL/agents/fde/ ~/.openclaw/skills/sofagent-fde/
cp -r SKILL/agents/audit/ ~/.openclaw/skills/sofagent-audit/

# 4. dogfood 验证（在当前 workspace 跑最新的 --doctor）
sofagent-audit --doctor
```

> ⚠️ `npm install -g .` 从本地源码安装，不会走 npm registry。**发版时的 `npm install -g /audit@latest`（阶段十一·步骤 19）仍然必须做**——那是验证发布的 npm 包。这里是发布前的自用安装。

### 发布前检查（npm 包洁净度 + 推前预检）

```bash
# 🔴 推前预检必须全绿
bash tools/pre-push-check.sh            # 全绿（全量 workspace）
bash tools/check-docs.sh                # 文档死链 + 预算 + Skill 行数

# 全部 12 包 .js.map 泄露检查 + 类型检查 + README 非空检查
for pkg in harness ontology eval core audit think mcp orchestrator daemon ab-test skillopt; do
  echo "=== $pkg ==="
  (cd engine/$pkg && npm pack --dry-run 2>&1 | grep -c '\.js\.map')  # 期望: 0
  (cd engine/$pkg && npx tsc --noEmit && echo "✅ tsc")
done
# 🔴 v1.1.3 教训追加（mcp README 0 bytes）：发布前检查 README 非空
for pkg in audit mcp; do
  size=$(npm pack --dry-run 2>&1 | grep -c 'README\|total files' || true)
  echo "$pkg pack 输出: $(cd engine/$pkg && npm pack --dry-run 2>&1 | tail -1)"
done
echo "⚠️ 确认 audit/mcp 的 README.md 在 npm pack 输出中有内容——v1.1.3 mcp README 0 bytes"
```

### 执行发布

**npm 先行策略**：先手动发布 npm 全部包（按依赖顺序），再 git tag + push。即使 CI 失败，npm 包已就位。

> 🔴 v1.1.0 教训：12 包按依赖层分批发布——叶子包先发，消费方后发，npm workspace symlink 在 publish 时不生效，必须在 npm registry 上有真实包。

```
── Step 1: 全量 workspace build（拓扑序） ──
npm run build
# 根 package.json 按拓扑序链式构建，不用 --workspaces（不保证顺序）

── Step 2: 按依赖层分批 publish ──

> 🔴 macOS 兼容（v1.1.8 教训）：不要用 `cd ../xxx && npm publish` 的连续 `&&` 链——
> 如果某一步失败或单独执行，`cd ../` 的基准目录是错的。用 `(cd engine/xxx && npm publish --access public)`
> 子 shell 模式，每行独立可执行。

🔴 第一层·叶子包（零 @sofagent 依赖，可并行）：
1. (cd engine/harness     && npm publish --access public)
2. (cd engine/ontology    && npm publish --access public)
3. (cd engine/eval        && npm publish --access public)
4. (cd engine/core        && npm publish --access public)

🔴 第二层·依赖第一层（audit/orchestrator/skillopt 可并行）：
5. (cd engine/audit        && npm publish --access public)
6. (cd engine/orchestrator && npm publish --access public)
7. (cd engine/skillopt     && npm publish --access public)

🔴 第三层·依赖第二层（think/daemon 可并行）：
8. (cd engine/think   && npm publish --access public)
9. (cd engine/daemon  && npm publish --access public)

🔴 第四层·依赖第二+三层（ab-test）：
10. (cd engine/ab-test      && npm publish --access public)

🔴 第五层·收官（mcp 依赖 audit+orchestrator+think）：
11. (cd engine/mcp  && npm publish --access public)

── Step 3: 验证全部 11 包（🔴 v1.1.3 教训强化——只 echo 不判 FAIL 是虚假绿色） ──
NEW_VER="1.1.X"  # 替换为实际新版本号
FAILED=""
for pkg in harness ontology eval core audit think mcp orchestrator daemon ab-test skillopt; do
  ver=$(npm view "/$pkg" version 2>/dev/null)
  if [ "$ver" != "$NEW_VER" ]; then
    echo "❌ /$pkg: $ver（期望 $NEW_VER）"
    FAILED="$FAILED $pkg"
  else
    echo "✅ /$pkg: $ver"
  fi
done
if [ -n "$FAILED" ]; then
  echo "🔴 以下包版本不一致，必须手动补发：$FAILED"
  exit 1
fi
echo "✅ 全部 12 包版本一致 = $NEW_VER"
# 🔴 v1.1.3 教训：Step 3 只 echo 不判 FAIL，导致 5/12 包（think/mcp/daemon/ab-test/skillopt）滞留在 v1.1.0 未发现

── Step 4: git tag + push ──
12.5 🔴 tag 完整性门禁（v1.1.3 起）：打 tag 前确认 `git log --oneline <last-tag>..HEAD` 无 fix 漏网——确保所有改动都已纳入本次 tag
12.6 🔴 tag message 校验（v1.1.3 起）：tag 必须打在最后一个本版提交上，tag message 必须含版本号。打 tag 后立即校验 `git tag -l "v$NEW_VER" --format='%(subject)' | grep "$NEW_VER"`——亲自核对。v1.1.3 曾 tag message 写 "v1.1.3" 但 tag 名是 v1.1.3
12.7 🔴 tag 必须指向最终发布提交（v1.1.8 起）：tag 不得提前打好再回头补丁——必须等本版全部改动（含文档 / 测试）合入、且 `bash tools/check-version.sh` / `bash tools/check-docs.sh` / 各包 `npm test` 全绿后，才在**最后一个本版提交**上打 tag。提前打 tag 会导致补丁提交游离在 tag 之外、版本号与代码不一致，破坏可回溯性。
13. git tag vX.Y.Z && git tag -l "vX.Y.Z" --format='%(subject)' | grep "vX.Y.Z" || echo "⚠️ tag message 不匹配，建议重新打 tag"
14. git push origin vX.Y.Z
```

**🔴 tag 后零 commit 校验（v1.1.9 fresh-eyes 教训）**：

tag push 成功后，确认 tag 指向的 commit 就是 HEAD（tag 之后没有游离 commit）：

```bash
TAG_SHA=$(git rev-parse vX.Y.Z^{commit} 2>/dev/null)
HEAD_SHA=$(git rev-parse HEAD)
if [ "$TAG_SHA" = "$HEAD_SHA" ]; then
  echo "✅ tag 指向 HEAD（零游离 commit）"
else
  echo "🔴 tag ($TAG_SHA) ≠ HEAD ($HEAD_SHA)——tag 之后有游离 commit"
  git log --oneline vX.Y.Z..HEAD   # 查看游离的 commit
  echo "⚠️ 如果游离 commit 属于本版本，需要重新打 tag"
fi
```

> **什么情况会触发**：发版过程中 tag 打好后，又手动 commit 了文档微调、CHANGELOG 措辞修正等改动，但没有重新打 tag。这会导致 tag 版本与实际仓库状态不一致。

**🔴 网络降级策略（v1.1.8 教训）**：

如果 git push HTTPS 超时（GitHub 网络波动），但 tag 已推上去（可用 `gh api` 确认），**不要干等**——gh CLI / clawhub / skillhub 走各自的 API 通道，不受 git HTTPS 影响。执行顺序可调整为：

```bash
# 确认 tag 已在远端
gh api repos/KongFangXun/sofagent/git/refs/tags/vX.Y.Z --jq '.object.sha'
# 对比本地 tag sha
git rev-parse vX.Y.Z
# 两者一致 → tag 已推送成功，可以继续 gh release

# 先用 gh API 通道完成 release + Skill 分发（不依赖 main push）
gh release create vX.Y.Z ...
clawhub skill publish ...
skillhub publish ...

# main push 后台重试（带超时保护）
GIT_HTTP_LOW_SPEED_LIMIT=1000 GIT_HTTP_LOW_SPEED_TIME=15 git push origin main
# 失败就多重试几次，间隔 5s
```

**关键认知**：gh release 只依赖 tag 存在于远端，**不依赖 main push 完成**。tag push 成功后就可以做 release + Skill 分发，main push 可以后台慢慢重试。

### 🔴 tag 后 commit 校验（F-10 / fresh-eyes F-03 教训）

tag 打好后，检查是否有新的 commit：

```bash
git log vX.Y.Z..HEAD --oneline
```

- **输出为空** → tag 是最终状态，正常
- **有 commit** → 检查 commit 类型：
  - 全是 `docs:` 前缀的文档微调 → **接受**，记录说明（文档微调不影响代码功能）
  - 有代码 commit（feat/fix/refactor）→ **评估是否需要 re-tag**（re-tag 流程：`git tag -f vX.Y.Z && git push origin vX.Y.Z --force`）

**规则**：tag 后允许文档微调 commit，代码变更 commit 必须重新评估是否 re-tag。

```bash
── Step 5: gh release create ──
15. gh release create vX.Y.Z
   🔴 Release body **必须**包含开发日志链接（**必须用 markdown 链接语法**，不要用反引号包裹的纯文本路径——后者在 GitHub 上不可点击）：
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
   - 末尾**必须有**开发日志链接——**🔴 v1.1.4 教训：必须用 markdown 链接语法 `[详细开发日志](./docs/changelog/vX.Y.Z.md)`，不要写成 `` `docs/changelog/vX.Y.Z.md` `` 反引号纯文本（后者在 GitHub 上不可点击）**
   - **不含**审查元信息（模型名、审查轮次、P0/P1 标签）——那是内部过程

── Step 5: Skill 分发 + 本机升级 ──
🔴 v1.0.9 教训：skillhub CLI 语法与 clawhub 不同——`skillhub publish <path> --version X`（无 `skill` 子命令，无 --slug/--owner）
🔴 v1.0.9 教训：FDE 发布到 ClawHub 时 slug "fde" 冲突——必须用 --slug sofagent-fde
🔴 v1.1.4 教训：ClawHub 默认版本号从 1.0.0 开始自增（不走 SKILL.md 的 version 字段），必须显式 `--version X.Y.Z` 才能对齐；`--changelog` 可附简短变更说明

15. clawhub skill publish ./SKILL --slug sofagent --owner KongFangXun --version X.Y.Z --changelog " vX.Y.Z: {简短变更}"
16. skillhub publish ./SKILL --version X.Y.Z
17. clawhub skill publish ./FDE --slug sofagent-fde --owner KongFangXun --version X.Y.Z --changelog "vX.Y.Z: {简短变更}"
18. skillhub publish ./FDE --version X.Y.Z
19. **🔴 本机全局升级**（v1.0.7 教训——忘了更新本机安装，导致 QA 测试时跑的是旧版本）：
    npm install -g /audit@latest
    sofagent-audit --version                    # 验证版本号
    sofagent-audit --doctor                     # 验证功能正常
20. 本地 Skill 同步：
    cp -r SKILL/harness/* ~/.workbuddy/skills/sofagent/
    cp -r SKILL/harness/* ~/.openclaw/skills/sofagent/
    cp SKILL/SKILL.md ~/.workbuddy/skills/sofagent-fde/
    # v1.0.7 新增：Agent Skill（@sofagent-fde / @sofagent-audit）
    cp -r SKILL/agents/fde/ ~/.workbuddy/skills/sofagent-fde/
    cp -r SKILL/agents/audit/ ~/.workbuddy/skills/sofagent-audit/
    cp -r SKILL/agents/fde/ ~/.openclaw/skills/sofagent-fde/
    cp -r SKILL/agents/audit/ ~/.openclaw/skills/sofagent-audit/
```

> **💡 WorkBuddy Skill 自动同步说明**：作者的 WorkBuddy 已安装 sofagent skill。每次 sofagent skill 文件更新并 cp 到 `~/.workbuddy/skills/sofagent/` 后，WorkBuddy 客户端会自动同步本地 skill 内容——这是作者自己开发环境内的同步，**不影响 ClawHub/SkillHub 发布流程**。ClawHub（`clawhub skill publish`）和 SkillHub 仍然是每次发版必须执行的发布渠道，一个都不能少。

### 发布后验证

```bash
# Git
git tag -l | grep vX.Y.Z
gh release view vX.Y.Z

# 🔴 Release Notes 完整性检查（v1.0.3 教训）
# 1. body 不为空
# 2. 包含 📖 [详细开发日志](./docs/changelog/vX.Y.Z.md) 链接——🔴 v1.1.4 教训：
#    必须是 markdown 链接语法（`[...](...)`），不是反引号包裹的纯文本路径
# 3. 不是 Draft 状态
gh release view vX.Y.Z --json isDraft,body -q '.body | length'  # 期望 > 100
gh release view vX.Y.Z --json body -q '.body | contains("](./docs/changelog/")'  # 期望: true（验证是 markdown 链接而非纯文本）

# npm
npm view /audit version
npm view /mcp version

# 🔴 关键：更新全局安装——npm publish 成功后 npm registry 已更新，
# 但开发者本地二进制仍是旧版本。不更新会导致 --version 输出旧版本号，
# 且测试时拿到的是旧功能（如 doctor 少检查项、A14 不存在等）
npm install -g /audit@latest
sofagent-audit --version                    # 期望：vX.Y.Z（与 SSOT 一致）
sofagent-audit --doctor                     # 期望：与当前版本 doctor 项数一致

# 本地安装验证
bash tools/check-version.sh             # 期望: 全绿（含第 13 项 npm 二进制版本检查）
```

### 常见发布故障

| 故障 | 现象 | 解决 |
|------|------|------|
| mcp 版本落后 | `npm view /mcp version` 显示旧版本 | mcp job 独立于 audit job，版本号需手动同步 |
| .js.map 泄露 | `npm pack --dry-run` 显示 .js.map | 检查 package.json `files` 是否包含排除模式 |
| README 空白 | npm 页面无 README | 检查 package.json `files` 是否引用了不存在的 README.md |
| npm publish 403 | `npm publish` E403 | 版本号已存在或 NPM_TOKEN 过期 |
| npm ENOTEMPTY（v1.0.9） | `npm install -g` 报 ENOTEMPTY rename 失败 | 清理全局 `node_modules//.audit-*` 残留目录后重试 |
| gh release TLS timeout（v1.0.9） | `gh release create` 报 TLS handshake timeout | 加 `--repo KongFangXun/sofagent` flag 重试 |
| ClawHub slug 冲突（v1.0.9） | `clawhub skill publish ./FDE` 报 Ambiguous slug | 加 `--slug sofagent-fde` |
| skillhub 语法错误（v1.0.9） | `skillhub skill publish` 报 invalid choice | skillhub 无 `skill` 子命令，直接 `skillhub publish <path> --version X` |
| A9 测试文件误报（v1.0.9） | commit-msg hook 拦截：测试文件中的注入向量被误报 | A9 已在 v1.0.9+post-release 跳过 `.test.`/`__tests__/`/`.fixture`；旧版本用 `--no-verify` |
| 全局二进制版本落后 | `sofagent-audit --version` 显示旧版本号 | npm registry 已更新但本地未重装。`npm install -g /audit@latest` |
| **npm install -g . 权限问题（v1.1.4）** | 本地源码全局安装后 `sofagent-audit` 报 Permission denied | v1.1.4 已修：`chmod +x dist/*.js` 从 `prepublishOnly` 挪到 `build` 脚本。**npm registry 装的包无此问题**，只影响 `npm install -g .` 本地自装场景 |
| **release.yml publish-audit 失败（v1.1.1-v1.1.3，v1.1.4 修）** | GitHub Actions Release job 失败：`Failed to resolve entry for package "/core"` 17 suites FAIL | 根因：publish-audit job 只在 engine/audit 目录跑 npm ci+test，漏 build /core。v1.1.4 已修：改为根目录 workspace 构建（对齐 publish-mcp）。**每个 npm 包有 runtime 依赖其他 /* 包时，CI 必须 workspace 模式 build** |
| **ClawHub 版本号显示错误（v1.1.4）** | ClawHub 显示 1.0.11 而非 1.1.4 | clawhub 默认 1.0.0 自增，不走 SKILL.md version。必须 `--version X.Y.Z --changelog "简短说明"` |
| **Release notes 链接不可点击（v1.1.4）** | `` 📖 详细开发日志：`docs/changelog/vX.Y.Z.md` `` 在 GitHub 不可点击 | 必须用 markdown 链接语法：`📖 [详细开发日志](./docs/changelog/vX.Y.Z.md)` |

---

## 阶段十二：发布后

| # | 步骤 |
|:--:|------|
| 31 | **npm 13 包验证**：全部 13 包版本一致，无 MISSING |
| 32 | npm README 验证：`npm view /audit readme` + `npm view /mcp readme` 均有内容 |
| 33 | **🔴 CI 全绿检查（v1.2.0 教训）**：`gh run list -b main -L 10 --json conclusion,name,headSha` → 任一 failure 则 `gh run view --log-failed` 定位 → 修复 → push → 重查。v1.2.0 教训：4 轮 CI 挂全是 LOOP→FORGE 重构时 CI 配置未同步——代码写对不等于 CI 能过 |
| 34 | 如果本次迭代暴露了新的流程漏洞，**直接吸收进本 SOP 对应阶段**——不要存到单独章节。每条新规则标注版本号（如 `vX.Y 教训`）以便追溯 |
| 35 | **🔴 审查闭环——发布后审查**：<br>① **全新 session**：开一个对开发过程完全不知情的 Agent session，让它读取 `FORGE/playbook/fresh-eyes-review.md`（已在本版本阶段五中更新），对已发布版本做独立审查<br>② **产出审查报告**：报告中的问题不阻塞当前版本——它们进入**下一版本的阶段一**，作为驱动下一版开发方向的 P0/P1/P2 清单<br>③ **如果发现新问题** → 自动成为下一版 releasing 的输入（回到阶段一开始新的迭代）<br>④ **审查体系持续自我进化**：每版积累"下轮会更锋利"的视角和敏感度。⚠️ 这里的"锋利"指 fresh-eyes-review 的直觉校准（见阶段五 Tier 3），不是加检查项——检查项归 regression-checklist 管 |
| 36 | **SOP 自我进化**（FDE 提议 → 作者确认）：FDE 发版后自动跑一轮，生成 releasing.md 更新建议（diff 格式），作者确认后 apply。检查项：<br>① 本版本发布过程中遇到的流程漏洞 → 直接吸收进对应阶段，标注版本号<br>② 检查本 SOP 中的数字是否过期（维度数、检查项数、doctor 项数等）<br>③ 本版本新增的工具/脚本是否已纳入对应阶段（如 pre-push-check.sh、check-docs.sh）<br>④ 把更新后的 releasing.md 同步到 FORGE.md 的映射表<br>⑤ 如果 FDE 未发现需更新项，输出"无需更新"报告——零变更也是有效结果 |
| 37 | **生成「下一版本开发 Prompt」到桌面**：综合 `ROADMAP.md`（未来规划）+ `CHANGELOG.md` + 下一版本 `docs/changelog/vX.Y.md`（若存在），生成开发 prompt 落盘 `~/Desktop/vX.Y-dev-prompt.md`。<br>**若下一版本 changelog 尚未创建**：先 ① 写新版本需求并产出 `docs/changelog/vX.Y.md`；再 ② 生成桌面开发 prompt |

### 下一版本开发 Prompt 生成说明（步骤 37）

> 来源：下一版本的「开发日志」——在 `docs/changelog/` 中查找（若不存在则先按下方流程补建）。辅助输入：`ROADMAP.md`（未来去哪 / 规划）+ `CHANGELOG.md`（版本索引）。

**生成流程**：
1. 读 `ROADMAP.md` 的「未来去哪」节，提取下一版本规划方向
2. 读 `CHANGELOG.md` 确认下一版本号与索引条目
3. 读 `docs/changelog/vX.Y.md`（下一版本开发日志，若存在）—— 这是开发 prompt 的主体来源
4. 综合上述，生成开发 prompt 落盘 `~/Desktop/vX.Y-dev-prompt.md`（结构：问题描述 → 修复方案 → 验证方式 → 发布检查清单）

**若下一版本 changelog 尚未创建**（开发到下一版本时文件还不存在）：
1. 先写新版本需求，产出 `docs/changelog/vX.Y.md`（含问题描述 → 修复方案 → 验证方式 → 发布检查清单）
2. 再执行上方「生成流程」生成桌面开发 prompt

---

## 阶段速查表

| 阶段 | 名称 | 谁做 | 需要新 session？ | 产出 |
|:--:|------|:--:|:--:|------|
| 一 | 审查（问题收敛） | 作者 | 是（阶段九 fresh-eyes-loop 发布前闸门 + 阶段十二发布后审查） | 审查报告（→ 本版本 BugFix 批次） |
| 二 | 开发 | 工程师 | 否 | 代码 + 随修随记的回归维度 |
| 三 | 自测 | 工程师 | 否 | build/test 全绿 + 更新验收测试文件（acceptance-test 本身只更新不跑，跑在阶段6）。涉及 CLI 迁移时 shellcheck 延后到阶段八 |
| 四 | 代码审核 | 当前 session | 否 | 逐项 PASS 或 FAIL→修复 |
| 五 | 审查体系合并更新（含瘦身检查） | 当前 session | 否 | regression-checklist（加法）+ fresh-eyes-review（校准，Tier 3 守护留白风格）+ acceptance-test.sh（可自动化验证的发现追加入场景）+ 防膨胀瘦身 |
| **六** | **acceptance-test + regression-checklist（开新 session）** | **审核者控制 OpenClaw** | **🔴 是（全新认知；FAIL 回阶段五循环）** | **stage6 合并报告全 PASS** |
| 七 | 审查体系最终确认 | 作者 | 否 | 两份审查文档状态一致、无遗漏（初版已在阶段五写入） |
| 八 | 开发日志定稿 + 文档收尾 | 作者 | 否 | **开发日志定稿（含发布检查清单打勾）** + CHANGELOG/ROADMAP 五步/版本号/**发版日期同步**/测试数一致性/**🔴 文档同步闭环（D6 落地：changelog 功能点→项目文档覆盖率对照）**。涉及 CLI 迁移时 shellcheck 在此补跑 |
| 九 | 发布前质量闸门 + 工具脚本健康检查 | 作者 | 是（步骤 22 开新 session 跑 fresh-eyes-loop） | loop 修复 + changelog 打勾 + check-version/bump-version/pre-push-check 覆盖同步 + 过时检查清理 |
| 十 | 确认关口 | AI → **生成发布 prompt 交接** | 否 | git diff 确认 → 检查清单打勾 → 生成发布 prompt 交给负责人（可授权 AI 代执行） |
| 十一 | 发布（含本地安装） | **🔴 项目负责人，或授权 AI 代执行** | 否 | 先装本地版本验证 → 再按依赖层分批 npm publish + git tag + gh release + Skill 分发。**网络降级**：tag 推上后 gh release/Skill 分发不依赖 main push |
| 十二 | 发布后 | 作者 | 是（步骤 35 开新 session 读 `fresh-eyes-review.md` 做审查） | npm 验证 + CI 全绿检查（步骤 33）+ 发布后审查 → 生成下版本开发 prompt 到桌面（步骤 37）→ 自动进入下版本阶段一 |

---

## 附：历史教训索引（按版本倒序）

> 正文散落大量 `vX.Y.Z 教训`，此索引便于按版本号快速定位。每条保留：版本 | 教训摘要 | 所在阶段。

| 版本 | 教训摘要 | 所在阶段 |
|------|---------|---------|
| v1.1.9 | tag 后零 commit 校验（tag 后有游离 commit = tag 与仓库不一致） | 阶段十一 |
| v1.1.9 | LIMITATIONS 覆盖新功能（文档滞后 P1）+ evidence 文件测试数一致 | 阶段八 |
| v1.1.9 | 文档同步闭环（changelog 写了但项目文档零提及 = 用户不知道有功能） | 阶段八 |
| v1.1.8 | 发版日期跨天漂移（bump-version 写入旧日期，check-version 硬编码 EXPECTED_DOC_DATE） | 阶段八 |
| v1.1.8 | 开发 session 与发版 session 分离（交付物清单闸门 D1-D6） | 阶段二 |
| v1.1.8 | macOS 兼容：npm publish 用 `(cd engine/xxx && ...)` 子 shell，不用 `cd ../xxx &&` | 阶段十一 |
| v1.1.8 | 网络降级策略（git push 超时时 gh release/Skill 分发不依赖 main push） | 阶段十一 |
| v1.1.7 | changelog 章节顺序铁律（新功能在前、BugFix 在后） | 阶段一 |
| v1.1.7 | 验证文件防膨胀瘦身（回归清单≤1000 行、acceptance-test≤1500 行） | 阶段五 |
| v1.1.6 | shellcheck 扫描范围与 CI 一致性（新增含 .sh 的目录须同步 find 范围） | 阶段九 |
| v1.1.4 | acceptance-test 对新功能零覆盖（覆盖率交叉检查） | 阶段六 |
| v1.1.4 | ClawHub 版本号从 1.0.0 自增（必须显式 `--version X.Y.Z`） | 阶段十一 |
| v1.1.4 | Release notes 链接必须用 markdown 语法（反引号纯文本不可点击） | 阶段十一 |
| v1.1.4 | 孤儿配置文件排查（pnpm-workspace.yaml 等不属于本项目技术栈的残留） | 阶段九 |
| v1.1.3 | acceptance-test 场景数落后于代码实现（每版本发版后需先审查更新） | 阶段三 |
| v1.1.3 | package-lock.json 禁止 sed 直接改（污染外部包版本→CI 崩溃） | 阶段八 |
| v1.1.3 | npm 版本号永久锁死（publish 后 unpublish 无法复写） | 阶段十一 |
| v1.1.3 | Step 3 只 echo 不判 FAIL 是虚假绿色（5/12 包滞留旧版本未发现） | 阶段十一 |
| v1.1.0 | 12 包按依赖层分批发布（npm workspace symlink 在 publish 时不生效） | 阶段十一 |
| v1.1.0 | CLI 迁移版本回归闸（shellcheck 跳过本阶段，延后到阶段八补跑） | 阶段八 |
| v1.0.9 | skillhub CLI 语法与 clawhub 不同（无 `skill` 子命令） | 阶段十一 |
| v1.0.9 | FDE ClawHub slug "fde" 冲突（必须用 `--slug sofagent-fde`） | 阶段十一 |
| v1.0.7 | 忘了更新本机全局安装（QA 测试时跑旧版本） | 阶段十一 |
| v1.0.4 | dist 与 src 同步验证 | 阶段三 |
| v1.0.4 | 审查文档自身也会过时（每版本审视数字/路径/维度有效性） | 阶段七 |
| v1.0.3 | changelog 文件命名三段式（vX.Y.Z.md） | 阶段一 |
| v1.0.3 | Release Notes 完整性检查（body 不为空 + 非 Draft） | 阶段十一 |
| v1.0.3 | SKILL.md 覆盖检查（check-version 动态扫描，version 字段须三段式） | 阶段八 |
| v1.0.2 | 版本重编号全局 grep（区分历史引用 vs 未来规划引用） | 阶段八 |
| v1.0.2 | 文档日期检查（bump-version 只改版本号不改日期） | 阶段八 |
