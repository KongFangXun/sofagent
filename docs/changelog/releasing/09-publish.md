<!-- SOP-ANCHOR: S9 | file: 09-publish.md | prev: S8 | next: S10 -->
<!-- 机器锚（模型检索用，人不影响阅读）：grep "SOP-ANCHOR:" 可一跳取全部阶段元信息；本阶段完成后 → S10 -->
# 阶段九：发布流水线

> **项目负责人亲手执行，或授权 AI 代执行。**
>
> **本阶段只做 npm 发布流水线（本机自装→检查→push→tag→release→npm publish）。分发（Skill / DSH plugin / OpenClaw plugin / 设备端安装）见 [10-distribute.md](./10-distribute.md)。**

---

## 授权边界：一揽子放行（发布链一次走完）

> 颗粒度原则：**放行一次，全链走完**——作者在阶段八确认三拍板项（push 积压 / npm 发布 / Skill 分发）并说「发布」后，阶段九整链不再逐动作请示。

**授权语义**：

| 环节 | 授权语义 |
|------|---------|
| **准备类**（可逆/只读：前置 lock 一致性 / 本机自装 / 发布前检查 / push 前置检查 / CI 轮询等待） | 放行前即可连续执行；红项按 [`auto-converge-protocol.md`](./auto-converge-protocol.md) 修复批协议自行修复复绿（修产品不修测试红线同款适用），修复后重跑该检查至 EXIT=0 |
| **发布类**（对外可见，不可逆：`git push` / 安装入口 bump commit / git tag + push tag / gh release / npm publish） | **随放行一揽子授权，按步骤顺序自动走完，不逐动作请示** |

**仅两类情况停下**：

1. **报错**——任一对外动作失败（push 被拒 / CI 红 / publish 报错）→ 停下报告请示，不自行重试对外动作（重试循环仅适用网络类瞬态失败，见 [troubleshooting.md · 网络降级策略](./troubleshooting.md#网络降级策略)）
2. **硬前置不满足**——CI 全绿才打 tag / tag 内自洽才 release / release.yml 成功才手动 publish 其余包：前置失败时停在关口，不跨越

**判别口径不变**：该步骤失败后是否需要撤回「已对外可见的状态」——一揽子授权改变的是请示次数，不改变安全边界。与 [08-confirm「AI 代执行边界」](./08-confirm.md) 一致：授权 AI 跑命令 ≠ 授权 AI 管凭证，npm 凭证始终在人的控制下。

---

## 前置：lock file + 内部依赖一致性

```bash
# lock file 更新（新增 workspace 包或改了依赖时必须，否则 CI npm ci 报 Missing）
npm install

# lock file 与 package.json 一致性验证（CI 用 npm ci 严格模式）
npm ci --dry-run 2>&1 | grep -q "missing\|error" && echo "❌ lock 不一致" || echo "✅ lock 一致"

# 内部 @sofagent/* 依赖版本同步检查（所有内部依赖必须与本版同号；bump 落在步骤五，届时须重跑本段）
# ⚠️ 必须扫全部 4 个 section（dependencies/devDependencies/peerDependencies/optionalDependencies）
#    + action.yml 的 npm 包@版本格式（@sofagent/audit@X.Y.Z）——曾出现 optionalDependencies
#    和 action.yml 各漏 1 处，靠 check-version 抓出才补上
grep -rn '"@sofagent/' engine/*/package.json | grep -v "$(node -p "require('./package.json').version")" | grep -v "^.*:.*\"dev\|peer"
# 期望：无输出（所有内部依赖版本 = 当前版本）。有输出 = 某些包的内部依赖版本未同步 bump
grep -n '@sofagent/[a-z-]*@[0-9]' action.yml | grep -v "$(node -p "require('./package.json').version")"
# 期望：无输出（action.yml 的 @sofagent/*@版本 全部 = 当前版本）
```

---

## 步骤一：本地安装（本机自装） ☐

> 全部验证通过、准备发布时，先把最新版装到本机——全局 npm 和本地 Skill 同步。这是发布前最后一道自用验证。

```bash
# 全局安装最新 audit（从本地源码，不走 registry）
cd engine/audit && npm run build && npm install -g . && cd ../..
sofagent-audit --version  # 确认版本号

# 本地 Skill 同步（WorkBuddy + OpenClaw）
# 🔴 SKILL/harness/ 只有流程文件、没有 SKILL.md 主入口——
#    只 cp harness/* 会让本地 skill 主入口停留在旧版。主入口必须单独 cp，且 cp 后 grep version 验证
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

## 步骤二：发布前检查 ☐

> push 前不模拟 CI 跑的检查 = 每次都 push→红叉→修→push 循环。以下检查**本地先跑一遍全绿再 push**。

```bash
# 推前预检全绿
bash tools/release/pre-push-check.sh

# 文档预算 + 死链 + Skill 行数（pre-push-check 内含，但发布前必须单独显式跑一次确认）
bash tools/check/check-docs.sh

# 测试数文档同步门禁（新增测试后文档声称数极易漂移，必须在发布前显式跑）
# check-test-count.sh 校验 README/WIKI/LIMITATIONS/ARCHITECTURE 的测试数与 test-count.sh SSOT 一致
bash tools/check/check-test-count.sh --quiet
# 期望输出 OK / EXIT=0。FAIL = 有文档测试数漂移，必须修后再 push

# 仓外门面对账（GitHub description/homepage 与仓内实数一致——工具数/插件数由 gh api 回读对账 tool-registry 与插件目录实数）
# 三态门禁：PASS / FAIL / SKIP-可见。SKIP（gh 不可达）不阻断但不放行——须在有 gh 登录态的发布窗口本地补跑至 PASS
bash tools/check/check-storefront.sh
# 期望 FAIL=0。FAIL = 仓外门面漂移，gh repo edit 修正后重跑

# ── 步骤二·补：SKIP / 降级跳过 数逐条裁决（**必做**）──
# 为什么要有这一步（实测根因，不是形式主义）：「门禁绿 = 增量为零 ≠ 债清零」——
#   ① 锚定串不命中即「天然通过」（已修）
#   ② 文件级前置过滤静默跳过（check-silent-catch 的「前置过滤豁免」覆盖度行：
#      跳过 N 个 / 实际判定 M 个，其中 X 个文件含 Y 处 catch **零覆盖**——数字随版本变，
#      **以当轮实测输出为准，勿写死**；台账 SSOT = tools/check/silent-catch-prefilter-exempt.json）
#   ③ 存量基线豁免（silent-catch-baseline.json——条数见该文件头部／门禁「存量 N 条」行，勿写死）
#   ④ 已知告警只计 WARNING 即放行——check-version §15 已精确抓到 ROADMAP 版本头
#      描述错版，却因「非 --strict」随发版出门（= P1-7 根因）。
# 共性：跳过是看不见的。故每个门禁结尾强制打印机器可读覆盖度行，本步逐条裁定并留档。
for c in check-docs check-version check-storefront check-readme-parity; do
  bash "tools/check/${c}.sh" > "/tmp/${c}.log" 2>&1
done
# 慢门禁（含 npm test）：非 quiet 跑一次才有覆盖度行（--quiet 契约只输出 OK/FAIL，不追加行）
bash tools/check/check-test-count.sh > /tmp/check-test-count.log 2>&1
node tools/check/check-silent-catch.mjs > /tmp/check-silent-catch.log 2>&1
grep -h '^\[check:coverage\]' /tmp/check-*.log
# 🔴 验收口径：`skipped=0` 也要留一行「本脚本本轮 0 跳过」——否则「没跑」与「跑了没跳过」不可区分。
# 裁决表（逐条填，禁止空话；本表随发版汇报留档）：
#   | 脚本 | skipped | 跳过项（逐条列） | 类别 | 处置 |
#   | ---- | ------- | ---------------- | ---- | ---- |
#   | ...  | ...     | ...              | ...  | ...  |
# 类别口径（三选一，不许含糊）：
#   真问题     → 当场修，不得进发版产物
#   合法窗口态 → 注明「随 push+tag+publish 自然消解」或「下版 vX.Y.Z 收敛」
#   已知盲区   → 注明收敛计划版本（例：check-silent-catch 前置过滤 167 文件，登记表 tools/check/silent-catch-prefilter-exempt.json）

# ── 发版窗口 --strict 默认开 ──
# pre-push-check.sh 第 2 步在**发版窗口**（tag v{SSOT} 在位 + 下一 patch 版开发日志在位）
# 自动给 check-version 加 --strict：warning 也阻断（exit 2 → FAIL）。
# 窗口外维持旧行为（warning 只提示），避免把非发版期的合法中间态告警变成日常推阻。
# 拿到 exit 2 时的裁决路径：真问题当场修；合法窗口态应计入「降级跳过（⏭️）」而非
# 「警告（⚠）」——check-version §27 的待发版窗口白名单即此形态的既有先例。

# CI shellcheck workflow 单独跑（pre-push-check 内含，但 CI 扫描范围可能不同）
shellcheck engine/scripts/*.sh tools/*.sh install.sh

# CI 核心检查本地模拟（push 前先跑，避免 push→红叉→修循环）
npm test
npm run build

# daemon CI 模拟（fake HOME 跑 foreground daemon 验证 daemon.json 生成）
# CI runner 无 fde.md、无 ~/.sofagent/data → config.sh 可能静默崩溃（set -e）
# CI 同款姿势（SOFAGENT_HOME=/tmp 会触发 data-paths 越界守卫回退——
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

### 空提交审计缺口（已闭合）

> 历史缺口：引擎空 diff 短路位于 commit message 读取之前——拆成空提交（`--allow-empty`）可绕过 message 类规则（A5/A9/A19），注入措辞的 commit message 不会被拦。**已闭合**：引擎空 diff 短路升级为 message 类规则照常执行（防回归场景 S381——注入措辞空提交必命中 A9），hook 空提交场景恢复引擎调用。
>
> 缓解条款（保留）：发布相关 commit 不使用 `--allow-empty`——发布序列的 commit 均有实质内容（版本 bump/文档），空提交在此场景无正当用途，禁用可消除一类混淆。

---

## 🔴 假红定性判据（CI/门禁红 ≠ 产品坏——先定性再动手）

> 发布窗口里「红」有三种性质，处置方式完全不同。**先定性，再动手**——把门禁红一律当产品 bug 修，
> 或一律 rerun 到绿，都会把真问题放出门或把假问题修成真问题。

| 性质 | 已实测形态 | 正确处置 |
|------|-----------|---------|
| **① 测试自身竞态** | 断言 X 之前只 `waitFor` 了 Y（等待条件 ≠ 断言条件）；断言条件晚于等待条件到达 | **修等待**（把等待条件对齐断言条件）——断言强度不变 |
| **② CI 环境差异** | runner 无全局安装包（本地有 → hook 解析链走全局分支 fail-loud）；runner 时区/浅克隆无 tag（本地正常）；runner 2 核高负载 | **显式注入被测对象/固定口径**（如 `SOFAGENT_AUDIT_ENTRY` 指向仓内 dist），不做「本地绿就 rerun」 |
| **③ 门禁自身缺陷** | 守卫空转（可判行数 0 却报全过）；把外部 API 错误体当数据解析（假红两连）；`echo \| grep -q` 在 `pipefail` 下的 SIGPIPE 假红 | **修门禁**，并做负向探针（见下）验证修复后仍能抓真问题 |

> 🔴 **可以改什么、不可以改什么**：可以改**等待条件、环境注入、口径固定**（对齐测试真实意图）；
> **不可放宽断言强度**（删断言、改小期望值、加 skip）。判据：改完之后，把已知的真缺陷注入回去，
> 门禁是否仍会红——会红才是合格测试。

## 🔴 门禁改动的负向探针纪律（放宽即须证伪）

> 任何**放宽类**改动——容差（±N 天 / ±N 字）、豁免登记（exempt/baseline/waiver）、跳过条件、
> 回退兜底——都属于「削弱检测力」的改动，**必须做负向探针**后才算完成。

**三条探针（缺一不可）**：
1. **应抓必抓**：注入一个超出阈值的偏移（如把日期改错 4 天），门禁**必须红**
2. **阈内不误伤**：注入一个阈内的边界值（如差 1 天），门禁**必须绿**
3. **还原后干净**：还原原始值，门禁回到绿（证明探针本身无副作用）

> 🔴 **fail-open 陷阱（实测）**：把「取不到值」回退成中性值（`0`/空）参与比较，会让判据恒成立而
> **静默吞掉一切漂移**——探针 1 若省掉，这种 bug 会随版本出门。**回退必须 fail-closed**：
> 取不到就退回**更严**的判据（如字符串全等比较），而不是更宽的。

> 🔴 **时区解耦（日期类守卫的通用口径）**：日期/时间比对取 **unix 时间戳 + 固定偏移**，
> 不要用 `TZ=` 环境变量——三层实测不可靠：① git ref 过滤器对 `TZ=` 前缀不生效；
> ② `date -r`（BSD）与 `date -d @`（GNU）语义不同，GNU 下 `-r` 是 `--reference`（取文件 mtime）；
> ③ `TZ` 的生效性依赖 runner 的 shell 与 tzdata。纯算术（`ts + 偏移秒数`）跨平台同值。

> 🔴 **外部 API 对账类门禁的失效判据**：凭证失效时 CLI 常把**错误体打到 stdout**（`2>/dev/null` 拦不住），
> 三变量各自捕获错误文本 → 均非空 → 走不进「不可达」分支 → 错误体被当数据解析出假红。
> 必须在解析前显式识别错误体特征（如 `Bad credentials` / `"message"` 字段）并归入 **SKIP**
> （SKIP 语义 = 本轮未对账、不阻断但**不放行**，发布窗口须在凭证可用时补跑到 PASS）。

---

## 步骤三：push 前置检查（双 SHA 分叉防御） ☐

> Git Data API 推送会造成远端/本地「同 tree 双 SHA」——直接 push 会被 rejected (fetch first)。本地代理死时用 `git -c http.proxy= -c https.proxy= push` 直连。

```bash
# ① 检查远端头是否在本地历史（双 SHA 分叉探测）
REMOTE_SHA=$(gh api repos/KongFangXun/sofagent/branches/main --jq '.commit.sha')
git merge-base --is-ancestor "$REMOTE_SHA" HEAD && echo "✓ 快进可推" || \
  git rebase --onto "$REMOTE_SHA" <本地等价旧commit> main   # tree 相同时干净接回
# ② tag 顺序铁律：先安装入口 bump commit（步骤五），后打 tag（tag 内容就该指本版）
```

> ⚠️ **发布窗口的 verify 红是预期形态**：bump commit 上 verify 工作流装 `@sofagent/audit@<本版>`，npm 尚未发布该版本——供应链 fail-closed（不降级 @latest）按设计拒绝。判别：此点位 verify 红 ≠ 阻断项（pr-check 等其余 workflow 全绿即可继续）；publish 后重跑该 verify run 应转绿（发布链收尾动作）。上一版同点位的「绿」是 fail-open 假绿（v1.5.2 起修复）。
>
> 🔴 **publish 完成后必须 rerun 首轮红项——这是「时序固有」与「真回归」的唯一分界动作**：
> 「verify 红 = 时序固有」是**假设**不是结论，唯一证伪方式 = publish 全部完成后 `gh run rerun <run-id> --failed`
> 再核该 run：转绿 ⇒ 假设成立；**仍红 ⇒ 红点已变成另一个真回归**，必须照步骤四「CI 失败三分类」
> 定位修复（禁以「已判定时序固有」为由放行）。实测：同一 run 首轮红是 npm 未发布（时序固有），
> rerun 后暴露的却是 install.sh 在 `bash -eo pipefail` 下因 `head -2 | grep` 无匹配而失败（真回归）
> ——**不 rerun 就会把真回归当已知时序放过**。
> 同理 **Release workflow 首跑失败**后：先按「已知坑①（E404）」核 npm 侧二次确认，再走本地重发 +
> `gh run rerun <run-id> --failed` 收口；rerun 转绿才算发布链完成（Release 的 publish job 有幂等豁免分支，
> 重跑不会重复发布）。

## 步骤四：push main + 等 CI 全绿 ☐

> **tag 先行策略**：先 push main → 等 CI 全绿验证 → 才打 tag。tag 一定指向 CI 验证过的 commit，不会 tag 了之后才发现 CI 红。
>
> 🔴 **push 前置检查：workspace 包与 lock 同步**：新增 workspace 包但 lock file 未同步时，push 后多个 CI 工作流（pr-check/verify/audit/windows-ci）在 `npm ci` 严格校验上**同根因全红**（本地 `npm install` 会静默补齐所以本地全绿，CI `npm ci` 直接炸）。
>**push 前必跑**：`npm ci --dry-run 2>&1 | grep -c "^npm error Missing"` 期望 0——非 0 则 `npm install --package-lock-only` 补齐 lock 后随代码同 commit。
>
> 🔴 **CI 全绿是打 tag 的硬前置**：push 之后必须**轮询等到全绿**（不是看一眼就走）——`exit 0` 之前禁止进入步骤六。CI 红着打 tag 会让用户装到坏版本（tag 是安装入口的锚点），回滚成本远高于等待 2-5 分钟。**轮询必须前台执行**：上述 while 循环在 session 前台逐轮跑（每轮一查 + sleep 60），严禁包进 run_in_background——挂后台 = session 空闲 = 界面无进展反馈。轮询脚本如下（循环跑直到 exit 0，每次间隔 60s）：

```bash
# ── push main（🔴 实证：裸命令一次成功率不稳——github.com:443 间歇阻断，
#    round 2 才成功是常态。push 主命令直接用 [troubleshooting.md · 网络降级策略](./troubleshooting.md#网络降级策略)的重试循环形态跑
#    （退出码判定版，禁 `| tail` 管道测退出码），失败形态见该节三连失败谱）──
for i in $(seq 1 10); do
  git push origin main > /tmp/push-main.log 2>&1
  RC=$?
  [ $RC -eq 0 ] && { echo "✅ push 第 $i 次成功"; break; }
  echo "第 $i 次 RC=$RC: $(tail -1 /tmp/push-main.log)"
  sleep 20
done
# push 完成后必须 ls-remote 核对远端 == 本地（防管道假绿 / 半成功态）

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

> 🔴 **禁自写轮询脚本替代上方官方段**：执行者常顺手用 `PENDING=$(gh run list ... | grep -c ...)` 自写简化版——zsh 下 grep 命中 0 行时 exit 1 触发 `|| echo 0`，`$()` 捕获 "0\n0" 双值 → `[ -eq ]` integer expression expected **死循环不退出**（CI 实际早已全绿，后台任务空转）。上方 node 单进程版无此陷阱；确需自写时，计数一律 `n=${n:-0}` 归一 + 用 `grep -q` 不用 `grep -c`。

> 🔴 **CI 失败三分类处置（先分类再动手——不同类修法完全不同）**：
> 1. **真回归**（本版改动引入：新脚本 set -u 炸弹 / 新测试环境假设 / 配置兜底链引用未初始化变量）→ 修根因 → 复现验证 → push 重等。识别特征：v上版 tag..HEAD 的 diff 里能定位到引入点。
> 2. **发版时序固有**（依赖 npm 上已有当前版本，而发布动作在本轮 CI 之后——如 install.sh 按 SSOT 版本从 registry 装 audit）→ 修依赖顺序/降级兜底（如 @latest 占位），不视为 CI 阻塞。
> 3. **环境特异**（本地绿 CI 红：runner 的 git 配置/并发竞态/进程 cwd 差异）→ 先在本地模拟 CI 姿势复现（env -i 干净 HOME / 全量并发），复现不了再读 CI 日志逐帧对——典型根因：git 子进程调用缺 `cwd`（在进程 cwd 而非被检查目录解析）。
>    🔴 **「本地绿 CI 红」三类高频根因**（排查按此序优先试）：
>    ① **构建产物残留掩盖**——本地 `engine/*/dist` 等产物存在，CI 干净环境没有；TS2307 类「依赖找不到」报错而本地全绿时，先 `rm -rf engine/*/dist && npm run build` 模拟 CI 干净态重建复现。同类还有 build 脚本拓扑序倒置（本地 dist 残留按依赖序缓存掩盖了乱序）——干净态重建 exit 0 即证新序自洽。
>    ② **宿主环境依赖**——测试依赖 `~/.sofagent-key` 等本机运行时文件，本地有 CI 无（或反之）；复现法：`SOFAGENT_KEY_PATH=/tmp/nonexistent` 等隔离 env 重跑，失败姿势与 CI 一致即锁定。
>    ③ **CI job 缺前置**——job 刻意「不装依赖直接跑」时，构建产物类依赖（如 AST 引擎 `engine/rules/dist/`）缺失致工具降级路径被静默触发，口径分歧报误报；修 job steps 补依赖+build，工具降级分支必须有 fail-loud 警告。

---

> ⚠️ **bump 批 commit 前必跑 `git status --porcelain` 检视暂存面**：bump 涉数百文件，惯用 `git add -A` 会把**旁生目录**（实测：audit-baseline-sync 在无 SOFAGENT_HOME 时把锚文件写进 `./undefined/`）一并收入。检视发现非 bump 目标路径即先清（`git rm -r --cached <dir>` + 删目录 + 产品侧登记修复）。

## 步骤五：版本 bump + 安装入口随版同步 ☐

> 🔴 **本步骤是全流程唯一的 bump 时点**——阶段二~八全程 `package.json` 保持上一版号（SOP 设计的待发版中间态，见 [02 步骤一](./02-dev.md)）。SSOT 升级落在本步骤，且必须与安装入口 URL、bootstrap 哈希、状态翻牌**同一个 commit** 收口，才能「tag 前自洽」（tag 指向的必须是已 bump 的 commit）。

### 第一拍：SSOT 版本号 bump（必做）

```bash
# ① 影响面预检（历史档案应零命中：脚本按设计排除 docs/changelog/）
bash tools/release/bump-version.sh <上一版> <目标版> --dry-run
#    <上一版> = bump 前 SSOT：node -p "require('./package.json').version"

# ② 实际替换
bash tools/release/bump-version.sh <上一版> <目标版>

# ③ 生成式产物重生成——唯一生产方不是 bump 脚本，不跑 = check-template-drift 断言五/六 报漂移
node tools/gen/gen-plugin-manifests.mjs

# ④ 抓残留（bump 可能 EXIT 137 中断，核心号已改、边缘位置残留）
bash tools/check/check-version.sh
```

> **残留补漏清单**（`optionalDependencies` / `action.yml` / 文档头日期 / WIKI 状态表 / package-lock / 发版状态标记，共六类）见
> [06 步骤六](./06-doc-finalize.md)「bump 中断恢复清单」——**清单正文只此一份，本处不复制**（防双事实源）。
> **版本位置清单 SSOT** = `tools/release/bump-version.sh` 头部「替换范围」注释；详细操作手册见 [playbook/version-bump.md](../../../playbook/version-bump.md)。
> **bump 涉数百文件** ⇒ commit 前必跑 `git status --porcelain` 检视暂存面（见本阶段末「多 session 并发」段），禁 `git add -A`。
> 🔴 **bump 历史引用防线（行首锚）**：bump 的替换规则必须带行首锚——裸 `· v旧版` / `（v旧版）` 形态的全局替换会把**正文历史叙述**当现态标记改掉（曾实锤；脚本侧已带锚）。bump 后仍须逐文件 `git diff` 复核「只动了该动的行」；发现历史叙述被改 = 回滚该 hunk 并修脚本锚，不得放行。
> 🔴 **功能溯源标记 ≠ 当前版本锚**：`（vX.Y.Z 新增 / 交付 / 第N章）` 这类标记记录的是**功能出身版**，bump 后必须保持原值。拦截靠 `bump-version.sh` [4/13] 的豁免关键词表——**新形态出现时同批补进豁免表**，不靠 bump 后逐个回改；漏列会让同一个标记被逐版抬号（出身版被改写成当前版，且因每版替换值恒等于该行已有值而自我延续）。`check-version` [12/14] 对此**无兜底**：其判据只认「头注释命中当前版即通过」，非当前版的取值一律跳过，没有异版告警路径。

### 第二拍：安装入口随版同步

> 🔴 tag 打了、npm 发了，安装入口没人管就会断链——曾出现 README/bootstrap 安装 URL 仍指上一版，用户按 README 完整安装装到旧版。**每版必做，curl 验证后才能进步骤七。**

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


> 🔴 **大文件 curl 恒 000 的处置**：`install.sh` 这类近 100KB 的文件在代理/网络抖动下 `curl` 可**连续 000**（同 tag 的 bootstrap.sh / lib 却 200）——此时勿反复重试等待，改用 **API 通道做内容级哈希对账闭环**：`gh api "repos/<O>/<R>/contents/install.sh?ref=<tag>" --jq .content | tr -d '\\n' | base64 -d | shasum -a 256`，与 `git show <tag>:install.sh | shasum -a 256` 逐字节比对。一致即 URL 可达性成立（curl 200 是同一事实的另一种测法，取其一即可，不必死等）。
> 注意：check-version.sh 含安装入口 tag 对账检查项，`bash tools/check/check-version.sh` 会给出三方 tag 一致性结论；此处 curl 是最后一道实测防线（URL 真实可达性）。

### 🔴 bootstrap.sh sha256 同步（每版必做）

> bootstrap.sh 对下载的 install.sh + 6 个 lib 文件做 sha256 校验（curl | bash 信任模型加固）。**tag 指向新版后哈希必然变化——必须同步更新 bootstrap.sh 内嵌的 7 个哈希，否则用户安装会因校验失败而 fail-closed（好陷阱：宁可不装也不装被劫持的脚本，但会让所有人装不上）。**

**优选路径：预计算哈希与 URL bump 同 commit，tag 一次打自洽**——打 tag 前预计算 HEAD 的 install.sh 哈希（`git show HEAD:install.sh | shasum -a 256`）与 tag URL bump、哈希回填全部进同一个 commit，push 后打 tag——tag 内 bootstrap.sh 天然自洽，无需重打。install.sh/lib 自上版零改动时 6 lib 哈希沿用免回填（`git diff <上tag>..HEAD --stat -- engine/scripts/lib/` 输出空即零改动）。
验收：`git show vX.Y.Z:bootstrap.sh` 内嵌哈希 == `git show vX.Y.Z:install.sh | shasum -a 256`。

> 🔴 **验收必须 7 项逐项实测，不能只验 install.sh**：6 个 lib 里任何一个在发布窗口内被改过
> （哪怕是发布前的审查修复批顺手改的），其哈希就必须同步回填——只验 install.sh 会漏掉 lib 项，
> 用户装到一半 fail-closed。口径：把 `LIB_FILES` 的 6 个文件按**声明顺序**逐一比对
> `bootstrap.sh` 内嵌的 `LIB_SHA256S` 对应行（顺序错位 = 校验必失败），与 `install.sh` 合成 7/7 全绿才算过。
> 判断 lib 是否改动：`git diff <上一 tag>..HEAD --stat -- engine/scripts/lib/`（输出空才可沿用旧哈希）。

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

> 🔴 **时序陷阱：回填哈希后必须重打 tag**——「先改 URL 提交 → 打 tag → 算哈希 → 回填提交」会让 tag 内 bootstrap.sh 仍持旧哈希（tag 内不自洽）。正确收口 = 回填哈希的 commit 落盘后**重打 tag**：`git tag -d vX.Y.Z && git tag -a vX.Y.Z -m ... && env -u http_proxy ... push origin :refs/tags/vX.Y.Z && push origin vX.Y.Z`（tag force 覆盖远端）。
>验收：`git show vX.Y.Z:bootstrap.sh | grep INSTALL_SHA256` 的哈希 == `git show vX.Y.Z:install.sh | shasum -a 256`。install.sh 本体无改动时 6 lib 哈希不变，只重算 install.sh 一项。

### 第三拍：阶段六挂账翻牌（版本介绍触点清单）

> 阶段六（[06 步骤十一](./06-doc-finalize.md)）把**版本号相关触点**挂账到本拍——这些格在阶段六勾不了（bump 未发生），必须在此一次性翻牌，否则「版本发完了、文档还挂着上一版介绍」。
> 🔴 **清单正文只此一份**：逐格目标见 [06 触点清单](./06-doc-finalize.md) 及其「挂账去向台账」，**本处不复述**（防双事实源）。本拍归口的格 = WIKI 状态表 / ROADMAP 规划表状态 / ROADMAP「现在在哪」+ 顶栏 / 各深读文档版本头 / SKILL·AGENTS·GEMINI 头部 / SKILL/harness·rules 文件头 / dashboard 版本角标。

```bash
# 翻牌结果反查（<上一版> = bump 前的 SSOT）——命中即该格漏翻
git grep -n "<上一版>" -- README.md README.en.md CHANGELOG.md SECURITY.md \
  docs/ROADMAP.md docs/HANDBOOK.md docs/ARCHITECTURE.md docs/API.md docs/WIKI.md \
  SKILL/ tools/dashboard/dashboard.html engine/umbrella/package.json
# 期望：介绍面/状态面零命中（历史区沿革表历史值、changelog、archive 命中属正常）
```

> 验收：反查零「介绍面/状态面」命中 + 06 触点清单挂账格全部改 `[x]`；本拍与 bump 同 commit 收口。
> 🔴 **规划表行两条硬约束（`check-forms` A7 会当场判红）**：① 本版行**不可删除**——A7 以 `VERSION_SOURCES` 逐版对 ROADMAP 规划版本表做对账，删行即判「规划版本表无该版本行（对账缺一侧）」；本版行在役期只**翻状态**（📋 规划中 → ✅ 已发版（日期））。② **版本单元格必须是纯版号**（`| **vX.Y.Z** |`）——A7 的行正则形如 `^\|\s*\*{0,2}vX\.Y\.Z\*{0,2}\s*\|`，写成 `| **vX.Y.Z**（日期） |` 即失配等同缺行；**日期放状态格**。


### 🔴 第四拍：bump 后全量门禁重跑（必做——bump 是新的改动面）

> **为什么**：发版链的门禁全绿发生在 pre-push 阶段（bump **之前**），bump 批本身是几十到几百文件的新改动面——此前绿的门禁对 bump 后的状态一概没验过。实测教训：bump 手工补漏的批量替换吃掉了 SKILL 六件头部的 H1 前缀（`# `），裸文本头让版本号落进 archaeology 扫描面（E3 判据回归），**带病出门直到发版后自查才暴露**。
> **门禁全绿 ≠ 永远绿**：每个大改动面（bump / 翻牌 / 合并）之后都要重验一遍，这是本手册铁律的推论。

```bash
# bump 批 commit 前必跑（退出码全 0 才可收口）：
bash tools/check/check-version.sh            # 版本一致性（含恢复清单逐项）
bash tools/check/check-archaeology.sh        # E3 文件头版本标识形态（H1/注释形态回归检测）
node tools/check/check-forms.mjs             # 形态归属/计数 pin（bump 翻牌动这些表）
node tools/check/check-table-shape.mjs       # 孤儿行/超列（批量替换易产生）
node tools/check/check-anchors.mjs           # 锚点完整性
```

> 验收：五项 exit 全 0。bump 涉及的替换规则有锚缺陷时（如本例），**先修脚本锚再重跑**——不修脚本只修产物 = 下版复发。

---

## 步骤六：git tag + push tag ☐

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

> 🔴 **tag 权威核对端点**：`gh api repos/<O>/<R>/git/refs/tags/<tag>`（**复数** `refs`）**返回 404，不是权威判据**——权威二选一：`git ls-remote --tags origin <tag>`（比对 tag object SHA）或单数端点 `gh api repos/<O>/<R>/git/ref/tags/<tag>`。判「tag 是否已推上」时以 `ls-remote` 为准；<br>🔴 **push 时点**：tag 必须指向**已在远端 main 上**的提交（否则 tag 指向游离提交，`main` 缺 bump commt，收口第④项 workflow 复核无对象）⇒ 顺序 = push main（含 bump 提交）→ 等 CI 全绿 → 才打 tag + push tag。
> 🔴 **tag push 失败重试**：`git tag -a` 本地打标成功但 push 可能被中断（实测 exit 137 SIGKILL / 超时）——此时**远端没有 tag，本地有**（`gh api repos/O/R/git/ref/tags/vX.Y.Z` 404 确认）。
>重试直接用「网络降级策略」的完整命令（剥代理 + HTTP/1.1 + 低速兜底）单独 push tag：`env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy git -c http.proxy= -c https.proxy= -c http.version=HTTP/1.1 -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=300 push origin vX.Y.Z`——push 完成后用 `gh api
>repos/O/R/git/refs/tags/vX.Y.Z --jq '.object.sha'` 确认远端存在，与本地 `git rev-parse vX.Y.Z` 一致。

---

## 步骤七：gh release（触发 release.yml 自动 publish audit + mcp） ☐

> GitHub Release published 后，`.github/workflows/release.yml` 自动触发，publish `@sofagent/audit` 和 `@sofagent/mcp` 两个包到 npm。其余 `@sofagent/*` 与裸名总包在步骤八手动 publish（13 个手动 `@sofagent/*` = 11 个引擎模块包 + `load-chain` + `dsh-plugin-kit`，加裸名总包 `sofagent` 共 **14 包**——包数口径以步骤八头部为准）；
>**另有七款 DSH 插件**（`cordis-plugin-sofagent-*`，裸名、目录在 `engine/dsh-plugins/`）同样在步骤八手动 publish——见「步骤八·补」。

> **触点纪律（撤策执行不完整教训 · F-8）**：策略类翻牌必须全站 grep `alpha|分道|channel|dist-tag` 后双语双段逐一翻牌（README 双语 62 区块与 188 段、LIMITATIONS、本文件）——commit message 的触点声称以 grep 结果为准，不以记忆为准。

### dist-tag 分道（🔴 **已撤策**——历史档案见 git 演进史本节旧版）

> 撤策后现行口径：本阶段与步骤八**全程不加 `--tag`**，全部包以默认 tag（latest）发布；
> 版本阶段语义由版本号承载。撤策始末与「alpha 分道」试行记录见本文件的 git 历史（该段 40+ 行档案已退役）。


### 🔴 发版 artifact 四件对账（release create 后立即做，不等收尾）

> 每版发完都出现「Release 发了但某个 artifact 断链」的返工——四件 artifact 在 release create 后**立即逐件核验**，比收尾阶段统一排查省一轮往返：

| # | artifact | 核验命令 | 期望 |
|---|----------|---------|------|
| 1 | | （说明见下方小节） | 两 SHA 一致（同口径） |

#### 1 · tag 对账口径

🔴 annotated tag 对账口径：`gh api git/refs/tags` 返回的是 **tag object SHA** ≠ commit SHA，直接与 `git rev-parse vX.Y.Z^{commit}` 比必不等——正确对账二选一：① `gh api refs/tags` 的 sha == `git rev-parse vX.Y.Z`（本地 tag object SHA）② `gh api git/tags/<object-sha>` 二段查 `.object.sha` == `git rev-parse vX.Y.Z^{commit}`

| # | 完成 | 步骤 | 验证方式 |
|:--:|:--:|------|------|
| 2 | GitHub Release（title + body 可达） | `gh release view vX.Y.Z --json name,isDraft` | name 匹配、isDraft=false |
| 3 | | （说明见下方小节） | 23 项全部 = 本版号（🔴 必加 --prefer-online——裸查询吃缓存会误报漏发） |

#### 3 · npm 23 包对账

`for p in audit mcp core daemon eval inject ontology orchestrator train rules evolve think ab-test; do npm view @sofagent/$p version --prefer-online; done` + `npm view @sofagent/load-chain version --prefer-online` + `npm view @sofagent/dsh-plugin-kit version --prefer-online` + `npm view sofagent
version --prefer-online` + `for p in $(node -p "require('./engine/dsh-plugins/plugins.json').plugins.map(p=>p.id).join(' ')"); do npm view "$p" version --prefer-online; done`

| # | 完成 | 步骤 | 验证方式 |
|:--:|:--:|------|------|
| 4 | 安装入口（README 双语 + bootstrap.sh 的 tag URL 可达） | `grep -rn "refs/tags/v" README.md README.en.md bootstrap.sh` + 逐条 `curl -sI` HTTP 200 | 三处 = 本版 tag 且真实可达 |

> 🔴 **对账通道的终局口径 = registry HTTP 直查**（实测补充）：`npm view --prefer-online` 在传播延迟期**仍可能长时间返回旧值**——本版 rollback 款按 `--prefer-online` 轮询 6×30s 全是旧值（被判 pending 假报），改 `curl -s https://registry.npmjs.org/<pkg>` + node 解 `dist-tags.latest` **立即见新版**。
>判定序：① 先查 publish 日志有无 `+ <pkg>@<ver>` 入队行（**有 = 已入发布队列，只是传播慢，不是失败**）→ ② 再用 curl 直查确认 `latest` 与版本键 → ③ CLI 查询只作辅助、不作终判。**发布终局对账一律以 ② 为准**。

> 任何一件不满足 = 发版未完成，当场补（重推 tag / 补 publish / 修 URL），不带病进入收尾。

### Release Note 生成 → 自检 → 上一版结构对照（三道工序 · 步骤七必做）

> 🔴 **release note 必须先过自检 + 上一版结构对照，才允许 gh release create**——「改了再发」的成本是 npm 用户看到的第一个版本就是错的（曾连续多版发布后都发现问题再改）。三道工序缺一不可：
>
> 📌 **与阶段八的分工（2026-09 流程修正）**：三道工序的 body 生成**已在阶段八步骤六随发布 prompt 同批完成**并落 `~/Desktop/release-note-vX.Y.Z-body.md`——本步骤跑同一套三道工序，性质是**复核 + 落终版**（数字取阶段八冻结基线终值；发版窗口内若有微调，以本步骤终版为准并同步更新桌面文件）。**分工理由**：放行 = 授权对外发布，作者须在放行前过目 body 本体——body 留到本步骤才现场生成，放行决策就缺了一半依据。

> 🔴 **剥元说明铁律**：devlog 的「## Release Notes」段**开头有两段给流程看的元说明**
> （「本节存在性 = 阶段六定稿必备项…」+「⚠️ 数字取值说明…」），它们**不是面向用户的内容**，
> 且含**仓内相对链接**（`../releasing/09-publish.md`）——原样搬进 GitHub Release body 会是
> **废话 + 404**。生成 body 时必须：① **剥掉内部标题**（`## Release Notes · vX.Y.Z`）；
> ② **剥掉元说明 blockquote**（从定位句开始）；③ 复核 H2 骨架与上一版一致
> （`gh release view v<上一版> --json body -q '.body' | grep -E "^## "` 对照）。
> 自检：`grep -nE "阶段六定稿必备项|数字取值说明|\.\./releasing/" body.md` 应为空。
>
> ⚠️ **补充**：devlog 的 Release Notes 段**顶部与尾部各有一段元说明**——尾部那段形如
> `> 🔗 尾链：本段与 GitHub Release body 同源；发布时由阶段九三道工序生成，此处不重复。`
> **两段都要剥**（只剥顶部会漏）。自检命令同步扩为：
> `grep -nE "阶段六定稿必备项|数字取值说明|\.\./releasing/|Release body 同源" body.md` 应为空。
> 另：body **必须**含指向本版 changelog 的相对链接（阶段十一步骤一以 `contains("](./docs/changelog/")` 断言）。


**工序〇 · 拉上一版结构骨架（生成前置，非收尾确认）**：`gh release view v上一版 --json body -q '.body'` 提取 **H2 骨架（节名+节序）与要素清单**（TL;DR (EN)/Install 三块/深入了解表）——上一版实际发布物是 body 结构的 **SSOT**，本版骨架照此生成。禁止跳过本工序直接按 06 格式规范文字生成（范本文字与实际发布物的结构差异要到这一步才对齐）。

**工序一 · 按骨架+规范生成**：以上一版骨架为模板，按下方「Release Notes 格式规范」填充本版内容（title 主题短语 / 首行定位句 / TL;DR (EN) / Install 升级命令带本版号 / 核心变更功能领域式 / 质量验证固定 7 项 / 深入了解表 / 尾链）。

> 🔴 **数字取值锚（单一来源）**：body 中全部数字（测试数 / acceptance 通过数 / 维度数 / check-version 项数 / 工具数）一律取**阶段八冻结基线终值表**——禁止取 run/precheck/修复批等中间过程值（终值与过程值差一轮修复批，曾出现 acceptance 用了 precheck 旧值 385/386 而基线终态 386/387）。CHANGELOG 索引行同口径。 
> 🔴 **发布时点终核（防并发窗口数字漂移）**：生成 body 后、`gh release create` 前，把 body 里每个数字当轮重算一遍（check-version 实测项数会因并发批新增检查而变——实测案例见 git 演进史：冻结时 134 → 发布前 137）；有差即改 body 并同批改 devlog RN 段（提取源一致）。

**工序二 · 生成后自检（跑脚本，不看感觉）**：

```bash
# ① 质量验证表必须恰好 7 项（不可增减）
echo "$BODY" | grep -c "^| "   # 期望 7 个表行（表头 2 行不算，从「npm test」数到「fresh-eyes」）

# ② H2 骨架与上一版同构（结构对照七要素见工序三）
echo "$BODY" | grep -E "^## "          # 期望输出 ## 🔨 核心变更 与 ## ✅ 质量验证
gh release view v上一版 --json body -q '.body' | grep -E "^## "

# ③ 固定 7 项逐字核对（每项必须在质量表中出现一次）
for item in "npm test" "acceptance-test" "shellcheck" "check-version" "回归检查" "release-gate" "fresh-eyes"; do
  echo "$BODY" | grep -q "$item" && echo "✅ $item" || echo "🔴 缺 $item"
done

# ④ 尾链存在且必须是绝对 URL（🔴 release 页相对链接按 /releases/tag/ 解析 = 404——上一版实物即此断链形态，用户复检定论）
echo "$BODY" | grep -qE '\[详细开发日志\]\(https://github\.com' && echo "✅ 尾链（绝对）" || echo "🔴 尾链缺失或为相对路径（必 404）"
# ④b 链接可达性第六查：body 内所有 markdown 链接禁相对路径（深入了解表曾用 ../../../docs/ → 全 404）
echo "$BODY" | grep -oE '\]\((\.|\.\.)[^)]*\)' | head -3
echo "$BODY" | grep -qE '\]\((\.|\.\.)' && echo "🔴 存在相对路径链接（release 页必断）" || echo "✅ 链接全绝对"

# ⑤ 开头段长度双实测（N9：定位句 ≤220 · TL;DR(EN) ≤650）——两条都必须跑，禁只测其一
POS_LEN=$(node -e "console.log(require('fs').readFileSync(0,'utf8').split('\n')[0].length)")  # 🔴 禁用 awk length——macOS awk 按字节计，中文行会 3 倍误报超限
[ "$POS_LEN" -le 220 ] && echo "✅ 定位句 $POS_LEN 字符" || echo "🔴 定位句 $POS_LEN 字符超 220 上限——拆 H3 承载"
TLDR_LEN=$(echo "$BODY" | awk '/^$/{if(f)exit} /TL;DR/{f=1} f' | wc -m | tr -d ' ')
[ "$TLDR_LEN" -le 650 ] && echo "✅ TL;DR $TLDR_LEN 字符" || echo "🔴 TL;DR $TLDR_LEN 字符超 650 上限——EN 只留主线与关键数字，细节归 H3"

# ⑥ BugFix 节标题逐字核对（N10——有 bugfix 节时必须带「（上版遗留）」补语）
echo "$BODY" | grep -E "^### 🔒" | grep -q "BugFix（上版遗留）" && echo "✅ BugFix 标题合规" || echo "🔴 BugFix 标题漂移（缺「（上版遗留）」补语）"

# ⑦ 里程碑 🎉 前缀规则（N11——仅 vX.Y.0 可用 🎉 vX.Y.Z — 格式；常规版尾部禁装饰）
echo "$TITLE" | grep -qE "^🎉 v[0-9]+\.[0-9]+\.0 — " && echo "✅ 里程碑格式（X.Y.0）" || echo "$TITLE" | grep -qE "^🎉" && echo "🔴 非 X.Y.0 版误用 🎉 前缀" || echo "✅ 常规版格式"
```

**工序三 · 上一版结构对照（取代人工过目）**：自检全过后，与上一版 release body 做**结构级并排对照**——title 形式（`vX.Y.Z — emoji 短语`，里程碑 `🎉 vX.Y.0 —` 前缀规则见 N11）/ 定位句有无 + 长度（N9 ≤220 字符）/ 英文 TL;DR 有无 / Install 速查块有无 / H2 骨架 / 质量表 7 项顺序 / BugFix 节标题逐字（N10）/ 破坏性变更迁移命令 / 尾链位置，十要素逐一比对上一版，**结构不一致即重写，直到同构**。
机制标准 = **v1.4.2 实际发布物（标准锚点：含英文 TL;DR + Install 速查 + 迁移命令 + 深入了解导航表）**——若上一版漂移，以 v1.4.2 为准重写，不追随上一版。对照命令：`gh release view v1.4.2 --json name,body -q '{name, body}'`（锚点）+ `gh release view 上一版 --json name,body`（漂移检测）。

```bash
> 🔴 **发布前必做**：生成 body 后先与上一版并排对照——`gh release view v上一版 --json body -q '.body' | grep -E "^## "`——两版 H2 骨架必须同构（首行定位句/核心变更/破坏性变更/质量验证/尾链）。**changelog 内嵌的 Release Notes 段 ≠ GitHub Release body**：前者归 08 的 N1-N7 管（✨ 新功能 bullet 式），后者归本规范管（### 功能领域子标题式）——分别核对，禁止把 changelog 段直接复制当 body。

gh release create vX.Y.Z --title "vX.Y.Z — {emoji 主题短语}" \
  --notes-file ~/Desktop/release-note-vX.Y.Z-body.md   # body 阶段八已生成并三道工序自检（防漂移：勿现场重写）
```
<!-- 完整 body 骨架示例已退役——格式 SSOT = 06「Release Notes」段 + 06 内「最新范本快照」 -->


### Release Notes 格式规范（→ 单一 SSOT：06-doc-finalize.md）

> 🔴 **规范定义在且仅在 [06-doc-finalize.md 的「Release Notes」段](./06-doc-finalize.md)** —— 那里是
> **格式规范源头**（Title 规则 / Body 五要素 / 质量表固定 7 项 / 破坏性变更写法）。
>
> **本节曾把同一套规范复制了一份** ⇒ 形成**双 SSOT**：实测——`09` 的副本里
> `check-version` 示例还停在 `{N}/{N}`、acceptance 示例写成 `{N}/{N} 场景全绿`（与脚本实际的
> `{N}/{N} passed · SKIP: {N} · EXIT: {N}` 不符），**规范一旦分叉，执法时按哪份都可能出错**。
> 故此处**不再复述规范**，只保留本条指针；本步骤（步骤七）只负责**按 06 的规范生成 body**。

> ⚠️ **若发现 06 与本节不一致——以 06 为准，并把本节改成指针**（禁止两处并行维护）。
>
> 🔴 **2026-09 复核查实：本条指针此前只改了一半**——L431 声明「不再复述规范」，但紧随其后仍留着
> 质量表副本与六条细则，且副本里 `acceptance-test | {N}/{N} 场景全绿` 恰是 L429 点名的**错误格式**
> （规范分叉的活标本：指针说以 06 为准，副本却在教错写法）。**现已删除全部副本**，六条细则迁入
> 06「Body 生成细则」；本节此后只有指针，无任何规范内容——**新增规范一律写 06**。

---

> **本版发版期新沉淀（六条实测经验）**：
> ① release.yml 的 audit/mcp publish 可能遇 npm 服务端瞬时 E404（PUT 根路径 404，二次确认不存在）——处置：worktree 本地手动重发两包（登录态在开发者侧），入队行确认即成功，CI 侧红不阻塞。
> ② check-npm-claims 会扫 README 双语版本声称 vs registry 真值——bump 后 publish 前必然红（窗口态），登记 npm-claims-exempt.json 锚式豁免（publish 后声称自动转真值）。
> ③ skillhub CLI 已收紧 SKILL.md frontmatter 校验（必须有闭合 `---`）——历史文件无闭合标记的会拒收，补标记即可。
> ④ ClawHub package publish 已收紧 dist 校验（runtimeExtensions 声明的 ./dist/index.js 必须在包内）——OpenClaw 插件发布前须 `npm run build`；openclawVersion 钉值须随 registry 当前版更新。
> ⑤ 🔴 **bump 批推送前必须重跑全量门禁**（尤其 check-archaeology——发版链的门禁全绿在 pre-push 阶段，bump 批之后若只跑 check-version 就推，archaeology/forms/docs 的回归会带病出门。实测：bump 手工补漏的批量替换吃掉 SKILL 六件头部 H1 前缀，E3 判据回归直到发版后自查才暴露）。
> ⑥ 发版窗口的中间 commit 红不可避免（翻牌批/registry 传播在触发批的下一拍）——**能合 commit 的翻牌动作与触发批同 commit 推送**（如 CHANGELOG 索引翻牌并入 frontmatter 修复批），缩小提交列表上的红叉窗口；收尾后逐 commit 复盘红叉是否全部有时序解释。

## 步骤八：npm 手动 publish 其余 14 包（含裸名总包）+ 七款 DSH 插件 ☐

> 🔴 **dist-tag 口径（撤策后 · 现行）**：下方每处 `npm publish --access public`（含「步骤八·补」的七款插件）**一律不加 `--tag`**——落默认 `latest`。历史分道说明见步骤七「dist-tag 分道」节（已撤策存档，不再执行）。

> 🔴 **包列表 SSOT = 根 `package.json` 的 workspaces（可发布子集）——禁止把包名硬编码当事实源**。
> 硬编码列表在包更名后必然漂移，照抄 = 静默漏发（漏发的包 npm 上停在上一版，无任何门禁会报）。
> 开跑前先对账：`node -p "require('./package.json').workspaces.join('\n')"` 与下方循环逐项核对——
> `engine/umbrella`（裸名总包）不在循环内（单独发）；`@sofagent/load-chain`（`engine/hooks/`）与
> `@sofagent/dsh-plugin-kit`（`engine/dsh-plugins/plugin-kit/`）虽**是** `@sofagent/*` scope 包，
> 但目录布局不是 `engine/<pkg>`，故也不在下方 `@sofagent/*` 循环里——各自单独段。七款 DSH 插件
> （`engine/dsh-plugins/cordis-plugin-sofagent*`）**是** npm 发布物，但包名是裸名、目录布局也不是
> `engine/<pkg>`，故不在下方 `@sofagent/*` 循环里——见「步骤八·补」。`engine/openclaw-plugins/*`
> 仍不是 npm 发布物（走 ClawHub 分发，见阶段十）。
>
> `npm publish --workspaces` 不支持 workspace 全局发布。release.yml 只 auto-publish audit + mcp（Release 触发），其余 `@sofagent/*` 手动 publish（11 个 `engine/<pkg>` 模块包（13 个模块包减去 auto 发布的 audit/mcp） + `load-chain` + `dsh-plugin-kit` = 13 包），再加裸名总包 `sofagent` 共 **14 包手动发布**。
>**再加七款 DSH 插件，本步骤发布面 = 23 包**（= 15 个 `@sofagent/*` scope 包 + 7 款 DSH 插件 + 1 个裸名总包；审计口径见步骤七 artifact 表第 3 行）。
>
> ⚠️ **`@sofagent/load-chain`（`engine/hooks/sofagent-load-chain/`）不在下方循环里**——下方循环写死 `engine/<pkg>` 布局，而它在 `engine/hooks/` 下，按「模块包」口径极易漏掉。必须把它加进循环与验证清单（仓内脚本 `publish-packages.sh` 已改为由根 workspaces 查表解析目录，不受此限）。
>
> ⚠️ **`@sofagent/dsh-plugin-kit`（`engine/dsh-plugins/plugin-kit/`）同样不在下方循环里**（章九二轮起转 npm 发布物）——目录在 `engine/dsh-plugins/` 下、不匹配 `engine/<pkg>`。它是六款原子插件的**适配层基座依赖** ⇒ **必须先于七款 DSH 插件发布**（否则插件装完第一步挂载即 `MODULE_NOT_FOUND: Cannot find module '@sofagent/dsh-plugin-kit'`）。单独段发布，见下方「load-chain 段」之后。
>
> ⚠️ **裸名总包 `sofagent`（`engine/umbrella/`）是手动 14 包中唯一的裸名包**——npm 包名是裸名 `sofagent`（无 scope）、目录名是 umbrella，两者都与循环模式不匹配，单独段发布。它是 npm 渠道的聚合安装入口（`npm i -g sofagent` = 全功能四包），v1.4.6 起随主线版本同步发版。

```bash
# 等 release.yml 完成（通常 3-5 分钟），确认 audit + mcp 已到 npm
npm view @sofagent/audit@vX.Y.Z version --prefer-online  # 期望返回版本号
npm view @sofagent/mcp@vX.Y.Z version --prefer-online    # 期望返回版本号

# 手动 publish 其余 11 个引擎模块包——每包 publish 后立即 npm view 对账 + E409 自动等待重查
# 🔴 publish 输出严禁接管道过滤（| grep xxx）——报错被过滤吞掉会表面循环跑完实际漏发，
#    23 包对账时才发现。输出必须全量落盘，失败立即停。
# 🔴 npm view 对账必须加 --prefer-online——裸查询吃本地缓存，刚 publish 完会误报
#    「失败实已发布」（发版 session 本地缓存里还是上版）。大包（≥800KB）registry 侧
#    收录延迟可达 3+ 分钟，对账窗口预留足够，勿据一次裸查询判定失败。
# 🔴 publish 日志含 `+@sofagent/<pkg>@<ver>` 行 = 已成功入队（npm CLI 的发布确认标记）——
#    propagation 延迟期（30s-5min 波动）view 查不到 ≠ 发布失败。判定序：先查日志有无入队行，
#    有则等 3 分钟再补查，连续 ≥6 轮仍查不到才升级人工处理（实锤：orchestrator/train/
#    load-chain 三包 6 轮超时全虚惊，日志均含入队行，等后全绿）。
TARGET_VER=$(node -p "require('./package.json').version")
for pkg in core daemon eval inject ontology orchestrator train rules evolve think ab-test; do
  echo "--- @sofagent/$pkg ---"
  ( cd "engine/$pkg" && npm publish --access public ) > "/tmp/publish-$pkg.log" 2>&1
  RC=$?
  if [ $RC -ne 0 ] && grep -q "E409\|previously staged" "/tmp/publish-$pkg.log"; then
    # E409 staged：registry 侧版本占位未 finalize，约 5 分钟自动完成（见下方 E409 段）
    echo "  ⏳ E409 staged——等 300s 自动 finalize 后重查"
    sleep 300
    LIVE=$(npm view "@sofagent/$pkg" dist-tags.latest --prefer-online 2>/dev/null || true)
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
  # 即时对账：publish exit 0 ≠ registry 已收录（npm 传播延迟波动大——实测常超 45s），
  # 重查 6 次 × 30s（3 次 × 15s 实测不够，常触发假报「对账失败」；
  # publish 日志含「+ @sofagent/X@ver」= 已提交入 registry 处理队列，重查超时只是传播慢，勿急着判失败）
  LIVE=""
  for i in 1 2 3 4 5 6; do
    LIVE=$(npm view "@sofagent/$pkg" version 2>/dev/null || true)
    [ "$LIVE" = "$TARGET_VER" ] && break
    echo "  ⏳ registry 传播中（查到 $LIVE），30s 后重查（第 $i 次）"
    sleep 30
  done
  [ "$LIVE" = "$TARGET_VER" ] && echo "  ✅ @sofagent/$pkg = $LIVE" || { echo "  🔴 对账失败：期望 $TARGET_VER 实际 $LIVE"; exit 1; }
done

# @sofagent/load-chain（布局在 engine/hooks/ 下，不进上面的循环——14 包手动口径之 12，验证逻辑同上）
( cd "engine/hooks/sofagent-load-chain" && npm publish --access public ) > /tmp/publish-load-chain.log 2>&1
RC=$?
[ $RC -ne 0 ] && { echo "🔴 load-chain publish 失败："; cat /tmp/publish-load-chain.log; exit 1; }
LIVE=$(npm view @sofagent/load-chain version 2>/dev/null || true)
[ "$LIVE" = "$TARGET_VER" ] && echo "✅ @sofagent/load-chain = $LIVE" || echo "🔴 load-chain 对账失败：期望 $TARGET_VER 实际 $LIVE"

# @sofagent/dsh-plugin-kit（engine/dsh-plugins/plugin-kit/，不进上面的循环——14 包手动口径之 13）
# 🔴 必须**先于「步骤八·补」的七款 DSH 插件**发布：六款原子插件以包名依赖它，
#    顺序反了则插件从 registry 装完第一步挂载即 MODULE_NOT_FOUND。验证逻辑同上。
( cd "engine/dsh-plugins/plugin-kit" && npm publish --access public ) > /tmp/publish-dsh-plugin-kit.log 2>&1
RC=$?
[ $RC -ne 0 ] && { echo "🔴 dsh-plugin-kit publish 失败："; cat /tmp/publish-dsh-plugin-kit.log; exit 1; }
LIVE=$(npm view @sofagent/dsh-plugin-kit version 2>/dev/null || true)
[ "$LIVE" = "$TARGET_VER" ] && echo "✅ @sofagent/dsh-plugin-kit = $LIVE" || echo "🔴 dsh-plugin-kit 对账失败：期望 $TARGET_VER 实际 $LIVE"

# 裸名总包 sofagent（engine/umbrella/——npm 聚合安装入口，包名无 scope 不进上方循环；14 包手动口径之 14）
# bin = `sofagent` 薄转发到 @sofagent/audit CLI；dependencies 四功能包（audit/mcp/orchestrator/daemon）
# 版本随 SSOT 同步（bump-version.sh 步骤 2c 自动覆盖 engine/umbrella/package.json）。
# 0.0.1 占位包（防抢注壳）无需 unpublish——总包跳版发布后 latest 自动指向本版。
( cd "engine/umbrella" && npm publish --access public ) > /tmp/publish-umbrella.log 2>&1
RC=$?
if [ $RC -ne 0 ] && grep -q "E409\|previously staged" /tmp/publish-umbrella.log; then
  echo "  ⏳ E409 staged——按上方 E409 段处理"
  exit 1
elif [ $RC -ne 0 ]; then
  echo "  🔴 裸名总包 publish 失败（exit $RC），完整报错："
  cat /tmp/publish-umbrella.log
  exit 1
fi
LIVE=""
for i in 1 2 3 4 5 6; do
  LIVE=$(npm view sofagent version 2>/dev/null || true)
  [ "$LIVE" = "$TARGET_VER" ] && break
  echo "  ⏳ registry 传播中（查到 $LIVE），30s 后重查（第 $i 次）"
  sleep 30
done
[ "$LIVE" = "$TARGET_VER" ] && echo "  ✅ sofagent（裸名总包）= $LIVE" || { echo "  🔴 裸名总包对账失败：期望 $TARGET_VER 实际 $LIVE"; exit 1; }
# 发版后冒烟：裸名直觉安装命令在 dry-run 下解析成功（不真装）
npm view sofagent dependencies --json | grep -q '"@sofagent/audit"' && echo "  ✅ 总包依赖面在位（audit/mcp/orchestrator/daemon）" || echo "  🔴 总包依赖面缺失——检查 package.json files/dependencies"
```

> 🔴 **E409「previously staged version」处理**：`npm publish` 网络中断会在 registry 留下 **staged blob**（发布事务中间态，版本号被占位但未 finalize）——同版本重发报 `409 Conflict - Cannot publish over previously staged version "X.Y.Z"`。**staged 版本约 5 分钟内自动 finalize**（多版实证：E409 后等待约 5 分钟，`npm view dist-tags.latest` 即显示新版本，无需 unpublish）。
>处理顺序：① 先等 5 分钟重查 `npm view <pkg> dist-tags.latest`；② 仍未 finalize 再考虑 `npm unpublish <pkg>@<version> --force`（staged blob 独立于记录，unpublish 后 registry 主节点传播完成即可重发同版本）。⚠️ 与「npm 版本永久锁死」铁律不冲突——E409 staged 是**未 finalize 的占位**，可清除重发；已 published 的版本才不可覆盖。

### 步骤八·补：七款 DSH 插件（`cordis-plugin-sofagent-*`） ☐

> 🔴 **为什么必须单独补一段**：上方 `@sofagent/*` 循环只筛该 scope 前缀 **+ `engine/<pkg>` 布局**，而这七款的
> 包名是**裸名** `cordis-plugin-sofagent*`、目录在 `engine/dsh-plugins/<id>`——两者都不匹配 ⇒ 上方循环会
> **静默跳过这七款却仍打印「✅ 全部包已发布」**。故此处显式发布；清单取自插件 SSOT
> `engine/dsh-plugins/plugins.json`（**不硬编码包名**——改名/新增款由数据源自动纳入，目录缺失即报红），
> 顺序 = 六原子款在前、suite 聚合款（`cordis-plugin-sofagent`，其 `optionalDependencies` 引用六个原子款）在末。
>
> 🔴 **发布前置之前置（章九二轮）**：本段的**前一拍**是上方「`@sofagent/dsh-plugin-kit` 单独段」——
> 六款原子插件以包名依赖 `@sofagent/dsh-plugin-kit`，该包未先发则逐款实装的第三步「`helpers.call` 引擎包
> 解析」必挂 `MODULE_NOT_FOUND: Cannot find module '@sofagent/dsh-plugin-kit'`。**kit 未发，本段不可开跑。**
>
> 🔴 **发布前置（硬门禁）**：七款必须先在**干净 DSH 环境逐款实装四段验证**（挂载 → seam 订阅 →
> `helpers.call` 引擎包解析 → 事件触发产出）——**不满足「单独可用」的不得发布**（空壳不发布）。
>
> **实作路径（不依赖 registry：先 `npm pack` 再隔离安装，等价于 registry 单装路径）**：
> ```bash
> V=/tmp/dsh-verify; rm -rf "$V"; mkdir -p "$V/tarballs"
> for d in engine/dsh-plugins/cordis-plugin-sofagent* engine/dsh-plugins/plugin-kit; do
>   ( cd "$d" && npm pack --pack-destination "$V/tarballs" >/dev/null ) || exit 1
> done
> cd "$V" && npm init -y && npm install ./tarballs/*.tgz   # 774 包依赖树（含 optional 的 @sofagent/*）
> ```
> 验证脚本放 `$V`（node ESM），**必须 `SOFAGENT_DATA=<临时目录>`** 隔离数据落盘，别写真实 `~/.sofagent/`。
> 四段判据与观察点（fakeCtx 用鸭子类型提供 `provide / on / get('tools') / settings / dynamicCordisRunner`）：
> - ① **挂载**：`(mod.default).default.apply(fakeCtx)`（CJS 互操作要逐层解 `default`）返回复合 disposer 且幂等；`provide` 收到 `sofagent.<short>`，`meta.id` == 包名、`version` == 本版；宿主 API 缺席时**不得**留假 disposer。
> - ② **seam 订阅**：订阅事件集**逐字等于** `plugins.json` 的 `seamHandlers`（多一个=幽灵订阅，少一个=假接线）；**非 seam 款（daemon / fde）期望 0**；**suite 期望转发「原子款 seam 之和」**（当前 6 原子 ⇒ 7；生命周期事件如 `dispose` 不计入 seam 集）。🔴 实测修正：原文把 suite 与 daemon/fde 并列写「期望 0」又在同句写「suite 期望 7」——**同句自相矛盾**，照前半句判会把 suite 的正确转发误判为「幽灵订阅」。
> - ③ **引擎包解析**：触发 handler 观察有无 `MODULE_NOT_FOUND`——**这是 kit 依赖桥的本命测试**（kit 未先发则此处必挂）；fde 另验 `resolveBridges()` 的 `resolved` 非空、`failed` 为空。
> - ④ **事件触发产出**：真造输入看真产出——audit 危险命令返回 `{kind:'deny'}`、`tools/result` 失败结果落 `<dataDir>/audit/`（decision-log.jsonl + intent.jsonl）、inject 的 `agent/pre-step` 返回 messages 多一条、evolve 的 `session/event`+`turn/end` 落 `think.md`、fde 角色工具注册数 > 0、suite 的 `SuiteReport.loaded == 6` 且 `failed` 为空。
>
> 🔴 **`--access public` 写法与裸名总包同款**（见上方 umbrella 段）——七款同为非 scoped 裸名，照抄该写法。
> 🔴 **不加 `--tag`**（撤策后口径，见步骤七）。七款均为**首发包**，直接落默认 `latest` ⇒ 装完 `npm i <pkg>` 立即可用，无需 `@alpha` 后缀、也无需事后 `dist-tag add`。四段实装验证仍是**发布前置门**（验证不过不发布），但不再有 dist-tag 二段动作。

```bash
# 七款 DSH 插件：清单取自 plugins.json（原子款在前、suite 末尾），逐款 publish + 即时对账
cd "$(git rev-parse --show-toplevel)"
for p in $(node -p "const d=require('./engine/dsh-plugins/plugins.json');const s=d.plugins.filter(p=>p.kind==='suite').map(p=>p.id);[...d.plugins.map(p=>p.id).filter(i=>!s.includes(i)),...s].join(' ')"); do
  echo "--- $p ---"
  ( cd "engine/dsh-plugins/$p" && npm publish --access public ) > "/tmp/publish-$p.log" 2>&1
  RC=$?
  if [ $RC -ne 0 ]; then
    echo "  🔴 publish 失败（exit $RC），完整报错："
    cat "/tmp/publish-$p.log"
    exit 1
  fi
  LIVE=""
  for i in 1 2 3 4 5 6; do
    LIVE=$(npm view "$p" version --prefer-online 2>/dev/null || true)
    [ "$LIVE" = "$TARGET_VER" ] && break
    echo "  ⏳ registry 传播中（查到 $LIVE），30s 后重查（第 $i 次）"
    sleep 30
  done
  [ "$LIVE" = "$TARGET_VER" ] && echo "  ✅ $p = $LIVE" || { echo "  🔴 对账失败：期望 $TARGET_VER 实际 $LIVE"; exit 1; }
done
```

> 仓内脚本同源实现 = `tools/release/publish-packages.sh` 的「DSH 插件发布」段（同数据源、同「原子款在前
> suite 在后」顺序、目录缺失即置失败标记、版本验证循环涵盖七款）。该脚本的 `@sofagent/*` 段**已改为由根
> `package.json` 的 workspaces 构建「包名→目录」查表**（章九二轮）——`@sofagent/dsh-plugin-kit`
> 因此被自动纳入并落第一层，无需像本 SOP 那样单独开段；施工期执行脚本时用
> `SOFAGENT_PUBLISH_TAG` 开关**常规发版一律不设**（撤策后口径：不设即落默认 `latest`）——仅在需要临时指定 tag 的高级场景（如回填历史通道）才显式赋值。

---

---

## 故障排查手册（已拆分）## 收尾：窗口态豁免移除（publish 完成后必做）

> 本阶段为了让 bump→publish 之间的时序差通过，曾登记 `npm-claims` 窗口态豁免（README 双语版本说明行的声称 ≠ registry latest）。**publish 完成后该豁免即成陈旧债**——声称值已与 registry 相等，豁免台账「可清空」设计要求债务清即移出（不改即留永久口子）：
> `tools/check/npm-claims-exempt.json` 的 `exemptAnchors` 清空 + notes 记移除理由；复跑 `node tools/check/check-npm-claims.mjs` 应报「无豁免、在线对账真绿」。

## 故障排查手册（已拆分）

> 网络降级 / 域名级断连重试 / 桌面发布物恢复 / 凭证 403 诊断 / 多 session 并发纪律等**异常路径处置**已拆分至独立手册：[troubleshooting.md](./troubleshooting.md)（跨阶段复用——10/11 阶段的同类故障也指向该手册）。步骤八正文止于正常发布路径。

