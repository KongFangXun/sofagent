# Changelog

每个版本的详细开发日志在 docs/changelog/ 下。v1.0.0+ 为正式版，v0.x 实验版日志在 [docs/changelog/experimental/](./docs/changelog/experimental/)。本文件是目录索引。

---

## 正式版
### [v1.0.9] — 二进制文件审计 + 快照时间线 + MCP compose tool + 安全加固 + 遗留补齐 🔧
> 2026-07-14（UTC）· 已发版（tag v1.0.9 @ 366eb54，2026-07-14）
**核心新功能**：A16 非授权文件变更 + A17 异常批量变更（二进制文件行为级审计）+ `--timeline` 快照时间线可视化 + `--revert` 回滚 + MCP compose tool（编排引擎通过标准 MCP 协议对 Agent 平台暴露）。EvidenceMode 类型扩展 `'filesystem'` 模式。daemon 审计闭环（文件变更→diff→runRules→快照→binary_history 全链路打通）+ daemon cron @weekly/@daily/@hourly 定时 FDE 巡检 + `--doctor` fs-watch 运行状态检测 + `install.sh --with-memory` TencentDB Memory 集成。
**安全修复**：A9 中文注入检测（追加 9 条中文正则，`忽略以上所有指令` 等模式正确拦截）+ `--diff` 模式 commitMsg 从区间终点取而非 HEAD。
**缺陷修复**：fs-watch 递归监控（子目录文件变更不再遗漏）+ config-loader knownKeys 补 a16/a17 + rules/index.ts 注释同步 A14-A17 + acceptance-test pipefail 全面保护（`git_log_has()` 函数统一封装）+ diff-ref 语义修正（非范围 ref 原样返回）+ 文档预算上限调整（5500→5600）。531 tests 全绿，acceptance-test 35/35 全绿，pre-push 7/7 全绿，check-version 39/39。
> 📖 [开发日志](./docs/changelog/v1.0.9.md)
### [v1.0.8] — FDE Agent 自进化 + 文件系统审计 + 内嵌 isomorphic-git + Agent 定义去耦合 🔧
> 2026-07-13（UTC）
FDE Agent 双模式（部署 deploy + 持续优化 sustain）构成自进化闭环（Audit 管底线、FDE sustain 管上限）+ 文件系统审计（isomorphic-git 隐藏 repo + fs-watch daemon + 5s 防抖 + 快照回溯 `--revert`）+ Agent 定义去 OpenClaw 耦合（`session.spawn` 零命中，Sub Agent 可在个人节点直跑）+ TencentDB Memory 集成（persona.md 注入加载链）+ Ontology 人类可读视图（`ontology view`）。审计语义从"git commit 拦截"扩展为"文件变更告警 + 回溯"，覆盖非开发者。发版审查后修复：版本号全量 bump（91 文件一致）+ verify.js 脚本目录解析兼容 monorepo 嵌套。493 测试全绿，pre-push 7/7 全绿，OpenClaw 28/28 验收全绿，回归检查清单（256 维度）质量验证全通过。
> 📖 [开发日志](./docs/changelog/v1.0.8.md)
### [v1.0.7] — 双节点架构 + Sub Agent 约束自加载 + ao 完全退役 🔧
> 2026-07-13（UTC）
> 🔴 **Breaking Change**：ao（agency-orchestrator）已完全退役。v1.0.6 用户升级到 v1.0.7 后需手动卸载：`npm uninstall -g agency-orchestrator`。编排引擎已全面迁移到 DeepAgents。

Sub Agent 约束自加载（buildConstrainedSystemPrompt，平台无关）+ CLI 编排入口（sofagent-audit compose）+ ao 代码全部清除（deepagents 提升为正式依赖）+ 审计 fast-fail（critical 层 FAIL 即停）+ A/B 自动切换（连续胜出计数器）+ 方案C运行器升级 + 双节点架构文档。v1.0.6 补丁修复（post-commit hook 误报修复 / --init 自动创建 .gitignore / 测试数对齐 / CHANGELOG 纯度 / 根目录归位 / 文档一致性等）。493 测试全绿，pre-push 全绿。
> 📖 [开发日志](./docs/changelog/v1.0.7.md)
### [v1.0.6] — 编排迁移 + A/B 真实运行器 + 安全加固 + SkillOpt CLI 修复 🔧
> 2026-07-13（UTC）
DeepAgents compose 迁移（ao 降为 fallback）+ Sub Agent 状态管理（runtime.json 心跳）+ A/B 真实运行器（模型 API 直跑，自动评估 + 手动 promote）+ history.jsonl 环境指纹防篡改（hashVersion: 2）+ post-commit hook 绕过检测 + SkillOpt CLI 契约修复（status 探针 + run 子命令 + parseArgs 误判）+ 文档一致性修复（README 规则分类 / CHANGELOG 纯度 / ROADMAP 日期对齐）。480 测试全绿，28/28 OpenClaw 验收，pre-push 7/7 全绿。
> 📖 [开发日志](./docs/changelog/v1.0.6.md)
### [v1.0.5] — Ontology 统一层 + Work模板市场 🔧
> 2026-07-12（UTC）
Ontology 三路合并引擎 + Work模板市场 独立项目 + A9 分级安全 + A15 绕过修复 + fail-closed 默认安全 + 原子文件写入 + 安全加固。DeepAgents 接入层保留为 optional wrapper，编排迁移推到 v1.0.6-v1.0.7。472 测试全绿，pre-push 全绿。
> 📖 [开发日志](./docs/changelog/v1.0.5.md)

### 规划中
- **v1.1.0** — 包结构纯度重构（audit 只做 audit）：`@sofagent/audit` 上帝包拆为 11 独立包（harness / ontology / eval / core / orchestrator / daemon / ab-test / work模板市场 / think / skillopt / 纯审计 audit）+ 轻量多设备四件事（经验共享 / 权限作用域化 / 自迭代周报 / daemon 主动巡检）→ [开发日志](./docs/changelog/v1.1.0.md)

### [v1.0.4] — 自动优化 + 约束验证 🔧
> 2026-07-11（UTC）
Sub Agent 会自己变好了：eval harness 评分体系 + Sub Agent A/B 自动优化（SkillOpt 集成） + HITL 渐进自主度 + A15 约束验证。465 测试全绿，pre-push 全绿。
> 📖 [开发日志](./docs/changelog/v1.0.4.md)
### [v1.0.3] — 编排引擎重构 + LOOP 自迭代 🔧
> 2026-07-11（UTC）
三件事重合：FDE Sub Agent 成型（DeepAgentsJS + LangGraph 编排 + Agency Agents 岗位模板 + SkillOpt CLI 集成）+ LOOP 自迭代架构落地（4 Agent 定义 + 内外层循环设计 + 4 验证文件自动优化机制）+ 30 项修复。附带 releasing.md 八阶段发版 SOP + SOP 自我进化（FDE 提议→作者确认）+ check-docs 文档分层预算（5 层独立检查）。430 测试全绿，pre-push 全绿。
> 📖 [开发日志](./docs/changelog/v1.0.3.md)
### [v1.0.2] — 文档修正 + 规则对齐 🔧
> 2026-07-11（UTC）
v1.0.1 本版修复 15 项问题。修复覆盖：文档死链（README/HANDBOOK/DEVELOPMENT 6 处锚点）、SECURITY.md 安全报告渠道（Issue→Security Advisory）、规则数量不一致（11→16）、A14 include='*' 全放开检测、config 未知规则名校验、doctor 输出友好度、CI 修复指引、hook 错误标签、knowledge 目录自动创建、ROADMAP 状态矛盾。418 测试全绿。
> 📖 [开发日志](./docs/changelog/v1.0.2.md)
### [v1.0.1] — AI 知识库实现版 🔧
> 2026-07-11（UTC）
v1.0.0 本轮完成 AI 知识库代码实现——7 件事：目录骨架（6 子目录 + index.md/log.md）+ fde.md 维护规则章节（4 子规则，≤3200 字符）+ knowledge-maintain.md 新 Skill（71 行）+ 加载链三层→四层（knowledge 被动注入）+ daemon Ingest 触发（task/logs 变化检测 + 30 分钟防抖）+ loop-evaluate 5 项 Lint + loop-check 20 轮硬上限。附带 A14 知识库越权审计规则（hybrid 模式）+ deepagents 可选依赖（不阻断安装）+ Ontology relations（entities/ frontmatter 含 has_many/belongs_to）+ doctor 第 9 项知识库访问矩阵。418 测试全绿，37 test files。回归检查清单全覆盖。
> 📖 [开发日志](./docs/changelog/v1.0.1.md)
### [v1.0.0] — 正式版：Agent 审计工具 🎉
> 2026-07-10（UTC）
从技术预览到可生产使用。18 件事全部完成：铁律措辞强化 + 上线前验收测试 + daemon 文档校准 + FDE 隐性代价 + 准入条件推进 + 工具链加固 + 审计可视化升级 + 违规修复建议 + 安装仪式感 + 无声失败保护 + 首次提交噪音消除 + --init 一键初始化 + --doctor 健康诊断 + 审查 prompt 回归检查清单升级 + README 定位 + 升级迁移指引。408 测试全绿，3 名外部用户验证通过。
> 📖 [开发日志](./docs/changelog/v1.0.0.md)

---

## 实验版
> ⚠️ 以下版本号为实验/测试版，产品形态和技术方案在此期间经历多次重大调整。正式版从 v1.0.0 开始。
### [v0.99.9] — AI 知识库概念 + verify.ts 拆分 + 行业笔记 + 理论基础 🔧
> 2026-07-07（UTC）
AI 知识库 6 文档概念先行（架构定位+边界划分）+ verify.ts 1257 行代码拆分（→ 4 模块）+ 7 项行业笔记写入 ROADMAP/ARCHITECTURE + Skill 摘要信息架构优化（去掉步骤性描述，只留触发条件）+ Hugging Face/AutoResearch/Akshay 理论基础引证（ARCHITECTURE 新增「理论基础与外部验证」节）。**v0.99.x 修复线最终版。**
> 📖 [开发日志](./docs/changelog/experimental/v0.99.9.md)

---
### [v0.99.8] — 文档收尾 + FDE 架构重构 ✅
> 2026-07-05（UTC）
文档数字全面对齐（30/30→33/33，41/41→48）+ GitHub Actions 升级 v5 + PR check workflow 新建 + shellcheck SC2086/SC2155 排除项收窄 + check-version 新增 --strict 模式 + v1.0 准入诚实化（3/10 ✅→2/10 ✅）+ **FDE 架构重构**（四层→三层实体、删 workflow/agents、templates 镜像产出结构、Skill 精简 925→742 行）+ FDE 非开发者快速入门。**v0.99.x 修复线收尾版。**
> 📖 [开发日志](./docs/changelog/experimental/v0.99.8.md)

---
### [v0.99.7] — 发布基础设施修复版 ✅
> 2026-07-04（UTC）· 北京时间 07-05
首次「npm 先行」发布策略。修复：CI 版本检查 / OIDC→NPM_TOKEN 12+ 处 / mcp 依赖解锁 / 回滚文档 / shellcheck 清零 / Windows 诚实标注 / logo 压缩 84%。详见 [开发日志](./docs/changelog/experimental/v0.99.7.md)。
> 📖 [开发日志](./docs/changelog/experimental/v0.99.7.md)
### [v0.99.6] — npm 双包发布 + 25 项修复 ✅
> 2026-07-04
npm 双包发布 + 25 项修复。复盘发现「发版前推前预检脚本救了我们 4 次」。
**npm 发布**：@sofagent/audit 0.99.6 · @sofagent/mcp 0.99.6（手动首发，CI 加版本检查后续自动跳过）
**修复概要**：release CI 优化 / evidence 注释修正 / bump-version 增强 / 11 项文档构建修复。详见 [开发日志](./docs/changelog/experimental/v0.99.6.md)。
> 📖 [开发日志](./docs/changelog/experimental/v0.99.6.md)
### [v0.99.5] — CI 自动化 + npm 发布 ✅
> 2026-07-03 初版 / 2026-07-04 修复
NPM_TOKEN 自动发布 + 文案对齐（07-03）。bump-version/check-version 增强，全仓版本号/日期一致性清零（07-04）。
>
> 📖 [开发日志](./docs/changelog/experimental/v0.99.5.md)
### [v0.99.4] — 准入诚实化 + 41 项修复 ✅
> 2026-07-02
41 项全面修复，准入条件从 6✅ 诚实化为 3✅，全仓 doc-vs-reality 清零。
> 📖 [开发日志](./docs/changelog/experimental/v0.99.4.md)
### [v0.99.3] — 文档校准版 ✅
> 2026-06-29
16 项一致性清零（check-version 30/30）。benchmark 幽灵引用修复，bump-version.sh Unicode bug 修复。v1.0 前的一轮文档收尾。
> 📖 [开发日志](./docs/changelog/experimental/v0.99.3.md)
### [v0.99.2] — 质量加固版 ✅
> 2026-07-01
v1.0 前最后一次质量加固。18 项修复（daemon 歧义根治 + 死链清零）。
> 📖 [开发日志](./docs/changelog/experimental/v0.99.2.md)
### [v0.99.1] — OpenClaw 叙事重写 + MCP 独立包 ✅
> 2026-06-28
OpenClaw 叙事重写（术语统一为「FDE 的工具包」）。手写 YAML→js-yaml，MCP Server 拆分为 @sofagent/mcp 独立包。局限声明修正。
> 📖 [开发日志](./docs/changelog/experimental/v0.99.1.md)
### [v0.99] — v1.0 前收尾版 ✅
> 2026-06-26（当时 398 tests，v0.99.1 增至 406）
Skill 全部 ≤90 行。44 处死链清零。放弃条件正式写入 ROADMAP。bus factor + 模型依赖声明。FDE 工具包（/FDE + sofagent-fde Skill）首次交付。文档预算 ≤5,000。
> 📖 [开发日志](./docs/changelog/experimental/v0.99.md)
### [v0.98] — 架构重组版
> 2026-06-24
产品核心从事前约束转向事后审计 + FDE 企业部署。100 次对照实验结论作废。OpenClaw 重定义为必装引擎。v1.0 定位从「Agent 工作验收工具」转向「FDE 工具包」。
> 📖 [开发日志](./docs/changelog/experimental/v0.98.md)
### [v0.97] — 证据版本 ✅
> 2026-06-22
审计 A9/A10/A11 + 编排引擎重构 + bash→TS 第二波。约束底座 100 次对照实验因方法缺陷结果作废。
> 📖 [开发日志](./docs/changelog/experimental/v0.97.md)
### [v0.96] — 诚实收缩
> 2026-06-20
README 373→166 行六段式重构。AI 中台叙事贯通。bash→TS 第一波（3 个僵尸脚本 + task-orchestrate）。铁律重排 + 审计 A9/A10/A11 草案。
> 📖 [开发日志](./docs/changelog/experimental/v0.96.md)
### [v0.95] — 审计体系重构
> 2026-06-18
审计体系重构（4·6·8·4）+ 铁律 10→6。目录改名 sofagent-audit/ → sofagent/audit/。ARCHITECTURE 三源收敛（Ralph Loop + MiroFish + 卡普二分法）。MCP/Agency 推 v1.0。
> 📖 [开发日志](./docs/changelog/experimental/v0.95.md)
### [v0.94] — 工程硬伤止血
> 2026-06-16
工程硬伤止血 + 审计独立化（沉默模式 + 7 条纯 diff 规则）+ FDE 部署者优先。双轮评审后重排。
> 📖 [开发日志](./docs/changelog/experimental/v0.94.md)
### [v0.93] — 工程迁移
> 2026-06-14
v0.92 修复 17 项中 11 项落地（4 项 FP 修复 + 审计规则扩展）。bash→TS 起步。10 组对照实验：约束底座增量 = f(陷阱难度)。
> 📖 [开发日志](./docs/changelog/experimental/v0.93.md)
### [v0.92] — 安全加固 + 工程止血
> 2026-06-13
v0.91 安全加固 + 工程止血——安全硬伤 + 工程欠债 + 改进。
> 📖 [开发日志](./docs/changelog/experimental/v0.92.md)
### [v0.91] — sofagent-audit MVP ✅
> 2026-06-12
sofagent-audit MVP 核心实现（4 条规则，bash 实现，v0.92 起逐步 TS 化）。文档瘦身 47%。
> 📖 [开发日志](./docs/changelog/experimental/v0.91.md)
### [v0.90] — 安全审查
> 2026-06-10
skill-safety-check（22 条正则 + LLM 双门）。三个安装断裂修复。7 个 SOP 中间产物清理。
> 📖 [开发日志](./docs/changelog/experimental/v0.90.md)
### [v0.86] — 运行时加固
> 2026-06-09
读写型任务分流 + Loop 成熟度四问 + 管道闸门——Agent 拆任务更聪明，不容易跑偏。
> 📖 [开发日志](./docs/changelog/experimental/v0.86.md)
### [v0.85] — 定位重构
> 2026-06-08
定位重构（治理层→约束底座）+ ROADMAP 砍削（20+→6 项）——基于独立评审的战略校准。
> 📖 [开发日志](./docs/changelog/experimental/v0.85.md)
### [v0.84] — 证据打磨
> 2026-06-07
A/B benchmark 五组数据 + 4 底线优化 + Hook 归因修正。核心发现：差异化在约束底座不在约束层。
> 📖 [开发日志](./docs/changelog/experimental/v0.84.md)
### [v0.83] — 安装修复
> 2026-06-05
安装断裂修复 + 代码加固 + 文档诚实度修正。纯 bugfix。
> 📖 [开发日志](./docs/changelog/experimental/v0.83.md)
### [v0.82] — 五平台实测
> 2026-06-03
评审问题修复 + 五平台实测 5/5 + ROADMAP 重构 + License MIT。核心结论：Hook 级治理加固仅在 OpenClaw 生效。
> 📖 [开发日志](./docs/changelog/experimental/v0.82.md)
### [v0.81] — daemon 骨架
> 2026-06-01
daemon 核心骨架（纯 bash：launchd/systemd + 文件 hash 监控）+ 5 项治理加固（幂等/步数闸/熔断闸/评判器隔离/怀疑论提示）。
> 📖 [开发日志](./docs/changelog/experimental/v0.81.md)

## v0.47–v0.80 — 早期开发期（摘要）
> 这段时间每个版本间隔 1-3 天，改动密集。只保留摘要，详细日志在 [docs/changelog/](./docs/changelog/) 下。
| 版本区间 | 主题 |
|---------|------|
| v0.70–v0.80 | 企业合规三件套（脱敏/保留/审计）+ daemon 开发（v0.76-0.80 内部版本，合并至 v0.81 发布） |
| v0.60–v0.63 | 架构重构（扁平化 + 诚实化）+ CI 闭环 |
| v0.54–v0.56 | 加载链防漏读 + Handbook 拆分 |
| v0.51–v0.53 | 宣称对齐 + 评审反馈修复 |
| v0.47–v0.50 | 项目首次发布 + 安装断裂修复 |
> 早期版本的完整日志在 [docs/changelog/](./docs/changelog/) 目录下。
