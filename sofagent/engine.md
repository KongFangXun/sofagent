# engine.md · 任务编排引擎 · v0.55

> 由 SKILL.md A0 触发。仅 🔴 复杂任务且用户确认后点火。`{SOFAGENT_DATA}` = `{当前工作目录}/.sofagent/`。
> ⛔ 三层加载链已在 SKILL.md 启动时完成——engine.md 不重复。编排引擎只管拆解、执行、闭环。
> B.系统安装 + D.种子指令均为一次性执行（首次后自动跳过）。
> Skill 检索（ClawHub）→ 见 [Developer §三](../DEVELOPMENT.md#三模型最优选择)「四步集成 + 渐进信任」。
> 离线模式：rules.md 含 `offline: true` 时，跳过 ClawHub 搜索，Skills 手动放入 `~/.openclaw/skills/` 目录。
>
> 当 `command -v ao` 失败或 rules.md 含 `offline: true` 时，走默认编排：
> 1. 主 Agent 按语义簇拆 3-5 个子任务（按任务描述的自然语义分界）
> 2. 每个子任务手动分配角色（从 agency-agents-zh 模板或 Agent 自行判断）
> 3. 用 task-record.sh 逐条记录，手动闭环
> 4. 不生成 YAML 工作流文件——主 Agent 直接在上下文里管理 DAG
>
> 这是简化版编排——没有 ao compose 的模板匹配和自动分配，但保留了"拆解→执行→闭环"的核心结构。比纯手动强，比 ao 弱。

---

## A. 平台检测 + 场景判断

**平台**（优先读缓存 `{SOFAGENT_DATA}/platform`）：`~/.openclaw/`→OpenClaw / `~/.workbuddy/`→WorkBuddy / `$CLAUDE_CODE`→Claude Code / `~/.codex/`→Codex / `~/.hermes/`→Hermes → 检测后写缓存。

**场景**（检查 `{SOFAGENT_DATA}/think.md`）：
→ 不存在 → 首次运行：继续 B→D。口头：「sofagent 已就绪。」
→ 存在 → 回归运行：跳过 B+D，读 think.md 反思区 → 直接进子 Skill 索引。

## B. 系统安装（一次性）

**B0**：OpenClaw → `bash scripts/install.sh --platform openclaw`；WorkBuddy → `bash scripts/task-record.sh --checkpoint --task "session-start"` + `bash scripts/load-chain.sh --check`。失败不阻塞。
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
