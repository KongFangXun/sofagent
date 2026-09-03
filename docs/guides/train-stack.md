# train-stack.md · sofagent 训练双栈契约（决策面 / 计算面 / 资源面）

> v1.4.1 块一定稿。本文档回答一个问题：**训练这件事，在 sofagent 里到底由谁、在哪个栈、按什么接口完成。** 双栈不是妥协，是生态现实——主流生产后训练框架（verl / TRL / NeMo RL / Oumi / open-instruct）全部是 Python（PyTorch + CUDA 生态决定）。Node 管决策与资源，Python 只当被 spawn 的计算子进程。
>
> 接口字段的唯一权威来源是 `engine/orchestrator/src/train/train-protocol.ts`（SSOT）——本文档只讲约定与流程，不复制字段定义。

---

## 一、分层架构

| 层 | 承载 | 职责边界 |
|---|---|---|
| **决策面** | 受约束的训练 Agent | 数据质检 / 超参选择 / 失败诊断 / 评估 / 晋升决策——有 LLM 决策空间的环节，走约束层（注入训练铁律 + 审计 + 可回溯 + think.md 进化） |
| **计算面** | verl / DeepSpeed / TRL（spawn） | LoRA 微调等确定性计算，Agent 不碰——防「每步都问 LLM」的成本 / 不确定性 / 审计噪音 |
| **资源面** | 后训模块（Node 控制面） | GPU 队列 / 显存预算 / checkpoint 续跑 / 失败恢复 / 环境准备——确定性流程，代码执行 |

三层的通信关系：决策面通过资源面下发训练任务（job.json），资源面 spawn 计算面的 Python 进程并消费其事件流；计算面对决策面完全不可见（它只看到 stdin/stdout/信号）。

### 环境准备是资源面的第零步

训练跑起来之前，资源面先做环境决策（`engine/orchestrator/src/train/train-env.ts`）：

- 流程：**检测 GPU → 安装/配置框架 → 验证可用 → 输出就绪报告**（结构化 JSON）。
- 分支判定：检测到可用 CUDA（`nvidia-smi` 存在且输出可解析）→ `cuda-ready`；否则 → `metal-degraded`（macOS 上用 `system_profiler SPDisplaysDataType` 探测 Metal 支持，给出明确降级提示）。
- 就绪报告字段：`branch`（分支）、`gpu`（GPU 信息：CUDA 版本 / 驱动 / Metal 等级）、`framework`（框架名 + 版本）、`freeVramMiB`（显存余量，经 `nvidia-smi --query-gpu=memory.free --format=csv`）、`degradationHint`（降级提示）、`ready`、`steps`（审计留痕）。
- GPU 检测经依赖注入（exec 探测函数可 mock）——Linux GPU 分支以单测 mock 验收，真机验收留 v1.4.3（GPU 队列版）。

---

## 二、协议三约定（双栈的接口契约）

> SSOT：`engine/orchestrator/src/train/train-protocol.ts`。此处只述约定本身，字段以源码为准。

### 约定一 · 启动：Node spawn Python + 单 JSON config

`python train.py --config <job.json>`——参数收敛为一个 JSON 文件（数据路径 + 基座 + 算法 + 超参 + checkpoint + 产物目录 + 预算），Node 不传散参数。job.json 即训练任务完整快照，审计可读。

### 约定二 · 回报：stdout 只打 JSON 事件流

Python 进程的 stdout 只允许输出 JSON 行（progress / checkpoint / done / failed 四类事件），Node 逐行解析更新状态。**禁止 print 非 JSON 文本**（污染事件流）。坏行不崩溃——记协议错误审计事件后继续解析（容忍训练库的 warn 输出）。

### 约定三 · 控制：SIGINT 存 checkpoint 后暂停

Node 发 SIGINT → Python 捕获后存 checkpoint 优雅退出（退出码 0）→ Node 记录断点 → 续跑从断点恢复。SIGINT 超时未退出升级 SIGKILL（沙箱超时兜底）。超预算（时间 / 步数 / 成本三维度，见 `train-budget.ts`）走同一 SIGINT 通道 + 人审。

三约定的价值：**接口即解耦**——Python 侧可以换任何框架（verl / TRL / DeepSpeed），只要守住三个约定就能被 Node 编排；协议即版本边界——schema 定稿后新增字段走版本号，breaking change 走 migrate 子命令 + 人审。

---

## 三、路径说明：阶段 0 与生产

### 阶段 0 · Mac @mlx-node/trl（纯 Node 验证 reward 收敛）

**定位**：在 Mac 开发机（Apple Silicon Metal）上，用 `@mlx-node/trl`（npm 0.0.10 实验版）的 Rust native 计算核心（`@mlx-node/core` 的 `MxArray`——底层即 MLX → Metal GPU）验证「reward 规则 → 参数学习 → reward 收敛」这条最小回路。**它不替代生产训练**——它是降级路径上的概念验证：证明双栈里 Node 这一侧对 reward 语义的理解是可实测的，而不是纸面推理。

**实测记录（2026-08-25 · A18 Pro · macOS darwin arm64 · Node v24.19.0）**：

| 验证项 | 方法 | 结果 |
|---|---|---|
| Metal GPU 实算 | `MxArray.randomNormal` + `matmul`（1024×1024）×10 | 通过，~7ms/次 |
| reward 收敛（确定版） | toy reward `r(w)=1-\|w-target\|²/D` + 解析梯度上升 40 步 | 通过：reward -0.25 → 1.000000，末段增益 2.12e-9 |
| reward 收敛（GRPO 风格） | 组采样（groupSize=8）+ 相对优势 `(r-mean)/(std+ε)` + 组内竞争权重 | 通过：meanReward -0.263 → 0.9882（含噪上限 ≈0.994），末段抖动 0.003 |
| trainer API 契约 | `GRPOTrainer.create` / `SFTTrainer.create` fail-fast 校验 | 完好：缺 modelPath / 路径不存在均正确拒绝 |

**实测结论**：`@mlx-node/trl` 的 **trainer 完整能力（SFT/GRPO 真跑）需要本地模型权重目录**（`config.json` + `tokenizer.json` + safetensors，如 Qwen3-0.6B）；API 契约层完好、native 计算核心可用。阶段 0 采用**降级概念验证**路径：不下载模型权重，直接用其 native 计算核心验证 reward 收敛——已通过（上表）。

**已探明的坑（后来者必读）**：

- 该包依赖 `@std/toml: npm:@jsr/std__toml@^1.0.11`，该别名在 npm registry 上 **404**——直接 `npm install @mlx-node/trl` 会失败。绕过：本地 shim + `overrides`（阶段 0 实测目录内有完整示例）。
- `MxArray` 的 shape 参数是 `BigInt64Array`（不是 number[]）；`randomNormal(shape, mean, std)` 的 mean/std 必填；标量读取用 `toFloat32()[0]`（`.d.cts` 声明的 `item_float32` 在运行时不存在——声明与实现有出入）。
- 隔离纪律：实测在 `/tmp` 独立目录（`mktemp -d`）进行，`npm install` 用 `--prefix` 或在该目录内执行——**绝不碰仓库 package.json / node_modules**。

### 生产 · Python 框架 spawn（verl / TRL / DeepSpeed）

生产训练全部走 Python 栈：Node 控制面按协议三约定 spawn `python train.py --config job.json`，计算面在 CUDA GPU 上执行 LoRA 微调 / GRPO / DPO。Linux GPU 真机验收留 v1.4.3（GPU 队列 + 监控版）；本版的 cuda-ready 分支以单测 mock 验收（nvidia-smi 存在 / 不存在 / 输出损坏三场景）。

---

## 四、复用优先原则（自研边界）

| 能力 | 决策 | 依据 |
|---|---|---|
| LoRA 计算 | **复用** LLaMA-Factory / Unsloth / verl spawn | 确定性计算，成熟框架，自研无增益 |
| 实验跟踪 | **复用** MLflow | 标准生态，Node 侧只消费其 API |
| 推理（评估 / 采样） | **复用** vLLM / SGLang | 高吞吐推理是独立成熟赛道 |
| 训练任务编排 + 四源语料闭环 + 训练审计 | **自研** | sofagent 的产品核心——约束层治理视角的编排 / 审计 / 回溯是差异化所在，外部框架没有等价物 |

一句话：**计算交给成熟框架，治理留给自己。** 自研面只做 Node 控制面（train-job 编排 / 预算 / 断点 / 审计）+ 数据闭环（四源语料），任何「用 Node 重写一遍训练算子」的冲动都应该被这个表格拦下。

---

## 五、相关文件索引

| 文件 | 角色 |
|---|---|
| `engine/orchestrator/src/train/train-protocol.ts` | 协议三约定 SSOT（job.json schema / 事件流解析 / 信号控制） |
| `engine/orchestrator/src/train/train-budget.ts` | 训练预算控制（时间 / 步数 / 成本三维度，超限 SIGINT + 人审） |
| `engine/orchestrator/src/train/train-env.ts` | 环境准备（GPU 检测 / 框架安装验证 / 就绪报告） |
| `engine/orchestrator/src/__tests__/train-env.test.ts` | 环境准备测试（mock 三场景 + Mac 真机集成） |
| `docs/changelog/v1.4/v1.4.1.md` | 版本目标与八大块排期 |
