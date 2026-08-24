📊 上一版我们把 AI 的工作过程记成了账本（worklog），这一版让账本变成人人都能看的驾驶舱，并把 sofagent 的约束能力打包成插件家族，直接进 DeepSeek Harness 和 OpenClaw 两个生态——就像给每个 AI 员工配了「工作报表 + 公司章程 + 审计官」。

## 🔨 核心变更

### 📊 Web 工作明细 + 🗺️ 图谱栏
- Dashboard 新增工作明细区块：按 Agent / Workflow / 周 + 人工介入四视角（读 worklog.json，示例数据降级）
- 图谱栏：FDE 双图谱（业务图谱 + 本体图谱）+ MCP 工具视图 + skill 加载链视图
- Dashboard HTML 产品化：随 install.sh 装到用户机（开发态/安装态双路径）

### 💰 成本审计
- 超支告警（WARN only 不拦截）+ `cost_query` MCP tool + COST DecisionKind（决策日志新分型）——「成本超支」从不可见变成可审计、可告警

### 🔌 DSH 插件家族（9 款）+ 🦞 OpenClaw 插件家族（4 款）
- 约束层四能力外化双生态：audit / rollback / inject / evolve / ontology / commons / gate / daemon / fde（DSH inventory 全可见）+ inject / audit / rollback / evolve（ClawHub code-plugin）
- Cursor / Claude hook 拦截：共享 precommit 脚本 + 双平台薄配置（S321 CI 闭环验证）

### 📡 远程 API 通道 + 🔗 MLflow + 🌐 Agentic Browser
- 客户端→服务器 workflow 触发 + 状态查询（契约文档化）
- `logBenchmarkToMlflow` 接入评测链路（tracking server 不可达降级不抛）
- Browser 4 工具（navigate / click / screenshot / assert）+ Playwright 真实驱动

### ⚡ DSH 默认启用 + 🔌 MCP 自动配置
- 不等 DSH 正式版——rc 期默认走 CLI 桥接（headless + 自带 fs/bash 工具链）；`SOFAGENT_FORCE_DSH=1` 不再需要
- install.sh 补 codex/hermes 分支 + 各平台写 MCP 配置装完即连

### 🔄 联邦查询 + 🐚 bash 3.2 + 🔍 审计溯源
- 联邦链路双重验收：fork 版 10 断言（S320）+ 独立进程版 4 场景（S322）——配对 / 跨设备加密查询 / 篡改检测 / 离线降级全通
- 全 shell 脚本 /bin/bash 3.2 真实环境验证 EXIT=0
- 审计溯源字段回填：`whichDataVersion` + `beforeAfter` 结构化摘要（TODO(v1.x) 收口）

### 🔀 工具角色分层 + 瘦描述
- 66 个 MCP 工具按 7 角色面打标（audit / fde / eval / agent / ops / commons / browser），默认全量暴露，`SOFAGENT_MCP_ROLES` 显式收窄专职面
- description 瘦身：schema 降 14%（去版本号/历史注释——聚焦「做什么」改善选错率）

### 🔒 BugFix
- Cordis 内嵌完整适配：worker 真正切到进程内驱动（boot + agents.create + followup，非 CLI 子进程桥接）
- argv[1] 守卫：node -e 宿主下 cordis-plugin-hmr 兼容（内嵌不再静默降级 CLI）
- 检查器 4 缺陷修复（维度 90/89/111 正则与解析 + 维度 49 参数动态化——误报根因系统性排查）

## ⚠️ 破坏性变更

- **MCP 工具数 61 → 66**：新增 `cost_query`（成本查询）+ browser 4 工具（navigate/click/screenshot/assert）
- **工具默认全量暴露 + description 瘦身**（schema 降 14%）——`SOFAGENT_MCP_ROLES` 显式收窄专职面（可选，不影响默认）
- **DSH 默认启用**：`SOFAGENT_FORCE_DSH=1` 不再需要——rc 期默认走 CLI 桥接（原默认 LangGraph 降级）；需 LangGraph 执行时显式 `SOFAGENT_EXECUTION_BACKEND=langgraph`
- **DecisionKind 枚举 12 → 13**：新增 `COST`（决策日志新分型）
- **目录归位**：`tools/pre-push-check.sh` → `tools/release/pre-push-check.sh`（引用已同步）
- **DSH 插件更名**：`cordis-plugin-audit` → `cordis-plugin-sofagent-audit`（9 款全改，品牌统一）

## ✅ 质量验证

| 检查项 | 结果 |
|------|:--:|
| npm test | 2937 tests 全绿 ✅ |
| acceptance-test | 332/332 场景全绿 ✅ |
| shellcheck | 零 error ✅ |
| check-version | 75/75 全绿 ✅ |
| 回归检查 | 94 维度 ✅ |
| release-gate | verdict=PASS ✅ |
| fresh-eyes | 16 视角审查闭环 ✅ |

📖 [详细开发日志](./docs/changelog/v1.4/v1.4.0.md)
