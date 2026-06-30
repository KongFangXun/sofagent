# 路线图 · Roadmap

> 已经做了什么、未来要去哪、哪些地方需要你的帮助。
> v0.99 · 2026-07-01 · v1.0 前收尾版——不进新功能，只做 bugfix + 文档终审 + 审查修复。
>
> **先跑通 FDE 部署闭环，再谈其他。**
>
> 🎯 **v1.0 定位**：**FDE 部署底座**——帮 FDE 快速梳理企业 workflow → 定义 AI 节点 → 部署到任意设备 → 审计结果自动推送到协作平台。

---

## 🔴 放弃条件

> 不是悲观——是诚实。一个知道什么时候该停的项目，比一个永远在「下个版本」的项目更值得信赖。

| # | 触发条件 | 判定时机 | 处置 |
|:--:|------|:--:|------|
| 1 | **纪律层实验第三次失败** | v0.98 发布时 | 砍掉纪律层叙事，只保留审计工具 |
| 2 | **审计工具推出后 3 个月，推广 20 人，0 安装** | v1.0 后 3 个月 | archive 仓库，写事后总结 |
| 3 | **v1.0 截止 2026-09-30，准入达标率 < 3/9** | 2026-09-30 | 诚实降级为「审计工具技术预览版」 |
| 4 | **OpenClaw 架构变更，hook 兼容丢失，3 月无迁移路径** | 变更时 | 只保留审计工具 |
| 5 | **作者 30 天无 commit，无 Co-maintainer 接手** | 连续 30 天 | archive，「不再维护」 |

> **「放弃」不是失败的标签——是诚实的工程决策。** 触发后公开写事后总结，文档保持原样。

---

## 现在在哪：v0.99

> v0.99 是 **v1.0 前收尾版**——不进新功能，只做 bugfix、文档终审、准入条件核查。

| 级别 | 交付 | 状态 |
|------|------|:----:|
| P0 | 文档信任修复（entry-gate / SECURITY / DEVELOPMENT ≤90行 / README 格式） | ✅ |
| P0 | 放弃条件正式写入 ROADMAP | ✅ |
| P0 | v1.0 准入条件 9 条核查（含截止日期 2026-09-30） | ✅ |
| P0 | Skill 全部 ≤90 行 | ✅ |
| P1 | docs/evidence/ 死链清零 + 中英文 README 对齐 + 成熟度声明 | ✅ |
| P1 | 内容去重 + bus factor + 模型依赖声明 + GitHub Action 模板 | ✅ |
| P2 | preferences.md 删除 + ARCHITECTURE 引用密度减半 + check-docs.sh | ✅ |

> 📖 [详细开发日志](./docs/changelog/v0.99.md)

---

## 迭代历程

> 倒叙排列，每个版本有独立开发日志。

| 版本 | 核心交付 | 日志 |
|------|------|:--:|
| **v0.97** | 审计 A9/A10/A11 + 编排引擎重构（砍四级深度→两档拆解 + engage.md）+ bash→TS 第二波 + 概念精简 | [📖](./docs/changelog/v0.97.md) |
| **v0.96** | README 六段式重构（373→166行）+ bash→TS 第一波 + 铁律重排 + 编排定位澄清 | [📖](./docs/changelog/v0.96.md) |
| **v0.95** | 铁律精简 10→6（4 条移审计层）+ 目录改名 + 三源收敛 + FDE 商业模式 | [📖](./docs/changelog/v0.95.md) |
| **v0.94** | 6 项代码止血 + --silent 模式 + LogFormat 可插拔 + FDE Skill 部署者优先 | [📖](./docs/changelog/v0.94.md) |
| **v0.93** | 4 项 FP 修复 + bash→TS 迁移 + 27 cases FP=0% FN=0% + 10 组对照实验 | [📖](./docs/changelog/v0.93.md) |
| **v0.92** | 安全加固 + 信任模型声明 + 审计 A7 检测加固 + 工程欠债清算 + OpenClaw 对照实验 | [📖](./docs/changelog/v0.92.md) |
| **v0.91** | sofagent-audit MVP + ARCHITECTURE 瘦身（710→378行）+ COMMUNITY.md | [📖](./docs/changelog/v0.91.md) |
| **v0.86** | 读写型分流 + Loop 成熟度四问 + 19 项学习笔记约束 + 8 项评审反馈 | [📖](./docs/changelog/v0.86.md) |
| **v0.85** | 定位校准（「治理」→「纪律」）+ ROADMAP 砍削 + 45 组验证实验设计 + sofagent-audit 方向确立 | [📖](./docs/changelog/v0.85.md) |
| **v0.82** | 五平台实测 + 步数闸/熔断闸/幂等检查/评判器隔离在非 OpenClaw 平台均不生效确认 | [📖](./docs/changelog/v0.82.md) |
| **v0.81** | daemon 核心骨架 + 5 项治理加固 + macOS launchd + Linux systemd | [📖](./docs/changelog/v0.81.md) |
| **v0.75** | 降低试用门槛 + benchmark.sh + 英文 README + Co-maintainer 招募 | [📖](./docs/changelog/v0.75.md) |
| **v0.74** | 文档拆分去重 + verify.sh --quick + Scoring 基准线 | [📖](./docs/changelog/v0.74.md) |
| **v0.73** | 三道闸门体系 + 编排加固 + 记忆最小闭环 + scoring 第九维 | [📖](./docs/changelog/v0.73.md) |
| **v0.72** | README 平台能力表重构 + benchmark.sh + anti-cases | [📖](./docs/changelog/v0.72.md) |
| **v0.7x** | 企业合规：数据保留 + task/logs 脱敏 + 审计日志 | — |
| **v0.6x** | 质量加固：端到端测试 + 闭环验证 + WorkBuddy 专家团共存 | — |
| **v0.5x** | 企业级能力：install.sh/uninstall.sh + 离线模式 + 编排 fallback | — |
| **v0.1~v0.4** | 治理核心：4 底线 + 6 铁律 + Loop Agent + 三层闸门 + 渐进减薄 + 反思区 + scoring | — |

---

## 未来去哪

> 以下是**方向**，不是承诺。没实测过的事标「不知道」。

**终局**：FDE 用 Agent 对话 → sofagent 引导梳理 workflow → OpenClaw 执行 AI 节点 → 审计结果推送到协作平台。

两条路径：**FDE 驻场部署**（传统中小企业，FDE 进场→十步流程→交付→撤离）和 **开发者自部署**（开源社区，git clone→install.sh→审计→CI 集成）。

设备端形态：安装时自动带 OpenClaw，审计结果通过 MCP server 推到企业协同平台。**数据主权在设备**——所有记忆、日志、决策记录永不离开本地。

### v0.98-v0.99：架构重组 + v1.0 前收尾

**v0.98**：产品架构重组（lite 删除 + think.md 自动生成 + FDE 从 Skill 改为根目录文档）+ OpenClaw 重定义为必装引擎 + 审计闭环六步 + GitHub Action 模板 + install.sh 模块化
**v0.99**：两份独立审查全面修复 + Skill 全部 ≤90 行 + 文档预算 4849≤5000 + 放弃条件引入 + bus factor 声明 + GitHub Action 模板 + MCP Server 实现 + verify.sh → TS 重构（sofagent-verify 第 6 个 bin）。FDE 端到端验证推迟 v1.0。

### v1.0 — 正式版：FDE 部署底座

三条主线：
1. FDE 引导逻辑 → 自动产出 workflow.yaml + 部署方案书
2. 部署方案装到任意设备 → OpenClaw 跑 workflow AI 节点
3. 审计结果通过 MCP webhook 推送到协作平台

| # | v1.0 准入条件 | 状态 |
|:--:|------|------|
| 1 | 纪律层增量在反转实验中被证实 | ❌ 实验缺陷，诚实调低定位 |
| 2 | 审计工具实现完整六步闭环 | ⏳ 需端到端验证 |
| 3 | 纪律层上下文成本 ≤ 窗口 5% | ✅ ~2.5% |
| 4 | OpenClaw + AO compose 全链路跑通 | ⏳ 未端到端验证 |
| 5 | MCP server + webhook 跑通 | ⏳ MCP Server 已实现（v0.99），webhook 推送待端到端验证 |
| 6 | daemon 稳定运行 ≥ 30 天 | 🔴 价值重评估 |
| 7 | ≥ 1 外部用户 + 5 个一次性测试 | ❌ 0 外部用户 |
| 8 | install → verify → 首次任务通过率 ≥ 90% | ⏳ 未测 |
| 9 | 能力矩阵五平台实测 | ⏳ 部分完成 |

**硬性截止日期**：2026-09-30。如果 #6/#7 不达标 → v1.0 降为「审计工具技术预览版」。

### v1.x — 发布后

| 想法 | 说明 |
|------|------|
| **Skill 自进化闭环** | 部署→运行→检查→进化 四步闭环 |
| 质量抽检仪表盘 | 抽检合格率、skillopt 迭代记录可视化 |
| age 加密 / 多用户隔离 | think.md + task/logs 加密；同机权限隔离 |
| 多企业平台 webhook | 飞书 + 企微 + 自定义 webhook |
| 记忆架构升级 | Ledger-Views-Policy 三层模型 |
| Windows 支持 | PowerShell 平行实现（待需求验证） |
| 分布式反思同步 | Gossip 协议 + 信任加权投票 |

### v2.x — 多设备协同（规划中）

四阶段渐进：协同编排协议（Markdown 优先）→ Agent 发现与注册 → 跨设备任务分发 → 企业 Agent 知识库（多设备蒸馏记忆聚合到企业自有 NAS/云盘，底层用 [Graphify](https://github.com/safishamsi/graphify) 轻量知识图谱）

**演化路径**：

| 阶段 | 形态 | 对应版本 |
|------|------|:--:|
| Ralph 循环（真菌） | 状态外化到文件，Agent 本体无状态 | v0.x-v1.x |
| Ralph 工厂 | 自治循环进化产品 | v2.x 规划 |
| 无身份 Agent（细菌） | 用完即焚，全新生成，零状态 | v3.x 远景 |

---

## 探索方向

| 方向 | 一句话 |
|------|------|
| workflow 外部模板扩充 | 引入 BPMN 2.0 / Coze / Dify 作为行业流程参考 |
| 企业 AI 节点知识库 | 多设备蒸馏记忆聚合到企业 NAS，知识库管理员 Agent 自动分类 |
| Agent 疲劳度检测 | 监控上下文窗口污染和决策质量衰减信号 |
| 双闸验证 | 工具执行前 gate + 执行后副作用复查 |
| SMB 场景审计扩展 | 审计从代码开发扩展到数据处理/报表生成 |
| 组织记忆主动调取 | Agent 接任务前先检索 think.md 共享版 |
| 异步长任务自治 | daemon 从文件监控升级为长任务自主运行 |

---

## 不需要的

以下认真考虑过但决定不做：

| 想法 | 为什么不 |
|------|------|
| 自研行为验证器 | OpenClaw 原生 `tools.loopDetection` 已覆盖 |
| 定时触发（cron） | 所有 Agent 平台都不支持 cron 级定时 |
| 动态 Skill Hook | OpenClaw 不支持 Skill 级动态 Hook |
| Connector | sofagent 是纪律层+审计层，不是自动化流水线 |
| 记忆压缩自动化 | 每个 Agent 有自己的记忆 |
| sofagent-lite 独立产品 | OpenClaw 自带约束机制，独立宪法 skill 多余 |
| 平台能力矩阵五平台 | 后台统一 OpenClaw |
| 三层加载链叙事 | 三层拆分为独立产品 |
| sofagent-fde 独立 Skill | 改为 FDE/FDE.md，FDE 自己装 |
| 纪律层实验第三次重跑 | 两次各 100 次都因任务设计无法结论 |
| 全栈组织级 Harness 产品 | sofagent 只做治理底座标准（纪律 + 审计） |

---

## 欢迎参与

| 你能做的事 | 时间 | 说明 |
|------|:--:|------|
| 跨平台测试 | 30 min | 你有 Codex / Hermes / Claude Code？装一下告诉我们 |
| 补充 FAQ | 20 min | 你踩了什么坑？直接改 Handbook §六 |
| 文档翻译 | 1-2 h | 英文翻译对社区意义巨大 |
| 第三方证据 | 1 周 | 装完用一周，填 EVIDENCE.md |
| 安全审计 | 不限 | 给 SECURITY.md 挑刺 |
| 企业场景反馈 | 30 min | 你们团队怎么用 Agent？直接开 Issue |

→ [CONTRIBUTING.md](./CONTRIBUTING.md)
