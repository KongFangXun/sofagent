# ============================================================
# sofagent audit.ps1 · 审计日志脚本 (Windows PowerShell)
# ============================================================
# audit.sh 的原生 Windows 移植。记录关键操作到
# .sofagent/task/audit/YYYY-MM/YYYY-MM-DD.md，追加 Markdown 表格行。
# 仅 fde.md audit_enabled: true 时写入（默认关闭，静默退出）。
#
# 用法：
#   audit.ps1 -Operation install -Target "开始" -Result "v0.99.7, windows"
#   audit.ps1 -Operation orchestrate -Target "重构模块" -Result "成功, L2, 45s"
# ============================================================

param(
    [string]$Operation = "",
    [string]$Target = "",
    [string]$Result = "",
    [switch]$Version,
    [switch]$Help
)

$ErrorActionPreference = "Stop"
$VERSION_STR = "1.1.6"
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}

if ($Version) { Write-Host "sofagent-audit v$VERSION_STR"; exit 0 }
if ($Help) {
    Write-Host "sofagent audit v$VERSION_STR (PowerShell)"
    Write-Host "  记录关键操作到 .sofagent/task/audit/YYYY-MM/YYYY-MM-DD.md"
    Write-Host "  用法: audit.ps1 -Operation <操作> -Target <对象> -Result <结果>"
    Write-Host "  开关: fde.md audit_enabled: true 启用（默认关闭）"
    exit 0
}

# ── 加载合规配置（dot-source，得到 SOFA_AUDIT_ENABLED 等）──
$cfg = Join-Path $PSScriptRoot "lib\config.ps1"
if (Test-Path $cfg) { . $cfg }

# ── 参数校验 ──
if ([string]::IsNullOrEmpty($Operation)) {
    Write-Host "错误: -Operation 为必填参数。-Help 查看用法。"
    exit 1
}

# ── 审计开关：仅 SOFA_AUDIT_ENABLED=true 时写入，否则静默退出 ──
if ($env:SOFA_AUDIT_ENABLED -ne "true") { exit 0 }

# ── 采集上下文 ──
$utcTime   = (Get-Date).ToUniversalTime().ToString("HH:mm:ss")
$userName  = if ($env:USERNAME) { $env:USERNAME } else { "unknown" }
$hostName  = if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { "unknown" }
$localDate = Get-Date -Format "yyyy-MM-dd"
$localMonth = Get-Date -Format "yyyy-MM"

# ── 路径（honor SOFAGENT_DATA）──
$sofagentData = if (-not [string]::IsNullOrEmpty($env:SOFAGENT_DATA)) { $env:SOFAGENT_DATA } else { Join-Path (Get-Location).Path ".sofagent" }
$auditDir = Join-Path $sofagentData "task\audit\$localMonth"
$auditFile = Join-Path $auditDir "$localDate.md"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null

$utf8NoBom = New-Object System.Text.UTF8Encoding $false
if (-not (Test-Path $auditFile)) {
    $header = "# $localDate 审计记录`n`n| 时间 (UTC) | 操作 | 对象 | 结果 | 用户 | 主机 | 详情 |`n|------------|------|------|------|------|------|------|`n"
    [System.IO.File]::WriteAllText($auditFile, $header, $utf8NoBom)
}

# ── 转义 Markdown 表格中的 | ──
function Escape-Pipe($s) { if ($null -eq $s) { "" } else { $s -replace '\|', '\|' } }

# 先算默认值（PS 5.1 不允许 if 表达式直接作函数参数）
$targetVal = if ([string]::IsNullOrEmpty($Target)) { "-" } else { $Target }
$resultVal = if ([string]::IsNullOrEmpty($Result)) { "-" } else { $Result }
$opEsc     = Escape-Pipe $Operation
$targetEsc = Escape-Pipe $targetVal
$resultEsc = Escape-Pipe $resultVal

$row = "| $utcTime | $opEsc | $targetEsc | $resultEsc | $userName | $hostName | |`n"
[System.IO.File]::AppendAllText($auditFile, $row, $utf8NoBom)
