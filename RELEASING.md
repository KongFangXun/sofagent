# sofagent Release Process

> v0.96 · 2026-06-28。跑命令 → 对清单 → 打 tag。

---

## 怎么做

```
1. 构建自测   → rm -rf dist/ && npm run build && npm test（必须全绿）
2. 审核       → 独立审查逐项核对 changelog，FAIL 项修完二次复核
3. 版本号升级 → ./scripts/bump-version.sh <旧版本> <新版本>（一键替换，见下方）
4. 版本号校验 → ./scripts/check-version.sh（必须全绿）
5. 索引文档   → CHANGELOG 新增条目 + 版本说明；ROADMAP 三步更新
6. 内容新鲜度 → 核对 7 项（效果证据 / 局限标注 / FDE 完成度 / 依赖表 / 英文同步 / COMMUNITY）
7. 确认关口   → git diff --stat 展示全部改动，确认后开发日志打 [x]
8. 安装副本   → cp SKILL.md 到 ~/.workbuddy/skills/ 和 ~/.openclaw/skills/
9. 发布       → git tag → gh release → clawhub → skillhub → 验证
```

## 版本号工具（🔴 v0.95 起，禁止手动改版本号）

> **每次发版必须用这两个脚本，不要手动 sed/grep 改版本号。**

### bump-version.sh — 一键升级

```bash
# 先 dry-run 看会影响哪些文件
./scripts/bump-version.sh 0.94 0.95 --dry-run

# 确认后实际替换
./scripts/bump-version.sh 0.94 0.95
```

**覆盖 8 类位置**（全自动，新增 .ts 文件自动扫描）：
1. package.json version（SSOT）
2. `const VERSION = 'x.y'`（动态扫描 audit/src/ 全目录）
3. index.ts 版本引用
4. `VERSION="x.y"`（扫描 scripts/*.sh）
5. `$VERSION = "x.y"`（扫描 scripts/windows/*.ps1）
6. MD 文件头 `> vX.Y ·`（排除 docs/changelog/）
7. README badge `version-vX.Y`
8. SKILL.md frontmatter `version: x.y`

**不碰**：正文中的历史引用（如 "v0.94 新增"、changelog 历史）。这是正确设计。

### check-version.sh — 一致性校验

```bash
./scripts/check-version.sh
```

从 package.json 读 SSOT 版本号，逐项比对全项目 8 类位置。任何不一致 → 红字报错 + exit 1。

---

## 打勾清单

### 构建

- [ ] `rm -rf dist/ && npm run build` exit 0
- [ ] `npm test` 全部通过

### 版本号（🔴 用脚本，不用手动 grep）

- [ ] `./scripts/bump-version.sh <旧> <新> --dry-run` → 确认影响文件列表
- [ ] `./scripts/bump-version.sh <旧> <新>` → 实际替换
- [ ] `./scripts/check-version.sh` → 全绿（38+ 项）

### 内容新鲜度

- [ ] 效果证据表——数据是否包含最新版本？
- [ ] 局限标注——修了的有没有更新？
- [ ] 事实断言——"尚无第三方数据"是否仍然成立？
- [ ] FDE 完成度——与交付层数是否匹配？
- [ ] 前置依赖表——新增工具是否需要新依赖？
- [ ] 英文版——README.en / EVIDENCE.en 是否同步？
- [ ] COMMUNITY.md——实验状态是否更新？

### 索引文档

- [ ] `CHANGELOG.md`：新版本条目 + 顶部版本说明
- [ ] `ROADMAP.md`：三步更新（文件头 / 现在在哪 / 未来去哪）
- [ ] `docs/changelog/vX.Y.md`：发布检查清单全部 [x]

### 确认关口

- [ ] `git diff --stat` → 展示全部改动，作者确认
- [ ] 开发日志发布检查清单全部 [x]

### 发布（七步）

- [ ] `git tag vX.YY && git push origin vX.YY`
- [ ] `gh release create vX.YY`
- [ ] `clawhub skill publish ./sofagent --slug sofagent --version X.YY.0`
- [ ] `skillhub publish <temp-dir> --version X.YY.0`（排除 images/）
- [ ] cp 3 个 SKILL.md → `~/.workbuddy/skills/`（sofagent / lite / fde）
- [ ] cp 3 个 SKILL.md → `~/.openclaw/skills/`
- [ ] 验证：`git tag -l vX.YY` / `gh release view vX.YY` / `check-version.sh` / 6 diff 零差异
