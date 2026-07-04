# Case 019：上善能及 FDE 部署

> 能源科技 · 2 个产线 Agent 已稳定运行数月 · FDE 部署新 Enterprise 知识库 Agent

---

## 基本信息

| 字段 | 内容 |
|------|------|
| 公司 | 上善能及能源科技有限公司 |
| 行业 | 能源 / 制造 / 科技 |
| 规模 | 11-50人 |
| 部署日期 | 2026-07-02 |
| 设备 | Mac mini（arm64），OpenClaw |
| 部署类型 | FDE 十步流程（Enterprise 知识库 Agent 新方向规划） |
| 填写人 | 姚旭琛（数字化部门 · Agent 落地研究员） |

---

## 部署背景

上善能及**已有 2 个产线 Agent 在稳定运行**（售后诊断 + BMS 告警降误报），本次 FDE 聚焦新方向——Enterprise 知识库 Agent。

售小助手Agent 已实现全自动闭环：
```
BMS 告警 → 降误报筛选 → 确认真实设备 → 写入钉钉 AI 表格 → 自动生成 OA 审批待办
```

---

## 部署成果

### FDE 十步流程

- **§一~§二**：企业画像 + 技术环境评估（Go 编排层 + Codex GPT-5.5 + Python MCP + MySQL/OTS）
- **§三**：接收 11 份岗位说明书，解析企业组织全景
- **§四**：AI 节点分类 + 部署方案 + Phase 1 代码
- **§六~§八**：10+ 份文档产出 + knowledge_ingest.py + doc_search_mcp.py + Codex prompt 配置
- **§十一**：离场检查通过

### Phase 1 交付物

| 文件 | 说明 |
|------|------|
| enterprise-profile.md | 企业画像 |
| tech-env.md | 技术环境评估 |
| workflow-nodes.md | 工作流节点分析 |
| node-classification.md | AI 节点分类 |
| deployment-plan.md | 部署方案书 |
| business-model.md | 商业模式 + ROI |
| exit-check.md | 离场确认 |
| knowledge_ingest.py | 文档入库 |
| doc_search_mcp.py | 知识库搜索 |
| codex-prompt-config.md | Codex prompt 配置 |

---

## 关键数据

| 指标 | 值 |
|------|------|
| 已有产线 Agent | 2（售后诊断 + BMS 告警降误报） |
| 本次新规划 Agent | 1（Enterprise 知识库） |
| 告警误报率 | 已大幅降低 |
| 售后诊断流程 | 从人工查数据+写报告 → 全自动化闭环 |
| 知识检索效率 | 从 10-20min → 秒回（待部署） |

---

## 用户反馈

> 「sofagent 的 FDE 流程像一个结构化的'企业 AI 落地导航仪'——不是教你开车，而是告诉你下一站在哪、该加什么油、前面有没有弯道。」

**遇到的改进需求**：
1. 一线流程细节不清楚时，需要替代方案（逐岗访谈提纲 / 痛点指定 / 快速 POC）
2. Webhook 机器人只能单向发消息，需引导改用正式企业内部机器人

---

## v1.0 准入条件贡献

| # | 条件 | 本次状态 |
|:--:|------|:--:|
| #7 | 外部用户 + 5 测试 | ✅ **全部通过**（5/5 任务，类型不重复） |
| #4 | AO compose 全链路 | ⚠️ 本次为 FDE 引导模式，未触发 AO compose |
| #5 | MCP webhook | ⚠️ DingTalk webhook 通，sofagent MCP webhook 未测 |
| #9 | 三操作系统 | ⚠️ macOS ✅，Linux/Windows 待补 |

> 📋 完整验证记录见 [v1.0 准入验证方案](../../../../Desktop/sofagent测试/上善能及/v1.0-准入条件-验证方案_已填写.md)

> ⚠️ 原始部署产物（workflow.yaml / 部署日志 / 验证截图）存放在部署企业内网。联系仓库维护者获取脱敏版本。

---

## 脱敏节点列表（从公开信息提取）

以下节点信息从部署方案摘要中提取，用于外部验证工作流结构完整性。

### 已有产线 Agent（2 个，稳定运行数月）

| Agent | 类型 | 说明 |
|------|:--:|------|
| 售后诊断 | 🔄 | BMS 告警 → 降误报筛选 → 确认真实设备 → 钉钉 AI 表格 → OA 审批待办 |
| BMS 告警降误报 | 🔄 | 告警误报率已大幅降低 |

### 本次 FDE 新规划（1 个）

| Agent | 说明 |
|------|------|
| Enterprise 知识库 | knowledge_ingest.py + doc_search_mcp.py，从 10-20min 检索 → 秒回 |

### Phase 1 交付物清单

| 文件 | 类型 |
|------|------|
| enterprise-profile.md | 企业画像 |
| tech-env.md | 技术环境评估 |
| workflow-nodes.md | 工作流节点分析 |
| node-classification.md | AI 节点分类 |
| deployment-plan.md | 部署方案书 |
| business-model.md | 商业模式 + ROI |
| exit-check.md | 离场确认 |
| knowledge_ingest.py | 文档入库脚本 |
| doc_search_mcp.py | 知识库搜索脚本 |
| codex-prompt-config.md | Codex prompt 配置 |
