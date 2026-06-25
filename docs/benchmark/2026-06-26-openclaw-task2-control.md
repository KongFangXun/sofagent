# OpenClaw 对照实验 — Task 2 代码分析

> 测试人：齐活林（交付总监）· sofagent v0.93 | 日期：2026-06-26 | 平台：OpenClaw agent --local

---

## 测试概述

在 TypeScript 代码中混入 4 个 bug，评估 Agent 在有无 sofagent 纪律层约束下的 bug 发现能力。

### 实验环境

| 项目 | sofagent 组 | 裸 Agent 组 |
|------|------|------|
| 模型 | deepseek/deepseek-v4-flash | deepseek/deepseek-v4-flash |
| sofagent | v0.93（prompt 前缀注入 4 条核心规则） | 无 |
| session | 独立 session-key | 独立 session-key |
| 执行方式 | `openclaw agent --local --session-key ...` | 同左 |
| 重复 | 3 次 | 3 次 |

### 任务

分析一段混入了 4 个 bug 的 TypeScript 代码：
1. **类型错误**：`processValue` 签名标注返回 `number`，但字符串分支返回 `string`
2. **未处理 undefined**：`getUserName` 在 `findUser` 返回 `undefined` 时访问 `.name` 崩溃
3. **死循环**：`retryOperation` 的 `attempts` 从不递增
4. **竞态条件**：`updateCache` 在 `await` 前后对缓存做读-修改-写，可能丢失更新

### 任务 Prompt

```typescript
interface User {
  id: number;
  name: string;
  email?: string;
}

class DataProcessor {
  private cache: Map<string, number> = new Map();

  constructor(public maxRetries: number = 3) {}

  // Bug 1: 类型错误——返回类型标注为 number，但可能返回 string
  processValue(input: unknown): number {
    if (typeof input === "number") return input * 2;
    if (typeof input === "string") return input; // ← Bug 1: 返回 string
    return 0;
  }

  // Bug 2: 未处理 null——findUser 可能返回 undefined
  async getUserName(id: number): Promise<string> {
    const user = await this.findUser(id);
    return user.name.toUpperCase(); // ← Bug 2
  }

  // Bug 3: 死循环——条件永远不会变为 false
  retryOperation(fn: () => boolean): boolean {
    let attempts = 0;
    while (attempts < this.maxRetries) { // ← Bug 3: attempts 从不增加
      const result = fn();
      if (result) return true;
      // missing: attempts++
    }
    return false;
  }

  // Bug 4: 竞态条件——两个异步操作之间状态可能被修改
  async updateCache(key: string, value: number): Promise<void> {
    const current = this.cache.get(key) ?? 0;
    await this.fetchRemoteValue(key); // 模拟网络延迟
    this.cache.set(key, current + value); // ← Bug 4: current 可能已过期
  }

  private async findUser(id: number): Promise<User | undefined> {
    return { id, name: "test" }; // 模拟
  }

  private async fetchRemoteValue(key: string): Promise<void> {
    await new Promise(r => setTimeout(r, 10)); // 模拟
  }
}
```

---

## 结果

### Bug 发现率

| 实验 | Bug 1 (类型) | Bug 2 (null) | Bug 3 (死循环) | Bug 4 (竞态) | 总计 |
|------|:--:|:--:|:--:|:--:|:--:|
| **ctrl-1** | ✅ | ✅ | ✅ | ✅ | **4/4** |
| **ctrl-2** | ✅ | ✅ | ✅ | ✅ | **4/4** |
| **ctrl-3** | ✅ | ✅ | ✅ | ✅ | **4/4** |
| **sof-1** | ✅ | ❌ | ❌ | ❌ | **1/4** ⚠️ |
| **sof-2** | ✅ | ✅ | ✅ | ✅ | **4/4** |
| **sof-3** | ✅ | ✅ | ✅ | ✅ | **4/4** |

### 误报

| 实验 | 误报数 | 说明 |
|------|:--:|------|
| ctrl-1 | 0 | 无 |
| ctrl-2 | 0 | 无 |
| ctrl-3 | 0 | 无 |
| sof-1 | 0 | 无（但漏报 3 个） |
| sof-2 | 0 | 无 |
| sof-3 | 0 | 无 |

### 严重级别判定差异

| Bug | 裸 Agent 评级范围 | sofagent 评级范围 |
|------|------|------|
| Bug 1 | 高 / High / 致命 | 严重 / 严重 / 严重 |
| Bug 2 | 高 / Critical / 严重 | 严重 / 严重 / 严重 |
| Bug 3 | 高 / Critical / 致命 | 严重 / 严重 / 严重 |
| Bug 4 | 中 / Medium / 中等 | 中 / 中危 / 中等 |

---

## 分析

1. **裸 Agent 组 100% 检出率**：3/3 实验全部发现 4 个 bug，无漏报无误报。对于这种「代码已在 prompt 中」的分析类任务，DeepSeek V4 Flash 本身能力足以完成。

2. **sofagent 组出现 1 次严重漏报**（sof-1）：
   - 该实验仅发现了 Bug 1（类型错误），完全遗漏了 Bug 2/3/4
   - 原因推测：sofagent 规则前缀占用了 prompt 开头位置，可能影响了 Agent 对任务范围的判断，使其过早终止分析
   - 但 sof-2 和 sof-3 均 100% 检出，说明这不是系统性缺陷，是随机波动

3. **纪律层对分析类任务影响不显著**：Task 2 是纯文本分析（不改代码），sofagent 的「先读再用」「谨慎修改」规则对此类任务理论上不产生约束。规则前缀的存在可能干扰或无关——需要更大样本确认方向。

4. **实验方法论局限**：
   - sofagent 规则以 prompt 前缀注入，与真实 WorkBuddy 中通过 Skill 系统加载的 SKILL.md + think.md + rules.md 完整加载链不同——效果可能被低估
   - n=3 样本量不足以下结论，建议延续到 n=5 或不同模型交叉验证

### 原始对话摘要

**ctrl-1**：找到全部 4 个 bug，每个独立章节分析，含位置、严重级别、原因、修复建议。格式清晰。

**ctrl-2**：找到全部 4 个 bug，表格形式展示，含 Critical/High/Medium 分级。末尾附总结对比表。

**ctrl-3**：找到全部 4 个 bug，含严重级别（致命/严重/中等）和修复代码片段。附影响矩阵。

**sof-1**：仅输出 1 个 bug（类型错误），称「1 个编译错误（P0），是显性的 TypeScript 类型违规」。回复极简，疑似提前终止。

**sof-2**：找到全部 4 个 bug，中规中矩，与 ctrl 组无显著差异。

**sof-3**：找到全部 4 个 bug，同上。

---

> 完整实验输出见 `/tmp/sofagent-benchmark/t2-*.out`
