# Evidence.md — sofagent 真的有用吗？

> 当前单元测试数：407（v0.99.8 起，`npm test` 实跑）。历史记录：v0.99.1 为 398。

> ⚠️ **中文版为完整版（截至 Case 025，2026-07-06）。** 英文版同步至 Case 025。

> 我们不替你回答。以下是装了 sofagent 的人自己记录的。

> ⚠️ **诚实声明**：以下数据含作者自测。复盘评分为 LLM 自评（非 OpenClaw 平台无工程隔离）。企业级评估请等待 v0.9 加密 + 外部评估器。当前数据适合探索性评估，不适用于生产决策。

> ⚠️ **v0.99.2 起**：benchmark.sh 已移除。以下 benchmark 数据为 v0.92-v0.93 期间的历史实验记录。当前部署验证请使用 `bash sofagent/scripts/verify.sh --quiet`（verify 全绿即通过）。benchmark 体系将在 v1.x 重建。
>
> 📊 **A/B benchmark 数据**：
>
> **v0.93 OpenClaw 10 组对照实验**：4 任务 × 2 条件（有/无 sofagent）× 独立 session。结论：**约束底座增量 = f(陷阱难度)**。在高难度「同名语义混淆」场景（Task 1 camelCase→snake_case），sofagent 组变量名误伤率 0%（0/7），裸 Agent 100%（7/7）。在精确指令场景（Task 3/4）无显著差异。Task 2（代码分析）sof-1 异常漏报（1/4 bugs）需更大样本确认。⚠️ 方法论诚实：本次实验 sofagent 条件为 prompt 前缀注入 4 条核心规则（非真实 Skill 加载链），可能低估实际效果。详见 [Task 2-4 实验总览](./benchmark/2026-06-26-openclaw-task2-4-summary.md)。
>
> **v0.92 OpenClaw 对照实验**：同一模型在独立 session 中跑 Task 1（camelCase → snake_case），sofagent 组变量名误伤率 0%（0/7），裸 Agent 组误伤率 100%（7/7）。纪律性 +2，首次通过率持平。详见 [OpenClaw Task 1 对照](./benchmark/2026-06-25-openclaw-task1-control.md)。
>
> **v0.81-v0.83 历史数据**：五组 A/B。约束层在 WorkBuddy 对话模式仅 1/10 明确增量，CLI 一击 0/16 全失效（见 [反案例 002](./anti-cases/002-cli-one-shot-ineffective.md)）。独立测试者代码重构 A/B 测出约束底座增量：纪律性 8→10（+2），首次通过率 60%→100%（+40%），但存在知识传递效应未排除的方法论局限（见 [反案例 001](./anti-cases/001-benchmark-self-test-circularity.md) 和 [WorkBuddy A/B 警告](./benchmark/2026-06-23-workbuddy-ab.md)）。

---

## 实证仪表盘

> 持续使用 >1 周的用户数：1 家。FDE 部署完成但尚未进入持续使用的：3 家。如果你在用——不是测试，是日常在用——请告诉我们用了多久。
>
> （注：Case 016-019 原始部署报告/workflow.yaml 在部署企业内网，联系维护者获取。）

---

## 最小证据模板

> 第一次用？填 3 个数字 + 1 句话就行。填完不超过 1 分钟。

| 指标 | 你填 |
|------|------|
| 用了多少天 | __天 |
| 遇到几次 Agent 跑偏 | __次 |
| 其中几次被 sofagent 拦住了 | __次 |

**一句话感受**：___

> 哪怕只有 1 个数据点也有价值——这是 sofagent 从「概念验证」到「能用的工具」的关键一步。

---

| 日期 | 测试人 | 平台 | 使用时长 | 任务数 | 装上了吗 | 有变化吗 | token 消耗 | 踩坑记录 | 一句话结论 |
|------|------|------|------|:--:|:--:|------|------|------|------|
| 2026-06-18 | [@cedric123123](https://github.com/cedric123123) | OpenClaw (kimi-k2.5) | 一次性测试 | 1 次 | ✅ 能 | 机制跑通（A0+编排+3检查点+闭环），效果待核验 | ~27K/任务 | markdown模块缺失→自动安装重试（+30s） | **sofagent 全流程首次在第三方环境跑通：28分钟完成复杂旅行规划，输出6文件，Loop 3检查点100%通过（Agent 自评，未经人工核验）。详见 [Case 001](./cases/italy-travel-2026-06-18/)。** |
| 2026-06-18 | KongFangXun | WorkBuddy (DeepSeek V4 Pro) | 一次性测试 | 1 次 | ✅ 能 | 闭环跑通（task/logs+think.md），加载链第1层漏读 | ~15K/任务 | constitution/双文件命名歧义→Agent跳过宪法层 | **作者自测：WorkBuddy 闭环机制跑通，但发现加载链第1层漏读（v0.56已修）。详见 [Case 002](./cases/workbuddy-self-test-2026-06-18/)。** |
| 2026-06-19 | KongFangXun | OpenClaw 2026.6.8 (DeepSeek V4 Flash) | 一次性测试 | 8 次 | ✅ 能 | 全链路跑通：三层加载链 + ao compose 子 Agent + loop-check 闭环 + **跨任务反思验证通过**（TC05 PASS） | ~26K/任务 | ① load-chain.sh 在 openclaw.json 新架构不兼容（P0 已修）② 并行报告未落盘 ③ scoring 未逐任务刷新 | **Case 003：v0.64 开发者全链路 E2E + 跨任务反思验证。Task1 写入反思 → Task2 新会话显式引用「think.md 指出路径可能不匹配」，证明反思跨会话生效。详见 [Case 003](./cases/openclaw-e2e-2026-06-19/) 和 [testing.md](../guides/testing.md) TC05。** |
| 2026-06-20 | qinanxie199229@gmail.com | Codex | 一次性测试 | 10 次 | ✅ 能（需规避脚本问题） | 明显改善：首次交付无需纠错率 0%→100%（10/10） | 未采集 | ① install.sh Codex 分支 SOFAGENT_DATA 未初始化（P0 已修）② verify.sh 误查 OpenClaw Hook（P0 已修） | **Case 004：首个 Codex 平台第三方测试。1 次完整可审计 + 9 次用户确认等效样本，10 次连续任务全部首次交付成功。详见 [Case 004](./cases/codex-stability-2026-06-20/)。** |
| 2026-06-20 | KongFangXun | WorkBuddy (DeepSeek V4 Pro + ao compose via DeepSeek API) | 一次性测试 | 16 项测试 | ✅ 能 | **全栈验证通过**：约束层 5/5 + 编排引擎链路通 + ao compose（API）跑通 + 模板注入正常 | ~49K/会话 | ao compose CLI provider 跨 3 模型失败（YAML 不兼容）；checkpoint 靠 Agent 自觉 | **Case 005：v0.71 全栈验证通过，发现 provider 兼容性 + checkpoint 纪律 2 项改进点。详见 [Case 005](./cases/workbuddy-constraint-ao-test-2026-06-20/)。** |
| 2026-06-20 | KongFangXun | OpenClaw 桌面 + CLI (DeepSeek) | 一次性测试 | 6 项约束 + 3 项编排 + ao compose | ✅ 能 | **双平台全通**：OpenClaw 桌面端 Hook 加载链 100% + WorkBuddy Agent 自觉加载链 100%。v0.71 新增任务准入拒绝首次生效 | ~35K/会话 | API Key 过期导致 ao compose 静默失败（已换 Key 修复）；engine.md 缺安装提示 | **v0.71 双平台运行时测试全部通过。加载链在非 OpenClaw 平台命中率从历史 0-33% 提升到本次 100%（单次样本）。详见 [testing.md](../guides/testing.md) 用例 9-12。** |
| 2026-06-22 | @liudi8785-cell | OpenClaw (v0.82) | 一次性测试 | 8 维度 | ✅ 能 | **8/8 全通过**：Hook 加载链 100% + 系统级断路器 + session.spawn 评判器隔离 | — | daemon-status.sh 显示 stopped（进程实际在运行）；旧版 hook 残留 | **OpenClaw 是唯一全维度通过的平台。verify.sh 41 通过 0 失败。详见 [Case 007](./cases/openclaw-v082-2026-06-21/)。** |
| 2026-06-22 | @yeqingan | WorkBuddy (v0.52 实装) | 一次性测试 | 8 维度 | ❌ 不能 | **治理加固全失效**：scripts/ 缺失，步数闸/熔断闸/幂等检查全降级为 prompt 自觉 | — | v0.52 skill 不含 scripts/ 目录（🔴 P0）；评判器隔离 ❌ 自评 | **WorkBuddy 是「守规矩的 prompt 框架」——能加载 SKILL.md 但脚本级治理全不可用。详见 [Case 008](./cases/workbuddy-v082-2026-06-22/)。** |
| 2026-06-22 | @kangjianrong | Codex (v0.82) | 一次性测试 | 8 维度 | ✅ 能（安装） | 安装+加载通过，治理靠自觉 | — | verify.sh Skills 路径统计瑕疵（🟡 中） | **Codex 安装烟测+平台验证通过。codex exec 真实加载测试：AGENTS.md → fde.md → SKILL.md 跑通，正确回答 4 条底线。详见 [Case 009](./cases/codex-v082-2026-06-22/)。** |
| 2026-06-22 | @cedric123123 | Hermes Agent (v0.82, deepseek-v4-pro) | 一次性测试 | 8 维度 | ❌ 不能 | **4 项治理全失效**：熔断闸实测连续 5 次调用不存在 API 未熔断 | — | daemon 脚本缺失；engine.md 不自动加载；think.md 不存在 | **最诚实的测试。prompt 级约束在 Hermes Agent 上完全不生效。L1+L3 加载超预期（Agent 主动搜索）。详见 [Case 010](./cases/hermes-v082-2026-06-22/)。** |
| 2026-06-22 | KongFangXun | Claude Code (v0.82) | 一次性测试 | 8 维度 | ❌ 不能 | **0/8 硬约束生效**：scripts/ 未部署，编排引擎完全失效 | — | scripts/ 未部署（🔴）；CLAUDE.md 种子指令未写入（🟡）；daemon 不检测 claude（🟡） | **Claude Code 与 Hermes Agent 同属"手动平台"。三个断裂点导致效果 = 0。详见 [Case 011](./cases/claude-v082-2026-06-22/)。** |
| 2026-06-24 | @jm4170134-droid（小嘉） | Mac mini (DeepSeek Reasoner, v0.86 tag) | 一次性测试 | 5 任务 A/B | ✅ 能 | **5 维度全正向**：陷阱注释全部保留 vs 部分移除、exports 完整 vs 遗漏、首次无 bug 5/5 vs 4/5、类型严谨 vs `any` 绕过 | — | N=1 单次运行（方差未知）；反序组设计（B 先 A 后）；评估非盲 | **社区第三方 A/B：5 个代码重构任务，sofagent 组全面优于裸 Agent 组。两组同模型（DeepSeek Reasoner），唯一变量是 sofagent 有无。详见 [Case 012](./cases/community-ab-test-2026-06-24/)。** |
| 2026-06-24 | @cedric123123（明我小助手） | OpenClaw main session (Opus 4.7) | 一次性测试 | task6 + task7 | ✅ 能 | **16/16 满分，但数据不可信**：6 个方法论硬伤导致无法归因 | task6: ~150K / task7: ~226K | 🔴 实际加载 v0.81-0.85 非 v0.86 / 🔴 无对照组 / 🔴 模型未控制（Opus vs deepseek）/ 🟡 N=2 / 🟡 task7 过于显眼 / 🟡 MEMORY.md 污染 | **满分报告 ≠ 可信报告。task6 读型分流 8/8 + task7 Loop 退出 8/8，但版本错配 + 无对照 + 模型混淆。方法论教训详见 [反案例 003](./anti-cases/003-test-methodology-pitfalls.md)。** |
| 2026-07-01 | KongFangXun | WorkBuddy + OpenClaw (deepseek-chat, v0.99) | 一次性测试 | 49 用例 + ao compose | ✅ 能 | **确定性测试 42/49 通过，2 个 P0（npm pack 打包源文件 + bin 无执行权限）当场修复**；ao compose 4 并行多智能体审查编排成功（76s / 57K token），但 Agent 无法自动读项目文件，审查为模拟性 | ~58K/会话 | ao compose Agent 无文件注入能力（P1）；audit-history 目录路径不一致（P2 已修）；MCP 未初始化时重复响应（P2 已修）；非 git 仓库无友好提示（P2 已修） | **Case 013：v0.99 发版前三线并行测试（确定性 + DeepSeek 代码审查 + ao 多智能体）。核心代码全绿：398 测试 + tsc 零错误 + 版本号 34 项一致 + 零依赖属实 + 命令注入防护到位。3 个 P0 + 10 个 P1 + 3 个 P2 全部当场修复。ao compose 工作流结构正确（4 并行+汇总），但发现 Agent 无文件注入能力是编排引擎的下一个改进点。** |
| 2026-07-01 | AI Agent（WorkBuddy + OpenClaw 自动执行） | WorkBuddy + OpenClaw 2026.6.8 (deepseek-chat, v0.99.2) | 一次性测试 | 6 TC 自动化测试套件 | ✅ 能 | **6/6 全绿**：daemon 核心功能 + verifysh 50 项（注：v0.99.2 时 verify 报 50 项，v0.99.3 后实测 41 项） + MCP 4 tools + 审计六步闭环 + ao 0.7.5 + macOS 全绿。v1.0 准入条件 3 项 ⏳→✅ | ~15K/会话 | TC-1 daemon 需重试一次（macOS 无 timeout 命令，改用后台进程+sleep）；install.sh 存在但缺 darwin 平台分支代码 | **Case 014：v0.99.2 审查驱动质量修复 + 本地验证。18 个问题修复（3 P0 + 9 P1 + 6 P2），406 测试全绿，版本号 33 项一致。测试由 Agent 自动执行，零人工介入。详见 [Case 014](./cases/v0992-release-test-2026-07-01/)。** |
| 2026-07-01 | 关联企业同事 | WorkBuddy (deepseek-chat, v0.99.2) | 一次性测试 | 5 TC 靶向违规构造 | ✅ 能 | **5/5 100% 检出**：A2 密钥/A3 越界/A4 删配置/A5 commit/E1 缺测试。A3 守门员效应确认。扩展规则框架正常。 | ~3K/会话 | 靶向构造非真实场景；未测误报率；密钥正则要求 48 字符 | **Case 015：审计引擎检出率首次外部实测。关联企业同事在独立仓库中构造已知违规，全部检出。详见 [Case 015](./cases/v0992-audit-detection-2026-07-01/)。** |
| 2026-07-02 | FDE（Agent 辅助）| OpenClaw (macOS, v0.99.4) | FDE 部署 | 71+ 工作流节点 + 2 🔄 节点 | ✅ 能 | 制造业 200+人，7部门梳理，4小时产出完整部署方案 + workflow.yaml | — | 需批量导入功能；管理类节点判定标准需增强 | **Case 016：锂电制造企业 FDE 部署——半天走完传统咨询 1-2 周的工作量。详见 [Case 016](./cases/fde-forever-battery-2026-07-02/)。** |
| 2026-07-02 | Cedric（今绘行空）| OpenClaw (Windows, v0.99.4) | FDE 部署 | 5 岗位 25 节点 + 1 🔄 上线 | ✅ 能 | 5人微团队，2小时走完十步，1个🔄节点已上线钉钉每日推送。首个 Windows 外部验证 | — | PowerShell curl 别名冲突；中文推送乱码 | **Case 017：农业科技微团队 FDE 部署——Windows 环境全链路跑通。详见 [Case 017](./cases/fde-jinhui-2026-07-02/)。** |
| 2026-07-02 | 小嘉（蔓嘉电商）| OpenClaw (macOS, v0.99.4) | 持续使用 ~3 周 | 2 🔄 节点日常运转 | ✅ 能 | 电商运营 2 个 🔄 节点已上线运转（周报+对账），年释放 ~440-590 小时。截至 2026-07-04 运行约 3 周 | — | 平台反爬限制运营数据获取；需离线安装文档 | **Case 018：电商运营 FDE 部署——首个持续使用的外部案例。详见 [Case 018](./cases/fde-manjia-2026-07-02/)。** |
| 2026-07-02 | 姚旭琛（上善能及）| OpenClaw (macOS, v0.99.4) | FDE 部署 | 2 产线 Agent + 1 知识库 Agent 规划 | ✅ 能 | 已有 2 个产线 Agent 稳定运行数月，FDE 部署新 Enterprise 知识库 Agent。产出 10+ 份方案文档 + Phase 1 代码 | — | Webhook 机器人单向限制 | **Case 019：能源科技 FDE 部署——在已有 AI 基础设施上扩展新 Agent。详见 [Case 019](./cases/fde-shangshan-2026-07-02/)。** |
| 2026-07-05 | KongFangXun | OpenClaw 0.7.5 + WorkBuddy (v0.99.7) | 一次性测试 | 8 场景全链路 | ✅ 能 | **5/7 核心 ✅ + 2/7 环境限制**：安装 0.39s 48 项检查 / 审计 A1+A2 双检出 / 加载链 3 层完整 / 编排 74.8s 5 步 / MCP 3 工具+3 资源 | — | daemon sandbox 阻止 pid 写入；webhook 需真实 URL；A2 不检测 sk-proj- 新格式 | **Case 020：v0.99.7 全链路实测——安装/审计/加载链/编排/MCP 五大核心全通。verify.sh 检查集扩容到 48 项。详见 [Case 020](./cases/v0997-fullchain-test-2026-07-05/)。** |
| 2026-07-05 | OpenClaw (代 Cedric) | Windows 10 (v0.99.8) | 一次性测试 | 5 极限场景 | ✅ 能 | **审计引擎极限能力验证**：100 文件 8.76s 零误报 / 200KB 单行检出 / 4 种 secret 全检出 / 5 种工作模式全通 | — | pre-commit hook 硬编码本地路径（P1）；JSON 输出 PowerShell 编码问题（P2）；base64 secret 未检出（P3） | **Case 021：审计引擎技术能力验证（Windows 极限测试）。非准入 #7 交付物——平台/测试人/场景不匹配外部用户验证计划。但作为审计检出精度证据价值很高。详见 [Case 021](./cases/v0998-extreme-audit-test-2026-07-05/)。** |
| 2026-07-05 | OpenClaw (代 Cedric) | Windows 10 (v0.99.8) | 一次性测试 | 7 组对比 | ✅ 能 | **有 vs 无 sofagent 对比**：无审计 5 处 secret 全部入库；有审计 5/5 全拦截。100 文件 8.76s 精准定位 | — | — | **Case 022：审计引擎价值对比展示——「没有 sofagent，secret 泄露不是会不会发生，而是什么时候被发现」。详见 [Case 022](./cases/v0998-audit-comparison-2026-07-05/)。** |
| 2026-07-06 | @cedric123123 | macOS 15.x · Node 24 (v0.99.8) | 一次性测试 | 8 场景 + 8 极限 | ✅ 能 | **8/8 全通，8.5/10**：ao compose→run 全链路 / MCP 9 种 JSON-RPC / 10000 行 99ms / 真实企业案例（上善能及 11 份交付物） | — | sk-proj- 漏检（P0 已修）；hook 路径硬编码（P0 已修） | **Case 023：v1.0 准入 #7 外部用户验证 #1——全链路+极限测试+真实 FDE 案例。详见 [Case 023](./cases/v0998-external-cedric-2026-07-06/)。** |
| 2026-07-06 | @xue52101-lzk | macOS 23.5 · Node 25 (v0.99.8) | 一次性测试 | 8 场景 | ✅ 能 | **8/8 全通，8.5/10**：FDE 模拟部署 14 AI 节点（3 部门 ¥700K+/年）/ daemon 完整日志 / ao demo 4 角色 | — | — | **Case 024：v1.0 准入 #7 外部用户验证 #2——FDE 企业部署模拟+daemon 全链路。详见 [Case 024](./cases/v0998-external-lzk-2026-07-06/)。** |
| 2026-07-06 | @Atreides-coder（小嘉） | macOS 15.6 · Node 24 (v0.99.8) | 一次性测试 | 8 场景 + 反馈表 | ✅ 能 | **8/8 全通，8.0/10**：最详细反馈表 / 发现 daemon 行为与文档不一致 / install 15s 丝滑 / 审计 0 误报 | — | daemon 行为与文档不符（P1 文档）；hook 路径硬编码（P0 已修） | **Case 025：v1.0 准入 #7 外部用户验证 #3——最详细反馈，发现 daemon 文档不一致+hook 路径问题。详见 [Case 025](./cases/v0998-external-xiaojia-2026-07-06/)。** |

> 使用时长分类：**一次性测试**（装上跑完验证就停了）/ **持续使用 N 天**（日常工作在使用）/ **弃用**（装过但不用了——**请写原因，这对我们最有价值**）

---

## 基准测试

> 可复现对比测试结果。运行 `bash sofagent/scripts/verify.sh --quiet`（检查全绿即 ✓）。
>
> 说明：benchmark.sh 已在 v0.99.2 移除，部署验证改用 verify.sh。

历史 benchmark 实验记录见 [benchmark/](./benchmark/) — 存档参考，不再自动更新。

---

## 社区贡献区

你的数据。格式不限，真实就行。

---

## 量化锚点（v0.95 设计锚点，v1.0 启动数据采集）

> 对标 Andrej Karpathy「LLM 原始编码错误率 41% → 人审后 11%」——sofagent 的目标是用约束底座 + 审计层在无人审的情况下逼近人审后水平。

| 指标 | 定义 | 基线（裸 Agent） | v0.95 目标 | 测量方式 |
|------|------|:--:|:--:|------|
| Agent 违规率 | 触发铁律/审计规则的任务占比 | 待采集（v1.0 启动） | < 11% | A/B 对照，sofagent 组 vs 裸 Agent 组 |
| 审计检出率 | git diff 规则命中已知问题的比例 | 0%（无审计） | > 80% | 人工标注违规集 → 跑 audit → 计算召回率 |
| 误报率红线 | 审计报告为 FAIL 但实际无问题 | — | < 5% | 每批 FAIL 报告人工复核，误报 / 总 FAIL |
| 首次通过率 | 任务无需返工即交付的比例 | 待采集（v1.0 启动） | > 85% | A/B 对照计数 |

> ⚠️ 以上目标为 v0.95 设计锚点，非已验证数据。「基线」列标「待采集（v1.0 启动）」的指标需独立第三方跑——作者自测不算数。

> 💡 为什么选 11%？Karpathy 的数据是人审后的错误率下限。sofagent 的命题是：**用机器审计替代人审，能不能逼近同一个下限。** 能不能做到是 v1.0 才能回答的问题——v0.95 先把测量框架搭好。

> 📌 行业趋势（Loop Engineering）见 [ARCHITECTURE.md](../../ARCHITECTURE.md)「架构基因」节——Ralph 循环被列为 Loop Engineering 的前期基础，sofagent 的设计方向与行业共识一致。
