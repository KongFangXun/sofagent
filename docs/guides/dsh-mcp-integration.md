# DSH MCP 互通指南——在 DeepSeek Harness 中使用 sofagent

> v1.5.2 · 2026-09-24（UTC）· ✅ 已发版 · 孔放勋 · MCP 互通自 v1.3.5 起支持。

sofagent 本身就是一个 MCP server（stdio 传输，bin `sofagent-mcp`，工具数以 `engine/mcp/src/tool-registry.ts` 为准——工具角色分层，默认全量暴露，`SOFAGENT_MCP_ROLES` 显式收窄专职面；各版增量见 [CHANGELOG](../../CHANGELOG.md) 与 [API 工具清单](../API.md)）。

DSH（DeepSeek Harness）有两条接入路径：① **本文档**——用官方 `@deepseek-ai/dsh-mcp-client` 桥接插件挂上 `sofagent-mcp`；② v1.4.0 起 DSH 原生 cordis-plugin（`engine/dsh-plugins/`，逐工具调用可拦，见 [README · 多平台挂载](../../README.md)）。走 ① 即可在 DSH 会话里调用 sofagent 的全部能力：审计查询、知识库检索、A/B 实验（`run_ab_test`）、快照时间线（`snapshot_list`）等。

## 配置方法

在 DSH 的 `cordis.yml`（插件挂载配置，通常在 `~/.dsh/` 或 profile 目录下）加一条 mcp-client 条目，stdio 传输直连 sofagent-mcp：

```yaml
- id: mcp-sofagent
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: sofagent
    transport: stdio
    command: npx
    args: ['-y', '@sofagent/mcp']
    env: {}                      # 可选：注入 SOFAGENT_HOME 等环境变量
    toolCallTimeoutMs: 120000    # 可选：run_ab_test 等长任务建议放宽（默认 60000）
```

> 字段名以 `@deepseek-ai/dsh-mcp-client@0.1.0-rc.6`（2026-08-15 npm 实测拉包核对 `lib/types/index.d.ts` 的 `StdioConfig`）为准——`transport` / `serverName` / `command` / `args` / `env` / `cwd` / `toolCallTimeoutMs` / `failOnStartupError` / `reconnect`。DSH 尚处 developer preview（rc），后续版本字段可能变化，以 [DSH 官方仓库](https://github.com/deepseek-ai/deepseek-harness) config 文档为最终依据。

挂载后 DSH 侧的模型看到的 tool 名形如 `mcp__sofagent__snapshot_list`（`mcp__<serverName>__<原始名>` 命名契约——与 Claude Code / Codex 同款），全部 tool 可见，与 DSH 原生 tool 走完全相同的执行管道（权限策略、timeout、compaction 行为一致）。

**两种 command 写法按部署形态选**：

| 部署形态 | command / args | 说明 |
|---------|---------------|------|
| npm 安装（v1.3.5 发版后） | `npx -y @sofagent/mcp` | 最简——首次会拉包，需能访问 npm registry；`@sofagent/mcp@^1.3.5` 起 bin 为 `sofagent-mcp` |
| monorepo 本地 / 内网 | `node /path/to/sofagent/engine/mcp/dist/mcp-server.js` | 开发/内网环境——dist 需先 `npm run build`（workspace 根目录执行）；也可 `npm i -g /path/to/engine/mcp` 后 command 直接写 `sofagent-mcp` |

> ⚠️ **command 必须是 `node`，`.js` 路径放 args**——本地 dist 直用场景若把 command 写成 `.js` 文件路径，部分客户端（如 MCP Inspector）会 `spawn EACCES`（dist 文件无 +x 位；npm 安装的 bin 由 npm 自动加执行位，无此问题）。冒烟实测：`command: node` + `args: [<dist路径>]` 稳定通过。

## 安全边界（🔴 必读）

互通只是新通道，不是新权限模型——sofagent 的安全语义在 DSH 通道下**完全不降级**：

- **破坏性 tool 强制人审**：`promote_ab`（A/B 晋升）和 `snapshot_restore`（快照恢复）要求显式 `human_confirmed: true` 参数——不确认就只返回决策依据挂起，绝不执行。DSH 的模型绕过这道门会被审计链捕获（语义在 sofagent 服务端实现，与调用方无关）
- **只读 tool 即开即用**：`snapshot_list` / `run_audit` / `search_knowledge` 等查询类无副作用
- **进程控制不开放**：daemon start/stop 类操作不暴露为 MCP tool（changelog 安全边界第 2 条）

## 验证状态

> ⚠️ **本节配置示例的验证口径**：字段结构已对照 `@deepseek-ai/dsh-mcp-client@0.1.0-rc.6` 的类型定义与官方 README 核对（2026-08-15），但**尚未经 DSH 真实连接端到端验证**——DSH 本体处于 developer preview（rc），安装面与 profile 结构仍在变动。验证口径：以 MCP Inspector（`npx @modelcontextprotocol/inspector`）做 stdio 通道等价冒烟（工具可见 + 只读 tool 调用 + 破坏性 tool 未确认时挂起）；DSH 直连验证待 DSH 正式版后补做。若你基于本节配置实操遇到字段不匹配，请以 DSH 报错信息与官方文档为准并[提 issue](https://github.com/KongFangXun/sofagent/issues)反馈。

---
