# 阶段十：发布流水线

> **项目负责人亲手执行，或授权 AI 代执行。**
>
> **本阶段只做 npm 发布流水线（狗粮→检查→push→tag→release→npm publish）。分发（Skill / DSH plugin / OpenClaw plugin / 设备端安装）见 [11-distribute.md](./11-distribute.md)。**

---

## 前置：lock file + 内部依赖一致性

```bash
# lock file 更新（新增 workspace 包或改了依赖时必须，否则 CI npm ci 报 Missing）
npm install

# lock file 与 package.json 一致性验证（CI 用 npm ci 严格模式）
npm ci --dry-run 2>&1 | grep -q "missing\|error" && echo "❌ lock 不一致" || echo "✅ lock 一致"

# 内部 @sofagent/* 依赖版本同步检查（bump 后所有内部依赖必须是同一版本）
# ⚠️ v1.4.0 升级：必须扫全部 4 个 section（dependencies/devDependencies/peerDependencies/optionalDependencies）
#    + action.yml 的 npm 包@版本格式（@sofagent/audit@1.3.9）——2026-08-23 实证 bump 中断后 mcp 的
#    optionalDependencies（@sofagent/daemon）和 action.yml 各漏 1 处，check-version 抓出才补上
grep -rn '"@sofagent/' engine/*/package.json | grep -v "$(node -p "require('./package.json').version")" | grep -v "^.*:.*\"dev\|peer"
# 期望：无输出（所有内部依赖版本 = 当前版本）。有输出 = 某些包的内部依赖版本未同步 bump
grep -n '@sofagent/[a-z-]*@[0-9]' action.yml | grep -v "$(node -p "require('./package.json').version")"
# 期望：无输出（action.yml 的 @sofagent/*@版本 全部 = 当前版本）
```

---

## 步骤一：本地安装（狗粮）

> 全部验证通过、准备发布时，先把最新版装到本机——全局 npm 和本地 Skill 同步。这是发布前的最后一块狗粮。

```bash
# 全局安装最新 audit（从本地源码，不走 registry）
cd engine/audit && npm run build && npm install -g . && cd ../..
sofagent-audit --version  # 确认版本号

# 本地 Skill 同步（WorkBuddy + OpenClaw）
# 🔴 v1.4.0 收尾发现：SKILL/harness/ 只有流程文件、没有 SKILL.md 主入口——
#    只 cp harness/* 会让本地 skill 主入口停留在旧版（v1.4.0 实况：本地 1.3.6 vs 源头 1.4.0，
#    fde/audit 子 skill 因单独 cp 是对的）。主入口必须单独 cp，且 cp 后 grep version 验证
cp SKILL/SKILL.md ~/.workbuddy/skills/sofagent/SKILL.md
cp -r SKILL/harness/* ~/.workbuddy/skills/sofagent/
cp SKILL/SKILL.md ~/.openclaw/skills/sofagent/SKILL.md
cp -r SKILL/harness/* ~/.openclaw/skills/sofagent/
cp SKILL/SKILL.md ~/.workbuddy/skills/sofagent-fde/
cp -r SKILL/agents/fde/ ~/.workbuddy/skills/sofagent-fde/
cp -r SKILL/agents/audit/ ~/.workbuddy/skills/sofagent-audit/
cp -r SKILL/agents/fde/ ~/.openclaw/skills/sofagent-fde/
cp -r SKILL/agents/audit/ ~/.openclaw/skills/sofagent-audit/
grep -m1 "^version" ~/.workbuddy/skills/sofagent/SKILL.md  # 期望 = 当前版本号，不匹配 = cp 路径漂移

# dogfood
sofagent-audit --doctor
```

---

## 步骤二：发布前检查

> push 前不模拟 CI 跑的检查 = 每次都 push→红叉→修→push 循环。以下检查**本地先跑一遍全绿再 push**。

```bash
# 推前预检全绿
bash tools/release/pre-push-check.sh

# 文档预算 + 死链 + Skill 行数（pre-push-check 内含，但发布前必须单独显式跑一次确认）
bash tools/check/check-docs.sh

# 测试数文档同步门禁（v1.3.4 教训：bugfix/dev/dsh 三阶段均漏此步，每次新增测试后文档声称数漂移）
# 必须在发布前显式跑——check-test-count.sh 校验 README/WIKI/LIMITATIONS/ARCHITECTURE 的测试数与 test-count.sh SSOT 一致
bash tools/check/check-test-count.sh --quiet
# 期望输出 OK / EXIT=0。FAIL = 有文档测试数漂移，必须修后再 push

# CI shellcheck workflow 单独跑（pre-push-check 内含，但 CI 扫描范围可能不同）
shellcheck engine/scripts/*.sh tools/*.sh install.sh

# CI 核心检查本地模拟（push 前先跑，避免 push→红叉→修循环）
npm test
npm run build

# daemon CI 模拟（fake HOME 跑 foreground daemon 验证 daemon.json 生成）
# CI runner 无 fde.md、无 ~/.sofagent/data → config.sh 可能静默崩溃（set -e）
# CI 同款姿势（v1.3.7 修正：SOFAGENT_HOME=/tmp 会触发 data-paths 越界守卫回退——
# 与 daemon-macos-ci.yml 对齐：仓库内 .sofagent + daemon.sh + sleep 35）
rm -rf .sofagent && mkdir -p .sofagent
SOFAGENT_DATA="${PWD}/.sofagent" engine/scripts/daemon.sh --foreground > .sofagent/daemon-stdout.log 2>&1 &
DAEMON_PID=$!; sleep 35; kill $DAEMON_PID 2>/dev/null
# 验证 daemon.json 能正常生成
[ -f .sofagent/daemon.json ] && echo "✅ daemon CI 模拟通过" || { echo "❌ daemon.json 未生成"; tail -6 .sofagent/daemon-stdout.log; }
rm -rf .sofagent

# npm 包洁净度 + 类型检查（逐包：.js.map 泄露 + README 非空 + tsc --noEmit）
for pkg in engine/*/; do
  [ -f "$pkg/package.json" ] || continue
  pkgname=$(basename "$pkg")
  echo "=== $pkgname ==="
  # .js.map 泄露
  maps=$(cd "$pkg" && npm pack --dry-run 2>&1 | grep -c '\.js\.map' || true)
  [ "$maps" -gt 0 ] && echo "  ⚠️ 含 .js.map（$maps 个）"
  # TypeScript 类型检查
  (cd "$pkg" && npx tsc --noEmit 2>&1 | grep -q "error" && echo "  ❌ tsc 有错误" || echo "  ✅ tsc")
  # README 非空
  if [ -f "$pkg/README.md" ]; then
    size=$(wc -c < "$pkg/README.md" | tr -d ' ')
    [ "$size" -lt 10 ] && echo "  ❌ README.md 内容过少（$size bytes）"
  fi
done
# load-chain 单独检查（路径不同）
(cd engine/hooks/sofagent-load-chain && npm pack --dry-run 2>&1 | grep -c '\.js\.map')  # 期望 0
(cd engine/hooks/sofagent-load-chain && npx tsc --noEmit && echo "✅ load-chain tsc")
echo "npm 包洁净度 + 类型检查完成"
```

---

## 步骤三：push 前置检查（v1.3.6 实战补 · 双 SHA 历史坑）

> v1.3.5 Git Data API 推送会造成远端/本地「同 tree 双 SHA」——直接 push 会被 rejected (fetch first)。本地代理死时用 `git -c http.proxy= -c https.proxy= push` 直连。

```bash
# ① 检查远端头是否在本地历史（双 SHA 分叉探测）
REMOTE_SHA=$(gh api repos/KongFangXun/sofagent/branches/main --jq '.commit.sha')
git merge-base --is-ancestor "$REMOTE_SHA" HEAD && echo "✓ 快进可推" || \
  git rebase --onto "$REMOTE_SHA" <本地等价旧commit> main   # tree 相同时干净接回
# ② tag 顺序铁律：先安装入口 bump commit（步骤五），后打 tag（tag 内容就该指本版）
```

## 步骤四：push main + 等 CI 全绿

> **tag 先行策略**（v1.3.2 起统一）：先 push main → 等 CI 全绿验证 → 才打 tag。tag 一定指向 CI 验证过的 commit，不会 tag 了之后才发现 CI 红。
>
> 🔴 **push 前置检查：workspace 包与 lock 同步（v1.4.0 教训）**：本版新增了 workspace 包（cordis-plugin 家族）但 lock file 未同步——push 后 4 个 CI 工作流（pr-check/verify/audit/windows-ci）在 `npm ci` 严格校验上**同根因全红**（本地 `npm install` 会静默补齐所以本地全绿，CI `npm ci` 直接炸）。**push 前必跑**：`npm ci --dry-run 2>&1 | grep -c "^npm error Missing"` 期望 0——非 0 则 `npm install --package-lock-only` 补齐 lock 后随代码同 commit。
>
> 🔴 **CI 全绿是打 tag 的硬前置（2026-08-19 用户拍板强化）**：push 之后必须**轮询等到全绿**（不是看一眼就走）——`exit 0` 之前禁止进入步骤六。历史教训：CI 红着打 tag 会让用户装到坏版本（tag 是安装入口的锚点），回滚成本远高于等待 2-5 分钟。**轮询必须前台执行**：上述 while 循环在 session 前台逐轮跑（每轮一查 + sleep 60），严禁包进 run_in_background——挂后台 = session 空闲 = 界面无进展反馈。轮询脚本如下（循环跑直到 exit 0，每次间隔 60s）：

```bash
# ── push main ──
git push origin main

# ── 轮询 CI 直到全绿（循环执行本段，exit 0 才继续）──
while true; do
  gh run list -b main -L 8 --json status,conclusion,name | node -e '
const runs = JSON.parse(require("fs").readFileSync("/dev/stdin","utf8"));
let pending = 0, failed = 0;
for (const r of runs) {
  const status = r.status || "";
  const conclusion = r.conclusion || "";
  const icon = conclusion === "success" ? "✅" : conclusion === "failure" || conclusion === "cancelled" ? "🔴" : "⏳";
  console.log(`${icon} ${r.name}: ${conclusion || status}`);
  if (status === "in_progress" || status === "queued") pending++;
  if (conclusion === "failure" || conclusion === "cancelled") failed++;
}
if (pending > 0) { console.log(`\n⏳ ${pending} 个 CI 运行中，60s 后重查`); process.exit(2); }
if (failed > 0) { console.log(`\n🔴 ${failed} 个 CI 失败，必须修复后重新 push`); process.exit(1); }
console.log("\n✅ CI 全绿，可以打 tag");
'
  RC=$?
  [ "$RC" -eq 0 ] && break
  [ "$RC" -eq 1 ] && { echo "🔴 CI 失败：gh run view --log-failed 定位 → 修 → push → 重等"; exit 1; }
  sleep 60
done
# exit 2 = 还在跑（循环重查） / exit 1 = 有失败（定位 → 修 → push → 重等，禁止打 tag） / exit 0 = 全绿
```

---

## 步骤五：安装入口随版同步（v1.3.6 新增 · fresh-eyes B1 根因）

> 🔴 历史教训：v1.3.5 发布后 README/bootstrap 安装 URL 仍指 v1.3.4，用户按 README 完整安装装到旧版。根因是 SOP 没有这一步——tag 打了、npm 发了，安装入口没人管。**每版必做，curl 验证后才能进步骤七。**

```bash
# ── 三处安装入口 tag 对账 ──
grep -rn "refs/tags/v" README.md README.en.md bootstrap.sh
# 期望：三处均为 refs/tags/vX.Y.Z（本版 tag），无一残留上一版

# ── 不一致则同步修改三处后，逐条 curl 验证 HTTP 200 ──
#   README.md / README.en.md 安装段的 bootstrap.sh URL
#   bootstrap.sh 的 INSTALL_URL + 文件头用法注释
for f in README.md README.en.md bootstrap.sh; do
  URL=$(grep -oE "https://raw\.githubusercontent\.com/KongFangXun/sofagent/refs/tags/v[0-9]+\.[0-9]+\.[0-9]+/[a-z.]+" "$f" | sort -u)
  for u in $URL; do
    code=$(curl -sI -o /dev/null -w "%{http_code}" "$u")
    [ "$code" = "200" ] && echo "✅ $u" || { echo "🔴 $u → HTTP $code"; exit 1; }
  done
done
```

> 注意：check-version.sh（v1.3.6 起）含安装入口 tag 对账检查项，`bash tools/check/check-version.sh` 会给出三方 tag 一致性结论；此处 curl 是最后一道实测防线（URL 真实可达性）。

### 🔴 bootstrap.sh sha256 同步（v1.4.3 P2-f 新增 · 每版必做）

> bootstrap.sh 自 v1.4.3 起对下载的 install.sh + 6 个 lib 文件做 sha256 校验（curl | bash 信任模型加固）。**tag 指向新版后哈希必然变化——必须同步更新 bootstrap.sh 内嵌的 7 个哈希，否则用户安装会因校验失败而 fail-closed（好陷阱：宁可不装也不装被劫持的脚本，但会让所有人装不上）。**

```bash
# ── 新 tag 打好后，在 bootstrap.sh 顶部更新两处后提交 ──
# ① INSTALL_SHA256（install.sh）：
git show vX.Y.Z:install.sh | shasum -a 256
# ② LIB_SHA256S（6 个 lib 文件，顺序与 LIB_FILES 一致）：
for f in platform-detect.sh file-deploy.sh daemon-register.sh post-install.sh daemon-lib.sh config.sh; do
  git show "vX.Y.Z:engine/scripts/lib/$f" | shasum -a 256
done
# ③ 提交后用 mock curl 篡改场景自测 fail-closed 仍生效（见 bootstrap.sh 头注释）
```

---

## 步骤六：git tag + push tag

```bash
# ── tag 前确认 ──
LAST_TAG=$(git describe --tags --abbrev=0 HEAD~1 2>/dev/null || echo "")
[ -n "$LAST_TAG" ] && echo "上一 tag: $LAST_TAG" && git log --oneline ${LAST_TAG}..HEAD | head -20
# 🔴 CI 全绿确认（步骤四的 exit 0 是进入本步骤的前提，不可跳过）
# 确认 check-version + check-test-count 全绿（tag 不得在代码/文档未就绪时打）
bash tools/check/check-version.sh && bash tools/check/check-test-count.sh --quiet

# ── 打 tag + push ──
git tag -a vX.Y.Z -m "vX.Y.Z · {一句话版本摘要}"
git push origin vX.Y.Z

# ── tag 后零 commit 校验 ──
TAG_SHA=$(git rev-parse vX.Y.Z^{commit})
HEAD_SHA=$(git rev-parse HEAD)
if [ "$TAG_SHA" = "$HEAD_SHA" ]; then
  echo "✅ tag 指向 HEAD（零游离 commit）"
else
  echo "🔴 tag ($TAG_SHA) ≠ HEAD ($HEAD_SHA)——tag 后有游离 commit"
  git log --oneline vX.Y.Z..HEAD
  echo "⚠️ 如果游离 commit 属于本版本，需要重新打 tag"
fi
```

> 🔴 **tag push 失败重试（v1.3.9 实战）**：`git tag -a` 本地打标成功但 push 可能被中断（实测 exit 137 SIGKILL / 超时）——此时**远端没有 tag，本地有**（`gh api repos/O/R/git/ref/tags/vX.Y.Z` 404 确认）。重试直接用「网络降级策略」的完整命令（剥代理 + HTTP/1.1 + 低速兜底）单独 push tag：`env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy git -c http.proxy= -c https.proxy= -c http.version=HTTP/1.1 -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=300 push origin vX.Y.Z`——push 完成后用 `gh api repos/O/R/git/refs/tags/vX.Y.Z --jq '.object.sha'` 确认远端存在，与本地 `git rev-parse vX.Y.Z` 一致。

---

## 步骤七：gh release（触发 release.yml 自动 publish audit + mcp）

> GitHub Release published 后，`.github/workflows/release.yml` 自动触发，publish `@sofagent/audit` 和 `@sofagent/mcp` 两个包到 npm。其余 10 包在步骤八手动 publish。

### Release Note 生成 → 自检 → 上一版结构对照（2026-08-19 用户拍板强化的三道工序 · 步骤七必做）

> 🔴 **历史痛点**：v1.3.0~v1.3.6 每次 release note 发布后都发现问题再改（title 漂移/质量表缺项/骨架不同构）——「改了再发」的成本是 npm 用户看到的第一个版本就是错的。从 v1.3.7 起：**release note 必须先过自检 + 上一版结构对照，才允许 gh release create**。三道工序缺一不可：

**工序一 · 按规范生成**：严格按下方「Release Notes 格式规范」生成 body（title 主题短语 / 首行定位句 / 核心变更功能领域式 / 质量验证固定 7 项 / 尾链）。

**工序二 · 生成后自检（跑脚本，不看感觉）**：

```bash
# ① 质量验证表必须恰好 7 项（不可增减——v1.3.0/1.3.1 缺 release-gate/fresh-eyes 的教训）
echo "$BODY" | grep -c "^| "   # 期望 7 个表行（表头 2 行不算，从「npm test」数到「fresh-eyes」）

# ② H2 骨架与上一版同构（结构对照七要素见工序三）
echo "$BODY" | grep -E "^## "          # 期望输出 ## 🔨 核心变更 与 ## ✅ 质量验证
gh release view v上一版 --json body -q '.body' | grep -E "^## "

# ③ 固定 7 项逐字核对（每项必须在质量表中出现一次）
for item in "npm test" "acceptance-test" "shellcheck" "check-version" "回归检查" "release-gate" "fresh-eyes"; do
  echo "$BODY" | grep -q "$item" && echo "✅ $item" || echo "🔴 缺 $item"
done

# ④ 尾链存在且为 markdown 链接语法
echo "$BODY" | grep -qE '\[详细开发日志\]\(\./docs/changelog/' && echo "✅ 尾链" || echo "🔴 缺尾链"

# ⑤ 定位句长度 ≤ 220 字符（N9 铁律——v1.4.0 曾 321 字符被退回）
POS_LEN=$(echo "$BODY" | head -1 | awk '{print length($0)}')
[ "$POS_LEN" -le 220 ] && echo "✅ 定位句 $POS_LEN 字符" || echo "🔴 定位句 $POS_LEN 字符超 220 上限——拆 H3 承载"

# ⑥ BugFix 节标题逐字核对（N10——有 bugfix 节时必须带「（上版遗留）」补语）
echo "$BODY" | grep -E "^### 🔒" | grep -q "BugFix（上版遗留）" && echo "✅ BugFix 标题合规" || echo "🔴 BugFix 标题漂移（缺「（上版遗留）」补语）"

# ⑦ 里程碑 🎉 前缀规则（N11——仅 vX.Y.0 可用 🎉 vX.Y.Z — 格式；常规版尾部禁装饰）
echo "$TITLE" | grep -qE "^🎉 v[0-9]+\.[0-9]+\.0 — " && echo "✅ 里程碑格式（X.Y.0）" || echo "$TITLE" | grep -qE "^🎉" && echo "🔴 非 X.Y.0 版误用 🎉 前缀" || echo "✅ 常规版格式"
```

**工序三 · 上一版结构对照（2026-08-19 用户拍板：取代人工过目）**：自检全过后，与上一版 release body 做**结构级并排对照**——title 形式（`vX.Y.Z — emoji 短语`，里程碑 `🎉 vX.Y.0 —` 前缀规则见 N11）/ 定位句有无 + 长度（N9 ≤220 字符）/ H2 骨架 / 质量表 7 项顺序 / BugFix 节标题逐字（N10）/ 尾链位置，七要素逐一比对上一版，**结构不一致即重写，直到同构**。机制标准 = **v1.3.7 实际发布物（2026-08-20 用户拍板的标准锚点，见 06-doc-finalize.md Release Notes 段）**——若上一版漂移（v1.3.8 曾两次漂移被作者退回），以 v1.3.7 为准重写，不追随上一版。对照命令：`gh release view v1.3.7 --json name,body -q '{name, body}'`（锚点）+ `gh release view 上一版 --json name,body`（漂移检测）。

```bash
> 🔴 **发布前必做（v1.3.6 教训）**：生成 body 后先与上一版并排对照——`gh release view v上一版 --json body -q '.body' | grep -E "^## "`——两版 H2 骨架必须同构（首行定位句/核心变更/破坏性变更/质量验证/尾链）。**changelog 内嵌的 Release Notes 段 ≠ GitHub Release body**：前者归 08 的 N1-N7 管（✨ 新功能 bullet 式），后者归本规范管（### 功能领域子标题式）——分别核对，禁止把 changelog 段直接复制当 body。

gh release create vX.Y.Z --title "vX.Y.Z — {emoji 主题短语}" --notes "$(cat <<'EOF'
{emoji 主题短语与 title 呼应}——{一句人话说明这版对用户意味着什么}

## 🔨 核心变更

### {功能领域 1}
- {变更点 1}
- {变更点 2}

### {功能领域 2}
- {变更点}

### BugFix（上版本遗留）
- {修复点}

## ✅ 质量验证

| 检查项 | 结果 |
|------|:--:|
| npm test | {N} tests 全绿 ✅ |
| acceptance-test | {N}/{N} 场景全绿 ✅ |
| shellcheck | 零 error ✅ |
| check-version | 71/71 全绿 ✅ |
| 回归检查 | {N} 维度 ✅ |
| release-gate | verdict=PASS ✅ |
| fresh-eyes | {N} 轮独立审查 ✅ |

📖 [详细开发日志](./docs/changelog/v{major}.{minor}/vX.Y.Z.md)  <!-- 链接相对仓库根（发布后 GitHub 上可达），在本文档内直接点击不可达 -->
EOF
)"
```

### Release Notes 格式规范

> **本节是 GitHub Release body 的强制规范——所有版本必须遵守，不可漂移。**
> 历史教训：v1.3.0/v1.3.1 的 release body 含「CI (8 workflows)」却缺 release-gate / fresh-eyes；v1.3.2/v1.3.3 反过来——四版四样。本规范把质量表 7 项钉死，禁止增减。

- **Title**：`vX.Y.Z — {emoji 主题短语} + {emoji 主题短语}`（常规，≤3 个短语）/ `🎉 vX.Y.Z — ...`（里程碑仅限 vX.Y.0，🎉 前缀在版本号前，不在短语尾部——N11）
  - **主题短语 ≠ 交付名清单**——title 讲主线故事（如「🏪 组织能力市场（L3 五环）」），不逐项罗列交付名（那是 note 新功能段的事）。**title 与 note 新功能禁止逐字重复**（2026-08-15 拍板，五版已统一修正）
  - 每个主题短语带语义 emoji；尾部不加装饰后缀（🎉/🔧 等历史漂移已清理）
- **Body 结构**（定位句 + 三段，固定顺序不可调）：
  0. **首行定位句**——`{emoji 主题短语呼应 title}——{一句人话}`，如「🏪 协作成果像内部应用商店一样流转——Skill/Agent/流程可发布、可评分、可退役，第三方 Skill 先过安全门。」，**≤220 字符**（N9，超线拆 H3 承载）。**禁止用旧 title 清单复读**（v1.3.1-1.3.3 历史遗留：body 首行挂着交付名清单，title 改了 body 没跟——2026-08-15 已统一修正）。与 title/H1 分工：title 点主题（名词短语）/ H1 讲故事（动词句）/ 定位句说人话（给用户的价值）
  1. `## 🔨 核心变更`——功能按重要性降序，安全修复优先于文档修复。每个变更点用 `-` 列表，一句话说清楚做了什么（不写「为什么」——那在开发日志里）
  2. `## ✅ 质量验证`——**固定 7 项表格**（见下方模板），结果列每项带 ✅，缺一项即视为体例不合规
  3. `📖 [详细开发日志](./docs/changelog/v<major>.<minor>/vX.Y.Z.md)`——必须用 markdown 链接语法，放最末

#### ✅ 质量验证表固定 7 项（不可增减）

```markdown
## ✅ 质量验证

| 检查项 | 结果 |
|------|:--:|
| npm test | {N} tests 全绿 ✅ |
| acceptance-test | {N}/{N} 场景全绿 ✅ |
| shellcheck | 零 error ✅ |
| check-version | 71/71 全绿 ✅ |
| 回归检查 | {N} 维度 ✅ |
| release-gate | verdict=PASS ✅ |
| fresh-eyes | {N} 轮独立审查 ✅ |
```

**为什么是这 7 项**：
- `CI (8 workflows)` 不单列——CI 跑的就是这 7 项的子集，单列等于重复
- `release-gate` 是发版闸门、`fresh-eyes` 是独立审查——两者是「是否值得发版」的质量证据，必须列
- v1.3.0/v1.3.1 缺这两项是因为当时还没跑通这两个 loop；v1.3.2+ 已跑通，禁止再省略

- **功能领域 emoji 按语义选**：🔧 功能 / 🛡️ 安全 / 📝 文档 / 🔍 审查 / 🆕 新建 / 📊 可视化 / ⚡ 自动化 / 🔗 集成 / 📦 打包 / 🎨 UI
- **不含审查元信息**（模型名、审查轮次内部代号、P0/P1 标签）——那是内部过程，用户看不懂。「{N} 轮独立审查」可写，但不写「GLM-5.2 / run-11 / P0-3」这种
- **测试数字写实际值**（从 `npm test 2>&1 | tail -5` 获取），不写约数
- **BugFix 段在核心变更最末**（不独立成 H2）——`### 🔒 BugFix（上版遗留）`逐字固定，补语不可省（N10，v1.4.0/v1.3.9 曾双版简写漂移），用 `-` 列表
- **与 changelog 内嵌「Release Notes」段的关系**：GitHub Release body = 面向 GitHub 用户（精炼版）；changelog 文件末尾的 `## Release Notes · vX.Y.Z` = 面向深度读者（含破坏性变更细节）。两者内容可重叠但读者层不同——GitHub body 偏精炼，changelog 段偏完整。

---

## 步骤八：npm 手动 publish 其余 10 包

> `npm publish --workspaces` 不支持 workspace 全局发布。release.yml 只 auto-publish audit + mcp（Release 触发），其余 10 包手动 publish。
>
> ⚠️ **v1.3.5 #30 勘误：`@sofagent/load-chain`（`engine/hooks/sofagent-load-chain/`）是第 13 个 workspace 包，不在下方循环里**——它不叫 `engine/<pkg>` 布局（在 `engine/hooks/` 下），历次发版都被「12 包」口径漏掉，npm 已落后（1.3.1 vs workspace 1.3.4）。v1.3.5 发版时必须补 publish，并把它加进下方两个循环与验证清单（此后按 13 包口径）。

```bash
# 等 release.yml 完成（通常 3-5 分钟），确认 audit + mcp 已到 npm
npm view @sofagent/audit@vX.Y.Z version  # 期望返回版本号
npm view @sofagent/mcp@vX.Y.Z version    # 期望返回版本号

# 手动 publish 其余 10 包——每包 publish 后立即 npm view 对账 + E409 自动等待重查
# 🔴 v1.4.0 教训：publish 输出严禁接管道过滤（| grep xxx）——skillopt 的 E409 报错被过滤吞掉，
#    表面循环跑完，实际漏发 1 包，13 包对账时才发现。输出必须全量落盘，失败立即停。
TARGET_VER=$(node -p "require('./package.json').version")
for pkg in core daemon eval harness ontology orchestrator rules skillopt think ab-test; do
  echo "--- @sofagent/$pkg ---"
  ( cd "engine/$pkg" && npm publish --access public ) > "/tmp/publish-$pkg.log" 2>&1
  RC=$?
  if [ $RC -ne 0 ] && grep -q "E409\|previously staged" "/tmp/publish-$pkg.log"; then
    # E409 staged：registry 侧版本占位未 finalize，约 5 分钟自动完成（见下方 E409 段）
    echo "  ⏳ E409 staged——等 300s 自动 finalize 后重查"
    sleep 300
    LIVE=$(npm view "@sofagent/$pkg" dist-tags.latest 2>/dev/null || true)
    if [ "$LIVE" = "$TARGET_VER" ]; then
      echo "  ✅ staged 已自动 finalize 为 $LIVE"
    else
      echo "  🔴 300s 后仍未 finalize（latest=$LIVE）——按下方 E409 段落人工处理"
      exit 1
    fi
  elif [ $RC -ne 0 ]; then
    echo "  🔴 publish 失败（exit $RC），完整报错："
    cat "/tmp/publish-$pkg.log"
    exit 1
  fi
  # 即时对账：publish exit 0 ≠ registry 已收录（npm 传播延迟约 15s），重查 3 次
  LIVE=""
  for i in 1 2 3; do
    LIVE=$(npm view "@sofagent/$pkg" version 2>/dev/null || true)
    [ "$LIVE" = "$TARGET_VER" ] && break
    echo "  ⏳ registry 传播中（查到 $LIVE），15s 后重查（第 $i 次）"
    sleep 15
  done
  [ "$LIVE" = "$TARGET_VER" ] && echo "  ✅ @sofagent/$pkg = $LIVE" || { echo "  🔴 对账失败：期望 $TARGET_VER 实际 $LIVE"; exit 1; }
done

# @sofagent/load-chain（布局在 engine/hooks/ 下，不进上面的循环——v1.3.5 #30 补，验证逻辑同上）
( cd "engine/hooks/sofagent-load-chain" && npm publish --access public ) > /tmp/publish-load-chain.log 2>&1
RC=$?
[ $RC -ne 0 ] && { echo "🔴 load-chain publish 失败："; cat /tmp/publish-load-chain.log; exit 1; }
LIVE=$(npm view @sofagent/load-chain version 2>/dev/null || true)
[ "$LIVE" = "$TARGET_VER" ] && echo "✅ @sofagent/load-chain = $LIVE" || echo "🔴 load-chain 对账失败：期望 $TARGET_VER 实际 $LIVE"

> 🔴 **E409「previously staged version」处理（v1.3.9 实战 · v1.4.0 修正）**：`npm publish` 网络中断会在 registry 留下 **staged blob**（发布事务中间态，版本号被占位但未 finalize）——同版本重发报 `409 Conflict - Cannot publish over previously staged version "X.Y.Z"`。**v1.4.0 实测修正：staged 版本约 5 分钟内自动 finalize**（skillopt 实证：E409 后等待约 5 分钟，`npm view dist-tags.latest` 即显示新版本，无需 unpublish）。处理顺序：① 先等 5 分钟重查 `npm view <pkg> dist-tags.latest`；② 仍未 finalize 再考虑 `npm unpublish <pkg>@<version> --force`（staged blob 独立于记录，unpublish 后 registry 主节点传播完成即可重发同版本）。⚠️ 与「npm 版本永久锁死」铁律不冲突——E409 staged 是**未 finalize 的占位**，可清除重发；已 published 的版本才不可覆盖。

---

## 网络降级策略

### 直连 push 与 HTTP/1.1（v1.3.7 实战补 · 本版三次断连实录）

> 本版（v1.3.7）push 三连失败实录：①git config 死代理（53957 端口）→ ②直连 443「Recv failure: Operation timed out」/「HTTP2 framing layer」→ ③HTTP/1.1 + 速度限制后成功。**经验：curl 能通 ≠ git 能通**（git 走 HTTP/2 + 慢连接更脆弱），git 侧强制 HTTP/1.1 + 慢速兜底最稳。

```bash
# 全配置一键直连（git config 代理 + 环境变量代理全剥）：
env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy \
  git -c http.proxy= -c https.proxy= -c http.version=HTTP/1.1 \
  -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=300 \
  push origin main
```

> curl 探测代理端口存活：`curl -s -o /dev/null -w "%{http_code}" -x http://127.0.0.1:<端口> https://github.com`——200 = 端口可用（但 git 仍可能因 HTTP/2 失败，直接上 HTTP/1.1）。

git push 超时时，gh CLI / clawhub / skillhub 走独立 API 通道不受影响：

```bash
# 确认 tag 已在远端
gh api repos/KongFangXun/sofagent/git/refs/tags/vX.Y.Z --jq '.object.sha'

# 先走 API 通道完成 release + Skill 分发（不依赖 main push）
gh release create vX.Y.Z ...
clawhub skill publish ...

# main push 后台重试
GIT_HTTP_LOW_SPEED_LIMIT=1000 GIT_HTTP_LOW_SPEED_TIME=15 git push origin main
```

sandbox 代理拦截 git HTTPS（exit 137）时：

```bash
# 剥离代理环境变量
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy git push --no-thin origin main

# tag 仍被 SIGKILL 时，用 gh api 建 tag（前提：commit 已在远端）
gh api repos/KongFangXun/sofagent/git/tags -X POST \
  -f tag=vX.Y.Z -f message="vX.Y.Z" \
  -f object="$(git rev-parse HEAD)" -f type=commit
gh api repos/KongFangXun/sofagent/git/refs -X POST \
  -f ref="refs/tags/vX.Y.Z" -f sha="$(git rev-parse HEAD)"
```


### main push 完全走 Git Data API（git push 死代理时 · v1.3.5 实战）

> 🛠 **v1.4.0 起优先用固化脚本**：`node tools/release/gitdata-push.mjs`——上述流程（blobs→trees→commits→refs PATCH + tree 一致性验收 + 删除补删 + mode 保真）已工具化，前置检查（工作树干净/远端实时 SHA）内置。脚本固化自 v1.3.8（82 commits）+ v1.4.0（阶段十二收尾）两次实战。**手工流程仅在脚本不可用时走下方步骤**（三坑/四坑原理同样适用脚本维护者）。

git push 彻底走不了（代理端口 127.0.0.1:53957 连不上）时，用 Git Data API 把本地 commit 内容推上去。核心 = 以远端 HEAD 为 parent 建「压平 commit」（blobs→tree→commit→ref，fast-forward 非 force）：

```bash
# 1. 对比本地 HEAD vs 远端 HEAD，算出需上传的 blob（path→本地 git blob sha）
#    注意：用 git ls-tree -r HEAD 拿本地 blob sha，不用工作区文件（见三坑②）
# 2. 逐文件上传 blob（⚠️ 三坑，见下）
gh api repos/O/R/git/blobs -X POST --input - -f /dev/stdin  # content 走 stdin
# 3. 建 tree：base_tree=远端HEAD的tree + 变更项（sha=新blob；删除项 sha=null）
gh api repos/O/R/git/trees -X POST --input tree.json
# 4. 建 commit：parent=远端HEAD，message 传完整正文（只传 subject 会致 SHA 不符）
gh api repos/O/R/git/commits -X POST --input commit.json
# 5. 更新 ref（fast-forward，parent 已=远端 HEAD 无需 force）
gh api repos/O/R/git/refs/heads/main -X PATCH -f sha=<新commit>
```

**🔴 三坑（v1.3.5 血泪，务必按此做）**：
1. **base64 内容禁用 `-f content=` 传参**——大文件 base64 超 ARG_MAX 报 `Argument list too long`。必须 `--input -` 从 stdin 传 JSON body（`{"content":"<base64>","encoding":"base64"}`）
2. **`.gitattributes` 的 eol 转换**——`*.ps1 text eol=crlf` 会让 git 存 LF 规范化 blob，工作区是 CRLF。上传必须用 `git cat-file blob <本地git sha>` 拿规范内容，不能读工作区文件（否则 sha 不一致）。**验证铁证：建 tree 后远端 tree sha == 本地 `git rev-parse HEAD^{tree}` = 逐字节一致**
3. **cat-file 必须用本地 git blob sha**——不能用「上传后 GitHub 返回的 sha」去 cat-file（本地无此对象 → 输出空 → 上传空 blob，sha 变 e69de29b）。修正时用 `git ls-tree` 重新拿本地 sha

**🔴 第五坑（v1.4.0 补 · 连续推送）——tree 参数必须 stdin JSON**：gh CLI 命令行拼 `tree[][path]=…` 数组参数，17 文件 = 68 个参数直接报 `accepts 1 arg(s), received 69`——tree 创建必须 `--input -` 从 stdin 传 `{"base_tree":…,"tree":[…]}` JSON（gitdata-push.mjs 已内置）。另：连续 API 推送时本地无上次 API commit 对象，`git diff <remoteSha>..HEAD` 炸——脚本用 compare API 兜底取变更清单（status=diverged 时拒绝盲推）。

**🔴 四坑（v1.3.8 补 · verify CI 失败根因）——tree 条目 mode 必须用本地真实值**：tree 每一项带 mode（`100644` 普通 / `100755` 可执行），**硬编码 `100644` 会让所有 .sh/.mjs 丢失执行位**——推送前 `git ls-tree -r HEAD | grep "^100755"` 列出全部可执行文件，tree 条目逐项用本地 mode。丢失后 verify CI 报「cleanup.sh 缺失或不可执行」（find 找到文件但 `-x` 检查失败）。**恢复只需一次操作**：blob SHA 只依赖内容，同一文件的 755 与 644 版本 blob SHA 相同——建一个只含 N 个 100755 条目的新 tree（base_tree=当前远端 tree，sha 引用已存在 blob）→ 建 commit → 更新 ref，无需重传内容。**推送完成必验**：远端 tree sha == 本地 `git rev-parse HEAD^{tree}`。
> 另：Git Data API 的 create-tree **无法表达删除条目**——rename（R100）在 diff 里是「新路径新增」，旧路径永远留在 base_tree；含删除/rename 的 commit 推送后必须用 Contents API（`gh api repos/O/R/contents/<path> -X DELETE -f sha=<file sha>`）逐个补删，最后同样以 tree sha 一致性收尾（v1.3.8 实测：82 commits 推送后补删 6 个残留 + 恢复 34 个执行位，最终 1162 blobs 零差异）。
