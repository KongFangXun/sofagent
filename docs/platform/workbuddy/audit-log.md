# WorkBuddy 安全中心审计日志（A/B 评测的机械层）

> 实地勘察自 `~/.workbuddy/audit-log/`（2026-06）。**这是 sofagent 做可信 A/B 评测的关键发现**：
> WorkBuddy runtime 自带一份**独立于 Agent 叙述**的行为日志——不用自己造 hook，读它即可。

## 为什么重要

sofagent 的核心难点（见 `docs/anti-cases/001-benchmark-self-test-circularity.md`）：被测 Agent 自己
报告自己是否遵守约束 = 循环论证（"戴眼罩的人自报眼罩有效"）。要打破循环，测量必须来自**机械层**
（runtime 捕获的实际行为），而非**叙事层**（Agent 自述，如 task-record `--result 成功`、think.md 自评）。

**WorkBuddy 的 audit-log 正是机械层**：安全中心捕获，记录 Agent 实际调了什么工具、安全决策是放行还是拦截，与 Agent 怎么"说"无关。

## 文件

| 文件 | 作用 |
|------|------|
| `audit-log/YYYY-MM-DD.jsonl` | 每日审计记录（一行一事件） |
| `audit-log/manifest.jsonl` | 清单 |
| `audit-log/state.json` | 状态 |
| `audit-log/spool/` | 缓冲 |

## 单条记录 schema（schemaVersion 2）

```
source        desktop-main / spool        事件来源
category      network / command-safety / file-safety
eventType     见下方分类
messageKey    securityCenter.audit.* 文案键
messageParams { target: "https://...", ... }  事件参数（部分含明文，如 URL）
decision      allowed / failed / needs-approval / approved / auto-approved
timestamp     epoch ms
sessionId     会话 ID  ← A/B 分臂的关键
toolCallId    toolu_...  Agent 工具调用 ID  ← 到动作级
commandHash   命令哈希（明文不落盘，隐私）
sequence      会话内序号
prevHash/hash 哈希链（防篡改，区块链式）
id            记录 UUID
```

## eventType 分类（本机样本 472 条分布）

| eventType | 含义 | 样本数 |
|-----------|------|--------|
| `WebFetch` | 网络抓取 | 279 |
| `command-safety.sandbox-executed` | 沙箱执行命令 | 142 |
| `file-safety.needs-approval` | 文件操作待批 | 31 |
| `file-safety.approved` | 文件操作已批 | 9 |
| `file-safety.auto-approved` | 文件自动批准 | 6 |
| `command-safety.auto-approved` | 命令自动批准 | 5 |

**decision 分布**：allowed 373 / failed 59 / info 31 / approved 9。

## 用它做 A/B（客观指标，零 Agent 自评）

1. 同一任务，开**两个会话**：sofagent 臂 / 原生臂（各有独立 `sessionId`）。
2. 读 jsonl，按 `sessionId` 过滤。
3. 算客观指标：
   - **行为画像**：工具调用数 / 命令数(command-safety) / 文件操作数(file-safety)
   - **风险画像**：`needs-approval` vs `auto-approved` 比例 → sofagent 是否让 Agent 更主动求批/更谨慎
   - **失败率**：`decision=failed` 计数
   - **底线验证**：陷阱任务里 command-safety 记录的是**实际执行**还是**拦截**
   - **自述失真度**：`task-record` 声称"成功" vs 本日志同 session `decision=failed` → 量诚实差（验证铁律 #10）

## 限制（诚实）

1. **命令明文不落盘**（`commandHash` 哈希）——看得到"跑了命令 + 安全决策 + 序号"，看不到命令文本。
   `messageParams` 有部分明文（WebFetch 的 target URL）。"是否跑了 rm -rf"靠 safety 分类/decision 推断。
2. **是安全审计**（network/command/file 三域），非全量动作/推理 trace。但安全事件恰好是底线 #2 瞄准的，对得准。

## 对照：OpenClaw 侧

OpenClaw 的 `~/.openclaw/logs/config-audit.jsonl` 偏**配置审计**，不如 WorkBuddy 的行为审计丰富。
故 **WorkBuddy 是更好的 A/B 评测平台**。
