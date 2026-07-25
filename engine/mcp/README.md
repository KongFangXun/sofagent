# @sofagent/mcp

> sofagent MCP Server —— 暴露审计能力给 MCP Client（JSON-RPC 2.0 over stdio）

独立进程，依赖 `@sofagent/audit`。可被 Claude Desktop / Cursor / Continue / 任何 MCP Client 调用。

---

## 安装

```bash
npm install -g @sofagent/mcp
```

或与 `@sofagent/audit` 一起安装（audit 包已内置 MCP Server）：

```bash
npm install -g @sofagent/audit
```

---

## 用法

```bash
# 直接启动 MCP Server
sofagent-mcp

# 或通过 audit 包的 --mcp 参数
sofagent-audit --mcp
```

MCP Server 通过 stdio 通信（JSON-RPC 2.0）。最小运行时依赖。

---

## MCP Client 配置

```json
{
  "mcpServers": {
    "sofagent": {
      "command": "npx",
      "args": ["-y", "@sofagent/audit", "--mcp"]
    }
  }
}
```

---

## 暴露的 Tools（3 个）

| Tool | 说明 |
|------|------|
| `run_audit` | 对 git diff 跑全量审计规则（A1-A11、A14-A19 + E1-E4，共 21 条），返回结构化报告 |
| `get_think` | 读取 think.md 最近 N 条反思条目 |
| `write_think` | 向 think.md 追加一条反思记录 |

> 注：A12/A13 已在 v0.99.4 合并入 A11（不滥资源），编号不再使用。

完整文档见主仓库：https://github.com/KongFangXun/sofagent

## License

MIT
