# IM 桥远程指挥 · dsh-im 接入指南

> **定位声明**：`@xmanrui/dsh-im` 是 DeepSeek Harness 官方插件体系下的**第三方社区插件**（作者 xmanrui，MIT，非 DSH 官方、非 sofagent 产物）。它把九种 IM 机器人（微信/飞书/钉钉/企微/QQ/Slack/Telegram/Discord/WhatsApp）和公网 AI Office 接入本机 Harness——手机扫码，远程指挥跑在你设备上的 Agent。每渠道支持多机器人，状态/工作区/会话绑定彼此独立。安全审计结论见文末附录。

## 一、安装

前置：本机已装 DeepSeek Harness（`dsh` 命令可用，Node ≥ 22.19）。

```bash
# 方式一：sofagent 安装器可选分支（v1.4.2+，默认不装，内部走方式二）
bash install.sh --with-im-bridge

# 方式二：DSH 插件命令（官方推荐，npm 稳定版 3.0.6）
dsh plugin --profile web add -w @xmanrui/dsh-im

# 方式三：GitHub 源安装最新未发布代码（pnpm 10+ 需允许构建脚本）
npx -y github:xmanrui/dsh-im install
```

装完重启 `dsh web`、刷新浏览器，进「设置 → IM机器人」按引导扫码或填 App ID/Secret。升级不改变已有机器人、凭据、工作区与会话绑定。

网络受限环境：飞书走 `HTTPS_PROXY`（启动 `dsh web` 前设置，长连接不读 `ALL_PROXY`）；Telegram 需 Node ≥ 22.21 + `NODE_USE_ENV_PROXY=1`。

## 二、AI Office Connector（无头设备方案）

「AI Office」页让本机 Harness **主动外连**公网 Office（协议 `office-harness.v1`），本机无需公网 IP、端口转发或 WebSocket 服务：

- **连接**：本机发起 `POST /api/harness/connector/heartbeat` 鉴权握手（响应必须为 `{"ok":true,"protocolVersion":"office-harness.v1"}`），再建 SSE 下行流，断线按退避策略自动重连
- **任务租约**：`job.available` 触发拉取任务 → 校验 Workspace/Preset alias → 领 90 秒租约、每 30 秒续租（源码核实 `RENEW_MS=30_000`，90s TTL 为 Office 服务端语义）；连接器建独立 Harness Session，状态/工具名/增量文字回传，终态只允许写一次
- **工具审批进人工面板**：Harness 发起的工具审批/补充问题推到 Office 人工面板，批准/拒绝/文字答复经 SSE 回原 Session；断线由租约与 Heartbeat 恢复
- **凭据**：Device Token 只写 Harness 凭据存储（源码核实走 `ctx.credentials.set`，配置文件只存 `deviceTokenRef` 引用）；Office 侧只见 alias，不接触本机绝对路径

命中场景：Harness 跑在无头服务器/NAS，通过公网 AI Office 网页远程指挥——设备全程不开任何入站端口。

## 三、机器人命令（白名单）

| 命令 | 作用 |
|------|------|
| `/help` `/status` `/version` | 帮助 / 连接状态 / 插件版本（均不创建会话） |
| `/new` | 解绑当前聊天会话，下一条消息开新 Session（不删旧 Session） |
| `/models` · `/model [序号\|Provider/ID [推理等级]]` | 列出 / 切换模型 |
| `/reasoning(s)` `/reasoning [序号\|--default]` | 列出 / 切换推理等级 |
| `/presetlist` · `/preset [序号\|--default]` | 列出 / 设置 Agent Preset |
| `/stop` | 立即停止当前任务（排队消息保留） |
| `/steer <补充指令>` | 向运行中任务追加指令 |
| `/batch` `/send` `/cancel` | 批量收集（≤10 条）/ 提交 / 取消 |
| `/compact` · `/repair` | 压缩上下文 / 修复飞书卡片回调（仅飞书私聊） |
| `/workspace <绝对路径>` · `/workspacelist` | 切换 / 列出机器人工作区 |
| `/sessionlist` · `/session <ID>` | 列出 / 绑定已有会话 |
| 交互式提问 · 远程审批 | 回复选项序号或文字（多选逗号分隔）；回复 `批准`/`拒绝`/`同意`/`不同意`/`yes`/`no` |

Slack 桌面端拦截 `/` 开头消息——前面加一个空格发送（如 ` /presetlist`）。

## 四、安全边界（三件套）

1. **凭据只进本机存储** ✅源码核实：所有 Secret/Token 只提交给本机 Harness Host，经 `ctx.credentials` 凭据提供方写入（飞书/Office 渠道均先写 secret 后写 ID、失败回滚）；配置 JSON 不落明文，状态接口与机器人列表不回传凭据。存储的物理加密强度取决于 DSH Host 本体（未审，见附录未验证项①）。
2. **可信用户限制** ⚠️部分核实：Telegram 默认兼容模式（私聊响应+群聊@响应），可切安全模式（私聊白名单，按数字 User ID，源码有 `privateAllowlist`）；WhatsApp 默认仅自己模式，可设联系人白名单；未授权消息静默忽略。**微信/飞书/钉钉/企微/QQ 渠道无内置用户白名单**——凡能联系到机器人者皆可用，企业场景应在 IM 平台侧收紧机器人可见范围或仅限小范围群使用。
3. **命令白名单** ✅源码核实：机器人只响应上表命令与普通消息，无任意 shell 通道；唯一路径级操作是 `/workspace`，需人工显式输入绝对路径。

管理面加固：IM 管理 RPC 默认仅回环（`rpcAuthority: loopback`）；仅可信局域网可显式开 `trusted-host`（复用 Host/Origin 防护，**非用户认证**——能访问该地址者即可扫码、提交凭据、删除机器人，只应在可信网络用）。

## 五、OpenClaw 备选通道

不用 DSH 的场景，OpenClaw 侧有 `@openclaw-china/channels` 国产 IM 聚合层可作同类备选（dsh-im 的微信协议适配亦源自 Tencent openclaw-weixin，见其 THIRD_PARTY_NOTICES）。sofagent 红线不变：**不写任何 IM 协议代码，IM 接入一律走插件层**。

---

## 附录：@xmanrui/dsh-im@3.0.6 安全审计（静态审计级）

- **样本**：npm tarball（sha1 `0f5afa75…` 与 registry dist.shasum 一致，2026-08-27 拉取），解包 238 文件；plugin-src/host + src/channels 源码全量阅读，lib/index.js（8MB 构建产物）做端点/子进程/eval 定向扫描
- **元数据**：3.0.6 · MIT · 5 运行时依赖 · 仓库 github.com/xmanrui/dsh-im · node ≥ 22.19 · **无 postinstall/preinstall 生命周期脚本**（发布自检 `scripts/verify-package.mjs` 校验包内无凭据）
- **凭据处理 ✅**：见上文安全边界①，feishu/office 均走凭据提供方，配置文件零明文
- **网络行为 ✅**：出站端点全部为渠道官方 API（api.dingtalk.com、open.feishu.cn、slack.com、api.telegram.org、discord.com、ilinkai.weixin.qq.com 等）+ 用户自配 Office Base URL；无遥测、无运行时统计上报；客户端 bundle 无外呼端点
- **进程权限 ✅（一项注意）**：运行时不 spawn 任意命令——唯一 `spawn` 在 harness-client 拉起本机 `dsh web`（参数固定 `["web","--host",h,"--port",p]`）；`bin/dsh-im.mjs` 的 spawnSync 仅调 `dsh plugin add/remove`。构建产物内含 sharp/node-gyp 安装器片段，属 devDependencies 打包噪音，不在本包执行
- **未验证项（声明核实清单）**：① DSH Host 凭据存储的物理加密强度（未审 DSH 本体）；② 九渠道运行时行为未实测（无真实 IM 账号环境），扫码流程/多机器人隔离仅文档+源码级确认；③ 8MB 构建产物未逐字节审计（仅定向扫描）；④ 供应链传递审计未做——WhatsApp 渠道依赖 baileys 7.0.0-rc14（RC 版+非官方 Web 协议），账号风控风险自担
- **结论**：凭据不入明文配置、无遥测、无任意命令执行通道、管理面默认回环——适合企业单机接入；局域网暴露场景慎用 `trusted-host`
