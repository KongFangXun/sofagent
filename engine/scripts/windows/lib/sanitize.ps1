# ============================================================
# sofagent lib/sanitize.ps1 · 日志脱敏函数共享库（单一真相源 · Windows 侧）
# ============================================================
# 与 engine/scripts/lib/sanitize.sh **逐条对齐**的 8 步语义（顺序、规则宽度、开关读取面）。
# 对齐基准是那份 .sh —— 它在 macOS/Linux 上已实跑验证过；两处规则宽窄差异见第 6 步注释。
#
# 为什么抽成 lib（而不是各脚本各留一份）：
#   verify.ps1 曾持一份**手抄副本**（只有第 1/5/7 三步，缺第 8 步内网 IP 与
#   Bearer/JWT/AWS/PEM），task-record.ps1 另持一份 8 步版 —— 与 shell 侧 8ed9042c
#   修掉的「副本漂移」**逐字同型**：副本缺步骤 ⇒ 真身坏了测试不知道，且两侧默认值不同
#   ⇒ 「同一函数、两种行为」。故合并为单一真相源，任何脱敏规则只在本文件改一次。
#
# 用法：. "$PSScriptRoot\lib\sanitize.ps1"
#   （调用方：task-record.ps1 写入前 / verify.ps1 自测；两者都 dot-source 本文件、
#     不保留任何本地实现）
# 导出：Invoke-Sanitize([string]$Text) -> [string]
#
# ⚠️ 与 shell 侧**唯一**的刻意差异：词边界直接用 `\b`。
#   shell 侧需要 `_WB_L`/`_WB_R` 探测，是因为 BSD sed 的 `\b` 是**静默空操作**
#   （不报错也不匹配 ⇒ 整条替换变 no-op）；.NET 正则原生支持 `\b`，不存在该平台差异
#   ⇒ 那套探测是 sed 的补丁，搬到 .NET 上没有对应物（照搬反而会引入 `[[:<:]]` 这个
#   .NET 不认的 POSIX 类）。**不要把探测"为了两边一致"抄过来。**
# ============================================================

function Get-SanitizeIpsEnabled {
    # 第 8 步开关的读取面，三层语义与 shell 侧逐条对齐：
    #   ① 规范名优先 + 旧名兜底：config.sh:170 / config.ps1 会把旧名回填，若只读旧名，
    #      用户设 SOFAGENT_SANITIZE_IPS=false 会被压过 ⇒ **关不掉**（#28 死键，shell 侧
    #      已修，本侧是同一处未对齐的镜像）。
    #   ② 缺省开启：shell 侧 config.sh:168 `SOFA_SANITIZE_IPS="${SOFA_SANITIZE_IPS:-true}"`
    #      ⇒ fde.md 不含该键时默认 true。实测 SKILL/harness/fde-template.md:90 的
    #      `# log_sanitize_ips: false` 是**注释掉的**（解析器只认 `^key:`）⇒ 该键永远
    #      解析不到 ⇒ 「缺省」就是真实生效路径，默认值必须在这里兜住，否则 Windows 侧
    #      会静默变成「默认不脱敏内网 IP」——比 shell 侧弱一整个方向。
    #   ③ 大小写：用 PS 原生 `-eq`（不区分大小写）。与 shell 的严格 `=` 相比只会让
    #      `True` 这类写法**多**脱敏、不会少脱敏（宽口径方向安全）。
    $canon = $env:SOFAGENT_SANITIZE_IPS
    $legacy = $env:SOFA_SANITIZE_IPS
    if (-not [string]::IsNullOrEmpty($canon)) { return ($canon -eq 'true') }
    if (-not [string]::IsNullOrEmpty($legacy)) { return ($legacy -eq 'true') }
    return $true
}

# ── 脱敏函数 ──
# 优先级（不可调换，前一步的产物可能被后一步继续匹配）：
#   API Key > Bearer Token > JWT > AWS Key > 凭证赋值 > 私钥 > 手机号 > 内网 IP
function Invoke-Sanitize([string]$Text) {
    if ([string]::IsNullOrEmpty($Text)) { return $Text }
    $s = $Text
    # 1. OpenAI / Anthropic API Key
    $s = $s -replace 'sk-(ant(-api)?-)?[a-zA-Z0-9_-]{20,}', 'sk-***REDACTED***'
    # 2. Bearer token
    $s = $s -replace 'Bearer +[a-zA-Z0-9._~+/-]+=*', 'Bearer ***REDACTED***'
    # 3. JWT token（eyJ 开头的 base64url 三段式）
    $s = $s -replace 'eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+', '***JWT-REDACTED***'
    # 4. AWS Access Key（AKIA 开头，20 字符）
    $s = $s -replace '\bAKIA[0-9A-Z]{16}\b', '***AWS-KEY-REDACTED***'
    # 5. 凭证赋值（password= / token= / secret= / api_key= / key=）
    #    词边界 `\b` 保护 monkey=foo 这类普通标识符（与 shell 侧第 5 步同判据）
    $s = $s -replace '\b(password|token|secret|api_key|key)[=:]\s*[^ ]+', '$1=***REDACTED***'
    # 6. 私钥块（PEM 格式：-----BEGIN ... PRIVATE KEY----- ... -----END）
    #    ⚠️ 与 shell 侧的**唯一规则形态差异**，刻意的：shell 用 sed 的**行范围**替换
    #    （`/BEGIN/,/END/{ s/BEGIN 行/标记/; /BEGIN/d; /END/d }`），.NET 用单行模式整块
    #    替换。多行 PEM 下两者不等价：sed 那套会把 END 行删掉、**留下中间的 base64 主体**
    #    （真密钥内容原样落盘）；本实现 `(?s)….*?` 跨行吞掉整块 ⇒ 无残留。本侧更严，
    #    故保留 .NET 形态，不回退成行范围语义。
    $s = $s -replace '(?s)-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----', '***PRIVATE-KEY-BLOCK-REDACTED***'
    # 7. 中国大陆手机号（1[3-9] 开头 + 9 位数字，共 11 位）
    #    加词边界，避免误伤订单号、时间戳等长数字串
    $s = $s -replace '\b1[3-9][0-9]{9}\b', '[PHONE-REDACTED]'
    # 8. 内网 IP（可选，开关见 Get-SanitizeIpsEnabled）
    #    RFC1918 三段网段在「网段前缀」之后剩余段数不同，必须**逐支写全**：
    #      10.           → 剩三段 x.y.z
    #      172.16–31.    → 剩两段 x.y
    #      192.168.      → 剩两段 x.y
    #    🔴 写成单条 `前缀 + [0-9]+\.[0-9]+`（旧实现就是单条交替
    #      `\b(10\.|172\.(…)|192\.168\.)[0-9]+\.[0-9]+\b`）会让 10. 支只吃两段：
    #      `10.0.0.5` → `[INTERNAL_IP].5`——残留的末段恰是主机号、信息量最大的那一段。
    #      shell 侧在 lib/sanitize.sh:51-57 明文警告过这条写法（macOS 已实跑验证）。
    #      反之若给全支统一补一段，172./192. 两支会变成需要三段而永久漏匹配。
    if (Get-SanitizeIpsEnabled) {
        $s = $s -replace '\b10\.[0-9]+\.[0-9]+\.[0-9]+\b', '[INTERNAL_IP]'
        $s = $s -replace '\b172\.(1[6-9]|2[0-9]|3[01])\.[0-9]+\.[0-9]+\b', '[INTERNAL_IP]'
        $s = $s -replace '\b192\.168\.[0-9]+\.[0-9]+\b', '[INTERNAL_IP]'
    }
    return $s
}
