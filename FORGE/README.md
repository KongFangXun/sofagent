# FORGE — sofagent 质量循环定义层

> **FORGE 是 sofagent 项目的质量循环定义层**——通过 `FORGE/SKILL/<loop>/` 定义可复用的循环协议（如 A/B 双盲 fresh-eyes 审查），由 driver（`fresh-eyes-driver.mjs`）自动编排执行。不面向终端用户。企业用户的入口是 [FDE Agent](../FDE/README.md)。

## 当前循环

| 循环 | 路径 | 用途 |
|------|------|------|
| **fresh-eyes-loop** | `FORGE/SKILL/fresh-eyes-loop/` | 发布后独立质量循环——A/B 异构模型双盲 12 视角审查 + 修复 + 验证，每轮新进程保证零上下文，连续 2 轮无 P0/P1 即停 |

## 快速开始（fresh-eyes-loop）

fresh-eyes-loop 由 driver（`fresh-eyes-driver.mjs`）自动编排——driver 会 spawn 独立子进程跑每个 step，无需手动在 A/B 之间 relay。

```bash
# 1. 确保 sofagent 底座已装
sofagent-audit --version

# 2. 配置 A/B 异构模型（详见 quick-start.md）
export SOFAGENT_LLM_A=glm:glm-5.2
export SOFAGENT_LLM_A_API_KEY=your-glm-key
export SOFAGENT_LLM_B=deepseek:deepseek-v4-pro
export SOFAGENT_LLM_B_API_KEY=your-deepseek-key

# 3. 一键启动（driver 自动起 A/B 子进程）
node FORGE/src/fresh-eyes-driver.mjs --target v1.2.0 --max-rounds 10

# 4. 先 dry-run 看流程
node FORGE/src/fresh-eyes-driver.mjs --target v1.2.0 --dry-run
```

**环境变量**（A/B 异构模型）：

```bash
# A（审查者）= GLM-5.2
export SOFAGENT_LLM_A=glm:glm-5.2
export SOFAGENT_LLM_A_API_KEY=your-glm-key

# B（工程师）= DeepSeek V4 Pro
export SOFAGENT_LLM_B=deepseek:deepseek-v4-pro
export SOFAGENT_LLM_B_API_KEY=your-deepseek-key
```

> A 和 B 用不同厂商的模型（异构），这是 fresh-eyes-loop 的设计——审查和修复用不同模型减少同模型盲区。详见 [`quick-start.md`](quick-start.md)。

## 内置 Agent

FORGE 的 sub-agent 定义在 `SKILL/agents/` 下：

| Agent | 角色 | 位置 |
|-------|------|------|
| `sofagent-engineer` | 软件工程师——写代码、修复 | `SKILL/agents/engineer/SKILL.md` |
| `sofagent-reviewer` | 代码审查员——审查 + 自动门控 | `SKILL/agents/reviewer/SKILL.md` |
| `sofagent-audit` | 合规审计员——A1-A21 规则检查 | `SKILL/agents/audit/SKILL.md` |

fresh-eyes-loop 的 A/B 即基于 reviewer + engineer 构建（同底座，不同行为指令——见 `prompts/`）。

## 目录

```
FORGE/
  README.md                     ← 你在这里
  FORGE.md                       ← 设计文档（旧自迭代模型，保留参考）
  quick-start.md                ← A/B 异构模型接入与环境配置
  LEDGER.md                     ← 跨 run 永久索引（git 跟踪）
  SKILL/
    fresh-eyes-loop/            ← 质量循环（A/B 双 Agent）
      SKILL.md / loop.md / prompts/ / specs/ / evolution.md / runs/
  src/
    fresh-eyes-driver.mjs        ← fresh-eyes-loop 编排 driver（spawn A/B 子进程）
    types.ts / workflow.ts      ← 旧编排运行时（保留参考，不再主动使用）
```

> **v1.2.0 后期**：FORGE 已从"自迭代工具包（engineer→audit→reviewer 单循环 + loop-install.sh 独立安装）"转向"质量循环定义层（`FORGE/SKILL/<loop>/` + driver 自动编排）"。旧 `loop-workflow.sh`、`FORGE/SKILL.md`、`FORGE/loop-install.sh`、`FORGE/releaser/` 已删除。详见 [`FORGE/SKILL/fresh-eyes-loop/loop.md`](SKILL/fresh-eyes-loop/loop.md)。
