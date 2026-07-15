# ============================================================
# sofagent daemon-install.ps1 · daemon 安装 (Windows PowerShell)
# ============================================================
# daemon-install.sh 的移植。注册 Windows 计划任务（替 launchd/systemd）：
# 登录时自动 daemon.ps1 start。注册失败（权限）则提示手动启动。
#
# 用法：daemon-install.ps1
# ============================================================

$ErrorActionPreference = "Continue"
$VERSION_STR = "1.1.2"
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}

$daemonPs = Join-Path $PSScriptRoot "daemon.ps1"
# scripts/windows → scripts → sofagent → 项目根
$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$taskName = "sofagentDaemon"

Write-Host "安装 sofagent daemon（Windows 计划任务）..."
if (-not (Test-Path $daemonPs)) { Write-Host "[X] 找不到 daemon.ps1: $daemonPs"; exit 1 }

try {
    $action = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$daemonPs`" start" `
        -WorkingDirectory $repoRoot
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force -ErrorAction Stop | Out-Null
    Write-Host "[OK] 已注册计划任务: $taskName（登录时自动启动 daemon）"
} catch {
    Write-Host "[!] 计划任务注册失败（可能需要管理员权限）：$($_.Exception.Message)"
    Write-Host "    可手动启动: powershell -File `"$daemonPs`" start"
}

# 立即启动一次
Write-Host "立即启动 daemon..."
& powershell -NoProfile -ExecutionPolicy Bypass -File $daemonPs start

Write-Host ""
Write-Host "[OK] daemon 安装完成。查看状态: powershell -File `"$(Join-Path $PSScriptRoot 'daemon-status.ps1')`""
