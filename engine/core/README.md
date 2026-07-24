# @sofagent/core

sofagent 核心运行时基础设施——常量、原子写入、git diff 解析、配置加载、装后验证（doctor / verify）。v1.2.0 从 audit 包迁出，不含审计逻辑。

## API

- `VERSION` — 当前版本号常量
- `atomicWriteSync()` / `atomicAppendSync()` — 原子文件写入（防半写）
- 依赖关系：被 audit / daemon / orchestrator 等几乎所有包引用
