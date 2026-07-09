# 路线图 · Roadmap

> 已经做了什么、未来要去哪、哪些地方需要你的帮助。
> v0.99.9 · 2026-07-07（UTC）· AI 知识库概念先行版——审查修复收尾 + verify.ts 代码拆分 + 行业笔记落地 + 理论基础引证
>

> 🎯 **v1.0 定位**：**Agent 审计工具**——git diff 硬证据审计，装 pre-commit hook，每次 Agent 提交自动扫描代码变更。编排引擎（Workflow 梳理用）为实验性附带。

---

## 现在在哪：v0.99.9 ✅

> AI 知识库概念先行版——v0.99.8 经双审查（GLM-5.2 67 维度 + DeepSeek V4 Pro 48 维度）发现 4 P0 + 7 P1 + 3 P2，本版全部修复。同时完成 AI 知识库 6 文档概念先行（架构定位+边界划分）+ verify.ts 1257 行代码拆分（→ 4 模块）+ 7 项行业笔记写入 ROADMAP/ARCHITECTURE + Hugging Face/AutoResearch/Akshay 理论基础引证。
>
> 📖 [开发日志](./docs/changelog/v0.99.9.md) · 完整版本历史见 [CHANGELOG](./CHANGELOG.md) 和 [迭代历程](#迭代历程)

---

## 迭代历程

> 倒叙排列，每个版本有独立开发日志。

| 版本 | 核心交付 | 日志 |
|------|------|:--:|
| **v0.99.9** | AI 知识库概念先行 + 审查修复收尾 + verify.ts 拆分（1257→4模块）+ 行业笔记落地 + 理论引证（Hugging Face/AutoResearch/Akshay） | [📖](./docs/changelog/v0.99.9.md) |
| **v0.99.8** | 审查修复收尾 + FDE 架构重构：双审查 20 项遗留全修 + FDE 四层→三层实体 + templates 镜像产出 + Skill 精简（925→742 行）+ GitHub Actions v5 + PR check + v1.0 准入诚实化（3✅→2✅） | [📖](./docs/changelog/v0.99.8.md) |
| **v0.99.7** | 发布基础设施修复：CI E403 根治 + OIDC 清零 + mcp 依赖解锁 + shellcheck 清零 + Windows 标注（11 项，三轮审查驱动） | [📖](./docs/changelog/v0.99.7.md) |
| **v0.99.6** | 审查修复：mcp npm 同步发布 + 文档一致性（25 项，双审驱动） | [📖](./docs/changelog/v0.99.6.md) |
| **v0.99.5** | CI 自动化 + 审查修复：NPM_TOKEN 自动发布 + P0×6/P1×10 修复 + 工具增强 | [📖](./docs/changelog/v0.99.5.md) |
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

两条路径：**FDE 驻场部署**（传统中小企业，FDE 进场→四阶段十二步流程→交付→撤离）和 **开发者自部署**（开源社区，git clone→install.sh→审计→CI 集成）。

设备端形态：安装时自动带 OpenClaw，审计结果通过 MCP server 推到企业协同平台。**数据主权在设备**——所有记忆、日志、决策记录永不离开本地。

### v1.0 — 正式版：Agent 审计工具（+ FDE 编排引擎实验性附带）

三条主线：
1. FDE 引导逻辑 → 自动产出节点文档（nodes/*.md）+ 交付手册
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
| 3 | Harness 层上下文成本 ≤ 窗口 5% | ⚠️ ~2.5%（自报，无独立验证。SKILL.md≈2000+字，fde.md=1596 字符） |
| 4 | OpenClaw + AO compose 全链路跑通 | ⚠️ ao compose→validate→plan→run 全链路实测通过（Case 023，免 API Key 2 角色协作 5s 完成）。局限：全链路运行需 OpenClaw 会话环境，非 OpenClaw 平台不可用 |
| 5 | MCP server + webhook 跑通 | ⚠️ MCP Server 全链路实测通过（Case 023/024，9 种 JSON-RPC 含错误场景优雅处理）。局限：webhook 推送代码完整（支持 dingtalk/feishu/wecom），需真实 webhook URL 完成端到端 |
| 6 | daemon 核心功能通过自动化测试 | ⚠️ 手动验证通过（Case 014），无独立自动化测试（见 LIMITATIONS） |
| 7 | ≥ 1 外部用户 + 5 个一次性测试 | ✅ 3 名外部用户 macOS 8/8 场景全通（Case 023-025），综合评分 8.0-8.5/10 |
| 8 | install → verify → 首次任务通过率 ≥ 90% | ⚠️ 安装环境验证：verify.sh ~48 项动态全绿 ✅（实际项数因环境条件变化），外部用户实测 install ~3-15s（Case 023-025）。局限：「首次任务通过率」无独立验证——verify 测环境正确性，不测 Agent 首次任务执行 |
| 9a | 三操作系统核心功能（build + tsc + smoke test） | ⚠️ macOS + Linux 全功能。Windows CI 通过但功能覆盖仅 24%（verify.ps1 230 行 vs verify.sh 942 行，见 LIMITATIONS） |
| 9b | vitest 在 Windows 上全量通过 | ⚠️ rollup 原生模块兼容问题，单元测试待解决 |
**硬性截止日期**：2026-09-30。如果 #7 不达标 → v1.0 降为「审计工具技术预览版」。

> 📝 **v1.0 发版前文案审查**：10 个 Skill 文件的铁律措辞过一遍，把「建议/应该/尽量」升级为「必须/绝无例外/违反即失败」。Superpowers（GitHub 23.9 万星）2.8 万次对话实测：强措辞让 AI 服从率 33%→72%，翻倍。规则内容不变，仅措辞强度提升。

### v1.x — 发布后

| 想法 | 说明 |
|------|------|
| **企业 Skill 自进化** | FDE 部署时给每个 AI 节点定制专属 Skill（注入行业术语/业务规则/历史案例）。节点跑起来后，基于 scoring.md 评分 + task/logs 记录 + think.md 反思，Skill 自动迭代优化——检查点不合格时触发优化分析，A/B 测试新版本，candidate 胜出 promote 替换 current。这是 sofagent 的核心服务：**Skill 不只是部署时写好，运行时持续进化** |
| **AI 知识库（v1.1）** | FDE 交付的第三样东西从散文件升级为结构化知识系统。`.sofagent/knowledge/` 目录：entities/（实体页）+ concepts/（概念页）+ comparisons/（对比页）。daemon 检测 task/logs 变化触发 Ingest，loop-evaluate 顺带跑 Lint，加载链启动时被动注入 top-N 相关页。think.md 不动（职责不重叠）。详见 [v1.1 开发日志](./docs/changelog/v1.1.md) |
| **think.md 模板强制** | think.md 目前可选——Agent 想写就写。v1.1 升级：如果写，必须按模板（做了什么 / 踩了什么坑 / 下次怎么办）。不强制写，审计引擎检测「本次任务无 think.md」标 ⚠️ 但不阻断。**不做 gate 前置检查**——强制 gate 会导致 Agent 用垃圾内容填模板 |
| **后置测验（可选维度）** | loop-check 新维度：任务结束时 AI 出题反问人类「我做了 X，你理解了吗？」从 Agent 自检到人机对齐。默认关闭，高风险任务才开启。成本高（每次任务需人答题），v2.x 探索 |
| **Lingua Word 短词锚定** | 给每条铁律一个短词别名（如 A1 最小变更 → @A1），Skill 里只注入短词代替展开全文。风险：短词太短 Agent 遗忘含义。v1.0 前在 fde.md 跑 A/B 对比 token + 服从率 |
| **Skill 自进化闭环** | 部署→运行→检查→进化 四步闭环 |
| 质量抽检仪表盘 | 抽检合格率、skillopt 迭代记录可视化 |
| age 加密 / 多用户隔离 | think.md + task/logs 加密；同机权限隔离 |
| 多企业平台 webhook | 飞书 + 企微 + 自定义 webhook |
| 记忆架构升级 | Ledger-Views-Policy 三层模型 |
| **Windows 完整支持** | PowerShell 对齐——verify.ps1 从 230 行扩到 ~700 行（对齐 verify.sh ~48 项动态检查）。当前覆盖率 24%，v0.99.7 起诚实标注为实验性。目标：覆盖率 ≥80%，去掉实验性标注 |
| **daemon 文档校准** | 外部用户反馈（Case 025）：daemon 实际监控 think.md/fde.md hash 变化，非直接监听 git commit 审计。需更新文档 + 评估是否在 daemon 主循环加 `sofagent-audit --diff HEAD` 定时触发 |
| 分布式反思同步 | Gossip 协议 + 信任加权投票 |
| bash 代码债清理 | ~450 行重复代码（颜色常量/日志函数/平台探测），方向：bash → TypeScript 迁移，不新建 bash 基础设施 |
| 英文文档扩展 | HANDBOOK/DEVELOPMENT/ARCHITECTURE 英文翻译 |
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

### v2.x — 多设备协同：组织级 Agent Harness（规划中）

> 💡 定位澄清：v2.x 的本质不是"设备能通信"，而是"每个 AI 节点拥有独立身份，能主动进入协作现场"。这是从个人助手 Harness 到组织级 Agent Harness 的跨越——Agent 不再是某个人的工具，而是组织的独立成员。详见项目记忆中的 [组织级 Agent Harness 研判](.workbuddy/memory/MEMORY.md#组织级-agent-harness2026-06-30-cloudtag-研判笔记)。

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
