# tools/ — 维护者工具脚本（发版 SOP + 仓库健康）

> **边界说明（v1.4.6 对齐 engine/scripts/README）**：`engine/scripts/` 是 install.sh 组装调用的**用户安装链**（task-record / cleanup / audit / lib/config 等随 `deploy_scripts()` 到达用户目标目录的 `scripts/` 下，install / verify / daemon 同理）；`tools/` 面向维护者发版 SOP 与仓库健康检查，不随安装分发。
>
> **目录结构（v1.3.9 物理分目录 · v1.5.2 收口 · v1.5.2 补 report/ · v1.5.2 补 verify/）**：按职能分子目录——check/ 门禁与测试统计、gen/ 草稿生成、report/ 报告生成、dashboard/ 仪表盘、release/ 发布与签名（v1.4.0 起含 `pre-push-check.sh` 四门禁聚合入口）、forge/ FORGE 运维、audit/ FDE 进场审计（脚本 + 问卷数据源同目录）、hooks/ 共享 hook 脚本（v1.4.0 交付五）、train/ 训练环境与设备打包（v1.4.4 归位）、
>verify/ 独立验签器（第三方举证面，v1.5.2 章二）。**根目录无任何脚本与数据文件**（含 .mjs——vitest-setup 归 check/，训练脚本归 train/）。

## 根目录

无脚本、无数据文件。新增脚本一律按职能进子目录（见文末防屎山规则三）。

## 一、check/ — 门禁与检查

| 脚本 | 用途 | 何时使用 |
|------|------|---------|
| `check/check-version.sh` | 版本号一致性检查（14 段：TS 常量/文档头/包版本/规则数等） | 发布前 / CI |
| `check/check-docs.sh` | 文档预算与结构检查（A/B/C/D/E 层行数警戒线） | 发版 SOP / CI |
| `check/check-test-count.sh` | 测试数对账（README/文档声称 vs 实测，双口径；漂移输出逐处 `file:line` + 旧→新 + 一条可粘贴执行的修复命令；`--fix` 显式回填并自动复验） | 发版 SOP / CI |
| `check/test-count.sh` | workspace 测试数汇总（SSOT 反查 · 门禁用） | 发版 SOP / 常态 |
| `check/sync-test-count.sh` | 测试数联动写入（实测值回写文档声称位） | 发版 SOP 数字收口 |
| `check/check-review-system.sh` | 审查体系一致性（维度数/警戒线/S 编号闭环对账） | 发版 SOP 阶段四 |
| `check/check-tool-health.sh` | 工具脚本健康（路径活性/孤儿配置/set -u 守卫/README 收录对账——递归扫 tools/ 全部 .sh 含子目录；**README 未收录自 v1.4.8 起阻断**） | CI / 发版 SOP 阶段九 |
| `check/check-unwired-exports.sh` | @public 导出接线深扫（S2 四断言：深扫接线/白名单/类型标注/eval 隔离） | 发版 SOP 阶段三/六 |
| `check/check-wiring-guard.mjs` | 接线守卫（注册表级：注册漂移——分发面孤儿/旁挂清单越界引用；死路径——注册项无分发落点。**首版非阻断**，只提示不阻断；`--selftest` 合成回归验证必命中） | CI（非阻断）/ 发版 SOP / 定期（观察期） |
| `check/check-seam-contract.mjs` | 插件适配层 seam 契约门禁（正向：插件 seam ∈ `engine/dsh-plugins/SEAMS. (→n1) | CI / 新增或改插件后 |
| `check/check-seam-drift.mjs` | 宿主 seam 词表漂移巡检（登记本 vs 宿主实测差集：宿主有词表未登 / 词表登宿主已废 等三面判定；`SEAMS.md` 只保证 sofagent 侧四载体自洽，本巡检防「宿主破坏性升级后词表静默过期」——**只提示不阻断**，`--strict` 供 CI 收紧） | 宿主升级后 / 定期（默认非阻断） |
| `check/check-template-drift.sh` | 模板漂移检测（三断言：模板与实现同步对账） | 发版 SOP 阶段六 |
| `../engine/audit/src/rulesets/*.json`（跨模块指针，**非 tools/ 内文件**） | 行业 overlay 规则包（ai / fintech / government / medical 四件；overlay 按 `context.md` 的 `industry:` 字段加载，机制见 `FDE/GUIDE.md` §5.9） | FDE 进场标注行业时（v1.4.8 第2批修正：此前登记的是仓内不存在的 `tools/check/` 下伪路径，真实文件在 engine/ 侧） |
| `check/dependency-direction.sh` | 依赖方向架构测试（build 序列 13 包边界：核心层←约束层←适配层←展示层；读同目录 `dependency-direction.yml` SSOT——含 `rhythm` 版本节奏段） | CI / 改包依赖后 |
| `check/check-silent-catch.mjs` | 静默吞错扫描（关键路径空 catch 只拦新增，存量见 `silent-catch-baseline.json` 基线） | CI / 改错误处理时 |
| `check/check-paired-records.mjs` | 判决类记录成对门禁（N 态判据：声明 N 态即须落 N 态。 (→n2) | pre-push 第 3j 步 / 新增判决类 kind 后 |
| `check/check-fresh-eyes-artifacts.mjs` | fresh-eyes-loop 产物契约守闸（harness 注入形态的机械停止条件等价面：校验 runDir 产物存在性 + schema + 计数一致性；`--self-test` 自检） | harness 执行形态跑完轮后（会话内人工/主任务协议步骤） |
| `check/check-home-resolution-parity.mjs` | 家目录解析口径对照共享守卫（harness 因 layer 0 · `allow: []` **不能** import core，只能本地重实现 `resolveEngineHome()`——本守卫断言两侧**同输入同输出**；core 侧真实 `require` dist 调用、harness 侧 (→n3) | 改 harness 或 core 的家目录解析后 · pre-push |
| `check/silent-catch-baseline.json` | 静默吞错存量基线（`check-silent-catch.mjs` 消费，新增即红） | 被 check-silent-catch.mjs 消费 |
| `check/check-archaeology.sh` | 规则文档禁考古守卫（`releasing.md` + `releasing/*.md` + `SKILL/**` + `playbook/**` 正文禁带出身： (→n4) | pre-push / 改规则文档后 |
| `check/archaeology-exempt.json` | 禁考古豁免台账（`check-archaeology.sh` 消费：① `exemptPaths` 第三方 vendored 原文 + 历史档案目录——档案是出身该待的地方；② `exemptAnchors` 行级豁免 `{file, anchor, reason}`——**锚串而非行号**（行号漂移即静默失效），锚须文件内唯一且当前仍是命中行，两条硬校验不成立即 exit 2） | 被 check-archaeology.sh 消费 |
| `check/check-readme-parity.sh` | 双语 README 结构 parity 门禁（中英 README 章节/条目对齐，防单语漂移） | CI / 改 README 后 |
| `check/check-dashboard.sh` | dashboard.html 结构性缺陷门禁（七项静默失效面：双 class 属性/未定义 CSS 变量/重复类定义不一致/未定义 keyframes/onclick 未定义函数/div 配平/U+FFFD 乱码——注入实测七项全报红） | CI / 改 dashboard.html 后 / 发版 SOP 阶段五 |
| `dashboard/sofagent-dashboard.test.sh` | Dashboard 端到端冒烟（页面可达 + 数据面断言） | dashboard 改动后 |
| `check/check-guards.sh` | 守卫的守卫（meta-guard：门禁脚本自身四类腐烂模式静态扫 + `--inject` 注入实测——红不了的门禁是装饰品） | 发版 SOP / CI |
| `check/check-anchors.mjs` | 跨文档 Markdown 锚点引用活性校验（见 check-docs.sh 第 11 段） | 发版 SOP / CI |
| `check/check-forms.mjs` | 「形态归属」标注一致性守卫（changelog 章标注 ↔ ROADMAP 声明计数**双向对账**：每章须挂 `> **形态归属**：` 行 · 形态词封闭枚举 · 声明计数逐版 pin · 成分按结构判据提取；退出码 0 绿 / 1 违规 / 2 失明） | pre-push 第 3h 步 / 发版 SOP / 新增或改 changelog 章后 |
| `check/check-cjk-var.sh` | shell 变量定界守卫（`$VAR` + CJK 全角标点误吞检测） | 改 shell 脚本后 / CI |
| `check/check-guard-fail-loud.sh` | 防线失明自检门禁（PATH 劫持假检测引擎实测守卫 fail-loud——引擎故障下仍 exit 0 的守卫即失明不自知） | 发版 SOP / CI |
| `check/check-shell-injection.sh` | 命令注入静态扫（engine 源码面：execSync 模板插值/字符串拼接注入形态——v1.4.3 安全修复批防线） | CI |
| `check/check-action-pins.sh` | GitHub Actions SHA pin 对账（uses: 完整 commit SHA 与行内注释 tag 指向一致性，离线降级 exit 0） | CI / 发版前 / 定期 |
| `check/check-storefront.sh` | 仓外门面对账（GitHub description/homepage/topics 数字 vs 仓内实数；离线 SKIP 可见不假绿） | CI（离线 SKIP 不阻断）/ 发版 SOP 阶段八/九 |
| `check/check-npm-claims.mjs` | registry 实测声称对账（活文档面 `npm view <pkg> dist-tags` 与「dist-tags 当前为 …」两种形态的值声称 vs `npm view --prefer-online` 在线真值——无 `npm view` 时回退行内被引用包名，有值无包名判盲区；≥3 轮重试 (→n5) | CI（pre-push 步骤 3i · 离线 SKIP 不阻断）/ 改 README/docs 后 |
| `check/npm-claims-exempt.json` | npm 实测声称豁免台账（`check-npm-claims.mjs` 消费：行级 `{file, anchor, reason}` 锚串豁免——锚须文件内唯一、当前仍是命中行、理由栏须实质，三条硬校验任一不成立即 exit 2；**当前为空 = 无豁免债的正常态**） | 被 check-npm-claims.mjs 消费 |
| `check/check-shellcheck.sh` | 全仓 shellcheck（**CI 同口径**：按 shell shebang 扫全仓含无扩展名 hook；`-s bash -S warning -e SC2034/SC1090/SC1091`）——补 CI 与本地扫描面口径差 |
| `check/check-forge-branches.sh` | 分支收编标记对账（tag `forge-merged-*` / 分支名 `-merged-YYYYMMDD` 双形态判定；未标记分支 INFO 四要素列出供人工确认，输出字符级截断防 U+FFFD） | 发版 SOP / 定期 |
| `check/check-literals.sh` | 手填字面量对账（`check/literals.json` 注册表驱动——同一事实被手抄两份时比对「手填值 vs 实算真值」；数据驱动，新增字面量只登记一行，非「保密字面量扫描」） | CI |
| `check/check-open-boundary.sh` | 开源边界守卫（商业名/内部路径/未脱敏标识不得进入开源仓库——脱敏三层纪律的结构防线） | CI |
| `check/check-spec-first.mjs` | 规范先行硬禁令门禁（engine/*/src 提交须含 `spec:` 关联或 `no-spec:` 豁免——观察期 WARN 不阻断，exit 恒 0） | CI（观察期）/ 发版 SOP / 定期 |
| `check/check-deps.sh` | 关键依赖版本检查（npm 包版本对齐） | 发版前 / 定期 |
| `check/check-dev-prompt.sh` | 开发日志/Dev Prompt 代码引用一致性校验（路径 / 函数定义 / 目录 / 快照行数 / **符号归属**——「某文件的某符号」断言该符号确定义于该文件；含「待新建·待归档·迁移目标」与「已退场」两类本就应当不存在的归类） | 发版 SOP |
| `check/public-api.mjs` | public API 变更检测门禁（@public 符号集 vs 基线，未 bump 即 FAIL；v1.3.9 四） | CI / 发版前 |
| `check/public-api-baseline.json` | @public 符号集基线（12 包 + 版本快照；`--update-baseline` 发版时重建） | 被 public-api.mjs 消费 |
| `check/resolve-section.sh` | 行号→markdown 段落归属解析器（防「行号冒充归属」——排障工具，非门禁） | 审查报告取证时 |
| `check/vitest-setup.mjs` | 全局测试隔离（预置 SOFAGENT_DATA 到 tmp，防测试污染真实 HOME——被 5 个 engine/*/vitest.config.ts setupFiles 引用） | vitest 自动挂载 |
| `check/check-cross-package-relative.mjs` | 越包相对引用守卫（相对 import/require 解析后越出**包根**即 FAIL；现存 6 条豁免 = 6 处清单 SSOT 对账测试读 `plugins.json`，登记在 `cross-package-relative-exempt.json`。 (→n6) | CI（pre-push 步骤 2e）/ 改 dsh-plugins 后 / `--selftest` |
| `check/cross-package-relative-exempt.json` | 越包相对引用存量豁免台账（被 `check-cross-package-relative.mjs` 消费；集合相等判定——新增/漂移/陈旧均红） | 被 check-cross-package-relative.mjs 消费 |
| `check/check-legacy-knowledge-path.mjs` | 知识库旧路径残留守卫（v1.2.1 前的旧知识库落点写法，**连写 + 分离**双形态；扫描面 = git tracked 文件；非注释面对账 `knowledge-legacy-path-exempt.json`，注释面可见不阻塞，历史冻结区豁免，本守卫自身两个文件的引用归「装置面」逐次可见打印；退出码 0 绿 / 1 违规 / 2 检查器失明） | CI（check-docs §18）/ 改 knowledge 路径解析后 / `--selftest` |
| `check/knowledge-legacy-path-exempt.json` | 知识库旧路径存量豁免台账（被 `check-legacy-knowledge-path.mjs` 消费；逐文件逐计数相等判定） | 被 check-legacy-knowledge-path.mjs 消费 |
| `check/doc-discipline.sh` | 对外文档写作纪律门禁（v1.4.9 P2-27）：依据 `CONTRIBUTING.md`「文档措辞 / 禁考古 / 来源块溯源 / changelog 写作」规范，把**正则可判定**的三面收进 CI —— **Face 1** 内部工单/审查代号（`F-xx`/`P0-xx`/`P1-xx`/` (→n7) | pre-push · 改对外文档后 |
| `check/source-block-exempt.txt` | 来源块溯源存量台账（被 `doc-discipline.sh` Face 3b 消费；逐文件逐类别计数**集合相等**判定——新增 / 漂移 / 陈旧均红。 (→n8) | 被 doc-discipline.sh Face 3b 消费 |
| `check/check-prepush-checklist.mjs` | pre-push 检查项清单对账（v1.4.9 G-16：`pre-push-check.sh` 里 `#   + <脚本名>` 清单声明的脚本名 **⊆ 实际被调用的脚本名**——子集非相等，实现多于清单合法；守「**声明了 X、实现里没有 X**」缺陷类（G-12 / G-11 同族）。 (→n9) | pre-push 第 1b 步 / 改 pre-push 检查项后 / `--selftest` |
| `check/check-mjs-comment-backtick.mjs` | mjs/js 注释可执行反引号守卫：注释行反引号串首 token 形似仓内脚本路径或 npm/node/bash 命令头 = 危险——bash 误跑该文件时会把注释串当命令替换**真执行**（实锤：check-prepush-checklist.mjs 头部注释串曾让 bash 跑完整套 pre-push 防线数分钟）。退出码 0 绿 / 1 有违规（改单引号）/ 2 引擎故障 | check-tool-health 第 ⑨ 项 / 新写 .mjs 注释含反引号路径串后 |
| `check/check-gate-inventory.sh` | 门禁清单覆盖对账（**登记 ≠ 调用**：`tools/check/` 全体守卫 ⊆ 真实调用面——抓「脚本写好、登记在册、零调用点」的**孤儿守卫**，其红态无人知晓）。 (→n10) | pre-push 第 1c 步 / 新增或搬迁 tools/check/ 守卫后 |
| `check/lib/coverage-line.sh` | 门禁覆盖度行统一范式（`[check:coverage] script=… asserts=… covered=… skipped=…`，让「跳过」可见可 grep） | 被 check-docs / check-silent-catch 等 source |
| `check/lib/listed-badges.mjs` | 收录徽章对账辅助：把 README `*-listed-brightgreen` 徽章的「被 Awesome 仓收录」声称变成可执行核查——取目标仓 README **全文 blob** 后 grep 本仓名（不用 `search/code` API，防超大 README 假阴性），输出 OK / MISSING / SKIP。 (→n11) | 被 check-storefront 消费（需 gh 环境） |
| `check/lib/unwired-reachability.mjs` | **生产可达判定内核**（被 `check-unwired-exports.sh --since` 调用 · v1.5.4 收紧批）：把「非测试代码里出现过该符号」升级为**生产可达**——① `import type` / 纯类型注解位不计接线 ② 追链可达（一跳有调用、上一跳无人用 ⇒ 断链）③ (→n12) |
| `check/silent-catch-prefilter-exempt.json` | 静默吞错扫描的文件级前置过滤豁免台账（被 `check-silent-catch.mjs` 消费） | 被 check-silent-catch.mjs 消费 |
| `check/check-table-shape.mjs` | 表格形态门禁（四断言）：① 超列——格数 > 表头列数（GFM 丢弃多余格）；② 孤儿行——含 `\|` 但无「表头 + 分隔线」归属，渲染成裸管道；③ 悬空注标——`（详→注-N）` 无对应 `> 注-N：` 定义；④ 断句格——拆注格切口未落句读符。内建 10 样本自检（含负样本）；存量见 `table-shape-baseline.json` | CI / 改 .md 表格后 / 发版 SOP |
| `check/lib/prompt-fork-lint.mjs` | **任务书零分支 lint**（被 `check-dev-prompt.sh` 调用 · 检查项 5）：禁「方案 A/B」「二选一」「视情况而定」「由你决定」——交给执行方的任务书不得留选择（出题方须先比完并选定一条）。 (→n13) |
| `check/table-shape-baseline.json` | 表格形状**存量台账**（被 `check-table-shape.mjs` 消费；只拦新增。签名 = 行内容归一化后 sha256 前 16 位——**不用行号**：行号随编辑漂移即静默放行；**不存行原文**：表格单元格常含正则/安全词，落原文会触发 A9 注入检测自指） | 被 check-table-shape.mjs 消费（`--update-baseline` 重生成） |
| `check/prompt-fork-baseline.json` | 任务书零分支 lint 的**豁免台账**（被 `prompt-fork-lint.mjs` 消费；签名 = 行内容归一化后 sha256 前 16 位——**不用行号**（行号漂移即静默放行，同 table-shape-baseline 理据）；每条须带理由，变更进 review）。 |
| `check/claims-sdk-ledger.json` | check-claims A 组「新增件零消费阻断」的豁免台账（SDK 面登记：刻意保留的新增件逐条带理由；签名 = 文件路径；变更进 review）。 |
| `check/doc-ratchet.json` | 核心文档**可读性棘轮台账**（被 `doc-discipline.sh` Face 5 消费：墙式行/墙式格实测值**只许降不许升**——治「内容只进不出」；键 = 逐文档实测计数，`_meta` 记口径，与 `lib/readability-count.mjs` 注释同源）。 |
| `check/lib/readability-count.mjs` | **可读性计数器（单一口径）**（被 doc-discipline Face 5 / reflow-walls 共用：墙式行/墙式格的定义与计数实现；改口径先改本文件头注释再同步 `doc-ratchet.json` `_meta`）。 |
| `check/lib/reflow-walls.mjs` | **墙式行折行器**（一次性治理工具，非门禁：把超长段落/表格格折行，产出供 doc-ratchet 重新基线；治理批 261→17 的执行器）。 |
| `check/lib/split-table-cells.mjs` | **超长表格格拆注工具**（一次性治理工具，非门禁：把超长表格内的墙式格拆成表格下方注行，产出供 doc-ratchet 重新基线）。产出契约受 `check-table-shape.mjs` ③④ 两条断言机械对账——标记形态 `（详→注-N）`、同文件必有 `> 注-N：` 定义、**切口必落句读符**（找不到切口就整格不拆，留长格交棘轮报人裁定，不硬切） | 拆注治理时 |
| `check/check-claims.mjs` | **声称↔实测三组断言**：**A** 整文件零生产消费者（存量件信息位不阻断、**新增件（上一 tag 后有改动或本轮暂存）零消费 ⇒ 阻断**（豁免台账 `check/claims-sdk-ledger.json`；治纸面接线第 4 逃逸路径）——生产面 = `engine` + `tools`（`playbook/` **剔出* (→n14) | CI / 改 SECURITY 测绘数字或 hook 时 |

> n1: md` 词汇表；DSH 三处 seam 逐条一致 + description 不滞后；反向：词汇表每条在**真实宿主**里 grep 到定义处，宿主缺席打印 `SKIP` 不静默通过；双向对账拦「漏写 seam」；`SKILL.md` 反向对账——SKILL.md 出现 `（seam: …）` 字面量的每一处都必须与三处一致，**残余缺口：SKILL.md 整体删去 seam 字样时不判红，只打印显著提示**；`--selftest` 合成回归验证必报红）

## 二、gen/ — 草稿生成

| 脚本 | 用途 | 何时使用 |
|------|------|---------|
| `gen/gen-abc-draft.mjs` | 阶段四 A/B/C 三类清单草稿（单次 LLM） | 发版 SOP 阶段四 |
| `gen/gen-fresh-eyes-draft.mjs` | fresh-eyes 16 视角审查草稿（单次 LLM） | fresh-eyes-loop |
| `gen/gen-acceptance-shard-prompts.mjs` | 验收测试 12 分片 prompt 生成 | 发版 SOP |
| `gen/gen-perspective-prompts.mjs` | 24 视角 prompt 生成 | fresh-eyes-loop |
| `gen/gen-weekly-report.mjs` | 周报生成 | 定期 |
| `gen/gen-draft-lib.mjs` | **公共库**（LLM 配置/调用/降级/参数解析/版本提取，供 gen-* 复用） | 被 import |
| `gen/gen-api-tools.mjs` | docs/API.md 第二节生成器（从 tool-registry.ts 提取全量 tool 按域分组重写，check-docs 断言「文档数 == registry 实数」） | 新增/变更 MCP tool 后 |
| `gen/gen-plugin-manifests.mjs` | 插件 manifest 生成器（从 `engine/dsh-plugins/plugins.json` 单一手写源生成 20 个生成物——`cordis.patch.yml` + package.json 的 sofagent/dsh 段；`--check` 逐字节对账，check-template-drift 断言五/六守护） | 新增/变更 DSH 插件或 seam 后 |

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
| `release/bump-version.sh` | 版本号 bump（SSOT 联动 253+ 处） | 发版 SOP 阶段九 |
| `release/pre-push-check.sh` | 推送前完整检查（CI 等价聚合 22+ 检查位：shellcheck / check-prepush-checklist / check-gate-inventory / check-version / check-unwired-exports / check-template-drift / c (→n15) | git push 前 |
| `release/heavy-gate-receipt.sh` | 长跑门禁「一次跑、多环节复用」凭据（`acceptance-test.sh` 单跑 9~15 分钟，而阶段三/四/五会反复跑同一内容 ⇒ 最高 5 倍耗时且零新信息）。 (→n16) | 发版 SOP 阶段五脚本层 |
| `release/publish-packages.sh` | npm 分批发布（依赖拓扑序）：`@sofagent/*` scope 包（含 `dsh-plugin-kit`——目录由根 `package. (→n17) | 发版 SOP 阶段九 |
| `release/sign-config.mjs` | config.yml HMAC-SHA256 签名颁发（读 `~/.sofagent-key`，DP-2） | 安装后 |
| `release/gitdata-push.mjs` | Git Data API 推送备选通道（blobs→trees→commits→refs，https 断连绕行） | push 502 时 |

> n15: heck-open-boundary / check-cross-package-relative / check-docs / check-literals / check-anchors / check-review-system / check-silent-catch / dependency-direction / check-tool-health（v1.4.
> n15: 9 G-12 接入） / doc-discipline / check-forms / build / test-count / check-test-count / forge-smoke / check-cjk-var / check-guard-fail-loud / check-home-resolution-parity + CLI `--help` 矩阵 / install.sh 路径 / tag 校验 / 依赖图 / CHANGELOG 元信息等；`--quick` 跳过 test/build，`--minimal` 结构性快检；v1.4.0 由根目录移入）

## 五、forge/ — FORGE 运维

| 脚本 | 用途 | 何时使用 |
|------|------|---------|
| `forge/forge-pm2-start.sh` | PM2 守护 FORGE driver（fresh-eyes / release-gate） | FORGE 长循环 |
| `forge/forge-smoke-test.sh` | FORGE 冒烟测试 | FORGE 改动后 |
| `forge/forge-runs-stats.mjs` | FORGE 质量循环离线统计（纯只读：视角生产力/复发热点/运行健康度三报告） | 定期复盘 |

## 六、audit/ — FDE 进场审计

| 内容 | 说明 | 备注 |
|------|------|------|
| `audit/client-audit.mjs` | FDE 进场审计问卷脚本（按行业输出 Markdown），问卷数据源同目录 |
| `audit/audit-questionnaires/*.json` | 7 个行业审计问卷（finance/generic/government/healthcare/manufacturing/retail/supplychain），每行业 15-20 题，三段式（审计现状/痛点定位/合规要求），`client-audit.mjs` 数据源 |
| `audit-baseline-sync.sh` | dist 聚合哈希基线同步（rebuild 后重置 `~/.sofagent/internal/audit-dist-hash.txt` 基线——不跑则 P1-A2 影子审计器拦 commit） | 发版 SOP 阶段七 |
| `audit-dist-hash.mjs` | dist 多入口聚合哈希计算（排序逐文件哈希再聚合——P1-A2 判定的数据源） | 随 baseline-sync 调用 |

> 📌 源码指纹脚本 `audit-src-fingerprint.mjs` **已迁出 tools/**：它必须随包分发（hook 只能从
> 可信源执行，禁执行被审仓 `tools/` 下的同名脚本——v1.5.4 #28），现位于
> `engine/audit/hooks/audit-src-fingerprint.mjs`（`hooks/` 随 npm 包分发，安装时落地副本到
> `$SOFAGENT_HOME/internal/`）。

## 七、hooks/ — 共享 hook 脚本

| 内容 | 说明 |
|------|------|
| `hooks/sofagent-precommit.sh` | 跨平台共享 pre-commit hook（stdin 模式——Cursor/Claude Code/Gemini CLI 等平台 commit 审计共用；v1.4.0 交付五） |

## 八、train/ — 训练环境与设备打包

| 脚本 | 用途 | 何时使用 |
|------|------|---------|
| `train/train-env-init.sh` | 训练环境一键安装（venv + 框架 + CUDA 校验；Mac 降级 npm --prefix 装 @mlx-node/trl；与 env-manager.ts 同一套判定——脚本形态是「无 Node 也能装」） | 装训练环境时 |
| `train/package-train-runtime.sh` | 训练运行时打包（orchestrator+core dist + 模板 + 环境脚本 + 可选基座缓存 → tar.gz + setup.sh，U 盘/离线交付形态） | 设备交付时 |
| `train/examples/hosted-channel.example.mjs` | TrainChannel 托管 API 参考适配示例（教学形态非引擎依赖——虚构 API 四动作演示状态机归一，内置 fake 轮询零真实网络；真实适配按 `docs/guides/train-channel-spec.md` 规范实现） | 对接自有托管微调云时 |

## 九、report/ — 报告生成

| 脚本 | 用途 | 何时使用 |
|------|------|---------|
| `report/evolution-report.mjs` | 进化实证报告生成（Dream Cycle 持续采样 → skill-impact 台账汇总） | 进化模块周报 / 发版证据 |

## 十、verify/ — 独立验签器（第三方举证面 · v1.5.2 章二）

| 脚本 | 用途 | 何时使用 |
|------|------|---------|
| `verify/verify-chain.mjs` | 独立 HMAC 验签器（单文件零依赖，裸 `node` 可跑）——同时校验 `history.jsonl` 历史链 + `decision-log.jsonl` 决策链；三态输出（链完整 / 某条断裂·给条目号与期望值 / 链头不匹配）+ 降级态（不可复验 / 不足）；`--selftest` 内置 golden vector 硬锚与篡改注入合成回归。 (→n18) | 第三方举证 / 合规审计 / `--verify-chain` 机内校验的独立对照 |
| `verify/README.md` | 验签器说明（输入格式 / 三态输出 / 第三方举证用法 / 环境指纹换机要点） | 随验签器查阅 |

> n18: 第三方（审计师 / 监管 / 法院技术顾问）无需安装 sofagent 即可举证

> 与 `check/` 侧重不同：`check/` 是**仓库健康门禁**（维护者自用）；`verify/` 是**对外举证工具**（第三方独立复算，可信根是密码学而非信任维护方）。验签器**不接 pre-push**——它是给外部用的只读工具，不是本仓 CI 门禁（`--selftest` 供人工 / 按需触发）。

## 十一、不接 CI 的工具（人工 / 按需触发 · v1.5.2 第2批登记）

以下脚本**刻意不接 CI**——接了会永久红或本身不是门禁。此处登记用途与「不接线」理由，防「不登记的新脚本过几版就没人知道为什么存在」（对齐 `docs/changelog/releasing/07-tool-health.md` 的登记纪律）。

| 脚本 | 用途 | 不接 CI 的理由 |
|------|------|---------------|
| `check/check-deps.sh` | 关键依赖版本检查（含 DSH / LangGraph / automerge 等） | **exit 1 = 有依赖落后于上游最新版**，而「是否升级」是人工决策（SOP 步骤 5 决策规则）——接线即永久红。需要人做决策的工具不进 CI |
| `check/check-dev-prompt.sh` | 开发日志/Dev Prompt 代码引用一致性校验（引用路径/函数是否真实存在；历史档案漂移单列 🕘 不计失败） | **参数化按需工具**：必须传 `<file.md>`，可加 `--strict` 强制历史档案按严格口径判；无参数时报用法错并 exit 1——CI 无处传参。生成 prompt 后手动跑 |
| `check/sync-test-count.sh` | 测试数多文档一键同步（实测值回写各文档声称位） | **写文档的收口工具**，不是检查器——发版 SOP 数字收口阶段人工触发 |
| `check/resolve-section.sh` | 行号 → markdown 段落归属解析器（防「行号冒充归属」） | **排障工具非门禁**：自动化版在扫描面为 0 时会静默通过（死分支形态），故刻意不接 check-guards/CI。挂载于 `docs/changelog/releasing/03-quality-loop.md` / `04-review-system.md` |
| `check/check-forge-branches.sh` | FORGE 分支收编标记对账（未标记的 `forge/*` 分支四要素列出） | 输出为 **INFO 级**（未标记分支需人工确认后补标记），由 `playbook/acceptance-test.sh` 人工链调用 |
| `check/check-interface-roadmap.mjs` | 接口编号承载对账（G1-G14 接口编号 ↔ ROADMAP/开发日志的真实承载版本；C1-C5 FAIL + C6 WARN，防「编号标了版本、版本却没承载它」） | **需 `--spec <商业机制文档>` 参数**：无参数时打印 SKIP 并 exit 0（SKIP 不算通过）。spec 属商业侧文档、不进开源仓——CI 无处传参，只在商业侧对账时人工跑 |
| `maintenance/prune-spill.mjs` | spill 临时文件 TTL 回收（>5MB diff 落盘的密钥类内容按保留期清理） | 独立工具（cron/手动） |

---

## 防屎山规则（新增脚本前必读）

1. **新增前置 grep**：新增检查项/生成器/脚本前，先 `grep -rn <功能关键词> tools/ engine/scripts/` 确认无同类实现；有则增量扩展，不新建；
2. **同类即抽**：同类文件 ≥3 个时必须抽公共库（现状：gen-* 系列 6 个 → `gen/gen-draft-lib.mjs` 已抽）；
3. **归类落位**：新脚本按职能进对应子目录（check/gen/dashboard/release/forge/audit/hooks/train），不留根——根目录不放置任何脚本与数据文件（`check-tool-health.sh` 收录对账守卫）。
