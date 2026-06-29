# ============================================================
# sofagent daemon-status.ps1 · daemon 状态查询 (Windows PowerShell)
# ============================================================
# daemon-status.sh 的移植。默认输出 / -Detect 进程检测 / -Json 机器可读。
# 用法：daemon-status.ps1 [-Detect] [-Json]
# ============================================================

param([switch]$Detect, [switch]$Json)

$ErrorActionPreference = "Continue"
$VERSION_STR = "0.97"
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}

$cfg = Join-Path $PSScriptRoot "lib\config.ps1"
if (Test-Path $cfg) { . $cfg }

$script:SOFAGENT_DATA = if (-not [string]::IsNullOrEmpty($env:SOFAGENT_DATA)) { $env:SOFAGENT_DATA } else { Join-Path (Get-Location).Path ".sofagent" }
$script:DAEMON_JSON = Join-Path $script:SOFAGENT_DATA "daemon.json"
$script:DAEMON_PID_FILE = Join-Path $script:SOFAGENT_DATA "daemon.pid"
$lib = Join-Path $PSScriptRoot "lib\daemon-lib.ps1"
if (Test-Path $lib) { . $lib }

function Get-Uptime($startedAt) {
    if ([string]::IsNullOrEmpty($startedAt)) { return "-" }
    try {
        $start = [datetime]::Parse($startedAt, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::AssumeUniversal -bor [System.Globalization.DateTimeStyles]::AdjustToUniversal)
        $sec = [int]((Get-Date).ToUniversalTime() - $start).TotalSeconds
        return "{0}h {1}m {2}s" -f [int]($sec / 3600), [int](($sec % 3600) / 60), ($sec % 60)
    } catch { return "-" }
}

# -Detect：仅进程检测
if ($Detect) { Get-DetectedPlatforms; return }

$pid_ = Get-DaemonPid
$running = Test-DaemonRunning
$o = Get-DaemonJson
$mode = if ($o) { $o.mode } else { "unknown" }
$platforms = if ($o) { $o.detected_platforms } else { "" }
$startedAt = if ($o) { $o.started_at } else { "" }
$evidence = if ($o -and $o.last_evidence_score) { $o.last_evidence_score } else { "unknown" }
$uptime = if ($running) { Get-Uptime $startedAt } else { "-" }

if ($Json) {
    $out = [ordered]@{
        status = if ($running) { "running" } else { "stopped" }
        pid = if ($pid_) { [int]$pid_ } else { 0 }
        uptime = $uptime; mode = $mode; detected_platforms = $platforms
        started_at = $startedAt
        think_hash = if ($o) { $o.think_hash } else { "" }
        rules_hash = if ($o) { $o.rules_hash } else { "" }
        last_check = if ($o) { $o.last_check } else { "" }
        last_evidence_score = $evidence
    }
    Write-Host (([pscustomobject]$out) | ConvertTo-Json -Depth 5 -Compress)
    return
}

# 默认输出
Write-Host "sofagent daemon v$VERSION_STR (PowerShell)"
Write-Host ""
Write-Host "  状态: $(if($running){'[运行中] running'}else{'[已停止] stopped'})"
Write-Host "  PID: $(if($pid_){$pid_}else{'无'})"
Write-Host "  运行时长: $uptime"
Write-Host "  模式: $mode"
Write-Host "  检测平台: $(if($platforms){$platforms}else{'无'})"
Write-Host "  可信证据: $evidence"
