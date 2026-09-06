# ============================================================
# sofagent daemon.ps1 · daemon 主进程 (Windows PowerShell)
# ============================================================
# daemon.sh 的原生 Windows 移植。命令：start / stop / status / -Foreground。
# 主循环每 30s：检测平台进程 + think.md/fde.md hash 变化 → 更新 daemon.json + daemon.log。
# bash 版拒绝在非 Unix 运行；本版**支持 Windows**（Get-Process/Start-Process/Get-FileHash）。
#
# 用法：daemon.ps1 start | stop | status | -Foreground
# ============================================================

param(
    [Parameter(Position = 0)][string]$Command = "",
    [switch]$Foreground
)

$ErrorActionPreference = "Continue"
$VERSION_STR = "1.4.5"
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}

$cfg = Join-Path $PSScriptRoot "lib\config.ps1"
if (Test-Path $cfg) { . $cfg }

# ── 路径（config.ps1 解析 SOFAGENT_DATA + .sofagent-data-path 标记）──
$script:SOFAGENT_DATA = if (-not [string]::IsNullOrEmpty($env:SOFAGENT_DATA)) { $env:SOFAGENT_DATA } else { Join-Path (Get-Location).Path ".sofagent" }
$script:DAEMON_JSON = Join-Path $script:SOFAGENT_DATA "daemon.json"
$script:DAEMON_LOG = Join-Path $script:SOFAGENT_DATA "daemon.log"
$script:DAEMON_PID_FILE = Join-Path $script:SOFAGENT_DATA "daemon.pid"
$utf8NoBom = New-Object System.Text.UTF8Encoding $false

# ── 加载函数库 ──
$lib = Join-Path $PSScriptRoot "lib\daemon-lib.ps1"
if (Test-Path $lib) { . $lib }

function Initialize-DataDir { New-Item -ItemType Directory -Force -Path $script:SOFAGENT_DATA | Out-Null }
function Get-UtcNow { (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ") }

function Initialize-DaemonJson {
    $obj = [ordered]@{
        pid = $PID; started_at = (Get-UtcNow); mode = "full"; detected_platforms = "";
        think_hash = ""; rules_hash = ""; last_check = (Get-UtcNow); last_evidence_score = "unknown"
    }
    [System.IO.File]::WriteAllText($script:DAEMON_JSON, (([pscustomobject]$obj) | ConvertTo-Json -Depth 5), $utf8NoBom)
}

function Find-ThinkFile {
    $f = Join-Path $script:SOFAGENT_DATA "think.md"
    if (Test-Path $f) { return $f } else { return "" }
}
function Find-RulesFile {
    foreach ($c in @("$env:USERPROFILE\.openclaw\skills\sofagent\fde.md", "$env:USERPROFILE\.workbuddy\skills\sofagent\fde.md", "$env:USERPROFILE\.openclaw\fde.md", "$env:USERPROFILE\.workbuddy\fde.md")) {
        if (Test-Path $c) { return $c }
    }
    return ""
}

function Invoke-MainLoop {
    Initialize-DaemonJson
    Write-DaemonLog "daemon 主循环启动 (PID $PID)"
    while ($true) {
        $now = Get-UtcNow
        $platforms = Get-DetectedPlatforms
        $thinkHash = Get-FileHash16 (Find-ThinkFile)
        $rulesHash = Get-FileHash16 (Find-RulesFile)
        $o = Get-DaemonJson
        if ($null -ne $o) {
            if ($thinkHash -and $thinkHash -ne $o.think_hash) {
                Write-DaemonLog "think.md 已变更 ($($o.think_hash) -> $thinkHash)"
                Write-DaemonLog "[daemon] $now think.md 已变更——下次启动时建议读取最新反思"
            }
            if ($rulesHash -and $rulesHash -ne $o.rules_hash) {
                Write-DaemonLog "fde.md 已变更 ($($o.rules_hash) -> $rulesHash)"
                Write-DaemonLog "[daemon] $now fde.md 已变更——下次启动时建议读取最新规则"
            }
            $o.pid = $PID; $o.detected_platforms = $platforms; $o.think_hash = $thinkHash; $o.rules_hash = $rulesHash; $o.last_check = $now
            # 最小可信验证
            $ev = "unknown"
            $vePs = Join-Path $PSScriptRoot "verify-evidence.ps1"
            if (Test-Path $vePs) {
                try { & powershell -NoProfile -ExecutionPolicy Bypass -File $vePs -Daemon 2>$null | Out-Null; $ev = if ($LASTEXITCODE -eq 0) { "verified" } else { "unverified" } } catch { $ev = "unverified" }
            }
            $o.last_evidence_score = $ev
            Set-DaemonJson $o
        }
        Start-Sleep -Seconds 30
    }
}

function Start-Daemon {
    Initialize-DataDir
    if (Test-DaemonRunning) { Write-Host "daemon 已在运行 (PID $(Get-DaemonPid))"; return }
    Write-Host "启动 sofagent daemon..."
    $p = Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"", "-Foreground" -WindowStyle Hidden -PassThru
    $p.Id | Out-File -FilePath $script:DAEMON_PID_FILE -Encoding ascii
    Start-Sleep -Seconds 1
    if (Get-Process -Id $p.Id -ErrorAction SilentlyContinue) { Write-Host "daemon 已启动 (PID $($p.Id))" }
    else { Write-Host "daemon 启动失败，查看日志: $script:DAEMON_LOG"; Remove-Item $script:DAEMON_PID_FILE -Force -EA SilentlyContinue }
}

function Stop-Daemon {
    $p = Get-DaemonPid
    if ([string]::IsNullOrEmpty($p)) { Write-Host "daemon 未运行（无 PID 文件）"; Remove-Item $script:DAEMON_PID_FILE -Force -EA SilentlyContinue; return }
    if (Get-Process -Id ([int]$p) -ErrorAction SilentlyContinue) {
        Write-Host "停止 daemon (PID $p)..."
        Stop-Process -Id ([int]$p) -Force -ErrorAction SilentlyContinue
        Write-Host "daemon 已停止"
    } else { Write-Host "daemon 进程 $p 已不存在" }
    Remove-Item $script:DAEMON_PID_FILE -Force -EA SilentlyContinue
}

function Show-Status {
    $statusPs = Join-Path $PSScriptRoot "daemon-status.ps1"
    if (Test-Path $statusPs) { & $statusPs } else { Write-Host "daemon-status.ps1 未找到——请确保 daemon 已安装" }
}

# ── 路由 ──
if ($Foreground) {
    Initialize-DataDir
    $PID | Out-File -FilePath $script:DAEMON_PID_FILE -Encoding ascii
    Invoke-MainLoop
    return
}
switch ($Command.ToLower()) {
    "start"  { Start-Daemon }
    "stop"   { Stop-Daemon }
    "status" { Show-Status }
    default {
        Write-Host "sofagent daemon v$VERSION_STR (PowerShell)"
        Write-Host "用法: daemon.ps1 start | stop | status | -Foreground"
        Write-Host "  start 后台启动 / stop 停止 / status 状态 / -Foreground 前台(调试)"
    }
}
