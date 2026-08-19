# 阶段六：release-gate-loop 发版闸门

> **必须 verdict=PASS 才能进阶段七~八。** FAIL 回阶段五修复后重跑。

---

## 步骤

| # | 步骤 |
|:--:|------|
| 1 | **脚本层直跑（零 LLM）**：acceptance-test.sh + check-version + check-docs + 锚点 + check-review-system + check-tool-health 依次跑，**全绿才进下一步** |
| 2 | 开新 session 跑**判断层**：driver `--step` 单步模式四步（regression → coverage → consolidate → verdict），**跳过 acceptance 分片 LLM 复核** |
| 3 | verdict=PASS → 过「零信任复验三件套」→ 进阶段七 |
| 4 | verdict=FAIL → 回阶段五（优化 regression-checklist + fresh-eyes-review）→ 修复后重跑。最多循环 2 轮 |

> **为什么分层（run-04 实测 2026-08-19）**：driver 全流程实测 30.7 万 token / 58 分钟，其中 **61%（18.7 万）花在 acceptance 12 分片 LLM 复核**——复核的是脚本 `exit 0 + 303/303 SUMMARY` 的确定性结果，没有主观判断空间，盲审增值≈0。脚本层零 token 直跑拿到同样保证；driver 只保留有判断空间的 regression 语义审查 + coverage 交叉 + 终裁（约 9 万 token / 20 分钟）。**独立性不伤**：盲审保留在真正需要判断的环节。

> **为什么开新 session**：阶段三~五在开发 session 做完后，上下文已经很长。判断层需要 15-20 分钟，期间只需执行命令 + 轮询日志 + 汇报——不需要开发 session 的上下文。开一个干净的 session，上下文短、不互相干扰。

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
2. 判断层（driver --step 单步模式四步，跳过 acceptance 分片 LLM 复核，约 20 分钟）：
   每步都用 Bash 工具 run_in_background:true + dangerouslyDisableSandbox:true，前置 export SOFAGENT_LLM_V="${SOFAGENT_LLM_A}" && export SOFAGENT_LLM_F="${SOFAGENT_LLM_B}"：
   node FORGE/src/release-gate-driver.mjs --step regression  --target {实际版本号} --run-dir <runDir>
   node FORGE/src/release-gate-driver.mjs --step coverage   --target {实际版本号} --run-dir <runDir>
   node FORGE/src/release-gate-driver.mjs --step consolidate --target {实际版本号} --run-dir <runDir>
   node FORGE/src/release-gate-driver.mjs --step verdict    --target {实际版本号} --run-dir <runDir>
   ⚠️ runDir 由首步调用打印，后续三步复用同一个 runDir；每步完成后进入下一步
   ⚠️ 若 consolidate 报「缺 acceptance 产物」（--step 跳步衔接问题）：如实汇报报错原文，等主 session 决策回退方案（回退=恢复 driver 全流程 --skip-acceptance 模式），不要自行补跑 acceptance 步
3. 每步运行中每 120 秒轮询 status.json + heartbeat（同 fresh-eyes-loop 协议）
4. 四步完成后读 <runDir>/verdict.md，3-5 行汇报：裁决结果 / 三步骤通过数 / 失败项 / 建议

铁律：不干涉 driver、不改代码、不探索源码；FAIL 项真伪由主 session 零信任复验（维度脚本自身缺陷会误报 FAIL，逐维复跑分辨「仓库 vs 检查器」）。
```

---

## 判定与循环

| 结果 | 下一步 |
|------|--------|
| **verdict = PASS**（regression + coverage 全 PASS，acceptance 已由脚本层保证） | 过「零信任复验三件套」（见下）→ 全过才进阶段七 |
| **verdict = FAIL** | 根据报告定位问题 → **回阶段五** → 修复后重跑本阶段 |

> driver 的 regression 步骤会自动处理「⏰ 待发版」标注的检查项（git tag / npm registry / 全局二进制版本）——这些在检查阶段必然不满足，标 ⏳ 不标 FAIL。

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
| 监控 session（新开） | 启动 driver / 轮询 status / 最终 3-5 行汇报 | 不干涉 driver、不改代码、不探索源码 |
| 主 session | 收到汇报后**零信任复验**：FAIL 清单逐维真跑分辨「仓库问题 vs 检查器问题」（退出码语义与写死签名是检查器误报两大源）；PASS 过三件套 | 不直接采信 run 汇报结论 |

> v1.3.6 三轮循环实证：run-08 的 7 个 FAIL 中 5 个是维度脚本自身缺陷、run-09 的 6 项全是检查基建问题——**逐维复跑这一步发现了全部真问题，跳过它会把检查器 bug 当仓库 bug 修**。
