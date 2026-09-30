<!-- SOP-ANCHOR: S5 | file: 05-release-gate.md | prev: S4 | next: S6 -->
<!-- 机器锚（模型检索用，人不影响阅读）：grep "SOP-ANCHOR:" 可一跳取全部阶段元信息；本阶段完成后 → S6 -->
# 阶段五：release-gate-loop 发版闸门

> **必须 verdict=PASS 才能进阶段六~八。**
> **入口前置闸门（阶段四产物核对）**：生成交接 prompt 前主 session 核对 `~/Desktop/abc-draft-vX.Y.Z.md` 为**正式草稿**（非 `.prompt.md` 降级残留）且 C 类分发 commit 在列——阶段四未真实完成即启动本阶段 = 下游全绿也建立在漏审上（[04 打勾前置产物核对](./04-review-system.md)第 1/2 项）。曾出现降级落盘被误当阶段四完成打勾、直冲本阶段的实锤——此闸为拦该形态而设。
> **执行方式（自动收敛模式，单 session 制）：开新 session 执行循环「跑闸门 → verdict=FAIL 则该 session 自行修复全部发现项 → 重跑」直到 verdict=PASS（硬上限 5 轮）**——执行 session 独立承担脚本层、判断层与修复批；主 session 只做两件事：PASS 零信任复验、停手条件命中后接手分诊。不再需要「监控 session ↔ 主 session」来回切换。
>用下方「Prompt 模板」生成交接 prompt，**直接在对话中输出可复制的 prompt 文本块（不落盘文件），用户复制粘贴到新 session 执行**（与阶段三交付形式一致）。

---

## 步骤

| # | 完成 | 步骤 |
|:--:|:--:|------|
| 一 | | **脚本层直跑（零 LLM）** |
| 二 | | 同 session 跑**判断层**：driver `--judgment-only` 一次启动四步（regression → coverage → consolidate → verdict），**跳过 acceptance 分片 LLM 复核**（不再 --step 四步手工编排） |
| 三 | | verdict=PASS → 主 session 过「零信任复验三件套」→ 全过才进阶段六。**PASS 轮的 LEDGER 行由主 session 复验后收编——执行 session 禁止预写**（预写账会在复验推翻 PASS 时账实不符） |
| 四 | | **FAIL 修复批** |

#### 四 · FAIL 修复批

verdict=FAIL → 执行 session 按「修复批协议」分诊修复 → 复绿 + 单次 commit 收编 → 归档断点重跑（自动收敛循环，硬上限 5 轮，上限可由用户在启动时调整）。**命中停手条件**（同一 FAIL 项连续 2 轮修不掉 / 修复需 bump·tag·push / 版本口径类 P0 再现 / 5 轮到顶）→ 停手汇报，主 session 接手（回阶段四语义）。driver 内置 `--auto-fix` 修复链仍默认关闭——session 级修复批与 F 链是两条不同机制，不混用


#### 一 · 脚本层直跑（零 LLM）

acceptance-test.sh + check-version + check-docs + 锚点 + check-review-system + check-tool-health + check-dashboard（dashboard.html 结构门禁）依次跑，全绿才进判断层；红项由执行 session 按「修复批协议」修复后复跑复绿。长跑门禁（acceptance）**先查凭据复用**——见 ②



>
> **为什么必须「持续轮询」而非「等后台通知」**：挂后台等通知时 session 处于空闲态，**用户在界面上看不到任何进展反馈**，会误以为卡死。**持续轮询的首要目的是 session 可见性**（界面一直显示「在跑」），其次才是顺带发现挂起（心跳冻结 >90s 探活）。token 成本是次要考量——20 分钟约 10 轮轻量 status.json 读取，成本可忽略。判断层与 fresh-eyes-loop 均适用此语义。

---

## release-gate-loop 自动收敛 Prompt 模板

> AI 输出 prompt 时必须把所有占位符替换为实际值（项目路径、目标版本、上一轮 runDir），不得残留花括号。
> **交付形式铁律**：交接 prompt **直接在对话中输出可复制的文本块，禁止落盘成文件**——用户复制粘贴到新 session 执行，不经过桌面/仓库中转。
> **版本口径声明**：模板第 0 步的基线描述（package.json 指向上一版、tag 未打等）随发版时点更新为当轮实际值——这是「待发版中间态」的合法描述，判断层 prompt 与 precheck 证据注入层均已内置校准（误判「版本口径错配」时按模板第 0 步口径归一）。

```
在 sofagent 项目（{REPO_ROOT}）中，执行 {TARGET_VERSION} 的 release-gate-loop 自动收敛模式：循环「跑闸门 → verdict=FAIL 则自行修复全部发现项 → 重跑」直到 verdict=PASS（硬上限 5 轮）。

## 版本裁定声明（所有轮次适用）
目标版本={TARGET_VERSION}；HEAD 以每轮 git rev-parse 实测为准（记下并终核未被击穿）；package.json=上一版号是待发版中间态（合法）。
预期合法输出形态（不修）：维度 130 的 ⏳/🟡 · 维度 7 ⏸️ · coverage EXEMPT。

## 执行序列
① 重跑前置三查 → 按 [05-release-gate §重跑前置三查] 全文执行（断点归档 / run 定位 / 冻结确认）
② 脚本层 → 按 [05-release-gate §步骤二] 全文执行（六门禁 + acceptance --pre 落凭据）
③ 判断层 → 按 [05-release-gate §步骤三]（driver --judgment-only · 仓库冻结 · 独占窗口）
④ 持续轮询 → 按 [05-release-gate §步骤四]（前台 120s · 严禁挂后台）
⑤ verdict 分支 → 按 [05-release-gate §步骤五]（PASS 不写 LEDGER / FAIL 修复批协议 / ERROR 双查）
修复批协议 SSOT = [auto-converge-protocol.md]；红线摘要：不改断言迁就 / 不删检查消音 / 不绕审计钩子 / 只动 FAIL 项涉及文件。

## 最终汇报
终态 / 轮次明细（verdict·FAIL 项·修复·commit）/ runDir + verdict 原文 / PASS 附 acceptance SUMMARY + 基线 HEAD + 凭据指纹。
```

---

## 🔴 重跑前置三查

verdict=FAIL/ERROR 修复后重跑判断层**之前**必查三项，任一跳过都会白跑一轮（自动收敛循环的每轮 ① 已内置，此处为手工重跑场景的完整说明）：

1. **resume 断点劫持检查**：driver 启动时自动扫最近 run 的 `resume-point.json`——存在 `verdict-done`/`f-round-done` 且 verdict≠PASS 的断点会**劫持新 run**（跳过 V 阶段直接进 F 链或立即退出）。重跑前必须消费归档旧断点：
   ```bash
   mv <旧runDir>/resume-point.json <旧runDir>/resume-point.json.consumed
   ```
   注：worker step 级失败（V 阶段内中断）不写断点，不受此限。
2. **dry-run 残留目录识别**：driver 启动过程自动做 dry-run 探测，产生多个 `verdict=DRY-RUN` 的残留 run 目录。定位正式 run **以 `status.json` 的 `event=run-start` + 最新 heartbeat 为准**，不按目录序号猜。
3. **启动时段选择**：重型 LLM loop 避开 GLM 3 倍价时段（工作日 14:00-18:00——高峰限流易触发 LLM 流 stall 熔断，症状为 worker 长时间无 chunk 后 stall-abort）；死因鉴定看 `sub-progress-*.jsonl` 的 `stall-detected` 事件。

**监控轮询纪律**：轮询必须**前台**执行（run_in_background 只属于 driver 启动命令，轮询严禁挂后台——挂后台即 session 空闲、界面无进展）；用短命令即时查或 sleep 后快速返回——长 `sleep 120` 挂轮询会被系统杀（exit 137）；监控中断不影响 driver（独立进程），续上后直接查 status.json。

---

## 🔴 运行期间仓库冻结纪律

**判断层运行期间（含脚本层直跑），仓库必须冻结**——所有 session 暂停对 sofagent 仓库的任何写入（commit / push / 文档改动 / 收编动作）。

- **风险实证**：曾出现运行窗口内 HEAD 被并发 session 多次改写——driver 运行中仓库持续被写，coverage/consolidate/verdict 三个 worker 全部崩溃（exit 1 + OOM），整轮白跑，verdict 未产出
- **机制**：driver 的 worker 在运行中读工作区文件 + 可能做 git 操作，工作树/HEAD 变化会撞上文件读写竞态；多 worker 并发 + 系统内存压力叠加 → OOM
- **执行方式**：启动判断层前，执行 session 向所有并发 session 声明「仓库冻结 N 分钟」；运行期间只允许读（grep/读文件/gh api），不允许写；verdict 出来后解除冻结（修复批窗口不在冻结内）
- **判 FAIL 分诊**：driver 崩了先查「运行窗口内 HEAD 是否被动过」——`git log --since="<启动时间>" --until="<结束时间>"`，改动 >0 即环境问题优先（重跑），0 才排查代码
- **机制锁已随编排循环退役**：原 commit-msg hook 冻结窗口锁（run 进行中 + 提交命中 driver 源码 → exit 1 阻断）与源码指纹门禁（spawn 前比对启动指纹，错位 exit 86）均已随多轮编排删除，「纪律声明冻结」为唯一约束面（机制演进与能力交接见 [FORGE/lessons/driver.md 四章](../../../FORGE/lessons/driver.md)）

---

## 判定与循环（自动收敛语义）

| 结果 | 下一步 |
|------|--------|
| **verdict = PASS**（regression + coverage 全 PASS，acceptance 已由脚本层保证） | 执行 session 汇报后结束 → 主 session 过「零信任复验三件套」（见下）→ 全过才进阶段六；PASS 轮 LEDGER 行由主 session 收编 |
| **verdict = FAIL** | 执行 session 按「修复批协议」分诊修复 → 复绿 + commit → 归档断点重跑（自动收敛循环，5 轮上限） |
| **命中停手条件** | 停手汇报 → 主 session 接手分诊（回阶段四语义）；修复后可重新走本阶段或交还执行 session |
| **需要 driver 内自动修复** | 显式加 `--auto-fix` 启动（f-diagnose → f-fix → f-audit，最多 3 轮）——默认不开，盲审独立性与修复上下文不混跑；与 session 级修复批是两条机制，不混用 |
| **driver 反复 FAIL 且复验全为检查器债** | 走「手工裁决路径」（见下） |
| **环境级故障（worker 系统性失败）** | driver 内建系统性失败熔断：失败率 ≥2/3 且绝对数 ≥5（双门阈值）= 环境级故障中止 run——不是单点降级占位继续跑。处置：读 death-audit.jsonl / sub-progress-*.jsonl 定位根因（常见：依赖 API 漂移 / DSH rc 包形态变化），修复依赖后 `--resume` 续跑 |

> driver 的 regression 步骤会自动处理「⏰ 待发版」标注的检查项（git tag / npm registry / 全局二进制版本）——这些在检查阶段必然不满足，标 ⏳ 不标 FAIL。
> 待发版中间态的预期合法形态（⏳/🟡/⏸️/EXEMPT）已写入 Prompt 模板第 0 步与判断层 prompt/证据注入层——worker 若仍误判为 FAIL，按停手条件「版本口径类 P0」处理，交主 session 重新诊断。

## 🔴 手工裁决路径（driver 反复 FAIL 于检查器债时的兜底）

**触发条件**：driver 至少 2 轮 FAIL，且主 session 零信任复验确认 FAIL 项**全部**是检查器侧债（非仓库问题）。三条前置**缺一不可**：

1. **逐项改判记录在案**——每个 FAIL 项复验结论（仓库问题 vs 检查器债）+ 复验方式，如实写入进度追踪或 changelog，不许一句「检查器问题」带过
2. **检查器修复 commit 在列**——每个检查器债的修复动作可追溯
3. **独立复核对冲突**——手工裁决是**有上下文裁决**（主 session 知道自己修了什么），独立性弱于 driver 盲审，必须交给**无上下文 session**（如执行 session）复查关键判定后才生效

**手工裁决内容**（三者全过才算 PASS）：
- regression 全维度「driver 同款语义亲跑」全绿（维度数每版变化，以 `playbook/regression-checklist.md` 头部「当前 N 维」为准；不是只跑脚本——按维度判定逻辑逐维过）
- coverage 关键词矩阵全命中
- acceptance 全量 EXIT=0（`bash playbook/acceptance-test.sh` 尾部 `SUMMARY: N/N passed`，**断言数每版变化，勿写死历史数字**）

**记录纪律**：进度追踪必须写「手工裁决 PASS（driver N 轮 FAIL + 复验改判记录）」，**禁止写成「loop PASS」**——手工裁决与 driver 盲审是两个不同的保证等级，混淆即造假。

## 🔴 PASS 零信任复验三件套（执行 session 自报 PASS 不可直接信）

> 曾出现 driver 连续两轮自报 PASS 均为假（f-fix 撞熔断降级零 commit，f-audit 对空 diff 审计必全绿，driver 误判「FAIL→PASS 收敛」）——全靠人工复验抓住。第三重校验（`git rev-list --count` 零 commit 拦截）已在代码层根治，但判定防线不依赖单点：

```bash
# ① verdict.md 主体裁决（不信 status.json，不信 driver 汇报——看产物文件）
grep -m1 "判定" <runDir>/verdict.md          # 期望含「PASS ✅」
# ② stepErrors 为空
node -e "const s=require('<runDir>/status.json');console.log(JSON.stringify(s.stepErrors||[]))"
# ③ 若该 run 走过 F 修复链（runDir 有 f-* 产物）：F 分支必须有新 commit
ls <runDir>/f-* 2>/dev/null && git -C <主仓> rev-list --count <基线SHA>..<F分支>   # 期望 >0
```

**任一不过 → 按 FAIL 处理**（回阶段四）。F 链从未触发（无 f-* 产物）时 ③ 跳过——「没进修复链」与「修复链零产出」是两回事，后者才是假 PASS 特征。
自动收敛循环下另加一道：**逐轮修复 commit 抽查**——从最终汇报的轮次明细抽 ≥2 个修复 commit，核对改动确属对应 FAIL 项（防「改断言迁就」类红线违规混入修复历史）。

## 监控 session 与主 session 的分工协议

| 角色 | 职责 | 禁止 |
|------|------|------|
| 执行 session（新开，跑自动收敛循环） | 脚本层直跑 / 判断层启动 / 持续轮询 / FAIL 修复批（分诊→修复→复绿→commit）/ 重跑直到 PASS 或停手 / 最终汇报 | 触碰修复红线；PASS 后预写 LEDGER；停手条件命中后继续硬跑；--no-verify 绕审计钩子 |
| 主 session | PASS 后零信任复验（三件套 + 逐轮修复 commit 抽查）；PASS 轮 LEDGER 收编；停手后接手分诊 | 不直接采信执行 session 的汇报结论 |

## 循环事故的 lessons 回写（run 收口后触发）

> **为什么有这一节**：loop 运行事故（run 中止/全灭/假 PASS/资产丢失）的修复是一次性的，但教训若不回写 lessons，换个 session 还会踩同款——曾出现四连事故隔数日后靠用户提醒才启动沉淀。回写触发器挂在本阶段收口，把「想起来回写」变成 SOP 固定动作。

**触发条件（任一命中即回写）**：
- run 终态非 PASS（aborted-* / ERROR / FAIL 到顶停手）
- PASS 但零信任复验推翻（假 PASS）
- 收口核对发现资产异常（bfix 快照分支有未收编 commit / 对账脚本报红）

**回写动作**：
1. 按 `FORGE/lessons/index.md` 的格式规范落笔——教训只写「问题 + 解决方案」，不带日期/run 编号/版本号（零考古铁律）
2. 落点：事故叙事进 `FORGE/lessons/driver.md` 对应章节（与既有事故实录体例对齐）；可复用坑位进 index.md「引擎/工具开发通用坑位」表；同步更新 index.md 章节索引与历史坑位索引
3. 写完扫 U+FFFD（`perl -CSD` 检查替换符）+ 跑 check-anchors 确认锚点有效
4. 与当轮修复同批或紧随 commit（`docs(forge-lessons):` 前缀）

**红线**：事故回写是复盘不是追责——写「什么形态的失误会产生这个事故、机制怎么防」，不写「谁在哪轮犯了错」；同一根因已沉淀过的不重复建条（合并或引用）。


---

## 设计注记（为什么这样设计——操作层无须阅读）

> **为什么分层**：driver 全流程曾实测约 61% token 花在 acceptance 分片 LLM 复核——复核的是脚本 `exit 0 + SUMMARY`（断言数每版变化）的确定性结果，没有主观判断空间，盲审增值≈0。脚本层零 token 直跑拿到同样保证；driver 只保留有判断空间的 regression 语义审查 + coverage 交叉 + 终裁。**独立性不伤**：盲审保留在真正需要判断的环节。

> **为什么开新 session**：阶段三~五在开发 session 做完后，上下文已经很长；自动收敛循环含多轮修复批，上下文消耗更大。开一个干净的执行 session 独立跑完整循环（脚本层 + 判断层 + 修复批 + 重跑），主 session 不代跑、不微观管理——只在 PASS 复验（三件套）与停手接手时介入。
