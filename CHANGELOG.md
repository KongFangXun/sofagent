# Changelog

本文件记录 sofagent 的版本历史。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

---

## [v0.7.0] — 2026-06-19

### Added — 企业合规（P0/P1）
- **日志脱敏**：task-record.sh 新增 `sanitize()` 函数，写入 task/logs 前自动打码 API Key / token / 凭证。内网 IP 脱敏可选（默认关闭）。通过 `log_sanitize: true` 在 rules.md 启用
- **数据保留策略**：新增 cleanup.sh 独立脚本，支持按天（`data_retention_days`，默认 90）/ 按条（`data_retention_max_entries`，默认 500）清理。删除前先 tar.gz 归档到 `archive/YYYY-MM.tar.gz`，确认成功后再删除源文件。通过 `data_cleanup_on_record: true` 在 task-record.sh 写入后概率触发（`data_cleanup_frequency`，默认 1/10）
- **审计日志**：新增 audit.sh 独立脚本，记录关键操作（install / uninstall / orchestrate / cleanup）到 `task/audit/YYYY-MM/YYYY-MM-DD.md`，追加 Markdown 表格行。通过 `audit_enabled: true` 在 rules.md 启用，默认关闭
- **共享配置层**：新增 lib/config.sh，从 rules.md 解析合规配置项，export 7 个环境变量供所有脚本复用
- **验证升级**：verify.sh 新增企业合规检查组（脱敏函数验证 / cleanup.sh 参数检查 / audit.sh 参数检查 / 默认关闭确认 / rules.md 配置段完整性）

### Changed
- **rules.md**：末尾新增「企业合规（v0.7x）」配置段，7 个配置项默认全部注释（向后兼容）
- **install.sh / uninstall.sh / task-orchestrate.sh**：新增审计钩子（开始/结束处调用 audit.sh，`|| true` 兜底）

---

## [v0.63] — 2026-06-19

### Changed — 诚实化（P0）
- **loop-agent.md 非 OpenClaw 评审路径去伪强制语气**：删除 `⛔ 禁止凭记忆补充` 等硬标记，加显式声明「prompt 级约束，无机制保障，效果未实测」。承认 LLM 没有「清空执行记忆」的 API——「重新 Read task/logs」是让 Agent 以文件为主依据，不是真的能擦除执行记忆。与 OpenClaw `session.spawn` 工程隔离路径的可靠性不在同一级别，文档不再混淆
- **ARCHITECTURE 外部研究引用诚实化**：Self Harness / Skill Reducer 删除具体百分比数字（14-21% / 39% / 2.8%），改定性描述；加免责声明「sofagent 核心效果未实测，不代表能达到相同效果」；标注「论文链接待补」（致谢表其他引用均有 arXiv 号）。非 OpenClaw 路径不再引用 Self Harness 的工程隔离实验数字
- **HANDBOOK §五「验证安装」与闸门矛盾修复**：删除「看 Agent 回复里有没有初始化提示」——SKILL.md 闸门 ① 明确「内部执行，不输出给用户」，两处直接矛盾。改为只推荐 verify.sh，并加说明「不要靠初始化提示验证」

### Changed — 一致性（P1）
- **SKILL.md triggers 可判定性修复**：删除「Agent行为异常」「经验积累」（事后状态/结果，路由阶段不可判定），新增「多步任务」「代码修改」「文件操作」（事前可路由特征）
- **task-closure.md 编号断裂修复**：执行清单缺 ①（写 task/logs 被合并进引用块），补 ①② 连续编号
- **loop-agent.md closure 输入边界讲清楚**：区分 task/logs（评审主依据）vs scoring/orchestrator（历史参考，不计入本次评审），消除「输入含 scoring/orchestrator 但又要求只读 task/logs」的矛盾

### Changed — 文档膨胀裁剪（P2）
- **ARCHITECTURE.md 612→585 行**：删除 §四「Osmani 三盆冷水」（面向用户的警告，移到 HANDBOOK FAQ），回到 600 硬上限内
- **DEVELOPMENT.md 610→599 行**：§五「评审者分离」表格精简为指向 loop-agent.md 和 ARCHITECTURE 的引用（避免重复 + 诚实化），清理冗余分隔符，回到 600 硬上限内
- **HANDBOOK.md 加 Osmani 三盆冷水精简版**（表格形式，443 行 ≤500 上限内）

### Fixed
- **ARCHITECTURE §三「复盘评分是 LLM 自评」段落诚实化**：原描述「v0.62.2 已按平台分级解决」过度乐观，改为分级表格明确 OpenClaw 工程隔离 vs 非 OpenClaw prompt 级约束的差异，标注非 OpenClaw 不引用具体数字

### 不动
- OpenClaw `session.spawn` 评审者分离分支（真改进，保留原样）
- 4 条底线 + 10 则铁律内容
- 三层加载链结构

---

## [v0.62] — 2026-06

### Added
- **load-chain.sh 防御性冗余**：恢复注入宪法（从 SKILL.md 提取），与 skill 系统注入形成双保险。~250 token 冗余可接受——关键系统不怕重复，怕单点失效
- **SKILL.md description 改为架构导向**：从「4 条底线 + 10 则铁律」改为「三层加载链实现复杂任务自动拆解执行 + 每次跑完任务自动复盘总结」
- **ARCHITECTURE.md 跨平台说明更新**：诚实声明第 1 层全平台强制（skill 注入 + OpenClaw 兜底），第 2、3 层 OpenClaw 强制、其他平台君子协定

### Changed
- **宪法内联进 SKILL.md（扁平化重构）**：4 底线 + 10 铁律从 `constitution/sofagent.md` 内联进 SKILL.md。第 1 层不再依赖 Agent Read——skill 调用自动注入，所有平台强制生效。WorkBuddy 新会话验证：第 1 层从「全跳」变为「强制生效」（回复含闸门自检痕迹）
- **三层加载链重构**：SKILL.md（自动注入）→ think.md（Agent Read）→ rules.md（Agent Read，最高优先级）
- **铁律重排**：#3 先读再用→#1（含 think.md/rules.md），原 #1→#2，原 #2→#3
- **文档命名规范化（对齐 GitHub 社区惯例）**：Design.md→ARCHITECTURE.md，Roadmap.md→ROADMAP.md，Handbook.md→HANDBOOK.md，Developer.md→DEVELOPMENT.md，Testing.md→docs/TESTING.md，Evidence.md→docs/EVIDENCE.md
- **load-chain.sh 重构**：v0.62 先删除宪法注入，v0.62.1 恢复（防御性冗余）

### Removed
- **删除 constitution/sofagent.md**：宪法内联进 SKILL.md 后不再需要

### Fixed
- **sofagent.md 引用清理**：23 处文档引用同步更新为 SKILL.md（v0.62 重构遗漏修复）
- **HANDBOOK 铁律表同步**：v0.62 铁律重排时 HANDBOOK 漏改，本轮修复
- **uninstall.sh 旧版遗留清理**：新增清理 v0.62 前部署的 sofagent.md 遗留

---

## [v0.60] — 2026-06

### Added
- **A0 专家团引擎自检**：SKILL.md A0 预判新增 WorkBuddy 专家团共存边界——专家团激活时引擎不点火，避免双重编排冲突
- **Logo 体系**：README / Design / Developer / Handbook 四文档统一加 sofagent logo（alt/width 统一）
- **CONTRIBUTING 新人快速开始表格**：顶部加一表速览，降低首 contributing 门槛
- **GitHub Actions CI**：补回 verify workflow，CI 容器预置 ~/.openclaw 最小安装环境后跑验证
- **仓库 Topics**：openclaw / agent-governance / loop-engineering / harness-engineering / ai-agent / skill

### Changed
- **README 徽章优化**：LICENSE MIT 前置 + 新增 GitHub stars 动态徽章 + 平台分级展示
- **Roadmap v0.6x 四项全部闭环**：新会话端到端测试 / 端到端闭环验证 / WorkBuddy 专家团共存边界 / load-chain.sh 权重折半
- **README 措辞平铺化**：「翻 Handbook 定制你的 Agent」改为平铺三句，降低跳转成本

### Fixed
- **{SOFAGENT_DATA} 变量定义补全**：SKILL.md 加载链末尾补变量路径定义，解决用户不知变量指向哪里的困惑

---

## [v0.56] — 2026-06

### Fixed
- **删假引用**：Open Viking 引用疑似编造（bytedance GitHub 无此仓库，DeepSeek 幻觉），删除 Design.md 正文段落 + 致谢表条目
- **修错引用**：SkillOS 机构更正为 Google Cloud AI Research / UIUC（原误写含 MIT）；名称统一为 SkillOS（原 Skill OS 带空格）
- **修错年份**：Klarna 裁员事件更正为 2024 年 2 月宣布（原写 2023）
- **折半机制真实现**：`load-chain.sh` 新增 `emit_think_downgraded` 函数（awk），解析 think.md 中 `[LLM自评]` 标记位并动态追加降权提示。降权提示不写回原文件，SHA-256 缓存按原文计算零影响。OpenClaw 平台物理降权生效
- **loop-agent 二值证据矛盾**：L52"文件 diff 符合预期"（语义判断）改为 `git diff --quiet exit 0`（可程序化判定）
- **Case 001 内部矛盾**：执行时间统一为 28 分钟（原 23/28 分混用）；60% 检查点加注释说明按 token/时间/进度三维度综合判定；版本号加注 v0.54 跑通
- **加载链防漏读（P0-7）**：SKILL.md 加载链表格上方加 ⛔ 硬出口，明确"读了 rules.md 不等于读了 sofagent.md"，要求逐文件 Read + 内部确认"✅ 宪法层已注入"。来自作者 WorkBuddy 自测发现的根因

### Changed
- **子 Skill 数统一**：全局统一为"1 主 Skill + 5 子 Skill = 6 个 .md 文件"（原 README/Developer/CONTRIBUTING 分别写 6/4/3 不一致）
- **"兼容"措辞诚实化**：README + Handbook 把"兼容五平台"改为分平台能力表，OpenClaw 全功能 / 其他平台仅宪法层约束
- **Quick Start 重写**：补前置依赖表（bash/git/node/npm）+ git clone + 30 秒 smoke test + install.sh 会改什么文件一览
- **安装路径统一**：README + Handbook 统一为 git clone + install.sh 主路径，技能市场作为 WorkBuddy 备选
- **三文件去重**：Developer §二 编排深度章节加指向 Design §二 的链接；Handbook §五 Developer 级内容（脚本速查/种子指令/Skill 文件列表）移到 Developer §一
- **闭环优先级提升**：Roadmap 中"新会话端到端测试""端到端闭环验证"从 🟡 提至 🔴
- **测试人字段统一**：Testing.md / Evidence.md 中作者测试记录用 GitHub 用户名 KongFangXun（文档签名保留中文孔放勋）

### Added
- **Case 002 归档**：作者 WorkBuddy + DeepSeek V4 Pro 自测报告（14 项检查），闭环跑通 + 发现加载链第 1 层漏读
- **Testing.md 用例 3 改 PASS**：从 FAIL（think.md 空白、task/logs 无记录）改为 PASS（闭环双写跑通）
- **Evidence.md 第三方表**：新增 KongFangXun 自测行
- **IDENTITY.md 模板**：新建 `sofagent/data/IDENTITY.md`（岗位名/职责/能力边界/风格偏好 4 字段）
- **文档膨胀控制原则**：Design §一 补行数预算（Handbook ≤500 / Developer ≤600 / Design ≤600 / README ≤250）
- **单点依赖坦白**：CONTRIBUTING 加"目前项目维护者为孔放勋一人，单点依赖风险已知"
- **ao compose npm 依赖局限**：Design §三 已知局限补一条
- **WorkBuddy 平台折半局限**：Design §三 补 WorkBuddy/其他平台无 load-chain.sh Hook，折半靠 Agent 自觉

### Removed
- **删 disable 字段误导**：CONTRIBUTING 删"SKILL.md 特殊处理：同步时需在 YAML 头里保留 disable: true 字段"（SKILL.md 实际无此字段）
- **删 Handbook §五 Developer 级内容**：load-chain.sh 详细说明 / 种子指令详细内容 / 四个子目录六个 Skill 文件列表（移到 Developer）

---

## [v0.55] — 2026-06

### Changed
- **架构重构**：978 行 Handbook 拆为三个文件——Handbook 436 行（普通用户）+ Developer 561 行（开发者）+ Design 573 行（设计决策）
- **team-deploy 改名**：team-deploy-checklist → team-deploy
- **README 四身份引导表**：普通用户 / 开发者 / 设计爱好者 / 技术 VP 各看哪个文件

### Added
- **Case 001 归档**：@cedric123123 在 OpenClaw + kimi-k2.5 首次跑通全流程（28 分钟，6 文件，3 检查点 100%）
- **Evidence.md 第一份第三方证据**
- **docs/enterprise-deploy.md**：企业内网部署指南（离线模式 / 权限 / 合规清单）
- **docs/team-deploy.md**：团队落地 3 页 checklist

---

## [v0.54] — 2026-06

### Fixed
- **反思自噬根因**：loop-agent.md closure 模式加外部信号校验（三标记 [LLM自评]/[已验证]/[用户确认] + 二值证据 + 权重折半 ×0.5）
- **ao compose 单点故障**：engine.md 实现默认编排策略（无 ao 时按语义簇拆 3-5 子任务）
- **多用户污染**：Design §三 + README 补"不是多用户系统"局限

### Added
- **约束回响**：loop-agent.md checkpoint 模式加"重大操作前自检铁律和反思区，答不上来暂停"
- **6 条企业级开关**：chmod 700 / --no-config-inject / --no-ao / offline 模式 / 编排 fallback / 企业部署文档

---

## [v0.53] / [v0.53.1] — 2026-06

### Fixed
- 双视角评审 22/23 项修复（GitHub 大神 + 创业公司技术 VP 视角）
- Handbook 瘦身 1136→983 行（-13.5%）

---

## [v0.52] — 2026-06

### Changed
- 风格统一 + 边界补齐

---

## [v0.51] — 2026-06

### Changed
- 宣称对齐

---

## [v0.50] — 2026-06

### Fixed
- 全链路通——install→verify→uninstall 首次跑通

---

## [v0.49] — 2026-06

### Fixed
- 自测挖 bug

---

## [v0.48] — 2026-06

### Fixed
- install.sh 文件复制不全问题（OpenClaw 路径仅复制 2/6 个 Skill 文件）
- 报告不实问题

---

## [v0.47] — 2026-06

### Added
- 项目首次发布——装不上（install.sh 路径错误）
