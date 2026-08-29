# @sofagent/rules

sofagent 规则引擎纯函数包——从 audit 包抽出，零 fs/git 依赖，供编排引擎 tool call 事前拦截。

## 安装

```bash
npm install @sofagent/rules
```

库包（无 CLI），随编排引擎引用。Node.js 18+。

## API

- `RulesEngine` — 规则引擎类，接受规则集 + tool call context，返回拦截裁决
- `defaultToolRules` — 默认规则集
- `InterceptVerdict` / `ToolCallContext` / `ToolRule` — 核心类型定义

## 文档

- [架构总览](../../docs/ARCHITECTURE.md) — rules 在约束层中的位置
- [使用手册（WIKI）](../../docs/WIKI.md) — 面向 FDE 的完整用法
