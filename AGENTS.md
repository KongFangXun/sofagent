# AGENTS.md · sofagent Codex 适配（薄挂载）

> 本文件是 Codex CLI 的顶层指令挂载点（AGENTS.md 约定），**不含规范内容**——四层加载链的规范资产唯一来源是 sofagent 的 `SKILL/` 目录（单一真相源）。规则更新只发生在 SKILL/，本文件永不复制它们。
>
> 区分：`FORGE/SKILL/` 不是规范资产——它仅存放 FORGE 内部循环（fresh-eyes-loop、release-gate-loop）的技能定义，与根 `SKILL/` 规范目录同名但职责无关。

## 会话开始时按序加载（四层加载链）

一、读取已安装的 SKILL.md 作为系统约束（L1 硬约束）：

```
~/.sofagent/skills/sofagent/SKILL.md
```

（若用 `bash install.sh --platform codex` 安装，fde.md 已写入 `~/.codex/fde.md`。）

二、读取用户工作规则（L2）：`~/.codex/fde.md`（或 `~/.sofagent/skills/sofagent/fde.md`）

三、读取反思区（L3）：`~/.sofagent/skills/sofagent/think.md`

四、知识库（L4）：`~/.sofagent/skills/sofagent/knowledge/` 目录，按任务关键词检索加载。

## model_instructions_file（可选）

Codex 的 `model_instructions_file` 配置可直接指向 SKILL.md，让约束进系统层：

```toml
# ~/.codex/config.toml
model_instructions_file = "~/.sofagent/skills/sofagent/SKILL.md"
```

## 审计强制（平台无关）

约束是建议性的，审计是强制性的——提交前审计走 **git hook**（`sofagent-audit --install-hook`），与宿主平台无关：24 条 git diff 规则 + HMAC 链审计在 Codex 下同样生效。

## 连接 MCP Server

76 个 tool（`run_audit` / `worklog_query` / `snapshot_restore` / `fde_interview` 等）经 MCP 协议面暴露——适配器只依赖 @public API 子集，@internal 破坏性变更不影响本挂载。默认全量暴露，`SOFAGENT_MCP_ROLES` 显式收窄专职面。
