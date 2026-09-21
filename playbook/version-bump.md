# 版本号 bump 操作手册

> 发版时全项目版本号升级的操作手册。releasing.md 阶段八引用本文件。

### 全项目版本号扫描（用脚本，禁止手动 grep）

#### Step 1: 一键升级

```bash
# 先 dry-run 看会影响哪些文件
./tools/release/bump-version.sh <旧版本> <新版本> --dry-run

# 确认后实际替换
./tools/release/bump-version.sh <旧版本> <新版本>
```

#### 🔴 bump 的两条前置动作（漏做必红）

```bash
# ① 先看影响面（dry-run），确认历史档案未被纳入
./tools/release/bump-version.sh <旧版本> <新版本> --dry-run   # 历史面应为空：脚本按设计排除 docs/changelog/
# ② bump 后必跑生成式产物重生成——唯一生产方不是 bump 脚本，不跑=check-template-drift 断言五/六 报漂移
node tools/gen/gen-plugin-manifests.mjs
```

> 🔴 **前缀替换陷阱（脚本级实测）**：bump 对「`v<major>.<minor>`」形态的位置做**前缀**替换——
> 文件里若是 `vX.Y.Z`（三段）而脚本按 `vX.Y` 匹配，替换后会得到 `vX.(Y+1).Z` 这类**畸形版本号**
> （例：`vX.Y.Z` → `vX.(Y+1).Z`，而正确结果应是 `vX.(Y+1).0`）。hook 头注释是该陷阱的高发点。
> **防御**：bump 后必跑 `grep -rn "v[0-9]\+\.[0-9]\+\.[0-9]\+" $(git diff --name-only)` 逐条核对，
> 或直接跑 `bash tools/check/check-template-drift.sh`（断言一/三 覆盖 hook 头版本自报）。

**脚本覆盖范围**（全自动扫描，新增 .ts/.sh/.ps1 文件自动发现；🔴 类数与位置清单 SSOT = `tools/release/bump-version.sh` 头部「替换范围」注释，随脚本演进——本手册不复述逐项清单，防双源漂移。已知覆盖面含：各层 package.json（SSOT/workspace 子包/openclaw 双 manifest）/ const VERSION / .ts 头注释 / index.ts / .sh / .ps1 / MD 头尾 / README badge / SKILL.md / SECURITY.md / hook 头 / dashboard.html）：
1. 版本号替换位置以脚本头部注释为准（`head -30 tools/release/bump-version.sh`），此处不维护第二份清单
2. **bump 后必跑门禁**：`bash tools/check/check-version.sh`——bump 能改的 check 必须能查，两脚本覆盖范围一致性是阶段二开发纪律既有项

**不碰**：正文中的历史引用（如 "v1.0 新增"）。这是正确设计。

#### Step 2: 一致性校验

```bash
./tools/check/check-version.sh
```

从 `package.json` 读 SSOT 版本号，逐项比对全项目版本位置（范围同 bump-version.sh 头部「替换范围」）。任何不一致 → 红字报错 + exit 1。

#### 同步 package-lock.json（🔴 教训）

bump-version.sh 改了 `package.json` 但不会自动同步 `package-lock.json`。必须手动执行：

```bash
npm install --package-lock-only
# 验证（engine/audit 是 SSOT）
grep -A3 '"engine/audit":' package-lock.json | grep '"version"'
# 应该是新版本号
```

**🔴 铁律**：**禁止用 `sed` 直接改 `package-lock.json`**——全局替换 `1.1.0→1.1.3` 会把外部包（如 `reusify@1.1.0`）也污染为不存在的版本（`reusify@1.1.3`），导致 CI 全平台 `npm ci` 崩溃。只能用 `npm install --package-lock-only` 重新生成锁文件。

#### 🔴 npm 发布铁律：版本号永久锁死（详见 releasing.md 索引段）

> 🔴 教训：npm 版本号 publish 后永久封存，unpublish 无法复写。发之前确认一切就绪 → 一次性批量发布。

```bash
# ❌ 永远不要：publish→unpublish→re-publish（报 400 Cannot publish over）
# ✅ 正确：确认就绪 → 一次性批量发布 → 发完即锁定
```

#### 手动排查（脚本未覆盖的边缘情况）

```bash
# 全项目搜旧版本号（排除 changelog 历史 + node_modules）
grep -rn "vX\.Y\.旧" --include="*.md" --include="*.ts" --include="*.sh" . \
 | grep -v "docs/changelog/" | grep -v "node_modules"
```

> 手动 grep 的结果会包含大量"合理的历史引用"（如 "v1.0 新增"）。这些**不改**——它们是变更溯源标记（bump 语境 = 不改已有的；新写规则正文时不引入溯源标记，见 releasing.md 禁考古条）。

#### 脚本不覆盖（必须手动）

| 文件 | 为什么脚本不碰 | 什么时候改 |
|------|------|------|
| `CHANGELOG.md` 条目 | 内容性更新，不是纯版本号替换 | 每次发版手动写摘要 + 版本说明 |
| `ROADMAP.md` 五步更新 | 结构性改动（删节/迁移），不是纯替换 | 每次发版手动做五步（详见 releasing.md 阶段八） |
| `ARCHITECTURE.md` 正文"当前 vX.Y" | 正文引用，不是版本头格式 | bump 后 grep `当前 v` 检查并手动更新 |
| `package-lock.json` | bump-version.sh 不覆盖 | 「同步 package-lock.json」小节用 `npm install --package-lock-only` 同步 |
| 正文中的历史引用 | "v1.0 新增"是溯源标记，不改 | 永远不改（bump 语境） |
| `engine/**` 常量 `= 'vX.Y.Z'` | bump 只认部分常量形态，漏改 = check-version 版本漂移断言红 | bump 后必跑 `bash tools/check/check-version.sh`，按报错逐条补 |
| `action.yml` 的 npx pin（`@sofagent/<pkg>@X.Y.Z`） | GitHub Action 用户拉到旧版引擎 | 同上，check-version 有专用断言 |
| 文档版本头「版本：vX.Y.Z」形态 | bump 不认该形态（非 `> vX.Y · DATE` 模板） | 同上；新增文档头请沿用模板形态 |
| 散文声称「当前 vX.Y.Z」/ 状态表当前+上一版两行 | bump 不管散文 | 同上；状态表「下一版」行须同步指向**真正未发布的下一版**（否则与当前版同号自相矛盾） |
| 根 `package.json` 内部依赖（`@sofagent/<pkg>`） | 只改了子包版号，根依赖未跟 | bump 后补，再 `npm install --package-lock-only` 重生成 lock |
| 文档头冗余父栏「（vX.Y.Z 更新 DATE）」 | 与行首日期重复且 bump 不覆盖 → 每版必漂 | **该形态已整体消除**；新增文档头不要再引入同类重复日期栏 |

#### 🔴 版本重编号全局 grep（教训）

版本重编号时（如 v1.0.x 系列内部跳号），只改规划版本表是不够的——ROADMAP 的详情表、HANDBOOK、DEVELOPMENT、THANKS 中的版本引用也要跟着改。必须全局 grep 所有 `vX.Y.x` 引用，区分"历史引用"（不改）和"未来规划引用"（必须改）。

```bash
# 搜所有含版本号的引用
grep -rn "v1\.0\.[0-9]" --include="*.md" . | grep -v "docs/changelog/" | grep -v "node_modules"
# 逐一判断哪些是"未来规划引用"（要改），哪些是"历史引用"（不改）
```

#### 新增 SKILL.md 覆盖检查（🔴 教训）

新增 SKILL.md 文件时，确认 check-version.sh 能检测到它。check-version.sh 用 `find -name 'SKILL.md'` 动态扫描，理论上自动覆盖——但 SKILL.md 的 version 字段必须用 3 段格式（如 `1.0.3`），否则 2 段比对会漏检 patch 差异。

```bash
# 验证所有 SKILL.md 被 check-version 覆盖
bash tools/check/check-version.sh 2>&1 | grep 'SKILL.md'
# 期望：所有 SKILL.md 文件都出现在列表中
```

## 🔴 bump 后 diff 历史语义审查（必做）

bump 脚本的文档/注释替换无法区分「当前版本声明」与「历史版本引用」——**每次 bump 后必须全量审查 diff**，把历史语义误伤改回：

1. 扫描：`git diff` 中所有含旧版本号的 `-` 行，逐行判定语义——「当前态」（文档头/版本字段/徽章/SSOT 引用）保留新版本号；「历史引用」（能力自 vX.Y 起 / vX.Y 修复 / vX.Y 改为 / vX.Y+ / vX.Y 补口 / 历史沿革）**恢复旧版本号**
2. 高发区：源码注释（`// vX.Y 修：` / `// vX.Y 起`）、SOP/手册标题后缀（`（进场时 · vX.Y 起）`）、安全披露（` vX.Y 补口`）、Mermaid 节点标注（` vX.Y+`）
3. 联动检查：标题后缀改回旧版本号后，引用该标题的锚点 slug（其他文档的 `#…-vXY-Y-起` 链接）须同步回滚
4. 门禁兜底：check-docs 的锚点校验会抓标题漂移，check-version 抓版本声明漂移——但**历史语义只有人工审查能兜**（工具无法区分「当前版本声明」与「历史版本交付的事实」）
