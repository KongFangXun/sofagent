# SECURITY 归档 · install.sh 完整行为清单（v1.5.7 文档减重）

> 原属 `SECURITY.md`〈install.sh 行为说明〉，按「运维参考明细下沉归档」迁出，**原文逐字保真**；原地留摘要 + 指针。供应链信任链与哈希钉值说明仍在 [SECURITY.md](../../../SECURITY.md)。

install.sh 是 sofagent 的一键安装脚本。以下是其完整行为清单，供安全审查：

#### 脚本会做的事

| 操作 | 路径 | 说明 |
|---|---|---|
| 创建目录 | `~/.openclaw/skills/sofagent/` 或 `~/.workbuddy/skills/sofagent/` | 按平台部署 Skill 文件（**仅显式传 `--platform <平台>` 时**；默认安装不探测、零平台目录） |
| 创建目录 | `~/.sofagent/data/task/logs/`（运行时产物按 `SOFAGENT_HOME` 解析，`install.sh:398 DATA_ROOT="$SOFAGENT_HOME/data"`） | 数据目录，权限 700 |
| 复制文件 | 宪法(fde.md) + SKILL.md + 分层 rules/ + harness 约束骨架与 agents 子 Skill + 配套脚本 | 从仓库 `SKILL/` 和 `engine/scripts/` 复制到目标目录（以 `SKILL/` 目录实际清单为准） |
| 写入配置 | `~/.openclaw/openclaw.json`（仅 OpenClaw） | 注册加载链 Hook |
| 写入配置 | `~/.openclaw/config.json`（仅 OpenClaw） | 注入 loopDetection 断路器 |
| npm install | **不自动安装**；编排模块为独立可选包 `@sofagent/orchestrator`（需单独 `npm install -g @sofagent/orchestrator`） | Sub Agent 编排模块 |
| 安装服务 | launchd(macOS) / systemd(Linux) | daemon 后台进程（交互确认后。daemon 当前为 bash 实现，正常运行中） |
| 执行外部命令 | 无 | install.sh 自身不执行任何外部命令（此前的裸文本缺陷行已于 v1.5.7 修复，仅保留注释行） |

#### 脚本不会做的事

- ⚠️ 不会交互式提权（不弹密码框）——仅当 symlink 目标目录不可写且 sudo NOPASSWD 已配置时，以非交互 `sudo -n` 注册 CLI 命令（失败则回退 `~/.local/bin`），其余操作在用户权限范围内
- ❌ 不会改系统文件——不碰 `/etc`、`/System`（`/usr/local/bin` 仅创建一个 symlink）
- ❌ 除安装时的 npm 依赖拉取（见上表）与 `--remote` 模式的 git clone 外，**运行时不联网**——安装后的审计模块、daemon、MCP server 均不发起网络请求（webhook 为可选功能需显式配置；模型推理出口仅 Dream Cycle「真实大脑」/ train_serve，同样 opt-in 需显式配置 `SOFAGENT_MODEL_API_KEY` 等，未配置降级 MockLLM 零外发）
- ❌ 不会执行远程脚本（`--remote` 模式只做 git clone 官方仓库）
- ❌ 不会收集或上传任何用户数据

#### 远程安装（curl | bash）信任模型（v1.4.3 披露）

一行安装（`curl ... bootstrap.sh | bash`）的行业信任链是「HTTPS 传输 + GitHub 账号安全」，**无代码签名**——通道或账号被劫持时下载脚本可被替换。sofagent 自 v1.4.3 起追加一层：**bootstrap.sh 内嵌发版时硬编码的 sha256（install.sh + 6 个 lib 共 7 个哈希），与发版时不一致即 fail-closed 拒绝执行**——劫持者即使控制传输通道，也无法在不改哈希（哈希在 bootstrap.sh 自身内，用户 curl 到的那份）的情况下替换安装载荷。残余信任面如实披露：① 用户 curl 到的 bootstrap.sh 本身仍无签名（首跳信任，与全行业一致）；② 哈希随发版更新，若发版流程被攻破（哈希与载荷同被替换）校验失效——此层防御针对传输劫持，不针对供应链根攻破；③ 高安全场景建议 `git clone` + 审查后 `bash install.sh`，绕开首跳信任。**边界重申（v1.5.7）：哈希锚与载荷同源（都在发版侧产出）——本机制防传输劫持、不防源头替换**；

独立校验通道（release 页公示哈希 / attestation）已登记 [ROADMAP 探索方向](./docs/ROADMAP.md) 排期评估。

#### 源码审查

install.sh 拆分为以下模块，便于逐模块审查：

| 模块 | 职责 |
|---|---|
| `install.sh` | 主入口（组装 + 参数解析） |
| `lib/config.sh` | 配置加载 + 常量定义 |
| `lib/daemon-lib.sh` | daemon 公共函数库 |
| `lib/daemon-register.sh` | Hook + daemon 注册 |
| `lib/file-deploy.sh` | 文件部署 |
| `lib/platform-detect.sh` | 平台探测 + 参数解析 |
| `lib/post-install.sh` | 安装后检查 + 输出 |
