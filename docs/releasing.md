# sofagent Release Process

> v0.99.6 · 2026-07-04。推前预检 → 跑命令 → 对清单 → 打 tag。
>
> 完整流程见 `~/Workbuddy/SOFAGENT_VERSION_SOP.md`，本文件是快速核对清单。

---

## 怎么做

```
0. 推前预检   → ./tools/pre-push-check.sh（全绿才推——shellcheck + version + docs + build + test + audit 全跑）
1. 构建自测   → npm test && tsc --noEmit (audit + mcp 双包) && shellcheck sofagent/scripts/*.sh tools/*.sh FDE/fde-install.sh && bash tools/check-docs.sh
2. 审核       → 独立审查逐项核对 changelog，FAIL 项修完二次复核
3. 版本号升级 → ./tools/bump-version.sh <旧> <新>（13 类位置全自动覆盖；手动改 index/index.html hero badge）
4. 版本号校验 → ./tools/check-version.sh（必须 30/30 全绿）
5. 索引文档   → CHANGELOG 新增条目 + 链接到 changelog；ROADMAP 三步更新（文件头 / 现在在哪 / 未来去哪删已完成版本）
6. npm 打包   → audit + mcp 双包 npm pack --dry-run，确认 .js.map=0
7. 内容新鲜度 → 核对 7 项（效果证据 / 局限标注 / FDE 完成度 / 依赖表 / 英文同步 / COMMUNITY / evidence 零依赖表述）
8. 确认关口   → git diff --stat 展示全部改动，作者确认后开发日志打 [x]
9. 安装副本   → cp -r skill/ ~/.workbuddy/skills/sofagent/ && cp -r skill/ ~/.openclaw/skills/sofagent/
10. 发布      → git tag → gh release（自动触发 OIDC npm 双包发布）→ clawhub → skillhub
11. npm 验证  → npm view @sofagent/audit version && npm view @sofagent/mcp version（必须都是新版本号——不信任自动化，亲自确认）
```

---

## 版本号工具（🔴 v0.95 起，禁止手动改版本号）

> **每次发版必须用这两个脚本，不要手动 sed/grep 改版本号。**

### bump-version.sh — 一键升级

```bash
# 先 dry-run 看会影响哪些文件
./tools/bump-version.sh 0.99.5 0.99.6 --dry-run

# 确认后实际替换
./tools/bump-version.sh 0.99.5 0.99.6
```

**覆盖 13 类位置**（全自动，新增 .ts/.sh/.ps1 文件自动扫描）：
1. `sofagent/audit/package.json` version（SSOT）
2. `sofagent/mcp/package.json` version
3. `const VERSION = 'x.y'`（动态扫描 audit/src/ + mcp/src/ 全目录）
4. .ts 文件头注释中的 `— vX.Y.Z` 格式
5. index.ts 版本引用
6. `VERSION="x.y"`（扫描 scripts/*.sh）
7. `$VERSION = "x.y"`（扫描 scripts/windows/*.ps1）
8. MD 文件头 `> vX.Y ·`（排除 docs/changelog/）
9. ROADMAP「现在在哪」节标题
10. README badge `version-vX.Y`
11. SKILL.md frontmatter `version: x.y`（含 skill/ 和 FDE/ 两个）
12. MD tail signature `> *vX.Y*`
13. SECURITY.md 状态标注 `**当前状态（vX.Y）**`

**不碰**：正文中的历史引用（如 "v0.94 新增"、changelog 历史）。正确设计。

**手动补充**：`index/index.html` hero badge 不在自动覆盖范围，需手动改版本号。

### check-version.sh — 一致性校验

```bash
./tools/check-version.sh
```

从 package.json 读 SSOT 版本号，逐项比对 13 类位置。任何不一致 → 红字报错 + exit 1。应为 30/30 全绿。

---

## 打勾清单

### 构建

- [ ] `./tools/pre-push-check.sh` → 全绿（推前必跑——本地 CI 等价检查）
- [ ] `npm test` → 全部通过
- [ ] `npx tsc --noEmit` → audit 通过
- [ ] `cd sofagent/mcp && npx tsc --noEmit` → mcp 通过

### 版本号（🔴 用脚本，不用手动 grep）

- [ ] `./tools/bump-version.sh <旧> <新> --dry-run` → 确认 13 步全有效
- [ ] `./tools/bump-version.sh <旧> <新>` → 实际替换
- [ ] `index/index.html` hero badge → 手动更新版本号
- [ ] `./tools/check-version.sh` → 30/30 全绿

### npm 打包洁净度（🔴 v0.99.5 教训）

- [ ] `cd sofagent/audit && npm pack --dry-run` → 0 个 .js.map
- [ ] `cd sofagent/mcp && npm pack --dry-run` → 0 个 .js.map
- [ ] audit package.json files 字段含 `"!dist/**/*.js.map"` 和 `"!dist/**/*.d.ts.map"`（双重保险）
- [ ] mcp package.json files 字段含相同排除模式（对齐 audit）
- [ ] `sofagent/mcp/README.md` 存在且有内容

### 内容新鲜度

- [ ] 效果证据表——数据是否包含最新版本？
- [ ] 局限标注——修了的有没有更新？
- [ ] 事实断言——"尚无第三方数据"是否仍然成立？
- [ ] FDE 完成度——与交付层数是否匹配？
- [ ] 前置依赖表——新增工具是否需要新依赖？
- [ ] 英文版——README.en / EVIDENCE.en 是否同步？
- [ ] COMMUNITY.md——实验状态是否更新？
- [ ] evidence 中"零运行时依赖"是否全部改为"最小运行时依赖（仅 js-yaml）"

### ROADMAP / CHANGELOG（🔴 v0.99.5 教训：两文档分工明确）

- [ ] `ROADMAP.md`：三步更新（文件头 / 现在在哪 / 未来去哪——**删掉已完成的版本**）
  - ROADMAP 只管方向 + v1.0 准入 + 迭代历程表，不在「现在在哪」堆版本细节
- [ ] `CHANGELOG.md`：新版本摘要（2-3 句话）+ 链接到 `docs/changelog/vX.Y.md`
  - CHANGELOG 是版本历史的唯一权威入口——ROADMAP 不再重复
- [ ] `docs/changelog/vX.Y.md`：完整开发日志（问题背景 + 逐项修复 + 质量验证 + 发布检查清单）

### 确认关口

- [ ] `git diff --stat` → 展示全部改动，作者确认
- [ ] 开发日志发布检查清单全部 [x]

### 发布

> ClawHub 和 SkillHub 共享命名空间，推 ClawHub 即可覆盖两边。
> 🔴 **npm 发布走 OIDC Trusted Publishing**（release.yml `id-token: write`），gh release create 后自动触发。不要信任自动化——发布后必须亲自验证（见下方步骤 f）。

- [ ] `git tag vX.YY && git push origin vX.YY`
- [ ] 🔴 **gh release create vX.YY**（自动触发 OIDC npm 双包发布）
  - 📝 **Release body 必须包含**：`📖 [详细开发日志](./docs/changelog/vX.YY.md)` 链接（GitHub 自动生成的 "Full Changelog" 只到 diff 页，不会到开发文档）
  - `gh release create vX.YY --notes "..."` 或用 `--notes-file` 从文件读
- [ ] `clawhub skill publish ./skill --slug sofagent --version X.YY.0`
- [ ] `clawhub skill publish ./FDE --slug sofagent-fde --version X.YY.0`
- [ ] cp -r skill/ → `~/.workbuddy/skills/sofagent/`
- [ ] cp -r skill/ → `~/.openclaw/skills/sofagent/`
- [ ] cp -r FDE/ → `~/.workbuddy/skills/sofagent-fde/`
- [ ] 🔴 **npm 双包验证**（等待 1-2 分钟后跑）：
  ```bash
  npm view @sofagent/audit version    # 必须是最新版本号
  npm view @sofagent/mcp version      # 必须是最新版本号（不能落后！）
  npm view @sofagent/mcp readme       # 必须有内容
  ```
- [ ] 全量验证：`check-version.sh` + `check-docs.sh` + `verify.sh --quiet`

---

## 常见故障

| 故障 | 现象 | 解决 |
|------|------|------|
| mcp 版本落后 | `npm view @sofagent/mcp version` 显示旧版本 | mcp job 依赖 audit job（`needs: publish-audit`），audit 失败则 mcp 不触发。手动 `gh workflow run release.yml` 或本地 `cd sofagent/mcp && npm publish` |
| .js.map 泄露 | `npm pack --dry-run` 显示 .js.map | 检查 package.json `files` 字段是否包含排除模式。**不要只依赖 prepublishOnly**——`files` 字段排除更可靠 |
| README 空白 | npm 页面无 README | 检查 package.json `files` 是否引用了不存在的 README.md；确认 README.md 在包目录内 |
| OIDC 认证失败 | `npm publish` 403 | 检查 npm 包设置中 Trusted Publishing 是否指向正确的 GitHub repo + workflow |
| bump-version [10/13] 无匹配 | index.html hero badge 不在覆盖范围 | 手动改 `index/index.html` 中的版本号 |
