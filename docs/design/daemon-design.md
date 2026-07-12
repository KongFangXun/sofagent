# daemon MVP · 架构设计

> sofagent v0.99.2 · sofagent 的第一个 session 外触发器——让约束从「Agent 自觉」升级为「外部进程强制」。
> v1.0.6 · 更新于 2026-07-11

---

## 定位

旧定位是「加载链补丁」——Agent 不读提醒和不读 think.md 是同一种行为。新定位是 **session 外触发器**，三层触发：

| 触发 | 实现 | 用途 |
|------|------|------|
| 定时 | macOS launchd / Linux systemd | 健康检查、压缩记忆、清理过期数据 |
| 事件 | 文件监控（think.md / fde.md 变更） | 跨 session 经验不丢失 |
| 状态 | Agent 进程检测（pgrep） | Agent 启动→注入契约摘要；关闭→记录时长 |

## MVP 范围

**做**：文件监控 think.md/fde.md 变更、Agent 启动检测+循环契约注入、状态持久化 daemon.json、macOS launchd + Linux systemd 注册。

**不做**：不参与 Agent 对话、不替 Agent 做决策、不引入数据库、不做 Windows 支持。

## 目录结构

```
sofagent/scripts/
├── daemon.sh              ← 主进程
├── daemon-install.sh      ← launchd/systemd 注册
├── daemon-uninstall.sh    ← 注销
├── daemon-status.sh       ← 状态查询
└── lib/
    ├── daemon-lib.sh      ← 公共库
    └── daemon-register.sh ← 注册逻辑
```

数据在 `~/.sofagent/daemon/daemon.json`（started_at / pid / status / last_check / last_action / last_hash / last_agent_pid / session_count）。

## 主循环（daemon.sh）

每 30 秒：检测进程存亡 → 检测 think.md hash 变化 → 有变更则更新 daemon.json + 调用 verify.sh 做可信证据验证 → 检测 fde.md hash 变化 → 有变更则更新 daemon.json。

信号处理：注册 TERM/INT 信号清理 PID 文件，非 Darwin/Linux 拒绝启动。

## 安装与注册

`daemon-install.sh`：macOS → 部署 plist 到 `~/Library/LaunchAgents/`，`launchctl load`；Linux → 部署 user service 到 `~/.config/systemd/user/`，`systemctl --user enable --now`；其他系统跳过并提示手动运行。`daemon-uninstall.sh` 执行反向操作 + 清理 daemon.json。

## 可信证据验证

daemon 不是靠文件存在判断合规——它实际运行 verify.sh 做验证。检测到 think.md hash 变化后 → 调用 verify.sh → 结果写入 daemon.json `last_evidence` 字段。确保硬盘上的文件是 Agent 真的写过的，不是空的或伪造的。

## 数据目录发现

四级 fallback（环境变量 SOFAGENT_DATA → CWD 的 .sofagent → 标记文件 .sofagent_root → fallback 路径），解决 install.sh --project-dir 后 verify/audit 找不到数据的问题。

## 经验压缩（v0.81+）

`cleanup.sh` 集成经验压缩：think.md 大量条目 → 调用 `compress-memory.ts` → 保留高频关键词（权重≥0.5）→ 归档低频条目（>90 天自动清理，<0.3 权重不保留）。可用 `--dry-run` 预览不执行。备份路径：`~/.sofagent/backups/`。

## 当前局限

daemon 只做文件监控 + 写 notice，功能比 cron job 简单。v1.0 ROADMAP 准入条件 #6 已移除（❌）——daemon 从未获得新增用户价值，维护它只会偏离核心目标。**不要为了凑准入条件而维护没有价值的东西。**
