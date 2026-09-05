# train-quickstart.md · 后训模块 5 分钟跑通（10 条 CSV → serve 全链路）

> v1.4.5 第六章交付。面向第一次接触 sofagent 后训模块的工程师：**给一份 10 条数据的 CSV，从环境准备到推理服务跑通**。每步三件套——命令、预期输出片段、失败排查。所有输出均为 2026-09-05 实测（macOS A18 Pro · Metal 4 降级分支），V4 基线以实跑为准。工具全景见 [train-stack.md](./train-stack.md)（双栈契约）与 [train-security.md](./train-security.md)（安全基线）。

**前置**：Node ≥18、Python 3.10+（可选——Metal 降级分支用 npm 包）。沙箱纪律：实验数据放独立目录，`SOFAGENT_HOME` 指向它（须在允许前缀内，否则回退 `~/.sofagent` 并告警）。

```bash
mkdir -p /tmp/sofagent-qs/home/data
export SOFAGENT_HOME=/tmp/sofagent-qs/home
export SOFAGENT_HOME_ALLOWED_PREFIXES=/tmp/sofagent-qs   # 越界防护白名单（v1.3.2 P0-RC2）
cp docs/guides/examples/quickstart-data.csv "$SOFAGENT_HOME/data/"
```

---

## 一、数据就位（10 条合成 CSV）

示例数据 `docs/guides/examples/quickstart-data.csv`——instruction/output 两列，主题为任务拆分示例（会议记录拆任务 / 评审意见转清单 / 故障复盘转行动项），**无任何敏感信息，可直接跑**。配 `docs/guides/examples/quickstart-job.json`（最小 job 模板，见第六步）。

**预期**：`wc -l` 出 11 行（1 表头 + 10 数据）。

**排查**：列名不是 instruction/output？第六步 dry-run 的列映射会按常见命名自动推断，也可显式传 `column_mapping`。

## 二、环境准备（train env init）

```bash
bash tools/train/train-env-init.sh "$SOFAGENT_HOME/data" quickstart-demo
```

实测输出（Mac 无 CUDA → Metal 降级分支）：

```
[sofagent] 训练环境一键安装（train env init）→ /tmp/sofagent-qs/home/data/train/quickstart-demo/train-env.json
  ✓ python-detect: Python 3.13.12
  ✓ gpu-detect: Apple A18 Pro · Metal 4（降级分支）
[sofagent] framework-install: npm install @mlx-node/trl --prefix …/sofagent-train-env
  ✗ framework-install: npm install @mlx-node/trl 失败（@mlx-node/trl 是实验包——网络不可达或包未发布时属预期，生产训练走 CUDA 服务器）
  ✓ manifest: /tmp/sofagent-qs/home/data/train/quickstart-demo/train-env.json
[sofagent] 完成。
```

⚠️ **当前限制（如实披露）**：`@mlx-node/trl` 依赖 `@std/toml: npm:@jsr/std__toml` 在 npm registry 404——直接安装必失败（train-stack.md「已探明的坑」有完整绕过方案：本地 shim + overrides）。**此失败不阻塞本 quickstart 的其余九步**（提交/监控/eval/部署/serve 均不依赖该包——只有真跑权重计算需要）。CUDA 机器上此步装 verl，正常成功。

## 三、环境体检（train doctor）

```bash
node engine/orchestrator/dist/cli.js train doctor
```

实测输出：`📋 训练任务体检：运行中 0 个（子进程存活 0 / 假活 0）` + `✅ 训练环境体检通过`。

四项细查走 MCP `train_doctor`（CUDA/显存/框架/基座缓存 + 反作弊三项），Mac 实测：cuda=fail（无 nvidia-smi，预期）、framework=fail（mlx 未装，见第二步限制）、modelCache=fail（候选 Qwen3-8B/14B 未下载，预期——只查不装）。

**排查**：CUDA 机器 cuda 仍 fail → 检查 `nvidia-smi` 可执行；modelCache fail → 走 model-downloader 下载（断点续传）。

## 四、训练预检（train dry-run）

```js
// node --input-type=module
import { runDryrun } from '<repo>/engine/orchestrator/dist/train/train-dryrun.js';
const r = runDryrun({ dataPath: '/tmp/sofagent-qs/home/data/quickstart-data.csv', algorithm: 'sft' });
console.log(r.passed, r.checks.map(c => `${c.name}:${c.status}`).join(' '));
```

实测输出：`passed = true`——`pipeline-connectivity ok`（10 条读取 → 10 条样本成型，列映射自动推断）、`data-preflight ok`（无字段缺失）、`vram-preflight skip`、`scale-extrapolation skip`（两项可选，未传输入即跳过）。

**排查**：connectivity fail → CSV 编码/列名；显存预估 fail → 降 batch 或开 gradient_checkpointing 再试。

## 五、选型（train analyze · 场景模板推导）

需先有访谈节点（`fde_interview` 落盘五要素）——quickstart 数据即对应「文本提取」场景：

```js
const r = analyzeTrainNeed(dataDir, 'quickstart-demo', 'weekly-report');
// scenario: extraction | confident: true | evidence: 抄录
// templateId: extraction-qlora | algorithm: sft | evalMetric: exact_match ≥ 0.90
// submitHint: train_submit（algorithm=sft，hyperparams 含 qlora.oumi 配置——base_type=dense）
```

报告落 `data/train/quickstart-demo/analyze/weekly-report.json`。模板库全景：`node engine/orchestrator/dist/cli.js train templates`（四场景 × QLoRA/SFT/DPO + RL 配置）。**注意**：模板要求数据 ≥500 条，quickstart 10 条仅验证链路——真训练请按 dataRequirement 补样。

## 六、提交（train_submit）

```js
const r = createTrainJob({ dataDir, enterpriseId: 'quickstart-demo',
  dataPath: 'quickstart-data.csv', baseModel: 'Qwen3-0.6B', algorithm: 'sft',
  hyperparams: { epochs: 1, maxSteps: 8 }, budget: { maxMinutes: 5, maxSteps: 8 } });
// created = true | jobId = job-mtnxx5in-99e743e9 | status = queued
```

MCP 面等价：`train_submit`（`data_path`/`base_model`/`algorithm`/`enterprise_id` 四必填）。幂等：同 `train_job_id` 重复提交返回既有任务。产物目录 `data/train/<企业>/<jobId>/`（state.json + job.json + events.jsonl）。job.json 模板见 `docs/guides/examples/quickstart-job.json`（协议 SSOT：train-protocol.ts，schemaVersion v1）。

**排查**：enterprise_id 缺失被拒（企业隔离分区硬约束）；协议校验失败看返回的 issues 数组逐条修。

## 七、监控（train_status）

```js
const jobs = listJobsGuarded(dataDir, 'quickstart-demo');
// job-mtnxx5in-99e743e9:queued
```

MCP 面：`train_status`（status/step/loss/reward 曲线——读 events.jsonl）。生产路径由 daemon 调度器接管 spawn（协议三约定：单 JSON config / stdout JSON 事件流 / SIGINT 存 checkpoint）。

## 八、评估（train eval）

先建题库（statement 公开 / rubric 私有物理分离），再对 job 跑 eval：

```js
const def = createBenchmark('quickstart-eval', { title: '任务拆分评估', description: '…' });
addCase(def, { name: 'weak-net-issue', statement: '把「登录页弱网加载超过十秒」整理为一句可执行问题',
  rubric: '包含对象（登录页）、条件（弱网）、指标（十秒）即可', goldScore: 80 });
freezeBenchmark(def); writeBenchmarkLayout(def, benchmarksRoot(dataDir));

const r = await runTrainEval({ dataDir, enterpriseId: 'quickstart-demo',
  trainJobId: jobId, benchmarkId: 'quickstart-eval',
  agentFn: async (ctx) => /* 训后模型调用——demo 用固定回答 */ '…' });
// averageScore: 100 | failureRate: 0 | decision: stop
// reason: 综合分 100.0 ≥ 80 且无短板 case——达标收工，产出权重
```

逐 case 写 evaluation-log（HMAC 链）。训练报告：`generateTrainReport(...)` → `data/dashboard/train-reports/<jobId>.md`。

**排查**：`decision: continue` 且 reason 提示失败占比高 → 先修评测链路（agentFn 异常会记 failureCode=evaluation_failed）。

## 九、部署（产物注册）

```js
const reg = registerTrainArtifact({ dataDir, enterpriseId: 'quickstart-demo',
  trainJobId: jobId, evalReport, weightsDir: dataDir + '/models/quickstart-weights' });
// ok = true | action = registered | versionId = v1
// message: 训练产物已注册：quickstart-demo-Qwen3-0.6B@v1（eval 100，manifest 校验通过）
```

三重闸：train done（仅 completed 可注册）→ eval pass（decision=stop）→ 归属一致。权重进 `models/quickstart-weights/`（manifest.json + v1/，sha256 溯源）。挂载建议给出后**人工确认再 model_switch**。

## 十、推理服务（train serve）

```js
const mgr = createTrainServeManager({ dataDir });
await mgr.start({ enterpriseId: 'quickstart-demo', weightsDir: …,
  modelName: 'quickstart-demo-Qwen3-0.6B', backend: 'openai-compatible', port: 19000 }, 'quickstart-fde');
// state: running | endpoint: http://127.0.0.1:19000
mgr.status('quickstart-demo', 'quickstart-demo-Qwen3-0.6B');  // + /health 就绪探测
mgr.stop('quickstart-demo', 'quickstart-demo-Qwen3-0.6B');    // SIGTERM 优雅 → 停
```

三后端（vllm/ollama/openai-compatible）都暴露 OpenAI 兼容端点；健康探测指数退避重试；model_switch 切模型自动拉起新服务（linkSwitchToServe）。每次启停记 `train_serve` 审计事件（`data/train/<企业>/serve-<model>/audit.jsonl`——实测含 start/stop 两行）。

**排查**：start 报权重目录不存在 → 第九步未跑或 weightsDir 路径错；/health 一直不通 → 后端冷启动慢，看退避重试次数（缺省 10 次）。

---

**全链路数据流**：CSV → dry-run 预检 → 选型（场景模板）→ 提交（job.json 快照）→ 监控（events.jsonl）→ eval（题库+HMAC 链）→ 注册（manifest+sha256）→ serve（OpenAI 兼容端点）。每步产物落企业分区 `data/train/<enterpriseId>/`，全程可审计。
