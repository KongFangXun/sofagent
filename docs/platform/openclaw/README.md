# OpenClaw 平台

> 实地勘察自本机 `~/.openclaw/`（2026-06）。OpenClaw 是 sofagent 唯一**有真 Hook 级注入**的平台。

## 目录结构（`~/.openclaw/`）

| 路径 | 作用 |
|------|------|
| `skills/sofagent/` | Skill 部署位置（含 `rules.md` 权威扁平化路径） |
| `hooks/sofagent-load-chain/` | **内部 hook**：`HOOK.md` + `handler.ts` |
| `scripts/` | 配套脚本 |
| `logs/` | `config-audit.jsonl` / `config-health.json`（偏配置审计） |
| `openclaw.json` | hook 注册（`hooks.internal.entries.sofagent-load-chain`） |
| `config.json` | `tools.loopDetection`（断路器）等 |
| `agents/main/` `flows/` `state/` `plugins/` `identity/` | 运行时 |

## 内部 Hook 机制（2026.6.x）

- **声明式内部 hook**：`hooks/sofagent-load-chain/`（HOOK.md + handler.ts），在 `openclaw.json` 的
  `hooks.internal.entries.sofagent-load-chain` 注册 `enabled:true`。
- **触发事件**：`agent:bootstrap`——子 Agent 启动时自动注入 sofagent 第 2 层（think.md）+ 第 3 层（rules.md）
  到 bootstrap 文件列表。第 1 层宪法由 skill 系统注入，hook 不重复。
- handler.ts 是 **TypeScript**，由 OpenClaw runtime 在事件触发时执行（非 bash 可跑）。
- 旧版 `load-chain.sh`（`config.json.before_prompt_build` shell hook）在 2026.6.x **已失效，v0.64 起删除**。

## 断路器（config.json）

`tools.loopDetection`：检测器 `genericRepeat` / `pingPong` / `knownPollNoProgress` +
`globalCircuitBreakerThreshold`（全局熔断步数）。install 注入、uninstall 移除。

## 与 A/B 评测的关系

- OpenClaw 日志 `logs/config-audit.jsonl` 偏**配置审计**，行为粒度不如 WorkBuddy 的 `audit-log/`。
- 但 OpenClaw 有 **agent:bootstrap 内部 hook** → 理论上可扩展一个 **post-tool-use 观察 hook**
  捕获实际工具调用（独立机械层）。若要在 OpenClaw 做 A/B，这是补"独立观察器"的落点。
- 现状：**WorkBuddy 的 audit-log 是现成机械层**（见 `../workbuddy/audit-log.md`），优先用它。
