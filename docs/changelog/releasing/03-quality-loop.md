# 阶段三：fresh-eyes-loop 质量循环 + 代码审核 + 验收测试

> **目的**：开发完的代码过一轮独立审查 + 验收测试，确保质量过关再进审查体系更新。
>
> ⚠️ **与阶段一的区分（先读，防混淆）**：阶段一审**上版本存量**（发版收尾态），阶段三审**本版本新开发代码**——即使阶段一走了对话式多轮审查，阶段三也不可跳过：审查对象不同，新开发代码必须过自己的独立审查。
>
> **执行方式（单次确认制）**：阶段三开始时用户做**一次**跑法裁定（下方「入口裁定」），确认内容三合一：跑法选择 + 自动修复循环授权 + 降级链授权。确认之后全程自动跑完——执行中途不再回头问「要不要继续修 / 要不要重跑 / 要不要换跑法」。唯二合法中断：**停手条件**命中（修复需对外动作 push/tag/publish、版本口径类 P0、连续 2 轮 ERROR、上限到顶）与**阶段边界硬停点**。

---

## 入口裁定（唯一确认点）

主 session 开场给一行裁定材料（commit 数 / diff 规模 / 版本类型 / 当前时段），用户二选一：

| | A · 快速路径 | B · 盲审路径 |
|---|---|---|
| 形态 | 单次草稿（或对话式多轮等价）+ 修复批 + 主 session 零信任复验 | 新 session 跑 fresh-eyes driver（单盲四角色，DSH worker）自动收敛循环 |
| 适用 | 小版本 / 变更面窄 / 待取证预期 ≤3 | 大版本 / 多模块交付 / P0 需独立复验 |
| 执行载体 | 当前 session + subagent（草稿降级与修复批） | 执行 session（用户**复制一次** prompt）+ 主 session 并行步骤三四 |
| 用户交互 | **零次复制**（草稿降级与修复批走 subagent 内部位移） | **恰好一次复制** |
| 审查独立性 | 草稿降级路径本身保证审查者≠收编者（subagent 审、主 session 复验） | driver 四角色流水线（A 审 12 视角 → B 修 → C 验 → D 复核，REOPEN 打回消耗修复批额度）+ 主 session 复验收编 |

**升级预授权（并入首次确认，不构成二次确认）**：

- A 复验后 **P0≥2 或待取证>5** → 主 session 直接生成 B 的 prompt 交用户复制（升级授权随首次确认生效，不再询问「要不要升级」）
- B 执行中环境故障（LLM 端点大输入超时 / DSH 依赖漂移 / 系统性 worker 全灭）→ 走模板内「环境异常豁免协议」（草稿升格 + 复验补偿 + 阶段五兜底，已预授权）
- 反向降级（B→A）**不预授权**——driver 已启动后撤跑属停手条件范畴，须请示

---

## 路径 A：快速路径（当前 session 直接收口 · 零复制）

1. **审查**：单次草稿优先——`node tools/gen/gen-fresh-eyes-draft.mjs --diff <patch 文件> --changelog <changelog> --out ~/Desktop/fresh-eyes-draft-vX.Y.Z.md`（16 视角草稿一次成型，「待取证」项少且变更小 → 草稿 + 人工复核即收口）。API 失败 → 降级路径：`.prompt.md` 落盘交 subagent 执行出**正式草稿**（降级≠豁免，`.prompt.md` 本身不算完成）。对话式多轮审查（主会话按 playbook 视角人肉多轮）与草稿产出等价可互换（见 [01-review.md](./01-review.md) 审查分层第三层）。
2. **修复**：草稿 P0/P1 项由主 session 零信任复验定性（逐项 grep 实证，不采信草稿结论——草稿 finding 是线索不是事实）→ 修复批交 subagent 执行（修复者≠复验者）→ 主 session 复验收编。修复批协议同引 [`auto-converge-protocol.md`](./auto-converge-protocol.md)。
3. **升级检查**：复验后 P0≥2 或待取证>5 → 触发升级预授权，转路径 B（生成 prompt 交用户复制）。
4. 步骤三/四（下方共用节）与审查并行推进。

> 取用配置参照 playbook 分层表（对话式形态）：常规发版 1-12 必跑，动态面 17-19（工具/门禁/hook/引擎改动版建议追加）、文档治理 13-14（文档大改版建议追加）、通读 15-16、发现面 22（门面改动）按版型选层；深度专项 20-21 留季度体检。

---

## 路径 B：盲审路径（复制一次 prompt · 执行 session 自动跑完全程）

> **防止 lost-in-the-middle**：执行 session 先读模板骨架确认要做什么，再按序执行。
> **主 session 并行面**：driver 后台跑时并行步骤三/四（代码审核 + 验收增量），不空等；运行窗口遵守冻结纪律（铁律一）。
> **循环语义**：driver 内建多轮「审查→修复→验证」与「连续 2 轮无 P0/P1」停止条件；执行 session 的增量职责 = driver 跑完仍有 P0/P1 残留时按「修复批协议」接手修复并重跑 driver（外层上限 2 次修复批）。

### driver 启动姿势（九条 · 执行 session 启动前必读）

> 每条规则都有实证来源，防再发。

| # | 姿势 | 说明与实证 |
|:--:|------|------|
| ① | **后台启动（仅限 driver 启动这一条命令）** | Bash 工具 `run_in_background:true` + `dangerouslyDisableSandbox:true`——三层进程嵌套会被 sandbox SIGKILL。🔴 后台参数**只属于 driver 启动命令本身**，启动之后的轮询等一切操作全部回到**前台**执行（见「监控协议」前台铁律） |
| ② | **输出重定向到文件** | `node FORGE/src/fresh-eyes-driver.mjs --target <版本号> --max-rounds 10 > /tmp/fresh-eyes-<ver>-driver.log 2>&1`——**禁止管道包装**（`\| head` 触发 SIGPIPE 杀 driver） |
| ③ | **先验证 round-start 再轮询** | 启动后等 8 秒读 `status.json`：event=round-start / phase=round-1-running 才算真跑起来，否则需重启 |
| ④ | **不传 timeout 参数** | 后台任务传 `timeout:600000` = 10 分钟上限杀 driver；后台无需 timeout，传了反而被杀 |
| ⑤ | **中断恢复用 `--resume` 续跑** | 异常死亡 → liveness 探针确认 → 命令加 `--resume`——driver 按产物完整性跳过已完成 worker，**保留已有产物续跑，绝不重开浪费** |
| ⑥ | **daemon + watch 守护优先** | `--daemon` spawn detached 自脱离进程树（会话结束不影响存活，日志 → runDir/driver.log）；`--watch <runDir>` 主管模式——每 30s 读心跳，心跳停 → 审计死因（death-audit.jsonl）→ **自动 `--resume` 拉起新 driver**（守护 v2 三闸：拉起封顶 RESUME_MAX=5 / 同 phase 快速死亡环检测（5min 窗口）判根因性退出 / watcher 自身每轮写 watcher-status.json 心跳），verdict.md 产出后 watcher 退出（`--watch-interval` 默认 30s / `--watch-threshold` 默认 90s）。watcher 退出留痕 runDir/watcher-exit.json（reason=verdict-done ✅ / resume-max・quick-death-loop・spawn-fail ❌ 需人工读 death-audit.jsonl）。**daemon+watch 就绪优先用**，裸后台（①~⑤）为 fallback |
| ⑦ | **独占窗口检查（三查）** | 启动前确认无其他 session 在写本仓库——一查 `git status --short \| wc -l` 改动文件数（预期 0 或个位数，几十个 = 有其他 session 在写）；二查近 5 分钟 mtime（`find . -path ./node_modules -prune -o -mmin -5 -type f -print`）；三查 `.workbuddy/memory/$(date +%Y-%m-%d).md` 今日日志有无他人活跃记录。**任一命中即停手问用户** |
| ⑧ | **driver 运行期并行步骤三/四** | driver 后台跑时当前 session 并行执行代码审核 + 验收增量，不空等 |
| ⑨ | **启动时段选择** | 重型 LLM loop 避开 GLM 3 倍价时段（工作日 14:00-18:00——高峰限流易触发 LLM 流 stall 熔断）；轮询用短命令快查，不挂超长 sleep（会被系统杀 exit 137） |

> **监控协议**：按 `FORGE/SKILL/fresh-eyes-loop/SKILL.md`——每 120 秒一轮读 `status.json`（短命令快查），session 保持活跃可见；心跳 >90 秒未更新用 `--check-alive <runDir>` liveness 探针（只认心跳不认日志——长 LLM 窗口日志冻结是正常，心跳停才是死）。
>
> 🔴 **轮询前台铁律**：`run_in_background:true` 只用于启动 driver 那一条命令——**每一轮轮询（sleep + cat status.json）必须在 session 前台执行**，禁止把轮询循环挂到后台（run_in_background / nohup 均禁）。挂后台 = session 空闲 = 用户界面看不到任何进展反馈。正确姿势：前台 `sleep 90~115` → 立即 `cat status.json` → 输出一行状态 → 下一轮。

### 执行 session Prompt 模板（自动收敛版 · 复制即跑）

> AI 输出 prompt 时必须把所有占位符替换为实际值（项目路径、版本号、runDir），不得残留花括号。
> 模板含 daemon+watch 守护优先 + resume 中断恢复两个分支——按上方「driver 启动姿势 9 条」执行。
> **交付形式铁律**：交接 prompt 直接在对话中输出可复制的文本块，禁止落盘成文件——用户复制粘贴到新窗口执行，**全程只此一次复制**（执行 session 内部的修复批/重跑/豁免降级全部自动，不再产生第二次复制）。

```
在 sofagent 项目（{项目实际路径}）中，执行 {实际版本号} 的 fresh-eyes-loop 自动收敛模式：跑 driver 多轮审查修复循环；driver 结束后仍有 P0/P1 残留则按「修复批协议」自行修复并重跑 driver；直到「连续 2 轮无 P0/P1」（driver 内建停止条件）或命中停手条件。用户已在阶段三入口裁定中一次性授权自动修复循环与环境降级链；修复时严格遵守下方红线与停手条件。

先读 `FORGE/SKILL/fresh-eyes-loop/SKILL.md` 拿到完整的「Session 监控协议」，然后按序执行：

0. 独占窗口检查（三查）：① `git status --short | wc -l` 改动文件数（预期 0/个位数，几十个 = 有其他 session 在写）② `find . -path ./node_modules -prune -o -mmin -5 -type f -print` 近 5 分钟活跃文件 ③ `tail .workbuddy/memory/$(date +%Y-%m-%d).md` 今日日志他人活跃记录——任一命中先停手问用户「是否还有其他 session 在写本仓库」。
0b. 先查 driver 是否已在跑：读 {runDir}/status.json（或 pgrep -f fresh-eyes-driver），若 running / 进程存活 → 跳过步骤 1 直接轮询；若已死/无产物 → 正常走步骤 1。
0c. 启动时段检查：工作日 14:00-18:00（GLM 3 倍价时段）不启动新 driver——等待并每 10 分钟报时，窗口过了再启动（周末全天平价）。

## 外层循环（修复批 N=0..2；N=0 即首轮 driver）

1. 启动 driver——优先 daemon+watch 守护模式（自动恢复，免疫会话回收）：
   FORGE_MAX_CONCURRENCY=1 node FORGE/src/fresh-eyes-driver.mjs \
     --target {实际版本号} --max-rounds 10 --daemon --watch {runDir}
   ⚠️ 8GB 机器必须 FORGE_MAX_CONCURRENCY=1（并发 worker 各占 2GB heap，3+ 并发即 OOM）
   ⚠️ 输出一律重定向文件（禁止任何管道包装，| head 触发 SIGPIPE 杀 driver）；不传 timeout 参数；启动后等 8 秒验证 status.json 出现 round-start 再进入轮询
   若为 resume 续跑（上次异常死亡）：命令加 --resume（保留已有产物，不重开）
   fallback（无 daemon 支持）：Bash 工具 run_in_background:true + dangerouslyDisableSandbox:true
2. 记住 runDir（启动日志第一行打印的路径）
3. **持续轮询（必做，非可选；🔴 前台执行，严禁挂后台）**：每 120 秒一轮读 <runDir>/status.json，
   输出一行状态（round 变化时一句话汇报）。前台「短 sleep + 快查」（sleep 90~115 后立即 cat 返回），
   不挂超长 sleep（会被系统杀 exit 137）；监控中断不影响 driver，续上后直接查 status.json。
   心跳冻结 >90 秒：daemon+watch 模式看 watcher 是否自动 resume（观察 death-audit.jsonl + 新 driver 拉起）；
   watcher 自身观测（守护 v2）：轮询时顺手读 runDir/watcher-status.json——其 ts 超 3×interval 未更新 = watcher 也死了，
   人工重启 watch（`node FORGE/src/fresh-eyes-driver.mjs --watch <runDir>`）；发现 watcher-exit.json 且 reason ≠ verdict-done
   = watcher 有意退出（拉起耗尽/快速死亡环/spawn 失败）——读 death-audit.jsonl 定位根因，不要盲目重启；
   fallback 模式用 pgrep 确认进程存活，无输出 = 已死 → 主 session 决定 --resume 续跑。
4. driver 终态（verdict 产出或 max-rounds 到顶）→ 读报告（findings/verdict 产物文件，非仅 status.json），
   统计未解决 P0/P1 计数，分支：
   - **无 P0/P1 残留**（连续 2 轮干净）→ 输出最终汇报，结束。不再做任何仓库写入。
   - **有 P0/P1 残留且修复批 <2 次** → 按「修复批协议」接手修复，修完回到步骤 1 重跑 driver
     （新 driver = 新视角独立验证 session 的修复，这不是重复劳动，是角色分离的复验环）。
   - **有 P0/P1 残留但修复批已 2 次** → 停手汇报（见停手条件）。

## 修复批协议（driver 残留 P0/P1 时执行——SSOT 先读）

**先读 [`auto-converge-protocol.md`](./auto-converge-protocol.md)**（修复批协议单一维护源：分诊三定性/红线/复绿/commit 收编/停手条件/汇报格式），按其执行。阶段三特化条目：

- 分诊第③类免修白名单：**版本中间态 finding**——npm registry 落后 / git tag 缺当前版本 / URL 指向未发布 tag / workspace 锁旧版；判别口径：该不一致会在「git push + tag + npm publish」三动作后自动消失 = SKIP
- 红线追加：禁止删 `fresh-eyes-review.md` 的审查视角或改视角定义来消音；禁止改 `fresh-eyes-calibration.md` 校准结论迁就当轮发现
- 外层硬上限 = **修复批 2 次**（driver 内建多轮循环是主通道，session 修复批是兜底不是主通道）
- 误报 SKIP 与存疑 DEFER 的留痕格式同 b-fix「分诊前置」节（`FORGE/SKILL/fresh-eyes-loop/prompts/b-fix.md`），分诊统计进汇报

🔴 **红线摘要（动手前必记）**：不改断言迁就 / 不删检查消音 / 不绕审计钩子 / 只动 finding 涉及文件。

## 环境异常豁免协议（driver 无法启动/无法收敛时——已随入口裁定预授权，无需二次请示）

环境故障（LLM 端点 300s 大输入超时 / DSH 依赖漂移 / 系统性 worker 全灭）使 driver 无法执行时，按降级执行链补偿，禁止裸跳过：

1. **豁免资格前置**：driver 至少真实启动尝试 2 次（含 `--resume` 续跑与平价时段重试各一），全部失败才具备豁免资格——启动尝试与失败形态记入汇报
2. **补偿措施（按优先级）**：
   - a. **草稿升格**：`node tools/gen/gen-fresh-eyes-draft.mjs` 产出草稿（工具失败则 `.prompt.md` 降级路径）；执行 session 对草稿 P0/P1 项逐项 grep 实证（不采信草稿结论）后按修复批协议处理——审查者≠修复者角色分离保持
   - b. **修复批照常走修复批协议**：分诊/红线/复绿/收编不变
   - c. **阶段五闸门兜底**：release-gate driver 的 regression/coverage worker 会重扫全维度，driver 缺位的盲区由闸门兜底——豁免汇报须注明「依赖阶段五兜底」
3. **留痕铁律**：最终汇报写「driver 环境豁免：<故障形态> + 补偿措施 a/b/c」；LEDGER 无需补行（run 未启动不产生 run 记录），但汇报须注明豁免形态——主 session 会把豁免落进 changelog devlog，未来读者必须能看出这版没跑 driver 盲审轮及原因
4. **豁免不豁免独立性**：补偿措施只是替代盲审的载体，不是降低质量标准——复验抽查比例不低于 driver 轮次的 c-verify 口径

## 最终汇报格式（循环结束后无论收敛/停手/豁免）
- 终态：收敛 ✅（连续 2 轮无 P0/P1）/ 停手原因 / 环境豁免+补偿形态
- 各轮明细：driver 每轮 P0/P1/P2 计数、修复批清单（finding+定性+文件+commit hash）
- 最终 runDir 路径 + findings 关键行原文

铁律（五条，违反即 run 报废级别事故）：

一、**冻结窗口对所有 session 生效**——driver 运行窗口内不 commit / 不改文件（仓库冻结：worker 与主仓共享工作目录，HEAD 变动杀进程树）。**任何** session 都受约束，不止执行 session 自己——主 session「顺手收编」同样炸 run；收编与 run 窗口必须错峰（等 run 收口，或先停 run 再收编再 `--resume` 续跑）。机制兜底已上（对最高危形态）：commit-msg hook 冻结窗口锁在「run 进行中 + 提交命中 driver 源码」时阻断提交——机制拦最高危（步骤表错位全灭），纪律管其余（HEAD 变动杀进程树）。

二、**exit 86 = 运行中换码**——看到 86（driver 源码指纹错位）处置口诀：停止本 run（已跑轮次产物在 runDir 不丢）→ 用新代码重启 driver（`--resume` 可续跑断点）→ 需要改 driver 行为时，先停 run 再改再重启。不要带病续跑。

三、**收编即标记**——把 FORGE 工作分支（forge/*）的内容收编进 main 后，必须当场打标记（`git tag forge-merged-<分支名 / 换 ->`）；未标记分支由 `tools/check/check-forge-branches.sh` 对账列出（INFO 不阻断）。禁止用 `git log main..<分支>` 或 `git cherry` 判「已收编」——逐文件 apply 收编下前者恒非空、后者假阳性（均实测）。收编方法红线：禁整包 cherry-pick、禁 `git checkout <分支> -- <文件>`，必须逐文件 diff apply 并验证零丢失。

四、**环境级故障熔断不要逐个降级**——worker 失败呈系统性比例（≥2/3 且绝对数 ≥5，双门阈值）时是**环境级故障**（依赖 API 漂移 / DSH rc 包形态变化 / 内存不足 OOM），driver 系统性失败熔断会中止 run。执行 session 看到全片同款死法（统一 TypeError / 全部降级占位）不要判「N 个单点失败逐个修」——先停手读 death-audit.jsonl / sub-progress-*.jsonl 定根因，修好依赖再 `--resume` 续跑。「逐个降级占位继续跑」是环境故障的损失放大器（曾整轮白烧两小时才发现 24 worker 全灭）。

五、**run 收口后两动作**——① **worktree 收编核对**：`git log main..forge/fresh-eyes/<run>` 及各轮 bfix 快照分支，非空即逐 commit 核对是否已收编（分支头被 re-sync/reset 回退时修复会**静默丢失**，无任何告警，对账脚本是唯一防线）；② **lessons 回写**：run 终态非 PASS / 复验推翻 / 收口核对发现资产异常，任一命中即按 [05 的 lessons 回写节](./05-release-gate.md) 执行（问题+解决方案零考古，事故叙事进 driver.md 对应章节）——事故教训不当天回写，换个 session 还会踩同款。

修复批窗口不在冻结内（修复批由执行 session 在轮间窗口执行，run 侧 driver 已进入下一轮前空闲；但修复批同样不得触碰 driver 源码）。
```

---

## 步骤三 · 代码审核 + 步骤四 · 验收增量（两路径共用）

- **代码审核（主 session）**：逐项核对发布检查清单（清单位置：`docs/changelog/vX.Y/vX.Y.Z.md` 的「发布检查清单（汇总）」节，参照近期版本 devlog 同节体例——**若本版 devlog 尚无该节，先建清单再核对**；清单项=从九交付验收标准逐条转勾），PASS 或 FAIL→修复。
- **验收增量（随功能开发先行）**：本版本新功能对应的 acceptance 新场景（S 编号顺延）+ checklist 新维度，随功能开发实时加——本步骤只做「增量补齐」。**归并/压缩/校准/A/B/C 分类是阶段四的职责**（见 [04-review-system.md](./04-review-system.md)），这里不动体系。

---

## 主 session 收口协议（两路径共用）

### 步骤完成判据（主 session 打勾前置）

> **为什么**：曾出现执行 session 只做了步骤四就汇报，步骤一二静默跳过（草稿 API 失败后未走降级、driver 只 dry-run），主 session 验了汇报内声称（全真实）却没验产物存在，打勾后发现缺位被迫中途补跑。

**主 session 打勾前，逐项核对产物存在性（ls/grep 实物，不信汇报文本）**：

| 项 | 完成判据（全满足才可打勾） |
|---|---|
| 审查产物（A） | `~/Desktop/fresh-eyes-draft-vX.Y.Z.md` 存在 **且** 含全部 16 个视角节（`grep -c "^## 视角" = 16`——草稿工具静态子集 1-16；动态面 17-19 由 driver/人工兜底取证）。若走了降级：产物为 `.prompt.md` 时 = **未完成**，必须粘贴执行出正式草稿后才算。若走对话式多轮形态（01-review.md 第三层）：产物为桌面 `vX.Y.Z-bugfix-prompt.md`（含问题总表 + 逐项修复方案 + 验证命令）**且**修复批已收编 commit——两者满足其一即可 |
| 审查产物（B） | runDir 内有 `verdict`/`findings` 产物**文件**——仅 status.json 不算（dry-run 空转也是 completed 状态）。环境豁免时：汇报须含「豁免：<故障形态> + 补偿措施 a/b/c」且豁免资格前置（2 次启动尝试）可查——两种形态都须留痕，禁止静默跳过 |
| 代码审核 | 发布检查清单逐项打勾记录（在 changelog 开发日志或汇报中可见） |
| 验收增量 | 新场景编号与汇报区间一致（判据命令按实际区间构造，如 `grep -c "^scenario 29[4-9]\|^scenario 30[0-9]"`——**编号每版不同，勿照抄本表示例**）；全量 acceptance EXIT=0 |

**执行 session 纪律（写进给它的 prompt）**：
- 每个步骤要么完成、要么**显式声明「未做+原因」**——禁止静默跳过（汇报模板第一件补「三分类统计」时必须含「未跑步骤声明」）
- 降级路径是 SOP 的一部分，**降级≠豁免**——除非汇报显式声明并由主 session 认可
- 环境豁免不等于免审——补偿链（草稿升格/修复批/阶段五兜底）必须实际执行并留痕

### 阶段汇报模板（主 session 收口时产出，汇总执行 session 汇报 + 自跑三/四结果）

> **为什么**：阶段汇报形态未定义时汇报质量全靠自觉（曾出现汇报良好但无格式约束，换个 session 可能只回三行）。本模板固化为五件套，**对话消息直接呈现**（不生成文件——发版期桌面已有大量产物文件，汇报属过程性信息，对话即阅即用）。

```
【vX.Y.Z 阶段三汇报】

一、步骤完成状态（先行声明——哪个步骤没做、为什么，写在这里）
- 跑法：A 快速 / B 盲审（B 附 runDir；环境豁免在此声明）
- 审查：草稿已产出 / driver verdict=X / 豁免+补偿形态
- 代码审核：已完成
- 验收增量：已完成

二、审查结论
- finding 三分类统计：机械可查已修 N / 待取证 N / 中间态 SKIP N（每项一句话）
- 修复清单：文件+一句话原因（commit hash 列表）

三、验收测试
- 新场景：S<N> 起 X 个（编号区间写实际值），全量 acceptance N/N EXIT=0
- 场景数 SSOT：旧→新（六文档同步）
```

### 修复分工与角色分离

> **为什么**：曾出现 loop 结构性不收敛后主 session 停轮**直接代做修复 + 自己复验 + 自己收编**——发现问题（worker）、修复、复验角色重合，「谁来检查检查者」缺位，被迫事后开新 session 补审。

**四角色映射**（单盲四角色流水线 = A 审 → B 修 → C 验 → D 复核；分离的对象是「行为」不是「session 实例」）：

| 角色 | 承担者 | 不变量 |
|------|--------|--------|
| 发现问题 | A worker（12 视角单盲，driver 子进程，零上下文；legacy 双盲时 A/B 并行） | 修复者永远不是发现者 |
| 修复执行 | b-fix worker（loop 内）/ subagent 或执行 session（修复批） | 修复时只消费 findings，不参与发现 |
| 独立验收 | c-verify（逐条实测不采信自报）+ d-review（P0/P1 裁决 CONFIRM/DOWNGRADE/REOPEN） | C/D 与 A/B 零信息通路——A 不再兼任验证（原告兼法官问题消除） |
| 复验收编 | **主 session 零信任复验后收编** | 执行 session 修复批自跑的验证 ≠ 复验收编；主 session 打勾前逐项 grep 实证 |

**铁律**：
- 一、主 session 发现 loop 结构性不收敛需人工收口时，停轮决策可自做，**修复必须移交独立载体**（subagent 或独立 session）——主 session 只产出「修复指令 prompt」（含 findings 裁决清单 + 验收标准），交 subagent 执行或输出给用户转发，二者皆可
- 二、若极端情况主 session 确实代做了修复（如单行紧急止血），**必须事后补独立审查**（新 session 或单次草稿模式审该 diff），verdict 记「人工收口 PASS（有保留）+ 补审 PASS」
- 三、复验与修复不得同人同轮完成——同一 session 先修后验等于没验

**driver 天然进程独立**（daemon detached，不依赖任何 session 存活）——「独立载体」要求的本质不是进程隔离而是角色隔离：审查者 ≠ 修复者 ≠ 复验者。危险组合是「同一行为主体既发现又修复」或「既修复又复验收编」——模板的红线与停手条件就是防这两个组合的。

### 版本类 finding 处理规则（版本中间态 SKIP 判别口径）

fresh-eyes 在**发版前**跑（阶段三时序先于打 tag/publish），此时版本一致性天然处于中间态——以下 finding 属预期噪音，**默认标 SKIP 不修**，留到阶段十（publish）自然消解：

| finding 模式 | 为何是中间态 |
|------|------|
| npm registry 版本落后本地 | publish 前注册表必然是旧版 |
| git tag 缺当前版本 | tag 在阶段十打 |
| README/bootstrap URL 指向未发布 tag | 打完 tag 即生效的死链 |
| workspace 依赖锁旧版 | bump-version.sh [2c] 发版时统一对齐 |

> 判别口径：**该不一致是否会在「git push + tag + npm publish」三动作后自动消失**——会 = SKIP，不会 = 真 finding（历史多轮 finding 属前者）。
> **b-fix 侧已自包含**：SKIP 判别口径已固化进 `FORGE/SKILL/fresh-eyes-loop/prompts/b-fix.md` 的「分诊前置」节（b-fix 无需读本文件即自带规则）；同时 b-fix 分诊前置把「先验证真伪再动手」固化为每条 finding 的必经步骤（实锤/误报/存疑三定性 + 分诊统计进 summary）。

### run 汇报的零信任复验

> loop 产出的 finding 清单是**线索不是事实**——曾出现「上轮遗留 N 条未修」全是 worker 拿旧报告对比的误标（实际早已修复）、b-fix 不遵守 SKIP 规则「修复」不该修的发版中间态项。主 session 收到汇报后：

1. **「未修」类 finding 先 grep 当前仓库复验**——旧审查报告是快照，不是当前状态
2. **修复前对照「版本类 finding 处理规则」（上方）**——会在 push+tag+publish 后自动消失的项判 SKIP，不修
3. **报告里的 `file:line` 引用先解析归属再采信**——审查报告每条发现都带行号，行号只证明「这一行存在」，不证明「这一段在说什么」；段落级结论先跑 `bash tools/check/resolve-section.sh <file> <line> [--chain]` 解析归属标题，对不上结论的引用打回重核（曾出现复核称段落完整、行号实属另一视角）。排障工具非门禁：不接入 check-guards/CI
4. 分工：执行 session 管跑与报，主 session 管验与修（完整协议见 [05 的分工协议](./05-release-gate.md)）

### 中止 run 的归档纪律

driver 异常中止（进程死亡/环境冲突）的 run **也必须留 LEDGER 行**（状态 aborted-*，注明死因与已有产出）——**中止 = 当场补行，不等下轮**（曾出现归档行事后人工补）。

### 快照对账 warn 级原则（跨阶段通用）

> 落点理由：本原则的范例（`dev-prompt-changelog-lines`）就是本阶段检查项，且「对账」语境与本文件的复验/收编一脉相承，故收在 03 而非独立小节。

对账检查的**级别**按对账对象定，不按检查者心情定：

| 对账对象 | 级别 | 理由 |
|------|:--:|------|
| 硬事实（计数 / 路径 / 版本号 / hash） | error | 错了就是错了，无解释空间 |
| **人工维护的易变快照**（行数声明 / 「最新」指针 / 摘要转述） | **warn** | 快照滞后是演化的常态，error 级会把「正常前进」当事故 |

范例：`dev-prompt-changelog-lines`（dev prompt 头部声明的 changelog 行数 vs 实际行数）已按此降为 warn——日志涨行是演化不是错误。新增对账检查时先问一句：**对账对象是硬事实还是易变快照？** 前者 error 后者 warn，不混用。
