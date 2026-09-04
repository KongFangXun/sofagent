# tools/ — 维护者工具脚本（发版 SOP + 仓库健康）

> **边界说明**：`engine/scripts/` 是 install.sh 组装调用的**用户安装链**（install / verify / daemon 等随安装流程到达用户）；`tools/` 面向维护者发版 SOP 与仓库健康检查，不随安装分发。
>
> **目录结构（v1.3.9 物理分目录 · v1.4.4 收口）**：按职能分子目录——check/ 门禁与测试统计、gen/ 草稿生成、dashboard/ 仪表盘、release/ 发布与签名（v1.4.0 起含 `pre-push-check.sh` 四门禁聚合入口）、forge/ FORGE 运维、audit/ FDE 进场审计（脚本 + 问卷数据源同目录）、hooks/ 共享 hook 脚本（v1.4.0 交付五）、train/ 训练环境与设备打包（v1.4.4 归位）。**根目录无任何脚本与数据文件**（含 .mjs——vitest-setup 归 check/，训练脚本归 train/）。

## 根目录

无脚本、无数据文件。新增脚本一律按职能进子目录（见文末防屎山规则三）。

## 一、check/ — 门禁与检查

| 脚本 | 用途 | 何时使用 |
|------|------|---------|
| `check/check-version.sh` | 版本号一致性检查（14 段：TS 常量/文档头/包版本/规则数等） | 发布前 / CI |
| `check/check-docs.sh` | 文档预算与结构检查（A/B/C/D/E 层行数警戒线） | 发版 SOP / CI |
| `check/check-test-count.sh` | 测试数对账（README/文档声称 vs 实测，双口径） | 发版 SOP / CI |
| `check/test-count.sh` | workspace 测试数汇总（SSOT 反查 · 门禁用） | 发版 SOP / 常态 |
| `check/sync-test-count.sh` | 测试数联动写入（实测值回写文档声称位） | 发版 SOP 数字收口 |
| `check/check-review-system.sh` | 审查体系一致性（维度数/警戒线/S 编号闭环对账） | 发版 SOP 阶段七 |
| `check/check-tool-health.sh` | 工具脚本健康（路径活性/孤儿配置/set -u 守卫/README 收录对账——递归扫 tools/ 全部 .sh 含子目录） | 发版 SOP 阶段九 |
| `check/check-guards.sh` | 守卫的守卫（meta-guard：门禁脚本自身四类腐烂模式静态扫 + `--inject` 注入实测——红不了的门禁是装饰品） | 发版 SOP / CI |
| `check/check-anchors.mjs` | 跨文档 Markdown 锚点引用活性校验（见 check-docs.sh 第 11 段） | 发版 SOP / CI |
| `check/check-cjk-var.sh` | shell 变量定界守卫（`$VAR` + CJK 全角标点误吞检测） | 改 shell 脚本后 / CI |
| `check/check-shell-injection.sh` | 命令注入静态扫（engine 源码面：execSync 模板插值/字符串拼接注入形态——v1.4.3 安全修复批防线） | CI |
| `check/check-action-pins.sh` | GitHub Actions SHA pin 对账（uses: 完整 commit SHA 与行内注释 tag 指向一致性，离线降级 exit 0） | 发版前 / 定期 |
| `check/check-storefront.sh` | 仓外门面对账（GitHub description/homepage/topics 数字 vs 仓内实数；离线 SKIP 可见不假绿） | 发版 SOP 阶段八/九 |
| `check/check-spec-first.mjs` | 规范先行硬禁令门禁（engine/*/src 提交须含 `spec:` 关联或 `no-spec:` 豁免——观察期 WARN 不阻断） | 发版 SOP / 定期 |
| `check/check-deps.sh` | 关键依赖版本检查（npm 包版本对齐） | 发版前 / 定期 |
| `check/check-dev-prompt.sh` | 开发日志/Dev Prompt 代码引用一致性校验 | 发版 SOP |
| `check/public-api.mjs` | public API 变更检测门禁（@public 符号集 vs 基线，未 bump 即 FAIL；v1.3.9 四） | CI / 发版前 |
| `check/public-api-baseline.json` | @public 符号集基线（12 包 + 版本快照；`--update-baseline` 发版时重建） | 被 public-api.mjs 消费 |
| `check/resolve-section.sh` | 行号→markdown 段落归属解析器（防「行号冒充归属」——排障工具，非门禁） | 审查报告取证时 |
| `check/vitest-setup.mjs` | 全局测试隔离（预置 SOFAGENT_DATA 到 tmp，防测试污染真实 HOME——被 5 个 engine/*/vitest.config.ts setupFiles 引用） | vitest 自动挂载 |

## 二、gen/ — 草稿生成

| 脚本 | 用途 | 何时使用 |
|------|------|---------|
| `gen/gen-abc-draft.mjs` | 阶段五 A/B/C 三类清单草稿（单次 LLM） | 发版 SOP 阶段五 |
| `gen/gen-fresh-eyes-draft.mjs` | fresh-eyes 16 视角审查草稿（单次 LLM） | fresh-eyes-loop |
| `gen/gen-acceptance-shard-prompts.mjs` | 验收测试 12 分片 prompt 生成 | 发版 SOP |
| `gen/gen-perspective-prompts.mjs` | 24 视角 prompt 生成 | fresh-eyes-loop |
| `gen/gen-weekly-report.mjs` | 周报生成 | 定期 |
| `gen/gen-draft-lib.mjs` | **公共库**（LLM 配置/调用/降级/参数解析/版本提取，供 gen-* 复用） | 被 import |
| `gen/gen-api-tools.mjs` | docs/API.md 第二节生成器（从 tool-registry.ts 提取全量 tool 按域分组重写，check-docs 断言「文档数 == registry 实数」） | 新增/变更 MCP tool 后 |

## 三、dashboard/ — 仪表盘

| 文件 | 用途 | 何时使用 |
|------|------|---------|
| `dashboard/sofagent-dashboard.sh` | 审计仪表盘入口（零前端依赖 bash+jq） | 日常监控 |
| `dashboard/serve-dashboard.mjs` | Dashboard HTTP 服务（localhost:3780） | 日常监控 |
| `dashboard/dashboard.html` | Dashboard 页面 | 被 serve-dashboard 加载 |
| `dashboard/sofagent-dashboard.test.sh` | Dashboard 冒烟测试（package.json test 集成） | npm test |

## 四、release/ — 发布与签名

| 脚本 | 用途 | 何时使用 |
|------|------|---------|
| `release/bump-version.sh` | 版本号 bump（SSOT 联动 253+ 处） | 发版 SOP 阶段三 |
| `release/pre-push-check.sh` | 推送前完整检查（四门禁聚合：check-version / check-docs / check-anchors / check-cjk-var / test-count / check-test-count / forge-smoke-test；v1.4.0 由根目录移入） | git push 前 |
| `release/publish-packages.sh` | npm 包批量发布（workspace 全量） | 发版 SOP 阶段十一 |
| `release/sign-config.mjs` | config.yml HMAC-SHA256 签名颁发（读 `~/.sofagent-key`，DP-2） | 安装后 |
| `release/gitdata-push.mjs` | Git Data API 推送备选通道（blobs→trees→commits→refs，https 断连绕行） | push 502 时 |

## 五、forge/ — FORGE 运维

| 脚本 | 用途 | 何时使用 |
|------|------|---------|
| `forge/forge-pm2-start.sh` | PM2 守护 FORGE driver（fresh-eyes / release-gate） | FORGE 长循环 |
| `forge/forge-smoke-test.sh` | FORGE 冒烟测试 | FORGE 改动后 |
| `forge/forge-runs-stats.mjs` | FORGE 质量循环离线统计（纯只读：视角生产力/复发热点/运行健康度三报告） | 定期复盘 |

## 六、audit/ — FDE 进场审计

| 内容 | 说明 |
|------|------|
| `audit/client-audit.mjs` | FDE 进场审计问卷脚本（按行业输出 Markdown），问卷数据源同目录 |
| `audit/audit-questionnaires/*.json` | 7 个行业审计问卷（finance/generic/government/healthcare/manufacturing/retail/supplychain），每行业 15-20 题，三段式（审计现状/痛点定位/合规要求），`client-audit.mjs` 数据源 |

## 七、hooks/ — 共享 hook 脚本

| 内容 | 说明 |
|------|------|
| `hooks/sofagent-precommit.sh` | 跨平台共享 pre-commit hook（stdin 模式——Cursor/Claude Code/Gemini CLI 等平台 commit 审计共用；v1.4.0 交付五） |

## 八、train/ — 训练环境与设备打包

| 脚本 | 用途 | 何时使用 |
|------|------|---------|
| `train/train-env-init.sh` | 训练环境一键安装（venv + 框架 + CUDA 校验；Mac 降级 npm --prefix 装 @mlx-node/trl；与 env-manager.ts 同一套判定——脚本形态是「无 Node 也能装」） | 装训练环境时 |
| `train/package-train-runtime.sh` | 训练运行时打包（orchestrator+core dist + 模板 + 环境脚本 + 可选基座缓存 → tar.gz + setup.sh，U 盘/离线交付形态） | 设备交付时 |

---

## 防屎山规则（新增脚本前必读）

1. **新增前置 grep**：新增检查项/生成器/脚本前，先 `grep -rn <功能关键词> tools/ engine/scripts/` 确认无同类实现；有则增量扩展，不新建；
2. **同类即抽**：同类文件 ≥3 个时必须抽公共库（现状：gen-* 系列 6 个 → `gen/gen-draft-lib.mjs` 已抽）；
3. **归类落位**：新脚本按职能进对应子目录（check/gen/dashboard/release/forge/audit/hooks/train），不留根——根目录不放置任何脚本与数据文件（`check-tool-health.sh` 收录对账守卫）。
