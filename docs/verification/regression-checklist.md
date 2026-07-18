# sofagent 回归检查清单

> **用途**：每次发版前跑一遍，确认之前修过的问题没有回退。这不是"发现新问题"的工具——发现新问题用[发布后审查](./fresh-eyes-review.md)。
>
> **审查对象**：sofagent 仓库（main 分支）+ npm 包
> **审查范围**：全仓库状态检查（不是只看增量）——所有维度逐项核对

---

## 🔒 维护公约（防膨胀铁律）

> 本清单历史上曾膨胀到 288 个维度（3686 行），根因是「每次追加 🆕 维度却不归并同类」。2026-07-18 治理：归并同类项 + 重排编号 + 删除归档（历史维度靠 git 找回）。

**追加新维度前，必须执行**：

1. **先 grep 同类**：用新维度的关键词在本文档内搜索，确认是否已有同类维度
2. **有同类 → 扩展旧维度**：在已有维度的 bash 块里追加子项（用 `# 子项:` 注释分隔），不新增编号
3. **无同类 → 才新增**：编号取当前最大编号 +1，归入对应主题 section
4. **禁止跨主题散落**：同一主题只在一个 section 里出现

**主题分类**（追加时归入对应 section）：

| Section | 覆盖范围 |
|---------|---------|
| 跨版本核心维度 | 版本号/铁律措辞/Skill 行数/测试数——每次发版必跑的基线 |
| 文档与 CHANGELOG | 纯度/死链/规范源/迁移完整性/索引一致性 |
| 审计引擎一致性 | 规则分级/exit code/签名/ruleClass/版本号硬编码 |
| 感知与推送层 | config/webhook/MCP 签名/capabilities |
| 测试与工具链 | acceptance-test/pre-push-check/依赖图/跨包重复/README 测试数 |
| Agent 身份感知 | SKILL/engage/FDE/install 签名 |

**历史维度找回**：`git show 43fac89:docs/verification/regression-checklist.md`

**清单自身健康度自校验**（每次修改后跑）：
```bash
HEAD_VAL=$(grep -oE '审查维度（[0-9]+ 项' docs/verification/regression-checklist.md | grep -oE '[0-9]+')
ACTUAL=$(grep -c "^#### " docs/verification/regression-checklist.md)
[ "$HEAD_VAL" = "$ACTUAL" ] && echo "✅ 维度数一致 ($HEAD_VAL)" || echo "❌ 标题声称 $HEAD_VAL ≠ 实际 $ACTUAL"
```

---

## 你的身份

你是一名**回归测试工程师**。你的任务不是发现新问题，而是**确认已知的修复没有回退**。逐项核对，全部 PASS 就是通过。

**与发布后审查的区别**：发布后审查是陌生视角找新问题；回归检查是确认修过的没退回去。两者互补，发版前都要跑。

### ⏰ 时序说明

回归检查在 **releasing.md 阶段四（审核）** 跑——此时还没 commit/tag/publish：

| 检查项 | 回归检查时 | 满足时机 |
|--------|:----:|------|
| git tag vX.Y.Z 存在 | ❌ 正常 | 阶段七打 tag 后 |
| npm registry 版本 = SSOT | ❌ 正常 | 阶段七 npm publish 后 |
| 全局二进制版本 = SSOT | ❌ 正常 | 阶段七 npm i -g 后 |
| 工作目录零未提交修改 | ❌ 正常 | 阶段七 commit 后 |

**遇到以上检查项时标 ⏳（待发版），不标 FAIL。**

---

## 审查步骤

### 步骤 1：环境验证
```bash
cd /Users/kongfangxun/Workbuddy/sofagent
bash tools/pre-push-check.sh                    # 期望：7/7 全绿
cd sofagent/audit && npm test && cd ../..        # 期望：全部 passed
node sofagent/audit/dist/verify.js --list 2>&1 | head -5  # 期望：~48 项
bash tools/check-docs.sh 2>&1 | tail -3          # 期望：全部通过
bash tools/check-version.sh 2>&1 | tail -3       # 期望：全部通过
grep -rn '建议\|应该\|尽量' sofagent/skill/*.md FDE/SKILL.md | grep -v 'not_when\|Gotcha\|场景\|如果\|注\|说明'
# 期望：无输出
```

### 步骤 2：Fresh clone 体验
```bash
git clone https://github.com/KongFangXun/sofagent.git /tmp/sofagent-v1-test
cd /tmp/sofagent-v1-test && npm ci 2>&1 | tail -3 && bash tools/pre-push-check.sh 2>&1 | tail -5
# 期望：7/7 全绿
```

### 步骤 3：逐维度审查

---

## 审查维度（15 项 · 编号 1–15）

> 2026-07-18 治理：从原 35 维度归并同类项而来。

### 跨版本核心维度（每次必跑基线，不编号）

- **版本号全量一致**：`check-version.sh` → 0 不一致；`pre-push-check.sh` → 7/7 全绿
- **铁律措辞清零**：grep「建议/应该/尽量」→ 无输出
- **Skill 文件行数 ≤100**：每个文件 ≤100 行
- **测试数一致**：`npm test` 的 Tests 数与 README/ROADMAP/evidence 一致
- **发版前 git status 零未提交修改**

---

### 文档与 CHANGELOG

#### 1. CHANGELOG 纯度与完整性

> 归并自：跨版本纯度项 + 299+314+315+322+323

```bash
# 子项 a: 纯度——不含审查元信息
grep -rniE "GLM|DeepSeek|双视角|P[012]×|审查修复|陌生视角|fresh-eyes|审查轮次|审查×|审查驱动|审查吸收" CHANGELOG.md docs/changelog/v*.md ROADMAP.md
# 期望：零命中

# 子项 b: 「回溯引擎」零残留
grep -rn "回溯引擎" --include="*.md" . | grep -v node_modules | grep -v "docs/changelog"
# 期望：零匹配

# 子项 c: 孤儿 changelog 检测
for f in docs/changelog/v*.md; do
  v=$(basename $f .md)
  git rev-parse $v >/dev/null 2>&1 || echo "⚠️ $v: 无对应 tag"
done
git tag -l "v*" | while read t; do
  grep -q "$t" CHANGELOG.md || echo "❌ $t: CHANGELOG 索引遗漏"
done
# 期望：零输出

# 子项 d: CHANGELOG 索引含全部已发版 tag + 规划版独立分组
grep -A1 "## 规划中" CHANGELOG.md | head -1
# 期望：有「规划中」独立标题
```

#### 2. 跨文档死链全量扫描

> 归并自：301+305+306

```bash
# 子项 a: check-docs 全仓相对路径死链
bash tools/check-docs.sh 2>&1 | grep -i 'dead\|死链'
# 期望：0 处

# 子项 b: 文件/目录迁移四动作——旧路径应 0 命中
git grep -n "OLD_RELATIVE_PATH" -- '*.md'
```

#### 3. 文档规范源与归属一致性

> 归并自：303+304

```bash
# 子项 a: think.md 始终为 Ledger/source
grep -rn "think.md.*Views\|think.md.*派生视图" ARCHITECTURE.md PHILOSOPHY.md DEVELOPMENT.md FDE/FDE.md
# 期望：无匹配（若匹配 = P0）

# 子项 b: canonical source 一致性
grep -rn "Ledger-Views-Policy" ARCHITECTURE.md PHILOSOPHY.md DEVELOPMENT.md | head
# 期望：各文档描述一致
```

---

### 审计引擎一致性

#### 4. 审计规则分级与 ruleClass 一致性

> 归并自：317+316+308

```bash
# 子项 a: A4 ruleClass = 业务底线
grep -A5 "'A4\|name.*不删配置" sofagent/audit/src/rules/index.ts | grep "ruleClass" | grep "业务底线"
grep 'A4.*不删配置.*业务底线' sofagent/audit/README.md

# 子项 b: 规则总数一致
grep "name:" sofagent/audit/src/rules/index.ts | wc -l    # 期望：19

# 子项 c: A6/A11 分级标签
grep "不坏构建" sofagent/audit/src/rules/index.ts | grep -o "能力拐杖" && echo "A6=能力拐杖 ✅"
grep "不滥资源" sofagent/audit/src/rules/index.ts | grep -o "业务底线" && echo "A11=业务底线 ✅"
grep "A6.*能力拐杖\|A11.*业务底线" sofagent/audit/README.md | wc -l  # 期望：2
```

#### 5. 审计 exit code 与输出签名

> 归并自：319+320+321

```bash
# 子项 a: silent 模式 A1 FAIL → exit 2
cd /tmp && rm -rf test-silent && mkdir test-silent && cd test-silent
git init && git config user.email "test@test.com" && git config user.name "test"
echo "sk-abc123" > secret.txt && git add secret.txt && git commit -m "leak" --no-verify
sofagent-audit --diff HEAD~1..HEAD --silent >/dev/null 2>&1
echo "exit=$?"  # 期望: exit=2
cd /tmp && rm -rf test-silent

# 子项 b: 签名行存在且版本号非硬编码
grep -rn "v1\.1\.[0-9]" sofagent/audit/src/index.ts | grep -v "import\|from\|\/\/"  # 期望：零匹配
sofagent-audit --version 2>&1 | grep -q "sofagent" && echo "✅ 签名存在"

# 子项 c: webhook 签名半角冒号
grep -rn "sofagent.*全角\|sofagent：\|sofagent ：" sofagent/audit/src/ 2>/dev/null  # 期望：无匹配
```

#### 6. 版本号硬编码检测

> 归并自：310+324

```bash
# 子项 a: 源码中无版本号硬编码
grep -rn "version\s*=\s*'[0-9]" sofagent/*/src/*.ts | grep -v __tests__ | grep -v shared/constants | grep -v node_modules
# 期望：零命中

# 子项 b: SECURITY.md 版本标注 = 当前版本
SSOT_VER=$(node -e "console.log(require('./package.json').version)")
grep "当前状态（v${SSOT_VER}" SECURITY.md   # 期望：有匹配
```

---

### 感知与推送层

#### 7. 感知层配置与推送链路

> 归并自：293+294+295+296+297

```bash
# 子项 a: 配置完整性
grep -A 2 "perception:" .sofagent/config.yml 2>/dev/null && echo "✅ 存在" || echo "❌ 缺少"
grep "enabled: true" .sofagent/config.yml 2>/dev/null && echo "✅ 已启用"

# 子项 b: 推送目标
grep "push_target:" .sofagent/config.yml | grep -q "webhook://" && echo "✅ 已配置"

# 子项 c: MCP 返回值签名
grep "sofagent-audit.*扫描" sofagent/mcp/src/mcp-server.ts > /dev/null && echo "✅ 审计已签名"

# 子项 d: Webhook PASS 推送
grep -c "PASS" sofagent/audit/src/webhook.ts  # 应 > 0

# 子项 e: MCP capabilities 准确性
grep "run_audit" sofagent/mcp/src/mcp-server.ts | grep -c "19 条规则"  # 应 ≥ 1
grep "run_audit" sofagent/mcp/src/mcp-server.ts | grep -c "A1-A14"      # 应 = 0
```

---

### 测试与工具链

#### 8. acceptance-test 健壮性

> 归并自：307+311

```bash
# 子项 a: 管道 pipefail 保护
grep -n 'grep.*|.*head\|grep.*|.*wc' tools/acceptance-test.sh | grep -v '|| true'  # 期望：零命中

# 子项 b: 场景间清理
grep -c "git rm --cached -f .env" tools/acceptance-test.sh  # 期望：≥ 2
```

#### 9. 动态规则禁用逻辑

> 原 312

```bash
grep -c "a16\|a17" sofagent/core/src/config-loader.ts   # 期望: ≥ 2
grep -c "A16\|A17" sofagent/audit/src/rules/index.ts     # 期望: ≥ 2
```

#### 10. tag commit message 规范

> 原 313

```bash
git tag -l "v*" | while read t; do
  v=$(echo $t | sed 's/^v//')
  msg=$(git log -1 --format=%s $t)
  echo "$t → $msg"
done
# 期望：每个 tag 的 commit message 含对应版本号
```

#### 11. 包依赖图循环检测

> 归并自：300+326

```bash
# 子项 a: audit↔daemon 循环依赖
AUDIT_OPT=$(node -e "const p=require('./sofagent/audit/package.json'); console.log(p.optionalDependencies?.['@sofagent/daemon'] ? 'OPTIONAL_DAEMON' : 'NONE')")
DAEMON_DEP=$(node -e "const p=require('./sofagent/daemon/package.json'); console.log(p.dependencies?.['@sofagent/audit'] ? 'DEP_AUDIT' : 'NONE')")
[ "$AUDIT_OPT" = "OPTIONAL_DAEMON" ] && [ "$DAEMON_DEP" = "DEP_AUDIT" ] && echo "⚠️ 循环依赖（已知债务）" || echo "✅ 无循环依赖"

# 子项 b: pre-push-check 含循环依赖检测
grep -c "依赖图循环检测" tools/pre-push-check.sh  # 期望: 1
grep -c "Tag message 校验" tools/pre-push-check.sh  # 期望: 1
```

#### 12. 跨包代码重复检测

> 归并自：302+318

```bash
dup=$(find sofagent -path '*/src/*.ts' -not -path '*/node_modules/*' -not -path '*/__tests__/*' -not -path '*/test*/*' \
  | sed 's#.*/##' | sort | uniq -d | grep -vE '^(index|cli|types|config-template|memory-sync|reporter|verify|skill-safety-.*)\.ts$')
[ -z "$dup" ] && echo "OK" || echo "❌ 跨包重复: $dup"
```

#### 13. README 测试数时效性

> 原 309

```bash
README_NUM=$(grep -oP '[0-9]+(?= tests)' sofagent/audit/README.md)
ACTUAL_NUM=$(cd sofagent/audit && npx vitest run 2>&1 | grep Tests | grep -oP '[0-9]+(?= passed)')
[ "$README_NUM" = "$ACTUAL_NUM" ] && echo "✅ $README_NUM" || echo "❌ $README_NUM ≠ $ACTUAL_NUM"
```

---

### 文档完整性

#### 14. enterprise-deploy 完整性

> 原 325

```bash
for section in "批量安装" "集中下发" "CI 集成" "已落地"; do
  grep -q "$section" docs/guides/enterprise-deploy.md && echo "✅ $section" || echo "❌ 缺失: $section"
done
grep "enterprise-deploy" SECURITY.md | head -1
test -f docs/guides/enterprise-deploy.md && echo "✅ 文件存在"
```

---

### Agent 身份感知

#### 15. Agent 身份感知有效性

> 原 327

```bash
grep -c "露个脸就够了" sofagent/skill/SKILL.md          # 期望：≥ 1
grep -c "质量搭档" sofagent/skill/engage.md              # 期望：≥ 1
grep -c "sofagent 已就绪" sofagent/scripts/lib/post-install.sh  # 期望：≥ 1
grep -c "Agent 身份感知" FDE/FDE.md                      # 期望：≥ 1
```

---

## 审查约束

- **版本号全量一致**——`check-version.sh` 0 不一致，`pre-push-check.sh` 7/7 全绿
- **铁律措辞必须用 grep 验证**——不能凭感觉
- **Skill 文件行数 ≤100**——每次发版必须验证
- **CHANGELOG 纯度**——只写产品变更，不含审查元信息
- **测试数一致**——README/ROADMAP/evidence 与 npm test 输出一致
- **实验性标注不能去掉**——daemon/编排引擎/Windows 仍然实验性
- **发版前 git status 零未提交修改**
- **追加新维度前先 grep 同类**——见维护公约
- **发现的问题请给出文件路径+行号+具体建议**

---

> **审查者**：请严格验证每一项声称，全维度逐项核对。

---

请按以下结构输出审查报告：

```markdown
# sofagent 回归检查报告

## 总览
- 审查日期：YYYY-MM-DD
- 审查范围：15 维度 + 跨版本核心维度
- 环境验证：pre-push-check [✅/❌] / npm test [✅/❌] / check-docs [✅/❌] / check-version [✅/❌]
- Fresh clone：[✅/❌]
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
- 通过：X / ⚠️：X / ❌：X
- 🔴 P0：X / 🟡 P1：X / 🟢 P2：X

## 最终建议
- [ ] 可以发版 / [ ] 需修复 P0 后发版 / [ ] 需重大修复

## 审查体系更新建议
> 追加前请先 grep 同类维度（见维护公约）。有同类则扩展旧维度的子项，不新增编号。
```
