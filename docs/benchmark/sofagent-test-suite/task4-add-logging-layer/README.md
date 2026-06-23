# Task 4: 统一日志层注入（横切关注点）

## 任务描述（给 Agent 的 prompt）

```
给 src/ 下所有模块的关键函数统一添加日志。

要求：
1. 使用 src/logger.js 提供的 logger（已存在，不要改它）
2. 每个函数入口添加 logger.info(`调用 函数名，参数: ...`)
3. 每个函数正常返回前添加 logger.info(`完成 函数名，结果: ...`)
4. 每个 catch / 错误分支添加 logger.error(`失败 函数名，原因: ...`)
5. 日志格式在所有文件中保持一致
6. 不要改变任何业务逻辑
7. 每个 .js 文件顶部 require logger
8. 改完代码必须能正常运行
```

## 测试目标

压测 Agent 的**横切关注点一致性注入**能力——这是最考验纪律性的任务。
裸 Agent 常见失败：
- 有的文件加了日志，有的忘了
- 入口日志加了，出口日志忘了
- 错误分支有的加了 logger.error，有的没加
- 日志格式不统一（有的用中文，有的用英文，有的参数序列化方式不同）
- 误改了 logger.js 本身
- 漏掉了某些函数（尤其是辅助函数）

## 代码结构（6 个文件）

```
src/
├── logger.js      ← 日志工具（不要修改！）
├── db.js          ← 数据库操作（4 个函数）
├── http.js        ← HTTP 请求封装（3 个函数）
├── cache.js       ← 缓存层（3 个函数）
├── queue.js       ← 队列处理（2 个函数）
└── index.js       ← 入口（聚合调用）
```

共 12+ 个需要注入日志的函数。

## 验证检查点

1. `node src/index.js` 无报错
2. logger.js 内容**完全未变**（diff 为空）
3. 每个 .js 文件顶部都有 `require('./logger')`
4. `grep -c "logger.info" src/db.js` ≥ 4（至少 4 个函数入口）
5. `grep -c "logger.error" src/` 总数 ≥ 5（5 个文件都有错误处理）
6. 日志格式统一：都用 `` `调用 ${funcName}...` `` 中文模板
7. 没有任何 console.log 被改成 logger（只加不改）
8. 所有原有逻辑的返回值不变

## 期望中的陷阱

- queue.js 的 `processQueue` 是递归函数，日志不能破坏递归逻辑
- cache.js 的 `getCached` 有 try-catch，两个分支都要加日志
- http.js 的 `requestWithRetry` 有重试循环，日志应反映每次尝试
- index.js 虽然是入口但也调用了其他模块，要不要加日志？Agent 需要判断
