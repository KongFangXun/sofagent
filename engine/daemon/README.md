# @sofagent/daemon

sofagent 守护进程——持续审计、文件监听（chokidar）、cron 定时巡检、USB federation 检测、Dream Cycle 6 阶段管道。

## API

- `startCron()` — 启动定时巡检（知识健康 / A/B 调度 / Dream Cycle）
- `startWatching()` — 文件变更监听 + 5 秒防抖审计触发
- 依赖关系：`@sofagent/core` + `@sofagent/audit` + `@sofagent/rules`
