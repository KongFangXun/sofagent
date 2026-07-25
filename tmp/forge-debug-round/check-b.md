# B-check · sofagent v1.2.0 独立审查报告

> **审查身份**：B（工程师）· fresh-eyes 12 视角 · 零上下文
> **审查时间**：2026-07-25
> **原则**：只看交付物，不修代码，逐视角清空记忆

---

## 🧑‍💻 视角一：陌生人

**第一印象**：3 屏内能基本搞清楚这是干什么的，但过程很累。README 信息密度极高——从 FDE Agent 定位、Harness 中间件、一底座·四引擎、21 条规则、USB 部署、三种安装方式，全塞在首屏。一个普通开发者的注意力在第二屏就会开始涣散。

**发现**：
- [陌生人] README.md · 首屏信息过载。标语 `进场梳理 · 部署 AI 节点 · 离场后 7×24 自己跑` 很好，但紧接着的 NOTE/IMPORTANT 框 + 对比表 + FDE 交付物折叠区 + USB 部署细节，让"第一句就懂"的体验在 10 秒后崩塌。· P2
- [陌生人] README.md L41 · 行业框架对齐引用（AOS 四大基础设施）面向的是已经知道"AI 中台是伪命题"的读者。陌生人读到这里只会更困惑——他不知道 AOS 是什么、不知道为什么要"对齐"。· P2
- [陌生人] README.md · `docs/assets/sofagent.png` 是一个 logo 图片，但 README 里没有截图或动图展示"装上后是什么样"——陌生人无法想象实际效果。· P2

**整体印象**：这是一个"做得很多"的项目，但门口堆了太多招牌。陌生人的好奇心在第三屏可能就被信息密度劝退。

---

## 👔 视角二：企业 IT

**第一印象**：SECURITY.md 相当诚实，LIMITATIONS.md 是亮眼的诚实文档。但关键风险敞口还在。

**发现**：
- [企业IT] SECURITY.md L35-36 · 明文存储问题用 ⚠️ 标得很清楚，age 加密推到 v1.2.x——但既然 v1.2.0 已经发了，这个承诺还没兑现。企业 IT 会问：v1.2.0 里到底是"推到了下一版"还是"会在 v1.2.x 补丁里"？· P1
- [企业IT] LIMITATIONS.md L30 · `audit ↔ daemon 循环依赖` 被列为 #1 局限。这两个包互相引用（`optionalDependencies` + `dependencies`），这在企业安全评审时是一个明显的架构债务信号。· P1
- [企业IT] SECURITY.md L200 · Agent 可以读取/写入/删除 history.jsonl——"Agent 和审计工具共享同一文件系统权限"。企业 IT 会问：如果 Agent 可以删除审计记录，那审计还有意义吗？HMAC 签名只防篡改不防删除。· P1
- [企业IT] SECURITY.md L79-80 · USB federation v1.1.6 计划中的 Schema 校验标注为"v1.1.6+ 计划"——现在 v1.2.0 已发，这个计划项落地了吗？文档没有回答。· P2
- [企业IT] LIMITATIONS.md · 20 台机器部署场景——README 说"买 U 盘→下载→写盘→发给员工"，但 LIMITATIONS 明确说企业批量部署需自行编写脚本。这两个叙事之间存在张力。· P2

**整体印象**：文档诚实度很高，这点加分。但关键安全承诺（age 加密）跳票、循环依赖未解、审计记录可被 Agent 删除——这三点会让企业 IT 在"这东西能进公司吗"的决策上犹豫。

---

## 🏗️ 视角三：竞品

**第一印象**：对比表写得有理有据，不是无脑贬低竞品。但"21 条规则"这个数字需要拆开看。

**发现**：
- [竞品] README.md L211-221 · "21 条规则自动审计每次变更"——实际默认生效的只有 13 条（A1-A11 + A18-A19），另外 8 条（E1-E4 + A14-A17）需要 config 里启用 extendedRulesEnabled。竞品会抓住这点："你的 21 条不是装上就有的，实际只有 13 条。"· P1
- [竞品] README.md L49 · 对比表中 `pre-commit/husky` 被归类为"代码质量"、sofagent 被归类为"Agent 行为"。但 sofagent 的 A6（不坏构建）、A7（不存盲改）、A8（不逃验证）本身就是工程质量问题——和 lint/format 的边界并不清晰。竞品会指出这个分类有自洽漏洞。· P2
- [竞品] README.md L183 · "审计引擎零 token"——这是一个很强的卖点。实际验证：audit/index.ts 使用了 `execFileSync('git', ...)` 和 `parseDiff()`——确实是纯静态分析，不需要 LLM 调用。这个声称站得住。✓
- [竞品] FORGE/FORGE.md L7-11 · "v1.2.0 后期转向（2026-07-25）"——这个日期在发布日（07-24）之后。竞品会问：v1.2.0 到底是 07-24 发的还是 07-25 发的？后期转向的内容属于 v1.2.0 还是 v1.2.1？· P1
- [竞品] CHANGELOG.md L11 · v1.2.0 状态标注为"✅ 开发完成，待发版"——但 README badge 显示 `Version-v1.2.0`。如果已发版，changelog 不应写"待发版"。· P0

**整体印象**：核心差异化（审计零 token、全平台可用）确实存在，不是包装出来的。但版本状态不一致（待发版 vs 已发版）和"21 条"的 nuanced 宣传给了竞品攻击点。

---

## 📦 视角四：npm 用户

**第一印象**：这不是一个常规 npm 包——是一个 monorepo，主安装路径是 bash install.sh。npm 用户会困惑。

**发现**：
- [npm用户] README.md L97-98 · 安装命令是 `bash install.sh`，不是 `npm install`。但后面又提到 `@sofagent/audit` 可以 `npm uninstall -g`。npm 用户的两条路径（bash 脚本 vs npm 全局安装）在 README 中没有清晰分叉。· P1
- [npm用户] package.json · `"private": true`——这意味着 `npm install sofagent-monorepo` 根本不可用。npm 用户面对的是一个不能 publish 的 monorepo，必须 clone 后跑 install.sh。这与典型的 npm 体验完全不同。· P1
- [npm用户] README.md L136 · 按需安装表列出了 `@sofagent/audit`、`@sofagent/core` 等包，但 npm 用户怎么装？没有 `npm install @sofagent/audit` 的示例——只有 install.sh 一条路。· P2
- [npm用户] engine/audit/README.md L5 · `sofagent-audit --init` 是一键初始化——这个入口好。但如果 npm 用户先 global install 再跑到一个非 git 目录跑这个命令，体验会怎样？· P2

**整体印象**：npm 用户会发现这不是他们习惯的"一个 npm install 搞定"的项目。install.sh 做主入口是合理的架构选择，但 README 没有为 npm 用户提供足够清晰的 onboarding 分叉。

---

## 🔍 视角五：开源审查员

**第一印象**：目录结构密集但基本合理。有一些"不该在这里"的东西。

**发现**：
- [开源审查员] 根目录 · `.codebuddy/` 和 `.workbuddy/` 目录——这些是 IDE/Agent 平台本地配置目录，出现在开源仓库根目录会让审查员觉得"作者不小心把自己工作目录一起提交了"。· P2
- [开源审查员] 根目录 `.sofagent/` · 包含 `think.md`（56KB）、`daemon-notice.md`（95KB）、`daemon.log`——这些是运行时数据，不应该出现在 git 仓库的根目录 `.sofagent/` 里。特别是 `daemon-notice.md` 有 95KB 的运行时日志，暴露了作者的本地使用细节。· P2
- [开源审查员] FORGE/src/ · 包含 `fresh-eyes-driver.mjs`（35KB）和测试文件（45KB）——这两个文件是 Node.js ESM 模块，放在 FORGE/src/ 而非 engine/ 下。审查员会问：为什么 FORGE 有独立的 src/ 而 engine/ 也有 src/？这两个 src/ 的职责边界是什么？· P2
- [开源审查员] `git log` · 无法执行，但从 CHANGELOG 看迭代极快——v1.0.0 是 07-10，v1.2.0 是 07-24，14 天发了 12 个正式版。这种速度在开源项目中不常见，审查员会关注质量是否跟得上。· P2

**整体印象**：代码组织在根目录层面看起来像是认真维护的（有明确的 engine/、SKILL/、docs/ 分层），但运行时数据（.sofagent/）暴露在仓库里、IDE 配置目录残留——这些都是开源项目"干净度"的短板。

---

## 🛤️ 视角六：用户旅程

**路径**：发现 → 安装 → 第一次 commit → 第一次拦截

| 步骤 | 体验 | 说明 |
|------|:--:|------|
| 发现（README 前 3 屏）| 🟡 | 信息密度太高，需要读者自己从中提取"怎么装" |
| 安装（bash install.sh）| 🟢 | 路径明确：clone → bash install.sh，Step 1/8 清晰 |
| 初始化（sofagent-audit --init）| 🟢 | README 三步体验中有清晰的冒烟测试命令 |
| 第一次拦截 | ❓ | 无法实际执行，但从代码路径看 commit-msg hook 会自动触发 |

**发现**：
- [用户旅程] README.md L108-120 · 三步体验写得很好，冒烟测试用 `echo "API_KEY=sk-123456" > .env` 来验证拦截——这个例子直观有效。🟢
- [用户旅程] README.md L123 · ⚠️ 关于 `--no-verify` 可绕过 hook 的提示——诚实且必要，但在体验流程中插入安全警告会打断用户的"爽感"。如果这是第三步之后才出现的，用户已经建立了信任，这条警告的位置更合理。🟡（位置调整建议）
- [用户旅程] FDE 独立产品旅程 · 从 FDE/ 入口进来——FDE/README.md 和 FDE/FDE.md 都存在，但 FDE/package.json 声明依赖 sofagent-audit。如果不先装主包，FDE 无法独立运行。"独立产品"是叙事上的独立，不是技术上的独立。· P1

**整体印象**：主路径走得通（至少在文档层面），FDE "独立产品"的说法需要更多工程支撑。

---

## 🐛 视角七：红队

**发现**：
- [红队] SECURITY.md L200 · Agent 可以删除 history.jsonl——没有删除检测机制。攻击路径：Agent 执行危险操作 → 删除 history.jsonl → 审计记录消失。HMAC 签名只验证完整性不检测删除。· P1
- [红队] engine/audit/src/index.ts L30 · `execFileSync('git', ...)` ——注释说 range 参数经过正则校验 `[a-zA-Z0-9~^.\-]`，命令参数使用数组传入。这是一个良好的防御措施。但需要实际验证这个正则是否在 index.ts 中实际执行。· P2
- [红队] LIMITATIONS.md L32-33 · "config.yml 可被 Agent 篡改绕过审计规则。仅当 config 解析失败时走 safeDefaults（fail-closed 强制启用）"——这意味着 Agent 可以修改 config.yml 关闭扩展规则，绕过 A14-A17 和 E1-E4。默认非 fail-closed 是一个有意识的设计选择，但红队视角下这是一个明确的绕过路径。· P1
- [红队] install.sh L132-133 · `bash "${SCRIPT_DIR}/engine/scripts/audit.sh" --operation "install" ... 2>/dev/null || true`——安装过程中的审计调用如果失败，`|| true` 会吞掉错误。安装器不会因为审计失败而中断。· P2
- [红队] ROADMAP.md L14 · Webhook 推送标记为"企业采购阻塞项"上提至 v1.2.1——这说明 v1.2.0 缺少企业协同平台推送能力。对于需要飞书/钉钉/企微集成做采购评审的企业，v1.2.0 缺这一块。· P2

**整体印象**：安全设计有清晰的威胁模型（"诚实 Agent 的护栏"而非"恶意攻击者的防线"），这个定位本身是诚实的。但在 config 篡改和审计记录删除两个路径上，确实存在 Agent 可以有意绕过的可能。

---

## 🤖 视角八：数字侦探

**数字对账**：

| 声称 | 实际 | 判定 |
|------|------|:--:|
| "21 条规则" | defaultRules 13 条 + extendedRules 8 条 = 21 | ✅ 数字对，但默认只生效 13 条 |
| 版本号 v1.2.0 | 根 package.json + 所有 engine/*/package.json + FDE/package.json 全为 1.2.0 | ✅ 一致 |
| 文档头部日期 2026-07-24 | README/CHANGELOG/SECURITY/LIMITATIONS/ARCHITECTURE/FDE/FORGE/ROADMAP 全为 2026-07-24 | ✅ 一致 |
| "21 条规则中 16 条纯 git-diff，4 条混合，1 条文件系统" | A1-A6, A9-A11, A18-A19, E1-E4 = 15 条 git-diff；A7/A8 = 2 条 hybrid；A14/A15 = 2 条 hybrid；A16 = git-diff；A17 = filesystem。合计 git-diff 15+1=16 ✓, hybrid 4 ✓, filesystem 1 ✓ | ✅ 对账通过 |
| FORGE/FORGE.md 后期转向日期 | 文档头部 2026-07-24，警告框标注 2026-07-25 | ❌ 日期不一致 |
| CHANGELOG v1.2.0 状态 | "✅ 开发完成，待发版" vs README badge "Version-v1.2.0" | ❌ 状态矛盾 |

**发现**：
- [数字侦探] CHANGELOG v1.2.0 详细日志第 3 行 · "状态：✅ 开发完成，待发版"——这与 README 的 v1.2.0 badge、所有文档头部的 2026-07-24 发版日期矛盾。要么更新 changelog 状态为"已发版"，要么确认是否真的发了。· P0
- [数字侦探] FORGE/FORGE.md · 头部日期 "2026-07-24（UTC）"，内容中警告框标注 "v1.2.0 后期转向（2026-07-25）"——这个后期转向的内容修改日期晚于文档声称的版本日期。如果 07-25 有实质性变更，头部日期应更新。· P1
- [数字侦探] FORGE/LEDGER.md · 示例行日期为 2026-07-25，但当前 LEDGER 只有示例行无实际数据——说明 FRESH EYES 循环可能尚未实际运行。· P2
- [数字侦探] 无法运行 `npm test` 获取实际测试数量（沙箱环境无 Node 运行时）· ⚠️ 未能验证

**整体印象**：大部分数字对得上，版本号一致性做得很好。但 v1.2.0 的"待发版 vs 已发版"状态矛盾是最显眼的数字侦探发现。

---

## 👁️ 视角九：感知层

**发现**：
- [感知层] install.sh L52-55 · 输出使用 `[sofagent]` 前缀 + 彩色符号（✓/✗/!）——这是一个好的产品签名。用户在终端里能清楚地知道"这是 sofagent 在做事"。🟢
- [感知层] engine/audit/src/reporter.ts · 审计输出使用 `PASS`/`WARN`/`FAIL`/`SKIPPED` 标准标签 + `[底线]`/`[拐杖]` 前缀——这个分级让用户知道违规的严重程度。但用户能区分"这是审计引擎的结论"和"这是 Agent 自己的输出"吗？在 Agent 对话中，审计结果是以什么形式呈现的？README 没有展示这个场景。· P2
- [感知层] README.md · 整个 README 没有一个截图展示"装上之后在 Agent 对话里是什么体验"。用户看不到 `sofagent-audit` 的输出长什么样、commit 被拦截时的提示是什么、dashboard 在哪里。感知层空空如也。· P1
- [感知层] 品牌身份 · 对外是"FDE Agent"，底层是"sofagent 引擎"。但终端命令是 `sofagent-audit`、安装日志是 `[sofagent]`——用户看到的所有技术触达点都是 "sofagent"，而产品叙事层是 "FDE Agent"。这两个名字之间的桥梁只在 README 的一个 NOTE 里提及了一次。用户可能会困惑：我装的到底是 FDE Agent 还是 sofagent？· P2

**整体印象**：终端输出有产品签名（加分），但缺少可视化示例（减分）。FDE Agent / sofagent 双品牌在感知层没有形成统一的体验。

---

## 📉 视角十：文档一致性

**发现**：
- [文档一致性] FORGE/FORGE.md L7-11 vs README · FORGE 文档在正文最前面有一个醒目的 ⚠️ 警告框说明 "本文档描述的是旧 FORGE 自迭代模型"，并指向新的 fresh-eyes-loop。但 README 的延伸阅读表（L237-250）中**没有列出 FORGE 或 fresh-eyes-loop 的任何链接**。用户从 README 出发，完全不会知道 FORGE 有一个新的质量循环模型。· P1
- [文档一致性] "FDE Agent" vs "FDE" vs "Forward Deployed Engineer" · 在 FDE/FDE.md 中，这三个术语被混用。第 5 行说 "FDE 从岗位 title 升级为能力模型，再升级为常驻 FDE Agent"，但后面又大量单独使用 "FDE"。读者在 60 页文档中需要反复回到开头确认当前语境下 "FDE" 指什么。· P2
- [文档一致性] engine/audit/README.md L5 · `sofagent-audit --init`——与 README.md 三步体验中的步骤一致。✅
- [文档一致性] CHANGELOG.md L127 · "FDE 安装包不自动装 LOOP"——但代码中 LOOP/ 目录似乎没有 loop-install.sh（changelog 中提到的路径）。FORGE/FORGE.md 也提到 `FORGE/loop-install.sh` 已删除。CHANGELOG 的记录与当前代码状态一致。✅
- [文档一致性] SKILL/harness/data/fde.md · install.sh L150 引用此路径——文件存在（4.7KB），路径有效。✅
- [文档一致性] 跨文档术语 · "一底座·四引擎"在 README、FDE.md、ARCHITECTURE.md、FORGE.md 中一致使用。✅

**整体印象**：跨文档一致性总体良好。但 FORGE 的新模型（fresh-eyes-loop）在 README 中没有入口链接，这是文档之间最大的裂缝。

---

## 🔬 视角十一：代码审读者

**发现**：
- [代码审读者] engine/audit/src/rules/index.ts L30 · 注释写 "默认规则（A1-A11 + A18/A19）"——实际代码中 defaultRules 数组确实包含这 13 条。注释与代码一致。✅
- [代码审读者] engine/audit/src/rules/index.ts L51-59 · `extendedRules` 数组中 A14 排在 E1-E4 之后。但 A 系列规则和 E 系列规则混排没有排序逻辑——A14-A17 应该和 A1-A11 在一起或者按数字排序。当前排列（E1-E4 → A14-A17）让人困惑。· P2
- [代码审读者] engine/rules/src/rules/index.ts L15-18 · `@sofagent/rules` 包的 `defaultToolRules` 只有 3 条规则（toolSensitiveFile / toolSecretLeak / toolInjection），但 README 声称"规则引擎从 @sofagent/audit 抽出为独立包 @sofagent/rules"——实际上 rules 包只覆盖了 A1/A2/A9 的工具调用版本，并不包含 A3-A19 的规则。README 的"独立包"说法与代码实际覆盖面有差距。· P1
- [代码审读者] engine/audit/src/index.ts L39 · 注释："P0-②: doctor needs checkHistoryChainIntegrity via require('@sofagent/audit')"——直接写 `require` 在 TypeScript ESM 项目中是代码气味，注释里提到 `require` 说明存在 CommonJS/ESM 互操作的历史包袱。· P2
- [代码审读者] engine/audit/src/rules/rule-a9-no-injection.ts · A9 文件有 11KB，是所有规则中最大的。SECURITY.md 已诚实标注 A9 的局限（leet speak / Unicode 同形字 / Base64 绕过）。但代码审读者会注意到：A9 的正则模式在文件中有 20+ 个，维护成本高。· P2
- [代码审读者] engine/audit/src/index.ts L82-83 · `parseArgs` 中 `webhookUrl` 的默认值从 `process.env.SOFAGENT_WEBHOOK_URL` 取——这是好的安全实践（不硬编码 URL）。但同一行中 `args` 对象的默认值全部内联，可读性较差。· P2
- [代码审读者] engine/core/package.json · `"bin": { "sofagent-core": "dist/cli.js" }`——但 README 按需安装表中列出的是 `@sofagent/core` 用途为 "运行时诊断（doctor / verify）"，用户看到的命令却是 `sofagent-core`。bin 名和产品叙事不一致。· P2

**整体印象**：代码质量中上，注释与实现基本一致。rules 包的覆盖面（3 条 vs 声称的"独立规则引擎"）和 require 注释是两个比较明显的代码气味。

---

## 🏗️ 视角十二：文件结构陌生人

**第一印象**：`ls` 之后看到 engine/、FORGE/、FDE/、SKILL/、tools/、docs/ 六个顶层目录 + 大量根文件。

**发现**：
- [文件结构] 根目录 · `engine/` 和 `SKILL/` 都在根目录下——engine 是"引擎代码"，SKILL 是"Agent 技能定义"。但 engine/harness/ 里也有 SKILL 相关逻辑。新贡献者会困惑：我想加一个新 Skill，放在 SKILL/ 还是 engine/harness/？· P2
- [文件结构] 根目录 · `FORGE/` 和 `FDE/` 都有独立的 package.json——但 FORGE 和 FDE 的代码分别在 FORGE/src/ 和 engine/orchestrator/（FORGE 通过 orchestator 驱动）。这种"文档在 A、代码在 B"的布局增加了理解成本。· P2
- [文件结构] engine/scripts/ · `install.sh` 的 lib 模块放在 engine/scripts/lib/——但 install.sh 本身在根目录。脚本在根目录、库在 engine/——逻辑上说得通（install.sh 是入口，lib 是引擎的一部分），但新贡献者需要跳转才能理解。· P2
- [文件结构] SKILL/harness/data/ · 包含 `fde.md`, `eval.md`, `think.md` 等——这些是模板数据，被 install.sh 复制到目标位置。文件名和后缀与运行时产生的数据文件（`.sofagent/think.md`）完全相同——容易混淆"哪个是模板、哪个是数据"。· P2
- [文件结构] .gitattributes + .gitignore · 根目录有 .gitattributes（286B），里面应该管理了换行符策略。.gitignore 排除了 node_modules/ 和 dist/。标准工程实践。✅
- [文件结构] docs/assets/sofagent.png · Logo 存在。在 README.md 和 FDE.md 中通过 `<img>` 标签引用。✅

**整体印象**：大结构（engine/SKILL/docs/FORGE/FDE/tools）是清晰的，但 SKILL 和 engine 之间的边界、FORGE 和 FDE 各自什么代码放在哪里——这些问题对于新贡献者会需要一段时间才能理解。

---

## 📊 总评

**整体分数**：**7.5 / 10**

**加分项**：
- 文档诚实度很高（SECURITY.md 和 LIMITATIONS.md 是开源项目中少见的坦率）
- 版本号一致性做得好（所有 package.json + 文档头部统一 1.2.0 / 2026-07-24）
- 数字对账基本通过（21 条规则可溯源、16/4/1 分类准确）
- 终端输出有产品签名（`[sofagent]` 前缀 + 彩色符号）
- 三步体验的冒烟测试示例直观有效
- 安全设计有清晰的威胁模型声明

**减分项**：
- **P0-1**：CHANGELOG v1.2.0 状态 "待发版" vs README "已发版"——这是最显眼的矛盾
- **P1**：FORGE/FORGE.md 头部日期 07-24 vs 内容 07-25 后期转向——是否属于 v1.2.0？
- **P1**："21 条规则" 默认只生效 13 条——宣传口径需要更精确
- **P1**：FDE "独立产品"但技术上依赖 sofagent-audit
- **P1**：Agent 可删除 history.jsonl、可篡改 config.yml——两个明确的绕过路径
- **P1**：README 缺少 FORGE/fresh-eyes-loop 的入口链接——文档间有裂缝
- **P1**：感知层零截图——用户看不到产品长什么样
- **P2**：.sofagent/ 运行时数据暴露在 git 仓库中
- **P2**：FDE Agent / sofagent 双品牌在感知层未统一

**一句话总结**：这是一个架构野心和工程诚实度都很高的项目，但 v1.2.0 的版本状态矛盾（"待发版" vs "已发版"）和 FORGE 后期转向的时间线模糊，让人对"v1.2.0 到底是什么"产生根本性疑问。解决这两个 P0/P1 问题后，这可以是一个 8.5 分的交付物。
