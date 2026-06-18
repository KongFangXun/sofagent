---
name: sofagent
description: >
  为 AI Agent 提供纪律层与反思循环：4 条底线 + 10 则铁律约束行为，复杂任务自动拆解执行，每次跑完自动复盘。
image: images/sofagent.png
triggers: [用户消息]
scenarios: [任务执行, 任务闭环, 工作目录含.sofagent/]
not_when: []
metadata:
  openclaw:
    requires:
      bins: [bash, mkdir]
---

# SKILL.md · v0.56

## ⛓️ 三层加载链（地基——任何消息前必须先走完）

> 🟢🟡🔴 都一样，不读完不回复。加载链属于整个会话，不属于某个任务。
> OpenClaw 通过 load-chain.sh Hook 注入；其他平台通过 Read 工具加载。效果等价。

> ⛔ **三层必须逐文件 Read，不可跳过。** 第 1 层 `sofagent.md` 是宪法（4 底线 + 10 铁律），第 3 层 `rules.md` 是你的自定义覆盖——两者是不同文件，读了 rules.md 不等于读了 sofagent.md。读完第 1 层后内部确认「✅ 宪法层已注入」，再读第 2 层。漏读第 1 层 = 整个 sofagent 失效。

| 层 | 文件 | 读什么 | 不存在时 |
|:--:|------|------|------|
| 1 | `constitution/sofagent.md` | ⛔ 必读——4 底线 + 10 铁律 | ❌ 致命——不接任务 |
| 2 | `{SOFAGENT_DATA}/think.md` | 反思区（上次踩了什么坑）| ⚠️ 跳过（首次运行）|
| 3 | `constitution/rules.md` | 你的规则（最高优先级）| ⚠️ 跳过（未配置）|

> ⛔ 以上三步是地基。第 1 层是宪法、第 2 层是错题本、第 3 层是你说了算。
> 💡 `{SOFAGENT_DATA}` = `${PWD}/.sofagent`（当前工作目录下的 .sofagent/ 数据目录）。

---

## A0. 复杂度预判（加载链完成后执行）

仅看消息文字判断，不读任何文件：
- 🟢🟡 → Read `task-aware.md` → 输出简复
- 🔴 → 问「拆解一下？」→ 确认后 Read `engine.md`（任务编排引擎点火）
- 闲聊 → 不激活编排
- ⚠️ **WorkBuddy 专家团激活时 → 引擎不点火**（专家团有独立编排，双重编排冲突）。仅走加载链底线约束

## ⚠️ 回复前闸门（内部执行，不输出给用户）

① 自检：回复中是否含内部标记（C步/入境闸门/能力注册/每任务闸门/engine已加载/Loop checkpoint/八维评分/think反思/编排决策/task-aware 1./task-closure）？命中 → 删除
② 闭合：最小成果 + 用户确认 → task/logs → Read `task-closure.md` → 调 Loop Agent → 打勾
③ 执行中：子任务间 / 60%预算 / 重大操作前 / 失败 → Read `loop-agent.md` → 调起对应模式
④ 兜底：当日 task/logs 不存在 → 口头告警
