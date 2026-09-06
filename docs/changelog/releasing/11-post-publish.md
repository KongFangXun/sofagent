# 阶段十一：发布后

---

## 步骤

> 🔴 **执行时逐格勾选本表「完成」列**（非命令行动作没有勾选就无防漏——曾出现步骤漏做仍继续推进的漂移）。全部勾完本阶段才算闭环。
>
> 🔴 **开工第一动作 = 通读本表并建勾选意识**：本阶段 13 步横跨验证/回写/生成/讲解/运维多类动作，只按「回写状态行」一类理解会漏掉 dev prompt/daemon 重载/置顶核查等大半步骤（曾整批漏做靠作者质询才发现）。每完成一格当场把「完成」列改 [x]——漏勾一格 = 该步骤大概率没做。

| # | 完成 | 步骤 | 产物 |
|:--:|:--:|------|------|
| 一 | [x] | **发布后验证**（见下方脚本） | 全绿 |
| 二 | [x] | CI 全绿检查 | CI 全绿 |
| — | [x] | **Release Notes 范本快照更新**：本版 gh release 发布后，把 body 的实际结构（H2 骨架/新要素）回写 [06](./06-doc-finalize.md)「Release Notes」范本段的「已知结构基线」行——上一版实际发布物是下一版生成的结构 SSOT，发版后不回写 = 下一版按旧结构生成（漂移链条的根因闭环点） | 06 范本段基线行与本版 body 一致 |
| 三 | [x] | **审查三文档回写**：发版过程（阶段五~十）暴露的新问题回写到 regression-checklist（新维度）/ fresh-eyes-review（新教训）/ acceptance-test（新场景）。与阶段四分工：阶段四管代码质量（发版前可见），本步骤管发版流程（发版中才暴露——如 CI 失败模式、publish 限制、日期硬编码等）。⚠️ **改了 acceptance 场景数后立即跑 `bash tools/check/check-test-count.sh --scenarios-only`**（秒级轻量守卫——场景数改后立即拦截 DEVELOPMENT/LIMITATIONS 漂移，勿拖到 pre-push 才暴露） | 三文档更新 |
| 四 | [x] | SOP 漏洞吸收：本次迭代暴露的 releasing.md 流程问题直接吸收进对应阶段 | SOP 更新 |
| 五 | [x] | SOP 数字核对：维度数、检查项数等是否过期 | 数字一致 |
| 六 | [x] | 生成「下一版本开发 Prompt」到桌面：综合 ROADMAP + CHANGELOG + 下一版本 changelog | `~/Desktop/vX.Y-dev-prompt.md` |
| 七 | [x] | **开发 Prompt 校验循环**（详见下方——脚本 + checklist 五条自查两步都要过） | prompt 定稿 |
| 八 | [x] | **下版本内容对话讲解**（详见下方——三问讲完 + 负责人确认优先级，缺任一不算完） | 项目负责人理解下版本方向 |
| 九 | [x] | **进度追踪清零**：把 `releasing.md` 进度追踪的 11 个 `[x]` 全部改回 `[ ]`，为下一版本新周期做准备 | 进度追踪重置 |
| 十 | [x] | **releasing 自迭代**（sop 审查自己）：对照本次发版的实际执行体验，检查 11 个阶段文件是否有过时/缺漏/顺序不合理的地方，直接修正。这是 releasing.md 的「Dream Cycle」——每次发版后用它自己的经验喂养它自己 | releasing.md 更新 |
| 十一 | [x] | **本机 daemon 重载（dogfooding 保活）**：发版后本机守护进程要吃上新代码。launchd 配置 `~/Library/LaunchAgents/local.sofagent-daemon.plist` 指向仓库 dist（非全局 npm 包），一条命令重载：`launchctl kickstart -k gui/$(id -u)/local.sofagent-daemon`，随后 `tail -3 ~/.sofagent/data/daemon-launchd.log` 确认版本号 = 刚发的版本。开机自启已由 plist 的 RunAtLoad+KeepAlive 保证，无需每次处理。⚠️ **重载前先预检 plist node 路径存在性**（`ls "$(grep -o '/[^<]*bin/node' ~/Library/LaunchAgents/local.sofagent-daemon.plist | head -1)"`——plist 写死的绝对路径在 runtime 目录升级/清理后即失效 → exit 78 EX_CONFIG 崩溃循环；手动跑 CLI 正常即证明是路径问题。改路径须 `bootout`+`bootstrap` 重载，kickstart 不重读 plist）。⚠️ **真假日志辨析**：launchd 真实日志在 plist `StandardOutPath` 指向的 `~/.sofagent/data/daemon-launchd.log`；`~/.sofagent/daemon.log` 可能是测试进程残留旧文件，勿据此判断重载成败 | daemon 跑新版 |
| 十二 | [x] | **网络恢复收尾**：发版全程若用过降级通道（gh api tag / Git Data API push / 剥代理直连），网络恢复后必须做三件事：① `git fetch origin && git status` 确认本地/远端无分叉（有分叉按 09-publish「双 SHA 分叉接回」处理）；② lightweight tag 覆盖为 annotated——`git tag -f -a vX.Y.Z -m "vX.Y.Z · {一句话}" <commit> && git push origin vX.Y.Z --force`（gh api 直建 ref 的 lightweight tag 无 tag object，`git for-each-ref refs/tags` 显示 type blob/commit 即 lightweight；经 git/tags 建 object 再建 ref 的通道产出直接是 annotated，免覆盖）；③ 桌面发布物清理——本版产生的 prompt/body 草稿（`vX.Y.Z-*.md` / `release-note-*.md`）归档或删除，只保留下一版 dev prompt（发布物落盘铁律：统一 `~/Desktop/`，禁仓库内） | 远端/桌面双干净 |
| 十三 | [x] | **Discussions 置顶轮换**：新版 release 帖（Announcements 自动生成）**不置顶**——版本帖是流水内容，置顶位只留给常青帖。🔴 置顶**变更**无 API（GitHub GraphQL Mutation 只有 pinIssue 系，无 pinDiscussion），只能网页操作（右侧齿轮 → Unpin/Pin）；**只读核查**走 GraphQL `pinnedDiscussions { discussion { number title } }` 即可，无需开网页，异常才需网页干预 | 置顶位干净 |

---

## 发布后验证脚本（步骤一）

> ⏱️ **时长预期**：全套约 5-8 分钟（`npm install -g` 拉包 + `check-version` 全仓扫描）。回写三文档后若跑全量 acceptance 验证：**4-8 分钟正常，必须 `run_in_background` 后台跑**——300s 前台超时会误判「卡死」（曾出现场景内嵌全量 npm test，实际健康只是慢）。

```bash
# Git tag + release 验证
git tag -l | grep vX.Y.Z
gh release view vX.Y.Z
# Release Notes 完整性：body 非空 + 含 changelog markdown 链接 + 非 Draft
gh release view vX.Y.Z --json isDraft,body -q '.body | length'  # 期望 > 100
gh release view vX.Y.Z --json body -q '.body | contains("](./docs/changelog/")'  # 期望 true

# npm 版本验证
npm view @sofagent/audit version   # 期望 vX.Y.Z
npm view @sofagent/mcp version     # 期望 vX.Y.Z
npm view @sofagent/audit readme    # 期望有内容（非空）

# 全局安装更新（registry 已更新，本地仍是旧版本）
npm install -g @sofagent/audit@latest @sofagent/core@latest
sofagent-audit --version           # 期望 vX.Y.Z
sofagent-audit --doctor            # 期望与当前版本 doctor 项数一致
sofagent-core --doctor             # 期望全部通过

# 最终版本号一致性验证
bash tools/check/check-version.sh        # 期望全绿
```

---

## 发版后 hotfix 流程（步骤一-2 之间可能发生）

> CI-only 概率性失败 = 先怀疑概率路径（如随机密钥定长契约用 ≥2000 次采样锁），修复 → 补防复发锁 → 测试数文档同步 commit **必须与 hotfix 同 push**（分两次 push 会让中间 commit 的 CI 红——check-test-count 在 CI 也跑）。

## 开发 Prompt 校验循环（步骤七）

```
① 跑 ./tools/check/check-dev-prompt.sh ~/Desktop/vX.Y-dev-prompt.md（查"引用的东西存不存在"）
② 脚本输出零 ❌ 后，再过一遍 FORGE/playbook/dev-prompt-checklist.md 的 5 条自查
   （查"写法对不对/全不全/新不新"——函数签名准确性、注册点/数组归属、改造代码保留声明、已完成区剥离、强动词名副其实）
③ 两项都过 → prompt 定稿
④ 任一项发现问题 → 逐条修正 prompt（只改 prompt 文件、不改代码库）→ 回到 ① 重跑
⑤ 最多 5 轮（5 轮仍不过说明开发日志本身有结构性问题，需人工介入）

脚本输出含义：
  ❌ 错误 = 引用了不存在的已有文件/函数（必须修）
  📋 待新建 = prompt 描述的新文件（正常，不算错误）
  🔄 运行时 = ~/.sofagent/ 等运行时目录（跳过）
```

> check-dev-prompt.sh 只查「存在性」，checklist 补「准确性」——两者互补，缺一不可。

---

## 下一版本开发 Prompt 生成说明（步骤六）

> 来源：下一版本的「开发日志」——在 `docs/changelog/` 中查找（若不存在则先按下方流程补建）。辅助输入：`ROADMAP.md`（未来去哪 / 规划）+ `CHANGELOG.md`（版本索引）。

**生成流程**：
1. 读 `ROADMAP.md` 的「未来去哪」节，提取下一版本规划方向
2. 读 `CHANGELOG.md` 确认下一版本号与索引条目
3. 读 `docs/changelog/v<major>.<minor>/vX.Y.md`（下一版本开发日志，若存在）—— 这是开发 prompt 的主体来源
4. 🔴 **完整读开发日志全文，禁止只看章节标题列表**（head/tail 截断曾漏掉中段完整章节致 prompt 漏交付。开发日志 400+ 行必须整读，交付清单以「## 章节标题」全量提取为准）
5. 综合上述，生成开发 prompt 落盘 `~/Desktop/vX.Y-dev-prompt.md`（结构：问题描述 → 修复方案 → 验证方式 → 发布检查清单）
6. 跑步骤七 校验循环

**Prompt 结构规范**——开发 prompt 不是 changelog 的裁剪版，而是**面向执行者的自足作战文档**，七要件缺一即回炉：

| 要件 | 说明 | 反面案例 |
|------|------|---------|
| 🔴 红线置顶 | 发版级红线（CI 全绿才 tag / release note 实跑对照 / 标题带主题短语等）放开头，任何章节不得违反 | 红线埋在中段，执行者做完才发现违反 |
| 权威源声明 | 头部声明「以开发日志为准，本 prompt 是执行 checklist」+ 基线快照（tag/npm/工具数/测试数）+ 开工前门禁命令 | 无基线——执行者不知道从哪个状态起步 |
| 章节任务清单 | 按**依赖序**（非文档序）排章；每交付件一行：`- [ ] 改/新建 \`路径\` + 做什么`；章尾挂验收标准 | 按 changelog 目录序照抄——上游产物没好下游就动工 |
| 路径真实性 | 开发日志写 `dashboard.html` 这类无前缀路径时，prompt 必须写真实路径 `tools/dashboard/dashboard.html` 并加 ⚠️ 标注差异——check-dev-prompt 只拦「不存在」，拦不住「存在但写错」 | 路径含糊导致改错文件 |
| 全局验收 | 发版关口收敛：工具数六处同改 / 测试数对账 / 场景数 SSOT / 新维度登记 / 四门禁 / 双语对称 / 红线复述 | 各章验收齐但全局口径没人对账 |
| 已完成区 | 已落盘条目显式标「仅回归验证，勿重复实现」（对照 `git log --oneline -20` 扫描）——防时间快照失真导致重复施工 | prompt 里混着「其实已做完」的条目 |
| 开发纪律 | 中文序号 / 脱敏规范 / 术语统一 / U+FFFD 扫描 / 章节完对照 changelog 验收标准打勾 | 执行者用自己习惯的风格另起炉灶 |

**生成前对账 checklist（5 条）**：① 章节完整性——prompt 章节数 == 开发日志 `## ` 章节数（漏章=漏交付）② 路径核对——开发日志「涉及文件」表逐行过一遍 `ls`，无前缀路径查真实位置 ③ 验收搬运——开发日志每章「验收标准」的 `- [ ]` 全部落进 prompt 对应章 ④ 新建文件命名——新建 `.sh`/`.mjs` 检查仓库既有同类命名风格（如 tools/ 下检查器用 `check-` 前缀），**禁中文文件名**（现有门禁无此项，靠本条兜底）⑤ **修正批回写完整性**——prompt 生成后又合入审查修正/定谳/销案合并的，修正批必须回写**同一结论的全部落点**（基线表、待拍板清单、正文交叉引用「见第 N 条」）；收尾时 grep 修正关键词扫全 prompt 逐处核对，并列出本批触碰段落清单——列不全即未收口（曾出现基线表与文末清单结论并存矛盾、清单合并后引用错位）。

**若下一版本 changelog 尚未创建**：
1. 先写新版本需求，产出 `docs/changelog/v<major>.<minor>/vX.Y.md`
2. 再执行上方「生成流程」生成桌面开发 prompt

---

## 下版本内容对话讲解（步骤八）

> prompt 文件是给 AI 执行用的（精确的技术指令），但项目负责人（人）需要的是**用"人话"理解下版本要干什么**。步骤八 在 prompt 定稿后，用对话形式向项目负责人讲解三个问题，帮助其理解方向、做出决策。

**讲解三个问题**（用大白话，不堆术语）：

1. **下个版本需要开发的内容**——一句话总结这版要干的核心的事，然后用"从 X 到 Y"的进化框架说清楚和上版本的区别（上版本做到了什么、留下了什么缺口、这版补什么）
2. **增加了什么新东西**——逐项列出新能力，每项用"人话"说明它解决什么问题（不是技术名词堆砌，是"企业客户为什么需要它"）
3. **能让产品未来怎么样**——这版做完后，产品的能力边界扩展到了哪里；和竞品/行业趋势的关系；为后续版本铺的什么路

**讲解原则**：
- 先给"一句话总结"，再展开细节
- 用具体场景举例（如"客服退货节点"而非抽象的"语义判定"）
- 对比"现在（上版本）" vs "做完后（这版）"的差异
- 说明每项能力的"对企业客户的意义"，不只讲技术实现

**互动方式**：讲解后询问项目负责人——是否需要调整开发优先级？是否有新的需求要加入？确认后 prompt 才算真正定稿。

---

## 进度追踪清零（步骤九）

> 本版本发版流程全部完成后，最后一步——把 `releasing.md` 进度追踪的 11 个 `[x]` 全部改回 `[ ]`，为下一版本新周期做准备。

**为什么要清零**：进度追踪是"当前版本走到哪了"的实时状态。如果不清零，下版本新 session 打开 releasing.md 会看到 11 个全 [x]，误以为"已完成"而不知道该从哪开始。清零后第一个 `[ ]`（阶段一）就是下版本的起点。
>
> **终态语义**：若发版过程未逐阶段打勾（直接走到本步骤），此处确认全 `[ ]` 即达成清零终态——打勾缺失不影响闭环（进度可见性靠各阶段产物与本表勾选），勿为补打勾而回溯考古。

**操作**：
```bash
# 把 releasing.md 进度追踪的 [x] 全部改回 [ ]
sed -i '' 's/- \[x\]/- [ ]/g' docs/changelog/releasing.md
```

**清零后确认**：进度追踪 11 行全部 `[ ]`，下一版本从阶段一重新开始。

---

## releasing 自迭代（步骤十）

> releasing.md 是活文档——每次发版的实际执行体验是最值钱的反馈。步骤十 是 releasing.md 的「Dream Cycle」：用它自己的经验喂养它自己，持续修正过时/缺漏/顺序不合理的地方。

**检查维度**（每次发版后逐一过）：

| # | 检查项 | 怎么查 | 修法 |
|:--:|--------|--------|------|
| 一 | **阶段顺序与实际流程一致** | 对比本次实际执行的步骤顺序 vs 阶段文件写的顺序 | 不一致 → 更新阶段文件（以实际为准） |
| 二 | **阶段间引用无断裂** | grep "阶段 X" 确认引用的阶段号/文件名都存在 | 断裂 → 修正引用；SOP 文件改名/拆分/移动时额外 `grep -rn "<旧文件名>" docs/ README.md` 全仓回扫（历史 changelog 活链接随迁，纯考古叙述不动） |
| 三 | **配套文档链接有效** | releasing.md 底部配套文档链接可访问 | 失效 → 更新路径 |
| 四 | **本次发版暴露的 SOP 缺口** | 回顾发版过程中「SOP 没写但我踩了坑」的环节 | 缺口 → 吸收进对应阶段 |
| 五 | **冗余/过时步骤** | 有没有阶段写了但实际从不执行（或已被工具覆盖）的步骤 | 删除或标注「工具已覆盖」 |
| 六 | **ROADMAP 体检** | 按 [06-doc-finalize.md](./06-doc-finalize.md)「ROADMAP 同步手册」的体检清单 9 项扫一遍（重复表/散落章节/死链/已交付混入/范围过期/模糊版本号/U+FFFD/新增前未 grep 同类/同类 ≥3 未抽库） | 逐项修复 |

> 📋 **发版 commit 规范（防 git log 噪音）**：发版过程中阶段一~十一的进度打勾（`releasing.md` 进度追踪 `[x]`）会产生大量「元工作 commit」。**这些打勾类 commit 应 squash 为单个 `docs(releasing): vX.Y.Z 发版流程完成`**，不要每个阶段一个 commit——否则 git log 充斥 `docs(releasing): 阶段X打勾` 噪音，外部贡献者看 commit 历史会以为项目没有产品迭代。实际产品改动（代码 fix/feat、文档内容修改）照常各自独立 commit，只有「纯进度打勾」类元工作 commit 才 squash。

> 📏 **进度追踪防膨胀**：releasing.md 进度追踪只保留「阶段名 + 链接 + 一句职责」的极简形态——版本执行实录、耗时记录、run 编号一律不写回（过程记录归 devlog / changelog 快照）。发现进度追踪区开始堆积考古内容即回炉瘦身。
