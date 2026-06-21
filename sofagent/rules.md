# rules.md · 执行层

> 本文件由 DeepSeek V4 Pro 和 GLM-5.2 配合生成，欢迎改进。
>
> 加载链第 3 层（最后一层）。优先级最高——你的运行规范说了算，可以覆盖前面所有层。
> 不用全部填，挑你需要的写进去就行。写了就生效，删了就取消。

---

## 模型偏好（可选）

<!-- 示例：模型：claude-sonnet-4 / 子 Agent 模型：claude-haiku-4。去掉 # 生效。 -->
# 模型：
# 子 Agent 模型：

## 行为规则（可选）

<!-- 示例：- 回复控制在 200 字以内 / - 不要生成 .md 文件 / - 优先用中文回答 / - 不要在未经确认的情况下创建新文件或目录。去掉 # 生效。 -->

# - 
# - 

## 阈值覆盖（高级，可选）

<!-- 详见 Handbook §四。示例：编排级回滚阈值：0.3 / 反思首次置信度：0.4。去掉 # 生效。编排机制详见 Developer §二。 -->

# 失败率回滚阈值（默认 > 0.2）：
# 编排级回滚阈值：
# 反思首次置信度：
# 反思两次置信度：
# 反思三次置信度：

## 修改纪律（可选）

<!-- 启用则生效，不启用则留空 -->
# - 涉及文字风格、语气、幽默感、节奏的修改，先给方案预览，确认后再动手。

## 其他（可选）

<!-- 示例：- 不自动淘汰 Skill / 单任务 token 上限：50000。去掉 # 生效。 -->
# - 

---

## 放什么 / 不放什么

| ✅ 放 rules.md | ❌ 不放 rules.md |
|------|------|
| 行为偏好（回复风格、语言、文件操作） | 任务级别的模型配置（去 orchestrator/） |
| 全局模型替换 | Skill 使用记录（去 scoring/） |
| 阈值覆盖 | 编排最优拆法（去 orchestrator/） |
| 特定规则的开关 | 长期记忆（去 think.md 反思区） |

> **「我希望一直这样」→ rules.md；「这个任务这样最优」→ orchestrator/。**

## 离线模式（企业环境可选）
# 取消下面这行的注释启用离线模式——跳过 ClawHub API 调用
# offline: true

---

## 企业合规（v0.7x，可选）

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
