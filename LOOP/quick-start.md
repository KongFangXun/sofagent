# LOOP 快速入门 · 5 分钟把自迭代跑起来

> 你已经装了 sofagent 底座和 LOOP Skill。这篇文章告诉你：第一条 prompt 怎么发，LOOP 怎么跑起来。

---

## 第一步：确认安装

```bash
# 确认 sofagent 底座已装
sofagent-audit --version   # 应输出 v1.0.3 或更高

# 确认 LOOP Skill 已装（OpenClaw）
ls ~/.openclaw/skills/sofagent-loop/SKILL.md

# 如果没装
bash LOOP/loop-install.sh
```

## 第二步：发第一条 prompt

在任何 Agent（WorkBuddy / Codex / Claude Code / Cursor）中输入：

```
@openclaw 启动 LOOP 自迭代循环：修复 README 里的 typo，把 "teh" 改成 "the"
```

或者手动分步：

```
openclaw session spawn --agent engineering-minimal-change-engineer --task "修复 README 里的 typo"
```

## 第三步：看 LOOP 跑起来

```
你的 Agent → OpenClaw 底座
  →
  ┌─ engineering-minimal-change-engineer 启动
  │   1. Read README.md（找到 typo 的位置）
  │   2. Edit README.md（只改那一行，不改别的）
  │   3. npm run build ✅
  │   4. npm test ✅
  │   5. git commit -m "fix: 修复 README 中的 typo"
  │       └→ sofagent-audit pre-commit hook 触发
  │          → PASS ✅（无敏感文件/密钥）
  │   6. 写 think.md 反思记录
  │
  ├─ engineering-code-reviewer 启动
  │   1. 读 git diff
  │   2. 语义审查 → 无逻辑问题 ✅
  │   3. 影响范围 → 只改 1 行，无波及 ✅
  │   4. 输出审查报告 → IS_PASS: YES
  │
  └─ 审查报告返回给你
     → 你确认 → git push → 完成
```

## 第四步：处理审查驳回

```
如果 IS_PASS: NO →
  code-reviewer 标注 🔴 阻断项
  → engineering-minimal-change-engineer 修复
  → 重新跑 sofagent-audit
  → code-reviewer 重新审查
  → 直到 IS_PASS: YES
```

## 外层循环：定期监督

不用每次都跑。装完 FDE（`bash FDE/fde-install.sh`）后，定期触发：

```
openclaw session spawn --agent forward-deployed-engineer \
  --task "分析本月 think.md 反思趋势，优化 Agent 定义"
```

外层循环会：
1. 分析 minimal-change-engineer 的重复错误模式
2. 检查 code-reviewer 的审查是否在变宽松
3. 自动修改 `agents/*.md` 的 rules/workflow
4. 触发 compliance-auditor 做全量 Workflow 巡检

## 自定义：适配你的项目

LOOP 默认是为 sofagent 自己的开发设计的。想用在你自己的项目上？改这几处：

| 文件 | 改什么 |
|------|------|
| `agents/engineering-minimal-change-engineer.md` | 把 sofagent 专属约束（A1-A11）换成你项目的规则 |
| `agents/engineering-code-reviewer.md` | 把 sofagent CLI 审计分工换成你项目的审查标准 |
| `LOOP/LOOP.md` | 改 Mermaid 流程图中的 sofagent-audit → 你的 CI/审查工具 |

## 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| `session.spawn` 报错 | OpenClaw 未安装或版本太低 | 装/升级 OpenClaw |
| minimal-change-engineer 不改代码 | 任务描述太模糊 | 给具体的任务："修复 README 第 3 行 typo" |
| code-reviewer 每轮都驳回 | 审查标准太严 | 改 `agents/engineering-code-reviewer.md` 的 🔴 清单 |
| 外层循环不工作 | FDE 没装 | `bash FDE/fde-install.sh` |
