# 安全策略

## 已知风险

sofagent 是纯本地治理层，**数据不出本机**——但以下数据以**明文 Markdown** 存储，请评估风险：

| 文件 | 位置 | 可能含 |
|------|------|------|
| `task/logs/` | `.sofagent/task/logs/YYYY-MM/YYYY-MM-DD.md` | 任务摘要、代码片段、API 响应摘要、对话摘要 |
| `think.md` | `.sofagent/think.md` | 反思记录，可能含踩坑细节、失败模式、决策推理 |
| `scoring/` | `.sofagent/scoring/` | Skill 使用记录 |
| `orchestrator/` | `.sofagent/orchestrator/` | 编排决策历史 |

**当前状态（v0.83+）**：
- ✅ 脱敏：sanitize() 管道扫描 API Key / 密码 / 手机号，写入前自动打码
- ✅ 数据保留：cleanup.sh 支持 --purge --before 定时清理 + tar.gz 归档
- ✅ 审计日志：task-record.sh 独立审计日志 + task/logs 追溯双通道
- ⚠️ 明文存储：`.sofagent/` 下文件仍为 Markdown 明文，未做加密
- ⚠️ **企业生产环境暂不建议使用**——数据明文存储 + LLM 自评无外部基准，GDPR / 等保 / SOC2 场景直接出局。age 加密计划于 v0.9
- `.sofagent/` 目录权限为 700（仅当前用户可访问），但同一服务器其他用户若有 root 权限可读

**企业环境建议**：
- 对 `.sofagent/` 目录做 gpg 加密或放在加密卷上
- 脱敏/保留/审计能力已在 v0.71 落地，详见 [企业部署指南](./docs/enterprise-deploy.md)

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

---

## 第三方依赖供应链

**agency-orchestrator (ao)** 是 sofagent 编排引擎的运行时依赖（npm 包 `agency-orchestrator@0.7.5`，Apache-2.0 许可）。install.sh 已将版本号 pin 到具体版本。

**降级路径**：
- `install.sh --no-ao` 可跳过 ao 安装——编排能力退化为手工拆解，约束层不受影响
- `task-orchestrate.sh` 在 ao 不可用时自动切到默认编排模式（v0.83+）

**供应链安全建议**：
- 每次 `npm install` 后运行 `npm audit`
- 定期检查 [agency-orchestrator 仓库](https://github.com/jnMetaCode/agency-orchestrator) 的 CHANGELOG
- 内网环境建议预装 ao 并验证 `ao compose --version` 通过后再部署
