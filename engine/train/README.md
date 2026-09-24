# @sofagent/train

> 命名说明：本目录是随安装分发的 engine 侧实现；维护者 SOP 脚本见同名 tools/train——职责边界见 tools/README.md。

sofagent 后训练功能包——数据 ingest → 训练编排 → eval 比对 → 产物注册 → 推理服务全链路，供编排模块与 daemon 任务调用。

## 安装

```bash
npm install @sofagent/train
```

库包（无自带 CLI；`train` 子命令入口在 `@sofagent/orchestrator`）。Node.js 18+。

## API

- `createTrainJob` / `TrainJobSchema` — 训练任务数据模型与状态机（job.json 协议 SSOT）
- `createTrainScheduler` — 任务编排（提交 / 监控 / 取消 / 续跑，spawn 子进程 + 事件回流）
- `runDryrun` — dry-run 预检（极小数据集跑通管线 + 显存估算 + 算力外推）
- `trainDoctor` — 训练环境体检（GPU / 框架 / 基座缓存 + 反作弊基线）
- `scanAndGate` / `scanDatasetCompliance` — 数据集合规扫描与闸门
- `generateTrainReport` — 训练报告生成（markdown + JSON 归档，含 ROI 量化四字段）
- `generateTrainDeliverable` / `verifyTrainDeliverable` — 交付包生成与校验
- `createTrainServeManager` — 推理服务生命周期（vLLM / Ollama / OpenAI 兼容端点）
- `createCloudRegistry` / `CloudVmRecord` — 云 VM 注册表
- `checkTrainAuditChain` — 训练审计链写入与校验
- `validateDataPush` / `gateDataPush` — 标准数据推送入口（schema 校验 + 双闸入库）
- `TrainChannel` / `ChannelStatusResult` / `TrainEvent` / `SpawnFn` — 通道与事件契约类型

## 文档

- [架构总览](../../docs/ARCHITECTURE.md) — train 在约束层中的位置
- [使用手册（WIKI）](../../docs/WIKI.md) — 面向 FDE 的完整用法
- [后训练全栈指南](../../docs/guides/train-stack.md) — 约定与流程
- [训练安全基线](../../docs/guides/train-security.md) — 路径白名单 / 注入过滤 / 数据主权
- [快速上手](../../docs/guides/train-quickstart.md)
