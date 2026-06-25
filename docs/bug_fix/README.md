# 确定性修复记录（fork 专用）

> 本目录是 **HyperGroups fork 自有记录**，只存在于 fork 仓库的镜像分支（`KongFangXun`，原名 `upstream`，
> 已改名以消除与 remote `upstream` 的歧义），**不向上游提 PR**。向上游贡献时从 `upstream/main`
> 另切干净的 `fix/xxx` 主题分支，只带代码改动，不带本目录。
>
> 与 `issues/`（gitignored，本地审计草稿）的分工：
> - `issues/` —— 原始发现台账，本地保留，不进版本库。
> - `docs/bug_fix/` —— 已确认的**确定性** bug + 复现 + 修复，提交到 fork，按拟提的主题分支分组。

「确定性」= 100% 可复现、与模型能力无关的脚本 bug（区别于 `docs/anti-cases/` 记录的模型行为问题）。

## 工作流

1. 在镜像分支（`KongFangXun`）按自己的方式修问题、记录到本目录、打 tag 标记。
2. 真要回贡上游时，从最新 `upstream/main` 切 `fix/xxx` 主题分支，把对应那一组修复做成**原子提交**。
3. 按作者规矩（CONTRIBUTING.md + PR 模板）走：`verify.sh` 全过 → 部署循环 → 非 OpenClaw 平台测试。
4. 先推到自己 fork（`origin`）的主题分支，再从该分支开 PR 到上游 `KongFangXun:main`。

> **PR 创建方式（实测）**：本机终端到 GitHub 的 HTTPS 被墙、只有 SSH 通；`gh` 用 PAT
> 建 PR 一律被拒（`Resource not accessible by personal access token`，三种 token 都试过，
> 疑账号级限制/邮箱未验证）。**改用浏览器会话开 PR 成功**——`git push`（SSH）推分支，
> 再去上游 Pull requests 页点 "recently pushed branches" 黄条的 *Compare & pull request*。

## 提交状态

| 主题分支 | 覆盖的 bug | 状态 |
|---------|-----------|------|
| `fix/cross-platform-portability` | shasum 回退、stat GNU/BSD | ✅ **已提 [PR #1](https://github.com/KongFangXun/sofagent/pull/1)**（OPEN，待作者 review） |
| `fix/set-e-premature-exit` | set -e 提前退出（3 处） | ⏳ 待提（等 #1 反馈后） |
| `fix/arg-parsing-shift` | verify/uninstall 参数解析 | ⏳ 待提 |
| `fix/numeric-and-unbound-guards` | 除零 / grep -c 双 0 / set -u | ⏳ 待提 |

> 策略：单人维护者，不一次性砸多个 PR。先用 #1（作者点名最缺的跨平台兼容）走通流程、摸清接受口味，再逐个发。

## 拟分组（= 拟提的主题分支）

相对最新 `upstream/main`（含 v0.82）的净改动，按主题归为 4 个主题分支：

### 1. `fix/set-e-premature-exit` — `set -e` 下裸命令提前退出（高）

`task-orchestrate.sh` 在 `set -euo pipefail`（line 69）下，3 处裸 `ao run` 失败即退出，
后续失败处理/重试逻辑全成死代码。

| 位置 | 修复 |
|------|------|
| L3 模板分支 | `EXIT_CODE=0; ao run ... \|\| EXIT_CODE=$?` |
| L4 直接执行 | 同上 |
| 重试循环（上游 v0.73 新增） | 把 `\|\| EXIT_CODE=$?` 并入上游循环，否则重试永不触发 |

**复现**：`ao` 返回非 0 → 脚本立即终止，看不到"重试 N/M"和失败汇总。

### 2. `fix/arg-parsing-shift` — `for arg in "$@"` + `shift` 失效（中）

`for arg` 循环里 `shift` 无效、取 `$2` 拿到的是脚本位置参数而非"下一个 arg"，
导致 `--quiet --platform X` 把 PLATFORM 误设为字面量 `--platform`。改用 `while [[ $# -gt 0 ]]` + `shift`。

| 文件 | 备注 |
|------|------|
| `verify.sh` | 同时保留上游新增的 `--quick` |
| `uninstall.sh` | 同类修复 |

**复现**：`bash verify.sh --quiet --platform claude` → 平台探测错误。

### 3. `fix/cross-platform-portability` — BSD/GNU 工具差异（中）✅ 已提 PR #1

作者在 CONTRIBUTING「最需要的技能」里点名的 bash BSD/macOS 兼容性。
> 已作为 [PR #1](https://github.com/KongFangXun/sofagent/pull/1) 提交（+4/-2，2 文件，OPEN）。
> 验证：`bash -n` 通过 + 功能验证（sha256sum 回退出哈希、`stat -c %Y` 取到真实 mtime）；
> 部署循环/非 OpenClaw 实测因无安装环境未跑，已在 PR 正文如实标注。

| 位置 | 修复 |
|------|------|
| `task-orchestrate.sh` TASK_SLUG | `shasum` 缺失时回退 `sha256sum`（Alpine/精简 Linux 无 shasum） |
| `verify.sh` think.md 时间 | `stat -c %Y`（GNU）优先 + `stat -f %m`（BSD）回退。原 BSD-only 写法在 GNU/Linux 上 `-f`=`--file-system`、`%m` 被当文件名，**取不到 mtime**，反思频率检查失真 |

**复现**：精简 Linux 容器跑 `task-orchestrate.sh` → TASK_SLUG 恒为 unknown；Linux 跑 `verify.sh` → think.md 反思频率计算错误（实测旧写法在 GNU 上会输出文件系统信息、破坏算术）。

### 4. `fix/numeric-and-unbound-guards` — 数值/未绑定健壮性（低-中）

| 文件 | 修复 |
|------|------|
| `task-record.sh` 预算 | `--limit 0`/非数字在 `$(( ))` 前拦截，防除零崩溃 |
| `task-record.sh` 闭环计数 | 修 `grep -c ... \|\| echo 0` 在 0 匹配时输出 `"0\n0"` |
| `task-orchestrate.sh` 清理 | guard 空 `$SOFAGENT_CONSTRAINT_FILE`，避免 set -u 下 `rm ""` |
| `install.sh` 数据目录 | `SOFAGENT_DATA="${SOFAGENT_DATA:-...}"` 保留外部环境变量覆盖 |

**复现**：`task-record.sh --budget --steps 5 --limit 0` → 除零，set -e 崩脚本。

## 跨平台自检脚本（`tests/`）

把验证固化成可移植脚本，各环境**独立执行**、方便复现与排查：

- **`tests/check-portability.sh`** —— 纯 POSIX sh，可在 Alpine(busybox) / Ubuntu / macOS / MSYS2 直接 `sh` 跑，
  验证 PR #1 两处修复在当前平台成立（stat 取 mtime、shasum 缺失回退），退出码 0/1。
- **`tests/run-envs.sh`** —— 本机驱动，把上面的自检丢进 **本机 MSYS2 + WSL Ubuntu + Docker Alpine** 各自独立跑、汇总；
  缺哪个环境就跳过哪个，互不影响。

已实测（2026-06）：本机 MSYS2(GNU 8.32) 与 WSL Ubuntu 24.04(GNU 9.4) 均 **4/0 通过**，slug 跨平台一致；
旧 `stat -f %m` 在两处 GNU 平台均复现 bug。Docker Alpine（真·无 shasum）待引擎启动后补跑。

## 回归测试

`dev` 分支已有针对前 5 个确定性 bug 的回归用例（A–E，commit `44a0778`）。
提主题分支时一并带上对应用例，满足作者 PR 模板的「verify.sh 全过」要求。

## 不在本目录的改动

- `install.ps1` + `install.sh` 环境检测 —— **功能新增**，不是确定性 bug 修复，不归此处。
  按 fork 原则（见 `issues/FORK.md` §1.3）走独立 feature 分支评估。
- `load-chain.sh` 哈希缓存修复 —— 上游 v0.64 已删该文件（hook 替代，无缓存层），修复已无对象。
