# sofagent-typed-decisions-minimal · 判定底座内部校准对照底盘（v1.7.0 §六）

> **定位：内部校准对照底盘**——不公开、不作对外验收线、数据源为判据集派生。370 题（36 判据全覆盖 × zh/en 分列 + 五类语义失灵专项），标签 `deterministic` 档可由代码复算。**已冻结**（冻结即单调：追加须新建集并声明新旧不可横比）。

## 构造方法与标签口径

- **题集**：`questions.jsonl`——每题字段 `id / criterionId / language / primitiveType / question / expectedAnswer / privateHash`（question 形态对齐 `DecisionQuestion`）。
- **生成器**：`build-minimal-dataset.mjs`（node 直跑：`npm run build && node datasets/sofagent-typed-decisions-minimal/build-minimal-dataset.mjs`）——从 `engine/audit/src/rules/criteria/audit-criteria.ts` 的 36 判据模板化派生：每判据 zh/en 各 5 题（合计 10 题/判据 = 360 题），另加五类语义失灵专项 10 题（算术 / 计数 / 日期比较 / 间接问句 / 干扰上下文 × zh/en）。
- **标签口径**：`deterministic`——`expectedAnswer` 由模板参数经 `computeExpected` 复算（noul 真值概率 / choice 选中项 / score 分值+区间），非人工标注；重跑生成器逐字节重现。
- **谱系三件套**（SSOT §三「数据集谱系声明」纪律）：
  1. **来源构成**：判据集派生 360 题（97.3%）+ 语义失灵专项 10 题（2.7%）——逐项列明见 `manifest.json`；
  2. **行数对账**：各判据题数之和 == 总量（370 == 370），可脚本复算（`line-reconciliation.json`）；
  3. **污染声明**：与公开基准 / 厂商评测集交集行数 = 0（全部题目为仓内判据模板化派生 + 私有盐 `privateHash` 锚定——盐不入任何公开集）；交集断言见 `engine/orchestrator/src/__tests__/minimal-dataset.test.ts`。

## 角色裁定（与 v1.6.0 §七门四不冲突）

门四「硬标签不参与 ECE」约束**校准集的样本构成**（管「什么能进」——只有能表达概率目标的样本进校准集）；本子集是**评测集**（管「在哪测」）——用「模型预测概率 × deterministic 结果」算 ECE / 一致率。两者正交：校准集拟合温度，本集给对照组读数；门四不禁止评测集用 deterministic 标签做分母。

## 冻结即单调

`manifest.json` 的 `frozen: true` 已写入。冻结后**不得追加**——追加须**新建集**（新目录新版本号）并在两集文档显式声明**新旧集不可横比**（不同构造批的读数不构成对照）。

## 与 FDE-Bench 的定位差异

| 面 | 本集（sofagent-typed-decisions-minimal） | FDE-Bench（v1.9.0 §五） |
|---|---|---|
| 定位 | 内部校准对照底盘 | 公开案例源 / 对外差异化标尺 |
| 公开性 | 不公开、不作对外验收线 | 公开运营 |
| 数据源 | 判据集派生（仓内自产） | 案例源采集（**禁入内部数据**） |
| 用途 | ECE / 一致率对照（阶段二收口） | 对外差异化度量（阶段四） |

## zh-decision-bench 预留对接位（本版零依赖）

中文通用面对照 = 第三方独立榜 `CodyQin/zh-decision-bench`（Apache + CC BY）。**本版零依赖**：不下载、不跑分、不引用其数字——仅在 `datasets/README.md` 预留对接位；承接版本待定（v1.9.0 §五 尚未登记该榜，登记后再对接）。

## 厂商基准纪律

厂商自建基准（Decision Index v0.2.1 = Liquid 自家、Typed Decisions 2000 = AgentJev 自建）**永久定位为方向性参照**——引用必须标 vendor-reported + @时点，**不得作任何验收线**。
