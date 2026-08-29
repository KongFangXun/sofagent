# @sofagent/core

sofagent 核心运行时基础设施——常量、原子写入、git diff 解析、配置加载、装后验证（doctor / verify）。v1.2.0 从 audit 包迁出，不含审计逻辑。

## 安装

```bash
npm install -g @sofagent/core
```

安装后获得 `sofagent-core` 命令（含 `verify` / `doctor` 子命令）。Node.js 18+。

## API

- `VERSION` — 当前版本号常量
- `atomicWriteSync()` / `atomicAppendSync()` — 原子文件写入（防半写）
- 依赖关系：被 audit / daemon / orchestrator 等几乎所有包引用

## 文档

- [架构总览](../../docs/ARCHITECTURE.md) — core 在约束层中的位置
- [使用手册（WIKI）](../../docs/WIKI.md) — 面向 FDE 的完整用法
- [贡献指南](../../CONTRIBUTING.md) — monorepo 单包开发流程
