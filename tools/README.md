# tools/ — 维护者工具脚本（发版 SOP + 仓库健康）

> **边界说明**：`engine/scripts/` 是 install.sh 组装调用的**用户安装链**（install / verify / daemon 等随安装流程到达用户）；`tools/` 面向维护者发版 SOP 与仓库健康检查，不随安装分发。
>
> **目录结构（v1.3.9 物理分目录）**：按职能分子目录——check/ 门禁与测试统计、gen/ 草稿生成、dashboard/ 仪表盘、release/ 发布三件套、forge/ FORGE 运维、audit/ FDE 进场审计（脚本 + 问卷数据源同目录）；`pre-push-check.sh` 留根（四门禁聚合入口，被 acceptance-test 大量引用）。

## 根目录

| 脚本 | 用途 | 何时使用 |
|------|------|---------|
| `pre-push-check.sh` | 推送前完整检查（四门禁聚合：check-version / check-docs / check-anchors / check-cjk-var / test-count / check-test-count / forge-smoke-test） | git push 前 |

## 一、check/ — 门禁与检查

| 脚本 | 用途 | 何时使用 |
|------|------|---------|
| `check/check-version.sh` | 版本号一致性检查（14 段：TS 常量/文档头/包版本/规则数等） | 发布前 |
| `check/check-docs.sh` | 文档预算与结构检查（A/B/C/D/E 层行数警戒线） | 发版 SOP |
| `check/check-test-count.sh` | 测试数对账（README/文档声称 vs 实测，双口径） | 发版 SOP |
| `check/test-count.sh` | workspace 测试数汇总（SSOT 反查 · 门禁用） | 发版 SOP / 常态 |
| `check/check-review-system.sh` | 审查体系一致性（维度数/警戒线/S 编号闭环对账） | 发版 SOP 阶段七 |
| `check/check-tool-health.sh` | 工具脚本健康（路径活性/孤儿配置/set -u 守卫——递归扫 tools/ 全部 .sh 含子目录） | 发版 SOP 阶段九 |
| `check/check-anchors.mjs` | 跨文档 Markdown 锚点引用活性校验（见 check-docs.sh 第 11 段） | 发版 SOP |
| `check/check-cjk-var.sh` | shell 变量定界守卫（`$VAR` + CJK 全角标点误吞检测） | 改 shell 脚本后 |
| `check/check-deps.sh` | 关键依赖版本检查（npm 包版本对齐） | 发版前 / 定期 |
| `check/check-dev-prompt.sh` | 开发日志/Dev Prompt 代码引用一致性校验 | 发版 SOP |
| `check/public-api.mjs` | public API 变更检测门禁（@public 符号集 vs 基线，未 bump 即 FAIL；v1.3.9 四） | CI / 发版前 |
| `check/public-api-baseline.json` | @public 符号集基线（12 包 + 版本快照；`--update-baseline` 发版时重建） | 被 public-api.mjs 消费 |

## 二、gen/ — 草稿生成

| 脚本 | 用途 | 何时使用 |
|------|------|---------|
| `gen/gen-abc-draft.mjs` | 阶段五 A/B/C 三类清单草稿（单次 LLM） | 发版 SOP 阶段五 |
| `gen/gen-fresh-eyes-draft.mjs` | fresh-eyes 16 视角审查草稿（单次 LLM） | fresh-eyes-loop |
| `gen/gen-acceptance-shard-prompts.mjs` | 验收测试 12 分片 prompt 生成 | 发版 SOP |
| `gen/gen-perspective-prompts.mjs` | 24 视角 prompt 生成 | fresh-eyes-loop |
| `gen/gen-weekly-report.mjs` | 周报生成 | 定期 |
| `gen/gen-draft-lib.mjs` | **公共库**（LLM 配置/调用/降级/参数解析/版本提取，供 gen-* 复用） | 被 import |

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
| `release/publish-packages.sh` | npm 包批量发布（workspace 全量） | 发版 SOP 阶段十一 |
| `release/sign-config.mjs` | config.yml HMAC-SHA256 签名颁发（读 `~/.sofagent-key`，DP-2） | 安装后 |

## 五、forge/ — FORGE 运维

| 脚本 | 用途 | 何时使用 |
|------|------|---------|
| `forge/forge-pm2-start.sh` | PM2 守护 FORGE driver（fresh-eyes / release-gate） | FORGE 长循环 |
| `forge/forge-smoke-test.sh` | FORGE 冒烟测试 | FORGE 改动后 |

## 六、audit/ — FDE 进场审计

| 内容 | 说明 |
|------|------|
| `audit/client-audit.mjs` | FDE 进场审计问卷脚本（按行业输出 Markdown），问卷数据源同目录 |
| `audit/audit-questionnaires/*.json` | 5 个行业审计问卷（finance/generic/government/healthcare/manufacturing），每行业 15-20 题，三段式（审计现状/痛点定位/合规要求），`client-audit.mjs` 数据源 |

## 七、scripts/ — 一次性迁移脚本

| 脚本 | 用途 | 何时使用 |
|------|------|---------|
| `scripts/annotate-api-tiers.mjs` | v1.3.9 四 API 分级基线一次性标注（幂等——已有标记则跳过） | 历史脚本，仅存档 |

---

## 防屎山规则（新增脚本前必读）

1. **新增前置 grep**：新增检查项/生成器/脚本前，先 `grep -rn <功能关键词> tools/ engine/scripts/` 确认无同类实现；有则增量扩展，不新建；
2. **同类即抽**：同类文件 ≥3 个时必须抽公共库（现状：gen-* 系列 6 个 → `gen/gen-draft-lib.mjs` 已抽）；
3. **归类落位**：新脚本按职能进对应子目录（check/gen/dashboard/release/forge/audit），不留根——根目录只允许 `pre-push-check.sh` 聚合入口。
