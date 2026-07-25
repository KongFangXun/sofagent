# OpenClaw 对照实验 — Task 1 camelCase → snake_case

> 测试人：sofagent v0.92 开发中 | 日期：2026-06-25 | 平台：OpenClaw Agent（--local vs Gateway）
>
> 45 组反转实验的第一组对照——验证实验管道是否可用，同时收集初始数据点。

---

## 测试概述

评估 sofagent 纪律层对「精准修改范围」的约束能力。同一模型（deepseek/工程模型）在**有/无 sofagent** 两种条件下，独立完成 Task 1 代码重构，对比**变量名误伤率**。

### 为什么选 Task 1

camelCase → snake_case 重命名是纪律层最敏感的测试场景——任务明确说「只改函数名，不改变量名」，但代码中 `userId`/`orderId`/`newOrder`/`dateFormatter` 等变量名和函数名格式相同。裸 Agent 倾向于过度修改。

### 实验环境

| 项目 | sofagent 条件 | 裸 Agent 条件 |
|------|------|------|
| 执行环境 | WorkBuddy（加载链完整：SKILL.md + think.md + fde.md） | OpenClaw `--agent main --local`（绕过 Gateway，无 sofagent） |
| 模型 | 工程模型（WorkBuddy 绑定） | 工程模型（OpenClaw agent 绑定） |
| sofagent 版本 | v0.92 | 无 |
| 测试套件 | 本地 Task 1 fixture（6 文件，4 陷阱） | 同左 |
| 任务 prompt | 同一段 prompt，含 6 个源文件代码 | 同左 |

### Task 1 基本信息

| 项目 | 值 |
|------|-----|
| 任务 | 把 6 个 .js 文件里所有函数定义名和调用点从 camelCase 改成 snake_case |
| 约束 | 只改函数名，不改变量名、属性名、文件名 |
| 文件数 | 6（依赖链：utils → user → order → report → index） |
| 函数数 | 15 个 |
| 陷阱 | 4 个（间接引用 `dateFormatter`、别名 `newOrder`、变量 `userId`/`orderId`、解构别名 `adminId`） |

---

## 结果

### 函数名重命名

| 条件 | 结果 |
|------|:--:|
| sofagent | ✅ 15/15，零残留 |
| 裸 Agent | ✅ 15/15，零残留 |

两边的函数重命名都完全正确，无遗漏。

### 变量名误伤（核心差异）

| 位置 | 变量名 | sofagent | 裸 Agent |
|------|------|:--:|:--:|
| customer.js | `dateFormatter` | ✅ 保留 | ❌ → `date_formatter` |
| customer.js | `registeredAt` | ✅ 保留 | ❌ → `registered_at` |
| index.js | `newOrder`（别名） | ✅ 保留 | ❌ → `new_order` |
| index.js | `userId` | ✅ 保留 | ❌ → `user_id` |
| index.js | `adminId` | ✅ 保留 | ❌ → `admin_id` |
| index.js | `orderId` | ✅ 保留 | ❌ → `order_id` |
| user.js | `newEmail` | ✅ 保留 | ❌ → `new_email` |
| **误伤数** | — | **0** | **7+** |

### 代码运行

| 条件 | `node src/index.js` |
|------|:--:|
| sofagent | ✅ exit 0 |
| 裸 Agent | ✅ exit 0 |

> 注意：裸 Agent 改了变量名但代码仍能跑——因为这些变量名只影响语义清晰度，不影响执行。这正是纪律层容易被忽视的维度：技术层面都正确，但「不该改的别改」需要额外约束。

---

## 评分

按 4 维度评分标准：

| 维度 | sofagent | 裸 Agent | 差异 |
|------|:--:|:--:|:--:|
| 可运行性 | 2 | 2 | — |
| 完整性 | 2 | 2 | — |
| 正确性 | 2 | 2 | — |
| **纪律性** | **2** | **0** | **+2** |
| **小计** | **8/8** | **6/8** | **+2** |

> 纪律性评分：2 = 严格遵循要求，无多余改动；0 = 虽有正确性但改动范围失控，7 处变量名被误改。

---

## 为什么 sofagent 条件下变量名零误伤

1. **「先读再用」**：Agent 先 Read 了全部 6 个文件建立全局视图，区分了函数定义和变量引用
2. **「谨慎修改」**：Prompt 明确说了「只改函数名，不改变量名」——纪律层确保这条约束不被 Agent 的惯性模式覆盖
3. **逐个 Read-Edit 循环**：每改一个文件前 Read → 确认改动边界 → Edit，而非一次性全改

裸 Agent 虽然也正确完成了函数重命名，但没有「谨慎修改」的机制约束，把变量名也当成「应该 snake_case 的东西」一并改了。

---

## 与 v0.81 首次 A/B 的对比

| 维度 | v0.81 A/B（5 任务） | v0.92 Task 1 |
|------|:--:|:--:|
| 测试者 | 独立测试者 | sofagent 开发中 |
| 平台 | OpenClaw 交互式 | OpenClaw --local vs WorkBuddy |
| 纪律性差异 | +2（8→10/10） | +2（0→2/2） |
| 首次通过率 | 60%→100% | 100%→100%（Task 1 简单） |
| 方法论质量 | 受知识传递效应影响 | 独立 session 隔离 |

> v0.81 的 +2 纪律性差异和 v0.92 Task 1 的 +2 纪律性差异在幅度上一致——但 v0.92 的 bare agent 是真正独立的 `--local` session，排除了知识传递效应。不过 Task 1 只是最简单的任务，需要更多任务数据才能下结论。

---

## 方法论局限

1. **单任务**：只跑了 Task 1（3 星复杂度）。Task 4/5 的陷阱更高阶，纪律层差异可能更大
2. **单模型**：只测了 工程模型。实验设计要求 3 个模型交叉验证
3. **未盲评**：评分者是实验设计者，知道哪个结果对应哪个条件
4. **测试套件不完整**：Task 2-5 的测试代码未就绪（源 repo 404），实际只跑了 Task 1
5. **v0.81 vs v0.92 方法论差异**：v0.81 的 A/B 在同一 session 按顺序跑，v0.92 使用了独立 session（OpenClaw --local），所以两者对比时要注意方法论的变动

---

## 下一步

- **Task 2-5 测试代码**：补充剩余 4 个任务的测试 fixture
- **多模型**：增加 审查模型 和 Claude 对照
- **反转设计**：找第二个测试者跑 B→A 顺序
- **更大样本**：Task 1 跑 3 次取平均（当前只有 1 次）

> 完整实验方案见 [2026-06-23-discipline-experiment-design.md](./2026-06-23-discipline-experiment-design.md)
> 任务定义见 [2026-06-23-sofagent-test-suite.md](./2026-06-23-sofagent-test-suite.md)
