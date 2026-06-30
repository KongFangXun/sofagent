# Case 012 — 社区独立测试 A/B（反向组，5 任务代码重构）

> **性质**：社区独立测试 · 真实 A/B 对照
> **来源**：小嘉 (@jm4170134-droid)
> **版本**：sofagent v0.86 (tag)
> **测试时间**：2026-06-24
> **模型**：DeepSeek Reasoner (deepseek/deepseek-reasoner)
> **主机**：Mac mini (ARM64, macOS)

---

## 一句话结论

**sofagent 组（B）在 5 个代码重构任务中全面优于裸 Agent 组（A）**：首次无 bug 率 5/5 vs 4/5，陷阱注释全部保留 vs 部分移除，exports 完整 vs 遗漏，类型严谨 vs `any` 绕过。

---

## 测试设计

| 项 | 值 |
|------|------|
| 任务数 | 5 个代码重构任务 |
| 对照方式 | B→A 反序（先 sofagent 组，后裸 Agent 组） |
| 模型 | DeepSeek Reasoner（两组同模型，控制变量） |
| 评估维度 | diff 行数 / `node --check` / 集成测试 / 陷阱注释保留 / exports 完整性 / 类型严谨度 |

**5 个任务**：
1. camelCase → snake_case（6 文件）
2. API 格式迁移 `{success,data,errorMsg}` → `{ok,payload,error}`（6 文件）
3. 提取公共函数（5 文件 + 新建 common.js）
4. 日志注入（3 文件改动）
5. JS → TypeScript（4 文件 + tsconfig.json）

---

## 结果汇总

| 指标 | Round B (sofagent) | Round A (裸 Agent) |
|------|:------------------:|:------------------:|
| 总 diff 行数 | 975 | 954 |
| 陷阱注释保留 | ✅ 全部保留 | ❌ 部分移除 |
| Exports 完整性 | ✅ 完整 | ❌ 有遗漏 |
| 首次无 bug 率 | ✅ 5/5 一次过 | ❌ 4/5（Task 4 有 bug） |
| 代码可维护性 | 高（结构清晰、注释完整） | 中（紧凑、不易读） |
| 类型严谨度 | 高（完整 interface） | 低（`any` 跳过） |

### 关键差异

| 任务 | sofagent 组优势 |
|------|----------------|
| Task 1 | 保留注释 + 独立 require + 完整 exports |
| Task 2 | `wrapResult` exports 保留 + 陷阱注释保留 |
| Task 3 | diff 更小（77 vs 120），3 个假重复陷阱正确标注不动 |
| Task 4 | **裸 Agent 初始版本有 bug**（`throw new Error` 丢失原始错误），后修复 |
| Task 5 | 完整 interfaces vs `as any` 绕过；裸 Agent 误改函数名 `calculateShipping` → `calcShipping` |

---

## 为什么这个测试有价值

1. **真 A/B 对照** — 两组都是同一模型（DeepSeek Reasoner），唯一变量是 sofagent 有无
2. **5 维度全正向** — 不是碰巧一个维度好，是纪律性/缺陷预防/类型严谨/可追溯性全面领先
3. **第三方独立** — 非作者自测，社区成员自发组织

---

## 方法论标注

> ⚠️ 诚实记录局限：

- **N=1（单次运行）** — 每组每个任务只跑了一次，方差未知
- **反序组设计** — B 先跑 A 后跑，可能有"热身效应"（但 B 是 sofagent 组反而先跑，如果有热身效应应该对 A 更有利，结果 A 仍然更差，说明信号较强）
- **评估非盲** — 报告由小嘉生成，知道哪组是 sofagent

---

## 原始报告

完整报告由小嘉自动生成，存档于本目录。
