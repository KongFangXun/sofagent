<!-- SOP-ANCHOR: S10 | file: 10-distribute.md | prev: S9 | next: S11 -->
<!-- 机器锚（模型检索用，人不影响阅读）：grep "SOP-ANCHOR:" 可一跳取全部阶段元信息；本阶段完成后 → S11 -->
# 阶段十：分发（Skill / DSH plugin / OpenClaw plugin / GitHub Marketplace / 设备端）

> **项目负责人亲手执行，或授权 AI 代执行。npm 发布流水线（本阶段前置）见 [09-publish.md](./09-publish.md) 步骤一~八。**
>
> **授权粒度**：阶段八放行的「Skill 分发」拍板即覆盖本阶段全部分发渠道（Skill 双平台 / DSH plugin 家族 / OpenClaw plugin 家族 / Marketplace / 设备端 / npm 门面巡检）——按步骤顺序一次走完，只在报错或渠道前置不满足（如 source-linked 未 push）时停下报告。分发不含不可逆撤回风险（同版本不可覆盖但可递增），一揽子走完的粒度与 09-publish 对齐。

---

## 步骤一：Skill 分发 ☐

> 🔴 **执行环境提示**：本阶段所有 `for` 循环与变量展开命令**必须在 bash 下执行**
> （`bash <<'BSH' … BSH` 或存成 .sh 再跑）。zsh 不对未加引号的 `$MULTILINE_VAR` 做空白分词
> ——`for d in $DIRS` 会把整个多行串当一个值，`skillhub publish` 随即报「路径不存在」（实测）。
> SOP 命令本就按 bash 语法书写，勿在 zsh 里直接粘。

```bash
# 发布前确认 slug（SSOT）
head -3 SKILL/SKILL.md   # 期望 slug: sofagent

# ── ClawHub 分发 ──
# 发布前先查现有版本（同版本号不可覆盖，冲突则递增版本号）
# 🔴 reasons 是集合、会随平台侧新增要求扩充——已实测：security.status_not_clean（安全扫描）、
#    card.missing（平台要求 skill 根目录提供 skill-card.md，格式由平台定义、CLI 无对应选项）。
#    判据 = 快照增量：发布前落盘 verify 快照 → 发布后逐条比对 → 只处置新引入的 reason；
#    历史遗留项（上版就有）不阻断发布。新引入项优先按平台要求补齐产物；格式未公开时不得猜写，
#    如实记为开放项上报（新建仓内文件属需作者拍板的动作）。
# 🔴 verify 快照纪律：security.status_not_clean 可能是历史版本遗留的既有状态——
#    发布前先落盘快照（verify 输出存档），发布后对照，新引入 reasons 才处置
clawhub skill verify sofagent 2>&1 | grep version
# 清理 .DS_Store（macOS 残留会触发 security 扫描 not_clean）
find ./SKILL -name '.DS_Store' -delete
# 发布（必须带 --changelog，否则 ClawHub 默认 1.0.0 自增，不走 SKILL.md version）
# 🔴 必须带 --name（缺 --name 时 ClawHub 显示名回退为 "SKILL"，不读 SKILL.md frontmatter 的 displayName）
clawhub skill publish ./SKILL --slug sofagent --name "FDE Skill" --version <版本号> --changelog "vX.Y.Z"

# ── SkillHub 分发 ──
# SkillHub 不接受 .png 文件，用临时目录排除
tmpdir=$(mktemp -d) && cp -r SKILL "$tmpdir/" && find "$tmpdir" -name "*.png" -delete && find "$tmpdir" -name '.DS_Store' -delete
skillhub publish "$tmpdir/SKILL" --version <版本号> --changelog "vX.Y.Z: 简短变更说明" && rm -rf "$tmpdir"
```

> **Skill 分发铁律**：
> - 唯一发布源 = `./SKILL` 目录（不是 FDE）
> - 两个平台 slug 统一 = `sofagent`（SKILL/SKILL.md frontmatter 的 slug 字段是 SSOT）
> - ClawHub 同版本号不可覆盖——dev 分支不要预发 Skill（会占用正式版本号）
> - skillhub CLI 无 `skill` 子命令，直接 `skillhub publish <path> --version X.Y.Z`
> - 两个平台每次发版都要推，一个都不能少

---

## 步骤二：DSH plugin 分发（每版必做） ☐

> **背景**：SkillHub 支持 DeepSeek Harness plugin 分发。sofagent 的 DSH plugin 家族（`cordis-plugin-sofagent*`，**7 个**：6 款原子 audit/rollback/inject/evolve/daemon/fde + 1 款聚合 `cordis-plugin-sofagent`——款数以 glob 实测为准，曾为 10 后经归并收口）**每版都要在 SkillHub 发布**——与 SKILL 分发并列，是 DSH 生态的发现层补充（npm 发布仍走主线，两者并行不互替）。

```bash
# 发布前确认 plugin 家族清单（SSOT = engine/dsh-plugins/ 目录实数 + 各版开发日志 plugin 家族表）
# 🔴 实际目录是 engine/dsh-plugins/cordis-plugin-sofagent*（前缀 cordis-plugin-sofagent——
#   聚合插件是**裸名**，glob 不带尾横线才不漏它）
PLUGIN_DIRS=$(ls -d engine/dsh-plugins/cordis-plugin-sofagent* 2>/dev/null || echo "")

# 🔴 发布坑（发布前必读）：
#   ① 各 plugin 目录已含静态 SKILL.md（skillhub 直接读它发布——不再需要临时目录组装）。
#      ⚠️ bump 版本时必须同步 SKILL.md frontmatter 的 version
#      字段（与 package.json 同步——bump-version.sh 覆盖范围内，见检查项）
#   ② 发布限流：skillhub 连续发布报「发布频率过高」——每次 publish 之间 sleep 20；
#      偶发仍命中限流时等 60s 补发该款即可
#   ③ changelog 中文禁止按字节截断（head -c 炸 UTF-8 0xe5）——用 node 按码点处理
# 逐 plugin 发布（版本号与 sofagent 主线版本对齐）
for pdir in $PLUGIN_DIRS; do
  name=$(basename "$pdir")
  # 清理 .DS_Store / .png（与 SkillHub SKILL 分发同规矩）
  find "$pdir" -name '.DS_Store' -delete && find "$pdir" -name '*.png' -delete
  # 先查现有版本，同版本号不可覆盖
  # ⚠️ skillhub verify 只对「已安装」skill 生效（未安装报 ENOENT）——发布前查远端版本
  #    无可用子命令，对账依据 = 发布时 CLI 的 OK/Published 输出（保留终端记录即可）
  skillhub verify "$name" 2>&1 | grep version || true
  skillhub publish "$pdir" --version <版本号> --changelog "vX.Y.Z: $(head -1 "$pdir/README.md" 2>/dev/null || echo "$name")" \
    && echo "✅ $name 已发布到 SkillHub" || echo "❌ $name 发布失败"
  sleep 20   # 限流间隔
done
```

> **DSH plugin 分发铁律**：
> - 发布源 = 各 cordis-plugin 包目录（`engine/dsh-plugins/cordis-plugin-sofagent*`，不是 SKILL/，SKILL 是方法论分发，plugin 是引擎能力分发）
> - 版本号 = 与 sofagent 主线版本对齐（DSH Cordis 协议 breaking change 时 bump major）
> - 🔴 **款数必须等于 glob 实测数**：正文枚举与下方 `PLUGIN_DIRS` 的 glob 是同一份清单的两种写法，改一个必改另一个——不一致时按文字走就会漏发（带尾横线的 glob 漏掉裸名聚合插件）
> - 每版发版都要推，与 ClawHub/SkillHub SKILL 分发同等强制
> - 分发通道真相源：**DSH plugin = SkillHub + npm 双通道**——`skillhub install cordis-plugin-sofagent*` 是 SkillHub 侧的安装与发现通道；**npm 侧七款同样是发布物**（逐款上 registry 见 [09-publish「步骤八·补」](./09-publish.md)），故「npm 可装」不再是禁语。⚠️ 但 npm 通道的**可用性前置**是干净 DSH 环境逐款实装四段验证（挂载 → seam 订阅 → helpers.call 引擎包解析 → 事件触发产出）——**不满足「单独可用」的不得发布**，故文档声称 npm 可装前须先有该验证留证

## 步骤二·a：OpenClaw plugin 分发（每版必做）

> **背景**：OpenClaw plugin 家族（约束层能力在 OpenClaw 生态的插件形态）**每版都要在 ClawHub plugins 发布**——与 DSH plugin 家族（SkillHub）分属两个生态：**ClawHub = OpenClaw 运行时 / SkillHub = DSH 运行时，各发各的**。clawhub CLI 已支持 `package publish`（code-plugin / bundle-plugin）。

> **前置（缺一不可）**：
> - 登录态：先 `clawhub whoami` 确认已登录（发布走 ClawHub 账号）
> - **源码已 push**：ClawHub 发布是 **source-linked 机制**——发布时从 `github:KongFangXun/sofagent@main:<plugin目录>` 拉源码，**必须先 push 到 GitHub 再发布**（dry-run 可验证映射，真实发布依赖远端文件存在）
> - **`openclaw.build.openclawVersion` 必填**：package.json 的 `openclaw.build.openclawVersion`（= 当前 OpenClaw 版本，`npm view openclaw version` 查）——缺失时 dry-run 报「required for external code plugins」
> - **双 manifest 版本一致**：ClawHub 校验 `package.json` 与 `openclaw.plugin.json` 两层 version 必须一致且 = 目标版本——bump 后先跑 `bash tools/check/check-version.sh`（9c 段已覆盖双 manifest），漂移直接被拒
> - 先 `--dry-run` 验证格式与 source 映射，再真实发布

> **publish 输出歧义判读**：真实发布输出「Fix: Align the plugin version...」是**自动修复提示非拒收**——发布已成功。重试报「Version already exists」也是已发布证据。**定性唯一通道**：API 查证 `https://clawhub.ai/api/v1/packages/<name>?ownerHandle=<handle>`（🔴 必须 `https://` 前缀——裸 `clawhub.ai/...` 被 curl 当本地路径静默失败返回空，对账假红）的 `latestVersion` + `scanStatus` + `verification.sourceCommit`，勿据 CLI 输出盲改版本号。另两条实测补充：① **服务端内存瞬断**——Convex `512 MB out of memory (reset in 48s)` 是平台侧限流非包问题，等 ≥60s 重发即成；② **scan=suspicious 未必是问题**——包内含 `*.test.js` 会触发扫描器启发式（同批无 test 文件的包 clean），按 verify 快照纪律判「新引入 vs 历史遗留」后再处置。

```bash
# 发布前确认 plugin 清单（SSOT = engine/openclaw-plugins/ 目录实数 + 各版开发日志家族表）
# 🔴 实际目录是 engine/openclaw-plugins/sofagent-*（前缀 sofagent-，不是 openclaw-plugin-）
OPENCLAW_PLUGIN_DIRS=$(ls -d engine/openclaw-plugins/sofagent-* 2>/dev/null || echo "")

# 逐 plugin 发布（版本号与 sofagent 主线版本对齐）
for pdir in $OPENCLAW_PLUGIN_DIRS; do
  name=$(basename "$pdir")
  # ① dry-run 验证（source 映射 + 格式，不上传）
  clawhub package publish "$pdir" --family code-plugin --name "$name" --version <版本号> --dry-run || exit 1
  # ② 先查现有版本，同版本号不可覆盖
  clawhub package verify "$name" 2>&1 | grep version || true
  # ③ 真实发布（--display-name 传中文品牌名）
  clawhub package publish "$pdir" --family code-plugin --name "$name" --display-name "$name" --version <版本号> \
    --changelog "vX.Y.Z: $(head -1 "$pdir/README.md" 2>/dev/null || echo "$name")" \
    && echo "✅ $name 已发布到 ClawHub plugins" || echo "❌ $name 发布失败"
done
```

> **OpenClaw plugin 分发铁律**：
> - 发布源 = `engine/openclaw-plugins/sofagent-*` 包目录（与 DSH plugin 家族分开，别混；前缀是 sofagent-，不是 openclaw-plugin-）
> - 发布通道 = **ClawHub plugins**（`clawhub package publish --family code-plugin`）——注意 ClawHub 的 `skill publish` 与 `package publish` 是两条独立命令
> - 🔴 **版本不可变**：ClawHub package 通道**拒绝覆盖已发布版本**（`Version X.Y.Z already exists. Increment the version number and try again.`）——与 skill 通道「同版本可 `Update submitted` 更新」**行为不同**。含义：发版后发现的插件缺陷修复**无法在原版本号上重发**，只能随下一版号发布；发版前插件侧的修复必须全部赶在 publish 之前落定，publish 之后发现的缺陷记入下一版 BugFix 批
> - 发布遇 Convex 512MB OOM（服务端内存限，CLI 报 `Node.js action execution ran out of memory`）属平台瞬时态：等待提示的 reset 时长（约 1 分钟）后重试即可
> - **必须先 push 再发布**（source-linked 从 GitHub 拉源码；未 push 时真实发布失败，dry-run 只能验证格式）
> - 版本号 = 与 sofagent 主线版本对齐（同 DSH 家族机制）
> - 每版发版都要推，与 SKILL / DSH plugin 分发同等强制

---

## 步骤二·b：GitHub Marketplace 分发（每版必做） ☐

> **背景**：sofagent 的 GitHub Action 形态（action.yml）已上线 GitHub Marketplace（listing：`github.com/marketplace/actions/sofagent`，Primary=Code review / Secondary=Utilities）。marketplace 版本列表跟随 release——**每次发新版，release 发布时必须勾选 Publish to Marketplace**，否则该版本不出现在 marketplace 版本页。
>
> **勾选自动延续核查**：每版勾选后 listing 关联自动延续——release 发布后先 curl 核查版本页是否已含本版号，含即免网页操作：`curl -s https://github.com/marketplace/actions/sofagent | grep vX.Y.Z`。未含才走下方网页操作。

**操作（release 编辑页，网页操作——仅当上方核查未见本版时）**：

1. 打开仓库 Releases 页 → 找到本版 release → 右侧铅笔 **Edit**
2. 勾选 **「Publish this Action to the GitHub Marketplace」**
3. 核对类目不变（Code review / Utilities），**勿勾 pre-release**
4. 底部 **Update release** → 2FA 验证 → 即时生效

**铁律**：

- 🔴 **action.yml 的 `name: 'sofagent'` 不得改动**——marketplace 按 name 关联 listing，改名 = 原 listing 失联
- 🔴 **description ≤ 125 字符（Unicode 码点）**——marketplace 校验硬门槛，中英混排易超限；安全模式 = 英文主句 + 短中文后缀
- 🔴 **新建 release 会撞已有 tag 报「invalid tag」**——marketplace 发布走**编辑已有 release** 路径（action.yml 文件页横幅的 Draft a release 仅首次/新 tag 用）
- listing 元数据（name/description/icon/color）读**默认分支当前 action.yml**——改描述后 push 即生效，与 release 无关
- 引用方 workflow 钉 tag（`KongFangXun/sofagent@vX.Y.Z`），新版不改变已有用户行为
- 发版时 action.yml 内 `npx -p @sofagent/audit@X.Y.Z` 版本号同步 bump（既有铁律，见文件头注释）

**Release Notes 升级注意事项（每版检查一次）**：git hook（commit-msg/post-commit）是**拷贝**而非软链——本版 hook 行为有变更时（查 engine/audit/hooks/ 头部版本号是否 bump），release notes 须加一条「**升级后需重装 git hook**：`sofagent-audit --install-hook`（每个装过 hook 的仓库逐个重装）」。install.sh 升级路径有版本落后提示，但用户不重跑安装脚本就感知不到——release notes 是最后一块告知面。

---

## 步骤三：设备端安装 ☐

```bash
# 1. 全局包更新（audit + core）
npm install -g @sofagent/audit@latest @sofagent/core@latest
sofagent-audit --version   # 确认 registry 版本
sofagent-core --doctor     # 期望全部通过

# 2. Skill 同步（WorkBuddy + OpenClaw 双平台）
# 🔴 主入口必须单独 cp：SKILL/harness/ 只有流程文件、不含 SKILL.md 主入口——
#    只 cp harness/* 会让本地 skill 主入口停在旧版（版本号核对会立刻暴露）
cp SKILL/SKILL.md ~/.workbuddy/skills/sofagent/SKILL.md
cp -r SKILL/harness/* ~/.workbuddy/skills/sofagent/
cp SKILL/SKILL.md ~/.openclaw/skills/sofagent/SKILL.md
cp -r SKILL/harness/* ~/.openclaw/skills/sofagent/
# 🔴 sofagent-fde 目录的主入口来自子 skill（SKILL/agents/fde/），不要用主 SKILL.md 覆写——
#    同名文件，写入顺序决定净结果（主入口被随后回写才侥幸正确），属顺序耦合
cp SKILL/agents/fde/ ~/.workbuddy/skills/sofagent-fde/ 2>/dev/null || echo "FDE 目标目录不存在，跳过"
cp SKILL/agents/fde/ ~/.openclaw/skills/sofagent-fde/ 2>/dev/null || echo "FDE 目标目录不存在，跳过"
cp -r SKILL/agents/audit/ ~/.workbuddy/skills/sofagent-audit/
cp -r SKILL/agents/audit/ ~/.openclaw/skills/sofagent-audit/

# 3. 最终验证
bash tools/check/check-version.sh   # 全绿
# 本地 Skill 主入口版本核对（期望 = 本版号；不匹配 = cp 路径漂移）
for f in ~/.workbuddy/skills/sofagent/SKILL.md ~/.openclaw/skills/sofagent/SKILL.md; do
  printf "%-50s %s\n" "$f" "$(grep -m1 '^version' "$f")"
done
```

---

## 步骤四：npm 渠道门面检查（每版必做） ☐

> **定位**：npm 是实测主分发渠道（`@sofagent/audit` 月下载 4848 vs 43 star，113:1），但门面投入曾全部压在 GitHub——渠道门面错配（审查实证）。本步骤每版分发时固定巡检 npm / GitHub / 官网三个「被找到」入口。仓内数字断言（description 工具数/插件数/homepage https）由 `bash tools/check/check-storefront.sh` 守护，此处补齐它不覆盖的面：

```bash
# 1. 裸名守护——期望指向本仓总包 sofagent（engine/umbrella/ 发版物）；版本对账由 check-storefront 断言 ④ 守护
npm view sofagent name version 2>&1 | head -2
# 2. npm 包页 README（@sofagent/audit 的 npm 门面 = 安装者看到的第一屏，须与仓库首屏一致）
npm view @sofagent/audit readme | head -20
# 3. GitHub description/topics 品类词（搜索流量入口；拍板口径：可搜索品类词前置，自造词殿后）
gh repo view --json description,repositoryTopics -q '.description, .repositoryTopics[].name'
# 4. 官网门面（源码不在本仓 = 仓内门禁盲区）：文档链接可达性人工核查
#    （审查实证 3 链接 404：文档已下沉 docs/、FDE.md 实为 GUIDE.md）
curl -sI https://sofagent.ai | head -1
```

- **裸名状态（v1.4.6 起总包正式态）**：裸名 `sofagent` 升级为聚合安装入口（`engine/umbrella/`，bin `sofagent` 薄转发 @sofagent/audit CLI + dependencies 四功能包 audit/mcp/orchestrator/daemon）——`npm i -g sofagent` 一条命令装齐全功能，与 install.sh 等效。前态 `0.0.1` 占位包（防抢注壳）无需 unpublish，总包随主线跳版发布后 latest 自动指向本版。每版 publish 后做一次直觉安装冒烟：`npm i -g sofagent` → `sofagent --help` 可跑 → `npm r -g sofagent` 还原。
- **官网改版是仓外动作**：官网源码不在本仓，本步骤只能「发现」不能「修复」——发现 404 / 口径漂移后转项目负责人处理仓外源码（短期可先下掉官网 about 中失效的描述段，止血优于留死链）。
