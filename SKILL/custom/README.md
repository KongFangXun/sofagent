# 用户自定义层（custom/）

> **一句话**：这是你给 FDE Agent 加"私有规则"的地方。你写的规则会在官方规则之后加载，追加生效——类似 CSS 的 `!important`。

## 这是什么？谁会用？

| 场景 | 具体例子 |
|------|---------|
| 企业 FDE 部署后想微调规则 | "我的公司所有 commit message 必须带 JIRA 工单号" |
| 开发者想给 engineer Sub Agent 加约束 | "只许改 TypeScript 文件，不碰 shell 脚本" |
| 团队约定覆盖默认铁律 | "我们团队不需要 A3 越界检查，太烦了" |

**谁往这里写**：企业 IT 人员（FDE 离场后自主维护）或开发者（个人定制）。**不是 Agent 自己写**——Agent 读这里的文件，不写。

## 怎么用？加载机制

```
Agent 启动时的加载顺序：
① 引擎层先加载（SKILL.md → harness/ → agents/）
② 用户层后加载（本目录 custom/）← 你写的规则在这里
```

后加载 = 优先级更高。你的规则**追加**到官方规则后面，不是替换。比如官方说"commit message 要描述清楚"（铁律 #0），你在 custom/ 里写"commit message 还要带工单号"，Agent 两条都遵守。

## 文件命名规则

文件名决定追加给谁：

| 文件名 | 追加到哪个 Agent | 效果 |
|--------|-----------------|------|
| `fde-overrides.md` | FDE Agent（SKILL.md 主入口） | 企业全局规则追加 |
| `engineer-overrides.md` | engineer Sub Agent | 工程师行为约束追加 |
| `reviewer-overrides.md` | reviewer Sub Agent | 审查员行为约束追加 |
| `audit-overrides.md` | audit Sub Agent | 审计规则调整追加 |

> 不在上述列表中的文件名会被忽略。如果你想定制全新 Agent（不是覆盖现有的），请在 `custom/` 下建子目录 + SKILL.md。

## 什么时候不要用 custom/

- **改业务规则** → 写到 `.sofagent/fde.md`（运行时约束层），不要写这里
- **改审计规则开关** → 改 `.sofagent/config.yml`（规则配置），不要写这里
- **加新知识** → 写到 `.sofagent/knowledge/`（知识库），不要写这里

custom/ 只管 **Agent 行为规则的追加覆盖**。其他配置有各自的归属。

## 升级时会发生什么？

`bash install.sh` 升级 sofagent 时：

| 策略 | 官方引擎层 | 你的 custom/ |
|------|----------|------------|
| 安全升级（默认） | 覆盖为最新版 | **不动** ← 你的定制保留 |
| 强制覆盖（`--force`） | 覆盖 | **也覆盖** ← 你的定制丢失，恢复官方默认 |
| diff 合并（`--merge`） | 覆盖 | 尝试三路合并（你的改动 + 官方更新自动合并） |

> 90% 场景用默认的安全升级就好。你的 custom/ 永远不会被意外覆盖。

## 示例：企业定制 fde-overrides.md

```markdown
# 企业定制规则

## Commit 规范
- 所有 commit message 必须以 `[JIRA-XXXX]` 开头
- 禁止直接 push 到 main 分支

## 文件约束
- `.env*` 文件禁止提交（已有 A1 审计规则，这里补充提醒）
- 任何涉及 `src/payment/` 的改动需要 CTO 签字
```

