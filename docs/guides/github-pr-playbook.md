# GitHub PR 投稿运营手册——sofagent 开源曝光实战沉淀

> 本手册沉淀 sofagent 开源投稿的全部可复用经验，随每次投稿持续更新。
> 读者：下次替 sofagent（或任何开源项目）投稿 awesome 清单 / 参与社区的人或 AI session。
> 定位：**操作手册**，不是叙事复盘——每条规则都可直接执行。

---

## 一、阵地筛选（投哪里）

### 1.1 可投性判定法（先看机制再看星数）

| 机制 | 判定 | 例子 |
|---|---|---|
| **手工维护清单**（README 条目 + PR 收录） | ✅ 标准阵地 | punkpeye/awesome-mcp-servers、0xsline/awesome-deepseek-harness |
| **adopters / users 名单**（使用者名单而非工具列表） | ✅ 以「用户/实践者」身份投 | loop-engineering adopters（PR #573 已合并） |
| **自动索引目录**（爬安装源/目录站） | ❌ 不走 PR | VoltAgent/awesome-openclaw-skills（clawskills.sh 自动索引） |
| **产品仓本体 / 框架仓库** | ❌ 不收外部条目 | 各类框架主仓 |
| **archived 仓库** | ❌ CreatePullRequest 直接报 GraphQL 权限错——这就是第一个信号 | appcypher/awesome-mcp-servers |
| **表单站**（网页提交） | ⚠️ 用户拍板不投（麻烦，收益低） | Glama 表单类 |

### 1.2 星数与收录门槛的经验值

- **>50k 星**（VoltAgent 52k）：收录门槛 = 生态成熟度，且多为自动索引——**新项目勿投，养资格**
- **3k~15k**（punkpeye 11k、hesreallyhim 53k 的 Claude Code 主清单）：可投，但人工审慢（周级）
- **<1k 星**（0xsline 961、Anil-matcha 991）：**性价比最高**——同类条目少、维护者活跃、审得快，一条 PR 一行描述就进
- 中文清单（yzfly/Awesome-MCP-ZH ⭐4k+）对中文项目友好，投稿无额外门槛

### 1.3 生态覆盖矩阵（sofagent 的四轴）

投稿不要堆在一个生态——按产品形态分轴投，每轴对准「该生态用户搜什么」：

| 轴 | 清单类型 | 描述口径重点 |
|---|---|---|
| **MCP 生态** | awesome-mcp-servers 系 | MCP server + 79 tools + Glama 已收录 |
| **AI 治理/安全** | awesome-ai-governance / llm-security / ai-security | 24 规则 + HMAC 审计链 + commit-time 拦截 |
| **FDE 生态** | awesome-fde-resources / OpenFDE 工具地图 | FDE 方法论 + 业务流梳理 + 提交时审计护栏 |
| **DSH 生态** | awesome-deepseek-harness / awesome-dsh-plugin | 9 插件 cordis-plugin 家族 + SkillHub 安装 |
| **泛开发者大综合** | awesome-ai-tools 大综合（mahseema ⭐6.1k） | 面向泛开发者：AI 行为审计工具（Developer tools 节，PR 模板含八项 checklist，条目加节尾） |

**同一清单内**：先读 README 分节，把条目放进**最窄的对口节**（Security & Governance > 泛 Tools 节）。

---

## 二、投稿操作 SOP（怎么投）

### 2.1 提交前五查（每条 PR 必过）

1. **读 contributing.md**（如有）——收录格式、双语要求、PR 标题格式（0xsline 要求 `docs: add <repo>` + 双语 README 同 PR）
2. **fork 分支必须基于 upstream 最新 HEAD**——🔴 血泪：punkpeye #13273 因 fork 落后，diff 混入别人新合并条目，bot 全家桶检查误杀。正确姿势：`git fetch upstream main && git checkout -b add-xxx upstream/main`
3. **条目格式照抄该清单现有条目**——`- [名字](https://github.com/<owner>/<repo>) - 一行事实性描述`；描述写「是什么/干什么」，不写营销词（0xsline 明言 no fluff, no badges）
4. **双语清单两个文件同 PR 改**——英文版 + 中文版同条目互译，漏一个会被要求补
5. **PR body 带自荐披露句**——🔴 agentrust 实证：reviewer 明说「自荐可以，但要摆在明面上」。

### 2.2 PR body 模板（实证有效）

```markdown
Adds [owner/repo](链接) to the **<节名>** section（位置说明：alphabetical / 节首 / 某条后）。

**Disclosure: this is a self-submission.** I am the author and maintainer of <项目名>.

<两三句事实性描述：核心能力 + 技术栈 + 协议。>

Related listings: <已收录/在审的交叉链接——punkpeye PR、Glama、agentrust PR 等，形成信任链。>

Single-line change to README.md only.（或双语两文件）
```

### 2.3 通道与认证

- 优先 `gh pr create --repo <upstream> --head KongFangXun:<分支>`（API 通道，网络抖动时比网页稳）
- git push 走 HTTPS；github.com:443 抖动时：**gitdata-push.mjs 四步兜底**（blob→tree→commit→ref PATCH，工具在 `tools/release/`）
- fork 后 clone 用 `--depth 1`，投稿轻量高效

### 2.4 投后动作

- **24h 内巡检一次评论**：bot 检查（glama-badge / check-submission / cla-bot / coderabbit）无需动作；**真人 review 必须当天回**
- **CLA 要求**（e2b 等）：按 bot 指引网页签掉，回帖 `@cla-bot check` 复验
- **CHANGES_REQUESTED**：逐条改 PR body（`gh pr edit`）+ 评论回复告知——agentrust #89 从 review 到补披露 10 分钟闭环
- 合并后：linked PR 关闭，交叉链接里的「在审」状态随手更新

---

## 三、清单投稿之外的曝光面（全景图）

| 曝光面 | 状态 | 要点 |
|---|---|---|
| GitHub Marketplace | ✅ 已上线 | name 冻结 `sofagent`；description ≤125 码点；每版 release 勾 Publish（SOP 阶段十一·二b） |
| Profile README | ✅ 已上线 | KongFangXun/KongFangXun 特殊仓；Contents API `-X PUT` 上传 |
| 清单 PR | 25 条在飞 | 本手册主体 |
| Discussions 常青帖 | #11 报到帖（自家） | 置顶只留常青帖，版本帖不置顶（SOP 阶段十二·十三） |
| 外站 Discussions 输出 | ✅ loop-engineering #326 已发 | adopters 合并后 24h 内发实践帖衔接最自然；按楼主模板回帖，不开新帖 |
| Featured in 区 | ✅ 双语 README | 徽章跟 PR 状态联动（open 橙 / merged 绿） |
| good first issue | #8/#9/#10 | 降低贡献门槛，等社区认领 |
| 流量观测 | 28 天基线 317 views / 66 uniques | 下月同口径复测对照 |

---

## 四、坑位速查（红线清单）

| # | 坑 | 后果 | 防御 |
|---|---|---|---|
| 1 | fork 分支落后 upstream | bot 检查误杀（#13273 被关） | fetch upstream + 基于 upstream/main 建分支 |
| 2 | archived 仓库硬投 | GraphQL 权限错浪费时间 | 投前 `gh api repos/<o>/<r>` 看 archived 字段 |
| 3 | PR body 无自荐披露 | 真人 review 要求补（agentrust） | body 模板固定带披露句 |
| 4 | description 营销腔 | 清单维护者反感，no fluff 是行规 | 只写事实：数字 + 机制 + 协议 |
| 5 | 双语清单只改一版 | 被打回补第二版 | contributing.md 五查里必查 |
| 6 | 表单站硬填 | 时间成本高收益低 | 用户拍板：只走 PR 通道 |
| 7 | 置顶/某些操作找 API | GraphQL Mutation 无 pinDiscussion | 置顶=网页专属；发帖/回复有 API 可代操作 |
| 8 | bot 评论当人话回复 | 浪费表情 | 认准 github-actions / *-bot / coderabbit 前缀 |
| 9 | 投前不查上游是否已有收录 | 重复收录 PR（部分清单有自动扫描，当天就可能被批量收走） | 投前先拉上游 README 搜目标条目；已收录则改为更新既有条目描述 |
| 10 | 插行 anchor 只用链接不含描述 | 原条目被拦腰截断（描述掉到新行尾），门禁报「missing description」 | anchor 必须用完整行；插完自查「新行独立 + 原行完整」 |
| 11 | 大小写同名 fork 重定向 | git push 按 URL 大小写不敏感重定向到**另一仓的同名旧 fork**（Anil-matcha 系 awesome-dsh-plugin ← Alex-Yanggg 系 awesome-DSH-plugin-2），分支推错仓 + PR 报「No commits between」 | fork 后先看返回的 fork 实名（带 -2/-3 后缀才是新 fork），push 前用 `git remote -v` 核对完整 URL 含大小写后缀；误推立即删分支恢复 |
| 12 | push 输出接管道吞错（如 2>&1 再截尾行） | push 失败信息被截掉，PR create 报错才发现分支没推上去 | push 单独跑不接管道，或紧跟 echo 输出 exit code 验证 |

---

## 五、投稿台账（实时状态，巡检用）

> 活台账：每次巡检/合并后更新本表对应行的状态列与备注（巡检命令：`gh search prs --author KongFangXun --state open`）。自家仓 PR（KongFangXun/sofagent 内部）不入台账。

### 5.1 在投（25 条 open）

| # | 仓库 | PR | 节 | 投日 | 状态 | 备注 |
|---|------|----|----|------|------|------|
| 1 | punkpeye/awesome-mcp-servers ⭐11k | [#13312](https://github.com/punkpeye/awesome-mcp-servers/pull/13312) | MCP servers | 08-31 | open | 重投版（首投 #13273 被 bot 关）；check-submission ✓；glama-badge ✓；评分页已就绪（score 200） |
| 2 | e2b-dev/awesome-ai-agents | [#1471](https://github.com/e2b-dev/awesome-ai-agents/pull/1471) | Agents | 08-30 | open | CLA 已签 + cla-bot 复验 ✓，等人工 |
| 3 | yzfly/Awesome-MCP-ZH | [#525](https://github.com/yzfly/Awesome-MCP-ZH/pull/525) | 🔒 安全与分析 | 08-31 | open | 中文清单 |
| 4 | corca-ai/awesome-llm-security | [#311](https://github.com/corca-ai/awesome-llm-security/pull/311) | Tools | 08-30 | open | coderabbit 摘要已出 |
| 5 | Puliczek/awesome-mcp-security | [#301](https://github.com/Puliczek/awesome-mcp-security/pull/301) | Tools and code | 08-30 | open | |
| 6 | ottosulin/awesome-ai-security | [#422](https://github.com/ottosulin/awesome-ai-security/pull/422) | Agent Runtime Security | 08-31 | open | |
| 7 | scadastrangelove/awesome-ai-security-tools | [#76](https://github.com/scadastrangelove/awesome-ai-security-tools/pull/76) | Runtime Protection | 08-31 | open | |
| 8 | ccplugins/awesome-claude-code-plugins | [#424](https://github.com/ccplugins/awesome-claude-code-plugins/pull/424) | Security, Compliance & Legal | 08-31 | open | |
| 9 | agentrust-io/awesome-ai-governance | [#89](https://github.com/agentrust-io/awesome-ai-governance/pull/89) | Governance Frameworks | 08-31 | open | 🔴 真人 review（imran-siddique）：验证通过（MIT/结构/41★），明言「补一行披露即合并」——披露句已在 PR body（09-01 12:55），等复审；⚠️ 门禁失败：Policy: Awaiting maintainer review（即待复审位，非 CI 故障） |
| 10 | ai-boost/awesome-harness-engineering ⭐3.9k | [#227](https://github.com/ai-boost/awesome-harness-engineering/pull/227) | Security, Sandbox & Permissions | 08-31 | open | 「Harness Engineering」最对口清单 |
| 11 | yzhao062/awesome-auditable-ai | [#18](https://github.com/yzhao062/awesome-auditable-ai/pull/18) | Tools | 08-30 | open | 已回 follow-up（本地 check_links 验证） |
| 12 | OpenFDEAI/OpenFDE | [#1](https://github.com/OpenFDEAI/OpenFDE/pull/1) | 工具地图·可观测/护栏 | 08-31 | open | 该仓**首个 PR** |
| 13 | global-fde/awesome-fde-resources | [#3](https://github.com/global-fde/awesome-fde-resources/pull/3) | Tools | 08-31 | open | |
| 14 | 0xsline/awesome-deepseek-harness ⭐961 | [#547](https://github.com/0xsline/awesome-deepseek-harness/pull/547) | Security & Governance（双语） | 09-01 | open | contributing 规范全遵守 |
| 15 | Anil-matcha/awesome-dsh-plugin ⭐991 | [#122](https://github.com/Anil-matcha/awesome-dsh-plugin/pull/122) | Security & Governance | 09-01 | open | 插节首 |
| 16 | mahseema/awesome-ai-tools ⭐6.1k | [#2078](https://github.com/mahseema/awesome-ai-tools/pull/2078) | Developer tools | 09-01 | open | PR 模板 checklist 全勾；条目加节尾（模板硬性要求） |
| 17 | beancookie/awesome-dsh-plugin ⭐127 | [#137](https://github.com/beancookie/awesome-dsh-plugin/pull/137) | 开发与运行时（双语） | 09-01 | open | 仓库 topics 已补 dsh-plugin |
| 18 | walkinglabs/awesome-harness-engineering ⭐3.9k | [#88](https://github.com/walkinglabs/awesome-harness-engineering/pull/88) | Security, Authorization & Policy | 09-01 | open | 独立仓（非 ai-boost fork），规模同级最大 |
| 19 | libukai/awesome-deepseek-harness ⭐225 | [#98](https://github.com/libukai/awesome-deepseek-harness/pull/98) | 开发工具（三语） | 09-01 | open | 李不凯深评测风格条目；中英日三 README 同 PR |
| 20 | TalEliyahu/Awesome-AI-Security ⭐860 | [#140](https://github.com/TalEliyahu/Awesome-AI-Security/pull/140) | Jailbreak & Policy Enforcement (Guardrails) | 09-01 | open | 晚间新投；CC0；星数徽章格式；Guardrails 节尾 |
| 21 | ProjectRecon/awesome-ai-agents-security ⭐68 | [#109](https://github.com/ProjectRecon/awesome-ai-agents-security/pull/109) | Guardrails & Compliance | 09-01 | open | 晚间新投；「agent 安全活地图」定位最贴 |
| 22 | Alex-Yanggg/awesome-DSH-plugin ⭐92 | [#108](https://github.com/Alex-Yanggg/awesome-DSH-plugin/pull/108) | Developer tools | 09-01 | open | 晚间新投；catalog/plugins.json+README+中文镜像三文件（generate_readmes --check 过）；描述提 9 个 Cordis 插件坐实 DSH 集成 |
| 23 | muellerberndt/awesome-ai-security ⭐123 | [#26](https://github.com/muellerberndt/awesome-ai-security/pull/26) | Tools & Frameworks | 09-01 | open | 晚间新投；学习路径型清单；git 通道挂时走 Git Data API 四步兜底 |
| 24 | DeepSpaceHarbor/Awesome-AI-Security ⭐1668 | [#50](https://github.com/DeepSpaceHarbor/Awesome-AI-Security/pull/50) | Code（表格行） | 09-01 | open | 晚间新投；默认分支 master 非 main；Code 节有 ClawMoat/SkillFortify 工具先例 |
| 25 | awesome-dsh-plugin/awesome-dsh-plugin ⭐14k | [#4101](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/4101) | security（data/plugins 单文件） | 09-01 | open | DSH 系最大清单；✅ Submission gate+check 双绿；经两轮 gate 修复：①-f 字面量→-F 真内容 ②entry 改指 cordis-plugin-sofagent-audit 子包（monorepo slug 文件名）；fork=awesome-dsh-plugin-3；dsh-plugin topic 已挂（fde-agent 换血） |

### 5.2 已收口

| 仓库 | PR | 结果 | 备注 |
|------|----|------|------|
| Dominic789654/awesome-deepseek-harness | #368 | ✅ **merged 09-01** | 转既有条目事实修正（FDE Harness/79 tools/HMAC）后被维护者验证合并：「Verified … factual. Merging」 |
| imsai-sh/awesome-deepseek-harness-plugins | #301 | ✅ **merged 09-01（当日）** | 目录 JSON 单条目快车道：static-review 自动通过后自动 squash-merge，全程零人工 |
| cobusgreyling/loop-engineering | #573 | ✅ **merged 08-31** | adopters 名单；仓主亲自合并；解锁 #326 Show your loop 发帖（已发） |
| punkpeye/awesome-mcp-servers | #13273 | ❌ closed | fork 落后被 bot 误杀（坑位 #1 教材）→ #13312 重投 |
| appcypher/awesome-mcp-servers | — | ⛔ 撤单 | archived 仓（坑位 #2 教材） |

### 5.3 巡检节奏

- **每日自动巡检**：晚上 21:00 自动跑（自动化任务「PR 投稿与关注度每日巡检」）：读 5.1 台账 → 核 PR 状态 → 状态变化自动写回台账（merged 移 5.2/closed 记原因/真人评论标 🔴）并 commit 收编，绝不 push；同时跑阵地检索（awesome deepseek harness / agent harness / harness engineering / ai governance / ai security / dsh-plugin topic 等查询词），新发现写入第六节候选（含防重复核查）但不擅自投稿；真人评论/CHANGES_REQUESTED 出回复草稿等确认后当天回
- **关注度监测**（每日）：流量/星数对比基线（见 5.3.1），异动进报告【关注度异动】栏——星数单日 +3、views 翻倍、连续 3 天零增长（冷启动预警）三阈值
- **门面周检**（每周一）：fresh-eyes 视角 22（GitHub 发现优化审查员）轻量体检——description/topics 失效词、双语首屏一致性、章节漂移；只报告不修改，门面改动由用户拍板
- **Trending 窗口值守**（每日）：当日有清单 PR merged 即在报告提示 T2 集中发射条件成立（Show HN/V2EX/掘金/知乎同天），由用户拍板执行
- **每周人工巡检**：发版周检顺手对一次台账；merged 的把行移到 5.2；README「Featured in」徽章状态联动（open 橙 → merged 绿）
- **命令**：`gh search prs --author KongFangXun --state open` 对表核状态

### 5.3.1 流量观测基线（巡检自动更新此行）

| 观测项 | 当前值 | 备注 |
|---|---|---|
| views（14 天滚动） | 9/1 基线：302 | 首基线 8/31：28 天 317 |
| uniques（14 天滚动） | 9/1 基线：74 | 首基线 8/31：66 |
| 星数 | 9/1 基线：⭐41 | 首基线 8/31 同值 |
| 优化动作存档 | 9/1：topics 换血（dsh/dsh-plugin→llm/agent-skills）+ 双语首屏 audit-terminal 实拍图 | 效果看下月同口径复测 |

## 六、下一步候选（按性价比排序）

> 2026-09-01 晚间批量投稿后更新：七/八/十/十一/十二共 5 条已投（见 5.1 第 20~24 行），移出候选池；六/九缓投（原因见下）。

一、**hesreallyhim/awesome-claude-code**（⭐53k）——等其「legacy 迁移期」结束后再投（README 自述正在重构收录）
二、**awesome-agent-harness 系（harness 研究综述类）**——Picrew ⭐1.7k / AutoJunjie ⭐515 / Gloriaameng ⭐345 / mahonzhan ⭐270 / RUCAIBox ⭐185：偏论文与综述，投稿前先看是否有「实现/工具」节，纯论文清单不对口
三、**machinae/awesome-claws**（⭐499）——OpenClaw 生态 agent 清单，先确认是否有工具/Skills 类分节再投
四、**slavakurilyak/awesome-ai-agents**（⭐2.1k）/ jim-schwoebel/awesome_ai_agents（⭐2k）——泛 agent 清单，收录粒度粗，性价比一般
五、其余小 DSH 清单（fendouai ⭐25 / walkinglabs-plugins ⭐17 等）——星少价值低，有空再投
六、**awesome-dsh-plugin/awesome-dsh-plugin**（⭐14k）——✅ **已投 #4101 双绿**（见 5.1 #25）：topic 冲突经 9/1 晚用户拍板解除（fde-agent→dsh-plugin 换血）；两轮 gate 修复（-f 字面量 / monorepo 子包 slug）后 Submission gate+check 全过，等人工审核
七、**bruc3van/awesome-dsh-plugin**（⭐305）——**观察中**：每日自动抓 GitHub `dsh-plugin` topic 自动收录；topic 已挂（9/1 晚），等其每日抓取自动收录（不主动投 PR）；巡检时顺手核当日是否已收

## 七、非清单曝光渠道（中文圈 + 用户网页动作）

一、**阮一峰周刊**（⭐101k）——✅ **已投 2026-09-01**：[issue #11453](https://github.com/ruanyf/weekly/issues/11453)【项目自荐】格式；每周五出刊，若入选「谁在招人/开源项目」栏预计数千精准点击；巡检时顺手核 issue 状态（closed 无回复 = 未收录，正常现象可隔 2-3 期再投）
二、**HelloGitHub 月刊**（⭐174k）——**待用户网页投**：主通道是 hellogithub.com/periodical 表单（issue 区非官方通道勿走）；每月 28 号出刊；用户操作指引见 7.1
三、**Social Preview 卡片**——**待用户网页设置**：repo Settings → General 最底 Social preview → 上传 banner 图；设置后所有 IM 分享为统一品牌卡片（一次性动作）
四、**DSH 官方社区案例帖**——**待内容排期**：「9 插件实战：给 DSH 加一层审计」纯技术分享；需 Discord/论坛账号登录（AI 无登录态），帖子可先由 AI 起草、用户发

### 7.1 HelloGitHub 表单投稿指引（用户网页操作）

一、打开 **https://hellogithub.com/periodical**（建议电脑浏览器，登录 GitHub 账号授权）
二、找到「推荐项目」入口，表单要点（按月刊调性组织）：
- **项目地址**：`https://github.com/KongFangXun/sofagent`
- **一句话推荐**（突出「有趣、易上手」调性）：「一行命令给 AI 编程助手配一个审计官——密钥泄漏、越界改文件，commit 前当场拦截」
- **补充说明**：`npx -y -p @sofagent/audit sofagent-audit` 任何 git 仓库秒级体验，无需配置；24 条规则 + 自动快照回滚；README 双语
三、提交后耐心等——月刊每月 28 号出刊，收录会有小编审核，未收录也可换角度隔期再投
