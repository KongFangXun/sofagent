# sofagent 回归检查清单

> **用途**：每次发版前跑一遍，确认之前修过的问题没有回退。这不是"发现新问题"的工具——发现新问题用[发布后审查](./fresh-eyes-review.md)。
>
> **维护规则**：
> - 每次发版修复新问题后，把对应的检查项加到本清单
> - 检查项编号递增，不重排已有编号
> - 删掉的检查项标注 `[已移除]` 并注明原因，不直接删除
> - 发版时在 `docs/changelog/vX.Y.md` 记录"回归检查 N/N 全通过"
> - **审查体系闭环**（发版时做，见 releasing.md 阶段五「合并更新两份审查文档」）：
>   - ① 本次修复的新增检查项是否已经加到本清单？
>   - ② 有没有反复出现的同类问题——要不要抽象成通用维度加到[发布后审查](./fresh-eyes-review.md)里？
>   - ③ [发布后审查](./fresh-eyes-review.md)本身有没有过时的角色或问题需要删改？
>
> **审查对象**：sofagent 仓库（main 分支）+ npm 包
> **审查范围**：全仓库状态检查（不是只看增量）——所有维度逐项核对

> 📦 **历史维度已归档至 [archive/](./archive/)，主文件只保留当前有效维度（v1.1.2~v1.1.3 及跨版本核心维度）。**
> - [archive/regression-v1.0.md](./archive/regression-v1.0.md)：v0.99.9~v1.0.9（维度 1–267）
> - [archive/regression-v1.1.md](./archive/regression-v1.1.md)：v1.1.0 包拆分（维度 268–292）

---

## 你的身份

你是一名**回归测试工程师**。你的任务不是发现新问题，而是**确认已知的修复没有回退**。你有一份检查清单，每一项对应历史上发现并修复过的问题。逐项核对，全部 PASS 就是通过。

**与发布后审查的区别**：发布后审查是"假装不知道项目是什么，凭直觉找新问题"；回归检查是"知道之前修了什么，确认没退回去"。两者互补，发版前都要跑。

### ⏰ 时序说明（CRITICAL — 避免误判）

回归检查在 **releasing.md 阶段四（审核）** 跑——此时代码已改完但**还没 commit、还没 tag、还没 npm publish**。以下检查项在回归检查阶段必然"不满足"，它们是**发布后验证项**，不是 FAIL：

| 检查项 | 回归检查时状态 | 什么时候满足 |
|--------|:----:|------|
| git tag vX.Y.Z 存在 | ❌ 正常 | 阶段七 Step 5 打 tag 后 |
| npm registry 版本 = SSOT | ❌ 正常 | 阶段七 Step 1 npm publish 后 |
| 全局二进制版本 = SSOT | ❌ 正常 | 阶段七 Step 3 npm i -g 后 |
| 工作目录零未提交修改 | ❌ 正常 | 阶段七 commit 后 |

**遇到以上检查项时标 ⏳（待发版），不标 FAIL。**

---

## 🔄 本次审查背景

> 本清单是**累积式**的——每个维度对应一个历史修复。审查前不需要了解每件事的背景，只需要逐项核对当前代码状态。
>
> v1.1.3 追加 19 维度（293-311）→ v1.1.3 第二次审查追加 5 维度（312-316）→ v1.1.3 全仓质量审计追加 6 维度（301-306）→ v1.1.3 文档工具链修复追加 10 维度（317-326）→ v1.1.3 追加 1 维度（327）。当前主文件保留维度 293-327（v1.1.3 当前有效维度）。

---

## 审查步骤

### 步骤 1：环境验证（必须先跑）
```bash
cd /Users/kongfangxun/Workbuddy/sofagent

# 1.1 pre-push-check
bash tools/pre-push-check.sh
# 期望：7 通过 / 0 警告 / 0 失败

# 1.2 单元测试
cd sofagent/audit && npm test && cd ../..
# 期望：与上次发版数一致或增加
cd sofagent/audit && npm test 2>&1 | tail -5  # 全部 passed

# 1.3 verify --list
node sofagent/audit/dist/verify.js --list 2>&1 | head -5
# 期望：「~48 项（动态）」

# 1.4 文档检查（含铁律措辞检查）
bash tools/check-docs.sh 2>&1 | tail -3
# 期望：全部通过（含铁律措辞检查）

# 1.5 版本号一致性
bash tools/check-version.sh 2>&1 | tail -3
# 期望：全部通过，版本号与 SSOT（package.json）一致

# 1.6 铁律措辞检查（v1.0 新增）
grep -rn '建议\|应该\|尽量' sofagent/skill/*.md FDE/SKILL.md | grep -v 'not_when\|Gotcha\|场景\|如果\|注\|说明'
# 期望：无输出（空 = 全部改完）

# 1.6b CHANGELOG 纯度全量检查（v1.1.3 扩展——涵盖子文件）
grep -rniE "GLM|DeepSeek|双视角|P[012]×|审查修复|陌生视角|fresh-eyes|审查轮次|审查×|审查驱动|审查吸收" CHANGELOG.md docs/changelog/v*.md
# 期望：零命中（仅工作流正当描述如「FDE 审查报告」「独立审查」可接受）
```

### 步骤 2：Fresh clone 体验（v1.0 硬性条件，不允许跳过）
```bash
git clone https://github.com/KongFangXun/sofagent.git /tmp/sofagent-v1-test
cd /tmp/sofagent-v1-test
npm ci 2>&1 | tail -3
bash tools/pre-push-check.sh 2>&1 | tail -5
# 期望：7/7 全绿
```
> ⚠️ 如 GitHub 网络不通：使用 `git clone file:///Users/kongfangxun/Workbuddy/sofagent /tmp/sofagent-v1-test` 绕过；如仍不通，记录原因后标注 ⚠️ 并说明情况。

### 步骤 3：逐维度审查

用 `git diff --cached -- <file>` 查看改动，同时验证全仓库状态。

---

## 审查维度（当前有效 · 编号 293–327）

> 以下为 v1.1.2~v1.1.3 当前有效维度。历史维度（1–292）已归档至 [archive/](./archive/)。

### 跨版本核心维度（版本号一致性、铁律措辞、Skill 行数等——每次发版必跑）

以下检查项跨版本持续有效，不因版本迭代而过时：

- **版本号全量一致**：`bash tools/check-version.sh` → 0 不一致；`bash tools/pre-push-check.sh` → 7/7 全绿
- **铁律措辞清零**：`grep -rn '建议\|应该\|尽量' sofagent/skill/*.md FDE/SKILL.md | grep -v 'not_when\|Gotcha\|场景\|如果\|注\|说明'` → 无输出
- **Skill 文件行数 ≤100**：`wc -l sofagent/skill/*.md FDE/SKILL.md` → 每个文件 ≤100 行
- **CHANGELOG 纯度**：`grep -rniE "GLM|DeepSeek|双视角|P[012]×|审查修复|陌生视角|fresh-eyes|审查轮次|审查×|审查驱动|审查吸收" CHANGELOG.md docs/changelog/v*.md` → 零命中
- **测试数一致**：`cd sofagent/audit && npm test 2>&1 | grep "Tests"` 的数字与 README/ROADMAP/evidence 一致
- **发版前 git status 零未提交修改**（⏰ 发布前最后步骤）：`git status --short | wc -l` → 0

---

### 第二十四部分：v1.1.3 全仓质量审计修复（维度 301-306）🆕

> 来源：v1.1.3 开发期全仓质量审计（代码冗余 + 文档错误 + 跨文档死链 + 文档冗余 四维度）。6 个维度覆盖：死链全量扫描、跨包代码重复、Ledger-Views 归属、文档规范源/DRY、文件迁移四动作、check-docs.sh 死链范围扩展。

#### 301. 跨文档相对路径死链全量扫描 🆕
```bash
# v1.1.3 审计发现：23 处死链。根因=文件/目录迁移后相对路径未修正 + 审查只查 rules.md 死链(check-docs.sh 第 1 项)。
bash tools/check-docs.sh 2>&1 | grep -i 'dead\|死链'
# 期望：0 处（除登记的白名单：仓库外 Desktop 路径、模板占位 vX.Y.Z.md）
```

#### 302. 跨包代码重复检测（复制≠移动） 🆕
```bash
# v1.1.3 发现：audit/src/filesystem/isomorphic-git.ts(383行) 与 core/src/filesystem/isomorphic-git.ts(383行) 仅 4 行差异
# audit 应 import @sofagent/core，不应复制。
dup=$(find sofagent -path '*/src/*.ts' -not -path '*/node_modules/*' -not -path '*/__tests__/*' -not -path '*/test*/*' \
  | sed 's#.*/##' | sort | uniq -d | grep -vE '^(index|cli|types|config-template|memory-sync|reporter|verify|skill-safety-.*)\.ts$')
[ -n "$dup" ] && echo "⚠️ 跨包重复源文件: $dup" || echo "OK 无跨包重复"
```

#### 303. Ledger-Views 归属一致性（think.md 始终为 Ledger/source） 🆕
```bash
# v1.1.3 发现：ARCHITECTURE.md:320 将 think.md 错标为 Views(派生视图)
grep -rn "think.md.*Views\|think.md.*派生视图" ARCHITECTURE.md PHILOSOPHY.md DEVELOPMENT.md FDE/FDE.md
# 期望：无匹配（若匹配 = P0，think.md 归属错误）
grep -n "Ledger-Views-Policy\|task/logs.*Ledger\|knowledge.*Views" PHILOSOPHY.md ARCHITECTURE.md
```

#### 304. 文档规范源与冗余（DRY：概念只定义一次） 🆕
```bash
# canonical source：架构=ARCHITECTURE、记忆模型=PHILOSOPHY、发版流程=releasing、局限=LIMITATIONS
grep -rn "Ledger-Views-Policy" ARCHITECTURE.md PHILOSOPHY.md DEVELOPMENT.md | head
# 期望：各文档对 Ledger/Views 的归属描述一致（think.md=Ledger）
```

#### 305. 文件/目录迁移四动作完整性（含死链修复） 🆕
```bash
# v1.1.3 教训：LIMITATIONS.md 从 docs/ 迁到根、docs/ 子目录重排，但迁入文件相对路径引用未同步 → 死链
git grep -n "OLD_RELATIVE_PATH" -- '*.md'   # 旧路径应 0 命中
# + 全仓相对路径死链 0（见维度 301）
```

#### 306. check-docs.sh 死链检查范围扩展 🆕
```bash
# v1.1.3 发现：check-docs.sh 第 1 项死链检查仅扫 rules.md，漏掉通用相对路径死链
bash tools/check-docs.sh 2>&1 | grep '死链'
# 期望：除已知白名单外，不报通用相对路径死链
# ✅ 已落地（v1.1.3）：tools/check-docs.sh 第 1b 节实现全仓相对路径死链扫描
```

---

### 第二十五部分：v1.1.3 文档与工具链修复（维度 317-326）🆕

> 来源：v1.1.3 文档卫生 + 工具链加固 + 发版流程修复。10 个维度。

#### 317. A4 ruleClass = 业务底线（index.ts 与 audit/README 一致）🆕
```bash
grep -A5 "'A4\|name.*不删配置" sofagent/audit/src/rules/index.ts | grep "ruleClass" | grep "业务底线"
# 期望：有匹配
grep 'A4.*不删配置.*业务底线' sofagent/audit/README.md
# 期望：有匹配
```

#### 318. 跨包重复清零（skill-safety-*/memory-sync/config-template 单包唯一）🆕
```bash
dup=$(find sofagent -path '*/src/*.ts' -not -path '*/node_modules/*' -not -path '*/__tests__/*' -not -path '*/test*/*' \
  | sed 's#.*/##' | sort | uniq -d | grep -vE '^(index|cli|types|config-template|memory-sync|reporter|verify|skill-safety-.*)\.ts$')
[ -z "$dup" ] && echo "OK" || echo "❌ 跨包重复: $dup"
```

#### 319. silent 模式 exit code（A1 FAIL → exit 2 不因 silent 归零）🆕
```bash
cd /tmp && rm -rf test-silent && mkdir test-silent && cd test-silent
git init && git config user.email "test@test.com" && git config user.name "test"
echo "sk-abc123" > secret.txt && git add secret.txt && git commit -m "leak" --no-verify
sofagent-audit --diff HEAD~1..HEAD --silent >/dev/null 2>&1
echo "exit=$?"  # 期望: exit=2（不因 silent 归零）
cd /tmp && rm -rf test-silent
```

#### 320. PASS 签名行存在且版本号非硬编码🆕
```bash
grep -rn "v1\.1\.[0-9]" sofagent/audit/src/index.ts | grep -v "import\|from\|\/\/"
# 期望：零匹配——无硬编码具体版本号
sofagent-audit --version 2>&1 | grep -q "sofagent" && echo "✅ 签名存在" || echo "❌ 签名缺失"
```

#### 321. webhook 签名半角冒号 + 紧凑措辞 🆕
```bash
grep -rn "sofagent.*全角\|sofagent：\|sofagent ：" sofagent/audit/src/ 2>/dev/null
# 期望：无匹配——签名段应为半角冒号（如 "[sofagent-audit]: PASS"）
```

#### 322. 「回溯引擎」零残留（排除 changelog 历史）🆕
```bash
grep -rn "回溯引擎" --include="*.md" . | grep -v node_modules | grep -v "docs/changelog"
# 期望：零匹配
```

#### 323. CHANGELOG 索引含全部已发版 tag（含 v1.1.1）+ 规划版独立分组 🆕
```bash
echo "=== 已发版 git tag ===" && git tag -l 'v1.*' | sort -V
echo "=== CHANGELOG 索引中的版本 ===" && grep -oP '### \[v[\d.]+\]' CHANGELOG.md | sed 's/### \[/[/'
# 人工核对：所有 v1.x git tag 应在 CHANGELOG 正式版索引中有条目
grep -A1 "## 规划中" CHANGELOG.md | head -1
# 期望：有「规划中」独立标题
```

#### 324. SECURITY.md 当前状态版本标注 = 当前版本 🆕
```bash
SSOT_VER=$(node -e "console.log(require('./package.json').version)")
grep "当前状态（v${SSOT_VER}" SECURITY.md
# 期望：有匹配
grep -n "当前状态（v1\.0" SECURITY.md
# 期望：无匹配
```

#### 325. enterprise-deploy.md 四节存在且 SECURITY 链接可达 🆕
```bash
for section in "批量安装" "集中下发" "CI 集成" "已落地"; do
  grep -q "$section" docs/guides/enterprise-deploy.md && echo "✅ $section" || echo "❌ 缺失: $section"
done
grep "enterprise-deploy" SECURITY.md | head -1
test -f docs/guides/enterprise-deploy.md && echo "✅ 文件存在" || echo "❌ 文件缺失"
```

#### 326. pre-push-check 含 tag message 校验 + 循环依赖检测步骤 🆕
```bash
grep -c "Tag message 校验" tools/pre-push-check.sh
# 期望: 1
grep -c "依赖图循环检测" tools/pre-push-check.sh
# 期望: 1
bash tools/pre-push-check.sh --quick 2>&1 | tail -5
# 期望: 全绿或仅 WARN（tag 不存在属正常）
```

---

### 第二十六部分：v1.1.3 持续感知层（维度 293-300）🆕

#### 293. 感知层配置完整性 🆕
```bash
grep -A 2 "perception:" .sofagent/config.yml 2>/dev/null && echo "✅ 感知配置段存在" || echo "❌ 缺少感知配置段"
grep "enabled: true" .sofagent/config.yml 2>/dev/null && echo "✅ 感知推送已启用" || echo "⚠️  感知推送未启用"
```

#### 294. 感知推送目标可达 🆕
```bash
grep "push_target:" .sofagent/config.yml | grep -q "webhook://" && echo "✅ push_target 已配置" || echo "❌ push_target 未配置"
```

#### 295. MCP 返回值签名覆盖率 🆕
```bash
grep "sofagent-audit.*扫描" sofagent/mcp/src/mcp-server.ts > /dev/null && echo "✅ 审计工具已签名" || echo "❌ 审计工具缺签名"
grep "sofagent.*知识库查询\|sofagent.*knowledge" sofagent/mcp/src/mcp-server.ts > /dev/null && echo "✅ 知识查询已签名" || echo "⚠️  知识查询缺签名"
```

#### 296. Webhook PASS 推送已实现 🆕
```bash
grep -c "PASS" sofagent/audit/src/webhook.ts
# 应 > 0，说明 PASS 路径存在推送逻辑
```

#### 297. MCP capabilities 工具描述准确性 🆕
```bash
grep "run_audit" sofagent/mcp/src/mcp-server.ts | grep -c "19 条规则"
# 应 ≥ 1
grep "run_audit" sofagent/mcp/src/mcp-server.ts | grep -c "0 token"
# 应 ≥ 1
grep "run_audit" sofagent/mcp/src/mcp-server.ts | grep -c "A1-A14"
# 应 = 0（过期描述）
```

#### 298. 回归清单头维度数自动校验 🆕
```bash
HEAD_VAL=$(head -1 docs/verification/regression-checklist.md | grep -oE '[0-9]+' | head -1)
ACTUAL=$(grep -c "^#### " docs/verification/regression-checklist.md)
[ "$HEAD_VAL" = "$ACTUAL" ] && echo "✅ 维度数一致 ($HEAD_VAL)" || echo "❌ 头声称 $HEAD_VAL ≠ 实际 $ACTUAL"
```

#### 299. CHANGELOG 纯度自动化检查加入 pre-push 🆕
```bash
grep -rniE "审查修复|审查驱动|P[0-9]×|审查问题.*项修复" docs/changelog/ CHANGELOG.md ROADMAP.md
# 期望：零命中
```

#### 300. 包依赖图循环检测（audit ↔ daemon） 🆕
```bash
AUDIT_OPT=$(node -e "const p=require('./sofagent/audit/package.json'); console.log(p.optionalDependencies?.['@sofagent/daemon'] ? 'OPTIONAL_DAEMON' : 'NONE')")
DAEMON_DEP=$(node -e "const p=require('./sofagent/daemon/package.json'); console.log(p.dependencies?.['@sofagent/audit'] ? 'DEP_AUDIT' : 'NONE')")
if [ "$AUDIT_OPT" = "OPTIONAL_DAEMON" ] && [ "$DAEMON_DEP" = "DEP_AUDIT" ]; then
  echo "⚠️  循环依赖持续存在（audit→daemon optional + daemon→audit dep）—已知架构债务"
else
  echo "✅ 无循环依赖"
fi
```

---

### 第二十七部分：v1.1.3 第二次审查追加（维度 307-316）🆕

#### 307. acceptance-test.sh 管道 pipefail 保护 🆕
```bash
grep -n 'grep.*|.*head\|grep.*|.*wc' tools/acceptance-test.sh | grep -v '|| true'
# 期望：零命中
```

#### 308. audit README 规则分级与代码一致性 🆕
```bash
grep "不坏构建" sofagent/audit/src/rules/index.ts | grep -o "能力拐杖" && echo "A6=能力拐杖 ✅"
grep "不滥资源" sofagent/audit/src/rules/index.ts | grep -o "业务底线" && echo "A11=业务底线 ✅"
grep "A6.*能力拐杖\|A11.*业务底线" sofagent/audit/README.md | wc -l
# 期望：2
```

#### 309. audit README 测试数时效性 🆕
```bash
README_NUM=$(grep -oP '[0-9]+(?= tests)' sofagent/audit/README.md)
ACTUAL_NUM=$(cd sofagent/audit && npx vitest run 2>&1 | grep Tests | grep -oP '[0-9]+(?= passed)')
[ "$README_NUM" = "$ACTUAL_NUM" ] && echo "✅ $README_NUM" || echo "❌ README $README_NUM ≠ 实际 $ACTUAL_NUM"
```

#### 310. webhook.ts 版本号硬编码检测 🆕
```bash
grep -rn "version\s*=\s*'[0-9]" sofagent/*/src/*.ts | grep -v __tests__ | grep -v shared/constants | grep -v node_modules
# 期望：零命中
```

#### 311. acceptance-test.sh scenario() 场景间清理完整性 🆕
```bash
grep -c "git rm --cached -f .env" tools/acceptance-test.sh
# 期望：≥ 2
```

#### 312. 动态规则禁用逻辑核验（config.yml rules: { a16: false } 实跑验证） 🆕
```bash
grep -c "a16" sofagent/core/src/config-loader.ts
grep -c "a17" sofagent/core/src/config-loader.ts
# 期望：≥ 1（knownKeys 含 a16/a17）
grep -c "A16" sofagent/audit/src/rules/index.ts
grep -c "A17" sofagent/audit/src/rules/index.ts
# 期望：≥ 1
```

#### 313. tag commit message 含版本号 🆕
```bash
git tag -l "v*" | while read t; do
  v=$(echo $t | sed 's/^v//')
  msg=$(git log -1 --format=%s $t)
  echo "$t → $msg"
done
# 期望：每个 tag 的 commit message 含对应版本号
```

#### 314. 孤儿 changelog 检测 🆕
```bash
for f in docs/changelog/v*.md; do
  v=$(basename $f .md)
  git rev-parse $v >/dev/null 2>&1 || echo "⚠️ $v: changelog 存在但无对应 tag（应为规划中）"
done
git tag -l "v*" | while read t; do
  grep -q "$t" CHANGELOG.md || echo "❌ $t: tag 存在但 CHANGELOG.md 索引遗漏"
done
# 期望：零输出
```

#### 315. CHANGELOG 纯度 grep 扩至全量子文件 🆕
```bash
grep -rniE "GLM|DeepSeek|双视角|P[012]×|审查修复|陌生视角|fresh-eyes|审查轮次|审查×|审查驱动|审查吸收" CHANGELOG.md docs/changelog/v*.md
# 期望：零命中
```

#### 316. ruleClass 代码↔README 跨文档一致性 🆕
```bash
grep "name:" sofagent/audit/src/rules/index.ts | wc -l
# 期望：19（规则总数，与 README 声称一致）
```

---

### 第二十八部分：v1.1.3 Agent 身份感知（维度 327）🆕

#### 327. Agent 身份感知有效性 🆕
```bash
# v1.1.3：Agent 需在上下文中感知到 sofagent 约束来源
grep -c "露个脸就够了" sofagent/skill/SKILL.md
# 期望：≥ 1
grep -c "质量搭档" sofagent/skill/engage.md
# 期望：≥ 1
grep -c "sofagent 已就绪" sofagent/scripts/lib/post-install.sh
# 期望：≥ 1
grep -c "Agent 身份感知" FDE/FDE.md
# 期望：≥ 1
```

---

## 审查约束

- **版本号全量一致**——`check-version.sh` 0 不一致，`pre-push-check.sh` 7/7 全绿
- **铁律措辞必须用 grep 验证**——不能凭感觉说「改完了」，grep 不到才算数
- **Skill 文件行数 ≤100**——每次发版必须验证，新增内容时同步删旧内容
- **CHANGELOG 纯度**——只写产品变更，不含审查元信息（模型名/轮次/P0P1P2 标签）
- **测试数一致**——README/ROADMAP/evidence 中的测试数与实际 npm test 输出一致
- **实验性标注不能去掉**——daemon / 编排引擎 / Windows 仍然实验性
- **发版前 git status 零未提交修改**（⏰ 发布前最后步骤，commit 后验证）
- **发现的问题请给出文件路径 + 行号 + 具体建议**，不要泛泛而谈

---

> **审查者**：请严格验证每一项声称，不放过任何矛盾。全维度逐项核对。

---

请按以下结构输出审查报告：

```markdown
# sofagent 回归检查报告

## 总览
- 审查日期：YYYY-MM-DD
- 审查范围：当前有效维度（293-327）+ 跨版本核心维度
- 环境验证：pre-push-check [✅/❌] / npm test [✅/❌] / check-docs [✅/❌] / check-version [✅/❌]
- Fresh clone：[✅/❌]
- npm 发布：@sofagent/audit@<最新版> [✅] / @sofagent/mcp@<最新版> [✅]
- 整体结论：[已发布无遗留 / 需修复后补发 / 阻塞]

## 问题清单

### 🔴 P0（阻塞发布）
> 必须修复才能发版

### 🟡 P1（建议修复）
| # | 维度 | 文件:行 | 问题 | 建议 |
|---|------|---------|------|------|

### 🟢 P2（优化建议）
| # | 维度 | 文件:行 | 问题 | 建议 |
|---|------|---------|------|------|

## 维度通过统计
- 通过：X
- ⚠️ 有条件通过：X
- ❌ 未通过：X
- 🔴 P0：X
- 🟡 P1：X
- 🟢 P2：X

## 最终建议
- [ ] 可以发版
- [ ] 需修复 P0 后发版
- [ ] 需重大修复

## 审查体系更新建议

### 建议追加的回归检查项
| 建议编号 | 维度描述 | 为什么加（关联的 P0/P1/P2） |
|---------|---------|--------------------------|
| 328 | 审计 PASS 后自动创建 shadow repo 快照（`--timeline` 有数据） | v1.1.3 验收发现：audit 主流程不调用 `createPostAuditSnapshot`，`--timeline`/`--revert` 永远空。已修复（audit index.ts 在 PASS 时调用 core 的 createShadowRepo + commitSnapshot） |
| 329 | 验收测试模块路径与实际包结构一致 | v1.1.3 验收发现：12 包拆分后 openclaw-acceptance-test.md 路径过时（audit/dist/→skillopt/dist/ 等 5 处）。每次包结构变更后必须同步验收文档路径 |
```
