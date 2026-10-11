# ============================================================
# sofagent lib/config.ps1 · 企业合规共享配置加载器 (PowerShell)
# ============================================================
# config.sh 的原生 Windows 移植。从 fde.md 提取合规配置，设为 $env:SOFA_*。
# 用法（在其他 .ps1 顶部 dot-source）：
#   $cfg = Join-Path $PSScriptRoot "lib\config.ps1"; if (Test-Path $cfg) { . $cfg }
#
# 导出：$env:SOFAGENT_DATA + $env:SOFA_*（对齐 config.sh v0.90 P0-3）
# ============================================================

function Find-SofaDataDir {
    # 1. 环境变量显式指定
    if (-not [string]::IsNullOrEmpty($env:SOFAGENT_DATA) -and (Test-Path $env:SOFAGENT_DATA)) {
        return $env:SOFAGENT_DATA
    }

    # 2. 当前工作目录有 .sofagent/
    $cwdData = Join-Path (Get-Location).Path ".sofagent"
    if (Test-Path $cwdData) { return $cwdData }

    # 3. 安装时写入的数据目录标记（install.ps1 -ProjectDir 时写入）
    $up = $env:USERPROFILE
    foreach ($marker in @(
        "$up\.openclaw\skills\sofagent\.sofagent-data-path",
        "$up\.workbuddy\skills\sofagent\.sofagent-data-path"
    )) {
        if (Test-Path $marker) {
            $dataPath = (Get-Content $marker -Encoding UTF8 -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
            if (-not [string]::IsNullOrEmpty($dataPath) -and (Test-Path $dataPath)) { return $dataPath }
        }
    }

    # 4. fallback：当前目录（即使不存在也返回，让调用方决定是否创建）
    return $cwdData
}

function Find-SofaRulesFile {
    $sofagentRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
    $up = $env:USERPROFILE
    $candidates = @(
        (Join-Path (Get-Location).Path "sofagent\skill\fde.md"),
        (Join-Path $sofagentRoot "skill\fde.md"),
        "$up\.openclaw\skills\sofagent\fde.md",
        "$up\.openclaw\fde.md",
        "$up\.openclaw\skills\sofagent\constitution\fde.md",
        "$up\.workbuddy\fde.md"
    )
    foreach ($c in $candidates) {
        if (-not [string]::IsNullOrEmpty($c) -and (Test-Path $c)) { return $c }
    }
    return $null
}

function Get-SofaConf($key, $default) {
    if ([string]::IsNullOrEmpty($script:SofaRulesFile)) { return $default }
    $m = Get-Content $script:SofaRulesFile -Encoding UTF8 -ErrorAction SilentlyContinue | Select-String -Pattern "^${key}:" | Select-Object -First 1
    if ($m) {
        return ($m.Line -replace "^[^:]+:\s*", "" -replace "\s+$", "")
    }
    return $default
}

$script:SofaRulesFile = Find-SofaRulesFile
$env:SOFAGENT_DATA = Find-SofaDataDir

# v0.90 P0-3 连带修复：fde.md 无匹配时保留已有环境变量
# v1.5.1 W 批（对齐 config.sh:153-171 的两层语义——此前 Windows 侧两层齐缺）：
#   ① **默认开启**（P1-16 口径：数据主权产品的脱敏不应是 opt-in）。缺这层实测后果：
#      SKILL/harness/fde-template.md:89-90 的两个键是**注释掉的**（解析器只认 `^key:`）
#      ⇒ 永远解析不到 ⇒ $env:SOFA_SANITIZE 保持 $null ⇒ task-record.ps1 的开关判定为假
#      ⇒ **Windows 侧默认一条都不脱敏**（shell 侧 config.sh:158/168 的 `:-true` 兜住）。
#   ② **规范名回填**（`SOFAGENT_*` ← `SOFA_*`），与 config.sh:160/170 同款；缺这层时
#      规范名无从诞生（用户只设规范名仍可被旧名压过 ⇒ #28 死键的 Windows 侧镜像）。
# ⚠️ 语义与 config.sh 逐条一致：fde.md 有键则用键值；无键则保留已有环境变量；再无则默认 true。
$env:SOFA_SANITIZE = Get-SofaConf "log_sanitize" $(if ($env:SOFA_SANITIZE) { $env:SOFA_SANITIZE } else { "true" })
if ([string]::IsNullOrEmpty($env:SOFAGENT_SANITIZE)) { $env:SOFAGENT_SANITIZE = $env:SOFA_SANITIZE }

$env:SOFA_SANITIZE_IPS = Get-SofaConf "log_sanitize_ips" $(if ($env:SOFA_SANITIZE_IPS) { $env:SOFA_SANITIZE_IPS } else { "true" })
if ([string]::IsNullOrEmpty($env:SOFAGENT_SANITIZE_IPS)) { $env:SOFAGENT_SANITIZE_IPS = $env:SOFA_SANITIZE_IPS }

$env:SOFA_RETENTION_DAYS = Get-SofaConf "data_retention_days" $(if ($env:SOFA_RETENTION_DAYS) { $env:SOFA_RETENTION_DAYS } else { "90" })
$env:SOFA_RETENTION_MAX = Get-SofaConf "data_retention_max_entries" $(if ($env:SOFA_RETENTION_MAX) { $env:SOFA_RETENTION_MAX } else { "500" })

# （data_cleanup_on_record 解析已随 v1.5.0 死配置清扫移除）

$env:SOFA_CLEANUP_FREQUENCY = Get-SofaConf "data_cleanup_frequency" $(if ($env:SOFA_CLEANUP_FREQUENCY) { $env:SOFA_CLEANUP_FREQUENCY } else { "10" })

$parsed = Get-SofaConf "audit_enabled" ""
if (-not [string]::IsNullOrEmpty($parsed)) { $env:SOFA_AUDIT_ENABLED = $parsed }
