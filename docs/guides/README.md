# sofagent 专题指南索引（guides/）

> 本目录收纳 18 份专题指南。按角色找入口：企业 IT / FDE 交付 / 开发者 / 审计与安全 / 后训模块 / 开源运营。全站文档导航见 [WIKI](../WIKI.md)。

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
| [filesystem-audit.md](./filesystem-audit.md) | 文件系统审计——非开发者也能跑的合规巡检 |

## 三、开发者（引擎 / SDK / 前端）

| 指南 | 讲什么 |
|------|--------|
| [harness-sdk.md](./harness-sdk.md) | SubAgent 托管 SDK（`harness.wrap`）——自定义 graph 一行包装接入约束层 |
| [testing.md](./testing.md) | 测试用例说明——怎么跑、跑什么、如何解读 |
| [loop-development.md](./loop-development.md) | FORGE Loop 开发——给自迭代工具链加新 Loop |
| [frontend-design-standard.md](./frontend-design-standard.md) | 前端设计标准——改 Dashboard 前必读的视觉与结构规范 |

## 四、审计与安全

| 指南 | 讲什么 |
|------|--------|
| [review-system.md](./review-system.md) | 审查体系运作——阶段五四文档如何协同 |
| [node-level-audit.md](./node-level-audit.md) | 节点级审计——24 条规则子集在 DSH 事件流上的逐条判定 |
| [github-action.md](./github-action.md) | GitHub Action——PR 提交时自动审计的 CI 配置 |

## 五、开源运营（v1.4.5+）

| 指南 | 讲什么 |
|------|--------|
| [github-pr-playbook.md](./github-pr-playbook.md) | GitHub PR 投稿运营手册——sofagent 开源曝光实战沉淀（阵地筛选 / PR 模板 / 收录后维护） |

## 六、后训模块（v1.4.1+）

| 指南 | 讲什么 |
|------|--------|
| [train-stack.md](./train-stack.md) | 训练双栈契约——决策面 / 计算面 / 资源面分层与接口 |
| [train-security.md](./train-security.md) | 训练攻击面声明——红队视角的覆盖与不覆盖 |
