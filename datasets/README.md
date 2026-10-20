# datasets/ · 判定底座基线产物

本目录存放**判定底座（v1.6.0）零样本基线的可复算产物**（`baseline-zero-shot-run.js` 复算脚本 + `baseline-zero-shot-result.json` 结果快照）与 **v1.7.0 §六 内部校准对照底盘**（`sofagent-typed-decisions-minimal/`）——属**基线评测产物**，非运行时数据。触达口径：**SDK 面 · 源码树可复算**（`npm run build` 后 `node datasets/baseline-zero-shot-run.js`），无 CLI 入口。

运行时数据的单一事实源（SSOT）是根目录 `data/`（事件队列 / decision-log / 审计链等运行期落盘）——两处勿混：本目录只进「可复算的评测快照」，`data/` 才是「活着的运行时状态」。

## 目录清单与角色裁定

| 目录/文件 | 角色 | 状态 |
|---|---|---|
| `baseline-zero-shot-run.js` + `baseline-zero-shot-result.json` | v1.6.0 零样本基线（mock 契约编码器——读数并列留档，不进 §六对照列） | 留档 |
| `sofagent-typed-decisions-minimal/` | **内部校准对照底盘**（370 题 · 判据集派生 · deterministic 标签可复算 · zh/en 分列）——评测集，管「在哪测」；与校准集门四（管「什么能进」）正交 | **已冻结**（冻结即单调：追加须新建集并声明不可横比） |

**与 FDE-Bench 的定位差异**（防后续混淆）：本目录最小子集定位为**内部校准对照底盘**（不公开、不作对外验收线、数据源为判据集派生）；FDE-Bench（v1.9.0 §五）是**公开案例源 / 对外差异化标尺 / 禁入内部数据**——两者数据面互斥、用途正交，详见 `sofagent-typed-decisions-minimal/README.md`。

**厂商基准纪律**：厂商自建基准（Decision Index v0.2.1 / Typed Decisions 2000）引用必须标 vendor-reported + @时点，零验收线引用。

**zh-decision-bench 预留对接位**（本版零依赖——不下载、不跑分、不引用其数字）：中文通用面对照 = 第三方独立榜 `CodyQin/zh-decision-bench`（Apache + CC BY · 已进 laya 官方 eval）；承接版本待定（v1.9.0 §五 尚未登记该榜，登记后再对接），对接落位将在本 README 增行而非改动最小子集。
