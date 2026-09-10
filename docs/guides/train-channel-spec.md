# TrainChannel 适配规范（托管 API 适配指南）

> sofagent 云端微调走标准 TrainChannel 接口——**不做每云适配器**（一体机战略硬性边界：云厂商适配由使用方按本规范自行实现，上游只收接口）。

## 接口定义

`engine/orchestrator/src/train/train-channel.ts`——四动作契约：

| 动作 | 签名 | 语义 |
|------|------|------|
| `submit` | `(jobDir, jobSpec) → { remoteJobId, accepted }` | 提交训练 job（job.json + 数据集上传 + 启动） |
| `status` | `(remoteJobId) → { status, rawStatus, error?, recentEvents }` | 轮询状态（状态机归一） |
| `artifacts` | `(remoteJobId) → ChannelArtifact[]` | 产物清单（sha256 必填） |
| `cancel` | `(remoteJobId, reason) → ChannelStatusResult` | 取消（幂等——已终态返回当次状态） |

## 字段映射

### 状态机归一（各云原生状态 → ChannelStatus）

| ChannelStatus | 语义 | 常见云原生值 |
|---------------|------|--------------|
| `pending` | 已受理未启动 | `QUEUED` / `CREATING` / `PENDING` |
| `running` | 训练中 | `TRAINING` / `RUNNING` / `IN_PROGRESS` |
| `succeeded` | 成功 | `COMPLETED` / `SUCCEEDED` / `DONE` |
| `failed` | 失败（error 携因） | `FAILED` / `ERROR` |
| `cancelled` | 已取消 | `CANCELLED` / `STOPPED` / `TERMINATED` |

未知原生值 → 映射 `pending` + `rawStatus` 保留原值（审计可读）。

### 事件归一（各云原生事件 → ChannelEvent → 协议② TrainEvent）

| ChannelEvent.kind | 映射到 TrainEvent | 说明 |
|-------------------|-------------------|------|
| `progress` | `{ type: 'progress', step }` | step = percent 取整 |
| `status`(succeeded) | `{ type: 'done' }` | 完成事件 |
| `status`(failed) / `error` | `{ type: 'failed', reason }` | 失败事件 |
| `status`(其他) / `log` | `{ type: 'progress', step: -1 }` | 心跳 |

## 轮询状态机

```
pending ──→ running ──→ succeeded
   │           │    └──→ failed
   │           └────────→ cancelled
   └────────────────────→ cancelled（未启动直接取消）
```

- 终态（succeeded/failed/cancelled）后 status 返回稳定值，不再迁移
- `artifacts` 仅在 `succeeded` 后可调（其他态返回空数组或抛错——实现自选，消费方容忍空）
- `cancel` 幂等：终态再调返回当次终态（不报错）

## 产物校验契约

`ChannelArtifact.sha256` **必填**——产物下载后经 `artifact-verify`（v1.4.4 权重 manifest）校验，**sha256 不匹配 = 篡改拒绝**（不入库不上线）。`sizeBytes` 尽力提供（预检磁盘空间用，0 = 未知）。

## 凭据边界（credentialRef）

凭据**不落明文**——jobSpec.credentialRef 是虚拟 key 引用：

- 实现方从自己的安全存储（KMS/env/secret manager）解析真实凭据
- 引用值不进审计日志（train-audit 只记引用存在性，不记值）
- sofagent 侧不做凭据生命周期管理（key 生命周期归 router——一体机边界）

## 参考实现

- ssh 通道：`engine/daemon/src/cloud-exec.ts`（`createSshTrainChannel`——消费 v1.4.6 命令构造器产物）
- 托管 API 示例：`tools/train/examples/hosted-channel.example.mjs`（教学形态，非引擎核心依赖）

## 验收要点（适配自测清单）

- [ ] 四动作全实现（submit/status/artifacts/cancel）
- [ ] execFile 数组参数（禁止 shell 拼接——防注入）
- [ ] 状态机归一覆盖五态 + 未知值 pending 兜底
- [ ] 事件归一进协议②（done/failed/progress 三类必支持）
- [ ] artifacts 带 sha256（篡改拒绝链路可测）
- [ ] cancel 幂等
- [ ] credentialRef 不落明文
- [ ] fake 注入测试零真实网络
