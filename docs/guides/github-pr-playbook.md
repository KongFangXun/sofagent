# GitHub PR 投稿运营手册——sofagent 开源曝光实战沉淀

> 本手册沉淀 2026-08-30 ~ 09-01 三轮投稿实战（15 条 PR + 1 条已合并 + 2 个生态位调研）的全部可复用经验。
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
| （第五轴待补） | awesome-ai-tools 大综合（mahseema ⭐6.1k，Developer tools 节，PR 免费） | 面向泛开发者：AI 行为审计工具 |

**同一清单内**：先读 README 分节，把条目放进**最窄的对口节**（Security & Governance > 泛 Tools 节）。

---

## 二、投稿操作 SOP（怎么投）

### 2.1 提交前五查（每条 PR 必过）

1. **读 contributing.md**（如有）——收录格式、双语要求、PR 标题格式（0xsline 要求 `docs: add <repo>` + 双语 README 同 PR）
2. **fork 分支必须基于 upstream 最新 HEAD**——🔴 血泪：punkpeye #13273 因 fork 落后，diff 混入别人新合并条目，bot 全家桶检查误杀。正确姿势：`git fetch upstream main && git checkout -b add-xxx upstream/main`
3. **条目格式照抄该清单现有条目**——`- [名字](链接) - 一行事实性描述`；描述写「是什么/干什么」，不写营销词（0xsline 明言 no fluff, no badges）
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

| 曝光面 | 状态（2026-09-01） | 要点 |
|---|---|---|
| GitHub Marketplace | ✅ 已上线 | name 冻结 `sofagent`；description ≤125 码点；每版 release 勾 Publish（SOP 阶段十一·二b） |
| Profile README | ✅ 已上线 | KongFangXun/KongFangXun 特殊仓；Contents API `-X PUT` 上传 |
| 清单 PR | 15 条在飞 | 本手册主体 |
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

---

## 五、本次实战数据（存档）

- **15 条 PR**：7 MCP 清单 + 5 治理清单 + 2 FDE 生态 + 2 DSH 生态（含 0xsline #547、Anil-matcha #122 当日投当日待审）
- **1 条已合并**：loop-engineering #573（adopters，仓主 cobusgreyling 亲自合并）
- **1 条待复审**：agentrust #89（真人 review，披露已补）
- **1 条流程完备**：e2b #1471（CLA 已签 + cla-bot 复验过）
- **首日回复率**：13 条老 PR 中 4 条有实质回复（31%），其中 1 条真人 review
- 未投：VoltAgent 52k（自动索引）、hesreallyhim 53k（人工精选迭代中，条目迁移期）、mahseema ⭐6.1k（**候选**，Developer tools 节格式对口，PR 免费）

## 六、下一步候选（按性价比排序）

一、**mahseema/awesome-ai-tools**（⭐6.1k，Developer tools 节）——格式已侦察完毕，条目一行即投
二、**hesreallyhim/awesome-claude-code**（⭐53k）——等其「legacy 迁移期」结束后再投（README 自述正在重构收录）
三、**imsai-sh / Dominic789654 / beancookie 三个小 DSH 清单**——星少但零竞争，顺手投
四、已投 15 条的合并追踪——每周巡检一次（`gh search prs --author KongFangXun --state open`）
