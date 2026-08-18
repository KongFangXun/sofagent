# 阶段九：工具脚本健康检查

> 工具脚本和产品代码同步演进，不要等脚本报错才发现缺口。每次发版前过一遍——防止「check 能查但 bump 不改」「新增目录没进排除规则」「regression-checklist 路径过时」三类结构性盲区。

---

## 步骤

| # | 步骤 | 验证方式 |
|:--:|------|------|
| 1 | **🔴 跑工具健康门禁**：`bash tools/check-tool-health.sh`——六项自动检查：审查文档路径活性（含 CI glob 前缀引用验证）/ 孤儿配置排查 / bump↔check 结构对照 / hook 头版本标记 vs SSOT / CI workflows 引用有效性 / **set -u 新变量初始化守卫**（`VAR="${VAR}..."` 首次赋值即自引用且无前置初始化 = 炸弹——v1.3.7 test-count.sh FLAKY_PKGS 实案，含 `local`/`declare`/`do` 后缀形态） | 脚本全绿（RC=0）；FAIL 按输出逐条修复 |
| 2 | **新增文件类型/目录排查**（脚本管不住的增量判断）：本版本有没有新增文件类型（`.yaml`/`.toml`/`.json5`）？→ check-version.sh 是否需要加检查项？bump-version.sh 是否需要加对应 bump 步骤？本版本有没有新增目录？→ find 排除规则是否需要更新？文件迁移？→ regression-checklist 路径是否需要更新？shellcheck 扫描范围与 CI 一致性。归档排除规则完整性。 | 逐项人工确认 |
| 3 | **三脚本对照检查**：① pre-push-check.sh 的检查项数量是否和 CHANGELOG/ROADMAP 声明的一致？② bump-version.sh --dry-run 必须验证为纯只读（跑完后 `git diff --stat` 零改动）。（check↔bump 结构对照与 check-version 分母已由步骤 1 脚本覆盖） | 跑脚本对照 |
| 4 | **🔴 `npm run build` 重建 dist 产物**（源码改了 dist 没改 = CLI 版本号不对） | `node engine/audit/dist/index.js --help` 显示正确版本 |
| 5 | **跨文档锚点校验** | `node tools/check-anchors.mjs` 全绿 |
| 6 | **🔴 hook 端到端实测**（见下方脚本） | 拦截 exit 2 + 放行 exit 0 |
| 7 | **shell 变量定界守卫**（`tools/*.sh` 中 `$VAR` 后紧跟 CJK 全角标点 → set -u 崩溃） | `bash tools/check-cjk-var.sh` 全绿 |

> 退出码语义（两个新门禁共用）：0=全绿 / 1=有 FAIL / 2=脚本自身错误——「工具死了」和「检查出问题」严格区分。
> 脚本产出是**清单不是结论**：⚠️/❌ 逐条人工裁决，修复归本阶段。

---

## hook 端到端实测脚本（步骤 6）

真装 hook + 真提交密钥验证拦截链路：

```bash
# 1. 准备隔离测试 bin（⚠️ 先 rm -f 确认不是 symlink——历史遗留 symlink 会覆盖 dist）
mkdir -p /tmp/fe-verify-bin
rm -f /tmp/fe-verify-bin/sofagent-audit  # 确认不是 symlink
printf '#!/bin/bash\nexec node %s/engine/audit/dist/cli-quick.js "$@"\n' "$(pwd)" > /tmp/fe-verify-bin/sofagent-audit
chmod +x /tmp/fe-verify-bin/sofagent-audit

# 2. 新仓库装 hook
mkdir -p /tmp/hook-test && cd /tmp/hook-test && rm -rf .git && git init
node -e "require('$(pwd)/../../engine/core/dist/config-template.js').HOOK_TEMPLATE" > .git/hooks/commit-msg 2>/dev/null || \
  node -e "console.log(require('./engine/core/dist/config-template.js').HOOK_TEMPLATE)" > .git/hooks/commit-msg
chmod +x .git/hooks/commit-msg

# 3. 拦截验证：提交含密钥 .env
# ⚠️ message 必须够长够具体（≥8 有效字符）——A5 不瞒真相 + A19 msg 质量会拦截
#    过短的 message（"test"/"init"），导致「密钥没测到先被 message 规则拦」的假失败（v1.3.4 教训）
export PATH=/tmp/fe-verify-bin:$PATH SOFAGENT_DATA=/tmp/fe-vd SOFAGENT_HOME=/tmp/fe-vh
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
cd - && rm -rf /tmp/hook-test /tmp/fe-verify-bin /tmp/fe-vd /tmp/fe-vh
```
