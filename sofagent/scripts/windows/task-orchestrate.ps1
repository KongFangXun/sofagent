# ============================================================
# sofagent task-orchestrate.ps1 · AO 编排包装 (Windows PowerShell)
# ============================================================
# task-orchestrate.sh 的原生 Windows 移植。包装 agency-orchestrator (ao)：
# 工作区隔离(git worktree) + 约束注入 + 编排预览 + 结果聚合 + 4 级深度。
# ao 是 Node 包，原生 Windows 可用：npm install -g agency-orchestrator
#
# 用法：
#   task-orchestrate.ps1 "重构用户模块"
#   task-orchestrate.ps1 "重构用户模块" -DryRun -Worktree -Level 2 -MaxRetries 5 -Model flash
# ============================================================

param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Rest
)

$ErrorActionPreference = "Stop"
$VERSION_STR = "0.94"
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}

# ── 颜色输出辅助 ──
function W-Info($m) { Write-Host "[orchestrate] $m" -ForegroundColor Blue }
function W-Ok($m)   { Write-Host "[OK] $m" -ForegroundColor Green }
function W-Warn($m) { Write-Host "[!] $m" -ForegroundColor Yellow }
function W-Err($m)  { Write-Host "[X] $m" -ForegroundColor Red }

$SCRIPT_DIR = $PSScriptRoot
$cfg = Join-Path $SCRIPT_DIR "lib\config.ps1"
if (Test-Path $cfg) { . $cfg }
$LEVEL_DESC = @("完整编排", "模板复用", "轻量调度", "自主执行")

# ── 解析参数（手工解析 $Rest：位置参数=任务描述，其余 -Flag）──
$TaskDesc = ""
$DryRun = $false; $UseWorktree = $false; $AutoLevel = $false
$Level = 1; $MaxRetries = 3; $AoModel = ""
$Help = $false; $ShowVersion = $false
for ($i = 0; $i -lt $Rest.Count; $i++) {
    $a = $Rest[$i]
    # 用 if/elseif 链——PS switch 无 break 会执行所有匹配 case（兜底 ^- 会误伤每个 flag）
    if     ($a -eq '-DryRun'   -or $a -eq '--dry-run')   { $DryRun = $true }
    elseif ($a -eq '-Worktree' -or $a -eq '--worktree')  { $UseWorktree = $true }
    elseif ($a -eq '-Auto'     -or $a -eq '--auto')      { $AutoLevel = $true }
    elseif ($a -eq '-Level'    -or $a -eq '--level')     { $Level = [int]$Rest[++$i] }
    elseif ($a -eq '-MaxRetries' -or $a -eq '--max-retries') { $MaxRetries = [int]$Rest[++$i] }
    elseif ($a -eq '-Model'    -or $a -eq '--model')     { $AoModel = $Rest[++$i] }
    elseif ($a -eq '-Help'     -or $a -eq '--help' -or $a -eq '-h') { $Help = $true }
    elseif ($a -eq '-Version'  -or $a -eq '--version')   { $ShowVersion = $true }
    elseif ($a -like '-*')     { W-Err "未知参数: $a（-Help 查看用法）"; exit 1 }
    else                       { $TaskDesc = $a }
}

if ($ShowVersion) { Write-Host "sofagent-task-orchestrate v$VERSION_STR"; exit 0 }
if ($Help) {
    Write-Host "sofagent task-orchestrate v$VERSION_STR (PowerShell)"
    Write-Host "  包装 ao compose，加 worktree 隔离 + 约束注入 + 编排深度控制"
    Write-Host ""
    Write-Host "  用法: task-orchestrate.ps1 ""任务描述"" [-DryRun] [-Worktree] [-Level N] [-Auto] [-MaxRetries N] [-Model flash|pro]"
    Write-Host ""
    Write-Host "  编排深度: 1=完整编排 2=模板复用 3=轻量调度 4=自主执行"
    Write-Host "  依赖: agency-orchestrator (ao, npm 包), git (worktree 模式)"
    exit 0
}

# ── ao 可用性检查（不可用→降级默认编排）──
$aoAvailable = [bool](Get-Command ao -ErrorAction SilentlyContinue)
if (-not $aoAvailable) {
    Write-Host "[sofagent] [!] agency-orchestrator (ao) 未安装——编排引擎不可用"
    Write-Host "[sofagent] 降级方案：手动拆任务 -> 用 task-record.ps1 逐条记录 -> 手动闭环"
    Write-Host "[sofagent] 安装 ao: npm install -g agency-orchestrator@0.7.5"
    if (-not [string]::IsNullOrEmpty($TaskDesc)) {
        Write-Host ""
        Write-Host "  ╔═══════════════════════════════════╗"
        Write-Host "  ║   sofagent · 默认编排（无 ao）    ║"
        Write-Host "  ╚═══════════════════════════════════╝"
        Write-Host ""
        Write-Host "  任务: $TaskDesc"
        Write-Host ""
        Write-Host "  建议手动拆为 3-5 个子任务："
        Write-Host "    1. 分析/准备 -> developer"
        Write-Host "    2. 核心实现 -> developer"
        Write-Host "    3. 验证/测试 -> qa-engineer"
        Write-Host "    4. 文档/收尾 -> technical-writer"
        Write-Host ""
        Write-Host "  每完成一个子任务，记录到 task/logs："
        Write-Host "    task-record.ps1 -Task ""子任务"" -Result ""成功|失败"""
        Write-Host ""
        Write-Host "  全部完成后，手动触发闭环反思（loop-check closure 模式）。"
        Write-Host ""
    }
    exit 0
}

if ([string]::IsNullOrEmpty($TaskDesc)) {
    W-Err "缺少任务描述。用法: task-orchestrate.ps1 ""你的任务"""
    exit 1
}

Write-Host ""
Write-Host "  ╔═══════════════════════════════════╗"
Write-Host "  ║   sofagent · task orchestrate    ║"
Write-Host "  ╚═══════════════════════════════════╝"
Write-Host ""
$LevelLabel = if ($Level -ge 1 -and $Level -le 4) { $LEVEL_DESC[$Level - 1] } else { "完整编排" }
W-Info "任务: $TaskDesc"
W-Info "编排深度: L$Level — $LevelLabel"
Write-Host ""

# ── 数据目录 + audit ──
$sofagentData = if (-not [string]::IsNullOrEmpty($env:SOFAGENT_DATA)) { $env:SOFAGENT_DATA } else { Join-Path (Get-Location).Path ".sofagent" }
$auditPs = Join-Path $SCRIPT_DIR "audit.ps1"
function Invoke-Audit($op, $target, $result) {
    if (Test-Path $auditPs) { try { & $auditPs -Operation $op -Target $target -Result $result 2>$null } catch {} }
}
Invoke-Audit "orchestrate" $TaskDesc "开始, L$Level"

# ── 任务唯一标识（SHA-256 前 8 位，对齐 echo|shasum）──
function Get-TaskSlug($desc) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes("$desc`n"))
    return ([System.BitConverter]::ToString($bytes) -replace '-', '').ToLower().Substring(0, 8)
}
$TaskSlug = Get-TaskSlug $TaskDesc

$orchestratorDir = Join-Path $sofagentData "orchestrator"
$workflowsDir = Join-Path $orchestratorDir "workflows"
New-Item -ItemType Directory -Force -Path $workflowsDir -ErrorAction SilentlyContinue | Out-Null

# ── 读取 orchestrator/ 配置 ──
$configThreshold = 80
if (Test-Path $orchestratorDir) {
    $orchConfig = Join-Path $orchestratorDir "$TaskSlug.json"
    if (-not (Test-Path $orchConfig)) { $orchConfig = Join-Path $orchestratorDir "_index.md" }
    if (Test-Path $orchConfig) {
        W-Info "读取编排配置: $orchConfig"
        if ($orchConfig -like "*.json") {
            try {
                $cfg = Get-Content $orchConfig -Raw -Encoding UTF8 | ConvertFrom-Json
                $cl = if ($cfg.level) { $cfg.level } elseif ($cfg.suggested_level) { $cfg.suggested_level } else { $null }
                if ($cfg.checkpoint) { $configThreshold = $cfg.checkpoint }
                if ($null -ne $cl) { $Level = [int]$cl }
            } catch {}
        }
    }
}

$cachedYaml = Join-Path $workflowsDir "$TaskSlug.yaml"

# ── 历史成功率分析（grep task desc，统计 状态|成功/失败）──
function Get-TrackRecord($matchText) {
    $total = 0; $success = 0
    $logRoot = Join-Path $sofagentData "task\logs"
    if (Test-Path $logRoot) {
        foreach ($lf in Get-ChildItem $logRoot -Recurse -Filter *.md -ErrorAction SilentlyContinue) {
            $content = Get-Content $lf.FullName -Encoding UTF8 -ErrorAction SilentlyContinue
            if (-not ($content | Select-String -SimpleMatch $matchText -Quiet)) { continue }
            foreach ($line in $content) {
                if ($line -match '状态 \| 成功') { $success++; $total++ }
                elseif ($line -match '状态 \| 失败') { $total++ }
            }
        }
    }
    return , @($total, $success)
}

# ── 滑窗回滚（近 5 次该任务状态行，失败 ≥2 且 level>1 → 写降级建议）──
function Invoke-SlidingWindowRollback($slug, $currentLevel) {
    $statusLines = @()
    $logRoot = Join-Path $sofagentData "task\logs"
    if (Test-Path $logRoot) {
        foreach ($lf in Get-ChildItem $logRoot -Recurse -Filter *.md -ErrorAction SilentlyContinue) {
            $inBlock = $false
            foreach ($line in (Get-Content $lf.FullName -Encoding UTF8 -ErrorAction SilentlyContinue)) {
                if ($line -match '^## ') { $inBlock = $line.Contains($TaskDesc) }
                elseif ($inBlock -and $line -match '\| 状态') { $statusLines += $line }
            }
        }
    }
    $statusLines = $statusLines | Select-Object -Last 5
    $total = $statusLines.Count
    $successCount = ($statusLines | Where-Object { $_ -match '成功' }).Count
    if ($total -ge 3 -and ($total - $successCount) -ge 2 -and $currentLevel -gt 1) {
        $newLevel = $currentLevel - 1
        W-Info "滑窗回滚: 近 $total 次中 $($total - $successCount) 次失败，建议 L$newLevel"
        New-Item -ItemType Directory -Force -Path $orchestratorDir -ErrorAction SilentlyContinue | Out-Null
        $ts = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        $json = "{""level"": $newLevel, ""reason"": ""近${total}次运行中$($total-$successCount)次失败"", ""last_update"": ""$ts"", ""rolling_window_total"": $total, ""rolling_window_failures"": $($total-$successCount)}"
        [System.IO.File]::WriteAllText((Join-Path $orchestratorDir "$slug.json"), $json, (New-Object System.Text.UTF8Encoding $false))
        W-Ok "回滚建议已写入: $slug.json"
    }
}

$tr = Get-TrackRecord $TaskDesc
$totalRuns = [int]$tr[0]; $successRuns = [int]$tr[1]
$failRuns = $totalRuns - $successRuns

# ── 自动级别建议 ──
$suggestedLevel = $Level
if ($totalRuns -ge 5 -and $successRuns -ge $totalRuns) { $suggestedLevel = 4 }
elseif ($totalRuns -ge 3 -and $successRuns -ge ($totalRuns - 1)) { $suggestedLevel = 3 }
elseif ($totalRuns -ge 1 -and $successRuns -ge 1 -and (Test-Path $cachedYaml)) { $suggestedLevel = 2 }

if ($totalRuns -gt 0) {
    $successPct = [int][math]::Floor($successRuns * 100 / $totalRuns)
    W-Info "历史记录: $totalRuns 次运行 · 成功率 $successPct%"
    if ($suggestedLevel -gt $Level) {
        W-Info "[建议] 升级到 L$suggestedLevel（$($LEVEL_DESC[$suggestedLevel-1])），添加 -Level $suggestedLevel"
    }
}

if ($AutoLevel) {
    $Level = $suggestedLevel
    $LevelLabel = $LEVEL_DESC[$Level - 1]
    W-Info "[自动] 采用 L$Level ($LevelLabel)"
}

$script:Elapsed = "?"
function Exit-Orchestrate($code) {
    try { Invoke-SlidingWindowRollback $TaskSlug $Level } catch {}
    $resultStr = if ($code -eq 0) { "成功" } else { "失败" }
    Invoke-Audit "orchestrate" $TaskDesc "$resultStr, L$Level, $($script:Elapsed)s"
    exit $code
}

# ── task-record 集成（调 .ps1）──
$taskRecordPs = Join-Path $SCRIPT_DIR "task-record.ps1"
function Invoke-TaskRecord($task, $result, $skills, $model) {
    if (Test-Path $taskRecordPs) {
        try { & $taskRecordPs -Task $task -Result $result -Skills $skills -Model $model 2>$null } catch {}
    }
}

# ── 按编排深度选执行路径 ──
$skipAoCompose = $false
$skipOrchestrate = $false

if ($Level -eq 4) {
    W-Info "L4 自主执行模式 — 跳过编排，直接交付 Agent"
    $skipOrchestrate = $true
}
elseif ($Level -eq 3) {
    $l3json = Join-Path $orchestratorDir "$TaskSlug.json"
    $aoTemplate = ""
    if (Test-Path $l3json) {
        try { $aoTemplate = (Get-Content $l3json -Raw -Encoding UTF8 | ConvertFrom-Json).ao_template } catch {}
    }
    if (-not [string]::IsNullOrEmpty($aoTemplate)) {
        W-Info "L3 模板调度 — ao run $aoTemplate"
        $aoInputs = @()
        try {
            $inputs = (Get-Content $l3json -Raw -Encoding UTF8 | ConvertFrom-Json).inputs
            if ($inputs) { foreach ($p in $inputs.PSObject.Properties) { $aoInputs += "--input"; $aoInputs += "$($p.Name)=$($p.Value)" } }
        } catch {}
        $start = Get-Date
        $exitCode = 0
        try { & ao run $aoTemplate @aoInputs 2>&1; $exitCode = $LASTEXITCODE } catch { $exitCode = 1 }
        $script:Elapsed = [int]((Get-Date) - $start).TotalSeconds
        Write-Host ""
        if ($exitCode -eq 0) { W-Ok "任务完成（耗时 $($script:Elapsed)s）" } else { W-Warn "任务结束（exit $exitCode）" }
        Invoke-TaskRecord "$TaskDesc (L3/$aoTemplate)" $(if ($exitCode -eq 0) { "成功" } else { "失败" }) "orchestrate-L3,$aoTemplate" ""
        Write-Host ""
        Write-Host "  编排结束。exit code: $exitCode · 深度: L3 (模板: $aoTemplate)"
        Exit-Orchestrate $exitCode
    }
    W-Warn "L3 模板缺失或 ao_template 字段为空，降级到 L2 缓存复用"
    $Level = 2
    if (Test-Path $cachedYaml) { $workflowFile = $cachedYaml; W-Ok "L2 模板复用 — 复用历史: $TaskSlug.yaml"; $skipAoCompose = $true }
    else { W-Warn "L2 缓存缺失，降级到 L1 完整编排"; $Level = 1 }
}
elseif ($Level -eq 2) {
    if (Test-Path $cachedYaml) { $workflowFile = $cachedYaml; W-Ok "L2 模板复用 — 复用历史: $TaskSlug.yaml"; $skipAoCompose = $true }
    else { W-Warn "L2 缓存缺失，降级到 L1 完整编排"; $Level = 1 }
}

Write-Host ""

# ── L4: 跳过所有编排，直接 ao run ──
if ($skipOrchestrate) {
    W-Info "Step 1-3/4 · L4 — 跳过编排/Harness/worktree"
    W-Info "Step 4/4 · 直接执行任务..."
    $start = Get-Date
    $exitCode = 0
    try { & ao run $TaskDesc 2>&1; $exitCode = $LASTEXITCODE } catch { $exitCode = 1 }
    $script:Elapsed = [int]((Get-Date) - $start).TotalSeconds
    Write-Host ""
    if ($exitCode -eq 0) { W-Ok "任务完成（耗时 $($script:Elapsed)s）" } else { W-Warn "任务结束（exit $exitCode，耗时 $($script:Elapsed)s）" }
    Invoke-TaskRecord "$TaskDesc (L4)" $(if ($exitCode -eq 0) { "成功" } else { "失败" }) "orchestrate-L4" ""
    Write-Host ""
    Write-Host "  编排结束。exit code: $exitCode · 深度: L4 (自主执行)"
    Exit-Orchestrate $exitCode
}

# ── Step 1: AO 编排预览 ──
if ($skipAoCompose) {
    W-Info "Step 1/4 · L$Level — 跳过 ao compose，使用缓存模板"
    if ($DryRun) {
        try { & ao explain $workflowFile 2>$null } catch { Get-Content $workflowFile -Encoding UTF8 -TotalCount 10 }
        Exit-Orchestrate 0
    }
} else {
    W-Info "Step 1/4 · AO 编排分析..."
    if (-not [string]::IsNullOrEmpty($AoModel)) { W-Info "  模型: $AoModel" }
    $workflowFile = Join-Path ([System.IO.Path]::GetTempPath()) "sofagent-workflow-$PID.yaml"
    $composeArgs = @(); if (-not [string]::IsNullOrEmpty($AoModel)) { $composeArgs += "--model"; $composeArgs += $AoModel }
    # PS 5.1 `>` redirect 写 UTF-16LE，改用 .NET API 写 UTF-8 无 BOM
    $composeOut = ""
    try { $composeOut = & ao compose @composeArgs $TaskDesc 2>$null | Out-String } catch {}
    if ($composeOut) { [System.IO.File]::WriteAllText($workflowFile, $composeOut, (New-Object System.Text.UTF8Encoding $false)) }
    if (-not (Test-Path $workflowFile) -or (Get-Item $workflowFile).Length -eq 0) {
        [System.IO.File]::WriteAllText($workflowFile, "# ao compose failed`n", (New-Object System.Text.UTF8Encoding $false))
    }
    if ((Get-Item $workflowFile).Length -gt 0) {
        W-Ok "编排计划已生成"
        W-Info "编排预览:"
        try { & ao explain $workflowFile 2>$null } catch { Get-Content $workflowFile -Encoding UTF8 -TotalCount 20 }
    } else {
        W-Warn "编排计划为空，直接执行"
        if (-not $DryRun) { & ao compose $TaskDesc --run }
        Remove-Item $workflowFile -Force -ErrorAction SilentlyContinue
        Exit-Orchestrate 0
    }
}

Write-Host ""
if ($DryRun) {
    W-Info "dry-run 模式，编排计划已生成: $workflowFile"
    Exit-Orchestrate 0
}

# ── Step 2: Worktree 隔离 ──
$worktrees = @()
$inGitRepo = $false
try { git rev-parse --git-dir 2>$null | Out-Null; $inGitRepo = ($LASTEXITCODE -eq 0) } catch {}
if ($UseWorktree -and $inGitRepo) {
    W-Info "Step 2/4 · 创建 worktree 隔离..."
    # PS 5.1 Select-String -Path 用系统编码读文件，改用 Get-Content -Encoding UTF8
    $wfContent = Get-Content $workflowFile -Encoding UTF8 -ErrorAction SilentlyContinue
    $subCount = if ($wfContent) { ($wfContent | Select-String -Pattern 'subtask|agent|workflow' | Measure-Object).Count } else { 0 }
    if ($subCount -le 0) { $subCount = 1 }
    if ($subCount -gt 5) { $subCount = 5 }
    $baseBranch = (git branch --show-current 2>$null); if ([string]::IsNullOrEmpty($baseBranch)) { $baseBranch = "main" }
    for ($i = 1; $i -le $subCount; $i++) {
        $wtPath = Join-Path ([System.IO.Path]::GetTempPath()) "sofagent-task-$i-$PID"
        W-Info "  创建 worktree $i/${subCount}: $wtPath"
        git worktree add $wtPath $baseBranch 2>$null
        if ($LASTEXITCODE -eq 0) { $worktrees += $wtPath } else { W-Warn "  worktree 创建失败，跳过隔离" }
    }
    if ($worktrees.Count -gt 0) { W-Ok "$($worktrees.Count) 个 worktree 就绪" }
}

Write-Host ""

# ── Step 3: Harness 约束注入（检查 hook 部署）──
W-Info "Step 3/4 · Harness 约束（2026.6.x 自动注入）..."
$openclawDir = if ($env:OPENCLAW_STATE_DIR) { $env:OPENCLAW_STATE_DIR } else { Join-Path $env:USERPROFILE ".openclaw" }
$hookDir = Join-Path $openclawDir "hooks\sofagent-load-chain"
if ((Test-Path (Join-Path $hookDir "handler.ts")) -and (Test-Path (Join-Path $hookDir "HOOK.md"))) {
    W-Ok "加载链 hook 就绪（子 Agent bootstrap 时自动注入第 2、3 层）"
} else {
    W-Warn "加载链 hook 未部署: $hookDir"
}

Write-Host ""

# ── Step 4: 执行编排（重试循环）──
W-Info "Step 4/4 · 执行任务编排..."
if (-not [string]::IsNullOrEmpty($AoModel)) { W-Info "  模型: $AoModel" }
$start = Get-Date
$runArgs = @(); if (-not [string]::IsNullOrEmpty($AoModel)) { $runArgs += "--model"; $runArgs += $AoModel }
$retryCount = 0
$exitCode = 1
while ($retryCount -lt $MaxRetries) {
    if ($retryCount -gt 0) { W-Warn "重试 $retryCount/$MaxRetries..." }
    $exitCode = 0
    try { & ao run @runArgs $workflowFile 2>&1; $exitCode = $LASTEXITCODE } catch { $exitCode = 1 }
    if ($exitCode -eq 0) { break }
    $retryCount++
}
$script:Elapsed = [int]((Get-Date) - $start).TotalSeconds
Write-Host ""

# ── 结果汇总 ──
if ($exitCode -eq 0) {
    if ($retryCount -gt 0) { W-Ok "任务完成（耗时 $($script:Elapsed)s，重试 $retryCount 次后成功）" }
    else { W-Ok "任务完成（耗时 $($script:Elapsed)s）" }
    if (-not $skipAoCompose -and (Test-Path $workflowFile)) {
        New-Item -ItemType Directory -Force -Path $orchestratorDir -ErrorAction SilentlyContinue | Out-Null
        Copy-Item $workflowFile $cachedYaml -Force -ErrorAction SilentlyContinue
        W-Info "工作流已缓存: $TaskSlug.yaml (下次可用 L2 复用)"
    }
} else {
    W-Warn "任务结束（exit $exitCode，耗时 $($script:Elapsed)s，重试 $retryCount/$MaxRetries 次）"
}

$resultVal = if ($exitCode -eq 0) { "成功" } else { "失败" }
$modelVal = if ([string]::IsNullOrEmpty($AoModel)) { "未记录" } else { $AoModel }
Invoke-TaskRecord "$TaskDesc (L$Level)" $resultVal "orchestrate-L$Level" $modelVal

# ── 清理 worktree + 临时文件 ──
foreach ($wt in $worktrees) {
    if (Test-Path $wt) {
        W-Info "清理 worktree: $wt"
        git worktree remove $wt --force 2>$null
        if (Test-Path $wt) { Remove-Item $wt -Recurse -Force -ErrorAction SilentlyContinue }
    }
}
Remove-Item $workflowFile -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "  ════════════════════════════════════"
Write-Host "  编排结束。exit code: $exitCode · 深度: L$Level ($LevelLabel)"
Write-Host ""
Exit-Orchestrate $exitCode
