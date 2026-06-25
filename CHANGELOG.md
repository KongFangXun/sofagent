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

## [v0.91] — 2026-06-25

评审落地 + sofagent-audit MVP + 文档瘦身——两份独立评审（GLM-5.2 72 分 + DeepSeek V4 Pro 62 分）的共识项统一落地，同时启动核心战略转向：提交时审计。

### 🔴 sofagent-audit MVP（提交时审计）

TypeScript CLI，扫描 git diff 对标 4 条可程序化铁律（#1 先读再用 / #3 验证再干 / #7 谨慎修改 / #10 如实汇报），exit code 0/1/2 确定性输出。不依赖 Agent 配合、跨平台、Agent 无法绕过。误报率红线 < 10%。焊死的门原则：检查规则独立只读。

### 🔴 评审落地（文档瘦身 + 叙事降温）

ARCHITECTURE 710→378 行（47% 减），只回答「为什么这么设计」，不再回答「外部研究怎么印证」。README 文案弱化（"完全不懂"→"不是很懂"）。FDE 叙事收敛（当前交付 = 3/5 层，标注诚实）。新建 COMMUNITY.md。

### ROADMAP 版本号理顺

v0.9 出现 15+ 次指代不同内容 → 按 audit/实验/合规/daemon 分拆为 v0.91/v0.92/v0.93。FDE 矩阵版本号三处统一。

> 📖 [详细开发日志](./docs/changelog/v0.91.md)

---

## [v0.90] — 2026-06-24

安全审查 + P0 修复 + 文档清理——给 Skill 自动抓取加安全门，修三个安装断裂 bug，清理 7 个 SOP 中间产物。

### 🔴 skill-safety-check.sh（22 条正则安全审查）

编排引擎从 ClawHub 自动抓取 Skill 后、进入候选池之前，必须过两步安全审查：第一步正则硬门（22 条规则，5 类：恶意命令/密钥泄露/危险调用/注入攻击/混淆代码，Agent 不可绕过），第二步 LLM 语义审查（补正则盲区，可被 prompt injection 绕过——诚实记录为已知局限）。

### 🔴 P0 修复（3 个）

| # | 问题 | 修复 |
|:--:|------|------|
| 1 | `--remote` 参数顺序：REMOTE_MODE 在参数解析前未初始化，`set -u` 炸弹 | 预扫描 `--remote`，提前初始化 |
| 2 | `--lite` 模式跳过 Step 5b 导致 `$SOFAGENT_DATA` 未创建，think.md 写入失败 | think.md 写入前 `mkdir -p` |
| 3 | 8 个脚本各自硬编码 `SOFAGENT_DATA="${PWD}/.sofagent"`，`--project-dir` 装在 A 目录从 B 目录跑找不到数据 | `config.sh` 新增 `_sofa_find_data_dir()` 统一解析，4 级优先链 |

**连带修复**：`config.sh` 布尔型配置不再被空值覆盖——rules.md 无匹配时保留已有环境变量。

### 证据体系

Case 012（社区 A/B 测试）：社区成员小嘉用 DeepSeek Reasoner 跑 5 个代码重构任务真 A/B 对照——sofagent 组首次无 bug 率 5/5，裸 Agent 组 4/5；陷阱注释全保留 vs 部分移除；类型完整 interface vs `any` 绕过。5 维度全正向。

反案例 003（方法论陷阱）：另一组测试 16/16 满分但不可信——6 个方法论硬伤（版本号矛盾/无对照/模型未控制/N=2/MEMORY 污染/设计过于显眼）。核心教训：「满分但不可信」比「50 分但可信」危险 100 倍。

### FDE 叙事 + 文档清理

README/ARCHITECTURE/HANDBOOK 三处加入 FDE 能力矩阵（纪律层核心 vs 审计层规划）。删除 7 个 SOP 中间产物（system_design/class-diagram/sequence-diagram/research/samples/ao-compose-format/platform-test-guide，净减 1300 行）。

> 📖 [详细开发日志](./docs/changelog/v0.90.md)

---

## [v0.86] — 2026-06-23

v0.85 重新定位为纪律层，v0.86 补三个核心能力：Agent 更聪明地拆任务、更清楚什么时候该停、更不容易跑偏。

### 🔴 读写型复杂任务分流（engine.md）

写代码为主的任务不再拆成多个子 Agent（会互相冲突），改用一个 Agent 完整地做。读代码、查资料的任务正常并行拆解。来源：Anthropic Cloud Code 实践数据——交接冲突代价 > 并行收益。

同时理清了开环/闭环区分（默认闭环，有明确目标才开工），加了四种跑偏检测：细节沉迷 / 卡在同一个 bug / 目标悄悄漂移 / 改完不验证。

### 🔴 Loop 成熟度四问（loop-check.md）

每次闭环时必须回答：怎么停 / 谁来判通过 / 失败怎么反馈 / 什么时候交还人类。连续 3 轮失败 → 强制交还，不再自动重试。

### 设计约束补充与文档改进

**路线图**：v0.9 加焊死的门原则、先实验再设计规则、数据存储安全声明；v1.x 加 bash→TypeScript 技术选型演进、成本仪表盘 100x 数据；v2.x 加信号文件夹模式、n8n 兼容。

**文档**：README 第一屏加适用范围声明、平台能力表拆「兼容 vs 支持」两列；架构设计补管道闸门模型、Maker-Checker 上下文隔离、反驳层设计参考。

> 📖 [详细开发日志](./docs/changelog/v0.86.md)

---

## [v0.85] — 2026-06-23

定位重构 + ROADMAP 砍削——基于评审（GLM-5.2 + DeepSeek V4 Pro）的战略校准。

### 🔴 定位校准：治理层 → 纪律层

v0.84 的 A/B 数据指向清晰差异化在纪律层（先读后写/验证再干/谨慎修改），不在约束层（被三层压缩）。定位从「Agent 治理层」改为「Agent 纪律层」。

### 🔴 ROADMAP v0.9 砍削：20+ → 6 项

v0.9 从「企业级 + Beta」改为「验证 + 合规刚需」。20+ 项企业级功能砍到合规三件套 + 验证工具 3 项，17 项推到 v1.x+ 待评估。**先证明价值再谈规模化。**

### v0.85 五件事

1. 验证实验设计（45 组对照，v0.9 执行）
2. sofagent Lite（30 秒只装宪法层，`--lite` 参数已实现）
3. sofagent-audit 方向确立（提交时审计）
4. 编排引擎降级（`--no-ao` 升为推荐默认）
5. 概念分层标注（README/ARCHITECTURE/HANDBOOK 两栏表：纪律层核心 vs 治理层增强）
6. 命名回改（「工程纪律层」→「纪律层」，「指导员」→「纪律委员」，README badge 加定位标签）
7. 文档全面同步定位校准

> 📖 [详细开发日志](./docs/changelog/v0.85.md)

---

## [v0.84] — 2026-06-23

证据 + 打磨——A/B benchmark 数据补全（5 组数据：WorkBuddy 对话 + CLI 一击两轮 + 独立测试者代码重构）+ install/uninstall 打磨 + 4 底线优化 + Hook 归因修正。

### A/B Benchmark — 五组数据（基于 v0.81-v0.83 实测，v0.84 改动尚未纳入）

> ⚠️ 以下数据是驱动 v0.84 决策的**基线数据**，不是 v0.84 的测试产出。v0.84 的 4 底线优化需要后续独立验证。

| 平台 | 模式 | sofagent 生效？ | 明确增量 | 核心限制 |
|------|------|:---:|:---:|------|
| WorkBuddy | 对话（skill 自觉加载） | ⚠️ 部分 | 1/10 | B 组加载链已含 sofagent 思想，非裸模型 |
| OpenClaw | 交互式对话（Hook 注入） | ✅ 完整 | 纪律性 +2，首次通过率 +40% | 独立测试者报告（v0.81），4 项方法论局限 |
| OpenClaw | CLI `--local` 一击 | ❌ 全失效 | 0/16 | bootstrap 不触发，Hook 永不调用 |
| Hermes | CLI `-z` 一击 | ❌ 全失效 | 0/16 | 不经过 OpenClaw Hook 系统，宪法可被篡改 |

> sofagent 的有效边界 = Agent 会话是否经过 bootstrap 生命周期。代码重构场景的增量在纪律层（减少误改 + 验证习惯），不在能力层。

### 🔴 Hook 归因修正（v0.82 问题 #1）

v0.82 platform-matrix 记录「OpenClaw Hook 自动注册失败」。v0.84 诊断推翻：Hook 注册完全正常（`openclaw.json` 配置完整，`handler.ts` 部署到位）。CLI 一击无效的根因是 `--local` 不触发 `agent:bootstrap` 事件——架构边界，非注册 bug。详见 [v0.84 开发日志](./docs/changelog/v0.84.md)。

### 🔴 战略洞察：测错了维度（v0.81-v0.83 代码实测，v0.84 改动未纳入）

v0.84 期间用 v0.81-v0.83 代码跑了 5 组 A/B，最重要的发现不是"CLI无效"或"WorkBuddy只有1/10"，而是**我们一直在用错误的尺子量 sofagent**。benchmark 10 任务中 7 个测约束层（拒绝/追问），但约束层被三层压缩（模型安全训练 + 用户加载链 + CLI绕过）——增量天花板很低。独立测试者用纪律层尺子（先读再用/验证再干/谨慎修改）量出了真实增量：纪律性 +2，首次通过率 +40%。

**sofagent 真正的差异化在纪律层，不在约束层。** 约束层是 base layer（★★☆），纪律层是 value layer（★★★★★）。

> v0.84 只记录洞察，不改 README/ARCHITECTURE 定位——独立测试者报告存在方法论局限（知识传递效应未排除），需反转顺序重跑确认后再动。

> 📖 [完整分析见 v0.84 开发日志](./docs/changelog/v0.84.md#战略启示测错了维度)

### 🔴 4 底线优化

| # | 改动 | 旧 | 新 |
|---|------|-----|-----|
| 1 | 结构 | 4 行单句（无前言） | 加前言「模型安全训练已覆盖有害内容识别与拒绝；4 底线聚焦 Agent 层闸门」 |
| 2 | 底线 #2 | 「拒绝不可逆破坏性命令」 | 「先说明风险、等用户确认后再执行」（闸门动作，非拒绝本身） |
| 3 | 底线 #3 | 列触发词（色情/暴力/诈骗/国家安全…）+ 「拒绝」 | 「不辩解、不迂回、不提供替代」（聚焦 Agent 动作，模型已管识别） |
| 4 | 底线 #4 | 「所有交互标注 AI 生成」 | 「标注 AI 生成、不模仿真人/不声称情感」（补齐防冒充维度） |

核心逻辑：模型安全训练已覆盖「能不能做」的识别，4 底线聚焦 Agent 层「怎么守」的闸门——模型不会主动做的事（脱敏打码、等确认、不辩解、标注身份）。

> 📖 [详细开发日志](./docs/changelog/v0.84.md)

---

## [v0.83] — 2026-06-22

v0.82 五平台实测发现的安装断裂 + 评审（GLM-5.2 + DeepSeek V4 Pro）发现的代码 bug + 文档诚实度修正。纯 bugfix，不加新功能。

### 🔴 P0 — 安装/部署断裂

| # | 问题 | 平台 | 来源 |
|:-:|------|:---:|------|
| 1 | ~~OpenClaw Hook 自动注册失败~~ → v0.84 修正：注册正常，CLI 一击不触发 bootstrap 是架构边界 | OpenClaw | v0.82 实测 |
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
