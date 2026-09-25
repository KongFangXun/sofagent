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

宿主包：`@deepseek-ai/dsh-tools` · `@deepseek-ai/dsh-fs` · `@deepseek-ai/dsh-agent` · `@deepseek-ai/dsh-session` · `@deepseek-ai/dsh-hook-protocol`。
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
| `agent/turn-stopping` | `@deepseek-ai/dsh-agent` | `lib/` | Turn 结束前停止条件判定——可拦截不放行（宿主 serial 派发；续跑手段是向 agent 送消息，返回值不参与判定） | `audit` |
| `agent/error` | `@deepseek-ai/dsh-agent` | `lib/` | Agent 运行出错（逆序撤销的触发点） | `rollback` |
| `agent/session-start` | `@deepseek-ai/dsh-agent` | `lib/` | Agent 会话开始 | 暂无 |
| `session/event` | `@deepseek-ai/dsh-session` | `lib/` | 会话事件流（`session.append` 追加即广播，listener 收 `(session, event)`；`turn/end` / `step/end` 等是 `event.type` 的取值，需自行过滤） | `evolve` |
| `hook/invoked` | `@deepseek-ai/dsh-hook-protocol` | `lib/` | 外部 hook 调用**载荷类型**（经该协议发给仓外 hook 进程，非 ctx 订阅点） | 暂无 |
| `hook/result` | `@deepseek-ai/dsh-hook-protocol` | `lib/` | 外部 hook 返回**载荷类型**（同上，非 ctx 订阅点） | 暂无 |
| `session/created` | `@deepseek-ai/dsh-hook-protocol` | `lib/` | 会话创建**载荷类型**（同上，非 ctx 订阅点） | 暂无 |
| `turn/start` | `@deepseek-ai/dsh-hook-protocol` | `lib/` | Turn 开始**载荷类型**（同上，非 ctx 订阅点） | 暂无 |
| `turn/end` | `@deepseek-ai/dsh-hook-protocol` | `lib/` | Turn 结束**载荷类型**（同上，非 ctx 订阅点）——in-process 插件要观察 turn 收尾请订阅 `session/event` 并按 `event.type === 'turn/end'` 过滤 | 暂无 |
<!-- SEAM-VOCAB:DSH-HOST:END -->

**复核命令**（必须用真实路径，软链目录 grep 会假空）：

```bash
B=~/.dsh/profiles/node_modules/@deepseek-ai
grep -rhoE "['\"]tools/[a-z-]+['\"]" "$B/dsh-tools/lib/"          | tr -d "\"'" | sort -u
grep -rhoE "['\"]fs/[a-z-]+['\"]"    "$B/dsh-fs/lib/"             | tr -d "\"'" | sort -u
grep -rhoE "['\"]agent/[a-z-]+['\"]" "$B/dsh-agent/lib/"          | tr -d "\"'" | sort -u
grep -rhoE "['\"][a-z]+/[a-z-]+['\"]" "$B/dsh-hook-protocol/lib/" | tr -d "\"'" | sort -u
# dsh-session 按**精确名**取：该包内 `session/*` 多数是 `session.append` 的载荷类型
# （`session/title` / `session/flush` …），只有 `session/event` 是广播订阅点
grep -rhoE "['\"]session/event['\"]" "$B/dsh-session/lib/"        | tr -d "\"'" | sort -u
```

> 词汇表**只收宿主真实存在的生命周期事件名**（上表 21 条）。其中 5 条
> `@deepseek-ai/dsh-hook-protocol` 的行是该协议的**事件载荷类型**——它们确实
> 是宿主真实存在的字符串，但**交付对象是仓外 hook 进程**（子进程 / webhook），
> **不是 `ctx.on` 能收到的 cordis 事件**。给插件写 seam 时只能用 ctx 事件名：
> 把 `turn/end` 这类载荷类型当订阅点写，会得到一个**永不触发的订阅**（grep 能过、
> 探针必挂）——turn 收尾的真实订阅点是 `session/event` + `event.type` 过滤。
> 其余 16 条（`tools/*` · `fs/*` · `agent/*` · `session/event`）都是真实派发点。

## 2. DSH 侧 · 非 seam 的接入形态

有些插件**确实不通过任何宿主事件接入**：它们只把能力注册成 `ctx` 服务 / 工具集，
由宿主按需调用，没有生命周期挂载点。对这类插件**不硬塞假 seam**，而是登记「接入形态」。
接入形态有两种：**能力型**（tool 集 / 独立进程——能力按需调用）与**聚合型**
（plugin-suite——只编排兄弟插件，自身不注册能力、也无独立事件时机）。

<!-- SEAM-VOCAB:DSH-FORM:BEGIN -->
| form | 接入形态 | 不通过宿主事件接入的理由 | 对外接口 | 插件 |
| --- | --- | --- | --- | --- |
| `non-seam:tool-set` | tool 集（能力以工具形式暴露） | 能力按需调用、无生命周期时机——挂任何生命周期事件都会是「跑不到的假契约」；v1.4.9 P2 起 `fde` 为厚插件：本体 / FDE / 公地三域工具面（合并原 `commons` 与 `ontology` 条目），settings 三档分域可关 | `ctx.provide('sofagent.fde')` | `fde` |
| `non-seam:host-process` | 独立调度进程 | 7×24 巡检是**进程级调度**（cron / 常驻），不寄生宿主事件循环 | `ctx.provide('sofagent.daemon')` | `daemon` |
| `non-seam:plugin-suite` | 插件聚合（一次 apply 挂全套原子插件） | 自身**不挂任何宿主生命周期**——只依次调用 6 个原子插件的 `apply`；能力仍由各原子插件 `provide`，聚合层没有独立的事件时机，挂任何生命周期都会是「跑不到的假契约」 | `ctx.provide('sofagent.suite')` | `suite` |
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
7. **接线面的三处对账**（v1.5.0 起）：声明了宿主事件的插件必须同时给出真实订阅名，
   三处同集合，`gen-plugin-manifests --check` 强制（任一不对称即报红）：
   - `plugins.json` 条目的 `seamHandlers`（声明侧）
   - `src/index.ts` 的 `seamHandlers` 对象**顶层键**（实现侧——kit 按此逐个 `ctx.on`）
   - 该条目 `seam` 值的事件段集（`+` 拆分后去掉 `non-seam:` 段）
   不对称的两种形态各有名字：seam 有而 seamHandlers 无 = **漏接线**；seamHandlers 有而
   seam 无 = **幽灵订阅**。非事件接入形态（`non-seam:*`）不得有 `seamHandlers`。

## 6. 声明与实现的边界（两侧接入深度不同）

词表登记的是**接入契约**。自 v1.5.0 起，DSH 侧声明了宿主事件的 4 款插件
（audit / inject / evolve / rollback）**同时是接线实现方**——订阅在 `plugin-kit` 的
`seamHandlers` 面上真实注册，事件名三方对账（`seam` ↔ `plugins.json.seamHandlers`
↔ `src/index.ts` 的 `seamHandlers` 顶层键，`gen-plugin-manifests --check` 强制）。

| 侧 | 现状 | 证据 |
| --- | --- | --- |
| **DSH** | seam 是**声明 + 实现**——7 款插件里声明了宿主事件的 4 款（共 7 个事件位）经 `ctx.on()` 真实订阅：audit `tools/result` + `tools/pre-execute` + `fs/write-intent` + `agent/turn-stopping`；inject `agent/pre-step`；evolve `session/event`（按 `event.type === 'turn/end'` 过滤）；rollback `agent/error`。订阅 disposer 收进 apply 的复合卸载契约 | 各插件 `src/index.ts` 的 `seamHandlers`；`plugins.json.seamHandlers`；门禁三方对账；探针剧本见 §7.3 |
| **OpenClaw** | hook 是**实现**——`api.on('before_tool_call', handler)` 真注册，拦停返回 `{ block: true, blockReason }` | `engine/openclaw-plugins/*/src/index.ts` |

> ⚠️ **对使用者的含义**：DSH 侧插件的运行时介入已经接线，但**能力边界不同**，
> 不要笼统写成「已自动拦截」：
> - `tools/pre-execute` 是**真拦截**（判定源 `checkDangerousCommand`，命中即 deny）；
> - `agent/turn-stopping` 是**验收续跑**（判定源 `checkAcceptance`，未定义验收时不拦；
>   每 turn 至多续跑一次）；
> - `fs/write-intent` 目前是**放行接线**——引擎包没有「按目标路径判定写意图」的
>   @public 判定源，按马鞍铁律不新造判定，故只接线不拦截；
> - `agent/error` 的自动回滚**默认关档**（settings `rollbackOnError`），开档才撤销工作区。
>
> **F-50 settings 声明实态（防误补/防误删）**：七款插件的 flags 声明面分两类——**显式声明**：`audit`（`settingsExtra: {rules, acceptanceGate}`，门禁类默认开）、`rollback`（`settingsExtra: {rollbackOnError}`，副作用类默认关）、`fde`（`featureGates` 三档分域 ontology/fde/commons）；**零声明**：伞插件 / `daemon` / `evolve` / `inject`——它们无分档需求，档位注册与读取由 plugin-kit 中央处理（featureGates 键自动并入 settings 注册面，兜底默认按声明值）。默认值方向原则：**门禁类默认开（未配置=默认有防线）、副作用类默认关（未配置=不乱动用户环境）**。后人勿对零声明插件"补齐"，也勿删显式声明。
> 另：判定源不可达时一律 fail-open（放行 + 可见日志）——接线故障不会升级成任务故障。

## 7. P0 动态探针实测记录（2026-09-15 · DSH 0.1.2-alpha.1 · Node 24.19.0）

> P0 探针（临时仓外插件 + 仓外 profile `~/.dsh/profiles/probe/`，用完即删）实测结论沉淀；完整剧本与输出摘录见证据案例 `docs/evidence/cases/dsh-plugin-probe-2026-09-15/README.md`（Case 022）。

### 7.1 六项产出逐条结论

| # | 实测项 | 结论 |
| --- | --- | --- |
| ① | 契约形状复核 | 与任务书 §1.2 相符：三种取法（`ctx.get('tools')` / `ctx.get('tools', false)` / `ctx.tools`）全部可用、返回 ToolRuntime；**非同一引用**（属性访问经 getTraceable 包装，方法面一致）。🔴 修正：`output.render` 是**双参** `render(exec.arguments, value)`（dsh-tools/lib/index.js:3431） |
| ② | 就绪时机与 inject 声明 | `inject: ['tools']` 声明后 apply() 内立即可用（无竞态）；不声明时属性访问抛 `cannot get property "tools" without inject`，`ctx.get` 则返 undefined。裁定走 `ctx.get?.('tools')`（见 7.2） |
| ③ | 工具可见可调 + guard | **通**：模型真实调用注册工具（pre-execute → result 全链路）；`guard()` 返回字符串=拒绝理由、单调不可翻案 |
| ④ | ask 分支 | **通，headless fail-closed**：`ctx.get('approval')` 服务在、无 answerer → `requires approval, but no approval channel is available`。WebUI 弹窗待 P3（web profile） |
| ⑤ | 命令/UI 面 | **headless 无 commands 注册面**（`<CommandsService add:undefined>`）→ kit 不做命令面；web 端待 P3 复核 |
| ⑥ | 可复现剧本 | 见 7.3 + 证据案例 Case 022 |

### 7.2 两种取法的机制裁定（静态源码 + 动态双重确认）

宿主 `@deepseek-ai/cordis`（dsh-deployed 内嵌 cordis 4.0.1）：

- **`ctx.get('tools')`** —— `ReflectService.get(name, strict=true)`（reflect mixin 直挂 ctx）：从 fiber store 取实现；strict 态服务未 active 返 `undefined`；**不要求 inject 声明**，天生鸭子降级友好。
- **`ctx.tools`（属性）** —— Context Proxy get trap：`Reflect.has` 未命中 → `internal/get` waterfall → **无 inject 声明且 fiber.runtime 存在**时沿 fiber 链查 store，查不到 `throw cannot get property "tools" without inject`。链式简洁，但无 inject 时抛错（破坏降级红线）。

**裁定：P1 kit 走 `ctx.get?.('tools')`**（对齐 dsh-backend.ts:135 参考实现，天然满足降级红线）。

### 7.3 宿主自跑可复现验证剧本（⑥产出）

完整五步剧本（探针插件形态 + profile `link:` 挂载 + 真 LLM 验证命令 + 期望输出 + 清理）见证据案例 `docs/evidence/cases/dsh-plugin-probe-2026-09-15/README.md`（Case 022）。核心命令面：

- `dsh --profile probe --dump-config | grep -A6 sofagent-probe` —— 合成树含探针条目 + `inject: [tools]`
- `dsh --profile probe "Call the tool sofagent_probe_echo ..."` —— 模型真实调用，`tools/result` 回显
- `DANGEROUS-payload` 变体 —— guard 拒绝；`sofagent_probe_ask` 变体 —— headless 无 answerer 拒绝

**事件位验证步（DSH 升级日复验用）**——把上一步的探针插件换成真实的 `cordis-plugin-sofagent-audit`，
断言的不再是「订阅成功」而是「拦截生效」：① 挂载后 kit 应打接线日志
`seam 事件接线成功：4/4（tools/result, tools/pre-execute, fs/write-intent, agent/turn-stopping）`；
② 模型发起一次**危险命令**调用（走宿主 bash 工具的 `command` 入参）——期望工具**未执行**、
模型收到 `Error: sofagent 工具门禁：…`（宿主把 `{ kind: 'deny', reason }` 转成错误结果，理由取
`dsh-tools/lib/index.js` 的 `prepareExecution` → `decision.reason`）；③ 非命令类工具（不带
`command` 入参）应照常执行——证明接线没有扩大拦截面；④ 卸载该插件 fiber 后重复 ② —— 应回到
**未拦截**状态（`plugin-kit` 的复合 disposer + cordis `ctx.on` 自身经 `fiber.effect` 登记，双保险）。

> ②④ 是唯一的端到端拦截面：`fs/write-intent` 是放行接线、`agent/error` 自动回滚默认关档（见 §6），
> 不要拿它们当拦截断言。

**进程内探针（零外部依赖，改动即复验）**——不起 profile、不调 LLM：在真实 `@deepseek-ai/cordis`
运行时里加载插件 `dist` 并直接派发事件断言判定结果。**完整脚本 + 两个必踩的坑**（① 插件
`inject` 声明的服务缺席时 cordis 静默不调 `apply`，表象等同「接线失效」；② CJS 产物经 `import()`
的 `default` 是双层的，宿主加载器 `unwrapExports` 解两层、探针须按同口径解包）**与实测输出**
（四款同挂 `4/4` + `1/1`×3；危险命令 `deny`、安全命令 `allow`、卸载 fiber 后回到 `allow`）见
Case 022 同名节。

### 7.4 对 P1 kit 扩容的直接输入

1. **取法**：`ctx.get?.('tools')`（reflect mixin 直挂、免 inject 声明、服务未就绪返 undefined 不抛——天然满足降级红线）；`PLUGIN_INJECT` 保持不含 `'tools'`。
2. **render 双参** `render(args, value)`（对齐 dsh-backend.ts `safeRender`）；**register() 返 disposer**——纳入 kit 复合卸载契约。
3. 注册无保留名冲突（不命中宿主 `run_code`）；apply() 内同步注册即可（实测无竞态），`tools/change` 可作注册确认信号。
4. **headless 无 commands 注册面**（add 为 undefined）——kit 不做命令面。
5. **ask 分支 fail-closed**：无 answerer 即 deny——需要 ask 语义的工具须 web profile（P3 复核）。
