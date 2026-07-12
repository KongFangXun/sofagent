# sofagent 陌生视角审查 Prompt（8 视角 × 6 方面）

> ⚠️ **使用时机**：当前版本发版后，在全新 session 中跑本 prompt 对已发布版本做独立审查。审查发现的问题不阻塞当前版本——它们进入下版本的开发计划。
>
> ⚠️ **审查体系自进化**：每版本发版前（releasing.md 步骤 10.6），基于本版本的开发经验审视并更新本 prompt——新增任务描述、更新过时视角、补充红队攻击面。更新后的 prompt 在下版本的发布后审查中生效：
> ```
> 版本 A 发版 → 跑陌生视角审查 → 发现问题
>   → 版本 B 开发时修复
>   → 版本 B 发版前更新审查体系（步骤 10.6）
>   → 版本 B 发版 → 用更新后的 prompt 审查版本 B
> ```
>
> ⚠️ **使用前审视**：每次在新版本发布后跑本 prompt 前，先花 1 分钟审视一下：
> - 有没有视角需要增删？（比如项目多了企业用户，加"企业运维"视角）
> - 有没有任务描述需要更新？（比如新增了 CLI 命令，用户旅程要加一步）
> - 有没有上一轮回归检查发现的"反复出现的同类问题"需要抽象成新视角？
>
> 审视完再跑，不要让过时的 prompt 产生过时的审查结果。
>
> **审查对象**：https://github.com/KongFangXun/sofagent（main 分支，当前已发布版本）
>
> **本次审查原则**：回归检查 + pre-push-check + acceptance-test + OpenClaw 验收已经全部通过。本轮换个思路：**假装你完全不知道 sofagent 是什么**，用陌生人的眼睛重新看一遍。不设固定检查项，不指定具体文件，不跑 grep。凭第一印象和直觉判断。
>
> **四轮审查法**：本 prompt 包含 8 个视角，分为四轮：
> - **第一轮：角色扮演**（视角 1-5）—— 5 个陌生人各自独立看一遍
> - **第二轮：用户旅程**（视角 6）—— 从安装到跑通，走完整路径找断点
> - **第三轮：红队对抗**（视角 7）—— 故意搞破坏，找边缘 case
> - **第四轮：CI/自动化**（视角 8）—— 文档声称 vs 代码实际，找数字不一致
>
> 四轮可以分四次跑（每次一个或几个视角），也可以一次性全跑。轮次之间清空认知，从空白开始。

---

## 你的身份（第一轮：5 角色切换）

> 第一轮你将**连续切换 5 个身份**，每轮只能从当前身份的视角出发，不能借用其他身份的知识。每轮完成后再切换到下一个。第二、三、四轮有独立的身份设定。

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

## 视角一：🧑‍💻 陌生人首次体验

> 你是一个普通开发者，在 GitHub Explore 或者某个技术群里看到了 sofagent。你没听过这个项目，不知道作者是谁，不知道它经历了 10 个版本的审查。你只是好奇——点进去了。

**你的任务**：
1. 看 GitHub 项目首页（README），**只往下滚 3 屏**。在这 3 屏里，你形成了什么印象？说清楚还是糊涂？
2. 如果要装，你第一步做什么？这一步有没有障碍？
3. 用 npm 装完 `@sofagent/audit`，跑 `sofagent-audit --help` 或者 `sofagent-audit --doctor`。输出让你觉得这东西能用吗？还是想卸载？
4. 你会把这个项目发给同事吗？如果会，你会怎么介绍它？（用你自己的话，不抄 README）
5. **版本声称验证**：看 CHANGELOG——它声称了什么？实际在项目里找到了吗？标题说的功能，在代码/目录/配置里能找到对应实现吗？你觉得这个声称诚实吗，还是夸大了？
6. **文档瘦身**：README 行数——你能在一屏内搞清楚这东西是干什么的吗？有没有你想找但找不到的东西？（比如"这东西能企业部署吗？"——你从 README 能看出来吗？）
7. **tag 指向确认**：跑 `git show vX.Y.Z --stat`——tag 指向的是发布提交还是修复提交？tag commit message 是否包含版本号？

你是一个普通开发者，不是来审代码的。你会读多少文档取决于你的好奇心——有人 3 屏就走了，有人会点进 ARCHITECTURE 看看设计思路。**读什么不重要，重要的是始终用普通开发者的心态判断：这东西对我有用吗？我愿意花时间装吗？**

---

## 视角二：👔 企业 IT 负责人

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

---

## 视角三：🏗️ 竞品分析

> 你是另一个开源项目（比如 Cursor Rules / Claude Code hooks / pre-commit 工具链）的维护者。你在研究竞品，想搞清楚 sofagent 到底跟你有什么区别、它有没有什么致命弱点。

**你的任务**：
1. README 里说的"Agent 提交时审计工具——git diff 硬证据，11 条规则，commit-msg hook，不依赖 Agent 配合"——这句话你能反驳吗？漏洞在哪？
2. 这个项目的核心差异化到底是什么？跟你的项目相比，它是真不同还是换个说法？
3. 如果你要写一篇文章《为什么不用 sofagent》，你的核心论据是什么？
4. 这个项目自称"正式版"和"可生产使用"。以你的标准，它够格吗？什么地方让你觉得不够格？
5. **范围合理性**：CHANGELOG 和文档中描述的每一条功能，以你的标准判断它是真功能还是花架子？一个 commit-msg 审计工具为什么要关心"知识库访问控制"？这是范围蔓延还是合理的演进？
6. **规则声称验证**：README 说的规则数量（如"16 条规则"）——打开 `sofagent/audit/src/rules/index.ts`，数 `defaultRules` + `extendedRules` 的实际注册数量。一致吗？每条规则的 `evidenceMode`（`git-diff` vs `hybrid`）与 README 的分类描述是否匹配？有没有声称了但代码里没注册的规则（如 A12/A13 在 ROADMAP 里但没实现）？
7. **声称与实现一致性**：CHANGELOG 标题中声称的功能（如"自进化引擎"），实际代码是否匹配？有没有夸大——比如 wrapper 叫"引擎"、CLI 调用叫"集成"？
8. **CHANGELOG 纯度**：CHANGELOG 历史条目中有没有审查元信息（模型名、审查轮次、P0/P1 计数）？CHANGELOG 应该只写产品变更。
9. **自进化声称验证**：v1.0.4 声称了 eval harness + Sub Agent A/B 自进化 + SkillOpt 自进化——实际是调外部 CLI（skillopt-sleep）的 wrapper 还是自研引擎？A/B 对比的"连续胜出"阈值是否硬编码？"自进化"这个词对用户来说意味着什么，实际能做到吗？
10. **Agent 定义的平台耦合度**：打开 `agents/` 下的 Agent 定义——它们的 role/workflow/rules 是否过度依赖 OpenClaw 的 `session.spawn` API？如果未来换平台，这些 Agent 定义还能独立使用吗？还是需要大幅改写？

---

## 视角四：📦 npm 用户视角

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
8. **`--strict`/`--ci` 模式验证**：跑 `sofagent-audit --diff HEAD~1..HEAD --task "wrong" --strict`，实际 exit code 是 2（承诺值）还是 1？文档声称的模式行为与实现是否一致？

你是"先动手再看文档"型开发者。装完跑通了，可能会随手翻一下 README 看看还有没有别的功能。**你的判断标准不是文档完不完整，而是"从敲下 npm install 到觉得这东西有用，中间花了多长时间"。**

---

## 视角五：🔍 开源审查员

> 你是一个在 GitHub 上 review 过 500+ 个开源项目的人。你有一套快速判断方法：先看目录结构和 git log，几分钟内形成第一印象。但如果目录结构让你困惑，README 就是帮你解谜的工具；如果结构一目了然，README 只是验证你的判断。

**你的任务**：
1. 只看根目录文件列表（`ls`），不看内容。猜一下这个项目的结构——前端/后端/CLI/文档/脚本都在哪？你觉得这个结构合理吗？
2. 有没有看起来"不该在这"的文件或目录？有没有一眼就知道是垃圾的？
3. 看 `git log --oneline --since="3 months ago"` ——提交节奏健康吗？有没有诡异的单次巨大提交？
4. 看 `CONTRIBUTING.md` ——你能找到怎么提交 PR 吗？能找到怎么跑测试吗？
5. 看 issue / PR 数量（如果有）。这是一个"作者自嗨"项目还是有社区活性的项目？
6. **文档引用链**：从 README 出发，点进 3-5 个链接——有没有 404？有没有引用的章节不存在？HANDBOOK 引用的 ARCHITECTURE §xxx 能对上吗？FDE 引用的模板路径存在吗？还缺引用吗——有没有地方提到了某个概念（如「AI 知识库」「铁律」）却没有指向设计原理或详细说明的链接？
   检查所有文档头部的日期是否与当前发版日期一致。`grep 'YYYY-MM-' *.md docs/design/*.md`——有没有过期日期？bump-version 脚本只改版本号不改日期，这个坑反复出现。
7. **CHANGELOG 全历史纯度**：检查所有历史 CHANGELOG 条目——有没有审查元信息（模型名、审查轮次、视角数、P0/P1 计数）？CHANGELOG 应该只写产品变更，不含审查过程。
8. **根目录整洁度**：根目录应该只有 5-7 个核心文件（README/LICENSE/CHANGELOG/CONTRIBUTING/SECURITY/CODE_OF_CONDUCT/ROADMAP）。其余 md 文件、HTML、PNG 是否应该移入 docs/ 或 assets/？

你的核心问题是："这个项目的代码组织方式让我觉得它是认真维护的，还是一团乱麻？"

---

## 审查输出格式

每轮视角输出一份不超过 1 页的报告：

```markdown
## 视角 N：[视角名称]

### 产品定位
[这个视角下对产品定位的判断]

### 工程质量
[这个视角下的工程质量印象]

### 文档与上手
[上手体验]

### 安全与诚实
[该视角下的信任度判断]

### 文档精简度
[有没有读到重复内容？有没有段落感觉"留着也行删了也行"？有没有一段话读完什么信息也没拿到？]

### 生命力
[该视角下的存续判断]

### 总体印象（1-10 分）
[分数 + 一句话理由]

### 发现的问题（如有）
| 严重度 | 问题 | 建议 |
|--------|------|------|
```

### 审查体系更新建议（最后输出，汇总所有视角）

> 以下两项在完成全部 8 个视角后输出一次。不填视为审查未完成。

#### 建议调整的视角
> 有没有视角需要增删改？有没有角色已经过时了？有没有任务描述跟不上项目变化？

| 操作 | 视角/角色 | 当前问题 | 建议改法 |
|------|----------|---------|---------|
| 新增 / 删除 / 修改 | | | |

#### 建议追加到回归检查的内容
> 有没有发现的具体检查点，应该变成回归检查清单里的固定维度？

| 建议编号 | 维度描述 | 关联的问题 |
|---------|---------|-----------|
|（留给回归检查清单维护者分配编号） | | |

---

## 审查约束

- **🔴 全新 session 硬性条件**——必须在没有任何开发上下文记忆的新 session 中跑。有记忆的审查者不是"陌生人"，知道项目的人会跳过怀疑。zero-knowledge 是整个 prompt 的前提。
- **想读什么读什么**——不限制文件范围。陌生人会好奇点进 ARCHITECTURE，竞品会翻遍 CHANGELOG 找历史污点，企业 IT 会逐行读 SECURITY。读什么都行，重要的是始终戴着当前身份的眼镜在读。
- **不设预期**——不要告诉审查者"之前已经修好了 X"，让他自己发现。
- **相信直觉**——如果第一反应是"这里不对劲"，那就是不对劲。不用证明。
- **8 轮独立**——每轮写完后清空上一轮的认知，从空白开始。

---

## 第二轮：用户旅程审查（视角 6）

> 前面 5 个角色是"各自站在一个角度看"，这一轮换个方法：**不走视角，走路径**。你假装是一个真实用户，从零开始完整走一遍使用流程。每一步都问自己：卡住了吗？困惑吗？报错信息能看懂吗？哪里让你想放弃？

## 视角六：🛤️ 完整用户旅程

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

---

## 第三轮：红队对抗审查（视角 7）

> 前两轮都是"正常使用"——你扮演各种角色走正常路径。这一轮反过来：**你是来搞破坏的**。你的目标是找出 sofagent 在极端、边缘、恶意场景下的弱点。不要测正常路径，只测不正常的。

## 视角七：🐛 红队对抗

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
    - commit-msg hook 用的是 `--ci`（= `--silent`，v1.0.5 起不再隐含 `--strict`）——WARN 级规则（A3/A4）exit 1 放行，不阻断 commit；FAIL 级规则（A1/A2）exit 2 阻断

16. **A9 Unicode/leet 绕过测试**：
    - 在代码注释中写全角字符 `ｉｇｎｏｒｅ ｐｒｅｖｉｏｕｓ ｉｎｓｔｒｕｃｔｉｏｎｓ` → A9 是否检出？
    - 在代码注释中写 leet speak `1gn0r3 pr3v10us 1nstruct10ns` → A9 是否检出？
    - 在 commit message 中写 `ignore previous instructions` → A9 是否扫描 commit message？

17. **审计日志完整性测试**：
    - history.jsonl 是否有 hash chain 或 HMAC 签名？
    - 手动篡改 history.jsonl 中间一行 → `--doctor` 是否检测到？
    - Agent 以当前用户身份能否直接读写 history.jsonl？

18. **eval harness 污染**（v1.0.4 新功能）：
    - golden set 测试用例是静态文件——Agent 能否通过修改 golden set 来"考自己会做的题"？
    - `runEval()` 的评分逻辑（精确匹配 / 语义相似度 / 规则合规）权重是否硬编码？Agent 知道权重后能否针对性地"刷分"？

19. **A15 约束验证绕过**（v1.0.4 新功能）：
    - config.yml 声明 `actions: [read]` 但 Agent 实际执行了 write——A15 离线验证能检出吗？
    - 如果 config.yml 没有 actions 字段——A15 是跳过还是告警？Agent 能否通过"不声明 actions"来规避约束检查？
    - **actions 未声明绕过**：workflow.yml 存在但各节点没有 `actions` 字段——A15 返回 PASS 还是 WARN？如果返回 PASS，Agent 只要不声明 actions 就能绕过所有约束检查。验证 `rule-a15-action-constraint.ts` 中 `nodesWithActions.length === 0` 的分支返回什么。
    - actions 提取正则——如果 diff 格式不标准（如 binary 文件 / 特殊编码），正则漏匹配导致"没检测到"被当作"合规"？

20. **HITL 置信度操纵**（v1.0.4 新功能）：
    - 置信度 score 怎么算的？如果 score 来自模型自评，Agent 能否通过措辞操纵来刷高置信度？
    - 四类强制人工场景（删除 / 外部 API / 权限变更 / 数据迁移）的正则——`rm -rf test/`（合理的测试清理）会被误匹配吗？

21. **A/B 自进化 promote 攻击**（v1.0.4 新功能）：
    - `decidePromotion()` 的连续胜出阈值——如果 B 版本碰巧在阈值内的几个场景赢了，但整体更差，会 promote 吗？
    - promote 后旧版本归档到 `.sofagent/subagents/history/`——Agent 能否通过删除归档来"洗白"被回退的历史？
    - A/B 对比的 eval 场景如果偏窄（只测了简单 case），promote 的版本在复杂场景下更差怎么办？

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

## 第四轮：CI/自动化一致性审查（视角 8）

> 前面三轮都是人在看——凭直觉、走路径、搞破坏。这一轮换个方法：**你是 CI 机器人，只做一件事——把文档里的数字和代码里的数字对一遍**。人类审查容易跳过"数字对不上"这种枯燥检查，但这是最容易暴露问题的地方。

## 视角八：🤖 CI/自动化一致性

> 你是一个没有感情的 CI 机器人。你不读叙事、不感受语气、不判断定位——你只做一件事：**把文档中出现的每一个数字声称，与代码中的实际数字交叉验证**。数字对不上就是 P0，没有商量。

**你的任务（每个都要实际跑命令验证）**：

1. **规则数量一致性**：
   - README 声称"X 条规则"——打开 `sofagent/audit/src/rules/index.ts`，数 `defaultRules` + `extendedRules` 的 `name:` 字段数。一致吗？
   - README 声称"Y 条纯 git-diff + Z 条需 Agent 日志"——逐条检查每条规则的 `evidenceMode` 字段，数 `git-diff` 和 `hybrid` 的数量。一致吗？
   - CHANGELOG 历史条目中提到的规则数量——与当前 index.ts 一致吗？有没有"历史声称 > 实际注册"的情况？

2. **测试数量一致性**：
   - CHANGELOG / README / evidence.md 中声称的测试数量——实际跑 `cd sofagent/audit && npm test 2>&1 | grep 'Tests'`。一致吗？
   - evidence.md 的数字是上次发版时的快照还是当前实际值？

3. **verify 项数一致性**：
   - LIMITATIONS.md 声称"~N 项（动态）"——实际跑 `node sofagent/audit/dist/verify.js --list 2>&1 | head -5`。在声称范围内吗？
   - CHANGELOG 中提到的 verify 项数——与当前一致吗？

4. **维度数字一致性**：
   - regression-checklist.md 文件头声称"N 维度"——实际数 `####` 标题数。一致吗？
   - 输出模板中的"总维度数：N"——与文件头一致吗？

5. **版本号全局一致**：
   - `package.json` 版本号——与 README / CHANGELOG / SECURITY / LIMITATIONS / ROADMAP 文件头版本号一致吗？
   - `sofagent/audit/package.json` 与 `sofagent/mcp/package.json` 版本号一致吗？
   - `tools/check-version.sh` 检查的版本号与 SSOT 一致吗？

6. **文件计数一致性**：
   - 根目录 `.md` 文件数——是否 ≤7（README/CHANGELOG/CONTRIBUTING/SECURITY/CODE_OF_CONDUCT/ROADMAP/LIMITATIONS）？多余的 .md / .html / .png 应移入 docs/ 或 assets/
   - Skill 文件数——README 声称"10 个 Skill 文件"——实际 `ls sofagent/skill/*.md | wc -l` 一致吗？
   - Agent 定义文件数——README/LOOP 文档声称的 Agent 数——实际 `ls agents/*.md | wc -l`（减去 README.md）一致吗？

7. **CHANGELOG 纯度**：
   - CHANGELOG 全历史——有没有审查元信息？`grep -i "GLM\|DeepSeek\|双视角\|P0×\|P1×\|7 视角\|8 视角\|× 6 方面" CHANGELOG.md`。CHANGELOG 应该只写产品变更，不含审查过程。
   - changelog 子文件（`docs/changelog/v*.md`）同理——有没有模型名、审查轮次、P0/P1/P2 标签等元信息？

8. **evidenceMode 与 README 分类匹配**：
   - README 把规则分为"纯 git-diff"和"需 Agent 日志"——逐条对照 index.ts 的 `evidenceMode` 字段。有没有标了 `hybrid` 但 README 归到"纯 git-diff"的规则？反之有没有？

9. **README Mermaid 图与正文一致性**（v1.0.5 教训）：
   - 编排引擎 Mermaid 图写"自动切换"，正文写"A/B 对比为手动"——图与文矛盾。检查所有 Mermaid 图中的标签是否与紧接的正文描述一致。
   - 约束底座 Mermaid 写"4 底线 + 7 铁律"——与 SKILL.md 实际内容一致吗？

10. **编排引擎声称诚实度**（v1.0.5 教训）：
   - README 说编排引擎"全平台可用，不再绑定 OpenClaw"——实际实现：DeepAgents 是 optional dependency，68 行 `launcher.ts` wrapper，A/B 对比需手动执行。
   - 检查：README 对编排引擎的描述是否诚实标注了"实验性"和当前限制？

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

> **审查者**：这是 sofagent 发布后的陌生视角审查。当前版本开发完成、发版前审查通过（pre-push-check / acceptance-test / OpenClaw / 回归清单 全绿）。这轮是"你完全不知道我是谁——你第一眼看到我，心里在想什么"。你的直觉比 grep 命令更有价值。发现的问题不阻塞本版本，将在下版本中修复，修复后更新回归清单和本 prompt（步骤 10.6）。
>
> 第一轮（视角 1-5）凭直觉，第二轮（视角 6）走路径，第三轮（视角 7）搞破坏，第四轮（视角 8）对数字。四轮合起来，覆盖"印象、体验、韧性、精确"四个维度。
