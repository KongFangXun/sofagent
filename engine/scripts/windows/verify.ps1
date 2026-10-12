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
$VERSION_STR = "1.5.8"
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
    if (Get-Command sofagent-audit -ErrorAction SilentlyContinue) { Check-Pass "sofagent-audit 可用 — v$(sofagent-audit --version 2>$null)" } else { Check-Warn "sofagent-audit 不可用——审计模块降级" }
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
        if ($wbSkillContent -match "4 底线|9 则铁律") { Check-Pass "SKILL.md 已部署且含宪法（4底线+9则铁律内联）" } else { Check-Warn "SKILL.md 已部署但宪法内容缺失" }
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
    foreach ($s in @("task-record.ps1", "audit.ps1")) {
        if (Test-Path (Join-Path $scriptsDir $s)) { Check-Pass "  $s 已部署" } else { Check-Warn "  $s 缺失" }
    }
} else { Check-Warn "scripts/ 目录不存在（请先运行 install.ps1 部署脚本）" }

Section "外部依赖"
if (Get-Command sofagent-audit -ErrorAction SilentlyContinue) {
    Check-Pass "sofagent-audit 可用 — v$(sofagent-audit --version 2>$null)"
} else { Check-Warn "sofagent-audit 命令不可用 — 审计功能将不可用" }
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

# ── 脱敏自检（被测对象 = 真身 lib\sanitize.ps1 的 8 步）──────────────────
# ⚠️ 历史缺陷（既有污染，非任何一次改动的回归）：本节曾持一份**手抄副本**
#    `function Test-Sanitize`，只有第 1/5/7 三步（缺第 8 步内网 IP 与 Bearer/JWT/AWS/PEM），
#    而且两条 fixture 自带期望标记：`sk-***REDACTED***` ⇒ 断言**恒真**；
#    `1**REDACTED***` ⇒ 断言**恒假红**。与 shell 侧 8ed9042c 修掉的副本漂移逐字同型
#    （副本缺步骤 ⇒ 真身坏了测试不知道）。副本已删，改为 dot-source 真身。
$sanitizeLib = Join-Path $ScriptDir "lib\sanitize.ps1"
$script:sanitizeReady = $false
if (Test-Path $sanitizeLib) {
    . $sanitizeLib
    if (Get-Command Invoke-Sanitize -ErrorAction SilentlyContinue) { $script:sanitizeReady = $true }
}
if ($script:sanitizeReady) {
    Check-Pass "脱敏: 真身 lib\sanitize.ps1 已加载（单一真相源，本文件无本地副本）"
} else {
    # fail-loud：缺文件时下游断言会以「命令不存在 → 输出为空」的形式失败，归因会指向
    # 「脱敏功能全坏」这一假因。此处显式点名真正根因（对齐 verify.sh:702-706）。
    Check-Fail "脱敏: lib\sanitize.ps1 缺失或无 Invoke-Sanitize——脱敏断言无法测真身（禁止退回手抄副本）"
}

# ── fixture（**一律先落变量**：内联字面量会让「fixture 自带期望标记」无法自证）──
# 三条 A2 不泄密钥地雷（与 shell 侧 verify.sh:709-717 / :739-742 同源，同一类地雷）：
#   ① 通用 sk- 规则门槛 32 字符（engine/audit/src/rules/rule-a2-secret-leak.ts:21）⇒ 取 26；
#   ② 赋值形态 `password=<8+ 字符>` 命中 ⇒ 用 A2 自带占位符白名单词 PLACEHOLDER；
#   ③ 本文件**不享受测试文件豁免**（A2 仅对 `.test.`/`__tests__/`/`.fixture` 降级 WARN）。
# 🔴 AWS Key / PEM 两步**故意不在本文件做 fixture 断言**——不要"补回来"：
#   这两条输入本身就是 A2 的命中形态（`/AKIA[A-Z0-9]{16}/`、`/-----BEGIN [A-Z ]*PRIVATE KEY-----/`），
#   而 A2 的相邻字面量合并判据（rule-a2-secret-leak.ts:122-143）会**把 `+` 相连的字面量
#   合并后取最长串再判**——实测把 AKIA 前缀与尾段写成相邻字面量相加时，被合并出完整密钥
#   形态 ⇒ 提交被 `A2 ❌ FAIL (exit 2)` 拦下（本批实测，非推测；**注释行同样不豁免**）。
#   想改写成 `@(…)-join ''` 能过闸，但那是**在提交闸门旁边开一条构造性旁路**——本仓
#   `secret-patterns.ts` 在规则定义里用该手法是自指规避，fixture 用它则不是。故不做。
#   替代覆盖：这两步由 QA 探针（8 步全覆盖）验证；shell 侧 verify.sh 同样不含这两步
#   ⇒ 不移除反而是与 shell 侧不对齐。
$fxSk = 'sk-ant-api03-ZZZZYYYYXXXXWWWW'
$fxPwd = 'password=PLACEHOLDER'
$fxBearer = 'Authorization: Bearer abc.def~ghi+0'
$fxJwt = 'token eyJhbGciOi.eyJzdWIiOiIxMjM.SflKxwRJSMeKKF2QT4'
$fxPhone = '用户电话 13812345678 请回拨'
$fxOrder = '订单号 28012345678 已生成'
$fxMonkey = 'monkey=foo 这是任务名'
$fxPlain = '普通文本无敏感信息'

# 负控先行：自证 fixture 干净（输入本身不含任何**本仓脱敏令牌**）。上面那两条历史污染就是
# 本负控的哨兵对象——只要 fixture 自己带标记，断言就同时失去「能报红」和「报红才算对」两个能力。
# ⚠️ 判据取 `REDACTED` / `INTERNAL_IP` 这两个**令牌词根**，而不是逐条取该断言要看的标记：
#    历史手机号污染的形态是 `1**REDACTED***`（A9 脱敏形态），它**不含** `[PHONE-REDACTED]`
#    （sanitize 形态）——若逐条按 `PHONE-REDACTED` 判，这条污染**判不出来**（负控自己空转）。
#    故一律按令牌词根判：任何 `*REDACTED*` 出现在输入里都使断言无法区分「脱敏后」与「本就长这样」。
$fxPairs = @(
    @{ name = 'API Key';   fx = $fxSk;      marker = 'REDACTED' },
    @{ name = '凭证';      fx = $fxPwd;     marker = 'REDACTED' },
    @{ name = 'Bearer';    fx = $fxBearer;  marker = 'REDACTED' },
    @{ name = 'JWT';       fx = $fxJwt;     marker = 'REDACTED' },
    @{ name = '手机号';    fx = $fxPhone;   marker = 'REDACTED' },
    @{ name = '内网 IP';   fx = '10.0.0.5'; marker = 'INTERNAL_IP' }
)
$fxPolluted = @($fxPairs | Where-Object { $_.fx -match [regex]::Escape($_.marker) })
if ($fxPolluted.Count -eq 0) {
    Check-Pass "脱敏: fixture 自证干净（不含期望标记 ⇒ 断言非恒真）"
} else {
    Check-Fail ("脱敏: fixture 已被污染（含期望标记 ⇒ 断言退化为恒真/恒假红）：" + (($fxPolluted | ForEach-Object { $_.name }) -join '、'))
}

# 期望标记**运行时拼接**构造（与上面 fixture 说明同款自指规避）：让「标记字面量」不整串出现在
# 任何一行的**实参位置**——静态扫描（QA 探针的「fixture 是否自带期望标记」静态项，以及任何
# 加严版「扫实参位置」的判据）就只需回答一个问题：**输入是否自带标记**。
$tkRedacted = ('***' + 'REDACTED' + '***')
$tkIp = ('[' + 'INTERNAL_IP' + ']')
$tkIpRe = ('\[' + 'INTERNAL_IP' + '\]')

# 正例断言一律**双向**：命中替代标记 **且** 原文形态不残留——单看一个子串会放过
# 「打了码但漏了尾段」形态（内网 IP 那族修过的正是这个）。
function Assert-Sanitized([string]$Label, [string]$Input, [string]$Marker, [string]$RawPattern) {
    $out = $null
    if ($script:sanitizeReady) { $out = Invoke-Sanitize $Input }
    if ($null -ne $out -and $out.Contains($Marker) -and -not ($out -match $RawPattern)) {
        Check-Pass "脱敏: $Label 打码正常"
    } else {
        Check-Fail "脱敏: $Label 未打码或有残留（→ $(if ($null -eq $out) { '<真身不可用>' } else { $out })）"
    }
}
# 负例断言：不得命中禁用形态，且原文原样保留（防「多脱敏」这种越权方向）
function Assert-Passthrough([string]$Label, [string]$Input, [string]$Forbid, [string]$Keep) {
    $out = $null
    if ($script:sanitizeReady) { $out = Invoke-Sanitize $Input }
    if ($null -ne $out -and -not ($out -match $Forbid) -and $out.Contains($Keep)) {
        Check-Pass "脱敏: $Label 未被误伤"
    } else {
        Check-Fail "脱敏: $Label 被误伤（→ $(if ($null -eq $out) { '<真身不可用>' } else { $out })）"
    }
}

# 第 1–7 步逐个断言（顺序与 lib\sanitize.ps1 一致）。AWS / PEM 两步见上方 fixture 说明——
# 它们的 fixture 与 A2 的拼接合并判据正面冲突，故意留空，由 QA 探针覆盖。
Assert-Sanitized "API Key 打码（第 1 步 sk- 规则）"       $fxSk     'REDACTED'                    'sk-[a-zA-Z0-9_-]{20,}'
Assert-Sanitized "Bearer token 打码（第 2 步）"           $fxBearer ('Bearer ' + $tkRedacted)     'Bearer +[a-zA-Z0-9._~+/-]+=*'
Assert-Sanitized "JWT 打码（第 3 步）"                    $fxJwt    'JWT-REDACTED'                'eyJ[a-zA-Z0-9_-]+\.eyJ'
Assert-Sanitized "凭证打码（第 5 步 password=）"          $fxPwd    'REDACTED'                    'PLACEHOLDER'
Assert-Sanitized "手机号打码（第 7 步）"                  $fxPhone  'PHONE-REDACTED'               '\b1[3-9][0-9]{9}\b'

# 第 8 步（内网 IP）：开关的**旧名与规范名都显式设**——使本组断言对「读取面改读规范名」的
# 修正不敏感；且必须显式设：默认值是 true，「不设」等于开，会把「关」的方向测成假绿。
$oldSanLegacy = $env:SOFA_SANITIZE_IPS
$oldSanCanon = $env:SOFAGENT_SANITIZE_IPS
$env:SOFA_SANITIZE_IPS = 'true'
$env:SOFAGENT_SANITIZE_IPS = 'true'
foreach ($ip in @('10.0.0.5', '172.16.5.9', '172.31.255.254', '192.168.1.1')) {
    Assert-Sanitized "内网 IP 打码（第 8 步 $ip）" "内网地址 $ip 已记录" $tkIp ([regex]::Escape($ip))
}
# 误伤负控：172.32.5.9 超出 172.16–31 网段、11.22.33.44 是公网地址，都不该被打码
foreach ($ip in @('172.32.5.9', '11.22.33.44')) {
    Assert-Passthrough "非 RFC1918 地址 $ip" "非内网地址 $ip 已记录" $tkIpRe $ip
}
# 关闭方向：开关必须真的关得掉（旧名默认 true 曾把规范名的 false 压过 ⇒ 死键）
$env:SOFA_SANITIZE_IPS = 'false'
$env:SOFAGENT_SANITIZE_IPS = 'false'
Assert-Passthrough "开关关闭时的内网 IP（10.0.0.5）" "内网地址 10.0.0.5 已记录" $tkIpRe '10.0.0.5'
# 复原（不能把 false 留给后续检查与子进程）
if ($null -eq $oldSanLegacy) { Remove-Item Env:\SOFA_SANITIZE_IPS -ErrorAction SilentlyContinue } else { $env:SOFA_SANITIZE_IPS = $oldSanLegacy }
if ($null -eq $oldSanCanon) { Remove-Item Env:\SOFAGENT_SANITIZE_IPS -ErrorAction SilentlyContinue } else { $env:SOFAGENT_SANITIZE_IPS = $oldSanCanon }

# 误伤负控：11 位订单号（非 1[3-9] 开头）与 monkey=foo（词边界）都不该被打码
Assert-Passthrough "11 位订单号（非 1[3-9] 开头）" $fxOrder  'PHONE-REDACTED' '28012345678'
Assert-Passthrough "词边界保护（monkey=foo）"      $fxMonkey 'REDACTED'       'monkey=foo'
# 无敏感信息文本必须原样通过（不做无差别打码）
$fxPlainOut = $null
if ($script:sanitizeReady) { $fxPlainOut = Invoke-Sanitize $fxPlain }
if ($null -ne $fxPlainOut -and $fxPlainOut -eq $fxPlain) { Check-Pass "脱敏: 无敏感信息文本原样通过" } else { Check-Warn "脱敏: 无敏感信息文本被修改" }

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
    foreach ($key in @("log_sanitize", "log_sanitize_ips", "data_retention_days", "data_retention_max_entries", "data_cleanup_frequency", "audit_enabled")) {
        if ($rulesCfgContent -notmatch "${key}:") { $missing++ }
    }
    if ($missing -eq 0) { Check-Pass "fde.md 合规配置段完整（6/6 配置项）" } else { Check-Warn "fde.md 合规配置段不完整（缺少 $missing/6 项）" }
} else { Check-Warn "fde.md 未找到，无法验证合规配置段" }

# ════════ 总结 ════════
Write-Summary
exit $(if ($script:fail -gt 0) { 1 } else { 0 })
