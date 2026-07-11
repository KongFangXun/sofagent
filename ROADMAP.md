# 路线图 · Roadmap

> 已经做了什么、未来要去哪、哪些地方需要你的帮助。
> v1.0.2 · 2026-07-11（UTC）· 审查修复版：15 项 P1-P3 修复 + 审查体系更新（144 维度回归清单 + 陌生视角 prompt 泛化）
>

> 🎯 **v1.0 定位**：**Agent 审计工具**——git diff 硬证据审计，装 pre-commit hook，每次 Agent 提交自动扫描代码变更。编排引擎（Workflow 梳理用）为实验性附带。

---

## 现在在哪：v1.0.2 ✅

> 审查修复版——v1.0.1 经双视角审查（GLM-5.2 + DeepSeek V4 Pro）发现 15 项 P1-P3 问题全部修复 + 审查体系更新（回归清单 138→144 维度 + 陌生视角 prompt 泛化 v1.0.1 特定内容）。修复覆盖：文档死链、安全报告渠道、规则数量不一致、A14 全放开检测、config 未知规则校验、doctor 输出友好度、CI 修复指引、hook 错误标签、knowledge 目录自动创建、ROADMAP 状态矛盾。418 测试全绿，144 维度回归检查清单。
>
> 📖 [开发日志](./docs/changelog/v1.0.2.md) · 完整版本历史见 [CHANGELOG](./CHANGELOG.md) 和 [迭代历程](#迭代历程)

---

## 迭代历程

> 倒叙排列，每个版本有独立开发日志。v0.x 为实验/测试版，v1.0.0 起为正式版。

| 版本 | 核心交付 | 日志 |
|------|------|:--:|
| **v1.0.2** 🔧 | 审查修复版：15 项 P1-P3 修复 + 审查体系更新（144 维度 + prompt 泛化） | [📖](./docs/changelog/v1.0.2.md) |
| **v1.0.1** 🔧 | AI 知识库实现版：7 件事（目录骨架/fde 规则/Skill/四层加载链/daemon Ingest/Lint/轮次上限）+ A14 越权审计 + 137 维度审查 | [📖](./docs/changelog/v1.0.1.md) |
| **v1.0.0** 🎉 | 正式版：Agent 审计工具——18 件事 + 408 测试全绿 + 106 维度审查 | [📖](./docs/changelog/v1.0.md) |
| *(实验/测试版)* | | |
| **v0.99.9** | AI 知识库概念先行 + 审查修复收尾 + verify.ts 拆分（1257→4模块）+ 行业笔记落地 + 理论引证 | [📖](./docs/changelog/experimental/v0.99.9.md) |
| **v0.99.8** | 审查修复收尾 + FDE 架构重构：双审查 20 项遗留全修 + FDE 四层→三层实体 + templates 镜像产出 + Skill 精简 | [📖](./docs/changelog/experimental/v0.99.8.md) |
| **v0.99.7** | 发布基础设施修复：CI E403 根治 + OIDC 清零 + mcp 依赖解锁 + shellcheck 清零 + Windows 标注 | [📖](./docs/changelog/experimental/v0.99.7.md) |
| **v0.99.6** | 审查修复：mcp npm 同步发布 + 文档一致性（25 项，双审驱动） | [📖](./docs/changelog/experimental/v0.99.6.md) |
| **v0.99.5** | CI 自动化 + 审查修复：NPM_TOKEN 自动发布 + P0×6/P1×10 修复 + 工具增强 | [📖](./docs/changelog/experimental/v0.99.5.md) |
| **v0.99.4** | 审查修复：41 项全面修复，准入 6✅→3✅ 诚实化，doc-vs-reality 清零，闭环→多维 | [📖](./docs/changelog/experimental/v0.99.4.md) |
| **v0.99.3** | 文档校准：16 项一致性清零（术语/幽灵引用/ROADMAP/CI/归档）+ bump-version 修复 | [📖](./docs/changelog/experimental/v0.99.3.md) |
| **v0.99.2** | 审查修复：daemon 歧义根治 + 死链清零 + 文档一致性 + P2 清零 | [📖](./docs/changelog/experimental/v0.99.2.md) |
| **v0.99.1** | 审查跟进：OpenClaw 叙事重写 + YAML→js-yaml + MCP 独立包 + 局限声明修正 | [📖](./docs/changelog/experimental/v0.99.1.md) |
| **v0.99** | v1.0 前收尾：两份审查修复 + Skill≤90行 + 放弃条件 + MCP Server + verify→TS | [📖](./docs/changelog/experimental/v0.99.md) |
| **v0.98** | 架构重组：产品核心转为事后审计 + FDE 企业部署 + OpenClaw 必装 | [📖](./docs/changelog/experimental/v0.98.md) |
| **v0.97** | 审计 A9/A10/A11 + 编排引擎重构（砍四级深度→两档拆解 + engage.md）+ bash→TS 第二波 + 概念精简 | [📖](./docs/changelog/experimental/v0.97.md) |
| **v0.96** | README 六段式重构（373→166行）+ bash→TS 第一波 + 铁律重排 + 编排定位澄清 | [📖](./docs/changelog/experimental/v0.96.md) |
| **v0.95** | 铁律精简 10→6（4 条移审计层）+ 目录改名 + 三源收敛 + FDE 商业模式 | [📖](./docs/changelog/experimental/v0.95.md) |
| **v0.94** | 6 项代码止血 + --silent 模式 + LogFormat 可插拔 + FDE Skill 部署者优先 | [📖](./docs/changelog/experimental/v0.94.md) |
| **v0.93** | 4 项 FP 修复 + bash→TS 迁移 + 27 cases FP=0% FN=0% + 10 组对照实验 | [📖](./docs/changelog/experimental/v0.93.md) |
| **v0.92** | 安全加固 + 信任模型声明 + 审计 A7 检测加固 + 工程欠债清算 + OpenClaw 对照实验 | [📖](./docs/changelog/experimental/v0.92.md) |
| **v0.91** | sofagent-audit MVP + ARCHITECTURE 瘦身（710→378行）+ COMMUNITY.md | [📖](./docs/changelog/experimental/v0.91.md) |
| **v0.86** | 读写型分流 + Loop 成熟度四问 + 19 项学习笔记约束 + 8 项评审反馈 | [📖](./docs/changelog/experimental/v0.86.md) |
| **v0.85** | 定位校准（「治理」→「纪律」）+ ROADMAP 砍削 + 45 组验证实验设计 + sofagent-audit 方向确立 | [📖](./docs/changelog/experimental/v0.85.md) |
| **v0.82** | 五平台实测 + 步数闸/熔断闸/幂等检查/评判器隔离在非 OpenClaw 平台均不生效确认 | [📖](./docs/changelog/experimental/v0.82.md) |
| **v0.81** | daemon 核心骨架 + 5 项治理加固 + macOS launchd + Linux systemd | [📖](./docs/changelog/experimental/v0.81.md) |
| **v0.75** | 降低试用门槛 + benchmark.sh + 英文 README + Co-maintainer 招募 | [📖](./docs/changelog/experimental/v0.75.md) |
| **v0.74** | 文档拆分去重 + verify.sh --quick + Scoring 基准线 | [📖](./docs/changelog/experimental/v0.74.md) |
| **v0.73** | 三道闸门体系 + 编排加固 + 记忆最小闭环 + scoring 第九维 | [📖](./docs/changelog/experimental/v0.73.md) |
| **v0.72** | README 平台能力表重构 + benchmark.sh + anti-cases | [📖](./docs/changelog/experimental/v0.72.md) |
| **v0.7x** | 企业合规：数据保留 + task/logs 脱敏 + 审计日志 | [📖](./docs/changelog/experimental/v0.75.md) |
| **v0.6x** | 质量加固：端到端测试 + 闭环验证 + WorkBuddy 专家团共存 | — |
| **v0.5x** | 企业级能力：install.sh/uninstall.sh + 离线模式 + 编排 fallback | — |
| **v0.1~v0.4** | 核心约束：4 底线 + 6 铁律 + Loop Agent + 三层闸门 + 渐进减薄 + 反思区 + scoring | — |

## 未来去哪

> 以下是**方向**，不是承诺。没实测过的事标「不知道」。

**终局**：企业不再需要 FDE。AI 节点部署后自主运行，审计引擎持续盯变更，编排引擎自动纠偏，知识库自我积累——人只需要偶尔看一眼 dashboard 确认一切正常。我们做的不是给企业装 AI，是让企业忘了我们的存在。

两条路径：**FDE 驻场部署**（传统中小企业，FDE 进场→四阶段十二步流程→交付→撤离）和 **开发者自部署**（开源社区，git clone→install.sh→审计→CI 集成）。

设备端形态：安装时自动带 OpenClaw，审计结果通过 MCP server 推到企业协同平台。**数据主权在设备**——所有记忆、日志、决策记录永不离开本地。

### 规划版本

| 版本 | 状态 | 核心交付 | 日志 |
|------|:--:|------|:--:|
| **v1.0.1** | ✅ 已完成 | AI 知识库 + 访问控制 + entities 实体关联 + deepagentsjs 引入 + think.md 模板 + loop-check 轮次上限 | [📖](./docs/changelog/v1.0.1.md) |
| **v1.0.2** | ✅ 已完成 | 审查修复版：15 项 P1-P3 修复 + 审查体系更新（144 维度 + prompt 泛化） | [📖](./docs/changelog/v1.0.2.md) |
| **v1.0.3** | ⏳ 待启动 | FDE Sub Agent + Audit Sub Agent（含成本） + SkillOpt 自进化 + think.md 判断单元结构化 | [📖](./docs/changelog/v1.0.3.md) |
| **v1.0.4** | ⏳ 待启动 | eval harness + Sub Agent A/B 自进化 + HITL 渐进自主度（suggest → approve → auto） + A15 约束验证 | [📖](./docs/changelog/v1.0.4.md) |
| **v1.0.5** | ⏳ 待启动 | Ontology 统一层 + ao 退役 + Workflow Hub 独立项目 + 首个行业模板 | [📖](./docs/changelog/v1.0.5.md) |

### v1.x — 发布后

> **v1.0.1-v1.0.5 开发日志**：[v1.0.1](./docs/changelog/v1.0.1.md) → [v1.0.2](./docs/changelog/v1.0.2.md) → [v1.0.3](./docs/changelog/v1.0.3.md) → [v1.0.4](./docs/changelog/v1.0.4.md) → [v1.0.5](./docs/changelog/v1.0.5.md)

#### 编排引擎升级：ao → DeepAgents + Agency Agents

v1.x 的核心架构升级——将编排引擎从自研实验性的 ao，渐进迁移到 LangChain 生态的 [DeepAgentsJS](https://github.com/langchain-ai/deepagentsjs)（LangGraph.js 之上的 batteries-included Agent harness），子 Agent 岗位定义参考 [Agency Agents](https://github.com/msitarzewski/agency-agents)（230+ 岗位模板，含 16 个职能部门 + 企业级 CI/lint 体系）。

**设计哲学**：OpenClaw 负责「连接与行动」（IM 渠道、消息路由），DeepAgents 负责「深度思考」（长任务规划、子 Agent 孵化、状态管理）。ao 验证了「Agent 需要编排层」这个需求，DeepAgents 是生产级实现。

```
OpenClaw 总管（TS）
 ├── sofagent-audit（TS · git diff 硬审计）
 ├── FDE Sub Agent（DeepAgents · 常驻 · 读代码/跑测试/生成手册）
 ├── Audit Sub Agent（DeepAgents · 按需 · 语义审查/跨 repo 审计/Workflow 巡检）
 └── LangGraph（编排状态图 · 条件路由 · HITL · 持久化）
```

**分阶段落地：**

| 阶段 | 版本 | 动作 | 关键依赖 |
|:--:|------|------|------|
| 🔵 引入 | v1.0.1 | `npm install deepagents` → 用 `createDeepAgent` 包装 ao 的 loop-check/evaluate/exit，ao 仍然做决策但编排层切到 LangGraph 状态图 | deepagentsjs + langgraph |
| 🟡 替换 | v1.0.3 | 基于 Agency Agents 模板定义 FDE Sub Agent 岗位（role/workflow/rules/deliverables）→ 对接 OpenClaw sub-agent 机制；同步定义 Audit Sub Agent（语义级审查、跨 repo Workflow 巡检） | agency-agents 模板 + OpenClaw sub-agent API |
| 🟢 增强 | v1.0.4 | 集成 deepagentsjs 的 eval harness（golden set/offline eval/online eval）+ HITL middleware（高风险操作人工审批）→ 对齐 OpenFDE 第 6/7 步。**HITL 置信度标注**（不自动审批）：>99% 自动放行 + 标 🟢；80-99% 标 🟡 待人工确认；<80% 标 🔒 强制人工确认。**仅标注不审批**——不做审批超时降级/防橡皮图章（企业级 BPM 功能，非 Agent harness 职责）。四类强制人工确认场景：删除操作 / 外部 API 调用 / 权限变更 / 数据迁移 | deepagents evals + HITL middleware |
| ✅ 退役 | v1.0.5 | ao 的 loop-check/evaluate/exit 全部由 DeepAgents + LangGraph 接管。ao 目录保留为实验性 archive，标注「已被 DeepAgents 替代」 | 全量功能对齐 |

#### Ontology 渐进构建（企业数字孪生操作层）

借鉴 Palantir Ontology——实体+关系+动作+约束四合一。不放到 v2.x，从 v1.0.1 开始每个版本加一层，自然演化。

| 阶段 | 版本 | 动作 | 说明 |
|:--:|------|------|------|
| 🌱 实体关联 | v1.0.1 | entities/ 页面的 frontmatter 加 `relations` 字段（`has_many`/`belongs_to`/`references`） | 知识库从独立页面变成关联图 |
| 🏗️ 动作定义 | v1.0.3 | Workflow 节点的 YML 加 `actions` 声明——每个节点能对什么对象做什么操作、有什么约束 | Agent 不只是能看什么（knowledge-domain），还能做什么（actions） |
| 🔍 约束验证 | v1.0.4 | 新增 A15 审计规则——Agent 执行的 action 是否在节点声明的 actions 范围内、是否满足 constraints | 事后审计扩展到事前约束检查 |
| 🌐 统一 Ontology 层 | v1.0.5 | `.sofagent/ontology/` 目录——自动从 entities + workflow actions 合并生成，Agent 加载时获得完整世界模型 | FDE 交付的不是文档，是企业数字孪生的操作接口 |
| 🛡️ 防幻觉四方案 | v1.0.5 | Schema Guided（ontology 约束 Action 输出）+ HTRO（High Trust Read Only，只读可信源）+ RAG+溯源（引用必须可追溯到 knowledge/ 页面）+ Action Type 终审（审计层验证 action 类型合规） | 与 A 系列「硬证据」哲学一致 |

#### 外部框架对齐（v1.x 全版本基线）

sofagent 不是孤立的——五层架构与以下成熟项目有明确的对应/借鉴关系：

| sofagent 模块 | 对应外部框架 | 关系 | 版本 |
|------|------|------|:--:|
| 审计引擎（Harness 层） | 独立自研——外部无可替代 | 核心差异化 | v1.0 |
| 编排引擎 | LangChain + LangGraph + DeepAgentsJS | 借鉴后替换 ao | v1.0.1-v1.0.5 |
| Skill 系统 | Agency Agents（岗位模板，v1.0.3）+ SkillOpt（Skill 文档自进化，v1.0.3）+ eval harness + A/B 对比（Sub Agent 配置自进化，v1.0.4） | 模板引用 + 对接优化引擎 | v1.0.1-v1.0.4 |
| AI 知识库 | OpenFDE 10 步工作流（行业定位验证） | 外部验证 | v1.0-1.1 |
| 企业世界模型 | Palantir Ontology（实体+关系+动作+约束） | 概念借鉴，渐进构建 | v1.0.1-v1.0.5 |
| 任务路由 + Skill 组合 | Router+Skill 架构（行业评估为性价比最高方案） | task-aware 路由与 sofagent 方向一致 | v1.x 基线 |


| 想法 | 说明 |
|------|------|
| **企业 Skill 自进化** | FDE 部署时给每个 AI 节点定制专属 Skill（注入行业术语/业务规则/历史案例）。节点跑起来后，基于 scoring.md 评分 + task/logs 记录 + think.md 反思，Skill 自动迭代优化——检查点不合格时触发优化分析，A/B 测试新版本，candidate 胜出 promote 替换 current。这是 sofagent 的核心服务：**Skill 不只是部署时写好，运行时持续进化** |
| **AI 知识库（v1.0.1）** | FDE 交付的第三样东西从散文件升级为结构化知识系统。`.sofagent/knowledge/` 目录：entities/（实体页）+ concepts/（概念页）+ comparisons/（对比页）。daemon 检测 task/logs 变化触发 Ingest，loop-evaluate 顺带跑 Lint，加载链启动时被动注入 top-N 相关页。think.md 不动（职责不重叠）。**新增 Workflow 节点数据契约**（每个 Agent 只看自己职责范围内的知识）+ **entities 实体关联**（frontmatter `relations` 字段——知识库从独立页面变成关联图，Ontology 第 1 步）。详见 [v1.0.1 开发日志](./docs/changelog/v1.0.1.md) |
| **think.md 模板强制** | think.md 目前可选——Agent 想写就写。v1.0.1 升级：如果写，必须按模板（做了什么 / 踩了什么坑 / 下次怎么办）。不强制写，审计引擎检测「本次任务无 think.md」标 ⚠️ 但不阻断。**不做 gate 前置检查**——强制 gate 会导致 Agent 用垃圾内容填模板 |
| **loop-check 轮次上限** | 当前 loop-check 只有步数比例检查点（60%），无绝对轮次上限。v1.0.1 加硬性兜底：超过 N 轮自动 closure → 交还人类。防止工具持续报错导致 Agent 无限循环消耗 Token |
| **后置测验（可选维度）** | loop-check 新维度：任务结束时 AI 出题反问人类「我做了 X，你理解了吗？」从 Agent 自检到人机对齐。默认关闭，高风险任务才开启。成本高（每次任务需人答题），v2.x 探索 |
| **Skill 自进化闭环（v1.0.3）** | FDE 离场时生成的定制 Skill 不是一次性写完就固定的——接入 [微软 SkillOpt](https://github.com/microsoft/SkillOpt) 自进化引擎：Agent 跑任务 → scoring + task/logs 收集轨迹 → `skillopt-sleep` 夜间训练（Rollout→Reflect→Aggregate→Select→Update→Evaluate）→ validation gate 严格验证 → 只升不降替换 Skill。MIT 免费，本地 pip 安装，通过 CLI subprocess 调用。详见 [v1.0.3 开发日志](./docs/changelog/v1.0.3.md) |
| 质量抽检仪表盘 | 抽检合格率、skillopt 迭代记录可视化 |
| age 加密 / 多用户隔离 | think.md + task/logs 加密；同机权限隔离 |
| 多企业平台 webhook | 飞书 + 企微 + 自定义 webhook |
| 记忆架构升级 | Ledger-Views-Policy 三层模型 |
| **Windows 完整支持** | PowerShell 对齐——verify.ps1 从 230 行扩到 ~700 行（对齐 verify.sh ~48 项动态检查）。当前覆盖率 24%，v0.99.7 起诚实标注为实验性。目标：覆盖率 ≥80%，去掉实验性标注 |
| **daemon 文档校准** | 外部用户反馈（Case 025）：daemon 实际监控 think.md/fde.md hash 变化，非直接监听 git commit 审计。需更新文档 + 评估是否在 daemon 主循环加 `sofagent-audit --diff HEAD` 定时触发 |
| 分布式反思同步 | Gossip 协议 + 信任加权投票 |
| bash 代码债清理 | ~450 行重复代码（颜色常量/日志函数/平台探测），方向：bash → TypeScript 迁移，不新建 bash 基础设施 |
| 英文文档扩展 | HANDBOOK/DEVELOPMENT/ARCHITECTURE 英文翻译 |
| **失败案例库** | 收集 Agent 审计拦截的真实案例（去敏后），用于回归测试 + 训练。已有 audit history 数据源 |
| **held-out 测试集** | 预留一批不参与日常迭代的测试样本，版本发版前验证（翁荔提出的三项短板之一） |
| **长期健康度监控** | 追踪 Agent 约束服从率随时间变化的趋势（是否衰减、是否需刷新约束措辞） |
| ARCHITECTURE 可读性 | 降低外部引用密度，让新人 10 分钟能看懂
| 恢复路径结构化 | think.md 记录失败但没有结构化恢复机制，等 JSONL 落地
| 审计规则模板消除重复 | RuleFunction 类型工厂 + Runner 注册模式（15 个 rule-*.ts 减少 30% 重复代码）
| 测试工具函数提取 | makeDiffFile / runDiffParse 等重复定义收敛到 test-utils.ts
| A12 供应链安全 | 依赖变更审计
| A13 文件权限 | chmod 操作检测
| MCP/Plugin/Skill/Hook 四组件扩展 | 在现有 MCP+Skill 基础上架构 Plugin+Hook 层
| 双闸验证：执行前 + 副作用写回前 | 审计从事后 diff 扩展到事前拦截
| **entry-gate 风险分级审批** | 当前权限清单是二分（能做/不能做）。升级为三级：🟢 低风险自动放行 / 🟡 中风险需确认 / 🔴 高风险（DB/外部 API/文件删除）必须人工审批。让低风险更快通过，把人工注意力精准投放到高风险节点。**不做**超时降级和防橡皮图章——那是企业级 BPM 的功能，不是 Agent harness 层的职责（v2.x 再探索） |
| **7-Entry Checklist 结构化** | 当前 entry-gate 只落地了 7-Entry 中的 recovery（LIMITATIONS + daemon 边界说明）和 loop（loop-check/evaluate）。完整 7 项：contact / assembly / model / loop / gate / executor / transcript。v1.x 在 entry-gate 注释埋占位结构 |
| **编排引擎收敛保护** | Loop 工程核心是收敛——不具备收敛性的目标会无限烧 Token。加硬约束：同一任务跑超过 N 轮未收敛 → 强制停下问人，写 think.md 标记「收敛失败」。当前 think.md 是被动记录，缺主动叫停机制
| loop-check 三元统一出口 | pass/fail/warn 收敛，对齐审计引擎 exit code 0/1/2
| 记忆产权三维框架 | 对象归属 / 锁定策略 / 边界定义补充到记忆层
| 入口契约三门槛 | 审计引擎扩展：检查提交含 decision log / PR 大小 / 测试证据，把「重建意图」成本推回提交者 |
| 记忆冲突检测三步法 | think.md 从追加模式升级：检测矛盾→智能融合→重心明确，不简单覆盖 |
| 审计工具健康度运维 | 规则失效检测 + baseline 增长告警——审计工具也需要被审计 |
| Skill 四维评估体系 | scoring 从「结果目标」扩展到「结果+过程+风格+效率」+ 反控样本测试 |
| Conway/Coase 双重反转叙事 | Agent 架构反向塑造组织形态——选择 sofagent 是组织治理模式的选择 |

### v2.x — 多设备协同 + Workflow Hub 前端（规划中）

> 💡 **多 Agent 协同已在 v1.x 完成**：v1.0.3 FDE Sub Agent + Audit Sub Agent 并存 → v1.0.4 A/B 自进化双 Agent 对比 → v1.0.5 Agent Dashboard 探索原型。v2.x 不需要再做多 Agent 协同——它已经是 v1.x 的自然产物（Dashboard 是否进核心取决于 v1.0.5 企业用户反馈）。
>
> v2.x 的核心是两件事：**多设备协同**（不同机器上的 sofagent 实例共享知识/记忆/审计数据，每个 AI 节点拥有独立身份主动进入协作者现场）和 **Workflow Hub 前端**（Web catalog + 社区贡献仪表盘 + 模板 marketplace）。

**ATTRIBUTION 归因引擎（v2.x 探索）**：当前 sofagent 审计能告诉你 Agent 违规了，但不能告诉你哪次正确的审计干预带来了业务价值。ATTRIBUTION 需要在多设备、多客户、长时间尺度上追踪审计决策→业务指标的因果链——"到底哪一次审计干预推动了真实业务结果"。依赖真实企业数据和 v2.x 的多设备协同基础设施。

四阶段渐进：协同编排协议（Markdown 优先）→ Agent 发现与注册 → 跨设备任务分发 → 企业 Agent 知识库（多设备蒸馏记忆聚合到企业自有 NAS/云盘，底层用 [Graphify](https://github.com/safishamsi/graphify) 轻量知识图谱）

> 🧠 **技术底座参考 — A2A 协议**：Google A2A（Agent-to-Agent）协议为多智能体协作定义了三个关键层级：① 动态服务发现（Agent 版 DNS——Agent 广播能力，匹配条件者自动响应）、② 能力契约对齐（入参/输出 Schema 握手，消除自然语言歧义）、③ 全状态接力（任务交接时同时移交执行目标 + 前置共识 + 专属记忆）。MCP 解决「脑和手」的工具调用，A2A 解决「脑和脑」的协作分工。
>
> 同时也需防御 A2A 的三大工程雷区：**语义漂移**（多 Agent 链路中每层推理偏差累积导致末端动作与原始需求南辕北辙）、**死循环雪崩**（Agent 互等形成逻辑闭环，数秒内耗尽 Token 预算）、**权限穿透**（低权限 Agent 构造恶意 A2A 请求诱骗高权限 Agent 执行危险操作）。防御方案三板斧：协调者中枢监控 + 强类型 Schema 前置拦截 + 零信任动态令牌——这三条将纳入 sofagent v2.x 的审计规则体系。

**多 Agent 共享记忆三模式对比**（未做决策，先让讨论可见）：

| 模式 | 机制 | 优势 | 劣势 | 适用场景 |
|------|------|------|------|---------|
| **黑板模式** | 中央共享文件，所有 Agent 读写同一区域 | 简单直观，一致性容易保证 | 单点瓶颈，并发写冲突 | 设备数少、信任度高 |
| **Gossip 协议** | P2P 传播，Agent 间互相同步增量 | 去中心化，容错强 | 最终一致，同步延迟 | 设备多、网络不稳定 |
| **上下文路由** | 按需注入，协调者根据任务匹配相关记忆 | 精准，不浪费上下文 | 需要智能匹配引擎 | 任务边界清晰、记忆量大 |

**双层循环（Loop Engineering）**：

> 来源：Karpathy [AutoResearch](https://github.com/karpathy/autoresearch) + Bilevel Autoresearch 论文。与 ARCHITECTURE 的三层循环（Andrew Ng 框架）视角不同——Karpathy 的双层循环关注自动化迭代的深度，Ng 的三层循环关注产品反馈的广度。

当前 sofagent 实现了**内层循环**（Agent 执行→审计→反思→自动纠偏）。v2.x 将实现**外层循环**——loop-evaluate 评分驱动 Skill 自动优化，打破 Agent 的先验认知，强制探索本能回避的优化方向。

| 循环层 | 时间尺度 | 职责 | sofagent 对应 | 当前状态 |
|--------|:--:|------|------|:--:|
| 内层 | 秒-分钟 | Agent 执行 + 反思 + 自动纠偏 | entry-gate → task-aware → loop-check → think.md → loop-exit | ✅ v0.99+ |
| 外层 | 天-周 | Skill 优化 + 知识库沉淀 | loop-evaluate → scoring.md → AI 知识库 → Skill 自进化 | v2.x |

> 当前 ROADMAP 已有「分布式反思同步」（Gossip 方向）。三模式不是互斥的——实践中可能黑板打底 + 上下文路由按需补充。决策留到 v2.x 需求分析时做。

**Dream Sandbox 沙盒审计（探索方向）**：参照 Palantir AIP 的 Dream Sandbox——Agent 操作先在平行空间模拟运行，人类审批后点「合并」才生效，相当于「对现实做版本控制」。当前 sofagent 只能事后 git diff 审计，沙盒审计将约束从事后升级为事前。v2.x 如果企业用户对 Agent 自主操作有安全需求时探索。（来源：Palantir AIP 架构分析，详见 THANKS.md）

**审批通道分层（探索方向）**：entry-gate 风险分级（v1.x）之上，可探索超时降级（审批 30 分钟无响应 → 自动降级为只读模式还是阻塞？）和防橡皮图章（连续秒批 → 系统警告）。**这是企业级 BPM 功能，不是 Agent harness 层的职责**——v2.x 如果企业用户强烈需求才考虑。

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
| 国标 Agent 审计对位 | 关注国家 AI 智能体互联标准草案进展（截至 2026-07 仍为征求意见稿阶段），标准正式发布后评估 sofagent 审计规则的合规对齐 |
| **Agent 身份码（v1.1.0）** | 国标草案中唯一明确「后续转强制」的方向。v1.1.0 预研——标准仍在制定中，落地取决于国标正式发布 |

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
