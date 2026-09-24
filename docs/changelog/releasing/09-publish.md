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

1. **报错**——任一对外动作失败（push 被拒 / CI 红 / publish 报错）→ 停下报告请示，不自行重试对外动作（重试循环仅适用网络类瞬态失败，见「网络降级策略」）
2. **硬前置不满足**——CI 全绿才打 tag / tag 内自洽才 release / release.yml 成功才手动 publish 其余包：前置失败时停在关口，不跨越

**判别口径不变**：该步骤失败后是否需要撤回「已对外可见的状态」——一揽子授权改变的是请示次数，不改变安全边界。与 [08-confirm「AI 代执行边界」](./08-confirm.md) 一致：授权 AI 跑命令 ≠ 授权 AI 管凭证，npm 凭证始终在人的控制下。

---

## 前置：lock file + 内部依赖一致性

```bash
# lock file 更新（新增 workspace 包或改了依赖时必须，否则 CI npm ci 报 Missing）
npm install

# lock file 与 package.json 一致性验证（CI 用 npm ci 严格模式）
npm ci --dry-run 2>&1 | grep -q "missing\|error" && echo "❌ lock 不一致" || echo "✅ lock 一致"

# 内部 @sofagent/* 依赖版本同步检查（bump 后所有内部依赖必须是同一版本）
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
#   ② 文件级前置过滤静默跳过（check-silent-catch：617 个 .ts 跳过 167 个，其中 83 个含 177 处 catch 零覆盖）
#   ③ 存量基线豁免（silent-catch-baseline.json 304 条）
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

## 步骤四：push main + 等 CI 全绿 ☐

> **tag 先行策略**：先 push main → 等 CI 全绿验证 → 才打 tag。tag 一定指向 CI 验证过的 commit，不会 tag 了之后才发现 CI 红。
>
> 🔴 **push 前置检查：workspace 包与 lock 同步**：新增 workspace 包但 lock file 未同步时，push 后多个 CI 工作流（pr-check/verify/audit/windows-ci）在 `npm ci` 严格校验上**同根因全红**（本地 `npm install` 会静默补齐所以本地全绿，CI `npm ci` 直接炸）。**push 前必跑**：`npm ci --dry-run 2>&1 | grep -c "^npm error Missing"` 期望 0——非 0 则 `npm install --package-lock-only` 补齐 lock 后随代码同 commit。
>
> 🔴 **CI 全绿是打 tag 的硬前置**：push 之后必须**轮询等到全绿**（不是看一眼就走）——`exit 0` 之前禁止进入步骤六。CI 红着打 tag 会让用户装到坏版本（tag 是安装入口的锚点），回滚成本远高于等待 2-5 分钟。**轮询必须前台执行**：上述 while 循环在 session 前台逐轮跑（每轮一查 + sleep 60），严禁包进 run_in_background——挂后台 = session 空闲 = 界面无进展反馈。轮询脚本如下（循环跑直到 exit 0，每次间隔 60s）：

```bash
# ── push main（🔴 实证：裸命令一次成功率不稳——github.com:443 间歇阻断，
#    round 2 才成功是常态。push 主命令直接用「网络降级策略」的重试循环形态跑
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

## 步骤五：安装入口随版同步 ☐

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

> 注意：check-version.sh 含安装入口 tag 对账检查项，`bash tools/check/check-version.sh` 会给出三方 tag 一致性结论；此处 curl 是最后一道实测防线（URL 真实可达性）。

### 🔴 bootstrap.sh sha256 同步（每版必做）

> bootstrap.sh 对下载的 install.sh + 6 个 lib 文件做 sha256 校验（curl | bash 信任模型加固）。**tag 指向新版后哈希必然变化——必须同步更新 bootstrap.sh 内嵌的 7 个哈希，否则用户安装会因校验失败而 fail-closed（好陷阱：宁可不装也不装被劫持的脚本，但会让所有人装不上）。**

**优选路径：预计算哈希与 URL bump 同 commit，tag 一次打自洽**——打 tag 前预计算 HEAD 的 install.sh 哈希（`git show HEAD:install.sh | shasum -a 256`）与 tag URL bump、哈希回填全部进同一个 commit，push 后打 tag——tag 内 bootstrap.sh 天然自洽，无需重打。install.sh/lib 自上版零改动时 6 lib 哈希沿用免回填（`git diff <上tag>..HEAD --stat -- engine/scripts/lib/` 输出空即零改动）。验收：`git show vX.Y.Z:bootstrap.sh` 内嵌哈希 == `git show vX.Y.Z:install.sh | shasum -a 256`。

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

> 🔴 **时序陷阱：回填哈希后必须重打 tag**——「先改 URL 提交 → 打 tag → 算哈希 → 回填提交」会让 tag 内 bootstrap.sh 仍持旧哈希（tag 内不自洽）。正确收口 = 回填哈希的 commit 落盘后**重打 tag**：`git tag -d vX.Y.Z && git tag -a vX.Y.Z -m ... && env -u http_proxy ... push origin :refs/tags/vX.Y.Z && push origin vX.Y.Z`（tag force 覆盖远端）。验收：`git show vX.Y.Z:bootstrap.sh | grep INSTALL_SHA256` 的哈希 == `git show vX.Y.Z:install.sh | shasum -a 256`。install.sh 本体无改动时 6 lib 哈希不变，只重算 install.sh 一项。

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

> 🔴 **tag push 失败重试**：`git tag -a` 本地打标成功但 push 可能被中断（实测 exit 137 SIGKILL / 超时）——此时**远端没有 tag，本地有**（`gh api repos/O/R/git/ref/tags/vX.Y.Z` 404 确认）。重试直接用「网络降级策略」的完整命令（剥代理 + HTTP/1.1 + 低速兜底）单独 push tag：`env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy git -c http.proxy= -c https.proxy= -c http.version=HTTP/1.1 -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=300 push origin vX.Y.Z`——push 完成后用 `gh api repos/O/R/git/refs/tags/vX.Y.Z --jq '.object.sha'` 确认远端存在，与本地 `git rev-parse vX.Y.Z` 一致。

---

## 步骤七：gh release（触发 release.yml 自动 publish audit + mcp） ☐

> GitHub Release published 后，`.github/workflows/release.yml` 自动触发，publish `@sofagent/audit` 和 `@sofagent/mcp` 两个包到 npm。其余 `@sofagent/*` 与裸名总包在步骤八手动 publish（13 个手动 `@sofagent/*` = 11 个引擎模块包 + `load-chain` + `dsh-plugin-kit`，加裸名总包 `sofagent` 共 **14 包**——包数口径以步骤八头部为准）；**另有七款 DSH 插件**（`cordis-plugin-sofagent-*`，裸名、目录在 `engine/dsh-plugins/`）同样在步骤八手动 publish——见「步骤八·补」。

### 🔴 dist-tag 分道（`gh release create` 之前必做 · 施工期一律 `--tag alpha`）

> **判据是版本期，不是日期**：本版低于 `v2.0.0` = 施工期 → 本版**全部 23 包**（15 个 `@sofagent/*` scope 包（13 模块包 + `load-chain` + `dsh-plugin-kit`）+ 1 个裸名总包 + 七款 DSH 插件）以 `--tag alpha` 发布，**`latest` 不动**；本版达到 `v2.0.0` = 贝塔，不加 tag（默认写 `latest`），恢复正常发布。
> **为什么有这条**：施工期功能面快速变动、不承诺接口稳定，`latest` 是留给「装了就不想被施工期改动打扰」的稳定通道——施工期把 `latest` 一路顶到最后一个施工版，等于把所有用户强推上施工节奏。
>
> 🔴 **自动通道也要管**：`.github/workflows/release.yml` 的 `npm publish --access public` **不带 tag**——本步骤若不先行，audit + mcp 会被 CI 以默认 tag 发布、`latest` 当场被改写。故施工期必须在 `gh release create` **之前**先手动以 `alpha` 发布这两包：release.yml 的 `Check if version already published` 步查到版本已在即置 `skip=true`、自动跳过 publish（该跳过通道 release.yml 内既有，非本步骤新增机制）。

```bash
# 施工期（本版低于 v2.0.0）：先手动以 alpha 发布自动通道那两包，再 gh release create
( cd engine/audit && npm publish --access public --tag alpha ) > /tmp/publish-audit.log 2>&1 \
  || { echo "🔴 audit publish 失败："; cat /tmp/publish-audit.log; exit 1; }
( cd engine/mcp && npm publish --access public --tag alpha ) > /tmp/publish-mcp.log 2>&1 \
  || { echo "🔴 mcp publish 失败："; cat /tmp/publish-mcp.log; exit 1; }
# 达到 v2.0.0 起：删掉上方两行（恢复由 release.yml 自动发布 = latest）
```

**逐格打勾**（施工期四格全做；达到 `v2.0.0` 起只做第 4 格）：

- [ ] 判版本期：本版低于 `v2.0.0` → 本步骤与步骤八全程 `--tag alpha`；达到 `v2.0.0` → 全程默认 tag
- [ ] 施工期：`gh release create` 之前先行发布 audit + mcp（上方命令），并确认 release.yml 走到「已发布即跳过」
- [ ] 施工期：步骤八每处 `npm publish --access public` 追加 `--tag alpha`
- [ ] 发布后对账：逐包 `npm view @sofagent/<pkg> dist-tags --prefer-online`——期望 `alpha` = 本版、**`latest` 不动**。施工期任何包出现在 `latest` = 策略被破坏：处置是查发布命令漏了 tag，**不是改本文件**

> 🔴 **首发包（本版首次上 npm 的包）额外一拍**：`--tag alpha` 意味着该包在 `@latest` 上**根本不存在**——`npm i <pkg>`（默认取 `latest`）会报 `No matching version found`。本版首发的七款 DSH 插件 + `@sofagent/dsh-plugin-kit` 全属此类。二选一，**发布前想清楚选哪条**：
> ① **保持施工期分道**：对外说明用 `npm i <pkg>@alpha`（或 `npm dist-tag add` 前先不装）；`latest` 留到**贝塔期**再由一次正式发布顶上（判据 = 本版低于 `v2.0.0`，见上）。
> ② **验证通过后提升 `latest`**：**先**在干净 DSH 环境跑完「步骤八·补」的四段实装验证（挂载 → seam 订阅 → `helpers.call` 引擎包解析 → 事件触发产出），**再**执行 `npm dist-tag add <pkg>@<版本> latest` 逐款顶 `latest`。
> ⚠️ **顺序不可颠倒**：未验证就顶 `latest` = 把未验证的空壳推给 `npm i` 的默认通道（本仓最痛恨的假绿形态）。逐款 `dist-tag add` 后仍按上一格复查 `dist-tags`。

### 🔴 发版 artifact 四件对账（release create 后立即做，不等收尾）

> 每版发完都出现「Release 发了但某个 artifact 断链」的返工——四件 artifact 在 release create 后**立即逐件核验**，比收尾阶段统一排查省一轮往返：

| # | artifact | 核验命令 | 期望 |
|---|----------|---------|------|
| 1 | git tag（远端存在且指向发版 commit） | 🔴 annotated tag 对账口径：`gh api git/refs/tags` 返回的是 **tag object SHA** ≠ commit SHA，直接与 `git rev-parse vX.Y.Z^{commit}` 比必不等——正确对账二选一：① `gh api refs/tags` 的 sha == `git rev-parse vX.Y.Z`（本地 tag object SHA）② `gh api git/tags/<object-sha>` 二段查 `.object.sha` == `git rev-parse vX.Y.Z^{commit}` | 两 SHA 一致（同口径） |
| 2 | GitHub Release（title + body 可达） | `gh release view vX.Y.Z --json name,isDraft` | name 匹配、isDraft=false |
| 3 | npm 23 包（audit + mcp 自动，其余 14 手动 + 七款 DSH 插件手动后） | `for p in audit mcp core daemon eval inject ontology orchestrator train rules evolve think ab-test; do npm view @sofagent/$p version --prefer-online; done` + `npm view @sofagent/load-chain version --prefer-online` + `npm view @sofagent/dsh-plugin-kit version --prefer-online` + `npm view sofagent version --prefer-online` + `for p in $(node -p "require('./engine/dsh-plugins/plugins.json').plugins.map(p=>p.id).join(' ')"); do npm view "$p" version --prefer-online; done` | 23 项全部 = 本版号（🔴 必加 --prefer-online——裸查询吃缓存会误报漏发） |
| 4 | 安装入口（README 双语 + bootstrap.sh 的 tag URL 可达） | `grep -rn "refs/tags/v" README.md README.en.md bootstrap.sh` + 逐条 `curl -sI` HTTP 200 | 三处 = 本版 tag 且真实可达 |

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

# ④ 尾链存在且为 markdown 链接语法
echo "$BODY" | grep -qE '\[详细开发日志\]\(\./docs/changelog/' && echo "✅ 尾链" || echo "🔴 缺尾链"

# ⑤ 定位句长度 ≤ 220 字符（N9 铁律）
POS_LEN=$(node -e "console.log(require('fs').readFileSync(0,'utf8').split('\n')[0].length)")  # 🔴 禁用 awk length——macOS awk 按字节计，中文行会 3 倍误报超限
[ "$POS_LEN" -le 220 ] && echo "✅ 定位句 $POS_LEN 字符" || echo "🔴 定位句 $POS_LEN 字符超 220 上限——拆 H3 承载"

# ⑥ BugFix 节标题逐字核对（N10——有 bugfix 节时必须带「（上版遗留）」补语）
echo "$BODY" | grep -E "^### 🔒" | grep -q "BugFix（上版遗留）" && echo "✅ BugFix 标题合规" || echo "🔴 BugFix 标题漂移（缺「（上版遗留）」补语）"

# ⑦ 里程碑 🎉 前缀规则（N11——仅 vX.Y.0 可用 🎉 vX.Y.Z — 格式；常规版尾部禁装饰）
echo "$TITLE" | grep -qE "^🎉 v[0-9]+\.[0-9]+\.0 — " && echo "✅ 里程碑格式（X.Y.0）" || echo "$TITLE" | grep -qE "^🎉" && echo "🔴 非 X.Y.0 版误用 🎉 前缀" || echo "✅ 常规版格式"
```

**工序三 · 上一版结构对照（取代人工过目）**：自检全过后，与上一版 release body 做**结构级并排对照**——title 形式（`vX.Y.Z — emoji 短语`，里程碑 `🎉 vX.Y.0 —` 前缀规则见 N11）/ 定位句有无 + 长度（N9 ≤220 字符）/ 英文 TL;DR 有无 / Install 速查块有无 / H2 骨架 / 质量表 7 项顺序 / BugFix 节标题逐字（N10）/ 破坏性变更迁移命令 / 尾链位置，十要素逐一比对上一版，**结构不一致即重写，直到同构**。机制标准 = **v1.4.2 实际发布物（标准锚点：含英文 TL;DR + Install 速查 + 迁移命令 + 深入了解导航表）**——若上一版漂移，以 v1.4.2 为准重写，不追随上一版。对照命令：`gh release view v1.4.2 --json name,body -q '{name, body}'`（锚点）+ `gh release view 上一版 --json name,body`（漂移检测）。

```bash
> 🔴 **发布前必做**：生成 body 后先与上一版并排对照——`gh release view v上一版 --json body -q '.body' | grep -E "^## "`——两版 H2 骨架必须同构（首行定位句/核心变更/破坏性变更/质量验证/尾链）。**changelog 内嵌的 Release Notes 段 ≠ GitHub Release body**：前者归 08 的 N1-N7 管（✨ 新功能 bullet 式），后者归本规范管（### 功能领域子标题式）——分别核对，禁止把 changelog 段直接复制当 body。

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
| acceptance-test | {N}/{N} passed · SKIP: {N} · EXIT: {N} ✅ |
| shellcheck | 零 error ✅ |
| check-version | {N}/{N} 全绿 ✅ |
| 回归检查 | {N} 维度 ✅ |
| release-gate | verdict=PASS ✅ |
| fresh-eyes | {N} 视角审查闭环 ✅ |

📖 [详细开发日志](./docs/changelog/v{major}.{minor}/vX.Y.Z.md)  <!-- 链接相对仓库根（发布后 GitHub 上可达），在本文档内直接点击不可达 -->
EOF
)"
```

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

## 步骤八：npm 手动 publish 其余 14 包（含裸名总包）+ 七款 DSH 插件 ☐

> 🔴 **dist-tag 分道（与步骤七同款）**：施工期（本版低于 `v2.0.0`）下方每处 `npm publish --access public`（含「步骤八·补」的七款插件）一律追加 `--tag alpha`、`latest` 不动；达到 `v2.0.0` 起去掉该 tag。判据与发布后对账命令见步骤七「dist-tag 分道」节（本节不复述）。

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
> `npm publish --workspaces` 不支持 workspace 全局发布。release.yml 只 auto-publish audit + mcp（Release 触发），其余 `@sofagent/*` 手动 publish（11 个 `engine/<pkg>` 模块包（13 个模块包减去 auto 发布的 audit/mcp） + `load-chain` + `dsh-plugin-kit` = 13 包），再加裸名总包 `sofagent` 共 **14 包手动发布**。**再加七款 DSH 插件，本步骤发布面 = 23 包**（= 15 个 `@sofagent/*` scope 包 + 7 款 DSH 插件 + 1 个裸名总包；审计口径见步骤七 artifact 表第 3 行）。
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

> 🔴 **E409「previously staged version」处理**：`npm publish` 网络中断会在 registry 留下 **staged blob**（发布事务中间态，版本号被占位但未 finalize）——同版本重发报 `409 Conflict - Cannot publish over previously staged version "X.Y.Z"`。**staged 版本约 5 分钟内自动 finalize**（多版实证：E409 后等待约 5 分钟，`npm view dist-tags.latest` 即显示新版本，无需 unpublish）。处理顺序：① 先等 5 分钟重查 `npm view <pkg> dist-tags.latest`；② 仍未 finalize 再考虑 `npm unpublish <pkg>@<version> --force`（staged blob 独立于记录，unpublish 后 registry 主节点传播完成即可重发同版本）。⚠️ 与「npm 版本永久锁死」铁律不冲突——E409 staged 是**未 finalize 的占位**，可清除重发；已 published 的版本才不可覆盖。

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
> 🔴 **发布前置（章九硬门禁）**：七款必须先在**干净 DSH 环境逐款实装四段验证**（挂载 → seam 订阅 →
> `helpers.call` 引擎包解析 → 事件触发产出）——**不满足「单独可用」的不得发布**（空壳不发布）。
>
> 🔴 **`--access public` 写法与裸名总包同款**（见上方 umbrella 段）——七款同为非 scoped 裸名，照抄该写法。
> 施工期同样追加 `--tag alpha`（见步骤七「dist-tag 分道」）。七款均为**首发包**，`--tag alpha` 后默认
> `latest` 上不存在 ⇒ 「`@alpha` 装不上 / 验证后 `npm dist-tag add` 顶 `latest`」二选一，见步骤七「首发包
> 额外一拍」。

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
> `SOFAGENT_PUBLISH_TAG=alpha bash tools/release/publish-packages.sh <版本>` 让全量 publish 追加 `--tag alpha`。

---

## 网络降级策略

### 直连 push 与 HTTP/1.1

> push 常见三连失败：①git config 死代理 → ②直连 443 超时/「HTTP2 framing layer」→ ③HTTP/1.1 + 速度限制后成功。**经验：curl 能通 ≠ git 能通**（git 走 HTTP/2 + 慢连接更脆弱），git 侧强制 HTTP/1.1 + 慢速兜底最稳。

```bash
# 全配置一键直连（git config 代理 + 环境变量代理全剥）：
env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy \
  git -c http.proxy= -c https.proxy= -c http.version=HTTP/1.1 \
  -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=300 \
  push origin main
```

> curl 探测代理端口存活：`curl -s -o /dev/null -w "%{http_code}" -x http://127.0.0.1:<端口> https://github.com`——200 = 端口可用（但 git 仍可能因 HTTP/2 失败，直接上 HTTP/1.1）。

### 🔴 多 session 并发期禁用 git add -A

发布流水线跨多 session（本 session 收尾 + 其他 session 在途）时，`git add -A` 会把**其他 session 的在途改动**一并吞进本任务 commit（曾一次吞 19 文件含他人 package.json 与 2041 行 lock 删除——审计 A3/A11 警告才暴露，若已 push 将污染远端）。**收编一律逐文件 add**（任务清单内的文件显式列出）；审计 A3「不改越界」警告是最后的拦截线——**警告出现即说明混入了清单外文件，必须 reset 拆分重提，禁止带病 push**。

### 🔴 凭证类 403 的诊断序（push 被拒 ≠ 网络问题）

> 症状：`git push` 报 `remote: Permission to <owner>/<repo>.git denied to <owner>` + `403`，
> 而 `gh api user` 正常、`gh api repos/... --jq .permissions` 显示 `push:true`。
> **注意：API 的 permissions 位反映的是「账号对该仓的能力」，不是「当前 token 的能力」**——拿它当判据必误判。

三步定性（按序做，前一步不能确定才进下一步）：

1. **测 token 的写权限（唯一可信判据）**：用 Contents API 做一次最小写
   `curl -X PUT -H "Authorization: Bearer $(gh auth token)" .../contents/_perm-test.txt -d '{"message":"perm test","content":"dGVzdA=="}'`
   ——返回 `Resource not accessible by personal access token` = **fine-grained token 的 Contents 权限是 Read-only**（高频默认值），
   须去 token 设置页把 `Contents` 与 `Workflows` 改为 Read and write（可原位编辑，token 串不变）。
   写成功记得 DELETE 清理（会留下两个测试 commit，内容已删，属可接受留痕）。
2. **看 git 实际用了哪个凭证**：`GIT_TRACE=1 GIT_CURL_VERBOSE=1 git push ...` 看 `run_command: '... git-credential get'`
   ——命中 `git-credential-osxkeychain` 说明**钥匙串旧凭证优先于 gh 的 token**；
   修法 = `git config --global --unset-all credential.helper` 后按序重加 `!gh auth git-credential` → `osxkeychain`，
   并 `printf 'protocol=https\nhost=github.com\n' | git credential-osxkeychain erase` 清旧条目。
3. **才轮到网络层**（前两步都通过）：`git -c http.version=HTTP/1.1 push`；仍失败且 `curl https://github.com` 返 `000` = 出口网络问题。

> 🔴 **权限拒绝与网络抖动必须分开处置**：网络问题表现为 `Failed to connect` / `Error in the HTTP2 framing layer` /
> `Recv failure` / curl 返 `000`；**权限问题固定为 `denied to <owner>` + `403`——后者重试一万次也不会好**。

### 🔴 重试循环与退出码测量（单次命令不够——网络失败是间歇性的）

单次降级 push 成功≠网络稳定——失败形态会轮换（SSL timeout / Connection reset / Empty reply / lowSpeed 超时），**必须重试循环**（每轮重新评测，成功即退）：

```bash
for i in 1 2 3 4 5 6; do
  env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy \
    git -c http.proxy= -c https.proxy= -c http.version=HTTP/1.1 \
    -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=300 \
    push origin main > /tmp/push-retry.log 2>&1
  RC=$?
  [ $RC -eq 0 ] && { echo "✅ 第 $i 次成功"; break; }
  echo "第 $i 次 RC=$RC: $(tail -1 /tmp/push-retry.log)"
  sleep 30
done
```

> 🔴 **退出码测量禁管道**：`cmd | tail -2; echo $?` 的 `$?` 是 tail 的退出码——push 失败会被误报为成功。测量一律「输出重定向到文件 + 独立 echo $?」，或 `PIPESTATUS` 数组。多 session 并发期尤其要重试循环兜底——并发 session 的 commit 交错合流（无冲突时快进），中间态 HEAD 被推上去无害。

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


### main push 完全走 Git Data API（git push 死代理时）

> 🛠 **优先用固化脚本**：`node tools/release/gitdata-push.mjs`——上述流程（blobs→trees→commits→refs PATCH + tree 一致性验收 + 删除补删 + mode 保真）已工具化，前置检查（工作树干净/远端实时 SHA）内置。**手工流程仅在脚本不可用时走下方步骤**（三坑/四坑原理同样适用脚本维护者）。

git push 彻底走不了（代理端口连不上）时，用 Git Data API 把本地 commit 内容推上去。核心 = 以远端 HEAD 为 parent 建「压平 commit」（blobs→tree→commit→ref，fast-forward 非 force）：

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

**🔴 三坑（务必按此做）**：
1. **base64 内容禁用 `-f content=` 传参**——大文件 base64 超 ARG_MAX 报 `Argument list too long`。必须 `--input -` 从 stdin 传 JSON body（`{"content":"<base64>","encoding":"base64"}`）
2. **`.gitattributes` 的 eol 转换**——`*.ps1 text eol=crlf` 会让 git 存 LF 规范化 blob，工作区是 CRLF。上传必须用 `git cat-file blob <本地git sha>` 拿规范内容，不能读工作区文件（否则 sha 不一致）。**验证铁证：建 tree 后远端 tree sha == 本地 `git rev-parse HEAD^{tree}` = 逐字节一致**
3. **cat-file 必须用本地 git blob sha**——不能用「上传后 GitHub 返回的 sha」去 cat-file（本地无此对象 → 输出空 → 上传空 blob，sha 变 e69de29b）。修正时用 `git ls-tree` 重新拿本地 sha

**🔴 第五坑（连续推送）——tree 参数必须 stdin JSON**：gh CLI 命令行拼 `tree[][path]=…` 数组参数，17 文件 = 68 个参数直接报 `accepts 1 arg(s), received 69`——tree 创建必须 `--input -` 从 stdin 传 `{"base_tree":…,"tree":[…]}` JSON（gitdata-push.mjs 已内置）。另：连续 API 推送时本地无上次 API commit 对象，`git diff <remoteSha>..HEAD` 炸——脚本用 compare API 兜底取变更清单（status=diverged 时拒绝盲推）。

**🔴 四坑（verify CI 失败根因）——tree 条目 mode 必须用本地真实值**：tree 每一项带 mode（`100644` 普通 / `100755` 可执行），**硬编码 `100644` 会让所有 .sh/.mjs 丢失执行位**——推送前 `git ls-tree -r HEAD | grep "^100755"` 列出全部可执行文件，tree 条目逐项用本地 mode。丢失后 verify CI 报「cleanup.sh 缺失或不可执行」（find 找到文件但 `-x` 检查失败）。**恢复只需一次操作**：blob SHA 只依赖内容，同一文件的 755 与 644 版本 blob SHA 相同——建一个只含 N 个 100755 条目的新 tree（base_tree=当前远端 tree，sha 引用已存在 blob）→ 建 commit → 更新 ref，无需重传内容。**推送完成必验**：远端 tree sha == 本地 `git rev-parse HEAD^{tree}`。
> 另：Git Data API 的 create-tree **无法表达删除条目**——rename（R100）在 diff 里是「新路径新增」，旧路径永远留在 base_tree；含删除/rename 的 commit 推送后必须用 Contents API（`gh api repos/O/R/contents/<path> -X DELETE -f sha=<file sha>`）逐个补删，最后同样以 tree sha 一致性收尾。
