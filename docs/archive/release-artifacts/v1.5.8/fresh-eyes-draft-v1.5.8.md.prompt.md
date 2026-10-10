<!-- 降级产物：LLM 调用失败（This operation was aborted）——把下面 prompt 粘贴给任意 AI session 执行；粘贴执行完即可删除本文件 -->

## System

你是 sofagent 项目的独立审查员。任务：从 16 个视角对本次变更生成审查草稿，供人工复核与 driver 兜底取证。

16 视角（完整清单，一个不减——详细指引见 playbook/fresh-eyes-review.md）：
  视角1 陌生人
  视角2 企业 IT
  视角3 竞品维护者
  视角4 npm 用户
  视角5 开源审查员
  视角6 用户旅程
  视角7 红队
  视角8 数字侦探
  视角9 感知层
  视角10 文档一致性
  视角11 代码审读者
  视角12 文件结构陌生人
  视角13 技术编辑
  视角14 对外形象分析师
  视角15 外部开发者通读
  视角16 资深架构师

每个视角的输出要求：
- 以该视角的身份与心态审视「来源」内容（不是全仓库——聚焦本次变更）
- 每视角给出 0-3 条发现（没有就写「无发现+一句理由」，禁止硬凑）
- 每条发现：视角 / 文件或位置 / 问题描述 / 优先级（P0 阻塞 / P1 应修 / P2 建议）+ 证据缺口（需要 driver 定点取证的标注「待取证」）

输出格式（严格遵守）：
# fresh-eyes 审查草稿 v1.5.8（16 视角 · 单次生成）

## 视角1：陌生人
（发现列表或「无发现」）

…（16 个视角逐个成节，顺序固定）…

## 视角16：资深架构师
（发现列表或「无发现」）

## 草稿层局限声明
- 本草稿基于 diff + changelog 文本理解，未跑命令未读全文件——「待取证」项必须经 fresh-eyes-driver 或人工复核后才可当结论

纪律：
- 只基于来源内容审查，不臆造来源里没有的发现
- 发现必须能定位到 diff/changelog 中的具体位置
- 16 视角全部输出（含「无发现」），缺一个视角 = 草稿不完整

## User

当前版本：v1.5.8
已加载来源：git diff（本版变更）、changelog 交付清单


### 来源：git diff（本版变更）（/tmp/v158_review.diff）

diff --git a/.cursor/rules/sofagent.mdc b/.cursor/rules/sofagent.mdc
index 10039e1ba..b291ec462 100644
--- a/.cursor/rules/sofagent.mdc
+++ b/.cursor/rules/sofagent.mdc
@@ -26,7 +26,7 @@ alwaysApply: true
 
 ## 审计强制（平台无关）
 
-约束是建议性的，审计是强制性的——提交前审计走 **git hook**（`sofagent audit --install-hook`），与宿主平台无关：25 条 git diff 规则 + HMAC 链审计在 Cursor 下同样生效。
+约束是建议性的，审计是强制性的——提交前审计走 **git hook**（`sofagent audit --install-hook`），与宿主平台无关：28 条 git diff 规则 + HMAC 链审计在 Cursor 下同样生效。
 
 ## 连接 MCP Server
 
diff --git a/.github/workflows/sofagent-audit.yml b/.github/workflows/sofagent-audit.yml
index b51a46b55..5187c03f5 100644
--- a/.github/workflows/sofagent-audit.yml
+++ b/.github/workflows/sofagent-audit.yml
@@ -103,7 +103,7 @@ jobs:
           PR_URL: ${{ github.event.pull_request.html_url }}
         run: |
           if gh pr view "$PR_URL" --json reviews --jq '[.reviews[] | select(.state == "APPROVED")] | length' | grep -q '^0$'; then
-            gh pr review "$PR_URL" --approve --body "✅ sofagent-audit PASS（25 规则零违规）。bot 自动 approve，merge 决策保留给维护者。" || echo "⚠️ approve 写入失败（fork PR 只读令牌），绿灯由维护者手动给"
+            gh pr review "$PR_URL" --approve --body "✅ sofagent-audit PASS（28 规则零违规）。bot 自动 approve，merge 决策保留给维护者。" || echo "⚠️ approve 写入失败（fork PR 只读令牌），绿灯由维护者手动给"
           else
             echo "已有 approve，跳过"
           fi
diff --git a/AGENTS.md b/AGENTS.md
index c8863ed7b..d80fd6913 100644
--- a/AGENTS.md
+++ b/AGENTS.md
@@ -31,7 +31,7 @@ model_instructions_file = "~/.sofagent/skills/sofagent/SKILL.md"
 
 ## 审计强制（平台无关）
 
-约束是建议性的，审计是强制性的——提交前审计走 **git hook**（`sofagent audit --install-hook`），与宿主平台无关：25 条 git diff 规则 + HMAC 链审计在 Codex 下同样生效。
+约束是建议性的，审计是强制性的——提交前审计走 **git hook**（`sofagent audit --install-hook`），与宿主平台无关：28 条 git diff 规则 + HMAC 链审计在 Codex 下同样生效。
 
 ## 连接 MCP Server
 
diff --git a/CHANGELOG.md b/CHANGELOG.md
index 327fd7797..6db8b2c70 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -15,7 +15,7 @@
 > 尚未实现的规划版本（标注"尚未实现"）在 `docs/changelog/` 下对应版本目录中（如 `v1.5/`、`v1.6/`–`v1.9/`、`v2.0/`），**不纳入本索引**；已开发完成但未发版的版本纳入本索引并附「待发版」状态标注——tag/npm/package.json 在发版时统一同步。
 
 - **v1.5.7** — 🔍 审计模块·覆盖面扩展与能力面治理——2026-10-08 已发版：SMB 场景审计（勾稽/溯源/口径三判据）· 审计规则 25→**28 条**（E5 数据产物 / E6 提示注入 / E7 决策质量）· 决策类型 17→**18 值**· 浏览器底座退役 · 能力面治理（SkillOps 五维 + 遥测 status/durationMs + 可拔契约 18 单元）· 评估三件（UI=不实做 / 国标 5 标准 10 差距 / ACS=不采纳）
-  ——MCP **104** · 测试 5661→**5842**（+181，workspace 13 包）· acceptance **483** 全绿· [开发日志](./docs/changelog/v1.5/v1.5.7.md)
+  ——MCP **104** · 测试 5661→**5842**（+181，workspace 13 包）· acceptance 场景 **401** 全绿（断言 483/483）· [开发日志](./docs/changelog/v1.5/v1.5.7.md)
 - **v1.5.6** — 🧭 存量收敛·单入口与数据面——2026-10-04 已发版：CLI 单入口收敛（13 bin → 单入口 + 12 shim）· 数据生命周期治理（记忆分层归档 · 审计链历史段归档 · doctor 数据健康度 · 记忆项目作用域）· 文档与安装面修复批（21 项）——MCP **104** · 测试 5642→**5661**（13 包）· acceptance **479**（场景 397，双口径见[开发日志](./docs/changelog/v1.5/v1.5.6.md#实现纪要2026-10-02--10-04--四波次)） · [开发日志](./docs/changelog/v1.5/v1.5.6.md)
 - **v1.5.5** — ⚡ 执行模块·执行状态机与按需加载——2026-10-01 已发版：全节点执行状态机 · Tool search 按需加载（BM25+中文 2-gram）· 多 Agent 阵型调度（六阵型三态）· 编排依赖治理（langgraph 降 optional）· README 理念主线重写——MCP **104** · 测试 5569→**5642**（13 包）· acceptance 388→**395** · [开发日志](./docs/changelog/v1.5/v1.5.5.md)
 - **v1.5.4** — 🎯 执行模块·模型路由与凭证验证——2026-09-30 已发版：路由决策链（三级路由/敏感强制本地/硬拒）· 凭证隔离 Vault · 多实例自验证表决 · AI 节点治理接入 · 授权/凭证对账——MCP 103→**104** · 测试 5408→**5569**（13 包）· acceptance 377→**388** · [开发日志](./docs/changelog/v1.5/v1.5.4.md)
diff --git a/CONTRIBUTING.md b/CONTRIBUTING.md
index 65420a2f1..83121360e 100644
--- a/CONTRIBUTING.md
+++ b/CONTRIBUTING.md
@@ -184,6 +184,8 @@ bash install.sh && bash engine/scripts/verify.sh
 
 代码主要由 AI 模型辅助生成，作者做产品决策和终审。PR 经 AI review 后作者终审。**Co-maintainer 诱因**：合入 5 个 PR → Admin；贡献跨平台修复 → README 留名；完成英文翻译 → 英文文档 Owner。
 
+> 📌 **提交者身份约定**：统一使用 `git config user.name KongFangXun`（与 GitHub 账号 [KongFangXun](https://github.com/KongFangXun) 一致；文档署名「孔放勋」与该账号为同一作者，关联说明见 [WIKI · 文件地图](./docs/WIKI.md#五文件地图)）。历史 11 条 `author=test` 提交与 `孔放勋`/`KongFangXun` 双身份并存属早期工具配置残留，**不改写历史**（冻结），本约定自登记起对新提交生效。
+
 ## 开发环境 + 发版
 
 ```bash
diff --git a/FDE/GUIDE.md b/FDE/GUIDE.md
index bd38f55f2..224e707c7 100644
--- a/FDE/GUIDE.md
+++ b/FDE/GUIDE.md
@@ -606,7 +606,7 @@ FDE 交付不只是建 Ontology 和部署——还要识别哪些失效模式会
 | 失效模式 | RPN | sofagent 怎么防 |
 |---|---|---|
 | Agent 身份权限误判（继承人的角色权限，越权操作） | 高 | 独立身份 + 最小 scope token + 季度复核（v1.3.7 沙箱） |
-| 无审计追溯（出事后无法归因、无法举证） | 高 | 六项必留痕 + 审计模块 25 条规则（v1.3.0 运行时审计补全） |
+| 无审计追溯（出事后无法归因、无法举证） | 高 | 六项必留痕 + 审计模块 28 条规则（v1.3.0 运行时审计补全） |
 | 范围蔓延（试点期不断新增对象类型，工期和人月双超） | 中 | RFC 流程 + 内核契约边界 + 复用率 <30% 暂停新用例 |
 | 中止开关无人具名（无人能紧急叫停 Agent 写入） | 中 | FDE 离场前具名中止负责人 + 季度演练 |
 | 隐性成本爆（数据清洗/合规/运维不在报价单上） | 中 | 进场时 1.5-2 系数 + 季度对账更新 |
@@ -903,7 +903,7 @@ AI 节点跑起来后，自动生成这些文件：
 | AI 行业 | `industry: ai` | `sofagent-ruleset-ai`（模型选型审计 + agent 安全治理） |
 
 - 标注放在 context.md 顶部 frontmatter（`industry:` 字段），部署时约束层读它决定加载哪个 overlay
-- 未标注行业 = 只跑 25 条默认规则，不加载任何 overlay（保守默认）
+- 未标注行业 = 只跑 17 条默认规则，不加载任何 overlay（保守默认）
 - overlay 复用 `--ruleset` 机制（v1.2.9），与规则市场同一加载通道
 
 ### 5.10 离场：五大能力
@@ -932,7 +932,7 @@ AI 节点跑起来后，自动生成这些文件：
 > | 产品化率 | ≥1.0 功能/engagement | 每次部署沉淀的可复用功能 |
 > | 复用率 | 12 个月 ≥70% 代码在主仓 | 从定制退化为产品的反向指标 |
 >
-> ⚠️ **口径声明**：以上是**传统 FDE 行业的验收阈值参考**（以 1650 测试 / 158 场景为例），**非 sofagent 当前验收标准**。sofagent 自有量化体系：测试数与验收场景数以门禁脚本实跑为准（`tools/check/test-count.sh` / `playbook/acceptance-test.sh` 头部声明）· 25 条规则。
+> ⚠️ **口径声明**：以上是**传统 FDE 行业的验收阈值参考**（以 1650 测试 / 158 场景为例），**非 sofagent 当前验收标准**。sofagent 自有量化体系：测试数与验收场景数以门禁脚本实跑为准（`tools/check/test-count.sh` / `playbook/acceptance-test.sh` 头部声明）· 28 条规则。
 >场景数口径 = `acceptance-test.sh` 中 `scenario` 调用行数，SSOT 由 `check-review-system.sh` 对账，**不等于最大 S 编号**——S 编号间有历史空洞号，勿按编号去重计数。此处仅作行业参考，帮助 FDE 评估自身交付成熟度。
 
 ### 5.11 案例：一次完整交付
@@ -1123,7 +1123,7 @@ FDE 工作全链路的指标体系，按四个层面组织。每层挑 1-2 个
 | ⑤ | **对「客户要求但不该做的事」说不** | 真正的专业不是满足客户的一切要求，而是敢于引导客户走向对他真正有利、也对世界无害的方向。说不的底气来自你账上有别的客户——所以道德从来也和商业模式有关 |
 | ⑥ | **记住你代表的是「技术」本身** | 对很多客户而言，你是他们接触 AI 的第一副面孔。你的每一次夸大都在透支整个行业的信用，每一次兑现都在为整个行业存款。你设计的护栏也在替普通人做决定——不能假设把关的人永远清醒 |
 
-> 💡 **sofagent 的工程呼应**：这六条底线不是空洞口号——sofagent 的约束层是它们的工程实现。① 数据主权→数据不出本机 + 联邦查询可选 + sensitivity 分级；② 诚实报告→审计模块 git diff 硬证据（不粉饰）；③ 不制造依赖→MIT 开源 + 交付物客户可自主维护 + FDE 离场机制；④⑤→25 条审计规则（编号 A1-A24）守住底线 + HITL 钩子强制人审；⑥→产品签名（每次输出带「sofagent 审计」标识，让用户知道这是经过验证的结果）。
+> 💡 **sofagent 的工程呼应**：这六条底线不是空洞口号——sofagent 的约束层是它们的工程实现。① 数据主权→数据不出本机 + 联邦查询可选 + sensitivity 分级；② 诚实报告→审计模块 git diff 硬证据（不粉饰）；③ 不制造依赖→MIT 开源 + 交付物客户可自主维护 + FDE 离场机制；④⑤→28 条审计规则（编号 A1-A24 + E1-E7）守住底线 + HITL 钩子强制人审；⑥→产品签名（每次输出带「sofagent 审计」标识，让用户知道这是经过验证的结果）。
 
 ### 术语表
 
diff --git a/FDE/HUMAN-FACTORS.md b/FDE/HUMAN-FACTORS.md
new file mode 100644
index 000000000..cb4ecb382
--- /dev/null
+++ b/FDE/HUMAN-FACTORS.md
@@ -0,0 +1,172 @@
+# 部署中的人的因素
+
+> **本文给交付方法论补一层「人」的判据。** 现有交付把业务判断写成文件（工作流 / 本体 / 节点），但部署能不能推进，往往不取决于文件写得对不对——
+> 而取决于房间里的人：谁的处境会因这个项目而改变、谁在用「不行」保护自己、谁的真实判断被姿态盖住。
+> 本文把这一层也做成可交付、可审计的判据。
+>
+> **适用**：进场梳理与陪跑期的部署工作；审核交付物的人；设计访谈、判定采集与协作规范的人。
+> **定位**：方法论的增补层——不替代既有交付流程，与「判断冻结成交付物」同源：人的处境也是判断的一部分。
+
+## 目录
+
+- [一、为什么部署失败多半不是技术问题](#一为什么部署失败多半不是技术问题)
+- [二、干系人图谱：交付物的第三张图](#二干系人图谱交付物的第三张图)
+- [三、访谈姿态：降位开场](#三访谈姿态降位开场)
+- [四、数据主权的第二层](#四数据主权的第二层)
+- [五、判定输入：真实判断与姿态表演](#五判定输入真实判断与姿态表演)
+- [六、协作姿态：承接者优先，阻断须带前进路径](#六协作姿态承接者优先阻断须带前进路径)
+- [七、节奏：探索期先动，交付期收口](#七节奏探索期先动交付期收口)
+- [八、验收第二维：现场是否真的改变](#八验收第二维现场是否真的改变)
+- [九、边界与风险](#九边界与风险)
+- [参考](#参考)
+
+
+## 一、为什么部署失败多半不是技术问题
+
+一次数据整合或流程改造失败后，复盘通常归因于三类：模型不够好、系统对接难、需求不清晰。这三类都是真问题，但都解释不了同一个现象——**方案在技术上成立，在组织里推不动**。
+
+推不动的常见形态：数据拿不到授权；试点部门配合一次就不再推进；评审会上人人说好，落地时处处卡壳。
+
+把镜头拉近，这些卡点都发生在「人」这一层，而且有共同结构：**每一个改造动作都会改变某些人的处境**。
+
+- 数据统一意味着信息不必再经过某个环节，该环节的议价能力随之下降
+- 流程自动化意味着某些审批动作消失，审批权的价值随之下降
+- 新工具进入意味着原有工具的使用者需要重新证明自己的价值
+
+这些都不是「不配合」的道德问题，是处境变化带来的自然反应。**把处境变化预先识别出来，是部署方法的一部分，不是人际技巧的附加项。**
+
+行业侧的对照观察：企业数据问题中，绝大多数难点在「拿到、清洗、对齐数据」，而不是在「分析数据」——而拿不到数据的原因，多数时候不在技术权限，在处境。
+
+### 判定的第四问：做进核心，还是现场定制
+
+行业一线的同一类判断还暴露了现有判定法的另一个盲区：**一个能力做出来之后放在哪**。
+做进核心平台（可复用、交付慢、需抽象）与现场定制（快、只服务本客户、易腐化）是每次交付都真实面对的岔路，
+且选错方向的代价不对称——该进核心的定制了，债务沉淀；该定制的进核心了，交付窗口错过。
+
+**第四问：这项能力做进核心平台，还是现场定制？**
+
+- 判据：**复用概率 × 交付窗口**——预判其它场景复用概率高且交付窗口允许，走核心；窗口紧或复用存疑，先定制并在交付物登记「定制标记」，供后续回收评估
+- 与既有三问的关系：三问答「哪里上 AI」，第四问答「做出来的东西放哪」——两问串联使用，输出的是完整的节点处置方案
+- 定制件必须有台账：无台账的定制 = 无人认领的债务
+
+## 二、干系人图谱：交付物的第三张图
+
+现有交付是两张图：业务图谱（工作流展开）+ 本体图谱（数据与概念结构）。
+建议增加第三张——**干系人图谱**。
+
+| 字段 | 说明 |
+|---|---|
+| 干系人 | 姓名或角色（对外交付物可匿名化为角色名） |
+| 处境来源 | 该角色在组织中的价值从哪来：信息枢纽 / 审批权 / 专业判断 / 历史功劳 / 团队规模 |
+| 项目影响 | 本项目使其处境 **上升 / 下降 / 中性**（逐人判定，不取平均） |
+| 当前姿态 | 承接者 / 观望者 / 阻挡者——**按行为判定，不按态度** |
+| 应对 | 让其处境不下滑的具体安排——不是说服，是设计 |
+
+三条使用规则：
+
+1. **影响为「下降」的干系人必须逐条给出应对**——没有应对的下降项等于埋雷，交付物视为未完成。
+2. **姿态按行为判定**：说「行不通」之后事情停下 = 阻挡者；补充条件后继续推进 = 承接者。区分标准是「之后事情有没有往前走」，不是措辞客气不客气。
+3. **图谱随陪跑更新**：处境会随项目进展变化，进场版与陪跑期版本分别留存，变更走既有留痕习惯。
+
+> 与「判断冻结成交付物」的关系：干系人图谱同样是**冻结的判断**——「谁会被影响、怎么应对」是进场就该拍板的内容，而不是推进受阻时的临时应对。
+
+## 三、访谈姿态：降位开场
+
+访谈的目标是拿到真实判断，而真实判断只在**对方感到安全**时才会出现。安全感的来源不是「我们很专业」——恰恰相反：**访谈者的姿态越高，对方给出的信息越接近「应该说的」而不是「真实的」**。
+
+可执行的开场原则三条：
+
+1. **主动降位**：开场承认自己是外行（「这套流程我完全不懂，得您教我」），把专家位置让给对方。
+2. **责任前置**：把可能的误解归到自己这一侧（「如果我的理解和您说的对不上，那是我没问对」）。
+3. **不做即时评判**：对方描述现状时不插「这个可以自动化」——评判会让对方转入防御，后续信息质量下降。
+
+降位的收益不是礼貌，是**信息质量**：对方开始纠正你、补充细节、主动说出顾虑——这些都是高价值输入。
+
+> 一个反直觉的实例：训练有素的访谈者常犯的错与受训演员相同——**太想「问对」**，于是不断自我审查，最后拿到的是一份工整但无信息量的访谈。承认外行反而放得开。
+
+## 四、数据主权的第二层
+
+数据主权通常从合规角度讲（数据不出企业、不外传）。这是第一层。还有第二层：**数据在组织内部同样不外流，原因常常不是合规，是处境**——一个部门的数据交给统一平台，该部门在协作链条上的位置会被改变。
+
+对交付的含义：
+
+- 索要数据时，直接要「访问权」会触发防御；要的是「与该部门共同定义：数据怎么用、由谁说了算、他们的位置如何不下降」
+- 数据主权条款在部门层面同样适用：企业内部跨部门的数据流动，需要明确谁授权、谁受益、谁的位置被保护
+
+第一层是法律与信任问题，第二层是处境与协作问题；**两层都处理完，数据才真正流通。**
+
+## 五、判定输入：真实判断与姿态表演
+
+判定层依赖「人给出的判断」作为输入：谁拍板、依据什么、为什么这么做。这里有一个必须处理的问题——**人在组织里说的话，不全是判断，很大一部分是姿态**。
+
+- 会议上的「同意」可能是真的同意，也可能是「不惹麻烦」的安全表态
+- 评审里的「我提个意见」可能指向真问题，也可能是为了显示存在
+- 「都听您的」既可能是授权，也可能是把责任推出去
+
+如果判定采集直接吃这些信号，训练与校准吃到的就是组织政治的噪音，而不是判断本身。
+
+三条处理原则：
+
+1. **异议要安全**：采集前先建立「提异议不影响任何评价」的明确约定；无此约定的采集，结果不可作为判定训练输入。
+2. **表态与行为不一致时以行为为准**——与「保存 ≠ 生效 ≠ 变好」的三态纪律同源：说的算表态，做的才算生效。
+3. **记录采集场合**：判断条目须标注采集方式（一对一 / 会上 / 书面），场合是判断可信度的元信息。
+
+## 六、协作姿态：承接者优先，阻断须带前进路径
+
+部署与内部协作共用一条规律：**说「之后怎么办」的人推进事情，只给否定的人把事情停下来。**
+
+但要区分两种「不」：
+
+- **杀死式否定**：「这行不通」——没有下文，信息量为零，且消耗提出者的意愿
+- **建构式否定**：「这个做法在 X 条件下会出问题，改成 Y 就能过」——同样是「不」，但事情往前走了
+
+工程体系里这条规律直接适用：**门禁与审查的输出必须是建构式的**——判红的同时给修复路径。既有的检查脚本已经在给「修复落点」与可直接执行的修复命令，这是正确的形态，应当作为**输出规范**固定下来。
+
+审查者侧还有一条自我约束：**挑错的位置越高，被指出问题的人越倾向于沉默**。审查的价值来自被审查者愿意继续交付，而不是来自审查结论正确。审查的产出应当让下一个人更愿意动手。
+
+> 需要区分的是：**对人承接，对原则有立场**。刻意的取舍（明确不做什么）会筛掉一部分合作者，这是健康筛选；但对具体的人，阻断之外必须给出路。
+
+## 七、节奏：探索期先动，交付期收口
+
+同一个团队里长期存在两种相反的要求：「别过度设计，先跑起来」与「不要留尾巴，做完再交」。它们都对，但**属于不同阶段**。
+
+| 阶段 | 特征 | 纪律 |
+|---|---|---|
+| 探索期 | 边界不清、返工成本低 | 先交出一个能跑的版本，允许不完整；目标是信息（什么可行），不是质量 |
+| 交付期 | 边界清晰、错误代价高 | 收口：测试、文档、审计全绿再交，不留尾巴 |
+
+两种阶段用两种纪律，混用会产生两类浪费：交付期追求「先动」→ 缺陷进主干；探索期追求「收口」→ 方案未定型就打磨细节，或者干脆不敢开始。
+
+**切换判据**：当「做什么」不再有争议、只剩「怎么做好」时，进入交付期。
+
+> 一个可借用的强度参照：驻场交付的公开经验是「**第一版应该让你难为情**」——探索期的高频循环（见客户、当天做、次日给人看、当晚迭代）本身就是在用频率换质量；而交付期的标准完全不适用这套节奏。
+
+## 八、验收第二维：现场是否真的改变
+
+现有验收看两样：交付物是否齐备、测试是否通过。这两样回答的是「东西做出来了吗」。还有一维没有被覆盖：**做出来的东西有没有真的改变现场**。
+
+一个改造是否成立，可以问三个问题：
+
+1. 谁的日常动作变了？（不是「多了个工具」，是「某件事的做法不一样了」）
+2. 什么决定权转移了？（谁从「必须经手」变成「可以不管」）
+3. 什么旧流程被打断了？（原来必须做的动作，现在不做也不出问题）
+
+三个问题都答不上来的交付，即便功能全绿，也只是「加了一个东西」——**加进去而没人改变做法，是常见的假成功。**
+
+这一维与既有的「保存 ≠ 生效 ≠ 变好」三态纪律同源：**「变好」的判据就是现场有没有变。**
+
+## 九、边界与风险
+
+把「人」纳入判据，有两条必须防的偏斜：
+
+- **不能退化成人际操控**：识别处境是为了让对方的安全边界被照顾，从而敢说真话、敢推进；用来压制或操纵对方，从方法上就走偏了——一旦被识别的处境被当作武器使用，后续所有访谈与协作的信息质量都会崩。
+- **不能变成对个案的过度解读**：逐次互动都按处境博弈解读，会让人疑神疑鬼，也会让真实的业务问题被误读为立场问题。这套判据的用法是**在出现「推不动」时用来定位，而不是常态化的审视**。
+
+另外，本节全部判据建立在「组织常态运作」的前提上；遇到明显的权力滥用或人事斗争场景，超出本文范围——应停下来报告，交由人判断。
+
+
+## 参考
+
+- 《即兴——即兴戏剧与剧场》（Impro: Improvisation and the Theatre），基思·约翰斯通（Keith Johnstone）· https://www.bloomsbury.com/uk/impro-9781350017962 · 1979
+- 《The Technological Republic》，Alexander C. Karp / Nicholas W. Zamiska · https://www.penguinrandomhouse.co.uk/books/465314/the-technological-republic-by-zamiska-alexander-c-karp-and-nicholas-w/9781529949926 · 2025
+- 《How Palantir built the ultimate founder factory》，Nabeel S. Qureshi · https://www.lennysnewsletter.com/p/inside-palantir-nabeel-qureshi · 2025-05
diff --git a/FDE/ROLES.md b/FDE/ROLES.md
index 0e6c778c9..59f6bec30 100644
--- a/FDE/ROLES.md
+++ b/FDE/ROLES.md
@@ -9,7 +9,7 @@
 | Workflow Designer | 工作流设计师 | ①梳理（五要素 + 三问） | 约束层：fdeing 流程、本体建模 | Greenhouse 各部门「创新负责人」重画端到端流程 |
 | Domain Anchor | 领域知识负责人 | ①梳理 + ③养护（知识资产） | 约束层：ontology、think.md、knowledge/ | Walmart 岗位「数字孪生」应对轮岗知识流失 |
 | Citizen Builder | 业务自建者 | ②部署（业务自建档） | 平台层：模板 fork、六引擎工作台 | DevRev 零技术销售运营做出 CRM Bot |
-| AI Guardian | AI 治理者 | ③养护（审计面） | 约束层：25 规则 + HMAC + 快照回溯（已交付） | Scale AI 专职团队对 Agent 系统做攻击测试 |
+| AI Guardian | AI 治理者 | ③养护（审计面） | 约束层：28 规则 + HMAC + 快照回溯（已交付） | Scale AI 专职团队对 Agent 系统做攻击测试 |
 | Agent Shepherd | Agent 运营负责人 | ③养护（运维面） | 约束层：daemon 巡检 + 插件生命周期（已交付） | Bolt.new 中央角色管 Agent 托管与异常下线 |
 
 三条读法：
diff --git a/FORGE/SKILL/fresh-eyes-loop/loop.md b/FORGE/SKILL/fresh-eyes-loop/loop.md
index 56feb5561..15ad9b86f 100644
--- a/FORGE/SKILL/fresh-eyes-loop/loop.md
+++ b/FORGE/SKILL/fresh-eyes-loop/loop.md
@@ -116,7 +116,7 @@ FORGE/SKILL/fresh-eyes-loop/runs/YYYY/MM/DD/run-NN/
 
 - **注入包本体 = 交付物**：落 runDir 存档（`injection-prompt.md`），不得只存在于对话——审计链要求每次注入可追溯。
 - **注入即授权改仓 + 跑测试**：主任务必须显式携带**越界清单**（不做 push / tag / publish、不动 FORGE 源码与审查视角定义、不改 devlog 勾选、不自称收编——复验收编是主 session 职责）。
-- **执行产生的 commit 过审计钩子**（25 条规则 + HMAC 链，机制强制非纪律约束）。
+- **执行产生的 commit 过审计钩子**（28 条规则 + HMAC 链，机制强制非纪律约束）。
 
 ## 执行器实现提示（`--worker` 单步链路）
 
diff --git a/FORGE/src/release-gate-driver.mjs b/FORGE/src/release-gate-driver.mjs
index fd875d1fb..a1c01f836 100644
--- a/FORGE/src/release-gate-driver.mjs
+++ b/FORGE/src/release-gate-driver.mjs
@@ -3586,7 +3586,11 @@ async function main() {
   //   （SOFAGENT_ACCEPTANCE_LOG 可覆盖路径），driver 兜底主动执行。
   if (!skipVPhase && args.judgmentOnly) {
     const accOutPath = join(runDir, 'acceptance.md');
-    let accRawPath = process.env.SOFAGENT_ACCEPTANCE_LOG || join(REPO_ROOT, 'acceptance-raw.log');
+    // v1.5.8 BUG-26：默认落点从仓库根（REPO_ROOT）改为 runDir——仓库根落日志会污染
+    // 工作树（曾在主工作树仓库根遗留 acceptance-raw.log，.gitignore:95 只是兜底）。
+    // runDir 是本 run 的既有产物目录，与其余 acceptance-raw.log 读写点同址、天然复用；
+    // SOFAGENT_ACCEPTANCE_LOG 显式覆盖仍最高优先。
+    let accRawPath = process.env.SOFAGENT_ACCEPTANCE_LOG || join(runDir, 'acceptance-raw.log');
     if (!existsSync(accRawPath)) {
       // 脚本层未预跑：driver 主动执行 acceptance（一次性，结果落盘 acceptance-raw.log 供复用）
       console.log('[driver] --judgment-only：未找到脚本层预跑日志，主动执行 acceptance-test.sh（一次性）...');
diff --git a/GEMINI.md b/GEMINI.md
index 4658a5996..8a2cf264c 100644
--- a/GEMINI.md
+++ b/GEMINI.md
@@ -20,7 +20,7 @@
 
 ## 审计强制（平台无关）
 
-约束是建议性的，审计是强制性的——提交前审计走 **git hook**（`sofagent audit --install-hook`），与宿主平台无关：25 条 git diff 规则 + HMAC 链审计在 Gemini CLI 下同样生效。
+约束是建议性的，审计是强制性的——提交前审计走 **git hook**（`sofagent audit --install-hook`），与宿主平台无关：28 条 git diff 规则 + HMAC 链审计在 Gemini CLI 下同样生效。
 
 ## 连接 MCP Server
 
diff --git a/README.en.md b/README.en.md
index 3f6200741..a7d298890 100644
--- a/README.en.md
+++ b/README.en.md
@@ -33,21 +33,22 @@
 
 ## What is this
 
-> 💬 **One-sentence version**: on entry, it maps your business and writes it down as files; after it leaves, etime your digital employee touches code or files, the change passes a security check, leaves a record, and saves a snapshot—traceable and roll-backable when things go wrong.
+> 💬 **One-sentence version**: on entry, it maps your business and writes it down as files; after it leaves, every time your digital employee touches code or files, the change passes a security check, leaves a record, and saves a snapshot—traceable and roll-backable when things go wrong.
 
 > 🏢 **The organizational lens**: the bottleneck of AI adoption has shifted from "is the model smart enough" to "can the organization dare to onboard it"—does it fit the org chart, does it get an account, how is performance measured, what happens when it errs. sofagent is the onboarding system for
->digital employees: on entry it writes the job description into files; after departure it runs performance reviews (evidence for echange), organizational memory (compounding know-how—the accumulation mechanism iterates with use; current empirical boundaries in
->[LIMITATIONS](./docs/LIMITATIONS.md)), and fault tolerance (emistake reversible). Install sofagent before you give AI an employee ID.
+>digital employees: on entry it writes the job description into files; after departure it runs performance reviews (evidence for every change), organizational memory (compounding know-how—the accumulation mechanism iterates with use; current empirical boundaries in
+>[LIMITATIONS](./docs/LIMITATIONS.md)), and fault tolerance (every mistake reversible). Install sofagent before you give AI an employee ID.
 
 > 🧩 **The three-factor framing**: sofagent is a **governance layer for FDE deliverables with a built-in Harness**—the engineering layer (FDEing) and the governance layer (harness) are shipped, while the judgment layer (S1M) is scheduled for v1.6.0–v1.9.0—FDEing is the engineering layer (turning
 >FDE from human labor into a reusable capability), S1M is the judgment layer (System One Model, a decision model that separates judgment
 >from generation; its foundation is under construction across v1.6.0–v1.9.0, with the declaration landing in v2.0.0), and **harness** is the governance layer (the five constraint-layer capabilities—today's main landing points). Each layer sits in its own place; see "Core Features".
+>The identity formula is settled as **FDEing × S1A (S1A = S1M + Harness)**; canonical wording in [PHILOSOPHY · identity caliber](./docs/PHILOSOPHY.md).
 
 **An open-source FDE Harness layer** (FDE = Forward Deployed Engineer, the engineer who embeds models into real enterprise
-operations; a *harness* is the governance layer that keeps eAgent change audited and reversible—see the
+operations; a *harness* is the governance layer that keeps every Agent change audited and reversible—see the
 "[What is the FDE Harness](#what-is-the-fde-harness)" section)—embedded between mature Agents (DSH / OpenClaw / WorkBuddy)
 and the model layer (general LLMs + bespoke post-trained models) to govern both: on entry, it
-writes the business judgment down as files (workflow, ontology data, AI-node deployment); after departure, it audits echange against those files.
+writes the business judgment down as files (workflow, ontology data, AI-node deployment); after departure, it audits every change against those files.
 
 Five Harness capabilities (inject · audit · rollback · distill · evolve), five distribution forms (FDE plugins / Skill / MCP / CLI / Dashboard).
 
@@ -64,7 +65,7 @@ sofagent doesn't build the Agent—it delivers the layer that keeps any Agent go
 <p align="center">
  <img src="docs/assets/architecture-diagram.png" alt="sofagent architecture: host Agent enters the FDE Harness constraint layer via MCP Server; orchestration / audit / post-training /
 governance / execution modules" width="860" /><br/>
- <sub>Constrain Agent behavior · Audit echange · Distill experience (five-module structure: governance module released in v1.5.0 · execution module released in v1.5.4/v1.5.5; full interactive
+ <sub>Constrain Agent behavior · Audit every change · Distill experience (five-module structure: governance module released in v1.5.0 · execution module released in v1.5.4/v1.5.5; full interactive
 version in <a href="./docs/ARCHITECTURE.md">ARCHITECTURE</a>)</sub>
 </p>
 
@@ -205,7 +206,7 @@ One command selects your mounting tier: `bash install.sh --platform <platform-na
 
 ## v1.5.7: Audit Coverage Expansion & Capability Governance
 
-🔍 **Audit extends to enterprises without repositories** (⏳ pending · 2026-10-08)—SMB scenarios, three new audit-input rules, browser retirement, capability-governance foundations:
+🔍 **Audit extends to enterprises without repositories**—SMB scenarios, three new audit-input rules, browser retirement, capability-governance foundations:
 
 | Capability | One-liner |
 |---|---|
@@ -399,7 +400,7 @@ npx -y -p sofagent sofagent audit --ruleset security  # load the security rulese
 | What each release did | [CHANGELOG](./CHANGELOG.md) |
 | Security statement · known limits | [SECURITY](./SECURITY.md) · [LIMITATIONS](./docs/LIMITATIONS.md) |
 
-> 🧪 **Engineering credibility** (current): 5842 tests / 13 module packages + 11 plugins (7 DSH + 4 OpenClaw) · 28 audit rules · fresh-eyes independent review continuously running.
+> 🧪 **Engineering credibility** (current): 5938 tests / 13 module packages + 11 plugins (7 DSH + 4 OpenClaw) · 28 audit rules · fresh-eyes independent review continuously running.
 > **Package-count standard** (disambiguation): workspace 27 = 13 module packages + load-chain + dsh-plugin-kit + umbrella + 7 DSH plugins + 4 OpenClaw plugins (see [WIKI §6](./docs/WIKI.md#六当前状态)); the **test-count standard** = 13 module packages (25 workspaces bear a test script; plugin packages,
 >the load-chain utility package and dsh-plugin-kit are outside this counting standard)—they'ren't the same set.
 > There are two test-count figures: the **release-time value** (the `4805 → 4903` delta account—see each version's section) and the **current measured value** (the value in the engineering-credibility line above, rolling forward with fix batches); the current authoritative value is whatever
diff --git a/README.md b/README.md
index 6b705133e..bc54f4bfa 100644
--- a/README.md
+++ b/README.md
@@ -114,7 +114,7 @@ sofagent 不造 Agent——交付的是让任何 Agent 被管住的那一层（
 - 🏠 **离场后常驻**——FDE 能力留下巡检、审计、优化，commit 时触发审计，人离场治理不离开
 - 🔍 **零配置审计**——`npx -y -p sofagent sofagent audit`，任何 git 仓库秒级审计最近一次 commit（quick 约 1.1s，口径见 [HANDBOOK](./docs/HANDBOOK.md)）
 - 🧱 **规则与安全面：28 条审计规则**——密钥泄漏、越界编辑、注入防御、权限红线，违规当场拦截；fail-fast（critical 命中后其余跳过）、默认非 fail-closed（绕过面见 [LIMITATIONS §三](./docs/LIMITATIONS.md#三安全与信任模型局限)）
-- 🔧 **工具与能力面：104 个 MCP tool + 证据两档**——28 条规则中 22 条基于 git diff（本地生效）、5 条需数据面（4 需 Agent 日志、1 走 decision-log，清单见 [SECURITY](./SECURITY.md#28-条审计规则完整清单文档级-ssot)）
+- 🔧 **工具与能力面：104 个 MCP tool + 证据分档**——28 条规则中 22 条基于 git diff（本地生效、零 token）、4 条 hybrid（diff + Agent 日志）、1 条 filesystem 扫描、1 条走 decision-log（清单见 [SECURITY](./SECURITY.md#28-条审计规则完整清单文档级-ssot)）
 - 🛡️ **自动快照回溯**——每次审计后自动存档，出事一键回到任意快照
 
 ## 什么是 FDE Harness
@@ -147,7 +147,7 @@ sofagent 不造 Agent——交付的是让任何 Agent 被管住的那一层（
 |---|---|---|---|
 | **深度结合** | DeepSeek Harness | ✅ **逐工具调用可拦** | 6 款原子 `cordis-plugin-sofagent-*` 挂进运行时（另有 1 款聚合可选）——`tools/pre-execute` 等 7 个生命周期事件（词汇表见 `engine/dsh-plugins/SEAMS.md`） |
 | **完整挂载** | OpenClaw | ✅ **每会话注入一次** | Hook 注入四层约束 + 断路器 + 4 款 OpenClaw 插件 |
-| **标准挂载** | Claude Code / Cursor | ⚠️ Skill 自觉加载 | Skill 目录 symlink + 平台规则文件 + 拦截配置（内容为提交级 25 规则，非调用级拦截） |
+| **标准挂载** | Claude Code / Cursor | ⚠️ Skill 自觉加载 | Skill 目录 symlink + 平台规则文件 + 拦截配置（内容为提交级 28 规则，非调用级拦截） |
 | **薄挂载** | WorkBuddy / Codex / Gemini CLI / Hermes | ⚠️ Skill 自觉加载 | Skill 目录 symlink（Codex 走 `AGENTS.md` 挂载点）+ git hook 审计 |
 
 - **别假设能力对齐——档位差的是注入强度，不是「有没有」**：DSH 逐工具调用可拦，OpenClaw 每会话注入一遍，其余宿主靠 Agent 自觉读 Skill 文本。「支持某平台」= 约束资产在该平台可用，**≠ 强度与他平台相同**；跨宿主迁移前先看目标宿主落在哪档，矩阵见 [加载链 HOOK](./engine/hooks/sofagent-load-chain/HOOK.md)
@@ -156,9 +156,11 @@ sofagent 不造 Agent——交付的是让任何 Agent 被管住的那一层（
 
 一条命令选定挂载档位：`bash install.sh --platform <平台名>`（全部平台与差异见 [HANDBOOK](./docs/HANDBOOK.md)）
 
+> 📌 `AGENTS.md`（Codex）/ `GEMINI.md`（Gemini CLI）/ `.claude/` / `.cursor/` 为各宿主的分层挂载点，均为对 `SKILL/` 的薄引用。
+
 ## v1.5.7：审计覆盖面扩展与能力面治理
 
-🔍 **审计扩到没有代码仓库的企业**（⏳ 待发版 · 开发完成 2026-10-08）——SMB 三判据 + 审计输入面三规则 + 浏览器退役 + 能力治理地基：
+🔍 **审计扩到没有代码仓库的企业**——SMB 三判据 + 审计输入面三规则 + 浏览器退役 + 能力治理地基：
 
 | 能力 | 一句话 |
 |---|---|
@@ -202,7 +204,7 @@ sofagent 不造 Agent——交付的是让任何 Agent 被管住的那一层（
 npx -y -p sofagent sofagent audit
 ```
 
-> 💡 quick 跑 17 条默认规则（A3 任务范围 / A9 commit-msg 注入检测——读最近一次 commit 消息，无消息时按无输入跳过）；`--init` 的 hook 默认同样 17 条，完整 28 条需在 `.sofagent/config.yml` 开 `extendedRulesEnabled: true`——详见 [LIMITATIONS §三](./docs/LIMITATIONS.md#三安全与信任模型局限)。
+> 💡 quick 跑 17 条默认（A1–A11 + A18–A23；其中 A3 任务范围 / A9 commit-msg 注入检测——读最近一次 commit 消息，无消息时按无输入跳过）；`--init` 的 hook 默认同样 17 条，完整 28 条需在 `.sofagent/config.yml` 开 `extendedRulesEnabled: true`——详见 [LIMITATIONS §三](./docs/LIMITATIONS.md#三安全与信任模型局限)。
 
 > ⚠️ 这一步是**一次性审计**（当次进程内），不装 git hook——之后 commit 不会被自动拦。要长期守护请跑 `sofagent audit --init`（见下方完整安装）。
 
@@ -324,7 +326,7 @@ npx -y -p sofagent sofagent audit --ruleset security   # 加载安全规则集
 | 每个版本做了什么 | [CHANGELOG](./CHANGELOG.md) |
 | 安全声明 · 已知局限 | [SECURITY](./SECURITY.md) · [LIMITATIONS](./docs/LIMITATIONS.md) |
 
-> 🧪 **工程可信度**（当前口径）：5842 测试 / 13 模块包 + 11 插件（7 DSH + 4 OpenClaw）· 28 条审计规则 · fresh-eyes 独立审查持续运行。
+> 🧪 **工程可信度**（当前口径）：5938 测试 / 13 模块包 + 11 插件（7 DSH + 4 OpenClaw）· 28 条审计规则 · fresh-eyes 独立审查持续运行。
 > **包数口径**（消歧）：workspace 27 = 13 模块包 + load-chain + dsh-plugin-kit + umbrella + 7 DSH 插件 + 4 OpenClaw 插件（见 [WIKI §六](./docs/WIKI.md#六当前状态)）；**测试计数口径** = 13 模块包（含 test script 的 workspace 共 25 个，插件包与工具包不计）——二者非同一集合。
 > 测试数两个口径：**发版时点值**（各版本章节的 `4805→4903` 增量账）与**当前实测值**（上方「工程可信度」行）；权威值以 `tools/check/check-test-count.sh` 实跑为准，包数标准见 [WIKI](./docs/WIKI.md#六当前状态)；审查环境见 [review-system](./docs/guides/review-system.md)；
 >性能数据为单机参考值。
diff --git a/SECURITY.md b/SEC
…（截断，原文 376826 字符）

---

### 来源：changelog 交付清单（docs/changelog/v1.5/v1.5.8.md）

# v1.5.8 开发日志 — 进化模块 · 准入门与数据面

> ✅ **已开发（2026-10-09 · 开发与基础自测完成，SOP 阶段二收口）。** 前置依赖：v1.3.5（instinct→skill 链——既有进化链）+ v1.4.8（成本 quota 事前门禁——进化循环纳入既有预算机制，不做第二套）+ 本版第一章（域验证器三档登记——考核器按域档位分流）+ v1.4.7（TrainChannel 标准接口——数据集构造的提交通道）
> 状态：已开发 · 原排期依据：**2026-09-20 地基期拆版（用户拍板颗粒度细化）：本版承接原 v1.5.5 第二章（进化准入判据）与第三章（三层晋级判据）——两章是进化的两面门（能不能自动进化 / 进化到哪一层），且域验证器三档是考核器分流的依据，故在合并后前置于旧 v1.5.15 的内容（该版内容已并入本版）** · 原依据链：2026-09-19 用户拍板 RSI 缺口裁定收编（Meta-RSI 研究对位发现六个自进化链路缺口，经马鞍 / 马场裁定）
> 状态（续）：已开发 · **2026-09-20 地基期拆版（用户拍板颗粒度细化）：本版承接原 v1.5.5 第一章（经验池接训练管道）与第四章（出题考核器）——两章是一个闭环的两端（导出器只收 `verified` 态 / 考核器产出 `verified` 态），内容零改写** · 原依据链：2026-09-19 用户拍板 RSI 缺口裁定收编（Data-RSI 断链打通——行业对位 Meta-RSI 归因→出题→考核三步） · **本版由旧 v1.5.14、旧 v1.5.15 撤并而来**
> 状态（三续）：已开发 · **2026-09-22 探索方向清仓（用户拍板「逐项裁定、排进 V2.0 前」）：RL 训练治理自探索方向迁入本版第五章——改判理由是版本边界纪律（属 V2.0 前进化/训练面治理能力，V2.0 后无承接窗口），且两块前置地基（v1.4.4 规则→reward 映射、v1.4.6 分布式执行面）已交付、本版又是训练通道版，时机亲和；非触发条件已满足**
> 交付快照（阶段二自测实测）：五章 15 新源文件 + 94 新测试 · 全量 **5938**/5938 绿（13 包 SSOT=test-count.sh）· 12 道门禁全绿 · devlog 验收 39/39 勾选 · 落数表 13 项全落数 · 测试数六处文档同步 5938。

## 定位


> ⚡ **进化模块 · 准入门与晋级判据**
>
> 📋 **文档连带（2026-09-26 反向核对预普查）**：准入门/晋级判据落地后失效的旧进化叙事三面——[LIMITATIONS](../../LIMITATIONS.md)「Skill 自动优化…尚未到自动改进阶段」段（补 v1.5.8 指针注，对齐 fde-activation-chain 先例）、[ARCHITECTURE](../../ARCHITECTURE.md) 五能力行与图题的「自动优化」表述（按准入门三档分流改写）、[HANDBOOK](../../HANDBOOK.md) 进化模块段 ab-test「连续胜出+非退化守卫才晋升」与新四道证据门槛对齐（单一口径）
——给进化装上两道门：**准入**（验证比生成便宜才自动进化——域验证器三档 `deterministic` / `model-judge` / `human-only` 分流，未登记 fail-closed 按最高档处理；判定者位于可写面之外；评测集钉哈希登记谱系 + 保护面安全套件独立硬阻断——防投毒基准后门化自改进循环）与**晋级**（注入租用 → skill 半持久 → 微调摊销——频次 × 存续期 × 验证态三输入纯函数给三态建议，promote-train 只提示人审，三层可逆可回退；晋级须过留出集优先 / 严格优于历史最佳 / 单变量可归因 / 校准不退化四道证据门槛）。退役修剪面（第三道门——「留下来的还值不值」）不占本版，登记于探索方向。

> ⚡ **进化模块 · 数据面与入池质检**——打通「经验池 → 数据集 → 训练通道」的 Data-RSI 断链：instinct 池按「高置信度 + 已考核」筛选导出为训练记录（带血缘锚点、来源真实性标记 `verified-trace`、租户隔离），而「已考核」由**出题考核器**供给（instinct 反向生成复现场景，答案校验 + 复现成功双成功才 `verified` 入池）。

> 🧪 **进化模块 · 训练期治理（自探索方向迁入）**——数据面和通道打通之后，还差一道**训练期**的合规判定：训练期间命中策略的轨迹按规则严重级折算惩罚权重、进 reward 判据并留痕（哪个规则集版本影响了哪批数据）。**边界**：本仓只做治理与信号，训练循环仍由模型层跑、经 TrainChannel 提交；训练期策略与准入门**互补不互替**。

---

## 一、进化准入判据（检验-生成差距 · 验证便宜的域才自动进化）


> **形态归属**：`[主干]`（判定·准入门）｜ **不可拔**（进化准入门是防「放养式自进化」的缰绳，拔掉它进化链失去安全边界）
>
> 📋 **研究收编**（行业综述定律）：自提升仅在「验证比生成便宜」的域成立——代码/数学有测试套件当免费验证器，开放式写作验证与生成同价、循环空转。对位 sofagent：空房间错误分流器已分「客观错误 vs 主观偏好」，本章把该判据从归因层上移到**准入层**——evolve/skill 晋升在启动前先判定目标域有没有廉价验证器。

### 交付

| 组件 | 能力 |
|------|------|
| **域验证器登记** | 技能/进化目标域声明其验证方式：`deterministic`（测试/编译/断言——廉价）/ `model-judge`（LLM 评分——有成本）/ `human-only`（开放式——必须 HITL）三档 |
| **准入判定** | evolve 晋升与 instinct 注入前按域档位分流：deterministic→全自动走 eval-gate；model-judge→评分 + 采样人审；human-only→强制 HITL，无自动晋升 |
| **fail-closed 语义** | 域未登记验证方式 ⇒ 按最高档（human-only）处理——宁可不进化，不盲目进化 |
| **进化成本门禁** | 进化循环（出题/考核/晋升/训练构造）纳入 v1.4.8 成本 quota 事前门禁——改进本身也烧钱（行业实证：循环又贵又慢是调度器改进的动因）；超预算按既有 WARN/HARD 双模式处置，不做第二套预算机制 |
| **收益停滞检测** | 连续 N 轮进化的 eval 提升低于阈值 ⇒ 停止自动进化并转人审（行业实证：改进存在边际效应递减）——**检测与提示，不自动决策该改什么**（那是调度器的活，本版不做）。**停环判据的极限面补强（2026-10-04 补）**：① [Harness Evolution as Learning](https://arxiv.org/abs/2609.36892) 把自进化 harness 形式化，给出**近似 / 泛化 / 优化三类极限**——「进步空间有上界」不靠经验阈值；② [Audit the Scaffold, Not the Checkpoint](https://arxiv.org/abs/2609.34924) 提出**平稳性二分**：递归自改进的收益应分别判 **scaffold（脚手架）** 与 **checkpoint（权重）** 两种平稳性。⇒ 本行「连续 N 轮无提升」的停环判定据此须**区分两类平稳**，防「权重到顶、脚手架仍有余量」被误判为整体停滞。**引用纪律**：均第三方单篇、本仓未复算，只落形态不引读数 |
| **保护面独立性** | 域验证器登记表与准入判定器必须位于**所有可写面之外**（Agent 改不到自己的考核标准）——保护面落在可写面上等于「被考核者自己出题、自己判卷」；登记表与判定逻辑的变更只能由人（FDE）发起并留痕（对齐 [v1.5.9 第一章](./v1.5.9.md) 写面留痕）；**自改进通道本身无权降低门的强度**——自改进只能加门、不能撤门，任何削弱准入门 / 晋级门强度的提案一律不准入。行业对位：Meta-RSI 要求保护面独立于 data / harness / model 三类写面——本章是「准入的判定者不可被准入对象修改」这一条的落地。**威胁面实证（2026-09）**：投毒基准可给自改进 agent 植入后门（arXiv:2609.17817）——三个自修改 coding agent 中其一被诱导自演化出「关闭 HTTPS 证书校验」并在干净留出任务上复发，且污染在改用干净基准后仍常存活（干净测试既测不出也清不掉）。四条控制与本仓强项面同构（审计链 / HITL / 版本控制回滚），但暴露**评测集谱系登记**这一缺项——「评测数据从哪来、谁能改、钉什么哈希」须与登记表同批立（见 §二 晋级证据门槛补强）。**机制同构补强（2026-09-28 登记）**：另有一件机器人 agent harness（[RegenHarness](https://arxiv.org/abs/2609.27612)，对方自报、本仓未复算）把同一结构**推得更远一格**——其递归自改进协议明写**修订 harness 配置既不更新在线模型权重、也不得削弱提交门**，且提交门**绑定身份与版本**（identity- and version-bound commit gate），版本化记忆另行区分「**已观察到的事实**」与「**已接受的任务进度**」。⇒ 两条同构来源：① 「自改进通道本身无权降低门的强度」（「被考核者不能改自己的考核标准」的加强形态）**已升格为本行硬要求 + 验收项**（见上文加粗句与本节验收标准）；② **原始观察与已接受结论分账存储**，是审计链「原始记录 vs 判定结论」分离的同构实现，**仍为可收紧的表述、本轮未升格**。**故障面实证（2026-10-04 补）**：[AgentBug-Smith](https://arxiv.org/abs/2609.37864) 从真实 agent 系统的运行记录**自动复现 harness 级缺陷**（把线上故障回放成可复现用例）。⇒ 与审计链同侧：本行管「保护面不可被改」，还须配**故障可复现**——不可复现的 harness 缺陷既无法归因、也无法证明修复有效。**引用纪律**：第三方单篇、本仓未复算，只落形态。来源登记见 [THANKS · 编排与架构](../../THANKS.md) |
| **评测集谱系与防投毒** | 自改进循环的自评基准即攻击面：投毒基准可诱导自修改 agent「自己演化出」削弱安全控制的指令（实测案例： poisoned 基准令 agent 自进化出关闭 HTTPS 证书校验的指令，且**换干净基准继续演化后污染仍存活**——干净测试既测不出也清不掉，[Roesner & Kohno](https://arxiv.org/abs/2609.17817)）。本章的对应防线：① 进化用评测集**钉哈希登记谱系**（来源/版本/谁可改）；② **评估与自改进分离**——保护面持有的安全套件独立于 evolve 分数，命中即硬阻断、不作为可权衡输入；③ 评测环境剥离答案键与隐藏测试（对齐 sandbox 零凭证纪律）。**外部独立表述（2026-09-25 登记）**：品类侧的独立第三方榜在其前言里自行声明——「公开半集**可被训练**也可被**择优**，因此密封的私有半集须**随领域变化持续演进**」，并据此设「公开集与密封集准确率差 **>25 个百分点即扣减**」的惩罚项。⇒ **冻结留出集 ≠ 永久干净**：纪律 ① 的完整形态须含**留出集的换代机制**（样本增补走新建集、并声明新旧集不可横比，与 [v1.6.0 §五](../v1.6/v1.6.0.md)「集的两条纪律」同源）——否则「钉了哈希的集」仍会被公开半集的选择压力慢慢污染。**机制前移（第三方同向实例）**：同一独立榜把污染从「事后扣分」前移为「**事前自陈**」——**S1 Bench** 把 `contamination` 做成**逐目标字段**（每个 target 逐条列出其读数所涉的公开集名，如 `boolq` / `paws` / `vitaminc-dev`；`data.json` 一手可取、本仓未复算），使污染从**事后核算项**变成**与读数一起被读到的输入** ⇒ 纪律 ③「剥离答案键」是防守方的事前动作、**逐目标自陈污染**是进攻面的事前暴露，两者同指「污染必须在读数之前显式化」 |

### 涉及文件（预估）

| 文件 | 改动 | 说明 |
|------|------|------|
| `engine/evolve/src/domain-verifier-registry.ts` | 新建 | 域档位登记 + 准入判定纯函数（登记表持久化载体落 {SOFAGENT_DATA}/protected/domain-verifiers.json——只读位 + 钉哈希；本仓可写面清单在文件头注释固化） |
| `engine/evolve/src/eval-provenance.ts` | 新建 | 评测集谱系登记（钉哈希登记 / 留出集换代 / 污染事前自陈三防线 + 答案键剥离投影 + 安全套件独立阻断） |
| `engine/evolve/src/__tests__/domain-verifier.test.ts` | 新建 | 三档分流 / fail-closed / 未登记默认最高档单测 |

### 验收标准

- [x] 域验证器三档登记可配置（deterministic/model-judge/human-only）
- [x] 准入判定按档位分流（human-only 域零自动晋升）
- [x] 未登记域 fail-closed 按 human-only 处理
- [x] 进化循环受成本 quota 门禁约束（超预算按 WARN/HARD 处置，无第二套预算）
- [x] 收益停滞可检测（连续 N 轮低于阈值转人审，只提示不自动改方向）
- [x] 域验证器登记表与准入判定器位于可写面之外（Agent 不可改，变更须人发起并留痕）
- [x] 自改进通道无权降低门强度（任何削弱准入门 / 晋级门强度的提案一律不准入；自改进只能加门、不能撤门）
- [x] 进化用评测集钉哈希登记谱系（来源/版本/变更权），保护面安全套件独立于 evolve 分数硬阻断，评测环境剥离答案键
- [x] `npm test` 全绿

---

## 二、三层晋级判据（注入租用 → skill 半持久 → 微调摊销 · 显式化）


> **形态归属**：`[主干]`（判定·晋级规则与台账）｜ L1 关档
>
> 📋 **研究收编**（两 substrate 成本模型）：context 更新「每次推理重付」（租用——注入即付 token），权重更新「一次付清」（摊销——训练一次推理免费），skill 介于两者（加载链常驻=半持久）。三条路已事实存在（instinct 注入 / evolve 晋升 / TrainChannel 微调），但没有显式晋级判据——何时从注入升 skill、从 skill 升微调，目前靠人拍。行业对照：Meta-RSI 的调度器先 Harness 后 Model（「先改便宜的，高频重要规则才内化」）。

### 交付

| 组件 | 能力 |
|------|------|
| **晋级判据纯函数** | 输入：条目注入频次 × 存续期 × 验证态（考核通过率/eval 分数）；输出：`keep-inject` / `promote-skill` / `promote-train` 三态建议 |
| **晋级台账** | 每次晋级判定落 decision-log（当前层→建议层 + 判据快照）——与 v1.4.5 skill-impact 台账同源扩展 |
| **人审门** | promote-train 建议**只提示不执行**（对齐「只提示不阻断」）——进 FDE 确认队列，确认后才走第一章管道 |
| **三层可逆（回退）** | 晋级的对偶面：任一上层验证失败（微调后 eval 退化 / skill 考核连续失败）⇒ 回退到下一层并留痕（微调→skill→注入）。**复用既有 snapshot/restore 语义，不新建回退机制**；回退判定与晋级判定同属本节纯函数（对称输出 `demote-train` / `demote-skill`），回退动作落 decision-log |
| **进化收益曲线** | 「做 1000 次任务后是否比第一次更强」的量化落地（PHILOSOPHY 既有承诺）：四指标可定义可量化可记录——**任务通过率趋势**（acceptance/ab-history 既有数据源）/ **错题本复发率**（同类失败重犯间隔）/ **skill 复用率**（调用次数 / 产生次数）/ **纠偏介入率**（人工干预频次趋势）。指标定义与记录属本章判定面（数据从既有台账取，不造新数据源）；曲线呈现挂 v1.5.0 治理 KPI 面板（复用六卡框架，不另做 UI 面） |
| **晋级证据门槛** | 晋级判定须同时满足四条证据纪律：① **以留出集（held-out）信号为准**——反馈集上的提升不计入晋级依据（行业实证：同一权重只换 harness，反馈集 +13.9 而留出集仅 +1.43，[HarnessDev](https://arxiv.org/abs/2609.01437)）；② **严格优于历史最佳**才接受，持平视为不接受——防迭代把既有改进抹掉（行业实证：24 个 run 仅 1/12 超基线，且继续训练会回退，[Aspire](https://arxiv.org/abs/2608.31111)）；③ **单变量归因**——一次晋级只归因一个变更面，多变量捆包 ⇒ 拆批（否则收益不可归因、回归不可定位）；④ **校准不得退化**——准确率与校准会**分离收敛**，故「严格优于」须**逐维判定**：准确率提升而校准（ECE / Brier）退化同样拒绝晋级（行业实证：9B 判定件准确率与商业件只差半步，Brier 反而更差 0.237 对 0.211；4B 档在 8.2% 的新来源题上给错答案 ≥0.9 概率）。**机制补强（行业两线实证）**：留出选择同时是对齐机制——在未显式优化作弊指标的前提下，纯留出集选择的自主改进运行把奖励作弊率从 55% 降至 32%、低于人类工程基线 7 个百分点（[AIDE²](https://arxiv.org/abs/2609.26457)：作弊解在隐藏评测上不稳，被选择器当作泛化噪声顺带筛掉）；而 evolve 集择优可整体反转——最强既有 harness 自进化法的产出移到未见任务后**比初始 harness 低 1.7 点**，且无复杂度惩罚项时 harness **单调膨胀**（[RRSI](https://arxiv.org/abs/2609.24972)：自进化三失败形态＝基准特化拟合 / 噪声追逐 / 复杂度累积；其「退火编辑预算」即「一次只归因一个变更面」的机制化；同文实测 evolve 集 +14.1 → 未见任务 +4.7——**约三分之二的 harness 进化增益不迁移到 held-out**，据此固化引用纪律：凡引用 harness / 自进化收益默认按 held-out 口径核，无 held-out 复算的自报数字只登记方向、不入对照表）。**基底定位（奖励作弊的三基底）**：作弊按优化基底分三类——**参数更新（weights）/ 输出间选择（selection）/ 持久化提示词（text）**，防御跨基底只有部分可迁移（[arXiv:2609.25848](https://arxiv.org/abs/2609.25848)）——本仓晋级门槛作用在 **text 基底**（skill/注入/判据均为持久化文本），该基底特有风险＝「内容可查但小改动的诱导行为难预判」，故④校准逐维判定与 §一 谱系钉哈希是 text 基底的针对性防线；同文收口句与本门槛同构——「可靠改进取决于控制可及的失效模式，并保留**独立于被优化分数**的任务质量证据」（即留出集优先的另一种表述）。**跨域基准补充（2026-10-01 登记）**：三基底的「作弊机会」形态已有跨域基准化产物——[CheatBench: Measuring Reward Gaming in AI Agents](https://arxiv.org/abs/2609.36308) 在数学研究 / 知识工作 / 编码 / 视觉等域**同时**布置「难题」与「作弊机会」，并把现实事故形态逐类点名（**访问未授权信息 / 规避监控 / 突破沙箱攻击外部系统**）。⇒ 本门槛的守备面**不止 text 基底的「小改动诱导」**：跨域存量作弊形态须一并作为对照清单输入；其「同域同时布置正题与作弊机会」的构造形态亦可供 [v1.6.0 §六](../v1.6/v1.6.0.md) 对抗类采集点借用。**引用纪律**：第三方基准设计，本仓未复算其读数，只取形态清单不取分数。**判据清单化（2026-09-30 登记）**：上述「混淆项 — 对照」结构已有公开清单化产物（[RSI Claim-Testing Checklist](https://github.com/sunghunkwag/recursive-self-improvement)，已在 `THANKS` 实验与证据节登记），其正面判据与本门槛同向——**「逐轮分数上升」必要而不充分，改进必须递归**（改进者本身要变，且变化后的改进者须产出比原版更好的改进）。四条与 v1.5.9 第四章收益归因对照组配套：那章管「净贡献是否有」，本章管「贡献是否可定位」。**生成侧补强（2026-10-02 补）**：[Certified Long-Horizon Code Agent Evolution via Validation-Gated Skill Optimization](https://arxiv.org/abs/2609.32990) 把长程代码 agent 的**技能优化置于验证闸门之下**——每轮演化须先过验证才被接受。⇒ 与本条**同侧且更靠生成端**：本条管「晋级要不要给」（门槛），该文补「**候选怎么产生**」（验证作生成侧的选择压），与 §一「验证便宜的域才自动进化」合成机制闭环。**引用纪律**：第三方单篇、本仓未复算，只落闸门形态，不引其读数。**安全跨代补强（2026-10-03 补）**：[Safety Must Survive Self-Improvement](https://arxiv.org/abs/2610.01073) 在**有状态授权任务**的受控试验台上研究 RSI **跨代**安全——固定 LLM 编辑器改可执行 agent 组件，**独立 traces** 逐代记录行为，把「不安全行为不得存活到下一代」与「失败后可恢复」拆成两个可分别观测的量。⇒ 与本行门槛**同侧、补齐「代际」维度**：本条管「这一代能不能晋级」，该文补「**上一代的不安全不得遗传、且失败态须可回退**」——与 §一「保护面独立性」行（自改进通道无权降低门强度）及审计链「原始记录 vs 判定结论」分离同构（其独立 traces 即留痕面）；同为第三方单篇、本仓未复算，只落代际安全与留痕形态，不引其读数 |
| **晋级三层的分层实证（2026-09-25 登记）** | 「注入租用 → skill 半持久 → 微调摊销」三层里，**最上层此前唯缺外部实证**，本轮补齐两件（均自报、本仓未复算，来源登记见 [THANKS · 实验与证据](../../THANKS.md)）：① **harness 蒸馏**（arXiv:2609.24974）——以优化过的 harness 作训练期指导、经 agent-as-harness 把引导转成训练示范，**微调后专用 harness 可在部署期移除**，且移除后基础模型任务成功率**反高于该 harness 仍挂着时的读数** ⇒ 正面回答了「凭什么信把能力蒸进权重比长期挂着 harness 更划算」，为「微调摊销」层给出机制与方向；② **留出集闸门回滚**（arXiv:2609.26760）——「**success-first held-out gate 回滚会伤害既有能力的修复序列**」是本章「严格优于历史最佳才接受 / 持平即不接受」的机制同构，同文并给出「把反复出现的控制决策从上下文搬进可复用代码」的路径（LLM 调用与部署推理成本方向性下降、小模型档位优势最大）⇒ 与 [v1.6.0 §四](../v1.6/v1.6.0.md)「纯函数型常数留代码、不判定化」同源。**边界**：两件均只作机制与层级归属参照，**不引其数字入本仓对照表**。**另两层各补一例（2026-10-02 补）**：② **skill 半持久层**——[R² Flow: Recursive Self-Improvement via Recursive Skill Evolution](https://arxiv.org/abs/2609.33867) 把 RSI 的载体放在**技能本身的递归演化**上 ⇒ 演化的单位不必是权重，**技能即递归改进的载体**；③ **注入租用层**——[Composing Task-specific Agent Harnesses at Test Time with Reusable Primitives](https://arxiv.org/abs/2609.38912) 主张 harness **不必预先整体定型**，可由**可复用原语在测试期按任务组装**（区别于预铺配置）。⇒ 本行三层**各有外部实证**（顶层原两件 + 本批两件）。**引用纪律**：两件均第三方单篇、本仓未复算，只落形态。**改进者本体两件（2026-10-03 补）**：① [Self-Evolving Harness on Multiple Tasks with the Agent as Its Own Optimizer](https://arxiv.org/abs/2609.38372) 把「**谁来做改进**」也纳入演化——既有自进化法多由一个挂在人设 harness 上的**独立 proposer** 改 solver 的 harness，该文让 **agent 自己当 optimizer**（去掉外置 proposer），且要求同一 harness 在**多任务**上成立；② [Learning Meta-Skills for Agent Harness Design in Test-Time AI4AI](https://arxiv.org/abs/2609.38143) 把「**设计 harness 的能力本身**」当作可学技能。⇒ 对本章的含义：三层晋级判据默认「改进者 ＝ 人 / 外置 proposer」，两件把**改进者本体**也列入可演化面——与 §二「保护面独立性」行（自改进通道无权降低门强度）**张力最直接**，故后续若评估「agent 自任优化器」，**门槛与留痕必须外置于该 agent 的可写面**，其「自改 harness」与「自改考核标准」的边界须显式落数。**自进化件簇（2026-10-04 补）**：同窗四件把 harness 演化推往不同侧面——[Turbo Harness](https://arxiv.org/abs/2609.40330)（**按实例自适应**调 harness）· [GUI-HARVEST](https://arxiv.org/abs/2610.00948)（GUI agent 以**证据驱动**演化 harness）· [Mixture of Self-Improving Branches](https://arxiv.org/abs/2609.37834)（自改分支**混合**）· [Video-RSI](https://arxiv.org/abs/2609.37950)（视频理解 agent 的**递归自改进**）——均属本行「harness 即演化载体」一族的延续（**并列登记、不排名**）。**引用纪律**：以上均第三方单篇、本仓未复算，只落形态 |

### 涉及文件（预估）

| 文件 | 改动 | 说明 |
|------|------|------|
| `engine/evolve/src/promotion-policy.ts` | 新建 | 晋级判据纯函数 + 台账写入 |
| `engine/evolve/src/__tests__/promotion-policy.test.ts` | 新建 | 频次×存续×验证三维判据 / 三态输出 / 人审门单测 |

### 验收标准

- [x] 晋级判据可计算（频次 × 存续期 × 验证态 → 三态建议）
- [x] 晋级判定落 decision-log（判据快照可追溯）
- [x] promote-train 只提示不自动执行（FDE 确认队列）
- [x] 三层可逆：上层验证失败可回退到下一层且留痕（复用既有 snapshot/restore，不新建机制）
- [x] 进化收益四指标可计算可记录（通过率趋势 / 复发率 / 复用率 / 介入率——数据从既有台账取）
- [x] 晋级以留出集信号为准（反馈集提升不计）+ 严格优于历史最佳才接受 + 单变量可归因（多变量捆包拒收）+ 校准不退化（逐维判定，准确率升而校准降同样拒收）
- [x] `npm test` 全绿

---

## 三、经验池接训练管道（instinct→数据集→TrainChannel · 打通 Data-RSI 断链）


> **形态归属**：`[主干]`（判定·数据入池资格与血缘锚点）**+ `[通道]` 成分**（数据集构造与通道提交的执行动作）｜ L1 关档
>
> 📋 **缺口实测（2026-09-19）**：`engine/train` 的数据接入链（`data-ingest.ts` 按扩展名判 CSV/XLSX/JSON/文本四源 → `dataset-builder.ts` 构造）只吃外部源，**不消费 instinct 池**——Data 面与 Model 面各自为政，一体机数据飞轮（session→分拣→脱敏→数据集→训练→灰度）在「数据集」一环断了内部供给。行业对位：Meta-RSI 的 Data-RSI 是「三算子的共同底料」，其产出同时喂 Harness-RSI 与 Model-RSI。**上游瓶颈补记**：环境供给（Agent 自造执行环境 → 增量快照 → 下一批训练场）是 Data-RSI 的上游——训练环境不可信则采集到的轨迹本身就是假的。「来源真实性标记」（本表）挡得住自述来源与合成来源，挡不住被环境伪造的轨迹；环境层的隔离与可验证是数据管线的前置条件（生产级沙盒基础设施的实证，[arXiv:2609.22978](https://arxiv.org/abs/2609.22978)）。

### 交付

| 组件 | 能力 |
|------|------|
| **instinct 池导出器** | 从 `{SOFAGENT_DATA}` instinct 存储（extractor 产物）筛选高置信度（≥ eval-gate 同源阈值）+ 已考核（本版第四章）条目，映射为训练记录（pattern→instruction，solution→output），血缘字段（来源轨迹 id / instinct id / 置信度）随行 |
| **来源真实性标记** | 导出器只收**经审计链锚定的真实运行轨迹**派生的 instinct（来源标记 `verified-trace` 与 Agent 自述/合成来源区分）——防自证污染：Agent 自己造的「成功经验」不得进训练数据（保护面在写面之外的直接推论；数据来源未标记 ⇒ 按不可信处理 fail-closed） |
| **租户隔离** | instinct 池与导出产物按 `enterpriseId` 分区（对齐 v1.4.7 多租户 `data/<tenant>/` 路径纪律）——一个企业的经验不得喂进另一个企业的训练数据（数据主权铁律）；跨租户导出默认禁止，显式配置才开且留痕 |
| **dataset-builder 新源** | `instinct` 作为第五种数据源类型接入既有管道（与 CSV/XLSX/JSON/文本并列），复用既有质量闸门与脱敏联动 |
| **TrainChannel 提交接线** | 构造的数据集可经既有 TrainChannel 接口提交（ssh 自管 VM 或托管 API），训练事件照常回流审计链 |
| **血缘锚点** | 数据集 manifest 记录「哪些 instinct 条目进了这个数据集」——训练产物（权重）可反向追溯至经验源头 |
| **经验面评估的硬边界（hooks 零外部调用 + 人审 gate 不自动执行）** | 经验评估的调用面收窄为**显式命令**：捕获/采集层（hooks 与后台捕获）**永不调用外部评估器**（含判定件与任何托管端点）——评估只在显式发起的评估命令里发生，dry-run 预览零网络请求。评估输入先投影再裁剪（有界脱敏投影，与 v1.8.0 判定件出站脱敏同纪律）。**评估结果只做排序与分类，不自动改写指令、不自动装技能、不自动执行动作**——一切入池/晋级/安装经人审 gate（生态记忆层同构：评估概率帮排序，不碰执行）。组织禁外部评估时，评估端点可指内部兼容实现或整体跳过，跳过不阻断捕获 |

### 涉及文件（预估）

| 文件 | 改动 | 说明 |
|------|------|------|
| `engine/orchestrator/src/instinct/store.ts` | 新建 | instinct 池持久化前置件（append-only JSONL + verified/sourceTrace/enterpriseId/traceId 四字段承载） |
| `engine/orchestrator/src/instinct/exporter.ts` | 新建 | instinct 池筛选导出（置信/考核/真实性/租户四道门 + 血缘字段） |
| `engine/orchestrator/src/instinct/index.ts` | 新建 | instinct 域 barrel（./instinct 子路径消费面） |
| `engine/train/src/instinct-source.ts` | 新建 | instinct 数据源适配器（归一到 IngestRecord，与 CSV/Excel/DB 同一下游——⚠️ 实测 dataset-builder 只吃已归一 IngestRecord[] 对来源无感、全仓无源类型枚举，故为旁挂适配器而非「builder 加第五种类型」；既有四源按扩展名判定的说法实为文件源子集形态） |
| `engine/tr
…（截断，原文 19826 字符）

请按系统指令输出 16 视角审查草稿。
