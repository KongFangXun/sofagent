# FORGE — sofagent 自迭代引擎

> ⚠️ **内部工具，不是对外产品能力**：FORGE 是 sofagent 项目自迭代工具链，用于项目自身的代码审查与发版流程，**不属于企业交付物**。本文档面向**项目维护者**，外部贡献者和企业用户可忽略此目录——它不影响 sofagent 的安装和使用。企业用户的入口是 [FDE Agent](../SKILL/SKILL.md)。

> **FORGE = sofagent 的自迭代引擎。** 双层循环架构——外环（项目级，每轮 = 一个版本生命周期）套内环（阶段级，质量循环 + 发版闸门）。终极目标是外环能自转：人给出 `/goal` → Agent 自动走完 A0→A12 → 回到 A0。当前内环已可 driver 自转，外环的关键节点逐步补上证据闸门。
>
> 这是给 sofagent 开发者的工具包——如果你是 sofagent 用户，不需要看这里。企业用户的入口是 [FDE Agent](../SKILL/SKILL.md)。
>
> ⚠️ **非独立产品**：FORGE 不独立发布、不对外提供安装包。它深度依赖 sofagent 主包（audit 引擎 + 发布闸门 + fresh-eyes 审查）与特定模型配置（fresh-eyes A/B 双盲审查需 LLM），单独复制 FORGE/ 目录无法运行。想复用其思想请参考 [docs/THANKS.md](../docs/THANKS.md) 的设计来源，想跑起来请先完整安装 sofagent。

## 双层循环架构

FORGE 的自迭代不是单一循环，而是**外环 + 内环**的双层结构：

### 外环 · 项目级（每轮 = 一个版本的生命周期）

外环就是 `docs/changelog/releasing.md` 的十二阶段——从 A0（编写开发日志/dev prompt）到 A12（发布后生成下一版 prompt），A12 → A0 形成闭环。**每一轮外环 = 一个版本从规划到发布的完整生命周期**。

外环的 loop body 就是 releasing.md。每转一轮：

- **产出新代码**：本版本的功能开发 + BugFix
- **产出更成熟的流程**：releasing.md 自身也在进化（阶段十二·步骤 38 SOP 自我进化），审查工具变得更锋利（回归清单 + 验收脚本 + fresh-eyes-review 持续校准）
- **每轮的"齿轮"**：外环每转一圈，都有新的节点从"手动"变成"可自动"、从"靠人判断"变成"靠证据闸门"——这正是通向自转的路径

外环的完整动作模型定义在 [`ontology/actions.yml`](ontology/actions.yml)，闭环全景详见 [`ontology/README.md`](ontology/README.md)「版本迭代闭环」。

### 内环 · 阶段级（外环某一阶段内部的子循环）

外环走到特定阶段时，启动内环做深度验证。内环结束 → 外环继续。当前已落地两个内环：

| 内环 | 嵌套在外环哪个阶段 | 路径 | 用途 |
|------|------------------|------|------|
| **fresh-eyes-loop** | 阶段三（开发后质量循环） | `FORGE/SKILL/fresh-eyes-loop/` | A/B 双角色零上下文 12 视角审查 + 修复 + 验证，连续 2 轮无 P0/P1 即停 |
| **release-gate-loop** | 阶段六（发版闸门） | `FORGE/SKILL/release-gate-loop/` | acceptance-test + regression + coverage + verdict，异步轮询长任务 |

### 证据闸门（外环节点的放行条件）

外环的每个关键节点都有**证据闸门**——不是靠"我觉得好了"放行，而是靠客观工具产出硬证据：

| 节点 | 证据工具 | 有 ❌ 的后果 |
|------|---------|------------|
| A0（编写 dev prompt） | ① `tools/check-dev-prompt.sh`（查存在性）+ ② `FORGE/playbook/dev-prompt-checklist.md`（查签名/注册点/已完成区等软错误） | 两层都过才许进开发 |
| A5-d3（D3 闸门） | `FORGE/playbook/acceptance-test.sh` | 零覆盖 = 不许进下一阶段 |
| A6（release-gate-loop） | `FORGE/src/release-gate-driver.mjs` | verdict = FAIL = 回阶段五 |
| VERSION-check | `tools/check-version.sh` | 版本号不一致 = 阻断发布 |

> **通向自转的路径**：外环每转一圈，就有新的证据闸门补上。当前这一轮补上的是 A0 的 `check-dev-prompt.sh`（v1.2.2 教训：dev prompt 引用了不存在的文件路径）。下一轮可能补的是 A8 文档收尾的自动化检查。当所有关键节点都有证据闸门、所有内环都能 driver 自转时，外环就能从"半自动"走向"人只在确认关口介入"。

### 终局：外环自转

终极目标是外环能**自转**——人给出 `/goal`（下一版本方向），Agent 自动走完 A0→A12→A0 一整轮：

- A0：自动生成 dev prompt + `check-dev-prompt.sh` 闸门通过
- A1-A4：自动审查 + 开发（fresh-eyes-loop 做质量验证）
- A5-A6：自动走审查体系更新 + release-gate-loop 验证
- A7-A11：人在确认关口介入（A10-action_type: 需审批），其余自动
- A12：自动生成下一版 prompt → 回到 A0

当前状态：内环（fresh-eyes-loop / release-gate-loop）已可 driver 自转；外环的 A0 闸门刚补上 `check-dev-prompt.sh`；A7-A11 的文档收尾和发布步骤仍需大量人工。每轮外环转一圈，都在减少人工介入点。

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

## 快速开始

FORGE 有两个内环，共用同一套模型配置（详见 [`quick-start.md`](quick-start.md)）：

| 内环 | 阶段 | 命令 |
|------|------|------|
| **fresh-eyes-loop**（质量循环） | 阶段三（开发后） | `node FORGE/src/fresh-eyes-driver.mjs --target v1.2.4 --max-rounds 10` |
| **release-gate-loop**（发版闸门） | 阶段六（发版前） | `node FORGE/src/release-gate-driver.mjs --target v1.2.4` |

两个 driver 都支持 `--dry-run`（只打印 step 序列不调 LLM）。release-gate-loop 在 sandbox/OOM 环境下有 `--skip-acceptance` 和 `--step` 单步模式（详见 [`quick-start.md`](quick-start.md)）。

## 内置 Agent

FORGE 的 sub-agent 定义在 `SKILL/agents/` 下：

| Agent | 角色 | 位置 |
|-------|------|------|
| `sofagent-engineer` | 软件工程师——写代码、修复 | `SKILL/agents/engineer/SKILL.md` |
| `sofagent-reviewer` | 代码审查员——审查 + 自动门控 | `SKILL/agents/reviewer/SKILL.md` |
| `sofagent-audit` | 合规审计员——A1-A23 规则检查 | `SKILL/agents/audit/SKILL.md` |

fresh-eyes-loop 的 A/B 即基于 reviewer + engineer 构建（同底座，不同行为指令——见 `prompts/`）。

> **⚠️ `FORGE/SKILL/` 与顶层 `SKILL/` 的关系**：两者同名但职责不同——`FORGE/SKILL/` 是 FORGE **内部 loop skill**（fresh-eyes-loop / release-gate-loop 的编排定义，仅 FORGE 自迭代用，不对外分发）；顶层 `SKILL/`（`SKILL/SKILL.md`）是**产品分发物**（FDE Agent 的运行时 skill，随 sofagent 安装部署到平台 skill 目录）。勿混用——改 FORGE 内部 loop 行为改 `FORGE/SKILL/`，改产品交付物改顶层 `SKILL/`。

## 目录

```
FORGE/
  README.md                     ← 你在这里
  quick-start.md                ← 模型接入与环境配置
  LEDGER.md                     ← 跨 run 永久索引（git 跟踪）
  lessons/                      ← 跨版本经验教训（index.md + 分章）
  ontology/                     ← 开发本体（dogfooding FDE §5）
    README.md                    ← 本体全景：六阶段闭环 + 多模型分工 + 文档分级
    objects.yml / actions.yml / constraints.yml
  playbook/                     ← 证据工具（外环闸门 + 内环验证）
    acceptance-test.sh           ← A5-d3 闸门证据
    regression-checklist.md      ← 回归检查维度
    fresh-eyes-review.md         ← 留白式直觉审查（12 视角）
    dev-prompt-checklist.md      ← A0 闸门人脑补充层（check-dev-prompt.sh 拦不住的软错误）
    acceptance-node-probes.js    ← release-gate-loop 探针
    version-bump.md / doc-sync.md
  SKILL/
    fresh-eyes-loop/             ← 内环 1：质量循环（A/B 双 Agent）
      SKILL.md / loop.md / prompts/ / evolution.md / runs/
    release-gate-loop/           ← 内环 2：发版闸门
      SKILL.md / loop.md / prompts/ / evolution.md / runs/
  src/
    fresh-eyes-driver.mjs        ← fresh-eyes-loop 编排 driver
    release-gate-driver.mjs      ← release-gate-loop 编排 driver
    progress-middleware.mjs      ← 进度上报中间件
    visibility.mjs / disk-backend.mjs / reporters/
```

### 技术债登记 · 拆分排期

- **`FORGE/src/fresh-eyes-driver.mjs`（3691 行，仓内最大脚本）**：`driver-base.mjs` 已抽 1499 行公共层（preflight / 信号清理 / 镜像漂移防御），但单文件体量仍是贡献者认知税。**拆分排期：下次新增 driver 能力时按模块拆分**——触发条件 = 新增 driver 能力或触及 fresh-eyes-driver 长文件维护；本轮不拆代码（无近期触发因素，强行拆属高风险重构）。

> **演进历程**：FORGE 从硬编码串行工具包（engineer→audit→reviewer 单循环 + loop-install.sh 独立安装）→ workflow 驱动（`FORGE/SKILL/<loop>/` + driver 自动编排）→ 双层循环架构（外环 releasing.md loop body + 内环 fresh-eyes/release-gate）。旧 `loop-workflow.sh`、`FORGE/SKILL.md`、`FORGE/loop-install.sh`、`FORGE/releaser/` 已删除。当前两个内环已可 driver 自转；外环的关键节点正逐步从"手动审批"升级为"证据闸门"——最近一轮补上的是 A0 的 `check-dev-prompt.sh`。
