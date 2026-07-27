# 用户自定义层（custom/）

> **一句话**：给 FDE Agent 追加**私有行为规则**的地方——你写的规则在官方规则之后加载，追加生效。**只管规则，不管代码。**

---

## 这个目录到底干什么？

custom/ 解决一个核心矛盾：**官方升级 vs 用户定制**。

sofagent 升级时会把 `SKILL.md` / `harness/` / `agents/` 全部覆盖为最新版。如果你直接改这些文件，下次升级就白改了。custom/ 给你一个安全的藏身处——**官方升级不碰这里**，你的规则永久保留。

**类比**：浏览器扩展 vs 浏览器本体。浏览器更新了，你的扩展配置不会丢。custom/ 就是 Agent 的"扩展配置目录"。

---

## custom/ 只管规则，不管代码（关键边界）

| 改动类型 | 归属 | 举例 |
|---------|------|------|
| **Agent 行为规则追加** | ✅ `custom/` | "commit message 必须带工单号" |
| **业务流程约束** | ❌ `.sofagent/fde.md` | "每个 PR 要等 5 分钟再合" |
| **审计规则开关** | ❌ `.sofagent/config.yml` | "关闭 A3 越界检查" |
| **知识库内容** | ❌ `.sofagent/knowledge/` | "公司 API 文档摘要" |
| **代码 / 脚本变更** | ❌ Git 仓库 | "给 rules 包加一条新规则" |
| **LOOP 自迭代沉淀** | ❌ `.sofagent/` + Git | LOOP 写的代码进 Git commit，经验进 knowledge/ |

**为什么代码变更不进 custom/？**

custom/ 里的 `.md` 文件是**文字规则**，被 Agent 当 prompt 加载。代码逻辑变更（加审计规则、改 orchestrator 行为、写新工具）是工程行为，要走 Git commit + 测试 + 发版流程。**文字约束和代码约束是两道防线**——文字约束让 Agent"自觉不犯"，代码约束在 Agent 真犯的时候"硬拦截"。custom/ 只管第一道。

---

## 谁往这里写？谁读？

| 角色 | 操作 | 什么时候 |
|------|------|---------|
| **企业 IT / FDE 运维** | 写 | FDE 离场后，企业想微调行为规则 |
| **开发者** | 写 | 个人定制 Sub Agent 约束 |
| **Agent 运行时** | 读 | 每次启动时加载引擎层 → 再加载 custom/ |
| **Agent 自己** | ❌ 不写 | Agent 读 custom/ 但不写——Agent 不能自我修改行为规则 |

---

## 文件命名规则

文件名决定规则追加给哪个 Agent：

| 文件名 | 追加到 | 效果 |
|--------|--------|------|
| `fde-overrides.md` | FDE Agent 主入口（SKILL.md） | 企业全局行为规则 |
| `engineer-overrides.md` | engineer Sub Agent | 工程师行为约束（如文件范围限定） |
| `reviewer-overrides.md` | reviewer Sub Agent | 审查员行为调整（如审查重点） |
| `audit-overrides.md` | audit Sub Agent | 审计规则补充说明 |

> 不在上述列表中的文件名会被忽略。要定制全新 Agent，在 `custom/` 下建子目录 + `SKILL.md`。

---

## 加载机制

```
Agent 启动时加载顺序：
  ① 引擎层（官方维护，升级时覆盖）
     SKILL.md → harness/*.md → agents/*/SKILL.md
  ② 用户层（你维护，升级时不动）
     custom/*-overrides.md ← 你写的规则追加在这里
```

后加载 = 优先级更高。你的规则**追加**到官方规则后面，不是替换。官方说"commit 要描述清楚"，你在 custom/ 写"commit 还要带工单号"——Agent 两条都遵守。

> ✅ **当前状态（v1.2.1 已落地）**：加载链已接通——`SKILL.md` 加载链段落已声明 custom/ 用户层；Sub Agent 由 `buildConstrainedSystemPrompt()` 自动注入 `{SOFAGENT_DATA}/custom/*-overrides.md`（按文件名排序，每篇截取前 2000 字符，最多 4 篇）。你只需按命名表新增文件，无需手动拼接 prompt。

---

## 升级时会发生什么？

`bash install.sh` 升级 sofagent 时：

| 策略 | 官方引擎层 | 你的 custom/ |
|------|----------|------------|
| **安全升级**（默认） | 覆盖为最新版 | **不动** ← 你的定制保留 |
| **强制覆盖**（`--force`） | 覆盖 | **也覆盖** ← 恢复官方默认 |
| **diff 合并**（`--merge`） | 覆盖 | 尝试三路合并 |

### `--force` 安全机制

`--force` 会覆盖 custom/，因此加入**交互式确认**：

```
[sofagent] 检测到 --force，以下 custom/ 文件将被覆盖：
  - fde-overrides.md (1.2KB)
  - engineer-overrides.md (0.8KB)
继续？[y/N]
```

- 默认 `N`（不覆盖），需手动输入 `y` 才执行
- `--force --yes` 可跳过确认（CI 场景）
- 覆盖前自动备份到 `custom/.backup/{timestamp}/`

### diff 合并冲突处理

`--merge` 模式对 custom/ 文件做三路合并（base → ours → theirs）：

| 情况 | 处理 |
|------|------|
| 无冲突 | 自动合并 |
| 有冲突 | 生成 `.merge-conflict` 文件，保留双方内容（`<<<<<<<` / `=======` / `>>>>>>>` 标记），**不覆盖原始文件** |
| 合并失败 | 原始文件不动，输出 `[sofagent] 合并冲突：手动处理 custom/*.merge-conflict` |

> ✅ **当前状态（v1.2.1 已落地）**：`file-deploy.sh` 已实现三策略——安全升级跳过 custom/、`--force` 交互确认 + 备份覆盖、`--merge` 三路合并（冲突生成 `.merge-conflict`，原始文件不动）。安装时自动创建 `skills/sofagent/custom/` 与 `{SOFAGENT_DATA}/custom/` 两处目录。

---

## 示例

### 企业定制 `fde-overrides.md`

```markdown
# XX 公司定制规则

## Commit 规范
- 所有 commit message 必须以 `[JIRA-XXXX]` 开头
- 禁止直接 push 到 main 分支

## 文件约束
- `.env*` 文件禁止提交（已有 A1 审计规则，这里补充提醒 Agent）
- 任何涉及 `src/payment/` 的改动需要 CTO 签字
```

### 开发者定制 `engineer-overrides.md`

```markdown
# 个人定制

## 文件范围
- 只许改 TypeScript 文件，不碰 shell 脚本
- 修改 `package.json` 前先跟我确认
```
