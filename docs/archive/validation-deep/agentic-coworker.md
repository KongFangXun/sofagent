# 麦肯锡 Agentic Coworker 五项基础（深读归档）

> 原节：VALIDATION §一 · 方法论印证（台账化收录）。搬入日期：2026-10-27。
> 来源判定：一手来源 = McKinsey 官方原文（两篇，链接见文末）；转述来源 = 公众号「AI组织进化论」2026-10-27 文（仅作发现渠道，不作为出处引用——二手转述不入引用面，本文所有观点均可回溯至麦肯锡原文措辞）。
> 收录理由：五项基础中三项与 sofagent 存量能力同构成印证（自主权分级 / 身份与责任 / 企业 Context），两项提供增量框架（三种记忆分类 / 生命周期责任人）。银行案例数据（未具名 + 转述）按引用纪律不收录。

## 背景脉络

- 2025-09-26：《The Agentic Organization》提出 Agentic Organization 组织形态（五大支柱：业务模式 / 运营模式 / 治理 / 人才与文化 / 技术与数据）。
- 2026-10-26：《The Rise of the Agentic Coworker: A Banking CIO's Guide to the Next Wave of AI》把视角落到具体管理机制，面向银行 CIO，提出 Agentic Coworker 概念与五项管理基础。

## 核心定义：Agentic Coworker ≠ 普通 Agent

麦肯锡定义句（原文）：

> An agentic coworker ... **owns a role and an outcome**.

区别于「接到提示词完成一项任务」的普通 Agent：Agentic Coworker 在一定授权下**持续执行一系列工作**，保留对客户/项目/任务的上下文，与其他人和 Agent 交接。四类能力支撑：大语言模型（推理规划）、工具（连接企业系统）、Skill（封装做事方法）、专业 Agent（细分任务）。

风险升维提示（原文）：Copilot 犯错导致员工返工；有执行权限的 Agent 犯错可能直接改生产系统、泄露客户数据、触发合规风险——因此需像管理其他工作参与者一样设计 Agent 的责任、授权和监督。

## 五项基础逐条 × sofagent 对照

### 一、自主权与风险边界

- 判据句：**Design for agent error, not against it**（按会犯错设计，不假装不犯错）。
- 自主权光谱：一端是顾问型（分析建议、人批准后执行），另一端是执行型（既定边界内直接操作系统）；自主权越高，身份验证 / 操作授权 / 数据保护 / 执行前检查 / 异常升级 / 回滚机制须同步加码。
- **sofagent 对照（同构印证）**：审计兜底 + fail-closed + 快照回滚 + HMAC 举证整套装在「按会犯错设计」前提下；三套档位（业务节点三问 🔄/⚡/👤、判定分流高/中/低、审计五态 ALLOW/ASK/ABSTAIN/DENY/SKIP）与自主权分级语义同构。无新增动作。

### 二、身份与责任（含增量②）

五项要求：① Agent 有独立数字身份（用途/版本/环境/访问权限 + 每次操作留痕）；② **每个 Agent 有明确的人类责任人**（负责业务目标、权限、风险等级、异常处理、运行结果）——原文特别指出**责任不能统一交给 AI CoE（AI 卓越中心）**，每个 Agent 都要有具体的人；③ Agent 注册清单（类似软件资产管理：用途/所有者/系统访问/风险等级/生命周期）；④ Agent 间协作也需身份与权限验证（防未经授权的指令跨 Agent 传播）；⑤ 共享记忆按其中最敏感数据定级管理。

- **sofagent 现状查证（2026-10-27 实测）**：① → agent_identity / Ed25519 身份码已交付；③ → `create_agent` + fde-registry 即注册清单；④ → 团队协作协议（team-state / intent-bus）+ Agent 间消息签名；⑤ → memory contract 三层敏感度插槽（L0 正则 / L1 词典 / L2 NER，core 敏感识别）；② → **部分缺口**：workflow-store 的 `owner`（`engine/orchestrator/src/crud/schema-gate.ts:177`，非空必填）是「工作流归属人」；workflow 节点的 `approver` 是「验收时刻拍板人」；但 `SubAgentDefinition`（`engine/orchestrator/src/registry.ts:12`）**没有 Agent 生命周期责任人字段**（谁负责这个 Agent 的权限/风险/停用）。
- **吸收判定**：候选增强——Agent 定义补生命周期 owner（区别于验收 approver 与 workflow owner），与「找谁负责」治理问题对齐；dashboard Agent 清单可展示。归路线候选，不自行排期。

### 三、人与 AI 分工与监督

- 三档监督：高风险不可逆决策（信贷审批/欺诈处置/高级权限授予）→ 人批准后执行；中等风险 → 按风险等级抽样检查；低风险成熟任务 → 人管异常但保留明确责任人。
- 自主权渐进释放：初期全审批 → 验证后按重要程度审批 → 成熟低风险转持续监控 + 异常处理。
- 管理者角色变化：从检查过程转向目标设定、权限分配、异常判断、输出质量与最终结果。
- **sofagent 对照（同构印证）**：HITL + 审批四模式 + 弃权第四态（ABSTAIN）覆盖三档监督语义；渐进释放对应进化准入三档（deterministic 全自动 / model-judge 采样人审 / human-only 强制 HITL）。无新增动作。

### 四、企业 Context：三种记忆（增量①）

麦肯锡把 Agentic Coworker 必须掌握的企业上下文分三种记忆：

| 记忆类型 | 定义（麦肯锡口径） | sofagent 沉淀资产对号 |
|---|---|---|
| **Episodic（情景记忆）** | 过去发生的事情：某客户的交易、异常和处理结果 | think.md 反思 + 审计历史 history.jsonl + decision-log 因果链 |
| **Procedural（程序性记忆）** | 工作应该如何完成：审批流程、操作规范、授权边界 | SKILL/ 约束资产 + workflow.yml 交付物（merge_criteria / approver / trigger） |
| **Semantic（语义记忆）** | 企业的专业概念、产品定义、业务规则及其关系 | knowledge/ 本体（entities / concepts / relations） |

配套观点：**企业可以购买通用编排、身份管理和系统连接能力，但应掌握自己的专有业务上下文**——银行多年积累的信贷政策、风控参数、架构标准包含企业内部专业判断，外部 AI 厂商无法直接提供；企业内部的专业知识与判断规则是 AI 时代新的组织能力资产。

- **sofagent 对照**：三分法给「沉淀能力」一个简洁的外部对齐框架——三种记忆在本仓各有既定承载物，无一缺失；「专有上下文自持」与 PHILOSOPHY「判据 schema 唯一 SSOT」「领域专属判据必须自建」同向，可作补强引用。

### 五、统一 AI Gateway：Protect / Prove / Price

- **Protect（保护）**：统一执行安全政策、身份验证、敏感数据保护。
- **Prove（可追溯）**：记录提示词、工具调用、决策过程、人工审批——能解释 Agent 为什么这样做、责任如何界定。
- **Price（成本）**：统一统计 token / 模型调用 / 工作流成本，按任务复杂度选模型；且**不能只看单 Agent 消耗多少 token，要衡量完成一个业务流程结果的全部 AI 成本**（模型调用 + 人工复核 + 异常处理）与传统流程对比是否创造价值。

- **sofagent 对照（同构印证）**：ToolGate 工具门禁 + 权限四原则（Protect）；HMAC 链 + decision-log + audit_trail（Prove）；cost_query + worklog_query 按 agent/workflow 聚合 + quota 双模式（Price）。半增量：**按「业务流程结果」算总账的口径视角**（单笔业务全链路成本 vs 传统流程）当前聚合维度未覆盖，可作 cost 面演进参考，不单独立项。

## 收录边界（不吸收项）

- **北美银行案例数据**（人工审核量降 40–50%、年处理量提 60%、审批周期缩短 25%）：未具名机构 + 二手转述，违反「无一手出处不引数据」纪律，不收录。
- **面向银行业的合规细节**（如监管报送类控制）：治理要求与 sofagent 目标客群（SMB/OPC）不同频，不照搬。
- **公众号课程推广与叙事部分**：营销内容不入仓。

## 来源（一手 · 机构 · 链接）

1. McKinsey（2026-10-26）· The Rise of the Agentic Coworker: A Banking CIO's Guide to the Next Wave of AI · https://www.mckinsey.com/capabilities/tech-and-ai/our-insights/the-rise-of-the-agentic-coworker-a-banking-cios-guide-to-the-next-wave-of-ai
2. McKinsey（2025-09-26）· The Agentic Organization: Contours of the Next Paradigm for the AI Era · https://www.mckinsey.com/capabilities/people-and-organization/our-insights/the-agentic-organization-contours-of-the-next-paradigm-for-the-ai-era
