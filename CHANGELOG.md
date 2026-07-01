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
> - **v0.98**：架构重组版——产品核心从事前约束转向事后审计 + FDE 企业部署，OpenClaw 必装，v1.0 转向 FDE 工具包，新增 THINK.md 项目反思文档
> - **v0.99**：v1.0 前收尾——审查全面修复 + Skill ≤90 行 + 放弃条件 + bus factor + GitHub Action + MCP Server + FDE 工具箱（/FDE + sofagent-fde Skill）+ 文档预算 ≤5,000。
- **v0.99.1**：审查跟进——OpenClaw 叙事重写（两层架构/审计层平台无关/编排层 FDE 工具包）+ P0 代码清理（手写YAML→js-yaml + MCP Server 拆分 @sofagent/mcp）+ 局限声明修正 + 案例模板。
- **v0.99.2**：审查驱动质量修复——双 LLM 审查驱动的全面修复（daemon 歧义根治 + 死链清零 + 文档一致性），v1.0 前最后一次质量加固。

---

## [v0.99] — v1.0 前收尾版 ✅

v1.0 前收尾——完成两份独立深度审查的全部修复（7 批次 + v0.99 4 节）。文档信任修复（entry-gate 加载链 / SECURITY 行数 / DEVELOPMENT ≤90 行宣称 / README 格式）。Skill 全部 ≤90 行（loop-check 拆分 + engage/entry-gate 精简）。44 处 rules.md 死链清零。中英文 README 对齐 + 90/10 rule + 成熟度声明。项目放弃条件 5 条正式写入 ROADMAP。v1.0 准入条件 9 条核查。bus factor + 模型依赖声明。内容去重。GitHub Action 模板。preferences.md 删除。think-generator.ts 死代码清理。tools/check-docs.sh 自动化检查。398 tests 全绿，tsc 零错误。文档预算 ≤5,000。FDE 工具箱（/FDE + sofagent-fde Skill）。data/fde.md 加载链模板。npm 包 README（@sofagent/audit）。MCP Server 配置文档合并精简。ARCHITECTURE MCP 推送层状态更新为 v0.99。

> 📖 [开发日志](./docs/changelog/v0.99.md)

---

## [v0.99.1] — 审查跟进版 ✅

审查跟进——OpenClaw 叙事重写（README/ARCHITECTURE 中英文 + 术语统一为"FDE 的工具包"）+ P0 代码清理（手写 YAML 解析器替换 js-yaml、MCP Server 拆分为 @sofagent/mcp 独立包 + npm workspaces）+ 局限声明修正（FDE 验证状态 + 编排引擎稳定性 + 模型依赖增强）+ Case study 模板。

> 📖 [开发日志](./docs/changelog/v0.99.1.md)

---

## [v0.99.2] — 审查驱动质量修复版 ✅

v1.0 前最后一次质量加固。基于 DeepSeek V4 Pro + GLM-5.2 两份独立十维审查，修复 18 个问题（3 P0 + 9 P1 + 6 P2）：daemon 歧义根治 + 死链清零 + 过期引用修复 + 术语统一 + 作者背景一致 + bin 命名 + Windows 兼容 + A/B 时间窗口 + LLM 阅读理解防御性优化。

> 📖 [开发日志](./docs/changelog/v0.99.2.md)

---

## [v0.98] — 架构重组版

架构重组 + 审计独立化——产品核心从事前约束转向事后审计 + FDE 企业部署，面向中小企业（SMB）和一人公司（OPC）。100 次对照实验结论作废（详见 [anti-cases/004](./docs/evidence/anti-cases/004-discipline-experiment-inconclusive.md)）→ lite 删除 + 宪法内联 + rules→fde.md 全脚本同步 + think.md 由审计引擎自动生成 + FDE 从 Skill 改为根目录文档 + OpenClaw 重定义为必装引擎。v1.0 定位从"Agent 工作验收工具"转向"FDE 工具包"。新增 [THINK.md](./THINK.md)——项目反思文档。

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

## v0.47–v0.80 — 早期开发期（摘要）

> 这段时间每个版本间隔 1-3 天，改动密集。只保留摘要，详细日志在 [docs/changelog/](./docs/changelog/) 下。

| 版本区间 | 主题 |
|---------|------|
| v0.47–v0.50 | 项目首次发布 + 安装断裂修复 |
| v0.51–v0.53 | 宣称对齐 + 评审反馈修复 |
| v0.54–v0.56 | 架构重构（Handbook 拆分）+ 加载链防漏读 |
| v0.60–v0.63 | CI 闭环 + 宪法内联 + 诚实化 |
| v0.70–v0.80 | 企业合规三件套 + 降低试用门槛 |

> 早期版本的完整日志在 [docs/changelog/](./docs/changelog/) 目录下。
