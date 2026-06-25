# ============================================================
# sofagent skill-safety-check.ps1 · Skill 安全审查 (PowerShell)
# ============================================================
# skill-safety-check.sh 的原生 Windows 移植。22 条正则快筛，零外部依赖。
#
# 用法：
#   skill-safety-check.ps1 <file-or-dir>
#   skill-safety-check.ps1 -Json <path>
#   skill-safety-check.ps1 -Quiet <path>
#
# 退出码：0=SAFE  1=DANGEROUS  2=SUSPICIOUS
# ============================================================

param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Rest = @(),
    [switch]$Json,
    [switch]$Quiet,
    [switch]$Help,
    [switch]$Version
)

$ErrorActionPreference = "Continue"
$VERSION_STR = "0.91"
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}

if ($Help) {
    Write-Host "sofagent skill-safety-check.ps1 v$VERSION_STR"
    Write-Host "  <path>   扫描文件或目录"
    Write-Host "  -Json    JSON 输出（CI/CD）"
    Write-Host "  -Quiet   仅输出 verdict"
    exit 0
}
if ($Version) { Write-Host "skill-safety-check.ps1 v$VERSION_STR"; exit 0 }

$OutputMode = if ($Json) { "json" } elseif ($Quiet) { "quiet" } else { "terminal" }
$Target = ($Rest | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1)

if ([string]::IsNullOrEmpty($Target)) {
    Write-Host "错误：缺少扫描目标。用法：skill-safety-check.ps1 <file-or-dir>" -ForegroundColor Red
    exit 2
}
if (-not (Test-Path $Target)) {
    Write-Host "错误：目标不存在：$Target" -ForegroundColor Red
    exit 2
}

$Rules = @(
    @{ Pattern = "(^|[^a-zA-Z0-9_])rm\s+-rf\s+/"; Category = "malicious"; Severity = "DANGEROUS"; Description = "rm -rf /" }
    @{ Pattern = "curl.*\|.*bash"; Category = "malicious"; Severity = "DANGEROUS"; Description = "curl pipe bash" }
    @{ Pattern = "curl.*\|.*sh\("; Category = "malicious"; Severity = "DANGEROUS"; Description = "curl pipe sh" }
    @{ Pattern = "wget.*\|.*sh"; Category = "malicious"; Severity = "DANGEROUS"; Description = "wget pipe sh" }
    @{ Pattern = "wget.*\|.*bash"; Category = "malicious"; Severity = "DANGEROUS"; Description = "wget pipe bash" }
    @{ Pattern = "chmod\s+777\s+/"; Category = "malicious"; Severity = "DANGEROUS"; Description = "chmod 777 /" }
    @{ Pattern = "mkfs\."; Category = "malicious"; Severity = "DANGEROUS"; Description = "mkfs" }
    @{ Pattern = "dd\s+if=.*of=/dev/"; Category = "malicious"; Severity = "DANGEROUS"; Description = "dd overwrite" }
    @{ Pattern = "AKIA[0-9A-Z]{16}"; Category = "secret"; Severity = "DANGEROUS"; Description = "AWS Access Key" }
    @{ Pattern = "sk-[a-zA-Z0-9]{20,}"; Category = "secret"; Severity = "DANGEROUS"; Description = "OpenAI API Key" }
    @{ Pattern = "gh[pousr]_[A-Za-z0-9]{36}"; Category = "secret"; Severity = "DANGEROUS"; Description = "GitHub Token" }
    @{ Pattern = "-----BEGIN.*PRIVATE KEY-----"; Category = "secret"; Severity = "DANGEROUS"; Description = "PEM private key" }
    @{ Pattern = "eval\(.*[^0-9`"'`"].*\)"; Category = "dangerous-call"; Severity = "SUSPICIOUS"; Description = "eval non-literal" }
    @{ Pattern = "os\.system\("; Category = "dangerous-call"; Severity = "SUSPICIOUS"; Description = "os.system()" }
    @{ Pattern = "child_process\.exec"; Category = "dangerous-call"; Severity = "SUSPICIOUS"; Description = "child_process.exec" }
    @{ Pattern = "subprocess\.call"; Category = "dangerous-call"; Severity = "SUSPICIOUS"; Description = "subprocess.call" }
    @{ Pattern = "new\s+Function\("; Category = "dangerous-call"; Severity = "SUSPICIOUS"; Description = "new Function()" }
    @{ Pattern = "(^|[^a-zA-Z])(ignore|forget|disregard)\s+(previous|all|above)\s+(instructions|prompts|rules)"; Category = "injection"; Severity = "SUSPICIOUS"; Description = "ignore previous instructions" }
    @{ Pattern = "webhook\.site|requestbin|pipedream"; Category = "injection"; Severity = "SUSPICIOUS"; Description = "exfil endpoint" }
    @{ Pattern = "base64\s+.*decode"; Category = "obfuscation"; Severity = "SUSPICIOUS"; Description = "base64 decode" }
    @{ Pattern = "eval\(atob\("; Category = "obfuscation"; Severity = "DANGEROUS"; Description = "eval(atob())" }
)

function Get-ScanFiles($path) {
    if (Test-Path $path -PathType Leaf) { return @((Resolve-Path $path).Path) }
    $exts = @('*.md', '*.js', '*.ts', '*.py', '*.sh', '*.ps1', '*.json', '*.yaml', '*.yml')
    $files = @()
    foreach ($e in $exts) {
        $files += Get-ChildItem -Path $path -Filter $e -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }
    }
    return $files | Select-Object -Unique
}

function Scan-File($file) {
    $hits = @()
    $lines = Get-Content $file -Encoding UTF8 -ErrorAction SilentlyContinue
    if ($null -eq $lines) { return @() }
    $i = 0
    foreach ($line in $lines) {
        $i++
        foreach ($rule in $Rules) {
            if ($line -match $rule.Pattern) {
                $hits += [pscustomobject]@{
                    File = $file; Line = $i; Category = $rule.Category
                    Severity = $rule.Severity; Description = $rule.Description
                }
            }
        }
    }
    return $hits
}

$scanTime = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$files = Get-ScanFiles $Target
$results = @()
$safeCount = 0; $dangerousCount = 0; $suspiciousCount = 0
$overallVerdict = "SAFE"

foreach ($f in $files) {
    $hits = Scan-File $f
    if ($hits.Count -eq 0) {
        $verdict = "SAFE"; $safeCount++
        if ($OutputMode -eq "terminal") { Write-Host "  [OK] SAFE — $f" -ForegroundColor Green }
    } else {
        $hasDanger = [bool]($hits | Where-Object { $_.Severity -eq "DANGEROUS" })
        if ($hasDanger) {
            $verdict = "DANGEROUS"; $dangerousCount++; $overallVerdict = "DANGEROUS"
        } else {
            $verdict = "SUSPICIOUS"; $suspiciousCount++
            if ($overallVerdict -ne "DANGEROUS") { $overallVerdict = "SUSPICIOUS" }
        }
        if ($OutputMode -eq "terminal") {
            $color = if ($verdict -eq "DANGEROUS") { "Red" } else { "Yellow" }
            Write-Host "  [X] $verdict — $f ($($hits.Count) hits)" -ForegroundColor $color
            foreach ($h in $hits) {
                $icon = if ($h.Severity -eq "DANGEROUS") { "X" } else { "!" }
                Write-Host "    L$($h.Line): [$icon] $($h.Category) — $($h.Description)" -ForegroundColor $color
            }
        }
    }
    $hitJson = @($hits | ForEach-Object {
        @{ line = $_.Line; category = $_.Category; severity = $_.Severity; description = $_.Description }
    })
    $results += @{ file = $f; verdict = $verdict; hits = $hitJson }
}

$exitCode = switch ($overallVerdict) { "DANGEROUS" { 1 } "SUSPICIOUS" { 2 } default { 0 } }

if ($OutputMode -eq "json") {
    $obj = @{
        version = $VERSION_STR; scanned_at = $scanTime; files_scanned = $files.Count
        verdict = $overallVerdict; exit_code = $exitCode; results = $results
    }
    Write-Host ($obj | ConvertTo-Json -Depth 6 -Compress)
} elseif ($OutputMode -eq "quiet") {
    Write-Host $overallVerdict
} else {
    Write-Host ""
    Write-Host "[sofagent] Skill 安全审查 · 扫描 $($files.Count) 个文件"
    Write-Host "  结果: $safeCount SAFE / $dangerousCount DANGEROUS / $suspiciousCount SUSPICIOUS"
    Write-Host "  退出码: $exitCode ($overallVerdict)"
    Write-Host ""
}

exit $exitCode
