# 千问办公（QwenWork）适配指南

> v1.4.0 规划项 · 状态：**MCP 确定可接，Hook 拦截待实测**
> 最后更新：2026-08-22

## 定位

千问办公（阿里 QwenWork）是阿里旗下协作平台，作为 sofagent 的**潜在第三个生态位**（与 OpenClaw / DSH 并列）。本指南记录已确认的接入面与待澄清项，**不写死配置契约**——schema 以官方实测为准。

## 已确认能力（可落地）

| 能力 | 状态 | 接入方式 |
|------|------|----------|
| **自定义 MCP 服务** | ✅ 确定 | 支持 Streamable HTTP / SSE / STDIO；sofagent 的 `sofagent-mcp`（61 tool）可直接挂入 |
| **自定义 Hook（命令行安全防护）** | ⚠️ 能力存在，schema 未公开 | 官方确认「支持开发者自定义 Hook 拦截危险命令（如 rm -rf）」，但配置格式未公开文档 |

## 与既有架构的同构性

千问办公的自定义 Hook 与 Cursor / Claude Code 的 hook 机制**功能同构**（工具调用前拦截 + 命令审计），因此复用 v1.4.0 的共享拦截脚本 `tools/hooks/sofagent-precommit.sh` 是可行的——该脚本已支持 stdin JSON（平台 hook 模式）。

## 接入路径（建议）

### 一、MCP 接入（确定项，可先落地）
1. 在千问办公的 MCP 配置处，按「STDIO」或「Streamable HTTP」挂载 `sofagent-mcp`。
2. 验证 61 tool 可见（`run_audit` / `snapshot_restore` / `worklog_query` 等）。

### 二、Hook 拦截（待实测项，不写死）
1. 查证千问办公自定义 Hook 的配置文件位置与 JSON schema（官方文档 / 实测抓包）。
2. 若 schema 与 Cursor/Claude Code 同构 → 复用 `tools/hooks/sofagent-precommit.sh`，薄配置指向它。
3. 若 schema 不同 → 在脚本内增加「千问办公适配分支」（读取其 stdin JSON 字段）。
4. **未实测前，不在仓库写入千问办公的 hook 配置文件**（避免臆测契约）。

## 验收（纳入 v1.4.0 acceptance）
- [ ] sofagent-mcp 在千问办公内可被发现并调用
- [ ] （实测后）commit 类命令被审计拦截或放行正确

## 反向要求（用户指令）
「不支持就不写」——当前结论：MCP 支持（写）；Hook 支持能力存在但合约未明（预留，不写死）。
