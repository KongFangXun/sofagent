# 阶段十一：发布

> **项目负责人亲手执行，或授权 AI 代执行。**

---

## 前置：lock file + 内部依赖一致性

```bash
# lock file 更新（新增 workspace 包或改了依赖时必须，否则 CI npm ci 报 Missing）
npm install

# lock file 与 package.json 一致性验证（CI 用 npm ci 严格模式）
npm ci --dry-run 2>&1 | grep -q "missing\|error" && echo "❌ lock 不一致" || echo "✅ lock 一致"

# 内部 @sofagent/* 依赖版本同步检查（bump 后所有内部依赖必须是同一版本）
grep -rn '"@sofagent/' engine/*/package.json | grep -v "$(node -p "require('./package.json').version")" | grep -v "^.*:.*\"dev\|peer"
# 期望：无输出（所有内部依赖版本 = 当前版本）。有输出 = 某些包的内部依赖版本未同步 bump
```

---

## 步骤 1：本地安装（狗粮）

> 全部验证通过、准备发布时，先把最新版装到本机——全局 npm 和本地 Skill 同步。这是发布前的最后一块狗粮。

```bash
# 全局安装最新 audit（从本地源码，不走 registry）
cd engine/audit && npm run build && npm install -g . && cd ../..
sofagent-audit --version  # 确认版本号

# 本地 Skill 同步（WorkBuddy + OpenClaw）
cp -r SKILL/harness/* ~/.workbuddy/skills/sofagent/
cp -r SKILL/harness/* ~/.openclaw/skills/sofagent/
cp SKILL/SKILL.md ~/.workbuddy/skills/sofagent-fde/
cp -r SKILL/agents/fde/ ~/.workbuddy/skills/sofagent-fde/
cp -r SKILL/agents/audit/ ~/.workbuddy/skills/sofagent-audit/
cp -r SKILL/agents/fde/ ~/.openclaw/skills/sofagent-fde/
cp -r SKILL/agents/audit/ ~/.openclaw/skills/sofagent-audit/

# dogfood
sofagent-audit --doctor
```

---

## 步骤 2：发布前检查

> push 前不模拟 CI 跑的检查 = 每次都 push→红叉→修→push 循环。以下检查**本地先跑一遍全绿再 push**。

```bash
# 推前预检全绿
bash tools/pre-push-check.sh

# 文档预算 + 死链 + Skill 行数（pre-push-check 内含，但发布前必须单独显式跑一次确认）
bash tools/check-docs.sh

# 测试数文档同步门禁（v1.3.4 教训：bugfix/dev/dsh 三阶段均漏此步，每次新增测试后文档声称数漂移）
# 必须在发布前显式跑——check-test-count.sh 校验 README/WIKI/LIMITATIONS/ARCHITECTURE 的测试数与 test-count.sh SSOT 一致
bash tools/check-test-count.sh --quiet
# 期望输出 OK / EXIT=0。FAIL = 有文档测试数漂移，必须修后再 push

# CI shellcheck workflow 单独跑（pre-push-check 内含，但 CI 扫描范围可能不同）
shellcheck engine/scripts/*.sh tools/*.sh install.sh

# CI 核心检查本地模拟（push 前先跑，避免 push→红叉→修循环）
npm test
npm run build

# daemon CI 模拟（fake HOME 跑 foreground daemon 验证 daemon.json 生成）
# CI runner 无 fde.md、无 ~/.sofagent/data → config.sh 可能静默崩溃（set -e）
mkdir -p /tmp/daemon-ci-test
SOFAGENT_HOME=/tmp/daemon-ci-test SOFAGENT_DATA=/tmp/daemon-ci-test/data \
  timeout 10 node engine/daemon/dist/index.js --foreground 2>&1 | tail -5
# 验证 daemon.json 能正常生成
[ -f /tmp/daemon-ci-test/data/daemon.json ] && echo "✅ daemon CI 模拟通过" || echo "❌ daemon.json 未生成"
rm -rf /tmp/daemon-ci-test

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

## 步骤 3：push main + 等 CI 全绿

> **tag 先行策略**（v1.3.2 起统一）：先 push main → 等 CI 全绿验证 → 才打 tag。tag 一定指向 CI 验证过的 commit，不会 tag 了之后才发现 CI 红。

```bash
# ── push main ──
git push origin main

# ── 等 CI 全绿（通常 2-5 分钟）──
sleep 30
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
if (pending > 0) { console.log(`\n⏳ ${pending} 个 CI 运行中，继续等待`); process.exit(2); }
if (failed > 0) { console.log(`\n🔴 ${failed} 个 CI 失败，先修`); process.exit(1); }
console.log("\n✅ CI 全绿，可以打 tag");
'
# exit 2 = 还在跑（循环重跑本步骤） / exit 1 = 有失败（gh run view --log-failed 定位 → 修 → push → 重等） / exit 0 = 全绿
# 任一 failure → gh run view --log-failed 定位 → 修复 → push → 重新等待
```

---

## 步骤 4：git tag + push tag

```bash
# ── tag 前确认 ──
LAST_TAG=$(git describe --tags --abbrev=0 HEAD~1 2>/dev/null || echo "")
[ -n "$LAST_TAG" ] && echo "上一 tag: $LAST_TAG" && git log --oneline ${LAST_TAG}..HEAD | head -20
# 确认 check-version + check-test-count 全绿（tag 不得在代码/文档未就绪时打）
bash tools/check-version.sh && bash tools/check-test-count.sh --quiet

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

---

## 步骤 5：gh release（触发 release.yml 自动 publish audit + mcp）

> GitHub Release published 后，`.github/workflows/release.yml` 自动触发，publish `@sofagent/audit` 和 `@sofagent/mcp` 两个包到 npm。其余 10 包在步骤 6 手动 publish。

```bash
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

📖 [详细开发日志](./docs/changelog/v{major}.{minor}/vX.Y.Z.md)
EOF
)"
```

### Release Notes 格式规范

> **本节是 GitHub Release body 的强制规范——所有版本必须遵守，不可漂移。**
> 历史教训：v1.3.0/v1.3.1 的 release body 含「CI (8 workflows)」却缺 release-gate / fresh-eyes；v1.3.2/v1.3.3 反过来——四版四样。本规范把质量表 7 项钉死，禁止增减。

- **Title**：`vX.Y.Z — {emoji 主题短语} + {emoji 主题短语}`（常规，≤3 个短语）/ `🎉 vX.Y.Z — ...`（里程碑仅限 vX.Y.0，前缀不在尾部）
  - **主题短语 ≠ 交付名清单**——title 讲主线故事（如「🏪 组织能力市场（L3 五环）」），不逐项罗列交付名（那是 note 新功能段的事）。**title 与 note 新功能禁止逐字重复**（2026-08-15 拍板，五版已统一修正）
  - 每个主题短语带语义 emoji；尾部不加装饰后缀（🎉/🔧 等历史漂移已清理）
- **Body 结构**（定位句 + 三段，固定顺序不可调）：
  0. **首行定位句**——`{emoji 主题短语呼应 title}——{一句人话}`，如「🏪 协作成果像内部应用商店一样流转——Skill/Agent/流程可发布、可评分、可退役，第三方 Skill 先过安全门。」。**禁止用旧 title 清单复读**（v1.3.1-1.3.3 历史遗留：body 首行挂着交付名清单，title 改了 body 没跟——2026-08-15 已统一修正）。与 title/H1 分工：title 点主题（名词短语）/ H1 讲故事（动词句）/ 定位句说人话（给用户的价值）
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
- **BugFix 段在核心变更最末**（不独立成 H2）——`### 🔒 BugFix（上版遗留）`，用 `-` 列表
- **与 changelog 内嵌「Release Notes」段的关系**：GitHub Release body = 面向 GitHub 用户（精炼版）；changelog 文件末尾的 `## Release Notes · vX.Y.Z` = 面向深度读者（含破坏性变更细节）。两者内容可重叠但读者层不同——GitHub body 偏精炼，changelog 段偏完整。

---

## 步骤 6：npm 手动 publish 其余 10 包

> `npm publish --workspaces` 不支持 workspace 全局发布。release.yml 只 auto-publish audit + mcp（Release 触发），其余 10 包手动 publish。

```bash
# 等 release.yml 完成（通常 3-5 分钟），确认 audit + mcp 已到 npm
npm view @sofagent/audit@vX.Y.Z version  # 期望返回版本号
npm view @sofagent/mcp@vX.Y.Z version    # 期望返回版本号

# 手动 publish 其余 10 包
for pkg in core daemon eval harness ontology orchestrator rules skillopt think ab-test; do
  echo "--- @sofagent/$pkg ---"
  cd "engine/$pkg" && npm publish --access public && cd ../..
done

# 验证全部 12 包
for pkg in audit core daemon eval harness ontology orchestrator rules skillopt think ab-test mcp; do
  V=$(npm view @sofagent/$pkg version 2>/dev/null || echo "❌ 未发布")
  echo "  @sofagent/$pkg: $V"
done
# 期望：全部 = 当前版本号（npm 缓存可能延迟 15 秒，未到则等一下重查）
```

---

## 步骤 7：Skill 分发

```bash
# 发布前确认 slug（SSOT）
head -3 SKILL/SKILL.md   # 期望 slug: sofagent

# ── ClawHub 分发 ──
# 发布前先查现有版本（同版本号不可覆盖，冲突则递增版本号）
clawhub skill verify sofagent 2>&1 | grep version
# 清理 .DS_Store（macOS 残留会触发 security 扫描 not_clean）
find ./SKILL -name '.DS_Store' -delete
# 发布（必须带 --changelog，否则 ClawHub 默认 1.0.0 自增，不走 SKILL.md version）
clawhub skill publish ./SKILL --slug sofagent --version <版本号> --changelog "vX.Y.Z"

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

## 步骤 8：设备端安装

```bash
# 1. 全局包更新（audit + core）
npm install -g @sofagent/audit@latest @sofagent/core@latest
sofagent-audit --version   # 确认 registry 版本
sofagent-core --doctor     # 期望全部通过

# 2. Skill 同步（WorkBuddy + OpenClaw 双平台）
cp -r SKILL/harness/* ~/.workbuddy/skills/sofagent/
cp -r SKILL/harness/* ~/.openclaw/skills/sofagent/
cp SKILL/SKILL.md ~/.workbuddy/skills/sofagent-fde/
cp -r SKILL/agents/audit/ ~/.workbuddy/skills/sofagent-audit/
cp -r SKILL/agents/audit/ ~/.openclaw/skills/sofagent-audit/
cp -r SKILL/agents/fde/ ~/.workbuddy/skills/sofagent-fde/ 2>/dev/null || echo "FDE Agent 目录不存在，跳过"
cp -r SKILL/agents/fde/ ~/.openclaw/skills/sofagent-fde/ 2>/dev/null || true

# 3. 最终验证
bash tools/check-version.sh   # 全绿
```

---

## 网络降级策略

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
