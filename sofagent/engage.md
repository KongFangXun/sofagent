# engage.md · 编排引擎（精简版）

> FDE 部署场景专用——workflow 节点触发时点火。个人开发者不需要。
> 两档拆解（拆 vs. 不拆），砍掉四级渐进减薄。

---

## 点火条件

只点火当以下**全部**满足：
1. 当前会话是 FDE 部署场景（`sofagent-fde` skill 已激活）
2. 当前操作是 workflow 中的 🔄/⚡ 节点（已由 FDE §四 识别）
3. 节点尚未执行过（`task/logs` 无该节点成功记录）

不点火的情况：
- 非 FDE 部署场景
- 节点已成功执行过（幂等跳过，复用缓存结果）
- 简单节点（📋 文档生成 / 💬 信息检索等，直接走 Agent 处理）

---

## 两档拆解

| 档位 | 触发条件 | 行为 |
|:--:|---------|------|
| **拆** | 节点任务含多步操作 / 多文件修改 / 多 Agent 协作 | 走 AO compose 一次性拆解 → DAG → 逐步执行 |
| **不拆** | 节点任务为单步操作 / 已知模板匹配 | Agent 直接处理，不走 AO compose |

判断逻辑（在点火后、执行前完成）：
- 读节点的五要素（输入 / 输出 / 负责人 / 耗时 / 痛点）→ 判断任务粒度
- 单步、无依赖 → **不拆**
- 多步、有顺序依赖、需多 Agent → **拆**
- 边界情况 → 默认**拆**（宁多拆不少拆，拆了能并起来，漏拆了难补救）

---

## AO Compose 拆解

当判定为「拆」时，调用 AO compose 生成任务分解：

```bash
ao compose "任务描述" --model flash
```

ao compose 输出 YAML DAG 结构：
```yaml
dag:
  - id: step-1
    description: "分析/准备"
    agent: researcher
    depends_on: []
  - id: step-2
    description: "核心处理"
    agent: developer
    depends_on: [step-1]
  - id: step-3
    description: "验证/测试"
    agent: qa-engineer
    depends_on: [step-2]
```

执行方式：
```bash
ao run workflow.yaml
```

> AO compose 只做一次拆解，不做渐进减薄。FDE 场景下 workflow 节点粒度已在 §三 深挖时确定。

---

## Agent 模板匹配

AO Compose 自带角色模板库，直接引用，不自定义：

| 节点类型 | 匹配角色 |
|---------|---------|
| 数据分析 / 信息检索 | `researcher` |
| 代码实现 / 配置修改 | `developer` |
| 测试 / 验证 | `qa-engineer` |
| 文档 / 报告生成 | `technical-writer` |
| 部署 / 运维操作 | `devops-engineer` |

匹配规则：
1. 优先用 AO Compose 自带 `ao roles` 列出的角色
2. 按节点类型从表中选最接近的
3. 找不到匹配时默认用 `developer`

> 不自定义新角色模板——AO Compose 自有模板库已覆盖 FDE 场景。

---

## think.md 反馈回路

每次编排执行后，更新 `{SOFAGENT_DATA}/think.md` 反思区：

```markdown
## 2026-06-29 节点: [节点名]

- #拆解策略: 本次用了「拆」/「不拆」，结果是 [成功/失败]
- #拆解粒度: 拆成 N 步，实际执行了 M 步——[拆分偏粗/刚好/偏细]
- #角色匹配: 用 developer + qa-engineer——[匹配正确/应换 X]
```

**下次同一节点任务点火时**：
1. Read think.md → 查该节点的历史反思记录
2. 上次「拆了但实际单步跑完」→ 本次改「不拆」
3. 上次「不拆但实际多步才完成」→ 本次改「拆」
4. 上次角色匹配错误 → 本次用 think.md 建议的角色组合

这个反馈回路让编排引擎随节点执行次数增加而自动优化——**第一次拆最细，越跑越精准**。

---

## 闭环验收

节点执行完成后：

1. **产出验收**：输出是否符合 §三 五要素定义的预期产出格式
2. **存入 task/logs**：记录节点执行日志（成功/失败 + 耗时 + 拆解策略）
3. **更新 think.md**：写入反馈回路记录（见上节）
4. **检查点过**：如该节点配置了工作流检查点（§七第三阶段），等待质检员确认

四个步骤全部完成 → 节点状态标记为 ✅ 完成 → 释放到下一个节点。

---

## 缓存复用

同一 workflow 节点之前跑过且有缓存时：
- 直接复用上次 AO compose 拆解结果（`orchestrator/workflows/<hash>.yaml`）
- 不重新走 AO compose——节省 token 和时间
- 仅当 think.md 反馈回路建议调整策略时重新拆解
