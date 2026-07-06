# Case 025：v0.99.8 外部用户 macOS 全链路验证（Atreides-coder / 小嘉）

> **定位**：v1.0 准入 #7 外部用户验证——真实外部用户在 macOS 上按测试计划走完 8/8 场景，含最详细的反馈表。

## 基本信息

| 项 | 值 |
|------|------|
| 测试人 | [Atreides-coder](https://github.com/Atreides-coder)（小嘉 🦞） |
| 角色 | AI 助手（电商团队，日常使用 git + 自动化脚本，10+ 次/周 commit） |
| 平台 | macOS Sequoia 15.6 (arm64) |
| 版本 | sofagent v0.99.8 |
| 日期 | 2026-07-06 |

## 测试结果：8/8 场景全部通过

| # | 场景 | 状态 | 关键结果 |
|:-:|:----|:----:|:---------|
| ① | 首次安装体验 | ✅ | install.sh + verify.sh 15 秒装完，46 项检查，零 error |
| ② | Secret 泄露检测 | ✅ | 3 种 secret 全部正确检出，0 误报 |
| ③ | daemon 自动监控 | ✅ | **发现 daemon 行为与文档不一致** |
| ④ | FDE 工具包 | ✅ | quick-start.md 2 分钟理解 |
| ⑤ | ao 编排 | ✅ | ao compose 拆出 5 个子任务 |
| ⑥ | MCP Server | ✅ | 3 个工具，JSON-RPC 2.0 规范兼容 |
| ⑦ | Skill 加载 | ✅ | 审计输出结构化（规则级判定 + exit code 三档） |
| ⑧ | npm 升级 | ✅ | 0.99.7→0.99.8 |

**综合评分**：8/10

## 最有价值的发现：daemon 行为与文档不一致

> **实测发现**：daemon 实际监控的是 `.sofagent/think.md` 和 `fde.md` 的**文件 hash 变化**，并非直接监听 git commit 或审计 secret。安装 pre-commit hook 后可以拦截含 secret 的提交，但 daemon 本身的审计覆盖范围与测试计划描述有差异。

**建议**：① 更新文档中 daemon 行为描述；② 考虑在 daemon 主循环中加入 `sofagent-audit --diff HEAD` 的定时触发能力。

## 完整反馈表

| 问题 | 回答 |
|------|------|
| 解决了实际问题吗？ | 是（审计引擎 + FDE 部署流程对有 AI 部署需求的团队有价值） |
| 最惊喜的？ | ① install 15s 丝滑 ② 审计正则精准 0 误报 ③ `--install-hook` 一键装 pre-commit |
| 最困惑的？ | ① daemon 行为与文档不符 ② pre-commit hook 路径硬编码 ③ ao 需配 API key |
| 会推荐给同事吗？ | 审计引擎可以推荐给团队开发者 |
| 最适合什么规模？ | 5-20 人 |
| v1.0 后会继续使用吗？ | hook 路径问题修复后会坚持使用 |

## 发现的问题

| 优先级 | 问题 | 状态 |
|--------|------|:----:|
| 🔴 P0 | pre-commit hook 硬编码 `node sofagent/audit/dist/index.js`，npm 全局装后找不到模块 | 待修复 |
| 🟡 P1 | daemon 行为与文档描述不一致 | 待修复（文档） |
| 🟡 P1 | ao compose 需配置 API key | 文档需说明 |

## 测试计划符合性

| 要求 | 结果 |
|------|:----:|
| macOS 或 Linux 平台 | ✅ macOS 15.6 |
| 真实外部用户 | ✅ |
| 核心场景 1-3 全做 | ✅ |
| ≥5 场景 | ✅ 8/8 |
| 反馈表 ≥80% 字段 | ✅ 最完整的反馈表 |

---
*原始报告：`sofagent-v1.0-外部用户验证测试计划(1).md`（Desktop 归档，含完整反馈表）*
