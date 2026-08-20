# 阶段六：release-gate-loop 发版闸门

> **必须 verdict=PASS 才能进阶段七~八。** FAIL 回阶段五修复后重跑。

---

## 步骤

| # | 步骤 |
|:--:|------|
| 一 | **脚本层直跑（零 LLM）**：acceptance-test.sh + check-version + check-docs + 锚点 + check-review-system + check-tool-health 依次跑，**全绿才进下一步** |
| 二 | 开新 session 跑**判断层**：driver `--judgment-only` 一次启动四步（regression → coverage → consolidate → verdict），**跳过 acceptance 分片 LLM 复核**（v1.3.8 交付七起不再 --step 四步手工编排） |
| 三 | verdict=PASS → 过「零信任复验三件套」→ 进阶段七 |
| 四 | verdict=FAIL → **循环即停**（v1.3.8 交付七起 F 修复链默认关闭，无 f-* 产物）→ 回阶段五修复后重跑。显式 `--auto-fix` 才进修复链（最多 3 轮） |

> **为什么分层（run-04 实测 2026-08-19）**：driver 全流程实测 30.7 万 token / 58 分钟，其中 **61%（18.7 万）花在 acceptance 12 分片 LLM 复核**——复核的是脚本 `exit 0 + 303/303 SUMMARY` 的确定性结果，没有主观判断空间，盲审增值≈0。脚本层零 token 直跑拿到同样保证；driver 只保留有判断空间的 regression 语义审查 + coverage 交叉 + 终裁（约 9 万 token / 20 分钟）。**独立性不伤**：盲审保留在真正需要判断的环节。

> **为什么开新 session**：阶段三~五在开发 session 做完后，上下文已经很长。判断层需要 15-20 分钟，期间只需执行命令 + 持续轮询 + 汇报——不需要开发 session 的上下文。开一个干净的 session，上下文短、不互相干扰。
>
> **为什么必须「持续轮询」而非「等后台通知」（2026-08-20 用户拍板修正）**：v1.3.8 曾一度改为「run_in_background 等自动通知」——但等通知时 session 处于空闲态，**用户在界面上看不到任何进展反馈**，会误以为卡死。**持续轮询的首要目的是 session 可见性**（界面一直显示「在跑」），其次才是顺带发现挂起（心跳冻结 >90s 探活）。token 成本是次要考量——20 分钟约 10 轮轻量 status.json 读取，成本可忽略。判断层与 fresh-eyes-loop 均适用此语义。

---

## release-gate-loop 新 session Prompt 模板

```
在 sofagent 项目（{项目实际路径}）中，执行 {实际版本号} 的 release-gate-loop（发版闸门，脚本层 + 判断层）。

先读 `FORGE/SKILL/release-gate-loop/SKILL.md` 拿到完整的「Session 监控协议」，然后按协议执行：

1. 脚本层直跑（零 LLM，约 15 分钟，全绿才进判断层）：
   bash FORGE/playbook/acceptance-test.sh > /tmp/acceptance-raw.log 2>&1，确认 exit 0 且 SUMMARY 全过
   依次跑：tools/check-version.sh → tools/check-docs.sh → tools/check-anchors.mjs → tools/check-review-system.sh → tools/check-tool-health.sh
   ⚠️ 脚本层有红即停：如实汇报红项与日志尾部，等主 session 决策（脚本层是确定性检查，不需要 driver）
   ⚠️ acceptance 预跑异常处置：先单跑死点命令对比（单命令健康+全量挂=上下文差异如 cwd/env，非环境问题），不要改脚本，如实汇报死点等主 session 决策
2. 判断层（driver --judgment-only 一次启动四步，跳过 acceptance 分片 LLM 复核，约 20 分钟）：
   Bash 工具 run_in_background:true + dangerouslyDisableSandbox:true，前置 export SOFAGENT_LLM_V="${SOFAGENT_LLM_A}" && export SOFAGENT_LLM_F="${SOFAGENT_LLM_B}"：
   node FORGE/src/release-gate-driver.mjs --judgment-only --target {实际版本号}
   ⚠️ v1.3.8 交付七：--judgment-only 一次进程串行四步（regression → coverage → consolidate → verdict），
   替代原 --step 四步手工编排（每步一进程）。runDir 由 driver 启动日志打印，全程复用。
   ⚠️ verdict=FAIL 时循环即停（F 修复链默认关闭，无 f-* 产物），如实汇报后等主 session 决策。
   旧 --step 单步模式保留用于单步调试（consolidate 缺 acceptance 产物属预期——judgment-only 模式下
   coverage/consolidate 从 acceptance-raw.log 与脚本层汇报取数）。
3. **持续轮询（必做，非可选——session 可见性的来源）**：每 120 秒一轮，读 `<runDir>/status.json`，输出一行状态（如「[第 N 轮] step=regression · heartbeat 距今 Xs」）——**让 session 一直活跃，用户界面持续可见「在跑」**。心跳冻结检测顺带完成：heartbeat 距今 >90s 则用 liveness 探针判定——`node FORGE/src/release-gate-driver.mjs --check-alive <runDir>`（只认心跳不认日志——LLM 长窗口日志冻结 ≠ 死亡；alive=RC0 / dead=RC1）。dead → 立即报告主 session，不要无限等。
4. 四步完成后读 <runDir>/verdict.md，3-5 行汇报：裁决结果 / 三步骤通过数 / 失败项 / 建议

铁律：不干涉 driver、不改代码、不探索源码；FAIL 项真伪由主 session 零信任复验（维度脚本自身缺陷会误报 FAIL，逐维复跑分辨「仓库 vs 检查器」）。
```

---

## 判定与循环

| 结果 | 下一步 |
|------|--------|
| **verdict = PASS**（regression + coverage 全 PASS，acceptance 已由脚本层保证） | 过「零信任复验三件套」（见下）→ 全过才进阶段七 |
| **verdict = FAIL** | 循环即停（v1.3.8 起 F 链默认关闭，无 f-* 产物）→ 根据报告定位问题 → **回阶段五** → 修复后重跑本阶段 |
| **需要 driver 内自动修复** | 显式加 `--auto-fix` 启动（f-diagnose → f-fix → f-audit，最多 3 轮）——默认不开，盲审独立性与修复上下文不混跑 |
| **driver 反复 FAIL 且复验全为检查器债** | 走「手工裁决路径」（见下）——v1.3.7 实操 run-01/04 两轮 FAIL 均改判检查器债已修，主 session 手工裁决 PASS |

> driver 的 regression 步骤会自动处理「⏰ 待发版」标注的检查项（git tag / npm registry / 全局二进制版本）——这些在检查阶段必然不满足，标 ⏳ 不标 FAIL。

## 🔴 手工裁决路径（driver 反复 FAIL 于检查器债时的兜底）

**触发条件**：driver 至少 2 轮 FAIL，且主 session 零信任复验确认 FAIL 项**全部**是检查器侧债（非仓库问题）。三条前置**缺一不可**：

1. **逐项改判记录在案**——每个 FAIL 项复验结论（仓库问题 vs 检查器债）+ 复验方式，如实写入进度追踪或 changelog，不许一句「检查器问题」带过
2. **检查器修复 commit 在列**——每个检查器债的修复动作可追溯
3. **独立复核对冲突**——手工裁决是**有上下文裁决**（主 session 知道自己修了什么），独立性弱于 driver 盲审，必须交给**无上下文 session**（如监控 session）复查关键判定后才生效

**手工裁决内容**（三者全过才算 PASS）：
- regression 89 维「driver 同款语义亲跑」全绿（不是只跑脚本——按维度判定逻辑逐维过）
- coverage 关键词矩阵全命中
- acceptance 303/303 EXIT=0

**记录纪律**：进度追踪必须写「手工裁决 PASS（driver N 轮 FAIL + 复验改判记录）」，**禁止写成「loop PASS」**——手工裁决与 driver 盲审是两个不同的保证等级，混淆即造假。

## 🔴 PASS 零信任复验三件套（v1.3.6 教训 · driver 自报 PASS 不可直接信）

> v1.3.6 发版时 release-gate 连续两轮自报 PASS 均为假（f-fix 撞熔断降级零 commit，f-audit 对空 diff 审计必全绿，driver 误判「FAIL→PASS 收敛」）——全靠人工复验抓住。第三重校验（`git rev-list --count` 零 commit 拦截）已在 v1.3.6 代码层根治，但判定防线不依赖单点：

```bash
# ① verdict.md 主体裁决（不信 status.json，不信 driver 汇报——看产物文件）
grep -m1 "判定" <runDir>/verdict.md          # 期望含「PASS ✅」
# ② stepErrors 为空
node -e "const s=require('<runDir>/status.json');console.log(JSON.stringify(s.stepErrors||[]))"
# ③ 若该 run 走过 F 修复链（runDir 有 f-* 产物）：F 分支必须有新 commit
ls <runDir>/f-* 2>/dev/null && git -C <主仓> rev-list --count <基线SHA>..<F分支>   # 期望 >0
```

**任一不过 → 按 FAIL 处理**（回阶段五）。F 链从未触发（无 f-* 产物）时 ③ 跳过——「没进修复链」与「修复链零产出」是两回事，后者才是假 PASS 特征。

## 监控 session 与主 session 的分工协议（v1.3.6 实战模式 SOP 化）

| 角色 | 职责 | 禁止 |
|------|------|------|
| 监控 session（新开） | 启动 driver / **持续轮询（60s/轮，session 可见性）** / 最终 3-5 行汇报 | 不干涉 driver、不改代码、不探索源码 |
| 主 session | 收到汇报后**零信任复验**：FAIL 清单逐维真跑分辨「仓库问题 vs 检查器问题」（退出码语义与写死签名是检查器误报两大源）；PASS 过三件套 | 不直接采信 run 汇报结论 |

> v1.3.6 三轮循环实证：run-08 的 7 个 FAIL 中 5 个是维度脚本自身缺陷、run-09 的 6 项全是检查基建问题——**逐维复跑这一步发现了全部真问题，跳过它会把检查器 bug 当仓库 bug 修**。
