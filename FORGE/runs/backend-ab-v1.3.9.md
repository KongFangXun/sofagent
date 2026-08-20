# v1.3.9（五）· FORGE driver 执行层切 DSH · A/B 实测报告

> 实测时间：2026-08-21 · 实测人：v1.3.9 开发 session · 任务：同任务两后端对比（耗时/产物一致性）

## 一、实测环境

| 项 | 值 |
|---|---|
| 机器 | macOS (darwin arm64) |
| 模型 | deepseek-v4-flash（DeepSeek API 按量计费，OpenAI 兼容接口） |
| 任务 | 系统提示「只回答一句话禁止调用工具」+ 用户问题「1+1 等于几」 |
| 接口 | `createExecutionBackend({ preferred })` → `backend.execute()`（真实 LLM 调用） |

## 二、实测数据

| 组 | preferred | 实际后端 | 后端选择耗时 | 执行耗时 | 产物 | 轮次 |
|---|---|---|---|---|---|---|
| A | `dsh`（DSH 默认） | langgraph（降级） | 126ms | 718ms | `"2"` | 1 |
| B | `langgraph`（显式） | langgraph | 2ms | 563ms | `"2"` | 1 |

**产物一致性**：A=B=`"2"`——两路径产出一致 ✓

**DSH 降级开销**：124ms（DSH 动态探测 + rc 守卫拦截 + LangGraph 加载）——一次性开销，run 级可忽略。

## 三、DSH 后端现状（如实记录）

DSH npm 仅有 rc 版本（`@deepseek-ai/dsh@0.1.0-rc.8`，cordis 4.0.1 stable）。v1.3.6 设计的层 1 守卫（rc/beta/alpha 拦截）按预期生效：preferred=dsh → 守卫拦截 → 自动降级 langgraph。**这不是缺陷而是设计**——DSH 正式版发布后守卫自动通过，preferred=dsh 将真实切到 DSH Cordis 运行时，无需改代码。

因此本 A/B 实测覆盖的是：
1. ✅ 后端选择机制（preferred 显式化 + 自动降级路径）
2. ✅ 降级路径的产物一致性（A=B）
3. ⏳ DSH 真实执行路径——待 DSH 正式版发布后补测（预期收益：架构解耦 + 供应链安全 + 运行时级用量计量，不是提速）

## 四、门禁工具化接线（验收：≥3 个门禁脚本经 tool 注册暴露）

`FORGE/src/gate-tools.mjs`（新增）——首期三个（prompt 明确的首期范围）：

| 工具名 | 包装脚本 | 实测 |
|---|---|---|
| `check_version` | `tools/check/check-version.sh` | ✅ 实调 ok=true exitCode=0 7354ms |
| `check_docs` | `tools/check/check-docs.sh` | ✅ 注册可用 |
| `check_review_system` | `tools/check/check-review-system.sh` | ✅ 注册可用 |

- **LangGraph 形态**：`createGateTools()` → DynamicStructuredTool（release-gate-driver 的 V 角色 worker 工具列表已追加——worker 调内部 tool 不跑 run_bash shell）
- **DSH 注册形态**：`getGateToolDefinitions()` → define 段（name/description/parameters）与 execute 段分离——对齐 dsh-backend.ts 的 ToolDefinition 三段式契约，DSH 后端启用时直接挂载
- ⚠️ 不做成 `@sofagent/cordis-plugin-*` 生态包（这些脚本只服务本仓库发版流程，与 v1.4.0 通用 cordis-plugin-gate 是两个东西）

## 五、driver 接线

| driver | 行为 |
|---|---|
| `release-gate-driver.mjs` | `preferred='dsh'`（DSH 默认，fallback 保留作降级）；`FORGE_BACKEND=langgraph` 可整体回切；worker 日志显式打印 `preferred → actual` |
| `fresh-eyes-driver.mjs` | 按场景切后端（同 driver 两后端并存）：审查类 step（a-check/b-check/a-consolidate/a-verify，对应 SOP 阶段一「审上版本」场景）→ langgraph；执行类 step（b-fix 修复，对应阶段四「审本版本」执行场景）→ dsh；`FORGE_FRESH_EYES_BACKEND` / `SOFAGENT_EXECUTION_BACKEND` 环境变量整体覆盖 |

## 六、usage 计量与监控

- usage 计量：driver 侧 `recordTokenUsage()` 从 execResult 提取 usage——两后端路径均经 backend.execute() 返回，计量链路不变（本实测任务无工具调用，token 计量在 FORGE 常规 run 中验证）
- 监控协议：**持续轮询 120s/轮仍是主档**（2026-08-20 用户两次拍板——session 可见性硬要求），事件订阅只作补充；心跳冻结（>90s）时 `--check-alive <runDir>` 探活——本版未改监控协议（事件推送升级与轮询并行评估，未实施）

## 七、上下文管理评估（DSH RC.8 启发 · 评估结论）

`truncateToolOutput` 200 行硬裁剪升级为「压力事件驱动」（对齐 DSH `compaction-tool-result-pruner`）+ 工具调用 bounded rolling pool：**评估完成，未实施**——当前 200 行裁剪 + TOOL_SOFT/HARD_LIMIT 软熔断组合在 run-12 后运行稳定；待 DSH 正式版真实切换后按实测数据决定是否升级（过早优化无数据支撑）。
