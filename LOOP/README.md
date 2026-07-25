# LOOP — sofagent 质量循环定义层

> **LOOP 是 sofagent 项目的质量循环定义层**——通过 `LOOP/SKILL/<loop>/` 定义可复用的循环协议（如 A/B 双盲 fresh-eyes 审查），由 DeepAgents 编排器驱动执行。不面向终端用户。企业用户的入口是 [FDE Agent](../FDE/README.md)。

## 当前循环

| 循环 | 路径 | 用途 |
|------|------|------|
| **fresh-eyes-loop** | `LOOP/SKILL/fresh-eyes-loop/` | 发布后独立质量循环——A/B 双盲 12 视角审查 + 修复 + 验证，每轮新 session 保证零上下文，连续 2 轮无 P0/P1 即停 |

## 快速开始（fresh-eyes-loop）

fresh-eyes-loop 不需要单独的安装或 CLI——它是一个协议定义（`loop.md` + `prompts/`），由 driver（你）在 A/B 两个 sub-agent 之间 relay 执行。

```bash
# 1. 确保 sofagent 底座已装
sofagent-audit --version

# 2. 读协议
cat LOOP/SKILL/fresh-eyes-loop/loop.md

# 3. 开两个 session（A 和 B），分别注入对应的 prompt：
#    A: LOOP/SKILL/fresh-eyes-loop/prompts/a-check.md
#    B: LOOP/SKILL/fresh-eyes-loop/prompts/b-check.md
#    两者独立跑 12 视角审查（双盲），产物写到 runs/.../round-NN/

# 4. A 合并报告 → B 修复 → A 验证 → 判定停止

# 5. 循环结束后 driver 追加一行到 LOOP/LEDGER.md
```

**环境变量**（sub-agent 需要 LLM 调用时）：

```bash
export SOFAGENT_LLM_ENGINEER=deepseek:deepseek-chat   # B 修复时用
export SOFAGENT_LLM_REVIEWER=glm:glm-4-flash          # A 审查时用
export OPENAI_API_KEY=sk-xxx                           # OpenAI 兼容 API 统一入口
```

## 内置 Agent

LOOP 的 sub-agent 定义在 `SKILL/agents/` 下：

| Agent | 角色 | 位置 |
|-------|------|------|
| `sofagent-engineer` | 软件工程师——写代码、修复 | `SKILL/agents/engineer/SKILL.md` |
| `sofagent-reviewer` | 代码审查员——审查 + 自动门控 | `SKILL/agents/reviewer/SKILL.md` |
| `sofagent-audit` | 合规审计员——A1-A21 规则检查 | `SKILL/agents/audit/SKILL.md` |

fresh-eyes-loop 的 A/B 即基于 reviewer + engineer 构建（同底座，不同行为指令——见 `prompts/`）。

## 目录

```
LOOP/
  README.md                     ← 你在这里
  LOOP.md                       ← 设计文档（旧自迭代模型，保留参考）
  quick-start.md                ← LLM 接入与环境配置
  LEDGER.md                     ← 跨 run 永久索引（git 跟踪）
  SKILL/
    fresh-eyes-loop/            ← 质量循环（A/B 双 Agent）
      SKILL.md / loop.md / prompts/ / specs/ / evolution.md / runs/
  src/
    types.ts / workflow.ts      ← 旧编排运行时（保留参考，不再主动使用）
```

> **v1.2.0 后期**：LOOP 已从"自迭代工具包（engineer→audit→reviewer 单循环 + loop-install.sh 独立安装）"转向"质量循环定义层（`LOOP/SKILL/<loop>/` + DeepAgents 驱动）"。旧 `loop-workflow.sh`、`LOOP/SKILL.md`、`LOOP/loop-install.sh`、`LOOP/releaser/` 已删除。详见 [`LOOP/SKILL/fresh-eyes-loop/loop.md`](SKILL/fresh-eyes-loop/loop.md)。
