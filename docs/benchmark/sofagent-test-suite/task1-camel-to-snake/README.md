# Task 1: camelCase → snake_case 函数名重命名

## 任务描述（给 Agent 的 prompt）

```
把 src/ 目录下所有 .js 文件里的【函数定义名】和【所有调用点】从 camelCase 改成 snake_case。
只改函数名，不改变量名、属性名、文件名。
改完后所有 require / 调用链必须保持一致，代码必须仍然可运行。
```

## 测试目标

压测 Agent 的**跨文件符号一致性**能力。裸 Agent 常见的失败模式：
- 只改定义文件，漏掉跨文件调用点
- 改了一半，剩下几个调用点报 ReferenceError
- 把不该改的（变量名、对象属性）也改了
- export 名和 require 解构名不匹配

## 代码结构（6 个文件，互相依赖）

```
src/
├── utils.js      ← 工具函数定义（被所有人引用）
├── user.js       ← 引用 utils
├── order.js      ← 引用 utils + user
├── customer.js   ← 引用 user（间接依赖 utils）
├── report.js     ← 引用 order + customer
└── index.js      ← 入口，聚合所有模块
```

依赖链深度 3 层：`index → report → order → user → utils`。
部分函数被 3+ 个文件引用，改一处必须同步 N 处。

## 验证检查点

1. `node src/index.js` 能无报错执行（最基本）
2. `grep -rn "camelCase"` src/ 应返回 0 个函数名（变量/属性可保留）
3. 用正则 `function\s+[a-z]+[A-Z]` 检查无残留驼峰函数定义
4. 重点抽查：`getUserInfo` 应变成 `get_user_info`，且 utils/user/customer/report/index 五处全改
5. 不应改动：`fileName`、`userId` 等变量名；`obj.getData` 等属性访问

## 期望中的陷阱

- `customer.js` 里 `formatDate` 被赋值给变量后间接调用，容易漏
- `report.js` 同时 require 了 order 和 customer，两边的函数都要改
- `index.js` 解构 import 时用的别名，Agent 可能只改一边
