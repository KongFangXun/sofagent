# 原生 Windows 环境（PowerShell + 非 WSL）

> "原生 Windows" = **Windows PowerShell 5.1（`powershell.exe`）+ 非 WSL**（用户定义）。
> 完整环境矩阵 + 编码/换行踩坑全集见 [`docs/bug_fix/tests/ENVIRONMENTS.md`](../../bug_fix/tests/ENVIRONMENTS.md)。

> 📦 **安装 / 使用 / 卸载（面向用户的操作指南）见 [install.md](install.md)。** 本文是环境勘察 + 移植现状 + 踩坑记录（面向维护者）。

## 本机环境（Windows 11 build 26200，中文版）

| 组件 | 版本 |
|------|------|
| Shell | Windows PowerShell **5.1** / 另有 MSYS2 bash 5.3.9（Git Bash） |
| coreutils | GNU **8.32**（MSYS2 侧）；WSL Ubuntu 侧 9.4 |
| git | 2.54.0.windows.1（`core.autocrlf=true`） |
| Node/npm | v24.15.0 / 11.12.1（**ao 原生可装可跑**） |
| curl | 8.19.0（Schannel TLS） |
| jq | 无（脚本用 ConvertFrom-Json / python 替代） |

## sofagent 原生 Windows 支持现状

**全部 shell 脚本已原生化**（feat/windows-installer 分支，**16 个 .sh 移植 100% 覆盖 + ab-eval.ps1 = 17 个 .ps1**）：
install / uninstall / task-record / audit / lib·config / task-orchestrate / verify / cleanup /
compress-memory / verify-evidence / benchmark / daemon / daemon-install / daemon-status /
daemon-uninstall / lib·daemon-lib。**14 个 .sh + 2 lib 全部有对应 .ps1**；另加 fork 专属 `ab-eval.ps1`（audit-log A/B 分析，上游无 .sh 对应）。

> **目录布局**：仓库内 `.ps1` 集中在 `sofagent/scripts/windows/`（含 `windows/lib/`），与顶层 `.sofagent/scripts/*.sh` 分开，避免散乱；
> 部署到平台后仍**扁平**落在 `~/.workbuddy/scripts/`（`.ps1` 与 `.sh` 共存），运行时调用路径不变。
> 已合并 upstream v0.84；install.ps1 已补 v0.84 新行为（部署后 SKILL.md 置 `disable: true`）。
> 已知小问题：.ps1 版本号仍标 0.82（落后 .sh 的 0.84），见 `issues/026`，仅展示性。

> daemon 系列：bash 版拒绝非 Unix；PS 版支持 Windows（Get-Process/Start-Process/
> Register-ScheduledTask 替 pgrep/nohup/launchd）。

- **Skill dispatch**：SKILL.md 第 1 层加「跨平台脚本调用约定」——`bash X.sh --flag` 在纯 PowerShell
  改 `powershell -File X.ps1 -Flag`（kebab→Pascal）。install.ps1 部署 .ps1 到 `~/.workbuddy/scripts/`。
- **E2E 已验证**：install→部署→反思闭环→uninstall 纯 PowerShell 全过。
- **ao**：Node 包，`npm i -g agency-orchestrator` 原生可用，无需 WSL/Python。

## 编码三铁律（写 .ps1 必看，详见 ENVIRONMENTS.md）

1. 含中文 `.ps1` 存 **UTF-8 BOM**（PS 5.1 读无 BOM 按 GBK 解析、乱码）。
2. 加 BOM 时读取须 `Get-Content -Raw -Encoding UTF8`（否则 GBK 误读读坏）。
3. 脚本顶部 `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false`（防输出被 Agent 读到乱码）。
4. `.gitattributes` 锁 `*.ps1=CRLF` / `*.sh=LF`。

## PowerShell 语法坑（移植 16 脚本踩过）

- `if` 表达式**不能直接作函数参数** → 先 `$x = if...` 再传。
- `switch` 无 `break` **执行所有匹配 case** → 用 if/elseif 链。
- **函数前向引用**：顺序解释，定义须在调用前。
- **单元素嵌套数组 `@(@(...))` 被摊平** → 遍历到字符。
- 日志写 UTF-8 无 BOM：`[IO.File]::AppendAllText($p,$s,(New-Object Text.UTF8Encoding $false))`。
