# 四、Driver 编排规范

> [← 返回索引](./index.md)

### recursionLimit 按步骤区分

| 步骤类型 | recursionLimit | 理由 |
|---------|---------------|------|
| 审查类（a-check/b-check） | 130 | L2 硬熔断在 100 次工具调用时触发（≈superstep 200），写报告窗口 REVIEW_GRACE_STEPS=80 |
| 文本处理类（a-consolidate） | 50-100 | 主要做合并/格式化 |
| 修复类（b-fix） | 100-150 | 每个修复点 Read→Edit→Test 三步 |
| 验证类（a-verify） | 50-150 | 简单验证给低，复杂验证给高 |
| regression（release-gate） | 250-400 | 46 维度 × 批量执行 |

**换算公式**：每次工具调用 = 2 步（model call + tool node）。25 步 ≈ 12 轮工具调用。

> **坑源**（commit 3248395）：统一 recursionLimit=150 导致 a-consolidate OOM。
>
> **🔴 死循环坑源**（run-01~run-06）：Qwen3.8 无视 prompt 铁律，1119 次工具调用打爆 recursionLimit 零产出。详见下方 §Worker 工具调用死循环防护。

---

### Worker 工具调用死循环防护（三层熔断）

> **来源**：run-01~run-06（commit 95cd74a → ca9e329 → a610d5d → dd5dde2 → f240594 → 701582a）

**根因**：Qwen3.8 在开放审查场景下会无限探索。prompt 层铁律（L0）对 Qwen 无效，必须在代码层做三层熔断。

#### LangGraph createReactAgent 消息模式（必知）

createReactAgent 中间所有 superstep 的 AI message 全是纯 tool_call（content 为空），只有最后决定停止调工具时才有文本：

```
superstep 1: AIMessage(content="", tool_calls=[{name:"sf_read"}])  ← 空
superstep 2: ToolMessage(content="文件内容...")
...
superstep N: AIMessage(content="审查报告...", tool_calls=[])        ← 唯一有文本
```

**后果**：硬熔断如果在最后一条消息触发，可能所有消息都没有文本 → extractAgentText 必须跳过空 content → 全空则需兜底合成。

#### 三层熔断架构

```
L0 prompt 铁律（commit 95cd74a，对 Qwen 无效但保留）
  ↓ 被无视
L1 软熔断 TOOL_SOFT_LIMIT=100（stateModifier 注入 HumanMessage）
  ↓ 被无视
L2 硬熔断 TOOL_HARD_LIMIT=100 + 写报告窗口 REVIEW_GRACE_STEPS=80（stream loop 两阶段）
  ↓ 仍未产出
L3 框架兜底 recursionLimit=130（GraphRecursionError 兜底）
```

```js
// v1.2.7 run-07 下调（原 100/100 导致 run-06 空转）：零窗口=撞硬上限立即中断
const TOOL_SOFT_LIMIT  = 35;  // L1: 超此值注入"立即写报告"HumanMessage
const TOOL_HARD_LIMIT  = 45;  // L2: 超此值进入"写报告窗口"
const REVIEW_GRACE_STEPS = 0; // L2 触发后审查步骤的写报告窗口（v1.2.7 起 0=立即中断）
const DEFAULT_GRACE_STEPS = 0; // 其他步骤同上
```

#### 并行工具调用让硬熔断"超发" + 步骤级预算覆盖（v1.3.0 run-21）

**并行超发**：硬熔断检查在**回合边界**（stream chunk）执行，而 GLM-5.2 单个回合可并行发出多个 tool_call——计数跳跃式增长，`TOOL_HARD_LIMIT=45` 实际在 48/54/60 次才熔断。**硬上限是下限不是精确值**，关键步骤不能依赖"45 就停"。

**步骤级预算**：`stepDef` 支持 `toolSoftLimit` / `toolHardLimit` 覆盖（v1.2.9 功能①加给 perspective worker 12/15）。对"必须读 N 份文件"的步骤（如 a-consolidate 要 sf_read 24 份 check 报告，天然 40-60 次调用），**必须单独配预算**，别用全局值：

```js
// ✅ a-consolidate：读 24 份报告 + 写长输出，60/80 足够且不会空转
// （run-21 教训：用全局 45 必然熔断 → 兜底产物格式坏 → 假绿停止）
'a-consolidate': { toolSoftLimit: 60, toolHardLimit: 80, ... },
// ❌ 不重蹈 run-06：全局 60/80 让 check 类步骤无限探索空转——check 有自己的 12/15
```

**判断标准**：步骤的工具调用数 = 必读文件数 + 探索余量。必读文件多的步骤单独提预算；开放探索类步骤压低预算（12/15）。

#### L2 两阶段写报告窗口（关键设计）

> **来源**：run-06 暴露——L1 单阶段硬熔断会打断"写报告"动作本身。85-102 条消息全是 tool_call/tool_result，一条 AI 文本都没有。

```js
let inGraceWindow = false, gotReport = false, graceStepCount = 0;

for await (const chunk of stream) {
  if (!inGraceWindow && toolCallCount >= TOOL_HARD_LIMIT) inGraceWindow = true;

  if (inGraceWindow) {
    graceStepCount++;
    if (aiMessageHasContent(lastMessage)) { gotReport = true; break; }  // 拿到报告
    if (graceStepCount >= TOOL_GRACE_STEPS) break;                       // 窗口耗尽
  }
}
```

**核心**：L2 触发后不立即 break，进入 5 superstep 窗口给模型最后机会输出文本。

#### 兜底报告合成

窗口耗尽仍无 AI 文本时，从 ToolMessage 提取文件路径合成最小报告：

```js
function synthesizeReportFromMessages(messages) {
  const filePaths = messages.filter(m => m instanceof ToolMessage)
    .map(m => extractFilePaths(m.content)).flat();
  return `# 降级报告（工具调用超限自动合成）\n\n## 已审查文件\n${filePaths.map(p => `- ${p}`).join('\n')}`;
}

function extractAgentText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = messages[i].content;
    if (typeof text === 'string' && text.trim()) return text;  // ← 跳过空 content
  }
  return synthesizeReportFromMessages(messages);  // 全空，兜底合成
}
```

#### allSettled 并行降级

check-a / check-b 并行时用 `Promise.allSettled` 替代 `Promise.all`——一方崩溃不拖死另一方。失败 Worker 写降级占位，用 `existsSync` 判断不覆盖已有产物。

#### 降级检测防假阳性干净

> **来源**：run-05——4 个 worker 全崩 → 降级占位被当"审查通过干净轮"。

```js
const DEGRADATION_MARKERS = ['降级报告', '工具调用超限', 'DEGRADED', '自动合成', '占位报告'];

// parseStopCondition 里
const isDegraded = DEGRADATION_MARKERS.some(m => text.includes(m));
const isClean = !isDegraded && (p0 === 0 && p1 === 0 && p2 === 0 && !hasFail);
```

**核心原则**：占位/降级产物**永远不算干净轮**。

#### 🔴 产物完整性校验（防"假成功"——v1.3.0 run-21 教训）

> **来源**（run-21，2026-08-09）：driver 报 `2-rounds-clean`（P0=0/P1=0/P2=0），实际 3 轮 findings 全丢——**现有降级检测只防「失败→降级」，没防「成功但格式坏→静默判空」**。

**假成功根因链**：

```
a-consolidate 撞硬熔断（40-60 次调用 vs 全局 45）
  → generateReportWithoutTools 兜底返回"非空文本"  ← driver 视为成功
  → 但文本缺 ===FILE: 分隔符
  → sliceMultiOutput fallback：findings.md=全文 ✓ / result.md=空占位 ✗
  → splitFindings(result.md)=0 条 → b-fix 跳过 → 连续 2 轮"干净" → 假绿停止
```

**铁律**：
1. **"有输出" ≠ "解析成功"**。兜底/正常路径产出的文本必须过**产物完整性校验**：多产物步骤写盘后检查每个判定产物，`result.md` 为空占位（匹配 `未检测到 ===FILE:|agent 未产出此文件`）→ 立即触发降级重建（writeFallbackFindings），不得静默跳过。
2. **判定产物与展示产物解耦的盲区**：sliceMultiOutput 无分隔符 fallback 是「findings.md 拿全文、result.md 只写占位」——但停止判定（splitFindings/parseStopCondition）只看 result.md。**判定产物必须永远有可解析内容**（哪怕降级重建为 `### finding-NN` 最小结构），展示产物内容再全也救不了空判定产物。
3. **降级重建的 result.md 要可消费**：重建格式用 `### finding-NN`（带 `**优先级**: P0/P1`），splitFindings 才能切片、b-fix 才能真修、parseStopCondition 才能数对——只写 `| fallback | SKIP |` 表格会让 b-fix 空转重试（"不假绿"但"修不了"）。
4. **排查陷阱**：grep `===FILE:` 判断分隔符存在时，占位注释文本本身含该字样（`未检测到 ===FILE: 分隔符`）→ `grep -c` 假阳性 1。用排除法或更精确 pattern（如 `grep '^===FILE:'` 只匹配行首）。

**run-22 补充（finding-NN 格式铁律）**：result.md **有内容但用分类段落**（`### 🔴 P0 阻塞项`）而非 `### finding-NN` 时，splitFindings 同样切 0 条 → 假绿。修复：① 兜底报告生成器 prompt 强制 result.md 每条用 `### finding-NN`（含 **问题**/**修复方案**/**验证** 三段，禁止分类段落标题）；② 检测扩展：result.md 空占位 **或**（切 0 finding 且含 P0/P1/P2 标记）→ 触发降级重建；无任何 P 标记才视为真干净（避免真干净轮被拖成永不停止）。

**run-23 补充（降级标记持久化）**：降级标记（`降级生成` 文本）**不能只写在会被下游覆盖的产物里**——a-verify 会覆盖 result.md（回填 verify 列）把标记抹掉 → 降级轮被误判 isClean=true（run-23 R1 实测）。**降级状态必须独立持久化**：writeFallbackFindings 额外写 `roundDir/degraded.flag`，parseStopCondition 优先查 flag（existsSync），文本标记匹配保留做旧 run 数据兼容（取或）。原则：**会被下游覆盖/重写的文件，不能承载跨步骤的判定状态**。

**修复范式（三层防御）**：防熔断（步骤级预算）→ 兜底格式（裸 LLM 生成器对多产物步骤也输出 `===FILE:` 分隔符 + finding-NN 结构）→ 最后保险（判定产物空占位/格式不符检测 + 降级重建 + isDegraded 强制不干净）。

#### 🔴 worker 写完产物不退出 → driver 永久 await（v1.3.0 run-23）

> **来源**（run-23 round-5，2026-08-09）：b-fix 第 3 批 worker 写完 `summary-batch-3.md` 后进程不退出，driver 的 `spawnWorkerStep` await 挂起 18 分钟（heartbeat 正常——await 不阻塞 event loop，心跳定时器照跑——但流程完全冻结）。

**根因**：worker 模式 `await runWorker()` 成功后**直接 return，无 `process.exit`**。runWorker 内部残留未清理句柄（LangGraph stream / API 长连接 / 定时器 / audit middleware 监听器）时，Node 事件循环不清空 → 进程永不退出。

**判断特征**：心跳正常（15s 更新）+ 某步产物已写全 + 下一步产物迟迟不出 + 工作区改动未 auto-commit——即 driver 卡在 await 某个 worker。

**两层修复**：
1. **worker 侧（治本）**：worker 写完产物后强制 `process.exit(0)`，无视残留句柄——`process.exit` 直接终止事件循环。
2. **driver 侧（兜底）**：`spawnWorkerStep` 加 30 分钟超时（正常 worker 最久 ~15 分钟），超时 `SIGKILL` + resolve 124，调用方 catch 后把该批记为失败继续流程——**任何 worker hang 都不会再卡死 driver**。

**铁律**：spawn 子进程必须配套超时兜底；子进程写完全部产物后必须显式退出（`process.exit`），不能依赖"事件循环自然清空"。

#### 连续降级 error 退出

连续 2 轮降级 → `fatal-error` 退出，不浪费 token 跑无意义循环。

#### stream.return() 防"幽灵"API 请求

硬熔断 break 后必须 `await stream.return()` 显式清理 generator，否则 LangGraph 可能在后台继续发 API 请求（commit dd5dde2）。

---

### 失败路径容错

```js
try {
  await spawnWorker('a-consolidate', roundDir, target, roundNum);
} catch (err) {
  console.warn(`⚠️ a-consolidate 失败: ${err.message}`);
  writeFallbackFindings(roundDir);  // 拼接 P0/P1 摘要
}
```

降级三原则：① "有"比"没有"强 ② 只提取 P0/P1 摘要 ③ catch 块也要写可见性事件

**Driver 致命错误**（commit 4a4a143）：catch 块用模块级 `globalVisibility` 引用写 ERROR + LOOP_END 事件，否则 status.json 停在 `round-1-running`。

### 分片执行模式

finding >10 条时分片——每批独立 Worker（零历史消息）：

```js
function computeBatchSize(n) { return n <= 20 ? 5 : n <= 35 ? 3 : 2; }
```

**防回归检查**：切出 0 条 finding 但 result.md 中 P0+P1 > 0 时报警。

### 停止条件判定

Driver 唯一做语义判断的地方——数 P0/P1/P2 + FAIL，不做语义审查。收敛策略：连续 2 轮干净（`cleanStreak >= 2`）。

> **🔴 假阳性干净**（run-05）：降级占位无 P0/P1 被当"审查通过"→ driver 误收敛。**降级轮的 isClean 永远为 false**。

#### LEDGER 会被假阳性 run 污染（v1.3.0 run-21）

LEDGER.md 是 append-only 永久索引，假阳性 run 的 `2-rounds-clean 0/0/0` 会**永久入册且无法事后纠正**（run-21 实例）。两条应对：
1. **修复后重跑才是纠错手段**——真 run（如 run-22）的干净记录会覆盖统计口径；
2. 若需历史可审计，给 LEDGER 条目加 `isDegraded`/`suspect` 标记列（当前未做，列为已知改进项）。

---

### 外部脚本 spawn 生存规范

> **来源**（commit 35cfb22）：sandbox 环境 ~20s kill 进程树，等 `close` 事件后 `writeFileSync` 的写法导致日志全丢。

**三条铁律**：

#### 1. 流式写日志（Driver 侧）

```js
const writeStream = createWriteStream(logPath);
child.stdout.on('data', (d) => { stdout += d; writeStream.write(d); });  // ← 实时落盘
```

不等 `close`——被 kill 时只在内存的 stdout 全丢。

#### 2. 处理 signal 参数

```js
child.on('close', (code, signal) => {
  // signal 非 null = 被 kill；code 非 null = 正常退出
  resolveP({ exitCode: code ?? -1, logPath, stdout });
});
```

#### 3. 禁用 `| head -N` 管道（shell 脚本侧）

`set -euo pipefail` 下 `cmd | head -N` → head 关闭管道 → SIGPIPE → `set -e` 退出。

| 场景 | ❌ 危险 | ✅ 安全 |
|------|---------|---------|
| 只关心副作用 | `cmd \| head -N` | `cmd > /dev/null 2>&1 \|\| true` |
| 需要截取输出 | `cmd \| head -N` | `OUT=$(cmd 2>&1 \|\| true); echo "$OUT" \| head -N` |

#### progress 日志

脚本超 30s 时每 30s 输出进度——卡住时最后一行直接告诉你卡在哪。

#### 超时设置

| 来源 | 值 |
|------|------|
| Driver 内部超时 | 脚本预估 3-5 倍（acceptance 2-3min → 超时 15min） |
| Sandbox kill | ~20s-300s（不可控，只能靠流式日志最小化杀伤） |

---

### SOFAGENT_SKIP_HOOK / --skip-acceptance / --step

#### SOFAGENT_SKIP_HOOK 环境变量旁路

`sofagent-audit --init` 入口设 `process.env.SOFAGENT_SKIP_HOOK = '1'`，commit-msg hook 检测到此变量 `exit 0`。防 init 内部 git 命令触发刚安装的 hook。

#### Driver --skip-acceptance

sandbox kill 窗口 < acceptance 执行时间时，手动预跑日志后跳过：

```bash
bash FORGE/playbook/acceptance-test.sh > run-00/acceptance-raw.log 2>&1
node driver.mjs --target v1.2.5 --skip-acceptance
```

#### Driver --step 单步执行模式

| 模式 | 触发 | 适用场景 |
|------|------|---------|
| 全量（默认） | `--target vX.Y.Z` | 正常发版 |
| 单步 | `--step <name> --target vX.Y.Z` | 沙箱 OOM / CI 内存受限 |
| worker | `--worker --step <name>` | 内部机制 |

```bash
node driver.mjs --step acceptance  --target v1.2.5 --run-dir "$RUN_DIR"
node driver.mjs --step regression  --target v1.2.5 --run-dir "$RUN_DIR"
# ...每步全新进程退出，内存归零
```

#### V8 heap 限制：--max-old-space-size（反直觉优化）

```bash
# ✅ 1536MB——v1.2.5 run-07 教训：768MB 在 6 轮长循环中主进程静默 OOM
node --max-old-space-size=1536 driver.mjs --step regression
```

**演进史**：最初用 768MB 迫使 V8 频繁 GC（old space 膨胀到 macOS jetsam 阈值被 kill），RSS 反而更低。但 v1.2.5 run-07 实测：6 轮 30+ worker 并发时 768MB 不够主进程自身用，静默 OOM（exit 137）。改为 1536MB 后稳定。单步短循环（release-gate）可容忍 768，但为统一不再区分。

> **三层防御**：preModelHook（旧消息可 GC）+ `--max-old-space-size=1536`（v1.2.5 起从 768 上调；v1.2.9 run-09 起再调至 2048）+ `--step`（每步归零）—— OOM 阈值从 17→198 次工具调用。

---

### 🔴 跨闭包变量引用：JS 作用域陷阱（v1.2.9 run-07）

> **来源**（run-07，2026-08-08）：`effectiveHardLimit is not defined` 导致全部 24 个 worker 瞬间崩溃。

**根因**：`effectiveHardLimit` 在 `stateModifier` 闭包内定义（L783），但 `invokeAgent` 函数在另一个闭包里引用它（L955）。两个闭包互相不可见对方的局部变量。

```js
// ❌ 错误——变量在闭包 A 定义，闭包 B 引用
const agent = createReactAgent({
  stateModifier: (state) => {
    const effectiveHardLimit = stepDef.toolHardLimit ?? TOOL_HARD_LIMIT;  // ← 闭包 A
  },
});

const invokeAgent = async () => {
  if (toolCallCount >= effectiveHardLimit) { ... }  // ← 闭包 B：ReferenceError!
};
```

**修复**：把变量声明提到 agent 定义前（两个闭包的共同外层作用域）：

```js
// ✅ 正确——提到共同外层
const effectiveHardLimit = stepDef.toolHardLimit ?? TOOL_HARD_LIMIT;
const agent = createReactAgent({ ... });  // stateModifier 能访问
const invokeAgent = async () => { ... };  // invokeAgent 也能访问
```

**铁律**：重构 LangGraph agent 时，如果同一个变量在 `stateModifier` 和 `invokeAgent`/stream loop 中都要用，必须在 `createReactAgent()` 调用前声明——它俩是平行的闭包，不是嵌套的。

---

### 🔴 nohup+disown 在 WorkBuddy 中不安全（v1.2.9 run-07~11）

> **来源**（run-07/08/09/11，2026-08-08）：4 次 nohup 启动的 driver 全部静默死亡（无 stderr、无 crash handler、heartbeat 停在启动后几秒）。

**根因**：WorkBuddy sandbox 对 `nohup + &disown` 脱离的进程有清理机制——后台进程脱离 session 后被回收。前台直接跑（阻塞终端）时正常，`nohup+disown` 时被杀。

**验证方法**：前台 `FORGE_MAX_CONCURRENCY=1 node driver.mjs` 正常完成 2+ worker → 证明代码没问题，是后台启动方式的问题。

**正确做法**：

| 方式 | 是否安全 | 说明 |
|------|---------|------|
| 前台阻塞执行 | ✅ | 但占住 session 无法监控 |
| `nohup ... &disown` | ❌ | WorkBuddy 清理脱离进程 |
| Bash 工具 `run_in_background: true` + `dangerouslyDisableSandbox: true` | ✅ | Bash 工具管理生命周期，不被清理 |

```bash
# ❌ 危险——被 WorkBuddy 清理
nohup node FORGE/src/fresh-eyes-driver.mjs --target v1.2.9 > /tmp/fresh-eyes.log 2>&1 &
disown

# ✅ 安全——Bash 工具管理后台进程
# 在 Bash 工具调用中设：run_in_background: true, dangerouslyDisableSandbox: true
node FORGE/src/fresh-eyes-driver.mjs --target v1.2.9 2>&1
```

**注意**：`dangerouslyDisableSandbox: true` 仍然是必须的——driver(spawn) → worker(spawn) → execSync(child_process) 三层进程嵌套，sandbox 对嵌套层数有限制，第 4 层返回时整棵进程树被 SIGKILL（run-01~03 教训）。

---

### 🔴 零信任复核：worker 的 FAIL 判定不可全信（v1.2.5 run-06~08 教训）

**背景**：release-gate regression worker 读 precheck JSON 做判定时，连续三轮（run-06/07/08）报出的 FAIL 经人工复核**全部是检查命令自身缺陷导致的误报**，没有一个是产品代码真实 bug。

**四个典型案例**（regression-checklist.md 检查命令缺陷）：

| 缺陷类型 | 案例 | 表现 |
|------|------|------|
| 期望值过期 | #4 | 规则数期望写死 21，实际 v1.2.0 起已是 24 |
| 环境假设错误 | #7 | 把 .gitignore 的运行时文件（config.yml）缺失判为 FAIL，干净 clone 必然"失败" |
| 比对格式不归一 | #4 | TS 源码 vs README 表格行直接 diff，两种格式永远有差异 |
| 子串误匹配 | #49 | 扫旧路径残留时 `sofagent/skill/` 匹配到正确路径 `~/.sofagent/skill/` 的子串 |

**铁律**：
1. **FAIL ≠ 真实 bug**。worker/报告判的 FAIL 必须亲手实跑检查命令复核后才能定性
2. 复核动作：把 checklist 里该维度的命令原样复制执行 → 看输出 → 判断是产品缺陷还是命令缺陷
3. 确认是命令缺陷 → 修 checklist（加豁免/归一化/前置判断），**绝不修产品代码迁就错误检查**
4. 检查命令的豁免逻辑（历史文档目录、运行时文件、HOME 部署路径）是误报最高发区，新增检查项时先想豁免

> **判定流程**：release-gate FAIL → 零信任复核（亲手跑）→ 产品 bug？修代码 ：命令 bug？修 checklist → 重跑验证全绿
