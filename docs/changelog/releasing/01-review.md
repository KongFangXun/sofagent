# 阶段一：审查上版本

> **目的**：先把上版本的 bug 找齐修完，再开发本版本新功能。不带上版本的债往前走。

---

## 步骤

| # | 步骤 | 产物 |
|:--:|------|------|
| 一 | 全新 session 启动 fresh-eyes-loop 审查上一版本：`node FORGE/src/fresh-eyes-driver.mjs --target <上一版本号> --max-rounds 10`。按 `FORGE/SKILL/fresh-eyes-loop/SKILL.md` 监控协议轮询。loop 产出的 P0/P1/P2 修复即本版本 BugFix 批次主体；修复只 commit 不 push | 审查报告 + loop 修复 → BugFix 批次 |
| 二 | （可选）人工补充：以 `fresh-eyes-review.md` 方法论人肉复核 loop 报告，直觉盲区发现并入清单 | 补充发现 |

---

## changelog 章节顺序铁律

> 合并版本（新功能 + BugFix 同版）的章节顺序规则见 [08-doc-finalize.md](./08-doc-finalize.md)——新功能在前、BugFix 在后。阶段二活文档随记时就开始遵守，定稿在阶段八。

---

## fresh-eyes-loop 新 session Prompt 模板

> 阶段一和阶段四都用 fresh-eyes-loop，区别是 target（阶段一审上版本，阶段四审本版本）。AI 输出 prompt 时必须把所有占位符替换为实际值（项目路径、版本号），不得残留花括号。

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
