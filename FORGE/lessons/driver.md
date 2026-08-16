# 四、Driver 编排规范

> [← 返回索引](./index.md)

### preflight-check 跑前自检

> **来源**：FORGE preflight-check 模块（`FORGE/src/driver-base.mjs` 导出 `runPreflight`）。fresh-eyes-loop / release-gate-loop 单次跑 15-60 分钟、烧真实 API 额度，环境不健康时中途崩溃代价极高。开跑前 1 分钟内把环境前置条件全部验一遍。

**六项检查与阻塞策略**：

| # | 检查项 | 级别 | 失败表现 |
|---|--------|------|---------|
| ① | cwd / repoRoot 路径 | HALT | 目录不存在/不是目录 → git 命令全崩 |
| ② | stdout 管道 SIGPIPE | **WARN** | stdout 是管道 → 下游 `| head` 截断会杀 driver |
| ③ | 模型 API 可达 | HALT | fetch 超时/网络错误 → 长任务必然中途断 |
| ④ | 工具预算配置 | HALT | soft > hard 预算倒挂 → 熔断逻辑失效 |
| ⑤ | runDir 可写 | HALT | 无法创建/写入 → 产物写不出去 |
| ⑥ | 磁盘空间 ≥ 200MB | WARN | 磁盘快满 → 产物写一半断 |

**🔴 关键设计修正：② stdout 管道定为 WARN 而非 HALT。** 原因：`tools/forge-smoke-test.sh` 用 `$(node driver --dry-run)` 命令替换调用 driver，命令替换的 stdout 天然是管道——若管道判 HALT 会打破冒烟测试的 exit 0 契约，也会误杀一切合法的 `> log` 重定向场景。因此管道只 WARN 提醒"别用 `| head`"，不阻塞。

**四条铁律**：
1. **不自动修复危险项**：只报问题 + 给可复制的修复命令（`mkdir -p ...`、`curl ...`），人来执行；唯一允许自动做的是幂等 `mkdir runDir`（目录非危险项）
2. **preflight 自身异常降级 WARN**：检查工具坏了绝不阻塞主流程（driver 里 `try/catch` 包裹 `runPreflight`，异常打 warn 后置 `null` 继续）
3. **API 检查最多一次**：同 baseURL 的角色去重只探测一次；key 缺失不探测（交给 driver 的 `missingEnvs` 检查拦截，避免无 key 探测必然 401 造成误导）；3 秒超时
4. **worker / dry-run / --step 模式跳过**：worker 子进程环境继承主 driver 重复检查纯浪费；dry-run 不真跑 worker 无意义且会打破冒烟测试 RC=0；release-gate `--step` 单步模式外层编排每步一个全新进程，重复自检拖慢编排

**集成点**（都在 main() 的环境变量检查之后）：
- fresh-eyes：`--dry-run` 之外的 Driver 模式，`roles:['A','B']`，预算含 perspective 15/20
- release-gate：`!dryRun && !step` 时，`roles:['V','F']`，仅全局预算 35/45
- 两者 `shouldHalt` 为 true 时 `process.exit(1)`

**测试注入点**（`__inject`）：`fetchImpl / statfsImpl / statSyncImpl / fstatSyncImpl / mkdirSyncImpl / writeFileSyncImpl / unlinkSyncImpl`——FAIL 分支全部靠注入模拟，不依赖真实断网/满磁盘。见 `FORGE/src/preflight-check.test.mjs`（27 用例，六项检查 PASS+FAIL 全覆盖）。

---

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

#### 🔴 降级判定一票否决误伤（v1.3.1 run-03 教训）

> **来源**（run-03，2026-08-10）：driver 报 `consecutive-degraded-error`（连续 2 轮降级熔断），实际 Round 1 的 24 份 check 产物里只有 1 份 `check-a-p6.md` = 184 字节触发降级（其余 22 份都是 2-7KB 正常报告）。**1 份短产物连累 23 份正常产物**，整轮被误判 `isDegraded=true` → 与 Round 2 叠加触发熔断 → 循环白跑两轮退出。

**根因**：原降级判定逻辑（`parseStopCondition`）是「**任一** checkFile < 200 字节 → `isDegraded = true`」——一票否决。但单份短产物更可能是该视角本身发现少（如"文件结构陌生人"对结构清晰的项目确实无话可说），不该上升到整轮降级。

**修复**：改为比例阈值——短产物占比 > 25%（24 份中 > 6 份）才判整轮降级。25% 阈值仍能抓住真·大面积降级（run-05 的 4/4 全崩），同时放过单视角偶发短产物。

```js
// ❌ 改前：任一短产物 → 整轮降级（一票否决误伤）
if (stat.size < CHECK_MIN_BYTES) { isDegraded = true; break; }

// ✅ 改后：比例阈值（短产物 > 25% 才判整轮降级）
const CHECK_SHORT_RATIO = 0.25;
let shortCheckCount = 0, totalCheckCount = 0;
// ... 循环累计
if (totalCheckCount > 0 && (shortCheckCount / totalCheckCount) > CHECK_SHORT_RATIO) {
  isDegraded = true;
}
```

**判断标准**：降级判定要区分「单点偶发」与「系统性失效」。一票否决适合「该产物必须完整否则整轮不可信」的场景（如 result.md 空占位），不适合「多产物中一份偏短」的场景——后者应该看比例。

#### 🔴 perspective worker 工具预算偏紧导致普遍熔断（v1.3.1 run-03 教训）

> **来源**（run-03，2026-08-10）：58 次撞硬上限 + 51 次裸 LLM 降级——24 个 perspective worker 几乎全部靠裸 LLM 兜底产出报告，而非正常的"工具调用 + 分析"流程。根因是 `toolHardLimit=15` 对 12 视角审查（每个视角需读 README → grep → 读 SECURITY → 跑 check-version → 写报告，轻松 15+ 次调用）偏紧。

**修复**：perspective worker `toolSoftLimit` 12→15、`toolHardLimit` 15→20。代价是单轮 token 涨 ~15-20%，但换来 worker 能完成完整审查而非被迫降级。

**权衡原则**：工具预算 = 必读文件数 + 探索余量。短任务化（v1.2.9）时把 perspective 压到 12/15 是为了防 run-06 式无限探索空转，但实测在「每个视角都要读 3-5 个文件」的真实负载下偏紧。开放探索类步骤压低预算（防空转），固定读取类步骤保证预算（防熔断）——**按步骤真实负载调，别一刀切**。

> 注：a-consolidate 已单独配 60/80（v1.3.0 run-21 修复），本次只动 perspective worker。

#### 🔴 裸 LLM 降级产物需过结构校验（v1.3.1 run-03 教训）

> **来源**（run-03，2026-08-10）：裸 LLM 降级报告（`generateReportWithoutTools`）产出的半截碎片（如 184 字节一句话中间思考）被直接写入产物文件，下游 `parseStopCondition` 的 `CHECK_MIN_BYTES=200` 刚卡不住，但碎片不含任何有效审查内容，污染整轮 finding 计数。

**根因**：`generateReportWithoutTools` 的返回值只做了 `respText.trim()` 非空检查，没过 `isReportText` 质量门控（≥500 字符 或 含 ## 标题行）。而 stream loop 路径的 `extractAgentText` 早就有这个门控（v1.2.7 run-07 修复）——两条路径质量标准不一致。

**修复**：`generateReportWithoutTools` 返回前加 `isReportText(respText)` 校验。不达标的碎片返回**结构化占位**（含「降级生成——裸 LLM 报告未达质量门控」标记词 + 该视角审查未完成说明），让下游 `parseStopCondition` 能识别降级、b-fix 不会误读碎片为有效 finding。

```js
// ❌ 改前：只查非空
return typeof respText === 'string' && respText.trim() ? respText : null;

// ✅ 改后：过 isReportText 门控，不达标返回结构化占位
if (respText && isReportText(respText)) return respText;
return [
  `## ${step}（角色 ${role}）审查未完成`,
  '> **降级生成——裸 LLM 报告未达质量门控**',
  '> 本份产物不含有效 finding，请人工复核该视角。',
  '降级占位',
].join('\n');
```

**核心原则**：所有降级路径（stream loop 兜底 / generateReportWithoutTools / synthesizeFallback）的产物质量标准必须一致——都过 `isReportText` 门控。任何一条路径放宽标准，都会成为碎片污染整轮的漏洞。

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

连续 3 轮降级 → `fatal-error` 退出，不浪费 token 跑无意义循环。

> **阈值演变**：
> - v1.2.7（run-06 教训）：3 轮全降级消耗 132k tokens 零产出 → 原始教训就是「3 轮」，阈值设为 `>=2` 偏激进。
> - v1.3.1 run-03 修正：原 `>=2` 在「降级判定本身有误伤」（见下方[降级判定一票否决误伤](#降级判定一票否决误伤v131-run-03-教训)）时，连续 2 轮误判降级即触发熔断，循环在第 2 轮被腰斩，没给第 3 轮自我修复机会。改回 `>=3`，与 run-06 原始教训精确对齐，给偶发降级 1 次容错。

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

#### splitFindings 切 0 条 → 计数全 0 → 假阳性 clean（v1.3.2 run-11）

**复现**：worker 不按 `### finding-XXX` 格式写，而是用自由编号 `### 1. xxx` / `### 2. xxx`。`splitFindings` 的正则 `^### finding-([A-Z0-9-]+)` 一个都匹配不上 → 返回空数组 → P0/P1/P2 全 0 → `isClean=true`。**run-11 Round 1 + Round 2 都触发**：worker 输出有 1 个 P0 + 6 个 P1，但 driver 报 `2-rounds-clean` 直接退出。

**根因**：driver 的 stop 判定**强依赖** worker 按 `### finding-P0-NN` 格式输出，但 worker prompt 没强制约束这个格式。worker 自由发挥时解析返回 0。

**三层防御**（已在 v1.3.2 实现）：

1. **Fallback 解析**（`parseStopCondition` 改造）：`splitFindings` 切出 0 条时，回退到正则数 markdown 表格行 `| **P0** |` + 标题前缀 `^#{1,4}\s+.*\bP0\b`。已知会因叙述性文字（"无 P0""P2/待证实"）出现假阳性计数偏高——但**"偏高让 driver 多跑几轮"比"为 0 让 driver 误判完成"安全得多**（fail-safe 原则）。

2. **Sanity check 兜底**（`parseStopCondition` 出口处）：即使 fallback 也走错（极小概率），只要 reports.md/findings.md 含 P0/P1 markdown 标记，强制把 `isClean` 改 false。这是治本兜底——下次 worker 又换新格式时仍能拦住。

3. **回归测试**（`fresh-eyes-driver.test.mjs: testParseStopConditionFallbackForFreeFormHeadings`）：模拟自由编号格式 + markdown 表格的 reports.md，断言 fallback 能数到 P0/P1，且 `isClean` 不为 true。

**教训**：测试只覆盖了 `splitFindings`（结构化格式正常路径），没覆盖 `parseStopCondition` 整体（结构化失败后的 fallback 路径）。下次新增任何解析逻辑时，**必须同时测"正常格式 + 异常格式 + 空文件 + 损坏文件"四个分支**，不能只测 happy path。

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

---

### 🔴 确定性判定优先：别让 LLM 解读能确定性解析的日志（v1.3.0 run-21）

> **来源**（release-gate run-21，2026-08-09）：acceptance 实际 PASS（241/0/241，exit 0），但 acceptance-consolidate worker 误判 FAIL，F 修复链对假 FAIL 空跑一轮。

**LLM 解读预跑日志的三个误判模式**：
1. **grep exit code 幻觉**：worker 跑 `grep -c "EXIT"` 无匹配 → 命令 exit 1 → worker 把**自己 grep 命令的退出码**当成验收脚本退出码，幻觉「EXIT: 1」——日志里根本无此字样。
2. **不懂领域设计**：acceptance 场景编号非连续是设计（编号间有缺失），worker 把不存在的编号当「9 个场景验收证据缺失」。
3. **WARN ≠ FAIL**：S028 输出 `⚠️ WARN`，worker 当缺陷上报。

**铁律**：**能用确定性规则判定的结果，不要让 LLM 去解读**——脚本日志的总结行是权威（如「验收测试结果：N 通过 / M 失败」+「✅ 全部通过」），driver 用正则直接判定（PASS/FAIL），LLM 解读只做日志不可解析时的兜底。

**🔴 ANSI 坑**：shell 脚本输出带颜色码（`验收测试结果：\x1b[0;32m241 通过\x1b[0m`）——数字与文字间插着 `\x1b[...m` 转义，直接正则匹配失败。**解析脚本日志前必须先剥离 ANSI**：`raw.replace(/\x1b\[[0-9;]*m/g, '')`。

---

### 🔴 F 链收敛要回写权威产物（verdict.md 同步）

> **来源**（release-gate run-21）：V 阶段 verdict.md 写 FAIL → F 修复链收敛（f-audit 通过）→ driver 变量改 PASS → loop-end 写 PASS——但 **verdict.md 文件还是 FAIL 文本**，监控端读文件(FAIL) 与 status.json(PASS) 矛盾。

**铁律**：**driver 内部状态变量变化后，必须回写承载该状态的权威产物文件**——否则文件与 status 不一致，监控端/下游拿到的结论互相矛盾。F 链收敛 PASS 时向 verdict.md 追加「F 修复链收敛」记录（保留 V 阶段 FAIL 依据可追溯，不覆盖）。

> 与「degraded.flag 持久化」是姊妹篇：一个说"状态别放会被下游覆盖的文件"，一个说"状态变化要回写权威文件"——**跨步骤状态的一致性是 driver 编排的核心责任**。

### F 修复链"audit 通过 = 收敛 = PASS"逻辑漏洞（v1.3.1 release-gate run-10）

**场景**：V 阶段裁决 FAIL（acceptance 2 项阻塞），driver 启动 F 修复链；F 跑 f-audit 检测代码违规，无 VIOLATIONS → driver 判定"收敛" → 把 V 的 FAIL 翻成 PASS。

**根因**：`f-audit` 检测的是**代码违规**（git diff 跑审计规则），而 V 阶段 verdict.md 列的阻塞项是**验收测试基础设施缺陷**（输出编码/汇总行）——两者是完全不同的维度。F 修复链的 audit 通过只能证明"代码没有 VIOLATIONS"，不能证明"verdict 列的阻塞项已修复"。

**修复方向**（待实现）：F 修复链收敛条件应该是"重跑 V 阶段 verdict 从 FAIL 变 PASS"，而非"f-audit 无 VIOLATIONS"。当前逻辑把 audit（代码违规检测）和 verdict（验收阻塞裁决）混为一谈。

**临时缓解**：人工核实——driver 报 PASS 但 status.json results 含 FAIL 时，必须读 verdict.md 确认 V 阶段裁决的真实状态，不信任 F 修复链的 FAIL→PASS 翻转。

## 2026-08-16 git 灾难三连（仓库级 P0）

**事件**：并行会话在主仓目录误操作三连——① 01:38 `git init`（c.txt "test" 为痕迹）重建 `.git`，本地全部提交历史丢失（无 remote 的 commit SHA 不可恢复）；② 23:45 前后 `git add -A` 把 765 个文件（含 node_modules 邻接测试目录）卷入暂存区；③ 主会话恢复时 `cp -R 远程快照 .` 又把工作区最新内容覆盖。

**根因**：
1. **git init 无害错觉**——在已有仓库目录跑 `git init` 不是"重新初始化"而是**重建 .git**（旧对象目录整体丢失），测试 git 行为必须在 /tmp 临时目录
2. **git add -A 在 monorepo 是核弹**——必须逐文件 add；765 文件进暂存区后审计钩子被规则源码的检测样本触发海量误报，阻断一切 commit
3. **恢复操作本身是最大风险源**——`cp -R A/. B/` 会静默覆盖 B 的新内容；恢复前必须先确认"哪个是超集"再单向恢复

**救援立功者**：sofagent 自己的回溯引擎 `.sofagent/.git-shadow/snapshots.json`（1370 文件全文快照，commit 钩子自动打点）——1365 文件完整恢复，**审计引擎在审计轨迹本身被毁时救了全场**。Cordis「可撤销效应」的同款价值实证。

**预防**（下次开发 sub-agent 必须遵守）：
- sub-agent 的 git 写操作白名单化：只允许 `add <显式路径>` / `commit -- <显式路径>`，**禁止 `init` / `add -A` / 裸 `commit -m`（不带文件清单）/ `reset --hard` / `stash`**（在主仓）
- 任何 git 实验测试（测 hook/测 init 行为）强制在 `/tmp/test-<随机>/` 进行
- 恢复流程铁律：先 `diff -rq` 双向对账确认超集方向 → 快照（`cp -r` 到 /tmp）→ 再单向恢复
- push 频率即安全边际：本地未推 commit 数 = 风险敞口，重要落盘当天推

**补充教训（2026-08-16 同日，driver 裸 commit 卷走队友暂存）**：`git add -A` 是明面的核弹，**裸 `git commit -m`（不带文件清单）是暗面的核弹**——它会提交暂存区里**所有已 staged 内容**，把队友并行编辑时先 `git add` 进暂存区的文件（如 docs/ 规划文档）一起卷进 auto-commit。修复：`git commit -m "..." -- <filesToAdd 清单>`，只提交本轮改动文件，队友 staged 的文件保持原状；且 filesToAdd 为空时**完全跳过 commit**（不执行任何裸 commit）。已在 `driver-base.mjs runAuditGate` 修复（fresh-eyes + release-gate 两 driver 共用，一处生效两处）。
