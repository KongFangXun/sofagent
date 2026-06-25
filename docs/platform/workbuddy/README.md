# WorkBuddy 平台

> 实地勘察自本机 `~/.workbuddy/`（2026-06，Windows）。WorkBuddy **跨平台**（Windows + macOS），
> 底层内嵌 OpenClaw（verify 注释："WorkBuddy 内嵌了 OpenClaw，不是独立安装"）。

## 目录结构（`~/.workbuddy/`）

| 路径 | 作用 |
|------|------|
| `skills/sofagent/` | sofagent Skill 部署位置（SKILL.md + 5 子 + data/） |
| `rules.md` | sofagent 第 3 层宪法部署位置 |
| `scripts/` | 配套脚本（Windows 上 install.ps1 部署 .ps1） |
| **`audit-log/`** | **安全中心审计日志**（见 [audit-log.md](audit-log.md)）——runtime 行为机械层 |
| `app/` | Electron 应用数据：`session/`、`sessions.json` |
| `file-history/` | 文件操作历史 |
| `expert-history.json` | 专家团历史 |
| `BOOTSTRAP.md` / `IDENTITY.md` / `SOUL.md` / `USER.md` | Agent 引导/身份/灵魂/用户配置 |
| `artifact-index/` `binaries/` `blobs/` | 产物索引 / 二进制 / blob 存储 |
| `.sofagent-install.log` | sofagent 安装日志 |

## 关键事实

- **平台定位**：sofagent 在 WorkBuddy 上第 1 层宪法靠 skill 机制注入；第 2、3 层靠 Agent 主动 Read（无 OpenClaw 那种 internal hook）。
- **bash 不是阻塞点**：WorkBuddy 跨平台，Windows 版自身处理平台差异（用户确认）。sofagent 的跨平台脚本调用约定（SKILL.md）让 Agent 有 bash 用 `.sh`、纯 PowerShell 用 `.ps1`，两条路都通。
- **审计日志是 A/B 评测的地基**：见 audit-log.md——它是独立于 Agent 自述的 runtime 机械层。
