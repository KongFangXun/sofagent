# 致谢

> sofagent 站在巨人肩膀上。以下每一个项目、文章和作者，都在 sofagent 的某个设计决策里留下了痕迹。
>
> v0.99.5 · 2026-07-04

---

## 基石

没有它，sofagent 一页都写不出来。

- **[OpenClaw](https://github.com/openclaw/openclaw)** by Peter Steinberger — 整个 sofagent 的基石。从上下文加载到 Hook 触发、从 Skill 注入到 Session 管理，整套体系都建立在 OpenClaw 的能力之上

---

## 生成伙伴

模型间 Loop 实验——多 session 内互改互审，直到所有模型都版本通过。随后新 session 重审，下一轮版本迭代开始。

- **[DeepSeek V4 Pro](https://api-docs.deepseek.com/zh-cn/)**（深度求索）
- **[GLM-5.2](https://z.ai/)**（智谱 AI）

---

## 关于作者

我叫孔放勋，一个只懂点前端代码的产品经理。

2026 年初我才开始用 OpenClaw，用了一段时间后攒了些想法，整理成了这份 Handbook。

为什么叫 sofagent？没什么深意——sofa + agent，合起来就是「沙发特工」。想表达的意思也简单：希望有一天能躺在沙发上，Agent 就把活干完了。

这不是什么「框架」或「方法论」，只是用大半年 OpenClaw 攒的笔记。

这个项目里的文件是模型间 Loop 实验的产物——多 session 内互改互审，直到所有模型都版本通过。参与的核心模型是 DeepSeek V4 Pro 和 GLM-5.2，详见 [致谢](./THANKS.md#生成伙伴)。分享出来期待你也参与进来一起优化。

如果你也在折腾 OpenClaw，希望这个对你有用。

---

## 哲学与理念

影响了 sofagent "为什么这么设计" 的思考。

- **[Ralph Loop](https://ghuntley.com/loop/)** by Geoffrey Huntley —「Agent 失忆，文件不失忆」是 sofagent 的哲学基因。一行 bash 循环 + Stop Hook + 新鲜上下文每轮刷新，启发了审计方向：git diff 是无状态地面真相
- **[Andrej Karpathy Skills](https://github.com/multica-ai/andrej-karpathy-skills)** — 4 条编码原则是 6 则铁律的根基。感谢 Karpathy
- **[Anthropic Skills](https://github.com/anthropics/skills)** — 官方 SKILL.md 格式规范，描述-实现分离和 Skill 索引卡片参考了它
- **[Loop Engineering](https://addyo.substack.com/p/loop-engineering)** by Addy Osmani — 帮我理清了 Context → Harness → Loop 三层框架的关系
- **[OpenAI Harness Engineering](https://openai.com/index/harness-engineering/)** — Harness 概念的系统化参考
- **[Anthropic Effective Harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)** — 长时间运行 Agent 的有效治理思路
- **[Lost in the Middle](https://arxiv.org/abs/2307.03172)** — 模型对长文档中段注意力衰减的研究，500 字原则的理论源头

---

## 工具与实现

sofagent 直接使用或借鉴了它们的能力。

- **[agency-orchestrator](https://github.com/jnMetaCode/agency-orchestrator)**（Apache-2.0）— `ao compose` 一行命令搞定编排：意图识别 → 任务图生成 → 模板匹配 → 分配
- **[agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh)** — 215 个中文岗位模板，IDENTITY 层素材来源
- **[MiroFish](https://github.com/666ghj/MiroFish)** —「工具调用与最终答案严格分离」模式，启发了 sofagent 审计层的证据分层设计
- **[superpowers](https://github.com/obra/superpowers)** — Skill 作为 Harness 杠杆的思路，启发了 Skills 体系的设计
- **[best-of-agent-harnesses](https://github.com/RyanAlberts/best-of-agent-harnesses)** — 101+ 个 Harness 项目索引，让我了解这个领域已经有什么人在做什么事

---

## 社区与平台

sofagent 在这些社区里传播和生长。

- **[ClawHub](https://clawhub.ai)** — 全球 Skills 社区，Skills 体系的外部来源
- **[/goal 命令](https://docs.anthropic.com/en/docs/claude-code/goal)** — Claude Code 的自主执行循环，启发了我加用户确认的设计

---
