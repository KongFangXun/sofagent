# ============================================================
# sofagent lib/daemon-lib.ps1 · daemon 共享函数库 (Windows PowerShell)
# ============================================================
# daemon-lib.sh 的原生 Windows 移植。被 daemon.ps1 / daemon-status.ps1 共用。
# JSON 用原生 ConvertFrom/To-Json（比 .sh 的 grep/sed 干净）；进程用 Get-Process。
# 调用方需先设 $DAEMON_JSON / $DAEMON_LOG / $DAEMON_PID_FILE。
# ============================================================

$utf8NoBomLib = New-Object System.Text.UTF8Encoding $false

# ── JSON 读写（原生）──
function Get-DaemonJson {
    if (-not (Test-Path $script:DAEMON_JSON)) { return $null }
    try { return (Get-Content $script:DAEMON_JSON -Raw -Encoding UTF8 -EA Stop | ConvertFrom-Json) } catch { return $null }
}
function Set-DaemonJson($obj) {
    [System.IO.File]::WriteAllText($script:DAEMON_JSON, ($obj | ConvertTo-Json -Depth 5), $utf8NoBomLib)
}
function Get-JsonField($key) {
    $o = Get-DaemonJson
    if ($null -eq $o) { return "" }
    $v = $o.$key
    if ($null -eq $v) { return "" } else { return $v }
}

# ── 文件 hash（SHA-256 前 16）──
function Get-FileHash16($file) {
    if (-not [string]::IsNullOrEmpty($file) -and (Test-Path $file)) {
        try { return (Get-FileHash $file -Algorithm SHA256).Hash.ToLower().Substring(0, 16) } catch { return "" }
    }
    return ""
}

# ── 进程检测（替 pgrep）──
function Get-DetectedPlatforms {
    $found = @()
    foreach ($p in @(@("openclaw", "openclaw"), @("workbuddy", "workbuddy"), @("claude", "claude"), @("codex", "codex"), @("hermes", "hermes"))) {
        if (Get-Process -Name "*$($p[0])*" -ErrorAction SilentlyContinue) { $found += $p[1] }
    }
    return ($found -join " ")
}

# ── 日志 ──
function Write-DaemonLog($msg) {
    $now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    # PS 5.1 Add-Content -Encoding UTF8 写 BOM，改用 .NET API 追加 UTF-8 无 BOM
    try { [System.IO.File]::AppendAllText($script:DAEMON_LOG, "[$now] $msg`n", $utf8NoBomLib) } catch {}
}

# ── PID 管理 ──
function Get-DaemonPid {
    if (Test-Path $script:DAEMON_PID_FILE) {
        try { return (Get-Content $script:DAEMON_PID_FILE -Raw -Encoding ASCII -EA SilentlyContinue).Trim() } catch { return "" }
    }
    return ""
}
function Test-DaemonRunning {
    $p = Get-DaemonPid
    if ([string]::IsNullOrEmpty($p)) { return $false }
    return [bool](Get-Process -Id ([int]$p) -ErrorAction SilentlyContinue)
}
