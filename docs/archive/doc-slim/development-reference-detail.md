# DEVELOPMENT 参考明细归档（v1.5.7 文档减重）

> 内容原属 `docs/DEVELOPMENT.md`，按「参考明细下沉归档」纪律迁出，**原文逐字保真**；原地留摘要 + 指针。

## 一 · USB 完整运行时代码架构（v1.1.8+，三模块）


USB key 不是简单的文件复制——它是一个完整的便携式运行时。三个模块协作：

| 模块 | 源码 | 职责 |
|---|---|---|
| 写入侧 | `daemon/src/usb-key.ts` | `createUsbKey()` 主入口——复制 Node 便携版 + sofagent dist + 三平台启动脚本 → 写 federation.json（AES key + HMAC key，缺字段自动生成随机密钥）→ knowledge/ 用 `core/crypto/aes-gcm.ts` 加密落盘（只存密文）→ 全量 HMAC 签名 |
| 签名 | `daemon/src/usb-signature.ts` | HMAC-SHA256 全量签名：路径 POSIX 归一化 + 字典序 + SHA-256 内容哈希串联，不含 mtime（确定性可复算） |
| 运行侧 | `daemon/src/usb-runtime.ts` | `startUsbRuntime()` 主入口——启动验签 fail-closed（失败写 `security-events.jsonl` + exit 1）→ 内存解密 knowledge/（明文不落盘）→ `SOFAGENT_DATA`/`OPENCLAW_HOME` 便携化 env → daemon 主循环 → 退出 `Buffer.fill(0)` 清内存密钥 |

CLI 入口：`sofagent daemon create-usb-key --role --target --platform`（写入侧）+ `sofagent daemon start --usb-root`（运行侧）。启动脚本：`daemon/usb/start.command`（macOS）/ `start.sh`（Linux）/ `start.bat`（Windows）。

> 💡 USB 功能的用户侧使用见 [HANDBOOK §USB 烧录](../../HANDBOOK.md#usb-烧录三种部署场景全覆盖v118) 和 [FDE/GUIDE.md](../FDE/GUIDE.md)。这里只讲代码层架构。



## 二 · `SOFAGENT_*` 分流完整名单（G 23 / P 72 明细）


> 实测基线：`git grep -ohE 'SOFAGENT_[A-Z0-9_]+' -- 'engine/**' | sort -u | wc -l` = **95**（v1.5.7 章五施工时点；devlog 曾记 93/94 为旧快照）。判据——**改了它会改变「某能力在不在」的是功能门控（G）**，**只改能力行为参数的是配置参数（P）**。G 面进 `engine/capabilities.json`（主干能力清单 SSOT，`tools/gen/gen-capability-manifest.mjs` 守卫）；P 面不进清单。
>两面对账：清单内 env 字段 ↔ 本表 G 组逐项对应。

| 类 | 名单（95 = G 23 + P 72） |
|---|---|
| **G 功能门控（23）· 前置安全面（12）** | `AUDIT_ENABLED` `PERMISSION_GUARD` `MCP_ROLES` `MCP_ROLES_STRICT` `USAGE_TRACKING` `EVOLVE_GATE` `SANITIZE` `SANITIZE_IPS` `GIT_DISABLED` `REQUIRE_SIGNED_CONFIG` `ALLOW_PLUGIN_RULES` `STATEFUL_EXEC` |
| **G 功能门控（23）· 能力与运维面（12）** | `TRACE_EVIDENCE` `REDACT_STRICT` `SCOPE_REQUIRED` `TRAIN_SANDBOX` `SANDBOX_EGRESS` `WEBHOOK_ALLOW_LOCALHOST` `DEBUG` `SINGLE_ENTRY` `INTERNAL` `INTERNAL_INIT` `CONFIRM_BACKUP` `SOFAGENT_` |
| **P 配置参数（72）** | 路径类：`DATA` `HOME` `DIR` `CONFIG` `PROJECT_ROOT` `REPO_ROOT` `REPO_LOCAL` `KEY_PATH` `SNAPSHOT_OUT` `AUDIT_ENTRY` `ENGINE_ENTRY` `SESSION_WORKSPACE` `HOME_ALLOWED_PREFIXES`；（详→注-2） |

> 注-2：模型/端点类：`LLM` `LLM_` `LLM_A` `LLM_B` `LLM_API_KEY` `LLM_A_API_KEY` `LLM_BASE_URL` `LLM_ENGINEER(_API_KEY)` `LLM_REVIEWER(_API_KEY)` `LLM_GOAL_EVAL(_API_KEY)`
> `MODEL_` `MODEL_NAME` `MODEL_API_KEY` `MODEL_BASE_URL` `OLLAMA_ENDPOINT` `OLLAMA_MODEL` `L2_NER_ENDPOINT` `L2_NER_TIMEOUT_MS` `EXECUTION_BACKEND` `VIRTUAL_KEY`
> `TASK` `TASK_ID` `TASK_PROMPT` `SESSION_TASK_ID` `SESSION_TYPE` `AGENT_ID` `AGENT_NAME` `TENANT` `LABEL` `MACHINE_ID`
> `PERSONA_SOURCE` `PRE` `PRE_RC` `CONTEXT_BUDGET_RATIO` `CONTEXT_WINDOW_TOKENS` `REFRESH_KEEP` `RETENTION_DAYS` `RETENTION_MAX` `SPILL_TTL_DAYS` `CLEANUP_FREQUENCY`
> `AUDIT_TIMEOUT_MS` `HEALTH_PORT` `WEBHOOK_URL` `WEBHOOK_DINGTALK` `WEBHOOK_FEISHU` `WEBHOOK_WECOM` `ACCEPTANCE_MARKER` `MARKER_START` `MARKER_END` `EVAL_GOLDEN_SET`
> `EGRESS_SECRET` `DSH_PERMISSION_MODE` `CLEANUP_ON_RECORD` `NET_DENIED` `TOOL_DENIED` `TOOL_PENDING_APPROVAL` `SOFAGENT_`

**双向一致纪律**：清单内 5 个 env 档位（`AUDIT_ENABLED`/`PERMISSION_GUARD`/`MCP_ROLES`/`USAGE_TRACKING`/`EVOLVE_GATE`）与 G 组逐项对得上；G 组其余 18 项属「清单外门控」（能力单元不可独立关档、或为安全 fail-closed 面不开放可拔声明——如 `SANITIZE`/`REQUIRE_SIGNED_CONFIG` 属安全底线不设关档）。新增 `SOFAGENT_*` 时先判 G/P：G 项须同批进 capabilities.json 并过生成器断言，P 项登记本表即可。

