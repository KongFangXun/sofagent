# @sofagent/rules

sofagent 规则引擎纯函数包——从 audit 包抽出，零 fs/git 依赖，供编排模块 tool call 事前拦截。

## 安装

```bash
npm install @sofagent/rules
```

库包（无 CLI），随编排模块引用。Node.js 18+。

## API

- `RulesEngine` — 规则引擎类，接受规则集 + tool call context，返回拦截裁决
- `defaultToolRules` — 默认规则集
- `InterceptVerdict` / `ToolCallContext` / `ToolRule` — 核心类型定义

## 文档

- [架构总览](../../docs/ARCHITECTURE.md) — rules 在约束层中的位置
- [使用手册（WIKI）](../../docs/WIKI.md) — 面向 FDE 的完整用法

## 判定规则只有一个事实源

本包是 **tool-level 触发时机的适配层**，不独立维护规则正则在跨引擎共用规则定义（A1 敏感文件 / A2 密钥泄漏 / A9 注入）上，与 git-diff 审计引擎（`engine/audit`）**共用 `@sofagent/core` 的同一套定义**（`shared/rule-definitions.ts` 的身份目录 + `shared/rule-patterns.ts` 的检测正则）——两处 `import` 同一来源，而非各写一份结构相同的定义。

> **纪律外延**：判定规则**只有一个事实源**。企业侧若另建判定点（自建模型网关 / 代理做流量侧 PII 过滤与敏感度分流），必须集成本引擎的同一套规则与检测器（经 v1.4.9 第八章检测器插槽嵌入组件），**不得另起一套**——每多一处独立实现，就是一次口径分裂风险。

> v1.5.2：网络出口治理面——host 白名单声明面（默认空全拒 opt-in）+ 裁决事件契约可导出（判定底座消费源）。
