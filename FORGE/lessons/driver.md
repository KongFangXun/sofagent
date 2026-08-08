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
const TOOL_SOFT_LIMIT  = 100;  // L1: 超此值注入"立即写报告"HumanMessage
const TOOL_HARD_LIMIT  = 100;  // L2: 超此值进入"写报告窗口"
const REVIEW_GRACE_STEPS = 80; // L2 触发后审查步骤的写报告窗口（superstep 数）
const DEFAULT_GRACE_STEPS = 5; // L2 触发后其他步骤的写报告窗口（superstep 数）
```

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
