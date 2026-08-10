# 阶段六：release-gate-loop 发版闸门

> **必须 verdict=PASS 才能进阶段七~八。** FAIL 回阶段五修复后重跑。

---

## 步骤

| # | 步骤 |
|:--:|------|
| 1 | 开新 session，一段 prompt 一次性完成：acceptance 预跑 → driver 启动 → 轮询监控 → 最终汇报 |
| 2 | verdict=PASS → 进阶段七 |
| 3 | verdict=FAIL → 回阶段五（优化 regression-checklist + fresh-eyes-review）→ 修复后重跑。最多循环 2 轮 |

> **为什么开新 session**：阶段三~五在开发 session 做完后，上下文已经很长。release-gate-loop 全程需要 15-20 分钟，期间只需执行命令 + 轮询日志 + 汇报——不需要开发 session 的上下文。开一个干净的 session，上下文短、不互相干扰。

---

## release-gate-loop 新 session Prompt 模板

```
在 sofagent 项目（{项目实际路径}）中，执行 {实际版本号} 的 release-gate-loop（发版闸门）。

先读 `FORGE/SKILL/release-gate-loop/SKILL.md` 拿到完整的「Session 监控协议」，然后按协议执行：

1. 直连预跑 acceptance（约 90 秒）：bash FORGE/playbook/acceptance-test.sh > /tmp/acceptance-raw.log 2>&1，确认 exit 0
2. 后台启动 driver——必须用 Bash 工具 run_in_background:true + dangerouslyDisableSandbox:true：
   export SOFAGENT_LLM_V="${SOFAGENT_LLM_A}" && export SOFAGENT_LLM_F="${SOFAGENT_LLM_B}" && FORGE_MAX_CONCURRENCY=1 node FORGE/src/release-gate-driver.mjs --target {实际版本号} --skip-acceptance
   ⚠️ V/F 角色环境变量须手动导出（driver 的 resolveConfigs 自动生成 SOFAGENT_LLM_V/F 但 models/ 未覆盖 specEnv）
3. 记住 runDir，每 120 秒轮询 status.json + heartbeat（同 fresh-eyes-loop 协议）
4. phase=completed/error 时读 verdict.md，3-5 行汇报：裁决结果 / 各步骤通过数 / 失败项 / 建议

铁律：不干涉 driver、不改代码、不探索源码。
```

---

## 判定与循环

| 结果 | 下一步 |
|------|--------|
| **verdict = PASS**（acceptance + regression + coverage 全 PASS） | 进阶段七 |
| **verdict = FAIL** | 根据报告定位问题 → **回阶段五** → 修复后重跑本阶段 |

> driver 的 regression 步骤会自动处理「⏰ 待发版」标注的检查项（git tag / npm registry / 全局二进制版本）——这些在检查阶段必然不满足，标 ⏳ 不标 FAIL。
