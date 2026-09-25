# @sofagent/dsh-plugin-kit

DSH 适配层基座——把 9 个 `cordis-plugin-sofagent-*` 的样板（pluginMeta / 懒加载 invoke / apply 三段式）收成一次 `createSofagentPlugin()` 调用。适配层红线（不 import 宿主类型 / 缺席降级不抛 / 桥接懒加载）见 `src/index.ts` 头注，seam 契约见 `../SEAMS.md`。

## invoke 签名：位置参数透传

`invoke(...args)` 把位置参数**逐位原样透传**给桥接包的 `@public` API——不重组、不命名、不包装。第 n 个入参落在目标函数第 n 个形参：

```js
// 桥接 @sofagent/audit.runRules 时（位置签名逐位对齐）
await invoke(diffFiles, logEntries, task, strict, silent, commitMsg, config, ...)
//   ≡ runRules(diffFiles, logEntries, task, strict, silent, commitMsg, config, ...)
```

多包桥接（`bridges`）按声明序解析，调用**第一个可用**包（同款位置透传）；全部不可用才 `throw`（错误含逐包原因），部分可用即部分成功（仅降级日志）。
