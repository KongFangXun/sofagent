# ============================================================
# sofagent daemon-uninstall.ps1 · daemon 卸载 (Windows PowerShell)
# ============================================================
# daemon-uninstall.sh 的移植。停止 daemon + 注销计划任务。
# 保留 daemon.json / daemon.log / .sofagent 用户数据。
#
# 用法：daemon-uninstall.ps1
# ============================================================

$ErrorActionPreference = "Continue"
$VERSION_STR = "1.3.9"
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}

$daemonPs = Join-Path $PSScriptRoot "daemon.ps1"
$taskName = "sofagentDaemon"

Write-Host "卸载 sofagent daemon..."

# 停止 daemon
if (Test-Path $daemonPs) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $daemonPs stop 2>$null
}

# 注销计划任务
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    try {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
        Write-Host "[OK] 已注销计划任务: $taskName"
    } catch {
        Write-Host "[!] 注销计划任务失败（可能需要权限）：$($_.Exception.Message)"
    }
} else {
    Write-Host "（无计划任务 $taskName）"
}

Write-Host "daemon.json / daemon.log 等用户数据已保留在 .sofagent/ 中"
Write-Host ""

$daemonScripts = @(
    (Join-Path $PSScriptRoot "daemon.ps1"),
    (Join-Path $PSScriptRoot "lib\daemon-lib.ps1")
)
foreach ($script in $daemonScripts) {
    if (Test-Path $script) {
        Remove-Item $script -Force
        Write-Host "[OK] 已删除: $(Split-Path $script -Leaf)"
    }
}

Write-Host "[OK] daemon 已卸载。"
