# 贡献指南

<p align="center"><img src="docs/assets/sofagent.png" alt="sofagent" width="96" /></p>

> 📖 新贡献者？先看 [COMMUNITY.md](./docs/COMMUNITY.md) 了解社区现状和贡献路径。
> 📌 基于当前 main 分支结构修订，目录与文件以你面前的仓库为准。
> v1.5.3 · 2026-09-26（UTC）· ✅ 已发版 · 孔放勋

欢迎参与 sofagent！这个项目的代码由 AI 模型辅助生成（详见[致谢](./docs/THANKS.md#生成伙伴)），作者做产品决策和终审。你看到的任何技术问题，请直接指出来，不必客气。

---

## 目录

- [新人 30 秒快速开始](#新人-30-秒快速开始)
- [怎么参与](#怎么参与)
- [项目维护模型](#项目维护模型)
- [开发环境 + 发版](#开发环境--发版)
- [文档体例（H1 语言 / 术语大小写）](#文档体例h1-语言--术语大小写)
- [目前最需要的帮助](#目前最需要的帮助)
- [Seeking Co-maintainers](#seeking-co-maintainers)
- [行为准则](#行为准则)
- [License](#license)
- [成为维护者](#成为维护者)

---

## 新人 30 秒快速开始

| 你想... | 怎么做 |
|------|------|
| 报 Bug / 提想法 | → [开 Issue](https://github.com/KongFangXun/sofagent/issues/new/choose) |
| 不知道怎么用 | → [Discussions 去问](https://github.com/KongFangXun/sofagent/discussions) |
| 不知道怎么测 | → 看 [testing.md](./docs/guides/testing.md) 的 9 个标准化用例 |
| 想直接改代码 | → 看下面「贡献者 10 分钟速览」 |
| 想理解概念 | → 看 [ARCHITECTURE.md](./docs/ARCHITECTURE.md) |
| 想跑实验 | → 看 [benchmark 复现指南](./docs/evidence/benchmark/reproduction-guide.md) 与 [案例模板](./docs/evidence/case-study-template.md) |

### 贡献者 10 分钟速览

**只看 3 个文件**：

| 顺序 | 文件 | 看什么 | 约几分钟 |
|:--:|------|------|:--:|
| 1 | [SKILL.md](./SKILL/SKILL.md) | 4 底线 + 9 则铁律 | 3 min |
| 2 | [CHANGELOG.md](./CHANGELOG.md) | 最新版本的变更 | 5 min |
| 3 | [LIMITATIONS.md](./docs/LIMITATIONS.md) | 已知局限 | 2 min |

**先改 3 个文件（最低门槛）**：

| 脚本 | 改什么 | 难度 |
|------|------|:--:|
| `install.sh` | BSD/macOS 兼容性修复 | ⭐⭐ |
| `engine/scripts/verify.sh` | 新增检查项（bash 版，安装流程内调用） | ⭐ |
| `engine/audit/src/verify.ts` | TS 版验证（命令为 `sofagent-core verify`；无 `sofagent-verify` 这个 bin） | ⭐ |

**跑 1 条命令验证**：

```bash
bash install.sh && bash engine/scripts/verify.sh
# 或 TS 版：cd engine/audit && npm run build && node dist/verify.js
```

> 💡 **首次 clone 后**：先 `npm install && npm run build`，再 `npm test`。测试依赖构建产物（`dist/`），未 build 直接跑测试会报模块找不到。

> ⚠️ **本地测试用 `node dist/index.js` 而非全局二进制**——全局 `sofagent-audit` 可能是旧版本（npm publish 后才更新）。改代码后先 `npm run build`，再用 `node engine/audit/dist/index.js --diff HEAD~1..HEAD` 测试。

### 仓库目录结构（新贡献者先看文件放哪）

| 目录 | 内容 |
|------|------|
| `engine/` | 13 个 @sofagent/* 模块包（`audit` 审计模块 / `core` 底座 / `daemon` 守护 / `orchestrator` 编排 / `train` 后训 / `mcp` / `rules` / `eval` / `think` / `evolve` / `ontology` / `inject`（v1.5.0 前名 harness）/ `ab-test`，13 个均含 test script）+ `hooks/sofagent-load-chain`（加载链 Hook，工具包非模块包）+ `umbrella/`（npm 裸名总包 `sofagent`）——模块包全部发布到 npm；另有 2 个插件族：`engine/dsh-plugins/`（cordis-plugin-sofagent* 7 款 DSH 插件：6 款原子 + 1 款聚合整装）+ `engine/openclaw-plugins/`（OpenClaw code-plugin 4 款） |
| `engine/audit/src/rules/` | 审计规则实现（`rule-a*.ts` A1-A24 + `skill-safety-engine.ts`）；A20 网络外传 / A21 持久化后门 / A22 权限提升 / A23 路径穿越 |
| `engine/audit/src/` | 审计核心：`audit-trail.ts` 审计轨迹聚合 + `protocol-neutrality.ts` 协议中立声明 |
| `engine/audit/src/permission/` | 权限配置加载与检查 |
| `engine/core/src/` | 底座：配置加载 / 原子写入 / 审计历史哈希链 / 联邦合并 / 安全脱敏；`agent-identity.ts` Agent 身份码 |
| `engine/daemon/src/` | 守护进程：cron / fs 监听 / 联邦查询 / Dream Cycle / 巡检器；`with-retry.ts` 推送重试 + `daemon-health.ts` 健康自检 |
| `engine/orchestrator/src/` | 编排模块：`activate.ts` 激活链 Phase 1（读 FDE 交付物 → 注册企业 SubAgent） |
| `tools/` | 维护者工具脚本（门禁在 `tools/check/`：`check-docs.sh` / `check-test-count.sh`；发布链在 `tools/release/`：`pre-push-check.sh`；仪表盘在 `tools/dashboard/`：`sofagent-dashboard.sh`；完整清单见 `tools/README.md`） |
| `FORGE/` | 项目自迭代工具链（LOOP 流水线 / playbook / fresh-eyes 审查体系） |
| `FDE/` | 前线部署方法论（GUIDE + templates） |
| `SKILL/` | 技能文件（SKILL.md 宪法 + harness 模板 + 子 Skill） |
| `docs/` | 文档（ARCHITECTURE / HANDBOOK / WIKI / changelog / evidence / guides） |

### 微任务清单（5-15 分钟）

| # | 任务 | 文件 | 难度 | 时间 |
|:--:|------|------|:--:|:--:|
| 1 | 改一条审计规则的正则 | `engine/audit/src/rules/rule-a*.ts` | ⭐ | 5 min |
| 2 | 给 install.sh lib 模块加参数校验 | `engine/scripts/lib/*.sh` | ⭐ | 10 min |
| 3 | 修复一个 ShellCheck 警告 | 见 ShellCheck Action 报告 | ⭐⭐ | 10 min |
| 4 | 补一条审计规则 + 测试 | `engine/audit/src/rules/rule-a*.ts` + `.test.ts` | ⭐ | 15 min |
| 5 | 翻译一段 HANDBOOK 到英文 | `docs/HANDBOOK.md` → 英文版 | ⭐⭐ | 15 min |

---

## 怎么参与

**提 PR**：Fork → `git checkout -b fix/xxx` → 提交 → 推送 → GitHub 提 PR。参照 [PR 模板](./.github/PULL_REQUEST_TEMPLATE.md)。

**Commit Message 规范**（Conventional Commits）：

```
<type>(<scope>): <subject>
```

| type | 用于 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档变更 |
| `refactor` | 重构（不改功能不修 Bug） |
| `test` | 测试相关 |
| `chore` | 构建/工具/依赖 |
| `style` | 格式调整（不改逻辑） |
| `ci` | CI 配置 |
| `perf` | 性能优化 |

> 自定义前缀（如 `evidence:` `index:`）不强制禁止，但推荐用标准 type。**纯描述性 commit（无前缀）不可接受。**
>
> 示例：`docs: evidence Case 023-025 外部用户验证归档` ✅ / `evidence 归档` ❌

**改 Skill 文件**：先改 `SKILL/harness/`（唯一权威），再 `bash install.sh` 同步。

**文档修改**：改 HANDBOOK 必须同步更新 `SKILL/harness/` 下模板。详见 [DEVELOPMENT §七](./docs/DEVELOPMENT.md#七数据文件架构)。

> 📋 **文档措辞规范（v1.3.4 起）**：sofagent 对「对外文档」和「内部文档」的措辞要求不同，避免审查者反复误报：
>
> | 文档类型 | 代表文件 | 「开发中 / WIP / draft」类措辞 | 说明 |
> |---------|---------|------|------|
> | **对外文档** | `README.md`、badge、`README.en.md` | ❌ **禁止** | 面向陌生读者和潜在用户，「开发中/WIP/draft」降低可信度。只允许发布版本号或「规划中」（指向明确路线） |
> | **内部文档** | `docs/ROADMAP.md`、`CHANGELOG.md`、`docs/changelog/` | ✅ **允许** | 面向贡献者，标注「开发中/已排期/尚未实现」是正常的项目状态披露，不违反铁律 |
>
> **规则**：看到 README/badge 出现「开发中/WIP/draft」→ 要改（对外文档必须显得已完成或有明确规划）；看到 ROADMAP/CHANGELOG 出现「开发中/已排期」→ 不用改（内部文档正常披露）。

> 📋 **文档禁考古规范**：规则/方法论/任务类文档只写「问题 + 解决方案」，**不带日期、版本号、run 编号、「XX 新增」「X月X日教训」类出身标注**——项目迭代快，文档向前看，历史由 git log 与 CHANGELOG 承载。
>
> **判据**：「X 起已支持/生效」= 能力门槛，保留；「vX.Y.Z 新增/实录/机制化/澄清」= 出身考古，删标签、留内容。版本号是「当下」代词——「vX.Y.Z 现状」直接写「现状」。
>
> **例外**：能力版本门槛（如 `v1.0.1+`）、与包版本对齐的文件头标识、历史事实档案（CHANGELOG / LEDGER / evolution 提案档案 /「已解决」记录章节）。

> 📋 **来源块溯源规范**：正文中的溯源块（`> 📖 来源：` / `> 📐 来源：`）只写**公开可核的三要素——作品名 + 链接 + 原文发布日**。
>
> - ❌ **不把内部件当来源**——内部会议纪要、内部复盘、内部流程/栏目名都没有公开出处，写进溯源块是对读者的虚假溯源。这类材料改走正文叙述，不进溯源块。
> - ❌ **不写商业产品名**（私域代号不进开源仓，见 `tools/check/check-open-boundary.sh`）——脱敏优先级高于「标注来源」。
> - ✅ 有公开出处就带全链接与原文发布日：补 `https://`、补日期都算**清理存量债**。
>
> **判定**：`tools/check/doc-discipline.sh` Face 3a 阻断内部件；Face 3b 对「缺链接 / 缺原文发布日」做**集合相等**台账（`tools/check/source-block-exempt.txt`）——新增即红，清理后须同步把台账改小。

## 项目维护模型

代码主要由 AI 模型辅助生成，作者做产品决策和终审。PR 经 AI review 后作者终审。**Co-maintainer 诱因**：合入 5 个 PR → Admin；贡献跨平台修复 → README 留名；完成英文翻译 → 英文文档 Owner。

## 开发环境 + 发版

```bash
git clone https://github.com/KongFangXun/sofagent.git
cd sofagent && bash install.sh && bash engine/scripts/verify.sh
```

发版：按 [docs/changelog/releasing.md](./docs/changelog/releasing.md) 十一阶段 SOP 执行——阶段一~四（审查/开发/质量循环/审查体系）→ 阶段五~七（发版闸门/文档收尾/工具健康）→ 阶段八（确认关口）→ 阶段九~十（发布：npm 13 包 + ClawHub/SkillHub 双分发 + tag + Release）→ 阶段十一（发布后收尾）。简版：`docs/changelog/vX.Y/vX.Y.Z.md` 写日志 → `CHANGELOG.md` 加索引 → `tools/release/bump-version.sh` 升级版本号 → `tools/release/pre-push-check.sh` 全绿 → `git tag vX.Y && git push` → `gh release create vX.Y`。

> 📋 **changelog 写作规范**：changelog 是对外公开文档，**不写人名、内部私有路径、内部工单/审查代号**。
> - ❌ 不写开发成员名字或角色代号（如"某某拍板""供某某实现"）
> - ❌ 不写本机私有路径（如 `~/Desktop/xxx-prompts/`），开发 Prompt 仅作内部参考不分发
> - ❌ 不写内部工单 / 审查代号（如 `F-XX` / `P0-XX` / `FLAG-X`），改用描述性文字（"密钥泄漏修复""链校验重构"）
> - ✅ 版本号、功能描述、行为变更、兼容性说明照常写
>
> 已发布版本的 changelog 按"已发布不改"原则保留原样。

---

## 文档体例（H1 语言 / 术语大小写）

> 这一节回答「新增文档该长什么样」——此前 H1 语言是三套写法并存且**无明文规则**，读者在不同文档间切换时只能靠猜。以下是**明文规则 + 逐份登记的例外清单**；不接受「不在清单里、也不是规则允许」的第五种形态。

### H1 语言规则 + 例外清单

**规则**：H1 的推荐形式是「**英文识别名 · 中文主题词**」（如 `# 路线图 · Roadmap`）——识别名给外链引用与全文检索（稳定），中文主题词给中文读者（可读）。**省略中文主题词是允许的例外，但必须在本清单登记**，新增文档不得默认走例外。

| 类别 | 规则 | 已登记文档 |
|:--:|------|-----------|
| **A · 中文 H1** | 面向中文读者的首读 / 规范文档，用纯中文（品牌名 `sofagent` 视为语言中立，可单独作 H1） | `README.md`·`README.en.md`（均为 `# sofagent`）·`SECURITY.md`·`CONTRIBUTING.md`·`docs/COMMUNITY.md`·`docs/THANKS.md`·`docs/WIKI.md` |
| **B · 英文元文件 H1** | 沿用 GitHub / 开源生态约定俗成的英文名，**刻意不改**（改了反而不被工具与读者识别） | `CHANGELOG.md`·`CODE_OF_CONDUCT.md` |
| **C · 中英混排 H1**（推荐形态） | 「英文识别名 · 中文主题词」 | `docs/API.md`·`docs/PHILOSOPHY.md`·`docs/ROADMAP.md`·`docs/VALIDATION.md`·`AGENTS.md`·`GEMINI.md` |
| **D · 英文主题 H1**（**登记的例外**：省略中文主题词） | 主题型长文档，H1 前缀已是稳定英文识别名 | `docs/ARCHITECTURE.md`·`docs/DEVELOPMENT.md`·`docs/HANDBOOK.md`·`docs/LIMITATIONS.md` |

**D 类为什么登记为「例外」而不是统一改掉**：这四个 H1 已被仓内外链接以锚点形式引用（形如 `...#sofagent-architecture`），**改 H1 文字 = 同时破坏锚点与既有外链**，体例收益小于断链代价。因此明确**登记**——「有规则的例外」与「三套并存且无规则」的区别就在这张表。**新增文档默认按 C 类写**；若确需走 D 类，在同一 PR 里往本表补一行。

### 术语大小写（`Skill` / `skill`）

| 写法 | 何时用 | 例 |
|------|--------|-----|
| **`Skill`（大写 S）** | 作为**产品概念**——加载链的一层形态、`SKILL.md` 体系、能力市场里的技能实体、`evolve` 的优化对象 | 「五种形态分发（FDE 插件 / **Skill** / MCP / CLI / Dashboard）」「执行时 **Skill** 快照」「**Skill** 陈旧度」 |
| **`skill`（小写）** | 只出现在**标识符语境**——目录 / 文件路径、包名或工具名、规则 id、YAML 字段名、锚点片段、外部体系自身的槽位命名 | 路径 `SKILL/skills/05-exit.md`、工具名 `skillopt`、规则 id `skill-staleness`、字段 `skill_ref:`、锚点 `#四件事的分工mcp--skills--ontology--harness` |

> 📌 **同族的既定先例**：`plugin` 小写（通用名词）、`MCP`/`CLI`/`FDE`/`Agent` 大写（专有名词/缩写）——`Skill` 归入「大写」一侧，判据是「它指 sofagent 的一个具体产品实体，不是一个泛化的英文名词」。**改大小写时务必排除路径 / 包名 / 锚点**（改了会断链或失配门禁正则）。

---

## 目前最需要的帮助

| 优先级 | 需要什么 | 你能得到什么 |
|:--:|------|------|
| 🔴 | **真实使用数据** | 在 docs/evidence/evidence.md 留名 |
| 🟡 | **跨平台测试** | Codex / Hermes / Claude Code 运行报告 |
| 🟡 | **英文翻译** | Handbook 目前只有中文 |

> 你不需要会写代码。跑一周 sofagent，回来告诉我们发生了什么——不管好坏。

---

## Seeking Co-maintainers

sofagent 当前维护者为孔放勋一人。不设申请制——贡献自然累积，作者主动邀请：

| 级别 | 条件 | 能做什么 |
|------|------|---------|
| **Contributor** | 无门槛 | 提 Issue / 发 PR |
| **Triage** | 合并 PR ≥1 或有效 Issue ≥3 | 分流 Issue / 打标签 |
| **Co-maintainer** | 合并 PR ≥5 + 持续 ≥2 月 + 作者邀请 | review 和合并 PR |

**急需的技能方向**：

| 方向 | 具体做什么 | 每周时间 |
|------|------|:--:|
| **bash BSD/macOS 兼容** | install/verify/uninstall 跨平台修复 | 2-4 小时 |
| **安全审计** | 审查 SECURITY.md + 企业合规缺口 | 不限 |
| **OpenClaw hook (TS)** | handler.ts 回归测试 + 升级适配 | 2-3 小时 |
| **英文文档** | HANDBOOK + README 英文翻译 | 不限 |

> 🔴 如果你是 bash 方向开发者，先开 Discussion 与维护者聊聊方向（早期接触不算正式申请，正式标准见下方「Seeking Co-maintainers」）。

---

## 行为准则

> **对人客气，对事尖锐。** 批评设计没问题，批评人不行。别把 Issue 区变成战场——但设计决策值得被尖锐地质疑，礼貌地。

完整行为准则基于 [Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct.html)，详见 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。

---

## License

本项目采用 MIT 许可证。你贡献的代码和文档默认跟随 MIT。详见 [LICENSE](./LICENSE)。

---

## 成为维护者

sofagent 当前 bus factor = 1（唯一维护者）。上面的「Seeking Co-maintainers」表是正式标准（合并 PR ≥5 + 持续 ≥2 月 + 作者邀请）；如果你已满足以下早期信号中的至少 2 条，可以先开 Discussion 与维护者聊聊方向——早期接触不算正式申请：

- 提交过 3+ 个被合并的 PR
- 熟悉 bash 兼容性 / OpenClaw hook / 安全审计 / 英文文档 中至少一个领域
- 能独立 review 他人的 PR

联系方式：开 [Discussion](https://github.com/KongFangXun/sofagent/discussions)
