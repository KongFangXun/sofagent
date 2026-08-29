# @sofagent/daemon

sofagent 守护进程——持续审计、文件监听（chokidar）、cron 定时巡检、USB federation 检测、Dream Cycle 6 阶段管道。

## 安装

```bash
npm install -g @sofagent/daemon
```

安装后获得 `sofagent-daemon` 命令。Node.js 18+。

## API

- `startCron()` — 启动定时巡检（知识健康 / A/B 调度 / Dream Cycle）
- `startWatching()` — 文件变更监听 + 5 秒防抖审计触发
- 依赖关系：`@sofagent/core` + `@sofagent/audit` + `@sofagent/rules`

## 文档

- [架构总览](../../docs/ARCHITECTURE.md) — daemon 在约束层中的位置与 Dream Cycle 管道
- [使用手册（WIKI）](../../docs/WIKI.md) — 面向 FDE 的完整用法
