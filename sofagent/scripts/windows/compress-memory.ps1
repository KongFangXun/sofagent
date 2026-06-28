# ============================================================
# sofagent compress-memory.ps1 · think.md 压缩归档 (Windows PowerShell)
# ============================================================
# compress-memory.sh 的原生 Windows 移植。备份 think.md（保留最近 3 份）+
# 把 60 天前的反思条目归档到 think.archive.md。
#
# 用法：compress-memory.ps1 [-DryRun] [-Force]
# ============================================================

param(
    [switch]$DryRun,
    [switch]$Force,
    [switch]$Help,
    [switch]$Version
)

$ErrorActionPreference = "Stop"
$VERSION_STR = "0.95"
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}

function W-Info($m) { Write-Host "[compress] $m" -ForegroundColor Blue }
function W-Ok($m)   { Write-Host "[OK] $m" -ForegroundColor Green }
function W-Warn($m) { Write-Host "[!] $m" -ForegroundColor Yellow }

if ($Version) { Write-Host "sofagent-compress-memory v$VERSION_STR"; exit 0 }
if ($Help) {
    Write-Host "sofagent compress-memory v$VERSION_STR (PowerShell)"
    Write-Host "  合并压缩 think.md 反思区——备份(保留3份) + 60天前条目归档到 think.archive.md"
    Write-Host "  -DryRun 仅预览   -Force 跳过确认"
    exit 0
}

$cfg = Join-Path $PSScriptRoot "lib\config.ps1"
if (Test-Path $cfg) { . $cfg }

$sofagentData = if (-not [string]::IsNullOrEmpty($env:SOFAGENT_DATA)) { $env:SOFAGENT_DATA } else { Join-Path (Get-Location).Path ".sofagent" }
$thinkFile = Join-Path $sofagentData "think.md"
$archiveFile = Join-Path $sofagentData "think.archive.md"

if (-not (Test-Path $thinkFile)) { W-Info "think.md 不存在，无需压缩。"; exit 0 }

$size = (Get-Item $thinkFile).Length
$lineCount = (Get-Content $thinkFile -Encoding UTF8 -EA SilentlyContinue).Count
W-Info "think.md: $size bytes · $lineCount 行"

$sixtyAgo = (Get-Date).AddDays(-60).ToString("yyyy-MM-dd")
$lines = Get-Content $thinkFile -Encoding UTF8 -EA SilentlyContinue

if ($DryRun) {
    Write-Host ""; W-Info "=== 预览：条目统计 ==="
    $entryCount = ($lines | Where-Object { $_ -match '^## 20' }).Count
    Write-Host "  反思条目: $entryCount"
    Write-Host "  标签分布:"
    foreach ($tag in @("#超时", "#模型不匹配", "#拆太粗", "#数据不存在", "#权限", "#外部依赖")) {
        $c = ($lines | Select-String -SimpleMatch $tag).Count
        if ($c -gt 0) { Write-Host "    ${tag}: $c" }
    }
    $oldCount = ($lines | Where-Object { $_ -match '^## (20\d\d-\d\d-\d\d)' -and $matches[1] -lt $sixtyAgo }).Count
    Write-Host "  60 天前条目: $oldCount（将移至 think.archive.md）"
    Write-Host ""; W-Info "-DryRun 完成。加 -Force 执行压缩。"
    exit 0
}

if (-not $Force) {
    $c = Read-Host "  确认压缩 think.md？[y/N]"
    if ($c -notmatch '^[yY]') { Write-Host "  已取消。"; exit 0 }
}

$utf8NoBom = New-Object System.Text.UTF8Encoding $false

# ── 备份 ──
$backupDate = (Get-Date).ToString("yyyy-MM-dd")
$backupFile = Join-Path $sofagentData "think.$backupDate.bak"
Copy-Item $thinkFile $backupFile -Force
W-Ok "已备份: think.$backupDate.bak"

# ── 仅保留最近 3 份备份 ──
$baks = Get-ChildItem $sofagentData -Filter "think.*.bak" -EA SilentlyContinue | Sort-Object Name -Descending
if ($baks.Count -gt 3) {
    $baks | Select-Object -Skip 3 | ForEach-Object { Remove-Item $_.FullName -Force -EA SilentlyContinue; W-Info "已删除旧备份: $($_.Name)" }
    W-Ok "备份轮转完成（保留最近 3 份）"
}

# ── 60 天归档：按 ## 日期块拆分（活跃 ≤60d / 归档 >60d）──
$active = New-Object System.Collections.Generic.List[string]
$archiveAdd = New-Object System.Collections.Generic.List[string]
$curBlock = $null; $curDate = $null
function Flush-Block {
    if ($null -eq $script:curBlock) { return }
    if ($script:curDate -and $script:curDate -lt $sixtyAgo) { $script:archiveAdd.Add($script:curBlock) }
    else { $script:active.Add($script:curBlock) }  # 无日期的前导块也保留在活跃区（不丢 think.md 标题）
}
foreach ($line in $lines) {
    if ($line -match '^## (20\d\d-\d\d-\d\d)') {
        Flush-Block
        $script:curDate = $matches[1]
        $script:curBlock = $line
    } else {
        if ($null -eq $script:curBlock) { $script:curBlock = $line } else { $script:curBlock += "`n" + $line }
    }
}
Flush-Block

$oldMoved = ($archiveAdd | Where-Object { $_ -match '^## 20' }).Count
if ($active.Count -gt 0) {
    [System.IO.File]::WriteAllText($thinkFile, (($active -join "`n") + "`n"), $utf8NoBom)
    if ($oldMoved -gt 0) {
        $existing = if (Test-Path $archiveFile) { [System.IO.File]::ReadAllText($archiveFile) } else { "" }
        [System.IO.File]::WriteAllText($archiveFile, $existing + "`n" + ($archiveAdd -join "`n") + "`n", $utf8NoBom)
        W-Ok "已归档 $oldMoved 条 60 天前反思 → think.archive.md"
    }
}

W-Ok "压缩完成。"
W-Info "活跃反思区: $((Get-Content $thinkFile -Encoding UTF8 -EA SilentlyContinue).Count) 行"
if (Test-Path $archiveFile) { W-Info "归档区: $((Get-Content $archiveFile -Encoding UTF8 -EA SilentlyContinue).Count) 行" }
