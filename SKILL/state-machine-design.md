# SKILL.state 执行协议 · 节点状态机设计文档

> **版本**：v1.5.5 章一交付 · **出处**：[arXiv:2608.26263](https://arxiv.org/abs/2608.26263)（EMNLP）· sofagent 采纳形态
> **模块**：`engine/orchestrator/src/execution-state/`（schema 注册表 + 协议核心 + 度量 + 审计摘要）

## 一、为什么

节点执行原来是「消息历史滚雪球」（createReactAgent 无 trimMessages）：长任务 token O(T²)、上下文中毒风险随步数累积。SKILL.state 把技能执行改成**状态机**：每步只带 P + Σt + ot，推理轨迹合并后即弃——单步 prompt O(1)、累计 token O(T)。论文实测 16.2 倍 token 压缩、抗噪 ≥0.97、同预算下远胜滑窗截断与 LLMLingua。

**sofagent 的独有底气**：wrapToolCall 运行时审计在每步动作发生时实时落记录——**轨迹可弃、行为可溯**（论文没有的审计前提）。

## 二、协议六要素（sofagent 落地形态）

| 要素 | 落地 | 实现点 |
|------|------|--------|
| **P（技能说明，不可变）** | systemPrompt / SKILL.md 注入内容，执行期只读恒定 | `node-executor.ts` 循环外构建一次 |
| **Σt（执行状态 JSON）** | 每节点类型结构化状态，唯一跨步携带的记忆 | `schema.ts` 注册表 + `protocol.ts` |
| **ot（最新观察）** | 上一步工具返回（截断至 token 预算），只看最新 | `protocol.ts` OT_BUDGET=4000 |
| **ΔΣt（状态补丁）** | 模型每步输出 JSON Patch 子集，**运行时代码执行合并** Σt+1 = Σt ⊕ ΔΣt，schema 校验不过即拒绝**整个补丁**（不部分应用） | `applyPatch()` fail-closed |
| **Rt（推理轨迹，即弃）** | 步内完整保留供推理，验证通过后不进下一步 prompt；丢弃前落审计摘要（动作 + ΔΣt + 因果边） | `emitAuditDigest()` → wrapToolCall 通道 |
| **降级路径** | 每节点 `executionMode: stateful \| legacy`；连续拒绝 N 次（默认 3）自动降级 + 审计告警；`SOFAGENT_STATEFUL_EXEC=off` 一键全回退 | `resolveExecutionMode()` / `shouldAutoDegrade()` |

## 三、节点类型 schema（基础六字段 + 领域扩展）

基础六字段（全节点通用底座）：

```json
{
  "goal": "本节点任务目标",
  "done": ["已完成步骤（带结果摘要）"],
  "todo": ["待办步骤"],
  "facts": ["工具观察到的关键事实（不含原始输出）"],
  "files": ["已改动文件路径"],
  "blockers": ["阻塞项与绕行决策"]
}
```

| 节点类型 | 领域扩展字段 | 语义 |
|------|------|------|
| engineer | `tests: {pass, fail, skipped}` · `reviewComments: [{file, line, status}]` | 代码修复循环 |
| checker | `checkRuns: [{rule, verdict, evidence}]` · `falsePositives: []` | 审查循环 |
| reviewer | `issuesBySeverity: {p0, p1, p2}` · `coveredFiles: []` | 审查循环 |
| refine-agent | `qualityScores: [{round, score}]` · `triedStrategies: []` | 优化循环 |
| 通用长任务 | （仅基础六字段） | 文档批处理/数据处理等默认形态 |

**schema 是领域资产**（沉淀于本设计文档），非任务级配置——新节点类型在 `schema.ts` 注册即用。

## 四、ΔΣt 合并规则（代码保证，不靠模型自觉）

- `add`：数组字段 = 追加语义；对象字段 = 覆盖
- `update`：覆盖（经 schema validator）
- `remove`：只允许领域字段移除**条目**；基础六字段键不可删
- `path` 必须是注册表内字段——未知字段拒绝（防状态面无限膨胀）
- 任一字段校验失败 ⇒ **整个补丁拒绝**（防半更新脏态）

## 五、度量与可观测

- 每节点 `data/evolution/stateful-metrics.jsonl`：token 曲线（stateful 应近似 O(1) 平线）/ 轮次 / 补丁拒绝数 / 成败 / 耗时 / 是否自动降级——Dashboard evolution 面消费既有通道。
- 审计摘要行（`execution-state-digest`）：动作 + 补丁 + 因果边——经 `setAuditSink` 由 middleware 的 wrapToolCall 通道接收。

## 六、降级语义

| 场景 | 行为 |
|------|------|
| `SOFAGENT_STATEFUL_EXEC=off` | 全部节点走 legacy（消息历史式）——一键回退 |
| 连续 3 次补丁被拒 | 该节点自动降级 legacy 重执行，`degraded:true` 可观测，度量记 `autoDegraded:true` |
| LLM / agent 工厂不可用 | 落 legacy 既有降级路径（v1.4.5 T6 语义） |
