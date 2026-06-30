# fde.md · 企业约束层

> 本文件由 FDE 在部署时编写，不是用户自己填。
>
> 企业约束层（由 FDE 编写，Agent 运行时加载，优先级最高）。FDE 梳理企业 workflow 后，
> 将企业合规要求、数据脱敏规则、审计频率、行业约束翻译成本文件。
> 写了就生效，删了就取消。

---

## 企业信息（FDE 填写）

<!-- 示例：企业名称：XX公司 / 行业：外贸 / 规模：SMB（15人）。去掉 # 生效。 -->
# 企业名称：
# 所属行业：
# 企业规模：SMB / OPC

---

## 模型策略（FDE 配置）

<!-- 示例：主模型：deepseek-v4 / 子 Agent 模型：deepseek-flash。去掉 # 生效。 -->
# 主模型：
# 子 Agent 模型：

## 行为约束（FDE 制定）

<!-- 示例：- 所有对外输出必须经过人工审核 / - 客户数据不得离开本地环境 / - 报价单生成后自动推送钉钉群。去掉 # 生效。 -->

# - 
# - 

## 阈值配置（高级，FDE 可选）

<!-- 详见 Handbook §四。去掉 # 生效。编排机制详见 DEVELOPMENT.md。 -->

# 失败率回滚阈值（默认 > 0.2）：
# 编排级回滚阈值：
# 反思首次置信度：
# 反思两次置信度：
# 反思三次置信度：

## 修改纪律（FDE 制定）

<!-- FDE 可设定哪些修改需要先确认 -->
# - 涉及客户数据的修改，先给方案预览，确认后执行。

---

## 放什么 / 不放什么

| ✅ 放 fde.md | ❌ 不放 fde.md |
|------|------|
| 企业合规要求（数据脱敏、审计频率） | 任务级别的模型配置（去 orchestrator/） |
| 行业约束（外贸/制造/金融特定规则） | Skill 使用记录（去 scoring/） |
| 阈值配置 | 编排最优拆法（去 orchestrator/） |
| 全局模型替换 | 踩坑反思（去 think.md） |

> **「企业要求一直这样」→ fde.md；「这个任务这样最优」→ orchestrator/。**

## 离线模式（企业环境可选）
# 取消下面这行的注释启用离线模式——跳过 ClawHub API 调用
# offline: true

---

## 企业合规（FDE 配置）

<!-- 去掉对应行 # 启用。所有功能默认关闭，不影响现有用户。 -->

# 日志脱敏：写入 task/logs 前自动打码 API Key / token / 密码
# log_sanitize: true
# log_sanitize_ips: false

# 数据保留：超过保留天数或条数上限自动清理。清理前先 tar.gz 归档。
# data_retention_days: 90
# data_retention_max_entries: 500
# data_cleanup_on_record: true
# data_cleanup_frequency: 10

# 审计日志：记录关键操作（install / uninstall / orchestrate / cleanup）
# audit_enabled: true

---

## Gotcha

- **fde.md 是模板不是文档**：部署时复制到目标项目的 `.sofagent/fde.md`，去掉 `#` 注释才生效。忘了去注释 = 配置不生效。
- **阈值配置要先测再上**：失败率回滚阈值默认 0.2，但不同业务场景差异大。先在非关键节点试跑 3 次，观察 think.md 反馈再调。
- **行为约束不能替代审计**：fde.md 写了「数据不得离开本地」只是声明——实际隔离靠基础设施。Agent 不保证遵守行为约束文字。
