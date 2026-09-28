# WeKnora 深读全文（原 docs/VALIDATION.md §一 WeKnora 节 · doc-slim 批 2026-09-28 搬出）

> 原节：知识平台与检索管线：WeKnora——判定件上游的检索基础设施现成件（含腾讯 Agent Memory 分工对比）。正文处已收敛为台账行，全文在此。

### 知识平台与检索管线：WeKnora——判定件上游的检索基础设施现成件（2026-09）

腾讯开源 WeKnora（MIT，v0.8.2 · 2026-09-24，3,263 commits 活跃维护）——「把原始文档变成可查询 RAG、自主推理 Agent 与自维护 Wiki 的 LLM 知识平台」。对本仓的价值定位：**不是同类**（它做知识检索基础设施，本仓做判定治理层），而是 [v1.9.0 §三](./changelog/v1.9/v1.9.0.md)「本体数据判据面·召回三问」链路的**上游现成件**——「认类/贴合度/准入」三问的输入正来自这类检索系统。
五点可参考：① **混合检索分数归一化**——向量（cosine）/关键词（BM25）/RRF 各库分数不可比（Milvus L2、(1+cos)/2、RRF ~0.016）是检索工程公认坑，WeKnora 的解法是**统一归一化到 [0,1] 再融合**——本仓知识库/联邦查询面的分数可比性设计可直接引用该形态；② **检索降级语义**——reranker 加载失败时**降级为检索顺序而非报错**，与 [v1.8.0](./changelog/v1.8/v1.8.0.md)「失败退 L0 不留空窗、不静默放行」同构，但它多一步「报失败原因与 mode_fallbacks」的留痕；
③ **chunk 级编辑带修订历史/diff/回滚**——与本体数据双时态（v1.5.0）同类形态，且「检索 chunk 可编辑」是知识资产「人审修正→反哺检索质量」的闭环抓手；④ **GraphRAG 实体源 chunk 置顶**——知识图谱命中时把实体来源 chunk 提到上下文顶部，是「召回三问」图谱版的溯源设计；
⑤ **治理面对照**——多工作区 RBAC 四角色 + 每工作区审计日志 + scoped API key（每工作区独立 endpoint/token/限流/工具组）+ AES-256-GCM + SSRF 白名单，与本仓「scoped API key」「SOFAGENT_MCP_ROLES 收窄」同构互证——但**无 append-only 审计链、无决策留痕、无校准判定**，治理纵深差一档（与本仓差异化定位一致）。
**工程面旁证**：Lite 单二进制档（SQLite + 内存队列零外部依赖）与 Docker/Helm/桌面四档分发、anydoc Rust cgo 解析引擎（恶意 PDF 开销上界 26.7s→5.8ms——解析面DoS防御）、内置 MCP Server 按工作区 scoped 发布。
**生态注意**：其 Agent 模式（技能/沙箱/MCP 工具/记忆）已接入 DeepSeek Harness 插件（`@wxg-prc-cpg/dsh-weknora`）且自带 ClawHub Skill 通道——**判定底座（v1.6.0+）就位后，此类知识平台的检索输出是 `Noul` 判定的天然输入源**（与出口治理面对称的「进料治理」位）。2026-09-26 一次大型 revert 将 11 个插件系统 PR 撤出 main 待审查——「该撤就撤不硬撑」与 v2.0.0 退役基调同频。

**与腾讯云 Agent Memory（TencentDB Agent Memory · 记忆底座）的分工对比**——两者是腾讯系「知识面」的两条互补轨道，判据在**写入来源与组织对象**：WeKnora 管**显性知识资产**（人上传的企业文档：PDF/Word/飞书/Confluence 等 10+ 格式，FAQ/文档/Wiki 三基，chunk 人可编辑带修订回滚），Agent Memory 管**Agent 行为记忆**（对话/代码/任务轨迹运行时自动蒸馏，L0 原始对话→L1 原子事实→L2 场景 Markdown→L3 用户画像四层金字塔，
PersonaMem 自报 47.85%→76.10%）。两者**检索内核同款**（关键词+向量+RRF 混合）——检索分数归一化坑是共性问题。对 sofagent 的映射：WeKnora 类平台是 [v1.9.0 §三](./changelog/v1.9/v1.9.0.md)「召回三问」的**上游检索件**；Agent Memory 的 L0-L3 分层与本仓「经验池→skill 晋级」（v1.5.8 准入门/晋级判据）同构——**记忆蒸馏的分层沉淀与晋级门控是同一问题的两种解**，其「每条结论保留指向下层的原始来源链接（四层逐级下钻）」与本仓「轨迹可弃行为可溯」的审计锚定互证。
**治理面对照**：Agent Memory 的「白盒可溯源」是检索溯源，非行为审计——无 append-only 链、无决策留痕，与 WeKnora 同样差一档治理纵深。

> 📖 来源：[WeKnora（GitHub，MIT）](https://github.com/Tencent/WeKnora)（README + 提交记录实证，2026-09-26 取证；腾讯官方维护，官网 weknora.weixin.qq.com）
