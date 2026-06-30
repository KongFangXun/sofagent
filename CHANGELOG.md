# Changelog

每个版本的详细开发日志在 [docs/changelog/](./docs/changelog/) 目录下。本文件是目录索引——一句话知道改了什么，点链接看完整故事。

> 📋 **版本号说明**（v0.83 新增，回应评审 P2-1）：
> - **v0.47–v0.56**：早期开发版，每个版本间隔 1-3 天，改动密集
> - **v0.60–v0.63**：架构重构期（扁平化 + 诚实化）
> - **v0.70.0/v0.70.1**：企业合规三件套（脱敏/保留/审计）+ Codex 兼容性修复
> - **v0.71**：未独立对外发布——内容（QA 审计 23 项 + 第三方代码审查 40+ 项 + 行业研究驱动功能 + 治理逻辑加固）已合并进下方 v0.72 条目。v0.71 仅作为内部版本号存在于脚本 `VERSION=` 字段和文档头中，没有对应的 Release
> - **v0.72–v0.75**：门面实证 + 运行时加固 + 治理层自身治理 + 降低试用门槛（每版一个主题）
> - **v0.76–v0.80**：daemon 开发内部版本，未对外发布。v0.8 系列 daemon 开发过程中的迭代版本，代码改动最终合并进 v0.81 统一发布
> - **v0.81**：daemon 核心骨架 + 5 项治理加固
> - **v0.82**：评审修复 + 五平台实测 5/5 完成 + ROADMAP 重构 + License MIT
> - **v0.83**：安装断裂修复 + 代码加固 + 文档诚实度修正（纯 bugfix）
> - **v0.84**：A/B benchmark 数据补全 + 4 底线优化 + Hook 归因修正
> - **v0.85**：定位重构（治理层→纪律层）+ ROADMAP 砍削（20+→6）
> - **v0.86**：读写型复杂任务分流 + Loop 成熟度四问 + 管道闸门
> - **v0.90**：skill-safety-check 安全审查 + P0 安装断裂修复 + 文档清理
> - **v0.91**：评审落地 + sofagent-audit MVP + 文档瘦身 47%
> - **v0.92**：v0.91 审查修复——execSync 安全加固 + 信任模型诚实声明 + 铁律检测精度的边界 + 单元测试覆盖
> - **v0.93**：工程迁移 + 4 项 FP 修复 + 6 项文档修缮 + 2 份社区 PR 合入跟进——bash→TS 第一步 + 信任模型精确化 + 中英文定位对齐
> - **v0.94**：工程硬伤止血 + 审计独立化（沉默审计 + LogFormat 可插拔）+ FDE 部署者优先 + 真实 Skill 加载链复现实验——双轮评审重排，MCP/Agency 推到 v0.95
> - **v0.95**：审计体系重构（4·6·8·4：4 底线 + 6 则铁律 + 8 审计 + 4 扩展）+ 铁律 10→6（4 条有 git diff 痕迹的移审计层 A3/A5/A7/A8）+ 目录改名（sofagent-audit/ → sofagent/audit/）+ ARCHITECTURE 三源收敛（Ralph Loop + MiroFish + 卡普二分法）+ FDE 商业模式——MCP/Agency/demogif 推迟 v1.0
> - **v0.96**：诚实收缩——README 六段式重构（373→166 行）+ AI 中台叙事贯通 + bash→TS 第一波（僵尸清理 + task-orchestrate）+ 铁律重排 + 审计 A9/A10/A11 规则草案 + 编排引擎定位澄清
> - **v0.97**：证据版本——审计 A9/A10/A11 + 编排引擎重构 + bash→TS 第二波 + 概念精简（纪律层实验 100 次对照结果作废）
> - **v0.98**：架构重组版——产品核心从事前约束转向事后审计 + FDE 企业部署，OpenClaw 必装，v1.0 转向 FDE 部署底座，新增 THINK.md 项目反思文档
> - **v0.99**：v1.0 前收尾——准入条件 6 条核查 + 外部反馈整理 + 文档终审 + FDE 完整链路端到端验证

---

## [v0.99] — 规划中

v1.0 前收尾——不进新功能，只做 bugfix + 文档终审 + 准入核查。v1.0 准入条件 6 条逐一打勾。外部反馈整理 + GitHub Issues triage。文档终审（13 份核心文档复核 + 概念去重复查 + 一致性自动化检查）。FDE 完整链路端到端验证（装环境→梳理 workflow→编排→执行→反思→审计→推送）。bus factor 缓解（目标：≥3 个外部 PR 合入）。所有未完成 TODO 要么完成要么诚实标注「推迟 v1.x」。

> 📖 [开发日志](./docs/changelog/v0.99.md)

---

## [v0.98] — 架构重组版

架构重组 + 审计独立化——产品核心从事前约束转向事后审计 + FDE 企业部署，面向中小企业（SMB）和一人公司（OPC）。100 次对照实验结论作废（详见 [anti-cases/004](./docs/evidence/anti-cases/004-discipline-experiment-inconclusive.md)）→ lite 删除 + 宪法内联 + rules→fde.md 全脚本同步 + think.md 由审计引擎自动生成 + FDE 从 Skill 改为根目录文档 + OpenClaw 重定义为必装引擎。v1.0 定位从"Agent 工作验收工具"转向"FDE 部署底座"。新增 [THINK.md](./THINK.md)——项目反思文档。

> 📖 [开发日志](./docs/changelog/v0.98.md)

文件结构整理：RELEASING.md → docs/releasing.md，docs/ 下文件分类到 guides/ / design/ / evidence/ 子目录，全项目引用链接同步更新。

---

## [v0.97] — 证据版本 ✅

审计 A9/A10/A11 + 编排引擎重构 + bash→TS 第二波 + 概念精简。纪律层实验 100 次对照因方法缺陷结果作废（详见 [anti-cases/004](./docs/evidence/anti-cases/004-discipline-experiment-inconclusive.md)）。

> 📖 [开发日志](./docs/changelog/v0.97.md)

---

## [v0.96] — 诚实收缩

诚实收缩版本——README 从 373 行重构为 166 行六段式 + AI 中台纪律底座叙事首次贯通文档体系。bash→TS 迁移第一波：3 个僵尸脚本清理 + task-orchestrate.sh 迁移（其余 6 个核心脚本推 v0.97）。铁律 6 条按重要性重排 + 精炼描述，去掉（底线）（拐杖）标签。审计 A9/A10/A11 规则草案（prompt injection / 供应链 / 资源耗尽，实现推 v0.97）。编排引擎定位澄清——从 sofagent 核心拆出，定位为 FDE 场景专用。两份外部审查吸收。纪律层证伪实验推 v0.97（独立版本），审计闭环六步推 v0.98（需要真实数据），FDE 经验抽象推 v0.99（需要真实客户）。

> 📖 [开发日志](./docs/changelog/v0.96.md)

---

## [v0.95] — 审计体系重构

审计体系重构（4·6·8·4）+ 铁律 10→6 + 目录改名 + ARCHITECTURE 三源收敛 + FDE 商业模式——铁律从 10 条精简为 6 条（4 条有 git diff 痕迹的移至审计层 A3/A5/A7/A8），sofagent-audit/ 目录改名为 sofagent/audit/，CLI 命令名 sofagent-audit 保留。MCP/Agency/demogif 因接口不稳定推迟 v1.0。

> 📖 [开发日志](./docs/changelog/v0.95.md)

---

## [v0.94] — 工程硬伤止血

工程硬伤止血 + 审计独立化（沉默模式 + 7 条纯 diff 规则）+ FDE 部署者优先 + 社区复现指南——双轮评审（GLM-5.2 + DeepSeek V4 Pro）后重排，MCP/Agency 推到 v0.95。

> 📖 [开发日志](./docs/changelog/v0.94.md)

---

## [v0.93] — 工程迁移

工程迁移 + 检测精度闭环 + 文档修缮 + 10 组实验——v0.92 全身审查 17 项问题中的 11 项落地（4 项 FP 修复含 --strict + 6 项文档修缮 + 10 组实验执行）+ bash→TypeScript 迁移起步 + 两份社区 PR 合入跟进。实验结论：纪律层增量 = f(陷阱难度)——在高难度「同名语义混淆」场景效果显著（0% vs 100% 误伤），在精确指令场景无显著差异。

> 📖 [开发日志](./docs/changelog/v0.93.md)

---

## [v0.92] — 审查修复

v0.91 审查修复版本——DeepSeek V4 Pro 驱动的 WorkBuddy 专家团审查发现 3 个 P0 安全硬伤、6 个 P1 工程欠债、5 个 P2 改进。综合评分 5.7/10 → 目标 7.0/10。

> 📖 [详细开发日志](./docs/changelog/v0.92.md)

---

## [v0.91] — 评审落地

评审落地 + sofagent-audit MVP + 文档瘦身 47%——两份独立评审（GLM-5.2 + DeepSeek V4 Pro）共识项落地，启动提交时审计战略转向。

> 📖 [详细开发日志](./docs/changelog/v0.91.md)

---

## [v0.90] — 安全审查

skill-safety-check 安全审查（22 条正则 + LLM 双门）+ 三个 P0 安装断裂修复 + 7 个 SOP 中间产物清理。

> 📖 [详细开发日志](./docs/changelog/v0.90.md)

---

## [v0.86] — 运行时加固

读写型任务分流 + Loop 成熟度四问 + 跑偏检测——Agent 拆任务更聪明、知道什么时候该停、不容易跑偏。

> 📖 [详细开发日志](./docs/changelog/v0.86.md)

---

## [v0.85] — 定位重构

定位重构（治理层→纪律层）+ ROADMAP 砍削（20+→6 项）——基于 GLM-5.2 + DeepSeek V4 Pro 双评审的战略校准。

> 📖 [详细开发日志](./docs/changelog/v0.85.md)

---

## [v0.84] — 证据打磨

A/B benchmark 五组数据 + 4 底线优化 + Hook 归因修正。核心发现：差异化在纪律层不在约束层（测错了维度）。

> 📖 [详细开发日志](./docs/changelog/v0.84.md)

---

## [v0.83] — 安装修复

安装断裂修复 + 代码加固 + 文档诚实度修正（P0×4 + P1×3 + P2×3）。纯 bugfix。

> 📖 [详细开发日志](./docs/changelog/v0.83.md)

---

## [v0.82] — 五平台实测

评审问题修复 + 五平台实测 5/5 + ROADMAP 重构 + License MIT。核心结论：治理加固仅在 OpenClaw 生效。

> 📖 [详细开发日志](./docs/changelog/v0.82.md)

---

## [v0.81] — daemon 骨架

daemon 核心骨架（纯 bash：launchd/systemd + 文件 hash 监控）+ 5 项治理加固（幂等/步数闸/熔断闸/评判器隔离/怀疑论提示）。

> 📖 [详细开发日志](./docs/changelog/v0.81.md)

---

## [v0.75] — 降低门槛

降低试用门槛（README.en.md + 一行安装 + Mermaid 架构图）+ 补可信度数据（EVIDENCE 诚实声明 + benchmark.sh API 模式 + 企业风险评估）+ 社区建设（CONTRIBUTING 三级权限）。

> 📖 [详细开发日志](./docs/changelog/v0.75.md)

---

## [v0.74] — 依赖加固

治理层自身治理：ao compose 依赖加固（YAML 格式写死 + 自动降级）+ 加载链自检声明 + 人类抽样审计 + verify.sh --quick + 一行安装 + 文档去重。

> 📖 [详细开发日志](./docs/changelog/v0.74.md)

---

## [v0.73] — 闸门体系

运行时逻辑加固：三道闸门体系落地（任务闸/执行闸/验收闸）+ ComplexityScorer 模型路由 + 6 个显式失败分支 + 记忆系统三规则 + LLM 自评降权 ×0.5→×0.3。结构重构：rules.md 从 constitution/ 扁平化到根目录。

> 📖 [详细开发日志](./docs/changelog/v0.73.md)

---

## [v0.72] — 门面实证

门面实证版本：README 平台能力表重构（三列：加载链/编排引擎/自动化程度）+ EVIDENCE 重构 + benchmark.sh 标准化测试。

> 包含 v0.71 内容（QA 审计 23 项 + 第三方代码审查 40+ 项 + 行业研究驱动），v0.71 未独立发布。

> 📖 [详细开发日志](./docs/changelog/v0.72.md)

---

## [v0.70.0 / v0.70.1] — 企业合规

企业合规三件套：日志脱敏（task-record.sh sanitize()）+ 数据保留策略（cleanup.sh）+ 审计日志（audit.sh）+ 共享配置层（lib/config.sh）。v0.70.1 修 Codex 平台兼容性（SOFAGENT_DATA 未初始化 + verify.sh 误查 OpenClaw Hook）。

---

## [v0.63] — 诚实化

诚实化：loop-agent.md 非OpenClaw评审路径去伪强制语气 + 外部研究引用诚实化（删百分比数字）+ HANDBOOK 闸门矛盾修复 + 文档膨胀裁剪（ARCHITECTURE 612→585，DEVELOPMENT 610→599）。

---

## [v0.62] — 宪法内联

宪法内联进 SKILL.md（扁平化重构）——第 1 层不再依赖 Agent Read，所有平台强制生效。三层加载链重构（SKILL.md→think.md→rules.md）。铁律重排。文档命名规范化（Design→ARCHITECTURE 等）。

---

## [v0.60] — CI 闭环

A0 专家团引擎自检 + Logo 体系 + GitHub Actions CI + README 徽章优化 + Roadmap v0.6x 四项全部闭环。

---

## [v0.56] — 2026-06

删假引用（Open Viking 编造）+ 折半机制真实现（load-chain.sh emit_think_downgraded）+ 加载链防漏读 ⛔ 硬出口 + "兼容"措辞诚实化 + Quick Start 重写 + Case 002 归档。

---

## [v0.55] — 2026-06

架构重构：978 行 Handbook 拆为三文件（Handbook + Developer + Design）。Case 001 归档（@cedric123123 OpenClaw + kimi-k2.5 首次跑通）。企业部署文档。

---

## [v0.54] — 2026-06

反思自噬根因修复（三标记权重折半）+ ao compose 单点故障（默认编排策略）+ 约束回响 + 6 条企业级开关。

---

## [v0.53] — 2026-06

评审反馈 22/23 项修复 + Handbook 瘦身 1136→983 行（-13.5%）。

---

## [v0.52] — 2026-06

风格统一 + 边界补齐。

---

## [v0.51] — 2026-06

宣称对齐。

---

## [v0.50] — 2026-06

全链路通——install→verify→uninstall 首次跑通。

---

## [v0.49] — 2026-06

自测挖 bug。

---

## [v0.48] — 2026-06

install.sh 文件复制不全问题（OpenClaw 路径仅复制 2/6 个 Skill 文件）+ 报告不实问题。

---

## [v0.47] — 2026-06

项目首次发布——装不上（install.sh 路径错误）。
