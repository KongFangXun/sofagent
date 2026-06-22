# sofagent v0.83 · 企业部署指南

# 企业级部署指南

> sofagent 在企业内网部署的配置说明。普通用户不需要看这份文档——默认安装就行。

## 离线部署

### 1. 跳过外部依赖安装

```bash
bash sofagent/scripts/install.sh --platform openclaw \
  --no-ao \
  --no-config-inject
# --no-ao              跳过 agency-orchestrator 全局安装
# --no-config-inject   跳过自动改 OpenClaw config.json
```

### 2. 离线模式（跳过 ClawHub API）

编辑 `~/.openclaw/rules.md`，取消 `offline: true` 的注释。
Agent 检测到后跳过 ClawHub 搜索，Skills 手动放入 `~/.openclaw/skills/` 目录。

### 3. 编排降级

没装 ao 时，task-orchestrate.sh 会提示降级方案：
- 手动拆任务
- 用 task-record.sh 逐条记录
- 手动闭环

## 数据安全

### 权限

install.sh 自动设置 `.sofagent/` 目录权限为 700（仅当前用户可访问）。
多用户服务器场景下，其他用户无法读取你的任务记录。

### 明文存储提醒

task/logs 和 think.md 以明文 Markdown 存储，可能含代码片段和对话摘要。
如需更高安全级别，考虑对 .sofagent/ 目录做 gpg 加密或放在加密卷上。

## 合规检查清单

| 检查项 | 状态 | 说明 |
|------|:--:|------|
| 数据存储位置 | ✅ 本地 | 不上云，不调外部 API（离线模式） |
| 数据加密 | ✅ 已完成 | v0.71 落地 sanitize() 脱敏管道，支持 API Key / 密码 / 手机号扫描 |
| 权限控制 | ✅ 700 | install.sh 自动设置 |
| 数据保留策略 | ✅ 已完成 | v0.71 落地 cleanup.sh 自动清理，支持 --purge --before |
| 审计日志 | ✅ 已完成 | v0.71 落地 task-record.sh 独立审计日志 + task/logs 追溯双通道 |
| 外部 API 调用 | ✅ 可关闭 | 离线模式跳过 ClawHub |
| 配置文件修改 | ✅ 可控 | --no-config-inject 跳过 |

## 已落地（v0.73+）

以下能力原为 v0.7x 规划，已在 v0.71 版本落地：
- task/logs 脱敏（sanitize() 扫描 API Key/密码/手机号）
- 数据保留策略（cleanup.sh --purge --before 命令）
- 独立审计日志（task-record.sh 双通道）

> think.md gpg 加密自动化仍待规划。

详见 [ROADMAP.md](../ROADMAP.md)。
