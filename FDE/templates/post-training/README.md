# post-training/ · 后训练 workflow 模板

> **用途**：企业需要做专属后训练小模型时，用本模板搭「一句话 → 模型选型 → 训练 → 部署」的完整链路。
> **机器可读**：`post-training.yml` 是 workflow-parser 的合法实例（字段对齐 `docs/guides/fde-activation-chain.md` §workflow.yml 示例），可直接被 dag-runner 加载执行。
> **说明文档**：HITL 确认点 / 激活链映射 / 依赖版本见本 README（YAML 文件只放机器可读结构，保证可解析）。

## 三个 HITL 确认点（人必须在场）

| 节点 | 为什么人必须确认 |
|------|-----------------|
| `pt-need-collect` | 企业一句话可能有歧义，模型不能自己脑补 |
| `pt-model-select` | 选哪个基座/算法影响成本，必须企业点头 |
| `pt-deploy` | 权重上线是生产变更，强制人审（对齐 v1.3.5 promote_ab） |

> 训练中（`pt-train-run`）不需要人——预算控制（v1.4.1 ④）在超预算时自动暂停等人审，其余全自动。

## 激活链映射

| 激活链阶段 | 节点 |
|-----------|------|
| ACTIVATE 进场 | pt-need-collect |
| ORCHESTRATE 编排 | pt-env-check → pt-model-select |
| EXECUTE 执行 | pt-data-prep → pt-train-run → pt-eval-gate |
| SUSTAIN 运转 | pt-deploy（+ 持续后训练扩展） |

## 依赖的后训模块版本

| 节点 | 依赖能力 | 版本 |
|------|---------|:---:|
| pt-need-collect / pt-model-select | train analyze + train templates | v1.4.3 |
| pt-env-check | train env / train doctor | v1.4.2 |
| pt-data-prep | 数据管道 + 训练集版本 | v1.4.2 |
| pt-train-run | train-job 编排 + 预算控制 | v1.4.1 |
| pt-eval-gate | eval 闭环 | v1.4.2 |
| pt-deploy | 企业专属模型权重部署 + 产物注册衔接 | v1.4.4 |
