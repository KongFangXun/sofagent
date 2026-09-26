# engine/hooks · Git Hook 模块

```
engine/hooks/
└── sofagent-load-chain/   # Hook 加载链——git commit 前后自动触发 audit
    ├── handler.ts          # 主处理器
    ├── HOOK.md             # 用法说明
    ├── src/                # 源码
    └── dist/               # 编译产物
```

`sofagent-load-chain` 是 Hook 子模块，嵌套在 `hooks/` 下（而非作为 workspace 顶层包平级），因为它是 hook 机制的具体实现，同样发布到 npm（`@sofagent/load-chain`）。

其余 14 个 engine 顶层 workspace（`audit` / `core` / `orchestrator` / `daemon` / `mcp` / `train` / `inject` / `ontology` / `evolve` / `eval` / `ab-test` / `rules` / `think` / `umbrella`，实测口径 = 根 package.json 显式 engine 条目）为独立模块，与 `engine/hooks` 平级。
