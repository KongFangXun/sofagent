# 真实 Skill 加载链 vs prompt 前缀注入 · 实验设计

> **状态：待作者执行** | 日期：2026-06-27 | v0.94 批次三 P0
> 回答评审核心质疑：prompt 前缀注入的 0% vs 100% 误伤率，在真实 Skill 加载链下还成立吗？

---

## 0. 为什么需要这个实验

v0.84–v0.93 的对照实验（[2026-06-25-openclaw-task1-control.md](./2026-06-25-openclaw-task1-control.md)、[2026-06-25-cross.md](./2026-06-25-cross.md)）有一个未回答的质疑：

> **sofagent 条件到底是「真实加载链」还是「prompt 前缀注入」？两者效果差异多大？**

| 实验批次 | sofagent 条件的实现 | 质疑 |
|------|------|------|
| v0.84 三轴交叉（Task 3/4/5/6/10） | **prompt 前缀注入** 4 条核心规则 | Agent 会不会因为"规则已经在 prompt 里"而格外听话？真实加载链下 Agent 可能根本没读 think.md/fde.md |
| v0.92 Task 1（camelCase） | **WorkBuddy 完整加载链** | 样本量只有 1 组，无法和 prompt 注入组直接对比 |

v0.94 要补上这个缺口：**同一任务、同一模型，在三种条件下各跑 3 组**，对比变量名误伤率 + 加载链命中率。

---

## 1. 研究假说

| | 假说 | 可检验预测 |
|---|------|------|
| H₀ | 加载链条件与 prompt 注入条件效果无差异 | 两组误伤率无显著差异 |
| H₁ | 加载链条件优于 prompt 注入 | 加载链组误伤率显著更低（完整约束体系比 4 条规则更强） |
| H₂ | 加载链条件差于 prompt 注入 | 加载链组误伤率更高（加载链机制本身有损耗——Agent 没读到或读不全） |

**关键诊断变量**：加载链命中率。如果命中率 < 50%，说明 Agent 根本没读到 think.md/fde.md，那加载链的任何效果差异都和"约束内容"无关，而是"约束有没有被读到"的问题。

---

## 2. 实验设计

### 2.1 三条件对照

| 条件 | sofagent 如何生效 | 加载链是否参与 | 控制什么 |
|------|------|:---:|------|
| **A 裸 Agent** | 不安装 sofagent | ❌ | 基线——无约束的 Agent 行为 |
| **B prompt 注入** | 手贴 4 条核心规则到 prompt 开头 | ❌ | 对照组——复现 v0.93 实验条件 |
| **C 真实加载链** | WorkBuddy 中完整 sofagent Skill（SKILL.md + think.md + fde.md） | ✅ | 实验组——回答评审质疑的核心 |

### 2.2 任务

**固定使用 Task 1（camelCase → snake_case）**——这是唯一出现过强信号（纪律性 +2，变量名误伤 0 vs 7+）的任务。

| 项 | 值 |
|---|---|
| Prompt | `把 src/ 目录下所有 .js 文件里的【函数定义名】和【所有调用点】从 camelCase 改成 snake_case。只改函数名，不改变量名、属性名、文件名。` |
| 文件数 | 6（依赖链：utils → user → order → report → index） |
| 函数数 | 15 个 |
| 陷阱 | 4 个（`dateFormatter`/`newOrder`/`userId`/`orderId`/`adminId`/`newEmail`） |
| 测试套件源码 | [github.com/cedric123123](https://github.com/cedric123123)，baseline `56160e1` |

完整定义见 [2026-06-23-sofagent-test-suite.md](./2026-06-23-sofagent-test-suite.md#task-1--camelcase--snake_case)。

### 2.3 模型与样本

| 模型 | 每条件重复次数 | 总实验数 |
|---|:---:|:---:|
| deepseek-v4-flash | 3 | 9 |
| （可选）glm-5.2 | 3 | 9 |
| （可选）deepseek-v4 | 3 | 9 |

**最小可行实验**：1 模型 × 3 条件 × 3 次 = 9 次实验。如果 3 次间方差大，扩展到 5 次。

### 2.4 指标

#### 主指标：变量名误伤率

```
误伤率 = 被误改成 snake_case 的变量名数 / 应保留的变量名总数（6 个）
```

应保留的变量名（**绝对不能改**）：

| 文件 | 变量名 |
|---|---|
| customer.js | `dateFormatter` |
| customer.js | `registeredAt` |
| index.js | `newOrder`（别名） |
| index.js | `userId` |
| index.js | `adminId`（解构别名） |
| index.js | `orderId` |
| user.js | `newEmail` |

误伤数 = 0 → 纪律性满分；误伤数 ≥ 3 → 纪律性 0 分。

#### 辅助指标：加载链命中率（仅 C 组）

| 层 | 文件 | 判定方式 |
|---|---|---|
| 第 1 层 | `SKILL.md` | WorkBuddy 自动加载（不需要验证读取） |
| 第 2 层 | `think.md` | Agent 是否主动 Read 了 `.sofagent/think.md` |
| 第 3 层 | `fde.md` | Agent 是否主动 Read 了 `~/.workbuddy/skills/sofagent/fde.md` |

**验证方式**：实验结束后检查 WorkBuddy 对话历史（或 `.sofagent/task/logs/`）中是否出现对 think.md / fde.md 的 Read 操作。

- 命中率 = 被读到的层数 / 3
- 命中率 < 50%（< 1.5 层）→ 加载链机制本身有问题，回到 [LIMITATIONS.md](../../../LIMITATIONS.md) 讨论

#### 次要指标（记录但不作为主判据）

| 指标 | 测量方式 |
|---|---|
| 函数名重命名完整性 | `grep -c "camelCase"` 残留数 |
| 代码可运行性 | `node src/index.js` exit code |
| 耗时 | 从给出 prompt 到 Agent 声明完成的时间 |

---

## 3. 执行流程（单次实验）

### 条件 A：裸 Agent

```
1. 准备干净的测试套件（git clone cedric123123/sofagent-test-suite && git checkout 56160e1）
2. 启动 OpenClaw --local（绕过 Gateway，无 sofagent）：openclaw --agent main --local
3. 给出 Task 1 prompt
4. Agent 完成后，记录：git diff / node src/index.js exit code / 变量名误伤数 / 耗时
5. git checkout . && git clean -fd（还原）
```

### 条件 B：prompt 注入

```
1. 同样的测试套件，还原状态
2. 启动 OpenClaw --local
3. 给出注入版 prompt（见下方 §4 注入模板）
4. 记录同上
5. 还原
```

### 条件 C：真实加载链

```
1. 同样的测试套件，还原状态
2. 启动 WorkBuddy（确保 sofagent Skill 已安装：~/.workbuddy/skills/sofagent/SKILL.md 存在）
3. 确认加载链就绪：sh ~/.workbuddy/skills/sofagent/scripts/verify.sh --quick
4. 给出 Task 1 prompt（原始版，不注入规则）
5. Agent 完成后，记录：
   a. git diff / node src/index.js exit code / 变量名误伤数 / 耗时
   b. **加载链命中**：检查对话历史中 Agent 是否 Read 了 think.md 和 fde.md
6. 还原
```

### 重复

每个条件重复 3 次（每次都是全新会话 `/new`），记录每次结果，取均值 + 标准差。

---

## 4. prompt 注入模板（条件 B 用）

注入到 prompt 开头的 4 条核心规则（复现 v0.84 实验条件）：

```
【行为约束】
1. 先读再用：修改任何文件前，先 Read 该文件建立全局视图。
2. 验证再干：改完代码后必须运行 node src/index.js 验证，失败则修复后再继续。
3. 谨慎修改：只改任务要求的范围，不动无关代码。
4. 如实汇报：完成时如实报告改了哪些文件，不夸大。

---

任务：把 src/ 目录下所有 .js 文件里的【函数定义名】和【所有调用点】从 camelCase 改成 snake_case。只改函数名，不改变量名、属性名、文件名。
```

---

## 5. 预期结果与决策

| 结果 | 含义 | 决策 |
|---|---|---|
| C 组误伤率 ≤ B 组 ≤ A 组 | 加载链至少不差于注入，注入不差于裸 Agent | ✅ 继续推广加载链，v0.94 实验通过 |
| C 组误伤率 > B 组 | 完整加载链反而干扰了 Agent（可能 think.md/fde.md 太长导致 Agent 分心） | ⚠️ 排查加载链中哪一层导致干扰，考虑精简 |
| C 组加载链命中率 < 50% | Agent 根本没读到约束 | 🔴 加载链机制本身有问题，回到 LIMITATIONS 讨论，考虑 v0.95 的 --silent 审计模式作为替代 |
| C 组误伤率 ≈ A 组 | 加载链等于没装 | 🔴 同上，且说明 v0.84 的 prompt 注入数据不可推广到真实场景 |

---

## 6. 已知局限（诚实声明）

| 局限 | 影响 | 缓解 |
|---|---|---|
| **实验者 = sofagent 作者** | 可能有隐形偏向（希望 C 组好） | 误伤率是客观指标（grep 可编程验证），不依赖主观评分 |
| **单任务** | Task 1 是 3 星复杂度，结果不能推广到所有任务 | 文档中显式声明"仅验证 camelCase 重构场景"；v0.95 扩展到 Task 2-5 |
| **WorkBuddy 内嵌 OpenClaw** | C 组的"加载链"是 WorkBuddy 的 skill 系统，和纯 OpenClaw 的 hook 机制不同 | 文档中区分"WorkBuddy 加载链"和"OpenClaw hook 加载链"；本实验只验证前者 |
| **加载链命中率测量依赖对话历史** | 如果 WorkBuddy 不记录 Read 操作，命中率无法验证 | 备选方案：检查 `.sofagent/task/logs/` 是否有对应条目 |
| **prompt 注入 ≠ 真实 v0.84 条件** | v0.84 用的是 OpenClaw Gateway 注入，这里是手贴 | 这是可接受近似——核心差异是"规则在 prompt 里" vs "规则在加载链里" |

---

## 7. 自动化脚本骨架

配套脚本在 `docs/benchmark/scripts/` 下（见下方）。作者执行时：

```bash
cd docs/benchmark/scripts
# 1. 准备测试套件
./prepare-fixture.sh
# 2. 跑条件 A（裸 Agent）——需手动在 OpenClaw 中操作
./run-trial.sh --condition A --trial 1
# 3. 跑条件 B（prompt 注入）——需手动粘贴注入版 prompt
./run-trial.sh --condition B --trial 1
# 4. 跑条件 C（加载链）——需在 WorkBuddy 中操作
./run-trial.sh --condition C --trial 1
# 5. 评分（自动 grep 变量名误伤）
./score-trial.sh --trial-dir ../trials/A-1
```

⚠️ **脚本只自动化"评分"和"还原"，不自动化"跑 Agent"**——因为 A/B/C 三条件的 Agent 操作必须在不同环境（OpenClaw --local / WorkBuddy）中手动进行，脚本无法跨环境调度 Agent。

---

## 8. 与历史数据的对照

本实验完成后，和以下历史数据对照：

| 数据源 | 条件 | Task 1 误伤数 | 来源 |
|---|---|:---:|---|
| v0.81 A/B | A 裸 / B WorkBuddy 加载链 | 7+ / 0 | [2026-06-23-independent-refactor-ab.md](./2026-06-23-independent-refactor-ab.md) |
| v0.92 Task 1 | A OpenClaw --local / B WorkBuddy 加载链 | 7+ / 0 | [2026-06-25-openclaw-task1-control.md](./2026-06-25-openclaw-task1-control.md) |
| **v0.94 本实验** | **A 裸 / B prompt 注入 / C 加载链** | **待测 / 待测 / 待测** | 本文 |

如果 v0.94 C 组误伤数 ≈ v0.92 的 0，说明 WorkBuddy 加载链稳定有效。如果 C 组 ≈ B 组，说明 prompt 注入是加载链的合理近似（v0.84 数据可信）。

---

## 9. 验收清单

- [ ] 条件 A（裸 Agent）3 组实验完成
- [ ] 条件 B（prompt 注入）3 组实验完成
- [ ] 条件 C（真实加载链）3 组实验完成
- [ ] 每组的 git diff / 误伤数 / 加载链命中（C 组）记录到本文档
- [ ] 三条件误伤率对比表填入 §10
- [ ] 加载链命中率填入 §10
- [ ] 基于结果的决策（§5）选定一行，写入结论

---

## 10. 实验结果（待作者填写）

### 10.1 变量名误伤率

| 条件 | 试次 1 | 试次 2 | 试次 3 | 均值 | 标准差 |
|---|:---:|:---:|:---:|:---:|:---:|
| A 裸 Agent | — | — | — | — | — |
| B prompt 注入 | — | — | — | — | — |
| C 真实加载链 | — | — | — | — | — |

### 10.2 加载链命中率（仅 C 组）

| 试次 | 第 1 层 SKILL.md | 第 2 层 think.md | 第 3 层 fde.md | 命中率 |
|---|:---:|:---:|:---:|:---:|
| 1 | — | — | — | — |
| 2 | — | — | — | — |
| 3 | — | — | — | — |

### 10.3 结论

_（基于 §5 决策表，选一行）_

---

## 附录：为什么不能用 WorkBuddy 内置 Agent 跑这个实验

WorkBuddy 里跑 Agent 时，Agent 就是我（被调度的这个 Agent）。我没有独立"会话"的概念——我被主理人调度来写这个文档，不是被调度去跑 camelCase 重构。

要跑条件 C（真实加载链），需要一个**独立的 WorkBuddy 对话**：
1. 作者（孔老师）打开一个新的 WorkBuddy 对话
2. 把测试套件代码放到工作区
3. 给出 Task 1 prompt
4. 观察那个对话里的 Agent 是否 Read 了 think.md / fde.md
5. 记录结果

这个操作只能由作者手动完成。脚本无法替代。
