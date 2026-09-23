# Case 023 — Node 推理栈可行性实测（判定件 encoder 的 Node 侧取证）

> **背景**：判定件的形态已定为「encoder + 判定头、非自回归」，部署面要求「Node 是一等公民」。
> 「能不能跑」这种问题靠推论容易两头错——低估则白造一套运行时，高估则交付时才发现离线装不上。
> 本案例把三件必须拿数字的事一次量完：**运行时组件面 / 真实时延面 / 分发体积面**，
> 并留一份可复跑的探针（`probe.mjs`）与两轮原始输出（`report.json` / `report.repro.json`）。

## 测试人信息

| 字段 | 填写 |
|------|------|
| 测试人 | KongFangXun |
| 事件日期 | 2026-09-23 |
| 测试环境 | macOS 26.6.2（darwin 25.6.0）· arm64 · Apple A18 Pro · 6 核 · 8 GiB · Node v22.12.0 |
| 测试版本 | 规划面取证（不绑定版本；承接「编码器基座接入 / 零新增运行时组件 / 离线可用」三项验收） |
| 测试类型 | 运行时可行性 + 时延 + 分发体积（探针脚本 + 两轮独立复跑） |

## 方法（探针形态）

- **依赖装在隔离工作区，不进本仓 `package.json`**：探针只读工作区的 `node_modules`，跑完不落任何东西到仓库（模型进 HF 缓存，不进仓）。
- **推理走 `@huggingface/transformers` 的 Node 入口**（`dist/transformers.node.mjs` + `feature-extraction` 管线），量化档 `q8`，`device: 'cpu'`——不启用任何加速器，取「最低可用档」。
- **判定输入固定两段中文，batch=2**：对齐「一次判定 = 一对 (输入, 候选输出)」的真实调用形态，而不是单条压测。
- **统计分两档**：`全部 N 次` 与 `稳态（丢弃前 1/4）`。冷启动的线程池 / 内存池开销会把首个计时样本抬成 outlier，只报全量 p95 会得到「p95 == max」这种自欺数字。
- **组件面与体积面不靠命令行推算**：直接读依赖树里 `@huggingface/transformers` 声明的 `onnxruntime-node` 版本，并对同平台原生库逐个算 sha256 找重复副本。

## 可复现剧本

```bash
# 0) 依赖：onnxruntime-node + @huggingface/transformers（装在任意隔离工作区）
MODULES=/path/to/isolated/workspace        # 该目录下需有 node_modules
#    本机用托管 Node 工作区，可用 PROBE_MODULES 覆盖：
#    export PROBE_MODULES="$HOME/.workbuddy/binaries/node/workspace"

# 1) 只用镜像源（实测 huggingface.co 不可达，见下）——离线环境先预热缓存
HF_ENDPOINT=https://hf-mirror.com PROBE_MODULES="$MODULES" node probe.mjs --download-only

# 2) 正式跑（40 次计时 + 3 次预热；输出单份 JSON）
HF_ENDPOINT=https://hf-mirror.com PROBE_MODULES="$MODULES" node probe.mjs --runs=40 | tee report.json

# 3) 复跑一次（验证结论不是单次侥幸）
HF_ENDPOINT=https://hf-mirror.com PROBE_MODULES="$MODULES" node probe.mjs --runs=40 > report.repro.json
```

换被测基座只改 `--model=<hf-repo>`，三项结论口径不变。

## 实测输出

### 一、时延面（batch=2 · q8 · CPU · 全部本机实测）

| 轮次 | 起始时刻 | 缓存 | 加载 | 稳态 p50 | 稳态 p95 | 稳态 max | 全量 p50 | 全量 max |
|------|---------|------|------|---------|---------|---------|---------|---------|
| 首跑（冷） | 06:05:08Z | 冷（含下载） | 114,987 ms | —— | —— | —— | 6.30 ms | 39.68 ms |
| 主跑 | 06:08:26Z | 热 | 780 ms | **6.36 ms** | **9.52 ms** | 9.55 ms | 6.08 ms | 9.55 ms |
| 复跑 | 06:10:06Z | 热 | 545 ms | **6.25 ms** | **8.74 ms** | 10.15 ms | 6.22 ms | 11.58 ms |

- **稳态 p50 落在 6.2–6.4 ms**，两轮复跑差 < 0.15 ms——结论可复现，不是单次侥幸。
- 首跑冷启动的加载值（114,987 ms）**主要是模型下载**，不是编译开销；同批冷跑的全量 p95 = 39.68 ms 恰好等于 max，是首个计时样本被冷启动抬高所致——这正是本探针增设「稳态」档的原因。
- 输出形状 `[2, 384]`（batch × 定长向量），与生成式逐 token 解码形态不同——探针把它作为**非自回归**的自证断言（`nonAutoregressive: true`）。

### 二、运行时组件面

| 项 | 实测值 |
|----|--------|
| `@huggingface/transformers` | 4.3.0 |
| `onnxruntime-node`（安装版） | 1.30.0 |
| `onnxruntime-node`（transformers 声明版） | 1.30.0 |
| 二者一致 | ✅ `zeroNewRuntimeComponent: true` |

**结论**：ONNX Runtime 由 Transformers.js 自己依赖进来，不在本仓的依赖面之外新增任何运行时组件。这条是拿依赖树**声明值**核的，不是拿文档说法核的。

### 三、分发体积面（`onnxruntime-node` 包内 `bin/napi-v6/`）

| 平台 | 体积 |
|------|------|
| darwin/arm64（当前平台） | 85.3 MiB |
| linux/x64 | 44.1 MiB |
| linux/arm64 | 24.3 MiB |
| win32/x64 | 64.0 MiB |
| win32/arm64 | 69.4 MiB |
| **全平台包体合计** | **287.1 MiB**（43 个文件） |

- **同平台原生库有重复副本**：`libonnxruntime.1.dylib` 与 `libonnxruntime.1.30.0.dylib` 的 sha256 完全相同（`685d2be5dba1309c…`，各 44,589,928 B）。
- 故 darwin/arm64 的**去重下限 = 42.8 MiB**（44.9 MB），比目录口径少 42.5 MiB——这是包体冗余，不是能力面。
- 被测基座本体：`Xenova/paraphrase-multilingual-MiniLM-L12-v2` 的 `model_quantized.onnx` = 112.8 MiB，含分词器等缓存合计 144 MB。

### 四、网络面（决定离线/镜像要求）

| 主机 | 可达 | 状态 | 耗时 |
|------|------|------|------|
| `https://huggingface.co` | ❌ | TimeoutError（10 s 超时） | 10,003 / 10,005 ms |
| `https://hf-mirror.com` | ✅ | 200 | 362 / 2,334 ms |

**结论**：模型主载域在实网中以直连不可达，**镜像源是必需项而非优化项**——「主载域 ≠ 运行时唯一来源」这条纪律在本案例拿到实网证据。

## 本案例不证什么（边界）

- **不证判定件准确率**：这里量的是运行时可行性与组件/分发面，与判据质量、校准、失败模式无关。
- **不证某个特定判定件基座的时延**：被测基座是一个多语小编码器（118M 量级），不是候选判定件本体；换 `--model` 即换被测对象，结论口径不变。
- **不证信创 / 国产卡档位**：本机是 arm64 Apple 平台，x86 与国产加速卡未测——各平台体积已量（见上表），但时延不可外推。
- **不证并发与长稳**：单批、单进程、短时；并发劣化曲线与长稳属独立取证项。

## 后续

- 信创 / 国产加速卡档位补一轮同时延取证（同一探针，换平台跑）。
- 换候选判定件基座复跑（含中文强多语 encoder 的对照），确认 0.3–0.5B 档的时延量级。
- 并发劣化曲线：batch 1 / 2 / 4 / 8 × 并发 N，取 p50/p95 随负载的变化，作为「判定独立槽位」的容量输入。
- 离线介质导入路径与镜像源的 sha256 校验链路同批验证（本案例只证「直连不可达 + 镜像可达」，未证导入链路）。
