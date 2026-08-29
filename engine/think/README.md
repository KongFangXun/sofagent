# @sofagent/think

sofagent 思考链分析——推理路径追踪、决策可视化、思维审计。基于 git diff 硬证据自动生成反思条目。

## 安装

```bash
npm install -g @sofagent/think
```

安装后获得 `sofagent-think` 命令。Node.js 18+。

## API

- `generateThinkEntry()` — 从 git diff 生成反思摘要（≤200 字），写入 think.md 反思区
- 类型：`ThinkEntryOptions`
- 依赖关系：`@sofagent/core`

## 文档

- [架构总览](../../docs/ARCHITECTURE.md) — think 在约束层中的位置
- [使用手册（WIKI）](../../docs/WIKI.md) — 面向 FDE 的完整用法
