# ============================================================
# sofagent install.ps1 · Windows PowerShell 安装脚本
# ============================================================
# WorkBuddy (Windows 11) 原生安装脚本
# 与 install.sh (WSL/Linux/macOS) 功能对齐
#
# 用法：
#   .\install.ps1 -Platform workbuddy -ProjectDir "D:\my-project"
#   .\install.ps1 -Platform workbuddy
#   .\install.ps1 -Help
#
# 环境说明：
#   - Windows 11 + WorkBuddy → 使用本脚本 (PowerShell)
#   - WSL / Linux / macOS    → 使用 install.sh (bash)
#   - Git Bash (Windows)     → 可用 install.sh，但建议用本脚本
# ============================================================

param(
    [string]$Platform = "",
    [string]$ProjectDir = "",
    [switch]$NoAO,
    [switch]$NoConfigInject,
    [switch]$NoDaemon,
    [switch]$WithDaemon,
    [switch]$Quick,
    [switch]$Ci,
    [switch]$Lite,
    [switch]$Help
)

$ErrorActionPreference = "Stop"
$VERSION = "1.3.1"

# v0.85: Lite = Quick + NoAO + NoDaemon + NoConfigInject
if ($Lite) { $Quick = $true; $NoAO = $true; $NoDaemon = $true; $NoConfigInject = $true }
# --ci = --quick（CI 非交互安装，对齐 install.sh）
if ($Ci) { $Quick = $true }

# ── 颜色输出 ──
function Write-Info  { param($msg) Write-Host "[sofagent] $msg" -ForegroundColor Cyan }
function Write-Ok    { param($msg) Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Warn  { param($msg) Write-Host "[!] $msg" -ForegroundColor Yellow }
function Write-Err   { param($msg) Write-Host "[X] $msg" -ForegroundColor Red }

# ── 帮助 ──
if ($Help) {
    Write-Host "sofagent install.ps1 v$VERSION"
    Write-Host ""
    Write-Host "Windows PowerShell 原生安装脚本（WorkBuddy on Windows 11）"
    Write-Host ""
    Write-Host "用法:"
    Write-Host "  .\install.ps1 -Platform workbuddy -ProjectDir 'D:\my-project'"
    Write-Host "  .\install.ps1 -Platform workbuddy"
    Write-Host ""
    Write-Host "参数:"
    Write-Host "  -Platform        目标平台 (workbuddy|openclaw|claude|codex|hermes)"
    Write-Host "  -ProjectDir      项目工作目录（.sofagent/ 数据目录位置）"
    Write-Host "  -NoAO            预留兼容参数（agency-orchestrator 已退役，P1-32 移除安装）"
    Write-Host "  -NoConfigInject  跳过 OpenClaw 断路器 loopDetection 注入"
    Write-Host "  -NoDaemon        跳过 daemon 安装（默认行为；需 daemon 时用 -WithDaemon）"
    Write-Host "  -WithDaemon      安装后台 daemon（Windows 计划任务，监控 think.md/fde.md）"
    Write-Host "  -Quick           快速模式——跳过欢迎横幅与冗长收尾提示"
    Write-Host "  -Ci              CI 模式（= -Quick，非交互安装）"
    Write-Host "  -Lite            精简模式——仅部署核心约束文件，跳过脚本/Hook/daemon（= -Quick -NoAO -NoDaemon -NoConfigInject）"
    Write-Host "  -Help            显示此帮助"
    Write-Host ""
    Write-Host "平台说明:"
    Write-Host "  workbuddy  部署 Skill + 数据目录（宪法内联在 SKILL.md）"
    Write-Host "  openclaw   完整部署（Skill + Hook + 断路器 + ao 编排引擎）"
    Write-Host "  claude/codex/hermes  部署宪法 + 写入种子指令（CLAUDE.md/AGENTS.md/SOUL.md）"
    Write-Host ""
    Write-Host "环境区分:"
    Write-Host "  Windows 原生 (PowerShell)  → install.ps1（本脚本）"
    Write-Host "  WSL / Linux / macOS        → install.sh"
    exit 0
}

# ── 环境检测 ──
if (-not $Quick) {
    Write-Host ""
    Write-Host "  +===================================+"
    Write-Host "  |   sofagent Harness · installer    |"
    Write-Host "  |   (Windows PowerShell)            |"
    Write-Host "  +===================================+"
    Write-Host ""
}

# 检测是否在 WSL 中运行（仅认 WSL_DISTRO_NAME——WSLENV 在装了 WSL 的 Windows 主机上也会被设，不能作判据）
if ($env:WSL_DISTRO_NAME) {
    Write-Err "检测到 WSL 环境，请使用 install.sh (bash) 而非本脚本"
    Write-Warn "  bash engine/scripts/install.sh --platform workbuddy"
    exit 1
}

# 检测操作系统（PS 5.1 无 $IsWindows，用 $env:OS 判断）
if ($env:OS -ne "Windows_NT") {
    Write-Err "本脚本仅支持 Windows，非 Windows 环境请使用 install.sh"
    exit 1
}

Write-Ok "运行环境: Windows PowerShell"

# ── 确定脚本所在目录 ──
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
# scripts/windows/ → scripts/ → engine/ → 项目根目录 → SKILL/harness/ (约束底座源码目录)
$SKILL_SRC_DIR = Join-Path (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $SCRIPT_DIR))) "SKILL\harness"
$SOFAGENT_DIR = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $SCRIPT_DIR))  # engine/ (hooks/audit/scripts 所在目录)
# engine/ → 项目根目录
$PROJECT_ROOT = Split-Path -Parent $SOFAGENT_DIR

# ── 平台探测 ──
Write-Info "Step 1/4 · 确定安装平台..."

if ([string]::IsNullOrEmpty($Platform)) {
    if     (Test-Path "$env:USERPROFILE\.workbuddy") { $Platform = "workbuddy" }
    elseif (Test-Path "$env:USERPROFILE\.openclaw")  { $Platform = "openclaw" }
    elseif (Test-Path "$env:USERPROFILE\.claude")    { $Platform = "claude" }
    elseif (Test-Path "$env:USERPROFILE\.codex")     { $Platform = "codex" }
    elseif (Test-Path "$env:USERPROFILE\.hermes")    { $Platform = "hermes" }
    else { $Platform = "workbuddy" }
}

$Platform = $Platform.ToLower()

# ── 确定数据目录 ──
if ([string]::IsNullOrEmpty($ProjectDir)) {
    $ProjectDir = Get-Location
    Write-Warn "未指定 -ProjectDir，.sofagent/ 数据目录将创建在当前目录: $ProjectDir"
    Write-Warn "  建议: .\install.ps1 -ProjectDir 'D:\my-project'"
} else {
    if (-not (Test-Path $ProjectDir)) {
        Write-Err "-ProjectDir 目录不存在: $ProjectDir"
        exit 1
    }
    $ProjectDir = (Resolve-Path $ProjectDir).Path
}

$SOFAGENT_DATA = if (-not [string]::IsNullOrEmpty($env:SOFAGENT_DATA)) { $env:SOFAGENT_DATA } else { Join-Path $ProjectDir ".sofagent" }
$env:SOFAGENT_DATA = $SOFAGENT_DATA
Write-Ok "数据目录: $SOFAGENT_DATA"

# ── 确定目标路径 ──
switch ($Platform) {
    "workbuddy" { $TARGET = "$env:USERPROFILE\.workbuddy" }
    "openclaw"  { $TARGET = "$env:USERPROFILE\.openclaw" }
    "claude"    { $TARGET = "$env:USERPROFILE\.claude" }
    "codex"     { $TARGET = "$env:USERPROFILE\.codex" }
    "hermes"    { $TARGET = "$env:USERPROFILE\.hermes" }
    default     { Write-Warn "未知平台 '$Platform'，回退 workbuddy"; $Platform = "workbuddy"; $TARGET = "$env:USERPROFILE\.workbuddy" }
}

Write-Ok "平台: $Platform → 目标: $TARGET"

# v0.90 P0-3：写入数据目录标记，供 config.ps1 还原 -ProjectDir 路径
if ($Platform -in @("openclaw", "workbuddy")) {
    $skillMarkerDir = Join-Path $TARGET "skills\sofagent"
    New-Item -ItemType Directory -Force -Path $skillMarkerDir | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $skillMarkerDir ".sofagent-data-path"), ($SOFAGENT_DATA + "`n"), (New-Object System.Text.UTF8Encoding $false))
}

# ── 检查源文件 ──
if (-not (Test-Path $SKILL_SRC_DIR)) {
    Write-Err "找不到 engine/ 目录。请在 sofagent 项目根目录下运行此脚本。"
    Write-Err "  当前脚本位置: $SCRIPT_DIR"
    Write-Err "  期望目录: $SKILL_SRC_DIR"
    exit 1
}

# ════════════════════════════════════════
# Step 2: 部署 Skill 文件
# ════════════════════════════════════════
Write-Info "Step 2/4 · 部署 Skill 文件 → $TARGET\skills\sofagent"

$SKILL_DST = Join-Path $TARGET "skills\sofagent"
if (-not (Test-Path $SKILL_DST)) {
    New-Item -ItemType Directory -Path $SKILL_DST -Force | Out-Null
}

# 核心 Skill 文件
$skillFiles = @("SKILL.md", "entry-gate.md", "task-aware.md", "task-closure.md", "loop-check.md", "engage.md", "engage-fde.md", "loop-evaluate.md", "loop-exit.md")
$copied = 0

foreach ($f in $skillFiles) {
    $src = Join-Path $SKILL_SRC_DIR $f
    $dst = Join-Path $SKILL_DST $f
    if (Test-Path $src) {
        $needCopy = $true
        if (Test-Path $dst) {
            $srcHash = (Get-FileHash $src -Algorithm SHA256).Hash
            $dstHash = (Get-FileHash $dst -Algorithm SHA256).Hash
            if ($srcHash -eq $dstHash) { $needCopy = $false }
        }
        if ($needCopy) {
            Copy-Item $src $dst -Force
            $copied++
        }
    } else {
        Write-Warn "找不到 $f，跳过"
    }
}

# 数据模板
$DATA_SRC = Join-Path $SKILL_SRC_DIR "data"
$DATA_DST = Join-Path $SKILL_DST "data"
if (-not (Test-Path $DATA_DST)) {
    New-Item -ItemType Directory -Path $DATA_DST -Force | Out-Null
}

if (Test-Path $DATA_SRC) {
    Get-ChildItem $DATA_SRC -Filter "*.md" | ForEach-Object {
        $src = $_.FullName
        $dst = Join-Path $DATA_DST $_.Name
        $needCopy = $true
        if (Test-Path $dst) {
            $srcHash = (Get-FileHash $src -Algorithm SHA256).Hash
            $dstHash = (Get-FileHash $dst -Algorithm SHA256).Hash
            if ($srcHash -eq $dstHash) { $needCopy = $false }
        }
        if ($needCopy) {
            Copy-Item $src $dst -Force
            $copied++
        }
    }
}

if ($copied -gt 0) {
    Write-Ok "$copied 个 Skill/数据文件已部署到 $SKILL_DST"
} else {
    Write-Ok "Skill 文件全部就绪（无变更）"
}

# fde.md 同步到 skills/sofagent/（AGENTS.md 注入优先查此路径，高于 $TARGET/fde.md）
$_rulesSrc2 = Join-Path $SKILL_SRC_DIR "data\fde.md"
if (-not (Test-Path $_rulesSrc2)) { $_rulesSrc2 = Join-Path $SKILL_SRC_DIR "fde.md" }
if (-not (Test-Path $_rulesSrc2)) { $_rulesSrc2 = Join-Path $SKILL_SRC_DIR "constitution\fde.md" }
$_rulesDst2 = Join-Path $SKILL_DST "fde.md"
if (Test-Path $_rulesSrc2) {
    $_needCopy2 = $true
    if (Test-Path $_rulesDst2) {
        if ((Get-FileHash $_rulesSrc2 -Algorithm SHA256).Hash -eq (Get-FileHash $_rulesDst2 -Algorithm SHA256).Hash) { $_needCopy2 = $false }
    }
    if ($_needCopy2) { Copy-Item $_rulesSrc2 $_rulesDst2 -Force; Write-Ok "fde.md → $SKILL_DST" }
}

# v1.2.2: agents/ Sub Agent 定义部署（fde / audit / engineer / reviewer）
$_agentsSrc = Join-Path $PROJECT_ROOT "SKILL\agents"
if (Test-Path $_agentsSrc) {
    Get-ChildItem $_agentsSrc -Directory | ForEach-Object {
        $_agentName = $_.Name
        $_agentSkillSrc = Join-Path $_.FullName "SKILL.md"
        if (Test-Path $_agentSkillSrc) {
            $_agentDstDir = Join-Path $SKILL_DST "agents\$_agentName"
            if (-not (Test-Path $_agentDstDir)) { New-Item -ItemType Directory -Path $_agentDstDir -Force | Out-Null }
            $_agentDstFile = Join-Path $_agentDstDir "SKILL.md"
            $_needCopyAgent = $true
            if (Test-Path $_agentDstFile) {
                if ((Get-FileHash $_agentSkillSrc -Algorithm SHA256).Hash -eq (Get-FileHash $_agentDstFile -Algorithm SHA256).Hash) { $_needCopyAgent = $false }
            }
            if ($_needCopyAgent) { Copy-Item $_agentSkillSrc $_agentDstFile -Force; $copied++ }
        }
    }
}

# constraints.md 同步到 skills/sofagent/（嵌入模式行为约束注入源，替代 SKILL.md 避免框架元指令干扰）
$_constraintsSrc = Join-Path $SKILL_SRC_DIR "skills\sofagent\constraints.md"
$_constraintsDst = Join-Path $SKILL_DST "constraints.md"
if (Test-Path $_constraintsSrc) {
    $_needCopyC = $true
    if (Test-Path $_constraintsDst) {
        if ((Get-FileHash $_constraintsSrc -Algorithm SHA256).Hash -eq (Get-FileHash $_constraintsDst -Algorithm SHA256).Hash) { $_needCopyC = $false }
    }
    if ($_needCopyC) { Copy-Item $_constraintsSrc $_constraintsDst -Force; Write-Ok "constraints.md → $SKILL_DST" }
} else {
    Write-Warn "constraints.md 源文件不存在：$_constraintsSrc（嵌入模式约束注入将 fallback 到 SKILL.md）"
}

# v0.91: SKILL.md 部署后确保 disable: true（防止安装副本被平台自动加载）
$deployedSkill = Join-Path $SKILL_DST "SKILL.md"
if (Test-Path $deployedSkill) {
    $skillLines = Get-Content $deployedSkill -Encoding UTF8
    if (-not ($skillLines | Where-Object { $_ -match '^disable:' })) {
        $hasDisplay = [bool]($skillLines | Where-Object { $_ -match '^displayName:' })
        $anchorRe = if ($hasDisplay) { '^displayName:' } else { '^name:' }
        $outLines = New-Object System.Collections.Generic.List[string]
        $inserted = $false
        foreach ($ln in $skillLines) {
            $outLines.Add($ln)
            if (-not $inserted -and $ln -match $anchorRe) {
                $outLines.Add('disable: true')
                $inserted = $true
            }
        }
        # .md 不写 BOM（BOM 在首行 --- 前会破坏 frontmatter 解析），保持 LF
        [System.IO.File]::WriteAllText($deployedSkill, (($outLines -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding $false))
        Write-Ok "SKILL.md 安装副本已置 disable: true"
    }
}

# Lite 模式：创建 think.md 空模板（v0.90 P0-2：Lite 跳过 Step 5b，需提前创建数据目录）
if ($Lite) {
    New-Item -ItemType Directory -Force -Path $SOFAGENT_DATA | Out-Null
    $thinkDst = Join-Path $SOFAGENT_DATA "think.md"
    if (-not (Test-Path $thinkDst)) {
        $thinkTpl = @"
# 反思区（think.md）

> sofagent 反思区——自动记录每次任务的教训和经验。
> 任务闭环后由 task-closure 自动更新，30 天衰减。

（暂无反思记录）
"@
        [System.IO.File]::WriteAllText($thinkDst, ($thinkTpl + "`n"), (New-Object System.Text.UTF8Encoding $false))
        Write-Ok "think.md 模板已创建: $thinkDst"
    } else {
        Write-Ok "think.md 已存在，跳过"
    }
}

# ════════════════════════════════════════
# Step 2.5: 部署 .ps1 运行时脚本（供 {OPENCLAW_SCRIPTS} 在部署后解析）
# ════════════════════════════════════════
if (-not $Lite) {
Write-Info "部署运行时脚本 → $TARGET\scripts\"
$scriptsDst = Join-Path $TARGET "scripts"
$libDst = Join-Path $scriptsDst "lib"
New-Item -ItemType Directory -Force -Path $libDst | Out-Null
$psCount = 0
Get-ChildItem -Path $SCRIPT_DIR -Filter *.ps1 -File | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $scriptsDst $_.Name) -Force; $psCount++
}
$libSrc = Join-Path $SCRIPT_DIR "lib"
if (Test-Path $libSrc) {
    Get-ChildItem -Path $libSrc -Filter *.ps1 -File | ForEach-Object {
        Copy-Item $_.FullName (Join-Path $libDst $_.Name) -Force; $psCount++
    }
}
Write-Ok "$psCount 个 .ps1 脚本已部署到 $scriptsDst"
} else {
    Write-Info "Lite 模式：跳过配套脚本部署"
}

# ════════════════════════════════════════
# Step 3: 部署 fde.md
# ════════════════════════════════════════
Write-Info "Step 3/4 · 部署宪法文件 → $TARGET\fde.md"

# v0.73 起 fde.md 扁平化到 SKILL/harness/data/fde.md；旧布局 fallback 到 constitution/fde.md
$rulesSrc = Join-Path $SKILL_SRC_DIR "fde.md"
if (-not (Test-Path $rulesSrc)) {
    $rulesSrc = Join-Path $SKILL_SRC_DIR "constitution\fde.md"
}
$rulesDst = Join-Path $TARGET "fde.md"

if (Test-Path $rulesSrc) {
    $needCopy = $true
    if (Test-Path $rulesDst) {
        $srcHash = (Get-FileHash $rulesSrc -Algorithm SHA256).Hash
        $dstHash = (Get-FileHash $rulesDst -Algorithm SHA256).Hash
        if ($srcHash -eq $dstHash) { $needCopy = $false }
    }
    if ($needCopy) {
        Copy-Item $rulesSrc $rulesDst -Force
        Write-Ok "fde.md 已安装"
    } else {
        Write-Ok "fde.md 已存在且内容相同，跳过"
    }
} else {
    Write-Err "fde.md 源文件不存在: $rulesSrc"
}

# ════════════════════════════════════════
# Step 4: 创建 .sofagent/ 数据目录
# ════════════════════════════════════════
if (-not $Lite) {
Write-Info "Step 4/4 · 初始化数据目录 → $SOFAGENT_DATA"

if (-not (Test-Path $SOFAGENT_DATA)) {
    New-Item -ItemType Directory -Path (Join-Path $SOFAGENT_DATA "task\logs") -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $SOFAGENT_DATA "orchestrator\workflows") -Force | Out-Null
    Write-Ok "数据目录已创建: $SOFAGENT_DATA"
} else {
    Write-Ok "数据目录已存在: $SOFAGENT_DATA"
    # 确保子目录存在
    if (-not (Test-Path (Join-Path $SOFAGENT_DATA "task\logs"))) {
        New-Item -ItemType Directory -Path (Join-Path $SOFAGENT_DATA "task\logs") -Force | Out-Null
    }
    if (-not (Test-Path (Join-Path $SOFAGENT_DATA "orchestrator\workflows"))) {
        New-Item -ItemType Directory -Path (Join-Path $SOFAGENT_DATA "orchestrator\workflows") -Force | Out-Null
    }
}
}

# ════════════════════════════════════════
# Step 5a（已移除 · P1-32）：agency-orchestrator 已退役
# install.sh v1.0.7 已删除 ao 安装逻辑，install.ps1 同步移除（原装已退役的编排引擎包）。
# 保留 -NoAO 参数仅为兼容旧脚本调用（无害 no-op）。
# ════════════════════════════════════════

# ════════════════════════════════════════
# Step 5（仅 OpenClaw）：部署加载链 Hook + 注入断路器（对齐 install.sh Step 6/7）
# ════════════════════════════════════════
if ($Platform -eq "openclaw" -and -not $Lite) {
    $utf8b = New-Object System.Text.UTF8Encoding $false
    # ── Hook 部署 ──
    Write-Info "OpenClaw · 部署加载链 Hook..."
    $hookSrc = Join-Path $SOFAGENT_DIR "hooks\sofagent-load-chain"
    $hookDst = Join-Path $TARGET "hooks\sofagent-load-chain"
    # v1.2.1 (DP-4): hook 已提升为正式 workspace 包，handler.ts 由 src/handler.ts 构建生成
    # 确保 handler.ts 存在（开发模式下可能未 build，从 src/ 复制）
    if ((Test-Path (Join-Path $hookSrc "HOOK.md")) -and -not (Test-Path (Join-Path $hookSrc "handler.ts"))) {
        $srcHandler = Join-Path $hookSrc "src\handler.ts"
        if (Test-Path $srcHandler) { Copy-Item $srcHandler (Join-Path $hookSrc "handler.ts") -Force }
    }
    if ((Test-Path (Join-Path $hookSrc "HOOK.md")) -and (Test-Path (Join-Path $hookSrc "handler.ts"))) {
        New-Item -ItemType Directory -Force -Path $hookDst | Out-Null
        Copy-Item (Join-Path $hookSrc "HOOK.md") (Join-Path $hookDst "HOOK.md") -Force
        Copy-Item (Join-Path $hookSrc "handler.ts") (Join-Path $hookDst "handler.ts") -Force
        # 额外部署编译产物（供直接 node 执行）
        $distHandler = Join-Path $hookSrc "dist\handler.js"
        if (Test-Path $distHandler) {
            $distDst = Join-Path $hookDst "dist"
            New-Item -ItemType Directory -Force -Path $distDst | Out-Null
            Copy-Item $distHandler (Join-Path $distDst "handler.js") -Force
        }
        Write-Ok "加载链 Hook 已部署: $hookDst"
        # 注册 openclaw.json: hooks.internal.entries.sofagent-load-chain = {enabled:true}
        $ocCfg = if ($env:OPENCLAW_CONFIG_PATH) { $env:OPENCLAW_CONFIG_PATH } else { Join-Path $TARGET "openclaw.json" }
        try {
            $j = if (Test-Path $ocCfg) { Get-Content $ocCfg -Raw -Encoding UTF8 | ConvertFrom-Json } else { [pscustomobject]@{} }
            if (-not $j.PSObject.Properties['hooks']) { $j | Add-Member hooks ([pscustomobject]@{}) }
            if (-not $j.hooks.PSObject.Properties['internal']) { $j.hooks | Add-Member internal ([pscustomobject]@{}) }
            $j.hooks.internal | Add-Member enabled $true -Force
            if (-not $j.hooks.internal.PSObject.Properties['entries']) { $j.hooks.internal | Add-Member entries ([pscustomobject]@{}) }
            $j.hooks.internal.entries | Add-Member "sofagent-load-chain" ([pscustomobject]@{ enabled = $true }) -Force
            if (Test-Path $ocCfg) { Copy-Item $ocCfg "$ocCfg.bak" -Force }
            [System.IO.File]::WriteAllText($ocCfg, ($j | ConvertTo-Json -Depth 10), $utf8b)
            Write-Ok "Hook 已注册: $ocCfg"
        } catch { Write-Warn "openclaw.json 注册失败（含注释/格式问题？）：$($_.Exception.Message)。手动加 hooks.internal.entries.sofagent-load-chain" }
        Write-Warn "Hook 说明：loadInternalHooks() 仅在 gateway 进程启动时调用，relay/embedded 模式下 hook 不触发。"
        Write-Warn "  → 实际约束注入路径：workspace/AGENTS.md（benchmark-cross.ps1 的 Set-SofagentContext 写入此文件）"
    } else { Write-Warn "找不到 hook 源文件（$hookSrc），跳过" }

    # ── 断路器 loopDetection（受 -NoConfigInject 控）──
    # loopDetection 写入 config.json；openclaw.json 仅用于 Hook（OPENCLAW_CONFIG_PATH 不混用）
    if (-not $NoConfigInject) {
        Write-Info "OpenClaw · 注入断路器 loopDetection..."
        $cfgFile = Join-Path $TARGET "config.json"
        try {
            $cf = if (Test-Path $cfgFile) { Get-Content $cfgFile -Raw -Encoding UTF8 | ConvertFrom-Json } else { [pscustomobject]@{} }
            if ($cf.PSObject.Properties['tools'] -and $cf.tools.PSObject.Properties['loopDetection']) {
                Write-Ok "loopDetection 已存在，跳过"
            } else {
                $loop = [pscustomobject]@{ enabled = $true; historySize = 30; warningThreshold = 10; criticalThreshold = 20; globalCircuitBreakerThreshold = 30; detectors = [pscustomobject]@{ genericRepeat = $true; knownPollNoProgress = $true; pingPong = $true } }
                if (-not $cf.PSObject.Properties['tools']) { $cf | Add-Member tools ([pscustomobject]@{}) }
                $cf.tools | Add-Member loopDetection $loop -Force
                if (Test-Path $cfgFile) { Copy-Item $cfgFile "$cfgFile.bak" -Force }
                [System.IO.File]::WriteAllText($cfgFile, ($cf | ConvertTo-Json -Depth 10), $utf8b)
                Write-Ok "loopDetection 断路器已注入: $cfgFile"
            }
        } catch { Write-Warn "config.json 注入失败：$($_.Exception.Message)" }
    } else { Write-Info "(-NoConfigInject) 跳过断路器注入" }
}

# ════════════════════════════════════════
# Step 5b（claude/codex/hermes）：写入种子指令（对齐 install.sh 手动平台段）
# ════════════════════════════════════════
$SEED_FILE = ""
if ($Platform -in @("claude", "codex", "hermes")) {
    $seedMap = @{
        claude = @{ file = "CLAUDE.md"; rules = "$env:USERPROFILE\.claude\fde.md" }
        codex  = @{ file = "AGENTS.md"; rules = "$env:USERPROFILE\.codex\fde.md" }
        hermes = @{ file = "SOUL.md";   rules = "$env:USERPROFILE\.hermes\fde.md" }
    }
    $SEED_FILE  = Join-Path $TARGET $seedMap[$Platform].file
    $seedRules  = $seedMap[$Platform].rules
    $seedContent = @(
        "每次对话开始时，读取以下文件并执行 sofagent 入口流程：",
        "1. fde.md：$seedRules（宪法已在 SKILL.md 内联）",
        "2. 如果工作目录含 .sofagent/ 数据文件，加载记忆和反思",
        "如果数据文件（.sofagent/）不存在，先创建空模板。"
    ) -join "`r`n"
    # PS 5.1 Select-String -Path 用系统编码读文件，改用 .NET API 读 UTF-8
    $seedFileContent = if (Test-Path $SEED_FILE) { [System.IO.File]::ReadAllText($SEED_FILE) } else { "" }
    if ((Test-Path $SEED_FILE) -and ($seedFileContent -match 'sofagent')) {
        Write-Ok "种子指令已存在于 $SEED_FILE，跳过写入"
    } else {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $SEED_FILE) | Out-Null
        $existing = if (Test-Path $SEED_FILE) { [System.IO.File]::ReadAllText($SEED_FILE) } else { "" }
        # 追加不覆盖；UTF-8 无 BOM
        [System.IO.File]::WriteAllText($SEED_FILE, ($existing + "`r`n" + $seedContent + "`r`n"), (New-Object System.Text.UTF8Encoding $false))
        Write-Ok "种子指令已写入 $SEED_FILE"
    }
}

# ════════════════════════════════════════
# Step 6（可选）：daemon 后台进程（Windows 计划任务，-WithDaemon 开启）
# ════════════════════════════════════════
# 注：install.sh 在 Windows 上跳过 daemon（用 launchd/systemd）；本 .ps1 的 daemon 原生支持
# Windows（Register-ScheduledTask），故这里提供 -WithDaemon 开关。
if ($WithDaemon -and -not $Lite) {
    Write-Info "安装 daemon（Windows 计划任务，监控 think.md/fde.md 变化）..."
    $daemonInstall = Join-Path $SCRIPT_DIR "daemon-install.ps1"
    if (Test-Path $daemonInstall) {
        try { & powershell -NoProfile -ExecutionPolicy Bypass -File $daemonInstall }
        catch { Write-Warn "daemon 安装失败：$($_.Exception.Message)（可稍后手动运行 daemon-install.ps1）" }
    } else { Write-Warn "找不到 daemon-install.ps1，跳过" }
} elseif (-not $Quick) {
    Write-Info "(未加 -WithDaemon) 跳过 daemon。需后台监控可加 -WithDaemon 或手动 daemon-install.ps1"
}

# ════════════════════════════════════════
# 安装完成
# ════════════════════════════════════════
if ($Lite) {
    Write-Host ""
    Write-Host "  +======================================+"
    Write-Host "  |  sofagent Lite · 安装完成！          |"
    Write-Host "  +======================================+"
    Write-Host ""
    Write-Host "  已部署：宪法（SKILL.md）+ 反思区（think.md）+ 规则（fde.md）"
    Write-Host "  跳过：编排引擎 / Hook / 断路器 / daemon / 配套脚本"
    Write-Host ""
    Write-Host "  降 80% 复杂度，保 60% 价值。"
    Write-Host "  非交互式平台推荐先用 Lite 体验核心约束。"
    Write-Host ""
    exit 0
}

if ($Quick) {
    Write-Ok "安装完成（quick）：$Platform → $TARGET | 数据: $SOFAGENT_DATA"
} else {
    Write-Host ""
    Write-Host "  +====================================+"
    Write-Host "  |  sofagent · 安装完成！             |"
    Write-Host "  +====================================+"
    Write-Host ""
    Write-Host "  平台: $Platform"
    Write-Host "  已部署文件："
    Write-Host "    Skill 文件:  $SKILL_DST"
    Write-Host "    宪法文件:    $rulesDst"
    Write-Host "    数据目录:    $SOFAGENT_DATA"
    if ($Platform -eq "openclaw") {
        Write-Host "    加载链 Hook: $TARGET\hooks\sofagent-load-chain\"
    }
    if ($SEED_FILE) {
        Write-Host "    种子指令:    $SEED_FILE"
    }
    Write-Host ""
    Write-Host "  下一步："
    if ($Platform -in @("claude", "codex", "hermes")) {
        Write-Host "    1. 种子指令已写入 $SEED_FILE"
        Write-Host "    2. 开始新对话，回复 'sofagent' 验证加载链是否生效"
    } else {
        Write-Host "    1. 在 $Platform 中打开项目: $ProjectDir"
        Write-Host "    2. 开始新对话，sofagent Skill 应自动加载"
        Write-Host "    3. 回复 'sofagent' 验证是否加载成功"
    }
    Write-Host ""
}
