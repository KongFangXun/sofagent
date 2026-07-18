# MCP Server 拆分设计（归档）

> v0.99.1 设计稿。MCP Server 从 @sofagent/audit 拆分为独立包 @sofagent/mcp。
> 拆分已完成（v0.99.1 起生效），本文件保留设计决策供回溯。

---

## 核心发现

MCP Server 传递依赖了整个审计引擎（parseDiff → checkLogs → runRules 全链路，20+ 源文件）。不是「薄包装层」——拆分策略基于「MCP 作为 audit 的消费者」。

## 方案：npm workspaces + MCP 依赖 Audit

```
@sofagent/mcp  ──依赖──→  @sofagent/audit
```

- 根 `package.json` 配置 `workspaces: ["sofagent/audit", "sofagent/mcp"]`
- MCP 包 `dependencies: { "@sofagent/audit": "workspace:*" }`
- `workspace:*` 在 `npm publish` 时自动替换为实际版本号
- 零代码重复——audit 增强公共 API 导出（`public-api.ts` barrel export）

**为什么不选其他方案**：复制代码（20+ 文件维护灾难）/ 共享类型包（过度抽象）/ 独立 package.json 无 workspace（需手动 npm link）。

## 关键决策

| 决策 | 方案 | 理由 |
|------|------|------|
| 共享代码 | npm workspace + 依赖 | 避免代码重复，类型安全 |
| `--mcp` 标志 | 改为打印引导信息 | 最小 breaking change |
| 公共 API 入口 | `public-api.ts` barrel export | 集中管理外部可见 API |
| workspace 协议 | `workspace:*` | publish 自动替换版本号 |

## 依赖面

```
@sofagent/mcp/src/mcp-server.ts
  └─import from "@sofagent/audit"
      ├── parseDiff()        ← diff-parser.ts
      ├── checkLogs()        ← log-checker.ts → log-reader.ts
      ├── runRules()         ← reporter.ts → rules/ → rules/types.ts
      ├── loadConfig()       ← config-loader.ts
      ├── generateThinkEntry() ← think-generator.ts
      └── loadHistory()      ← audit-history.ts
```

MCP 包自身零代码重复，零第三方运行时依赖。

## 发布顺序

先 @sofagent/audit（mcp 依赖它），后 @sofagent/mcp。
