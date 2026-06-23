# sofagent 测试套件

> 5 个高复杂度多文件代码任务，用于测试 AI Agent（在有无 sofagent 约束下）的代码修改能力。
> 每个任务都包含互相 import 的多文件代码，改一处需同步改多处。

## 使用方法

### 方式一：对比测试（推荐）

```bash
# 1. 裸 Agent 测试（不装 sofagent）
cd ~/sofagent-test-suite/task1-camel-to-snake
# 给 Agent 任务：见该目录 README.md 中的「任务描述」
# 记录结果（是否完成、错误数、修改一致性）

# 2. 还原代码
git init && git add -A && git commit -m "baseline"  # 先建 baseline
# 跑完裸 Agent 后：git checkout . && git clean -fd  # 还原

# 3. 装上 sofagent，重复同样的任务
# 对比两次结果

# 4. 对每个 task 重复 1-3
```

### 方式二：快速验证单个任务

```bash
cd ~/sofagent-test-suite/taskN-xxx
node src/index.js          # 确认基线可运行
# 给 Agent 任务 → Agent 修改代码
node src/index.js          # 验证修改后是否仍可运行
# 按 README.md 的「验证检查点」逐项检查
```

---

## 5 个测试任务

| # | 目录 | 测试维度 | 文件数 | 复杂度 |
|---|------|---------|--------|--------|
| 1 | `task1-camel-to-snake/` | 跨文件符号一致性（重命名） | 6 | ★★★☆ |
| 2 | `task2-api-migration/` | 接口契约迁移（返回值结构） | 6 | ★★★☆ |
| 3 | `task3-extract-shared-module/` | 代码去重 + 真假重复判断 | 6 | ★★★★ |
| 4 | `task4-add-logging-layer/` | 横切关注点一致性注入 | 6 | ★★★☆ |
| 5 | `task5-js-to-ts/` | 类型推断 + 跨文件类型传播 | 5 | ★★★★★ |

### 各任务核心考点

**Task 1 — camelCase → snake_case**
- 函数定义名跨 5 个文件引用，改定义必须同步改所有调用点
- 陷阱：`customer.js` 有间接调用（赋值给变量后调用），容易漏

**Task 2 — API 签名迁移**
- 返回值字段全换（success→ok, data→payload, errorMsg→error）
- 所有调用方的条件判断和解构都要同步改
- 陷阱：`service-b.js` 同时解构三个字段，容易只改一两个

**Task 3 — 提取公共模块**
- 识别真正重复的代码提取到 shared.js
- **关键陷阱**：`isEmail` 在 validator.js（正则）和 auth.js（includes）里实现不同，不能合并
- 考验 Agent 能否理解语义而非仅看函数名

**Task 4 — 统一日志注入**
- 在 12+ 个函数中统一添加日志（入口/出口/错误三个位置）
- 考验 Agent 的纪律性——格式必须一致，不能有的加有的漏
- 陷阱：递归函数 `processQueue` 加日志不能破坏递归

**Task 5 — JS → TS 迁移**
- 四层架构（model→repository→service→handler）全部加类型
- 需要定义 interface、泛型 Result<T>、处理联合类型
- 陷阱：service.js 的 Result 是 discriminated union，类型推断易出错

---

## 评分建议

每个任务按以下维度打分（0-2 分）：

| 维度 | 0 分 | 1 分 | 2 分 |
|------|------|------|------|
| **可运行性** | 代码报错无法执行 | 有报错但核心功能正常 | 完全无报错 |
| **完整性** | 漏改 >30% 的引用 | 漏改少量（<30%） | 零遗漏 |
| **正确性** | 逻辑被破坏 | 逻辑基本对但有边界错误 | 逻辑完全不变 |
| **纪律性** | 格式混乱、随意发挥 | 基本遵循但有偏差 | 严格遵循要求 |

满分 40 分（5 任务 × 4 维度 × 2 分）。建议对比「裸 Agent vs sofagent Agent」的总分差异。

---

## 目录结构

```
~/sofagent-test-suite/
├── README.md                          ← 本文件
├── task1-camel-to-snake/
│   ├── README.md                      ← 任务说明 + 验证检查点
│   └── src/  (6 个 .js 文件)
├── task2-api-migration/
│   ├── README.md
│   └── src/  (6 个 .js 文件)
├── task3-extract-shared-module/
│   ├── README.md
│   └── src/  (6 个 .js 文件)
├── task4-add-logging-layer/
│   ├── README.md
│   └── src/  (6 个 .js 文件)
└── task5-js-to-ts/
    ├── README.md
    └── src/  (5 个 .js 文件)
```

共 29 个源文件，全部已验证可运行（`node src/index.js` 通过）。
