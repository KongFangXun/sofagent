# engine.md · 任务编排引擎 · v0.64

> 由 SKILL.md A0 触发。仅 🔴 复杂任务且用户确认后点火。`{SOFAGENT_DATA}` = `{当前工作目录}/.sofagent/`。
> ⛔ 三层加载链已在 SKILL.md 启动时完成——engine.md 不重复。编排引擎只管拆解、执行、闭环。
> B.系统安装 + D.种子指令均为一次性执行（首次后自动跳过）。
> Skill 检索（ClawHub）→ 见 [Developer §三](../DEVELOPMENT.md#三模型最优选择)「四步集成 + 渐进信任」。
> 离线模式：rules.md 含 `offline: true` 时，跳过 ClawHub 搜索，Skills 手动放入 `~/.openclaw/skills/` 目录。
>
> 当 `command -v ao` 失败或 rules.md 含 `offline: true` 时，走默认编排：
> 1. 主 Agent 按语义簇拆 3-5 个子任务（按任务描述的自然语义分界）
> 2. 每个子任务手动分配角色（从 agency-agents-zh 模板或 Agent 自行判断）
> 3. 用 `{OPENCLAW_SCRIPTS}/task-record.sh` 逐条记录，手动闭环
> 4. 不生成 YAML 工作流文件——主 Agent 直接在上下文里管理 DAG
>
> ⚠️ **ao 降级前必须检查 API Key**：`command -v ao` 成功 ≠ ao 可用。即使 ao 已安装，如果没有配置 LLM API Key（`$DEEPSEEK_API_KEY` / `$ANTHROPIC_API_KEY` / `$OPENAI_API_KEY` 任一非空），ao compose 会静默失败，后续闭环也写不进去。判断细节见下方「A2. ao 能力探测」。
>
> 这是简化版编排——没有 ao compose 的模板匹配和自动分配，但保留了"拆解→执行→闭环"的核心结构。比纯手动强，比 ao 弱。

---

## A. 平台检测 + 场景判断

**平台**（优先读缓存 `{SOFAGENT_DATA}/platform`）：`~/.openclaw/`→OpenClaw / `~/.workbuddy/`→WorkBuddy / `$CLAUDE_CODE`→Claude Code / `~/.codex/`→Codex / `~/.hermes/`→Hermes → 检测后写缓存。

**场景**（检查 `{SOFAGENT_DATA}/think.md`）：
→ 不存在 → 首次运行：继续 B→D。口头：「sofagent 已就绪。」
→ 存在 → 回归运行：跳过 B+D，读 think.md 反思区 → 直接进子 Skill 索引。

## A2. ao 能力探测（🔴 任务点火前必跑）

> `command -v ao` 成功 ≠ ao 可用。ao compose 静默失败会让 Agent 困在手工拆解里而不自知。本节点把判断做成显式步骤，不依赖「仔细读注释」的自觉。

按顺序判断，命中即停：

1. ✅ **完整编排** — `command -v ao` 成功 **且** (`$DEEPSEEK_API_KEY` / `$ANTHROPIC_API_KEY` / `$OPENAI_API_KEY` 任一非空) → 走 ao compose（模板匹配 → 子 Agent 分配 → Loop check）。
2. ⚠️ **口头告知后降级** — `command -v ao` 成功 **但** 三个 Key 全空 → 先口头告知用户：「ao 已安装但未配置 API Key，编排降级为手工拆解。配置任一 LLM API Key（DEEPSEEK_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY）后可用。」然后走默认编排。
3. ❌ **直接降级** — `command -v ao` 失败 → 走默认编排（ao 未安装）。

> 默认编排见文件顶部注释块（按语义簇拆 3-5 个子任务 + 手动分配角色 + `{OPENCLAW_SCRIPTS}/task-record.sh` 逐条记录）。

## B. 系统安装（一次性）

**B0**：
- OpenClaw → 首次从源仓库运行 `bash sofagent/scripts/install.sh --platform openclaw`（install.sh 是安装器，不部署自身到 scripts/；已安装则跳过）。失败不阻塞。
- WorkBuddy → 跳过（WorkBuddy 靠 skill 系统加载，不依赖 shell hook 与 scripts/，B0 无需调脚本）。
**B1**：`mkdir -p {SOFAGENT_DATA}/{task/plans,task/logs,scoring,orchestrator}` → 创建 `think.md`（反思区空白模板）→ 创建 `scoring/_index.md` + `orchestrator/_index.md`。bash 不可用：逐条 mkdir + Write。
**B2**：INIT_OK → 继续 D。失败 → 停止：「初始化失败，检查权限。」

## D. 植入种子指令（一次性）

先读目标文件查重（含 `sofagent` 则跳过）。自动写：WorkBuddy→`.workbuddy/memory/MEMORY.md` / OpenClaw→`~/.openclaw/MEMORY.md`。手动：Claude→`CLAUDE.md` / Codex→`AGENTS.md` / Hermes→`SOUL.md`。内容：「每次对话开始时，读取 SKILL.md 并执行入口流程。」

---

## ⛔ 入口结束 → 加载子 Skill

> 入口流程（A→B→D）完成后立即 Read `entry-gate.md` 并执行全部。⛔ 闸门检查严禁输出给用户。

| # | 子 Skill | 何时加载 | 位置 |
|:--:|------|------|------|
| 1 | entry-gate | 入口结束后 | `entry-gate.md` |
| 2 | task-aware | 收到任何任务时 | `task-aware.md` |
| 3 | task-closure | 闭环信号时 | `task-closure.md` |
| 4 | loop-check | 检查点/失败/闭环 | `loop-check.md` |

闭环信号：① 子任务完成+用户确认 ② 用户 /new 或 /reset。

---

## 执行纪律

SKILL.md 地基 → A0 → 🟢🟡只读task-aware / 🔴→engine→entry-gate。**回复前闸门**每次执行。核心靠 MD 文件，脚本仅在 bash 可用时使用。写入前读确认、写入后验证。数据仅写 `{SOFAGENT_DATA}/`。**加载链、能力注册、每任务闸门、闭环清单——四个硬出口，严禁输出给用户。**
