# sofagent 版本开发 SOP

> v0.95 实践沉淀。十阶段：审查→开发→自测→代码审核→**回归检查**→审查体系维护→文档收尾→确认关口→发布→发布后。
> 🔴 v0.95 起，版本号操作用 `bump-version.sh` + `check-version.sh`，禁止手动 grep/sed。
> 🔴 v1.0.3 起，文档预算分层检查（A 用户文档 / B 开发者参考 / C 审查体系 / D 设计 / E 指南），见 `check-docs.sh`。
> 🔴 v1.0.6 起，回归检查升格为**独立阶段**（阶段五）——需要全新 session，不再作为"审核"的子步骤。

---

## 阶段一：审查 → 开发日志

上一版本发布后，由陌生视角审查（fresh-eyes-review.md）驱动新版本的开发方向。

| # | 步骤 | 谁做 | 产物 |
|:--:|------|:--:|------|
| 1 | 上一版本接受独立审查（GLM + DeepSeek），产出 P0/P1/P2 清单 | 作者 | 审查报告 |
| 2 | 写 `docs/changelog/vX.Y.md`，含：问题描述 → 修复方案 → 验证方式 → 发布检查清单 | 作者 | 开发日志 |

---

## 阶段二：开发

按优先级分三批，每批独立派发/回报/核实，禁止合并批次。

| # | 优先级 | 谁做 | 说明 |
|:--:|:--:|:--:|------|
| 3 | P0 安全硬伤 | 工程师 | 必须修，阻塞发布。**每修完一个 P0/P1，顺手在回归清单追加检查项——趁记忆新鲜，不要等到发版前才回忆。** |
| 4 | P1 工程欠债 | 工程师 | 应该修 |
| 5 | P2 改进 | 工程师 | 不阻塞发布 |
| 5.5 | 审查体系更新 | 工程师 | 随修复同步更新：① 回归清单追加检查项（编号递增）② 陌生视角 prompt 补充新盲区视角/任务。**不要等到阶段六才做——开发时记忆最新，随修随记** |

**🔴 开发铁律（v1.0.3 教训）**：
- **开发完后再 bump 版本号**——不要在开发过程中提前 bump。工程师可能写了目标版本号而非当前 SSOT
- 对 optional dependency（如 deepagents）的类型断言统一用 `as unknown as` 双重转换——本地编译通过不代表 CI 通过

---

## 阶段三：自测

开发完成后、交审核之前，工程师先自己跑一轮：

| # | 步骤 | 验证方式 |
|:--:|------|------|
| 6 | `npm run build` | exit 0 |
| 7 | `npm test` | 全部通过 |
| 8 | `shellcheck sofagent/scripts/*.sh tools/*.sh FDE/fde-install.sh` | 零 error |
| 8.5 | 改动清单核对 | diff 确认只改了 changelog 规定的文件 |
| 8.6 | dist 与 src 同步验证（v1.0.4 教训）<br>`diff <(grep "关键命令" src/index.ts) <(grep "关键命令" dist/index.js)` | 无实质差异（排除编译格式化） |
| 8.7 | `bash tools/acceptance-test.sh` — 28 个端到端场景：Fresh install → --init → --doctor → 正常 commit → 违规拦截 → --json → --ci → 首次提交 → hook 破坏 → --no-verify 检测 → config rules 过滤 → A2/A3/A4/A5/A6/A9/A10/A11 → E1-E4 扩展规则 → --strict exit code=2 → hook 迁移 → post-commit → hashVersion 混合格式 → history.jsonl 写入 → --json 违规输出 → post-commit 安装+丢失检测 | 全部 PASS |
| 8.8 | **OpenClaw 综合验证**（v1.0.6 起）：在全新 session 中执行 `docs/verification/openclaw-acceptance-test.md`（28 场景：审计管道全规则 + hook 机制 + hashVersion 混合格式 + SkillOpt 自净化 + DeepAgents Sub Agent + optional 依赖降级 + config rules 过滤） | 全部通过 |

---

## 阶段四：代码审核

由独立审核者逐项核对 changelog 中的每一项改动。审核者可以是外部审查员，也可以是作者用另一个模型跑。

| # | 步骤 | 谁做 | 验证方式 |
|:--:|------|:--:|------|
| 9 | 独立审核者逐项核对 changelog 每一项 | 审核者 | 逐文件读源码，逐项确认改动存在且正确 |
| 9.5 | FAIL 项修复 | 工程师 | build + test 全绿 |
| 10 | 二次复核确认全部到位 | 审核者 | changelog 所有项 PASS |

---

## 🔴 阶段五：回归检查（独立阶段，必须全新 session）

> ⚠️ **v1.0.6 起升格为独立阶段**——之前是"审核"的子步骤 10.5，容易被跳过。回归检查的"全新 session"要求与开发 session 天然矛盾，不应放在同一个阶段里。

**为什么必须独立**：
- 回归检查用 `docs/verification/regression-checklist.md`（当前维度数见文件头）
- 🔴 **必须开全新 session**——老 session 有上下文记忆，审查者知道"这东西是我修的"，会跳过怀疑。全新 session = 空白认知
- 和阶段一（陌生视角审查）不同：回归检查是"确认已知修复没回退"，不是"发现新问题"

| # | 步骤 | 谁做 | 验证方式 |
|:--:|------|:--:|------|
| 10.5a | **回归清单**：在**全新 session** 中用 `docs/verification/regression-checklist.md` 逐项核对 | 审核者（不能是开发者本人） | 全 PASS |
| 10.5b | **OpenClaw 验收**：在同一个全新 session 中用 `docs/verification/openclaw-acceptance-test.md` 跑全场景验证 | 审核者 | 所有场景 PASS |

> 🔴 两项**都必须**通过才能进阶段六。任何一项 FAIL → 回开发 session 修复 → 重跑阶段三自测 → 再开新 session 重跑阶段五。

**操作方式**：

1. 开一个全新的 WorkBuddy/CodeBuddy session（不要从开发 session 继续）
2. **先跑回归清单**：
   ```
   请读取 docs/verification/regression-checklist.md，
   按照里面的审查约束和逐项检查清单，
   对当前 workspace 的 sofagent 项目执行回归检查。
   输出每项的 PASS/FAIL 结果。
   ```
3. **再跑 OpenClaw 验收**：
   ```
   请读取 docs/verification/openclaw-acceptance-test.md，
   按照里面的场景逐一执行验证。
   输出每个场景的 PASS/FAIL 结果。
   ```
4. 如果有 FAIL：回到开发 session 修复 → 重新跑阶段三自测 → 再开新 session 重跑阶段五（两项都要重跑）

**时序注意**：
- 回归清单中标注「发布后验证」的检查项（如 npm latest 版本号），在回归检查阶段必然不满足——这是正常的，不要标 FAIL
- OpenClaw 验收需要 OpenClaw 环境——如果当前 session 不在 OpenClaw 中，部分场景可跳过（prompt 中有降级说明）

---

## 阶段六：审查体系维护

> 本阶段在**开发 session** 中执行——这是在更新文档，不是在审查，不需要新 session。

基于本版本整个迭代的开发经验，更新两套审查体系：

| # | 步骤 | 验证方式 |
|:--:|------|------|
| 10.6a | **回归清单**：开发过程中已随修随记（步骤 5.5），本步骤做最后核对——有没有遗漏的 P0/P1 修复没抽象为检查项？ | 回归清单检查项数 ≥ 上一版 |
| 10.6b | **陌生视角 prompt**（`docs/verification/fresh-eyes-review.md`）：本版本暴露了哪些新盲区？把新视角/任务/攻击面补进 prompt。更新后的 prompt 下版本发布后用于阶段一的独立审查 | 陌生视角 prompt 新增任务/视角见于文件 diff |

**审查体系闭环**（v1.0.4 教训）：审查文档自身也会过时——每次发版后审视审查 prompt 的数字、路径、视角是否还有效。

---

## 阶段七：文档收尾（🔴 v0.92 踩坑最密集）

### 7.1 开发日志自更新

- 补上本轮 `npm test` / `acceptance-test` / `shellcheck` / `check-version` 的实际结果（不要留占位符）
- 开发日志是活文档，代码改完立刻回写，不要等
- 发布检查清单全部打 `[x]`（在阶段八确认关口之后）

### 7.1.1 测试数字一致性（v1.0.4 教训）

CHANGELOG/ROADMAP 中声称的测试数必须与实际 `npm test` 输出一致。v1.0.4 曾写 455 但实际 465。

```bash
# 获取实际测试数
actual=$(cd sofagent/audit && npm test 2>&1 | grep 'Tests' | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+')
echo "实际测试数: $actual"

# 检查 CHANGELOG/ROADMAP 中写的数字
grep "$actual" CHANGELOG.md
grep "$actual" ROADMAP.md
# 如果 grep 不到 = 文档写错了
```

### 7.2 全项目版本号扫描（🔴 v0.95 起用脚本，禁止手动 grep）

#### Step 1: 一键升级

```bash
# 先 dry-run 看会影响哪些文件
./tools/bump-version.sh <旧版本> <新版本> --dry-run

# 确认后实际替换
./tools/bump-version.sh <旧版本> <新版本>
```

**脚本覆盖 13 类位置**（全自动扫描，新增 .ts/.sh/.ps1 文件自动发现）：
1. `sofagent/audit/package.json` version（SSOT）
2. `sofagent/mcp/package.json` version
3. `const VERSION = 'x.y'`（动态扫描 `audit/src/` + `mcp/src/` 全目录）
4. .ts 文件头注释中的 `— vX.Y.Z` 格式
5. `index.ts` 版本引用
6. `VERSION="x.y"`（扫描 `scripts/*.sh`）+ .sh 文件头注释中的 `（vX.Y.Z）` 格式
7. `$VERSION = "x.y"`（扫描 `scripts/windows/*.ps1`）
8. MD 文件头 `> vX.Y ·`（排除 `docs/changelog/`）+ ROADMAP「现在在哪」节标题
9. README badge `version-vX.Y`（大小写不敏感）
10. SKILL.md frontmatter `version: x.y`（含 `skill/` 和 `FDE/` 两个 SKILL.md）
11. MD tail signature `> *vX.Y*`
12. SECURITY.md 状态标注 `**当前状态（vX.Y）**`
13. FDE/package.json + LOOP/package.json（v1.0.3 起）

**不碰**：正文中的历史引用（如 "v0.94 新增"）。这是正确设计。

#### Step 2: 一致性校验

```bash
./tools/check-version.sh
```

从 `package.json` 读 SSOT 版本号，逐项比对全项目 13 类位置。任何不一致 → 红字报错 + exit 1。

#### Step 2.5: 同步 package-lock.json（🔴 v1.0.3 教训）

bump-version.sh 改了 `package.json` 但不会自动同步 `package-lock.json`。必须手动执行：

```bash
npm install --package-lock-only
# 验证
grep -A3 '"sofagent/audit":' package-lock.json | grep '"version"'
grep -A3 '"sofagent/mcp":' package-lock.json | grep '"version"'
# 两个都应该是新版本号
```

#### Step 2.6: 手动排查（脚本未覆盖的边缘情况）

```bash
# 全项目搜旧版本号（排除 changelog 历史 + node_modules）
grep -rn "v0\.旧版本" --include="*.md" --include="*.ts" --include="*.sh" . \
  | grep -v "docs/changelog/" | grep -v "node_modules"
```

> 手动 grep 的结果会包含大量"合理的历史引用"（如 "v0.94 新增"）。这些**不改**——它们是变更溯源标记。

#### 脚本不覆盖（必须手动）

| 文件 | 为什么脚本不碰 | 什么时候改 |
|------|------|------|
| `CHANGELOG.md` 条目 | 内容性更新，不是纯版本号替换 | 每次发版手动写摘要 + 版本说明 |
| `ROADMAP.md` 三步更新 | 结构性改动（删节/迁移），不是纯替换 | 每次发版手动做三步 |
| `ARCHITECTURE.md` 正文"当前 vX.Y" | 正文引用，不是版本头格式 | bump 后 grep `当前 v` 检查并手动更新 |
| `package-lock.json` | bump-version.sh 不覆盖 | Step 2.5 用 `npm install --package-lock-only` 同步 |
| 正文中的历史引用 | "v0.94 新增"是溯源标记，不改 | 永远不改 |

#### 🔴 版本重编号全局 grep（v1.0.2 教训）

版本重编号时（如 v1.0.x 系列内部跳号），只改规划版本表是不够的——ROADMAP 的详情表、HANDBOOK、DEVELOPMENT、THANKS 中的版本引用也要跟着改。必须全局 grep 所有 `vX.Y.x` 引用，区分"历史引用"（不改）和"未来规划引用"（必须改）。

```bash
# 搜所有含版本号的引用
grep -rn "v1\.0\.[0-9]" --include="*.md" . | grep -v "docs/changelog/" | grep -v "node_modules"
# 逐一判断哪些是"未来规划引用"（要改），哪些是"历史引用"（不改）
```

#### Step 2.7: 新增 SKILL.md 覆盖检查（🔴 v1.0.3 教训）

新增 SKILL.md 文件（如 `LOOP/SKILL.md`）时，确认 check-version.sh 能检测到它。check-version.sh 用 `find -name 'SKILL.md'` 动态扫描，理论上自动覆盖——但 SKILL.md 的 version 字段必须用 3 段格式（如 `1.0.3`），否则 2 段比对会漏检 patch 差异。

```bash
# 验证所有 SKILL.md 被 check-version 覆盖
bash tools/check-version.sh 2>&1 | grep 'SKILL.md'
# 期望：所有 SKILL.md 文件都出现在列表中
```

#### 内容新鲜度检查

版本号更新不代表内容没变质。每次发布前逐项核对：

- [ ] 效果证据表——数据是否包含最新版本？
- [ ] 「vX.Y 不修 / 待修」的局限标注——是否已经修了但标注没动？
- [ ] 「尚无第三方实测数据」「尚无 ≥1 周样本」等事实断言——是否已经变了？
- [ ] README FDE 完成度——是否与交付层数匹配？
- [ ] 前置依赖表——新增工具是否需要新依赖？
- [ ] 英文版（README.en / EVIDENCE.en）内容是否与中文版同步？
- [ ] COMMUNITY.md 实验状态、contributor 数是否为当前实际状态？

#### 7.2.1 文档日期检查（🔴 v1.0.2 教训）

bump-version.sh 只改版本号**不改日期**。每次 bump 后必须手动检查：

```bash
# 检查所有 MD 文件头日期——把 DATE 替换为实际发版日期
DATE="$(date +%Y-%m-%d)"  # 或手动指定
grep -rn "$DATE" *.md docs/design/*.md | grep -v "docs/changelog/" | grep -v "docs/evidence/"
# 期望：主要文档都匹配到当天日期
# 排除 changelog 历史（里面记的是发版当天日期，不该改）和 evidence 案例日期
```

重点检查（bump-version.sh 不覆盖的）：
- `LIMITATIONS.md` 文件头日期
- `docs/design/audit-design.md` 文件头日期
- `docs/design/daemon-design.md` 文件头日期
- `HANDBOOK.md` 依赖表日期
- `DEVELOPMENT.md` 依赖表日期
- `THANKS.md` 致谢日期

#### 7.2.2 changelog 文件命名一致性（🔴 v1.0.3 教训）

changelog 文件命名统一为 `vX.Y.Z.md`（三段式）。曾经 `v1.0.md` 是两段式，其他版本都是三段式，导致引用混乱。

```bash
# 检查 docs/changelog/ 下所有文件名都是三段式 vX.Y.Z.md
ls docs/changelog/*.md | grep -v -E 'v[0-9]+\.[0-9]+\.[0-9]+\.md'
# 期望：无输出（所有文件都是三段式）
```

### 7.3 CHANGELOG 两步

- [ ] 新增版本条目（摘要一句话 + 链接到 `docs/changelog/vX.Y.Z.md`）
- [ ] 索引列表按时间倒序排列，版本号与日期正确
- [ ] 🔴 **只写产品变更**——不含审查元信息（维度编号、模型名、轮次、视角数等）。这些属于内部过程，外部用户不关心

### 7.4 ROADMAP 三步

- [ ] 文件头版本号更新（keep 当前已发布版本，不是目标版本）
- [ ] 「现在在哪」替换为当前版本简表，旧内容迁移到「迭代历程」
- [ ] 「未来去哪」删掉已完成版本，TOC 同步

### 7.5 按需文档

| 文档 | 什么时候更新 |
|------|------|
| `README.md` | FDE 完成度变化、效果证据更新、新功能入口 |
| `ARCHITECTURE.md` | 架构决策或设计思路有变更 |
| `DEVELOPMENT.md` | 开发流程有变更 |
| `LIMITATIONS.md` | 新发现的局限或旧局限被消除 |
| `HANDBOOK.md` | 用户使用习惯、FAQ 有变化 |
| `COMMUNITY.md` | contributor 数据、社区状态有变化 |
| `ROADMAP.md` | 三步更新。不要在「现在在哪」堆积历史版本详细表 |
| `CHANGELOG.md` | 新增版本索引条目。版本历史的**唯一权威入口** |
| `docs/changelog/vX.Y.md` | 完整开发日志：问题背景 + 逐项修复方案 + 质量验证数据 + 发布检查清单 |

---

## 阶段八：确认关口

文档全部收尾后，**必须**让作者过一遍改动，确认没问题再交接给项目负责人发版。v0.92 的教训：文档收尾完直接发布，没人确认，导致遗留问题。

| # | 步骤 | 验证方式 |
|:--:|------|------|
| 12 | 展示全部改动清单 | `git diff --stat` |
| 13 | 作者逐项确认 | 重点看版本号、ROADMAP、CHANGELOG |
| 14 | 确认通过后，开发日志「发布检查清单」打 `[x]` | 不在文档收尾前打勾 |
| 15 | **AI 生成发布 prompt，交接给项目负责人**——发版命令由 AI 准备但绝不执行 | AI 输出完整的发布 prompt（含 npm publish / git tag / gh release / Skill 分发 / 发布后验证），项目负责人亲手跑 |

---

## 阶段九：发布（🔴 项目负责人根据 AI 生成的发布 prompt 亲手执行）

> AI 在阶段八确认关口生成一份完整的发布 prompt（含所有命令），项目负责人（孔放勋）拿到后亲手逐条执行。npm publish、git tag、gh release create 涉及凭证和权限，AI 绝不代劳。

### 9.1 发布前检查（npm 包洁净度 + 推前预检）

```bash
# 🔴 v0.99.1 起铁律：推前预检必须全绿
bash tools/pre-push-check.sh            # 7/7 全绿（--quick 跳过 npm test/build，--audit-only 只跑审计）
bash tools/check-docs.sh                # 文档死链 + 预算 + Skill 行数

# audit 包检查
cd sofagent/audit && npm pack --dry-run 2>&1 | grep '\.js\.map' | wc -l    # 期望: 0
npm pack --dry-run 2>&1 | grep 'total files'

# mcp 包检查
cd ../mcp && npm pack --dry-run 2>&1 | grep '\.js\.map' | wc -l             # 期望: 0
npm pack --dry-run 2>&1 | grep 'total files'

# 类型检查（两个包）
cd ../audit && npx tsc --noEmit && echo "audit tsc: OK"
cd ../mcp && npx tsc --noEmit && echo "mcp tsc: OK"
```

### 9.2 执行发布

**npm 先行策略**（v0.99.7 起推荐）：先手动发布 npm 双包，再 git tag + push。即使 CI 失败，npm 包已就位。

```
── Step 1: 手动发布 npm 双包 ──
🔴 publish 前必须 build——npm publish 上传的是 dist/ 目录，如果不 build 直接 publish，npm 上是旧 dist

1. cd sofagent/audit && npm run build && npm publish --access public
2. cd ../mcp && npm publish --access public（mcp 依赖 audit，audit 已 publish 到 registry）
3. npm view @sofagent/audit version   # 验证：必须是新版本号
4. npm view @sofagent/mcp version     # 验证：必须是新版本号

── Step 2: git tag + push ──
5. git tag vX.Y.Z + git push origin vX.Y.Z
6. gh release create vX.Y.Z
   🔴 Release body **必须**包含开发日志链接：
   📖 [详细开发日志](./docs/changelog/vX.Y.Z.md)

   🔴 Release Notes 标准格式（v1.0.6 起规范化）：

   **Title**: `vX.Y.Z — {核心变更摘要}（≤60 字，逗号分隔 2-4 个要点）`

   **Body 结构**（分节制，每节用 `##` 标题）：

   ```markdown
   ## 核心变更

   ### {功能领域 1}（如"编排引擎"/"安全加固"/"审计规则"）
   - {一句话描述变更}（如"DeepAgents compose 迁移（ao 降为 fallback）"）

   ### {功能领域 2}
   - ...

   ## 质量验证

   | 检查项 | 结果 |
   |------|:--:|
   | npm test | {N} tests 全绿 |
   | acceptance-test | {N}/{N} 全绿 |
   | OpenClaw 验收 | {N}/{N} 全绿 |
   | shellcheck | 零 error |
   | pre-push-check | {N}/{N} 全绿 |
   | 回归检查 | {N}/{N} 全绿 |

   📖 [详细开发日志](./docs/changelog/vX.Y.Z.md)
   ```

   **规范细则**：
   - 功能领域按变更重要性降序排列，安全修复优先于文档修复
   - 每个变更点用 `-` 列表，一句话说清楚做了什么（不写"为什么"——那在开发日志里）
   - 质量验证表格**固定 6 项**：npm test / acceptance-test / OpenClaw 验收 / shellcheck / pre-push-check / 回归检查
   - 测试数字写**实际值**（从 `npm test 2>&1 | tail -5` 获取），不写约数
   - 末尾**必须有**开发日志链接
   - **不含**审查元信息（模型名、审查轮次、P0/P1 标签）——那是内部过程

── Step 3: Skill 分发 ──
7. clawhub skill publish ./sofagent/skill --slug sofagent --owner KongFangXun
8. clawhub skill publish ./FDE --owner KongFangXun
    # ClawHub 和 SkillHub 共享命名空间，推 ClawHub 即可，不需要额外推 SkillHub
9. 本地安装：
    cp -r sofagent/skill/* ~/.workbuddy/skills/sofagent/
    cp -r sofagent/skill/* ~/.openclaw/skills/sofagent/
    cp FDE/SKILL.md ~/.workbuddy/skills/sofagent-fde/
10. iCloud 同步（可选）：cp -r FDE/* ~/Library/Mobile\ Documents/com~apple~CloudDocs/WorkBuddy/FDE工具包/
```

### 9.3 发布后验证

```bash
# Git
git tag -l | grep vX.Y.Z
gh release view vX.Y.Z

# 🔴 Release Notes 完整性检查（v1.0.3 教训）
# 1. body 不为空
# 2. 包含 📖 [详细开发日志](./docs/changelog/vX.Y.Z.md) 链接
# 3. 不是 Draft 状态
gh release view vX.Y.Z --json isDraft,body -q '.body | length'  # 期望 > 100
gh release view vX.Y.Z --json body -q '.body | contains("详细开发日志")'  # 期望: true

# npm
npm view @sofagent/audit version
npm view @sofagent/mcp version

# 🔴 关键：更新全局安装——npm publish 成功后 npm registry 已更新，
# 但开发者本地二进制仍是旧版本。不更新会导致 --version 输出旧版本号，
# 且测试时拿到的是旧功能（如 doctor 少检查项、A14 不存在等）
npm install -g @sofagent/audit@latest
sofagent-audit --version                    # 期望：vX.Y.Z（与 SSOT 一致）
sofagent-audit --doctor                     # 期望：与当前版本 doctor 项数一致

# 本地安装验证
bash tools/check-version.sh             # 期望: 全绿（含第 13 项 npm 二进制版本检查）
```

### 9.4 常见发布故障

| 故障 | 现象 | 解决 |
|------|------|------|
| mcp 版本落后 | `npm view @sofagent/mcp version` 显示旧版本 | mcp job 独立于 audit job，版本号需手动同步 |
| .js.map 泄露 | `npm pack --dry-run` 显示 .js.map | 检查 package.json `files` 是否包含排除模式 |
| README 空白 | npm 页面无 README | 检查 package.json `files` 是否引用了不存在的 README.md |
| npm publish 403 | `npm publish` E403 | 版本号已存在或 NPM_TOKEN 过期 |
| 全局二进制版本落后 | `sofagent-audit --version` 显示旧版本号 | npm registry 已更新但本地未重装。`npm install -g @sofagent/audit@latest` |

---

## 阶段十：发布后

| # | 步骤 |
|:--:|------|
| 15 | **npm 双包验证**：`npm view @sofagent/audit version` + `npm view @sofagent/mcp version` 必须都是最新版本号。不信任自动化 |
| 16 | npm README 验证：`npm view @sofagent/audit readme` + `npm view @sofagent/mcp readme` 均有内容 |
| 17 | 如果本次迭代暴露了新的流程漏洞，**直接吸收进本 SOP 对应阶段**——不要存到单独章节。每条新规则标注版本号（如 `vX.Y 教训`）以便追溯 |
| 18 | **审查闭环**：① 发版后在**全新 session**中用陌生视角 prompt 对已发布版本做独立审查 → 产出报告（这就是下版本的阶段一输入）② 审查发现的新问题 → 下版本修复 ③ 审查体系持续自我进化——每版积累"下次审查会更锋利"的视角和检查项 |
| 19 | **SOP 自我进化**（FDE 提议 → 作者确认）：FDE 发版后自动跑一轮，生成 releasing.md 更新建议（diff 格式），作者确认后 apply。检查项：<br>① 本版本发布过程中遇到的流程漏洞 → 直接吸收进对应阶段，标注版本号<br>② 检查本 SOP 中的数字是否过期（维度数、检查项数、doctor 项数等）<br>③ 本版本新增的工具/脚本是否已纳入对应阶段（如 pre-push-check.sh、check-docs.sh）<br>④ 把更新后的 releasing.md 同步到 LOOP.md 的映射表<br>⑤ 如果 FDE 未发现需更新项，输出"无需更新"报告——零变更也是有效结果 |

---

## 阶段速查表

| 阶段 | 名称 | 谁做 | 需要新 session？ | 产出 |
|:--:|------|:--:|:--:|------|
| 一 | 审查 → 开发日志 | 作者 | 是（陌生视角审查） | 审查报告 + 开发日志 |
| 二 | 开发 | 工程师 | 否 | 代码 + 随修随记的回归维度 |
| 三 | 自测 | 工程师 | 否 | build/test/shellcheck/acceptance 全绿 |
| 四 | 代码审核 | 审核者 | 否 | 逐项 PASS 或 FAIL→修复 |
| **五** | **回归检查 + OpenClaw 验收** | **审核者** | **🔴 是（独立 session）** | **回归清单全 PASS + OpenClaw 全场景通过** |
| 六 | 审查体系维护 | 作者 | 否 | 回归清单 + 陌生视角 prompt 更新 |
| 七 | 文档收尾 | 作者 | 否 | CHANGELOG/ROADMAP/版本号/日期对齐 |
| 八 | 确认关口 | AI → **生成发布 prompt 交接** | 否 | git diff 确认 → 检查清单打勾 → 生成发布 prompt 交给负责人 |
| 九 | 发布 | **🔴 项目负责人亲手执行** | 否 | 按 AI 生成的发布 prompt 逐条执行：npm 双包 + git tag + gh release + Skill 分发 |
| 十 | 发布后 | 作者 | 是（步骤 18） | npm 验证 + 陌生视角审查 → 下版本阶段一输入 |

---

