# sofagent

**Audit-first governance layer for AI coding agents.**

`npm i -g sofagent` 一次装全：聚合安装入口（umbrella），等价于同时安装四大功能包。

- **审计 CLI**（`@sofagent/audit`）——`sofagent` / `sofagent-audit` 命令，扫描 git diff 检查 Agent 是否遵守工作纪律
- **MCP server**（`@sofagent/mcp`）——84 tools，把审计/训练/治理能力接入任意 MCP 客户端
- **编排器**（`@sofagent/orchestrator`）——训练任务全生命周期：数据管道、多卡多机、云执行平面
- **守护进程**（`@sofagent/daemon`）——dashboard 与 cron 任务

## 快速开始

```bash
npm i -g sofagent

# 在任意 git repo 内运行 30 秒零配置审计
sofagent            # 审计最近一次 commit
sofagent HEAD~3..HEAD   # 审计指定范围
```

`sofagent` 命令是 `sofagent-audit` 的薄转发——完整 CLI 能力见 [@sofagent/audit](https://www.npmjs.com/package/@sofagent/audit)。

## 许可

MIT © KongFangXun · 源码 [github.com/KongFangXun/sofagent](https://github.com/KongFangXun/sofagent)
