# 测试环境与编码记录

> 本机实测过的环境、版本，以及踩过的编码/换行坑。供跨平台脚本（install.ps1 / uninstall.ps1 /
> verify.sh / 自检脚本）开发与排查参考。记录时间：2026-06（fork 维护）。

## 一、已测试环境矩阵

宿主：**Windows 11**（build 10.0-26200，中文版）。

| 环境 | 版本 | 解释器 | 关键工具 | 已实测 |
|------|------|--------|---------|--------|
| MSYS2 / Git Bash | MINGW64 | bash 5.3.9 | GNU coreutils **8.32**（stat 8.32 / sha256sum / shasum=perl） | ✅ 自检 4/0 |
| WSL Ubuntu | 24.04.1 LTS | bash | GNU coreutils **9.4**（shasum + sha256sum 均有） | ✅ 自检 4/0 |
| Windows PowerShell | **5.1**（`powershell.exe`） | — | — | ✅ install/uninstall 部署循环 PASS |
| Docker（rancher-desktop） | 29.1.4-rd | — | Alpine（busybox，真·无 shasum） | ⏳ 引擎未启动，待补 |

辅助工具版本：git 2.54.0.windows.1、curl 8.19.0（**Schannel** TLS 后端）、python 3.12.10、
node v24.15.0 / npm 11.12.1、gh 2.95.0。jq **未装**（脚本里用 python 替代解析 JSON）。

### 实测结论
- `check-portability.sh`（PR#1 两修复）：MSYS2(GNU 8.32) + WSL Ubuntu 24.04(GNU 9.4) 均 **4/0**，slug 跨平台一致。
- `install.ps1` / `uninstall.ps1`：沙箱（临时 USERPROFILE）部署循环 install→uninstall→reinstall **PASS**，卸载正确保留 `.sofagent/` 数据。
- 缺口：Alpine（真·无 shasum）需启动 docker 引擎后用 `run-envs.sh` 补跑。

## 二、编码与换行坑（重要，已踩过）

### 1. PowerShell `.ps1` 必须 UTF-8 **带 BOM**
- **现象**：Windows PowerShell 5.1 读**无 BOM** 的 UTF-8 脚本时，按系统 ANSI 代码页（中文 Windows = **GBK**）解析 → 中文乱码、字符串提前截断、`解析报错`（Unexpected token / Missing closing quote）。
- **规则**：含中文的 `.ps1` 一律存 **UTF-8 with BOM**（前 3 字节 `EF BB BF`）。
- **正确加 BOM 写法**：
  ```powershell
  [System.IO.File]::WriteAllText($p, $c, (New-Object System.Text.UTF8Encoding $true))
  ```

### 2. 转 BOM 时，读取**必须显式 `-Encoding UTF8`**
- **本次踩坑**：用 `Get-Content -Raw`（不带 `-Encoding`）读一个**无 BOM** 的 UTF-8 文件，5.1 默认按 GBK 误读 → 中文变 `鍗歌浇`/`涓枃` 这类 mojibake，再写回直接把文件读坏。
- **正确**：`Get-Content -Raw -Encoding UTF8 $p`。
- **例外**：原文件是 **UTF-16 BOM** 时，`Get-Content -Raw`（不带 `-Encoding`）能靠 BOM 自动识别、正确读入（install.ps1 第一次从 UTF-16 转 UTF-8 即此情形，所以那次没坏）。

### 3. `.gitattributes` 锁换行（已落地）
```
*.sh  *.bash          text eol=lf      # Linux/Alpine/WSL 跑 shell 必须 LF
*.ps1 *.bat *.cmd     text eol=crlf    # Windows 脚本
```
- **背景**：仓库 `core.autocrlf=true` 且原本无 `.gitattributes` → checkout 会把 `*.sh` 变 CRLF → 在 Linux/Alpine/WSL 里 `bad interpreter: /bin/sh^M` 直接跑不了。

### 4. `wsl.exe` 输出是 UTF-16LE
- **现象**：`wsl.exe ... cmd` 的 stdout 是 UTF-16LE，Git Bash 里直接管道/`grep` 会乱码、或被当成 “Binary file matches”。
- **解法**：让重定向**在 WSL 内部**完成，输出文件即 UTF-8：
  ```bash
  wsl.exe -d Ubuntu sh -c "sh /mnt/c/.../check.sh > /mnt/c/.../out.txt 2>&1"
  cat /c/.../out.txt   # UTF-8，干净
  ```

### 5. MSYS 路径转换（调 `wsl.exe` / native exe 时）
- **现象**：Git Bash 调 `wsl.exe` 时会把 `/tmp/x` 这类 `/unix/路径` 误转成 Windows 路径，导致 WSL 里 `No such file`。
- **解法**：`export MSYS2_ARG_CONV_EXCL='*'`（或 `MSYS_NO_PATHCONV=1`）禁用转换。

## 三、Windows 安装器实测发现的 bug（`feat/windows-installer`）

| # | bug | 影响 | 修复 |
|---|-----|------|------|
| 1 | install.ps1/install.sh 用 **`WSLENV`** 判 WSL | `WSLENV`（如 `WT_SESSION:`）在装了 WSL 的 Windows 主机上**本就有** → 脚本在 Windows 上误判为 WSL **直接拒跑** | 只认 `WSL_DISTRO_NAME` |
| 2 | install.ps1 rules.md 用旧路径 `constitution\rules.md` | v0.73 已扁平化到 `sofagent\rules.md` → **宪法部署失败** | 新路径优先 + 旧路径 fallback |

两者均由**沙箱实测**逐轮跑出来，修复后部署循环全过。

## 四、Shell→PowerShell 全面移植（`feat/windows-installer`）

把运行时 shell 脚本全量移植为原生 Windows PowerShell（纯 PowerShell + 非 WSL 可跑）。

### 已移植（**16 个 .ps1，100% 覆盖**，均实测对照 .sh）
`install` `uninstall` `task-record`（反思闭环）`audit` `lib/config` `task-orchestrate`（ao 包装）
`verify` `cleanup` `compress-memory` `verify-evidence` `benchmark`（A/B 题库 + audit-log 客观判定）
`daemon` `daemon-install` `daemon-status` `daemon-uninstall` `lib/daemon-lib`。
**全部 .sh（14）+ 2 lib 均有对应 .ps1，无遗漏。**

> daemon 系列特别说明：bash 版**明确拒绝在非 Unix 运行**；PS 版**反过来支持 Windows**——
> Get-Process 替 pgrep、Start-Process 替 nohup、Register-ScheduledTask 替 launchd/systemd、
> 原生 ConvertFrom/To-Json 替 grep/sed。实测主循环检测到真实 workbuddy/claude 进程。
> 计划任务注册需管理员权限（否则 try/catch 降级 + 直接启动）。

### Skill dispatch
SKILL.md（第 1 层永远注入）加「跨平台脚本调用约定」：`bash X.sh --flag` 在纯 Windows PowerShell
改 `powershell -File X.ps1 -Flag`（kebab→Pascal）。install.ps1 部署 .ps1 到 `$TARGET\scripts\`。
E2E 实测：install→部署7脚本→用部署后的 task-record.ps1 跑闭环→uninstall，纯 PowerShell 全过。

### PowerShell 移植踩坑全集（写 .ps1 必看）
1. **脚本编码**：含中文 .ps1 必须 **UTF-8 BOM**（PS 5.1 读无 BOM 按 GBK 解析、乱码/解析错）。
2. **加 BOM 时读取**须 `Get-Content -Raw -Encoding UTF8`（不指定→GBK 误读、直接读坏文件）。
3. **控制台输出**：脚本顶部加 `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false`，
   否则输出按 OEM/GBK 编码，被 UTF-8 消费方（Agent/Git Bash）读到乱码。机器可读前缀（ASCII）不受影响。
4. **`if` 表达式不能直接作函数参数**：`f (if(){}else{})` 运行时崩 → 先 `$x = if...` 再传。
5. **`switch` 无 `break` 执行所有匹配 case**：兜底 `^-` 会误伤每个 flag → 用 if/elseif 链。
6. **函数前向引用**：PS 顺序解释，函数定义须在调用之前（Write-Summary 被前置段调用就得提前定义）。
7. **单元素嵌套数组 `@(@(...))` 被摊平**成一维 → `foreach` 遍历到字符、`$x[0]` 取首字符。多元素不摊平。
8. **日志/数据文件写 UTF-8 无 BOM**：用 `[IO.File]::WriteAllText/AppendAllText($p,$s,(New-Object Text.UTF8Encoding $false))`，对齐 .sh，且 BOM 会污染追加。
9. **`.gitattributes`** 锁 `*.ps1=CRLF` / `*.sh=LF`。

### 移植中顺带发现的 .sh bug（候选独立 PR）
- `task-record.sh` 的 `sanitize()` 用 BSD 专属词边界 `[[:<:]]`，**GNU sed 4.9 报 `Invalid character class`** →
  AWS密钥/凭证/手机/IP 4 条脱敏在 Linux 上失效。ps1 用 `\b` 修对。
- `stat -f %m`（BSD）在 GNU 上是 `--file-system`、取不到 mtime（已在 PR #1 修）。
