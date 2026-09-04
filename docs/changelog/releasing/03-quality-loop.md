# 阶段三：fresh-eyes-loop 质量循环 + 代码审核 + 验收测试

> **目的**：开发完的代码过一轮独立审查 + 验收测试，确保质量过关再进审查体系更新。
>
> ⚠️ **与阶段一的区分（先读，防混淆）**：阶段一审**上版本存量**（发版收尾态），阶段三审**本版本新开发代码**——即使阶段一走了对话式多轮审查，阶段三也不可跳过：审查对象不同，新开发代码必须过自己的独立审查。
>
> **执行方式**：步骤二 driver 及其监控**走新 session**（用户手动开新 WorkBuddy 窗口），主 session 用下方「监控 session Prompt 模板」生成 prompt 直接在对话中输出（不落盘文件），用户复制粘贴到新窗口执行；新 session 跑完以对话消息汇报回主 session。主 session 不代跑 loop——只负责复验收编与分诊。
>
> **防止 lost-in-the-middle**：执行顺序——先读「步骤总览」确认要做什么；步骤二 driver 是长跑任务，启动姿势见「driver 启动姿势」专节；跑完后按「阶段汇报模板」汇报，主 session 按「步骤完成判据」打勾。

---

## 步骤总览

| # | 步骤 | 产物 | 完成判据 |
|:--:|------|------|------|
| 一 | **单次草稿优先**：`node tools/gen/gen-fresh-eyes-draft.mjs --diff <patch 文件> --changelog <changelog> --out ~/Desktop/fresh-eyes-draft-vX.Y.Z.md`——16 视角草稿一次成型；「待取证」项少且变更小 → 草稿 + 人工复核即收口 | 审查草稿 | 见「步骤完成判据」表 |
| 二 | **driver 兜底**（草稿待取证多 / 大版本）：**新 session 跑 fresh-eyes-loop**——「新 session」= **用户手动开的新 WorkBuddy 窗口**（独立上下文、用户可控、隔离审查视角），不是主 session 的 subagent/spawn 子进程。主 session 按下方「监控 session Prompt 模板」生成 prompt、**直接在对话中输出**（不落盘文件——零号铁律：未经确认不创建文件），用户复制粘贴到新窗口执行；新 session 跑完以对话消息汇报回主 session。启动姿势见「driver 启动姿势」专节（9 条）；按监控协议轮询 `status.json`（或 `--check-alive` 探针）。loop 修复即本版本代码质量加固。**loop 修复的分工守「修复分工与三角色分离」专节**（修复交独立 session，主 session 只复验收编） | loop 修复 + changelog 汇总打勾 | 见「步骤完成判据」表 |
| 三 | **代码审核**（当前 session）：逐项核对发布检查清单（清单位置见判据表），PASS 或 FAIL→修复 | 检查清单打勾 | 见「步骤完成判据」表 |
| 四 | **验收测试随功能开发先行新增（增量）**：本版本新功能对应的 acceptance 新场景（S 编号顺延）+ checklist 新维度，随功能开发实时加——本步骤只做「增量补齐」。**归并/压缩/校准/A/B/C 分类是阶段四的职责**（见 [04-review-system.md](./04-review-system.md)），这里不动体系 | 验收测试更新（增量） | 见「步骤完成判据」表 |
| 五 | **阶段汇报**：全部步骤完成后，执行 session 按下方「阶段汇报模板」以**对话消息**形式发回主 session（不落盘文件）——主 session 依此打勾推进 | 汇报消息（见模板） | 模板五件套齐全（含步骤完成状态声明） |

> **审查分层说明**（与 [01-review.md](./01-review.md) 同款）：
> 单次草稿（`gen-fresh-eyes-draft.mjs`，约 1-3 万 token）优先——理解型审查一次成型；
> driver 兜底（24 worker，单轮 6-10 万 token）只用于「待取证」项多或大版本变更。
> 对话式多轮审查（主会话 16 视角人肉多轮）与两者产出等价，可互换——见 01-review.md 审查分层第三层。
> driver 内 B 侧已改复核模式（独立复核 A 的 P0/P1，可推翻可补充），B 侧 token 约省一半。

---

## driver 启动姿势（步骤二 · 9 条）

> 每条规则都有实证来源，防再发。执行步骤二前先读本节。

| # | 姿势 | 说明与实证 |
|:--:|------|------|
| ① | **后台启动（仅限 driver 启动这一条命令）** | Bash 工具 `run_in_background:true` + `dangerouslyDisableSandbox:true`——三层进程嵌套会被 sandbox SIGKILL。🔴 后台参数**只属于 driver 启动命令本身**，启动之后的轮询等一切操作全部回到**前台**执行（见「监控协议」前台铁律） |
| ② | **输出重定向到文件** | `node FORGE/src/fresh-eyes-driver.mjs --target <版本号> --max-rounds 10 > /tmp/fresh-eyes-<ver>-driver.log 2>&1`——**禁止管道包装**（`\| head` 触发 SIGPIPE 杀 driver） |
| ③ | **先验证 round-start 再轮询** | 启动后等 8 秒读 `status.json`：event=round-start / phase=round-1-running 才算真跑起来，否则需重启 |
| ④ | **不传 timeout 参数** | 后台任务传 `timeout:600000` = 10 分钟上限杀 driver；后台无需 timeout，传了反而被杀 |
| ⑤ | **中断恢复用 `--resume` 续跑** | 异常死亡 → liveness 探针确认 → 命令加 `--resume`——driver 按产物完整性跳过已完成 worker，**保留已有产物续跑，绝不重开浪费** |
| ⑥ | **daemon + watch 守护优先** | `--daemon` spawn detached 自脱离进程树（会话结束不影响存活，日志 → runDir/driver.log）；`--watch <runDir>` 主管模式——每 30s 读心跳，心跳停 → 审计死因（death-audit.jsonl）→ **自动 `--resume` 拉起新 driver**，verdict.md 产出后 watcher 退出（`--watch-interval` 默认 30s / `--watch-threshold` 默认 90s）。**daemon+watch 就绪优先用**，裸后台（①~⑤）为 fallback |
| ⑦ | **独占窗口检查（三查）** | 启动前确认无其他 session 在写本仓库——一查 `git status --short \| wc -l` 改动文件数（预期 0 或个位数，几十个 = 有其他 session 在写）；二查近 5 分钟 mtime（`find . -path ./node_modules -prune -o -mmin -5 -type f -print`）；三查 `.workbuddy/memory/$(date +%Y-%m-%d).md` 今日日志有无他人活跃记录。**任一命中即停手问用户** |
| ⑧ | **driver 运行期并行步骤三/四** | driver 后台跑时当前 session 并行执行代码审核 + 验收增量，不空等 |
| ⑨ | **启动时段选择** | 重型 LLM loop 避开 GLM 3 倍价时段（工作日 14:00-18:00——高峰限流易触发 LLM 流 stall 熔断）；轮询用短命令快查，不挂超长 sleep（会被系统杀 exit 137） |

> **监控协议**：按 `FORGE/SKILL/fresh-eyes-loop/SKILL.md`——每 120 秒一轮读 `status.json`（短命令快查），session 保持活跃可见；心跳 >90 秒未更新用 `--check-alive <runDir>` liveness 探针（只认心跳不认日志——长 LLM 窗口日志冻结是正常，心跳停才是死）。
>
> 🔴 **轮询前台铁律**：`run_in_background:true` 只用于启动 driver 那一条命令——**每一轮轮询（sleep + cat status.json）必须在 session 前台执行**，禁止把轮询循环挂到后台（run_in_background / nohup 均禁）。挂后台 = session 空闲 = 用户界面看不到任何进展反馈，与「持续轮询的首要目的是 session 可见性」直接冲突。正确姿势：前台 `sleep 90~115` → 立即 `cat status.json` → 输出一行状态 → 下一轮。

---

## 阶段汇报模板（步骤五用）

> **为什么**：阶段四产物此前只写「审查草稿/loop 修复/验收更新」，汇报形态未定义——执行 session 汇报质量全靠自觉（曾出现汇报良好但无格式约束，换个 session 可能只回三行）。本模板把汇报固化为四件套，**对话消息直接发主 session**（不生成文件——发版期桌面已有大量产物文件，汇报属过程性信息，对话即阅即用）。

执行 session 完成全部步骤后，按此结构汇报：

```
【vX.Y.Z 阶段三汇报】

一、步骤完成状态（先行声明——哪个步骤没做、为什么，写在这里）
- 步骤一 草稿：已完成 / 未做+原因 / 走降级（.prompt.md 粘贴执行）
- 步骤二 driver：已跑 verdict=X / 未跑+理由（待取证 N≤3）
- 步骤三 审核：已完成
- 步骤四 场景：已完成

二、审查结论
- 草稿 finding 三分类统计：机械可查已修 N / 待取证 N / 中间态 SKIP N（每项一句话）
- 修复清单：文件+一句话原因（commit hash 列表）

三、验收测试
- 新场景：S<N> 起 X 个（编号区间写实际值），全量 acceptance N/N EXIT=0
- 场景数 SSOT：旧→新（三处同步：脚本头部/DEVELOPMENT/LIMITATIONS）
```

---

## 步骤完成判据（主 session 打勾前置）

> **为什么**：曾出现执行 session 只做了步骤四就汇报，步骤一二静默跳过（草稿 API 失败后未走降级、driver 只 dry-run），主 session 验了汇报内声称（全真实）却没验产物存在，打勾后发现缺位被迫中途补跑。

**主 session 打勾前，逐项核对产物存在性（ls/grep 实物，不信汇报文本）**：

| 步骤 | 完成判据（全满足才可打勾） |
|---|---|
| 一 草稿 | `~/Desktop/fresh-eyes-draft-vX.Y.Z.md` 存在 **且** 含全部 16 个视角节（`grep -c "^## 视角" = 16`）。若走了降级：产物为 `.prompt.md` 时 = **未完成**，必须粘贴执行出正式草稿后才算。若走对话式多轮形态（01-review.md 第三层）：产物为桌面 `vX.Y.Z-bugfix-prompt.md`（含问题总表 + 逐项修复方案 + 验证命令）**且**修复批已收编 commit——两者满足其一即可 |
| 二 driver（若应跑） | runDir 内有 `verdict`/`findings` 产物**文件**——仅 status.json 不算（dry-run 空转也是 completed 状态）。未应跑时：汇报须显式写「步骤二未跑，理由：待取证 N≤3」 |
| 三 审核 | 发布检查清单逐项打勾记录（在 changelog 开发日志或汇报中可见）。⚠️ 清单位置：`docs/changelog/vX.Y/vX.Y.Z.md` 的「发布检查清单（汇总）」节（参照近期版本 devlog 同节体例）——**若本版 devlog 尚无该节，先建清单再核对**（清单项=从九交付验收标准逐条转勾） |
| 四 场景 | 新场景编号与汇报区间一致（判据命令按实际区间构造，如 `grep -c "^scenario 29[4-9]\|^scenario 30[0-9]"`——**编号每版不同，勿照抄本表示例**）；全量 acceptance EXIT=0 |

**执行 session 纪律（写进给它的 prompt）**：
- 每个步骤要么完成、要么**显式声明「未做+原因」**——禁止静默跳过（汇报模板第一件补「三分类统计」时必须含「未跑步骤声明」）
- 步骤一 API 失败 → 降级路径（prompt 落盘粘贴执行）是 SOP 的一部分，**降级≠豁免**——除非汇报显式声明并由主 session 认可
- 「草稿待取证≤3 可收口」指跳过步骤二，**前提是步骤一草稿已产出**——不可跳过整个审查

---

## 监控 session Prompt 模板

> AI 输出 prompt 时必须把所有占位符替换为实际值（项目路径、版本号、runDir），不得残留花括号。
> 模板含 daemon+watch 守护优先 + resume 中断恢复两个分支——按「driver 启动姿势 9 条」执行。

```
在 sofagent 项目（{项目实际路径}）中，执行 {实际版本号} 的 fresh-eyes-loop。

先读 `FORGE/SKILL/fresh-eyes-loop/SKILL.md` 拿到完整的「Session 监控协议」，然后按协议执行：

0. 独占窗口检查（三查）：① `git status --short | wc -l` 改动文件数（预期 0/个位数，几十个 = 有其他 session 在写）② `find . -path ./node_modules -prune -o -mmin -5 -type f -print` 近 5 分钟活跃文件 ③ `tail .workbuddy/memory/$(date +%Y-%m-%d).md` 今日日志他人活跃记录——任一命中先停手问用户「是否还有其他 session 在写本仓库」。
0b. **先查 driver 是否已在跑（主 session 可能已用 daemon 启动，新窗口只做监控）**：读 {runDir}/status.json（或 pgrep -f fresh-eyes-driver），若 event 含 running / 进程存活 → **跳过步骤 1 直接进步骤 3 轮询**，不重复启动；若已死/无产物 → 正常走步骤 1。
0c. **启动时段检查**：当前若在工作日 14:00-18:00（GLM 3 倍价时段，高峰限流易 stall），先报告用户确认再启动。
1. 启动 driver——**优先 daemon+watch 守护模式**（自动恢复，免疫会话回收）：
   FORGE_MAX_CONCURRENCY=1 node FORGE/src/fresh-eyes-driver.mjs \
     --target {实际版本号} --max-rounds 10 --daemon --watch {runDir}
   ⚠️ 8GB 机器必须 FORGE_MAX_CONCURRENCY=1（并发 worker 各占 2GB heap，3+ 并发即 OOM）
   若为 resume 续跑（上次异常死亡）：命令加 --resume（保留已有产物，不重开）
   fallback（无 daemon 支持）：Bash 工具 run_in_background:true + dangerouslyDisableSandbox:true，
   输出重定向文件 > /tmp/fresh-eyes-<ver>-driver.log 2>&1（禁止管道），不传 timeout 参数
2. 记住 runDir（启动日志第一行打印的路径）
3. **持续轮询（必做，非可选——session 可见性的来源；🔴 必须前台执行）**：每 120 秒一轮，读 `<runDir>/status.json`，
   输出一行状态（round 变化时一句话汇报）——**让 session 一直活跃，用户界面持续可见「在跑」**。
   ⚠️ 轮询是前台短命令：run_in_background 只用于步骤 1 的 driver 启动命令，轮询循环（sleep + cat）严禁挂后台——
   挂后台 = session 空闲 = 界面无任何进展反馈。前台「短 sleep + 快查」（sleep 90~115 后立即 cat 返回），
   不挂超长 sleep（会被系统杀 exit 137）；
   监控中断不影响 driver（独立进程），续上后直接查 status.json。
   心跳冻结检测：heartbeat 距今 >90 秒 → daemon+watch 模式看 watcher 是否自动 resume（观察 death-audit.jsonl + 新 driver 拉起）；
   fallback 模式用 pgrep 确认进程存活，无输出 = 已死 → 汇报主 session，主 session 决定 --resume 续跑。
4. round 变成 completed 或 error 时，读报告（verdict/findings 产物文件，非仅 status.json），用 3-5 行汇报

铁律：不干涉 driver、不改代码、不探索源码——只启动 + 持续轮询监控 + 最终汇报。
```

---

## 修复分工与三角色分离

> **为什么**：曾出现 loop 结构性不收敛后主 session 停轮**直接代做修复 + 自己复验 + 自己收编**——发现问题（worker）、修复、复验三角色中后两者重合，「谁来检查检查者」缺位，被迫事后开新 session 补审。固化为以下分工：

| 角色 | 承担者 | 职责边界 |
|------|--------|---------|
| **发现问题** | loop 的 A/B worker（独立子会话） | 审查 + findings 产出，不修 |
| **修复执行** | **独立 session**（用户开新窗口，或工程师寇豆码） | 消费 result.md / b-fix 修复规格（summary-batch-*.md），机械应用到主仓库并 commit |
| **复验收编** | 主 session | 零信任复验修复内容（grep 实证每条）→ 收编 or 打回；**不代写修复** |

**铁律**：
- 一、主 session 发现 loop 结构性不收敛需人工收口时，停轮决策可自做，**修复必须移交独立 session**——主 session 只产出「修复指令 prompt」（含 findings 裁决清单 + 验收标准），在对话中输出给用户转发
- 二、若极端情况主 session 确实代做了修复（如单行紧急止血），**必须事后补独立审查**（新 session 或单次草稿模式审该 diff），verdict 记「人工收口 PASS（有保留）+ 补审 PASS」
- 三、复验与修复不得同人同轮完成——同一 session 先修后验等于没验

**driver 天然进程独立**（daemon detached，不依赖任何 session 存活）——「新 session」要求的本质不是进程隔离而是角色隔离：审查者 ≠ 修复者 ≠ 复验者。loop 在哪个 session 启动均可，收口时守住三角色分离即可。

---

fresh-eyes 在**发版前**跑（阶段三时序先于打 tag/publish），此时版本一致性天然处于中间态——以下 finding 属预期噪音，**默认标 SKIP 不修**，留到阶段十（publish）自然消解：

| finding 模式 | 为何是中间态 |
|------|------|
| npm registry 版本落后本地 | publish 前注册表必然是旧版 |
| git tag 缺当前版本 | tag 在阶段十打 |
| README/bootstrap URL 指向未发布 tag | 打完 tag 即生效的死链 |
| workspace 依赖锁旧版 | bump-version.sh [2c] 发版时统一对齐 |

> 判别口径：**该不一致是否会在「git push + tag + npm publish」三动作后自动消失**——会 = SKIP，不会 = 真 finding（历史多轮 finding 属前者）。

> **已知局限（待 FORGE 演进）**：SKIP 判定目前靠修复者读规则自觉执行（曾有 b-fix 违反此规则「修复」发版中间态项）。理想形态是 driver 在 b-fix prompt 里自动注入本节 SKIP 清单原文（b-fix 看不到规则就不会遵守），属 FORGE 工具链演进项，暂记于此。

---

## 中止 run 的归档纪律

driver 异常中止（进程死亡/环境冲突）的 run **也必须留 LEDGER 行**（状态 aborted-*，注明死因与已有产出）——**中止 = 当场补行，不等下轮**（曾出现归档行事后人工补）。

---

## run 汇报的零信任复验

> loop 产出的 finding 清单是**线索不是事实**——曾出现「上轮遗留 N 条未修」全是 worker 拿旧报告对比的误标（实际早已修复）、b-fix 不遵守 SKIP 规则「修复」不该修的发版中间态项。主 session 收到汇报后：

1. **「未修」类 finding 先 grep 当前仓库复验**——旧审查报告是快照，不是当前状态
2. **修复前对照「版本类 finding 处理规则」（本文件上方）**——会在 push+tag+publish 后自动消失的项判 SKIP，不修
3. **报告里的 `file:line` 引用先解析归属再采信**——审查报告每条发现都带行号，行号只证明「这一行存在」，不证明「这一段在说什么」；段落级结论先跑 `bash tools/check/resolve-section.sh <file> <line> [--chain]` 解析归属标题，对不上结论的引用打回重核（曾出现复核称段落完整、行号实属另一视角）。排障工具非门禁：不接入 check-guards/CI
4. 分工：监控 session 管跑与报，主 session 管验与修（完整协议见 [05 的分工协议](./05-release-gate.md)）
