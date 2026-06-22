# Evidence.md — sofagent 真的有用吗？

> 我们不替你回答。以下是装了 sofagent 的人自己记录的。

> ⚠️ **诚实声明**：以下数据含作者自测。复盘评分为 LLM 自评（非 OpenClaw 平台无工程隔离）。企业级评估请等待 v0.9 加密 + 外部评估器。当前数据适合探索性评估，不适用于生产决策。

> 📊 **A/B benchmark 数据**：v0.75 首轮 benchmark 已跑——4/10 约束层任务 PASS（任务 1/3/4/10），6/10 编排层任务 🔲 待独立会话验证。「不带 sofagent」对比侧因单会话自测限制标记为「无法自测」。详见 [docs/benchmark/2026-06-21.md](./benchmark/2026-06-21.md) | 方法论文档：[反案例 001](./anti-cases/001-benchmark-self-test-circularity.md)

---

## 实证仪表盘

> 持续使用 >1 周的用户数：待统计。如果你在用——不是测试，是日常在用——请告诉我们用了多久。

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
| 2026-06-18 | [@cedric123123](https://github.com/cedric123123) | OpenClaw (kimi-k2.5) | 一次性测试 | 1 次 | ✅ 能 | 机制跑通（A0+编排+3检查点+闭环），效果待核验 | ~27K/任务 | markdown模块缺失→自动安装重试（+30s） | **sofagent 全流程首次在第三方环境跑通：28分钟完成复杂旅行规划，输出6文件，Loop 3检查点100%通过（Agent 自评，未经人工核验）。详见 [Case 001](./docs/cases/italy-travel-2026-06-18/)。** |
| 2026-06-18 | KongFangXun | WorkBuddy (DeepSeek V4 Pro) | 一次性测试 | 1 次 | ✅ 能 | 闭环跑通（task/logs+think.md），加载链第1层漏读 | ~15K/任务 | constitution/双文件命名歧义→Agent跳过宪法层 | **作者自测：WorkBuddy 闭环机制跑通，但发现加载链第1层漏读（v0.56已修）。详见 [Case 002](./docs/cases/workbuddy-self-test-2026-06-18/)。** |
| 2026-06-19 | KongFangXun | OpenClaw 2026.6.8 (DeepSeek V4 Flash) | 一次性测试 | 8 次 | ✅ 能 | 全链路跑通：三层加载链 + ao compose 子 Agent + loop-check 闭环 + **跨任务反思验证通过**（TC05 PASS） | ~26K/任务 | ① load-chain.sh 在 openclaw.json 新架构不兼容（P0 已修）② 并行报告未落盘 ③ scoring 未逐任务刷新 | **Case 003：v0.64 开发者全链路 E2E + 跨任务反思验证。Task1 写入反思 → Task2 新会话显式引用「think.md 指出路径可能不匹配」，证明反思跨会话生效。详见 [Case 003](./docs/cases/openclaw-e2e-2026-06-19/) 和 [TESTING.md](./docs/TESTING.md) TC05。** |
| 2026-06-20 | qinanxie199229@gmail.com | Codex | 一次性测试 | 10 次 | ✅ 能（需规避脚本问题） | 明显改善：首次交付无需纠错率 0%→100%（10/10） | 未采集 | ① install.sh Codex 分支 SOFAGENT_DATA 未初始化（P0 已修）② verify.sh 误查 OpenClaw Hook（P0 已修） | **Case 004：首个 Codex 平台第三方测试。1 次完整可审计 + 9 次用户确认等效样本，10 次连续任务全部首次交付成功。详见 [Case 004](./docs/cases/codex-stability-2026-06-20/)。** |
| 2026-06-20 | KongFangXun | WorkBuddy (DeepSeek V4 Pro + ao compose via DeepSeek API) | 一次性测试 | 16 项测试 | ✅ 能 | **全栈验证通过**：约束层 5/5 + 编排引擎链路通 + ao compose（API）跑通 + 模板注入正常 | ~49K/会话 | ao compose CLI provider 跨 3 模型失败（YAML 不兼容）；checkpoint 靠 Agent 自觉 | **Case 005：v0.71 全栈验证通过，发现 provider 兼容性 + checkpoint 纪律 2 项改进点。详见 [Case 005](./docs/cases/workbuddy-constraint-ao-test-2026-06-20/)。** |
| 2026-06-20 | KongFangXun | OpenClaw 桌面 + CLI (DeepSeek) | 一次性测试 | 6 项约束 + 3 项编排 + ao compose | ✅ 能 | **双平台全通**：OpenClaw 桌面端 Hook 加载链 100% + WorkBuddy Agent 自觉加载链 100%。v0.71 新增任务准入拒绝首次生效 | ~35K/会话 | API Key 过期导致 ao compose 静默失败（已换 Key 修复）；engine.md 缺安装提示 | **v0.71 双平台运行时测试全部通过。加载链在非 OpenClaw 平台命中率从历史 0-33% 提升到本次 100%（单次样本）。详见 [TESTING.md](./docs/TESTING.md) 用例 9-12。** |
| 2026-06-22 | @liudi8785-cell | OpenClaw (v0.82) | 一次性测试 | 8 维度 | ✅ 能 | **8/8 全通过**：Hook 加载链 100% + 系统级断路器 + session.spawn 评判器隔离 | — | daemon-status.sh 显示 stopped（进程实际在运行）；旧版 hook 残留 | **OpenClaw 是唯一全维度通过的平台。verify.sh 41 通过 0 失败。详见 [Case 007](./cases/openclaw-v082-2026-06-21/)。** |
| 2026-06-22 | @yeqingan | WorkBuddy (v0.52 实装) | 一次性测试 | 8 维度 | ❌ 不能 | **治理加固全失效**：scripts/ 缺失，步数闸/熔断闸/幂等检查全降级为 prompt 自觉 | — | v0.52 skill 不含 scripts/ 目录（🔴 P0）；评判器隔离 ❌ 自评 | **WorkBuddy 是「守规矩的 prompt 框架」——能加载 SKILL.md 但脚本级治理全不可用。详见 [Case 008](./cases/workbuddy-v082-2026-06-22/)。** |
| 2026-06-22 | @kangjianrong | Codex (v0.82) | 一次性测试 | 8 维度 | ✅ 能（安装） | 安装+加载通过，治理靠自觉 | — | verify.sh Skills 路径统计瑕疵（🟡 中） | **Codex 安装烟测+平台验证通过。codex exec 真实加载测试：AGENTS.md → rules.md → SKILL.md 跑通，正确回答 4 条底线。详见 [Case 009](./cases/codex-v082-2026-06-22/)。** |
| 2026-06-22 | @cedric123123 | Hermes Agent (v0.82, deepseek-v4-pro) | 一次性测试 | 8 维度 | ❌ 不能 | **4 项治理全失效**：熔断闸实测连续 5 次调用不存在 API 未熔断 | — | daemon 脚本缺失；engine.md 不自动加载；think.md 不存在 | **最诚实的测试。prompt 级约束在 Hermes Agent 上完全不生效。L1+L3 加载超预期（Agent 主动搜索）。详见 [Case 010](./cases/hermes-v082-2026-06-22/)。** |
| 2026-06-22 | KongFangXun | Claude Code (v0.82) | 一次性测试 | 8 维度 | ❌ 不能 | **0/8 硬约束生效**：scripts/ 未部署，编排引擎完全失效 | — | scripts/ 未部署（🔴）；CLAUDE.md 种子指令未写入（🟡）；daemon 不检测 claude（🟡） | **Claude Code 与 Hermes Agent 同属"手动平台"。三个断裂点导致效果 = 0。详见 [Case 011](./cases/claude-v082-2026-06-22/)。** |

> 使用时长分类：**一次性测试**（装上跑完验证就停了）/ **持续使用 N 天**（日常工作在使用）/ **弃用**（装过但不用了——**请写原因，这对我们最有价值**）

---

## 基准测试

> 可复现对比测试结果。运行 `bash sofagent/scripts/benchmark.sh --platform 你的平台` 生成。

详见 [docs/benchmark/](./docs/benchmark/) — 每次运行自动更新。

---

## 社区贡献区

你的数据。格式不限，真实就行。
