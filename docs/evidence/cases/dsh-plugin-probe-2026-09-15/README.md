# Case 022 — DSH 宿主插件契约动态探针实测（P0）

> **背景**：插件能力面开发批（工序表 P0）——静态源码分析只证明「代码里有这些 API」，不证明「真实 profile 启动后插件拿得到」。本案例是动态部分的完整证据留档；结论摘要已沉淀 `engine/dsh-plugins/SEAMS.md` §7（词表与契约面），本文件承载可复现剧本与真实输出摘录。

## 测试人信息

| 字段 | 填写 |
|------|------|
| 测试人 | KongFangXun |
| 事件日期 | 2026-09-15 |
| 测试环境 | macOS · DSH 0.1.2-alpha.1（`~/.local/share/dsh-deployed`）· Node 24.19.0 |
| 测试版本 | v1.4.9 插件能力面 P0 批（SEAMS.md §7 commit 7e3ad29a） |
| 测试类型 | DSH 宿主插件契约动态验证（临时探针插件 + 真实 headless 跑通） |

## 方法（探针形态）

- **临时探针插件**：`/tmp/sofagent-probe-plugin/`（仓外，纯 `apply(ctx)` 形态、无 cordis import——对齐 plugin-kit 鸭子类型先例）。default export `{ name, inject: ['tools'], apply(ctx, config) }`；apply 内：打印 `ctx.get('tools')` / `ctx.tools` 形状 → 注册 `sofagent_probe_echo` / `sofagent_probe_ask` / `sofagent_probe_report` 三工具 → `guard()` 拦 DANGEROUS 关键字 → 订阅 `tools/change` / `tools/result` / `tools/pre-execute` → 探测 `ctx.get('approval')` / `ctx.get('commands')`。
- **仓外探针 profile**：`~/.dsh/profiles/probe/`（bundles `[dsh-base, dsh-headless, cordis-plugin-sofagent-probe]`，deps `link:/tmp/sofagent-probe-plugin`）——**绝不动现有 web/headless profile**。
- 探针产物用完即删（插件目录与 profile 均已清理），只留结论。

## 可复现剧本（五步）

前置：`~/.zshrc` 内 GLM_API_KEY 可用。

```bash
# 1) 建仓外探针插件
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

## 验证结论（六项产出，详表见 SEAMS.md §7.1）

| # | 验证项 | 结果 |
|:--:|--------|:--:|
| 1 | 契约形状复核（三种取法可用 + 非同引用 + render 双参签名修正） | ✅ |
| 2 | `ctx.get('tools')` vs `ctx.tools` 机制裁定（kit 走 `ctx.get?.('tools')`） | ✅ |
| 3 | 工具注册后模型可见可调 + guard 单调拒绝 | ✅ |
| 4 | ask 分支 headless fail-closed（无 answerer → deny） | ✅ |
| 5 | 命令面：headless 无 commands 注册面（add undefined） | ✅（不可用已确认） |
| 6 | 可复现剧本（本文件） | ✅ |

## 真实输出摘录

```
[probe] ctx.get("tools") = <ToolRuntime register:function guard:function>
[probe] same object via get/property = false
[probe] waterfall tools/pre-execute listener invoked for sofagent_probe_echo args.message = "hello-from-probe"
[probe] event tools/result fired: sofagent_probe_echo {"isError":false,...,"value":{"echoed":"probe-echo:hello-from-probe"}}
Error: probe-guard: DANGEROUS keyword denied (monotonic)
[probe] event tools/result fired: sofagent_probe_ask {"isError":true,...requires approval...}
[probe] ctx.get("commands") = <CommandsService add:undefined>
```

## 后续

- P1（plugin-kit 工具注册面 + 多包桥接）按 SEAMS.md §7.4 输入实施——kit 采用 `ctx.get?.('tools')` 取服务（免 inject、天然降级不抛），render 按 `render(args, value)` 双参。
- WebUI 审批弹窗（ask 分支完整交互）与命令面复核排 P3（web profile 验收）。
