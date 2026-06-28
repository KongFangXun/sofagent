# ============================================================
# sofagent verify-evidence.ps1 · 最小可信验证器 (Windows PowerShell)
# ============================================================
# verify-evidence.sh 的原生 Windows 移植。扫描今日 task/logs 记录，
# 检查有无客观证据（测试 exit code / lint / build）；有→[已验证]，无→[未验证]。
#
# 用法：verify-evidence.ps1 [-Daemon]
#   -Daemon  静默模式，仅返回 exit code（0=已验证, 1=未验证/无日志）
# ============================================================

param([switch]$Daemon)

$ErrorActionPreference = "Continue"
$VERSION_STR = "0.96"
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}

$cfg = Join-Path $PSScriptRoot "lib\config.ps1"
if (Test-Path $cfg) { . $cfg }

$sofagentData = if (-not [string]::IsNullOrEmpty($env:SOFAGENT_DATA)) { $env:SOFAGENT_DATA } else { Join-Path (Get-Location).Path ".sofagent" }
$today = Get-Date -Format "yyyy-MM-dd"
$month = Get-Date -Format "yyyy-MM"
$logFile = Join-Path $sofagentData "task\logs\$month\$today.md"

if (-not $Daemon) {
    Write-Host "sofagent verify-evidence v$VERSION_STR"
    Write-Host "扫描目标: $logFile"
    Write-Host ""
}

if (-not (Test-Path $logFile)) {
    if (-not $Daemon) { Write-Host "[X] 今日无 task/logs 记录" }
    exit 1
}

$content = Get-Content $logFile -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
function Count-Matches($pattern) { ([regex]::Matches($content, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)).Count }

$hasTest  = Count-Matches "exit.code|测试.*(pass|fail|通过|失败)|test.*(pass|fail)|✅.*pass|❌.*fail"
$hasLint  = Count-Matches "lint|eslint|prettier|shellcheck"
$hasBuild = Count-Matches "build.*(success|fail)|编译.*(成功|失败)|npm run build|make"
$total = $hasTest + $hasLint + $hasBuild

if ($total -gt 0) {
    if (-not $Daemon) {
        Write-Host "[已验证] 检测到客观证据：测试 $hasTest 处 / lint $hasLint 处 / build $hasBuild 处"
        Write-Host "→ 本轮闭环评分有客观证据支撑"
    }
    exit 0
} else {
    if (-not $Daemon) {
        Write-Host "[未验证] 未检测到测试 / lint / build 等客观证据"
        Write-Host "→ 本轮闭环评分依赖 LLM 自评，可信度有限"
    }
    exit 1
}
