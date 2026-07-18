# Changelog

每个版本的详细开发日志在 docs/changelog/ 下。v1.0.0+ 为正式版，v0.x 实验版日志在 [docs/archive/changelog-experimental/](./docs/archive/changelog-experimental/)。本文件是目录索引。
> v1.1.4 · 2026-07-18（UTC）· 孔放勋

---

## 正式版

### [v1.1.4] — LOOP 独立产品化 + 工具注入 + A18/A19 + CI 修复
> 2026-07-19（UTC）· 待发版
**核心变更**：① **LOOP 独立产品化**——workflow 代码从 orchestrator 分离到 `LOOP/`，配套 `loop-install.sh` 全栈部署；Skill 命名统一（engineering-* → sofagent-*）；`work模板市场` → `模板市场`（三层命名规则：大写=独立产品）。② **LOOP 工具注入**——engineer/reviewer 从零工具升级为 6 工具集（read/write/edit/bash/search/test），支持双模型配置 + IS_PASS 自动门控。③ **新审计规则**：A18 垃圾文件检测 + A19 commit message 质量（规则集 19→21）。④ **daemon 可见性修复**（v1.1.0 拆包后 plist 参数错误导致 daemon 从未运行）+ USB federation 基础检测 + WARN 累积报告巡检器。
**缺陷修复**：11 包 ESM exports 修复（CI vitest 全绿）+ 🔴 **release.yml publish-audit 修复**（v1.1.1-v1.1.3 npm publish 持续失败根因——CI 漏 build @sofagent/core）+ maxTurns=20 + WARN 写入 history + run_bash 高危命令黑名单。
**质量验证**：660 tests across 12 packages 全绿 · acceptance-test 50/50 · check-version 67/67 · pre-push-check 13 通过/1 警告（共 14 项）。
> 📖 [开发日志](./docs/changelog/v1.1.4.md)

### [v1.1.3] — LangGraph StateGraph 直接编排 + Checkpoint + HITL
> 2026-07-18（UTC）· 已发版
**核心变更**：编排控制从 DeepAgents compose（一次性生成 YAML）上提为 sofagent 直接掌握的 LangGraph StateGraph 节点级流转——四节点（engineer → audit → reviewer → human_confirm）自动流转 + 条件路由（FAIL 回 engineer，3 轮重试上限 + blocked 终态）+ Checkpoint 持久化（并发安全：原子写/文件锁/schemaVersion/latest 指针）+ HITL 确认节点（y/n + --resume 断点续跑）。`@langchain/langgraph@^1.4.7` 首次成为直接依赖。daemon 集成顺延 v1.1.4。
**缺陷修复**：跨包代码重复清零、silent 模式 exit code 修正、PASS 输出品牌签名、CHANGELOG 补 v1.1.1 索引、「回溯引擎」更名「回溯能力」、pre-push 新增 tag message 校验与依赖循环检测。
**质量验证**：558 tests across 12 packages 全绿 · acceptance-test 55/55 · check-version 67/67 · pre-push-check 15 通过/0 失败（共 16 项）。
> 📖 [开发日志](./docs/changelog/v1.1.3.md)

### [v1.1.2] — LOOP 双 Agent 串联 + Harness 可见性
> 2026-07-15（UTC）· 已发版
**核心变更**：LOOP 双 Agent 自迭代（engineer → audit → reviewer）+ Harness 可见性三层签名机制（CLI/Webhook/MCP/审查报告输出带 sofagent 身份）+ orchestrator/mcp 实质 smoke 测试。
> 📖 [开发日志](./docs/changelog/v1.1.2.md)

### [v1.1.1] — 双 Agent 串联验证 + 记忆契约代码化 + 多设备同步
> 2026-07-16（UTC+8）· 已发版
**核心变更**：LOOP 双 Agent 端到端串联（engineer → audit → reviewer）+ Harness 可见性签名机制（CLI/Webhook/MCP/审查报告）+ 多设备同步指南（4 种方案）+ think.md 记忆契约代码级单一事实来源（core/memory-contract.ts）+ 全仓质量审计 6 类问题收口。V1.1.0 发布后 16 项修复收敛。
> 📖 [开发日志](./docs/changelog/v1.1.1.md)

### [v1.1.0] — 包结构纯度重构（12 包独立）+ 轻量多设备 🎉
> 2026-07-14（UTC）· 已发版
**核心变更**：`@sofagent/audit` 拆分为 12 个独立 npm 包，按基础层/运行层/协议层/纯审计四层清晰分层。**新功能**：权限作用域化（permission.local.json 项目级 override）+ 经验共享（跨设备 knowledge/shared/ + think.md 语义合并）+ 自迭代周报（daemon 从 think.md 自动提取踩坑经验）+ 主动巡检（daemon 4 项定时巡检）。**继承修复**：v1.0.9 发布后修复的 19 项文档/代码问题。**破坏性变更**：CLI 子命令迁移到新包二进制（`sofagent-audit compose` → `sofagent-orchestrator compose` 等）。
**文档维护**：审计规则编号口径收敛——全仓库统一为「A1-A11、A14-A17 + E1-E4（共 19 条）」写法，修复 FDE/ARCHITECTURE/DEVELOPMENT/HANDBOOK 断链、加载链「三层→四层」矛盾与版本滞后（v1.0.x→v1.1.0）。
> 本次为 12 包 monorepo 拆分，单提交含 387 文件，属架构重组非功能变更。
> 📖 [开发日志](./docs/changelog/v1.1.0.md)

### [v1.0.9] — 二进制文件审计 + 快照时间线 + MCP compose tool + 安全加固 + 遗留补齐 🔧
> 2026-07-14（UTC）· 已发版（tag v1.0.9 @ 366eb54，2026-07-14）
**核心新功能**：A16 非授权文件变更 + A17 异常批量变更（二进制文件行为级审计）+ `--timeline` 快照时间线可视化 + `--revert` 回滚 + MCP compose tool（编排引擎通过标准 MCP 协议对 Agent 平台暴露）。EvidenceMode 类型扩展 `'filesystem'` 模式。daemon 审计闭环（文件变更→diff→runRules→快照→binary_history 全链路打通）+ daemon cron @weekly/@daily/@hourly 定时 FDE 巡检 + `--doctor` fs-watch 运行状态检测 + `install.sh --with-memory` TencentDB Memory 集成。
**安全修复**：A9 中文注入检测（追加 9 条中文正则，`忽略以上所有指令` 等模式正确拦截）+ `--diff` 模式 commitMsg 从区间终点取而非 HEAD。
**缺陷修复**：fs-watch 递归监控（子目录文件变更不再遗漏）+ config-loader knownKeys 补 a16/a17 + rules/index.ts 注释同步 A14-A17 + acceptance-test pipefail 全面保护（`git_log_has()` 函数统一封装）+ diff-ref 语义修正（非范围 ref 原样返回）+ 文档预算上限调整（5500→5600）。531 tests across 12 packages（workspace 汇总口径），acceptance-test 35/35 全绿，pre-push 7/7 全绿，check-version 39/39。
> 📖 [开发日志](./docs/changelog/v1.0.9.md)

### [v1.0.8] — FDE Agent 自进化 + 文件系统审计 + 内嵌 isomorphic-git + Agent 定义去耦合 🔧
> 2026-07-13（UTC）
FDE Agent 双模式（部署 deploy + 持续优化 sustain）构成自进化闭环（Audit 管底线、FDE sustain 管上限）+ 文件系统审计（isomorphic-git 隐藏 repo + fs-watch daemon + 5s 防抖 + 快照回溯 `--revert`）+ Agent 定义去 OpenClaw 耦合（`session.spawn` 零命中，Sub Agent 可在个人节点直跑）+ TencentDB Memory 集成（persona.md 注入加载链）+ Ontology 人类可读视图（`ontology view`）。审计语义从"git commit 拦截"扩展为"文件变更告警 + 回溯"，覆盖非开发者。

**发版后修复**：版本号全量 bump（91 文件一致）+ verify.js 脚本目录解析兼容 monorepo 嵌套。493 tests across 12 packages（workspace 汇总口径），pre-push 7/7 全绿，OpenClaw 28/28 验收全绿，回归检查清单（256 维度）质量验证全通过。
> 📖 [开发日志](./docs/changelog/v1.0.8.md)

### [v1.0.7] — 双节点架构 + Sub Agent 约束自加载 + ao 完全退役 🔧
> 2026-07-13（UTC）
> 🔴 **Breaking Change**：ao（agency-orchestrator）已完全退役。v1.0.6 用户升级到 v1.0.7 后需手动卸载：`npm uninstall -g agency-orchestrator`。编排引擎已全面迁移到 DeepAgents。

Sub Agent 约束自加载（buildConstrainedSystemPrompt，平台无关）+ CLI 编排入口（sofagent-audit compose）+ ao 代码全部清除（deepagents 提升为正式依赖）+ 审计 fast-fail（critical 层 FAIL 即停）+ A/B 自动切换（连续胜出计数器）+ 方案C运行器升级 + 双节点架构文档。v1.0.6 补丁修复（post-commit hook 误报修复 / --init 自动创建 .gitignore / 测试数对齐 / CHANGELOG 纯度 / 根目录归位 / 文档一致性等）。493 tests across 12 packages（workspace 汇总口径），pre-push 全绿。
> 📖 [开发日志](./docs/changelog/v1.0.7.md)

### [v1.0.6] — 编排迁移 + A/B 真实运行器 + 安全加固 + SkillOpt CLI 修复 🔧
> 2026-07-13（UTC）
DeepAgents compose 迁移（ao 降为 fallback）+ Sub Agent 状态管理（runtime.json 心跳）+ A/B 真实运行器（模型 API 直跑，自动评估 + 手动 promote）+ history.jsonl 环境指纹防篡改（hashVersion: 2）+ post-commit hook 绕过检测 + SkillOpt CLI 契约修复（status 探针 + run 子命令 + parseArgs 误判）+ 文档一致性修复（README 规则分类 / CHANGELOG 纯度 / ROADMAP 日期对齐）。480 tests across 12 packages（workspace 汇总口径），28/28 OpenClaw 验收，pre-push 7/7 全绿。
> 📖 [开发日志](./docs/changelog/v1.0.6.md)

### [v1.0.5] — Ontology 统一层 + Work模板市场 🔧
> 2026-07-12（UTC）
Ontology 三路合并引擎 + Work模板市场 独立项目 + A9 分级安全 + A15 绕过修复 + fail-closed 默认安全 + 原子文件写入 + 安全加固。DeepAgents 接入层保留为 optional wrapper，编排迁移推到 v1.0.6-v1.0.7。472 tests across 12 packages（workspace 汇总口径），pre-push 全绿。
> 📖 [开发日志](./docs/changelog/v1.0.5.md)

### [v1.0.4] — Sub Agent 自进化 🔧
> 2026-07-11（UTC）
Sub Agent 会自己变好了：eval harness 评分体系 + Sub Agent A/B 自动优化（SkillOpt 集成） + HITL 渐进自主度 + A15 约束验证。465 tests across 12 packages（workspace 汇总口径），pre-push 全绿。
> 📖 [开发日志](./docs/changelog/v1.0.4.md)

### [v1.0.3] — 编排引擎重构 + LOOP 自迭代 🔧
> 2026-07-11（UTC）
三件事重合：FDE Sub Agent 成型（DeepAgentsJS + LangGraph 编排 + Agency Agents 岗位模板 + SkillOpt CLI 集成）+ LOOP 自迭代架构落地（4 Agent 定义 + 内外层循环设计 + 4 验证文件自动优化机制）+ 30 项修复。附带 releasing.md 八阶段发版 SOP + SOP 自我进化（FDE 提议→作者确认）+ check-docs 文档分层预算（5 层独立检查）。430 tests across 12 packages（workspace 汇总口径），pre-push 全绿。
> 📖 [开发日志](./docs/changelog/v1.0.3.md)

### [v1.0.2] — 文档修正 + 规则对齐 🔧
> 2026-07-11（UTC）
v1.0.1 本版修复 15 项问题。修复覆盖：文档死链（README/HANDBOOK/DEVELOPMENT 6 处锚点）、SECURITY.md 安全报告渠道（Issue→Security Advisory）、规则数量不一致（11→16）、A14 include='*' 全放开检测、config 未知规则名校验、doctor 输出友好度、CI 修复指引、hook 错误标签、knowledge 目录自动创建、ROADMAP 状态矛盾。418 tests across 12 packages（workspace 汇总口径）。
> 📖 [开发日志](./docs/changelog/v1.0.2.md)

### [v1.0.1] — AI 知识库实现版 🔧
> 2026-07-11（UTC）
v1.0.0 本轮完成 AI 知识库代码实现——7 件事：目录骨架（6 子目录 + index.md/log.md）+ fde.md 维护规则章节（4 子规则，≤3200 字符）+ knowledge-maintain.md 新 Skill（71 行）+ 加载链三层→四层（knowledge 被动注入）+ daemon Ingest 触发（task/logs 变化检测 + 30 分钟防抖）+ loop-evaluate 5 项 Lint + loop-check 20 轮硬上限。附带 A14 知识库越权审计规则（hybrid 模式）+ deepagents 可选依赖（不阻断安装）+ Ontology relations（entities/ frontmatter 含 has_many/belongs_to）+ doctor 第 9 项知识库访问矩阵。418 tests across 12 packages（workspace 汇总口径），37 test files。回归检查清单全覆盖。
> 📖 [开发日志](./docs/changelog/v1.0.1.md)

### [v1.0.0] — 正式版：Agent 审计工具 🎉
> 2026-07-10（UTC）
从技术预览到可生产使用。18 件事全部完成：铁律措辞强化 + 上线前验收测试 + daemon 文档校准 + FDE 隐性代价 + 准入条件推进 + 工具链加固 + 审计可视化升级 + 违规修复建议 + 安装仪式感 + 无声失败保护 + 首次提交噪音消除 + --init 一键初始化 + --doctor 健康诊断 + 审查 prompt 回归检查清单升级 + README 定位 + 升级迁移指引。408 tests across 12 packages（workspace 汇总口径），3 名外部用户验证通过。
> 📖 [开发日志](./docs/changelog/v1.0.0.md)

---

## 规划中

### [v1.2.0] — 多设备知识联邦收口 🎉
> 规划中（v1.1.3~v1.1.9 子能力收口）
**核心变更**：LOOP 双 Agent 自循环 + LangGraph 编排 + OpenClaw MCP 知识联邦 + Dream Cycle 知识管道 + LLM Wiki 3 层分层 + AES-256-GCM 加密 + USB key 物理身份。7 个子版本 → 1 个联邦。v1.2.x 完整多设备协同的起点。
> 📖 [开发日志](./docs/changelog/v1.2.0.md)

### [v1.1.5] — releasing.md SOP 集成 + MCP knowledge resource 📋
> 规划中
**核心变更**：Agent 按 releasing.md 十二阶段 SOP 全流程自动发版 + 7 个 MCP knowledge resource。
> 📖 [开发日志](./docs/changelog/v1.1.5.md)

### [v1.1.6] — LLM Wiki 3 层分层 + conflict-check 📋
> 规划中
**核心变更**：Ledger-Views-Policy 显式映射 + daemon conflict-check（矛盾/孤儿/死链）。
> 📖 [开发日志](./docs/changelog/v1.1.6.md)

### [v1.1.7] — Dream Cycle 6 阶段 + sensitivity 📋
> 规划中
**核心变更**：gbrain Dream Cycle 精简 pipeline（fact→atom→cluster→synthesize→skillopt→embed）+ knowledge sensitivity 分级。
> 📖 [开发日志](./docs/changelog/v1.1.7.md)

### [v1.1.8] — 安全层 + 联邦查询 📋
> 规划中
**核心变更**：AES-256-GCM 加密 + ECDH 密钥交换 + 三条配对路径 + OpenClaw channel 联邦知识查询。
> 📖 [开发日志](./docs/changelog/v1.1.8.md)

### [v1.1.9] — USB 完整运行时 📋
> 规划中
**核心变更**：Node.js 单文件打包 + OpenClaw 便携化 + 跨平台启动脚本。U 盘插入 → 双击 start → 联邦在线 → 拔掉零残留。
> 📖 [开发日志](./docs/changelog/v1.1.9.md)

---

## 实验版
> ⚠️ 以下版本号为实验/测试版，产品形态和技术方案在此期间经历多次重大调整。正式版从 v1.0.0 开始。

<details>
<summary>v0.81–v0.99.9 实验版历史（30 个版本，点击展开）</summary>

### [v0.99.9] — AI 知识库概念 + verify.ts 拆分 + 行业笔记 + 理论基础 🔧
> 2026-07-07（UTC）
AI 知识库 6 文档概念先行（架构定位+边界划分）+ verify.ts 1257 行代码拆分（→ 4 模块）+ 7 项行业笔记写入 ROADMAP/ARCHITECTURE + Skill 摘要信息架构优化（去掉步骤性描述，只留触发条件）+ Hugging Face/AutoResearch/Akshay 理论基础引证（ARCHITECTURE 新增「理论基础与外部验证」节）。**v0.99.x 修复线最终版。**
> 📖 [开发日志](./docs/archive/changelog-experimental/v0.99.9.md)

---
### [v0.99.8] — 文档收尾 + FDE 架构重构 ✅
> 2026-07-05（UTC）
文档数字全面对齐（30/30→33/33，41/41→48）+ GitHub Actions 升级 v5 + PR check workflow 新建 + shellcheck SC2086/SC2155 排除项收窄 + check-version 新增 --strict 模式 + v1.0 准入诚实化（3/10 ✅→2/10 ✅）+ **FDE 架构重构**（四层→三层实体、删 workflow/agents、templates 镜像产出结构、Skill 精简 925→742 行）+ FDE 非开发者快速入门。**v0.99.x 修复线收尾版。**
> 📖 [开发日志](./docs/archive/changelog-experimental/v0.99.8.md)

---
### [v0.99.7] — 发布基础设施修复版 ✅
> 2026-07-04（UTC）· 北京时间 07-05
首次「npm 先行」发布策略。修复：CI 版本检查 / OIDC→NPM_TOKEN 12+ 处 / mcp 依赖解锁 / 回滚文档 / shellcheck 清零 / Windows 诚实标注 / logo 压缩 84%。详见 [开发日志](./docs/archive/changelog-experimental/v0.99.7.md)。
> 📖 [开发日志](./docs/archive/changelog-experimental/v0.99.7.md)
### [v0.99.6] — npm 双包发布 + 25 项修复 ✅
> 2026-07-04
npm 双包发布 + 25 项修复。复盘发现「发版前推前预检脚本救了我们 4 次」。
**npm 发布**：@sofagent/audit 0.99.6 · @sofagent/mcp 0.99.6（手动首发，CI 加版本检查后续自动跳过）
**修复概要**：release CI 优化 / evidence 注释修正 / bump-version 增强 / 11 项文档构建修复。详见 [开发日志](./docs/archive/changelog-experimental/v0.99.6.md)。
> 📖 [开发日志](./docs/archive/changelog-experimental/v0.99.6.md)
### [v0.99.5] — CI 自动化 + npm 发布 ✅
> 2026-07-03 初版 / 2026-07-04 修复
NPM_TOKEN 自动发布 + 文案对齐（07-03）。bump-version/check-version 增强，全仓版本号/日期一致性清零（07-04）。
>
> 📖 [开发日志](./docs/archive/changelog-experimental/v0.99.5.md)
### [v0.99.4] — 准入诚实化 + 41 项修复 ✅
> 2026-07-02
41 项全面修复，准入条件从 6✅ 诚实化为 3✅，全仓 doc-vs-reality 清零。
> 📖 [开发日志](./docs/archive/changelog-experimental/v0.99.4.md)
### [v0.99.3] — 文档校准版 ✅
> 2026-06-29
16 项一致性清零（check-version 30/30）。benchmark 幽灵引用修复，bump-version.sh Unicode bug 修复。v1.0 前的一轮文档收尾。
> 📖 [开发日志](./docs/archive/changelog-experimental/v0.99.3.md)
### [v0.99.2] — 质量加固版 ✅
> 2026-07-01
v1.0 前最后一次质量加固。18 项修复（daemon 歧义根治 + 死链清零）。
> 📖 [开发日志](./docs/archive/changelog-experimental/v0.99.2.md)
### [v0.99.1] — OpenClaw 叙事重写 + MCP 独立包 ✅
> 2026-06-28
OpenClaw 叙事重写（术语统一为「FDE 的工具包」）。手写 YAML→js-yaml，MCP Server 拆分为 @sofagent/mcp 独立包。局限声明修正。
> 📖 [开发日志](./docs/archive/changelog-experimental/v0.99.1.md)
### [v0.99] — v1.0 前收尾版 ✅
> 2026-06-26（当时 398 tests，v0.99.1 增至 406）
Skill 全部 ≤90 行。44 处死链清零。放弃条件正式写入 ROADMAP。bus factor + 模型依赖声明。FDE 工具包（/FDE + sofagent-fde Skill）首次交付。文档预算 ≤5,000。
> 📖 [开发日志](./docs/archive/changelog-experimental/v0.99.md)
### [v0.98] — 架构重组版
> 2026-06-24
产品核心从事前约束转向事后审计 + FDE 企业部署。100 次对照实验结论作废。OpenClaw 重定义为必装引擎。v1.0 定位从「Agent 工作验收工具」转向「FDE 工具包」。
> 📖 [开发日志](./docs/archive/changelog-experimental/v0.98.md)
### [v0.97] — 证据版本 ✅
> 2026-06-22
审计 A9/A10/A11 + 编排引擎重构 + bash→TS 第二波。约束底座 100 次对照实验因方法缺陷结果作废。
> 📖 [开发日志](./docs/archive/changelog-experimental/v0.97.md)
### [v0.96] — 诚实收缩
> 2026-06-20
README 373→166 行六段式重构。AI 中台叙事贯通。bash→TS 第一波（3 个僵尸脚本 + task-orchestrate）。铁律重排 + 审计 A9/A10/A11 草案。
> 📖 [开发日志](./docs/archive/changelog-experimental/v0.96.md)
### [v0.95] — 审计体系重构
> 2026-06-18
审计体系重构（4·6·8·4）+ 铁律 10→6。目录改名 sofagent-audit/ → sofagent/audit/。ARCHITECTURE 三源收敛（Ralph Loop + MiroFish + 卡普二分法）。MCP/Agency 推 v1.0。
> 📖 [开发日志](./docs/archive/changelog-experimental/v0.95.md)
### [v0.94] — 工程硬伤止血
> 2026-06-16
工程硬伤止血 + 审计独立化（沉默模式 + 7 条纯 diff 规则）+ FDE 部署者优先。双轮评审后重排。
> 📖 [开发日志](./docs/archive/changelog-experimental/v0.94.md)
### [v0.93] — 工程迁移
> 2026-06-14
v0.92 修复 17 项中 11 项落地（4 项 FP 修复 + 审计规则扩展）。bash→TS 起步。10 组对照实验：约束底座增量 = f(陷阱难度)。
> 📖 [开发日志](./docs/archive/changelog-experimental/v0.93.md)
### [v0.92] — 安全加固 + 工程止血
> 2026-06-13
v0.91 安全加固 + 工程止血——安全硬伤 + 工程欠债 + 改进。
> 📖 [开发日志](./docs/archive/changelog-experimental/v0.92.md)
### [v0.91] — sofagent-audit MVP ✅
> 2026-06-12
sofagent-audit MVP 核心实现（4 条规则，bash 实现，v0.92 起逐步 TS 化）。文档瘦身 47%。
> 📖 [开发日志](./docs/archive/changelog-experimental/v0.91.md)
### [v0.90] — 安全审查
> 2026-06-10
skill-safety-check（22 条正则 + LLM 双门）。三个安装断裂修复。7 个 SOP 中间产物清理。
> 📖 [开发日志](./docs/archive/changelog-experimental/v0.90.md)
### [v0.86] — 运行时加固
> 2026-06-09
读写型任务分流 + Loop 成熟度四问 + 管道闸门——Agent 拆任务更聪明，不容易跑偏。
> 📖 [开发日志](./docs/archive/changelog-experimental/v0.86.md)
### [v0.85] — 定位重构
> 2026-06-08
定位重构（治理层→约束底座）+ ROADMAP 砍削（20+→6 项）——基于独立评审的战略校准。
> 📖 [开发日志](./docs/archive/changelog-experimental/v0.85.md)
### [v0.84] — 证据打磨
> 2026-06-07
A/B benchmark 五组数据 + 4 底线优化 + Hook 归因修正。核心发现：差异化在约束底座不在约束层。
> 📖 [开发日志](./docs/archive/changelog-experimental/v0.84.md)
### [v0.83] — 安装修复
> 2026-06-05
安装断裂修复 + 代码加固 + 文档诚实度修正。纯 bugfix。
> 📖 [开发日志](./docs/archive/changelog-experimental/v0.83.md)
### [v0.82] — 五平台实测
> 2026-06-03
评审问题修复 + 五平台实测 5/5 + ROADMAP 重构 + License MIT。核心结论：Hook 级治理加固仅在 OpenClaw 生效。
> 📖 [开发日志](./docs/archive/changelog-experimental/v0.82.md)
### [v0.81] — daemon 骨架
> 2026-06-01
daemon 核心骨架（纯 bash：launchd/systemd + 文件 hash 监控）+ 5 项治理加固（幂等/步数闸/熔断闸/评判器隔离/怀疑论提示）。
> 📖 [开发日志](./docs/archive/changelog-experimental/v0.81.md)

</details>

## v0.47–v0.80 — 早期开发期（摘要）
> 这段时间每个版本间隔 1-3 天，改动密集。只保留摘要，详细日志在 [docs/changelog/](./docs/changelog/) 下。
| 版本区间 | 主题 |
|---------|------|
| v0.70–v0.80 | 企业合规三件套（脱敏/保留/审计）+ daemon 开发（v0.76-0.80 内部版本，合并至 v0.81 发布） |
| v0.60–v0.63 | 架构重构（扁平化 + 诚实化）+ CI 闭环 |
| v0.54–v0.56 | 加载链防漏读 + Handbook 拆分 |
| v0.51–v0.53 | 宣称对齐 + 评审反馈修复 |
| v0.47–v0.50 | 项目首次发布 + 安装断裂修复 |

> ℹ️ 以上区间涵盖此时期所有 git tag（含 v0.62, v0.63.1, v0.64, v0.70.0, v0.70.1, v0.71, v0.72, v0.73, v0.74, v0.75 等子版本），子版本无单独索引条目。
> 早期版本的完整日志在 [docs/changelog/](./docs/changelog/) 目录下。
