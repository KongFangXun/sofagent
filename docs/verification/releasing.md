# sofagent 版本开发 SOP

> v0.95 实践沉淀。**十二阶段**：审查→开发→自测→代码审核→审查体系合并更新（含瘦身检查）→OpenClaw 全面检查→审查体系最终确认→文档收尾→工具脚本健康检查→确认关口→发布（含本地安装）→发布后。
> 🔴 v0.95 起，版本号操作用 `bump-version.sh` + `check-version.sh`，禁止手动 grep/sed。
> 🔴 v1.0.3 起，文档预算分层检查（A 用户文档 / B 开发者参考 / C 审查体系 / E 指南），见 `check-docs.sh`。
> 🔴 回归检查已升格为**独立阶段**（阶段六）——需要全新 session，不再作为"审核"的子步骤。

---

## 阶段一：审查 → 开发日志

上一版本发布后，由发布后审查（fresh-eyes-review.md）驱动新版本的开发方向。

| # | 步骤 | 谁做 | 产物 |
|:--:|------|:--:|------|
| 1 | 上一版本接受独立审查（GLM + DeepSeek），产出 P0/P1/P2 清单 | 作者 | 审查报告 |
| 2 | 写 `docs/changelog/vX.Y.md`，含：问题描述 → 修复方案 → 验证方式 → 发布检查清单 | 作者 | 开发日志 |

> **🔴 changelog 章节顺序铁律（v1.1.7 教训）**：合并版本（新功能 + BugFix 同版）时，**新功能在前、BugFix 在后**。用户读 changelog 第一眼看到的应该是「这个版本带来了什么新价值」，而不是「修了上个版本的哪些坑」。BugFix 放前面会让用户觉得这只是个补丁版，掩盖了新功能的价值传达。背景段的两行概述同理——先写新功能一句话，再写 BugFix。

---

## 阶段二：开发

按优先级分三批，每批独立派发/回报/核实，禁止合并批次。

| # | 优先级 | 谁做 | 说明 |
|:--:|:--:|:--:|------|
| 3 | P0 安全硬伤 | 工程师 | 必须修，阻塞发布。**每修完一个 P0/P1，顺手在回归清单追加检查项——趁记忆新鲜，不要等到发版前才回忆。** |
| 4 | P1 工程欠债 | 工程师 | 应该修 |
| 5 | P2 改进 | 工程师 | 不阻塞发布 |
| 6 | 审查体系更新 | 工程师 | 随修复同步更新：① 回归清单追加检查项（编号递增）② 发布后审查文档（`fresh-eyes-review.md`）补充新盲区维度/任务。**不要等到阶段三和阶段八才做——开发时记忆最新，随修随记** |
| 6b | 版本号前置 bump | 工程师 | 开发完成后、自测前：`./tools/bump-version.sh <旧> <新>` → `./tools/check-version.sh` 全绿。npm 不动 |

**🔴 开发铁律（v1.0.3 教训）**：
- **🔴 版本号前置（v1.1.3 流程优化）**：开发完成后、进入自测（阶段四）之前，先跑 `bump-version.sh <旧版本> <新版本>` 把 13 类位置全部更新到目标版本号。然后跑 `check-version.sh` 确认全绿。这样测试阶段所有版本号已统一，不会出现「全局 v1.1.2 vs SSOT v1.1.3」的漂移。npm publish 仍在阶段十一，版本号一致性 ≠ 发布。
- 对 optional dependency（如 deepagents）的类型断言统一用 `as unknown as` 双重转换——本地编译通过不代表 CI 通过

---

## 阶段三：自测

开发完成后、交审核之前，工程师先自己跑一轮。

> 🔴 **v1.0.9 教训**：步骤 9（shellcheck）依赖当前版本的 CLI 命令名。如果本版本涉及 CLI 命令迁移（如旧命令改名、上帝包子命令拆到新包二进制），shellcheck **跳过本阶段**，延后到阶段八文档收尾全部完成之后补跑——那时文档引用和脚本命令名都已更新完毕，跑出来才是真实结果。build + test（步骤 7/8）不受影响，正常执行。acceptance-test 已挪到阶段6新 session 跑，不在本阶段执行。

> 🔴 **v1.1.3 教训**：每版本发版后，验收测试文件自身的功能也会过时——**场景数落后于代码实现、新增功能零覆盖**。在跑验收测试之前，必须先审查并更新 `tools/acceptance-test.sh`，确保本版本新增的每条功能都有对应的验收场景。

| # | 步骤 | 验证方式 |
|:--:|------|------|
| 7 | `npm run build` | exit 0 |
| 8 | `npm test` | 全部通过 |
| 9 | `shellcheck sofagent/scripts/*.sh tools/*.sh FDE/fde-install.sh` | 零 error。⚠️ 涉及 CLI 命令迁移时跳过，延后到阶段八之后 |
| 10 | 改动清单核对 | diff 确认只改了 changelog 规定的文件 |
| 11 | dist 与 src 同步验证（v1.0.4 教训）<br>`diff <(grep "关键命令" src/index.ts) <(grep "关键命令" dist/index.js)` | 无实质差异（排除编译格式化） |
| 12 | **🔴 更新 `tools/acceptance-test.sh`**<br><br>**Step A — 对照 changelog 找出缺口**：<br>① 读本版本 `docs/changelog/vX.Y.md`，列出所有新增/变更的功能点<br>② 逐条 grep `tools/acceptance-test.sh`，确认每条功能有对应场景——**只新增场景，不改现有场景编号**<br><br>**Step B — 更新 `tools/acceptance-test.sh`**：<br>① 在最后一个场景与总结段之间追加新场景（用 `scenario N "描述"` 格式）<br>② 更新文件头第 4 行：场景总数 + 功能描述<br>③ 新场景使用已有辅助函数（`pass`/`fail`/`git_log_has`），遵守 pipefail 安全约定<br>④ 改后跑 `bash -n tools/acceptance-test.sh` 确认语法<br><br>**Step C — 同步 `docs/verification/regression-checklist.md`**：<br>如果新场景暴露了之前遗漏的检查维度，追加到回归检查清单（编号递增）<br><br>**🔴 Step D — 覆盖率闭环判定**：<br>① **场景数声称 vs 实际对齐**：`DECLARED=$(head -5 tools/acceptance-test.sh \| grep -oE "[0-9]+ 个端到端" \| grep -oE "[0-9]+"); ACTUAL=$(grep -c "^scenario " tools/acceptance-test.sh); [ "$DECLARED" = "$ACTUAL" ]` 不一致 = P0<br>② **功能点逐条对照**：从 changelog「核心变更/交付」提取功能关键词，逐条 grep `tools/acceptance-test.sh`——零覆盖 = P0（回归测试无法发现该功能退化）<br>③ **失效场景清理**：`grep -rn "sofagent-audit --daemon\|work模板市场/" tools/acceptance-test.sh` 期望零命中 | `bash -n tools/acceptance-test.sh` 通过；**Step D 三项判定全 PASS** |
| ~~13~~ | ~~`bash tools/acceptance-test.sh`~~ → **已挪到阶段6**。acceptance-test 不在开发 session 跑（避免确认偏差），改由阶段6的独立审查者在新 session 里跑，与 regression-checklist 一起执行 | — |
| ~~14~~ | ~~OpenClaw 综合验证~~ → **已取消**。原独立 Agent 端到端验收文件已合并入 acceptance-test.sh。acceptance-test + regression-checklist 统一在阶段6的新 session 里一起跑（独立审查者执行），开发 session 不跑 acceptance-test | — |

---

## 阶段四：代码审核

在当前 session 中，拿着 changelog 当核对表，逐项确认每个改动存在且正确。核心价值不是"换模型"，而是"拿 changelog 当 checklist 逐项验证代码"——代码就在磁盘上，读 diff 验证不需要换脑子。真正的独立性验证交给阶段六。

| # | 步骤 | 谁做 | 验证方式 |
|:--:|------|:--:|------|
| 15 | 逐项核对 changelog 每一项 | 当前 session | 逐文件读源码/diff，逐项确认改动存在且正确，标记 PASS/FAIL |
| 16 | FAIL 项修复 | 当前 session（切回开发者角色） | build + test 全绿 |

---

## 🔴 阶段五：审查体系合并更新（回归清单 + 发布后审查，一步完成）

> ⚠️ 本版本已开发完成，遇到的问题和情况都已清楚——**回归清单维度**和**发布后审查**在**同一步骤**一并更新，不要拆成两步。趁记忆最新，把"修过什么"和"下次从什么角度能一眼看出"同时写进去。

所有 P0/P1/P2 开发修复完毕、自测和代码审核全部通过后，执行以下步骤：

| # | 步骤 | 谁做 | 验证方式 |
|:--:|------|:--:|------|
| 18 | **合并更新两份审查文档**：① 汇总本版本所有修复项，抽象为回归检查维度（编号递增）写入 `regression-checklist.md`；② 同步把本版本暴露的新盲区 / 新维度 / 新攻击面写入 `fresh-eyes-review.md`。两项一并完成，不要留到后面 | 当前 session | `git diff` 显示两份文档均有新增；新增维度 ≥ 本版本修复数 |
| 19 | **当前 session 逐项验证**：每条新增回归维度跑一遍命令确认可执行；确认 `fresh-eyes-review.md` 新维度与回归维度互相印证、无矛盾 | 当前 session | 所有新增维度可执行 + 两份文档互相印证 |

> ✅ 完成 步骤 18 → 19 后，**开发 session 的文档工作已一气呵成**——回归清单 + 发布后审查全部在当前 session 更新完。接下来只有**阶段六需要开新 session 控制 OpenClaw**，到那时才停。

> 🔴 **瘦身检查（每 3 个版本执行一次，v1.1.3 起）**：回归清单历史上曾膨胀到 288 维度（3686 行），2026-07-18 治理归并为 15 维度。为防止再次膨胀，每 3 个版本在步骤 18-19 完成后追加以下步骤。

| # | 步骤 | 谁做 | 验证方式 |
|:--:|------|:--:|------|
| 20 | **瘦身检查——逐维度过 3 个问题**（每 3 版）：<br><br>**问题 ① 工具覆盖？**这个维度的检查是否已被 pre-push-check.sh / check-docs.sh / acceptance-test.sh 全量覆盖？若是 → 移除该维度（标注 `[vX.Y.Z 移除: 被 XX 工具覆盖]`）<br><br>**问题 ② 命令还跑得通？**该维度的 bash 命令引用的文件路径、CLI 命令名、grep 模式是否仍然有效？若失效超过 2 个版本 → 移除；若小修可用 → 更新命令<br><br>**问题 ③ 与其它维度重叠？**用该维度关键词 grep 同 section 内其他维度，检查是否有 ≥50% 的检查目标文件重叠。若是 → 归并：选一个做主编号，其余降为 `# 子项:`，空闲编号回收<br><br>**执行方式**：打开 `regression-checklist.md`，从维度 1 到维度 N 逐条在心里问这 3 个问题。归并结果直接改文件，移除前确认 bash 命令确实不可执行 | 当前 session | 清单行数 ≤ 上次瘦身时的 120%；归并的维度有 `> 归并自：` 注释；移除的维度有 `[vX.Y.Z 移除]` 标注 |
| 21 | **瘦身自验证**：跑维护公约自校验脚本确认标题声称数 = 实际 #### 数 | 当前 session | 一致 |

> 💡 **瘦身检查不是每次发版都做**——每 3 版一次即可。如果本次版本号末位能被 3 整除（如 v1.1.3、v1.1.6），执行步骤 20-21；否则跳过。本规则的目标是**让清单保持轻量但不增加负担**。

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
2. 【v1.0.8 优化】构建审计包：在跑任何依赖 dist/ 的检查前，先 `cd sofagent/audit && npm run build`。否则 --version / --help banner / `ontology view` / `compose` 等基于 dist 的回归维度与验收场景会命中 stale dist 误报 FAIL
3. **🔴 端到端验收测试** —— `bash tools/acceptance-test.sh`，跑完全部场景。记录结果：场景数 / 通过数 / 失败数 / 失败场景编号清单。⚠️ 涉及 CLI 命令迁移时 acceptance-test 可能大量 FAIL——如果是因为脚本引用了已废弃命令（如 `sofagent-audit --daemon`），标 SKIP 并说明原因，不算真 FAIL
4. **回归检查** —— 读 `docs/verification/regression-checklist.md`，用 Bash 跑全部维度验证命令，逐项输出 PASS/FAIL/SKIP。**维度24（验收测试覆盖率）此时可引用步骤3 acceptance-test 的真实结果做对照**，而不是干 grep
5. **🔴 覆盖率交叉检查（v1.1.4 教训——acceptance-test 对新功能零覆盖）** —— 读 `docs/changelog/vX.Y.md`「核心变更/交付」章节，提取每条功能关键词（如新规则号 A18/A19、新模块 LOOP/USB/工具注入等）。逐条 grep `tools/acceptance-test.sh`，确认每条功能都有对应场景。**零覆盖 = FAIL**（回归测试无法发现该功能退化）
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
| **有 FAIL** | 你把 stage6 合并报告带回开发 session → **回阶段三**（根据问题优化 `regression-checklist.md` + `fresh-eyes-review.md` 两个文档）→ 再开新 session 重跑本阶段 |

> 🔴 **循环测试机制**：阶段六任何 FAIL → 回**阶段三**（优化回归清单 `regression-checklist.md` + 发布后审查 `fresh-eyes-review.md` 两个文档）→ 再开新 session 控制 OpenClaw 重查。全部改完、阶段六全 PASS 后，进阶段七。最多循环 2 轮；2 轮仍不过则在报告中标注遗留问题，交开发侧决策。

> 时序说明已内嵌在 prompt 的步骤 5——回归清单中标注「⏰ 待发版」的检查项（git tag / npm registry / 全局二进制版本）在检查阶段必然不满足，这是正常的，不标 FAIL。

---

## 阶段七：审查体系最终确认

> 本阶段在**开发 session** 中执行，更新文档，不需要新 session。

阶段三已合并更新两份审查文档，此处做**最终确认**：确认 `regression-checklist.md` 与 `fresh-eyes-review.md` 状态一致、无遗漏，本版本新盲区均已落档。若阶段六循环修复中暴露了新盲区，在此补充。

| # | 步骤 | 验证方式 |
|:--:|------|------|
| 22 | **最终确认两份审查文档**：regression 维度与 fresh-eyes 维度互相印证，循环修复中暴露的新盲区已补入 | 两份文档最终状态见于文件 diff |
| 22b | **🔴 确认 acceptance test 的审查维度已同步**（v1.1.4 教训）：`regression-checklist.md` 维度 24「验收测试覆盖率与时效性」+ `fresh-eyes-review.md` 维度八任务 30「验收测试场景覆盖率与功能对齐」——两处都必须覆盖本版本新功能的验收场景缺口 | grep 两份审查文档含本版本新功能关键词 |

**审查体系闭环**（v1.0.4 教训）：审查文档自身也会过时——每次发版后审视 `fresh-eyes-review.md` 和 `regression-checklist.md` 的数字、路径、维度是否还有效。**验收测试同理**（v1.1.4 教训）——`acceptance-test.sh` 的场景数和覆盖范围必须与 changelog 功能点对齐，否则回归测试形同虚设。

---

## 阶段八：文档收尾（🔴 v0.92 踩坑最密集）

### 开发日志自更新

- 补上本轮 `npm test` / `acceptance-test` / `shellcheck` / `check-version` 的实际结果（不要留占位符）
- 开发日志是活文档，代码改完立刻回写，不要等
- 发布检查清单全部打 `[x]`（在阶段十确认关口之后）

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

#### 同步 package-lock.json（🔴 v1.0.3 + v1.1.3 教训）

bump-version.sh 改了 `package.json` 但不会自动同步 `package-lock.json`。必须手动执行：

```bash
npm install --package-lock-only
# 验证
grep -A3 '"sofagent/audit":' package-lock.json | grep '"version"'
grep -A3 '"sofagent/mcp":' package-lock.json | grep '"version"'
# 两个都应该是新版本号
```

**🔴 v1.1.3 铁律**：**禁止用 `sed` 直接改 `package-lock.json`**——全局替换 `1.1.0→1.1.3` 会把外部包（如 `reusify@1.1.0`）也污染为不存在的版本（`reusify@1.1.3`），导致 CI 全平台 `npm ci` 崩溃。只能用 `npm install --package-lock-only` 重新生成锁文件。

#### 🔴 v1.1.3 npm 发布铁律：版本号永久锁死

npm 版本号一旦 publish 就**永久封存**——即便 `npm unpublish --force` 成功删除了表象，后台数据库里那个版本号仍然被占用，`npm publish` 会报 `E400 Cannot publish over previously published version`。

**教训**：
1. **不在发布前做任何实验性 `npm publish`**——哪怕只发了一个叶子包，那个版本号就锁死了
2. **发布前必须跑完整的 script/bump/publish 流水线**——不能边修边发
3. **发错了版本号 = 永久浪费**——npm support 也不会帮你解封（除非重大安全事故）
4. **unpublish 只能用来"隐藏"，不能用来"复写"**

```bash
# ❌ 永远不要这样：
npm publish # 发了一个包，发现有问题
npm unpublish --force  # 删掉
npm publish # 重新发 → 400 Cannot publish over previously published version

# ✅ 正确流程：
# 发之前确认一切就绪 → 一次性批量发布 → 发完即锁定
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
| `ROADMAP.md` 五步更新 | 结构性改动（删节/迁移），不是纯替换 | 每次发版手动做五步（详见阶段八） |
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

> 如果本版本涉及 CLI 命令迁移（旧命令改名、上帝包子命令拆到新包二进制），阶段四跳过的 shellcheck（步骤 9）在**此处补跑**——文档收尾已完成，所有引用已更新，跑出来是真实结果。acceptance-test 不在此处补跑——它已挪到阶段6新 session 跑（由独立审查者执行）。

```bash
# 补跑 shellcheck
shellcheck sofagent/scripts/*.sh tools/*.sh FDE/fde-install.sh   # 期望：零 error
```

> 如果 shellcheck 因脚本未适配新命令而大量 FAIL，标注为已知遗留并写入下版本的 Wave 5 适配计划。acceptance-test 同理——在阶段6新 session 跑时如因 CLI 迁移大量 FAIL，标注为已知遗留。

---

## 阶段九：工具脚本健康检查（v1.1.3 教训）

> 工具脚本和产品代码同步演进，不要等脚本报错才发现缺口。每次发版前过一遍——这一步防止「check 能查但 bump 不改」「新增目录没进排除规则」「regression-checklist 路径过时」三类结构性盲区。

| # | 步骤 | 验证方式 |
|:--:|------|------|
| 23 | **新增文件类型/目录排查**<br><br>① 本版本有没有新增文件类型（如 `.yaml`/`.toml`/`.json5`）？→ `check-version.sh` 是否需要加对应检查项？`bump-version.sh` 是否需要加对应 bump 步骤？<br>② 本版本有没有新增目录（如 `LOOP/`/`agents/`/`docs/new-section/`）？→ `bump-version.sh` 和 `check-version.sh` 的 `find` 排除规则是否需要更新（`_archive`/`docs/archive`/`node_modules`/`dist`）？<br>③ 本版本有没有文件迁移（如 `audit/src/` → `core/src/`）？→ `regression-checklist.md` 中的路径是否需要更新？跑 `grep -rn "旧路径" docs/verification/regression-checklist.md` 确认<br>④ **🔴 v1.1.4 教训：孤儿配置文件排查**——`pnpm-workspace.yaml` 是上个版本的残留配置（项目用 npm workspace，文件不被任何工具读取）。本步追加：扫根目录有无不属于本项目技术栈的配置文件（`pnpm-workspace.yaml`/`yarn.lock`/`.ruby-version` 等），有则确认是否需要删除<br>⑤ **🔴 v1.1.6 教训：shellcheck 扫描范围与 CI 一致性**——本版本有没有新增含 `.sh` 的目录？→ `pre-push-check.sh` 的 shellcheck `find` 命令是否覆盖了所有含 `.sh` 的目录？对比 CI 的 `.github/workflows/shellcheck.yml` 确保一致（CI 扫全仓，本地也必须全扫）。v1.1.6 教训：`LOOP/` 有 `.sh` 但 pre-push-check 的 find 没扫它——CI 抓住了，本地门禁放行。另外检查本地 shellcheck 版本 ≥0.11.0（与 CI 对齐），低于则 warning 提示升级——v0.10.0 对 SC2155 等 warning 判定宽松（exit 0），v0.11.0 更严格（exit 1），版本差会导致本地过了 CI 挂了 | 五项逐一确认，有变更则更新对应脚本；④ 额外扫孤儿配置；⑤ `grep "find.*\.sh" tools/pre-push-check.sh` 抓当前扫描目录，与 CI shellcheck.yml 的 files 配置对照 |
| 24 | **三脚本对照检查**<br><br>① `check-version.sh` 检查的每一类文件，`bump-version.sh` 是否都有对应的 bump 步骤？（缺口 = check 能发现但不自动修复——如 v1.1.3 发现的 10 个 workspace 子包 version 字段）<br>② `pre-push-check.sh` 的检查项数量是否和 CHANGELOG/ROADMAP 声明的一致？（v1.1.3 教训：声明 13 通过，实际 15 通过/16 项）<br>③ `check-version.sh` 的检查项编号分母是否和实际检查项数一致？（v1.1.3 教训：`[1/13]~[12/13]+[13/14]+[14/14]` 分母跳变） | ① `diff <(grep '──\|✓\|✗' <(./tools/check-version.sh 2>&1 \| grep '── \[')) <(grep '\[.*\/13\]' tools/bump-version.sh)` 粗略对照<br>② `./tools/pre-push-check.sh 2>&1 \| grep '结果:'` 的数字和 CHANGELOG 声明对比<br>③ `grep '\[.*\/' tools/check-version.sh \| head -20` 检查分母一致性 |
| 25 | **过时检查清理**<br><br>**机制**（v1.1.4 重构——从版本专用硬编码升级为通用框架）：<br><br>**Step A — 从 SSOT changelog 推导检测模式**：<br>读 `docs/changelog/v{SSOT}.md`，从「核心变更」「缺陷修复」章节提取本版本涉及的废弃/变更项。按以下模板生成检测关键词：<br>　· 新增规则 → 搜索旧规则数（如 v1.1.4 新增 A18/A19 → 搜索 `19 条规则`）<br>　· 废弃命令/入口 → 搜索旧命令（如 `sofagent-audit --daemon`）<br>　· 测试数变化 → 搜索旧测试数（如 `343` → 388）<br>　· 术语更名 → 搜索旧术语（如 `回溯引擎` → `回溯能力`）<br>　· 删除的标志/功能 → 搜索删除项（如 `verify.js --list`）<br>　· **🔴 目录更名（v1.1.4 教训）→ 搜索旧目录名**（如 `work模板市场` → `模板市场`，这种更名会留下 markdown 相对路径死链——`./work模板市场/` 在 README 里变成死链。grep 搜索旧目录名 + 跑 `bash tools/check-docs.sh` 维度 1b「全仓相对路径死链扫描」）<br><br>**Step B — 运行检测**：`grep -rn '<模式>' docs/ *.md --include='*.md' \| grep -v 'docs/changelog/\|.workbuddy/\|node_modules/'` + `bash tools/check-docs.sh`（特别是维度 1b 死链扫描）<br><br>**Step C — 判定与分类**：<br>　· 历史记录（changelog 正文、审查盲区描述）→ 保留，不标过时<br>　· 当前文档（README/ARCHITECTURE/LIMITATIONS/指南）→ **必须更新**<br>　· 检查模式自身（regression-checklist 中的 grep 命令）→ 保留<br><br>**Step D — 历史存档**：将本版本新增的废弃项追加到下面的「历史废弃项」表，供后续版本回溯——**不要替换**，累积追加。<br><br>**硬规**：检测结果中，除 changelog 历史记录和检查模式自身外，**零残留**。<br><br>── 历史废弃项（按版本累积，只追加不替换）──<br><br>**v1.1.4 废弃/变更项**（SSOT 1.1.3→1.1.4）：<br>· `sofagent-audit --daemon` → `sofagent-daemon`（daemon 独立 CLI）<br>· `19 条规则` → `21 条`（A18/A19 新增）<br>· `343` tests → `388`（audit）/ `558` → `660`（全 workspace）<br>· `回溯引擎` → `回溯能力`（v1.1.3 更名，v1.1.4 继续清理残留）<br>· `verify.js --list` → 删除（标志不存在）<br>· pre-push-check 数字：`14/14` → 去硬编码<br>· `work模板市场/` → `模板市场/`（目录更名，README 4 处死链）<br>· `engineering-*` → `sofagent-*`（Skill 命名统一） | 除 changelog 历史 + 检查模式自身外，**零残留**（0 处） |

---

## 阶段十：确认关口

文档全部收尾后，**必须**让作者过一遍改动，确认没问题再交接给项目负责人发版。v0.92 的教训：文档收尾完直接发布，没人确认，导致遗留问题。

| # | 步骤 | 验证方式 |
|:--:|------|------|
| 26 | 展示全部改动清单 | `git diff --stat` |
| 27 | 作者逐项确认 | 重点看版本号、ROADMAP、CHANGELOG |
| 28 | 确认通过后，开发日志「发布检查清单」打 `[x]` | 不在文档收尾前打勾 |
| 29 | **AI 生成发布 prompt，交接给项目负责人**——发版命令由 AI 准备但绝不执行 | AI 输出完整的发布 prompt（含 npm publish / git tag / gh release / Skill 分发 / 发布后验证），项目负责人亲手跑 |

---

## 阶段十一：发布（🔴 项目负责人根据 AI 生成的发布 prompt 亲手执行）

> AI 在阶段十确认关口生成一份完整的发布 prompt（含所有命令），项目负责人（孔放勋）拿到后亲手逐条执行。npm publish、git tag、gh release create 涉及凭证和权限，AI 绝不代劳。

### 本地安装（自己吃自己的狗粮）

> v1.1.3 教训：发版后才想起本机装的还是旧版本。**全部验证通过、准备发布时，先把最新版装到本机**——全局 npm 和本地 Skill 同步。这是发布前的最后一块狗粮，确认本机能正常跑新版本。

```bash
# 1. 全局安装最新 audit 包（从本地源码构建安装，不需要等 npm publish）
cd sofagent/audit
npm run build && npm install -g .
cd ../..

# 2. 验证版本号
sofagent-audit --version  # 应显示当前开发版本号

# 3. 本地 Skill 同步（WorkBuddy + OpenClaw 双平台）
cp -r sofagent/skill/* ~/.workbuddy/skills/sofagent/
cp -r sofagent/skill/* ~/.openclaw/skills/sofagent/
cp FDE/SKILL.md ~/.workbuddy/skills/sofagent-fde/
cp -r agents/SKILL/sofagent-fde/ ~/.workbuddy/skills/sofagent-fde/
cp -r agents/SKILL/sofagent-audit/ ~/.workbuddy/skills/sofagent-audit/
cp -r agents/SKILL/sofagent-fde/ ~/.openclaw/skills/sofagent-fde/
cp -r agents/SKILL/sofagent-audit/ ~/.openclaw/skills/sofagent-audit/

# 4. dogfood 验证（在当前 workspace 跑最新的 --doctor）
sofagent-audit --doctor
```

> ⚠️ `npm install -g .` 从本地源码安装，不会走 npm registry。**发版时的 `npm install -g @sofagent/audit@latest`（阶段十一·步骤 19）仍然必须做**——那是验证发布的 npm 包。这里是发布前的自用安装。

### 发布前检查（npm 包洁净度 + 推前预检）

```bash
# 🔴 v0.99.1 起铁律：推前预检必须全绿
bash tools/pre-push-check.sh            # 全绿（全量 workspace）
bash tools/check-docs.sh                # 文档死链 + 预算 + Skill 行数

# 全部 12 包 .js.map 泄露检查 + 类型检查 + README 非空检查
for pkg in harness ontology eval core audit think mcp orchestrator daemon ab-test work模板市场 skillopt; do
  echo "=== $pkg ==="
  (cd sofagent/$pkg && npm pack --dry-run 2>&1 | grep -c '\.js\.map')  # 期望: 0
  (cd sofagent/$pkg && npx tsc --noEmit && echo "✅ tsc")
done
# 🔴 v1.1.3 教训追加（mcp README 0 bytes）：发布前检查 README 非空
for pkg in audit mcp; do
  size=$(npm pack --dry-run 2>&1 | grep -c 'README\|total files' || true)
  echo "$pkg pack 输出: $(cd sofagent/$pkg && npm pack --dry-run 2>&1 | tail -1)"
done
echo "⚠️ 确认 audit/mcp 的 README.md 在 npm pack 输出中有内容——v1.1.3 mcp README 0 bytes"
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

── Step 3: 验证全部 12 包（🔴 v1.1.3 教训强化——只 echo 不判 FAIL 是虚假绿色） ──
NEW_VER="1.1.X"  # 替换为实际新版本号
FAILED=""
for pkg in harness ontology eval core audit think mcp orchestrator daemon ab-test work模板市场 skillopt; do
  ver=$(npm view "@sofagent/$pkg" version 2>/dev/null)
  if [ "$ver" != "$NEW_VER" ]; then
    echo "❌ @sofagent/$pkg: $ver（期望 $NEW_VER）"
    FAILED="$FAILED $pkg"
  else
    echo "✅ @sofagent/$pkg: $ver"
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
13. git tag vX.Y.Z && git tag -l "vX.Y.Z" --format='%(subject)' | grep "vX.Y.Z" || echo "⚠️ tag message 不匹配，建议重新打 tag"
14. git push origin vX.Y.Z
14. gh release create vX.Y.Z
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

15. clawhub skill publish ./sofagent/skill --slug sofagent --owner KongFangXun --version X.Y.Z --changelog " vX.Y.Z: {简短变更}"
16. skillhub publish ./sofagent/skill --version X.Y.Z
17. clawhub skill publish ./FDE --slug sofagent-fde --owner KongFangXun --version X.Y.Z --changelog "vX.Y.Z: {简短变更}"
18. skillhub publish ./FDE --version X.Y.Z
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
# 2. 包含 📖 [详细开发日志](./docs/changelog/vX.Y.Z.md) 链接——🔴 v1.1.4 教训：
#    必须是 markdown 链接语法（`[...](...)`），不是反引号包裹的纯文本路径
# 3. 不是 Draft 状态
gh release view vX.Y.Z --json isDraft,body -q '.body | length'  # 期望 > 100
gh release view vX.Y.Z --json body -q '.body | contains("](./docs/changelog/")'  # 期望: true（验证是 markdown 链接而非纯文本）

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
| **npm install -g . 权限问题（v1.1.4）** | 本地源码全局安装后 `sofagent-audit` 报 Permission denied | v1.1.4 已修：`chmod +x dist/*.js` 从 `prepublishOnly` 挪到 `build` 脚本。**npm registry 装的包无此问题**，只影响 `npm install -g .` 本地自装场景 |
| **release.yml publish-audit 失败（v1.1.1-v1.1.3，v1.1.4 修）** | GitHub Actions Release job 失败：`Failed to resolve entry for package "@sofagent/core"` 17 suites FAIL | 根因：publish-audit job 只在 sofagent/audit 目录跑 npm ci+test，漏 build @sofagent/core。v1.1.4 已修：改为根目录 workspace 构建（对齐 publish-mcp）。**每个 npm 包有 runtime 依赖其他 @sofagent/* 包时，CI 必须 workspace 模式 build** |
| **ClawHub 版本号显示错误（v1.1.4）** | ClawHub 显示 1.0.11 而非 1.1.4 | clawhub 默认 1.0.0 自增，不走 SKILL.md version。必须 `--version X.Y.Z --changelog "简短说明"` |
| **Release notes 链接不可点击（v1.1.4）** | `` 📖 详细开发日志：`docs/changelog/vX.Y.Z.md` `` 在 GitHub 不可点击 | 必须用 markdown 链接语法：`📖 [详细开发日志](./docs/changelog/vX.Y.Z.md)` |

---

## 阶段十二：发布后

| # | 步骤 |
|:--:|------|
| 30 | **npm 12 包验证**：全部 12 包版本一致，无 MISSING |
| 31 | npm README 验证：`npm view @sofagent/audit readme` + `npm view @sofagent/mcp readme` 均有内容 |
| 32 | 如果本次迭代暴露了新的流程漏洞，**直接吸收进本 SOP 对应阶段**——不要存到单独章节。每条新规则标注版本号（如 `vX.Y 教训`）以便追溯 |
| 33 | **🔴 审查闭环——发布后审查**：<br>① **全新 session**：开一个对开发过程完全不知情的 Agent session，让它读取 `docs/verification/fresh-eyes-review.md`（已在本版本阶段三中更新），对已发布版本做独立审查<br>② **产出审查报告**：报告中的问题不阻塞当前版本——它们进入**下一版本的阶段一**，作为驱动下一版开发方向的 P0/P1/P2 清单<br>③ **如果发现新问题** → 自动成为下一版 releasing 的输入（回到阶段一开始新的迭代）<br>④ **审查体系持续自我进化**：每版积累"下轮会更锋利"的维度和检查项 |
| 34 | **SOP 自我进化**（FDE 提议 → 作者确认）：FDE 发版后自动跑一轮，生成 releasing.md 更新建议（diff 格式），作者确认后 apply。检查项：<br>① 本版本发布过程中遇到的流程漏洞 → 直接吸收进对应阶段，标注版本号<br>② 检查本 SOP 中的数字是否过期（维度数、检查项数、doctor 项数等）<br>③ 本版本新增的工具/脚本是否已纳入对应阶段（如 pre-push-check.sh、check-docs.sh）<br>④ 把更新后的 releasing.md 同步到 LOOP.md 的映射表<br>⑤ 如果 FDE 未发现需更新项，输出"无需更新"报告——零变更也是有效结果 |
| 35 | **生成「下一版本开发 Prompt」到桌面**：综合 `ROADMAP.md`（未来规划）+ `CHANGELOG.md` + 下一版本 `docs/changelog/vX.Y.md`（若存在），生成开发 prompt 落盘 `~/Desktop/vX.Y-dev-prompt.md`。<br>**若下一版本 changelog 尚未创建**：先 ① 写新版本需求并产出 `docs/changelog/vX.Y.md`；再 ② 生成桌面开发 prompt |
| 36 | **🔴 不再落盘独立审查 prompt（v1.1.5 决策）**：<br>发布的 `fresh-eyes-review.md` 本身已经是一份完整的、可直接在**新 session** 中执行的审查指令（5 轮 9 视角 + 维度 1-32）。额外生成 `~/Desktop/vX.Y-review-prompt.md` 落盘会造成两个文件各自演进、偏离同步——人来改 fresh-eyes-review 时忘了同步桌面 prompt，或者反过来用旧 prompt 跑新审查。**新 session 直接读 `docs/verification/fresh-eyes-review.md` 执行发布会后审查**——比单独维护一份桌面 prompt 更干净、更不容易过时。 |

### 下一版本开发 Prompt 生成说明（步骤 35）

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
| 一 | 审查 → 开发日志 | 作者 | 是（发布后审查） | 审查报告 + 开发日志 |
| 二 | 开发 | 工程师 | 否 | 代码 + 随修随记的回归维度 |
| 三 | 审查体系合并更新 | 当前 session | 否 | regression-checklist + fresh-eyes-review 同步更新 |
| 四 | 自测 | 工程师 | 否 | build/test 全绿 + 更新验收测试文件（acceptance-test 本身只更新不跑，跑在阶段6）。涉及 CLI 迁移时 shellcheck 延后到阶段八 |
| 五 | 代码审核 | 当前 session | 否 | 逐项 PASS 或 FAIL→修复 |
| **六** | **acceptance-test + regression-checklist（开新 session）** | **审核者控制 OpenClaw** | **🔴 是（全新认知；FAIL 回阶段三循环）** | **stage6 合并报告全 PASS** |
| 七 | 审查体系最终确认 | 作者 | 否 | 两份审查文档状态一致、无遗漏（初版已在阶段三写入） |
| 八 | 文档收尾 | 作者 | 否 | CHANGELOG/ROADMAP 五步/版本号/日期对齐。CLI 迁移版本在此处补跑 shellcheck/acceptance |
| 九 | 工具脚本健康检查 | 作者 | 否 | check-version/bump-version/pre-push-check 覆盖同步 + 过时检查清理 |
| 十 | 确认关口 | AI → **生成发布 prompt 交接** | 否 | git diff 确认 → 检查清单打勾 → 生成发布 prompt 交给负责人 |
| 十一 | 发布（含本地安装） | **🔴 项目负责人亲手执行** | 否 | 先装本地版本验证 → 再按依赖层分批 npm publish + git tag + gh release + Skill 分发 |
| 十二 | 发布后 | 作者 | 是（步骤 33 开新 session 读 `fresh-eyes-review.md` 做审查） | npm 验证 + 发布后审查 → 生成下版本开发 prompt 到桌面（步骤 35）→ 自动进入下版本阶段一 |

---

