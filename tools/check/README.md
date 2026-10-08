# tools/check/ · 门禁一览

> 本目录承载 sofagent 的**机器门禁集**（53 个 `.sh`/`.mjs` 脚本 + 台账/基线 JSON + `lib/` 共享库）。本表只登记现状（v1.5.8），不做脚本拆分。
> 执行入口：多数脚本可直接 `bash tools/check/<name>.sh` 单跑；发版链路由 `tools/release/pre-push-check.sh` 与 `docs/changelog/releasing.md` SOP 汇编调用。

## 门禁 → 管哪个面（53 脚本）

### 文档与声称面（14）

| 脚本 | 管什么 |
|---|---|
| `check-docs.sh` | 文档一致性（规则数/工具数/链接/行数预算 A 层 7480/E 层 4000/平台挂载文件 MCP 数对账） |
| `check-version.sh` | 全项目版本号一致性（13 包 + action.yml + bin 钉值） |
| `check-test-count.sh` | 文档声称测试数/acceptance 场景数 vs 实际（SSOT=TOTAL_TESTS 行；场景守卫已接主路径） |
| `check-storefront.sh` | 仓外门面对账（GitHub description/npm umbrella/glama + 规则数五变体全仓活区零残留） |
| `check-readme-parity.sh` | 双语 README 结构对账（中英对称） |
| `doc-discipline.sh` | 对外文档写作纪律（冻结区 Face 4 / 本机路径 Face 2 等） |
| `doc-score.mjs` | 文档质量六维评分（每版必跑，各维 ≥8 放行） |
| `doc-postcheck.mjs` | 文档落盘后自检（单文件秒级，非门禁） |
| `check-anchors.mjs` | Markdown 锚点校验（跨文件 + 文件内） |
| `check-claims.mjs` | 三组「声称 ↔ 实测」断言 |
| `check-literals.sh` | 手填字面量对账（数据驱动，`literals.json`） |
| `check-table-shape.mjs` | 表格形态门禁（形状 + 注引用） |
| `check-archaeology.sh` | 规则文档「禁考古」守卫（豁免见 `archaeology-exempt.json`） |
| `check-cjk-var.sh` | shell 变量定界守卫（CJK 变量名） |

### 规则与审计面（4）

| 脚本 | 管什么 |
|---|---|
| `check-dev-prompt.sh` | 开发日志/Dev Prompt 代码引用一致性（跨版「新建」索引 + 纠错语境豁免） |
| `check-review-system.sh` | 审查体系一致性（阶段四执行体） |
| `check-paired-records.mjs` | 判决类记录成对完整门禁 |
| `public-api.mjs` | public API 变更检测（`public-api-baseline.json`） |

### 代码与接线面（14）

| 脚本 | 管什么 |
|---|---|
| `check-shellcheck.sh` | shellcheck 门禁（CI 同口径） |
| `check-shell-injection.sh` | 命令注入静态扫（engine 源码面） |
| `check-silent-catch.mjs` | 静默吞错门禁（`silent-catch-baseline.json` 台账） |
| `check-unwired-exports.sh` | 零接线导出门禁 |
| `check-wiring-guard.mjs` | 接线守卫 |
| `check-mcp-registry-wiring.mjs` | MCP 注册表接线守卫 |
| `check-seam-contract.mjs` | 插件适配层 seam 契约门禁（词表 SSOT=SEAMS.md） |
| `check-seam-drift.mjs` | 宿主 hook 词表漂移巡检（只提示不阻断） |
| `check-cross-package-relative.mjs` | 越包相对引用守卫 |
| `check-mjs-comment-backtick.mjs` | mjs/js 注释可执行反引号守卫 |
| `dependency-direction.sh` | 依赖方向架构测试 |
| `check-home-resolution-parity.mjs` | 家目录解析口径对照共享守卫 |
| `check-legacy-knowledge-path.mjs` | 知识库旧路径残留守卫 |
| `check-deps.sh` | 依赖健康检查 |

### 工具与资产面（6）

| 脚本 | 管什么 |
|---|---|
| `check-dashboard.sh` | dashboard.html 结构性缺陷门禁（MAX_LINES 3000 / 内联 style 上限） |
| `check-action-pins.sh` | GitHub Actions 引用完整性（uses 钉 hash） |
| `check-template-drift.sh` | 模板漂移总闸 |
| `check-tool-health.sh` | 工具脚本健康检查（阶段九执行体） |
| `test-count.sh` | 汇总 workspace 各包测试数（SSOT 反查，门禁用） |
| `sync-test-count.sh` | 测试数四文件一键同步（非门禁，修复工具） |

### 发版与 SOP 面（8）

| 脚本 | 管什么 |
|---|---|
| `check-release-closeout.sh` | 发版收口门禁（tag/终态断言） |
| `check-sop-integrity.mjs` | 发版 SOP 阶段文件完整性（A0 互校，`sop-integrity-baseline.json`） |
| `check-prepush-checklist.mjs` | pre-push 检查项清单对账 |
| `check-gate-inventory.sh` | 门禁清单覆盖对账守卫（meta：门禁清单自身） |
| `check-guard-fail-loud.sh` | 防线失明自检门禁（故障注入实测） |
| `check-guards.sh` | 守卫的守卫（meta-guard） |
| `check-npm-claims.mjs` | registry 实测声称对账（`npm-claims-exempt.json`） |
| `check-fresh-eyes-artifacts.mjs` | fresh-eyes 产物契约守闸 |

### 规划与边界面（7）

| 脚本 | 管什么 |
|---|---|
| `check-interface-roadmap.mjs` | 接口编号承载对账门禁 |
| `check-forms.mjs` | 「形态归属」标注一致性（changelog ↔ ROADMAP） |
| `check-open-boundary.sh` | 开源/商业边界守卫 |
| `check-spec-first.mjs` | 规范先行硬禁令门禁（只提示不阻断） |
| `check-forge-branches.sh` | FORGE 分支收编标记对账 |
| `check-claims.mjs`（同上） | — |
| `resolve-section.sh` | 行号 → markdown 段落归属解析器（非门禁，共享工具） |

## 台账与基线（非脚本）

`archaeology-exempt.json` · `claims-sdk-ledger.json` · `cross-package-relative-exempt.json` · `dependency-direction.yml` · `doc-char-ratchet.json` · `doc-ratchet.json` · `doc-score-baseline.json` · `knowledge-legacy-path-exempt.json` · `literals.json` · `npm-claims-exempt.json` · `prompt-fork-baseline.json` · `public-api-baseline.json` · `silent-catch-baseline.json` · `silent-catch-io-ledger.json` · `silent-catch-prefilter-exempt.json` · `sop-integrity-baseline.json` · `source-block-exempt.txt` · `table-shape-baseline.json` · `vitest-setup.mjs`（测试共享设置）· `lib/`（共享 bash/node 库）

> ⚠️ 计数口径：53 = 门禁脚本 51 + 共享工具 2（`resolve-section.sh` / `sync-test-count.sh` 归入表内登记）。新增门禁时同步本表与 `check-gate-inventory.sh` 台账。
