<!-- SOP-ANCHOR: S7 | file: 07-tool-health.md | prev: S6 | next: S8 -->
<!-- 机器锚（模型检索用，人不影响阅读）：grep "SOP-ANCHOR:" 可一跳取全部阶段元信息；本阶段完成后 → S8 -->
# 阶段七：工具脚本健康检查

> 工具脚本和产品代码同步演进，不要等脚本报错才发现缺口。每次发版前过一遍——防止「check 能查但 bump 不改」「新增目录没进排除规则」「regression-checklist 路径过时」三类结构性盲区。
>
> **总则：fail-loud 而非 fail-silent**——工具/门禁/守卫的任何一层故障（引擎崩、依赖缺失、环境异常）都必须**发出声音**（非 0 退出 + 明确报错），绝不允许把故障静默伪装成「零问题」通过。空输出 ≠ 零违规；「0 处违规但根本没在看」必须报红。本原则适用于本阶段全部步骤及未来新增的一切检查器。

---

## 步骤

| # | 完成 | 步骤 | 验证方式 |
|:--:|:--:|------|------|
| 一 | | **🔴 跑工具健康门禁**：`bash tools/check/check-tool-health.sh`——九项自动检查：审查文档路径活性（含 CI glob 前缀引用验证）/ 孤儿配置排查 / bump↔check 结构对照 / hook 头版本标记 vs SSOT / CI workflows 引用有效性 / **set -u 新变量初始化守卫**（`VAR="${VAR}..."` 首次赋值即自引用且无前置初始化 = 炸弹——给门禁/防御脚本加新逻辑时必查，含 `local`/`declare`/`do` 后缀形态）/ README 收录对账 / **防线失明自检**（见步骤八）/ **mjs 注释可执行反引号守卫**（`check-mjs-comment-backtick.mjs`：.mjs/.js 注释行反引号串首 token 形似仓内脚本路径或 npm/node/bash 命令头 = bash 误跑时会被当命令替换**真执行**——实锤：check-prepush-checklist.mjs 头部注释串曾让 bash 跑完整套 pre-push 防线数分钟。新写 .mjs 注释时反引号内不要放可执行形态路径，需要引用路径用单引号） | 脚本全绿（RC=0）；FAIL 按输出逐条修复 |
| 二 | | **新增文件类型/目录排查**（脚本管不住的增量判断）：本版本有没有新增文件类型（`.yaml`/`.toml`/`.json5`）？→ check-version.sh 是否需要加检查项？bump-version.sh 是否需要加对应 bump 步骤？本版本有没有新增目录？→ find 排除规则是否需要更新？文件迁移？→ regression-checklist 路径是否需要更新？shellcheck 扫描范围与 CI 一致性。归档排除规则完整性。**新增排障工具须在 SOP 登记用法与定位**（登记防孤儿——不登记的新脚本过几版就没人知道为什么存在；参照 resolve-section.sh 挂载于 [03](./03-quality-loop.md) / [04](./04-review-system.md)；check-storefront.sh 仓外门面对账挂载于 [09 步骤二](./09-publish.md)；check-forge-branches.sh 分支收编对账挂载于 [03 铁律三](./03-quality-loop.md)） | 逐项人工确认 |
| 三 | | **三脚本对照检查**：① pre-push-check.sh 的检查项数量是否和 CHANGELOG/ROADMAP 声明的一致？② bump-version.sh --dry-run 必须验证为纯只读（跑完后 `git diff --stat` 零改动）。（check↔bump 结构对照与 check-version 分母已由步骤一 脚本覆盖）。🔴 **先 commit 再跑 dry-run 验证**：dry-run 的「纯只读检测」需要干净基线——工作区有未提交改动时 `git diff --stat` 分不清「dry-run 污染」与「正当改动」，误判后执行 `git checkout -- .` 会**误撤全部未提交改动**。正确顺序：**先 `git commit` 收编当前改动 → 再跑 dry-run → 确认 diff 零改动** | 跑脚本对照 |
| 四 | | **🔴 `npm run build` 重建 dist 产物**（源码改了 dist 没改 = CLI 版本号不对）。🔴 **rebuild 后必须重置 dist 基线**：`bash tools/audit-baseline-sync.sh`——否则下一次 commit 被 P1-A2 影子审计器守卫拦截（dist 聚合哈希 vs 基线不匹配，属刻意防御的正常拦截非误报）。**基线语义是「多入口聚合哈希」**：`tools/audit-dist-hash.mjs` 聚合 dist 下**全部** `.js`（排序逐文件哈希再聚合），基线锚 `~/.sofagent/internal/audit-dist-hash.txt`——不是单文件 `audit-hash.txt`（后者仅作兼容锚保留，doctor 语义不同） | `node engine/audit/dist/index.js --help` 显示正确版本 + 基线同步后 commit 放行 |
| 五 | | **跨文档锚点校验** | `node tools/check/check-anchors.mjs` 全绿 |
| 六 | | **🔴 hook 端到端实测**（见下方脚本） | 拦截 exit 2 + 放行 exit 0 |
| 七 | | **shell 变量定界守卫**（`tools/` 下全部 `.sh` 中 `$VAR` 后紧跟**非 ASCII 字符** → 变量名被吞，set -u 崩溃 / 无 set -u 时静默展开为空）。⚠️ 危害主形态是**变量静默展开为空**（无 set -u 时不报错，只在输出里丢值，常藏在仅失败分支触发的行里）——不是只有 set -u 崩溃一种形态 | `bash tools/check/check-cjk-var.sh` 全绿 |
| 八 | | **🔴 防线失明自检**：`bash tools/check/check-guard-fail-loud.sh`——PATH 劫持假检测引擎（崩溃型 exit 3 / 空响应型 exit 0 无输出）实测守卫 fail-loud：引擎故障下守卫必须非 0 退出，仍 exit 0 = 「0 处违规但根本没在看」= 失明不自知，比没有防线更坏。覆盖判定路径依赖 perl 的守卫（check-cjk-var / check-guards） | 正常态 RC=0 且注入矩阵全报红；人为让 perl 失效重跑必须 RC≠0 |

> 退出码语义（两个新门禁共用）：0=全绿 / 1=有 FAIL / 2=脚本自身错误——「工具死了」和「检查出问题」严格区分。
> 🔴 **audit CLI 的退出码契约（步骤六相关）**：0=全绿 / 1=有警告（放行）/ 2=有违规（阻断）/ 3=非 git 仓库（cli-quick 口径）/ **引擎崩溃=4**——node 未捕获异常默认 exit 1 会与「警告」撞码，导致 hook 把崩溃当警告**静默放行**（fail-open 实测：含密钥的 .env 入库）。hook 侧已有 `-ne 0` 兜底分支拦截非 0/1/2 退出码。
> ⚠️ **v1.4.9 P1-15 变更**：崩溃码由 **3 改 4**。原 3 与 cli-quick 自己的「非 git 仓库 ⇒ `return 3`」**撞码**（实测两义并存：非 git 目录跑出 3，`SOFAGENT_HOME` 越界崩溃也跑出 3），定位需靠 stderr 猜。改 4 后「引擎崩溃」与「用错目录」可由退出码单义区分。hook 侧 `-ne 0` 兜底分支逻辑未动（3/4 同样落入该分支）。

> 脚本产出是**清单不是结论**：⚠️/❌ 逐条人工裁决，修复归本阶段。

---

## hook 端到端实测脚本（步骤六）

真装 hook + 真提交密钥验证拦截链路：

```bash
# 1. 准备隔离测试 bin（⚠️ 先 rm -f 确认不是 symlink——symlink 会覆盖 dist）
mkdir -p /tmp/fe-verify-bin
rm -f /tmp/fe-verify-bin/sofagent-audit  # 确认不是 symlink
printf '#!/bin/bash\nexec node %s/engine/audit/dist/cli-quick.js "$@"\n' "$(pwd)" > /tmp/fe-verify-bin/sofagent-audit
chmod +x /tmp/fe-verify-bin/sofagent-audit

# 2. 新仓库装 hook（🔴 必须显式 console.log 输出——「require('...').HOOK_TEMPLATE」只求值不打印，
#    会让 hook 文件为空且 exit 0 → fallback 不触发 → 拦截链路静默失效）
mkdir -p /tmp/hook-test && cd /tmp/hook-test && rm -rf .git && git init
# 🔴 v1.4.8 修正：不再从 core 的 HOOK_TEMPLATE 导出取模板（该常量已 @deprecated——它曾与
#    engine/audit/hooks/ 人工同步并漂移，正是 S51 假红根因）。改为走**真实安装路径**：
#    `sofagent-audit --init`（唯一源 = hooks/ 目录），顺带让本步骤测的是用户实际拿到的 hook。
node "$(pwd)/../../engine/audit/dist/index.js" --init >/dev/null 2>&1
test -s .git/hooks/commit-msg || { echo "❌ hook 未安装——--init 异常，停手排查"; exit 1; }
test -x .git/hooks/commit-msg || chmod +x .git/hooks/commit-msg

# 3. 拦截验证：提交含密钥 .env
# ⚠️ message 必须够长够具体（≥8 有效字符）——A5 不瞒真相 + A19 msg 质量会拦截，
#    过短的 message（"test"/"init"）会导致「密钥没测到先被 message 规则拦」的假失败
# 🔴 v1.4.8 修正：SOFAGENT_HOME 不能用 /tmp 下路径——core 的 sanitizeSofagentHome 会
#    fail-loud 拒绝（越界前缀），audit 随之崩溃。两种正确写法任选：
#      a) 用 HOME 下路径（推荐）：SOFAGENT_HOME="$HOME/.sofagent-hooktest"
#      b) 确需 /tmp 时显式放行：SOFAGENT_HOME_ALLOWED_PREFIXES=/tmp
export PATH=/tmp/fe-verify-bin:$PATH SOFAGENT_DATA="$HOME/.sofagent-hooktest/data" \
       SOFAGENT_HOME="$HOME/.sofagent-hooktest/home"
echo "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" > .env
git add -f .env   # ⚠️ 必须 -f——init 自带的 .gitignore 会挡 .env（git 层先拦是双保险，但那样测不到 hook 层）
git commit -m "chore: add environment config for deployment"  # 期望：A1+A2 拦截 exit 2，.env 未入库
git show HEAD:.env 2>&1 | grep -q "fatal" && echo "✅ 密钥被拦截" || echo "❌ 密钥入库了"

# 4. 清暂存区后测干净提交（⚠️ 必须清，否则残留 .env 会误拦；首提对空树审计，message 同样要合格）
git reset HEAD -- .env && rm .env
echo "print('hello')" > app.py && git add app.py
git commit -m "feat: add hello application entry point"  # 期望：17 规则 PASS 放行 exit 0
git log --oneline -1 | grep -q "hello application" && echo "✅ 干净提交放行" || echo "❌ 干净提交被拦"

# 5. 清理
cd - && rm -rf /tmp/hook-test /tmp/fe-verify-bin /tmp/fe-vd
```

> ⚠️ **SOFAGENT_HOME 越界守卫提示**：v1.4.4 起 data-paths 守卫拒绝 HOME 指向 /tmp 等非允许前缀（回退 ~/.sofagent）——隔离 HOME 请用测试仓库内路径（如上 `$(pwd)/.sofagent-test`），数据面隔离走 `SOFAGENT_DATA=/tmp/fe-vd`（DATA 允许任意路径）。
