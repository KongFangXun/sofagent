# ============================================================
# sofagent verify.ps1 · 装后验证脚本 (Windows PowerShell)
# ============================================================
# verify.sh 的原生 Windows 移植。验证 sofagent 安装完整性。
# 适配 Windows：脚本检查 .ps1、platform 用 USERPROFILE 路径、脱敏自检用 .NET 正则。
#
# 用法：
#   verify.ps1                正常输出
#   verify.ps1 -Json          JSON 机器可读
#   verify.ps1 -Quiet         只显示失败/警告
#   verify.ps1 -Quick         快速模式（4 项核心检查）
#   verify.ps1 -Platform workbuddy
# ============================================================

param(
    [switch]$Json,
    [switch]$Quiet,
    [switch]$Quick,
    [string]$Platform = "",
    [switch]$Help
)

$ErrorActionPreference = "Continue"
$VERSION_STR = "1.0.6"
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}

$cfg = Join-Path $PSScriptRoot "lib\config.ps1"
if (Test-Path $cfg) { . $cfg }

if ($Help) {
    Write-Host "sofagent verify v$VERSION_STR (PowerShell)"
    Write-Host "  -Json   JSON 输出   -Quiet 只显示失败/警告   -Quick 快速 4 项   -Platform 指定平台"
    exit 0
}

$script:pass = 0; $script:fail = 0; $script:warn = 0
$script:jsonItems = @()
function Check-Pass($m) { $script:pass++; if ($Json) { $script:jsonItems += @{status = "pass"; item = $m } } elseif (-not $Quiet) { Write-Host "  [+] $m" -ForegroundColor Green } }
function Check-Fail($m) { $script:fail++; if ($Json) { $script:jsonItems += @{status = "fail"; item = $m } } else { Write-Host "  [x] $m" -ForegroundColor Red } }
function Check-Warn($m) { $script:warn++; if ($Json) { $script:jsonItems += @{status = "warn"; item = $m } } else { Write-Host "  [!] $m" -ForegroundColor Yellow } }
function Section($t) { if (-not $Json -and -not $Quiet) { Write-Host ""; Write-Host "── $t ──" -ForegroundColor Cyan } }
function Write-Summary($mode) {
    $total = $script:pass + $script:fail + $script:warn
    if ($Json) {
        $obj = @{ summary = @{ pass = $script:pass; warn = $script:warn; fail = $script:fail; total = $total }; checks = $script:jsonItems }
        Write-Host ($obj | ConvertTo-Json -Depth 5 -Compress)
        return
    }
    if (-not $Quiet -or $script:fail -gt 0) {
        Write-Host "───────────────────────────────────────"
        Write-Host "  结果: $($script:pass) 通过 / $($script:warn) 警告 / $($script:fail) 失败（共 $total 项）"
    }
    if ($script:fail -eq 0) {
        if (-not $Quiet) { Write-Host "  [OK] sofagent 安装验证通过！" -ForegroundColor Green }
    } else {
        Write-Host "  [X] 发现 $($script:fail) 项失败。请先运行 install.ps1 修复。" -ForegroundColor Red
    }
}

# ── 平台探测 ──
$up = $env:USERPROFILE
if ([string]::IsNullOrEmpty($Platform)) {
    if     (Test-Path "$up\.openclaw")  { $Platform = "openclaw" }
    elseif (Test-Path "$up\.workbuddy") { $Platform = "workbuddy" }
    elseif (Test-Path "$up\.claude")    { $Platform = "claude" }
    elseif (Test-Path "$up\.codex")     { $Platform = "codex" }
    elseif (Test-Path "$up\.hermes")    { $Platform = "hermes" }
    else                                { $Platform = "openclaw" }
}
$Platform = $Platform.ToLower()
switch ($Platform) {
    "workbuddy" { $TARGET = "" }
    "claude"    { $TARGET = "$up\.claude" }
    "codex"     { $TARGET = "$up\.codex" }
    "hermes"    { $TARGET = "$up\.hermes" }
    default     { $TARGET = if ($env:OPENCLAW_STATE_DIR) { $env:OPENCLAW_STATE_DIR } else { "$up\.openclaw" } }
}
$OPENCLAW_DIR = if ([string]::IsNullOrEmpty($TARGET)) { "$up\.openclaw" } else { $TARGET }
$ScriptDir = $PSScriptRoot
$sofagentData = if (-not [string]::IsNullOrEmpty($env:SOFAGENT_DATA)) { $env:SOFAGENT_DATA } else { Join-Path (Get-Location).Path ".sofagent" }

if (-not $Json) {
    Write-Host ""
    Write-Host "  ╔═══════════════════════════════════╗"
    Write-Host "  ║   sofagent · verify (PowerShell) ║"
    Write-Host "  ╚═══════════════════════════════════╝"
    if (-not $Quiet) { Write-Host "  平台: $Platform | 目标: $(if($TARGET){$TARGET}else{'工作区'})" }
}

function Get-CharCount($f) { try { ([System.IO.File]::ReadAllText($f)).Length } catch { 0 } }

# ════════ Quick 模式：4 项核心检查 ════════
if ($Quick) {
    if (-not $Json -and -not $Quiet) { Write-Host "  [快速模式] 4 项核心检查" }
    # 修复 .sh 老 bug：quick 模式应按平台找 SKILL.md，不能写死 .openclaw（workbuddy 装在 .workbuddy）
    $skillQuick = @("$OPENCLAW_DIR\skills\sofagent\SKILL.md", "$up\.workbuddy\skills\sofagent\SKILL.md", "$up\.openclaw\skills\sofagent\SKILL.md") | Where-Object { Test-Path $_ } | Select-Object -First 1
    # PS 5.1 Select-String -Path 用系统编码读文件，改用 .NET API 读 UTF-8
    $skillQuickContent = if ($skillQuick) { [System.IO.File]::ReadAllText($skillQuick) } else { "" }
    if ($skillQuick -and ($skillQuickContent -match "4.*底线|6.*铁律")) { Check-Pass "SKILL.md 存在且含宪法（4底线+6则铁律）" } else { Check-Fail "SKILL.md 缺失或宪法关键词不全" }
    if (Test-Path $sofagentData) { Check-Pass ".sofagent/ 数据目录存在" } else { Check-Warn ".sofagent/ 数据目录不存在（首次使用会自动创建）" }
    if (Get-Command ao -ErrorAction SilentlyContinue) { Check-Pass "ao compose 可用 — v$(ao --version 2>$null)" } else { Check-Warn "ao compose 不可用——编排引擎降级为默认编排" }
    $rulesQuick = @("$OPENCLAW_DIR\skills\sofagent\fde.md", "$up\.workbuddy\skills\sofagent\fde.md", "$up\.openclaw\fde.md") | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($rulesQuick) { Check-Pass "fde.md 可读 — $rulesQuick" } else { Check-Warn "fde.md 未找到或不可读" }
    Write-Summary; exit $(if ($script:fail -gt 0) { 1 } else { 0 })
}

# ════════ WorkBuddy 专属检查后结束 ════════
if ($Platform -eq "workbuddy") {
    Check-Pass "WorkBuddy 平台——宪法/Hook/断路器由 SKILL.md 入口流程管理"
    $wbSkill = "$up\.workbuddy\skills\sofagent\SKILL.md"
    if ((Test-Path $wbSkill) -and (Get-Item $wbSkill).Length -gt 0) {
        # PS 5.1 Select-String -Path 用系统编码读文件，改用 .NET API 读 UTF-8
        $wbSkillContent = [System.IO.File]::ReadAllText($wbSkill)
        if ($wbSkillContent -match "4 底线|6 则铁律") { Check-Pass "SKILL.md 已部署且含宪法（4底线+6则铁律内联）" } else { Check-Warn "SKILL.md 已部署但宪法内容缺失" }
    } else { Check-Warn "SKILL.md 未部署到 ~/.workbuddy/skills/sofagent/" }
    $wbRules = "$up\.workbuddy\fde.md"
    if ((Test-Path $wbRules) -and (Get-Item $wbRules).Length -gt 0) { Check-Pass "fde.md 已部署（$(Get-CharCount $wbRules) 字符）" } else { Check-Warn "fde.md 未部署到 ~/.workbuddy/" }
    if (Test-Path "$up\.workbuddy\skills\sofagent") {
        $cnt = (Get-ChildItem "$up\.workbuddy\skills\sofagent" -Filter *.md -ErrorAction SilentlyContinue | Measure-Object).Count
        Check-Pass "Skills 目录已部署（$cnt 个 .md 文件）"
    } else { Check-Warn "Skills 目录不存在" }
    if (Test-Path $sofagentData) { Check-Pass ".sofagent/ 数据目录存在" } else { Check-Warn ".sofagent/ 数据目录不存在（首次使用会自动创建）" }
    Write-Summary "workbuddy"; exit $(if ($script:fail -gt 0) { 1 } else { 0 })
}

# ════════ 完整检查（非 workbuddy）════════
Section "宪法文件（fde.md）"
$rp = Join-Path $OPENCLAW_DIR "skills\sofagent\fde.md"
if (-not (Test-Path $rp)) { $rp = Join-Path $OPENCLAW_DIR "fde.md" }
if ((Test-Path $rp) -and (Get-Item $rp).Length -gt 0) {
    $chars = Get-CharCount $rp; $lines = (Get-Content $rp -Encoding UTF8).Count
    Check-Pass "fde.md ($chars 字符, $lines 行)"
    if ($chars -gt 1200) { Check-Warn "fde.md 超过 1200 字符（$chars），宪法层阈值放宽至 1200" }
} else { Check-Fail "fde.md — 缺失或为空" }

Section "Skill 文件"
$skillsDir = Join-Path $OPENCLAW_DIR "skills"
if (Test-Path $skillsDir) { Check-Pass "Skills 目录存在: $((Get-ChildItem $skillsDir -Recurse -Filter *.md -EA SilentlyContinue | Measure-Object).Count) 个 .md 文件" } else { Check-Fail "Skills 目录不存在: $skillsDir" }

Section "配套脚本（Windows 检查 .ps1）"
$scriptsDir = Join-Path $OPENCLAW_DIR "scripts"
if (Test-Path $scriptsDir) {
    Check-Pass "scripts/ 目录存在: $((Get-ChildItem $scriptsDir -Filter *.ps1 -EA SilentlyContinue | Measure-Object).Count) 个 .ps1 文件"
    foreach ($s in @("task-record.ps1", "task-orchestrate.ps1", "skill-safety-check.ps1")) {
        if (Test-Path (Join-Path $scriptsDir $s)) { Check-Pass "  $s 已部署" } else { Check-Warn "  $s 缺失" }
    }
} else { Check-Warn "scripts/ 目录不存在（请先运行 install.ps1 部署脚本）" }

Section "外部依赖"
if (Get-Command ao -ErrorAction SilentlyContinue) {
    Check-Pass "agency-orchestrator (ao) 可用 — v$(ao --version 2>$null)"
} else { Check-Warn "ao 命令不可用 — 编排功能将不可用" }
if (Get-Command node -ErrorAction SilentlyContinue) { Check-Pass "Node.js $(node --version)" } else { Check-Fail "Node.js 不可用" }

Section "平台兼容性"
foreach ($p in @(@("openclaw", "OpenClaw"), @("claude", "Claude Code"), @("codex", "Codex"), @("hermes", "Hermes"))) {
    if (Get-Command $p[0] -ErrorAction SilentlyContinue) { Check-Pass "$($p[1]) CLI 已安装" } else { Check-Warn "$($p[1]) 未检测 — 如不使用请忽略" }
}
if (Test-Path "$up\.workbuddy") { Check-Pass "WorkBuddy 环境已检测" } else { Check-Warn "WorkBuddy 未检测 — 如不使用请忽略" }

Section "数据目录"
if (Test-Path $sofagentData) {
    Check-Pass ".sofagent/ 数据目录存在"
    foreach ($sub in @("task\logs", "orchestrator")) {
        if (Test-Path (Join-Path $sofagentData $sub)) { Check-Pass "  .sofagent/$sub/ 就绪" } else { Check-Warn "  .sofagent/$sub/ 缺失" }
    }
} else { Check-Warn ".sofagent/ 数据目录不存在（首次使用会自动创建）" }

# ════════ 约束实效验证 ════════
Section "约束验证"
$skillFile = Join-Path $OPENCLAW_DIR "skills\sofagent\SKILL.md"
if (Test-Path $skillFile) {
    # PS 5.1 Select-String -Path 用系统编码读文件，改用 .NET API 读 UTF-8
    $skillFileContent = [System.IO.File]::ReadAllText($skillFile)
    if ($skillFileContent -match "4.*底线|6.*铁律") { Check-Pass "契约层关键词完整（4底线+6则铁律内联在 SKILL.md）" } else { Check-Fail "SKILL.md 内容异常——宪法关键词缺失" }
} else { Check-Warn "SKILL.md 不存在，无法验证宪法内容" }

$logsDir = Join-Path $sofagentData "task\logs"
if (Test-Path $logsDir) {
    $recent = (Get-ChildItem $logsDir -Recurse -Filter *.md -EA SilentlyContinue | Where-Object { $_.LastWriteTime -gt (Get-Date).AddDays(-7) } | Measure-Object).Count
    if ($recent -gt 0) { Check-Pass "最近7天有 $recent 条任务记录" } else { Check-Warn "最近7天无任务记录——数据层可能空转" }
} else { Check-Warn "task/logs/ 目录不存在——尚未运行过任务" }

$thinkFile = Join-Path $sofagentData "think.md"
if (Test-Path $thinkFile) {
    $days = ((Get-Date) - (Get-Item $thinkFile).LastWriteTime).Days
    if ($days -le 3) { Check-Pass "think.md $days 天前更新（活跃）" }
    elseif ($days -le 14) { Check-Warn "think.md $days 天前更新（较不活跃）" }
    else { Check-Warn "think.md $days 天前更新——闭环可能未正常运转" }
} else { Check-Warn "think.md 不存在——尚未触发过闭环反思" }

# ════════ 企业合规：脱敏自检（.NET 正则）════════
Section "企业合规"
if (Test-Path (Join-Path $ScriptDir "lib\config.ps1")) { Check-Pass "config.ps1 共享配置加载器存在" } else { Check-Warn "config.ps1 不存在" }

function Test-Sanitize([string]$t) {
    $t = $t -replace 'sk-(ant(-api)?-)?[a-zA-Z0-9_-]{20,}', 'sk-***REDACTED***'
    $t = $t -replace '\b(password|token|secret|api_key|key)[=:]\s*[^ ]+', '$1=***REDACTED***'
    $t = $t -replace '\b1[3-9][0-9]{9}\b', '[PHONE-REDACTED]'
    return $t
}
if ((Test-Sanitize "sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456") -match 'REDACTED') { Check-Pass "脱敏: API Key 打码正常" } else { Check-Fail "脱敏: API Key 未打码" }
$pw = Test-Sanitize "password=mysecret123"
if ($pw -match 'REDACTED' -and $pw -notmatch 'mysecret123') { Check-Pass "脱敏: 凭证打码正常" } else { Check-Fail "脱敏: 凭证未打码" }
$ph = Test-Sanitize "用户电话 13812345678 请回拨"
if ($ph -match 'PHONE-REDACTED' -and $ph -notmatch '13812345678') { Check-Pass "脱敏: 手机号打码正常" } else { Check-Fail "脱敏: 手机号未打码" }
if ((Test-Sanitize "订单号 28012345678 已生成") -notmatch 'PHONE-REDACTED') { Check-Pass "脱敏: 11 位订单号（非 1[3-9] 开头）未被误伤" } else { Check-Warn "脱敏: 11 位订单号被误伤" }
if ((Test-Sanitize "monkey=foo 这是任务名") -notmatch 'REDACTED') { Check-Pass "脱敏: 词边界保护（monkey=foo 不被误伤）" } else { Check-Warn "脱敏: 词边界失效" }
if ((Test-Sanitize "普通文本无敏感信息") -eq "普通文本无敏感信息") { Check-Pass "脱敏: 无敏感信息文本原样通过" } else { Check-Warn "脱敏: 无敏感信息文本被修改" }

# 合规/核心脚本存在性（.ps1，直接检查避免单元素嵌套数组被 PS 摊平）
foreach ($cs in @("audit.ps1", "task-record.ps1")) {
    if (Test-Path (Join-Path $ScriptDir $cs)) { Check-Pass "$cs 存在" } else { Check-Warn "$cs 缺失" }
}

# fde.md 合规配置段完整性
$rulesCfg = @("$((Get-Location).Path)\sofagent\fde.md", "$up\.openclaw\skills\sofagent\fde.md", "$up\.workbuddy\skills\sofagent\fde.md", "$OPENCLAW_DIR\skills\sofagent\fde.md") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($rulesCfg) {
    # PS 5.1 Select-String -Path 用系统编码读文件，改用 .NET API 读 UTF-8
    $rulesCfgContent = [System.IO.File]::ReadAllText($rulesCfg)
    $missing = 0
    foreach ($key in @("log_sanitize", "log_sanitize_ips", "data_retention_days", "data_retention_max_entries", "data_cleanup_on_record", "data_cleanup_frequency", "audit_enabled")) {
        if ($rulesCfgContent -notmatch "${key}:") { $missing++ }
    }
    if ($missing -eq 0) { Check-Pass "fde.md 合规配置段完整（7/7 配置项）" } else { Check-Warn "fde.md 合规配置段不完整（缺少 $missing/7 项）" }
} else { Check-Warn "fde.md 未找到，无法验证合规配置段" }

# ════════ 总结 ════════
Write-Summary
exit $(if ($script:fail -gt 0) { 1 } else { 0 })
