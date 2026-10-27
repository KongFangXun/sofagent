# sofagent 行业印证与生态定位 · Validation

<p align="center"><img src="assets/sofagent.png" alt="sofagent" width="96" /></p>

> v1.7.0 · 2026-10-22（GMT+8）· ✅ 已发版 · 孔放勋

> **本文档从四个维度回答一个问题：行业有没有独立验证 sofagent 的直觉？** ① 方法论——约束层为什么是刚需；② 生态位——sofagent 在 Agent 三层模型中的位置；③ 架构——行业框架怎么独立复现 sofagent 的选择；④ 市场——技术判断有没有被买单。四维同指一结论：**不管 Agent 怎么搭、在哪跑，它需要一个独立的约束层。**
> 收录纪律（doc-slim 批起）：正文每条印证 = 一句判据 + 出处链接（≤3 行）；成篇深论证全文归档 [`docs/archive/validation-deep/`](./archive/validation-deep/README.md)。



## 零样本基线（v1.6.0 · 自产 · 不修饰）

> 口径：零样本 · 单次运行 · 自产（**引用他人数字不构成基线**）；mock 契约编码器（`mock-contract-v1`——真基座接入排期 v1.8.0 一体机离线推理，本版以契约接口落地）；可复算产物入仓（`datasets/baseline-zero-shot-run.js` + `baseline-zero-shot-result.json`）。**「校准已验证」与「校准是设计目标」分档：本版 ECE 落数只允许后一种表述**（构造已知题集复算归阶段二前置输入）。

| 指标 | 数值 | 备注 |
|---|---|---|
| 逐判据准确率（q-block） | **0.500** | = 随机基线（零样本判定力不足——**预期内，不修饰**） |
| 中英分列 | zh 0.667 / en 0.333 | 落差 0.333 超阈 ⇒ **不宣称中文可用**（也不宣称英文） |
| ECE（总/中/英） | 0.500 / 0.333 / 0.667 | 校准现状确认阶段二必要性 |
| 分布内 / 外 | 0.500 / **not-measured** | 泛化落差显式（合并会平均掉风险信号）；分布外读数原记 0.000 系**空 OOD 集默认值非实测**（样本 6 条全为分布内）——v1.7.0 §六口径修正为 `not-measured`（空集复扫值不得以数值形态出现；OOD 样本已随最小子集入集，实测待实机） |
| 失败模式 | en 侧 `completely-stuck` | 阶段二训练重点输入（该判据零样本完全跑不动） |
| 耗时 | 1 ms（6 样本） | 单次评测成本（预算分配分母） |

**失败模式清单（按语言分开报）**：zh 侧无分类命中（样本量 3 不足以稳定分类）；en 侧 `q-block:completely-stuck`（准确率低于随机基线）。**已知失灵面**：契约编码器无语义表征——算术/计数/日期比较类、间接问句、干扰上下文均属预期失灵面（本批未单独采样，登记为阶段二采样扩展项）。**诚实性**：基线难看是预期内的——其价值在于把「训练能带来多少提升」变成可量化问题。

## RLCD 训练读数（v1.7.0 §一 · 如实登记）

> **环境限制登记（不修饰）**：本版实测环境无独立 GPU 与基座权重——**本地 LoRA 档读数 `not-measured`**，移交后续版本（云侧/实机）。验收条目「本地 LoRA 档在单机上跑通」按任务书口径如实记录为**不可用，标注不推荐**（非「跑通」，不硬凑）；落数四项（墙钟耗时/峰值显存/机型+内存档位/可训参数量上限）结构先建好，读数待实测回填。学习率敏感性同理：两档表骨架在位，读数 `not-measured`。

### 规模-内存对照表（骨架 · 推理侧与训练侧分列，不得混用）

| 侧 | 基座规模 | 机型 + 内存档位 | 墙钟耗时 | 峰值资源 | 可训参数量上限 | 读数状态 |
|---|---|---|---|---|---|---|
| 训练侧（LoRA） | — | — | — | — | — | **not-measured**（本版无基座权重与独立 GPU） |
| 推理侧 | — | — | — | — | — | not-measured（v1.8.0 接线面） |

### 本地 LoRA 档落数四项（占位 · 待实测回填）

| 项 | 读数 |
|---|---|
| ① 墙钟耗时 | **云 GPU 档实测 3,265 s/seed**（8 epoch × ~380 s——`main01v5` 三 seed 完整跑完，曦云 C500）· 本机 CPU 档对照 **~1.92 h/epoch**（26,657 行 · 0.26 s/行稳态）——**本地 LoRA 档 not-measured**（本机 8GB 内存档未跑训练，见下） |
| ② 峰值显存/内存 | **云 GPU 档实测 3,926 / 65,536 MiB**（单卡 heads-only，2026-10-19 mx-smi）· 主机进程 ~23 GB/卡（torch+MACA 运行时，不随 micro-batch 缩水）· 本机 CPU 档 RSS 峰值 1.05 GB |
| ③ 机型 + 内存档位 | 云 GPU：**曦云 C500**（64GB HBM2e · 128 GiB 系统 · ¥4/卡时 · torch 2.8.0+metax）· 本机：**Mac A18 Pro · 8 GB 统一内存**（实测 `hw.memsize`=8 GiB——本地 LoRA 档在此档不可训，明确标注不推荐） |
| ④ 该内存档位下可训参数量上限 | **14,770,945 可训参数**（总参 3.22 亿 = encoder 306.9M 冻结 + act_head 198K + LoRA 适配——云 GPU 档实测落数） |

> 读数来源（引注）：factory `rsi/` 云端训练实录（`models/s1m-heads-main01v5-3seed/run-v5.log` 三 seed summary-json + `rsi/docs/CLOUD.md` §1.2/§1.4 实测表）· 日期 2026-10-18 · 基座 `jhu-clsp/mmBERT-base`。
>三 seed 训练读数：best_val_nll 1.3814 / 1.3701 / 1.3574（seed 20261013/14/15）· test_NLL 1.0669 / 1.0655 / 1.0550 · 校准温度（分原语）choice 1.21–1.28 / noul 1.43–1.55 / score 5.00 顶格（拟合上限触顶——score 原语校准信号弱，登记为跟进项）。
>⚠️ 「本地 LoRA 档跑通」验收：本机 8GB 内存档实测不可训（基座加载 18 分钟 + epoch 1.92h + 内存余量不足），按任务书「不可用则明确标注为不推荐，不修饰」如实登记——本地档移交后续实机/云侧。

### 基座选型快核表（骨架 · 两项必填字段在位）

| 基座 | 参数量 | 许可 | 目标推理硬件型号 | 该硬件上有无对应快核 | 读数状态 |
|---|---|---|---|---|---|
| `jhu-clsp/mmBERT-base` | 306.9M encoder（+198K 判定头 + LoRA 14.77M 可训） | 开源（HF 公开权重，派生自查） | 曦云 C500（训练/推理同卡）· Mac A18 Pro（本机推理档） | C500：**有**（MXMACA/PyTorch 实测跑通——mx-smi 3,926 MiB 实读）· A18 Pro：CPU/MPS 核在位（torch 2.14 MPS 可用，未做延迟实测） | **已落数（训练侧）**——推理延迟 not-measured |

> 口径（SSOT §一「基座选型的第一性问题」）：选型表须把「目标推理硬件上有无对应核」与参数量、许可证并列；本地档延迟读数必须在目标硬件上实测，**不得由云卡读数外推**——本表已落数项为 factory 云端训练实测，推理延迟仍 not-measured（未做延迟基准）。

### 学习率敏感性两档表（本机实测 · 2026-10-21 · Mac A18 Pro · MPS · main01v5 分层 200×3 片 × 3 epoch）

| 学习率档 | val_NLL 轨迹 | best_epoch | test_NLL | 判定 |
|---|---|---|---|---|
| 高 lr 档（encoder 2e-4 / head 5e-4） | 1.6909 → 1.7099 → 1.7132（**epoch 1 后回升**） | **1** | 0.9017 | 高 lr 在本数据量上**第 1 轮即到顶、后续过拟合回升**——升 lr 无增益 |
| 默认值档（encoder 2.5e-5 / head 1e-4） | 1.7264 → 1.7119 → 1.7103（**单调下降**） | 3 | 0.9171 | 默认档仍在下降通道——**配方选择有据**（沿用默认值） |

> 依据（SSOT §一「训练配方纪律」①②）：首要变量是学习率不是容量；采用他人配方须读代码默认值。**本版两档实测结论**：高 lr 档 epoch 1 见顶回升（train_NLL 1.2472 低于默认档同期 1.3128 但 val 回升——小数据上高 lr 的典型过拟合形态），默认档 3 轮单调降且 best 在末轮。**判默认档为配方起点**（与生态教训「降 lr 恢复基座能力」同向）。
>产物：`/tmp/v17-eval/lr-{default,high}/history.jsonl`（本机可复跑：`train-heads.py train --limit 200 --epochs 3`）。注：单 seed 小样本对照（数据量受本机 8GB 档约束），量级结论非终局配方——正式训练前的全量 lr 扫描归 factory 云侧。

### 冒烟回路读数（本版实测 · toy 策略回路收敛证明）

| 项 | 读数 | 产物 |
|---|---|---|
| 冒烟收敛（固定种子） | 300 步 · 末段期望斜率 < 0（tailScoreSlope 为负——收敛方向） | `engine/train/src/__tests__/rlcd-train.test.ts`（test_runSmokeLoop_* 断言）+ CLI `sofagent train rlcd --data <json>`（实测输出斜率 −4.65e-8） |
| 可复现性 | 同种子同损失序列（逐项全等断言） | 同上（test_runSmokeLoop_固定种子_*） |

> 冒烟回路是 toy 策略的**回路收敛证明**，不是基座训练效果——效果数字属 §二（校准）与 §六（对照基线）验收面（SSOT §一风险段「本版不承诺准确率数字」）。

## 校准判据纪律（v1.7.0 §三 · 既有置信度普查登记册）

> 口径：**登记不改造**——引擎内全部既有置信度数字逐条登记校准状态（多数 `uncalibrated`），实际收敛归 v1.9.0；登记面 SSOT = `engine/core/src/calibration-registry.ts`（`registerLegacyConfidenceClaims`），门禁 = `tools/check/check-calibration-claims.sh`（C1 对账：新消费点未登记即红）。运行时查询点：`intent-triage.uncalibratedDecisionPathClaims()`。

| # | 消费点 | 阈值/统计量 | 校准状态 | 决策路径 | 备注 |
|---|---|---|---|---|---|
| 1 | `decision-channel.ts:152`（DEFAULT_GRADE_THRESHOLDS.allowMinConfidence） | 0.8 / max-prob | **uncalibrated** | ✅ 是 | 三段门控高自动段边界——未在独立校准集拟合 |
| 2 | `decision-channel.ts:153`（DEFAULT_GRADE_THRESHOLDS.askMinConfidence） | 0.5 / max-prob | **uncalibrated** | ✅ 是 | 三段门控中复核段边界——未实测重标 |
| 3 | `intent-triage.ts:89`（DEFAULT_TRIAGE_CONFIG.l1MinConfidence） | 0.75 / max-prob | **uncalibrated** | ✅ 是 | L1 语义分类置信阈——embedding 置信度未校准 |
| 4 | `decision-channel.ts:288`（DEFAULT_CALIBRATION_POLICY.maxEce） | 0.05 / max-prob | **uncalibrated** | ✅ 是 | 分桶门控 ECE 线——门控参数自身无校准集读数（v1.8.0 拟合面前占位） |
| 5 | `instinct/exporter.ts:79`（DEFAULT_CONFIDENCE_THRESHOLD 消费） | 0.7 / max-prob | **uncalibrated** | 否 | instinct 导出置信门——非分流路径（导出过滤面） |
| 6 | `instinct/scorer.ts:21`（DEFAULT_CONFIDENCE_THRESHOLD 定义） | 0.7 / max-prob | **uncalibrated** | 否 | 打分头输出非概率口径 |
| 7 | `route-request.ts:163`（MATCH_THRESHOLD） | 0.2 / similarity-score | **uncalibrated** | ✅ 是 | workflow 节点匹配阈——相似度得分非概率口径，路由决策路径消费 |
| 8 | `decision-schema.ts:130`（confidence 三档） | 序数档 / ordinal-tier | **uncalibrated** | 否 | 'high'\|'med'\|'low' 留痕面非门控面 |
| 9 | `calibration-report.ts:86`（claimLevel） | — / max-prob | **uncalibrated** | 否 | v1.6.0 零样本报告 design-goal 档（未宣称 verified） |
| 10 | `calibration.ts:ECE_HARD_LINE` | 0.10 / max-prob | calibrated | 否 | 验收线本身——THRESHOLDS.md 动工前冻结值 |
| 11 | `calibration.ts:STATISTIC_NAME` | — / max-prob | calibrated | 否 | 统计量一致性对账锚（evidence.ece=0 = 声明面非实测面） |

**合计：11 条登记——uncalibrated 9 条（决策路径上 4 条）· calibrated 2 条（均为对账锚非消费阈值）。** 决策路径 4 条 uncalibrated 即 `assertNoUncalibratedInDecisionPath()` 当前为红态（如实暴露——补齐校准依据后才可过，收敛归 v1.9.0）。

### 校准实现读数（v1.7.0 §二 · 本机实测回填 2026-10-21）

| 项 | 读数 | 产物 |
|---|---|---|
| 拟合正确性 | 过度自信样本（真值 0.7 报 0.86）分桶温度拟合后 ECE 下降（单测断言） | `engine/train/src/__tests__/calibration.test.ts` |
| score 保序 | 校准前后 argmax 档一致 + 相邻档序不变（单测断言） | 同上 |
| 三原语 ECE 达阈判定 | **实测落数（main01v5 三 seed × eval 片 3,357 行 · 出厂温度 · 分原语×分语言）**——见下表 | `/tmp/v17-eval/report-s{20261013,20261014,20261015}.json` |
| 已知题集 TVD | 构造题集（袋中球/骰子/三选路/负载分档）完全重合 TVD=0 可复算 | 同上 |

**ECE 实测矩阵（三 seed 各档 · 硬线 ≤0.10）**：

| 档 | seed 13 | seed 14 | seed 15 | 三 seed 均值 | 达阈 |
|---|---|---|---|---|---|
| choice/en | 0.0282 | 0.0441 | 0.0445 | 0.039 | ✅ |
| choice/zh | 0.0682 | 0.0725 | 0.0702 | 0.070 | ✅ |
| score/en | 0.0782 | 0.0933 | 0.0856 | 0.086 | ✅（n=56 小样本） |
| score/zh | 0.0632 | 0.0717 | 0.0854 | 0.073 | ✅ |
| noul/en | 0.0348 | 0.0303 | 0.0210 | 0.029 | ✅ |
| noul/zh | 0.0658 | 0.0910 | **0.1143** | 0.090 | ⚠️ seed 15 单档超线（三 seed 均值 0.090 线内，n=185） |

> §二 ECE 硬线（0.10 · 分原语×分语言逐档）**实测判定：6 档 × 3 seed = 18 格中 17 格达线**（逐 seed 判定口径——唯 seed 15 的 noul/zh 单格 0.1143 超线 0.014；该档样本 n=185 为最小格。三 seed 均值口径则 6/6 档全达线）。**注意事项**：① 本读数用的是**出厂温度**（`rl_agent_config.json` 内嵌分原语温度——即「校准后」态），非独立校准集重拟合——严格口径的 §二「独立校准集拟合」实测仍待回填；
>② score 温度 5.00 顶格（拟合上限触顶）意味着 score 原语校准信号弱，其 ECE 达线部分来自高熵摊平——**达线不等于校准质量好**，登记为跟进项；③ 语言口径 = state CJK 占比 >30% 判 zh（snli 中文指令+英文内容的混合行按内容主体归 en）。

### 候选形态登记（v1.7.0 §四验收 · 三「评估、不默认实施」项结论落册）

> 口径：SSOT §四验收第 13 条——本章与 §二的三个「本版评估、不默认实施」候选形态逐项给出「采用 / 不采用 + 依据 + 若不采用则承接版本」。登记 ≠ 承诺，但不得空缺。

| 候选 | 结论 | 依据 | 承接版本 |
|---|---|---|---|
| **弃权专头**（§四——独立检测头：域外检测 + 判据覆盖检测，与三原语判定头并列） | **不采用（本版）** | 牵动判定头数量与训练目标（新增头的标签来源未定——候选来源「判据域边界 + 覆盖率登记」的数据面本版尚未产出）；本版以「弃权三源间接推断」交付（`decision-abstain.ts` 三源留痕 + `abstain-policy.ts` 门槛面），语义档（弃权一等输出）已落，架构档（专头）待数据面就绪后评估 | 承接：v1.8.0 起接线面（判定头交付介质定型时一并评估） |
| **二阶判定**（§四——判定分两阶：一阶答命题真伪、二阶答「这次判定本身是否可判」） | **不采用（本版）** | 与弃权专头同批的架构名（实现位依赖专头）；本版二阶所需信息面已由请求面问题 × 判据 `question` 文本比对反查覆盖（`criterion-missing` 源的留痕字段），「决策 + 概率 + 元可信度」输出契约中的元可信度位由弃权三源归因承担——显式前向输出（专头形态）未实施 | v1.8.0（与弃权专头同批评估；若专头不实施则本项持续搁置——两阶正交的架构收益须专头才可兑现） |
| **校准内建**（§二——把温度参数/校准项放进训练目标，替代事后分桶拟合） | **不采用（本版）** | 品类内未见公开实践（候选非共识）；耦合代价明确（换基座或换数据须连训练重来，失去「校准产物可分发」的解耦收益——§二已交付独立校准制品）；本版主线为事后校准（`bucketedTemperatureFit`），内建与事后**并存的可能性**（内建为主、事后兜底微调）留待实测对照后评估——无实测读数前不引入新超参（校准项权重） | v1.9.0（判定使用度量落地后——若有「训练时就没往校准走」的实测失败模式再启动内建评估） |

> 三项均为「本版评估、不默认实施 → 不采用 + 依据 + 承接版本」形态如实落数；SSOT 原文对三项的登记要求即此形态（候选不是承诺，结论不得空缺）。

## 阶段二收口（v1.7.0 §六 · 三态对照与失败模式复扫 · 如实落数）

> 口径：三态对照（零样本 / 训练后 / 校准后，同数据集 = `datasets/sofagent-typed-decisions-minimal@1.0.0`、同评测器 = `judge-eval@v1.7.0`）；**本版实测环境无基座权重与独立 GPU**（与 §一/§二 not-measured 同源）——三态读数全部 `not-measured` 哨兵态，不虚构；机制面（三态结构 / 双指标分离 / 两线独立判定 / best-of-N 列）已交付，读数待实机回填。
>判定面 SSOT = `engine/orchestrator/src/router/judge-eval.ts`（`buildThreeStateComparison` / `judgeThresholdVerdict`）。

### 三态对照表（训练后/校准后实测回填 2026-10-21 · 零样本仍 not-measured）

| 态 | 一致率 zh / en（≥0.70 分列） | ECE zh / en（≤0.10） | 读数状态 |
|---|---|---|---|
| 零样本（第一态 = 训练基座本版实测接口） | not-measured | not-measured | **not-measured**（mmBERT 裸基座（未挂判定头）的零样本读出接口未建——裸基座无判定头不可直出三原语概率，第一态须以「同头随机初始化」或 v1.6.0 语义编码器口径补测；不用 v1.6.0 mock 读数充第一态） |
| 训练后 | **zh 0.410–0.425 / en 0.653–0.659**（三 seed：13→0.399/0.659 · 14→0.420/0.658 · 15→0.425/0.653） | zh 0.037–0.062 / en 0.021–0.034 | **实测**（main01v5 eval 片 3,357 行 × 三 seed · 出厂温度出概率） |
| 校准后 | zh 0.410 / en 0.665（三 seed ensemble 概率平均） | zh 0.075 / en 0.034（**ensemble 各档**：score/all 0.131 · score/zh 0.139 超线 · noul/zh 0.109 超线） | **实测**（ensemble 合并口径——单 seed 各档见 §二矩阵） |
| best-of-N 选优（N=4，选择器 = 判定头 max-prob） | not-measured（N=3 seed 全用则无「选优」语义；N=4 需第 4 seed） | — | N 与选择器口径落数；读数待第 4 seed |

> v1.6.0 mock 读数（一致率 zh 0.667 / en 0.333）并列留档于 `datasets/baseline-zero-shot-result.json`——mock 契约编码器非真基座，跨口径不可比，**不进对照列**。
>
> 达阈裁决（2026-10-21 实测判定 · 两线独立）：概率可信度线（ECE ≤0.10 分原语分语言）——单 seed 口径 17/18 格达线（唯 seed 15 noul/zh 0.1143 超线；档级三 seed 均值 6/6 达线）；判定质量线（一致率 ≥0.70 中英分列）——zh 最高 0.425 / en 最高 0.665，两语言均未达线。⇒ 阶段三暂缓判定维持（en 差 0.035、zh 差 0.275）——训练质量是当前短板（数据量 26,653 行 vs 参照件 18,760 题五分割管线尚有差距 + score 原语一致率 0.31–0.36 全语言最弱）。
>产物：`/tmp/v17-eval/report-*.json`（本机可复跑：`train-heads.py score --ckpt <seed 产物> --input eval.jsonl` + 聚合脚本）。

### 失败模式复扫表（v1.6.0 失败模式清单 × 三态标注 + 处置动作）

| v1.6.0 失败模式 | 复扫状态 | 处置动作 |
|---|---|---|
| en 侧 `q-block:completely-stuck`（准确率低于随机基线） | **部分改善** | 专项采样已入集（`SEM-FAILURE` 五类 × zh/en——最小子集 `questions.jsonl` 含 en 侧语义失灵样本，脱离「完全跑不动」的采样前提）；训练改善幅度待实机（not-measured 环境如实标注） |
| zh 侧无分类命中（样本量 3 不足以稳定分类） | **已解决** | 最小子集每判据 zh/en 各 5 题（370 题全集 zh/en 各半 185）——分类样本量从 3 抬到判据级 5，复扫可稳定分类 |
| 契约编码器无语义表征（算术/计数/日期比较/间接问句/干扰上下文五类预期失灵面，v1.6.0 未单独采样） | **部分改善** | 五类语义失灵专项样本已入集（`SEM-FAILURE` 10 题，deterministic 标签可复算）；语义表征根因（编码器无实义理解）非采样可解——该留代码的不判定化，专项样本落数证明「判过且确实不行」，改善归训练（待实机） |
| 中英落差（v1.6.0 实测一致率 zh 0.667 / en 0.333，超阈 0.333 不宣称中文可用） | **未改善** | 机制面已交付（三态对照 zh/en 分列 + 两线分列达线不合并计）；读数改善待实机训练——**显式声明移出本版读数面，承接 = 实机训练批（阶段三前回填，见下方中英倒挂单列）** |
| OOD 0.000（空 OOD 集默认值非实测——分布外复算不可比） | **部分改善** | OOD 样本已入集（`distractor-context` 类标 `ood:true`——最小子集含分布外样本，复扫口径成立）；空集 0.000 已按验收口径修正为 `not-measured`（本文件 §零样本基线段 + `LIMITATIONS.md` §一同步）；分布外准确率实测待实机 |

### 中英倒挂单列（改善幅度报数口径）

v1.6.0 实测**一致率** zh 0.667 / en 0.333（勿与上行 ECE 行中 0.333 / 英 0.667 混淆——SSOT §六验收原文注记）。**本版实测改善幅度（2026-10-21）**：训练后 zh 0.399→0.425（三 seed 区间，Δ +0.026 较 mock 基线 −0.242）/ en 0.653→0.659（Δ +0.326 较 mock 基线）。**倒挂已消除但方向翻转**：v1.6.0「zh 高 en 低」→ 本版「en 高 zh 低 0.24」——⚠️ 注意 mock 基线是契约编码器非真基座（跨口径比较仅作方向参考）；
真实结论以三 seed 实测为准：**中文判定质量（0.41–0.43）显著低于英文（0.65–0.66），与「中文主攻位」定位形成反差**——中文样本质量/数量（proc-* 家族 cast 标签占比高）列为下一训练轮的第一改进项。

### §六四条同批记录（与 `docs/LIMITATIONS.md` §一「S1M 判定失灵面」同批）

1. **零样本 0.500**（v1.6.0 实测，逐判据准确率 = 随机基线）——可复算产物：`datasets/baseline-zero-shot-run.js` + `datasets/baseline-zero-shot-result.json`（重跑 `node datasets/baseline-zero-shot-run.js` 复算）；本版三态对照第一态 not-measured（无实机基座，不以 mock 充第一态）。
2. **中英落差**（v1.6.0 实测一致率 zh 0.667 / en 0.333，ECE 行中 0.333 / 英 0.667）——可复算产物同上；处置见上方「中英倒挂单列」。
3. **OOD 0.000 → not-measured 口径修正**——0.000 系空 OOD 集默认值非实测（v1.6.0 样本 6 条全为分布内；非 §九 52 语言扫描读数）；口径修正后空集复扫值标 `not-measured` 而非数值；可复算产物同上 + 最小子集 OOD 样本（`datasets/sofagent-typed-decisions-minimal/questions.jsonl` 中 `ood:true` 行）。
4. **校准依赖分布**——阈值/置信度绑定采集分布，漂移须重校准（门槛重标触发器已随阶段一交付）；机制面：`engine/core/src/calibration-registry.ts` 漂移监测（`recordDrift` + `checkDrift`，超阈只提示不阻断）。

> 每个对外数字附可复算产物路径；无路径的数字不得对外（无路径数字未在本段出现）。

## 目录

- [一、方法论印证](#一方法论印证行业研究怎么验证-sofagent-直觉)
- [二、生态位](#二生态位agent-三层模型与-sofagent-的位置)
- [三、架构印证](#三架构印证行业框架独立复现-sofagent-的选择)
- [四、市场印证](#四市场印证行业判断被市场买单)
- [五、研报视角的边界提示](#五研报视角的边界提示)
- [六、反面案例 / 证伪记录](#六反面案例--证伪记录)


## 一、方法论印证：行业研究怎么验证 sofagent 直觉

> 跨批行业研读里反复出现、能直接印证 sofagent 已有直觉的结论落纸。成篇论证见 [归档 · concept-layer](./archive/validation-deep/concept-layer.md) / [归档 · harness-vendors](./archive/validation-deep/harness-vendors.md)。

**▍概念层（一句话判据）**

- **骨架开场钩子**——智能体 = 多层骨架（配置/知识/指令/校验/编排）：约束层是钢筋，模型是水泥
- **Harness Engineering 范式锚点**——2025-2026 行业把它列为与 Prompt/Context/Loop 并列的范式跃迁阶段，sofagent「约束层（Harness）」字面对应。
- **确定性迁移主线**——刚性规则三段迁移（prompt 软约束 → 知识层结构化 → 代码层 100% 强制）：「桩径不能小于 600mm 这类要求必须 100% 执行，AI 只能大概率，代码才能一定」。
- **知行合一注脚**——「知而不行只是未知」：破局不是叠加规则，是让系统理解规则目的并在事前拦截——与约束注入链 + 审计硬证据同构。
- **黑盒症结**——企业 AI 落地常败于「无法证明结果正确」；审计把黑盒变白盒（git diff 硬证据、可复核）。
- **编排兜底**——LLM 不可用时确定性规则引擎照常守门（28 条规则中 22 条纯 git-diff、零 token）：纪律不绑单一模型。
- **反去人化命题**——human-in-the-loop 不是能力缺陷，是「可靠优先于自主」的差异化优势（主体性护栏不可外包）。
- **90/10 价值分层 → 知行合一框架**——模型给 90% 智力（知），约束层补 10% 可靠执行（行），关键在「合一」；模型越强那 10% 越值钱。
- **治理缺口的代价（三项联网核验）**——Gartner：2027 年 40% 企业自主 Agent 将因治理缺口被降级/停用；MIT NANDA：95% gen-AI 部署零可衡量 ROI；Governance Decay：运行时约束被上下文压缩擦除后违规率 0%→38%。
- **RSI 治理的可见性优先级（Hinton 等 22 人论文）**——首优「可见性」：自动化比例报告 + 独立第三方审计 + 越权监测，即约束层产品面；次级约束「物理硬件隔离阻断不可控网络」与本仓沙箱同构。[arXiv 2609.36054](https://arxiv.org/abs/2609.36054)（本仓未复算）

约束/治理是投产前提，非加分项。
- **a16z 七法则映射**——「人比软件便宜」与 90/10 同频；五条本仓原生具备（[完整映射表见归档](./archive/validation-digest/README.md)）。
- **Sovereign AI 四层主权框架**——「主权是光谱不是开关」「先建评测集再谈微调」与本仓模型路由不自研、Benchmark 先行完全同构（四层落点见 [v1.4.0 商业侧定位](./changelog/v1.4/v1.4.0.md)）
- **评测集是受管资产（三源收敛）**——来源：真实失败与生产流量（非合成）；规模：20-50 个真实失败案例即可起步、随版本扩展（拖越久越难补）；形态：进版本控制、接 CI（临时脚本 = 不可回归 = 假评测）。与既有 09-06「评测集所有权治理」为姊妹条：彼管归属，此管来源与形态。
  来源：Anthropic《Demystifying Evals》（IMA 收录）｜ DeepSeek Safety 官方技术报告（IMA 收录）｜ OpenRouter · https://openrouter.ai/blog/tutorials/ai-agent-regression-testing-after-a-prompt-or-model-change/
- **硅基员工论（Org Graph / Ontology Runtime）**——「长期存活、固定领域、进组织编制」的 Agent 称为 Org Graph 节点，与常驻 Agent 定位字面对应；Ontology Runtime 是企业底座而非 API 网关。
- **数字员工操作性定义**——四跨越（组织身份/岗位职责/事件驱动/结果负责）+ 结果负责三要素（可观测/可归因/可回滚），与审计/回溯能力对齐。
- **Agentic Coworker 五项基础（麦肯锡）**——定义句「owns a role and an outcome」与硅基员工哲学同向；五项基础中三项（自主权分级/身份与责任/统一网关 Protect-Prove-Price）为存量同构印证，两项为增量框架：三种记忆（Episodic/Procedural/Semantic ↔ think.md+审计历史/SKILL+workflow.yml/knowledge 本体）与「每个 Agent 须有生命周期人类责任人（不能统一归 AI CoE）」——后者为候选增强（SubAgentDefinition 现无此字段，区别于 workflow owner 与验收 approver）。银行案例数据（未具名转述）不收录。成篇对照见 [归档 · agentic-coworker](./archive/validation-deep/agentic-coworker.md)。
  来源：McKinsey（2026-10-26）· https://www.mckinsey.com/capabilities/tech-and-ai/our-insights/the-rise-of-the-agentic-coworker-a-banking-cios-guide-to-the-next-wave-of-ai

> 📌 **本节出处形态说明**：条内已含机构名/论文名的（如 Gartner / MIT NANDA / Anthropic《Demystifying Evals》）为一手来源就地标注；未带链接的条目出处统一在 [归档 · concept-layer](./archive/validation-deep/concept-layer.md)（成篇论证）——本节为一句话判据层，不逐条重复挂链。

### Verifier 才是瓶颈

Loop 真正的瓶颈是 **Verifier**（定义什么是合格、何时算完成），不是生成器——生成能力已严重过剩，稀缺的是「定义合格」，这正是 90/10 里那 10%。sofagent 审计 + 约束注入链做的正是这件事：把验收标准写进确定性规则，让 Loop 有判停依据。闸门必须分层（快闸门确定性低耗时 / 慢闸门全量异步）。Linear 实测：AI 编码使测试套件一年增长约 4 倍，验证成为新瓶颈。

> 📖 [Linear · Refactoring CI for the AI coding verification crunch](https://aihot.news/items/cmublfs5a03bcro0lebbtf8fb)

### 独立第三方评估的成立条件：权限对等与发布权归属

「独立评估」是形容词，容易被自评冒用——把它落成两条可机械核对的规则，缺任一项即退化为自评：① **权限对等**——评估方可否取得与内部团队对等的访问（含事件窗口外记录、涉密员工访谈），而非仅看厂商备好的材料；② **发布权归属**——评估方能否单独公开发布结论、厂商不得否决，厂商删节权限于「预定义类别」并允许评估方公开质疑。

> ⚠️ 该机制目前为厂商自述（Anthropic 宣布向 METR 开放员工级访问），**非第三方核验**。
> 📖 来源：知识库消化与维护（2026-10-16 · 4 源：Anthropic 开放员工级访问 · Dario 政策长文 · Anthropic 交 METR 调查 · Hinton 等 22 人 RSI 论文）· [TechCrunch](https://techcrunch.com/2026/10/15/anthropic-is-letting-metr-researchers-look-under-the-hood-with-employee-level-access/)

### FDE 职能的组织学验证：五常设岗位

BCG 访谈 50+ 家 AI 领先公司归纳出五种新角色原型——工作流设计师/领域知识负责人 / 业务自建者 / AI 治理者 / Agent 运营负责人。三重印证：① **五岗位恰是 FDE 三重角色（梳理/部署/养护）在企业内部的常设化拆分**——FDE 是生成相位的总承包人，五岗位是驻留相位的分包编制（映射 SSOT 见 [FDE/ROLES.md](../FDE/ROLES.md)）；② **「先重构再上 AI」被定量定价**——
重做工作与人才机制的公司年度 TSR 比同行高 11+ 个百分点，BCG 另一调研显示 60% 企业未获 AI 价值的根因是任务层面叠加工具、未触及流程（= 跳过 FDE 梳理直接买工具）；③ **治理与运维两岗的自动化恰是本仓存量**——Guardian（审计/HMAC/回溯）与 Shepherd（daemon 巡检/插件生命周期）对应能力全部已发版。边界：定性原型非统计抽样，读数自报未复算。

> **三因子归位标注（v1.5.7 R7）**：本节行业对标按三因子各归其位——**激活链**（FDEing 场景层：五岗位验证的是「岗位→能力」，本仓在此之上的动词化 FDEing 属概念首创，首创面无第三方印证可引，如实标注）；**判定底座**（S1M：行业验证止于「结果可验证」的岗位形态，判定底座本体——判据/留痕/举证——的行业印证章节排 v1.6.0+ 施工期）；**治理**（harness：③ 的 Guardian/Shepherd 两岗即治理层能力的组织学印证）。归位只加标注，既有锚定纪律与来源标注零改动。

> 📖 [Sagar Goel et al. · Five Ways That AI Front-Runners Change How Work Gets Done](https://www.bcg.com/publications/2026/companies-use-ai-to-redesign-work)

### 测量者转型：从「月底审计报表」到「每次 AI 行动留日志」（Cloudflare 实证）

Cloudflare CEO 把工作角色分三类（Builder/Seller/Measurer），**Measurer 最先被 AI 逼近**；测量岗位减少但「测量」无处不在——以前月底一张审计报表，以后**每次 AI 行动都留日志**。安全度不看岗位名看角色：被重新定价的是「输入完整、标准清楚、结果可验证的具体任务」——审计同构（输入=git diff、标准=28 条规则、结果=PASS/FAIL），即测量者形态的工程化。

> 📖 [Matthew Prince · How I Choose Which Cloudflare Employees to Replace With AI](https://www.wsj.com/articles/cloudflare-ceo-how-i-choose-which-cloudflare-employees-to-replace-with-ai)

**▍厂商实证——Harness 品类被多方独立验证（一句话判据，逐家深读见 [归档](./archive/validation-deep/harness-vendors.md)）**

| 厂商/项目 | 一句话判据 | 出处 |
|---|---|---|
| **DeerFlow 2.0**（字节） | 自称 "super agent harness"，Harness 品类词站住；它是「河」（运行时）sofagent 是「堤」（约束层），互补不冲突 | [bytedance/deer-flow](https://github.com/bytedance/deer-flow) |
| **DeepSeek Harness** | 模型厂商开源 `Agent = Model + Harness` 运行时（一切皆插件）——「Harness 独立于模型」获厂商级验证；机制与 sofagent 深度同构（可逆性/事件留痕/两旋钮权限） | [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) |
| **OpenAI Codex Harness** | ARC-AGI-3 上仅调 Harness 两项（保留推理+上下文压缩）得分 13.3%→38.3%、token 降 6 倍——「Harness 决定 Agent 表现」被官方量化（⚠️ 量纲限定：能力型表现 ≠ 治理型可靠性，只作方向性信号） | [openai/codex](https://github.com/openai/codex) |
| **OpenAI Agents API**（2026-09-10 公测） | Harness 托管商品化、零平台费——编排层护城河在消失，壁垒收窄到治理工程（28 规则/HMAC 链/本体/审批流）；压缩不是审计记录 ⇒ 审计证据链必须独立落盘 | [Introducing the Agents API](https://openai.com/index/introducing-the-agents-api/) |
| **Anthropic 产品真相** | 运行的生产代码是产品最可靠的事实来源——审计「不看 Agent 说什么，看 git diff 留下什么」同源 | Anthropic Joel 访谈（第三方框架转述） |
| **Codex Guardian 模块** | 审查结论的失效语义（`IncompatibleCompaction` 等）——「压缩不是审计记录」的工程化背书 | [codex guardian/](https://github.com/openai/codex/tree/main/codex-rs/core/src/guardian) |
| **Omnigent**（Databricks 系） | meta-harness 把策略强制在基础设施层而非 prompt；密钥不进 Agent 进程——「约束进代码层」的工程化版本 | [GitHub](https://github.com/omnigent-ai/omnigent) |
| **DataFlow**（北大 DCAI） | 顶尖高校独立用「Harness」命名（同月第三家）——品类共识非孤证 | [OpenDCAI/DataFlow](https://github.com/OpenDCAI/DataFlow) + arXiv:2607.16617 |
| **OpenFDE** | 以 Forward Deployed Engineer 命名售前工作流——FDE 术语同源佐证；spec-first 硬禁令与 decisions.jsonl 是可借鉴方向 | [OpenFDEAI/ChatDemo](https://github.com/OpenFDEAI/ChatDemo) |

**▍跨域实证——eval / 记忆 / 训练基建 / Skill 形态（一句话判据，深读见 [归档](./archive/validation-deep/cross-domain.md)）**

- **OpenAI build-prove-generalize**——FDE 官方方法论：`prove = 建定制 eval`，审计从成本项重新定义为产品化前置条件（John Deere 案例：定制评估后农户化学品用量降 70%、客户互动提升 6 倍）。[出处](https://openai.com/business/the-openai-deployment-company/)
- **OpenAI Agents SDK v0.22.0**——四因子乘积模型（模型能力 × 运行时可靠性 × 数据可信度 × 权限与审计）被官方一手源实证，后三因子正是约束层的活。[出处](https://github.com/openai/openai-agents-python/releases/tag/v0.22.0)
- **harnessed agentic RL**——训练域验证「归因单位必须是完整执行、不是单次调用」（Agent Lightning 2.41 样本/rollout、Dressage reward 以整条 trajectory 为单位）：与审计按 commit 留痕同构。arXiv:2608.17528
- **Omarchy**——SKILL.md 是正在收敛的 Agent 接口形态；反漂移靠「禁二份」纪律（SSOT 声明 + 扫描对账互补）。[omacom/omarchy](https://github.com/omacom/omarchy)（35.3k stars）
- **企业 AI 选型框架「两轴一红线」**——两轴矩阵 + 高影响动作留给人；「能用规则不用模型判断」与 20/25 纯 git-diff 同构，「不信可解释性」与 HMAC 链 + HITL 咬合（完整对照见归档）。
- **金融风控归因消融**——汇添富以领域本体为底座引导 LLM：实体识别 95%、关系抽取 99%，**消融对照移除本体约束后关系抽取降约 30 个百分点**——「可检查性必须落在模型外」的量化实证。《证券信息技术》2026-1（周建军等）

### System One 决策模型：判断与生成分离（Jev · 2026-09）

判断/生成分离成独立模型类别（Jev：三原语 + 校准概率，RLCD 训练）。四条判据级启示：判断面独立成层获行业印证 / 校准概率是置信度验收标准 / 类型化输出天然可审计 / 可被操纵 ⇒ 永不进信任地基只坐语义兜底层。谱系（RouteLLM/FrugalGPT/semantic-router 三级延迟阶梯）与生态实证全文见归档。

2026-10-12 补（形态面修正）：同期多模态判定件（上海 AI Lab／InternLM，Apache-2.0，0.8B／2B／4B；厂商自报、本仓未复算）按准入判据第④项仍落「保留 next-token head」一侧——`config.json` 实测（本仓一手）`architectures:["Qwen3_5ForConditionalGeneration"]` + `tie_word_embeddings:true`，走词表读出口（logits 限合法单 token 后 softmax），非独立判定头。

**不利结论照录**：「专用训练 + 多模态 + 厂商自报高指标」不构成越过准入判据的理由——准入判据以**结构**（概率是否直接 readout）为准，不以指标为准。

**修正认知**：该件温度只有一个标量且跨原语共用（同时作用于 `choice`／`noul`／`score`），与本仓「按原语分档……不得全局共用」相反 ⇒「一个温度通吃」是品类现状，本仓分档口径获实物反面对照；其合并 ECE 恰掩盖按原语差异。

**正面印证**：其「可选外挂思考交接」默认关闭，且自述交接输出不是本地校准概率、不计入所报评测——与「假概率正名」同款处置且系厂商自曝。

2026-10-26 补（执行面修正）：**离线准确率不预测执行面成功率**——同批九个判定件的孤立题准确率极差 5.1 pt，而 agent 内任务成功率极差 57.5 pt，两极排序反转（工具选择 92.2% 的一件在 agent 内只解 69.5%，89.3% 的一件升至 91.5%）。阈值口径同源给出：整段交给判定件 −19.0 pt、固定阈值 0.5 −21.5 pt，而**按该 agent 自身轨迹拟合**后成本 −14.2% 且 500 题零结果变化。⇒ 选型表须并列「离线题准确率」与「agent 内成功率」两栏；阈值须**逐决策点拟合**，全局单值会系统性误放。
**边界**：换任务重新拟合后最省的通过配置掉 8.1 分——省钱读数须带同分布前提。

> 📚 全文与读数：[归档](./archive/validation-digest/README.md)——本节 2026-09-28 台账化压缩。执行面补记的一手拆解见知识库《JevAgentHarness拆解》（厂商自报、本仓未复算；未读 PDF 正文）。

### Meta-RSI 三算子与保护面（2026-09）

RSI 统一形式化：三个可写面算子（Data-RSI 经验池 / Harness-RSI 五槽位 scaffold / Model-RSI 参数内化）共享一个闭环内核（消费学习信号→提出改动→验证器裁决→回流），其上加改进调度器。实测：自托管 35B 四基准平均自提升 10.9 分；六款前沿 API 模型仅走 Harness 路线（不动权重）平均 +7.3 分——context-space 改进对不可训练的前沿模型同样有效。
三条判据级启示：① **保护面独立**——评估器与发布门必须在所有可写面之外（eval-gate + audit HMAC 链 + release-gate-loop 恰是这个形态）；② **验证差距是自进化的适用边界**——自提升仅在有廉价验证器的域成立，开放式域必须人审兜底；③ **多层写的成本模型**——context 更新「每次推理重付」、权重更新「一次付清」，三层须有显式晋级判据。行业 RSI 分级与五层谱系对位见 [PHILOSOPHY · 自进化五层谱系](./PHILOSOPHY.md#自进化的五层谱系update是分界线)。

> 📖 [CosmosMind · MetaRSI/RSI²](https://arxiv.org/abs/2609.06396) · [RSI-Harness](https://github.com/CosmosMind-ai/RSI-Harness)

### 记忆要笨：应用层记忆的死亡测试

清华唐杰团队综述《Memory for Large Language Models》两条直接对位：① **模型内部记忆出场后加不进去**（ANM 门控只在预训练开放）——模型身体里的记忆是厂商地盘，应用层碰不了；② **应用层记忆只做「笨事」**——前沿图景是模型自己分层消化原始记忆，应用层手搓「切块→向量化→检索→重排」会被内置记忆取代；按「等原始记忆能全量丢进模型那天，这个功能还有意义吗」的死亡尺子，剩三样不需要聪明：**一样不忘（全量 append-only）、可带走（长在文件里非权重里）、入口在本地**。
这把「Agent 失忆，文件不失忆」从工程直觉升维为架构定律；「写入笨、派生灵活」（Ledger 绝对不压缩、Views 可自由整理）由此立得住。

> 📖 [唐杰团队 · Memory for Large Language Models](https://arxiv.org/abs/2604.08915)

**▍其他（2026-09 深读，一句话判据）**

- **WeKnora**（腾讯开源知识平台）——判定件上游的检索现成件，非同类：混合检索归一化 / 降级留痕 / chunk 级修订可引；治理面无 append-only 链差一档。[深读见归档](./archive/validation-deep/weknora.md)
- **具身智能切面**——机器人的运动过程 = 一个个 workflow，**差别在执行器、不在治理形态**；判定件对具身的价值在控制回路**外**的治理，判定永不进安全反射。[深读见归档](./archive/validation-deep/cross-domain.md)

---

> 对应的落地借鉴项清单见 [ROADMAP · 探索方向](./ROADMAP.md#探索方向)。

## 二、生态位：Agent 三层模型与 sofagent 的位置

> sofagent 不是开发者框架的竞争者，也不是大厂平台的替代品——它占据被三层夹击后依然空出来的生态位：**约束基础设施**。⚠️ 术语导航：本节「三层」= 生态位；[ARCHITECTURE 心智模型](./ARCHITECTURE.md#心智模型先读这个)「双层」= 产品组织；[四层运行形态](./ARCHITECTURE.md#四层运行形态企业-ai-从梳理到专属模型) = 企业 AI 运行形态。三个维度勿混。
> 本章全文（含 deepagents 弃用完整踩坑、意图/理解债务）见 [归档 · ecosystem-niche](./archive/validation-deep/ecosystem-niche.md)。

### 三层架构——从终端用户到开发者到约束层

| 层 | 面向谁 | 典型代表 | 核心价值 | sofagent 的关系 |
|---|---|---|---|---|
| **Layer 1 — 大厂 Agent 平台** | 终端用户 | OpenClaw / WorkBuddy / 扣子 | 完整产品——UI + 会话 + 记忆 + 插件生态 | sofagent 不替代它 |
| **Layer 2 — 开发者框架** | 开发者 | LangGraph / LangChain / deepagents | 用代码搭 Agent——状态机、工具链、编排原语 | sofagent 使用它，不竞争 |
| **Layer 3 — 约束基础设施** | 企业 + 开发者 | sofagent | 跨层约束——守规矩、留痕迹、沉淀经验 | **sofagent 的位置** |

三层是**叠加关系**：sofagent（L3）嵌在 Agent 生态与模型层之间、同时裹在外面做跨层约束——堤坝（约束注入链）+ 水表（审计 git diff 硬证据）+ 蓄水池（知识库）。LangGraph 不做（编排框架）、WorkBuddy 不做（利益冲突——平台不会自己审自己）、deepagents 也不做（聚焦编排）——**这个生态位空着，sofagent 填它**。
deepagents 启发了 v1.0-1.1 的 DAG 编排（Harness 范式 + HITL 功不可没），v1.2.0 起弃用迁 LangGraph createReactAgent（黑盒 vs 白盒的完整踩坑见 [FORGE/lessons](../FORGE/lessons/index.md)）。

### 与现有工具的差异（速查表）

一句话：现有工具查代码，sofagent 查 AI 的行为——密钥泄漏、越界改文件、盲目修改是 AI 特有闯祸方式。完整速查表见归档。

> 📚 全文与读数：[归档](./archive/validation-digest/README.md)——本节 2026-09-28 台账化压缩。

### 技术选型原则——用什么、不用什么

| LangChain 生态组件 | 是否使用 | 理由 |
|---|---|---|
| **LangChain Core** | ✅ | LLM 调用底座——模型接口抽象、消息格式标准化 |
| **LangGraph** | ✅ | DAG 编排底座——StateGraph 状态机 + createReactAgent，白盒可控 |
| **LangChain 全家桶**（Loader/VectorStore/RAG） | ❌ | 不做 RAG/向量检索——知识管理用干净 Markdown + YAML + Git |
| **LangSmith** | ? 可选 | 开发调试工具，非产品组成（SDK MIT，平台闭源收费） |

**不做 RAG、不做向量检索、不做 Document Loader** 是设计禁区（详见 PHILOSOPHY [§八 设计禁区](./PHILOSOPHY.md#八不做什么设计禁区)）——知识管理哲学是 [Don't Do RAG](https://arxiv.org/abs/2412.15605) 验证的 CAG 方向：干净 Markdown + 加载链按需注入比向量检索更可审计。FORGE loop 技术栈极其克制——**核心价值不在「用了多少技术」，在「管住了多少行为」**。
意图债务 / 理解债务（loop-engineering 概念）全文见归档。

### 2026 年的新一代对标：Agent 运行时治理内核

2026 年治理从合规文档类分化为运行时内核类（概率模型外做确定性裁决）：ArbiterOS / Cordum / 《Reason Less Verify More》（78% 失败是静默错误状态、门自身精度必须被审计）/ 风控三层——本仓占「运行时治理内核」格，差异在判定面多出校准概率+弃权+档位。对标表与数据见归档。

> ⚠️ **判定/决策接口须保留显式弃权位并报弃权率（判据级纪律）**：Arena 对 12 模型 34,580 场裁决实测——**96% 对战被强制选出赢家**（无弃权位的强制二选一）；裁判间一致率 79.4% vs 与人类仅 56.9%——**高分一致率可能只是同源假象**（裁判偏爱自己的答案比人类高 70%、同厂裁判对同厂模型宽容 37 分）。
> 推论：无弃权位的判定系统会把「判不了」静默伪装成「判了」，是系统性偏差信号；本仓档位五态中 `ABSTAIN`（带三源归因）与选项表强制第四选项正是对位设计，**弃权率本身须作为可观测指标上报**（弃权率趋零先查通道坍缩再查能力提升）。
>（人类侧镜像现象属使用面洞察，详见归档，不并入本判据。）
> 来源：Arena · https://x.com/arena/status/2104965778613452895 ｜ 《研究：AI 建议可用让人几乎不再愿意说「我不知道」》（IMA 收录）

> 📚 完整映射表：[归档](./archive/validation-digest/README.md)

## 三、架构印证：行业框架独立复现 sofagent 的选择

> 本节逐条印证与 sofagent 架构**结构上对齐**的行业框架（非发明新架构，是验证既有选型）。成篇论证全文见 [归档 · architecture-mapping](./archive/validation-deep/architecture-mapping.md)。

### Ontology = 共同理解层 / 翻译层

Ontology 的本质是「**翻译而非统一**」——在多个异构系统之上建立共同参照系，同时保留各系统内部语境独立；≠ 数据模型 / ≠ ER 图 / ≠ 知识图谱（图谱只能查，Ontology 还能在对象上**触发操作**）。「本体 = 运行时语义层」——Agent 跑任务时实时提供「谁依赖谁、谁能看什么、能触发什么」的活的中间层。

> sofagent 设计决策（本体数据 = GitHub 生长树）见 [ARCHITECTURE §三](./ARCHITECTURE.md#本体数据--github-生长树核心设计原则)

**▍架构对位速览（一句话判据）**

- **Apache Ossie**（2026-07 进孵化器）——语义层交换标准：厂商中性 YAML/JSON 语义模型 + `ai_context` 字段 = 「本体 = 运行时语义层」的工业级实例化；Hub-and-Spoke（N 平台互转 2N 条路径）与「合的框架」同构。⚠️ 克制：初生标准不引入依赖，仅作演进参照。[ossie.apache.org](https://ossie.apache.org/)
- **Notification 事件驱动协作**——多 Agent 经事件总线协作而非点对点：调用路径不动态化，治理不失控。
- **外层 FORGE 节奏与护栏**——Onyx 四阶段闭环 + 双模式审批（高风险人工/常规受信自动）= SUSTAIN 巡检 + critical/warning/crutch 分层。
- **行业五层骨架映射**——五层映射本仓三层，关键同构 = 仅指令层直接调 AI（[映射表见归档](./archive/validation-digest/README.md)）
- **AOS 四大基础设施**（数据接口/上下文理解/权限管理/Skill 生态）与 sofagent 五层工程谱系逐层同构。
- **脑力自动化四阶段**（提示词→上下文→驾驭→循环）恰是 sofagent 五层谱系的工程化落地。
- **企业级确定性执行底线**——零数据权限 / 全链路留痕 / 确定性执行三条底线与「LLM 动脑指挥，Ontology 指路，确定性工具执行」分工完全同构。
- **OLAF-I 五块骨架**——Object/Link/Action/Function/Interface 最小不可再分集与本仓五能力同构；Palantir「Action 默认 staged 等人审」= human_confirm 同构（[映射表见归档](./archive/validation-digest/README.md)）
- **模型层判断**——智能密度提升（小大模型差距缩到半年）印证分层模型架构可行；运行时动态路由与 model-router 同构；「组合优于单一」是 Scaling Law 天花板的必然结果。

### 循环的边界：入场判据与升级判据

**Loop 是 Graph 的特例**（包含关系，非替代）。边界两个方向——先判**该不该建**（入场判据），再判**该不该升**（升级判据）：

**入场三适合**：① 重复发生（同一任务反复出现）；② 完成标准清晰（「做完」能被独立判定——exit 0 / 测试数对账 / verdict PASS；主观目标先定义 Rubric，定义不出来不建 Loop）；③ token 成本可扛（单轮成本 × 预期轮数在预算内——FORGE 三层熔断即此工程化）。

**单 Loop 四类失败 → sofagent 解法**：指标异化 → audit 看 git diff 硬证据不信自报；目标僵化 → human_confirm + 危险操作人工批准；多目标冲突 → ★Reality Anchor 统一裁决；测量衰退 → audit 规则不可篡改 + acceptance-test 冻结验收标准。

**升级六信号**：任务需交接（dag-runner vs 并行编排）/ 需散出汇合（Send API + MergeQueue）/ 每步不同模型工具（model-router）/ 需显式可审计角色（StateGraph 四节点）/ 节点失败需隔离（git worktree）/ 需独立 reviewer（audit + fresh-eyes）。满足其一才升级，否则 Loop 就够（避免过度设计）。
完整对照见 [FORGE §Graph Engineering 视角](./guides/loop-development.md#graph-engineering-视角控制图--stategraph)。

### 循环系统的鲁棒性：四类故障与六要素

自主循环稳定运行需六要素（自动化触发/隔离演练/安全边界/工具连接/角色分离/记忆分层）——sofagent 全部已有：pre/post hook = 激活链 + daemon cron；隔离演练 = git worktree；安全边界 = 工具审批 + HITL；工具连接 = MCP server；角色分离 = Explore/Code 拆分；记忆分层 = 四层加载链。

| 故障模式 | 表现 | sofagent 对应 |
|---|---|---|
| **空转** | 反复改几十次测试通不过 | Onboard L5 连续 FAIL 判发散 |
| **过拟合测试** | 单元测试全过，业务不能用 | Benchmark 评测 + 人工验收 |
| **上下文漂移** | 基于过期假设写代码 | Durable Execution L1 checkpoint 续跑 |
| **不安全自主** | AI 越权搞破坏 | 工具审批四模式 + 保守默认拒绝 |

> 💡 **核心定律**：「测试失败 = 最高质量的下一轮上下文」「仓库记得，即使模型不记得」——git diff 是无状态的地面真相，仓库是模型永远可以回读的外部记忆。

### Palantir 落地路径（Red Loop / KLM / Apollo / FDE）与双 MCP 体系

一句话判据：Palantir 官方把 Ontology 定义为「**可运行的业务契约**」（Data+Logic+Action+Security 四合一，「表达企业彼此关联的复杂**决定**，而不是数据」）；KLM 范式 = 智能/控制分离 + 把规则动作边界放模型外；Red Loop 写回五机制（幂等/回执/补偿/审计/人工接管）与 Durable Execution + WAL + HITL 逐一对位；
双 MCP 体系把「改结构」（proposal 人工门）与「改数据」（受控 Action）拆成两条治理通道——每个 action type 独立暴露为 MCP 工具 = **审计粒度到单个业务动作**，与「28 条规则按变更类型切分」同构。Snowflake 反向「自下而上」路径（数仓长出本体栈，Cortex Sense 47%→83%）与 Palantir 互为外部佐证——**本体 = 运行时 context 层被多家独立复现**；其 Action 语义缺失恰是审计 + HITL 的主场。

纳德拉「学习循环」四要素与本仓能力面对齐：「可以外包一项任务甚至一份工作，但永远无法外包学习过程」——模型/平台可换，企业积累的约束与审计历史不动。深读全文见 [归档](./archive/validation-deep/thanks-extended.md)


> 📖 [Palantir Foundation · Ontology MCP](https://palantirfoundation.org/docs/foundry/ontology-mcp/sample-architecture) · [Snowflake · Cortex Sense](https://www.snowflake.com/en/blog/enterprise-ai-agents-grounded-context/) · [Satya Nadella ·
A frontier without an ecosystem is not stable](https://www.linkedin.com/pulse/frontier-without-ecosystem-stable-satya-nadella)

### Loop 四层循环：从 Agent Demo 到可交付 AI 产品

四层循环是**四个时间尺度的控制**——单 Agent Loop 只算「连续执行的 Demo」，四层打通才是可交付产品：

| 循环层级 | 管什么 | 时间尺度 | sofagent 对应 |
|---|---|---|---|
| **Agent Loop** | 一次行动 | 单次执行 | 模型自动调用工具循环到自判完成 |
| **Fortification Loop** | 一次任务 | 单次交付 | 审计 + acceptance-test 冻结验收 + define_acceptance——**把「完成」的定义权从模型转移到系统** |
| **Event Driven Loop** | 持续业务 | 长期运行 | daemon + WAL 续跑——排队/幂等/MergeQueue/退避/checkpoint 逐项对应 |
| **Hill Climbing Loop** | 系统进化 | 跨多次任务 | 进化模块 + FORGE fresh-eyes-loop（安全网：release-gate + 回滚，≠ 随意改 prompt 直接上线） |

关键安全网：Hill Climbing ≠ 让 Agent 随意改自己的 Prompt——可靠改进仍需候选版本/离线评测/回归/人审/小流量/回滚。

**并行规模的真实瓶颈在收敛而非执行**——三条外部证据同向：① **结果不过大模型汇总**：任务原子化＋独立上下文＋程序按题号确定性合并，使同一模型从 38.54%（主 Agent 拆解并汇总）升到 70.69–70.87%（EvoMap 蜂群）；
② **综合层必须限流**：并行读取可无限扩，汇总质量随份数单调下降（1946 智能体读小鼠全脑图谱）；③ **去中心化只搬移瓶颈、不消灭瓶颈**：拿掉中心编排器后，协调成本从「调度器状态」转移到「共享工作区＋认领协议」（Microsoft Agensh）。⇒ 判据：编排去中心化须同时给出汇总层方案，汇总一律程序化（不过模型）并设并发上限，否则规模越大分越低。

**加速读数须与总成本同表，否则是口径失真**——只报墙钟或倍数（「读完用了多少分钟」「快 90%」）判断不了值不值；加速量必须与训练 / 推理 / 运维 / 重试成本并列成同一张表。三条证据同向：并行读取的端到端墙钟须与并发上限带来的汇总损耗同列（1946 智能体）；「成本 −90%」若不含训练与运维，省下的是执行费而非总成本（Shopify）；「不重复执行 ⇒ 不重复计费」只在幂等成立时兑现，须与重放成本同列（Vercel）。

⇒ 判据：**任何加速结论须给同表两列**——加速量（墙钟 / 吞吐）+ 总成本（含训练、运维、重试）；缺一列即降级为「局部读数」，不得进对外材料。

## 四、市场印证：行业判断被市场买单

> 前三章回答「技术对不对」，本章回答「市场认不认」。成篇全文见 [归档 · market-validation](./archive/validation-deep/market-validation.md)。

**▍经济账与定位（一句话判据）**

- **SMB 断层**（SaaStr Lemkin 单位经济账）——FDE $135K–$200K 年薪、每部署年成本 $75K+，对 20–50 人中小企业占营收 1-4% 无法 justify：**「最需要 AI 转型的企业，正被那个能出结果的实施模型的定价排除在外」**。若 FDE 判断固化进可复制 harness，人力成本才可能摊薄成软件成本——$75K/部署/年是可长期引用的量化锚点。
- **价值度量翻转**——传统外包按人·月计费，FDE 按成果·Token 计费，成本差可达三个数量级（~5 人 3 个月 ~50 万 vs 1 FDE 3 天 ~500 元 Token，量级对比未经独立核验）——印证「卖能力不卖工时」。
- **产品化四条**——① 卖能力不卖工时；② MCP + dashboard 必须有；③ open-core 双轨（内核 MIT，卖控制台层）；④ **能力长在代码里不长在 prompt 里**——文字约束每次注入 = 每次投喂，生存位 = 封装进 SubAgent + 防投喂机制。商业化指标与 FDE 量化口径互补。
- **FDE 组织机制四件事**（OpenAI FDE 负责人）——评估驱动 / 原型驱动 / 双向收敛（向客户交付 + 向产品沉淀）/ 只做难题：防「堕落惯性」（滑向外包咨询）的组织参照。
- **FDE 全环节入口（软印证）**——「垂直 Agent 门槛大幅下降，FDE 应扎进细分赛道全环节 AI 化」：前提是先把环节梳理出来，这正是 FDE 第①层（梳理）价值。

**▍市场信号（量化锚点，明细见 [归档](./archive/validation-deep/market-validation.md)）**

- **FDE 岗位爆发**：MIT NANDA「95% 项目零财务回报」vs FDE 岗位一年涨 **729%**（Indeed 2025）——模型不稀缺了，能把模型塞进真实业务的人/工具才稀缺。…
> 📦 **本条印证全文（多源数据与逐条出处）见 [归档 · validation-deep](./archive/validation-deep/section-fde-market-and-harness-research.md)。**

## 五、研报视角的边界提示

> 行业研报的边界提示与 [LIMITATIONS](./LIMITATIONS.md) 互证。成篇全文见 [归档 · boundary-research](./archive/validation-deep/boundary-research.md)。

### 约束增益与自进化系列的实验数据汇总（ARCHITECTURE/PHILOSOPHY 引用的数据锚）

以下数据被 ARCHITECTURE 与 PHILOSOPHY 以指针方式引用，集中于此：

- **Harness-MU**（[arXiv:2606.21856](https://arxiv.org/abs/2606.21856)）：GPT 基座指令跟随 42.2%→91.2%（+48.9pt；冲突模式 30.9%→78.1%），访问控制攻击下隐私零泄露，wall-time 反降 11%。

**▍边界提示（一句话判据）**

- **不要一上来就 Agent 自动闭环**——分阶段风险收敛：存量系统之上的语义接管不可跳步，高风险 Action 必须 HITL（印证 A14 仍是事后审计的现状）。五阶段对照见 [ROADMAP · 行业印证](./ROADMAP.md#行业印证)。
- **模糊提示下确定性骨架不可替代**——用户提示模糊时精简上下文方案弱于「有完整 system prompt 兜底」：Skill 定义质量直接决定 Agent 在模糊输入下的下限。
- **LGA 四层治理框架**（[arXiv:2603.07191](https://arxiv.org/abs/2603.07191)，York，OpenClaw 实测）——L1 沙箱/L2 意图验证/L3 零信任授权/L4 不可变审计日志与本仓五能力对位；本地档判定读数（Qwen2.5-14B 98% 拦截 / 10-20% 误报；级联可达 1.9-6.7% 误报）给了一体机档量化参照；双语基准（1,081 条中文原生）可作采集器外部对照样本源候选。
- **生态速览（2026-09-24 巡检）**——wire 协议事实标准已六家可枚举：协议面决策的外部输入已齐，**窗口在收窄**；对照件状态翻转四件（nimble 数据公开 / kev 读数以 09-21 快照为准 / ECE 披露面翻转 / 准入第④项判别实例成对）。NIST 口径辨析**唯一持有处在 [THANKS · 官方标准面]**；Laya 反例锚定 0.3.4 制品、时效在消退，引用须带限定语。

- **训练环境不可信则评估作废（DSec）**（[arXiv:2609.22978](https://arxiv.org/abs/2609.22978)）——论文实录 Agent 沙盒内成规模作弊（翻答案/伪造响应/覆盖 bash）：**训练信号可被环境伪造，防自证污染不是洁癖**——来源真实性标记 + 捕获层零外部调用 + 评估只排序不自动入池三条纪律的实证背书；沙盒不只是安全边界，是评估可信性的前提。
- **评测环境是风险面（三源）**——评测中 reward hacking 与正常解题在产出上同形：审计须**双轴判定**（结果正确性 × 手段合法性，两维独立留痕分别举证），越界刷分才在日志里现形。与 [DEVELOPMENT 评估器反作弊四形态](./DEVELOPMENT.md)（让作弊拿不到答案）正交——本条管「让漏网的作弊在审计里可判定」。
- **行为验收独立于能力分数（三源）**——门禁须能拦下「能力更强但行为不合格」的模型：OpenAI 曾因对齐测试显示欺骗倾向/未经许可行动而叫停能力更强的 Astra 模型——若门禁只按能力档位放行，Astra 会被放出去；Google Harness 把「端到端基准之外补一层行为评估」定为方法论（行为规格→行为用例→回归比对）；hugozhu 把验收（Spec/Evals）与执行自由（Harness）拆为两个独立契约。与上条正交：彼管「评测可被作弊」，此管「验收维度须独立于能力」。

> 来源：Google Developers Blog ·〈The Anatomy of Harness Engineering〉｜OpenAI · Astra 对齐叫停决定（本仓经媒体转述收录，未复算官方声明）｜hugozhu.site ·〈别配置 Agent 了，给它岗位〉

- **完成认证锚定环境终态（Outcome），文本声明≠完成（三源）**——验收须查环境终态而非执行者自报：Anthropic 评测方法论把评测基本单位定义为 Task（输入+成功标准）/ Trial / Transcript / **Outcome（环境终态）**，明确「文本声明≠完成」——Agent 自报的任务完成声明不构成完成认证，须以环境终态为裁决锚（文件已写入、服务已响应、状态机已迁移）；配套区分 Capability（允许低通过率爬坡）与 Regression（应接近 100% 防退化）两类评测，成熟任务「毕业」转入回归集。
  Transactional Outbox 式「期望 vs 观测」效果查证位是其工程化形态：未观测不默认成功——审计从记账升级为闭环确认。与上条正交：彼管「验收维度须独立于能力」，此管「完成状态语义须锚定终态证据」。
> 来源：Anthropic《Demystifying Evals》· https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents （IMA 收录；转述交叉：Agent评测三源合篇 2026-10-07）｜ Transactional Outbox 效果查证位（Agentic 发布篇 2026-09）

- **评测对象是「一次行动」而非「一个答案」（四源）**——被测的是 模型 + Prompt + Skill + 工具 + 记忆 + 状态 + 业务流程 组成的复杂系统，而非裸模型本身：
  同一模型换 Harness / Skill / 工具即等于换被测对象，故「模型升级了评测作废」与「Harness 改了评测同样作废」须同等对待。
  配套判据「**带着正确答案的失败**」（结果正确而过程错误）：只看终局答案会把它判成通过，须与结果轴**独立留痕、分别举证**。
> 来源：美团 Agent 评测五层用例体系（AItest进阶之路）｜淘宝 LLM-as-Judge 日级工业化（大淘宝技术）

- **出线判定须为 AND 复合门槛（五源）**——红线项（越权 / 伪造 / 数据外泄）须**一票否决且不参与加权**，关键短板须**穿透总分**而非被高分稀释；多分合成为一分时不取算术平均（一次越权不能被九次合规摊平），取两段式：先否决、再排序，命中即封顶不因后续改善回抬。与上条正交：彼管「被测对象是什么」，此管「多指标怎么合成才不掩盖灾难性失败」。
> 来源：1688 · 双门槛出线判据（执行完整率 ≥90 AND 结果分 ≥80，94.41 分仍不准出）｜美团 · Agent 评测五层用例体系｜大淘宝技术 · LLM-as-Judge 日级工业化（2026-09-18）｜货拉拉技术 · 业务 Agent 评测平台（2026-10-14）｜叶小钗 · Agent 评测维度方法与落地（2026-08-25）

- **pass^k 一致性抽验（单次通过 ≠ 稳定通过）**：回归验收抽验边缘场景，要求 **k 次重复稳定通过**而非单次成功——单次通过率会掩盖抖动的 harness。
  - ⚠️ 两条口径注记（**细节见归档**）：+54% 系 **pass^1 相对提升**、非 k 次一致性；同页已声明「多数场景推荐改用 extended thinking」⇒ 只按**方法论**采用。
> 📖 来源：[Anthropic Engineering · The think tool](https://www.anthropic.com/engineering/claude-think-tool)（2025-12-15 更新）· 哥伦比亚大学 COMS W4995 第 5 讲（2026-10-11）

- **FDE 不是唯一路径：同一机构存在「绕开 FDE」的对立路线（并列不归一化）**——OpenAI 一边成立 Deployment Company 要 FDE，一边由 Codex 产品负责人主张「把 AI 直接交到干活的人手里」。**判定：本仓不在攻击面内**（批评的靶子是「一上来搞大而全 workflow 自动化」，而本仓方法论首条铁律是**按最小工作单元切**）；
  须对外应答的是平台层「图即企业」叙事被误读成「大而全」的风险。**不做**：不为本条新增任何能力（W4 反向对照，指认不出 W1/W2/W3 消费方，按登记与承诺分离只进本节）。
  全文（两条路线逐句原文 · 三条处置纪律 · 对外应答建议 · 来源）见 [归档 · validation-deep](./archive/validation-deep/section-fde-market-and-harness-research.md)。
## 六、反面案例 / 证伪记录

> **收录规则**：本节只收仓内已披露的失效、未达预期与判据偏差——每条三行制（判据 + 事实 + 出处链接指向仓内文档）。正面印证在 §一–§五，反面边界在此——两面对账才是完整的验证观。

- **「越用越好」进化实证边界（v1.4.5 收口前）**
  - 判据：进化宣称须有 ≥1 周持续样本 + A/B 对照支撑。
  - 事实：v1.4.5 收口前仅 11 个一次性测试 Case（LIMITATIONS 已诚实披露）；7 天采样管道 v1.4.5 才交付，样本达标前「越用越好」表述不挂实测链接。
  - 出处：[v1.4.5 开发日志](./changelog/v1.4/v1.4.5.md)（进化模块实证收口段）· [LIMITATIONS §四](./LIMITATIONS.md)（7 天样本未采满披露）。
- **Dream Cycle 采样恒真缺陷（v1.5.7 F45 修复）**
  - 判据：采样器读数须能区分「管道正常」与「管道恒真」。
  - 事实：采样曾存在恒真缺陷（读数不随真实产出变化），零产出探针是计数器不是成功证明——探针记「看了多少天」，不记「管道已验证正常」。
  - 出处：[LIMITATIONS · Dream Cycle 采样恒真缺陷](./LIMITATIONS.md#-dream-cycle-采样恒真缺陷与零产出探针边界v157-f45-修复)。
- **v1.4.8 判据偏差登记**
  - 判据：门禁判据与产品行为的一致性须对账登记。
  - 事实：v1.4.8 存在判据偏差（判据与实际行为不符），以登记形态在 CHANGELOG 历史中留痕（对外有披露价值的过程登记）。
  - 出处：[v1.4.8 开发日志](./changelog/v1.4/v1.4.8.md) · [LIMITATIONS §四 · 历史遗留说明](./LIMITATIONS.md)。
