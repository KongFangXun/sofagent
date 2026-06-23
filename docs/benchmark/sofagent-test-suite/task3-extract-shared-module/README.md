# Task 3: 提取公共模块（消除重复代码）

## 任务描述（给 Agent 的 prompt）

```
审查 src/ 目录下的代码，发现多个文件中重复实现的逻辑。

1. 创建 src/shared.js，把所有重复的工具函数提取到这里
2. 修改原有文件，删除重复代码，改为从 shared.js 引入
3. 代码行为必须完全不变
4. 注意：有些"看起来重复"的代码其实有细微差异，不要强行合并那些
5. 改完所有文件必须能正常运行
```

## 测试目标

压测 Agent 的**代码理解 + 去重判断**能力。裸 Agent 常见失败：
- 把不同实现的函数强行合并（如一个用正则验证邮箱、一个用长度验证，行为不同）
- 漏提取某个重复
- 改了引用但忘了删原文件里的死代码
- 提取后 export 名和原函数名不一致导致调用点报错

## 代码结构（6 个文件，故意埋重复）

```
src/
├── validator.js   ← 有 isEmpty, isEmail, isPhone（和 formatter.js 部分重复）
├── formatter.js   ← 有 isEmpty, formatPhone, formatDate（isEmpty 和 validator 重复）
├── auth.js        ← 有 isEmail（和 validator 重复但实现不同！）、hashPassword
├── repository.js  ← 有 formatDate（和 formatter 重复）
├── service.js     ← 引用以上所有
└── index.js       ← 入口
```

## 埋点说明（Agent 必须区分真重复和假重复）

| 函数名 | 出现位置 | 是否真重复 |
|--------|---------|-----------|
| isEmpty | validator.js, formatter.js | ✅ 真重复（实现相同） |
| isEmail | validator.js, auth.js | ❌ 假重复！validator 用正则，auth 用 includes('@') |
| formatDate | formatter.js, repository.js | ✅ 真重复 |
| isPhone | validator.js 独有 | 独有，不提取 |
| formatPhone | formatter.js 独有 | 独有 |

正确结果：shared.js 应包含 `isEmpty` 和 `formatDate` 两个函数。
**isEmail 不能合并**（实现不同，行为不同）。

## 验证检查点

1. `node src/index.js` 无报错
2. `src/shared.js` 存在，导出 `isEmpty` 和 `formatDate`
3. validator.js 和 formatter.js 的 `isEmpty` 已替换为 require shared
4. formatter.js 和 repository.js 的 `formatDate` 已替换为 require shared
5. auth.js 的 `isEmail` **保留不动**（它和 validator 的实现不同）
6. `grep -rn "function isEmpty" src/` 只出现在 shared.js
7. `grep -rn "function formatDate" src/` 只出现在 shared.js
