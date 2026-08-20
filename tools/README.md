# tools/ — 维护者工具脚本（发版 SOP + 仓库健康）

> **边界说明**：`engine/scripts/` 是 install.sh 组装调用的**用户安装链**（install / verify / daemon 等随安装流程到达用户）；`tools/` 面向维护者发版 SOP 与仓库健康检查，不随安装分发。

## 一、门禁与检查（check-*）

| 脚本 | 用途 | 何时使用 |
|------|------|---------|
| `check-version.sh` | 版本号一致性检查（14 段：TS 常量/文档头/包版本/规则数等） | 发布前 |
| `check-docs.sh` | 文档预算与结构检查（A/B/C/D/E 层行数警戒线） | 发版 SOP |
| `check-test-count.sh` | 测试数对账（README/文档声称 vs 实测，双口径） | 发版 SOP |
| `check-review-system.sh` | 审查体系一致性（维度数/警戒线/S 编号闭环对账） | 发版 SOP 阶段七 |
| `check-tool-health.sh` | 工具脚本健康（路径活性/孤儿配置/set -u 守卫） | 发版 SOP 阶段九 |
| `check-anchors.mjs` | 跨文档 Markdown 锚点引用活性校验（见 check-docs.sh 第 11 段） | 发版 SOP |
| `check-cjk-var.sh` | shell 变量定界守卫（`$VAR` + CJK 全角标点误吞检测） | 改 shell 脚本后 |
| `check-deps.sh` | 关键依赖版本检查（npm 包版本对齐） | 发版前 / 定期 |
| `check-dev-prompt.sh` | 开发日志/Dev Prompt 代码引用一致性校验 | 发版 SOP |

## 二、草稿生成（gen-*）

| 脚本 | 用途 | 何时使用 |
|------|------|---------|
| `gen-abc-draft.mjs` | 阶段五 A/B/C 三类清单草稿（单次 LLM） | 发版 SOP 阶段五 |
| `gen-fresh-eyes-draft.mjs` | fresh-eyes 16 视角审查草稿（单次 LLM） | fresh-eyes-loop |
| `gen-acceptance-shard-prompts.mjs` | 验收测试 12 分片 prompt 生成 | 发版 SOP |
| `gen-perspective-prompts.mjs` | 24 视角 prompt 生成 | fresh-eyes-loop |
| `gen-weekly-report.mjs` | 周报生成 | 定期 |
| `gen-draft-lib.mjs` | **公共库**（LLM 配置/调用/降级/参数解析/版本提取，供 gen-* 复用） | 被 import |

## 三、仪表盘（dashboard）

| 文件 | 用途 | 何时使用 |
|------|------|---------|
| `sofagent-dashboard.sh` | 审计仪表盘入口（零前端依赖 bash+jq） | 日常监控 |
| `serve-dashboard.mjs` | Dashboard HTTP 服务（localhost:3780） | 日常监控 |
| `dashboard.html` | Dashboard 页面 | 被 serve-dashboard 加载 |
| `sofagent-dashboard.test.sh` | Dashboard 冒烟测试（package.json test 集成） | npm test |

## 四、发布与签名

| 脚本 | 用途 | 何时使用 |
|------|------|---------|
| `bump-version.sh` | 版本号 bump（SSOT 联动 253+ 处） | 发版 SOP 阶段三 |
| `publish-packages.sh` | npm 包批量发布（workspace 全量） | 发版 SOP 阶段十一 |
| `sign-config.mjs` | config.yml HMAC-SHA256 签名颁发（读 `~/.sofagent-key`，DP-2） | 安装后 |

## 五、推送门禁与测试统计

| 脚本 | 用途 | 何时使用 |
|------|------|---------|
| `pre-push-check.sh` | 推送前完整检查（四门禁聚合） | git push 前 |
| `test-count.sh` | workspace 测试数汇总（SSOT 反查 · 门禁用） | 发版 SOP / 常态 |
| `client-audit.mjs` | FDE 进场审计问卷脚本（按行业输出 Markdown） | FDE 进场 |
| `forge-pm2-start.sh` | PM2 守护 FORGE driver（fresh-eyes / release-gate） | FORGE 长循环 |
| `forge-smoke-test.sh` | FORGE 冒烟测试 | FORGE 改动后 |

## 六、审计问卷模板（audit-questionnaires/）

| 内容 | 说明 |
|------|------|
| `audit-questionnaires/*.json` | 5 个行业审计问卷（finance/generic/government/healthcare/manufacturing），每行业 15-20 题，三段式（审计现状/痛点定位/合规要求），`client-audit.mjs` 数据源 |

---

## 防屎山规则（新增脚本前必读）

1. **新增前置 grep**：新增检查项/生成器/脚本前，先 `grep -rn <功能关键词> tools/ engine/scripts/` 确认无同类实现；有则增量扩展，不新建；
2. **同类即抽**：同类文件 ≥3 个时必须抽公共库（现状：gen-* 系列 6 个 → `gen-draft-lib.mjs` 已抽）。
