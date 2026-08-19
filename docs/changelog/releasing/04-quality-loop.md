# 阶段四：fresh-eyes-loop 质量循环 + 代码审核 + 验收测试

> **目的**：开发完的代码过一轮独立审查 + 验收测试，确保质量过关再进审查体系更新。

---

## 步骤

| # | 步骤 | 产物 |
|:--:|------|------|
| 一 | **新 session 跑 fresh-eyes-loop**：`node FORGE/src/fresh-eyes-driver.mjs --target <本版本号> --max-rounds 10`。按 `FORGE/SKILL/fresh-eyes-loop/SKILL.md` 监控协议轮询 `status.json`。loop 修复即本版本代码质量加固 | loop 修复 + changelog 汇总打勾 |
| 二 | 代码审核（当前 session）：逐项核对发布检查清单，PASS 或 FAIL→修复 | 检查清单打勾 |
| 三 | **验收测试随功能开发先行新增（增量）**：本版本新功能对应的 acceptance 新场景（S 编号顺延）+ checklist 新维度，随功能开发实时加——本步骤只做「增量补齐」。**归并/压缩/校准/A/B/C 分类是阶段五的职责**，这里不动体系 | 验收测试更新（增量） |

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

---

## 版本类 finding 处理规则（2026-08-16 · run-07 教训）

fresh-eyes 在**发版前**跑（阶段四时序先于打 tag/publish），此时版本一致性天然处于中间态——以下 finding 属预期噪音，**默认标 SKIP 不修**，留到阶段十一（publish）自然消解：

| finding 模式 | 为何是中间态 |
|------|------|
| npm registry 版本落后本地 | publish 前注册表必然是旧版 |
| git tag 缺当前版本 | tag 在阶段十一打 |
| README/bootstrap URL 指向未发布 tag | 打完 tag 即生效的死链 |
| workspace 依赖锁旧版 | bump-version.sh [2c] 发版时统一对齐 |

> 判别口径：**该不一致是否会在「git push + tag + npm publish」三动作后自动消失**——会 = SKIP，不会 = 真 finding。run-07 的 R1-02/R2-P1-01/R2-P1-02/R3-3 均属前者。

> **已知局限（待 FORGE 演进）**：SKIP 判定目前靠修复者读规则自觉执行——v1.3.6 run-03 的 b-fix 曾违反此规则「修复」发版中间态项。理想形态是 driver 在 b-fix prompt 里自动注入本节 SKIP 清单原文（b-fix 看不到规则就不会遵守），属 FORGE 工具链演进项，暂记于此。

## 中止 run 的归档纪律（2026-08-16 · run-07 教训）

driver 异常中止（进程死亡/环境冲突）的 run **也必须留 LEDGER 行**（状态 aborted-*，注明死因与已有产出）——run-07 的归档行是事后人工补的，此处 SOP 化：中止 = 当场补行，不等下轮。

## run 汇报的零信任复验（v1.3.6 教训 · 与阶段六分工协议同款）

> loop 产出的 finding 清单是**线索不是事实**——v1.3.6 run-03 的「上轮遗留 3 条未修」全是 worker 拿旧报告对比的误标（实际早已修复），另有 b-fix 不遵守 SKIP 规则「修复」了不该修的发版中间态项。主 session 收到汇报后：

1. **「未修」类 finding 先 grep 当前仓库复验**——旧审查报告是快照，不是当前状态
2. **修复前对照「版本类 finding 处理规则」（本文件上方）**——会在 push+tag+publish 后自动消失的项判 SKIP，不修
3. 分工：监控 session 管跑与报，主 session 管验与修（完整协议见 [06 的分工表](./06-release-gate.md)）
