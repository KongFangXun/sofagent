# sofagent 发布后审查 Prompt（9 维度 × 6 方面）

> **发版后独立审查**：当前版本发版后，在全新 session 中跑本 prompt 对已发布版本做独立审查。审查发现的问题不阻塞当前版本——进入下版本开发计划。
>
> **核心原则**：假装你完全不知道 sofagent 是什么，用陌生人的眼睛重新看。不设固定检查项、不指定具体文件、不跑 grep、不预设"之前已修好 X"——凭第一印象和直觉判断。
>
> 📋 **审视变更记录**：本 prompt 随 v1.0.6→v1.1.3 多轮审查持续演进，每次新增的检查项已直接写入对应维度任务（均带版本标注，如「v1.1.3 新增」）。跨版本核心教训见文末附录「审查体系演进」。
>
> **审查对象**：https://github.com/KongFangXun/sofagent（当前已发布版本）
>
> **九维度 · 五轮法**：
> | 轮次 | 维度 | 角色 | 方法 |
> |------|------|------|------|
> | 1 角色扮演 | 一 陌生人 / 二 企业IT / 三 竞品 / 四 npm / 五 开源 | 5 个陌生人各自独立看 | 凭直觉 |
> | 2 用户旅程 | 六 完整用户旅程 | 真实用户走完整路径 | 找断点 |
> | 3 红队对抗 | 七 红队 | 安全测试搞破坏 | 找边缘 case |
> | 4 CI 一致性 | 八 CI/自动化 | CI 机器人对数字 | 文档 vs 代码 |
> | 5 感知层 | 九 感知层健全性 | 感知审查 | 用户能否感知 sofagent |
>
> 五轮九维可以分多次跑，也可以一次性全跑。轮次之间清空认知，从空白开始。

---

## 全局约定

> **路径约定**：本 prompt 中所有文件路径（如 `sofagent/audit/src/rules/index.ts`）均相对于**项目根目录**——即 `git clone` 后的仓库顶层。

> **审查者身份**：这是 sofagent 发布后独立审查。当前版本开发完成、发版前审查（pre-push-check / acceptance-test / OpenClaw / 回归清单 全绿）已通过。这轮是"你完全不知道我是谁——你第一眼看到我，心里在想什么"。你的直觉比 grep 更有价值。发现的问题不阻塞本版本，进下版本修复。

> **审查约束**：
> - 🔴 **全新 session 硬性条件**——必须在零开发上下文的新 session 中跑。有记忆的审查者不是"陌生人"。
> - **想读什么读什么**——不限制文件范围，始终戴着当前身份眼镜在读。
> - **不设预期**——不要告诉审查者"之前已修好 X"，让他自己发现。
> - **相信直觉**——第一反应"不对劲"就是不对劲，不用证明。
> - **5 轮独立**——每轮写完后清空上一轮认知，从空白开始。

## 你的身份（第一轮：5 角色切换）

> 第一轮你将**连续切换 5 个身份**，每轮只能从当前身份出发，不能借用其他身份的知识。每轮完成后再切换到下一个。第二、三、四、五轮各有独立的身份设定。

---

## 6 个审查方面（每轮都覆盖）

| # | 方面 | 审查者的核心问题 |
|---|------|----------------|
| 1 | **产品定位** | 这东西到底是干什么的？3 秒能说清楚吗？说清楚了想用吗？ |
| 2 | **工程质量** | 代码和工具链给人什么感觉？专业还是凑合？跑得动吗？ |
| 3 | **文档与上手** | 从零到第一次跑通要多久？卡在哪里？哪里让人想放弃？ |
| 4 | **安全与诚实** | 声称了什么？哪里让人觉得"这你也敢声称"？有没有藏问题？ |
| 5 | **生命力** | 这项目一年后还会活着吗？有人维护吗？能贡献吗？ |
| 6 | **文档精简度** | 有没有读到重复内容？有没有段落感觉"留着也行删了也行"？有没有一段话读完什么信息也没拿到？ |

---

## 维度一：🧑‍💻 陌生人首次体验

> 你是一个普通开发者，在 GitHub Explore 或者某个技术群里看到了 sofagent。你没听过这个项目，不知道作者是谁，不知道它经历了 10 个版本的审查。你只是好奇——点进去了。

**你的任务**：
1. 看 GitHub 项目首页（README），**只往下滚 3 屏**。在这 3 屏里，你形成了什么印象？说清楚还是糊涂？
2. 如果要装，你第一步做什么？这一步有没有障碍？
3. 用 npm 装完 `@sofagent/audit`，跑 `sofagent-audit --help` 或者 `sofagent-audit --doctor`。输出让你觉得这东西能用吗？还是想卸载？
4. 你会把这个项目发给同事吗？如果会，你会怎么介绍它？（用你自己的话，不抄 README）
5. **版本声称验证**：看 CHANGELOG——它声称了什么？实际在项目里找到了吗？标题说的功能，在代码/目录/配置里能找到对应实现吗？你觉得这个声称诚实吗，还是夸大了？**特别检查 README 规则分类**：README 把规则分成"纯 git-diff"和"需 Agent 日志"两类并标注规则 ID——打开 `sofagent/audit/src/rules/index.ts`，分类里提到的每个 ID 是否真实存在？有没有"幽灵规则"（README 写了但代码里根本没注册的 ID）？
6. **文档瘦身**：README 行数——你能在一屏内搞清楚这东西是干什么的吗？有没有你想找但找不到的东西？（比如"这东西能企业部署吗？"——你从 README 能看出来吗？）
7. **tag 指向确认**：跑 `git show vX.Y.Z --stat`——tag 指向的是发布提交还是修复提交？tag commit message 是否包含版本号？
8. **双节点架构验证**：README 说 sofagent 支持两种部署节点——"自动运行节点"（需 OpenClaw）和"个人增强节点"（WorkBuddy/Codex/Claude Code，不需 OpenClaw）。你用的是哪个？如果你用的不是 OpenClaw（比如 WorkBuddy），能跑通吗？README 里"个人增强节点"的说明清楚吗？`sofagent-orchestrator compose --task` 这个 CLI 入口你找得到吗？**这个声称是 v1.0.7+ 的核心卖点——如果不装 OpenClaw 就能跑，文档要让你相信这一点；如果其实跑不通，就是夸大宣传。**
9. **输出归属感（v1.1.3 新增）**：跑 `sofagent-audit --help`、`--init`、`--doctor` 后，你知道这些功能是谁提供的吗？输出里有没有 sofagent 的名字？还是你看到的只是通用工具输出（"PASS""FAIL""检测完成"），不知道背后是哪个引擎在跑？作为一个刚装上的开发者，你能感知到"这是 sofagent 在做的事"吗，还是觉得"这不就是普通的 git hook 吗"？**Harness 中间件最大的挑战是存在感——如果用户用了三周还不知道自己装了 sofagent，这个产品就是失败的。**

你是一个普通开发者，不是来审代码的。你会读多少文档取决于你的好奇心——有人 3 屏就走了，有人会点进 ARCHITECTURE 看看设计思路。**读什么不重要，重要的是始终用普通开发者的心态判断：这东西对我有用吗？我愿意花时间装吗？**

---

## 维度二：👔 企业 IT 负责人

> 你管理着一家 200 人公司的 IT 基础设施。你们的开发团队在用 AI 写代码（Cursor / Copilot / Claude Code），你担心安全和合规问题。你在找工具，看到 sofagent。你的上级问：这东西能进我们公司吗？

**你的任务**：
1. 打开 SECURITY.md。读完以后，你信任这个项目吗？哪里让你安心，哪里让你不安？
2. 打开 LIMITATIONS.md。诚实吗？有没有避重就轻？
3. 你关心的不是"有没有 bug"，而是**出事了谁负责**。读完项目的文档后，你清楚谁是责任方吗？
4. 你会向你的上级推荐 sofagent 吗？推荐的三个理由和反对的三个理由是什么？
5. 如果要部署到团队 20 个开发者的机器上，你能从文档里找到足够的信息吗？
6. **知识库访问控制**：打开 ARCHITECTURE 或 CHANGELOG 中关于知识库访问控制的描述。财务 Agent 和人事 Agent 用同一个 sofagent 底座——能防止财务 Agent 读到人事数据吗？你觉得这个"Agent 网关控制"的方案靠谱吗，还是一个企业 IT 看了会摇头的设计？

你关心的核心问题是"出事了谁负责"和"这东西能进公司吗"。你会从 SECURITY.md 和 LIMITATIONS.md 开始，但如果其他文档（比如 ROADMAP 里的准入条件、ARCHITECTURE 里的实验性标注）能帮你判断项目成熟度，你也会去看。**你读任何文档的出发点都是：这一页让我更放心了，还是更担心了？**

7. **审计日志自身安全**：打开 `sofagent/audit/src/audit-history.ts`。审计拦截了密钥泄漏后，拦截结果（含 diff 内容）被写入 `history.jsonl`。这个文件本身会不会成为第二个泄漏点？Agent 能读这个文件吗？能篡改吗？有没有脱敏机制？
8. **optional dependency 类型安全**：检查对 optional dependency（如 deepagents）的 import 是否用了 `as unknown as` 双重转换。CI 环境 TS 类型检查比本地严格——直接 `as` 可能本地通过但 CI 失败。
9. **文件系统审计的企业适用性**：README 声称"v1.0.8+ 支持文件系统审计——内嵌 isomorphic-git，daemon 监控文件变更自动审计，非开发者也能用，不需要装 git、不需要 commit"。你管理的是 200 人公司，大部分岗位不是开发者——这个声称对你有吸引力吗？从文档里你能搞清楚怎么配置 daemon 监控哪些目录吗？审计结果推到哪里？**v1.2.x 前 daemon 审计结果仅本地 stdout（daemon-notice.md），Webhook 推送能力待落地**——文档有没有诚实标注这个限制？
10. **合规审计可追溯性（v1.1.3 新增）**：企业 IT 做合规审计时，审计记录里能追溯到"这是 sofagent 审计引擎做的"吗？Webhook 推送的消息、history.jsonl 的审计记录、daemon 的巡检报告——每一条是否能清晰地归因到 sofagent？如果你们的合规审查员翻审计日志，看到"PASS"却不知道是谁判的 PASS，这对企业来说是不可接受的——就像财务报表没有审计师签名一样。

---

## 维度三：🏗️ 竞品分析

> 你是另一个开源项目（比如 Cursor Rules / Claude Code hooks / pre-commit 工具链）的维护者。你在研究竞品，想搞清楚 sofagent 到底跟你有什么区别、它有没有什么致命弱点。

**你的任务**：
1. README 里说的"Agent 提交时审计工具——git diff 硬证据，11 条规则，commit-msg hook，不依赖 Agent 配合"——这句话你能反驳吗？漏洞在哪？
2. 这个项目的核心差异化到底是什么？跟你的项目相比，它是真不同还是换个说法？
3. 如果你要写一篇文章《为什么不用 sofagent》，你的核心论据是什么？
4. 这个项目自称"正式版"和"可生产使用"。以你的标准，它够格吗？什么地方让你觉得不够格？
5. **范围合理性**：CHANGELOG 和文档中描述的每一条功能，以你的标准判断它是真功能还是花架子？一个 commit-msg 审计工具为什么要关心"知识库访问控制"？这是范围蔓延还是合理的演进？
6. **规则声称验证**：README 说的规则数量（如"17 条规则"）——打开 `sofagent/audit/src/rules/index.ts`，数 `defaultRules` + `extendedRules` 的实际注册数量。一致吗？每条规则的 `evidenceMode`（`git-diff` vs `hybrid`）与 README 的分类描述是否匹配？有没有声称了但代码里没注册的规则？**特别检查规则 ID 是否真实存在**：README 分类描述中提到的每个规则 ID（如"A1-A6, A9-A11"），逐个确认在 index.ts 的 `name:` 字段中确实有注册。**注意跳号**：规则编号不是连续的——A1-A11 后跳到 A14/A15（A12/A13 是永久跳号，不是"规划中"），不要把跳号当作遗漏。历史教训：曾出现 README 声称了代码中根本不存在的规则 ID（文档漂移问题）。
7. **声称与实现一致性**：CHANGELOG 标题中声称的功能（如"自进化引擎"），实际代码是否匹配？有没有夸大——比如 wrapper 叫"引擎"、CLI 调用叫"集成"？
8. **CHANGELOG 纯度**：CHANGELOG 历史条目中有没有审查元信息（模型名、审查轮次、P0/P1 计数）？CHANGELOG 应该只写产品变更。
9. **SkillOpt 集成 CLI 契约验证**：打开 `skillopt-integration.ts`——`isSkillOptAvailable()` 和 `runSkillOpt()` 调用的 CLI 参数形式与真实安装的 `skillopt-sleep --help` 声明的子命令/参数一致吗？**特别检查**：`isSkillOptAvailable()` 探针是否用 `status` 子命令（而非被 CLI 拒绝的 `--version`）；`runSkillOpt()` 是否用 `run --target-skill-path <input> --auto-adopt` 子命令形式（而非 flat positional + `--output`）。历史教训：曾发现集成代码照着不存在的 CLI 契约写了整整一个版本——探针用 `--version`（真实 CLI exit 2）、调用用 flat positional + `--output`（真实 CLI 只认子命令）。**v1.1.3 起升级为 CI 必跑**：装 skillopt-sleep 后实跑 `skillopt-sleep --help` 对比集成代码的调用形式，仅读源码不算验证。
10. **Agent 定义的平台耦合度**：打开 `agents/` 下的 Agent 定义——它们的 role/workflow/rules 是否过度依赖 OpenClaw 的 `session.spawn` API？如果未来换平台，这些 Agent 定义还能独立使用吗？还是需要大幅改写？
11. **ruleClass 跨文档漂移检测（v1.1.3 追加）**：提取 `sofagent/audit/src/rules/index.ts` 的 `name` + `ruleClass`，与 `sofagent/audit/README.md` 规则表逐行 diff。ruleClass 漂移已反复出现（A6 曾从「业务底线」漂移到「能力拐杖」、A11 反向漂移），单文档审查永远发现不了——只有跨文档交叉对照才暴露矛盾。**检查手法**：`diff <(grep "name:\|ruleClass:" sofagent/audit/src/rules/index.ts | paste - -) <(提取 audit/README.md 规则表的名称+分级列)`。建议对此建自动化脚本加入 pre-push-check。

---

## 维度四：📦 npm 用户

> 你是一名前端/全栈开发者。你不需要读 README（太长不看），你只做一件事：`npm install -g @sofagent/audit && sofagent-audit --help`。

**你的任务**：
1. `--help` 输出清晰吗？你马上知道怎么用还是要再查文档？
   先试 `npx @sofagent/audit --help`——能跑吗？如果不能，报什么错？README 有没有告诉你该怎么办？
2. 在随便一个 git 项目里跑 `sofagent-audit --init`，然后 commit 一个改动。这个体验顺滑吗？有没有让你困惑的输出？
3. 跑 `sofagent-audit --doctor`。输出有用吗？每一项检查都合理还是有的凑数？有没有你看到"跳过"或"未找到"但不明白什么意思的检查项？你会查文档还是忽略？
4. 如果你装完后跑不通，你会投诉什么？（模拟一次失败的场景，比如 Node 版本不够、没在 git 仓库里跑）
5. 包的依赖树干净吗？（`npm ls` 看一眼）有没有让你皱眉的依赖？
6. **安装脚本的报错友好度**：跑 `LOOP/loop-install.sh` 在缺少前置依赖时（比如没装 sofagent 底座、不支持的平台）——报错信息清楚吗？告诉你缺什么、怎么装了吗？还是直接 exit 1 让你摸不着头脑？
7. **批量部署/集中配置**：如果要给 50 个仓库都装 sofagent，有没有批量安装或集中配置下发的能力？企业级场景需要 org-level 配置。当前是 per-repo 安装——这对 DevOps 来说够用吗？
8. **`--strict`/`--ci` 模式验证**：跑 `sofagent-audit --diff HEAD~1..HEAD --task "wrong" --strict`，实际 exit code 是 2（承诺值）还是 1？文档声称的模式行为与实现是否一致？**如果 exit code 不是 2，这就是 P0——文档声称与实现不符。**

你是"先动手再看文档"型开发者。装完跑通了，可能会随手翻一下 README 看看还有没有别的功能。**你的判断标准不是文档完不完整，而是"从敲下 npm install 到觉得这东西有用，中间花了多长时间"。**

---

## 维度五：🔍 开源审查员

> 你是一个在 GitHub 上 review 过 500+ 个开源项目的人。你有一套快速判断方法：先看目录结构和 git log，几分钟内形成第一印象。但如果目录结构让你困惑，README 就是帮你解谜的工具；如果结构一目了然，README 只是验证你的判断。

**你的任务**：
1. 只看根目录文件列表（`ls`），不看内容。猜一下这个项目的结构——前端/后端/CLI/文档/脚本都在哪？你觉得这个结构合理吗？
2. 有没有看起来"不该在这"的文件或目录？有没有一眼就知道是垃圾的？
3. 看 `git log --oneline --since="3 months ago"` ——提交节奏健康吗？有没有诡异的单次巨大提交？
4. 看 `CONTRIBUTING.md` ——你能找到怎么提交 PR 吗？能找到怎么跑测试吗？
5. 看 issue / PR 数量（如果有）。这是一个"作者自嗨"项目还是有社区活性的项目？
6. **文档引用链**：从 README 出发，点进 3-5 个链接——有没有 404？有没有引用的章节不存在？HANDBOOK 引用的 ARCHITECTURE §xxx 能对上吗？FDE 引用的模板路径存在吗？还缺引用吗——有没有地方提到了某个概念（如「AI 知识库」「铁律」）却没有指向设计原理或详细说明的链接？
   检查所有文档头部的日期是否与当前发版日期一致。`grep 'YYYY-MM-' *.md docs/design/*.md`——有没有过期日期？bump-version 脚本只改版本号不改日期，这个坑反复出现。
7. **CHANGELOG 全历史纯度**：检查所有历史 CHANGELOG 条目——有没有审查元信息（模型名、审查轮次、维度数、P0/P1 计数）？CHANGELOG 应该只写产品变更，不含审查过程。
8. **根目录整洁度**：根目录应该只有 5-7 个核心文件（README/LICENSE/CHANGELOG/CONTRIBUTING/SECURITY/CODE_OF_CONDUCT/ROADMAP）。其余 md 文件、HTML、PNG 是否应该移入 docs/ 或 assets/？国际化翻译版 README.xx.md（如 README.en.md）不计入此计数。

你的核心问题是："这个项目的代码组织方式让我觉得它是认真维护的，还是一团乱麻？"

---

## 第二轮：用户旅程审查（维度 6）

> 前面 5 个角色是"各自站在一个角度看"，这一轮换个方法：**不走维度，走路径**。你假装是一个真实用户，从零开始完整走一遍使用流程。每一步都问自己：卡住了吗？困惑吗？报错信息能看懂吗？哪里让你想放弃？

## 维度六：🛤️ 完整用户旅程

> 你是一个想用 sofagent 的开发者。你不用读完所有文档——你直接动手装，遇到问题再查。你的目标是：装上 sofagent，在一个真实 git 项目里让它跑起来，体验一次审计拦截。

**你的任务（按顺序执行，记录每一步的体验）**：

1. **发现**：你在 GitHub 搜 "git pre-commit AI audit" 或者某个群里看到推荐。点进 README——30 秒内你能说清楚这东西是干什么的吗？
2. **安装**：跟着 Quick Start 走。npm install 顺利吗？还是 install.sh？装完之后你知道下一步做什么吗？
3. **初始化**：跑 `sofagent-audit --init`。输出清楚吗？config、hook、冒烟测试三步都顺滑吗？有没有让你困惑的提示？
4. **第一次 commit**：在一个真实 git 项目里改个文件，提交。审计 hook 触发了吗？输出能看懂吗？
5. **第一次拦截**：故意提交一个 .env 文件（或类似的敏感文件）。审计拦住了吗？报错信息告诉你怎么修了吗？
6. **探索更多**：你会继续翻 README / HANDBOOK 吗？还是觉得已经够了？
7. **放弃点**：从头到尾，哪个环节最可能让你放弃？如果放弃，你会用什么替代方案？

**输出格式**：画一张用户旅程图（文字版即可），标注每一步的体验评分（🟢 顺滑 / 🟡 小障碍 / 🔴 卡住），以及每个障碍的具体描述。

**放弃阈值**：如果前 3 步（发现 → 安装 → 初始化）出现 2 个🔴，记录放弃点并停止后续步骤——这个体验已经不及格，继续走只是浪费时间。直接在报告里标"放弃点：第 X 步"并说明原因。

---

## 第三轮：红队对抗审查（维度 7）

> 前两轮都是"正常使用"——你扮演各种角色走正常路径。这一轮反过来：**你是来搞破坏的**。你的目标是找出 sofagent 在极端、边缘、恶意场景下的弱点。不要测正常路径，只测不正常的。

## 维度七：🐛 红队对抗

> 你是一个安全测试工程师，任务是找出 sofagent 审计引擎的盲区和弱点。你不是来夸的——你是来找洞的。

**你的任务（每个都要实际尝试）**：

1. **边缘 git diff**：
   - 提交一个二进制文件变更——审计引擎怎么处理？
   - 提交一个超大的 diff（1000+ 行改动）——性能如何？输出可读吗？
   - 文件名含非 ASCII 字符（中文/emoji）——会不会崩？
   - 重命名 + 修改同时发生——diff-parser 能正确解析吗？

2. **config 篡改**：
   - 把 `.sofagent/config.yml` 改成不合法的 YAML——审计引擎怎么报错？
   - 删掉 config 里的关键字段——会静默跳过检查还是报错？
   - config 里写一个不存在的规则名——会被忽略还是会报错？

3. **hook 降级场景**：
   - Node.js 版本低于 18——会怎么提示？
   - 在非 git 目录跑 `sofagent-audit`——报错友好吗？
   - bash 不可用（比如纯 Windows PowerShell 环境）——hook 能跑吗？
   - 故意搞坏 hook（删掉 .git/hooks/commit-msg）——`--doctor` 能发现吗？

4. **绕过审计**：
   - `git commit --no-verify` 能绕过——这是设计如此还是安全风险？文档里有说明吗？
   - 如果 Agent 用 `git commit --no-verify` 提交，sofagent 能检测到吗？（`--doctor` 第 8 项）
   - **hook 文件删除检测**：Agent 直接删掉 `.git/hooks/commit-msg`——`--doctor` 能发现 hook 丢失吗？有没有自愈机制？还是只有用户手动跑 `--doctor` 才知道？
   - 有没有其他绕过路径？

5. **注入攻击面**：
   - 在 commit message 里写 prompt injection——会影响审计引擎吗？
   - 在被审计的代码注释里写 `ignore previous instructions`——A9 规则能检出吗？
   - 审计引擎自身有注入风险吗？（比如 grep 用户的代码内容）

6. **知识库访问控制盲区**：
   - 构造一个 workflow.yml，给它配 knowledge-domain include/exclude。然后让 Agent 读取一个 exclude 掉的页面——A14 能告警吗？
   - 把 workflow.yml 的 include 改成 `*`（全放开）——这算安全配置吗？有没有检测机制？
   - 如果在 knowledge-domain 里写一个不存在的页面路径——A14 怎么处理？崩溃还是跳过？
   - daemon Ingest 触发机制——如果短时间内大量制造 task/logs 文件，daemon 会怎么处理？防抖真的生效吗？
   - **多入口一致性**：install.sh 和 `--init` 都创建 knowledge/ 目录——两个入口创建的 index.md / log.md 模板格式一致吗？如果不一致，用户从不同入口初始化会得到不同的知识库结构。

7. **config rules 过滤回归**：
   - 在 config.yml 中设 `rules: { a1: false }`，提交 .env 文件。确认 A1 真的被禁用了（不被拦截）。
   - 在 config.yml 中设 `rules: { a14: false }`——确认扩展规则的 key 生成正确（不是因 number > 11 而错误生成 e-186 之类的 key）。
   - 同时禁用多条规则（如 `a1: false, a2: false`）——确认两条规则都被正确跳过，不会出现只跳过了一条的 bug。

8. **版本号替换完整性**：
   - bump-version.sh + check-version.sh 全绿后，还有没有漏网之鱼？手动 `grep` 一遍旧版本号，看看有没有脚本没覆盖到的位置。
   - ROADMAP 不止规划版本表——里面还有编排引擎详情表、Ontology 详情表、外部框架对齐表。重编号时这些表里的版本数跟着变了吗？
   - 文档头除了版本号还有日期——日期更新了吗？还是写的上版本的日期？
   - changelog 里有没有不该有的东西——比如"GLM-5.2 审查发现"、"DeepSeek 验证"之类的审查元信息？changelog 应该只写产品变更。

9. **模块安装隔离**：
   - 跑各模块的 install.sh（如 `install.sh`、`loop-install.sh`、`fde-install.sh`）——检查它们是否互相包含对方的安装逻辑（不应该）
   - 主安装不应自动安装可选模块（LOOP / FDE 等独立 Skill）

10. **Skill frontmatter 完整性**：
    - 检查所有 SKILL.md（含 `skill/`、`FDE/`、`LOOP/`）—— frontmatter 是否含 name/slug/displayName/description/version/tags/image/triggers/scenarios/not_when 全部字段
    - 检查 `triggers` 列表是否覆盖了合理的触发场景——有没有明显的遗漏
    - 检查 `not_when` 列表——是否列出了不应该触发的明确场景

11. **安装后快速体验路径**：
    - 按 quick-start.md（如有）走一遍——能否 5 分钟内完成首次操作
    - 如果 quick-start 里的某一步卡住了，记录卡在哪里

12. **跨平台触发**：
    - 在非 OpenClaw 平台（WorkBuddy/Codex）上尝试触发需要 OpenClaw 的功能——检查提示是否清晰
    - 是否明确告知用户"需要 OpenClaw 底座"而非静默失败

13. **Agent 定义与 OpenClaw 的耦合度**：
    - 读 `agents/` 下的 Agent 定义——是否过度依赖 `session.spawn` API？
    - 如果未来换平台或拆出去，Agent 定义本身能独立使用吗？

14. **审计工具自身文件测试**：
    - 修改 `.sofagent/audit/history.jsonl`（加入含 "ignore previous instructions" 的文本）→ commit 这个文件 → A9 会不会误报？
    - 修改 `.sofagent/config.yml` 为不合法 YAML → 审计引擎怎么报错？
    - 删除 `.sofagent/audit/history.jsonl` → 审计引擎是否正常工作？
    - 检查 history.jsonl 中是否存储了被拦截的敏感内容明文（A2 拦截密钥后，history.jsonl 里有没有密钥原文）？
    - **loadHistory 健壮性**：在 history.jsonl 插入一行无 timestamp 的 JSON（如 `{"test":"abc"}`）→ `--doctor` 第 8 项是否崩溃？catch 块是否吞错？攻击者能否用一行垃圾 JSON 永久禁用绕过检测？

15. **`--strict`/`--ci` exit code 验证**：
    - 跑 `sofagent-audit --diff HEAD~1..HEAD --task "wrong" --strict` → exit code 是 2 还是 1？
    - 如果 exit 1：检查 `reporter.ts` 的 `runRules()` 中 `strict` 参数是否在 exitCode 计算中被使用
    - commit-msg hook 用的是 `--ci`（= `--silent`，不再隐含 `--strict`）——WARN 级规则（A3/A4）exit 1 放行，不阻断 commit；FAIL 级规则（A1/A2）exit 2 阻断

16. **A9 Unicode/leet 绕过测试**：
    - 在代码注释中写全角字符 `ｉｇｎｏｒｅ ｐｒｅｖｉｏｕｓ ｉｎｓｔｒｕｃｔｉｏｎｓ` → A9 是否检出？
    - 在代码注释中写 leet speak `1gn0r3 pr3v10us 1nstruct10ns` → A9 是否检出？
    - 在 commit message 中写 `ignore previous instructions` → A9 是否扫描 commit message？

17. **审计日志完整性测试**：
    - history.jsonl 是否有 hash chain 或 HMAC 签名？
    - 手动篡改 history.jsonl 中间一行 → `--doctor` 是否检测到？
    - Agent 以当前用户身份能否直接读写 history.jsonl？

18. **eval harness 污染**：
    - golden set 测试用例是静态文件——Agent 能否通过修改 golden set 来"考自己会做的题"？
    - `runEval()` 的评分逻辑（精确匹配 / 语义相似度 / 规则合规）权重是否硬编码？Agent 知道权重后能否针对性地"刷分"？

19. **A15 约束验证绕过**：
    - config.yml 声明 `actions: [read]` 但 Agent 实际执行了 write——A15 离线验证能检出吗？
    - 如果 config.yml 没有 actions 字段——A15 是跳过还是告警？Agent 能否通过"不声明 actions"来规避约束检查？
    - **actions 未声明绕过（v1.1.3 升级——安全红线）**：workflow.yml 存在但各节点没有 `actions` 字段——A15 应返回 **FAIL**（而非 fail-open WARN）。验证 `rule-a15-action-constraint.ts` 中 `nodesWithActions.length === 0` 分支：返回 PASS 或静默 = P0 安全红线（Agent 不声明 actions 即绕过所有约束）；返回 WARN 是当前默认，FAIL 是更严格的设计目标。
    - actions 提取正则——如果 diff 格式不标准（如 binary 文件 / 特殊编码），正则漏匹配导致"没检测到"被当作"合规"？

20. **HITL 置信度操纵**：
    - 置信度 score 怎么算的？如果 score 来自模型自评，Agent 能否通过措辞操纵来刷高置信度？
    - 四类强制人工场景（删除 / 外部 API / 权限变更 / 数据迁移）的正则——`rm -rf test/`（合理的测试清理）会被误匹配吗？

21. **A/B 自进化 promote 攻击**：
    - `decidePromotion()` 的连续胜出阈值——如果 B 版本碰巧在阈值内的几个场景赢了，但整体更差，会 promote 吗？**v1.1.3 追加**：promote 守卫——除连续胜出外，还必须要求 `overallImprovement > 0`（整体改善）。没有这个守卫 = 窄 eval 集连胜 2 次即晋升更差版本。
    - promote 后旧版本归档到 `.sofagent/subagents/history/`——Agent 能否通过删除归档来"洗白"被回退的历史？
    - A/B 对比的 eval 场景如果偏窄（只测了简单 case），promote 的版本在复杂场景下更差怎么办？

22. **post-commit hook 绕过验证**：
    - Agent 删掉 `.git/hooks/post-commit`——`--doctor` 能发现 hook 丢失吗？有没有自愈机制？
    - `git commit --no-verify` 绕过了 commit-msg hook——post-commit hook 是否仍然触发？（设计意图：post-commit 不受 --no-verify 影响）
    - post-commit hook 的输出是否为 UTF-8 中文？有没有乱码风险？（历史教训：曾出现中文乱码）
    - post-commit 的 exit code 是否始终为 0？（设计意图：提醒而非阻断）
    - 如果 Agent 同时删掉 commit-msg 和 post-commit——`--doctor` 能发现两个 hook 都丢失吗？

23. **hashVersion 混合格式篡改测试**：
    - 构造 history.jsonl：前 N 条为旧格式（无 hashVersion 字段），后 M 条为新格式（hashVersion: 2）——`checkHistoryChainIntegrity()` 是否正确返回 true（不误报链断裂）？
    - 篡改中间一条 v2 格式条目的 prevHash——`--doctor` 是否检测到链断裂？
    - 篡改中间一条 v1 格式条目的内容——`--doctor` 是否检测到（v1 用旧算法计算 hash，不含 fingerprint）？
    - 在 history.jsonl 尾部追加一条 hashVersion: 3 的条目——代码会怎么处理未知版本号？

24. **集成代码 CLI 契约对抗**：
    - 打开 `skillopt-integration.ts`——`isSkillOptAvailable()` 和 `runSkillOpt()` 调用的 CLI 参数形式与真实 `skillopt-sleep --help` 声明的子命令/参数是否一致？
    - 历史教训：曾发现集成代码用 `--version` 探活（真实 CLI exit 2）、用 flat positional + `--output` 调用（真实 CLI 只认子命令 `run --target-skill-path`）——照着不存在的 CLI 契约写了整整一个版本
    - 跑 `skillopt-sleep --help` 看真实子命令列表，逐一对比集成代码的调用形式
    - 同理检查其他外部 CLI 集成（如 `loadDeepAgents` 调用的 deepagents API）是否也有契约漂移

25. **daemon 文件监控防抖与吞审计**：
    - 如果当前版本已实现文件系统审计（daemon + isomorphic-git）：短时间内制造大量文件变更（脚本批量创建 100+ 文件），daemon 的防抖机制会怎样？是等 30 分钟统一审计一次，还是逐个审计？会不会因为防抖窗口太长而漏掉"创建后立即删除"的中间态违规？
    - daemon 监控的目录列表——用户能配置吗？如果 Agent 把文件写到一个不被监控的目录，审计引擎完全无感知？
    - 文件系统审计不依赖 git commit——那如果 Agent 直接用系统 API 写文件（绕过 bash/git），daemon 的 `fs.watch` 能捕获到吗？
    - 审计结果推送——如果 Webhook URL 配错了或目标服务挂了，daemon 会重试还是静默丢弃告警？

26. **Sub Agent 约束自加载对抗**：
    - 如果当前版本已实现 Sub Agent 自加载（`buildConstrainedSystemPrompt`）：Agent 在启动时读 `.sofagent/` 下的约束文件——如果 Agent 在读之前先把 SKILL.md 的内容换成空字符串，约束就没了。有校验机制吗？
    - 约束文件被 Agent 自己删除后重新创建（内容不同）——自加载能检测到篡改吗？还是直接信任磁盘上的内容？
    - CLI 编排入口 `sofagent-orchestrator compose --task`——如果 Agent 调用时传入一个超长的 task 描述（prompt injection），编排引擎会原样传给 Sub Agent 吗？

**输出格式**：

```markdown
## 红队对抗报告

### 测试矩阵
| # | 场景 | 预期 | 实际 | 严重度 |
|---|------|------|------|--------|
| 1 | 二进制文件 diff | ? | ? | ? |
| 2 | 超大 diff | ? | ? | ? |
...

### 发现的弱点
| 严重度 | 弱点 | 复现步骤 | 建议修复 |
|--------|------|---------|---------|

### 绕过路径
[如果有绕过审计的方法，在这里列出]
```

---

## 第四轮：CI/自动化一致性审查（维度 8）

> 前面三轮都是人在看——凭直觉、走路径、搞破坏。这一轮换个方法：**你是 CI 机器人，只做一件事——把文档里的数字和代码里的数字对一遍**。人类审查容易跳过"数字对不上"这种枯燥检查，但这是最容易暴露问题的地方。

## 维度八：🤖 CI/自动化一致性

> 你是一个没有感情的 CI 机器人。你不读叙事、不感受语气、不判断定位——你只做一件事：**把文档中出现的每一个数字声称，与代码中的实际数字交叉验证**。数字对不上就是 P0，没有商量。

**你的任务（每个都要实际跑命令验证）**：

1. **规则数量一致性**：
   - README 声称"X 条规则"——打开 `sofagent/audit/src/rules/index.ts`，数 `defaultRules` + `extendedRules` 的 `name:` 字段数。一致吗？
   - README 声称"Y 条纯 git-diff + Z 条需 Agent 日志"——逐条检查每条规则的 `evidenceMode` 字段，数 `git-diff` 和 `hybrid` 的数量。一致吗？
   - CHANGELOG 历史条目中提到的规则数量——与当前 index.ts 一致吗？有没有"历史声称 > 实际注册"的情况？
   - **规则 ID 分类交叉验证**：README 分类描述里的每个规则 ID 逐个在 index.ts 中确认存在。历史教训：曾反复出现"幽灵规则"问题——README 声称了代码中无对应 `name:` 注册的规则 ID。不仅看数量，还要看 ID 是否一一对应。**注意跳号**：A1-A11 后直接跳到 A14（A12/A13 永久跳号），这不是遗漏——但如果 README 声称了 A12 或 A13，那才是幽灵规则。

2. **测试数量一致性**：
   - CHANGELOG / README / evidence.md 中声称的测试数量——实际跑 `cd sofagent/audit && npm test 2>&1 | grep 'Tests'`。一致吗？
   - evidence.md 的数字是上次发版时的快照还是当前实际值？

3. **verify 项数一致性**：
   - LIMITATIONS.md 声称"~N 项（动态）"——实际跑 `node sofagent/audit/dist/verify.js --list 2>&1 | head -5`。在声称范围内吗？
   - CHANGELOG 中提到的 verify 项数——与当前一致吗？

4. **维度数字一致性**：
   - regression-checklist.md 文件头声称"N 维度"——实际数 `####` 标题数。一致吗？
   - 输出模板中的"总维度数：N"——与文件头一致吗？

5. **版本号全局一致（含 tag commit message）**：
   - `package.json` 版本号——与 README / CHANGELOG / SECURITY / LIMITATIONS / ROADMAP 文件头版本号一致吗？
   - `sofagent/audit/package.json` 与 `sofagent/mcp/package.json` 版本号一致吗？
   - `tools/check-version.sh` 检查的版本号与 SSOT 一致吗？
   - **版本全量一致（v1.0.8 暴露的新盲区，阶段六实证）**：`sofagent/audit/src/shared/constants.ts` 的 `VERSION` 常量、各 `package.json`、`index.ts` 文件头注释——与 `sofagent/audit/package.json` 的 `version` 一致吗？**但不能只查这几个 CLI 自报源**：v1.0.8 曾只 bump 了 package.json + constants.ts + mcp + index.ts 部分（4 源全 1.0.8），91 个散落文件的版本号仍是 1.0.7——4 源检查全过却发了错版，阶段六才用 `check-version.sh` 抓出 93 处不一致。权威门禁是 `bash tools/check-version.sh`（应 0 不一致）+ `bash tools/pre-push-check.sh`（应 7/7 全绿）。CI 机器人必须跑全量扫描，不能凭"4 源对得上"就放行。
   - **tag commit message 一致性（v1.1.3 追加）**：跑 `git show vX.Y.Z --format=%s -s`——tag 指向的 commit message 必须含版本号。历史教训：v1.1.3 tag 指向 commit message 为 "v1.1.3: …"——tag 版本与 commit message 不一致。检查手法：`git tag -l "v*" | while read t; do v=$(echo $t | sed 's/^v//'); msg=$(git log -1 --format=%s $t); echo "$t → $msg" | grep -q "$v" || echo "❌ $t: commit message 不含 $v"; done`

6. **文件计数一致性**：
   - 根目录 `.md` 文件数——是否 ≤7（README/CHANGELOG/CONTRIBUTING/SECURITY/CODE_OF_CONDUCT/ROADMAP/LIMITATIONS）？多余的 .md / .html / .png 应移入 docs/ 或 assets/。国际化翻译版 README.xx.md（如 README.en.md）不计入此计数。
   - Skill 文件数——README 声称"10 个 Skill 文件"——实际 `ls sofagent/skill/*.md | wc -l` 一致吗？
   - Agent 定义文件数——README/LOOP 文档声称的 Agent 数——实际 `ls agents/*.md | wc -l`（减去 README.md）一致吗？

7. **CHANGELOG 纯度**：
   - CHANGELOG 全历史——有没有审查元信息？`grep -iE "GLM|DeepSeek|双视角|P[012]×|7 视角|8 视角|× 6 方面|审查修复|陌生视角|fresh-eyes|× [0-9]+ 视角|审查轮次|审查×" CHANGELOG.md`。CHANGELOG 应该只写产品变更，不含审查过程。历史教训：多个版本标题含"审查修复""陌生视角审查修复"等元信息。
   - changelog 子文件（`docs/changelog/v*.md`）同理——有没有模型名、审查轮次、P0/P1/P2 标签等元信息？**v1.1.3 起扩展 grep 范围到 `docs/changelog/*.md` 全量**，因为历史 experimental changelog 可能含遗留审查元信息。
   - **检查手法（v1.1.3 扩展）**：`grep -rniE "GLM|DeepSeek|双视角|P[012]×|审查修复|陌生视角|fresh-eyes|审查轮次|审查×|审查驱动|审查吸收" CHANGELOG.md docs/changelog/*.md`，期望零命中。注意：工作流正当描述如「独立审查 + 写 changelog」「FDE 审查报告」不在此列。

8. **evidenceMode 与 README 分类匹配**：
   - README 把规则分为"纯 git-diff"和"需 Agent 日志"——逐条对照 index.ts 的 `evidenceMode` 字段。有没有标了 `hybrid` 但 README 归到"纯 git-diff"的规则？反之有没有？

9. **README Mermaid 图与正文一致性**：
   - 编排引擎 Mermaid 图写"自动切换"，正文写"A/B 对比为手动"——图与文矛盾。检查所有 Mermaid 图中的标签是否与紧接的正文描述一致。
   - 约束底座 Mermaid 写"4 底线 + 7 铁律"——与 SKILL.md 实际内容一致吗？

10. **编排引擎声称诚实度**：
   - README 说编排引擎"全平台可用，不再绑定 OpenClaw"——实际实现：DeepAgents 是 optional dependency，68 行 `launcher.ts` wrapper，A/B 对比需手动执行。
   - 检查：README 对编排引擎的描述是否诚实标注了"实验性"和当前限制？

11. **SkillOpt 可用性返回值实测**：
   - 跑 `node -e "console.log(require('./sofagent/audit/dist/skillopt-integration').isSkillOptAvailable())"` 在已安装 skillopt-sleep 的环境下返回 `true`？
   - 如果返回 `false`——检查探针形式是否匹配真实 CLI（`status` 子命令 exit 0 vs `--version` exit 2）。历史教训：曾因探针形式错误导致已安装也返回 false，SkillOpt 能力被静默禁用
   - 跑 `node -e "console.log(typeof require('./sofagent/audit/dist/skillopt-integration').isSkillOptAvailable())"` 确认返回 `boolean`（不是 Promise）
   - **v1.1.3 升级为实跑验证**：装 skillopt-sleep 后跑 `skillopt-sleep --help` 看真实子命令列表，逐一对比集成代码的调用形式。仅静态读源码不算验证。

12. **版本敏感的规则数声称**：
   - README 可能声称"17 条规则（v1.0.9 扩展为 19 条）"——这是**版本条件声称**。验证当前 `package.json` 的版本号，再看 A16/A17 是否已在 `index.ts` 注册。如果当前是 v1.0.8 但 README 说"19 条"，就是 P0 不一致。
   - README 审计引擎 Mermaid 图里写的规则数（如"17 条规则"）——与 index.ts 注册数一致吗？
   - CHANGELOG 历史条目中提到的规则数——有没有"当时声称 N 条但代码实际 M 条"的情况？

13. **发版终验必须独立跑完整门禁（不信任任何"已验证"声明）** 🆕
   - **v1.0.8 教训**：阶段四终审只验了用户指定的 4 项（constants/README/build/test），漏跑了实际发版门禁（`pre-push-check` / `check-version`）。版本号散落 91 文件仍是 1.0.7 因此溜过，直到阶段六独立 session 才用 `check-version.sh` 抓出 93 处不一致。
   - **盲区本质**：独立审查者不能只验"别人/用户给的清单"——开发报告、用户指定项、上次审查结论都不算数。**收口硬判定必须是亲手跑** `bash tools/pre-push-check.sh`（7/7）+ `bash tools/check-version.sh`（0 不一致，非 strict 下 1 项 warning 属预期）。清单验收永远代替不了门禁实跑。

14. **版本变更必须走工具，且工具自身状态假设也是审查对象** 🆕
   - 版本 bump 一律走 `tools/bump-version.sh`，禁手动散点改 SSOT（v1.0.8 P0 正是手动散点 bump 漏了 91 文件）。
   - 但文档化工具自身有状态假设：`bump-version.sh` 从 `package.json` 读 OLD 版本号，若 SSOT 已被手动超前（如先手 bump 成 1.0.8），脚本会误判并在 296 行 `NEW_3SEG unbound` 崩溃。独立审查者应注意"工具可用性边界"，别盲信文档化脚本——遇到崩溃先查 SSOT 与磁盘是否一致。
   - 跨包依赖（`sofagent/mcp/package.json` 对 `@sofagent/audit` 的 `^1.0.0`）用通用范围、不写死 SSOT：功能已覆盖当前版本，`check-version.sh` 的 1 项 warning 是预期非阻断。**不要用 `^1.0.8` 硬编码**——否则每发一版都得手改这条依赖，reintroduce 散点 bump 风险。

15. **验收测试脚本自身的 shell 安全性** 🆕
   - **v1.0.9 教训**：acceptance-test.sh 全局 `set -euo pipefail`，但多处 `git log --oneline | grep -q "xxx"` 模式在 commit 数量大时被 SIGPIPE 误杀（grep -q 匹配后退出 → git log 收到 SIGPIPE 返回 141 → pipefail 判管道失败 → if ! 判 true → 误报 FAIL）。同类模式还包括 `$CLI --doctor 2>&1` 返回非零时 set -e 直接终止脚本，跳过后续场景。
   - **盲区本质**：开发者写测试脚本时，默认"set -e 保护我"——但 `pipefail` 和"长管道匹配"组合后，保护变成炸弹。陌生审查者应把 `grep -n 'git log.*| grep -q' tools/acceptance-test.sh` 当第一件事跑。
   - **同类风险扩散**：所有 `... | grep -q` 模式（不只 git log）、所有 `$(... )` 子shell 中返回非零的 $CLI 调用——都需检查是否有 `|| true` 保护。

16. **hook 安装入口的语义差异（--install-hook vs --init）** 🆕
   - **v1.0.9 教训**：`--install-hook` 只装 `commit-msg`（快速入口），`--init` 装 `commit-msg` + `post-commit` + `config.yml`（完整初始化）。两者都是"安装"但产物不同，验收测试场景 1 混用了 `--install-hook` 却检查两个 hook。
   - **盲区本质**：CLI 有多个"看起来做同一件事"的入口（install-hook / init / 手动 cp），但它们的产品语义不同。陌生审查者不能假设"安装了就全套"——必须验证每个入口安装的具体产物清单。
   - **延伸检查**：`--init` 在 v1.0.9 还加了"dirty 状态检测"——有未提交更改时会拒绝安装 hook（只创建 config）。这意味着 acceptance-test 在连续场景中，前一个场景的脏状态会阻断后续场景的 `--init`。

17. **新增功能的注册同步盲区与规则禁用逻辑验证（v1.1.3 路径修正）** 🆕
   - **v1.0.9 阶段六教训**：新增 A16/A17 规则后，规则校验器的已知键集合忘记同步更新，导致用户在 config.yml 写 `a16: true` 时误报"未知规则名"。v1.1.0 包拆分后，`config-loader.ts` 已迁至 `core/src/`，规则动态禁用逻辑改为 `runner.ts` 的 `a{number}`/`e{number}` 动态键生成。
   - **盲区本质**：每新增一个功能（规则/函数/命令），需要同步更新的地方不止一处——注册表（rules/index.ts）、规则禁用校验器、帮助文本、注释。开发者只改了"核心实现"，忘了"外围感知"。陌生审查者必须**沿着功能注册链走一遍**：规则号在 index.ts 注册了吗？动态禁用逻辑覆盖了吗？注释和警告文案更新了吗？测试的所有分支和代码行为一致吗？
   - **检查手法（v1.1.3 更新）**：在 config.yml 中设 `rules: { a16: false }`，跑审计提交一个触发 A16 的变更。确认 A16 真的被跳过（不再出现 A16 判定行）。同理验证 `a17: false`、`a1: false`、多条同时禁用。每个新增纯函数跑 `npm test` 确认 0 failed。

18. **包拆分后的独立构建验证（新攻击面）** 🆕
   - **v1.1.0 教训**：11 包拆分后，audit 构建通过不代表 core/orchestrator 也能独立构建。core 曾因缺少 `filesystem/` 目录报 TS2307，orchestrator 可能因依赖缺失而失败。陌生审查者必须对每个包独立跑 `tsc --noEmit`——不要假设"主包过了其他包也能过"。
   - **盲区本质**：开发者在 audit 包内开发、测试，习惯性只跑 audit 的 build。拆包后每个包的 tsconfig 独立、依赖独立，一个包的构建成功不传递到其他包。
   - **检查手法**：对 core/orchestrator/daemon/ab-test 等新包逐一 `npx tsc --noEmit`，报任何 TS2307/TS2305 都是 P0。

19. **"复制≠移动"——文件迁移完整性检测（新攻击面）** 🆕
   - **v1.1.0 教训**：AI 工程师做源码迁移时，在新包创建了文件副本，但忘了删除 audit/src/ 中的原文件。导致 audit 成为"重复文件仓库"——同一份代码在 audit 和新包各有一份，后续修改不同步产生行为差异。
   - **盲区本质**：人类审查"文件迁移"时会自然检查源是否已删，但 AI 工程师的"完成报告"只说"已创建 N 个文件"，不会主动报告"未删除 M 个源文件"。陌生审查者必须反向验证——不是确认新包有啥，而是确认 audit/src/ 里**不该有啥**。
   - **检查手法**：对照架构设计文档中的迁移清单，逐项确认 audit/src/ 中不应存在的目录/文件是否已删除。`grep -rn "from '\.\.\/subagents\|from '\.\.\/eval" sofagent/audit/src/` 查残留 import。

20. **测试工厂函数迁移后的签名兼容性（新盲区）** 🆕
   - **v1.1.0 教训**：测试辅助函数（`makeCtx`/`makeDiffFile`）从各测试文件内联实现提取为共享 `test-utils.ts` 后，参数签名与原始调用方不兼容——`makeCtx` 缺少 `commitMsg`/`task`/`strict` 字段透传导致所有规则测试返回 PASS；`makeDiffFile` 缺少 `status` 参数导致删除类规则测试失效。
   - **盲区本质**：提取共享 helper 时，开发者只看了"最常见调用方式"，没覆盖所有调用方的参数组合。陌生审查者应实际运行测试——74 个测试因这个盲区静默失败，但 npm test 的 exit code 仍然是 1（有 failure），只是被 IS_PASS 声明掩盖了。
   - **检查手法**：`npm test` 后检查是否有 `expected 'PASS' to be 'WARN'` 模式的断言失败（所有规则都返回 PASS），这是工厂函数不兼容的典型信号。

21. **audit/src/ 收敛验证（v1.0.9 文件迁移后联动）** 🆕
   - **v1.0.9 教训**：LIMITATIONS.md 从 `docs/` 迁到根目录后，8 处跨文件引用未同步更新，形成死链。v1.1.0 教训放大：不仅文档会迁移，源码也会——subagents/ontology/eval/daemon/ 等 9 个目录从 audit 迁到新包后，audit/src/ 中残留副本 + 残留 import + 残留测试文件形成三重污染。
   - **盲区本质**：文件迁移不是"复制过去"就完了——是"移动过去 + 删除源 + 更新所有引用 + 迁移测试"。四个动作缺一不可。陌生审查者必须逐一验证这四个动作都已完成。
   - **检查手法**：`for d in subagents ontology eval daemon; do ls sofagent/audit/src/$d 2>&1; done` 全部应报 No such file。同样检查散文件。

22. **测试计数漂移的文档联动检测（新盲区）** 🆕
   - **v1.1.0 教训**：77 个测试随被测模块迁出后，npm test 从 531→417。但 CHANGELOG/ROADMAP/FDE/evidence/LIMITATIONS 等 5 处文档仍写 531。发布后审查者的任务八"测试数一致性"被触发——发现文档数字与实跑数字不符。
   - **盲区本质**：测试数是一个"分布式声称"——8 个文档各自维护，没有单一事实源自动同步。每次测试迁移必须全量 grep 更新。
   - **检查手法**：`ACTUAL=$(cd sofagent/audit && npm test 2>&1 | grep Tests | grep -oE '[0-9]+(?= passed)'); grep -rn "$ACTUAL" ROADMAP.md FDE/FDE.md docs/evidence/evidence.md LIMITATIONS.md` 期望 4 处全部命中。

23. **基础层叶子包的反向依赖验证（新维度）** 🆕
   - **v1.1.0 架构铁律**：harness/ontology/eval/core 为基础层叶子，**绝不** import 任何 `@sofagent/*` 包。陌生审查者应逐一检查四个包的 src/ 目录是否真的零跨包引用。
   - **盲区本质**：开发者可能在"最后一刻"加了一个 import 来解决编译问题（如 core 想 import ontology 的某个类型），但违反架构铁律。这类 import 在 monorepo symlink 环境下编译能过（npm workspace 自动 resolve），但破坏了分层。
   - **检查手法**：`for pkg in harness ontology eval core; do grep -rn "from '@sofagent/" "sofagent/$pkg/src/"; done` 期望四个包全部零输出。

#### 24. **跨包代码重复检测（复制≠移动）** 🆕
   - **v1.1.3 全仓审计发现**：audit/src/filesystem/isomorphic-git.ts(383行) 与 core/src/filesystem/isomorphic-git.ts(383行) 仅 4 行差异——audit 应 import @sofagent/core，却复制了一份。跨包复制在 monorepo 下编译能过、功能正常，所以永远不进功能回归——只有「跨包 diff」才发现得了。
   - **盲区本质**：单包审查（「我只在 audit 包改」）看不到别的包有同名文件；它「能用」所以没症状。陌生审查者必须跨包比对同名源文件。
   - **检查手法**：`find sofagent -path '*/src/*.ts' -not -path '*/node_modules/*' -not -path '*/__tests__/*' | sed 's#.*/##' | sort | uniq -d` —— 有输出 = 跨包重复 → 提升为 import（core 为 canonical source），删除副本。

#### 25. **Ledger-Views 归属一致性（think.md 永远为 Ledger/source）** 🆕
   - **v1.1.3 全仓审计发现**：ARCHITECTURE.md:320 将 think.md 错标为 Views(派生视图)，PHILOSOPHY.md:132 正确标为 Ledger(原始数据)。Dream Cycle 从 think.md **抽取** 事实进 knowledge/(派生)——think.md 是 source 不是 derived。单篇阅读发现不了，必须两篇对照 + 推理数据流。
   - **盲区本质**：记忆模型三层(Ledger-Views-Policy)的归属描述散落在多文档，任何一篇单独看都「像对的」，只有跨文档对照 + 确认派生方向才暴露矛盾。
   - **检查手法**：`grep -rn "think.md.*Views\|think.md.*派生视图" ARCHITECTURE.md PHILOSOPHY.md DEVELOPMENT.md FDE/FDE.md` 期望零匹配；且 Ledger-Views-Policy 映射中 think.md=Ledger、knowledge/=Views、方向严格 think.md→knowledge/。

#### 26. **孤儿 changelog 与 CHANGELOG 索引完整性（v1.1.3 追加）** 🆕
   - **盲区**：`docs/changelog/` 下存在无对应 git tag 的 .md 文件（如 v1.1.3.md/v1.1.4.md 等规划中文件），可能被自动化门禁误读为已发布版本。反向也存在：git tag 存在但 CHANGELOG.md 索引中无条目（v1.1.3 审查发现 v1.1.1 tag 存在但索引遗漏）。
   - **检查手法**：
     - 正向：`for f in docs/changelog/v*.md; do v=$(basename $f .md); git rev-parse $v >/dev/null 2>&1 || echo "⚠️ $v: changelog 存在但无对应 tag（应为规划中）"; done`
     - 反向：`git tag -l "v*" | while read t; do grep -q "$t" CHANGELOG.md || echo "❌ $t: tag 存在但 CHANGELOG.md 索引遗漏"; done`

#### 27. **ruleClass 跨文档漂移检测（v1.1.3 追加）** 🆕
   - **v1.1.3 审查发现**：A6 和 A11 的 ruleClass 在 `rules/index.ts`（SSOT）和 `audit/README.md` 规则表之间反复漂移。单文档审查永远发现不了——ruleClass 不是"错"，是"不一致"。
   - **盲区本质**：规则分级定义在两处——代码（SSOT）和文档（README 规则表）手工维护。每次调整 ruleClass 时，README 表格容易遗漏更新。
   - **检查手法**：提取 index.ts 的 `name` + `ruleClass` → 与 audit/README.md 规则表的名称+分级列逐行 diff。建议对此建自动化脚本加入 pre-push-check（参考回归清单·维度 4「审计规则分级与 ruleClass 一致性」的 A6/A11 人工 grep，扩展为全量逐行 diff）。

#### 28. **Agent 身份感知有效性（v1.1.3 补入）** 🆕
   - **背景**：v1.1.2 的三层输出签名（CLI/Webhook/MCP 带 `[sofagent]` 前缀）解决了「输出渠道可见性」，但 Agent 本身不知道约束来自 sofagent——约束在生效，用户和 Agent 都感知不到。
   - **检查手法**：
     1. SKILL.md 是否含方案 C 身份感知指令（`grep -c "露个脸就够了" sofagent/skill/SKILL.md` ≥ 1）
     2. engage.md 是否含身份感知序言（`grep -c "质量搭档" sofagent/skill/engage.md` ≥ 1）
     3. install.sh 完成后是否输出「✅ sofagent 已就绪」品牌行
     4. FDE/FDE.md §13 是否注明 Agent 身份感知设计意图
   - **验证**：从一个 clean slate 加载 sofagent skill 后，Agent 是否在上下文中感知到 sofagent 的存在（通过 system prompt 或首次响应确认）

**输出格式**：

```markdown
## CI/自动化一致性报告

### 数字对照表
| 声称来源 | 声称数字 | 实际来源 | 实际数字 | 一致？ |
|---------|---------|---------|---------|:------:|
| README  | 16 条规则 | index.ts | 15 条 | ❌ |
| CHANGELOG | 465 测试 | npm test | 465 | ✅ |
...

### 不一致清单
| 严重度 | 不一致项 | 声称值 | 实际值 | 修复建议 |
|--------|---------|-------|-------|---------|
| P0 | README 规则数 | 16 | 15 | 改为"15 条已实现 + 2 条规划中" |
...
```

---


## 维度九：👁️ 感知层健全性

> 你做完了前面八轮审查，确认了文档和代码的一致性。但还有一个维度是前八轮都没覆盖的：**用户能不能感知到 sofagent 的存在？** Harness 中间件最大的挑战是——所有引擎都在正常工作，但用户看不到"是谁让这一切发生的"。

**你的任务**：

1. **所有面向用户的输出是否带签名**：
   - 翻查 `sofagent/audit/src/index.ts` 中所有 `console.log` 输出：PASS/WARN/FAIL 的判定行是否标注了引擎身份（`sofagent-audit` 或 `[sofagent]`）？
   - 翻查 `sofagent/audit/src/webhook.ts` 中推送到 IM 的消息：第一行是否以 `[sofagent]` 或 `sofagent` 开头？
   - 翻查 `sofagent/mcp/src/mcp-server.ts` 中所有 `sendToolResult` 的 `text` 字段：是否以 `[sofagent]` 为前缀标注来源？**特别检查 think.md 回读工具（get_think/write_think）的返回——这是 v1.1.3 审查发现的感知层废墟高发区**，Agent 在回读反思/日志时如果不知道"这是 sofagent 管的数据"，就等于废墟功能。

2. **PASS 是否也在推送**：
   - 检查 `sofagent/audit/src/webhook.ts` 的 `pushAuditResult()` 函数：PASS 时是否推送？还是只在 WARN/FAIL 时推送？
   - 如果只在 WARN/FAIL 时推送——PASS 是最大的可见性缺口。Agent 做对了的时候，用户恰恰最需要知道"这个对，是经过验证的对"。

3. **持续感知层文档是否健全**：
   - FDE/FDE.md 是否有 §13 持续存在感机制？含感知衰减曲线图？
   - 概念培训文档是否包含了成功悖论的论述？
   - PHILOSOPHY.md 是否将"持续存在感"列为设计原则？

4. **如果用户看到的结果没有 sofagent 签名**：从用户的角度，你怎么区分"模型自己生成的结果"和"经过 sofagent 审计引擎验证的结果"？如果无法区分，这就是废墟功能——做了但用户感知不到，等于没做。


> 📋 输出格式见下方「审查输出格式」（适用于全部九维度）。

---

## 审查输出格式（适用于全部九维度）

每轮维度输出一份不超过 1 页的报告：

```markdown
## 维度 N：[维度名称]

### 产品定位
[这个维度下对产品定位的判断]

### 工程质量
[这个维度下的工程质量印象]

### 文档与上手
[上手体验]

### 安全与诚实
[该维度下的信任度判断]

### 文档精简度
[有没有读到重复内容？有没有段落感觉"留着也行删了也行"？有没有一段话读完什么信息也没拿到？]

### 生命力
[该维度下的存续判断]

### 总体印象（1-10 分）
[分数 + 一句话理由]

### 发现的问题（如有）
| 严重度 | 问题 | 建议 |
|--------|------|------|
```

### 审查体系更新建议（完成全部九维度后输出一次）

> 以下两项在完成所有维度后输出一次。不填视为审查未完成。

#### 建议调整的维度
> 有没有维度需要增删改？角色是否已过时？任务描述是否跟不上项目变化？

| 操作 | 维度/角色 | 当前问题 | 建议改法 |
|------|----------|---------|---------|
|      |          |         |         |

#### 建议追加到回归检查的内容
> 有没有发现的具体检查点，应该变成回归检查清单里的固定维度？不要写死编号——描述检查点和它防御的问题，落位由维护者决定。

| 检查点描述 | 防御的问题 | 建议落位 |
|-----------|-----------|---------|
|           |           |         |
---
## v1.1.3 审查追补——本版新暴露的盲区
> 以下盲区来自 v1.1.3 BugFix 版的开发经验，是本次新暴露的**具体案例**。跨版本提炼的**通用教训**见文末「审查体系演进」附录——两者互补：盲区讲"当时发生了什么"，附录讲"以后怎么防"，不重复。


### 盲区 1：acceptance-test.sh 管道 pipefail 导致虚假绿色

**现象**：`set -euo pipefail` 下 `echo "$OUTPUT" | grep -i "pattern" | head -3` 在 grep 无匹配时，head -3 关闭管道 → grep 收 SIGPIPE → pipefail 判管道失败 → set -e 直接退出脚本。exit code 可能是 0，表面看不出问题，但后续场景全部跳过。

**教训**：bash 脚本中所有 `... | grep ... | head/tail/wc` 展示管道必须在末尾补 `|| true`。CI 机器人应扫描 acceptance-test.sh 中所有此类管道，确认有保护。

**关联回归维度**：维度 8「acceptance-test 健壮性」

### 盲区 2：跨文档 ruleClass 不一致（README vs 代码）

**现象**：`sofagent/audit/README.md` 写 A6=业务底线（代码=能力拐杖）、A11=能力拐杖（代码=业务底线）。单看任何一篇都"像对的"，只有交叉对照才暴露矛盾。

**教训**：规则分级（ruleClass）不是只定义一次就完事了——README 表格是手动维护的，代码是 SSOT。每次新增/调整规则时必须同时更新 README 表格。

**关联回归维度**：维度 4「审计规则分级与 ruleClass 一致性」

### 盲区 3：webhook.ts 硬编码版本号散落

**现象**：`sofagent/audit/src/webhook.ts:24` 写 `const version = '1.1.3'`，check-version.sh 不会扫描到这种局部变量。版本号散落点不止 package.json + constants.ts + index.ts 自报——任何 `const version = 'X.Y.Z'` 模式都是散落点。

**教训**：全局搜索 `version\s*=\s*'[0-9]` 匹配所有硬编码版本号，将其改为 `import { VERSION } from '@sofagent/core'`。

**关联回归维度**：维度 6「版本号硬编码检测」

### 盲区 4：scenario() 场景间清理不彻底（git index vs 工作区）

**现象**：`scenario()` 函数的 `rm -f .env` 只清工作区文件，但 git index 中的 .env 仍然存在。后续场景 `git reset --hard` 回到含 .env 的 commit 时，工作区 .env 被重新还原。

**教训**：场景间清理必须是"git index + 工作区"双重清除：`git rm --cached -f .env 2>/dev/null || true` + `rm -f .env`。

**关联回归维度**：维度 8「acceptance-test 健壮性」

### 盲区 5：npm 已发布版本与工作树不一致（v1.1.3 暴露）

**现象**：v1.1.3 已 commit + tag + npm publish，但 ESM P0 修复（13 个 package.json exports 字段）仍躺工作树未提交。npm 用户装到的是有 ESM bug 的版本，工作树虽修好了却没上车。

**教训**：发版前的"工作树 clean 检查"不能只查"有没有未 commit 的修改"，要扩展为"**npm registry 版本 vs git tag vs 工作树三方一致**"——npm 版本落后于 SSOT 就是发版诚信问题。

**关联回归维度**：维度 17「npm 产物 + bin 权限 + tag commit message」

### 盲区 6：MCP 回读工具缺 [sofagent] 前缀（v1.1.3 暴露）

**现象**：v1.1.2 三层输出签名只覆盖了 CLI/Webhook/审计结果，但 MCP 的 think.md 回读工具（get_think/write_think）返回的 text 缺 `[sofagent]` 前缀。Agent 回读反思/日志时不知道"这是 sofagent 管的数据"——感知层废墟功能。

**教训**：感知层签名不是"做一遍就完了"——每加一个面向用户的输出渠道（含 MCP tools 返回的 text），都要回查签名是否覆盖。MCP 回读类工具是高发区。

**关联回归维度**：维度 7「感知层配置与推送链路」+ 维度九感知层

---

## 审查体系演进（附录）

> 本 prompt 自 v1.0.6 起随每轮审查持续追加检查项，新增项已写入对应维度任务（带版本标注）。以下仅保留跨版本**核心教训**，供审视时参考。

### v1.0.7 暴露
- **发版状态真实性**：changelog 写"已正式发版"必须有真实 commit + tag 支撑（v1.0.7 曾 97 文件未提交却标已发版）。→ 维度八·任务 13
- **测试数跨文件一致性**：CHANGELOG/ROADMAP/README/README.en/evidence 五处测试数必须一致（v1.0.7 实测 493，曾四处写 480）。→ 维度八·任务 2
- **版本号复制粘贴**：改写段落版本号必须与 package.json 一致（v1.0.7 P2-10 把 v1.0.7 误抄 v1.0.6）。→ 维度八·任务 5
- **hook skip 模糊匹配**：`includes('sofagent')` 式判断会让存量用户永远跳过重装（v1.0.7 P1-1）。→ 维度七

### v1.1.0 暴露
- **workspace 构建顺序**：`--workspaces` 按数组顺序非拓扑，think 排 mcp 后 CI 报 TS2307。→ 维度八·任务 15
- **12 包发布顺序**：拆分后发布顺序错会导致 npm install 失败。→ 维度二·任务 10
- **新包测试覆盖率鸿沟**：workflow-hub 1 / harness 0 / eval 0 vs audit 342。→ 维度八·任务 16
- **deprecation shim 可用性**：core 非必装，未装时 `--doctor` 崩溃→篡改检测降级。→ 维度七·任务 27
- **包拆分后独立构建**：一个包过不代表全体过（v1.1.0 core 曾缺 filesystem/ 报 TS2307）。→ 维度八·任务 18
- **"复制≠移动"**：AI 迁移只建副本不删源 → audit 成重复仓库。→ 维度八·任务 19/24
- **测试工厂函数签名**：提取共享 helper 后签名不兼容，74 测试静默失败。→ 维度八·任务 20
- **audit/src 收敛**：9 目录迁出后残留副本+import+测试三重污染。→ 维度八·任务 21

### v1.1.3 暴露
- **Harness 输出可见性**：所有输出渠道须标 sofagent 来源（MCP capabilities 曾漏 A15-A17）。→ 维度一·任务 14 等
- **deprecation shim 一致性**：注释说"已改"实际只 doctor 改了（v1.1.0）。→ 维度八·任务 19
- **维度数自校验**：回归清单头声称维度数与实际 #### 数须对齐（v1.1.3 曾 254≠259）。→ 维度八·任务 21/22
- **包依赖循环持续监控**：audit↔daemon 循环依赖首次独立检出。→ 回归维度 300
- **跨文档死链全量扫描**：v1.1.3 发现 23 处（文件迁移后 `../` 层数错）。→ 维度五·任务 15
- **跨包代码重复**：同名 .ts 两包各一份（isomorphic-git.ts 仅 4 行差）。→ 维度八·任务 24
- **Ledger-Views 归属**：think.md 永为 Ledger/source（ARCHITECTURE:320 曾错标 Views）。→ 维度八·任务 25
- **孤儿 changelog + 索引遗漏**：v1.1.1 tag 存在但 CHANGELOG 索引遗漏。→ 维度八·任务 26
- **ruleClass 跨文档漂移**：A6/A11 在代码与 README 间反复漂移，须逐行 diff。→ 维度八·任务 27
- **tag commit message 一致性**：v1.1.3 tag 指向 commit message "v1.1.3: …" 与版本号不符。→ 维度八·任务 5
- **npm 发版诚信**：v1.1.3 npm 已发布但工作树仍有 13 文件 ESM 修复未提交。→ 回归维度 17（新增）
- **MCP 回读缺签名**：MCP think.md 回读工具返回缺 [sofagent] 前缀（感知层废墟）。→ 回归维度 7 + 维度九
- **A15 actions fail-open**：A15 未声明 actions 时 fail-open（当前 WARN），理想应为 FAIL。→ 回归维度 16（新增）
- **A/B promote 缺守卫**：decidePromotion 缺 overallImprovement > 0 守卫，窄 eval 集可晋升更差版本。→ 回归维度 16（新增）
- **SkillOpt 仅静态验证**：读源码不实跑导致 CLI 契约漂移整版本未发现。→ 维度三·任务 9 升级为实跑

### v1.1.4 暴露
- **daemon 物理失效**：v1.1.0 拆包后 plist 仍调用 `sofagent-audit --daemon start`（已废），WorkingDirectory=$HOME 而非项目目录，PATH 残缺——daemon 自 v1.1.0 起从未真正运行。→ 回归维度 20 + init.ts 修复
- **watch.yml 不生成**：`--init` 只生成 config.yml 不生成 watch.yml，daemon 只能 fallback 到默认 paths=['src/','agents/','.sofagent/']——项目结构不同则完全失效。→ 回归维度 20
- **LOOP maxTurns 漏传**：createDeepAgent 未传 maxTurns 参数，PRD Q1 决策「先按 20」未落地，Agent 理论上可无限轮次。→ 回归维度 21
- **WARN 不写 history**：defaultRunAudit 的 WARN 路径不写 audit history，warn-accumulator 对 LOOP 场景完全失效。→ 回归维度 21 + nodes.ts 修复
- **warn-accumulator 语义错误**：先过滤 WARN 再判连续——任何 N 条 WARN 都触发，不区分"WARN 后有 PASS 清理"。→ warn-accumulator.ts 重写（真正连续性）
- **tools.ts run_bash 无代码级拦截**：A11「禁止 rm -rf /」只写在 description 约束里——Agent 忽视 description 时无障碍。→ 回归维度 21 + checkDangerousCommand 黑名单
- **USB federation 无签名校验**：任何人制作 SOFAGENT 卷标 U 盘即可注入任意 federation 配置——企业环境安全缺口。→ SECURITY.md 警告 + v1.1.5 签名计划
- **USB applyFederation 未实现**：只写到 ~/.sofagent/federation.json，不自动分发 nodes/policies 到各目录。→ v1.1.4 changelog 标注 + v1.1.5 计划
- **架构设计文档与实现偏离**：A18 检测范围（设计写只看 added，实现遍历所有）、checkDangerousCommand 正则 \b 边界陷阱——都需要独立审查来发现。→ 发布前审查流程强化
- **版本标注系统性漂移**：tools.ts/nodes.ts/rule-a18/a19/warn-accumulator/usb-detect 共 6 个文件注释写「v1.1.3 新增」但实际 v1.1.4 交付——SSOT 版本号与交付版本号混淆的连锁效应。→ 阶段八文档收尾强化
- **`--init` 无条件覆盖全局 plist**（v1.1.4 阶段六暴露）：init.ts 在任何目录跑 --init 都会 unload + 重写 `~/Library/LaunchAgents/com.sofagent.daemon.plist`。OpenClaw 验收 session 在临时目录跑 --init 后，本机 daemon 被指向临时路径完全失效。plist 是系统级全局资源——应只在 WorkingDirectory 变化时才重新生成，否则应跳过。→ 回归维度 22
- **文档测试数手工同步无人验证**（v1.1.4 回归报告 P0-1）：LIMITATIONS.md/evidence.md 各自声明测试数 343，实际 audit 包 388、全 workspace 660——三个文档手工维护同一个数字，无人验证一致性。应加入 pre-push-check 自动比对 `npm test` 实际输出与文档声明。→ 后续版本工具链增强

