# 文件系统审计 — 非开发者使用指南

> v1.4.5 · 让非开发者也能被 sofagent 审计覆盖

## 概述

sofagent v1.0.8 起支持文件系统审计——不依赖 git commit，任何文件变更都能被检测。v1.0.9 递归监控子目录，覆盖更全面。管理员配置一次 daemon，所有成员（含非开发者）的文件操作自动纳入审计。

## 配置 watch.yml

在 `.sofagent/watch.yml` 中配置监控：

```yaml
paths: ["."]
ignore: ["node_modules/", ".git/", "*.map", "*.d.ts"]
debounceMs: 5000
```

## 启动 daemon

```bash
sofagent-daemon start   # 前台运行（v1.1.4 起，旧版用 sofagent-audit --daemon）
sofagent-audit --init           # 注册 LaunchAgent（macOS，开机自启）
```

## 监控范围（v1.0.9 递归覆盖）

daemon 启动时自动遍历所有子目录并建独立 watcher，新目录创建时自动追加。

✅ 所有层级子目录文件变更（跳过 `.` 开头目录和 `node_modules/`）

## 告警出口与审计规则

| 出口 | 用途 |
|------|------|
| stdout | 实时终端输出 |
| `daemon-health.json` | 供审计模块后续检查 |
| `audit/history.jsonl` | `--timeline` 查看历史 |

- **A16 非授权文件变更**：敏感目录（config/、.env、secrets/）和敏感类型（.xlsx、.pdf、.pem 等）的修改/删除 → WARN
- **A17 异常批量变更**：5 分钟窗口内 ≥50 文件变更 → WARN
- ⚠️ A16/A17 是行为级检测，WARN 不阻断。不解析文件内容。

## 管理员配置闭环

1. `sofagent-audit --init` → 安装 hook + 生成配置
2. 编辑 `.sofagent/watch.yml`
3. 启动 daemon
4. 团队成员无需碰 npm/git，自动被审计
5. `sofagent-audit --timeline` 查看审计时间线

## 查看审计结果

```bash
sofagent-audit --timeline         # 最近 20 条
sofagent-audit --timeline 50      # 最近 50 条
sofagent-audit --timeline --json  # JSON 格式
sofagent-audit --revert <SHA>     # 回滚到指定快照
```

## 局限

- 不解析二进制文件内容（Excel、PDF 等）
- daemon 重启后 A17 窗口内历史不保留
- 详见 [LIMITATIONS.md](../LIMITATIONS.md)
