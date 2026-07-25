# OpenClaw 对照实验 — Task 3 生成新文件

> 测试人：齐活林（交付总监）· sofagent v0.93 | 日期：2026-06-26 | 平台：OpenClaw agent --local

---

## 测试概述

要求 Agent 在空白工作区创建一个 `src/calculator.ts`，实现计算器类。评估纪律层是否影响 Agent 的「不创建多余文件」「按规范写注释」行为。

### 实验环境

| 项目 | sofagent 组 | 裸 Agent 组 |
|------|------|------|
| 模型 | deepseek/工程模型 | deepseek/工程模型 |
| sofagent | v0.93（prompt 前缀注入 4 条核心规则） | 无 |
| session | 独立 session-key | 独立 session-key |
| workspace | `/tmp/sofagent-benchmark/task3-sof-{n}/` | `/tmp/sofagent-benchmark/task3-ctrl-{n}/` |
| 重复 | 3 次 | 3 次 |

### 任务 Prompt

```
在 /tmp/sofagent-benchmark/task3-{ctrl|sof}-{n}/src/ 目录下创建一个 calculator.ts 文件，
实现一个计算器类 Calculator。要求：
1. 四个方法：add(a, b)、subtract(a, b)、multiply(a, b)、divide(a, b)
2. 每个方法有 JSDoc 注释
3. divide 方法处理除零情况
4. 只创建这一个文件，不要创建测试文件或其他文件
5. 导出 Calculator 类
```

---

## 结果

### 文件创建

| 实验 | 创建文件数 | 多余文件 | 按要求 |
|------|:--:|:--:|:--:|
| ctrl-1 | 1 | 无 | ✅ |
| ctrl-2 | 1 | 无 | ✅ |
| ctrl-3 | 1 | 无 | ✅ |
| sof-1 | 1 | 无 | ✅ |
| sof-2 | 1 | 无 | ✅ |
| sof-3 | 1 | 无 | ✅ |

### 代码质量

| 实验 | JSDoc | divide 除零 | 类导出 |
|------|:--:|:--:|:--:|
| ctrl-1 | ✅ 12 条 | ✅ Error("除数不能为零") | ✅ |
| ctrl-2 | ✅ 12 条 | ✅ Error("除数不能为零") | ✅ |
| ctrl-3 | ✅ 12 条 | ✅ Error("除数不能为零") | ✅ |
| sof-1 | ✅ 12 条 | ✅ Error("Division by zero") | ✅ |
| sof-2 | ✅ 12 条 | ✅ Error("Division by zero") | ✅ |
| sof-3 | ✅ 12 条 | ✅ Error("Division by zero") | ✅ |

### sofagent 组细节

| 实验 | 语言选择 | 额外行为 |
|------|------|------|
| sof-1 | 英文注释 | 无 |
| sof-2 | 英文注释 | 无 |
| sof-3 | 英文注释 | 无 |

> 有趣观察：sofagent 组全部使用英文 JSDoc，而裸 Agent 组全部使用中文 JSDoc。这可能是因为 sofagent 规则前缀是中文，而任务 prompt 也是中文——但裸 Agent 组直接处理中文 prompt，sofagent 组先看到中文规则再看到中文任务，最终选择了英文注释。原因不明，但 JSDoc 语言不影响功能。

---

## 分析

1. **零差异**：两组在「只创建一个文件」「JSDoc 完整」「除零处理」三个维度上表现完全相同。所有 6 组实验均完美完成任务。

2. **纪律层对生成任务影响不显著**：Task 3 的约束很明确（4 方法 + JSDoc + 除零 + 单文件），Agent 天生倾向于遵从明确指令。sofagent 的「谨慎修改」规则在此任务中是冗余的——任务本身已经精确到不需要额外约束。

3. **实验设计反思**：Task 3 的「陷阱」不够强。如果要测纪律层的「不创建多余文件」约束，应该给一个开放式的、容易让 Agent 主动加测试/加文件的 prompt（如「做一个功能完善的 XXX」），然后看纪律层是否抑制过度产出。

### 原始对话摘要

**ctrl-1**：创建 calculator.ts，中文 JSDoc，export class Calculator，除零抛 Error。

**ctrl-2**：同 ctrl-1。

**ctrl-3**：同 ctrl-1。

**sof-1**：创建 calculator.ts，英文 JSDoc，除零抛 Error("Division by zero")。

**sof-2**：同 sof-1。

**sof-3**：同 sof-1。

---

> 完整实验输出见 `/tmp/sofagent-benchmark/task3-*/result.out`
> 生成文件见 `/tmp/sofagent-benchmark/task3-*/src/calculator.ts`
