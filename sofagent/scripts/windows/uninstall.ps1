# ============================================================
# sofagent uninstall.ps1 · Windows PowerShell 卸载脚本
# ============================================================
# 删除 sofagent 约束文件，保留 .sofagent/ 用户数据。
# 与 uninstall.sh (WSL/Linux/macOS) 按环境解耦；与 install.ps1 对称。
#
# 用法：
#     .\uninstall.ps1 -Platform workbuddy
#     .\uninstall.ps1 -Force          跳过确认直接删除
#     .\uninstall.ps1 -List           仅列出将删除项，不执行
#     .\uninstall.ps1 -Help
# ============================================================

param(
    [string]$Platform       = "",
    [switch]$Force,
    [switch]$List,
    [switch]$CleanBenchmark,    # 清理 benchmark-cross.ps1 自动写入的模型配置
    [switch]$Help
)

$ErrorActionPreference = "Stop"
$VERSION = "1.1.7"

function Write-Info { param($msg) Write-Host "[sofagent] $msg" -ForegroundColor Cyan }
function Write-Ok   { param($msg) Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "[!] $msg" -ForegroundColor Yellow }
function Write-Err  { param($msg) Write-Host "[X] $msg" -ForegroundColor Red }

# 帮助
if ($Help) {
    Write-Host "sofagent uninstall.ps1 v$VERSION"
    Write-Host ""
    Write-Host "Windows PowerShell 卸载脚本 (workbuddy/openclaw/claude/codex/hermes)"
    Write-Host ""
    Write-Host "用法:"
    Write-Host "    .\uninstall.ps1 -Platform workbuddy"
    Write-Host "    .\uninstall.ps1 -Force          跳过确认直接删除"
    Write-Host "    .\uninstall.ps1 -List           仅列出将删除项，不执行"
    Write-Host "    .\uninstall.ps1 -CleanBenchmark 清理 benchmark-cross 写入的模型配置"
    Write-Host ""
    Write-Host "参数:"
    Write-Host "    -Platform       目标平台 (workbuddy|openclaw|claude|codex|hermes)"
    Write-Host "    -Force          跳过交互确认（不自动清理 benchmark 配置，需加 -CleanBenchmark）"
    Write-Host "    -List           预览将删除的文件"
    Write-Host "    -CleanBenchmark 清理 benchmark-cross.ps1 自动添加的模型条目"
    Write-Host "    -Help           显示此帮助"
    Write-Host ""
    Write-Host "保留: .sofagent/ 数据目录 (如需清除请手动删除)"
    exit 0
}

# 环境检测
Write-Host ""
Write-Host "  +===================================+"
Write-Host "  |   sofagent Harness - uninstaller   |"
Write-Host "  |   (Windows PowerShell)            |"
Write-Host "  +===================================+"
Write-Host ""

# WSL 检测 (仅认 WSL_DISTRO_NAME——WSLENV 在装了 WSL 的 Windows 主机上也会被设, 不能作判据)
if ($env:WSL_DISTRO_NAME) {
    Write-Err "检测到 WSL 环境, 请使用 uninstall.sh (bash) 而非本脚本"
    Write-Warn "  bash sofagent/scripts/uninstall.sh --platform workbuddy"
    exit 1
}
# 操作系统检测（PS 5.1 无 $IsWindows，用 $env:OS 判断）
if ($env:OS -ne "Windows_NT") {
    Write-Err "本脚本仅支持 Windows, 非 Windows 环境请使用 uninstall.sh"
    exit 1
}

# 平台探测
if ([string]::IsNullOrEmpty($Platform)) {
    if     (Test-Path "$env:USERPROFILE\.workbuddy") { $Platform = "workbuddy" }
    elseif (Test-Path "$env:USERPROFILE\.openclaw")  { $Platform = "openclaw" }
    elseif (Test-Path "$env:USERPROFILE\.claude")    { $Platform = "claude" }
    elseif (Test-Path "$env:USERPROFILE\.codex")     { $Platform = "codex" }
    elseif (Test-Path "$env:USERPROFILE\.hermes")    { $Platform = "hermes" }
    else { $Platform = "workbuddy" }
}
$Platform = $Platform.ToLower()

switch ($Platform) {
    "workbuddy" { $TARGET = "$env:USERPROFILE\.workbuddy" }
    "openclaw"  { $TARGET = "$env:USERPROFILE\.openclaw" }
    "claude"    { $TARGET = "$env:USERPROFILE\.claude" }
    "codex"     { $TARGET = "$env:USERPROFILE\.codex" }
    "hermes"    { $TARGET = "$env:USERPROFILE\.hermes" }
    default     { $TARGET = "$env:USERPROFILE\.workbuddy" }
}
Write-Info "平台: $Platform -> 目标: $TARGET"

# 收集将删除项 (对应 install.ps1 部署的内容)
$skillDir  = Join-Path $TARGET "skills\sofagent"
$rulesFile = Join-Path $TARGET "fde.md"
$scriptsDir = Join-Path $TARGET "scripts"
$targets = @()
if (Test-Path $skillDir)   { $targets += $skillDir }
if (Test-Path $rulesFile)  { $targets += $rulesFile }
if (Test-Path $scriptsDir) { $targets += $scriptsDir }

if ($targets.Count -eq 0) {
    Write-Warn "未发现 sofagent 部署文件 ($TARGET 下无 skills\sofagent 或 fde.md)"
    exit 0
}

Write-Host ""
Write-Host "  将删除以下 sofagent 约束文件:"
foreach ($t in $targets) {
    if (Test-Path $t -PathType Container) {
        $n = (Get-ChildItem $t -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
        Write-Host "    $t\  ($n 个文件)"
    } else {
        Write-Host "    $t"
    }
}
Write-Host ""
Write-Host "  保留: 工作区 .sofagent/ 数据目录 (如需清除请手动删除)"
Write-Host ""

# -List: 仅预览
if ($List) {
    Write-Host "  (-List 模式, 未执行删除)"
    exit 0
}

# 确认
if (-not $Force) {
    $confirm = Read-Host "  确认删除? [y/N]"
    if ($confirm -notmatch '^[yY]') {
        Write-Host "  已取消。"
        exit 0
    }
}

# 执行删除
$removed = 0
foreach ($t in $targets) {
    Remove-Item -Recurse -Force $t -ErrorAction SilentlyContinue
    if (-not (Test-Path $t)) { Write-Ok "已删除: $t"; $removed++ }
    else { Write-Err "删除失败: $t" }
}

# OpenClaw 专属清理：Hook + openclaw.json 注销 + config.json loopDetection + benchmark 状态（对齐 uninstall.sh）
if ($Platform -eq "openclaw") {
    $utf8b = New-Object System.Text.UTF8Encoding $false
    $hookDir = Join-Path $TARGET "hooks\sofagent-load-chain"
    if (Test-Path $hookDir) { Remove-Item $hookDir -Recurse -Force -EA SilentlyContinue; Write-Ok "已删除 Hook: $hookDir" }

    # AGENTS.md 约束注入清理（benchmark-cross.ps1 Set-SofagentContext 写入的 marker 段落）
    $agentsMd = Join-Path $TARGET "workspace\AGENTS.md"
    if (Test-Path $agentsMd) {
        try {
            $ac  = [System.IO.File]::ReadAllText($agentsMd, [System.Text.Encoding]::UTF8)
            $mks = "<!-- sofagent-constraint-start -->"
            $mke = "<!-- sofagent-constraint-end -->"
            $pat = [regex]::Escape($mks) + '[\s\S]*?' + [regex]::Escape($mke)
            if ($ac -match $pat) {
                $cleaned = ([regex]::Replace($ac, $pat, "")).TrimEnd() + "`n"
                [System.IO.File]::WriteAllText($agentsMd, $cleaned, $utf8b)
                Write-Ok "已清理 AGENTS.md 中的 sofagent 约束段"
            }
        } catch { Write-Warn "AGENTS.md 清理失败：$($_.Exception.Message)" }
    }

    $ocCfg = if ($env:OPENCLAW_CONFIG_PATH) { $env:OPENCLAW_CONFIG_PATH } else { Join-Path $TARGET "openclaw.json" }
    if (Test-Path $ocCfg) {
        try {
            $j = Get-Content $ocCfg -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($j.hooks -and $j.hooks.internal -and $j.hooks.internal.entries -and $j.hooks.internal.entries.PSObject.Properties['sofagent-load-chain']) {
                $j.hooks.internal.entries.PSObject.Properties.Remove('sofagent-load-chain')
                [System.IO.File]::WriteAllText($ocCfg, ($j | ConvertTo-Json -Depth 10), $utf8b)
                Write-Ok "已注销 openclaw.json 中的 sofagent-load-chain"
            }
        } catch { Write-Warn "openclaw.json 注销失败：$($_.Exception.Message)" }
    }
    $cfgFile = Join-Path $TARGET "config.json"
    if (Test-Path $cfgFile) {
        try {
            $cf = Get-Content $cfgFile -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($cf.tools -and $cf.tools.PSObject.Properties['loopDetection']) {
                $cf.tools.PSObject.Properties.Remove('loopDetection')
                [System.IO.File]::WriteAllText($cfgFile, ($cf | ConvertTo-Json -Depth 10), $utf8b)
                Write-Ok "已移除 config.json 中的 loopDetection"
            }
        } catch { Write-Warn "config.json 清理失败：$($_.Exception.Message)" }
    }

    # Benchmark 状态清理：benchmark-cross.ps1 自动添加的模型条目
    $benchState = Join-Path $TARGET "sofagent-benchmark-state.json"
    if (Test-Path $benchState) {
        try {
            $state       = Get-Content $benchState -Raw -Encoding UTF8 | ConvertFrom-Json
            $addedModels = @($state.addedModels | Where-Object { $_ })
            if ($addedModels.Count -gt 0) {
                Write-Host ""
                Write-Warn "检测到 benchmark-cross.ps1 曾自动添加的模型配置："
                $addedModels | ForEach-Object { Write-Host "      - $_" -ForegroundColor DarkYellow }
                Write-Host ""

                $doClean = if ($CleanBenchmark) {
                    $true
                } elseif ($List) {
                    Write-Host "      (-List 模式：跳过清理决策)"
                    $false
                } else {
                    $ans = Read-Host "  是否从 openclaw.json 中移除这些模型配置? [y/N]"
                    $ans -match '^[yY]'
                }

                if ($doClean -and (Test-Path $ocCfg)) {
                    $jj = Get-Content $ocCfg -Raw -Encoding UTF8 | ConvertFrom-Json
                    foreach ($mid in $addedModels) {
                        if ($jj.agents -and $jj.agents.defaults -and $jj.agents.defaults.models -and
                            $jj.agents.defaults.models.PSObject.Properties[$mid]) {
                            $jj.agents.defaults.models.PSObject.Properties.Remove($mid)
                            Write-Ok "已从允许列表移除：$mid"
                        }
                    }
                    [System.IO.File]::WriteAllText($ocCfg, ($jj | ConvertTo-Json -Depth 10), $utf8b)
                    Remove-Item $benchState -Force -EA SilentlyContinue
                    Write-Ok "benchmark 状态文件已清除"
                } else {
                    Write-Info "保留 benchmark 模型配置（sofagent-benchmark-state.json 仍在）"
                }
            }
        } catch { Write-Warn "benchmark 状态清理失败：$($_.Exception.Message)" }
    }
}

# daemon 清理（所有平台——daemon 可经 install.ps1 -WithDaemon 在任意平台安装；无任务时无害）
$dUninst = Join-Path $PSScriptRoot "daemon-uninstall.ps1"
if (Test-Path $dUninst) {
    try { & powershell -NoProfile -ExecutionPolicy Bypass -File $dUninst 2>$null | Out-Null; Write-Ok "已清理 daemon（如有）" }
    catch {}
}

Write-Host ""
Write-Host "  +====================================+"
Write-Host "  |  sofagent - 卸载完成                |"
Write-Host "  +====================================+"
Write-Host ""
Write-Host "  共删除 $removed 项约束文件。.sofagent/ 工作区数据已保留。"
Write-Host "  重新安装: .\install.ps1 -Platform $Platform"
Write-Host ""
