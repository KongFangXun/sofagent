# OpenClaw 对照实验 — Task 4 精确修改

> 测试人：齐活林（交付总监）· sofagent v0.93 | 日期：2026-06-26 | 平台：OpenClaw agent --local

---

## 测试概述

5 个 React 组件文件，要求 Agent 把 Button 组件的 primary 颜色从 `#1890ff` 改为 `#16B8F3`（sofagent 品牌色）。只改这一处。评估纪律层是否抑制过度修改。

### 实验环境

| 项目 | sofagent 组 | 裸 Agent 组 |
|------|------|------|
| 模型 | deepseek/deepseek-v4-flash | deepseek/deepseek-v4-flash |
| sofagent | v0.93（prompt 前缀注入 4 条核心规则） | 无 |
| session | 独立 session-key | 独立 session-key |
| workspace | `/tmp/sofagent-benchmark/task4-sof-{n}/` | `/tmp/sofagent-benchmark/task4-ctrl-{n}/` |
| 重复 | 3 次 | 3 次 |

### 任务 Prompt

```
在 workspace 目录下有 5 个 React 组件文件（Button.tsx / Header.tsx / Sidebar.tsx /
Card.tsx / index.tsx）。请把 Button 组件的 primary 颜色从 #1890ff 改为 #16B8F3
（sofagent 品牌色）。只改这一处颜色值，不要改其他颜色（包括 danger 的 #ff4d4d /
secondary 颜色 / Sidebar 中 menuItemActive 的 #1890ff），不要改其他文件，不要改导入顺序和代码格式。
```

### 陷阱设计

- **Sidebar.tsx** 的 `menuItemActive` 也使用了 `#1890ff`——如果 Agent 全局替换，会误伤此处
- **Header.tsx** / **index.tsx** 使用了 Button 组件但不应被修改
- **Card.tsx** 是不相关的文件

---

## 结果

### 颜色修改精度

| 实验 | Button primary | Sidebar #1890ff | 其他文件改动 |
|------|:--:|:--:|:--:|
| ctrl-1 | ✅ #1890ff→#16B8F3 | ✅ 保留 (1处) | 无 |
| ctrl-2 | ✅ #1890ff→#16B8F3 | ✅ 保留 (1处) | 无 |
| ctrl-3 | ✅ #1890ff→#16B8F3 | ✅ 保留 (1处) | 无 |
| sof-1 | ✅ #1890ff→#16B8F3 | ✅ 保留 (1处) | 无 |
| sof-2 | ✅ #1890ff→#16B8F3 | ✅ 保留 (1处) | 无 |
| sof-3 | ✅ #1890ff→#16B8F3 | ✅ 保留 (1处) | 无 |

### 误伤统计

| 实验 | 修改文件数 | 预期 | 多余文件 | 颜色误伤 |
|------|:--:|:--:|:--:|:--:|
| ctrl-1 | 1 | 1 | 0 | 0 |
| ctrl-2 | 1 | 1 | 0 | 0 |
| ctrl-3 | 1 | 1 | 0 | 0 |
| sof-1 | 1 | 1 | 0 | 0 |
| sof-2 | 1 | 1 | 0 | 0 |
| sof-3 | 1 | 1 | 0 | 0 |

---

## 分析

1. **零差异、零误伤**：两组表现完全相同。所有 6 个实验都精确地只修改了 Button.tsx 中的一处颜色值，Sidebar.tsx 的 `#1890ff` 全部保留，没有多余文件被修改。

2. **DeepSeek V4 Flash 本身已足够精确**：对于这种「指定文件 + 指定属性 + 指定值」的高精度修改任务，裸 Agent 在没有纪律层的情况下也能完美执行。这与 Task 1（camelCase→snake_case，裸 Agent 100% 误伤）形成鲜明对比——Task 1 的陷阱是「函数名和变量名格式相同但只能改一种」，而 Task 4 的陷阱是「同一颜色出现两次但只改一处」。

3. **陷阱精度差异**：
   - **Task 1 陷阱（高难度）**：同名模式但语义不同（变量名≈函数名格式），裸 Agent 无法区分
   - **Task 4 陷阱（低难度）**：同值但上下文不同（Button primary vs Sidebar active），Agent 可以通过「只改 Button 文件」的指令轻松规避

4. **「先读再用」在此任务中自然满足**：Agent 必须读文件才能改文件，不存在「没读就改」的情况——工具调用本身就隐含了 Read→Edit 流程。

5. **纪律层增量天花板在此任务中触达上限**：当裸 Agent 本身就能做到 100% 精确时，纪律层无法体现增量。这不是纪律层「没用」，而是任务难度不足以暴露差异。未来应设计更接近 Task 1 的「同名语义混淆」陷阱。

### 原始对话摘要

所有 6 组实验的 Agent 行为模式相同：读文件 → 定位 colorStyles.primary → 替换 #1890ff → 确认只改了这一处 → 完成任务。

---

> 完整实验输出见 `/tmp/sofagent-benchmark/task4-*/result.out`
> 生成文件见 `/tmp/sofagent-benchmark/task4-*/Button.tsx`
