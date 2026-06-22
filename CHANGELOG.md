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

---

## [v0.83] — 2026-06-22

v0.82 五平台实测发现的安装断裂 + 双视角评审（GLM + DeepSeek）发现的代码 bug + 文档诚实度修正。纯 bugfix，不加新功能。

### 🔴 P0 — 安装/部署断裂

| # | 问题 | 平台 | 来源 |
|:-:|------|:---:|------|
| 1 | OpenClaw Hook 自动注册失败（全新配置目录生成空 `.tmp`） | OpenClaw | v0.82 实测 |
| 2 | WorkBuddy scripts/ 未部署（install.sh Step 6 脚本部署被锁在 OpenClaw-only 块内） | WorkBuddy | v0.82 实测 |
| 3 | Claude Code scripts/ 未部署（install.sh --platform claude 分支遗漏） | Claude Code | v0.82 实测 |
| 4 | install.sh `TARGET_DIR` 未定义（REMOTE_MODE=1 时 set -u 炸弹） | install.sh | DeepSeek 评审 |

### 🟡 P1 — 体验断裂 + 代码加固

| # | 问题 | 涉及文件 | 来源 |
|:-:|------|------|------|
| 5 | CLAUDE.md 种子指令未自动写入 | install.sh | v0.82 实测 |
| 6 | daemon-status.sh `local` 在函数外使用（set -euo pipefail 下报错退出） | daemon-status.sh | DeepSeek 评审 |
| 7 | daemon-lib.sh set_json_field 写入后不校验 JSON 完整性 | daemon-lib.sh | DeepSeek 评审 |

### 🟢 P2 — 文档诚实度 + CI

| # | 问题 | 涉及文件 | 来源 |
|:-:|------|------|------|
| 8 | engine.md A2 节 ao 能力探测新增快速决策表 | engine.md | DeepSeek 评审 |
| 9 | ARCHITECTURE.md 致谢表 SkillOpt arXiv 号修正（2605.06614 → 2605.23904） | ARCHITECTURE.md | GLM 评审 |
| 10 | 新增 shellcheck CI（只加 lint，不重构） | .github/workflows/ | GLM 评审 |

> 📖 [详细开发日志](./docs/changelog/v0.83.md)

---

## [v0.82] — 2026-06-22

v0.81 评审问题修复（P0×4 + P1×3 + P2×4）+ 五平台实测 5/5 全部完成 + ROADMAP 结构重构 + License 改纯 MIT + SkillOpt 方法论引用 + 平台排序全局调整。

**核心结论**：治理加固（步数闸/熔断闸/幂等检查/评判器隔离）**仅在 OpenClaw 生效**，其他平台全部降级或失效。

| 平台 | 测试人 | 结果 |
|------|--------|------|
| OpenClaw | @liudi8785-cell | ✅ 8/8 全维度通过 |
| WorkBuddy | @yeqingan | ❌ 治理加固全失效（v0.52 不含 scripts/） |
| Codex | @kangjianrong | ✅ 安装+加载通过，治理靠自觉 |
| Hermes Agent | @cedric123123 | ❌ 4 项治理全失效，熔断闸 5 次未断 |
| Claude Code | KongFangXun | ❌ 0/8，scripts/ 未部署 |

> 📖 [详细开发日志](./docs/changelog/v0.82.md)

---

## [v0.81] — 2026-06-22

daemon 核心骨架（纯 bash 零依赖：launchd/systemd 系统服务注册 + 文件 hash 监控 + 降级）+ 5 项治理逻辑加固（幂等检查 / 步数闸 / 熔断闸 / 评判器隔离 / 怀疑论提示）+ 五平台验证文档。

> ⚠️ 以下 5 项治理加固经五平台实测确认——**仅在 OpenClaw 生效**。其他平台全部降级为 prompt 级软约束或失效。

> 📖 [详细开发日志](./docs/changelog/v0.81.md)

---

## [v0.75] — 2026-06-21

降低试用门槛（README.en.md + 一行安装 + Mermaid 架构图）+ 补可信度数据（EVIDENCE 诚实声明 + benchmark.sh API 模式 + 企业风险评估）+ 社区建设（CONTRIBUTING 三级权限）。

> 📖 [详细开发日志](./docs/changelog/v0.75.md)

---

## [v0.74] — 2026-06-21

治理层自身治理：ao compose 依赖加固（YAML 格式写死 + 自动降级）+ 加载链自检声明 + 人类抽样审计 + verify.sh --quick + 一行安装 + 文档去重。

> 📖 [详细开发日志](./docs/changelog/v0.74.md)

---

## [v0.73] — 2026-06-21

运行时逻辑加固：三道闸门体系落地（任务闸/执行闸/验收闸）+ ComplexityScorer 模型路由 + 6 个显式失败分支 + 记忆系统三规则 + LLM 自评降权 ×0.5→×0.3。结构重构：rules.md 从 constitution/ 扁平化到根目录。

> 📖 [详细开发日志](./docs/changelog/v0.73.md)

---

## [v0.72] — 2026-06-20

门面实证版本：README 平台能力表重构（三列：加载链/编排引擎/自动化程度）+ EVIDENCE 重构 + benchmark.sh 标准化测试。

> 包含 v0.71 内容（QA 审计 23 项 + 第三方代码审查 40+ 项 + 行业研究驱动），v0.71 未独立发布。

> 📖 [详细开发日志](./docs/changelog/v0.72.md)

---

## [v0.70.0 / v0.70.1] — 2026-06-19/20

企业合规三件套：日志脱敏（task-record.sh sanitize()）+ 数据保留策略（cleanup.sh）+ 审计日志（audit.sh）+ 共享配置层（lib/config.sh）。v0.70.1 修 Codex 平台兼容性（SOFAGENT_DATA 未初始化 + verify.sh 误查 OpenClaw Hook）。

---

## [v0.63] — 2026-06-19

诚实化：loop-agent.md 非OpenClaw评审路径去伪强制语气 + 外部研究引用诚实化（删百分比数字）+ HANDBOOK 闸门矛盾修复 + 文档膨胀裁剪（ARCHITECTURE 612→585，DEVELOPMENT 610→599）。

---

## [v0.62] — 2026-06

宪法内联进 SKILL.md（扁平化重构）——第 1 层不再依赖 Agent Read，所有平台强制生效。三层加载链重构（SKILL.md→think.md→rules.md）。铁律重排。文档命名规范化（Design→ARCHITECTURE 等）。

---

## [v0.60] — 2026-06

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

双视角评审 22/23 项修复 + Handbook 瘦身 1136→983 行（-13.5%）。

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
