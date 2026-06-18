# 安全策略

## 已知风险

sofagent 是纯本地治理层，**数据不出本机**——但以下数据以**明文 Markdown** 存储，请评估风险：

| 文件 | 位置 | 可能含 |
|------|------|------|
| `task/logs/` | `.sofagent/task/logs/YYYY-MM/YYYY-MM-DD.md` | 任务摘要、代码片段、API 响应摘要、对话摘要 |
| `think.md` | `.sofagent/think.md` | 反思记录，可能含踩坑细节、失败模式、决策推理 |
| `scoring/` | `.sofagent/scoring/` | Skill 使用记录 |
| `orchestrator/` | `.sofagent/orchestrator/` | 编排决策历史 |

**当前状态**：
- 无加密、无脱敏、无数据保留策略
- LLM 提炼反思时可能无意写入敏感信息（API Key、密码、手机号等）
- `.sofagent/` 目录权限为 700（仅当前用户可访问），但同一服务器其他用户若有 root 权限可读

**企业环境建议**：
- 对 `.sofagent/` 目录做 gpg 加密或放在加密卷上
- 等待 v0.7x 的 `task/logs` 脱敏 + 数据保留策略（`--purge` 命令）
- 详见 [企业部署指南](./docs/enterprise-deploy.md)

## 报告漏洞

如果你发现安全问题（不是普通 Bug），请通过以下方式私密报告：

- **邮件**：kong.yao@evfrey.com
- **GitHub 私密 Issue**：[新建 Issue](https://github.com/KongFangXun/sofagent/issues) 时选 "Security" 标签

**请不要在公开 Issue 中披露安全漏洞细节。**

## 响应承诺

- **确认**：7 天内确认收到报告
- **初步评估**：30 天内给出初步评估和影响范围
- **修复**：根据严重程度排期——高危（数据泄露/权限提升）优先修复并发布补丁版本

## 适用范围

本安全策略适用于 sofagent 项目仓库内的所有文件。第三方依赖（如 agency-orchestrator、OpenClaw）的安全问题请向对应项目报告。
