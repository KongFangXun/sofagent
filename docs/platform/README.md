# 平台知识库（fork 内部）

各 Agent 平台的环境、目录结构、hook/日志机制等**实地勘察**记录，供跨平台移植与评测设计参考。
区别于 `docs/platform-matrix.md`（能力对照表）——本目录是**每个平台的深度细节**。

> fork 产品线记录，不向上游提 PR。

## 目录

| 平台 | 内容 |
|------|------|
| [workbuddy/](workbuddy/) | 目录结构、Skill 部署位置、**audit-log 审计日志 schema**（A/B 评测的机械层尺子） |
| [windows/](windows/) | 原生 Windows 环境（PowerShell 5.1）、编码/换行、.ps1 移植；**安装/使用指南见 [windows/install.md](windows/install.md)** |
| [openclaw/](openclaw/) | 目录结构、内部 hook（agent:bootstrap）、日志、断路器配置 |

## 速查：sofagent 在各平台的部署位置

| 平台 | Skill | rules.md | 脚本 | 数据 |
|------|-------|----------|------|------|
| WorkBuddy | `~/.workbuddy/skills/sofagent/` | `~/.workbuddy/rules.md` | `~/.workbuddy/scripts/`（.ps1，Windows） | `{项目}/.sofagent/` |
| OpenClaw | `~/.openclaw/skills/sofagent/` | `~/.openclaw/skills/sofagent/rules.md` | `~/.openclaw/scripts/` | `{PWD}/.sofagent/` |
