# trimMessagesSafe 作用域审计结论（第七章·三）

> 审计对象：`FORGE/src/fresh-eyes-driver.mjs` 与 `FORGE/src/release-gate-driver.mjs` 中的消息裁剪函数 `trimMessagesSafe`（两份同构实现，F-4 修复复制）。审计目标：确认裁剪函数无跨闭包引用（run-12 effectiveHardLimit 同族风险）。

## 一、审计方法

逐文件静态审查三个维度：① 函数自身的自由变量（引用了定义域之外的东西吗）；② 函数的调用点分布在哪些闭包层级；③ 同族风险变量（effectiveSoftLimit/effectiveHardLimit/TOOL_SOFT_LIMIT/TOOL_HARD_LIMIT）的定义位置与可见性。

## 二、审计发现

### trimMessagesSafe 自身：纯函数，零自由变量

两份实现完全同构，函数体只依赖两样东西：

- 形参 `messages` / `keepCount`
- 局部变量（`recent` / `aiToolCallIds` / `toolMsgIds` / `cleaned`）

不引用任何外层闭包变量、不读全局状态、不写共享状态。**是纯函数，不存在跨闭包引用风险。**

### 调用点：全部在函数定义之后的同层或内层闭包

| 文件 | 调用点 | 闭包层级 |
|------|--------|---------|
| fresh-eyes-driver.mjs | L1283/L1300/L1308/L1321（stateModifier 内 trimmed 逻辑）| worker 内层闭包，定义于 L1170 |
| release-gate-driver.mjs | L1172/L1212（buildStateModifier 的 trimmed + preModelHook）| 同层闭包，定义于 L1074 |

所有调用点都在函数定义之后、同一 worker 作用域内——不存在「定义时引用了稍后才初始化的外层变量」的 TDZ 风险。

### 同族风险变量：run-12 坑已修复，模式正确

run-12 事故（effectiveHardLimit 跨闭包不可见导致 ReferenceError）的修复方式是把变量提到 worker 函数顶部、agent 定义之前（fresh-eyes-driver.mjs L1250-1253 注释明载）。本次审计确认：

- `effectiveSoftLimit` / `effectiveHardLimit` 在两个 driver 中均定义于 worker 顶部（L1252-1253）
- stateModifier / streamHandler / preModelHook 三个内层闭包引用的都是这对提前定义的变量
- `TOOL_SOFT_LIMIT` / `TOOL_HARD_LIMIT` 为模块级常量，天然全作用域可见

## 三、结论

**trimMessagesSafe 无跨闭包引用风险，无需加固。** 该函数是纯函数（无自由变量），调用点全部位于定义后的同层闭包；同族的 run-12 坑（effectiveHardLimit）已按「变量提共同作用域」模式修复且当前代码保持正确。release-gate 侧为 F-4 修复时的同构复制，两份实现语义一致，各自的独立性（不共享可变状态）正是所要的隔离性。

唯一的设计债（记录不行动）：两份同构实现存在复制漂移的可能——若未来改动其一，需同步另一份。这属于 FORGE 内部循环代码（不入 engine/ 发布面），复制即文档（F-4 注释已互相引用），维持现状。
