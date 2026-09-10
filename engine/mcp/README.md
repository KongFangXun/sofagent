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

## 暴露的 Tools（95 个）

> 完整清单（按域分组 + 每工具说明）见 [docs/API.md](../../docs/API.md)——由 tool-registry.ts 生成，门禁对账永不漂移。

| Tool | 说明 |
|------|------|
| `run_audit` | 对 git diff 跑全量审计规则（A1-A11、A14-A23 + E1-E2/E4，共 24 条），返回结构化报告 |
| `get_think` | 读取 think.md 最近 N 条反思条目 |
| `write_think` | 向 think.md 追加一条反思记录 |
| `worklog_query` / `cost_query` / `fde_*` / `train_*` / `snapshot_*` / `ontology_*` / `pr_*` / `workflow_*` / `data_push` / … | 其余 92 个——审计/编排/后训/治理/成本/知识/PR 生命周期/workflow CRUD/数据推送各域，见 API.md 分域清单 |

> 注：A12/A13 已在 v0.99.4 合并入 A11（不滥资源），编号不再使用。

---

## 角色收窄（SOFAGENT_MCP_ROLES）

专职面部署形态——按角色过滤 tools/list 暴露面，两种配置形态：

```bash
# 形态一：环境变量（进程级）
SOFAGENT_MCP_ROLES=audit sofagent-mcp

# 形态二：JSON 配置（客户端级——mcpServers 条目内）
{ "command": "npx", "args": ["-y", "@sofagent/audit", "--mcp"], "env": { "SOFAGENT_MCP_ROLES": "audit" } }
```

多角色逗号分隔（如 `fde,audit`）；缺省 / `all` = 全量暴露。调用未暴露 tool 返回结构化错误（含恢复全量的配置提示）。

### audit 专职面（9 tools）

`SOFAGENT_MCP_ROLES=audit` 时的暴露清单（与 tool-registry `roles` 打标逐项一致——门禁断言防漂移）：

| Tool | 语义 |
|------|------|
| `run_audit` | 全量审计规则跑批（24 条规则 + HMAC 链） |
| `audit_file` | 单文件定点审计（不改链） |
| `search_knowledge` | 审计知识库检索（lessons/规则语料） |
| `read_lessons` | 经验教训条目读取 |
| `data_sovereignty_report` | 数据主权审计报告 |
| `audit_data_change` | 数据变更审计（表/行级追溯） |
| `notify_session` | 会话通知（审计事件面） |
| `list_rules` | 规则清单（24 条——名称/分级/启用态） |
| `audit_trail` | 审计链查询（HMAC 校验 + 时间窗过滤） |

完整文档见主仓库：https://github.com/KongFangXun/sofagent

## License

MIT
