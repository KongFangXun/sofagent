# COMMUNITY.md · sofagent 社区

> v0.91 · 2026-06-24 · 孔放勋

## 📌 当前状态

👤 sofagent 是单人项目。所有代码由 DeepSeek V4 Pro 和 GLM-5.2 配合生成，作者做产品决策和终审。

**[![GitHub stars](https://img.shields.io/github/stars/KongFangXun/sofagent?style=flat)](https://github.com/KongFangXun/sofagent/stargazers)**
**[![GitHub contributors](https://img.shields.io/github/contributors/KongFangXun/sofagent?style=flat)](https://github.com/KongFangXun/sofagent/graphs/contributors)**

## 🪜 贡献者阶梯

| 级别 | 权限 | 条件 |
|------|------|------|
| **Contributor** | 提交 PR、参与 Issue 讨论 | 任意有效 PR 被合并 |
| **Triage** | 管理 Issue 标签、关闭重复/无效 Issue | 持续贡献 ≥ 3 个月 + 活跃参与 Issue 讨论 |
| **Co-maintainer** | 合并 PR、管理 Release、决策权 | 持续贡献 ≥ 6 个月 + 深入理解项目架构 + 作者邀请 |

> 🔴 如果你是 bash 方向的开发者，每周能投入 2-4 小时，直接开 Issue 说「我想做 Co-maintainer」——不用走正常流程，我们直接谈。

## 🎯 从哪开始

| 类型 | 说明 | 难度 |
|------|------|:--:|
| **跨平台测试** | 在 Windows/WSL/Linux 上跑 install.sh + verify.sh，报告结果 | ★ |
| **FAQ 补充** | HANDBOOK §六 常见问题需要更多真实场景的回答 | ★ |
| **文档翻译** | README 已有英文版，需要维护和更新 | ★★ |
| **安全审计** | 审查 install.sh / skill-safety-check.sh 的安全性 | ★★★ |
| **规则优化** | 改进 skill-safety-check.sh 的正则规则，减少误报 | ★★★ |

## 公开数据

| 指标 | 状态 | 需要什么 |
|------|:--:|------|
| 外部 contributor | 0 | 👋 你 |
| 跨平台实测数据 | OpenClaw 完整，其余 4 平台部分 | Windows/Hermes Agent 实测 |
| A/B 对照实验 | 设计完成，未执行（v0.92 计划） | 独立测试者 |
| 多语言文档 | 中英双语 README，HANDBOOK 仅中文 | 英文翻译 |

## 行为准则

我们就一条规矩：对事尖锐，对人客气。做不到？issue 见。

## 联系方式

- GitHub Issues：[KongFangXun/sofagent/issues](https://github.com/KongFangXun/sofagent/issues)
- ✍️ 作者：孔放勋
