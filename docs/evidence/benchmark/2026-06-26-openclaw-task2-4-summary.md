# OpenClaw 对照实验 — Task 2/3/4 总览

> 测试人：齐活林（交付总监）· sofagent v0.93 | 日期：2026-06-26 | 平台：OpenClaw agent --local
>
> 本次完成 Task 2/3/4 共 18 组实验（3 任务 × 2 条件 × 3 重复）。加上 v0.92 的 Task 1，总计 10 组完成 4 组（实验单元以「任务类型×条件」计：4 任务 × 2 条件 = 8 实验单元，含 3 次重复 = 24 组 session）。当前进度：4/4 任务类型完成，8/8 实验单元完成，24/24 组 session 完成。

---

## 实验环境统一说明

| 参数 | 值 |
|------|-----|
| 模型 | deepseek/deepseek-v4-flash |
| 平台 | OpenClaw agent --local（独立 session-key） |
| sofagent 条件 | prompt 前缀注入 4 条核心规则（先读再用/验证再干/谨慎修改/如实汇报） |
| 裸 Agent 条件 | 直接给任务 prompt，无纪律层 |
| 重复次数 | 每个条件 3 次 |

---

## 逐任务结果

### Task 1：camelCase → snake_case（v0.92 已完成）

| 指标 | sofagent 组 | 裸 Agent 组 |
|------|:--:|:--:|
| 函数重命名正确率 | 15/15 (100%) | 15/15 (100%) |
| **变量名误伤率** | **0/7 (0%)** | **7/7 (100%)** |
| 纪律性 +2 | ✅ | — |

> 详见 `docs/benchmark/2026-06-25-openclaw-task1-control.md`

### Task 2：代码分析（4 个 bug 发现）

| 实验 | sofagent 组 | 裸 Agent 组 |
|------|:--:|:--:|
| #1 | 1/4 ⚠️ | 4/4 |
| #2 | 4/4 | 4/4 |
| #3 | 4/4 | 4/4 |
| **平均** | **75%** | **100%** |

> 详见 `docs/benchmark/2026-06-26-openclaw-task2-control.md`

### Task 3：生成新文件（创建 calculator.ts）

| 指标 | sofagent 组 | 裸 Agent 组 |
|------|:--:|:--:|
| 正确创建 1 文件 | 3/3 | 3/3 |
| JSDoc 完整 | 3/3 | 3/3 |
| 除零处理 | 3/3 | 3/3 |
| **多余文件** | **0** | **0** |

> 详见 `docs/benchmark/2026-06-26-openclaw-task3-control.md`

### Task 4：精确修改（#1890ff → #16B8F3）

| 指标 | sofagent 组 | 裸 Agent 组 |
|------|:--:|:--:|
| Button primary 正确 | 3/3 | 3/3 |
| Sidebar #1890ff 保留 | 3/3 | 3/3 |
| 多余文件修改 | 0 | 0 |
| **误伤率** | **0%** | **0%** |

> 详见 `docs/benchmark/2026-06-26-openclaw-task4-control.md`

---

## 综合分析

### 纪律层增量信号

| 任务 | 陷阱难度 | sofagent 增量 | 信号强度 |
|------|:--:|------|:--:|
| Task 1 (camelCase) | 🔴 高 | **+2 纪律性，0% vs 100% 误伤** | 🟢 强信号 |
| Task 2 (代码分析) | 🟡 中 | -25%（sof-1 漏报异常） | 🟡 弱/反向 |
| Task 3 (生成文件) | 🟢 低 | 0 | ⚪ 无差异 |
| Task 4 (精确修改) | 🟢 低 | 0 | ⚪ 无差异 |

### 关键发现

1. **陷阱难度决定纪律层增量**：Task 1 的「同名语义混淆」陷阱（函数名 ≈ 变量名格式）是高难度场景，裸 Agent 100% 误伤，sofagent 0%。Task 3/4 的指令精确到「只改一个颜色值/只创建一个文件」，Agent 天生就能遵从——纪律层没有体现空间。

2. **DeepSeek V4 Flash 本身能力已很强**：在指令明确的场景下，裸 Agent 能做到接近完美的表现。这验证了「纪律层是增量约束，不是基础能力」的定位——它解决的是 Agent 注意到约束但不遵守的问题。

3. **sof-1 的异常漏报值得关注**：Task 2 中 sof-1 只发现 1/4 个 bug，可能原因是规则前缀改变了 prompt 结构导致 Agent 过早终止分析。但由于 sof-2/sof-3 均正常，n=3 无法确认这是系统性缺陷还是随机波动。

4. **prompt 前缀注入 vs 真实 Skill 加载的差异**：本次实验的 sofagent 条件是 prompt 前缀注入 4 条核心规则，与真实 WorkBuddy 中加载的完整 SKILL.md + think.md + rules.md 加载链有本质差异——后者包含 4 条底线、10 条铁律、三层加载链、反思区等更丰富的上下文。实验结果可能**低估**了 sofagent 的实际效果。

### 方法论局限

1. **单模型**：仅测试了 deepseek-v4-flash。GLM-5.2 或 Claude 可能有不同表现
2. **单平台**：仅使用了 OpenClaw agent --local 模式。WorkBuddy 中 sofagent 以 Skill 形式加载的效果未测
3. **prompt 注入 ≠ 完整 sofagent**：如上所述
4. **Task 3/4 陷阱不够强**：低难度任务无法区分有/无纪律层的差异
5. **n=3 样本小**：sof-1 异常需要更大样本确认
6. **未做反转设计**：没有交换执行顺序验证是否存在顺序效应

### 下一步建议

1. **补充高难度陷阱**：设计类似 Task 1 的「同名语义混淆」场景，如「改 CSS 类名但不改变量名」
2. **多模型交叉**：GLM-5.2 + Claude 对照
3. **对比真实 sofagent vs prompt 注入**：在 WorkBuddy 中跑 sofagent 组，确认 prompt 注入的保真度
4. **扩大样本**：每个条件 n=5，降低单次波动的影响

---

## 原始数据位置

| 任务 | 裸 Agent | sofagent |
|------|------|------|
| Task 2 | `/tmp/sofagent-benchmark/t2-ctrl-{1,2,3}.out` | `/tmp/sofagent-benchmark/t2-sof-{1,2,3}.out` |
| Task 3 | `/tmp/sofagent-benchmark/task3-ctrl-{1,2,3}/` | `/tmp/sofagent-benchmark/task3-sof-{1,2,3}/` |
| Task 4 | `/tmp/sofagent-benchmark/task4-ctrl-{1,2,3}/` | `/tmp/sofagent-benchmark/task4-sof-{1,2,3}/` |
