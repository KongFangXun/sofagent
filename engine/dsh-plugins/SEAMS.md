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
