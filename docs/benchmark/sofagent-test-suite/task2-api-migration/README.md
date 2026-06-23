# Task 2: API 签名迁移（返回值结构重构）

## 任务描述（给 Agent 的 prompt）

```
把 src/ 下所有 API 调用从旧格式迁移到新格式。

旧 API 返回值：{ success: boolean, data: any, errorMsg?: string }
新 API 返回值：{ ok: boolean, payload: any, error: string | null }

要求：
1. 改 api.js 里的返回值结构（成功时 error 字段为 null，失败时 payload 为 null）
2. 改所有调用方（service-a/b/c.js、controller.js、index.js），适配新字段名
3. 失败处理逻辑：旧代码用 if(!result.success) 判断，新代码用 if(!result.ok) 判断
4. 保持业务逻辑不变，只改字段访问
5. 改完代码必须能正常运行
```

## 测试目标

压测 Agent 的**接口契约一致性**能力。裸 Agent 常见失败：
- 改了 api.js 但漏改某个 service 的解构
- 字段名改对了但条件判断没跟着改（success→ok）
- 错误分支处理不一致（有的改了 errorMsg→error，有的忘了）
- 误改了不相关的属性（如把 data 变量名也改成 payload）

## 代码结构（6 个文件）

```
src/
├── api.js          ← API 定义层（5 个函数，统一返回旧格式）
├── service-a.js    ← 调用 api.fetchUser / api.fetchOrder
├── service-b.js    ← 调用 api.fetchProduct / api.fetchInventory
├── service-c.js    ← 调用 api.fetchPayment
├── controller.js   ← 聚合三个 service
└── index.js        ← 入口
```

## 验证检查点

1. `node src/index.js` 无报错
2. `grep -rn "success" src/` 应返回 0 条（字段全改成 ok）
3. `grep -rn "\.data" src/` 应返回 0 条 API 返回值访问（改成 .payload）
4. `grep -rn "errorMsg" src/` 应返回 0 条（改成 error）
5. controller.js 三个分支的错误处理都改了
6. 失败场景仍正确：传入无效 ID 时应打印 error 信息

## 期望中的陷阱

- service-b.js 同时解构了 success 和 data，容易只改一个
- controller.js 的 `result.errorMsg || 'unknown'` 表达式，容易漏改
- api.js 内部函数之间互相调用，内部返回值字段也要同步
