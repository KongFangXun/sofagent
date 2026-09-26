# sofagent 专题指南索引（guides/）

> 本目录收纳 22 份专题指南（另有本索引，目录共 23 文件）。按角色找入口：企业 IT / FDE 交付 / 开发者 / 审计与安全 / 后训模块 / 开源运营。全站文档导航见 [WIKI](../WIKI.md)。

## 一、企业落地（IT 负责人 / 管理员）

| 指南 | 讲什么 |
|------|--------|
| [enterprise-deploy.md](./enterprise-deploy.md) | 企业部署全流程指南——单企业从零到自运转 |
| [team-deploy.md](./team-deploy.md) | 团队落地 Checklist——多团队批量上线的逐项核对 |
| [multi-device-sync.md](./multi-device-sync.md) | 多设备联邦同步——知识库与审计数据跨设备一致 |
| [im-bridge.md](./im-bridge.md) | IM 桥远程指挥——dsh-im 扫码接入九渠道 + AI Office Connector + 安全审计 |
| [qwenwork-integration.md](./qwenwork-integration.md) | 千问办公（QwenWork）适配——MCP 接入与状态说明 |
| [team-collaboration-protocol.md](./team-collaboration-protocol.md) | L2 团队协作协议——多 Agent 协作的底层架构 |

## 二、FDE 交付（前线部署工程师）

| 指南 | 讲什么 |
|------|--------|
| [fde-activation-chain.md](./fde-activation-chain.md) | 激活链设计——交付物从静态文件到自运转（ACTIVATE→ORCHESTRATE→EXECUTE→SUSTAIN） |
| [fde-training-baseline.md](./fde-training-baseline.md) | 训练决策基线——能力阶梯四格（模型 API / 结构化调用 / tool calling / RAG）逐级排查，什么时候该训、什么时候别训 |
| [filesystem-audit.md](./filesystem-audit.md) | 文件系统审计——非开发者也能跑的合规巡检 |

## 三、开发者（引擎 / SDK / 前端）

| 指南 | 讲什么 |
|------|--------|
| [dsh-mcp-integration.md](./dsh-mcp-integration.md) | DSH MCP 互通——在 DeepSeek Harness 中挂载 sofagent-mcp 的配置专章 |
| [harness-sdk.md](./harness-sdk.md) | SubAgent 托管 SDK（`harness.wrap`）——自定义 graph 一行包装接入约束层 |
| [testing.md](./testing.md) | 测试用例说明——怎么跑、跑什么、如何解读 |
| [loop-development.md](./loop-development.md) | FORGE Loop 开发——给自迭代工具链加新 Loop |
| [frontend-design-standard.md](./frontend-design-standard.md) | 前端设计标准——改 Dashboard 前必读的视觉与结构规范 |
| [narrative-standard.md](./narrative-standard.md) | 叙事标准——改对外文案前必读的主轴/术语/结构公式 SSOT |

## 四、审计与安全

| 指南 | 讲什么 |
|------|--------|
| [review-system.md](./review-system.md) | 审查体系运作——阶段五四文档如何协同 |
| [node-level-audit.md](./node-level-audit.md) | 节点级审计——25 条规则子集在 DSH 事件流上的逐条判定 |
| [github-action.md](./github-action.md) | GitHub Action——PR 提交时自动审计的 CI 配置 |

## 五、开源运营（v1.4.5+）

> 本分类暂无专篇指南——开源运营相关内容暂由 [review-system.md](./review-system.md)（审查体系，归「四、审计与安全」）与 [narrative-standard.md](./narrative-standard.md)（叙事标准，归「三、开发者」）承载；新增运营指南时归入本分类。

## 六、后训模块（v1.4.1+）

| 指南 | 讲什么 |
|------|--------|
| [train-quickstart.md](./train-quickstart.md) | 后训模块 Quickstart——10 条 CSV 到推理服务的十步端到端（v1.4.5 · 每步命令/实测输出/排查三件套） |
| [train-stack.md](./train-stack.md) | 训练双栈契约——决策面 / 计算面 / 资源面分层与接口 |
| [train-security.md](./train-security.md) | 训练攻击面声明——红队视角的覆盖与不覆盖 |
| [train-channel-spec.md](./train-channel-spec.md) | TrainChannel 适配规范——托管 API 四动作契约（上游只收接口，不做每云适配器） |
