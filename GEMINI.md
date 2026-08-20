# GEMINI.md · sofagent Gemini CLI 适配（薄挂载）

> 本文件是 Gemini CLI 的分层上下文挂载点（GEMINI.md 约定），**不含规范内容**——四层加载链的规范资产唯一来源是 sofagent 的 `SKILL/` 目录（单一真相源）。规则更新只发生在 SKILL/，本文件永不复制它们。

## 会话开始时按序加载（四层加载链）

一、读取已安装的 SKILL.md 作为系统提示词（L1 硬约束——Gemini CLI 将本文件与引用内容一并注入系统上下文）：

```
~/.sofagent/skills/sofagent/SKILL.md
```

（若用 `bash install.sh --platform gemini` 安装，则为 `~/.gemini/skills/sofagent/SKILL.md`。）

二、读取用户工作规则（L2）：`~/.sofagent/skills/sofagent/fde.md`

三、读取反思区（L3）：`~/.sofagent/skills/sofagent/think.md`

四、知识库（L4）：`~/.sofagent/skills/sofagent/knowledge/` 目录，按任务关键词检索加载。

## 审计强制（平台无关）

约束是建议性的，审计是强制性的——提交前审计走 **git hook**（`sofagent-audit --install-hook`），与宿主平台无关：24 条 git diff 规则 + HMAC 链审计在 Gemini CLI 下同样生效。

## 连接 MCP Server

Gemini CLI 的 MCP 配置（`settings.json`）指向 sofagent MCP Server（stdio）：

```json
{ "mcpServers": { "sofagent": { "command": "sofagent-mcp" } } }
```

61 个 tool（`run_audit` / `worklog_query` / `snapshot_restore` 等）经 MCP 协议面暴露——适配器只依赖 @public API 子集，@internal 破坏性变更不影响本挂载。
