# Task 5: JavaScript → TypeScript 迁移（添加类型）

## 任务描述（给 Agent 的 prompt）

```
把 src/ 下的所有 .js 文件迁移为 TypeScript。

要求：
1. 将所有 .js 文件重命名为 .ts
2. 为所有函数添加参数类型和返回值类型注解
3. 定义必要的 interface / type（如 User, Order, Result<T>）
4. 处理跨文件类型：类型定义放在最合适的文件，其他文件 import
5. index.ts 改名为 index.ts 并添加正确的类型入口
6. 确保类型严格：不使用 any（除非确实无法推断，需注释说明）
7. 所有跨文件的类型引用（import type）必须正确
8. 确保类型一致性：model 定义的 User 必须和 repository / service 使用的一致
```

## 测试目标

压测 Agent 的**类型推断 + 跨文件类型传播**能力。
裸 Agent 常见失败：
- 每个文件各自定义同名 interface 而不是共享 import
- model 层定义了 User，service 层又重复定义
- 函数返回类型推断错误（尤其是 Promise / 嵌套对象）
- 忘记处理联合类型（如 `Result<T> = { ok: true, data: T } | { ok: false, error: string }`）
- import type vs import 混用导致运行时问题
- 忘记给可选字段加 `?`

## 代码结构（5 个文件，四层架构）

```
src/
├── model.js        ← 数据模型层（应定义 User, Order 等 interface）
├── repository.js   ← 数据访问层（返回 model 中定义的类型）
├── service.js      ← 业务层（组合 repository，返回 Result<T>）
├── handler.js      ← 处理层（调用 service，返回 HTTP 风格响应）
└── index.js        ← 入口
```

## 验证检查点

1. 所有 .js 文件已重命名为 .ts
2. `grep -rn "any" src/*.ts` 返回 0（或仅有带注释的例外）
3. model.ts 定义了 `User` 和 `Order` interface
4. repository.ts 用 `import type { User, Order } from './model'`
5. service.ts 定义了泛型 `Result<T>` 类型
6. 所有函数有显式返回类型注解
7. handler.ts 的返回类型是统一的 `{ status: number, body: T }` 形态
8. 类型链完整：model → repository → service → handler，无断链

## 期望中的陷阱

- service.js 的 `Result` 是联合类型（成功/失败两种形态），需要 discriminated union
- repository.js 的 `findById` 返回 `User | null`，service 层必须处理 null 分支
- handler.js 返回的 status 是数字字面量类型（200/400/404），需推断为 number
- index.js 的 main 函数无返回值，应为 `: void`
- 部分字段是可选的（如 Order.discount），需要 `?` 标记
