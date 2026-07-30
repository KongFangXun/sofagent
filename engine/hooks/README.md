# engine/hooks · Git Hook 模块

```
engine/hooks/
└── sofagent-load-chain/   # Hook 加载链——git commit 前后自动触发 audit
    ├── handler.ts          # 主处理器
    ├── HOOK.md             # 用法说明
    ├── src/                # 源码
    └── dist/               # 编译产物
```

`sofagent-load-chain` 是 Hook 子模块，嵌套在 `hooks/` 下（而非作为 workspace 顶层包平级），因为它是 hook 机制的具体实现，不独立对外发布。

其他 12 个 workspace 包（`engine/audit`, `engine/core`, `engine/constraints` 等）为独立模块，与 `engine/hooks` 平级。
