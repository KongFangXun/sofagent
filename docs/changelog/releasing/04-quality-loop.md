# 阶段四：fresh-eyes-loop 质量循环 + 代码审核 + 验收测试

> **目的**：开发完的代码过一轮独立审查 + 验收测试，确保质量过关再进审查体系更新。

---

## 步骤

| # | 步骤 | 产物 |
|:--:|------|------|
| 1 | **新 session 跑 fresh-eyes-loop**：`node FORGE/src/fresh-eyes-driver.mjs --target <本版本号> --max-rounds 10`。按 `FORGE/SKILL/fresh-eyes-loop/SKILL.md` 监控协议轮询 `status.json`。loop 修复即本版本代码质量加固 | loop 修复 + changelog 汇总打勾 |
| 2 | 代码审核（当前 session）：逐项核对发布检查清单，PASS 或 FAIL→修复 | 检查清单打勾 |
| 3 | 更新验收测试文件（`regression-checklist.md` + `acceptance-test.sh`） | 验收测试更新 |

---

## fresh-eyes-loop 新 session Prompt 模板

> AI 输出 prompt 时必须把所有占位符替换为实际值（项目路径、版本号），不得残留花括号。

```
在 sofagent 项目（{项目实际路径}）中，执行 {实际版本号} 的 fresh-eyes-loop。

先读 `FORGE/SKILL/fresh-eyes-loop/SKILL.md` 拿到完整的「Session 监控协议」，然后按协议执行：

1. 后台启动 driver——必须用 Bash 工具 run_in_background:true + dangerouslyDisableSandbox:true（三层进程嵌套会被 sandbox SIGKILL）：
   FORGE_MAX_CONCURRENCY=1 node FORGE/src/fresh-eyes-driver.mjs --target {实际版本号} --max-rounds 10
   ⚠️ 8GB 机器必须 FORGE_MAX_CONCURRENCY=1（并发 worker 各占 2GB heap，3+ 并发即 OOM）
2. 记住 runDir（启动日志第一行打印的路径）
3. 在 session 内持续轮询——每 120 秒一个工作周期：
   ① 读 <runDir>/status.json 看 round 变化，变化时一句话汇报
   ② 读 heartbeat 字段时间戳——距今 > 90 秒则 pgrep 确认进程是否存活，无输出 = 已死，汇报并退出
   round 不变且 heartbeat 正常 → 继续轮询
4. round 变成 completed 或 error 时，读报告，用 3-5 行汇报

铁律：不干涉 driver、不改代码、不探索源码——只启动 + 持续轮询监控 + 最终汇报。
```
