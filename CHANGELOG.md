# Changelog

本文件记录 sofagent 的版本历史。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

> 📋 **版本号说明**（v0.82 新增，回应评审 P2-1）：
> - **v0.47–v0.56**：早期开发版，每个版本间隔 1-3 天，改动密集
> - **v0.60–v0.63**：架构重构期（扁平化 + 诚实化）
> - **v0.70.0/v0.70.1**：企业合规三件套（脱敏/保留/审计）+ Codex 兼容性修复
> - **v0.71**：未独立对外发布——内容（QA 审计 23 项 + 第三方代码审查 40+ 项 + 行业研究驱动功能 + 治理逻辑加固）已合并进下方 v0.72 条目。v0.71 仅作为内部版本号存在于脚本 `VERSION=` 字段和文档头中，没有对应的 Release
> - **v0.72–v0.75**：门面实证 + 运行时加固 + 治理层自身治理 + 降低试用门槛（每版一个主题）
> - **v0.76–v0.80**：daemon 开发内部版本，未对外发布。v0.8 系列 daemon 开发过程中的迭代版本，代码改动最终合并进 v0.81 统一发布
> - **v0.81**：daemon 核心骨架 + 5 项治理加固（本次评审对象）

---

## [v0.82] — 2026-06-22（v0.81 评审问题修复 + 平台名规范化）

> 来源：2026-06-22 v0.81 版本评审（GitHub 大神视角 + 科技公司技术负责人视角）。评审全文不落盘，问题转成修复任务。

### Fixed — v0.81 评审问题修复

**P0 — 文档说谎 / 约束级别混淆**

- ~~**治理加固约束级别未标注**：engine.md / loop-check.md 新增的步数闸 / 熔断闸 / 幂等检查用代码块 + `if/then` 写法，但本质是 prompt 级软提醒（非进程级硬拦截）。文档未区分「平台级硬约束（OpenClaw Hook）」与「prompt 级软提醒（全平台君子协定）」，易让技术负责人误判为机制保障~~ → ✅ **已完成**：engine.md 3 处 + loop-check.md 2 处加 `[软约束·全平台]` 标注行
- ~~**v0.81 Release Notes 未显著标注「治理加固未经平台验证」**：5 项新增逻辑全是未验证状态，但 CHANGELOG / engine.md 写法像已交付~~ → ✅ **已完成**：CHANGELOG v0.81 条目顶部加警告框
- ~~**纯 bash 解析 daemon.json 是定时炸弹**：当前 grep+sed 方案在 daemon.json 字段 >10 个或出现嵌套时会断（value 含 `|` 字符、同名 key 匹配错、无引号转义）~~ → ✅ **已完成**：daemon-lib.sh 加 `# TODO-v0.9` 注释，设明确迁移触发条件
- ~~**daemon 只监控不注入——骨架缺最小消费动作**：v0.81 daemon 检测 think.md hash 变化后只写 daemon.json，无下游消费者~~ → ✅ **已完成**：daemon.sh 检测变化后写 daemon-notice.md，下次 Agent 启动时可注入

**P1 — 可维护性 / 可信度**

- **五平台验证矩阵全 ❓**：v0.81 新增的 5 项治理加固在所有平台均未验证生效 → 待五平台实测（作者手动执行）
- ~~**文档重复度偏高、交叉引用链太长**：三层加载链 / 500 字原则 / 已知局限在 4 份核心文档各解释一遍，改一个设计决策要同步 4 处~~ → ✅ **已完成**：`LIMITATIONS.md` 已创建（17 条局限全文搬迁 + 保留所有锚点），ARCHITECTURE §三 改为摘要表 + 引用，HANDBOOK / DEVELOPMENT / README 共 8 处引用全部改为指向 `LIMITATIONS.md`
- ~~**LLM 自评是根本性结构缺陷**：非 OpenClaw 平台闭环评分本质是自我表扬循环（loop-check.md 自己承认「Agent 可能仍凭执行记忆补充评审」）~~ → ✅ **已完成**：新增 `verify-evidence.sh` 最小可信验证器（bash 脚本查 task/logs 有无测试 exit code / lint 结果），loop-check.md 加引导行；外部评估器完整版推到 v0.9

**P2 — 工程打磨**

- ~~**CHANGELOG 版本号跳跃**：v0.75 → v0.81 中间 v0.76-v0.80 未说明去向~~ → ✅ **已完成**：CHANGELOG 顶部新增「版本号说明」段
- ~~**README Quick Start 依赖 `curl pipe bash`**：安全敏感用户（企业）会被劝退~~ → ✅ **已完成**：`git clone + bash install.sh` 提为推荐路径，`curl pipe bash` 降为备选
- ~~**CI verify.yml 引用已删的 constitution/ 目录 + --ci 参数未实现**~~ → ✅ **已完成（热修）**：verify.yml fallback 改为 `sofagent/rules.md`；`--ci` 改为 `--quick`；install.sh 新增 `--ci` 作为别名；daemon 安装步骤在 `--quick`/`--ci` 模式下自动跳过交互
- ~~**平台名规范化：Hermes → Hermes Agent**：裸名 Hermes 与 NousResearch 的 Hermes 系列开源大模型同名，搜索结果被稀释。正式名称为 **Hermes Agent**（[github.com/NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)）~~ → ✅ **已完成**：15 文件 19 处展示名替换（代码逻辑 `--platform hermes` / `pgrep` / `~/.hermes/` 保持不变）；GitHub 标签 `hermes` 已改为 `hermes-agent`

### Added

- **verify-evidence.sh**：最小可信验证器，扫描 task/logs 检查客观证据（测试 exit code / lint 结果），有标 `[已验证]`，无标 `[未验证]`
- **daemon-notice.md**：daemon 最小消费动作，检测 think.md / rules.md 变化后写通知文件

### Pending — 五平台实测（待作者手动执行）

- **五平台实测矩阵**：8 维度 × 5 平台逐格填实测结果。无平台标「未测」，不编数据
- **daemon 进程检测验证**：各平台 pgrep 命中率实测
- **治理加固生效验证**：步数闸 / 熔断闸 / 幂等检查 / 评判器隔离是否真的生效
- **docs/platform-matrix.md 填充**：v0.81 建的模板填实测数据

### Added — 五平台实测（已在 ROADMAP 规划）

- **五平台实测矩阵**：8 维度 × 5 平台逐格填实测结果。无平台标「未测」，不编数据
- **daemon 进程检测验证**：各平台 pgrep 命中率实测
- **治理加固生效验证**：步数闸 / 熔断闸 / 幂等检查 / 评判器隔离是否真的生效
- **docs/platform-matrix.md 填充**：v0.81 建的模板填实测数据

### 诚实声明

- 作者不一定有全部 5 个平台的环境（特别是 Codex 和 Hermes Agent），没有环境的平台标「未测」
- 实测若发现步数闸 / 熔断闸 / 幂等检查在非 OpenClaw 平台完全不生效，文档将明确说「仅 OpenClaw 生效」，不模糊地标 ⚠️

---

## [v0.81] — 2026-06-22

### Added — daemon 核心骨架
- **daemon.sh + daemon-lib.sh**：主进程 + 共享函数库（JSON 读写、hash 比对、进程检测、降级），纯 bash 零外部依赖
- **daemon-install.sh + daemon-uninstall.sh + daemon-status.sh**：launchd（macOS）/ systemd（Linux）系统服务注册 + 卸载 + 状态查询（--detect / --json）
- **GitHub Actions CI**：`.github/workflows/daemon-linux-ci.yml`（systemd 全流程测试）
- **install.sh Step 6b + verify.sh daemon Section + uninstall.sh 清理**：集成到现有脚本

> ⚠️ **验证状态（截至 v0.82）**：以下 5 项治理加固（幂等检查 / 步数闸 / 熔断闸 / 评判器隔离 / 怀疑论提示）均为 prompt 级实现，**未经五平台实测验证**。不要假设它们能在你的平台上生效——实测数据见 `docs/platform-matrix.md`。

### Changed — 治理逻辑加固
- **engine.md**：新增幂等检查（4 类不可逆操作 + 操作 ID）+ 步数闸（MAX_STEPS=50 + GRACE_STEPS=3）+ 熔断闸（三态机 FAILURE_THRESHOLD=3 / COOLDOWN_SECONDS=30）
- **loop-check.md**：新增闭环验证模型选择 + 怀疑论提示（模型分离 + 指令污染互补规则）
- **ARCHITECTURE.md**：新增「意图债」术语
- **五平台验证**：新增 `docs/platform-matrix.md`（8 维度 × 5 平台能力矩阵）+ `docs/test-cases/platform-v081.md`（标准化测试用例）

> 详见 [v0.81 详细变更记录](./docs/changelog/v0.81.md)

---

## [v0.75] — 2026-06-21

### Changed — 降低试用门槛 + 补可信度数据
- **文档门槛降低**：新增 README.en.md（英文 README）+ docs/EVIDENCE.en.md（英文 EVIDENCE）；README 顶部加中英文语言切换；LICENSE 分界说明（代码 MIT / 文档 CC-BY-4.0）
- **社区建设**：CONTRIBUTING.md 新增 Seeking Co-maintainers 段（三级权限：Contributor→Triage→Co-maintainer）；README 底部 Co-maintainer 招募引导
- **平台预期管理**：README 平台能力表下方强化非 OpenClaw 预期管理声明（「价值约 30%」）
- **企业可评估性**：SECURITY.md 新增 ao npm 包供应链说明段 + 企业生产环境风险声明；EVIDENCE.md 顶部加诚实声明（LLM 自评 + 数据明文）
- **CI/CD 集成**：docs/team-deploy.md 新增 GitHub Actions CI 示例 + Migration Checklist（7 步）
- **工程打磨**：verify.sh 新增 ao 版本下限检查（≥0.7.5）+ 日志格式变化提示；SKILL.md 加载链自检措辞软化

> 详见 [v0.75 详细变更记录](./docs/changelog/v0.75.md)

---

## [v0.74] — 2026-06-21

### Changed — 治理层自身治理
- **ao compose 依赖加固**：新建 docs/ao-compose-format.md（YAML 格式写死 + 手动编排指南）；task-orchestrate.sh 在 ao 不可用时自动切默认编排；install.sh 新增 --remote 模式
- **加载链 + 记忆加固**：SKILL.md 新增加载链自检声明（L1/L2/L3 缺失提醒）；loop-check.md 新增人类抽样审计规则 + 冷启动基准线报告
- **易用性**：verify.sh 新增 --quick 参数（4 项核心检查）；README 新增一行安装命令
- **文档去重 + 版本同步**：全局版本号 v0.73 → v0.74（15 个文件）；ARCHITECTURE.md 行数声明更新（585→612）

> 详见 [v0.74 详细变更记录](./docs/changelog/v0.74.md)

---

## [v0.73] — 2026-06-21

### Changed — 运行时逻辑加固 + 结构重构
- **三道闸门体系落地**：任务闸（task-aware.md 准入检查 PASS/REJECT）+ 执行闸（entry-gate.md 能力注册表加权限边界+平台差异列）+ 验收闸（loop-check.md 5 项结构化 checklist + Diagnosing Box 四维度排查 + 防雪崩规则）
- **ComplexityScorer 模型路由**：engine.md A4 段新增 50 行确定性公式（子任务×0.4 + 跨领域×0.3 + token×0.2 + 代码/报告×0.1），≥0.5→Pro，<0.5→Flash
- **6 个显式失败分支**：engine.md 编排引擎加单步失败/连续失败/改动过大/任务冲突/多Agent矛盾/成本超预算
- **记忆系统三规则**：写入规则（≥2次重复或可验证后果）+ 遗忘规则（30天降权×0.3/60天归档）+ 合并规则（compress-memory.sh）
- **scoring 第九维判断力**：弃权率 +0.5 / 不该做但做了 -1.0，与前八维分开计分
- **LLM 自评降权 ×0.5→×0.3**：loop-check.md + handler.ts + think.md 模板 + DEVELOPMENT + ARCHITECTURE 全局同步（6 处）
- **rules.md 升级**：DEVELOPMENT.md + HANDBOOK.md 描述从「自定义规则」改为「Agent 运行规范」（功能不变）
- **ROADMAP ASCII→Mermaid**：架构演进图从纯文本转为 Mermaid flowchart

### Added — 新功能
- **compress-memory.sh**（新建）：记忆合并压缩脚本，--dry-run 预览 + --force 跳过确认 + 备份保留 3 份 + 60 天归档
- **task-orchestrate.sh --max-retries**：默认 3 次重试上限
- **task-orchestrate.sh --model**：配合 ComplexityScorer 手动指定模型

### Fixed — Bug 修复
- **install.sh QUICK_MODE bug**：set -u 下 QUICK_MODE 使用前未初始化 → 参数解析前 `${QUICK_MODE:-0}` 兜底

### 结构重构 — constitution/ 扁平化
- **rules.md 从 constitution/ 提到根目录**：用户更容易找到和修改
- **旧路径自动迁移**：install.sh 检测到 constitution/rules.md 自动 cp+rm+rmdir，用户无感升级
- **三级 fallback 兼容**：handler.ts 新权威 → v0.72前 → v0.70前
- **涉及 10 个文件路径同步**：install/verify/uninstall/config.sh/handler.ts/SKILL.md + 3 文档

> 详见 [v0.73 详细变更记录](./docs/changelog/v0.73.md)

---

## [v0.72] — 2026-06-27

> 📋 **关于 v0.71**：v0.71 未独立对外发布。本条目的「Added — 行业研究驱动」「Fixed — QA 审计 + 第三方代码审查（共 40+ 项）」两段实际是 v0.71 的内容（QA 审计 23 项 + 第三方代码审查 + 行业研究驱动功能）。v0.71 仅作为内部版本号存在于脚本 `VERSION=` 字段和文档头中，内容随 v0.72 一起发布。「Changed — 门面实证版本」段才是 v0.72 本身的改动。

### Changed — 门面实证版本
- **README.md 平台能力表重构**：一行「支持五大平台」替换为三列平台能力表（加载链/编排引擎/自动化程度），加诚实声明 + 种子指令脚注 + 编排引擎依赖说明
- **README.md 实际效果诚实化**：删除占位指标表，「越用越聪明」等定性说法改为诚实描述，引导用户跑 benchmark.sh
- **docs/EVIDENCE.md 重构**：标题从「测试记录表」改为「实证仪表盘」；删除「等你来填」空行模板改为社区贡献区；新增「使用时长」列（一次性测试/持续使用/弃用）；首行加诚实标注；新增基准测试区
- **sofagent/engine.md**：A2 节头部新增 ao compose vs 默认编排 6 行能力差异对比表
- **sofagent/SKILL.md**：frontmatter 版本号 0.71 → 0.72

### Added — 实证工具
- **sofagent/scripts/benchmark.sh**：10 个标准化任务半自动对比测试脚本（BSD/macOS 兼容），输出到 docs/benchmark/YYYY-MM-DD.md
- **docs/samples/ao-workflow-sample.yaml**：来自 Case 006 真实跑通的 ao compose 工作流样本，用于离线参考和降级对比
- **docs/anti-cases/README.md + TEMPLATE.md**：反案例目录——记录装了 sofagent 但仍然失败的案例

### Fixed — 工程加固
- **sofagent/scripts/verify.sh**：新增 handler.ts 回归检查（扫描 OpenClaw 日志确认加载链 hook 触发 + 第 2/3 层注入）+ ao compose 健康检查（`ao compose --version`，失败时 warn 非 fail）
- **sofagent/scripts/install.sh**：npm install agency-orchestrator 时 pin 具体版本号
- **docs/TESTING.md**：删除「等你来填」空行模板；第三方测试区块加诚实声明

---


### Added — 行业研究驱动
- **task-aware.md §1.5 目标契约模板**：澄清完成后输出 5 字段（目标/验收标准/验证方式/停止条件/风险边界），来自「下一代 Coding Agent」笔记
- **task-aware.md §1.1 任务准入拒绝**：新增 5 类高风险任务（需求不清/产品判断/安全权限/支付/数据删除/架构重构）→ 直接拒绝，区分「能力边界外」（拒接+替代方案）与「风险边界外」（拒接+说明原因，不给替代方案），来自「Loop Engineering 三道闸门」笔记
- **task-aware.md §1.6 任务闸参考**：Loop Engineering 三道闸门概念（任务闸/执行闸/验收闸）+ 执行闸/验收闸入口指引，来自「Loop Engineering 三道闸门」笔记
- **ARCHITECTURE.md §五 Loop Engineering 三道闸门对照**：闸门对照表 + 核心指标冲突三组对比 + 失败分支显式设计 + "换了一种方式加班"警告 + 第一版 Loop MVP 类比 + 渐进式路径，来自「Loop Engineering 三道闸门」笔记
- **ARCHITECTURE.md §三 Skill 自进化仍处于经验记录阶段**：标注当前阶段与目标阶段（多轨迹归纳/自验证闭环/可训练参数）的差距
- **ARCHITECTURE.md §五 行业研究启发与未来方向（8 条）**：防雪崩评审机制 / Diagnosing Box 四维度排查 / rules.md 升级 / 检查点定义 / 权限最小化 / 多重置信度 / 验证门控 / 三种协作模式
- `.github/PULL_REQUEST_TEMPLATE.md`：自检 checklist（文档同步 / verify.sh / 非 OpenClaw 测试 / 部署循环 / 参数兑现检查）

### Fixed — QA 审计 + 第三方代码审查（共 40+ 项）

**QA 审计 23 项**：
- **版本号同步**：19 处版本号从 v0.70.x 统一为 v0.71
- **交叉引用修复**：DEVELOPMENT.md §七 末尾补 docs/system_design.md 引用；CONTRIBUTING.md 删除重复的第 2/3 步
- **README 树形图补全**：补 17 项缺少的目录/文件
- **P0 合规修复**：ROADMAP.md 3 项合规描述与 enterprise-deploy.md 同步；install.sh 末尾平台分支能力说明；install.sh Step 2 npm 权限检查
- **P1 内部一致性**：rules.md 统一到 skills/sofagent/constitution/；{OPENCLAW_SCRIPTS} fallback 链；engine.md B0 路径修正 + AO Key 去优先级；entry-gate 分平台能力注册；SECURITY.md 合规地位更新；install.sh Step 3 npm set +e 包裹
- **P2 工程化**：PR 模板新建；docs/system_design.md 保留+引用；badge 补 last-updated；CONTRIBUTING 提 PR 模板；脚本注释/脱敏追加；verify.yml install.sh 化；HANDBOOK FAQ 补 @skill:sofagent

**第三方代码审查 P0（文档说谎/功能不存在）**：
- **cleanup.sh 虚构参数兑现**：SECURITY.md / enterprise-deploy.md 宣称支持 `--purge --before`，代码没有。修复：在 cleanup.sh 真正实现这两个参数（`--purge` = 强制清理；`--before DATE` 按文件名日期过滤），含日期格式校验
- **手机号脱敏虚构兑现**：task-record.sh 的 `sanitize()` 缺中国大陆手机号 `1[3-9]\d{9}` 打码，但 SECURITY.md / ROADMAP.md / enterprise-deploy.md 全部宣称有。修复：加 `sed -E 's/[[:<:]]1[3-9][0-9]{9}[[:>:]]/[PHONE-REDACTED]/g'` + verify.sh 同步加测试用例（含误伤防护：11 位订单号、`monkey=foo` 不打码）
- **handler.ts rules.md 路径不一致**：install.sh B2 部署 rules.md 到 `skills/sofagent/constitution/`，但 hook 仍从 `~/.openclaw/rules.md` 读——OpenClaw 第 3 层加载链 silently 失效。修复：handler.ts 改为优先读 constitution 权威路径，fallback 旧路径，删除自认 P0 的 TODO 注释

**第三方代码审查 P1（一致性）**：
- **脚本版本号统一**：7 个脚本（install/verify/uninstall/task-record/task-orchestrate/cleanup/audit）VERSION 从 `1.0.0` 改为 `0.71`，与 SKILL.md 对齐
- **task-record.sh 命名统一**：`--version` / `--help` 输出从 `task-log` 改为 `task-record`（3 处）
- **verify.sh rules.md 路径去重**：B2 统一到 constitution/ 后，verify.sh 仍把 `~/.openclaw/rules.md` 当合法路径检查。修复：改为权威路径优先 + 遗留路径 warning
- **enterprise-deploy.md 顶部版本号**：`v0.55` → `v0.71`；顺手修复 bash 行内续行符注释错误

**第三方代码审查 P2（工程债务）**：
- **sanitize key 正则词边界**：加 `[[:<:]]` 防 `monkey=foo` 误伤
- **AWS Key 正则 BSD 兼容**：`\b` → `[[:>:]]`
- **task-orchestrate.sh L3 fall-through**：加注释说明"复制 L2 逻辑作降级路径"（bash case 不支持 fall-through）
- **cleanup.sh grep pipefail 风险**：`ls | grep -v | sort` 加 `|| true`
- **ARCHITECTURE §五 加 Skill 自进化交叉引用**：现状（§三 经验记录阶段）vs 未来方向（§五）互相指引
- **ROADMAP ASCII 架构图**：中英混排导致 box 塌陷 → 改纯英文 box + 中文副标题
- **PR 模板分类**：「非 OpenClaw 平台测试」从必勾改为「仅脚本/Skill 改动时勾选」，避免纯文档 PR 被门槛劝退；加「参数兑现检查」防止再次出现虚构参数类问题
- **verify.sh pipefail + grep -q SIGPIPE 误报**：`bash script.sh --help | grep -q "dry-run"` 在 pipefail 下因 SIGPIPE 返回 141 → 误报参数不可用。修法：临时变量承接输出再 grep

**第三方代码审查 P3（顺手）**：
- **install.sh / uninstall.sh 注释里的 `task-log` → `task-record`**：与文件名对齐
- **docs/system_design.md**：引用 `task-record.sh v1.0.0` → `v0.71`

---

## [v0.70.1] — 2026-06-20

### Fixed — Codex 平台兼容性（来自 Case 004 第三方测试报告）
- **install.sh `SOFAGENT_DATA` 未初始化**：Codex/Claude/Hermes 分支不初始化该变量，但汇总输出阶段引用它，在 `set -u` 下导致退出。修复：在平台分支前统一初始化 `SOFAGENT_DATA="${PROJECT_DIR}/.sofagent"`
- **verify.sh 误查 OpenClaw Hook**：`verify.sh --platform=codex` 仍检查 `hooks/sofagent-load-chain/` 和 `openclaw.json`，对手动平台产生稳定误报。修复：Hook 检查段加平台守卫，非 OpenClaw 平台跳过并输出 pass

### Added — 第三方测试证据
- **Case 004**：Codex 平台 10 次连续稳定性测试（qinanxie199229@gmail.com）。1 次完整可审计 + 9 次用户确认等效样本，首次交付无需纠错率 0%→100%。详见 [Case 004](./docs/cases/codex-stability-2026-06-20/)
- **EVIDENCE.md / TESTING.md**：新增 Case 004 行 + 用例 1/3 补 Codex 平台结果

---

## [v0.70.0] — 2026-06-19

### Added — 企业合规（P0/P1）
- **日志脱敏**：task-record.sh 新增 `sanitize()` 函数，写入 task/logs 前自动打码 API Key / token / 凭证。内网 IP 脱敏可选（默认关闭）。通过 `log_sanitize: true` 在 rules.md 启用
- **数据保留策略**：新增 cleanup.sh 独立脚本，支持按天（`data_retention_days`，默认 90）/ 按条（`data_retention_max_entries`，默认 500）清理。删除前先 tar.gz 归档到 `archive/YYYY-MM.tar.gz`，确认成功后再删除源文件。通过 `data_cleanup_on_record: true` 在 task-record.sh 写入后概率触发（`data_cleanup_frequency`，默认 1/10）
- **审计日志**：新增 audit.sh 独立脚本，记录关键操作（install / uninstall / orchestrate / cleanup）到 `task/audit/YYYY-MM/YYYY-MM-DD.md`，追加 Markdown 表格行。通过 `audit_enabled: true` 在 rules.md 启用，默认关闭
- **共享配置层**：新增 lib/config.sh，从 rules.md 解析合规配置项，export 7 个环境变量供所有脚本复用
- **验证升级**：verify.sh 新增企业合规检查组（脱敏函数验证 / cleanup.sh 参数检查 / audit.sh 参数检查 / 默认关闭确认 / rules.md 配置段完整性）

### Changed
- **rules.md**：末尾新增「企业合规（v0.7x）」配置段，7 个配置项默认全部注释（向后兼容）
- **install.sh / uninstall.sh / task-orchestrate.sh**：新增审计钩子（开始/结束处调用 audit.sh，`|| true` 兜底）

---

## [v0.63] — 2026-06-19

### Changed — 诚实化（P0）
- **loop-agent.md 非 OpenClaw 评审路径去伪强制语气**：删除 `⛔ 禁止凭记忆补充` 等硬标记，加显式声明「prompt 级约束，无机制保障，效果未实测」。承认 LLM 没有「清空执行记忆」的 API——「重新 Read task/logs」是让 Agent 以文件为主依据，不是真的能擦除执行记忆。与 OpenClaw `session.spawn` 工程隔离路径的可靠性不在同一级别，文档不再混淆
- **ARCHITECTURE 外部研究引用诚实化**：Self Harness / Skill Reducer 删除具体百分比数字（14-21% / 39% / 2.8%），改定性描述；加免责声明「sofagent 核心效果未实测，不代表能达到相同效果」；标注「论文链接待补」（致谢表其他引用均有 arXiv 号）。非 OpenClaw 路径不再引用 Self Harness 的工程隔离实验数字
- **HANDBOOK §五「验证安装」与闸门矛盾修复**：删除「看 Agent 回复里有没有初始化提示」——SKILL.md 闸门 ① 明确「内部执行，不输出给用户」，两处直接矛盾。改为只推荐 verify.sh，并加说明「不要靠初始化提示验证」

### Changed — 一致性（P1）
- **SKILL.md triggers 可判定性修复**：删除「Agent行为异常」「经验积累」（事后状态/结果，路由阶段不可判定），新增「多步任务」「代码修改」「文件操作」（事前可路由特征）
- **task-closure.md 编号断裂修复**：执行清单缺 ①（写 task/logs 被合并进引用块），补 ①② 连续编号
- **loop-agent.md closure 输入边界讲清楚**：区分 task/logs（评审主依据）vs scoring/orchestrator（历史参考，不计入本次评审），消除「输入含 scoring/orchestrator 但又要求只读 task/logs」的矛盾

### Changed — 文档膨胀裁剪（P2）
- **ARCHITECTURE.md 612→585 行**：删除 §四「Osmani 三盆冷水」（面向用户的警告，移到 HANDBOOK FAQ），回到 600 硬上限内
- **DEVELOPMENT.md 610→599 行**：§五「评审者分离」表格精简为指向 loop-agent.md 和 ARCHITECTURE 的引用（避免重复 + 诚实化），清理冗余分隔符，回到 600 硬上限内
- **HANDBOOK.md 加 Osmani 三盆冷水精简版**（表格形式，443 行 ≤500 上限内）

### Fixed
- **ARCHITECTURE §三「复盘评分是 LLM 自评」段落诚实化**：原描述「v0.62.2 已按平台分级解决」过度乐观，改为分级表格明确 OpenClaw 工程隔离 vs 非 OpenClaw prompt 级约束的差异，标注非 OpenClaw 不引用具体数字

### 不动
- OpenClaw `session.spawn` 评审者分离分支（真改进，保留原样）
- 4 条底线 + 10 则铁律内容
- 三层加载链结构

---

## [v0.62] — 2026-06

### Added
- **load-chain.sh 防御性冗余**：恢复注入宪法（从 SKILL.md 提取），与 skill 系统注入形成双保险。~250 token 冗余可接受——关键系统不怕重复，怕单点失效
- **SKILL.md description 改为架构导向**：从「4 条底线 + 10 则铁律」改为「三层加载链实现复杂任务自动拆解执行 + 每次跑完任务自动复盘总结」
- **ARCHITECTURE.md 跨平台说明更新**：诚实声明第 1 层全平台强制（skill 注入 + OpenClaw 兜底），第 2、3 层 OpenClaw 强制、其他平台君子协定

### Changed
- **宪法内联进 SKILL.md（扁平化重构）**：4 底线 + 10 铁律从 `constitution/sofagent.md` 内联进 SKILL.md。第 1 层不再依赖 Agent Read——skill 调用自动注入，所有平台强制生效。WorkBuddy 新会话验证：第 1 层从「全跳」变为「强制生效」（回复含闸门自检痕迹）
- **三层加载链重构**：SKILL.md（自动注入）→ think.md（Agent Read）→ rules.md（Agent Read，最高优先级）
- **铁律重排**：#3 先读再用→#1（含 think.md/rules.md），原 #1→#2，原 #2→#3
- **文档命名规范化（对齐 GitHub 社区惯例）**：Design.md→ARCHITECTURE.md，Roadmap.md→ROADMAP.md，Handbook.md→HANDBOOK.md，Developer.md→DEVELOPMENT.md，Testing.md→docs/TESTING.md，Evidence.md→docs/EVIDENCE.md
- **load-chain.sh 重构**：v0.62 先删除宪法注入，v0.62.1 恢复（防御性冗余）

### Removed
- **删除 constitution/sofagent.md**：宪法内联进 SKILL.md 后不再需要

### Fixed
- **sofagent.md 引用清理**：23 处文档引用同步更新为 SKILL.md（v0.62 重构遗漏修复）
- **HANDBOOK 铁律表同步**：v0.62 铁律重排时 HANDBOOK 漏改，本轮修复
- **uninstall.sh 旧版遗留清理**：新增清理 v0.62 前部署的 sofagent.md 遗留

---

## [v0.60] — 2026-06

### Added
- **A0 专家团引擎自检**：SKILL.md A0 预判新增 WorkBuddy 专家团共存边界——专家团激活时引擎不点火，避免双重编排冲突
- **Logo 体系**：README / Design / Developer / Handbook 四文档统一加 sofagent logo（alt/width 统一）
- **CONTRIBUTING 新人快速开始表格**：顶部加一表速览，降低首 contributing 门槛
- **GitHub Actions CI**：补回 verify workflow，CI 容器预置 ~/.openclaw 最小安装环境后跑验证
- **仓库 Topics**：openclaw / agent-governance / loop-engineering / harness-engineering / ai-agent / skill

### Changed
- **README 徽章优化**：LICENSE MIT 前置 + 新增 GitHub stars 动态徽章 + 平台分级展示
- **Roadmap v0.6x 四项全部闭环**：新会话端到端测试 / 端到端闭环验证 / WorkBuddy 专家团共存边界 / load-chain.sh 权重折半
- **README 措辞平铺化**：「翻 Handbook 定制你的 Agent」改为平铺三句，降低跳转成本

### Fixed
- **{SOFAGENT_DATA} 变量定义补全**：SKILL.md 加载链末尾补变量路径定义，解决用户不知变量指向哪里的困惑

---

## [v0.56] — 2026-06

### Fixed
- **删假引用**：Open Viking 引用疑似编造（bytedance GitHub 无此仓库，DeepSeek 幻觉），删除 Design.md 正文段落 + 致谢表条目
- **修错引用**：SkillOS 机构更正为 Google Cloud AI Research / UIUC（原误写含 MIT）；名称统一为 SkillOS（原 Skill OS 带空格）
- **修错年份**：Klarna 裁员事件更正为 2024 年 2 月宣布（原写 2023）
- **折半机制真实现**：`load-chain.sh` 新增 `emit_think_downgraded` 函数（awk），解析 think.md 中 `[LLM自评]` 标记位并动态追加降权提示。降权提示不写回原文件，SHA-256 缓存按原文计算零影响。OpenClaw 平台物理降权生效
- **loop-agent 二值证据矛盾**：L52"文件 diff 符合预期"（语义判断）改为 `git diff --quiet exit 0`（可程序化判定）
- **Case 001 内部矛盾**：执行时间统一为 28 分钟（原 23/28 分混用）；60% 检查点加注释说明按 token/时间/进度三维度综合判定；版本号加注 v0.54 跑通
- **加载链防漏读（P0-7）**：SKILL.md 加载链表格上方加 ⛔ 硬出口，明确"读了 rules.md 不等于读了 sofagent.md"，要求逐文件 Read + 内部确认"✅ 宪法层已注入"。来自作者 WorkBuddy 自测发现的根因

### Changed
- **子 Skill 数统一**：全局统一为"1 主 Skill + 5 子 Skill = 6 个 .md 文件"（原 README/Developer/CONTRIBUTING 分别写 6/4/3 不一致）
- **"兼容"措辞诚实化**：README + Handbook 把"兼容五平台"改为分平台能力表，OpenClaw 全功能 / 其他平台仅宪法层约束
- **Quick Start 重写**：补前置依赖表（bash/git/node/npm）+ git clone + 30 秒 smoke test + install.sh 会改什么文件一览
- **安装路径统一**：README + Handbook 统一为 git clone + install.sh 主路径，技能市场作为 WorkBuddy 备选
- **三文件去重**：Developer §二 编排深度章节加指向 Design §二 的链接；Handbook §五 Developer 级内容（脚本速查/种子指令/Skill 文件列表）移到 Developer §一
- **闭环优先级提升**：Roadmap 中"新会话端到端测试""端到端闭环验证"从 🟡 提至 🔴
- **测试人字段统一**：Testing.md / Evidence.md 中作者测试记录用 GitHub 用户名 KongFangXun（文档签名保留中文孔放勋）

### Added
- **Case 002 归档**：作者 WorkBuddy + DeepSeek V4 Pro 自测报告（14 项检查），闭环跑通 + 发现加载链第 1 层漏读
- **Testing.md 用例 3 改 PASS**：从 FAIL（think.md 空白、task/logs 无记录）改为 PASS（闭环双写跑通）
- **Evidence.md 第三方表**：新增 KongFangXun 自测行
- **IDENTITY.md 模板**：新建 `sofagent/data/IDENTITY.md`（岗位名/职责/能力边界/风格偏好 4 字段）
- **文档膨胀控制原则**：Design §一 补行数预算（Handbook ≤500 / Developer ≤600 / Design ≤600 / README ≤250）
- **单点依赖坦白**：CONTRIBUTING 加"目前项目维护者为孔放勋一人，单点依赖风险已知"
- **ao compose npm 依赖局限**：Design §三 已知局限补一条
- **WorkBuddy 平台折半局限**：Design §三 补 WorkBuddy/其他平台无 load-chain.sh Hook，折半靠 Agent 自觉

### Removed
- **删 disable 字段误导**：CONTRIBUTING 删"SKILL.md 特殊处理：同步时需在 YAML 头里保留 disable: true 字段"（SKILL.md 实际无此字段）
- **删 Handbook §五 Developer 级内容**：load-chain.sh 详细说明 / 种子指令详细内容 / 四个子目录六个 Skill 文件列表（移到 Developer）

---

## [v0.55] — 2026-06

### Changed
- **架构重构**：978 行 Handbook 拆为三个文件——Handbook 436 行（普通用户）+ Developer 561 行（开发者）+ Design 573 行（设计决策）
- **team-deploy 改名**：team-deploy-checklist → team-deploy
- **README 四身份引导表**：普通用户 / 开发者 / 设计爱好者 / 技术 VP 各看哪个文件

### Added
- **Case 001 归档**：@cedric123123 在 OpenClaw + kimi-k2.5 首次跑通全流程（28 分钟，6 文件，3 检查点 100%）
- **Evidence.md 第一份第三方证据**
- **docs/enterprise-deploy.md**：企业内网部署指南（离线模式 / 权限 / 合规清单）
- **docs/team-deploy.md**：团队落地 3 页 checklist

---

## [v0.54] — 2026-06

### Fixed
- **反思自噬根因**：loop-agent.md closure 模式加外部信号校验（三标记 [LLM自评]/[已验证]/[用户确认] + 二值证据 + 权重折半 ×0.5）
- **ao compose 单点故障**：engine.md 实现默认编排策略（无 ao 时按语义簇拆 3-5 子任务）
- **多用户污染**：Design §三 + README 补"不是多用户系统"局限

### Added
- **约束回响**：loop-agent.md checkpoint 模式加"重大操作前自检铁律和反思区，答不上来暂停"
- **6 条企业级开关**：chmod 700 / --no-config-inject / --no-ao / offline 模式 / 编排 fallback / 企业部署文档

---

## [v0.53] / [v0.53.1] — 2026-06

### Fixed
- 双视角评审 22/23 项修复（GitHub 大神 + 创业公司技术 VP 视角）
- Handbook 瘦身 1136→983 行（-13.5%）

---

## [v0.52] — 2026-06

### Changed
- 风格统一 + 边界补齐

---

## [v0.51] — 2026-06

### Changed
- 宣称对齐

---

## [v0.50] — 2026-06

### Fixed
- 全链路通——install→verify→uninstall 首次跑通

---

## [v0.49] — 2026-06

### Fixed
- 自测挖 bug

---

## [v0.48] — 2026-06

### Fixed
- install.sh 文件复制不全问题（OpenClaw 路径仅复制 2/6 个 Skill 文件）
- 报告不实问题

---

## [v0.47] — 2026-06

### Added
- 项目首次发布——装不上（install.sh 路径错误）
