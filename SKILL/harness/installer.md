# Installer · 裸机自动安装引导

> 设备侧 Agent（OpenClaw / WorkBuddy / Claude Code 等）读本 skill 自主完成 sofagent 引擎装机。四步分步引导：**依赖检测 → install.sh 执行 → 安装结果校验 → 触发 G9 设备注册**——装完即注册、注册即在线。
> 上游输入：上岗 prompt（v1.4.7 onboard_prompt 生成器产出——设备身份、平台选择、策略文件路径以它为准）。
> ⛔ **每步必须可回滚/可中断**：任何一步失败先输出结构化诊断（本 skill 各步的「诊断表」），不要打哑炮，不要在失败后继续下一步。

---

## 第 0 步 · 前置确认（读上岗 prompt）

从上岗 prompt 提取四要素，缺任何一项 → **停在诊断，不开始安装**：

| 要素 | 用途 | 缺失时诊断 |
|------|------|-----------|
| 平台名（openclaw/workbuddy/claude/cursor/codex/hermes/gemini） | `install.sh --platform` 参数 | `{ "step": 0, "missing": "platform" }`——问派单方要，不猜 |
| 设备身份码（agentId + publicKey + signature） | 第 4 步 G9 注册 | 同上——身份码由约束层侧生成下发，设备侧不自造 |
| 策略文件路径（可选） | `install.sh --policy` | 可缺省（无企业策略管控时跳过） |
| 安装源（本地路径 / git URL / tag 版本） | `install.sh` 取材 | 缺省用派单方指定源 |

---

## 第 1 步 · 环境依赖检测

> 先跑脚本拿客观数值，再决定是否进入安装（与 Loop Check 同纪律：脚本先行，不凭直觉）。

```
node --version        → 期望 ≥ 18（模型清单探测用内置 fetch 的基线）
git --version         → 期望存在（--remote 模式必需；本地源可降级）
磁盘剩余 ≥ 500MB      → ~/.sofagent/ 落盘面
~/.sofagent/ 已存在？ → 已装过：转「升级」分支（问用户，不覆盖）
```

**诊断表（依赖缺失 → 结构化输出，不打哑炮）**：

```
{ "step": 1, "status": "blocked", "missing": ["node>=18"], "advice": "brew install node@18 或 nvm install 18", "rollback": "none（本步零副作用）" }
```

⛔ 检测命令本身失败（如 `node` 不存在导致 command not found）也算「缺失」，不是「跳过」——如实进 missing 数组。

---

## 第 2 步 · install.sh 执行

按第 0 步要素拼命令。**中断语义**：install.sh 任何非零退出 → 本步失败，读 stderr 全文进诊断。

```
bash <源路径>/install.sh --platform <平台> [--policy <策略文件>] [--base-only] [--with-first-deploy-cron]
```

- 首次装机不带 `--force`/`--merge`（那是升级参数）。
- `--policy` 指定但校验失败 → install.sh 自身 fail-closed 退出非零——**这是设计行为不是故障**，诊断里如实转述策略校验的 stderr 行，不要重试绕过。
- 静默环境（CI/无人值守）加 `--quick`；交互环境不加，让脚本自己问。

**诊断表**：

```
{ "step": 2, "status": "failed", "exitCode": 1, "stderrTail": "<最后 5 行>", "advice": "按 stderr 指路修复后重跑本步", "rollback": "rm -rf ~/.sofagent/<本版目录>（安装未完成时）；已存在旧版则恢复备份" }
```

**回滚**：install.sh 迁移旧目录失败会自行中止（数据安全语义）；Agent 侧只需确认 `~/.sofagent/` 状态与安装前一致（第 1 步检测时记的快照）。

---

## 第 3 步 · 安装结果校验

> 安装后自检全绿才算装完——三条证据缺一不可：

```
① ~/.sofagent/ 目录结构存在（data/ + SKILL/ + install.sh 落位）
② sofagent-audit --doctor → 退出码 0（doctor 自检：config / hook / 版本一致性）
③ MCP 连通：sofagent CLI 可响应（--version 或 doctor 的 MCP 段不报 unavailable）
```

**诊断表**：

```
{ "step": 3, "status": "failed", "checks": { "dirs": true, "doctor": false, "mcp": false }, "advice": "doctor 输出的修复提示（runDoctorWithRepair 文案）逐条执行后重跑", "rollback": "第 2 步回滚语义" }
```

⛔ doctor 非 0 不是「可能没事」——doctor 的每一项 FAIL 都有修复指引文案，逐条转述给派单方，修完重跑第 3 步。

---

## 第 4 步 · 触发 G9 设备注册

> 装完即注册。设备身份码（第 0 步要素）在此消费：

```
MCP tool: device_register
入参：identity（agentId + publicKey + signature）+ kind（pc/node/appliance）+ capabilities + tenant
```

- **验签 fail-closed**：`reason=invalid-identity` → 身份码被篡改或字段缺失——**不要重试**，回派单方重新签发身份码；这不是可自愈故障。
- `reason=duplicate-device` → 本机已注册过（agentId 唯一）——转「已注册」结论，直接跳到心跳确认。
- 注册成功后确认心跳已落位：写入面是 daemon 导出的 `reportHeartbeat`（带 `availableModels` = 本机扫描清单）——**它不是 MCP 工具**，MCP 面只读，Agent 侧用 `device_list` 的「最后心跳时间」与在线状态复核。注册即在线、心跳即上报，一步验证全链。

**诊断表**：

```
{ "step": 4, "status": "rejected", "reason": "invalid-identity", "advice": "身份码需约束层侧重新签发（设备侧不可自造）", "rollback": "none（注册被拒无副作用——拒绝已留事件链审计）" }
```

---

## 完成判据（四步全绿后向派单方汇报）

```
安装完成：platform=<名> 版本=<tag> 设备=<agentId 前 8 位>
- 依赖检测：通过（node <版本> / 磁盘 <剩余>）
- install.sh：exit 0
- 自检：doctor 全绿 / MCP 连通
- 注册：deviceId=<agentId> + 首跳心跳 ok（models=<N>）
```

## Gotcha

- **装完不注册**——install.sh exit 0 就当完成了，跳过第 4 步。后果：设备在平台上永远离线（注册即在线是本 skill 的存在理由）。
- **验签失败反复重试**——invalid-identity 是 fail-closed 设计，重试不会变绿，只会刷爆事件链。正确动作是回派单方换身份码。
- **升级当新装**——`~/.sofagent/` 已存在时直接跑 install.sh 不带升级参数，可能触发迁移中止。先判存量再选参数。
- **doctor FAIL 被吞**——只看 exit code 不看各项明细，把「部分 FAIL」当全绿汇报。逐条转述修复指引是硬要求。
- **诊断打了哑炮**——失败后只说「安装失败」不带结构化字段（step/status/reason/advice/rollback 五件套），派单方无从接手。
