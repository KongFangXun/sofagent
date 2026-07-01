# ============================================================
# sofagent cleanup.ps1 · 数据保留清理 (Windows PowerShell)
# ============================================================
# cleanup.sh 的原生 Windows 移植。按保留策略清理 .sofagent/task/logs/ 过期日志。
# 归档用原生 Compress-Archive（.zip，免 tar 依赖）；其余逻辑对齐 .sh。
# 通常由 task-record.ps1 概率触发（1/N），也可独立运行。
#
# 用法：cleanup.ps1 [-DryRun] [-Force] [-Purge] [-Before YYYY-MM-DD]
# ============================================================

param(
    [switch]$DryRun,
    [switch]$Force,
    [switch]$Purge,
    [string]$Before = "",
    [switch]$Help,
    [switch]$Version
)

$ErrorActionPreference = "Stop"
$VERSION_STR = "0.99.1"
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}
if ($Purge) { $Force = $true }

if ($Version) { Write-Host "sofagent-cleanup v$VERSION_STR"; exit 0 }
if ($Help) {
    Write-Host "sofagent cleanup v$VERSION_STR (PowerShell)"
    Write-Host "  按保留策略清理 .sofagent/task/logs/ 过期日志"
    Write-Host "  -DryRun 仅预览   -Force/-Purge 跳过确认   -Before YYYY-MM-DD 只清该日期前"
    Write-Host "  配置(fde.md): data_retention_days(默认90) / data_retention_max_entries(默认500)"
    exit 0
}
if (-not [string]::IsNullOrEmpty($Before) -and $Before -notmatch '^\d{4}-\d{2}-\d{2}$') {
    Write-Host "[cleanup] 错误：-Before 需要日期格式 YYYY-MM-DD（收到：$Before）"; exit 1
}

# 加载配置
$cfg = Join-Path $PSScriptRoot "lib\config.ps1"
if (Test-Path $cfg) { . $cfg }
$retentionDays = if ($env:SOFA_RETENTION_DAYS) { [int]$env:SOFA_RETENTION_DAYS } else { 90 }
$retentionMax  = if ($env:SOFA_RETENTION_MAX) { [int]$env:SOFA_RETENTION_MAX } else { 500 }

$sofagentData = if (-not [string]::IsNullOrEmpty($env:SOFAGENT_DATA)) { $env:SOFAGENT_DATA } else { Join-Path (Get-Location).Path ".sofagent" }
$logsDir = Join-Path $sofagentData "task\logs"
$archiveDir = Join-Path $logsDir "archive"

if (-not (Test-Path $logsDir)) { Write-Host "[cleanup] task/logs/ 目录不存在，无需清理。"; exit 0 }

# 非交互确认
if (-not $DryRun -and -not $Force) {
    Write-Host "[cleanup] 即将扫描 $logsDir 进行清理。"
    Write-Host "[cleanup] 保留策略: 保留 $retentionDays 天内日志，最多 $retentionMax 条记录。"
    if (-not [string]::IsNullOrEmpty($Before)) { Write-Host "[cleanup] [!] 仅清理 $Before 之前的日志" }
    $c = Read-Host "  确认执行？[y/N]"
    if ($c -notmatch '^[yY]') { Write-Host "  已取消。"; exit 0 }
}

$script:deletedFiles = 0
$script:deletedEntries = 0
$utf8NoBom = New-Object System.Text.UTF8Encoding $false

function Count-Entries($dir) {
    $n = 0
    Get-ChildItem $dir -Filter *.md -EA SilentlyContinue | ForEach-Object {
        $n += (Get-Content $_.FullName -Encoding UTF8 -EA SilentlyContinue | Where-Object { $_ -match '^## ' }).Count
    }
    return $n
}

# 归档（zip）后删除一个月份目录
function Archive-AndRemove($monthDir, $month) {
    $fileCount = (Get-ChildItem $monthDir -Filter *.md -EA SilentlyContinue | Measure-Object).Count
    $entryCount = Count-Entries $monthDir
    if ($DryRun) {
        Write-Host "  [dry-run] 将删除 $monthDir\ ($fileCount 个文件, $entryCount 条记录)"
        return
    }
    Write-Host "[cleanup] 归档并删除月份: $month ($fileCount 个文件, $entryCount 条记录)"
    New-Item -ItemType Directory -Force -Path $archiveDir | Out-Null
    $archiveFile = Join-Path $archiveDir "$month.zip"
    try {
        Compress-Archive -Path $monthDir -DestinationPath $archiveFile -Force -EA Stop
        if ((Test-Path $archiveFile) -and (Get-Item $archiveFile).Length -gt 0) {
            Write-Host "[cleanup]   归档成功: $archiveFile"
            Remove-Item $monthDir -Recurse -Force
            Write-Host "[cleanup]   已删除: $monthDir\"
            $script:deletedFiles += $fileCount
            $script:deletedEntries += $entryCount
        } else { Write-Host "[cleanup]   归档文件为空，跳过删除: $month" }
    } catch { Write-Host "[cleanup]   归档失败，保留源文件: $month" }
}

if ($DryRun) {
    Write-Host ""; Write-Host "[cleanup] === DRY RUN 预览 ==="
    Write-Host "[cleanup] 保留天数: $retentionDays"
    if (-not [string]::IsNullOrEmpty($Before)) { Write-Host "[cleanup] -Before 过滤: $Before" }
    Write-Host "[cleanup] 扫描目录: $logsDir"; Write-Host ""
}

# ── 1. 按天/按 -Before 清理 ──
$allMd = Get-ChildItem $logsDir -Recurse -Filter *.md -EA SilentlyContinue | Where-Object { $_.FullName -notlike "*\archive\*" }
if (-not [string]::IsNullOrEmpty($Before)) {
    $expired = $allMd | Where-Object { $_.BaseName -match '^\d{4}-\d{2}-\d{2}$' -and $_.BaseName -lt $Before }
} else {
    $cutoff = (Get-Date).AddDays(-$retentionDays)
    $expired = $allMd | Where-Object { $_.LastWriteTime -lt $cutoff }
}
$expiredMonths = $expired | ForEach-Object { $_.Directory.FullName } | Select-Object -Unique
if ($expiredMonths) {
    foreach ($md in $expiredMonths) { if (Test-Path $md) { Archive-AndRemove $md (Split-Path $md -Leaf) } }
} else {
    Write-Host "[cleanup] 没有超过 $retentionDays 天的过期文件"
}

# ── 2. 按条清理（总条目超上限 → 从最旧月删）──
$totalEntries = 0
Get-ChildItem $logsDir -Recurse -Filter *.md -EA SilentlyContinue | Where-Object { $_.FullName -notlike "*\archive\*" } | ForEach-Object {
    $totalEntries += (Get-Content $_.FullName -Encoding UTF8 -EA SilentlyContinue | Where-Object { $_ -match '^## ' }).Count
}
if ($totalEntries -gt $retentionMax) {
    $excess = $totalEntries - $retentionMax
    Write-Host ""
    Write-Host "[cleanup] 条目总数 $totalEntries 超过上限 $retentionMax，超出 $excess 条$(if(-not $DryRun){'，从最旧月开始清理...'})"
    $sortedMonths = Get-ChildItem $logsDir -Directory -EA SilentlyContinue | Where-Object { $_.Name -ne "archive" } | Sort-Object Name
    $toRemove = $excess
    foreach ($m in $sortedMonths) {
        if ($toRemove -le 0) { break }
        if (-not (Test-Path $m.FullName)) { continue }
        $ec = Count-Entries $m.FullName
        Archive-AndRemove $m.FullName $m.Name
        $toRemove -= $ec
    }
} elseif ($DryRun) {
    Write-Host ""; Write-Host "[cleanup] 条目总数 $totalEntries，未超过上限 $retentionMax"
}

# ── 3. 删空月份目录 ──
if (-not $DryRun) {
    Get-ChildItem $logsDir -Directory -EA SilentlyContinue | Where-Object { $_.Name -ne "archive" } | ForEach-Object {
        if ((Get-ChildItem $_.FullName -EA SilentlyContinue | Measure-Object).Count -eq 0) { Remove-Item $_.FullName -Force -EA SilentlyContinue }
    }
}

# ── 4. 摘要 ──
Write-Host ""
if ($DryRun) {
    Write-Host "[cleanup] === DRY RUN 完成 ==="
    Write-Host "[cleanup] 预览中未执行实际删除。添加 -Force 执行清理。"
    exit 0
}
Write-Host "[cleanup] === 清理完成 ==="
Write-Host "[cleanup] 删除文件数: $($script:deletedFiles)"
Write-Host "[cleanup] 删除条目数: $($script:deletedEntries)"
Write-Host ""

# ── 5. 审计 ──
$auditPs = Join-Path $PSScriptRoot "audit.ps1"
if ((Test-Path $auditPs) -and $script:deletedFiles -gt 0) {
    try { & $auditPs -Operation "cleanup" -Target "task/logs/" -Result "成功, 删除 $($script:deletedFiles) 个文件, $($script:deletedEntries) 条记录" 2>$null } catch {}
}
