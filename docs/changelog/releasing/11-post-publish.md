# 阶段十一：发布后

---

## 步骤

> 🔴 **执行时逐格勾选本表「完成」列**（v1.3.6 教训：步骤八「对话讲解」曾被漏做仍继续推进——非命令行动作没有勾选就无防漏）。全部勾完本阶段才算闭环。

| # | 完成 | 步骤 | 产物 |
|:--:|:--:|------|------|
| 一 | [ ] | **发布后验证**（见下方脚本） | 全绿 |
| 二 | [ ] | CI 全绿检查 | CI 全绿 |
| 三 | [ ] | **审查三文档回写**：发版过程（阶段五~十）暴露的新问题回写到 regression-checklist（新维度）/ fresh-eyes-review（新教训）/ acceptance-test（新场景）。与阶段四分工：阶段四管代码质量（发版前可见），本步骤管发版流程（发版中才暴露——如 CI 失败模式、publish 限制、日期硬编码等）。⚠️ **改了 acceptance 场景数后立即跑 `bash tools/check/check-test-count.sh --scenarios-only`**（秒级轻量守卫——v1.4.3 教训：S361 后 DEVELOPMENT/LIMITATIONS 漂移拖到 pre-push 才暴露，commit 时即可拦截） | 三文档更新 |
| 四 | [ ] | SOP 漏洞吸收：本次迭代暴露的 releasing.md 流程问题直接吸收进对应阶段 | SOP 更新 |
| 五 | [ ] | SOP 数字核对：维度数、检查项数等是否过期 | 数字一致 |
| 六 | [ ] | 生成「下一版本开发 Prompt」到桌面：综合 ROADMAP + CHANGELOG + 下一版本 changelog | `~/Desktop/vX.Y-dev-prompt.md` |
| 七 | [ ] | **开发 Prompt 校验循环**（详见下方——脚本 + checklist 五条自查两步都要过） | prompt 定稿 |
| 八 | [ ] | **下版本内容对话讲解**（详见下方——三问讲完 + 负责人确认优先级，缺任一不算完） | 项目负责人理解下版本方向 |
| 九 | [ ] | **进度追踪清零**：把 `releasing.md` 进度追踪的 11 个 `[x]` 全部改回 `[ ]`，为下一版本新周期做准备 | 进度追踪重置 |
| 十 | [ ] | **releasing 自迭代**（sop 审查自己）：对照本次发版的实际执行体验，检查 11 个阶段文件是否有过时/缺漏/顺序不合理的地方，直接修正。这是 releasing.md 的「Dream Cycle」——每次发版后用它自己的经验喂养它自己 | releasing.md 更新 |
| 十一 | [ ] | **本机 daemon 重载（dogfooding 保活 · 2026-08-18 新增）**：发版后本机守护进程要吃上新代码。launchd 配置 `~/Library/LaunchAgents/local.sofagent-daemon.plist` 指向仓库 dist（非全局 npm 包），一条命令重载：`launchctl kickstart -k gui/$(id -u)/local.sofagent-daemon`，随后 `tail -3 ~/.sofagent/data/daemon-launchd.log` 确认版本号 = 刚发的版本。开机自启已由 plist 的 RunAtLoad+KeepAlive 保证，无需每次处理。⚠️ **重载前先预检 plist node 路径存在性**（`ls "$(grep -o '/[^<]*bin/node' ~/Library/LaunchAgents/local.sofagent-daemon.plist | head -1)"`——v1.4.3 实录：runtime 目录清理致写死的绝对路径失效 → exit 78 EX_CONFIG 崩溃循环，手动跑 CLI 正常即证明是路径问题；改路径须 `bootout`+`bootstrap` 重载，kickstart 不重读 plist） | daemon 跑新版 |
| 十二 | [ ] | **网络恢复收尾（v1.4.0 新增）**：发版全程若用过降级通道（gh api tag / Git Data API push / 剥代理直连），网络恢复后必须做三件事：① `git fetch origin && git status` 确认本地/远端无分叉（有分叉按 09-publish「双 SHA 分叉接回」处理）；② lightweight tag 覆盖为 annotated——`git tag -f -a vX.Y.Z -m "vX.Y.Z · {一句话}" <commit> && git push origin vX.Y.Z --force`（gh api 建的 tag 无 tag object，`git for-each-ref refs/tags` 显示 type blob/commit 即 lightweight）；③ 桌面发布物清理——本版产生的 prompt/body 草稿（`vX.Y.Z-*.md` / `release-note-*.md`）归档或删除，只保留下一版 dev prompt（发布物落盘铁律：统一 `~/Desktop/`，禁仓库内） | 远端/桌面双干净 |
| 十三 | [ ] | **Discussions 置顶轮换（网页操作 · 30 秒）**：新版 release 帖（Announcements 自动生成）**不置顶**——版本帖是流水内容，置顶位只留给常青帖。当前常青帖 = #11「用 sofagent 的都在这报到」。若版本帖曾被误置顶，网页右侧齿轮 → Unpin；若需轮换常青帖，同样路径 Pin。🔴 置顶无 API（GitHub GraphQL Mutation 只有 pinIssue 系，无 pinDiscussion——2026-09-01 实测），只能网页操作（⚠️ GraphQL `pinnedDiscussions { discussion { number title } }` **可只读查询**——v1.4.3 实测置顶位核查不需开网页，仅变更才需要） | 置顶位干净 |

---

## 发布后验证脚本（步骤一）

> ⏱️ **时长预期**：全套约 5-8 分钟（`npm install -g` 拉包 + `check-version` 全仓扫描）。回写三文档后若跑全量 acceptance 验证：**4-8 分钟正常，必须 `run_in_background` 后台跑**——300s 前台超时会误判「卡死」（v1.4.3 实录：场景 165 内嵌全量 npm test，实际健康只是慢）。

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

## 发版后 hotfix 流程（v1.3.6 实战补 · 步骤一-2 之间可能发生）

> v1.3.6 发布后 pr-check 抓到概率性失败（ECDH 私钥前导零，1/256）：CI-only 红 = 先怀疑概率路径（随机密钥定长契约用 ≥2000 次采样锁），修复 → 补防复发锁 → 测试数文档同步 commit **必须与 hotfix 同 push**（分两次 push 会让中间 commit 的 CI 红——check-test-count 在 CI 也跑）。

## 发版耗时记录（v1.3.6 起追踪 · 步骤十 自迭代的输入）

> 在步骤表下方追加一行（版本 / 开发完成→发布的墙钟时间 / release-gate 循环次数及主因）——用于观测审查循环健康度：v1.3.6 基线 = 约 9 小时 / 3 轮（3 轮全因检查器自身缺陷，归一化修复后预期单轮直过）。若某版仍 ≥3 轮，深挖 driver 而非仓库。

| 版本 | 开发完成→发布 | release-gate 轮次 | 主因 |
|------|--------------|------------------|------|
| v1.3.6 | ~9h | 3（2 假 FAIL + 1 真 PASS） | 检查器缺陷：exit 语义 / PROJECT_ROOT / 视野预算 / 零 commit 假 PASS |
| v1.3.8 | ~6h（10:00 开发完成 → 16:00 发布） | 4（run-03 环境崩溃 / run-06 缺输入 / run-10 截断+占位 / run-13 PASS） | driver 管线问题 3 轮（judgment-only 缺 acceptance 输入 / precheck 截断 / 占位无实证）+ 环境 1 轮（运行窗口 HEAD 漂移 8 次致 OOM）；driver 修复后 run-13 单轮直过 |
| v1.3.9 | ~25h（08-20 15:00 开发完成 → 08-21 16:10 发布，含隔夜） | 3（run-01 FAIL 4 阻塞 / run-10 FAIL 1 coverage / run-13 PASS） | run-01 真实 4 阻塞（mcp bin 权限 / forge-smoke 路径漂移 / 测试数文档漂移 / checklist #119 路径错，主 session 零信任复验修复）+ run-10 coverage 2 零覆盖（ATTRIBUTION/Dream 补 S318/S319）；driver 无债，全人工修复后 run-13 单轮直过 |
| v1.4.1 | ~3.5h（08-27 08:30 阶段十启动 → 12:00 阶段十二完成） | 0（判断层 PASS 已在发版窗口前凌晨完成，与 v1.4.0 同模式） | CI 红 1 次（sandbox 时间戳双源竞态真 bug——修复+回归锁+8 文档数字同 commit 转绿）；分发期补修双层 manifest 盲区 2 commit（bump 通配误伤 + manifest 层未覆盖） |
| v1.4.2 | ~4h（08-28 晚放行 → 08-29 00:5x 阶段十二完成，含隔夜） | 0（判断层 PASS 已在发版窗口前完成，与 v1.4.0/1.4.1 同模式） | 网络故障贯穿全程（git push 502 代理死→Git Data API 三推 + ps1 eol 二坑 11 文件分叉→cat-file 重传逐字节一致）；CI 红 1 次（B8 测试隐式依赖全局安装——本地狗粮假绿 CI 纯净环境真红，补 dist fixture 转绿）；双 SHA rebase 对齐悬置（github.com 443 持续断，登记下版收尾） |
| v1.4.4 | ~7h（09-03 上午阶段六启动 → 18:30 阶段十一过半） | 0（阶段五 run-07 GO 有条件放行，连续第五版同模式） | 网络半瘫再现（github.com 443 断 api.github.com 通——main 走 gitdata-push.mjs + tag 走 gh api 建 annotated object，网络恢复后 rebase 干净接回）；npm skillopt 传播慢触发一次 6×30s 超时（日志判读 + pkg@ver 已入队即信，等 120s 自愈）；release note 工序三对照抓出段落顺序颠倒（质量验证/破坏性变更）；同文件多 Edit 并行竞态实锤（5 处只落 2 处，串行重做） |

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
4. 🔴 **完整读开发日志全文，禁止只看章节标题列表**（v1.3.6 教训：`head`/`tail` 截断会漏掉中间章节——训练协议/预算两个完整章节恰好被截断，prompt 漏了 4 项交付。开发日志 400+ 行必须整读，交付清单以「## 章节标题」全量提取为准）
5. 综合上述，生成开发 prompt 落盘 `~/Desktop/vX.Y-dev-prompt.md`（结构：问题描述 → 修复方案 → 验证方式 → 发布检查清单）
6. 跑步骤七 校验循环

**Prompt 结构规范（v1.4.2 拍板 · 2026-08-29）**——开发 prompt 不是 changelog 的裁剪版，而是**面向执行者的自足作战文档**，七要件缺一即回炉：

| 要件 | 说明 | 反面案例 |
|------|------|---------|
| 🔴 红线置顶 | 发版级红线（CI 全绿才 tag / release note 实跑对照 / 标题带主题短语等）放开头，任何章节不得违反 | 红线埋在中段，执行者做完才发现违反 |
| 权威源声明 | 头部声明「以开发日志为准，本 prompt 是执行 checklist」+ 基线快照（tag/npm/工具数/测试数）+ 开工前门禁命令 | 无基线——执行者不知道从哪个状态起步 |
| 章节任务清单 | 按**依赖序**（非文档序）排章；每交付件一行：`- [ ] 改/新建 \`路径\` + 做什么`；章尾挂验收标准 | 按 changelog 目录序照抄——上游产物没好下游就动工 |
| 路径真实性 | 开发日志写 `dashboard.html` 这类无前缀路径时，prompt 必须写真实路径 `tools/dashboard/dashboard.html` 并加 ⚠️ 标注差异——check-dev-prompt 只拦「不存在」，拦不住「存在但写错」 | 路径含糊导致改错文件 |
| 全局验收 | 发版关口收敛：工具数六处同改 / 测试数对账 / 场景数 SSOT / 新维度登记 / 四门禁 / 双语对称 / 红线复述 | 各章验收齐但全局口径没人对账 |
| 已完成区 | 已落盘条目显式标「仅回归验证，勿重复实现」（对照 `git log --oneline -20` 扫描）——防时间快照失真导致重复施工 | prompt 里混着「其实已做完」的条目 |
| 开发纪律 | 中文序号 / 脱敏规范 / 术语统一 / U+FFFD 扫描 / 章节完对照 changelog 验收标准打勾 | 执行者用自己习惯的风格另起炉灶 |

**生成前对账 checklist（5 条）**：① 章节完整性——prompt 章节数 == 开发日志 `## ` 章节数（漏章=漏交付）② 路径核对——开发日志「涉及文件」表逐行过一遍 `ls`，无前缀路径查真实位置 ③ 验收搬运——开发日志每章「验收标准」的 `- [ ]` 全部落进 prompt 对应章 ④ 新建文件命名——新建 `.sh`/`.mjs` 检查仓库既有同类命名风格（如 tools/ 下检查器用 `check-` 前缀），**禁中文文件名**（现有门禁无此项，靠本条兜底）⑤ **修正批回写完整性（2026-09-01 拍板）**——prompt 生成后又合入审查修正/定谳/销案合并的，修正批必须回写**同一结论的全部落点**（基线表、待拍板清单、正文交叉引用「见第 N 条」）；收尾时 grep 修正关键词扫全 prompt 逐处核对，并列出本批触碰段落清单——列不全即未收口（实测病灶：基线表「未定谳」与文末清单「已定谳」并存、清单合并后引用错位）。

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
| 三 | **配套文档链接有效** | releasing.md 底部 3 个配套文档链接可访问 | 失效 → 更新路径 |
| 四 | **本次发版暴露的 SOP 缺口** | 回顾发版过程中「SOP 没写但我踩了坑」的环节 | 缺口 → 吸收进对应阶段 |
| 五 | **冗余/过时步骤** | 有没有阶段写了但实际从不执行（或已被工具覆盖）的步骤 | 删除或标注「工具已覆盖」 |
| 六 | **ROADMAP 体检** | 按 [06-doc-finalize.md](./06-doc-finalize.md)「ROADMAP 同步手册」的体检清单 9 项扫一遍（重复表/散落章节/死链/已交付混入/范围过期/模糊版本号/U+FFFD/新增前未 grep 同类/同类 ≥3 未抽库） | 逐项修复 |

> 📋 **发版 commit 规范（防 git log 噪音）**：发版过程中阶段一~十一的进度打勾（`releasing.md` 进度追踪 `[x]`）会产生大量「元工作 commit」。**这些打勾类 commit 应 squash 为单个 `docs(releasing): vX.Y.Z 发版流程完成`**，不要每个阶段一个 commit——否则 git log 充斥 `docs(releasing): 阶段X打勾` 噪音，外部贡献者看 commit 历史会以为项目没有产品迭代。实际产品改动（代码 fix/feat、文档内容修改）照常各自独立 commit，只有「纯进度打勾」类元工作 commit 才 squash。

> 📏 **行内记录瘦身（v1.4.3 起 · 防进度追踪膨胀）**：`releasing.md` 进度追踪每阶段行内的 `**vX.Y.Z：…**` 记录 ≤200 字/版·阶段——超出部分写进对应阶段文件的详情段，行内只留「一句话 + 数字基线 + 指向」。判据：L15-26 每行超过 3 屏（约 1500 字符）即触发瘦身。历史行内记录是快照不追溯改写，只约束新增。

**v1.3.2 发版后的自迭代记录**（示例，每次发版后追加一条）：

- **步骤三 新增**（审查三文档回写）：阶段五管代码质量，本步骤管发版流程——v1.3.2 阶段十一~十二暴露的 3 个问题（日期硬编码/警戒线多处同步/npm workspace 限制）进了 regression-checklist 95-97
- **阶段十一策略统一**：从 npm 先行改为 tag 先行（push main → 等 CI → tag → release auto-publish → 手动 publish 10 包）——v1.3.2 实际验证，tag 一定指向 CI 全绿 commit 更安全

**v1.3.3 发版后的自迭代记录**：

- **阶段八新增 LIMIT 检查**：check-docs.sh LIMIT_B 超标（8437 > 8400）在 CI 才暴露——本地 WorkBuddy 环境跑 check-docs.sh 超时（锚点段 node 逐行调慢），CI 上才能跑完。已补 regression-checklist 维度 101（LIMIT 超标提前检查）。建议阶段八加一步"CI 模拟只跑 B 层行数检查（不跑锚点段避免超时）"
- **阶段十 git proxy 对齐**：WorkBuddy 环境的代理端口会变（54621→53957），git global config 里的旧端口导致 push 失败。阶段十加一步"push 前确认 git proxy 端口与环境变量一致"
- **阶段十 gh API 推 tag**：git push tag 遇代理 502 时，用 `gh api` 创建 tag object + ref 绕过（走 api.github.com 通道）。已验证可行，加入阶段十网络降级策略
- **阶段六 release-gate driver 两个 bug**：① verdict 误判 PASS（status.json 标 PASS 但 results 全 FAIL）② changelogPath 路径偏差（指向 `docs/changelog/1.3.3.md` 而非 `v1.3/v1.3.3.md`）。driver bug 未修但不影响发版判定（verdict.md 为准）——FORGE 工程债

**v1.3.4 发版后的自迭代记录**：

- **阶段五 verdict 读取规则**：driver 在 verdict.md 尾部追加的「FAIL→PASS 修复收敛」段不可信——run-01 中 f-fix 报错没改任何代码，尾部照样写 PASS。阶段五模板加判定规则：verdict 以主体 `IS_PASS:` 行为准 + f-fix 有 git diff 才算修复收敛（stepErrors 非空 = 本轮作废）。已回写 regression-checklist 维度（臆造链家族）与 fresh-eyes-review 教训
- **阶段八 hook 测试用例合格性**：SOP 自带的测试用例 message（"test"/"add app"）太短被 A5+A19 正确拦截——测试用例自己不合格导致假失败。已修 08-tool-health.md（合格 message + `git add -f` 说明），并回写 checklist 维度 108 防 SOP 再漂移
- **阶段十 pre-push 环境降级**：check-docs 第 11 项锚点扫描（bash 逐行）在 WorkBuddy shim 环境必然超时——与 check-anchors.mjs 功能重复。已加 `SKIP_ANCHOR_SCAN=1` 降级开关（CI 跑完整版）；WorkBuddy 环境跑 pre-push 应带此变量（4m43s vs 13min+）。回写 checklist 维度 109
- **阶段十 Git Data API 收尾通道实战**：发布完成后网络彻底断（github.com 443 不通），最后的打勾 commit 走 blobs→trees→commits→refs PATCH 完成。新增后续动作：**网络恢复后必须 `git pull --rebase` 对齐本地远端 SHA**（API commit 与本地 commit 同内容不同 SHA，git 会识别 cherry-pick 重复自动消化）
- **阶段九二 stash 清理纳入发版收尾**：本轮发版过程发现 4 个历史 stash 残留——逐段甄别后 3 段有价值内容恢复进对应 changelog、其余确认覆盖后清理。原则：stash 是隐形技术债，发版收尾时顺手清（stash list 非空即处理）
- **阶段三 + 阶段十一加 check-test-count 门禁**：v1.3.4 周期内 bugfix（+31 测试 → 8 处漂移）+ dev（+93 → 11 处）+ dsh（+11 → 7 处）**三次犯同类错误**——新增测试后文档声称数（README/WIKI/LIMITATIONS/ARCHITECTURE）未同步。根因：check-test-count.sh 只在 tag 前（阶段十一步骤四）跑一次，开发过程中没人跑。修复：① 阶段三（自测）加步骤四——`check-test-count.sh --quiet` 作为开发完成后的强制门禁；② 阶段十一（发布）步骤二 显式列 check-test-count 与 check-docs.sh 并列。**原则：新增/删除测试 = 必须同步文档声称数，check-test-count 不绿不算开发完成**

**v1.3.7 发版后的自迭代记录**：

- **步骤编号铁律（用户拍板）**：所有步骤编号一律中文序号（一、二、三……），禁止阿拉伯数字、小数点、字母后缀——「4b」类编号是反面案例。已全量清理 12 个阶段文件（38 处引用 + 12 个表格行号），并写入项目铁律
- **release note 三道工序**：v1.3.0~1.3.6 每次发布后都发现问题再改——本次新增「生成→自检（质量表恰 7 项/H2 骨架同构/七项逐字/尾链）→上一版结构对照」工序，v1.3.7 一次到位零修改
- **CI 全绿硬前置**：push 后轮询到全绿（60s 循环）才允许打 tag——原 sleep 30 单次查看可被跳过。实测 shellcheck runner apt stall（16 分钟挂 Install ShellCheck）→ `gh run rerun` 解决；空 commit 不触发 paths 过滤的 workflow，重触发用 rerun 而非空 commit
- **check-version TS 文件头溯源标记误报（CI 红实录）**：文件头注释版本号是功能溯源标记（`v1.1.9 新增`）非当前版本锚点，历史 check 误判为「漏 bump」。判据改为「找 = SSOT 版本号」：有锚点通过、纯溯源跳过；bump 同步豁免（防误伤）。已回写 checklist 维度 116
- **push 连接三连失败实录**：git config 死代理 → 直连 443 超时/HTTP2 framing → HTTP/1.1 + 慢速兜底解决。经验：curl 能通 ≠ git 能通。已写入 10-publish 网络降级策略
- **daemon CI 模拟姿势对齐**：SOFAGENT_HOME=/tmp 会触发 data-paths 越界守卫回退——模拟脚本与 daemon-macos-ci.yml 对齐（仓库内 .sofagent + daemon.sh + sleep 35）
- **v1.3.7 发版耗时**：开发完成（08-18 14:00 前后）→ 发布（08-19 13:40）约 24h（含隔夜）；release-gate 2 轮 FAIL 均检查器侧债（dim106 SSOT/dim116 awk 转义），手工裁决 PASS

**v1.3.8 发版后的自迭代记录**：

- **阶段五·仓库冻结纪律（新增）**：run-03 运行窗口（31.5 分钟）HEAD 被改 8 次 → 三 worker 崩溃/OOM。判断层运行期间仓库必须冻结（含脚本层直跑）——已写入 05-release-gate.md「运行期间仓库冻结纪律」小节 + 判 FAIL 分诊方法（先查运行窗口 HEAD 变动）
- **阶段五·judgment-only 注入机制（更新）**：run-06（缺 acceptance 输入 FAIL）+ run-10（占位无实证）两次踩坑 → driver 修复为「启动时注入脚本层预跑日志（仓库根 acceptance-raw.log / SOFAGENT_ACCEPTANCE_LOG）+ 无日志主动实测」。**SOP 侧根因：prompt 模板写 /tmp/acceptance-raw.log 但 driver 找仓库根——路径不一致**。已修 06 prompt 模板 + 更新旧描述
- **阶段六·precheck 紧凑格式（更新）**：run-10 的 59/91 维截断根因是 indent=2 JSON 格式化结构开销 637 行 + sf_read 引擎层 500 行上限（v1.3.6 修 FORGE 预算表 800 是修错层）——driver 已改紧凑格式单行写盘。认知：sf_read 是行数限制非字符限制，单行大文件整行返回
- **阶段九·bump dry-run 先 commit（新增）**：v1.3.8 阶段九误把未提交的阶段八改动当 dry-run 污染，git checkout -- . 整批误撤。已写入 08-tool-health.md 步骤三：先 commit 再跑 dry-run
- **阶段十·Git Data API 四坑（更新）**：原三坑（base64/eol/cat-file）补第四坑——tree 条目 mode 硬编码 100644 丢全部 .sh 执行位（verify CI 失败），恢复靠「blob 内容寻址引用既有 blob 建新 tree」；另 create-tree 无法表达删除/rename 残留，须 Contents API 补删。验收唯一标准：远端 tree sha == 本地 HEAD tree
- **阶段八·Release Notes 锚点对照（更新）**：SOP 08 曾误写「简洁三段式」但 v1.3.0/1.3.1/1.3.7 实际发布均为「分节式 + 质量验证表」——v1.3.8 两次被作者退回（漏质量验证表 + 漏标题主题短语）。SOP 08 重写为 v1.3.7 锚点 + 铁律 N1-N8 + SOP 11 工序 3 机制标准 = v1.3.7 实际发布物；10-confirm 补防漂移铁律（发布 prompt 的 gh release 段必须逐字引用 SOP 11 模板）
- **步骤编号铁律复查**：10-publish.md「### 5.0」标题 + 工序 1/2/3 + 代码块 2a-2d 三处残留修复为中文序号/①②③④；全仓复查零残留
- **check-dev-prompt.sh 三缺陷修复（工具）**：① bash/node 命令前缀未剥离 → `bash tools/check/check-version.sh` 误报 ❌ ② is_runtime 定义未接线 → worklog.json 误报 ❌ ③ planned 只看同行关键词 → tools/ 分目录目标路径误报 ❌。修复后 v1.3.9 prompt 校验 0 错误
- **v1.3.8 发版耗时**：约 6h（08-20 10:00 开发完成 → 16:00 发布）；release-gate 4 轮（3 轮 driver 管线问题 + 1 轮环境，driver 修复后 run-13 单轮直过）

**v1.3.9 发版后的自迭代记录**：

- **阶段十一·步骤八 E409 staged 处理（新增）**：`npm publish` 网络中断留 staged blob（版本号占位未 finalize）→ 同版本重发 E409「previously staged」24h 锁。处理：`npm unpublish <pkg>@<ver> --force` 清记录 + registry 传播完成即可重发（v1.3.9 实战 skillopt）。已写入 10-publish 步骤八
- **阶段十·步骤六 tag push 失败重试（新增）**：`git tag -a` 本地打标成功但 push 中断（exit 137 SIGKILL/超时）→ 远端无 tag 本地有。重试用网络降级完整命令单独 push tag + `gh api .../git/refs/tags/vX.Y.Z` 确认远端。已写入 10-publish 步骤六
- **阶段八·Release Notes 段存在性（新增）**：v1.3.9 发布前才发现 v1.3.9.md 缺「## Release Notes」段（08 铁律十一欠账）→ 补写后才进 gh release。已写入 08 步骤一验证方式（定稿必含该段）
- **阶段六·文档预算确认（新增步骤九）**：check-docs LIMIT 超标（B 层 9363>9300）到阶段十 pre-push 才暴露——阶段六文档收尾新增内容推高行数。已写入 08 步骤表（打勾前跑 check-docs）
- **阶段十·定位优化（v1.3.9 用户拍板）**：「纯确认环节」用户觉得怪（内容重复无决策意义）→ 重定位为「发布放行关口」：发布就绪汇总（门禁基线表）+ 作者一次性放行（三拍板项）+ 发布 prompt 交接，不再逐项过。09-confirm.md 已改
- **双 SHA 分叉接回实操**：远端 Git Data API 遗留 commit（同 tree 不同 SHA）→ `git fetch`（剥代理直连）+ `git rebase --onto origin/main <本地等价点> main` 接回（v1.3.9 实战 678cc130→d274d826）；本地历史找等价点用 `git log --all --format="%h %T"` 匹配 tree
- **v1.3.9 发版耗时**：约 25h（08-20 15:00 → 08-21 16:10，含隔夜）；release-gate 3 轮全人工修复（4 阻塞 + 2 零覆盖），driver 无债

**v1.4.0 发版后的自迭代记录**：

- **阶段十·步骤四 push 前置 lock 检查（新增）**：新增 9 个 cordis-plugin workspace 包但 lock file 未同步——push 后 4 个 CI 工作流（pr-check/verify/audit/windows-ci）在 `npm ci` 严格校验**同根因全红**（本地 `npm install` 静默补齐掩盖问题）。修复：`npm install --package-lock-only` 补齐（+217/-228 行：9 workspace 条目 + vitest@2 依赖树入 lock，悬空旧前缀条目清理）。已写入 10-publish 步骤四（push 前 `npm ci --dry-run` 零 Missing 必跑）+ checklist 维度 122
- **阶段十一·DSH plugin 分发 SKILL.md 包装三坑（新增）**：skillhub publish 要求目录含 SKILL.md，但 plugin 目录是 npm 包结构——① 临时目录组装发布物（frontmatter + package.json + src），用完即删不动仓库；② 发布限流（连续发布报「频率过高」，≥20s 间隔）；③ changelog 中文按字节截断炸 UTF-8（0xe5）——用码点感知工具。已写入 11-distribute 步骤二
- **阶段十一·步骤八 E409 staged 处理修正（更新）**：v1.3.9 记录称「24h 锁 + unpublish 清除」——v1.4.0 实测 skillopt E409 后**约 5 分钟自动 finalize**，无需 unpublish。处理顺序修正为：先等 5 分钟重查 dist-tags，仍未 finalize 再 unpublish。已更新 10-publish 步骤八
- **阶段十·步骤六 tag push 代理 502 连环（实录）**：`git push origin v1.4.0` 遭 exit 137 SIGKILL → 远端 404 本地有 tag；重试遭 CONNECT 502 → 最终 `gh api repos/O/R/git/refs -f ref=refs/tags/vX.Y.Z -f sha=<commit>` 直接创建远端 tag 成功（走 api.github.com 通道绕过 git CONNECT 隧道）。**gh api 创建 tag 是代理 502 下最可靠通道**，比 v1.3.9 的「剥代理直连」更稳（本机网络必须走代理时直连反而不通）
- **发布物落盘铁律（用户拍板）**：发布物（publish prompt / release note body）统一 `~/Desktop/`，禁止在 FORGE/ 或仓库内自建目录（FORGE/artifacts/ 已删）。已写入 09-confirm.md
- **步骤十二 网络恢复收尾（新增 · 发版复盘落地）**：①双 SHA 分叉检查（`git fetch` + `git status`）②lightweight tag 覆盖为 annotated（gh api 通道建的 tag 无 tag object，force push 覆盖）③桌面发布物清理——三件事打包进步骤十二，不再散落各处
- **警戒线声明收口单一 SSOT（更新 · 发版复盘落地）**：多处写死数值必然漂移（本次实锤：SOP 表 1660 / guides 1500 系 / checklist 维度 96 史前 2500，均落后 checklist 头部 1690）——收口为**checklist 头部唯一 SSOT**（门禁动态提取），04-review-system 与 guides 改引用不写死，维度 96 检查逻辑重写
- **npm publish 循环即时验证（更新 · 发版复盘落地）**：每包 publish 后立即 `npm view` 对账（3 次重试 ×15s）+ E409 自动 sleep 300 重查 + **publish 输出严禁接管道过滤**（本轮 skillopt E409 被 grep 过滤吞掉，13 包对账才发现漏发）——10-publish 步骤八循环重写
- **v1.4.0 发版耗时**：约 4h（08-24 14:00 阶段十启动 → 19:00 阶段十二完成）；CI lock 事故 1 次（4 工作流同根因红 → 单 commit 修复转绿）；release-gate 0 轮（v1.4.0 阶段五 fresh-eyes 4 轮已在过渡期完成，发版窗口内零审查轮）

**v1.4.1 发版后的自迭代记录**：

- **阶段十·CI 红先怀疑真 bug（实录 · CI Linux vs 本地 Mac 时序差）**：banner commit 只改 png 却触发 sandbox.test.ts 红（retry x1 仍挂）——根因是 `record()` 时间戳双源竞态（chainMac 内 ts() 取 T1 算 HMAC、事件对象再 ts() 取 T2 存储，verifyChain 用 T2 重放，跨毫秒边界链必断）。**CI Linux 慢机器高频命中、本地 Mac 快从未撞上 = 平台时序差不是 flaky 假象**。修复模式：单源取时后传参 + 确定性回归锁（mock `Date.prototype.toISOString` 每调用 +1ms 强走毫秒边界；mock 体必须 `realToISOString.call(new Date(fakeNow))` 防自递归）+ git stash 撤修复实测「旧代码必红/新代码必绿」验证锁有效。测试数同步 8 文档同 commit
- **阶段十·Git Data API 打 annotated tag 通道（新增）**：git 通道断时 tag 也能走 API——先 `gh api repos/O/R/git/tags`（type=tag + message + object 指目标 commit）建 tag object，再 `gh api repos/O/R/git/refs -f ref=refs/tags/vX.Y.Z -f sha=<tag-object-sha>` 建 ref 指向 tag object。**产出直接是 annotated**（`git for-each-ref` type=tag），与 v1.4.0 的 `-f sha=<commit>` lightweight 形态不同——后者才需步骤十二 force 覆盖。坑：本地补打 tag 想对齐时 message 中文两次乱码（输入法残留）→ 删本地 tag，远端 tag object 为权威源，网络恢复后 `git fetch origin tag vX.Y.Z` 同步即可
- **阶段十·npm staged finalize 时序（更新）**：脚本分层发布中 audit/mcp 手动 publish 报 403「already exists」+ registry 时间戳早于脚本尝试 26s——**不是他人发布，是自己 release.yml 自动 publish 已成功**（staged finalize 时序：registry 时间戳可早于后续尝试）。定性通道：`npm view <pkg> time` 时间戳 vs release workflow 触发时间对账，全包 dist-tags 对账为准
- **阶段十·tarball 内容验证路径坑（新增）**：抽验 orchestrator tarball 内修复代码必须查**正确的 dist 子路径**（`dist/sandbox/filesystem-backend.js` 而非 `dist/` 根）——查错路径 = 假阴性「修复没进包」
- **阶段十一·双层发版门禁盲区（本版最重教训 · 已三层根治）**：盲区一 bump-version.sh 2c 段通配 `*audit/package.json` 跳过逻辑误伤 `openclaw-plugins/sofagent-audit/package.json`（阶段六静默漏 bump）；盲区二 `openclaw.plugin.json` manifest 层从未被任何 bump 覆盖（4 款全停 1.4.0），ClawHub publish 报 manifest version drift 拒收。三层修复：补漏（5542cc2c）+ check-version 新增 9c 段双 manifest 检查（94→102）+ bump 脚本新增 2d 段扫 manifest。已写入 11-distribute 步骤二·a 前置
- **阶段十一·ClawHub publish 输出歧义判读（新增）**：输出「Fix: Align the plugin version...」是**自动修复提示非拒收**（首次发布已成功）；重试报「Version already exists」是已发布证据。定性唯一通道 = API `clawhub.ai/api/v1/packages/<name>?ownerHandle=` 查 latestVersion + scanStatus + verification.sourceCommit，勿据 CLI 输出盲改版本号。已写入 11-distribute
- **阶段十一·SkillHub 限流间隔实测（更新）**：sleep 20 偶发不足——daemon 款实测 20s 间隔仍被限流（「发布频率过高」），等 60s 补发成功。已更新 11-distribute 步骤二限流注释
- **阶段十二·步骤十二 annotated tag 辨析修正（更新）**：原表述「gh api 建的 tag 无 tag object 需 force 覆盖」只适用于 `-f sha=<commit>` lightweight 形态；v1.4.1 实战「先 git/tags 建 object 再 git/refs 建 ref」产出直接 annotated（`git for-each-ref` type=tag 验证），**可免覆盖**。判据：`git for-each-ref refs/tags --format="%(objecttype)"` 显示 tag = annotated 已合规，commit/blob 才需覆盖
- **v1.4.1 发版耗时**：约 3.5h（08-27 08:30 阶段十启动 → 12:00 阶段十二完成）；CI 红 1 次（sandbox 时间戳双源竞态真 bug——修复+回归锁+8 文档数字同 commit 37d393e4 转绿）；release-gate 0 轮（阶段五判断层 PASS 已在发版窗口前凌晨 07:41 完成，与 v1.4.0 同模式）；分发期补修双层 manifest 盲区 2 commit（de45a53e + 5542cc2c）

**v1.4.2 发版后的自迭代记录**：

- **阶段十·gitdata-push.mjs cat-file 固化（🔴 本版最重要 SOP 吸收）**：10-publish L466 早已写明「上传必须用 `git cat-file blob <本地sha>` 拿规范内容」，但脚本 L143 一直 `fs.readFileSync` 读工作区——ps1 eol 二坑（v1.3.8 首犯 + v1.4.2 再犯 11 文件分叉）根因即此。已修：mode 与内容同源自 `git ls-tree` 取、内容走 `git cat-file blob`（实测 cat-file 流 hash 恒等于 tree sha），HEAD 未跟踪才兜底读工作区。acceptance S344 锚点在位（cat-file/.gitattributes eol 规则/树对账输出三断言）
- **阶段十·cat-file 输出禁走 trim 通道（三坑收口 · 阶段十二狗粮实测）**：修完 cat-file 后首轮推送仍报 tree 不一致——13 个文本文件 blob sha 全部差 1 字节（末尾换行被剥）。根因：`sh()` 封装统一 `.trim()`，cat-file 输出经 trim 后末尾 `\n` 丢失。修复：cat-file 调用改 `execSync` 直取 Buffer 原始字节（零转码零 trim），二推 tree 逐字节一致验证通过。🔴 纪律：**二进制敏感/字节精确的 git 命令输出（cat-file / hash-object）禁止经过任何 trim/utf8 转码封装**——ps1 eol 三坑至此全收口（工作区读→cat-file、SOP 有脚本无→固化、trim 坑→Buffer 直取）
- **阶段十·CI 纯净环境 vs 本地狗粮分叉（新增）**：pr-check 红而本地全绿——本地 `npm install -g` 后 PATH 有 sofagent-audit（狗粮污染），CI 纯净环境无全局命令 + 测试 repoDir 无 dist → hook AUDIT_CMD 探测失败静默 exit 0 → 断言空输出失败。修测试不修产品：照同文件 H-01 describe 先例补迷你 dist fixture。纪律：hook 对账类测试自带 dist fixture；本地复跑剥净 PATH（`PATH="/usr/bin:/bin:$(dirname $(which node))"`）模拟 CI。已写入 checklist #126 子项 d + fresh-eyes 发版期校准
- **阶段十二·daemon 真假日志辨析（新增）**：`~/.sofagent/daemon.log` 是测试进程写入的残留旧文件（监控目录全是 /tmp/sofagent-*），launchd 真实 daemon 日志在 plist `StandardOutPath` 指向的 `~/.sofagent/data/daemon-launchd.log`——重载验证须查后者（本次真日志确认 v1.4.2 横幅）。`~/.sofagent/VERSION` 1.4.0 系旧装机残留不随 daemon 更新。步骤十一验证命令已按此修正
- **阶段十二·双 SHA rebase 对齐悬置登记（流程新增）**：github.com 443 断而 api.github.com 通的网络半瘫状态下，阶段十二收尾 commit 照走 Git Data API（顺手狗粮 cat-file 修复）；rebase 对齐（`git fetch origin && git rebase --onto origin/main <本地等价点> main`）悬置并登记下版阶段一收尾——网络恢复判据：`curl -s -o /dev/null -w %{http_code} https://github.com` 返回 200/301
- **阶段十·Git Data API 连续推送三通道纪律（实录）**：①430 blobs 级大批量推送须 `run_in_background` 后台跑（前台超时 SIGKILL 137）；②连续 API 推送后本地 origin/main 必陈旧，脚本已内置 gh api 实时 ref 查询（勿信本地 ref）；③tree 对账验收用远端 recursive tree API vs 本地 `git ls-tree -r HEAD` 双向对齐（python 解析 ls-tree 时 sha 是 `parts[2]` 非 `parts[1]`——踩过）
- **v1.4.2 发版耗时**：约 4h（08-28 晚 22:52 放行 → 08-29 00:5x 阶段十二完成）；网络故障贯穿（git push 502 代理死 → Git Data API 三推 + ps1 eol 11 文件重传）；CI 红 1 次（B8 狗粮假绿纯净真红——补 fixture 转绿）；release-gate 0 轮（判断层 PASS 已在发版窗口前完成，连续第三版同模式）

**v1.4.3 发版后的自迭代记录**：

- **阶段十·本地部署树 overrides 三红（🔴 本版最重事故 · 已三层固化）**：45517d77 用 `~/.local/share/dsh-deployed`（pnpm deploy 产物）+ 72 条绝对路径 overrides 接 DSH 0.1.2-alpha.1——本地 node_modules symlink 在位全绿，开源 CI `npm ci` 恢复 symlink 指向不存在路径 → TS2307 三红。修复切 npm alpha.3（8c8517b5）。**npm 机制实测**：包不在依赖树时 overrides 惰性不匹配不报警（cordis 系 6 条死配置现状），包一旦进依赖立即生效——残留本地路径 overrides 属地雷应清。三层固化：checklist #122④（lock 零 dsh-deployed 断言）/ acceptance S361（dsh 六包 registry 解析抽查）/ calibration 发版踩坑两条
- **阶段十·publish 对账重查放宽（SOP 修正）**：3 次 × 15s 实测不够（orchestrator/think 均触发假报「对账失败」，publish 日志「+ pkg@ver」已入队只是传播慢）——改 6 次 × 30s；E409 staged 等 5 分钟自动 finalize 在 orchestrator/think 双包复证成立，10-publish E409 段标注 v1.4.3 复证
- **阶段十·bootstrap sha256 随版自洽纪律（新增）**：哈希从新 tag `git show vX.Y.Z:install.sh | shasum -a 256` 计算 → 回填 bootstrap.sh → **重打 tag**（delete + re-tag + force push）让哈希入 tag——否则 tag 内 bootstrap.sh 持旧哈希不自洽（check-version 红项）。10-publish sha256 段补时序陷阱注
- **阶段十二·acceptance 场景脚本 set -e 坑（checklist 铁律自身实证）**：新增 S361 首跑即被 `S361_DSH=$(grep -c ...)` 杀脚本——grep -c 零命中 exit 1 经命令替换继承触发 set -e。checklist 头部「set -e + $(cmd)=静默杀手」铁律的防复发实证：写维度脚本前照铁律加 `|| true`，6fd32d4d 修复
- **阶段十二·数字对账场景抓真漂移**：S176 抓到 docs/DEVELOPMENT.md 场景数 293 未随 S361 更新（连带发现 96 维→实际 98 维同样滞后）——数字对账类场景的价值实证：改头部 SSOT 数字时全仓对账场景自动暴露所有未同步点
- **v1.4.3 发版耗时**：约 3.5h（08-31 16:40 三拍板放行 → 09-01 00:1x 阶段十二过半）；CI 红 1 次（本地部署树 overrides——切 npm alpha.3 转绿）；release-gate 0 轮（run-07 verdict=GO 有条件放行，三项硬性前置发版前闭环，连续第四版同模式）；npm publish 网络中断 2 次（E409 staged 等待自愈 ×2）
- **阶段十二·步骤十一 daemon exit 78 根因 = plist node 路径失效（新增 · 排障实录）**：kickstart 后仍 exit 78 EX_CONFIG 崩溃循环，手动跑 CLI 完全正常（v1.4.3 横幅 + health ok）——根因是 plist `ProgramArguments` 写死的 node 绝对路径 `versions/22.22.2/bin/node` 已不存在（runtime 目录清理后实际为 `22.22.2-2`），launchd spawn 不出进程即报 EX_CONFIG。**排障链：launchctl print 看 last exit code → 手动前台跑 CLI 排除代码问题 → 查 plist 路径存在性**。修复：备份 plist → sed 改路径 → `bootout` + `bootstrap` 重载（kickstart 不重读 plist）→ 日志 v1.4.3 横幅确认。⚠️ plist 内嵌绝对路径属环境硬编码，runtime 目录升级/清理后必断——重载验证失败先查路径存在性，勿先怀疑 daemon 代码
- **阶段十二·步骤十三置顶位可 API 核查（口径修正）**：「置顶无 API 只能网页操作」只对**变更**成立（Mutation 确无 pinDiscussion）——**只读核查**走 GraphQL `pinnedDiscussions { discussion { number title } }` 即可（v1.4.3 实测：置顶位仅常青帖 #11、版本帖未误置顶，网页都不用开）。步骤十三从「必做网页动作」降级为「查询确认，异常才需网页干预」

**v1.4.4 收敛扫描批自迭代记录**（发版窗口期补扫，非发版复盘）：

- **SOP 文件拆分/改名时全仓回扫旧引用（新增纪律）**：releasing SOP 拆分（原 10-publish.md 拆为 09-publish.md + 10-distribute.md）时只改活文档未扫历史 changelog——v1.4.2/v1.4.3 Release Notes 段的 `10-publish.md` 链接死链拖了 4 个版本无人发现（b00fe556 修复）。**防御：SOP 文件改名/拆分/移动时，必跑 `grep -rn "<旧文件名>" docs/ README.md` 回扫全仓引用；历史 changelog 内的活链接一并随迁，纯考古叙述（「已写入 10-publish」类）不动**。同时进检查维度二「阶段间引用无断裂」的修法列
- **对账先跑门禁，不拿记忆当 SSOT**：收敛扫描中曾据记忆判「README 3744 测试」为漂移（记忆里 SSOT=3619）——实跑 check-test-count 后反转：3744 = v1.4.4 真值（3619 引擎 + 125 插件），门禁 11/11 绿。**防御：任何数字对账前先实跑对应门禁脚本拿当前真值；多源口径冲突时列各源原值请裁定，禁止拿历史数字当现值**

**v1.4.4 发版后的自迭代记录**：

- **阶段九·sha256 预计算免重打（新增优选路径）**：「tag 后算哈希→回填→重打 tag」两次往返可免——预计算 HEAD 哈希与 URL bump 同 commit，tag 一次打自洽；lib 零改动时 6 哈希沿用（`git diff <上tag>..HEAD --stat -- engine/scripts/lib/` 空）。已写入 09-publish sha256 段 + checklist #130 ①
- **阶段九·网络半瘫双通道实战（实录）**：github.com 443 断而 api.github.com 通——main 推送走 gitdata-push.mjs（tree 逐字节一致验收）、tag 走 gh api 建 annotated tag object（`git for-each-ref` type=tag 免覆盖）+ ref；网络恢复后 `git fetch` + rebase --onto 干净接回 + 本地 tag 删重指。v1.4.1/v1.4.2 两次实战的通道组合第三次验证
- **阶段九·release note 工序三抓段落顺序（实录）**：草稿「质量验证」与「破坏性变更」顺序颠倒——规范钉死核心变更→质量验证→破坏性变更→深入了解，v1.4.3 实际发布物为同构参照（v1.4.2 锚点自身缺质量表，锚点偏差不追随、以 SOP 规范优先）。三道工序再次实证价值
- **阶段九·同文件多 Edit 并行竞态（🔴 工具纪律）**：同一文件 5 处 Edit 并行调用，仅 2 处落盘——读写竞态实锤。**同文件多处编辑必须串行执行**。已回写 calibration + checklist #130 ④
- **阶段九·npm 传播延迟判读（更新）**：skillopt 第 6 次 30s 重查仍未到——按「publish 日志 `+ @sofagent/X@ver` 已入队即信」纪律不判失败，等 120s 复查到位。6×30s 循环若尽须人工续等而非报错中断（本轮 think/ab-test 被误中断一次）
- **阶段十·Marketplace 勾选自动延续（新增核查命令）**：v1.4.2 起每版勾选后 listing 关联保持——curl 版本页含本版号即免网页操作。已写入 10-distribute 步骤二·b
- **阶段十·ClawHub verify 快照纪律（新增）**：`security.status_not_clean` 可能是历史版本遗留既有状态（1.4.3 时代已存在）——发布前落盘快照、发布后对照，新引入 reasons 才处置。plugin API latestVersion 首查未到勿急判（与 npm 同款传播延迟，复查一次）。已写入 10-distribute + calibration
- **阶段十一·checklist 归并对销实操（实录）**：1800 警戒线余量 2 行，新增 #130 前先真实归并 #121 入 #124（插件目录锚已由 S331 锁、cost_query 已由 S347/S348 锁，dashboard worklog 弱锚收 124 子项 k）——净增 0 行 1800 压线过 CRS。**警戒线内新增 = 先找已被 acceptance/门禁双重覆盖的旧维度归并**
