# VALIDATION 印证归档 · FDE 市场面 + Harness 研究（v1.5.7 文档减重）

> 原属 `docs/VALIDATION.md`，按 [06-doc-finalize 步骤④](../../changelog/releasing/06-doc-finalize.md)「>3 行印证全文须在 docs/archive/validation-deep/ 有归档件、原地留摘要 + 指针」迁出，**原文逐字保真**。

## 1 · 原 `docs/VALIDATION.md` L246-253

- **FDE 岗位爆发**：MIT NANDA「95% 项目零财务回报」vs FDE 岗位一年涨 **729%**（Indeed 2025）——模型不稀缺了，能把模型塞进真实业务的人/工具才稀缺。Foundation Capital 估 $4.6T 量级市场：软件收费对象正从「工具预算」换成「人力预算」。
- **FDE-as-a-Service 被资本验证**：Anthropic 收购 Fractional AI、Accenture×Anthropic 3 万人 FDE 受训、Blackstone+H&F+Goldman 共建、Anthropic 接入 Palantir FedStart。
- **FDE 赛道十亿美金级定价（2026）**：Fireworks AI（D 轮 $15.05 亿 @ $17.5B）、Wonderful（C 轮 $5.5 亿 @ $5B、20 个月 650 人 FDE 团队）、AWS 投 $1B 组 FDE 组织——**FDE 不是过渡性岗位，是被资本市场按基础设施定价的赛道**。
- **受监管行业规模化**：TCS×Anthropic 56 国 5 万员工、DXC 联盟、Infosys 电信共建——「卖能力不卖工时」在强监管客户侧已被头部 SI 验证。
- **中国市场三信号**：本土 FDE 人才白皮书（招聘标准与定价 thesis 缺的中国底）· 中信证券研报（本土机构级分析）· **政策双信号**（国家数据局「本体三件套」入国家级清单 + 上海「培育 FDE 队伍」入地方产业政策）——「先约束后智能」获政策层背书。
- **同形态平台 Octop（腾讯云开源）**：**层位不同即非竞品**——Octop 是 Agent 应用平台（运行时+壳），sofagent 是治理与判定控制平面；其无 append-only 审计链/无决策留痕恰是 sofagent 治理面的**接入价值实证**；Roadmap「自动蒸馏 skill 无准入门」正是本仓治理面要防的形态。
- **Ontology 赛道开源竞品**（2026-08 二次深挖）：Semantica 真身 = 「问责层」而非全栈（双时态+PROV-O 是独特性，无 Action 闭环）⇒ 本仓不必追全栈，「问责层 + 行动闭环」恰是已有布局；OpenBKN / ontology-driven-platform 验证范式被复刻但「差的不是方向是厚度」；混合检索实测（38k→12k、82.1%→89.2%）已登记升级候选。
- **Harness 工程赛道补充**：AutoHarness（决策引擎跑在模型上下文之外，shadow mode 与「只提示不阻断」同源）/ harness-kit（doom loop 检测与 FORGE 重复率熔断同源）。

## 2 · 原 `docs/VALIDATION.md` L263-271

- **Harness-MU**（[arXiv:2606.21856](https://arxiv.org/abs/2606.21856)）：GPT 基座指令跟随 42.2%→91.2%（+48.9pt；冲突模式 30.9%→78.1%），访问控制攻击下隐私零泄露，wall-time 反降 11%。
- **GLM-5.3-Flash 安全涌现**：约束下的编程能力即安全能力（CyberGym 84.5%）。
- **JitRL**（[arXiv:2601.18510](https://arxiv.org/abs/2601.18510)，ICML 2026 Spotlight）：轨迹检索调制输出分布，权重不动，成本约梯度微调 1/30。
- **QWM**（[arXiv:2608.17163](https://arxiv.org/abs/2608.17163)，Stanford）：Q 搜索（评估状态+动作）显著强于 V 搜索（只评估状态）。
- **HarnessDev**（[arXiv:2609.01437](https://arxiv.org/abs/2609.01437)，字节 Seed）：同一 GPT-5 权重仅换 harness，Terminal-Bench 35.2%→49.6%；held-out 仅剩 +1.43——保留判定须用外部信号。
- **Aspire**（[arXiv:2608.31111](https://arxiv.org/abs/2608.31111)）：24 个 run 仅 1/12 超基线，继续训练会抹掉此前的改进。
- **ES vs RL 多样性**（[arXiv:2608.12679](https://arxiv.org/abs/2608.12679)）：ES 相比 RL checkpoint 减少回退、失败时保留更高答案熵。
- **S³Gym**（[arXiv:2608.31100](https://arxiv.org/abs/2608.31100)，字节 Seed）：自评判与环境真值一致率 0.88 但价值估计误差同样 0.88；评判准确度与下一步改进几乎零相关（r=-0.23）。
- **SkillZip**（[arXiv:2608.11079](https://arxiv.org/abs/2608.11079)，阿里×浙大×杜克）：第 1 轮起压缩的技能长度钉在 1.6-1.9 倍，第 8 轮才清理的涨到 2.6 倍追不回。

