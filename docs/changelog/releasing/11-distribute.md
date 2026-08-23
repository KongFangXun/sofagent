# 阶段十一：分发（Skill / DSH plugin / OpenClaw plugin / 设备端）

> **项目负责人亲手执行，或授权 AI 代执行。npm 发布流水线（本阶段前置）见 [10-publish.md](./10-publish.md) 步骤一~八。**

---

## 步骤一：Skill 分发

```bash
# 发布前确认 slug（SSOT）
head -3 SKILL/SKILL.md   # 期望 slug: sofagent

# ── ClawHub 分发 ──
# 发布前先查现有版本（同版本号不可覆盖，冲突则递增版本号）
clawhub skill verify sofagent 2>&1 | grep version
# 清理 .DS_Store（macOS 残留会触发 security 扫描 not_clean）
find ./SKILL -name '.DS_Store' -delete
# 发布（必须带 --changelog，否则 ClawHub 默认 1.0.0 自增，不走 SKILL.md version）
# 🔴 必须带 --name（2026-08-21 教训：缺 --name 时 ClawHub 显示名回退为 "SKILL"，
#   不读 SKILL.md frontmatter 的 displayName——重发修复见 v1.3.9 发布记录）
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

## 步骤二：DSH plugin 分发（v1.4.0 起 · 每版必做）

> **背景（2026-08-21 拍板）**：SkillHub 现已支持 DeepSeek Harness plugin 分发。v1.4.0 起 sofagent 的 DSH plugin 家族（`cordis-plugin-sofagent-*`，**9 个**（v1.4.0 修正：原评估 10 个，实际交付 9 个——audit/rollback/inject/evolve/ontology/commons/gate/daemon/fde），见 v1.4.0 开发日志「DSH 插件家族」）**每版都要在 SkillHub 发布**——与 SKILL 分发并列，是 DSH 生态的发现层补充（npm 发布仍走主线，两者并行不互替）。

```bash
# 发布前确认 plugin 家族清单（SSOT = v1.4.0 开发日志 plugin 家族表）
# 🔴 实际目录是 engine/dsh-plugins/cordis-plugin-sofagent-*（v1.4.0 品牌化改名后，前缀 cordis-plugin-sofagent-）
PLUGIN_DIRS=$(ls -d engine/dsh-plugins/cordis-plugin-sofagent-* 2>/dev/null || echo "")

# 逐 plugin 发布（版本号与 sofagent 主线版本对齐，见 v1.4.0「版本同步机制」）
for pdir in $PLUGIN_DIRS; do
  name=$(basename "$pdir")
  # 清理 .DS_Store / .png（与 SkillHub SKILL 分发同规矩）
  find "$pdir" -name '.DS_Store' -delete && find "$pdir" -name '*.png' -delete
  # 先查现有版本，同版本号不可覆盖
  skillhub verify "$name" 2>&1 | grep version || true
  skillhub publish "$pdir" --version <版本号> --changelog "vX.Y.Z: $(head -1 "$pdir/README.md" 2>/dev/null || echo "$name")" \
    && echo "✅ $name 已发布到 SkillHub" || echo "❌ $name 发布失败"
done
```

> **DSH plugin 分发铁律**：
> - 发布源 = 各 cordis-plugin 包目录（`engine/dsh-plugins/cordis-plugin-sofagent-*`，不是 SKILL/，SKILL 是方法论分发，plugin 是引擎能力分发）
> - 版本号 = 与 sofagent 主线版本对齐（v1.4.0 → 各 plugin v0.1.0 起步；DSH Cordis 协议 breaking change 时 bump major）
> - 每版发版都要推，与 ClawHub/SkillHub SKILL 分发同等强制
> - SkillHub 与 npm 并行：npm 是安装通道（`dsh plugin add`），SkillHub 是发现层（DSH 生态检索），不互替

### 步骤二·a：OpenClaw plugin 分发（v1.4.0 起 · 每版必做）

> **背景（2026-08-21 拍板）**：v1.4.0 的 OpenClaw plugin 家族（约束层四能力在 OpenClaw 生态的插件形态，见 v1.4.0 开发日志「OpenClaw plugin 家族」）**每版都要在 ClawHub plugins 发布**——与 DSH plugin 家族（SkillHub）分属两个生态：**ClawHub = OpenClaw 运行时 / SkillHub = DSH 运行时，各发各的**。clawhub CLI 已支持 `package publish`（code-plugin / bundle-plugin）。

> **前置（v1.4.0 实测补充，缺一不可）**：
> - 登录态：先 `clawhub whoami` 确认已登录（发布走 ClawHub 账号）
> - **源码已 push**：ClawHub 发布是 **source-linked 机制**——发布时从 `github:KongFangXun/sofagent@main:<plugin目录>` 拉源码，**必须先 push 到 GitHub 再发布**（dry-run 可验证映射，真实发布依赖远端文件存在）
> - **`openclaw.build.openclawVersion` 必填**：package.json 的 `openclaw.build.openclawVersion`（= 当前 OpenClaw 版本，`npm view openclaw version` 查）——缺失时 dry-run 报「required for external code plugins」
> - 先 `--dry-run` 验证格式与 source 映射，再真实发布

```bash
# 发布前确认 plugin 清单（SSOT = v1.4.0 开发日志 OpenClaw plugin 家族表）
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
> - **必须先 push 再发布**（source-linked 从 GitHub 拉源码；未 push 时真实发布失败，dry-run 只能验证格式）
> - 版本号 = 与 sofagent 主线版本对齐（同 DSH 家族机制）
> - 每版发版都要推，与 SKILL / DSH plugin 分发同等强制

---

## 步骤三：设备端安装

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
bash tools/check/check-version.sh   # 全绿
```

---
