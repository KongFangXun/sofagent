# FORGE — sofagent 自迭代引擎

> **FORGE = sofagent 的自迭代引擎。** 通过 workflow 驱动 Agent 审查/修复/验证自己的代码。这是给 sofagent 开发者的工具包——如果你是 sofagent 用户，不需要看这里。
>
> **FORGE 是 sofagent 项目的自迭代引擎**——终极目标是让 Agent 写代码、Agent 审计、Agent 审查。通过 `FORGE/SKILL/<loop>/` 定义可复用的 workflow，每个 workflow 是一步 toward 自迭代。当前已落地第一个 workflow：**fresh-eyes-loop**（A/B 双盲质量审查循环），由 driver（`fresh-eyes-driver.mjs`）自动编排执行。不面向终端用户。企业用户的入口是 [FDE Agent](../FDE/README.md)。

## 当前循环

| 循环 | 路径 | 用途 |
|------|------|------|
| **fresh-eyes-loop** | `FORGE/SKILL/fresh-eyes-loop/` | 发布后独立质量循环——A/B 异构模型双盲 12 视角审查 + 修复 + 验证，每轮新进程保证零上下文，连续 2 轮无 P0/P1 即停 |
| **release-gate-loop** | `FORGE/SKILL/release-gate-loop/` | 发版闸门循环——acceptance-test + regression + 审查报告，异步轮询长任务 |

### Loop 七要素自检

好的 Loop 不是「让 Agent 一直尝试」，而是让每一轮获得新证据并在明确边界内靠近终点。参考 Agent Engineering 中 Loop 设计的七个核心问题，对照检查两个 loop：

| 要素 | 核心问题 | fresh-eyes-loop 现状 | release-gate-loop 现状 |
|------|---------|---------------------|----------------------|
| 触发 | 什么会启动下一轮？ | A 审查完成→B 修复→A 验证，driver 自动编排 | 发版前手动触发，异步轮询 |
| 目标 | 什么状态才算成功？ | 连续 2 轮无 P0/P1 | acceptance-test + regression 全绿 |
| 状态 | 下一轮需要保留什么？ | 审查报告 + 修复 diff + 验证结论 | 审查报告 + acceptance 结果 + regression 结果 |
| 权限 | Agent 可以修改或调用什么？ | B 只读 A 的审查报告，只改指定文件 | 验证 Agent 只读产物、不写代码 |
| 证据 | 用什么证明结果正确？ | A 验证 agent 重新审查 B 的修复 | acceptance-node-probes.js + regression-checklist.md |
| 反馈 | 失败后返回什么信息？ | 审查报告标注 PASS/FAIL + 具体行号 | 门禁失败原因 + 指向具体检查项 |
| 停止 | 何时成功、超时或交给人？ | 2 轮无 P0/P1 或达到 max-rounds | 门禁通过则放行，否则标注遗留问题人工决策 |

> **核心原则**：不要围绕信心循环，要围绕证据循环。fresh-eyes-loop 的 A-verify 阶段和 release-gate-loop 的 acceptance-test 都是「证据」——不是让 Agent 自己说「我觉得好了」，而是让独立 Agent 基于硬证据判断「确实好了」。

## 快速开始（fresh-eyes-loop）

fresh-eyes-loop 由 driver（`fresh-eyes-driver.mjs`）自动编排——driver 会 spawn 独立子进程跑每个 step，无需手动在 A/B 之间 relay。

```bash
# 1. 确保 sofagent 底座已装
sofagent-audit --version

# 2. 配置 A/B 异构模型（详见 quick-start.md）
export SOFAGENT_LLM_A=<provider>:<model-name>      # 审查类模型
export SOFAGENT_LLM_A_API_KEY=your-key
export SOFAGENT_LLM_B=<provider>:<model-name>      # 工程类模型（异构）
export SOFAGENT_LLM_B_API_KEY=your-key

# 3. 一键启动（driver 自动起 A/B 子进程）
node FORGE/src/fresh-eyes-driver.mjs --target v1.2.0 --max-rounds 10

# 4. 先 dry-run 看流程
node FORGE/src/fresh-eyes-driver.mjs --target v1.2.0 --dry-run
```

**环境变量**（A/B 异构模型）：

```bash
# A（审查者）= 你选的审查类模型
export SOFAGENT_LLM_A=<provider>:<model-name>
export SOFAGENT_LLM_A_API_KEY=your-key

# B（工程师）= 你选的工程类模型（必须与 A 不同厂商）
export SOFAGENT_LLM_B=<provider>:<model-name>
export SOFAGENT_LLM_B_API_KEY=your-key
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
  FORGE.md                       ← 早期自迭代设计（历史参考，现行以 loop.md 为准）→ 已移至 archive/FORGE.md
  quick-start.md                ← A/B 异构模型接入与环境配置
  LEDGER.md                     ← 跨 run 永久索引（git 跟踪）
  SKILL/
    fresh-eyes-loop/            ← 质量循环（A/B 双 Agent）
      SKILL.md / loop.md / prompts/ / specs/ / evolution.md / runs/
  src/
    fresh-eyes-driver.mjs        ← fresh-eyes-loop 编排 driver（spawn A/B 子进程）
    types.ts / workflow.ts      ← 旧编排运行时（保留参考，不再主动使用）
```

> **v1.2.0 后期**：FORGE 的自迭代目标不变，重构了落地方式——从硬编码串行工具包（engineer→audit→reviewer 单循环 + loop-install.sh 独立安装）改为通过 workflow 逐步实现自迭代（`FORGE/SKILL/<loop>/` + driver 自动编排）。当前已落地第一个 workflow **fresh-eyes-loop**。旧 `loop-workflow.sh`、`FORGE/SKILL.md`、`FORGE/loop-install.sh`、`FORGE/releaser/` 已删除。详见 [`FORGE/SKILL/fresh-eyes-loop/loop.md`](SKILL/fresh-eyes-loop/loop.md)。
