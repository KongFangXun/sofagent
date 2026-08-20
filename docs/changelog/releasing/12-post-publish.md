# 阶段十二：发布后

---

## 步骤

> 🔴 **执行时逐格勾选本表「完成」列**（v1.3.6 教训：步骤八「对话讲解」曾被漏做仍继续推进——非命令行动作没有勾选就无防漏）。全部勾完本阶段才算闭环。

| # | 完成 | 步骤 | 产物 |
|:--:|:--:|------|------|
| 一 | [x] | **发布后验证**（见下方脚本） | 全绿 |
| 二 | [x] | CI 全绿检查 | CI 全绿 |
| 三 | [x] | **审查三文档回写**：发版过程（阶段六~十一）暴露的新问题回写到 regression-checklist（新维度）/ fresh-eyes-review（新教训）/ acceptance-test（新场景）。与阶段五分工：阶段五管代码质量（发版前可见），本步骤管发版流程（发版中才暴露——如 CI 失败模式、publish 限制、日期硬编码等） | 三文档更新 |
| 四 | [x] | SOP 漏洞吸收：本次迭代暴露的 releasing.md 流程问题直接吸收进对应阶段 | SOP 更新 |
| 五 | [x] | SOP 数字核对：维度数、检查项数等是否过期 | 数字一致 |
| 六 | [x] | 生成「下一版本开发 Prompt」到桌面：综合 ROADMAP + CHANGELOG + 下一版本 changelog | `~/Desktop/vX.Y-dev-prompt.md` |
| 七 | [x] | **开发 Prompt 校验循环**（详见下方——脚本 + checklist 五条自查两步都要过） | prompt 定稿 |
| 八 | [x] | **下版本内容对话讲解**（详见下方——三问讲完 + 负责人确认优先级，缺任一不算完） | 项目负责人理解下版本方向 |
| 九 | [x] | **进度追踪清零**：把 `releasing.md` 进度追踪的 12 个 `[x]` 全部改回 `[ ]`，为下一版本新周期做准备 | 进度追踪重置 |
| 十 | [x] | **releasing 自迭代**（sop 审查自己）：对照本次发版的实际执行体验，检查 12 个阶段文件是否有过时/缺漏/顺序不合理的地方，直接修正。这是 releasing.md 的「Dream Cycle」——每次发版后用它自己的经验喂养它自己 | releasing.md 更新 |
| 十一 | [x] | **本机 daemon 重载（dogfooding 保活 · 2026-08-18 新增）**：发版后本机守护进程要吃上新代码。launchd 配置 `~/Library/LaunchAgents/local.sofagent-daemon.plist` 指向仓库 dist（非全局 npm 包），一条命令重载：`launchctl kickstart -k gui/$(id -u)/local.sofagent-daemon`，随后 `tail -3 ~/.sofagent/data/daemon-launchd.log` 确认版本号 = 刚发的版本。开机自启已由 plist 的 RunAtLoad+KeepAlive 保证，无需每次处理 | daemon 跑新版 |

---

## 发布后验证脚本（步骤一）

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
bash tools/check-version.sh        # 期望全绿
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

## 开发 Prompt 校验循环（步骤七）

```
① 跑 ./tools/check-dev-prompt.sh ~/Desktop/vX.Y-dev-prompt.md（查"引用的东西存不存在"）
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

> 本版本发版流程全部完成后，最后一步——把 `releasing.md` 进度追踪的 12 个 `[x]` 全部改回 `[ ]`，为下一版本新周期做准备。

**为什么要清零**：进度追踪是"当前版本走到哪了"的实时状态。如果不清零，下版本新 session 打开 releasing.md 会看到 12 个全 [x]，误以为"已完成"而不知道该从哪开始。清零后第一个 `[ ]`（阶段一）就是下版本的起点。

**操作**：
```bash
# 把 releasing.md 进度追踪的 [x] 全部改回 [ ]
sed -i '' 's/- \[x\]/- [ ]/g' docs/changelog/releasing.md
```

**清零后确认**：进度追踪 12 行全部 `[ ]`，下一版本从阶段一重新开始。

---

## releasing 自迭代（步骤十）

> releasing.md 是活文档——每次发版的实际执行体验是最值钱的反馈。步骤十 是 releasing.md 的「Dream Cycle」：用它自己的经验喂养它自己，持续修正过时/缺漏/顺序不合理的地方。

**检查维度**（每次发版后逐一过）：

| # | 检查项 | 怎么查 | 修法 |
|:--:|--------|--------|------|
| 一 | **阶段顺序与实际流程一致** | 对比本次实际执行的步骤顺序 vs 阶段文件写的顺序 | 不一致 → 更新阶段文件（以实际为准） |
| 二 | **阶段间引用无断裂** | grep "阶段 X" 确认引用的阶段号/文件名都存在 | 断裂 → 修正引用 |
| 三 | **配套文档链接有效** | releasing.md 底部 3 个配套文档链接可访问 | 失效 → 更新路径 |
| 四 | **本次发版暴露的 SOP 缺口** | 回顾发版过程中「SOP 没写但我踩了坑」的环节 | 缺口 → 吸收进对应阶段 |
| 五 | **冗余/过时步骤** | 有没有阶段写了但实际从不执行（或已被工具覆盖）的步骤 | 删除或标注「工具已覆盖」 |
| 六 | **ROADMAP 体检** | 按 [08-roadmap-sync.md](./08-roadmap-sync.md) 的「体检清单」7 项扫一遍（重复表/散落章节/死链/已交付混入/范围过期/模糊版本号/U+FFFD） | 逐项修复 |

> 📋 **发版 commit 规范（防 git log 噪音）**：发版过程中阶段一~十二的进度打勾（`releasing.md` 进度追踪 `[x]`）会产生大量「元工作 commit」。**这些打勾类 commit 应 squash 为单个 `docs(releasing): vX.Y.Z 发版流程完成`**，不要每个阶段一个 commit——否则 git log 充斥 `docs(releasing): 阶段X打勾` 噪音，外部贡献者看 commit 历史会以为项目没有产品迭代。实际产品改动（代码 fix/feat、文档内容修改）照常各自独立 commit，只有「纯进度打勾」类元工作 commit 才 squash。

**v1.3.2 发版后的自迭代记录**（示例，每次发版后追加一条）：

- **步骤三 新增**（审查三文档回写）：阶段五管代码质量，本步骤管发版流程——v1.3.2 阶段十一~十二暴露的 3 个问题（日期硬编码/警戒线多处同步/npm workspace 限制）进了 regression-checklist 95-97
- **阶段十一策略统一**：从 npm 先行改为 tag 先行（push main → 等 CI → tag → release auto-publish → 手动 publish 10 包）——v1.3.2 实际验证，tag 一定指向 CI 全绿 commit 更安全

**v1.3.3 发版后的自迭代记录**：

- **阶段九新增 LIMIT 检查**：check-docs.sh LIMIT_B 超标（8437 > 8400）在 CI 才暴露——本地 WorkBuddy 环境跑 check-docs.sh 超时（锚点段 node 逐行调慢），CI 上才能跑完。已补 regression-checklist 维度 101（LIMIT 超标提前检查）。建议阶段九加一步"CI 模拟只跑 B 层行数检查（不跑锚点段避免超时）"
- **阶段十一 git proxy 对齐**：WorkBuddy 环境的代理端口会变（54621→53957），git global config 里的旧端口导致 push 失败。阶段十一加一步"push 前确认 git proxy 端口与环境变量一致"
- **阶段十一 gh API 推 tag**：git push tag 遇代理 502 时，用 `gh api` 创建 tag object + ref 绕过（走 api.github.com 通道）。已验证可行，加入阶段十一网络降级策略
- **阶段六 release-gate driver 两个 bug**：① verdict 误判 PASS（status.json 标 PASS 但 results 全 FAIL）② changelogPath 路径偏差（指向 `docs/changelog/1.3.3.md` 而非 `v1.3/v1.3.3.md`）。driver bug 未修但不影响发版判定（verdict.md 为准）——FORGE 工程债

**v1.3.4 发版后的自迭代记录**：

- **阶段六 verdict 读取规则**：driver 在 verdict.md 尾部追加的「FAIL→PASS 修复收敛」段不可信——run-01 中 f-fix 报错没改任何代码，尾部照样写 PASS。阶段六模板加判定规则：verdict 以主体 `IS_PASS:` 行为准 + f-fix 有 git diff 才算修复收敛（stepErrors 非空 = 本轮作废）。已回写 regression-checklist 维度（臆造链家族）与 fresh-eyes-review 教训
- **阶段九 hook 测试用例合格性**：SOP 自带的测试用例 message（"test"/"add app"）太短被 A5+A19 正确拦截——测试用例自己不合格导致假失败。已修 09-tool-health.md（合格 message + `git add -f` 说明），并回写 checklist 维度 108 防 SOP 再漂移
- **阶段十一 pre-push 环境降级**：check-docs 第 11 项锚点扫描（bash 逐行）在 WorkBuddy shim 环境必然超时——与 check-anchors.mjs 功能重复。已加 `SKIP_ANCHOR_SCAN=1` 降级开关（CI 跑完整版）；WorkBuddy 环境跑 pre-push 应带此变量（4m43s vs 13min+）。回写 checklist 维度 109
- **阶段十一 Git Data API 收尾通道实战**：发布完成后网络彻底断（github.com 443 不通），最后的打勾 commit 走 blobs→trees→commits→refs PATCH 完成。新增后续动作：**网络恢复后必须 `git pull --rebase` 对齐本地远端 SHA**（API commit 与本地 commit 同内容不同 SHA，git 会识别 cherry-pick 重复自动消化）
- **阶段十二 stash 清理纳入发版收尾**：本轮发版过程发现 4 个历史 stash 残留——逐段甄别后 3 段有价值内容恢复进对应 changelog、其余确认覆盖后清理。原则：stash 是隐形技术债，发版收尾时顺手清（stash list 非空即处理）
- **阶段三 + 阶段十一加 check-test-count 门禁**：v1.3.4 周期内 bugfix（+31 测试 → 8 处漂移）+ dev（+93 → 11 处）+ dsh（+11 → 7 处）**三次犯同类错误**——新增测试后文档声称数（README/WIKI/LIMITATIONS/ARCHITECTURE）未同步。根因：check-test-count.sh 只在 tag 前（阶段十一步骤四）跑一次，开发过程中没人跑。修复：① 阶段三（自测）加步骤四——`check-test-count.sh --quiet` 作为开发完成后的强制门禁；② 阶段十一（发布）步骤二 显式列 check-test-count 与 check-docs.sh 并列。**原则：新增/删除测试 = 必须同步文档声称数，check-test-count 不绿不算开发完成**

**v1.3.7 发版后的自迭代记录**：

- **步骤编号铁律（用户拍板）**：所有步骤编号一律中文序号（一、二、三……），禁止阿拉伯数字、小数点、字母后缀——「4b」类编号是反面案例。已全量清理 12 个阶段文件（38 处引用 + 12 个表格行号），并写入项目铁律
- **release note 三道工序**：v1.3.0~1.3.6 每次发布后都发现问题再改——本次新增「生成→自检（质量表恰 7 项/H2 骨架同构/七项逐字/尾链）→上一版结构对照」工序，v1.3.7 一次到位零修改
- **CI 全绿硬前置**：push 后轮询到全绿（60s 循环）才允许打 tag——原 sleep 30 单次查看可被跳过。实测 shellcheck runner apt stall（16 分钟挂 Install ShellCheck）→ `gh run rerun` 解决；空 commit 不触发 paths 过滤的 workflow，重触发用 rerun 而非空 commit
- **check-version TS 文件头溯源标记误报（CI 红实录）**：文件头注释版本号是功能溯源标记（`v1.1.9 新增`）非当前版本锚点，历史 check 误判为「漏 bump」。判据改为「找 = SSOT 版本号」：有锚点通过、纯溯源跳过；bump 同步豁免（防误伤）。已回写 checklist 维度 116
- **push 连接三连失败实录**：git config 死代理 → 直连 443 超时/HTTP2 framing → HTTP/1.1 + 慢速兜底解决。经验：curl 能通 ≠ git 能通。已写入 11-publish 网络降级策略
- **daemon CI 模拟姿势对齐**：SOFAGENT_HOME=/tmp 会触发 data-paths 越界守卫回退——模拟脚本与 daemon-macos-ci.yml 对齐（仓库内 .sofagent + daemon.sh + sleep 35）
- **v1.3.7 发版耗时**：开发完成（08-18 14:00 前后）→ 发布（08-19 13:40）约 24h（含隔夜）；release-gate 2 轮 FAIL 均检查器侧债（dim106 SSOT/dim116 awk 转义），手工裁决 PASS

**v1.3.8 发版后的自迭代记录**：

- **阶段六·仓库冻结纪律（新增）**：run-03 运行窗口（31.5 分钟）HEAD 被改 8 次 → 三 worker 崩溃/OOM。判断层运行期间仓库必须冻结（含脚本层直跑）——已写入 06-release-gate.md「运行期间仓库冻结纪律」小节 + 判 FAIL 分诊方法（先查运行窗口 HEAD 变动）
- **阶段六·judgment-only 注入机制（更新）**：run-06（缺 acceptance 输入 FAIL）+ run-10（占位无实证）两次踩坑 → driver 修复为「启动时注入脚本层预跑日志（仓库根 acceptance-raw.log / SOFAGENT_ACCEPTANCE_LOG）+ 无日志主动实测」。**SOP 侧根因：prompt 模板写 /tmp/acceptance-raw.log 但 driver 找仓库根——路径不一致**。已修 06 prompt 模板 + 更新旧描述
- **阶段六·precheck 紧凑格式（更新）**：run-10 的 59/91 维截断根因是 indent=2 JSON 格式化结构开销 637 行 + sf_read 引擎层 500 行上限（v1.3.6 修 FORGE 预算表 800 是修错层）——driver 已改紧凑格式单行写盘。认知：sf_read 是行数限制非字符限制，单行大文件整行返回
- **阶段九·bump dry-run 先 commit（新增）**：v1.3.8 阶段九误把未提交的阶段八改动当 dry-run 污染，git checkout -- . 整批误撤。已写入 09-tool-health.md 步骤三：先 commit 再跑 dry-run
- **阶段十一·Git Data API 四坑（更新）**：原三坑（base64/eol/cat-file）补第四坑——tree 条目 mode 硬编码 100644 丢全部 .sh 执行位（verify CI 失败），恢复靠「blob 内容寻址引用既有 blob 建新 tree」；另 create-tree 无法表达删除/rename 残留，须 Contents API 补删。验收唯一标准：远端 tree sha == 本地 HEAD tree
- **阶段八·Release Notes 锚点对照（更新）**：SOP 08 曾误写「简洁三段式」但 v1.3.0/1.3.1/1.3.7 实际发布均为「分节式 + 质量验证表」——v1.3.8 两次被作者退回（漏质量验证表 + 漏标题主题短语）。SOP 08 重写为 v1.3.7 锚点 + 铁律 N1-N8 + SOP 11 工序 3 机制标准 = v1.3.7 实际发布物；10-confirm 补防漂移铁律（发布 prompt 的 gh release 段必须逐字引用 SOP 11 模板）
- **步骤编号铁律复查**：11-publish.md「### 5.0」标题 + 工序 1/2/3 + 代码块 2a-2d 三处残留修复为中文序号/①②③④；全仓复查零残留
- **check-dev-prompt.sh 三缺陷修复（工具）**：① bash/node 命令前缀未剥离 → `bash tools/check-version.sh` 误报 ❌ ② is_runtime 定义未接线 → worklog.json 误报 ❌ ③ planned 只看同行关键词 → tools/ 分目录目标路径误报 ❌。修复后 v1.3.9 prompt 校验 0 错误
- **v1.3.8 发版耗时**：约 6h（08-20 10:00 开发完成 → 16:00 发布）；release-gate 4 轮（3 轮 driver 管线问题 + 1 轮环境，driver 修复后 run-13 单轮直过）
