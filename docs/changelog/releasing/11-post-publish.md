<!-- SOP-ANCHOR: S11 | file: 11-post-publish.md | prev: S10 | next: （S1 新周期） -->
<!-- 机器锚（模型检索用，人不影响阅读）：grep "SOP-ANCHOR:" 可一跳取全部阶段元信息；本阶段完成后 → （S1 新周期） -->
# 阶段十一：发布后

---

## 步骤

> 🔴 **执行时逐格勾选本表「完成」列**（非命令行动作没有勾选就无防漏——曾出现步骤漏做仍继续推进的漂移）。全部勾完本阶段才算闭环。
>
> 🔴 **开工第一动作 = 通读本表并建勾选意识**：本阶段 15 步横跨验证/回写/生成/讲解/运维多类动作，只按「回写状态行」一类理解会漏掉 dev prompt/daemon 重载/置顶核查等大半步骤（曾整批漏做靠作者质询才发现）。每完成一格当场把「完成」列改 [x]——漏勾一格 = 该步骤大概率没做。

| # | 完成 | 步骤 | 产物 |
|:--:|:--:|------|------|
| 一 | [ ] | **发布后验证**（见下方脚本）——含**文档头发版状态翻转**（活文档头「待发版」语义族→「已发版」+ 当前版本开发日志头「⏳ 待发版」→「✅ 已发版」+ 翻转后**双零残留复核**，翻转后 `check-version` F6 全绿才过关） | 全绿 |
| 二 | [ ] | CI 全绿检查 | CI 全绿 |
| — | [ ] | **Release Notes 范本快照更新**：本版 gh release 发布后，把 body 的实际结构（H2 骨架/新要素）回写 [06](./06-doc-finalize.md)「Release Notes」范本段的「已知结构基线」行——上一版实际发布物是下一版生成的结构 SSOT，发版后不回写 = 下一版按旧结构生成（漂移链条的根因闭环点） | 06 范本段基线行与本版 body 一致 |
| 三 | [ ] | **审查三文档回写** | 三文档更新 |

#### 三 · 审查三文档回写

发版过程（阶段五~十）暴露的新问题回写到 regression-checklist（新维度）/ fresh-eyes-review（新教训）/ acceptance-test（新场景）。与阶段四分工：阶段四管代码质量（发版前可见），本步骤管发版流程（发版中才暴露——如 CI 失败模式、publish 限制、日期硬编码等）。
⚠️ **改了 acceptance 场景数后立即跑 `bash tools/check/check-test-count.sh --scenarios-only`**（秒级轻量守卫——场景数改后立即拦截 DEVELOPMENT/LIMITATIONS 漂移，勿拖到 pre-push 才暴露） 

| # | 完成 | 步骤 | 验证方式 |
|:--:|:--:|------|------|
| 四 | [ ] | SOP 漏洞吸收：本次迭代暴露的 releasing.md 流程问题直接吸收进对应阶段 | SOP 更新 |
| 五 | [ ] | SOP 数字核对：维度数、检查项数等是否过期 | 数字一致 |
| 六 | [ ] | 生成「下一版本开发 Prompt」到桌面：综合 ROADMAP + CHANGELOG + 下一版本 changelog | `~/Desktop/vX.Y-dev-prompt.md` |
| 七 | [ ] | **开发 Prompt 校验循环**（详见下方——脚本 + checklist 八条自查两步都要过；minor 版含 breaking 时第 7 条「大版本深检六项」必跑） | prompt 定稿 |
| 八 | [ ] | **下版本内容对话讲解**（三问讲稿已出；作者以「把阶段 11 全部走完」确认——未提范围增减/优先级调整 = 本版 8 章范围与顺序维持；见下「步骤八留痕」） | 项目负责人理解下版本方向 |
| 九 | [ ] | **进度追踪清零**：把 `releasing.md` 进度追踪的 11 个 `[x]` 全部改回 `[ ]`，并同步清零本文件内部步骤表勾选（见下方步骤九说明），为下一版本新周期做准备 | 进度追踪重置 |
| 十 | [ ] | **releasing 自迭代**（sop 审查自己）：对照本次发版的实际执行体验，检查 11 个阶段文件是否有过时/缺漏/顺序不合理的地方，直接修正。这是 releasing.md 的「Dream Cycle」——每次发版后用它自己的经验喂养它自己 | releasing.md 更新 + `check-table-shape` EXIT=0 |
| 十二 | [ ] | **网络恢复收尾** | 远端/桌面双干净 |

#### 十一 · 本机 daemon 重载

发版后本机守护进程要吃上新代码。launchd 配置 `~/Library/LaunchAgents/local.sofagent-daemon.plist` 指向仓库 dist（非全局 npm 包）。⚠️ **前置：确认 plist 指向的仓库已同步到本版**——daemon 跑的 dist 来自 plist `WorkingDirectory` 指向的那个仓库，而发版常在 **worktree** 里进行（worktree 与主仓是两个工作副本）。
若 daemon 指向主仓而主仓未 pull，`kickstart` 后日志版本号仍是上一版——**版本核对会当场揭穿，勿据「state = running」判成功**。同步主仓（`git pull` + `npm install` + `npm run build`）属对另一个工作副本的写操作：有并发 session 在其中作业时**停手报告**，交作者决定，勿自行 pull。

#### 十二 · 网络恢复收尾

发版全程若用过降级通道（gh api tag / Git Data API push / 剥代理直连），网络恢复后必须做三件事：① `git fetch origin && git status` 确认本地/远端无分叉（有分叉按 [troubleshooting.md](./troubleshooting.md) 的分叉接回处置处理）；
② lightweight tag 覆盖为 annotated——`git tag -f -a vX.Y.Z -m "vX.Y.Z · {一句话}" <commit> && git push origin vX.Y.Z --force`（gh api 直建 ref 的 lightweight tag 无 tag object，`git for-each-ref refs/tags` 显示 type blob/commit 即 lightweight；经 git/tags 建 object 再建 ref 的通道产出直接是 annotated，免覆盖）；
③ 桌面发布物清理——本版产生的 prompt/body 草稿（`vX.Y.Z-*.md` / `release-note-*.md`）归档或删除，只保留下一版 dev prompt（发布物落盘铁律：统一 `~/Desktop/`，禁仓库内）
> ⚠️ **发布物不得「放着不管」**：桌面可能被外部清理（实测：本版发布物在发版窗口内被清空，只剩无关文件）⇒ 发布物落盘后应**尽快消费**（步骤七 `gh release` 即用完），本步骤要么**归档进仓内 `docs/archive/`**、要么**显式删除**并在此登记；不登记 = 下轮无从判断「是清理了还是丢了」。
 

| # | 完成 | 步骤 | 验证方式 |
|:--:|:--:|------|------|
| 十三 | [ ] | **Discussions 置顶轮换** | 置顶位干净 |
| 十四 | | **hook 生效确认** | 两版本号一致 |

#### 十三 · Discussions 置顶轮换

新版 release 帖（Announcements 自动生成）**不置顶**——版本帖是流水内容，置顶位只留给常青帖。🔴 置顶**变更**无 API（GitHub GraphQL Mutation 只有 pinIssue 系，无 pinDiscussion），只能网页操作（右侧齿轮 → Unpin/Pin）；**只读核查**走 GraphQL `pinnedDiscussions { discussion { number title } }` 即可，无需开网页，异常才需网页干预


#### 十四 · hook 生效确认

本机 `.git/hooks/commit-msg` 头部版本号 == `engine/audit/hooks/commit-msg` 头部版本号（hook 是拷贝非软链，git pull 不随同步——发版窗口改过 hook 的版本，本机与其他仓库都是旧拷贝）。不一致 → `sofagent-audit --install-hook` 重装后复验（install.sh Step 6.5 的版本对账提示同源）<br>⚠️ `--init` **不会覆盖已存在的 hook**（保护性跳过）⇒ 版本不符时须**先备份并删除**
`.git/hooks/{commit-msg,pre-commit,post-commit}` 再跑 `--init`，否则该步永远修不好（实测：跑完 hook 版本仍未更新） 


#### 十五 · 核心文档内容时效巡检

🔴 版本号对账已由 `check-version` **全项**机器化覆盖，但「文档说的能力/状态是否还是真的」缺专门步骤——发版后审查发现的已知问题须进 LIMITATIONS 如实披露，而非只留在 devlog）。三项：① **LIMITATIONS 已知问题披露**——发版期发现且未随版修复的用户可感知限制（安装入口断链 / 分发渠道异常标记 / 平台兼容缺口）逐条入册，注明「哪个版本修复」；② **WIKI「当前状态」节刷新**——当前版本 / 下一版描述 / 测试数 / 规则数对齐 ROADMAP 与 devlog 实况；
③ **CHANGELOG 索引行复核**——本版条目的能力摘要与 devlog 交付一致（索引是外部用户第一入口，摘要漂移 = 对外失真）。巡检发现的漂移当场修，同批 commit。**④ 发版即移出双清单**：a) ROADMAP——本版行自「版本规划」表移入「迭代历程」表（提炼一句话行 + changelog 链接；规划表只留未发版）；
b) `tools/check/check-forms.mjs`——本版自 VERSION_SOURCES/EXPECTED_COUNTS/形态白名单三处移出（该守卫只扫未发版版本，已发版回填对账无意义且假红） | LIMITATIONS/WIKI/CHANGELOG 三处时效一致 + ROADMAP/check-forms 双移出
a) ROADMAP——本版行自「版本规划」表移入「迭代历程」表（提炼一句话行 + changelog 链接；规划表只留未发版）；b) `tools/check/check-forms.mjs`——本版自 VERSION_SOURCES/EXPECTED_COUNTS/形态白名单三处移出（该守卫只扫未发版版本，已发版回填对账无意义且假红） 


> 🔴 **步骤十一「本机 daemon 重载」补充①——主仓被并发长跑分支占用时的替代通道**：主仓本地领先/落后远端几十 commit（长跑分支态）时 pull 即 merge，不可行——此时**把 plist 指向交付 worktree**（发版 worktree 就是本版完整源码，dist 已 build，七依赖链全本版）：改 `ProgramArguments` 的 cli.js 路径与 `WorkingDirectory` 两处 → `bootout`+`bootstrap`（改路径 kickstart 不重读 plist）→ 日志核版本号。
>前置自检：① `node engine/daemon/dist/cli.js --version` = 本版（worktree 可跑性）② `doctor` 数据面兼容（读同一 `~/.sofagent/`）③ plist node 路径存在性（runtime 目录清理后失效 → exit 78 崩溃循环）。主仓回归常轨后改回主仓路径（回滚备份 `.bak-<旧版>` 随切随留）。**勿把「主仓是唯一 dist 来源」当默认**——那是本步骤的原始过窄假设，已被并发场景证伪。
>
> ⚠️ **步骤十一补充②——重载前先预检 plist node 路径存在性**（`ls "$(grep -o '/[^<]*bin/node' ~/Library/LaunchAgents/local.sofagent-daemon.plist | head -1)"`——plist 写死的绝对路径在 runtime 目录升级/清理后即失效 → exit 78 EX_CONFIG 崩溃循环；手动跑 CLI 正常即证明是路径问题。改路径须 `bootout`+`bootstrap` 重载，kickstart 不重读 plist）。
>⚠️ **真假日志辨析**：launchd 真实日志在 plist `StandardOutPath` 指向的 `~/.sofagent/data/daemon-launchd.log`；`~/.sofagent/daemon.log` 可能是测试进程残留旧文件，勿据此判断重载成败。

> 🔴 **步骤十三「Discussions 置顶轮换」补充——本步骤的两个 worktree 陷阱（均在 worktree 内执行时命中）**：
> ① **真实 hooks 路径不是 `<repo>/.git/hooks`**——worktree 里 `.git` 是**文件**（指向主仓的 gitdir），
>    hooks 实际在主仓实现目录。取真实路径用 `git rev-parse --git-path hooks`（本 worktree 实跑命中：
>    直接看 `.git/hooks/` 会误判「无本机 hook」，而真实 hooks 在 `~/WorkBuddy/sofagent/.git/hooks`）。
> ② **`sofagent-audit --init` 在 worktree 内安装 hook 会失败**（实跑 `ENOTDIR: mkdir <worktree>/.git/hooks`
>    ——安装器按 `<cwd>/.git/hooks` 拼路径，未走 `git rev-parse --git-path hooks`），且**此前的旧 hook 已在
>    「先删后装」流程中被移除** → `--init` 失败后本仓处于**无 hook 状态**（后续 commit 不再被审计）。
>    **安全修法（不依赖 CLI）**：备份 → 直接从 `engine/audit/hooks/` 拷贝三件并 `chmod +x` 到真实 hooks 路径
>    （hook 本就是拷贝形态，与 `--init` 产出一致）。装完用一次真实 commit 验证审计确实运行。

---

## 发布后验证脚本（步骤一）

> ⏱️ **时长预期**：全套约 5-8 分钟（`npm install -g` 拉包 + `check-version` 全仓扫描）。回写三文档后若跑全量 acceptance 验证：**4-8 分钟正常，必须 `run_in_background` 后台跑**——300s 前台超时会误判「卡死」（曾出现场景内嵌全量 npm test，实际健康只是慢）。

```bash
# Git tag + release 验证
git tag -l | grep vX.Y.Z
gh release view vX.Y.Z
# Release Notes 完整性：body 非空 + 含 changelog markdown 链接 + 非 Draft
gh release view vX.Y.Z --json isDraft,body -q '.body | length'  # 期望 > 100
gh release view vX.Y.Z --json body -q '.body | contains("blob/main/docs/changelog/")'  # 期望 true（🔴 绝对形态——release 页相对链接 = 404，见 06 三条硬口径）

# npm 版本验证（🔴 必加 --prefer-online——裸查询吃本地缓存，发版 session 内误报上版号）
npm view @sofagent/audit version --prefer-online   # 期望 vX.Y.Z
npm view @sofagent/mcp version --prefer-online     # 期望 vX.Y.Z
npm view @sofagent/audit readme --prefer-online    # 期望有内容（非空）

# 分发渠道对账（实锤：阶段十被整体跳过，直到下版自迭代才补走——本段是唯一报警面）
# ① ClawHub skill：verify 返回版本号 = 本版（安全扫描 pending 时 verify 可能滞后几分钟，重试）
clawhub skill verify sofagent 2>&1 | grep '"version"'   # 期望 "version": "vX.Y.Z"
# ② ClawHub OpenClaw plugin 家族：API 逐款查 latestVersion（🔴 必须带 https:// 前缀——裸域名被当本地路径静默失败）
for n in $(ls -d engine/openclaw-plugins/sofagent-* | xargs -n1 basename); do
  curl -s "https://clawhub.ai/api/v1/packages/$n?ownerHandle=KongFangXun" \
    | node -e 'const p=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8")).package||{}; console.log(`${p.name||"?".padEnd(20)} latest=${p.latestVersion||"?"} scan=${p.scanStatus||"?"}`)'
done   # 期望全部 latest=vX.Y.Z；scan=suspicious 未必是问题（测试文件触发启发式，见 10-distribute 快照纪律）
# ③ SkillHub DSH plugin 家族：skillhub 无远端 verify（verify 只对已安装 skill 生效）——对账走发布时 CLI OK 输出留档
# ④ Marketplace：curl 版本页含本版号即免网页操作
curl -s https://github.com/marketplace/actions/sofagent | grep -c "vX.Y.Z"   # 期望 ≥1

# 全局安装更新（registry 已更新，本地仍是旧版本）
npm install -g @sofagent/audit@latest @sofagent/core@latest
sofagent-audit --version           # 期望 vX.Y.Z（🔴 用默认登录 shell 跑——本机多套 node runtime 各装全局包时，给命令注入 PATH 前缀会选中旧版二进制制造「版本不一致」假红，实测四 runtime 四版本并存）
sofagent-audit --doctor            # 期望与当前版本 doctor 项数一致
sofagent-core --doctor             # 期望全部通过

# 文档头发版状态翻转（「待发版」语义族 →「已发版」）——check-version F6 已锚定「待发版」
# 🔴 预期红窗口（别误诊）：tag 建成 → 活文档头翻牌完成 之间，check-version §26「活文档待发版
#    残留」**必然报红**——这是窗口态，不是缺陷。处置 = 执行下方翻牌脚本使 §26 转绿，
#    **不是**改守卫、也不是把「待发版」字样删掉了事（§27 的 F-14 行级排除只豁免「下一版」标注，
#    不豁免本版残留）。判定口诀：报红对象里出现**本版号**即窗口态；出现**非本版号**才是真残留。
# 三字拦截（措辞变体不可穷举，曾两版各漏 13 份与 8+2 份后收口），
# 此翻转必须在下方 check-version 全绿验收之前做，否则 F6 报文档头残留红灯。
# 只翻转活文档头，历史 changelog/archive 的「待发版」是当时正确状态不动。
# 🔴 翻牌面三分（实测口径，勿混）：
#   ① **本步骤翻**：活文档头语义族——README 双语「版本说明 / Version note」行 + 版本章标题 +
#      目录锚点（标题括注变则锚点必变，照既有形态 `-已发版--日期` 写）、docs/ROADMAP.md
#      「现在在哪」节本版叙事行、当前版本 devlog 头、各文档头状态行。
#   ② **bump 时已翻**（本步骤只复核不重做）：文档头 `> vX.Y.Z · 日期 · ✅ 已发版`（20+ 个 .md）、
#      CHANGELOG 索引行、WIKI 状态表、ROADMAP 顶栏第一二行与目录锚点。
#   ③ **本步骤不翻**（属步骤十五「发版即移出」面）：ROADMAP「规划版本」表的本版行状态列——
#      该行整行要移入「迭代历程」表，翻牌是多余动作（06-doc-finalize 定谳：bump 时保持
#      「✅ 开发完成（⏳ 待发版）」）。该列**不计入** check-version 第 26/27 项 ⇒
#      「§26 全绿但规划表仍写待发版」是正常窗口态，不是漏翻。
# 🔴 翻牌批裹挟防御：多 session 并发时 `git add <翻牌文件>` 会把并行 session
#    在该文件工作区的未提交 hunk（如测试数预改 4805→4807）一并裹挟进翻牌 commit → 远端 CI
#    报测试数漂移红（本地因含对方改动看不到）。防御：翻牌 commit 前 `git diff --cached` 逐 hunk
#    核对，只认翻牌 hunk（状态标注行），数字/内容 hunk 不是自己的不入——发现裹挟先
#    `git restore --staged <file>` 重新只 stage 翻牌 hunk，或还原对方数字为 tag 时点值随
#    follow-up 修（对方完工提交时再合法升级）。
grep -rlE '待发版' --include="*.md" docs/ \
  | grep -v "docs/changelog/" \
  | grep -v "docs/archive/" \
  | xargs sed -i '' 's/⏳ 定稿待发版——本批更新/✅ 已发版——本批更新/g; s/⏳ 定稿待发版（本批更新/✅ 已发版（本批更新/g; s/开发完成未发版/已发版/g; s/开发完成待发版/已发版/g' 2>/dev/null || true
# 当前版本开发日志头状态翻转（路径替换为当前版本 vX.Y/vX.Y.Z.md）
# 🔴 措辞变体必须逐个覆盖——死守单一形态会**静默漏翻**：sed 锚不匹配时不报错、直接无操作。
#    实锤：某版 devlog 头写的是「✅ **已开发完成。**」与「> 状态：✅ 已开发完成 ·」，与下方
#    旧的单一模式都不匹配 ⇒ sed 空转；而 check-version §26 的扫描面**明确排除
#    docs/changelog/**（「活文档」定义不含 changelog）⇒ 没有机械兜底，漏翻一路留到下一轮
#    巡检才被人工发现。故本段「多模式 sed + 翻转后断言」两件必须成对（少任一件即留缺口）。
_DLOG="docs/changelog/vX.Y/vX.Y.Z.md"
sed -i '' \
  -e 's/⏳ 待发版（tag\/npm 发版时同步）/✅ 已发版（YYYY-MM-DD）/g' \
  -e 's/✅ \*\*已开发完成。\*\*/✅ **已发版（YYYY-MM-DD）。**/g' \
  -e 's/已开发完成待发版/已发版/g' \
  -e 's/开发完成未发版/已发版/g' \
  -e 's/✅ 已开发完成 ·/✅ 已发版（YYYY-MM-DD）·/g' \
  "$_DLOG"
# 翻转后断言（fail-closed，两道）：
#   ① 头部区块必须出现带日期的「✅ **已发版（YYYY-MM-DD）」——零命中 = 该版措辞不在
#      覆盖面内（漏翻），当场红并提示去补 sed 模式，而不是留到下一版巡检；
#   ② 头部区块不得再出现「已开发完成」——命中 = 翻了一半或模式未覆盖全。
if ! head -12 "$_DLOG" | grep -qE '✅ \*\*已发版（[0-9]{4}-[0-9]{2}-[0-9]{2}）'; then
  echo "❌ devlog 头未翻转为『✅ **已发版（YYYY-MM-DD）』——检查该版措辞变体，补 sed 模式后重跑"; exit 1
fi
if head -12 "$_DLOG" | grep -q '已开发完成'; then
  echo "❌ devlog 头仍含『已开发完成』（发版后应为『已发版』）"; exit 1
fi
# 翻转后双零残留复核：「待发版」字样与版本头≠SSOT 必须双零命中，
# 非零即 fail——翻转脚本自身不再静默漏翻（F6 门禁是最后防线，此复核是第一防线）。
_REMAIN=$(grep -rlE '待发版' --include="*.md" docs/ | grep -v "docs/changelog/" | grep -v "docs/archive/" || true)
if [ -n "$_REMAIN" ]; then echo "❌ 翻转后仍残留待发版："; echo "$_REMAIN"; exit 1; fi
_SSOT=$(node -p "require('./package.json').version")
# 🔴 版本头正则写成 `v1.4.x` 会在 v1.5+ 全仓静默漏扫（零命中被误读成"无滞后"）——用
#    通配 minor 形态。扫描面 = docs/ 非 changelog/archive；根目录 README 双语与 CHANGELOG
#    的状态词由 check-version 第 26/27 项承担（本段只管 docs/）。
for _f in $(find docs -name '*.md' -not -path '*/changelog/*' -not -path '*/archive/*'); do
  _v=$(head -8 "$_f" | grep -E '^> *v1\.[0-9]+\.[0-9]+ *·|^> *版本[：:] *v1\.[0-9]+\.[0-9]+' | grep -oE 'v1\.[0-9]+\.[0-9]+' | head -1)
  if [ -n "$_v" ] && [ "$_v" != "v${_SSOT}" ]; then echo "❌ 版本头滞后：$_f: $_v ≠ v${_SSOT}"; exit 1; fi
done
echo "✅ 双零复核通过（待发版零残留 + 版本头全对齐）"

# 最终版本号一致性验证（文档头状态已翻转，F6 应全绿）
bash tools/check/check-version.sh        # 期望全绿
```

---

## 发版后 hotfix 流程（步骤一-2 之间可能发生）

> CI-only 概率性失败 = 先怀疑概率路径（如随机密钥定长契约用 ≥2000 次采样锁），修复 → 补防复发锁 → 测试数文档同步 commit **必须与 hotfix 同 push**（分两次 push 会让中间 commit 的 CI 红——check-test-count 在 CI 也跑）。

### 发版后追加 fix 批（tag 已定、不重打）

> 发版后阶段十一期间发现的**非安装入口**缺陷（tag 指向的 bump 自洽无恙），不必重打 tag——修复 commit 直接推 main，随下一版发布。实走此路径 4 个 fix（插件 projectRoot / orchestrator 上游钉 / README 发布命令 / ClawHub 不可变揭示的滞留项）。

**判据（是否需要重打 tag）**：
- **不重打**：缺陷不在 tag 锚定的安装入口链上（`install.sh` / `bootstrap.sh` / npm tag `latest` 指向的包内容）——tag 是用户安装锚点，只要锚定内容自洽，main 上的后续修复属下一版范畴
- **必须重打**：tag 内自洽被破坏（INSTALL_SHA256 钉值错 / 安装入口断链）——按 09-publish:332 既定章法重算重打

**纪律**：① fix commit 过全量门禁再推（HEAD 前移会让「tag == HEAD」窗口类检查自然落历史豁免，无需处理）② 修复涉及分发面（npm/ClawHub 版本不可变）的，用户面生效时点 = 下一版发版——记入下一版 devlog BugFix 批 ③ **不要为「让 tag 指向最新」而重打**——每次重打都是一次 provenance 漂移（已两次）。

## 开发 Prompt 校验循环（步骤七）

```
① 跑 ./tools/check/check-dev-prompt.sh ~/Desktop/vX.Y-dev-prompt.md（查"引用的东西存不存在"）
   ①b 验收块逐字对账（🔴 机械判据，前缀匹配会全误报）：
   for ln in $(awk '/### 验收标准/{f=1;next} /^## /{f=0} f&&/^- \[ \] /' docs/changelog/v<下一版>/v<下一版>.md | md5 -q); do :; done
   diff <(awk '/### 验收标准/{f=1;next} /^## /{f=0} f&&/^- \[ \] /' docs/changelog/v<下一版>/v<下一版>.md) \
        <(grep "^- \[ \] " ~/Desktop/vX.Y-dev-prompt.md) > /dev/null \
     && echo "✅ 验收块逐字零差" || echo "🔴 验收块有差——逐行核对（语义压缩即丢判据）"
② 脚本输出零 ❌ 后，再过一遍 playbook/dev-prompt-checklist.md 的 8 条自查
   （查"写法对不对/全不全/新不新"——函数签名准确性、注册点/数组归属、改造代码保留声明、已完成区剥离、强动词名副其实；第 7 条为**大版本深检六项**：minor 版或含 breaking 的 prompt 必跑，六类结构性错误是存在性脚本拦不住的——章节数对账/验收搬运对账/「不存在的东西当已存在写」（枚举值查源码）/移除面全枚举（@public 基线）/基线数字时效（排期快照重测）/ROADMAP 行交叉对账）
③ 两项都过 → **独立二轮深检**（🔴 prompt 不是写好就交——定稿前必须再做一轮**独立于首轮生成视角**的核查，结合 ROADMAP 行 + CHANGELOG 索引 + devlog 全文 + npm registry + 源码实查五源交叉。实证首轮零 ❌ 的 prompt 二轮仍抓出 3 处真问题：章七「移除 X 指向 X」笔误（旧包名写错）、章十重复排期（examples/justification 系存量，真实差距只剩 loader 断言）、章九现状基线缺失（ruleType 已在位被当新任务）。二轮深检的方法论：**每个「新增 X」条目先查 X 是否已存在**（grep 源码 + 实跑模块计数）——排期文档写「新增」时可能指的是数月前的状态；每个「移除/退役 X」条目查 X 的全部落点是否真存在可移除对象）
④ 二轮发现问题 → **先修 devlog（SSOT）再同步 prompt**，回 ① 重跑
⑤ 三项都过 → prompt 定稿
⑥ 任一项发现问题 → 逐条修正 prompt（只改 prompt 文件、不改代码库）→ 回到 ① 重跑
⑦ 最多 5 轮（5 轮仍不过说明开发日志本身有结构性问题，需人工介入）

脚本输出含义：
  ❌ 错误 = 引用了不存在的已有文件/函数（必须修）
  📋 待新建 = prompt 描述的新文件（正常，不算错误）
  🔄 运行时 = ~/.sofagent/ 等运行时目录（跳过）
```

> check-dev-prompt.sh 只查「存在性」，checklist 补「准确性」，二轮深检补「排期时效性」——三层递进，缺一不可。

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

**生成前对账 checklist（5 条）**：① 章节完整性——prompt 章节数 == 开发日志 `## ` 章节数（漏章=漏交付）② 路径核对——开发日志「涉及文件」表逐行过一遍 `ls`，无前缀路径查真实位置 ③ 验收搬运——开发日志每章「验收标准」的 `- [ ]` 全部落进 prompt 对应章，且必须**逐字搬运禁止语义压缩**（🔴 实测教训：prompt 生成时把验收项做了语义压缩转写，前缀匹配检查全误报为绿，逐字比对才暴露 6 项判据细节缺失——「双锚点指纹」「血缘与审批留痕」这类括注就是判据本体，压缩即丢判据；核对法：`diff <(devlog 验收块) <(prompt 验收块)` 逐行零差） ④ 新建文件命名——新建 `.sh`/`.mjs` 检查仓库既有同类命名风格（如 tools/ 下检查器用 `check-` 前缀），**禁中文文件名**（现有门禁无此项，靠本条兜底）⑤ **修正批回写完整性**——prompt 生成后又合入审查修正/定谳/销案合并的，
修正批必须回写**同一结论的全部落点**（基线表、待拍板清单、正文交叉引用「见第 N 条」）；收尾时 grep 修正关键词扫全 prompt 逐处核对，并列出本批触碰段落清单——列不全即未收口（曾出现基线表与文末清单结论并存矛盾、清单合并后引用错位）。

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

## 步骤八留痕（下版本讲解 · 作者确认）

> **本轮讲解留痕（存量收敛 → 审计模块覆盖面扩展）**：
>
> **① 下版本要干什么（一句话）**——把**审计模块的覆盖面**补宽：SMB 场景审计（数据产物规则）· 浏览器四件套实现底座处置 · OWASP 补条 · 规则语料双分类映射；并把**决策日志**接成审计输入源、对 **ACS YAML 策略引擎**做表达面兼容性评估。
>
> **② 增加了什么新东西（人话）**——a) **数据产物规则**（数值勾稽 / 来源可溯 / 口径一致三类，让「数对不对」也进审计面）；b) **能力清单与使用率治理**（capabilities manifest：哪些能力在被用、哪些只躺仓库）；c) **决策日志作为审计输入源**（规则面直接消费决策记录）；d) **ACS YAML 策略表达面**（策略可用 YAML 声明）；e) **SMB onboarding 模板**（无代码仓库的纯数据节点部署路径）；f) 清掉浏览器四件套遗留的实现底座。
>
> **③ 让产品未来怎么样**——审计面从「代码与变更」扩到「**数据与策略**」，为后续判定底座（判据与数据地基）准备消费面与被审计对象：覆盖面先补齐，判定件才有可判之物。
>
> 🔴 **作者确认状态**：作者以「**按 SOP 全部执行**」指令走完阶段十一全程——未提出范围增减、未提出优先级调整 ⇒ **本版章范围与顺序维持**，prompt 定稿（`~/Desktop/vX.Y-dev-prompt.md`，占位形态对应当前在役版本）。二轮深检登记的 2 项排期语义待确认项（见当前在役下一版开发日志末章〈二轮深检登记〉）按同一口径**维持原范围**，其纯事实陈旧项已由 prompt 侧按实测更正。

> **下一版讲解留痕（本次 · 三问讲稿）**：
>
> **① 下版本要干什么（一句话）**——把「执行侧决策链」补齐：上一版把**判得准**做完了（审计规则引擎统一 + 自测 schema），本版补**走得对**（往哪走 / 去不了怎么办 / 怎么判）。上一版留下的缺口有两个：决策链只有「承接面」（router → 引擎）没有「下达面」（引擎 → router）；判定链还没有「不占本地主模型槽」的分层方案。
>
> **② 增加了什么新东西（人话）**——a) **模型路由**：客户的敏感数据自动留在本地、只有通用知识走云端，省 API 成本且满足合规；b) **本地槽位排队**：一体机 GPU 就那几张卡，多请求来了排队而不是把机器打爆，等太久且合规允许就自动转云端；c) **判定分层 L0/L1/L2**：判断「这请求该走哪」不再占用本地大模型（省槽位、不被循环依赖拖死）；d) **凭证隔离 Vault**：Agent 的 token 拿不到明文（动态注入请求头），还能回答「这条凭证是不是本任务的最小授权」；e) **多实例表决**：同一个判断并发跑 N 个小实例、交叉比对、分歧交人；
>f) **AI 节点治理接入**：客户自己用 DeepSeek harness + LangChain 搭的 Agent 能纳入本仓的审计与出口管控，第三方插件挂上来还能白得审计、进化护栏、飞轮增值、判定服务四层好处；g) **授权 × 凭证对账**：批准了小事却发下大范围凭证——这种「两张表各自看都合法」的缝能被判成越权风险。
>
> **③ 让产品未来怎么样**——从「审计与判定」走到「执行侧可治理」：本版把 `DecisionChannel` 契约与路由底座立起来（后续判定底座各阶段才有地方填真实判定件实现）；cordis 兼容层让生态插件挂得上来，为「一次判定多插件复用」铺路；S1M 宣告版需要的「判定件接进真实执行链」实装证据，由本版提供。
>
> 🔴 **作者确认状态**：本轮为**无人值守授权**执行（原话「我直接睡觉了……不要再向我询问了」）——**未进行对话确认**。按步骤八「确认后 prompt 才算真正定稿」的字面要求，登记为 **⏳ 待作者复核**；未收到范围增减或优先级调整指令 ⇒ **本章范围与顺序维持**（首项硬交付 + 一~七）。

> **上一轮讲解留痕**：用户以「继续」指令走完阶段十一全程——下一版七章范围与顺序维持（规则引擎统一 + 工具链修复闭环：双规则引擎统一 / 自测 schema / A24 新规则 24→25 / doctor 修复闭环 / ARCHITECTURE 三域重构 / 判决记录成对 / AuditScope 一等公民化）。讲解三问已随桌面 dev prompt（下一版命名惯例文件）呈现。

> **讲解已做**（编排模块 · 事件驱动——8 章：事件驱动触发 / 理解债务应对 / AI 异常处理总线 / G12 设备 OTA / 任务下发二期 / T8·T9 生产管线接线 / 审计输入双通道 / `sofagent demo`）。
> **作者确认**（原话「把阶段 11 全部走完」）：未提出范围增减、未提出优先级调整 → **本版 8 章范围与顺序维持**，prompt 定稿（`~/Desktop/vX.Y-dev-prompt.md`）。
> 若后续需要调整，改动落 devlog（SSOT）后同批回灌 prompt（深检② 会机械校验一致性）。

---

## 🔴 发布期机械自检清单（事故沉淀 · 步骤四的落地形态）

> **为什么要有这一节**：发版时暴露的问题里，**多数规则 SOP 早就写着**，但仍被踩——
> 说明「叙述性规则」不足以约束执行。本节把它们**改写成可直接跑的命令/断言**：规则只有变成
> 机械检查才真正生效。

| # | 事故 | 机械检查（照着跑） |
|:--:|---|---|
| 1 | **Release Notes 体例漂移 7 处**（加粗/千分位/超长说明/塞表格/简化 URL） | `gh release view v<上一版> --json body -q .body > /tmp/prev.md` 与本版 body **逐行 diff**；H2 骨架必须逐字相同（`grep -E "^## " ` 两侧比对） |
| 2 | **编造数字**（「1017 断言」——脚本根本不统计断言数） | 表里每个数字**必须能指认产出命令**；指认不出就**不写**。acceptance 只认脚本 SUMMARY 原格式：`{N}/{N} passed · SKIP: {N} · EXIT: {N}` |
| 3 | **剥元说明只剥顶部**（尾部「🔗 尾链…同源」漏剥） | `grep -nE "阶段六定稿必备项\|数字取值说明\|Release body 同源\|\.\./releasing/" body.md` 必须**为空** |
| 4 | **`INSTALL_SHA256` 基准算错**（用 bump 前 HEAD 算，而 bump 会改 install.sh） | 回填后自检：`git show v<tag>:bootstrap.sh` 的钉值 == `git show v<tag>:install.sh \| shasum -a 256`——**不等就重算并重打 tag** |
| 5 | **活文档「待发版」漏翻**（ROADMAP 版本表行） | `bash tools/check/check-version.sh` 的**第 26 项**（已发版态扫活文档；开发态/待发版窗口白名单内降级跳过，与 §27 同口径） |
| 6 | **验收断言随 bump 失配**（断言锁死当版号，bump 后失配） | 验收脚本里**禁止锁死当前 SSOT 版本号**；要比对就取变量或放宽为 `v[0-9]+\.[0-9]+\.[0-9]+` |
| 7 | **CI 与本地门禁口径差**（shellcheck 按 shebang 扫全仓，本地按 `*.sh` 扫） | 本地必须跑 **CI 同口径**门禁：`bash tools/check/check-shellcheck.sh` |
| 8 | **跨平台脚本假设 bash**（我的 fail-closed 在 Windows 崩） | 任何 `postbuild`/`scripts` 里调 `bash` 的，必须加 `process.platform===win32` 短路 |
| 9 | **平台发布输出判定词不全**（ClawHub 的 `Update submitted … pending security scans` 是**成功**） | 判定词表须含全部成功形态：`Published`/`success`/`already exists`/`Fix: Align`/`Update submitted` |
| 10 | **自己写的检查脚本误判**（`grep -c` 空输出被 `[ "$n" != "0" ]` 判成「存在」） | 计数判据先 `n=${n:-0}`，或用 `grep -q`；**空输出 ≠ 0** |

**执行纪律三条**（都踩过）：
1. **批量替换前限定白名单目录**——否则会把 `.workbuddy/memory/` 也扫进去；
2. **`cd` 到临时目录后必须切回**——否则后续命令在错目录里跑（实锤：命令报 file not found）；
3. **改门禁后跑反测**——注入一个违规样本确认它**真的会红**（只跑正常态不算验证；且注意注入样本要被门禁的扫描面覆盖：`git ls-files` 类门禁需先 `git add`）。

---

## 进度追踪清零（步骤九）

> 本版本发版流程全部完成后，最后一步——把 `releasing.md` 进度追踪的 11 个 `[x]` 全部改回 `[ ]`，为下一版本新周期做准备。

**为什么要清零**：进度追踪是"当前版本走到哪了"的实时状态。如果不清零，下版本新 session 打开 releasing.md 会看到 11 个全 [x]，误以为"已完成"而不知道该从哪开始。清零后第一个 `[ ]`（阶段一）就是下版本的起点。
>
> **终态语义**：若发版过程未逐阶段打勾（直接走到本步骤），此处确认全 `[ ]` 即达成清零终态——打勾缺失不影响闭环（进度可见性靠各阶段产物与本表勾选），勿为补打勾而回溯考古。

**操作**：
```bash
# 🔴 清零前断言——按下值三分判定（**不是**一律要求全 [x]）：
#    ⚠️ 为何要判：「阶段十分发整个被跳过却没人发现」——各阶段勾选从未全绿就进了清零，
#    跳阶段的证据随清零销毁。故**部分打勾**（有阶段走一半）必须阻断；
#    而「从未打勾」（全 [ ]）不是跳阶段证据，属下方「终态语义」覆盖的正常路径。
grep -c "^- \[x\]" docs/changelog/releasing.md   # 全 [x]=11 → 清零；全 [ ]=0 → 终态语义直接达成
#   部分打勾（0 < n < 11）= 有阶段走到一半没走完 → 先补走缺口阶段，禁止清零
#   （矛盾消解：本条与上方「终态语义」曾互斥——守卫一律拦 <11，终态语义又允许全 [ ]；
#    现按 n 取值三分：0 走终态、11 走清零、中间值才阻断）
# 把 releasing.md 进度追踪的 [x] 全部改回 [ ]
sed -i '' 's/- \[x\]/- [ ]/g' docs/changelog/releasing.md
```

**清零后确认**：进度追踪 11 行全部 `[ ]`，下一版本从阶段一重新开始。

**🔴 内部步骤表同步清零**：本文件步骤一~十五的「完成」列勾选同样跨版本累积（一~十三的 `[x]` 全是上一版残留，与本版实际进度无关造成误读）——步骤九清零主表时，把本表勾选一并改回 `[ ]`：
```bash
sed -i '' 's/| \[x\] |/| [ ] |/g' docs/changelog/releasing/11-post-publish.md
```

---

## releasing 自迭代（步骤十）

> 🔴 **本步骤的收尾判据：改完必跑表格形态门禁**。11 个阶段文件正是 `check-table-shape` 的高风险面——实测（SOP 排版治理批）：一次性「长内容降 H3」改动引入 **56 处孤儿行**（表格被 H3 / 正文切断，后半段渲染为裸管道文本，**内容在 GitHub 上根本不进表**，静默不可见），潜伏一天方被发现。两次原因叠加：**本步骤不走 06 文档定稿流程**（那是发版流程的文档门禁），而 pre-push 门禁在「只 commit 不 push」的窗口内不触发。
> **判据**：改完 SOP 文件立刻跑 `node tools/check/check-table-shape.mjs`（全量 400 文件 / 2267 张表，**0.4 秒**）——**EXIT=0 才算本步骤完成**；存量 43 处已在基线台账豁免，只需保证「无新增违规」。
> **改表格结构的通用纪律**（本次事故的操作教训）：把表格中的长内容提炼为 H3 / 正文时，**必须同时处理原表格行**，且提炼出的块**只能放在表格之后**——插在表格中间即切断表格，后半段全部变孤儿行。

> **已登记待办（最近发版周期实测产出 · 下次自迭代优先处理）**——六条精简方向（按性价比排序，均属
> 判定面/结构面变更，发版窗口内禁动，留本步骤执行）：
> 1. **05 模板与 SOP 双写收敛**：prompt 模板内嵌 ①~⑤ 全流程细节与正文重复（实测已有一处措辞分叉）——模板只留「版本裁定 + 差异项 + 指针」，骨架细节以正文为 SSOT。
> 2. **05/06「为什么」注释外移**：解释块混在操作序列中间（执行方每轮重读）——集中抽到文件尾 design-notes 节。
> 3. **06 拆二**：692 行塞六个主题——拆 `06-doc-finalize`（定稿+评分）+ `06b-release-notes`（RN 规范+触点清单+挂账交接）。
> 4. **05 重跑前置三查双写消除**：与模板 ① 完全重复——正文留 SSOT，模板留一行指针。
> 5. **凭据链纪律收敛**：--pre 语义在 05 出现 3 次 + SKILL 1 次——收敛为一处小节他处指针（并发挤压停手时实测翻找困难）。
> 6. **11 与 releasing.md 进度表职责去重**：自迭代主责面归 11，总览表只留指针。
> 7. **阶段文件超规拆分**（已实测）：`09-publish`（785 行）与 `06-doc-finalize`（747 行）**超「单文件 ≤650 行」规约**——按规约拆子文件（09 的「故障排查手册」已拆为 troubleshooting，可续拆「发布窗口三坑处方」为独立子文件；06 按待办 3 的 06/06b 方案拆）。**拆完同批更新 `tools/check/sop-integrity-baseline.json`**（结构 pin 三元组）。
> 8. **窗口态豁免的自动过期守卫**（本轮实测）：`npm-claims` 窗口态豁免须在 publish 完成后移出——本轮靠人工记忆执行。可机械化：当被豁免的声称值 == registry latest 时，豁免台账必须为空，否则判红（把「债清即移出」从纪律变成判据）。


> releasing.md 是活文档——每次发版的实际执行体验是最值钱的反馈。步骤十 是 releasing.md 的「Dream Cycle」：用它自己的经验喂养它自己，持续修正过时/缺漏/顺序不合理的地方。

> 🔴 **步骤表审计的两条方法纪律（本轮实测）**：① **审计步骤表要连非数字编号行一起抓**——`grep '^\| [一二三四五六七八九十]'` 会漏掉 `| — |` 这类非数字编号行（本轮据此漏掉〈Release Notes 范本快照更新〉一步）；用 `grep -E '^\| *[—一二三四五六七八九十0-9]'`。② **结构面已有机械兜底**——`tools/check/check-sop-integrity.mjs`（pre-push 4c 块）钉住每份阶段文件的（步骤表行数 / 步骤标题数 / 正文小节数）三元组，静默删步骤行、删 `## 步骤X：` 标题、删正文小节、批量截断均当场红。

**检查维度**（每次发版后逐一过）：

| # | 检查项 | 怎么查 | 修法 |
|:--:|--------|--------|------|
| 一 | **阶段顺序与实际流程一致** | 对比本次实际执行的步骤顺序 vs 阶段文件写的顺序 | 不一致 → 更新阶段文件（以实际为准） |
| 二 | **阶段间引用无断裂** | grep "阶段 X" 确认引用的阶段号/文件名都存在 | 断裂 → 修正引用；SOP 文件改名/拆分/移动时额外 `grep -rn "<旧文件名>" docs/ README.md` 全仓回扫（历史 changelog 活链接随迁，纯考古叙述不动） |
| 三 | **配套文档链接有效** | releasing.md 底部配套文档链接可访问 | 失效 → 更新路径 |
| 四 | **本次发版暴露的 SOP 缺口** | 回顾发版过程中「SOP 没写但我踩了坑」的环节 | 缺口 → 吸收进对应阶段 |
| 五 | **冗余/过时步骤** | 有没有阶段写了但实际从不执行（或已被工具覆盖）的步骤 | 删除或标注「工具已覆盖」 |
| 六 | **ROADMAP 体检** | 按 [06-doc-finalize.md](./06-doc-finalize.md)「ROADMAP 同步手册」的体检清单 9 项扫一遍（重复表/散落章节/死链/已交付混入/范围过期/模糊版本号/U+FFFD/新增前未 grep 同类/同类 ≥3 未抽库） | 逐项修复 |

> 📋 **发版 commit 规范（防 git log 噪音）**：发版过程中阶段一~十一的进度打勾（`releasing.md` 进度追踪 `[x]`）会产生大量「元工作 commit」。**这些打勾类 commit 应 squash 为单个 `docs(releasing): vX.Y.Z 发版流程完成`**，不要每个阶段一个 commit——否则 git log 充斥 `docs(releasing): 阶段X打勾` 噪音，外部贡献者看 commit 历史会以为项目没有产品迭代。
>实际产品改动（代码 fix/feat、文档内容修改）照常各自独立 commit，只有「纯进度打勾」类元工作 commit 才 squash。

> 📏 **进度追踪防膨胀**：releasing.md 进度追踪只保留「阶段名 + 链接 + 一句职责」的极简形态——版本执行实录、耗时记录、run 编号一律不写回（过程记录归 devlog / changelog 快照）。发现进度追踪区开始堆积考古内容即回炉瘦身。

### 自迭代记录（本轮发版 · 吸收清单）

> 本节只记**本轮实际改了什么**（每条对应上文六个检查维度之一），不记过程叙述。

| 维度 | 本轮吸收内容 | 落点 |
|---|---|---|
| 四（SOP 缺口） | dist-tag 分道**彻底撤策化**——现行口径段 + `<details>` 历史存档折叠；步骤八补四段实装验证**实作路径**；artifact 对账补「终局口径 = registry HTTP 直查」 | `09-publish.md` |
| 四 | `doctor` 写法纠正（`--doctor` 是 flag 非子命令，裸 `doctor` 会被 quick 模式当 diff ref）；Convex OOM 补「按款单独重发」实测 | `10-distribute.md` |
| 四 | 双零复核版本正则改**通配 minor**（硬编码 `v1.4.x` 在 v1.5+ 全仓静默漏扫、零命中被误读成「无滞后」）；补「翻牌面三分」注释块；补「§26 预期红窗口」判据（tag 建成→翻牌之间报红是窗口态） | `11-post-publish.md` |
| 一/四 | 触点清单 **#15/#16 归属批次纠偏**（规划表本版行由阶段十一步骤十五整行移出、不翻牌；#16 三分：顶栏+节标题归 bump / 本版叙事行归阶段十一）——原「阶段九 bump 批」与实测口径冲突 | `06-doc-finalize.md` |
| 五（数字核对） | 三处陈旧计数改**活口径**：`check-version 131 项`→「全项」；silent-catch 前置过滤计数与存量基线指向台账；规则口径 `A1-A23 共 26 条`→`A1-A11 + A14-A24 + E1/E2/E4 共 25 条` | `06/09/11` |
| 四 | 新增教训形态：「**不存在**」有三态——空输出 / E404 退出码 / **空对象 packument**（`{}`），只认前两者会把「已下架终态」读成「数据缺失」 | `playbook/fresh-eyes-review.md` |
| 六（ROADMAP 体检） | 本版行移入迭代历程表 + `check-forms.mjs` 三处移出（见步骤十五） | 步骤十五 |
| 四 | **devlog 头翻转的措辞变体漏翻**（本轮实锤）：步骤一原 sed 只匹配 `⏳ 待发版（tag/npm 发版时同步）` 单一形态，本版 devlog 头实写「✅ **已开发完成。**」⇒ sed 锚不匹配**静默空转**；而 `check-version` §26 扫描面明确排除 `docs/changelog/` ⇒ 无机械兜底，漏翻一路留到下一轮巡检才被人工发现。修法：改**多…| `11-post-publish.md` · `06-doc-finalize.md` |

---

## 文档退役巡检（步骤十-2 · 发版后固定步）

> 🔪 **奥卡姆剃刀步**：每版发版后对全仓维护文档跑一轮「淘汰巡检」——文档只加不删会持续腐坏（考古章堆积 / 时态过期 / 新旧两说 / 数字漂移）。本轮的产出不是新增内容，是**删掉、收敛、对齐**已失去指导价值的内容。与 [playbook/doc-fresh-review.md](../../../playbook/doc-fresh-review.md) 的「质量审查」（写得对不对）互补——本步管「时效」（该不该留）。

### 四层挖掘法（顺序执行，前两层命中率最高）

| 层 | 方法 | 命中形态 |
|:--:|------|---------|
| 一 | **反向连带核对**（最有效）：以本版 devlog 每项交付为索引，全仓 grep 哪些文档描述因此失效；与本版已登记的「文档连带」清单比对找漏项 | 「该章施工后 X 文档失效」但 devlog 连带清单没登记 |
| 二 | **正向过时扫描**：grep 词形——考古章标题（「已解决」「vX.Y.Z-VX.Y.Z 局限」）/ 过期版本承诺（「将做」「排期 vX.Y」对照已发版与现行 ROADMAP）/ 数字漂移（规则数/工具数/包数/测试数全仓声称 vs registry 实数）/ 已移除别名与已删除命令 | 考古章 / 死承诺 / 三处自洽破裂 |
| 三 | **全文逐行核验**（重点文档轮换，每版 5-8 份）：命令示例 test -e、跨文档链接 test -e、「当前/目前/现阶段」对照 ROADMAP 现态、同主题文档重复度 | 「用户照文档操作会失败」级 |
| 四 | **待议判定**：需业务验证才能定去留的，留议不强行处置 | — |

### 四桶分类与处置五选

| 桶 | 判据 | 处置 |
|----|------|------|
| **要退役** | 描述的能力/命令/文件已不存在（实证），或已由退役裁定删除 | 真删（三条件）或移 `docs/archive/`（归档文件头部写来源与退役理由） |
| **要淘汰** | 表述仍真但已无指导价值：一次性过程叙事 / 双重维护的重复段 / 被更好写法取代的 workaround | 收敛为一段结论 + 指针；合并去重 |
| **要更新** | 内容仍成立但细节过期：版本引用 / 路径 / 计数 / 时态（将来时指已发版版本） | 改写即活——对齐现态并预埋后续版本指针 |
| **要优化** | 内容正确但表达问题：重复条 / 缺时点声明 / 结构混乱 | 结构收敛（净零或减行） |
| **触发条件未到** | 退役已裁定但施工在后续版本 | **不提前动**——具名登记进对应版本 devlog 的「文档连带」清单，施工时同批改 |

### 执行纪律（每条都有实战拦截记录，逐条遵守）

1. **每批改完必跑 check-docs + check-version**——死锚 / 相对路径死链 / 工具计数对账三道拦截实证有效，红项清零才算完
2. **相对路径层级先 test -e**：docs/guides/→engine 需 `../../engine`；docs/changelog/vX/→docs 需 `../..`——写直觉层级必错
3. **「N tools」「N 个 tool」形态会被对账器提取为工具数声称**——退役标注/历史读数与当前口径必须分列且语义正确；行号引用避用纯数字形态（会被误提）
4. **ASCII 路径枚举连写总长 ≤39 字符**（超长触发 A2 密钥误报，commit 被拦）——枚举用顿号分隔
5. **删章节同步删目录/TOC 行**；markdown 链接的括号在批量替换时易被吃掉——改后抽验渲染形态
6. **多 session 并发**：git add 后核对暂存区（防裹挟他人未完成改动）；批量脚本 throw 即半途态——每轮结束全量盘点落点，不信任上轮输出；**写共享文件（本文件即典型）后立即 commit 缩小竞争窗口**——本节自身即因并发覆盖丢失过一次
7. **历史读数与当前口径分列**：冻结区数字不回改，活文档「107（发版时点）/ 103（当前）」双口径并列各得其所
8. **代码退役与文档退役分离评估**：BREAKING 代码变更（registry 注销等）需 CHANGELOG 公告；触发条件未到的代码面只清文档叙述

### 计数类联动的特殊提醒

工具数增删是**全仓 20 文件级联动**（五域图图题与分桶求和 / check-docs §17 §20 / check-version §12 §14 §15 §26b / API.md / 双语 README / SKILL 两件 / AGENTS / GEMINI / WIKI / mcp 与 umbrella README / dashboard 字典 / playbook 守卫锚）——增删 tool 时对照 A24（24→25）与浏览器四件套（107→103）两次先例的联动清单逐处过，
跑 `node tools/gen/gen-api-tools.mjs` 重生成后必同步修 **gen 模板源**（否则下次重生成恢复旧句）。
