# sofagent 测试套件

> 5 个高复杂度多文件代码重构任务，用于测试 AI Agent（在有无 sofagent 约束下）的代码修改能力。
> 每个任务都包含互相 import 的多文件代码，改一处需同步改多处。
>
> 测试套件源码由独立测试者维护：[github.com/cedric123123](https://github.com/cedric123123)

---

## 测试任务矩阵

| # | 任务 | 测试维度 | 文件数 | 复杂度 | 陷阱数 |
|---|------|---------|--------|--------|--------|
| 1 | camelCase → snake_case 重命名 | 跨文件符号一致性 | 6 | ★★★☆ | 3 |
| 2 | API 签名迁移（返回值结构） | 接口契约一致性 | 6 | ★★★☆ | 2 |
| 3 | 提取公共模块（消除重复） | 代码理解 + 去重判断 | 6 | ★★★★ | 1 |
| 4 | 统一日志层注入 | 横切关注点一致性 | 6 | ★★★☆ | 3 |
| 5 | JavaScript → TypeScript 迁移 | 类型推断 + 类型传播 | 5 | ★★★★★ | 3 |

共 29 个源文件，~50 个函数，跨文件依赖链最深 3 层（index → report → order → user → utils），~1500 行。

---

## 评分标准

每个任务按 4 个维度打分，每项 0-2 分，满分 40 分（5 × 4 × 2）。

| 维度 | 0 分 | 1 分 | 2 分 |
|------|------|------|------|
| **可运行性** | 代码报错无法执行 | 有少量报错但核心功能正常 | 完全无报错，所有路径通过 |
| **完整性** | 漏改 >30% 的引用点 | 漏改少量（<30%） | 零遗漏，所有检查点通过 |
| **正确性** | 业务逻辑被破坏 | 逻辑基本正确但有边界错误 | 逻辑完全与基线等价 |
| **纪律性** | 随意发挥、格式混乱 | 基本遵循要求但有偏差 | 严格遵循要求，无多余改动 |

---

## 各任务详细说明

### Task 1 — camelCase → snake_case

**Prompt**：把 src/ 目录下所有 .js 文件里的【函数定义名】和【所有调用点】从 camelCase 改成 snake_case。只改函数名，不改变量名、属性名、文件名。

**代码结构**：
```
src/
├── utils.js      ← 工具函数定义（被所有人引用）
├── user.js       ← 引用 utils
├── order.js      ← 引用 utils + user
├── customer.js   ← 引用 user（间接依赖 utils）
├── report.js     ← 引用 order + customer
└── index.js      ← 入口，聚合所有模块
```

**核心陷阱**：
- `customer.js` 里 `formatDate` 被赋值给变量后间接调用，容易漏
- `report.js` 同时 require 了 order 和 customer，两边的函数都要改
- `index.js` 解构 import 时用的别名，Agent 可能只改一边
- 变量名 `userId`/`orderId` 不应改（裸 Agent 常误改）

**验证检查点**：`node src/index.js` 无报错 → `grep` 无残留驼峰函数名 → 变量名未改 → 间接调用也改了

---

### Task 2 — API 签名迁移

**Prompt**：把所有 API 从旧格式迁移到新格式。

```
旧：{ success: boolean, data: any, errorMsg?: string }
新：{ ok: boolean, payload: any, error: string | null }
```

**代码结构**：api.js（定义层）+ service-a/b/c.js（调用方）+ controller.js（聚合）+ index.js（入口）

**核心陷阱**：
- service-b.js 同时解构 success 和 data，容易只改一个
- controller.js 的 `result.errorMsg || 'unknown'` 表达式，容易漏改
- api.js 内部函数之间互相调用，内部返回值字段也要同步

---

### Task 3 — 提取公共模块

**Prompt**：审查代码，发现重复实现的逻辑，提取到 shared.js。注意有些"看起来重复"的代码其实有细微差异，不要强行合并。

**关键陷阱 — 真假重复区分**：

| 函数名 | 出现位置 | 是否真重复 |
|--------|---------|-----------|
| isEmpty | validator.js, formatter.js | ✅ 真重复（实现相同） |
| isEmail | validator.js, auth.js | ❌ **假重复！** validator 用正则，auth 用 `includes('@')` |
| formatDate | formatter.js, repository.js | ✅ 真重复 |

正确结果：shared.js 只包含 `isEmpty` 和 `formatDate`。**isEmail 不能合并**。

---

### Task 4 — 统一日志层注入

**Prompt**：给所有模块的关键函数统一添加日志。入口 `logger.info`、返回 `logger.info`、错误 `logger.error`。格式统一，不改业务逻辑。

**代码结构**：logger.js（不改）+ db.js + http.js + cache.js + queue.js + index.js，共 12+ 个需要注入日志的函数。

**核心陷阱**：
- queue.js 的 `processQueue` 是递归函数，日志不能破坏递归逻辑
- cache.js 的 `getCached` 有 try-catch，两个分支都要加日志
- http.js 的 `requestWithRetry` 有重试循环，日志应反映每次尝试
- 最考验纪律性——格式必须一致，不能有的加有的漏

---

### Task 5 — JS → TS 迁移

**Prompt**：把所有 .js 迁移为 TypeScript。为所有函数添加类型注解，定义 interface/type，处理跨文件类型传播。

**代码结构**（四层架构）：
```
src/
├── model.js        ← 数据模型层（应定义 User, Order interface）
├── repository.js   ← 数据访问层（返回 model 中定义的类型）
├── service.js      ← 业务层（组合 repository，返回 Result<T>）
├── handler.js      ← 处理层（调用 service，返回 HTTP 风格响应）
└── index.js        ← 入口
```

**核心陷阱**：
- service.js 的 `Result` 是联合类型（成功/失败两种形态），需要 discriminated union
- repository.js 的 `findById` 返回 `User | null`，service 层必须处理 null 分支
- handler.js 返回的 status 是数字字面量类型（200/400/404）
- 类型链必须完整：model → repository → service → handler，无断链

---

## 使用方法

### 对比测试流程

```bash
# 1. 裸 Agent 测试（不装 sofagent）
cd ~/sofagent-test-suite/task1-camel-to-snake
git init && git add -A && git commit -m "baseline"
# 给 Agent 任务 → Agent 修改代码 → 记录结果

# 2. 还原代码
git checkout . && git clean -fd

# 3. 装上 sofagent，重复同样的任务，对比两次结果

# 4. 对每个 task 重复 1-3
```

### 测试套件源码

源码（29 个 JS/TS 文件）由独立测试者维护，获取方式：

> GitHub: [github.com/cedric123123](https://github.com/cedric123123)
> Git baseline: `56160e1`（2026-06-23 10:00 +0800）

---

## 首次实测结果（v0.81，2026-06-23）

> 完整对比报告见 [2026-06-23-independent-refactor-ab.md](./2026-06-23-independent-refactor-ab.md)

### 总体评分

| 维度 | 第一轮（无 sofagent） | 第二轮（使用 sofagent） | 差异 |
|------|:---:|:---:|:---:|
| 可运行性 | **10/10** | **10/10** | — |
| 完整性 | **10/10** | **10/10** | — |
| 正确性 | **10/10** | **10/10** | — |
| **纪律性** | **8/10** | **10/10** | **+2** ⬆️ |
| **总分** | **38/40（95%）** | **40/40（100%）** | **+2** |

### 效率对比

| 指标 | 第一轮 | 第二轮 | 差异 |
|------|:----:|:----:|:---:|
| 总用时 | ~16 min | ~12 min | **-25%** ⬇️ |
| 修复次数 | 2 | 0 | **-100%** ⬇️ |
| 首次通过率 | 60%（3/5） | **100%（5/5）** | **+40%** ⬆️ |

### sofagent 具体贡献

| sofagent 机制 | 影响的任务 | 具体改善 |
|--------------|-----------|---------|
| **「先读再用」** | Task 1 | 先读全部 6 文件建全局视图，区分函数名/变量名的改动边界 |
| **「验证再干」** | Task 5 | handler.ts 主动验证类型导入路径，编译一次通过 |
| **「谨慎修改」** | Task 1, 5 | 阻止不必要的范围蔓延 |
| **think.md** | 全部 | 第一轮经验教训沉淀到第二轮 |

### 一句话结论

sofagent 的主要价值不在提升 Agent 的"技术能力"（两轮正确性一样好），而在**提升纪律性、减少修复迭代、降低返工成本**。

> ⚠️ **方法论局限**：知识传递效应（第二轮可能受益于第一轮上下文）+ 单次测试 + 单一模型 + 任务同质化。需反转顺序重跑确认。
