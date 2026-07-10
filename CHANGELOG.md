# Changelog

每个版本的详细开发日志在 [docs/changelog/](./docs/changelog/) 下。本文件是目录索引——一句话知道改了什么，点链接看完整故事。

---

## [v1.0.0] — 正式版：Agent 审计工具 🎉

> 2026-07-10（UTC）

从技术预览到可生产使用。18 件事全部完成：铁律措辞强化 + 上线前验收测试 + daemon 文档校准 + FDE 隐性代价 + 准入条件推进 + 工具链加固 + 审计可视化升级 + 违规修复建议 + 安装仪式感 + 无声失败保护 + 首次提交噪音消除 + --init 一键初始化 + --doctor 健康诊断 + 审查 prompt 106 维度升级 + README 定位 + 升级迁移指引。408 测试全绿，3 名外部用户验证通过。

> 📖 [开发日志](./docs/changelog/v1.0.md)

---

## [v0.99.9] — 审查修复 + AI 知识库概念 + verify.ts 拆分 + 行业笔记 + 理论基础 🔧

> 2026-07-07（UTC）

v0.99.8 经双审查（GLM-5.2 67 维度 + DeepSeek V4 Pro 48 维度）发现 4 个 P0 + 7 个 P1 + 3 个 P2，本版全部修复。同时完成 AI 知识库 6 文档概念先行（架构定位+边界划分）+ verify.ts 1257 行代码拆分（→ 4 模块）+ 7 项行业笔记写入 ROADMAP/ARCHITECTURE + Skill 摘要信息架构优化（去掉步骤性描述，只留触发条件）+ Hugging Face/AutoResearch/Akshay 理论基础引证（ARCHITECTURE 新增「理论基础与外部验证」节）。**v0.99.x 修复线最终版。**

> 📖 [开发日志](./docs/changelog/v0.99.9.md)

---

## [v0.99.8] — 审查修复收尾版 ✅

> 2026-07-05（UTC）

v0.99.7 发版后双审查（GLM-5.2 48 维度 + DeepSeek V4 Pro 48 维度）发现 20 项遗留问题，本版全部修复。核心：文档数字全面对齐（30/30→33/33，41/41→48）+ GitHub Actions 升级 v5 + PR check workflow 新建 + shellcheck SC2086/SC2155 排除项收窄 + check-version 新增 --strict 模式 + v1.0 准入诚实化（3/10 ✅→2/10 ✅）+ **FDE 架构重构**（四层→三层实体、删 workflow/agents、templates 镜像产出结构、Skill 精简 925→742 行）+ FDE 非开发者快速入门。**v0.99.x 修复线收尾版。**

> 📖 [开发日志](./docs/changelog/v0.99.8.md)

---

## [v0.99.7] — 发布基础设施修复版 ✅

> 2026-07-04（UTC）· 北京时间 07-05

v0.99.6 三轮独立审查（GLM-5.2 + DeepSeek × 2）共发现 13 项问题，本版修复其中 11 项（另外 2 项已在 v0.99.6 修复）。核心：CI E403 根治（加版本存在性检查）+ OIDC 文档谎言清零（12+ 处改 NPM_TOKEN）+ mcp 依赖解锁（精确改范围）+ 回滚文档补全 + shellcheck SC2034 清零 + Windows 实验性标注 + logo 压缩 84%。**首次采用「npm 先行」发布策略。**

**npm 发布状态**：@sofagent/audit ✅ 0.99.7 · @sofagent/mcp ✅ 0.99.7（npm 先行手动发布，CI 自动 skip）

- P0-1：release.yml 加版本存在性检查（`npm view` 检查已发布则跳过），删除 `id-token: write` 死代码
- P0-2：OIDC 文档谎言清零——12+ 处 OIDC/Trusted Publishing 统一改为 NPM_TOKEN
- P0-3：releasing.md 新增「回滚与降级」章节（npm deprecate + dist-tag + git revert + ClawHub 四通道）
- P1-1：mcp 依赖从精确 `"0.99.6"` 改为范围 `"^0.99.6"`
- P1-2：package-lock.json 同步（npm install --package-lock-only）
- P1-3：releasing.md 悬空引用修复（「见下方步骤 f」→「见 npm 双包验证步骤」）
- P1-4：Tag 卫生——v0.7.0/v0.7.1 改名为 v0.70.0/v0.70.1（semver 一致）
- P2-1：Windows 实验性诚实标注（README + LIMITATIONS，含 .sh vs .ps1 行数对比）
- P2-2：shellcheck SC2034 全部清除（7 个脚本，CI 等价扫描 0 警告）
- P2-3：logo 压缩 84%（334KB → 52KB，400×400px 保留 alpha）
- P2-4：orchestrate-compare.ts 注释修正（回退→并集 OR）

> 📖 [开发日志](./docs/changelog/v0.99.7.md)

## [v0.99.6] — 审查修复版 ✅

> 2026-07-04

v0.99.5 发版后双审（齐活林 + GLM-5.2）发现 25 项问题（P0×4 + P1×7 + P2×11 + P3×3），本版全部修复。核心：@sofagent/mcp npm 同步发布 + README 创建 + .npmignore/files 双重保险 + 全仓文档一致性修正 + 新增 mcp 单元测试 13 tests + bump-version 工具增强。

**npm 发布状态**：@sofagent/audit ✅ 已发布 0.99.6 · @sofagent/mcp ✅ 已同步发布 0.99.6（手动发布，CI 加版本存在性检查后续版本自动跳过）

- P0-1：release.yml 去掉 mcp 对 audit 的 `needs` 依赖——两个包独立发布
- P0-2：创建 @sofagent/mcp README.md（之前 npm 页面无 README）
- P0-3：mcp package.json files 字段排除模式 + .npmignore 对齐 audit（双重保险）
- P0-4：evidence 目录残留「零运行时依赖」→「最小运行时依赖（仅 js-yaml）」
- P1-1：audit README bin 表格修正（不写死数字 + 移除跨包命令 + 标注别名）
- P1-2：changelog v0.99.5.md mcp 文件数修正为准确描述
- P1-3：Case 018 蔓嘉电商时间线统一为「~3 周（截至 2026-07-04）」
- P1-4：SOFAGENT_VERSION_SOP.md 拷入 docs/ 目录（之前只在 workspace 外层）
- P1-5：release.yml mcp job 加 `npm run check`（类型检查）
- P1-6：CHANGELOG v0.99.6 索引条目 + npm 发布状态标注
- P1-7：bump-version.sh 分母统一为 13 步 + hero badge 注释说明
- P2×11 + P3×3：详见开发日志（FDE case 脱敏/evidence 注释优化/shellcheck CI/mcp 单元测试 13 tests/verify.ts daemon 输出/emoji 替换 等）

> 📖 [开发日志](./docs/changelog/v0.99.6.md)

## [v0.99.5] — CI 自动化 + 审查修复版 ✅

> 2026-07-03 初版 / 2026-07-04 修复

NPM_TOKEN 自动发布 + 文案对齐（07-03）。审查驱动修复：P0×6（badge版本号、ROADMAP节标题、mcp版本、.js.map、零依赖假话、env-check残留）+ P1×10 + bump-version/check-version 增强，全仓版本号/日期一致性清零（07-04）。

> ⚠️ **发版后审查**：发现 25 项新问题（P0×4 + P1×7 + P2×11 + P3×3），已在 [v0.99.6](#v0996---审查修复版-) 全部修复。
>
> 📖 [开发日志](./docs/changelog/v0.99.5.md)

## [v0.99.4] — 审查修复版 ✅

> 2026-07-02

41 项全面修复（P0×7 + P1×15 + P2×19），基于双模型独立审查。准入条件从 6✅ 诚实化为 3✅，全仓 doc-vs-reality 清零。

> 📖 [开发日志](./docs/changelog/v0.99.4.md)

## [v0.99.3] — 文档校准版 ✅

> 2026-06-29

16 项一致性清零（check-version 30/30）。benchmark 幽灵引用修复，bump-version.sh Unicode bug 修复。v1.0 前的一轮文档收尾。

> 📖 [开发日志](./docs/changelog/v0.99.3.md)

## [v0.99.2] — 质量加固版 ✅

> 2026-07-01

v1.0 前最后一次质量加固。两份独立十维审查驱动修复 18 个问题（3 P0 + 9 P1 + 6 P2）。daemon 歧义根治，死链清零。

> 📖 [开发日志](./docs/changelog/v0.99.2.md)

## [v0.99.1] — 审查跟进版 ✅

> 2026-06-28

OpenClaw 叙事重写（术语统一为「FDE 的工具包」）。手写 YAML→js-yaml，MCP Server 拆分为 @sofagent/mcp 独立包。局限声明修正。

> 📖 [开发日志](./docs/changelog/v0.99.1.md)

## [v0.99] — v1.0 前收尾版 ✅

> 2026-06-26（当时 398 tests，v0.99.1 增至 406）

两份独立深度审查全部修复。Skill 全部 ≤90 行。44 处死链清零。放弃条件正式写入 ROADMAP。bus factor + 模型依赖声明。FDE 工具包（/FDE + sofagent-fde Skill）首次交付。文档预算 ≤5,000。

> 📖 [开发日志](./docs/changelog/v0.99.md)

## [v0.98] — 架构重组版

> 2026-06-24

产品核心从事前约束转向事后审计 + FDE 企业部署。100 次对照实验结论作废。OpenClaw 重定义为必装引擎。v1.0 定位从「Agent 工作验收工具」转向「FDE 工具包」。

> 📖 [开发日志](./docs/changelog/v0.98.md)

## [v0.97] — 证据版本 ✅

> 2026-06-22

审计 A9/A10/A11 + 编排引擎重构 + bash→TS 第二波。约束底座 100 次对照实验因方法缺陷结果作废。

> 📖 [开发日志](./docs/changelog/v0.97.md)

## [v0.96] — 诚实收缩

> 2026-06-20

README 373→166 行六段式重构。AI 中台叙事贯通。bash→TS 第一波（3 个僵尸脚本 + task-orchestrate）。铁律重排 + 审计 A9/A10/A11 草案。

> 📖 [开发日志](./docs/changelog/v0.96.md)

## [v0.95] — 审计体系重构

> 2026-06-18

审计体系重构（4·6·8·4）+ 铁律 10→6。目录改名 sofagent-audit/ → sofagent/audit/。ARCHITECTURE 三源收敛（Ralph Loop + MiroFish + 卡普二分法）。MCP/Agency 推 v1.0。

> 📖 [开发日志](./docs/changelog/v0.95.md)

## [v0.94] — 工程硬伤止血

> 2026-06-16

工程硬伤止血 + 审计独立化（沉默模式 + 7 条纯 diff 规则）+ FDE 部署者优先。双轮评审后重排。

> 📖 [开发日志](./docs/changelog/v0.94.md)

## [v0.93] — 工程迁移

> 2026-06-14

v0.92 审查 17 项中 11 项落地（4 项 FP 修复 + 审计规则扩展）。bash→TS 起步。10 组对照实验：约束底座增量 = f(陷阱难度)。

> 📖 [开发日志](./docs/changelog/v0.93.md)

## [v0.92] — 审查修复

> 2026-06-13

v0.91 审查修复——3 个 P0 安全硬伤 + 6 个 P1 工程欠债 + 5 个 P2 改进。综合评分 5.7/10 → 目标 7.0/10。

> 📖 [开发日志](./docs/changelog/v0.92.md)

## [v0.91] — 评审落地

> 2026-06-12

两份独立评审共识项落地。sofagent-audit MVP 核心实现（4 条规则，bash 实现，v0.92 起逐步 TS 化）。文档瘦身 47%。

> 📖 [开发日志](./docs/changelog/v0.91.md)

## [v0.90] — 安全审查

> 2026-06-10

skill-safety-check（22 条正则 + LLM 双门）。三个 P0 安装断裂修复。7 个 SOP 中间产物清理。

> 📖 [开发日志](./docs/changelog/v0.90.md)

## [v0.86] — 运行时加固

> 2026-06-09

读写型任务分流 + Loop 成熟度四问 + 管道闸门——Agent 拆任务更聪明，不容易跑偏。

> 📖 [开发日志](./docs/changelog/v0.86.md)

## [v0.85] — 定位重构

> 2026-06-08

定位重构（治理层→约束底座）+ ROADMAP 砍削（20+→6 项）——基于 GLM-5.2 + DeepSeek V4 Pro 双评审的战略校准。

> 📖 [开发日志](./docs/changelog/v0.85.md)

## [v0.84] — 证据打磨

> 2026-06-07

A/B benchmark 五组数据 + 4 底线优化 + Hook 归因修正。核心发现：差异化在约束底座不在约束层。

> 📖 [开发日志](./docs/changelog/v0.84.md)

## [v0.83] — 安装修复

> 2026-06-05

安装断裂修复 + 代码加固 + 文档诚实度修正（P0×4 + P1×3 + P2×3）。纯 bugfix。

> 📖 [开发日志](./docs/changelog/v0.83.md)

## [v0.82] — 五平台实测

> 2026-06-03

评审问题修复 + 五平台实测 5/5 + ROADMAP 重构 + License MIT。核心结论：Hook 级治理加固仅在 OpenClaw 生效。

> 📖 [开发日志](./docs/changelog/v0.82.md)

## [v0.81] — daemon 骨架

> 2026-06-01

daemon 核心骨架（纯 bash：launchd/systemd + 文件 hash 监控）+ 5 项治理加固（幂等/步数闸/熔断闸/评判器隔离/怀疑论提示）。

> 📖 [开发日志](./docs/changelog/v0.81.md)

## v0.47–v0.80 — 早期开发期（摘要）

> 这段时间每个版本间隔 1-3 天，改动密集。只保留摘要，详细日志在 [docs/changelog/](./docs/changelog/) 下。

| 版本区间 | 主题 |
|---------|------|
| v0.70–v0.80 | 企业合规三件套（脱敏/保留/审计）+ daemon 开发（v0.76-0.80 内部版本，合并至 v0.81 发布） |
| v0.60–v0.63 | 架构重构（扁平化 + 诚实化）+ CI 闭环 |
| v0.54–v0.56 | 加载链防漏读 + Handbook 拆分 |
| v0.51–v0.53 | 宣称对齐 + 评审反馈修复 |
| v0.47–v0.50 | 项目首次发布 + 安装断裂修复 |

> 早期版本的完整日志在 [docs/changelog/](./docs/changelog/) 目录下。
