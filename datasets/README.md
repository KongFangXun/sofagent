# datasets/ · 判定底座基线产物

本目录存放**判定底座（v1.6.0）零样本基线的可复算产物**（`baseline-zero-shot-run.js` 复算脚本 + `baseline-zero-shot-result.json` 结果快照）——属**基线评测产物**，非运行时数据。触达口径：**SDK 面 · 源码树可复算**（`npm run build` 后 `node datasets/baseline-zero-shot-run.js`），无 CLI 入口。

运行时数据的单一事实源（SSOT）是根目录 `data/`（事件队列 / decision-log / 审计链等运行期落盘）——两处勿混：本目录只进「可复算的评测快照」，`data/` 才是「活着的运行时状态」。
