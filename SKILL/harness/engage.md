# engage.md · 编排引擎（精简版）· v1.3.8

> 你已接入 sofagent。它不替你干活——在你越界时提醒，完成后帮你验证。当成质量搭档，不是上级。
>
> FDE 部署场景专用——workflow 节点触发时点火。个人开发者不需要。

---

## 点火条件

只点火当以下**全部**满足：
1. 当前会话是 FDE 部署场景（FDE 场景已激活，参见 engage-fde.md 检测逻辑）
2. 当前操作是 workflow 中的 🔄/⚡ 节点（已由 FDE §5 识别）
3. 节点尚未执行过（`task/logs` 无该节点成功记录）

不点火：非 FDE 场景 / 节点已执行过（幂等跳过，复用缓存） / 简单节点（📋 文档生成、💬 信息检索等直接走 Agent）。

---

## 两档拆解

| 档位 | 触发条件 | 决策 | 标注 |
|:--:|---------|:--:|------|
| **拆** | 多步操作 / 多文件 / 多 Agent 协作 / 有顺序依赖 | 走 AO compose 一次性拆解 → DAG → 逐步执行 | 边界情况默认拆 |
| **不拆** | 单步操作 / 无依赖 / 已知模板匹配 | Agent 直接处理，不走 AO compose | 宁多拆不少拆 |

判断依据：读节点的五要素（输入/输出/负责人/耗时/痛点）→ 判断任务粒度。单步无依赖 → 不拆；多步有依赖需多 Agent → 拆。

---

## AO Compose 拆解

`sofagent-orchestrator compose` 的完整说明见 **DEVELOPMENT.md §二**。核心流程：Agent 读 `nodes/[节点名].md`（三层实体之文档层）→ 把节点定义注入给 `sofagent-orchestrator compose "节点描述"` → 输出 YAML DAG 结构 → 逐步执行。

> sofagent-orchestrator compose 接受自然语言描述（不是读 .yaml 配置文件）。Agent 读节点 .md 后，把内容揉成一句话描述传给 sofagent-orchestrator compose。sofagent-orchestrator compose 内部会生成临时 YAML DAG 做执行计划，但那是它自己的内部产物，不是我们需要维护的配置文件。

## Agent 模板匹配

AO Compose 自带角色模板库，直接引用不自定义：

| 节点类型 | 匹配角色 |
|---------|---------|
| 数据分析 / 信息检索 | `researcher` |
| 代码实现 / 配置修改 | `developer` |
| 测试 / 验证 | `qa-engineer` |
| 文档 / 报告生成 | `technical-writer` |
| 部署 / 运维操作 | `devops-engineer` |

优先用 `ao roles` 列出的角色，找不到匹配时默认 `developer`。

---

## think.md 反馈回路

每次编排执行后更新 think.md 反思区：拆解策略（拆/不拆 + 结果）、拆解粒度（N步→实际M步）、角色匹配（用 X+Y 是否正确）。下次同节点点火时 Read think.md 查历史 → 自动调整。**第一次拆最细，越跑越精准。**

---

## 闭环验收

节点执行完成后：① 产出验收（对照 §4 五要素预期格式）② 存入 task/logs（成功/失败+耗时+策略）③ 更新 think.md（反馈回路）④ 检查点过（如配置了工作流检查点，等待质检员确认）。四步全过 → ✅ 释放到下一节点。

## 缓存复用

同一 workflow 节点已有缓存时，直接复用 `orchestrator/workflows/<hash>.yaml` 拆解结果。仅当 think.md 反馈要求调整时重新拆解。

---

## Gotcha

- **sofagent-orchestrator compose 跨 provider 兼容性差**：OpenClaw CLI provider 输出的 YAML 与 sofagent-orchestrator compose 期望的 schema 不完全兼容。优先配 DeepSeek API Key 直连，fallback CLI provider 成功率低。
- **拆解粒度宁细不粗**：首次执行不确定时选「拆」。多拆一步的代价远小于拆少了导致 Agent 迷路。
- **缓存哈希不含模型版本**：换了模型后旧缓存仍可能命中。手动删除 `orchestrator/workflows/<hash>.yaml` 强制重走 compose。
