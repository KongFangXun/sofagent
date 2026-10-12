# ============================================================
# sofagent task-record.ps1 · 任务记录脚本 (Windows PowerShell)
# ============================================================
# task-record.sh 的原生 Windows 移植版（PowerShell 5.1+）。
# 行为对齐 .sh：收集任务数据 -> 拼 Markdown -> 追加到 .sofagent/task/logs/YYYY-MM/YYYY-MM-DD.md
# 改进：用 PowerShell 原生 ConvertFrom-Json（免 jq）；honor SOFAGENT_DATA 环境变量。
#
# 用法：
#   task-record.ps1 -Task "重构数据库" -Result "成功" -Cost 0.15
#   task-record.ps1 -Budget -Task "X" -Steps 48 -Limit 80
#   task-record.ps1 -ClosureCheck -Task "X"
#   ... | task-record.ps1 -FromStdin
# ============================================================

param(
    [string]$Task = "",
    [string]$Result = "",
    [string]$Model = "",
    [string]$Tokens = "",
    [string]$Cost = "",
    [string]$Skills = "",
    [string]$Steps = "",
    [string]$Retries = "",
    [switch]$Checkpoint,
    [switch]$Budget,
    [switch]$ClosureCheck,
    [string]$Limit = "",
    [switch]$FromStdin,
    [switch]$Version,
    [switch]$Help
)

$ErrorActionPreference = "Stop"
$VERSION_STR = "1.5.8"

# 强制 UTF-8 控制台输出——PS 5.1 默认按 OEM/GBK 输出，被 UTF-8 消费方(Agent/Git Bash)读会乱码
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}

if ($Version) { Write-Host "sofagent-task-record v$VERSION_STR"; exit 0 }
if ($Help) {
    Write-Host "sofagent task-record v$VERSION_STR (PowerShell)"
    Write-Host "  记录 AI Agent 任务执行数据"
    Write-Host ""
    Write-Host "  常规: -Task NAME -Result R -Model M -Tokens N -Cost N -Skills LIST"
    Write-Host "  检查点: -Checkpoint -Steps N -Retries N"
    Write-Host "  预算: -Budget -Steps N -Limit N   返回 BUDGET_CHECK: 步数/上限=百分比"
    Write-Host "  闭环: -ClosureCheck               返回 CLOSURE_CHECK: 今日记录数"
    Write-Host "  管道: -FromStdin                  从管道读 JSON 数组"
    exit 0
}

# ── 加载合规配置（dot-source，对齐 task-record.sh 的 source config.sh）──
$cfg = Join-Path $PSScriptRoot "lib\config.ps1"
if (Test-Path $cfg) { . $cfg }

# ── 加载脱敏函数（单一真相源，verify.ps1 同源调用）──
# 保持 Test-Path 守卫（与 config.ps1 同款）：缺 lib 时 Invoke-Sanitize 未定义，
# 调用点抛「无法识别的命令」并在 $ErrorActionPreference="Stop" 下中止——fail-loud，
# 不会静默写出未脱敏日志。对齐 task-record.sh:37-42 的同款守卫与理由。
$sanitizeLib = Join-Path $PSScriptRoot "lib\sanitize.ps1"
if (Test-Path $sanitizeLib) { . $sanitizeLib }

# ── 默认值辅助（对齐 bash 的 ${VAR:-default}）──
function Def($v, $d) { if ([string]::IsNullOrEmpty($v)) { $d } else { $v } }

# ── 数据目录（honor SOFAGENT_DATA，缺省 PWD/.sofagent）──
function Get-SofagentData {
    if (-not [string]::IsNullOrEmpty($env:SOFAGENT_DATA)) { $env:SOFAGENT_DATA }
    else { Join-Path (Get-Location).Path ".sofagent" }
}

# ── 从 stdin 读取 JSON 数组 ──
if ($FromStdin) {
    # PS 5.1 [Console]::In 默认用系统 OEM 编码，改用 UTF-8
    try { [Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}
    $stdinData = [Console]::In.ReadToEnd()
    if (-not [string]::IsNullOrWhiteSpace($stdinData)) {
        $parsed = $null
        try { $parsed = $stdinData | ConvertFrom-Json } catch { $parsed = $null }
        if ($null -ne $parsed) {
            foreach ($e in @($parsed)) {
                & $PSCommandPath -Task (Def $e.task "") -Result (Def $e.result "未知") `
                    -Model (Def $e.model "未记录") -Tokens (Def $e.tokens "?") `
                    -Cost (Def $e.cost "?") -Skills (Def $e.skills "-")
            }
            exit 0
        }
    }
    Write-Host "警告: -FromStdin 需要管道输入且为合法 JSON"
    exit 0
}

# ── 必填检查 ──
if ([string]::IsNullOrEmpty($Task)) {
    Write-Host "错误: -Task 为必填参数。-Help 查看用法。"
    exit 1
}

# ── 预算检查（非写入，输出后退出）──
if ($Budget) {
    if ([string]::IsNullOrEmpty($Steps) -or [string]::IsNullOrEmpty($Limit)) {
        Write-Host "BUDGET_CHECK: 参数不完整（需 -Steps 和 -Limit）"
        exit 0
    }
    if ($Steps -notmatch '^[0-9]+$' -or $Limit -notmatch '^[1-9][0-9]*$') {
        Write-Host "BUDGET_CHECK: 参数无效（-Steps 需非负整数，-Limit 需正整数）"
        exit 0
    }
    $pct = [int][math]::Floor([double]$Steps * 100 / [double]$Limit)
    if ($pct -ge 60) {
        Write-Host "BUDGET_CHECK: $Steps/$Limit=$pct% -> [!] 已达预算 60%，建议调 Loop Agent (checkpoint)"
    } else {
        Write-Host "BUDGET_CHECK: $Steps/$Limit=$pct% -> [OK] 预算内，继续"
    }
    exit 0
}

# ── 闭环检查（非写入，输出后退出）──
if ($ClosureCheck) {
    $today = Get-Date -Format "yyyy-MM-dd"
    $month = Get-Date -Format "yyyy-MM"
    $logFile = Join-Path (Get-SofagentData) "task\logs\$month\$today.md"
    if (Test-Path $logFile) {
        $count = (Get-Content $logFile -Encoding UTF8 -ErrorAction SilentlyContinue | Where-Object { $_ -match '^## ' }).Count
        Write-Host "CLOSURE_CHECK: $logFile 存在 $count 条记录 -> [OK] 已闭合"
    } else {
        Write-Host "CLOSURE_CHECK: $logFile 不存在 -> [X] 今日无闭环记录，需警惕"
    }
    exit 0
}

# ── 路径 ──
$sofagentData = Get-SofagentData
$today = Get-Date -Format "yyyy-MM-dd"
$month = Get-Date -Format "yyyy-MM"
$logDir = Join-Path $sofagentData "task\logs\$month"
$logFile = Join-Path $logDir "$today.md"
$timestamp = Get-Date -Format "HH:mm:ss"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# ── 写入前脱敏 ──
# 用局部变量保存脱敏后值，不修改原始参数变量
# 🔴 开关读「规范名优先 + 旧名兜底」——对齐 task-record.sh:188-192 的同款读取面：
#    config.ps1 会把旧名从 fde.md 回填成 true，若只读旧名，用户设 SOFAGENT_SANITIZE=false
#    会被压过 ⇒ 关不掉（#28 死键的 Windows 侧镜像；旧实现 `if ($env:SOFA_SANITIZE -eq "true")`
#    连规范名都完全不看）。缺省值不在此处兜，由 config.ps1 逐条对齐 config.sh 给出。
if (-not [string]::IsNullOrEmpty($env:SOFAGENT_SANITIZE)) {
    $sanitizeOn = ($env:SOFAGENT_SANITIZE -eq "true")
} elseif (-not [string]::IsNullOrEmpty($env:SOFA_SANITIZE)) {
    $sanitizeOn = ($env:SOFA_SANITIZE -eq "true")
} else {
    $sanitizeOn = $false
}
if ($sanitizeOn) {
    $saneTask   = Invoke-Sanitize $Task
    $saneResult = Invoke-Sanitize $Result
    $saneModel  = Invoke-Sanitize $Model
    $saneSkills = Invoke-Sanitize $Skills
} else {
    $saneTask = $Task; $saneResult = $Result; $saneModel = $Model; $saneSkills = $Skills
}

# ── 写 UTF-8 无 BOM（对齐 .sh，且 Agent 读取友好）──
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
if (-not (Test-Path $logFile)) {
    [System.IO.File]::WriteAllText($logFile, "# $today 任务记录`n`n", $utf8NoBom)
}

if ($Checkpoint) {
    $entry = @"

## $timestamp — #checkpoint $saneTask

| 字段 | 值 |
|------|------|
| 检查点 | $(Def $saneResult '评估中') |
| 当前步数 | $(Def $Steps '-') |
| 重试次数 | $(Def $Retries '-') |
| 已用 Token | $(Def $Tokens '-') |
| 已用费用 | $(Def $Cost '-') |
| Skills | $(Def $saneSkills '-') |
"@
} else {
    $entry = @"

## $timestamp — $saneTask

| 字段 | 值 |
|------|------|
| 状态 | $(Def $saneResult '未记录') |
| 模型 | $(Def $saneModel '未记录') |
| Token | $(Def $Tokens '-') |
| 费用 | $(Def $Cost '-') |
| Skills | $(Def $saneSkills '-') |
"@
}
$entry = $entry -replace "`r`n", "`n"   # 归一 LF，与 .sh 输出一致
[System.IO.File]::AppendAllText($logFile, $entry, $utf8NoBom)

Write-Host "  已记录: $saneTask -> $logFile"

# （写后概率触发清理已随 v1.5.0 死配置清扫移除——手动清理走 cleanup.ps1）
