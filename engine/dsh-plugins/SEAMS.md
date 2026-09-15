# SEAMS · 插件适配层 seam 词汇表

> 本文件是 sofagent 插件 `seam` 字段的**唯一事实源（SSOT）**。
> 门禁 `tools/check/check-seam-contract.mjs` 直接解析本文件下方的机器可读块，
> 逐条断言「插件声明的 seam ∈ 词汇表」与「词汇表每条能在宿主体里找到定义处」。

## 0. 为什么要有这份词汇表

`seam` 是插件向宿主声明「我挂在哪」的契约字段。它此前写在**三处**：

| 位置 | 载体 | 消费方 |
| --- | --- | --- |
| `engine/dsh-plugins/<pkg>/src/index.ts` | `pluginMeta.seam` | DSH 注册表 / skill 引导链 |
| `engine/dsh-plugins/<pkg>/package.json` | `sofagent.seam` | npm 生态 / 工具链 |
| `engine/dsh-plugins/<pkg>/cordis.patch.yml` | `config.seam` | Cordis loader 挂载 |

三处**必须逐条一致**——否则同一次挂载在不同消费面上看到不同的「挂在哪」。

**词汇表的事实来源只有一个：宿主自己定义的事件名。** sofagent 不得自创 seam 名。
本文件只收**宿主真实存在的**名字；确实不通过宿主事件接入的插件，单列
「非 seam 接入形态」一节说明理由，**不硬塞假 seam**。

> 🔴 **零命中的假空警戒**：复核宿主体时 `~/.dsh/profiles/node_modules` 全是**符号链接**，
> `grep -r` 默认不跟随软链 → 直接 grep 得到「零命中」是**假空**。
> 必须走 `.../<pkg>/lib/` 这类**真实路径**。凡「宿主没有这个名字」的结论，先排除搜索方式导致的假空。
> （本批实测就抓到一次：只查 3 个包时 `agent/turn-stopping` 判为「虚构」，
> 扩到 `dsh-agent` 后命中真实定义——见 §1 该行。）

## 1. DSH 侧 · 宿主 seam 词汇表

宿主包：`@deepseek-ai/dsh-tools` · `@deepseek-ai/dsh-fs` · `@deepseek-ai/dsh-agent` · `@deepseek-ai/dsh-hook-protocol`。
下列每个名字都是**宿主 lib 里真实存在的事件字符串**，不是 sofagent 的转述。

<!-- SEAM-VOCAB:DSH-HOST:BEGIN -->
| seam | 宿主包 | 宿主目录 | 语义 | 挂载插件 |
| --- | --- | --- | --- | --- |
| `tools/change` | `@deepseek-ai/dsh-tools` | `lib/` | 工具集合变更（工具增删的广播） | 暂无 |
| `tools/execute` | `@deepseek-ai/dsh-tools` | `lib/` | 工具执行中（计时 / 成本计量落点） | 暂无 |
| `tools/post-execute` | `@deepseek-ai/dsh-tools` | `lib/` | 工具执行后（结果质检落点） | 暂无 |
| `tools/pre-execute` | `@deepseek-ai/dsh-tools` | `lib/` | 工具执行前——可拦截、可改参（瀑布流） | `audit` |
| `tools/ptc-dispatch-log` | `@deepseek-ai/dsh-tools` | `lib/` | PTC 派发日志（提示词工具调用派发） | 暂无 |
| `tools/result` | `@deepseek-ai/dsh-tools` | `lib/` | 工具最终结果确定——审计留证落点 | `audit` |
| `fs/edit-intent` | `@deepseek-ai/dsh-fs` | `lib/` | 文件编辑意图（写盘前可见） | 暂无 |
| `fs/observed` | `@deepseek-ai/dsh-fs` | `lib/` | 文件系统变更已观测 | 暂无 |
| `fs/write-intent` | `@deepseek-ai/dsh-fs` | `lib/` | 文件写入意图（写盘前可拦） | `audit` |
| `agent/pre-step` | `@deepseek-ai/dsh-agent` | `lib/` | 模型看到输入前——约束注入落点 | `inject` |
| `agent/request` | `@deepseek-ai/dsh-agent` | `lib/` | 模型请求发出前 | 暂无 |
| `agent/request-error` | `@deepseek-ai/dsh-agent` | `lib/` | 模型请求失败后（重试 / 降级落点） | 暂无 |
| `agent/turn-stopping` | `@deepseek-ai/dsh-agent` | `lib/` | Turn 结束前停止条件判定——可拦截不放行 | `gate` |
| `agent/error` | `@deepseek-ai/dsh-agent` | `lib/` | Agent 运行出错（逆序撤销的触发点） | `rollback` |
| `agent/session-start` | `@deepseek-ai/dsh-agent` | `lib/` | Agent 会话开始 | 暂无 |
| `hook/invoked` | `@deepseek-ai/dsh-hook-protocol` | `lib/` | 外部 hook 被调用 | 暂无 |
| `hook/result` | `@deepseek-ai/dsh-hook-protocol` | `lib/` | 外部 hook 返回结果 | 暂无 |
| `session/created` | `@deepseek-ai/dsh-hook-protocol` | `lib/` | 会话创建 | 暂无 |
| `turn/start` | `@deepseek-ai/dsh-hook-protocol` | `lib/` | Turn 开始 | 暂无 |
| `turn/end` | `@deepseek-ai/dsh-hook-protocol` | `lib/` | Turn 结束（任务收尾——经验沉淀落点） | `evolve` |
<!-- SEAM-VOCAB:DSH-HOST:END -->

**复核命令**（必须用真实路径，软链目录 grep 会假空）：

```bash
B=~/.dsh/profiles/node_modules/@deepseek-ai
grep -rhoE "['\"]tools/[a-z-]+['\"]" "$B/dsh-tools/lib/"          | tr -d "\"'" | sort -u
grep -rhoE "['\"]fs/[a-z-]+['\"]"    "$B/dsh-fs/lib/"             | tr -d "\"'" | sort -u
grep -rhoE "['\"]agent/[a-z-]+['\"]" "$B/dsh-agent/lib/"          | tr -d "\"'" | sort -u
grep -rhoE "['\"][a-z]+/[a-z-]+['\"]" "$B/dsh-hook-protocol/lib/" | tr -d "\"'" | sort -u
```

> 词汇表**只收插件可挂的生命周期事件**（上表 20 条），不追求把宿主全部内部事件
> （如 `internal/dispatch`、`session/event`）登记进来——那些不对插件开放。

## 2. DSH 侧 · 非 seam 的接入形态

有些插件**确实不通过任何宿主事件接入**：它们只把能力注册成 `ctx` 服务 / 工具集，
由宿主按需调用，没有生命周期挂载点。对这类插件**不硬塞假 seam**，而是登记「接入形态」。
接入形态有两种：**能力型**（tool 集 / 独立进程——能力按需调用）与**聚合型**
（plugin-suite——只编排兄弟插件，自身不注册能力、也无独立事件时机）。

<!-- SEAM-VOCAB:DSH-FORM:BEGIN -->
| form | 接入形态 | 不通过宿主事件接入的理由 | 对外接口 | 插件 |
| --- | --- | --- | --- | --- |
| `non-seam:tool-set` | tool 集（能力以工具形式暴露） | 能力按需调用、无生命周期时机——挂任何生命周期事件都会是「跑不到的假契约」 | `ctx.provide('sofagent.<name>')` | `commons` |
| `non-seam:tool-set` | tool 集（能力以工具形式暴露） | 同上：本体查询 / 知识检索是工具调用，不拦截任何生命周期节点 | `ctx.provide('sofagent.ontology')` | `ontology` |
| `non-seam:tool-set` | tool 集（能力以工具形式暴露） | 同上：`fde_*` 六 tool 是方法论工具集，宿主不派发事件给它 | `ctx.provide('sofagent.fde')` | `fde` |
| `non-seam:host-process` | 独立调度进程 | 7×24 巡检是**进程级调度**（cron / 常驻），不寄生宿主事件循环 | `ctx.provide('sofagent.daemon')` | `daemon` |
| `non-seam:plugin-suite` | 插件聚合（一次 apply 挂全套原子插件） | 自身**不挂任何宿主生命周期**——只依次调用 9 个原子插件的 `apply`；能力仍由各原子插件 `provide`，聚合层没有独立的事件时机，挂任何生命周期都会是「跑不到的假契约」 | `ctx.provide('sofagent.suite')` | `suite` |
<!-- SEAM-VOCAB:DSH-FORM:END -->

### 2b. 宿主 profile 的挂载差异是**有意的**

`~/.dsh/profiles/<name>/` 各 profile 的 `bundles` 与 patch **允许不同**，差异本身不是漏挂：

| profile | bundles 里的 sofagent 项 | 差异理由（该 profile `cordis.patch.yml` 自述） |
| --- | --- | --- |
| `web` | `cordis-plugin-sofagent`（一次挂全套原子插件） | 有 WebUI 服务（`settings` / `dynamicCordisRunner`） |
| `headless` | 只挂 `cordis-plugin-sofagent-audit`，patch 里 `inject: []` | headless 无上述 WebUI 服务——插件默认 patch inject 了这两个服务会导致 pending 启动失败 |

> 巡检时若见某 profile 挂得少，先读该 profile 的 `cordis.patch.yml` 自述与 `bundles`，**不直接判为缺口**。

## 3. OpenClaw 侧 · 宿主 seam 词汇表

OpenClaw 的探测事件名是**下划线风格**（`before_tool_call`），与 DSH 的
`命名空间/事件` 斜杠风格**不同源**——两侧词表**分列**，不得互相照抄。

宿主包 `openclaw`（本机 `2026.6.1`）。事件名的权威定义在
`dist/hook-types-*.d.ts` 的 `PluginHookName` 联合类型（构建产物文件名带 hash，用 glob 匹配），
人读目录见 `docs/plugins/hooks.md`。

<!-- SEAM-VOCAB:OPENCLAW-HOST:BEGIN -->
| hook | 宿主包 | 宿主路径 glob | 语义 | 挂载插件 |
| --- | --- | --- | --- | --- |
| `before_model_resolve` | `openclaw` | `dist/hook-types-*.d.ts` | 会话消息载入前覆盖 provider / model | 暂无 |
| `agent_turn_prepare` | `openclaw` | `dist/hook-types-*.d.ts` | 消费排队的 turn 注入、补同轮上下文 | 暂无 |
| `before_prompt_build` | `openclaw` | `dist/hook-types-*.d.ts` | 模型调用前追加动态上下文 / 系统提示词 | `sofagent-inject` `sofagent-evolve` |
| `before_agent_start` | `openclaw` | `dist/hook-types-*.d.ts` | 兼容用的组合相位（官方建议改用上面两个） | 暂无 |
| `before_agent_run` | `openclaw` | `dist/hook-types-*.d.ts` | 提交模型前检视最终 prompt，可拦停本轮 | 暂无 |
| `before_agent_reply` | `openclaw` | `dist/hook-types-*.d.ts` | 用合成回复短路模型轮次 | 暂无 |
| `before_agent_finalize` | `openclaw` | `dist/hook-types-*.d.ts` | 检视自然终答，可要求再跑一轮模型 | 暂无 |
| `agent_end` | `openclaw` | `dist/hook-types-*.d.ts` | 观测最终消息 / 成功态 / 运行时长 | 暂无 |
| `model_call_started` | `openclaw` | `dist/hook-types-*.d.ts` | 观测模型调用元数据与计时（无正文） | 暂无 |
| `model_call_ended` | `openclaw` | `dist/hook-types-*.d.ts` | 观测模型调用结果（无正文） | 暂无 |
| `llm_input` | `openclaw` | `dist/hook-types-*.d.ts` | 观测 provider 输入 | 暂无 |
| `llm_output` | `openclaw` | `dist/hook-types-*.d.ts` | 观测 provider 输出与用量 | 暂无 |
| `before_compaction` | `openclaw` | `dist/hook-types-*.d.ts` | 历史压缩前 | 暂无 |
| `after_compaction` | `openclaw` | `dist/hook-types-*.d.ts` | 历史压缩后 | 暂无 |
| `before_reset` | `openclaw` | `dist/hook-types-*.d.ts` | 会话重置前 | 暂无 |
| `inbound_claim` | `openclaw` | `dist/hook-types-*.d.ts` | 认领入站消息（决定由谁处理） | 暂无 |
| `message_received` | `openclaw` | `dist/hook-types-*.d.ts` | 收到任意渠道入站消息 | 暂无 |
| `message_sending` | `openclaw` | `dist/hook-types-*.d.ts` | 出站消息发送前 | 暂无 |
| `reply_payload_sending` | `openclaw` | `dist/hook-types-*.d.ts` | 回复负载发送前 | 暂无 |
| `message_sent` | `openclaw` | `dist/hook-types-*.d.ts` | 出站消息已投递 | 暂无 |
| `before_tool_call` | `openclaw` | `dist/hook-types-*.d.ts` | 工具调用前——**可拦停 / 要求审批** | `sofagent-audit` |
| `after_tool_call` | `openclaw` | `dist/hook-types-*.d.ts` | 工具调用后 | 暂无 |
| `tool_result_persist` | `openclaw` | `dist/hook-types-*.d.ts` | 工具结果落盘时 | 暂无 |
| `before_message_write` | `openclaw` | `dist/hook-types-*.d.ts` | 消息写入前 | 暂无 |
| `session_start` | `openclaw` | `dist/hook-types-*.d.ts` | 会话开始 | 暂无 |
| `session_end` | `openclaw` | `dist/hook-types-*.d.ts` | 会话结束 | 暂无 |
<!-- SEAM-VOCAB:OPENCLAW-HOST:END -->

> 另有**已废弃**事件名 `subagent_spawning` / `deactivate`（宿主 `DeprecatedPluginHookName`），
> **不得**作为新插件的 seam。

### 3b. OpenClaw 内建 hook（operator `HOOK.md` 机制）

OpenClaw 还有一套**与 plugin hook 不同源**的内建 hook 事件（`HOOK.md` 脚本，
`api.on(...)` 之外的第二套机制）。sofagent 的 `engine/hooks/sofagent-load-chain/HOOK.md`
用的就是这一套。

<!-- SEAM-VOCAB:OPENCLAW-INTERNAL-HOST:BEGIN -->
| event | 宿主包 | 宿主路径 glob | 语义 | 挂载插件 |
| --- | --- | --- | --- | --- |
| `agent:bootstrap` | `openclaw` | `docs/automation/hooks.md` | workspace bootstrap 文件注入前——会话级约束注入落点 | `sofagent-load-chain` |
| `command:new` | `openclaw` | `docs/automation/hooks.md` | `/new` 命令触发 | 暂无 |
| `command:reset` | `openclaw` | `docs/automation/hooks.md` | `/reset` 命令触发 | 暂无 |
| `command:stop` | `openclaw` | `docs/automation/hooks.md` | `/stop` 命令触发 | 暂无 |
| `session:compact:before` | `openclaw` | `docs/automation/hooks.md` | 历史压缩前 | 暂无 |
| `session:compact:after` | `openclaw` | `docs/automation/hooks.md` | 历史压缩后 | 暂无 |
| `session:patch` | `openclaw` | `docs/automation/hooks.md` | 会话属性被修改 | 暂无 |
| `gateway:startup` | `openclaw` | `docs/automation/hooks.md` | 渠道启动、hook 载入完成 | 暂无 |
| `gateway:shutdown` | `openclaw` | `docs/automation/hooks.md` | 网关开始关闭 | 暂无 |
| `gateway:pre-restart` | `openclaw` | `docs/automation/hooks.md` | 预期重启前 | 暂无 |
| `message:received` | `openclaw` | `docs/automation/hooks.md` | 任意渠道入站消息 | 暂无 |
| `message:transcribed` | `openclaw` | `docs/automation/hooks.md` | 音频转写完成 | 暂无 |
| `message:preprocessed` | `openclaw` | `docs/automation/hooks.md` | 媒体与链接预处理完成或被跳过 | 暂无 |
| `message:sent` | `openclaw` | `docs/automation/hooks.md` | 出站消息已投递 | 暂无 |
<!-- SEAM-VOCAB:OPENCLAW-INTERNAL-HOST:END -->

## 4. OpenClaw 侧 · 非 seam 的接入形态

<!-- SEAM-VOCAB:OPENCLAW-FORM:BEGIN -->
| form | 接入形态 | 不通过宿主事件接入的理由 | 对外接口 | 插件 |
| --- | --- | --- | --- | --- |
| `non-seam:tool-set` | tool 集 + CLI 命令 | 只注册工具与 CLI（`registerTool` / `registerCli`），不拦截任何生命周期 | `api.registerTool('sofagent_rollback')` | `sofagent-rollback` |
<!-- SEAM-VOCAB:OPENCLAW-FORM:END -->

## 5. 机器可读契约（门禁读取约定）

`tools/check/check-seam-contract.mjs` 的读取约定：

1. 只解析上表 `<!-- SEAM-VOCAB:<KEY>:BEGIN -->` … `<!-- SEAM-VOCAB:<KEY>:END -->` 之间的
   Markdown 表格；表格列序固定，**单元格内不得出现 `|` 字符**。
2. **正向**：每个插件声明的 seam（按 `+` 拆分后逐段）必须 ∈ 对应侧的
   `*-HOST` ∪ `*-FORM` 词表。宿主不存在也能跑——**无条件可运行**。
3. **反向**：`*-HOST` 每条的 `宿主包` + `宿主路径 glob` + 事件名三要素齐备；
   宿主体在**本机真实存在时实跑校验**（grep 到定义处），**宿主不存在时打印
   `SKIP:` 并说明原因**（`exit 0`，但**绝不静默通过**——SKIP 必须可见）。
4. 插件与词表**双向对账**：文件系统里的每个插件都必须在词表 `挂载插件` 列出现；
   词表 `挂载插件` 列出现的每个插件都必须在文件系统里存在。**漏写 seam 会被拦下**。
5. `seam` 值统一形态：**「词汇表里的名字」+「语义」两段式**。载体按文件语法分三种
   （语义是同一件事，只是携带方式不同）：
   - `src/index.ts` —— JS 行注释：`// seam 挂载：turn/end    # 语义：Turn 结束 → 经验沉淀`
   - `cordis.patch.yml` —— YAML 行内注释：`seam: "turn/end"    # 语义：Turn 结束 → 经验沉淀`
   - `package.json` / `openclaw.plugin.json` —— JSON **无注释语法**，故用兄弟字段
     `seamSemantics` 承载（与 `seam` 同级）；门禁断言其非空，缺了报红。
6. `package.json.description` 必须内含 `seam: <seam 值>`——描述滞后于契约（同一次挂载
   在不同消费面说不同的话）是本批要治的病之一，故做成**阻断项**。

## 6. 声明与实现的边界（两侧接入深度不同）

词表登记的是**接入契约**，不等于运行时已经接线。读词表时必须区分「声明」与「实现」：

| 侧 | 现状 | 证据 |
| --- | --- | --- |
| **DSH** | seam 是**声明**——写在 `src` 注释 / `pluginMeta.seam` / `plugins.json` / `cordis.patch.yml` 的 `config.seam`，四载体由 `check-seam-contract.mjs` 对账；但插件**不注册宿主事件处理器**（`plugin-kit` 的 `apply` 只做 `provide` + `dynamicCordisRunner.define` + `settings.register`） | 全仓 `on(` + `tools/` 与 `on(` + `agent/` 均零命中；宿主侧确实可订阅（`ctx.waterfall(carrier, '<tools 族事件>', …)`） |
| **OpenClaw** | hook 是**实现**——`api.on('before_tool_call', handler)` 真注册，拦停返回 `{ block: true, blockReason }` | `engine/openclaw-plugins/*/src/index.ts` |

> ⚠️ **对使用者的含义**：DSH 侧插件的运行时介入（拦截 / 注入 / 收尾触发）**尚未接线**；今天拦截生效的路径是 sofagent 自身运行时（`engine/orchestrator` 的 `wrapToolsWithGate` + `checkDangerousCommand`）。补接线（基座加订阅面 + 各插件接线）是独立工作项——落地前，对外文案不得写成「已自动拦截」。

## 7. P0 动态探针实测记录（2026-09-15 · DSH 0.1.2-alpha.1 · Node 24.19.0）

> 本节是 P0 探针（临时仓外插件 `cordis-plugin-sofagent-probe` + 仓外 profile
> `~/.dsh/profiles/probe/`）的实测结论。探针产物已清理，不留在仓库；本节是结论沉淀。
> 复核方式：临时插件 + `dsh --profile probe` 真实跑通 headless 任务（真 LLM + 真工具调用）。

### 7.1 六项产出逐条结论

| # | 实测项 | 结论 | 真实输出摘录 |
| --- | --- | --- | --- |
| ① | 契约形状复核 | **与任务书 §1.2 记载相符**。`ctx.get('tools')` / `ctx.get('tools', false)` / `ctx.tools`（属性）三种取法全部可用，返回 ToolRuntime 实例 | `[probe] ctx.get("tools") = <ToolRuntime register:function guard:function>` |
| ① | 契约形状复核（身份差异） | `ctx.get('tools')` 与 `ctx.tools` 返回**不是同一对象引用**（`same object via get/property = false`）——属性访问经 Proxy trap 包装（getTraceable），方法面一致，等价可用 | `[probe] same object via get/property = false` |
| ① | 契约形状复核（render 签名修正） | 🔴 `output.render` 是**双参签名** `render(exec.arguments, value)`——第一参是**工具入参**，第二参才是 execute 返回值。此前按单参 `render(value)` 的理解不准确；dsh-backend.ts 的 `safeRender(args, value)` 双参形态正确 | `rendered = tool.output.render(exec.arguments, value)`（dsh-tools/lib/index.js:3431） |
| ② | ctx.tools 就绪时机与 inject 声明 | **plugin default export 上声明 `inject: ['tools']` 后，apply() 内三种取法均立即可用**（探针实测无等待/无竞态）。kit 现状 `PLUGIN_INJECT = ['settings','dynamicCordisRunner']` 不含 tools——P1 加 toolsRole 后必须显式扩（或走 `ctx.get?.('tools')` 免 inject 的鸭子路径）。不声明 inject 时属性访问会抛 `cannot get property "tools" without inject` | 探针 apply() 入口同 tick 打印 P1 段全部形状 |
| ② | `ctx.get('tools')` vs `ctx.tools.register` 裁定 | **两者皆可用**；P1 kit 拍板走 `ctx.get?.('tools')`（对齐 dsh-backend.ts:135 参考实现）。理由：`ctx.get` 是 reflect mixin 直挂方法，**不要求 inject 声明**，服务未就绪返回 `undefined` 而非抛错——天然满足 kit「宿主 API 缺席降级不抛」红线；属性形态无 inject 时抛错且依赖 Proxy internal/get 瀑布流。方法面（register/guard/restrict/presentAs/view/modeFor）两种取法完全一致 | 见 7.2 机制分析 |
| ③ | 工具注册后模型可见可调 | **通**。`register()` 返回 disposer（function）；模型在提示词里看到 `sofagent_probe_echo` 并真实调用：`tools/pre-execute` 瀑布流监听器收到调用 → `tools/result` 收到成功结果 `{"isError":false,...,"value":{"echoed":"probe-echo:hello-from-probe"}}` | `[probe] waterfall tools/pre-execute listener invoked for sofagent_probe_echo args.message = "hello-from-probe"` |
| ③ | 危险调用被拒（guard） | **通**。`guard()` 同步返回字符串=拒绝理由，单调不可翻案；模型收到拒绝后明确表示不绕过 | `Error: probe-guard: DANGEROUS keyword denied (monotonic)` |
| ④ | ask 分支真实交互 | **通，但 headless 下 fail-closed**。`ctx.get('approval')` 服务存在（`<ApprovalService request:function>`）；`tools/pre-execute` 返回 `{kind:'ask', reason}` 后宿主走 `serviceAsk → approval.request()`，无 answerer 时拒绝（`requires approval, but no approval channel is available`）。**WebUI 审批弹窗不在本探针范围**（需 web profile + 浏览器，P3 验收复核） | `[probe] event tools/result fired: sofagent_probe_ask {"isError":true,...requires approval...}` |
| ⑤ | 命令/UI 面是否存在 | **headless 无 commands 注册面**——`ctx.get('commands')` 返回 `<CommandsService add:undefined>`，add 是 undefined 无法注册命令。WebUI 端命令面待 P3 验收（web profile）复核。⚠️ 直接影响 P1 kit 设计：**kit 不做命令注册面** | `[probe] ctx.get("commands") = <CommandsService add:undefined>` |
| ⑥ | 宿主自跑可复现验证剧本 | 见 7.3 | — |

### 7.2 两种取法的机制裁定（静态源码 + 动态双重确认）

宿主 `@deepseek-ai/cordis`（dsh-deployed 内嵌 cordis 4.0.1，`@deepseek-ai/cordis` 包）：

- **`ctx.get('tools')`** —— `ReflectService.get(name, strict=true)`（reflect mixin 直挂 ctx）：
  从 fiber store 按 isolation key 取实现；**strict 态**下服务 fiber 未 active 返回 `undefined`；
  **不要求 inject 声明**，天生鸭子降级友好（`ctx.get?.('tools')` + 判空）。
- **`ctx.tools`（属性访问）** —— Context Proxy get trap：
  1. `Reflect.has(target, prop)` 命中 → 直返；
  2. 未命中 → `reflect.props[prop]` 存在（service）→ 走 `events.waterfall("internal/get", ...)` 解析；
  3. **无 inject 声明且 fiber.runtime 存在** → 沿 fiber 链查 `fiber.store?.[prop]`，
     查不到最终 `throw cannot get property "tools" without inject`；
  `ctx.tools.register` 直接在 apply() 内可用，前提是 plugin 声明了 `inject: ['tools']`
  （或经 `ctx.get` 先取）。属性形态的优势是**链式调用简洁**（`ctx.tools.register(def)` 一行），
  劣势是**无 inject 时抛错**（破坏 kit「降级不抛」红线）。

**裁定：P1 kit 采用 `ctx.get?.('tools')` 作为工具注册面的取法**（不采用 `ctx.tools` 属性形态），
与 dsh-backend.ts:135 参考实现一致，且天然满足降级红线。

### 7.3 宿主自跑可复现验证剧本（⑥产出）

前置条件：DSH 0.1.2-alpha.1（`~/.local/share/dsh-deployed`）· Node 24.19.0 · `~/.zshrc` 内 GLM_API_KEY 可用。

```bash
# 1) 建仓外探针插件（纯 apply(ctx) 形态，无 cordis import——对齐 kit 鸭子类型先例）
mkdir -p /tmp/sofagent-probe-plugin/dist
#    package.json: { name: "cordis-plugin-sofagent-probe", main: "dist/index.js", type: "module",
#                    dsh: { bundle: { patch: "./cordis.patch.yml" } } }
#    cordis.patch.yml: - insert: [ { id: sofagent-probe, name: 'cordis-plugin-sofagent-probe',
#                                    inject: [tools], config: { probeTag: probe } } ]
#    dist/index.js: export default { name, inject: ['tools'], apply(ctx, config) { ... } }
#    （apply 内：打印 ctx.get('tools') 形状 → 注册 sofagent_probe_echo/ask/report 工具 →
#      guard 拦 DANGEROUS → ctx.on('tools/change'|'tools/result'|'tools/pre-execute') 订阅 →
#      探测 ctx.get('approval')/ctx.get('commands')）

# 2) 建探针 profile（link: 挂入，绝不动 web/headless）
mkdir -p ~/.dsh/profiles/probe
#    package.json: bundles [ "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless",
#                            "cordis-plugin-sofagent-probe" ] + deps link:/tmp/sofagent-probe-plugin
cd ~/.dsh/profiles/probe && pnpm install

# 3) 验证合成树（探针行出现且 inject 生效）
dsh --profile probe --dump-config | grep -A6 sofagent-probe
#    期望：- id: sofagent-probe / name: cordis-plugin-sofagent-probe / inject: [tools]

# 4) 跑通三项核心验证（真 LLM）
dsh --profile probe "Call the tool sofagent_probe_echo with message 'hello-from-probe'"
#    期望：[probe] 前缀打印 P1–P5 全部形状结论；模型真实调用工具；tools/result 成功回显
dsh --profile probe "Call sofagent_probe_echo with message 'DANGEROUS-payload'"
#    期望（输出尾部）：Error: probe-guard: DANGEROUS keyword denied (monotonic)
dsh --profile probe "Call sofagent_probe_ask with message 'confirm-me'"
#    期望：tools/result isError:true —— requires approval, but no approval channel is available

# 5) 清理（探针产物不留仓库，profile 用完即删）
rm -rf /tmp/sofagent-probe-plugin ~/.dsh/profiles/probe
```

### 7.4 对 P1 kit 扩容的直接输入

1. **`PLUGIN_INJECT` 必须扩 `'tools'`**（当走属性取法时）；走 `ctx.get?.('tools')` 则可免，
   但显式声明更稳（保证 apply 时服务就绪、消除竞态可能）。P1 实现采用「inject 声明 +
   `ctx.get?.('tools')` 取服务」双保险。
2. **render 双参签名**：kit 的宿主形状转换必须按 `render(args, value)` 传双参——
   dsh-backend.ts 的 `safeRender(args, value)` 正是此形态。
3. **register() 返回 disposer**：必须纳入 kit 的 disposers 复合卸载契约（与 provide/define 的
   disposer 合并）。
4. 注册面无 `name='run_code'` 冲突风险（sofagent 工具名 mcp__sofagent__* 前缀不命中保留名）。
5. **headless 无 commands 注册面**：kit 不做命令面；未来若需要，须在 web profile 下复核
   `dsh-commands` 的 add 方法面。
6. 工具注册时机：apply() 内同步注册即可（探针实测无竞态）；`tools/change` 事件每次注册都广播
   （可用作注册确认信号）。
7. **`ctx.get('approval')` 在 headless 下服务存在但无 answerer**：fail-closed。若某工具需要 ask
   语义，须在 web profile（有 UI answerer）下才有完整交互；headless 下等价于 deny。
