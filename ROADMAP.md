# 路线图 · Roadmap

> 已经做了什么、未来要去哪、哪些地方需要你的帮助。
> v0.99.5 · 2026-07-04 · CI 自动化 + 审查修复版——OIDC Trusted Publishing + P0×6/P1×10 修复
>

> 🎯 **v1.0 定位**：**Agent 审计工具**——git diff 硬证据审计，装 pre-commit hook，每次 Agent 提交自动扫描代码变更。编排引擎（FDE 部署用）为实验性附带。

---

## 现在在哪：v0.99.5

> v0.99.5 是 CI 自动化版本（OIDC Trusted Publishing）+ 2026-07-04 审查修复（P0×6 + P1×10 + 工具增强）。以下 v0.99.4 的交付描述仍然有效。
>
> v0.99.4 是 **审查修复版**——41 项全面修复（P0×7 + P1×15 + P2×19），基于 DeepSeek V4 Pro + GLM-5.2 双模型独立审查 + 齐活林交叉查漏。准入条件从 6✅/4⚠️ 诚实化为 3✅/7⚠️，全仓 doc-vs-reality 清零。

| 级别 | 交付 | 状态 |
|------|------|:----:|
| P0 | evidence「4家→1家」诚信修复 + ROADMAP 准入 3✅→⚠️ + npm pack .js.map→0 + verify 50→41项 + mcp VERSION TODO + mcp 零测试声明 + FDE case 原始数据声明 | ✅ |
| P1 | README/HANDBOOK 定位收敛 + CHANGELOG 数字对齐 + FDE 成熟度声明 + bin 构成注明 + orchestrate TODO 标注 + 连续胜出文档诚实化 + check-version/bump-version 修复 + verify ⚠ 标注 + 集成测试声明 + 闭环→多维 | ✅ |
| P2 | ARCHITECTURE 人设移除 + AI 工程段精简 + README 精简 + Rolling AI 因果 + 人称一致性 + ROADMAP v1.x 规划（A12/A13/规则模板/测试工具） | ✅ |

> 📖 [详细开发日志](./docs/changelog/v0.99.4.md) · v1.0 准入条件进度：3/10 ✅ + 7/10 ⚠️

### v0.99.3 — 文档校准版

| 级别 | 交付 | 状态 |
|------|------|:----:|
| P0 | benchmark.sh 幽灵引用清零——7 处文档引用改为 verify.sh | ✅ |
| P0 | ROADMAP v1.0 准入条件三处口径统一（经独立审查修正为 6/10 ✅ + 4/10 ⚠️，v0.99.4 重新评定为 3/10 ✅ + 7/10 ⚠️） | ✅ |
| P0 | bump-version.sh Unicode 编码 bug 修复 | ✅ |
| P1 | 全量外部链接验证 + windows-ci.yml vitest 跳过注释 + CI workflow 合并（audit.yml→sofagent-audit.yml） | ✅ |
| P1 | CONTRIBUTING 版本号修正 + CoC 去重 | ✅ |
| P2 | 术语全线清零：CHANGELOG 7 处纪律层/纪律底座→约束底座 + THINK.md 术语注 | ✅ |
| P2 | evidence 量化锚点更新 + benchmark 段落状态声明 + team-deploy 部署流程修正 | ✅ |
| P2 | mcp-server-design 日期修正 + daemon-design 版本号 | ✅ |
| P2 | mcp-server.ts + mcp-push-poc.ts 归档至 _archive/ + mcp/package.json files 字段 | ✅ |
| P2 | ROADMAP 放弃条件节删除 | ✅ |
| P2 | CHANGELOG v0.99 条目 398→406 注记 | ✅ |

> 📖 [详细开发日志](./docs/changelog/v0.99.3.md) · v1.0 准入条件进度：3/10 ✅ + 7/10 ⚠️

### v0.99.2 — 审查驱动质量修复版

> 两份独立十维审查，三轮修复 25+ 问题。v1.0 前的最后一次质量加固。

| 级别 | 交付 | 状态 |
|------|------|:----:|
| P0 | evidence 测试数 398 vs 406 不一致 + DEVELOPMENT/SECURITY 过期引用 task-orchestrate 修复 | ✅ |
| P0 | ROADMAP daemon 准入条件 `❌ 移除` → `✅`（根治 LLM 误读） | ✅ |
| P1 | HANDBOOK 死链 + 中英文 README 不对等 + daemon 6 文件描述统一 | ✅ |
| P1 | dist/ 僵尸编译产物（prepublishOnly 清 dist）+ Skill 计数统一 + 作者背景三处矛盾 | ✅ |
| P1 | 术语中英文对齐（ARCHITECTURE 术语对照表）+ bin 命名统一 + 贡献者阶梯引用 | ✅ |
| P2 | orchestrate-compare 时间窗口/连续胜出/Windows 兼容 + audit-history 并发安全 | ✅ |

> 📖 [详细开发日志](./docs/changelog/v0.99.2.md) · 6/6 测试用例全绿 · 3 项 v1.0 准入条件 ⏳→✅、3 项 ⏳→⚠️ · 审计引擎检出率首次实测 5/5 100% · 406 tests ✅

### v0.99.1 — 审查跟进版

| 级别 | 交付 | 状态 |
|------|------|:----:|
| P0 | OpenClaw 叙事重写（README/ARCHITECTURE/LIMITATIONS 中英文 + 术语统一） | ✅ |
| P0 | 手写 YAML 解析器 → js-yaml（config-loader.ts -102行） | ✅ |
| P0 | MCP Server 独立包拆分（@sofagent/mcp，npm workspaces） | ✅ |
| P0 | FDE 验证状态修正 + 编排引擎/模型依赖局限声明新增 | ✅ |
| P1 | Case study 模板 + 审计引擎边界修复 + 叙事降调 | ✅ |
| P2 | CI/CD 扩展（release workflow）+ CONTRIBUTING 链接更新 | ✅ |

> 📖 [详细开发日志](./docs/changelog/v0.99.1.md)

### v0.99 — v1.0 前收尾版

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
| **v0.99.5** | CI 自动化 + 审查修复：OIDC Trusted Publishing + P0×6/P1×10 修复 + 工具增强 | [📖](./docs/changelog/v0.99.5.md) |
| **v0.99.4** | 审查修复：41 项全面修复，准入 6✅→3✅ 诚实化，doc-vs-reality 清零，闭环→多维 | [📖](./docs/changelog/v0.99.4.md) |
| **v0.99.3** | 文档校准：16 项一致性清零（术语/幽灵引用/ROADMAP/CI/归档）+ bump-version 修复 | [📖](./docs/changelog/v0.99.3.md) |
| **v0.99.2** | 审查修复：daemon 歧义根治 + 死链清零 + 文档一致性 + P2 清零 | [📖](./docs/changelog/v0.99.2.md) |
| **v0.99.1** | 审查跟进：OpenClaw 叙事重写 + YAML→js-yaml + MCP 独立包 + 局限声明修正 | [📖](./docs/changelog/v0.99.1.md) |
| **v0.99** | v1.0 前收尾：两份审查修复 + Skill≤90行 + 放弃条件 + MCP Server + verify→TS | [📖](./docs/changelog/v0.99.md) |
| **v0.98** | 架构重组：产品核心转为事后审计 + FDE 企业部署 + OpenClaw 必装 | [📖](./docs/changelog/v0.98.md) |
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
| **v0.7x** | 企业合规：数据保留 + task/logs 脱敏 + 审计日志 | [📖](./docs/changelog/v0.75.md) |
| **v0.6x** | 质量加固：端到端测试 + 闭环验证 + WorkBuddy 专家团共存 | — |
| **v0.5x** | 企业级能力：install.sh/uninstall.sh + 离线模式 + 编排 fallback | — |
| **v0.1~v0.4** | 核心约束：4 底线 + 6 铁律 + Loop Agent + 三层闸门 + 渐进减薄 + 反思区 + scoring | — |

---

## 未来去哪

> 以下是**方向**，不是承诺。没实测过的事标「不知道」。

**终局**：FDE 用 Agent 对话 → sofagent 引导梳理 workflow → OpenClaw 执行 AI 节点 → 审计结果推送到协作平台。

两条路径：**FDE 驻场部署**（传统中小企业，FDE 进场→十步流程→交付→撤离）和 **开发者自部署**（开源社区，git clone→install.sh→审计→CI 集成）。

设备端形态：安装时自动带 OpenClaw，审计结果通过 MCP server 推到企业协同平台。**数据主权在设备**——所有记忆、日志、决策记录永不离开本地。

### v0.98-v0.99：架构重组 + v1.0 前收尾

**v0.98**：产品架构重组（lite 删除 + think.md 自动生成 + FDE 从 Skill 改为根目录文档）+ OpenClaw 重定义为必装引擎 + 审计闭环六步 + GitHub Action 模板 + install.sh 模块化。v0.98 交付明细已合并到下方 v0.99 交付表中。
**v0.99**：两份独立审查全面修复 + Skill 全部 ≤90 行 + 文档预算 4849≤5000 + 放弃条件引入 + bus factor 声明 + GitHub Action 模板 + MCP Server 实现 + verify.sh → TS 重构（sofagent-verify 第 6 个 bin）。FDE 端到端验证推迟 v1.0。
**v0.99.1**：审查跟进——OpenClaw 叙事重写（两层架构 / 审计层平台无关 / 编排层 FDE 工具包）+ P0 代码清理（手写 YAML→js-yaml、MCP Server 拆分为 @sofagent/mcp）+ 局限声明修正 + 案例模板

### v1.0 — 正式版：Agent 审计工具（+ FDE 编排引擎实验性附带）

三条主线：
1. FDE 引导逻辑 → 自动产出 workflow.yaml + 部署方案
2. 部署方案装到任意设备 → OpenClaw 跑 workflow AI 节点
3. 审计结果通过 MCP webhook 推送到协作平台

**状态符号说明**：
- ✅ = 已通过，无已知限制
- ⚠️ = 有条件通过——核心功能已实现并本地验证，但端到端全链路或跨平台覆盖尚未完成
- ❌ = 未通过
- ⏳ = 未开始验证

| # | v1.0 准入条件 | 状态 |
|:--:|------|------|
| 1 | 审计引擎检出率验证 | ✅ v0.99.2 首次实测——5/5 100% 检出（Case 015）。局限：靶向构造、未测误报率、非盲测 |
| 2 | 审计工具实现完整六步闭环 | ⚠️ 步骤 1-3 生产可用，步骤 4-6 实验性/技术预览（见 LIMITATIONS） |
| 3 | Harness 层上下文成本 ≤ 窗口 5% | ⚠️ ~2.5%（自报，无独立验证。「500 字原则」未达——SKILL.md≈2000+字，fde.md=1679 字符） |
| 4 | OpenClaw + AO compose 全链路跑通 | ⚠️ ao 0.7.5 compose 生成有效 workflow（v0.99.2 实测，216 角色可用，输出完整 YAML）。全链路运行（ao run）需 OpenClaw 会话 |
| 5 | MCP server + webhook 跑通 | ⚠️ MCP Server 本地通过（initialize/tools/list/tools/call）。Webhook 推送代码完整（`pushAuditResult` 支持 dingtalk/feishu/wecom，fire-and-forget），需真实 webhook URL 完成端到端 |
| 6 | daemon 核心功能通过自动化测试 | ⚠️ 手动验证通过（Case 014），无独立自动化测试（见 LIMITATIONS） |
| 7 | ≥ 1 外部用户 + 5 个一次性测试 | ⚠️ 关联企业已在试用，测试数据收集整理中 |
| 8 | install → verify → 首次任务通过率 ≥ 90% | ✅ v0.99.2 验证通过——verify.sh exit 0，检查全绿 |
| 9a | 三操作系统核心功能（build + tsc + smoke test） | ✅ macOS——Case 014。Linux——`daemon-linux-ci`。Windows——`windows-ci` |
| 9b | vitest 在 Windows 上全量通过 | ⚠️ rollup 原生模块兼容问题，单元测试待解决 |
**硬性截止日期**：2026-09-30。如果 #7 不达标 → v1.0 降为「审计工具技术预览版」。

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
| bash 代码债清理 | ~450 行重复代码 bash→TS 迁移完成 |
| 英文文档扩展 | HANDBOOK/DEVELOPMENT/ARCHITECTURE 英文翻译 |
| ARCHITECTURE 可读性 | 降低外部引用密度，让新人 10 分钟能看懂
| 恢复路径结构化 | think.md 记录失败但没有结构化恢复机制，等 JSONL 落地
| 审计规则模板消除重复 | RuleFunction 类型工厂 + Runner 注册模式（15 个 rule-*.ts 减少 30% 重复代码）
| 测试工具函数提取 | makeDiffFile / runDiffParse 等重复定义收敛到 test-utils.ts
| A12 供应链安全 | 依赖变更审计
| A13 文件权限 | chmod 操作检测
| MCP/Plugin/Skill/Hook 四组件扩展 | 在现有 MCP+Skill 基础上架构 Plugin+Hook 层
| 双闸验证：执行前 + 副作用写回前 | 审计从事后 diff 扩展到事前拦截
| loop-check 三元统一出口 | pass/fail/warn 收敛，对齐审计引擎 exit code 0/1/2
| 记忆产权三维框架 | 对象归属 / 锁定策略 / 边界定义补充到记忆层

### v2.x — 多设备协同：组织级 Agent Harness（规划中）

> 💡 定位澄清：v2.x 的本质不是"设备能通信"，而是"每个 AI 节点拥有独立身份，能主动进入协作现场"。这是从个人助手 Harness 到组织级 Agent Harness 的跨越——Agent 不再是某个人的工具，而是组织的独立成员。详见项目记忆中的 [组织级 Agent Harness 研判](.workbuddy/memory/MEMORY.md#组织级-agent-harness2026-06-30-cloudtag-研判笔记)。

四阶段渐进：协同编排协议（Markdown 优先）→ Agent 发现与注册 → 跨设备任务分发 → 企业 Agent 知识库（多设备蒸馏记忆聚合到企业自有 NAS/云盘，底层用 [Graphify](https://github.com/safishamsi/graphify) 轻量知识图谱）

> 🧠 **技术底座参考 — A2A 协议**：Google A2A（Agent-to-Agent）协议为多智能体协作定义了三个关键层级：① 动态服务发现（Agent 版 DNS——Agent 广播能力，匹配条件者自动响应）、② 能力契约对齐（入参/输出 Schema 握手，消除自然语言歧义）、③ 全状态接力（任务交接时同时移交执行目标 + 前置共识 + 专属记忆）。MCP 解决「脑和手」的工具调用，A2A 解决「脑和脑」的协作分工。
>
> 同时也需防御 A2A 的三大工程雷区：**语义漂移**（多 Agent 链路中每层推理偏差累积导致末端动作与原始需求南辕北辙）、**死循环雪崩**（Agent 互等形成逻辑闭环，数秒内耗尽 Token 预算）、**权限穿透**（低权限 Agent 构造恶意 A2A 请求诱骗高权限 Agent 执行危险操作）。防御方案三板斧：协调者中枢监控 + 强类型 Schema 前置拦截 + 零信任动态令牌——这三条将纳入 sofagent v2.x 的审计规则体系。

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
| PE/VC 多企业审计仪表盘 | 投后管理场景——所有被投企业的 AI 审计数据汇总到一个面板，投后团队统一监控 |
| FDE 陪跑期机制 | 部署后前 2 周 AI 节点 daily review，人类反馈和 AI 反思双向写入 think.md |

---

## 不需要的

以下认真考虑过但决定不做：

| 想法 | 为什么不 |
|------|------|
| 自研行为验证器 | OpenClaw 原生 `tools.loopDetection` 已覆盖 |
| 定时触发（cron） | 所有 Agent 平台都不支持 cron 级定时 |
| 动态 Skill Hook | OpenClaw 不支持 Skill 级动态 Hook |
| Connector | sofagent 是 Harness 层 + 审计引擎，不是自动化流水线 |
| 记忆压缩自动化 | 每个 Agent 有自己的记忆 |
| sofagent-lite 独立产品 | OpenClaw 自带约束机制，独立宪法 skill 多余 |
| 平台能力矩阵五平台 | 后台统一 OpenClaw |
| 三层加载链叙事 | 三层拆分为独立产品 |
| sofagent-fde 独立 Skill | 改为 FDE/FDE.md，FDE 自己装 |
| Harness 层实验第三次重跑 | 两次各 100 次都因任务设计无法结论 |
| 全栈组织级 Harness 产品 | sofagent 只做约束规范 + 审计工具 |

---

## 欢迎参与

| 你能做的事 | 时间 | 说明 |
|------|:--:|------|
| 跨平台测试 | 30 min | 你有 Codex / Hermes / Claude Code？装一下告诉我们 |
| 补充 FAQ | 20 min | 你踩了什么坑？直接改 HANDBOOK §三（排查问题） |
| 文档翻译 | 1-2 h | 英文翻译对社区意义巨大 |
| 第三方证据 | 1 周 | 装完用一周，填 EVIDENCE.md |
| 安全审计 | 不限 | 给 SECURITY.md 挑刺 |
| 企业场景反馈 | 30 min | 你们团队怎么用 Agent？直接开 Issue |

→ [CONTRIBUTING.md](./CONTRIBUTING.md)
