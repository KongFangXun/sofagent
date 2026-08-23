# 阶段三：fresh-eyes-loop 质量循环 + 代码审核 + 验收测试

> **目的**：开发完的代码过一轮独立审查 + 验收测试，确保质量过关再进审查体系更新。
>
> **防止 lost-in-the-middle**：执行顺序——先读「步骤总览」确认要做什么；步骤二 driver 是长跑任务，启动姿势见「driver 启动姿势」专节（8 条，含中断恢复）；跑完后按「阶段汇报模板」汇报，主 session 按「步骤完成判据」打勾。

---

## 步骤总览

| # | 步骤 | 产物 | 完成判据 |
|:--:|------|------|------|
| 一 | **单次草稿优先**（v1.3.8 交付八）：`node tools/gen/gen-fresh-eyes-draft.mjs --diff <patch 文件> --changelog <changelog> --out ~/Desktop/fresh-eyes-draft-vX.Y.Z.md`——16 视角草稿一次成型；「待取证」项少且变更小 → 草稿 + 人工复核即收口 | 审查草稿 | 见「步骤完成判据」表 |
| 二 | **driver 兜底**（草稿待取证多 / 大版本）：**新 session 跑 fresh-eyes-loop**，启动姿势见下方「driver 启动姿势」专节（8 条）；按监控协议轮询 `status.json`（或 `--check-alive` 探针）。loop 修复即本版本代码质量加固 | loop 修复 + changelog 汇总打勾 | 见「步骤完成判据」表 |
| 三 | **代码审核**（当前 session）：逐项核对发布检查清单（清单位置见判据表），PASS 或 FAIL→修复 | 检查清单打勾 | 见「步骤完成判据」表 |
| 四 | **验收测试随功能开发先行新增（增量）**：本版本新功能对应的 acceptance 新场景（S 编号顺延）+ checklist 新维度，随功能开发实时加——本步骤只做「增量补齐」。**归并/压缩/校准/A/B/C 分类是阶段四的职责**（见 [04-review-system.md](./04-review-system.md)），这里不动体系 | 验收测试更新（增量） | 见「步骤完成判据」表 |
| 五 | **阶段汇报**：全部步骤完成后，执行 session 按下方「阶段汇报模板」以**对话消息**形式发回主 session（不落盘文件）——主 session 依此打勾推进，不再考古 | 汇报消息（见模板） | 模板五件套齐全（含步骤完成状态声明） |

> **审查分层说明**（v1.3.8 交付八，与 [01-review.md](./01-review.md) 同款）：
> 单次草稿（`gen-fresh-eyes-draft.mjs`，约 1-3 万 token）优先——理解型审查一次成型；
> driver 兜底（24 worker，单轮 6-10 万 token）只用于「待取证」项多或大版本变更。
> driver 内 B 侧已改复核模式（独立复核 A 的 P0/P1，可推翻可补充），B 侧 token 约省一半。

---

## driver 启动姿势（步骤二 · 8 条）

> **为什么是 8 条**：v1.3.9 阶段四实测三趟 driver 踩出全部坑（SIGPIPE 杀 / timeout 上限杀 / 会话回收杀 / 并行 session 冲突）——每条带实证，防再发。执行步骤二前先读本节。

| # | 姿势 | 说明与实证 |
|:--:|------|------|
| ① | **后台启动** | Bash 工具 `run_in_background:true` + `dangerouslyDisableSandbox:true`——三层进程嵌套会被 sandbox SIGKILL |
| ② | **输出重定向到文件** | `node FORGE/src/fresh-eyes-driver.mjs --target <版本号> --max-rounds 10 > /tmp/fresh-eyes-<ver>-driver.log 2>&1`——**禁止管道包装**（`\| head` 触发 SIGPIPE 杀 driver，preflight 已警告仍踩过，v1.3.9 run-01 首死） |
| ③ | **先验证 round-start 再轮询** | 启动后等 8 秒读 `status.json`：event=round-start / phase=round-1-running 才算真跑起来，否则需重启 |
| ④ | **不传 timeout 参数** | `timeout:600000` 生效 = 10 分钟上限杀 driver——v1.3.9 run-01 二次死亡实证（心跳停与重启间隔恰好 10 分钟）。后台任务无需 timeout，传了反而被杀 |
| ⑤ | **中断恢复用 `--resume` 续跑** | 异常死亡 → liveness 探针确认 → `node FORGE/src/fresh-eyes-driver.mjs --target <版本号> --max-rounds 10 --resume > <log> 2>&1`——driver 按产物完整性跳过已完成 worker，**保留已有产物续跑，绝不重开浪费**（v1.3.9 run-01 死两次均靠 resume 保住 round-1/2 的 61 个产物） |
| ⑥ | **daemon + watch 守护优先** | v1.3.9 已交付进程守护（[767d7c10] 起）：`--daemon` spawn detached 自脱离进程树（WorkBuddy 会话结束不影响存活，日志 → runDir/driver.log）；`--watch <runDir>` 主管模式——每 30s 读心跳，心跳停 → 审计死因（death-audit.jsonl）→ **自动 `--resume` 拉起新 driver**，verdict.md 产出后 watcher 退出（`--watch-interval` 默认 30s / `--watch-threshold` 默认 90s）。**daemon+watch 就绪优先用**，裸后台（①~⑤）为 fallback |
| ⑦ | **独占窗口检查（三查）** | 启动前确认无其他 session 在写本仓库——一查 `git status --short \| wc -l` 改动文件数（预期 0 或个位数，几十个 = 有其他 session 在写）；二查近 5 分钟 mtime（`find . -path ./node_modules -prune -o -mmin -5 -type f -print`）；三查 `.workbuddy/memory/$(date +%Y-%m-%d).md` 今日日志有无他人活跃记录（「commit 收编」「working tree clean」等他 session 痕迹）。**任一命中即停手问用户**——SKILL.md run-07 教训 + 2026-08-23 双 session 并行写同一仓库撞车实证（bugfix session 与术语重构 session 交替写 README/WIKI，靠对方收编才合流） |
| ⑧ | **driver 运行期并行步骤三/四** | driver 后台跑时当前 session 并行执行代码审核 + 验收增量，不空等（v1.3.9 实测高效） |

> **监控协议**：按 `FORGE/SKILL/fresh-eyes-loop/SKILL.md`——每 120 秒一轮读 `status.json`，session 保持活跃可见；心跳 >90 秒未更新用 `--check-alive <runDir>` liveness 探针（只认心跳不认日志——长 LLM 窗口日志冻结是正常，心跳停才是死）。

---

## 阶段汇报模板（步骤五用）

> **为什么**：阶段四产物此前只写「审查草稿/loop 修复/验收更新」，汇报形态未定义——执行 session 汇报质量全靠自觉（v1.3.8 实录：汇报良好但无格式约束，换个 session 可能只回三行）。本模板把汇报固化为四件套，**对话消息直接发主 session**（不生成文件——发版期桌面已有大量产物文件，汇报属过程性信息，对话即阅即用）。

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

> **为什么**：v1.3.8 发版实录——执行 session 只做了步骤四就汇报，步骤一二静默跳过（草稿 API 失败后未走降级、driver 只 dry-run），主 session 验了汇报内声称（全真实）却没验产物存在，打勾后发现缺位被迫中途补跑。教训入 `FORGE/lessons/driver.md`。

**主 session 打勾前，逐项核对产物存在性（ls/grep 实物，不信汇报文本）**：

| 步骤 | 完成判据（全满足才可打勾） |
|---|---|
| 一 草稿 | `~/Desktop/fresh-eyes-draft-vX.Y.Z.md` 存在 **且** 含全部 16 个视角节（`grep -c "^## 视角" = 16`）。若走了降级：产物为 `.prompt.md` 时 = **未完成**，必须粘贴执行出正式草稿后才算 |
| 二 driver（若应跑） | runDir 内有 `verdict`/`findings` 产物**文件**——仅 status.json 不算（dry-run 空转也是 completed 状态）。未应跑时：汇报须显式写「步骤二未跑，理由：待取证 N≤3」 |
| 三 审核 | 发布检查清单逐项打勾记录（在 changelog 开发日志或汇报中可见）。⚠️ 清单位置：`docs/changelog/vX.Y/vX.Y.Z.md` 的「发布检查清单（汇总）」节（参照 v1.3.7.md:455 体例）——**若本版 devlog 尚无该节，先建清单再核对**（清单项=从九交付验收标准逐条转勾） |
| 四 场景 | 新场景编号与汇报区间一致（判据命令按实际区间构造，如 `grep -c "^scenario 29[4-9]\|^scenario 30[0-9]"`——**编号每版不同，勿照抄本表示例**）；全量 acceptance EXIT=0 |

**执行 session 纪律（写进给它的 prompt）**：
- 每个步骤要么完成、要么**显式声明「未做+原因」**——禁止静默跳过（汇报模板第一件补「三分类统计」时必须含「未跑步骤声明」）
- 步骤一 API 失败 → 降级路径（prompt 落盘粘贴执行）是 SOP 的一部分，**降级≠豁免**——除非汇报显式声明并由主 session 认可
- 「草稿待取证≤3 可收口」指跳过步骤二，**前提是步骤一草稿已产出**——不可跳过整个审查

---

## 监控 session Prompt 模板

> AI 输出 prompt 时必须把所有占位符替换为实际值（项目路径、版本号），不得残留花括号。
> 模板含 daemon+watch 守护优先 + resume 中断恢复两个分支——按「启动姿势 8 条」更新（v1.3.9）。

```
在 sofagent 项目（{项目实际路径}）中，执行 {实际版本号} 的 fresh-eyes-loop。

先读 `FORGE/SKILL/fresh-eyes-loop/SKILL.md` 拿到完整的「Session 监控协议」，然后按协议执行：

0. 独占窗口检查（三查，2026-08-23 双 session 并行撞车升级）：① `git status --short | wc -l` 改动文件数（预期 0/个位数，几十个 = 有其他 session 在写）② `find . -path ./node_modules -prune -o -mmin -5 -type f -print` 近 5 分钟活跃文件 ③ `tail .workbuddy/memory/$(date +%Y-%m-%d).md` 今日日志他人活跃记录——任一命中先停手问用户「是否还有其他 session 在写本仓库」。
1. 启动 driver——**优先 daemon+watch 守护模式**（自动恢复，免疫会话回收）：
   FORGE_MAX_CONCURRENCY=1 node FORGE/src/fresh-eyes-driver.mjs \
     --target {实际版本号} --max-rounds 10 --daemon --watch {runDir}
   ⚠️ 8GB 机器必须 FORGE_MAX_CONCURRENCY=1（并发 worker 各占 2GB heap，3+ 并发即 OOM）
   若为 resume 续跑（上次异常死亡）：命令加 --resume（保留已有产物，不重开）
   fallback（无 daemon 支持）：Bash 工具 run_in_background:true + dangerouslyDisableSandbox:true，
   输出重定向文件 > /tmp/fresh-eyes-<ver>-driver.log 2>&1（禁止管道），不传 timeout 参数
2. 记住 runDir（启动日志第一行打印的路径）
3. **持续轮询（必做，非可选——session 可见性的来源）**：每 120 秒一轮，读 `<runDir>/status.json`，
   输出一行状态（round 变化时一句话汇报）——**让 session 一直活跃，用户界面持续可见「在跑」**。
   心跳冻结检测顺带完成：heartbeat 距今 >90 秒则 pgrep 确认进程是否存活，无输出 = 已死：
   → daemon+watch 模式：watcher 会自动 resume，观察 death-audit.jsonl + 新 driver 拉起即可
   → fallback 模式：汇报主 session，主 session 决定 --resume 续跑
4. round 变成 completed 或 error 时，读报告，用 3-5 行汇报

铁律：不干涉 driver、不改代码、不探索源码——只启动 + 持续轮询监控 + 最终汇报。
```

---

## 版本类 finding 处理规则

fresh-eyes 在**发版前**跑（阶段三时序先于打 tag/publish），此时版本一致性天然处于中间态——以下 finding 属预期噪音，**默认标 SKIP 不修**，留到阶段十（publish）自然消解：

| finding 模式 | 为何是中间态 |
|------|------|
| npm registry 版本落后本地 | publish 前注册表必然是旧版 |
| git tag 缺当前版本 | tag 在阶段十打 |
| README/bootstrap URL 指向未发布 tag | 打完 tag 即生效的死链 |
| workspace 依赖锁旧版 | bump-version.sh [2c] 发版时统一对齐 |

> 判别口径：**该不一致是否会在「git push + tag + npm publish」三动作后自动消失**——会 = SKIP，不会 = 真 finding。run-07 的 R1-02/R2-P1-01/R2-P1-02/R3-3 均属前者。

> **已知局限（待 FORGE 演进）**：SKIP 判定目前靠修复者读规则自觉执行——v1.3.6 run-03 的 b-fix 曾违反此规则「修复」发版中间态项。理想形态是 driver 在 b-fix prompt 里自动注入本节 SKIP 清单原文（b-fix 看不到规则就不会遵守），属 FORGE 工具链演进项，暂记于此。

---

## 中止 run 的归档纪律

driver 异常中止（进程死亡/环境冲突）的 run **也必须留 LEDGER 行**（状态 aborted-*，注明死因与已有产出）——run-07 的归档行是事后人工补的，此处 SOP 化：中止 = 当场补行，不等下轮。

---

## run 汇报的零信任复验

> loop 产出的 finding 清单是**线索不是事实**——v1.3.6 run-03 的「上轮遗留 3 条未修」全是 worker 拿旧报告对比的误标（实际早已修复），另有 b-fix 不遵守 SKIP 规则「修复」了不该修的发版中间态项。主 session 收到汇报后：

1. **「未修」类 finding 先 grep 当前仓库复验**——旧审查报告是快照，不是当前状态
2. **修复前对照「版本类 finding 处理规则」（本文件上方）**——会在 push+tag+publish 后自动消失的项判 SKIP，不修
3. 分工：监控 session 管跑与报，主 session 管验与修（完整协议见 [06 的分工表](./05-release-gate.md)）
