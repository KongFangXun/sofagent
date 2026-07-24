# sofagent 回归检查清单

> **用途**：每次发版前跑一遍，确认之前修过的问题没有回退。发现新问题用[fresh-eyes-review](./fresh-eyes-review.md)。
> **审查对象**：sofagent 仓库（main 分支）+ npm 包 · **审查范围**：全仓库状态检查（不是只看增量）
## 🔒 维护公约（防膨胀铁律）

**追加新维度前，必须先 grep 同类**：有同类 → 扩展旧维度的子项，不新增编号；无同类 → 才新增编号 = 当前最大 +1。历史维度靠 `git show 43fac89:LOOP/releaser/regression-checklist.md` 找回。

**行数警戒线（验收脚本联动，v1.1.7 起）**：两份验证文件任一行数越线即触发瘦身（releasing.md 阶段五 Tier 2）——`regression-checklist.md` ≤ 1000 行、`LOOP/releaser/acceptance-test.sh` ≤ 1500 行。越线不表示有 bug，只是提醒该做一轮精简，防止几版后回到 3000+ 行不可维护。

**清单自身健康度自校验**（每次修改后跑）：
```bash
HEAD_VAL=$(grep -oE '审查维度（[0-9]+ 项' LOOP/releaser/regression-checklist.md | grep -oE '[0-9]+')
ACTUAL=$(grep -c "^#### " LOOP/releaser/regression-checklist.md)
[ "$HEAD_VAL" = "$ACTUAL" ] && echo "✅ 维度数一致 ($HEAD_VAL)" || echo "❌ 标题声称 $HEAD_VAL ≠ 实际 $ACTUAL"

# 行数警戒线自检（越线提醒瘦身，非失败）
WC_CHK=$(wc -l < LOOP/releaser/regression-checklist.md)
WC_ACC=$(wc -l < LOOP/releaser/acceptance-test.sh)
[ "$WC_CHK" -le 1000 ] && echo "✅ checklist 行数 $WC_CHK (≤1000)" || echo "⚠️ checklist 行数 $WC_CHK 超 1000，触发瘦身"
[ "$WC_ACC" -le 1500 ] && echo "✅ acceptance-test 行数 $WC_ACC (≤1500)" || echo "⚠️ acceptance-test 行数 $WC_ACC 超 1500，触发瘦身"
```
## 你的身份

你是**回归测试工程师**——确认已知的修复没有回退，不是发现新问题。逐项核对，全 PASS 即通过。

**⏰ 时序**：回归检查在 releasing.md 阶段六跑，此时 git tag / npm registry 等还没到位——遇到这些检查项标 ⏳（待发版），不标 FAIL。

> **🔍 环境依赖标注（v1.1.6+）**：维度 5/7f/17a-b/20/22 依赖真实环境（npm/git/OpenClaw），AI 审查中标 `⏸️ 需人工环境`，人工审查时必跑。

## 审查步骤

**步骤 1：环境验证**
```bash
cd /Users/kongfangxun/Workbuddy/sofagent
bash tools/pre-push-check.sh                    # 期望：N/N 全绿
cd engine/audit && npm test && cd ../..        # 期望：全部 passed
node engine/core/dist/verify.js 2>&1 | tail -10  # 期望：无 FAIL
bash tools/check-docs.sh 2>&1 | tail -3 && bash tools/check-version.sh 2>&1 | tail -3
grep -rn '建议\|应该\|尽量' SKILL/harness/*.md FDE/SKILL.md | grep -v 'not_when\|Gotcha\|场景\|如果\|注\|说明'  # 期望：无输出
```

**步骤 2：Fresh clone 体验**
```bash
git clone https://github.com/KongFangXun/sofagent.git /tmp/sofagent-v1-test
cd /tmp/sofagent-v1-test && npm ci 2>&1 | tail -3 && bash tools/pre-push-check.sh 2>&1 | tail -5  # 期望：7/7 全绿
```

**步骤 3：逐维度审查**
## 审查维度（48 项 · 编号 1–48）

### 跨版本核心维度（每次必跑基线，不编号）

版本号全量一致 · 铁律措辞清零 · Skill 行数 ≤100 · 测试数一致（维度 13 SSOT 反查） · git status 零未提交修改

#### 1. CHANGELOG 纯度与完整性

```bash
# 子项 a: 纯度——不含审查元信息
grep -rniE "GLM|DeepSeek|双视角|P[012]×|审查修复|陌生视角|fresh-eyes|审查轮次|审查×|审查驱动|审查吸收" CHANGELOG.md docs/changelog/v*.md ROADMAP.md
# 期望：零命中

# 子项 b: 「回溯引擎」诚实化检查——后应跟"本质：git snapshot"或已改为「回溯能力」
grep -rn "回溯引擎" --include="*.md" . | grep -v node_modules | grep -v ".sofagent/" | grep -v "docs/changelog" | grep -v "CHANGELOG.md" | grep -v ".workbuddy/" | grep -v "regression-checklist.md" | grep -v "git snapshot\|revert 包装\|本质"
# 期望：零命中

# 子项 c: 孤儿 changelog 检测
for f in docs/changelog/v*.md; do v=$(basename $f .md); git rev-parse $v >/dev/null 2>&1 || echo "⚠️ $v: 无对应 tag"; done
git tag -l "v*" | while read t; do grep -q "$t" CHANGELOG.md || echo "❌ $t: CHANGELOG 索引遗漏"; done
# 期望：零输出

# 子项 d: CHANGELOG 索引含全部已发版 tag + 规划版独立分组
grep -A1 "## 规划中" CHANGELOG.md | head -1
# 期望：有「规划中」独立标题

# 子项 f: README 对核心文档链接可发现性（v1.1.6 教训）
grep -c "llm-wiki-mapping" README.md   # 期望: ≥ 1
```

#### 2. 跨文档死链全量扫描

```bash
# 子项 a: check-docs 全仓相对路径死链
bash tools/check-docs.sh 2>&1 | grep -i 'dead\|死链'   # 期望：0 处

# 子项 b: 文件/目录迁移——旧路径应 0 命中
git grep -n "OLD_RELATIVE_PATH" -- '*.md'

# 子项 c: 占位符死链豁免（v1.1.4 教训）
grep -n "vX\.Y\.Z\|<.*>\.md\|EXAMPLE.*\.md" LOOP/releaser/releasing.md docs/guides/*.md 2>/dev/null | head
# 人工检查：check-docs.sh 是否对占位符路径做豁免
```

#### 3. 文档规范源与归属一致性

```bash
# 子项 a: think.md 始终为 Ledger/source（非 Views/派生视图）
grep -rn "think.md.*Views\|think.md.*派生视图" docs/ARCHITECTURE.md docs/PHILOSOPHY.md docs/DEVELOPMENT.md FDE/FDE.md   # 期望：无匹配

# 子项 b: canonical source 一致性
grep -rn "Ledger-Views-Policy" docs/ARCHITECTURE.md docs/PHILOSOPHY.md docs/DEVELOPMENT.md | head   # 期望：各文档描述一致
```

#### 4. 审计规则分级与 ruleClass 一致性

```bash
# 子项 a-c: A4=业务底线 / 规则总数=21 / A6=能力拐杖 A11=业务底线
grep -A5 "'A4\|name.*不删配置" engine/audit/src/rules/index.ts | grep "ruleClass" | grep "业务底线"
grep "name:" engine/audit/src/rules/index.ts | wc -l   # 期望 21
grep "A6.*能力拐杖\|A11.*业务底线" engine/audit/README.md | wc -l   # 期望 2

# 子项 d: ruleClass SSOT ↔ README 逐行 diff（v1.1.3 盲区）
diff <(grep -E "name:|ruleClass:" engine/audit/src/rules/index.ts | paste - - | sort) \
     <(grep -oE "A[0-9]+ .*  \|  (业务底线|能力拐杖|工程规范)" engine/audit/README.md | sort)   # 零差异

# 子项 e-g: evidenceMode 计数 + README 表行数 + MCP 规则数（v1.1.4 教训）
echo "git-diff=$(grep -c "evidenceMode: 'git-diff'" engine/audit/src/rules/index.ts) hybrid=$(grep -c "evidenceMode: 'hybrid'" engine/audit/src/rules/index.ts) fs=$(grep -c "evidenceMode: 'filesystem'" engine/audit/src/rules/index.ts)"   # 人工核对 README
INDEX=$(grep -cE "name:\s*'A[0-9]|name:\s*'E[0-9]" engine/audit/src/rules/index.ts)
TABLE=$(grep -cE "^\| A[0-9]+ |^\| E[0-9]+ " engine/audit/README.md)
echo "index=$INDEX / README表=$TABLE（期望 TABLE≥INDEX）"   # v1.1.4：A18/A19 漏更新
grep "run_audit" engine/mcp/src/mcp-server.ts | grep -oE "[0-9]+ 条规则"   # MCP 数字一致
```

#### 5. 审计 exit code 与输出签名

```bash
# 子项 a: silent 模式 A1 FAIL → exit 2（⚠️ 需 ≥2 commits：先建正常 commit，再建违规 commit）
cd /tmp && rm -rf t && mkdir t && cd t && git init && git config user.email t@t.com && git config user.name t
echo "normal" > a.txt && git add a.txt && git commit -m "init normal commit"
echo "sk-abc123" > s.txt && git add s.txt && git commit -m "leak" --no-verify
sofagent-audit --diff HEAD~1..HEAD --silent >/dev/null 2>&1; echo "exit=$?"   # 期望: exit=2
cd /tmp && rm -rf t
# 子项 b: 签名行版本号非硬编码
grep -rn "v1\.1\.[0-9]" engine/audit/src/index.ts | grep -v "import\|from\|\/\/"   # 期望：零匹配
sofagent-audit --version 2>&1 | grep -q "sofagent" && echo "✅ 签名存在"
# 子项 c: webhook 签名半角冒号
grep -rn "sofagent.*全角\|sofagent：" engine/audit/src/ 2>/dev/null   # 期望：无匹配
```

#### 6. 版本号硬编码检测

```bash
SSOT_VER=$(node -e "console.log(require('./package.json').version)")

# 子项 a: 源码中无版本号硬编码
grep -rn "version\s*=\s*'[0-9]" engine/*/src/*.ts | grep -v __tests__ | grep -v shared/constants | grep -v node_modules   # 期望：零命中

# 子项 b: SECURITY.md 版本标注 = 当前版本
grep "当前状态（v${SSOT_VER}" SECURITY.md   # 期望：有匹配

# 子项 c: README 正文版本引用一致（v1.1.4 教训）
grep -oE "v1\.[0-9]+\.[0-9]+" README.md | sort | uniq -c   # 期望：只有一个版本号
grep -E "当前版本.*v[0-9]+\.[0-9]+\.[0-9]+\|当前版本（v[0-9]+\.[0-9]+\.[0-9]+）" README.md   # 期望：括号内 = SSOT_VER
```

#### 7. 感知层配置与推送链路

```bash
# 子项 a: 配置完整性
grep -A 2 "perception:" .sofagent/config.yml 2>/dev/null && echo "✅ 存在" || echo "❌ 缺少"
grep "enabled: true" .sofagent/config.yml 2>/dev/null && echo "✅ 已启用"

# 子项 b: 推送目标
grep "push_target:" .sofagent/config.yml | grep -q "webhook://" && echo "✅ 已配置"

# 子项 c: MCP 返回值签名（v1.1.3 追加——所有 sendToolResult text 必须带 [sofagent]）
grep -rn 'sendToolResult' engine/mcp/src/mcp-server.ts | head -5
# 人工检查：每个 sendToolResult 的 text 字段开头必须以 [sofagent] 或 sofagent 开头

# 子项 d: Webhook PASS 推送
grep -c "PASS" engine/audit/src/webhook.ts   # 应 > 0

# 子项 e: MCP capabilities 准确性（被 check-docs.sh §7 跨文档对照覆盖）

# 子项 f: CLI stdout 签名一致性（v1.1.4 教训——感知层废墟高发区）
node engine/audit/dist/index.js --version 2>&1 | grep -q "sofagent" && echo "✅ --version 签名存在"
grep -c "sofagent-audit.*v\|sofagent-audit ·" engine/audit/src/index.ts   # 期望：≥ 1
grep -c "审计引擎.*sofagent-audit\|审计引擎:.*sofagent" engine/audit/src/index.ts   # 期望：≥ 1
# 人工跑一次 --doctor 和 --init，确认输出开头带 sofagent
```

#### 8. acceptance-test 健壮性

```bash
# 子项 a: 管道 pipefail 保护
grep -n 'grep.*|.*head\|grep.*|.*wc' LOOP/releaser/acceptance-test.sh | grep -v '|| true'   # 期望：零命中

# 子项 b: 场景间清理
grep -c "git rm --cached -f .env" LOOP/releaser/acceptance-test.sh   # 期望：≥ 2

# 子项 c: --init 烟测期望值与实际对齐（v1.1.4 教训）
DEFAULT_COUNT=$(grep -cE "name:\s*'A[0-9]" engine/audit/src/rules/index.ts | head -1)
grep -nE "期望.*[0-9]+\s*项\|期望.*[0-9]+\s*条\|expected.*[0-9]+" LOOP/releaser/acceptance-test.sh | head
# 人工检查：acceptance-test 里所有"期望 N 项/条"的硬编码 N 是否与 index.ts 注册数一致

# 子项 d: check-version 文案扫描 baseline（v1.1.6 教训——工具自身 SSOT 标签误导）
EXPECTED_DEFAULT=$(awk '/export const defaultRules/{f=1; next} f && /^[[:space:]]*\{.*name:/{c++} f && /^[[:space:]]*\];/{exit} END{print c+0}' engine/audit/src/rules/index.ts)
REPORTED_DEFAULT=$(bash tools/check-version.sh 2>&1 | grep -oE "defaultRules.length=[0-9]+" | grep -oE "[0-9]+")
echo "期望=$EXPECTED_DEFAULT 报告=$REPORTED_DEFAULT"   # 期望：两者相等

# 子项 e: acceptance-test.sh JSON 输出不被 stderr 污染（v1.1.5 教训）
grep -E "\-\-json.*2>&1|2>&1.*\-\-json" LOOP/releaser/acceptance-test.sh   # 期望：零命中

# 子项 f: init.ts 禁止硬编码规则条数常量（v1.1.8 教训）
grep -nE "expectedDefaultRules\s*=\s*[0-9]+|expectedDefault\s*=\s*[0-9]+" engine/audit/src/commands/init.ts   # 期望：零命中
grep -c "defaultRules\.length\|defaultRules\[.length\]" engine/audit/src/commands/init.ts   # 期望：≥ 1
```

#### 9. 动态规则禁用逻辑 + 文档侧规则数声称一致性

> v1.1.5 扩展：覆盖**代码侧 + 文档侧**两个一致性面

```bash
SSOT_TOTAL=$(grep -cE "^\s*name:\s*'A[0-9]+" engine/audit/src/rules/index.ts)
SSOT_MAX=$(grep -oE "name:\s*'A[0-9]+" engine/audit/src/rules/index.ts | grep -oE "[0-9]+" | sort -n | tail -1)
echo "SSOT 规则总数: $SSOT_TOTAL / 最大编号: A$SSOT_MAX"

# 代码侧：knownKeys = index.ts 注册号（A16-A19 两组各验证）
grep -c "a1[6-9]" engine/core/src/config-loader.ts   # ≥4
INDEX_RULES=$(grep -oE "name:\s*'A[0-9]+" engine/audit/src/rules/index.ts | grep -oE "[0-9]+" | sort -n | tr '\n' ',')
KNOWN_KEYS=$(grep -A20 "knownKeys = new Set" engine/core/src/config-loader.ts | grep -oE "'a[0-9]+'" | tr -d "'a" | sort -n | tr '\n' ',')
echo "index.ts: $INDEX_RULES / knownKeys: $KNOWN_KEYS"   # 期望：两集合相等

# 文档侧：声称型数字（v1.1.5 教训——6 文档漏改）
grep -rnE "A1-A11、A14-A1[0-9]|[0-9]+ 条审计规则" --include="*.md" README.md README.en.md docs/ FDE/ LOOP/ ROADMAP.md 2>/dev/null | grep -v "regression-checklist\|fresh-eyes-review\|changelog/"   # 人工核对：与 SSOT 一致

# 字段完整性（v1.1.6：name+ruleClass 各 21 条=42）+ evidenceMode 计数（v1.1.4：期望 21）
grep -oE "name:|ruleClass:" engine/audit/src/rules/index.ts | wc -l   # 期望 42
grep -cE "evidenceMode:" engine/audit/src/rules/index.ts   # 期望 21
```

#### 10. tag commit message 规范

```bash
# 子项: changelog 规划中标注（v1.1.6 教训）
for f in docs/changelog/v*.md; do v=$(basename "$f" .md); git rev-parse "$v" >/dev/null 2>&1 || echo "⚠️ $v: 规划中"; done
# 期望：输出仅含未来版本
```

#### 11. 包依赖图循环检测

```bash
# 子项 a: audit↔daemon 循环依赖
AUDIT_OPT=$(node -e "const p=require('./engine/audit/package.json'); console.log(p.optionalDependencies?.['/daemon'] ? 'OPTIONAL_DAEMON' : 'NONE')")
DAEMON_DEP=$(node -e "const p=require('./engine/daemon/package.json'); console.log(p.dependencies?.['/audit'] ? 'DEP_AUDIT' : 'NONE')")
[ "$AUDIT_OPT" = "OPTIONAL_DAEMON" ] && [ "$DAEMON_DEP" = "DEP_AUDIT" ] && echo "⚠️ 循环依赖（已知债务）" || echo "✅ 无循环依赖"

# 子项 b: 循环依赖 + tag message 校验（被 pre-push-check.sh 步骤 7+8 全量覆盖）
```

#### 12. 跨包代码重复检测

```bash
dup=$(find sofagent -path '*/src/*.ts' -not -path '*/node_modules/*' -not -path '*/__tests__/*' -not -path '*/test*/*' \
  | sed 's#.*/##' | sort | uniq -d | grep -vE '^(index|cli|types|config-template|memory-sync|reporter|verify|skill-safety-.*)\.ts$')
[ -z "$dup" ] && echo "OK" || echo "❌ 跨包重复: $dup"
```

#### 13. 测试数声称一致性（SSOT 反查 · v1.1.9 扩）

> SSOT = vitest 实测（与 test-count.sh 同源）。v1.1.7 起有 `tools/check-test-count.sh` 一键校验。

```bash
bash tools/check-test-count.sh   # 一键校验 CHANGELOG/ROADMAP/LIMITATIONS/evidence.md 声称数 vs 实际值
# 如漂移：脚本指出文件+行号，手动改成实际值
# 也可单独跑：AUDIT=$(cd engine/audit && npx vitest run 2>&1 | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' | head -1)
# WS=$(bash tools/test-count.sh --quiet 2>&1 | grep -oE 'TOTAL_TESTS=[0-9]+' | cut -d= -f2)
# 逐文档核对（已 SSOT 化的跳过）：for f in engine/audit/README.md FDE/FDE.md LIMITATIONS.md docs/evidence/evidence.md; do ...
```

#### 14. enterprise-deploy 完整性

```bash
for section in "批量安装" "集中下发" "CI 集成" "已落地"; do
  grep -q "$section" docs/guides/enterprise-deploy.md && echo "✅ $section" || echo "❌ 缺失: $section"
done
grep "enterprise-deploy" SECURITY.md | head -1
test -f docs/guides/enterprise-deploy.md && echo "✅ 文件存在"
```

#### 15. Agent 身份感知有效性

```bash
grep -c "露个脸就够了" SKILL/harness/SKILL.md          # 期望：≥ 1
grep -c "质量搭档" SKILL/harness/engage.md              # 期望：≥ 1
grep -c "sofagent 已就绪" engine/scripts/lib/post-install.sh  # 期望：≥ 1
grep -c "Agent 身份感知" FDE/FDE.md                      # 期望：≥ 1
```

#### 16. 安全约束 fail-closed 与权限加固

```bash
# 子项 a: A15 actions 未声明时必须 FAIL（非 fail-open WARN）—— v1.1.7 二次验证确认已返回 FAIL，本项保留为回归锁
grep -n "nodesWithActions.length === 0\|nodesWithActions.length === 0" engine/audit/src/rules/rule-a15-action-constraint.ts
grep -A2 "nodesWithActions.length === 0" engine/audit/src/rules/rule-a15-action-constraint.ts | grep -c "FAIL"   # 期望：≥ 1

# 子项 b: .sofagent/ 子目录权限 700
ls -ld .sofagent .sofagent/audit .sofagent/task 2>/dev/null   # 期望：drwx------（700）

# 子项 c: A/B promote 守卫——overallImprovement > 0
grep -n "overallImprovement\|decidePromotion" engine/ab-test/src/*.ts 2>/dev/null
# 人工检查：decidePromotion() 必须有 overallImprovement > 0 守卫
```

#### 17. npm 产物 + bin 权限 + tag commit message

```bash
SSOT_VER=$(node -e "console.log(require('./engine/audit/package.json').version)")

# 子项 a: bin 文件执行权限
for pkg in audit core orchestrator daemon mcp; do
  bin=$(node -e "const p=require('./engine/$pkg/package.json'); console.log(Object.keys(p.bin||{}).map(k=>p.bin[k]).join(' '))" 2>/dev/null)
  for b in $bin; do [ -x "engine/$pkg/$b" ] || ls -la "engine/$pkg/$b" 2>/dev/null | grep -q '^-.x' || echo "❌ $pkg/$b 无执行权限"; done
done

# 子项 b: npm registry vs git tag vs 工作树三方一致
NPM_VER=$(npm view /audit version 2>/dev/null)
TAG_VER=$(git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//')
echo "npm=$NPM_VER ssot=$SSOT_VER tag=$TAG_VER"   # 期望：三者一致

# 子项 c: tag 指向的 commit message 含版本号（被 pre-push-check.sh 步骤 7 全量覆盖）

# 子项 d: 发版前工作树 clean
git diff --quiet || echo "⚠️ 工作树有未提交修改"

# 子项 e: 全量历史 tag commit message 含版本号（被 pre-push-check.sh 步骤 7 全量覆盖）
```

#### 18. A19 commit message 质量

```bash
F=engine/audit/src/rules/rule-a19-commit-msg-quality.ts
grep -c "MIN_LENGTH = 8" $F && grep -c "BLACKLIST" $F && grep "业务底线" $F   # 长度检查+黑名单+分级
grep "!commitMsg || !commitMsg.trim" $F   # 空 message 降级 PASS
grep "A19" engine/audit/src/rules/index.ts | head -1   # 在 defaultRules
grep -c "A19" engine/audit/src/rules/runner.ts   # critical 层阻断
```

#### 19. A18 垃圾文件检测

```bash
F=engine/audit/src/rules/rule-a18-junk-file.ts
grep -c "JUNK_PATTERNS" $F   # 3 组正则
grep -c "isExempt" $F   # 豁免规则
grep "\"WARN\"" $F   # 只产生 WARN
grep "A18" engine/audit/src/rules/runner.ts   # extended 优先级 A18 排在 A17 之后
```

#### 20. daemon plist + watch.yml 正确性

```bash
grep "sofagent-daemon" ~/Library/LaunchAgents/com.sofagent.daemon.plist   # ProgramArguments
grep "Workbuddy/sofagent" ~/Library/LaunchAgents/com.sofagent.daemon.plist   # WorkingDirectory
test -f .sofagent/watch.yml && grep "paths:" .sofagent/watch.yml   # --init 生成
! grep -q "不支持的参数.*--daemon" ~/.sofagent/daemon.log   # 无废弃参数
tail -20 ~/.sofagent/daemon.log | grep "监控目录"   # 监控目录正确
```

#### 21. LOOP 工具注入 + 硬约束

```bash
F=engine/orchestrator/src/loop/nodes.ts
grep "DEFAULT_ENGINEER_MAX_TURNS = 20\|DEFAULT_REVIEWER_MAX_TURNS = 15" $F   # maxTurns 常量
grep "ENGINEER_TOOLS\|REVIEWER_TOOLS" $F   # 工具注入
grep -c "recordLoopAuditHistory" $F   # WARN verdict 写入 audit history
grep "maxTurns: resolveMaxTurns" $F   # maxTurns 注入
grep -c "checkDangerousCommand" engine/orchestrator/src/tools.ts   # 高危命令黑名单
grep "break.*连续中断" engine/daemon/src/inspectors/warn-accumulator.ts   # warn-accumulator
grep "SOFAGENT_LABEL" engine/daemon/src/usb-detect.ts   # USB federation 基础检测
grep -c "createHmac\|timingSafeEqual\|applyFederation" engine/daemon/src/usb-detect.ts   # USB HMAC
grep -c "audit_file\|auditEngine" engine/mcp/src/mcp-server.ts   # MCP audit_file
grep -c "list_capabilities\|search_knowledge\|stats" engine/mcp/src/mcp-server.ts   # MCP capabilities
grep -c "webhook:dingtalk\|webhook:feishu\|webhook:wecom\|openclaw:im\|daemon:notice" engine/daemon/src/push-target.ts   # 5 种路由
grep "parseSubagentRunArgs\|--mode" engine/orchestrator/src/cli-args.ts   # --mode 参数
grep -l "sofagent-releaser" engine/scripts/lib/file-deploy.sh FDE/fde-install.sh LOOP/loop-install.sh 2>/dev/null | wc -l   # Skill 复制契约=3
```

## 审查约束（每次发版必验铁律）

版本号全量一致 · 铁律措辞清零 · Skill 行数 ≤100 · CHANGELOG 纯度 · 测试数一致 · 安全约束 fail-closed · npm 产物三方一致

#### 22. plist 不被外来 --init 覆盖

```bash
grep "Workbuddy/sofagent" ~/Library/LaunchAgents/com.sofagent.daemon.plist   # WorkingDirectory 指向当前项目
grep "sofagent-daemon" ~/Library/LaunchAgents/com.sofagent.daemon.plist   # ProgramArguments
launchctl list | grep sofagent | awk '{print $2}'   # 期望=0（daemon 正常运行）
# 跑完 acceptance-test.sh 后重复上述检查，确认 plist 未被污染
```

#### 23. FDE/LOOP 跨产品声称一致性

> v1.1.4 暴露：FDE/LOOP 声称"独立产品"，但文档里步数、Agent 数、CLI 子命令存在矛盾

```bash
SSOT_VER=$(node -e "console.log(require('./package.json').version)")

# 子项 a: FDE 步数跨文档一致（v1.1.4 已修复，固化防回退）
grep -oE "[0-9]+ 个阶段|[0-9]+ 个关键步骤|[0-9]+ 步" FDE/SKILL.md FDE/README.md FDE/FDE.md 2>/dev/null | sort | uniq -c   # 期望：一致

# 子项 b: LOOP Agent 数跨文档一致（v1.1.4 暴露）
ACTUAL_AGENTS=$(ls agents/SKILL/sofagent-* -d 2>/dev/null | wc -l); echo "实际安装 Agent 数: $ACTUAL_AGENTS"
grep -oE "[0-9]+ 个内置 Agent\|[0-9]+ 个 Agent" LOOP/SKILL.md LOOP/README.md LOOP/quick-start.md 2>/dev/null   # 人工核对一致

# 子项 c: 跨产品 install.sh 契约稳定性（v1.1.4 暴露——无契约文档）
grep -n "install.sh\|PROJECT_ROOT.*install.sh" FDE/fde-install.sh LOOP/loop-install.sh
# 人工检查：接口（路径/参数/退出码）有无契约文档或 pin commit

# 子项 d: 独立 install 闭环（v1.1.4 暴露——只 clone FDE/ 子目录能否跑通）
FDE_DEP=$(grep -c "install.sh" FDE/fde-install.sh 2>/dev/null || echo 0)
LOOP_DEP=$(grep -c "install.sh" LOOP/loop-install.sh 2>/dev/null || echo 0)
echo "FDE 依赖主 install.sh: $FDE_DEP / LOOP 依赖: $LOOP_DEP"
CLONE_NOTE=$(grep -rliE "完整 clone|完整仓库|需要.*sofagent.*仓库|clone.*完整" FDE/README.md FDE/SKILL.md LOOP/README.md 2>/dev/null | head -1 || true)
[ -n "$CLONE_NOTE" ] && echo "✅ 文档已标注完整 clone 要求" || echo "⚠️ 未找到标注"
grep -q "被 FDE/LOOP 依赖\|FDE/LOOP" install.sh 2>/dev/null && echo "✅ 主 install.sh 已标注" || echo "⚠️ 未标注"

# 子项 e: install 脚本版本号 = SSOT（v1.1.4 暴露——loop-install.sh 版本号漂移）
grep -H "v[0-9]\+\.[0-9]\+\.[0-9]\+" FDE/fde-install.sh LOOP/loop-install.sh | head -4   # 期望：所有版本号 = SSOT_VER
```

#### 24. acceptance-test.sh 与 changelog 功能对齐（单文件）

> v1.1.5 更新：原 `docs/verification/openclaw-acceptance-test.md` 已合并入 `LOOP/releaser/acceptance-test.sh`

```bash
# 子项 a: 场景数声称与实际对齐（v1.1.4 教训）
DECLARED_COUNT=$(head -5 LOOP/releaser/acceptance-test.sh | grep -oE "[0-9]+ 个端到端" | grep -oE "[0-9]+")
ACTUAL_COUNT=$(grep -c "^scenario " LOOP/releaser/acceptance-test.sh)
echo "声明: $DECLARED_COUNT / 实际: $ACTUAL_COUNT"   # 期望：两者相等

# 子项 b: 本版本 changelog 功能点逐条对照 acceptance-test 覆盖
# 🔴 v1.1.7 教训：阶段三必须同步跑此检查，不能只更新场景数就跳过
CHANGELOG_FEATURES=$(grep -E "^### |^## 交付" docs/changelog/v$(node -e "console.log(require('./package.json').version)").md | head -20)
echo "$CHANGELOG_FEATURES"   # 人工检查：每个功能点在 acceptance-test.sh 里都有对应场景

# 子项 c-e: 失效场景清理 / 场景间清理 / JSON stderr 隔离（已归并至维度 8 统一管理）
```
#### 25. conflict-check 巡检器只读铁律 + schedule 正确性（v1.1.6 新增）

```bash
# 子项 a: fail-closed 只读——源码零写操作（排除注释）
grep -n "writeFile\|writeFileSync\|unlink\|rmSync" engine/daemon/src/inspectors/conflict-check.ts | grep -v "^.*\/\/"   # 期望：零命中

# 子项 b: schedule = @weekly（非 @daily）
grep -A1 "'conflict-check'" engine/daemon/src/inspectors/index.ts | grep -c "@weekly"   # 期望：≥1

# 子项 c: runInspectors 调用链包含 conflict-check
grep -c "checkConflict\|conflict-check" engine/daemon/src/inspectors/index.ts   # 期望：≥3

# 子项 d: 空 knowledge 目录优雅降级
node -e "
const {checkConflict} = require('./engine/daemon/dist/inspectors/conflict-check.js');
const r = checkConflict(process.cwd());
if (r.triggered) throw new Error('Expected triggered:false');
if (r.severity !== 'info') throw new Error('Expected info');
console.log('OK');"   # 期望：OK
```

#### 26. llm-wiki-mapping.md 存在 + 内容完整性（v1.1.6 新增）

```bash
# 子项 a: 文档存在
[ -f docs/llm-wiki-mapping.md ] && echo "EXISTS" || echo "MISSING"

# 子项 b: 三层映射齐全
grep -c "Ledger\|Views\|Policy" docs/llm-wiki-mapping.md   # ≥3

# 子项 c: 数据流图存在（mermaid）
grep -c "mermaid\|flowchart" docs/llm-wiki-mapping.md   # ≥1

# 子项 d: ROADMAP v1.1.6 行链接到文档
grep -c "llm-wiki-mapping.md" ROADMAP.md   # ≥1

# 子项 e: 文档不重新定义三层（引用 PHILOSOPHY §五 为权威源）
grep -c "唯一权威\|不重新定义\|PHILOSOPHY.md.*§五" docs/llm-wiki-mapping.md   # ≥1
```
#### 27. pre-push-check shellcheck 扫描范围与 CI 一致性（v1.1.6 新增）

> v1.1.6 教训：LOOP/ 有 .sh 但 shellcheck find 只扫了 engine/scripts tools FDE

```bash
FIND_LINE=$(grep "find.*\.sh" tools/pre-push-check.sh); echo "当前扫描范围: $FIND_LINE"
echo "$FIND_LINE" | grep -q "LOOP" && echo "LOOP 已纳入扫描" || echo "❌ LOOP 漏扫"
[ -f .github/workflows/shellcheck.yml ] && echo "CI 配置存在" || echo "❌ CI 配置缺失"
SC_VER=$(shellcheck --version 2>/dev/null | grep -oE "[0-9]+\.[0-9]+\.[0-9]+" | head -1)
if [ -n "$SC_VER" ]; then
  major=$(echo "$SC_VER" | cut -d. -f1); minor=$(echo "$SC_VER" | cut -d. -f2)
  if [ "$major" -eq 0 ] && [ "$minor" -lt 11 ] 2>/dev/null; then echo "⚠️  shellcheck $SC_VER < 0.11.0"
  else echo "✅ shellcheck $SC_VER ≥ 0.11.0"; fi
fi
```
#### 28. Skill 元数据完整性（v1.1.6 新增）

> SKILL.md 若缺必需字段，Agent 可能无法自动加载

```bash
for f in agents/SKILL/*/SKILL.md FDE/SKILL.md LOOP/SKILL.md SKILL/harness/SKILL.md; do
  [ -f "$f" ] || continue
  miss=$(grep -cE "name:|slug:|displayName:|description:|version:|tags:|image:|triggers:|scenarios:|not_when:" "$f")
  echo "$f: 命中必需字段 $miss/9"
done   # 期望：每个 SKILL.md 命中 9 个必需字段
```
#### 29. Dream Cycle 管道完整性 + 只读铁律（v1.1.7 新增 · 交付一）

> Dream Cycle 是 v1.1.7 知识生成管道的核心——6 阶段缺一不可，think.md（Ledger）必须只读

```bash
# 子项 a: 6 阶段文件全部存在
for stage in extract-facts extract-atoms cluster-patterns synthesize-concepts skillopt-backfill embed; do
  test -f "engine/daemon/src/dream-cycle/${stage}.ts" && echo "✅ ${stage}.ts" || echo "❌ 缺失: ${stage}.ts"
done

# 子项 b: 状态机存在且有断点续跑逻辑
grep -c "DREAM_CYCLE_STAGES\|fromStage\|loadState\|saveState" engine/daemon/src/dream-cycle/state-machine.ts   # ≥4

# 子项 c: dream-cycle 源码对 think.md 只读（排除注释行 + state-machine 写 state.md/log.md + synthesize-concepts 写 entities/ 产物落盘）
grep -n "writeFile\|writeFileSync\|unlink\|rmSync" engine/daemon/src/dream-cycle/*.ts | grep -v "__tests__\|llm-mock\|state-machine\|synthesize-concepts" | grep -v "^.*/\/"
# 期望：零命中（synthesize-concepts 的 writeFileSync 是概念实体产物落盘，非 think.md 写入）

# 子项 d: 旧脚本 weekly-report / lessons-extract 引用清零
grep -rn "weekly-report\|lessons-extract" --include="*.ts" engine/daemon/src/ | grep -v node_modules | grep -v "memory-contract.ts" | grep -v "\.test\.\|__tests__"   # 期望：零命中

# 子项 e: 6 阶段定义与 types.ts 一致
grep -c "extract_facts\|extract_atoms\|cluster_patterns\|synthesize_concepts\|skillopt_backfill\|embed" engine/daemon/src/dream-cycle/types.ts   # ≥6
```
#### 30. sensitivity frontmatter + 联邦过滤（v1.1.7 新增 · 交付二）

> 缺省必须 internal，restricted 绝不默认

```bash
# 子项 a: core/src/ 有 sensitivity 三值定义
grep -c "'public'\|'internal'\|'restricted'" engine/core/src/memory-contract.ts   # ≥3

# 子项 b: 缺省级别 = internal（safe-by-default）
grep "DEFAULT_SENSITIVITY.*=.*'internal'" engine/core/src/memory-contract.ts   # 期望：有匹配

# 子项 c: resolveSensitivity 非法值回落 internal
grep -c "return DEFAULT_SENSITIVITY" engine/core/src/memory-contract.ts   # ≥2

# 子项 d: isSensitivityVisible 实现 restricted 不泄露
grep -c "SENSITIVITY_ORDER\|isSensitivityVisible" engine/core/src/memory-contract.ts   # ≥2

# 子项 e: 测试覆盖联邦过滤
grep -c "sensitivity\|restricted\|internal" engine/core/src/__tests__/memory-contract-sensitivity.test.ts   # ≥3
```
#### 31. knowledge-health inspector 注册 + 五项检查 + 只读（v1.1.7 新增 · 交付三）

> knowledge-health 巡检器必须注册为 @weekly，执行五项检查，且自身零写操作（除 health-report.md + index.md 自动修复）

```bash
# 子项 a: 注册在 inspectors/index.ts 且 schedule = @weekly
grep "'knowledge-health'" engine/daemon/src/inspectors/index.ts | grep "@weekly"   # 期望：有匹配

# 子项 b: 5 项检查关键词全在源码
grep -c "孤立\|重复\|断链\|index 过旧\|缺源" engine/daemon/src/inspectors/knowledge-health.ts   # ≥5

# 子项 c: knowledge-health.ts 无写操作（只读铁律，排除 health-report + index.md 断链修复/索引重建）
grep -n "writeFile\|writeFileSync\|unlink\|rmSync" engine/daemon/src/inspectors/knowledge-health.ts | grep -v "health-report\|writeReport\|saveReport\|appendReport\|indexPath\|generateIndexMarkdown\|^29:import"   # 期望：零命中

# 子项 d: 测试用例 ≥8
grep -c "  it(" engine/daemon/src/inspectors/__tests__/knowledge-health.test.ts   # ≥8

# 子项 e: health-report.md 是巡检产物（LUI A 可感知）
grep -c "health-report" engine/daemon/src/inspectors/knowledge-health.ts   # ≥1
```
#### 32. `sofagent knowledge status` 聚合命令 + restricted 不泄露（v1.1.7 新增 · 交付四）

> 聚合命令自身必须只读，且不泄露 restricted 条目

```bash
# 子项 a: 命令文件存在
test -f engine/daemon/src/commands/knowledge-status.ts && echo "✅ 存在" || echo "❌ 缺失"

# 子项 b: 命令在 daemon CLI 中可发现
grep -c "knowledge.status\|knowledge-status\|knowledgeStatus" engine/daemon/src/cli.ts engine/daemon/src/index.ts 2>/dev/null   # ≥1

# 子项 c: commands/knowledge-status.ts 无写操作（只读聚合）
grep -n "writeFile\|writeFileSync\|unlink\|rmSync" engine/daemon/src/commands/knowledge-status.ts   # 期望：零命中

# 子项 d: 测试用例 ≥4
grep -c "  it(" engine/daemon/src/commands/__tests__/knowledge-status.test.ts   # ≥4

# 子项 e: 输出含受限条目不泄露提示（sensitivity 集成）
grep -c "restricted\|sensitivity\|隐藏\|不可见" engine/daemon/src/commands/knowledge-status.ts   # ≥1
```
#### 33. ActionGovernance schema 完整性 + 向后兼容（v1.1.7 新增 · 交付六）

> ActionGovernance 让审计记录从"结果"升级为"可问责的动作凭证"

```bash
# 子项 a: types.ts 有 ActionGovernance 接口 + 5 字段
grep -A15 "export interface ActionGovernance" engine/audit/src/rules/types.ts | grep -c "actor\|timestamp\|targetEntity\|beforeAfter\|context\|decisionProvenance"   # ≥5

# 子项 b: DecisionProvenance 决策溯源组存在
grep "export interface DecisionProvenance" engine/audit/src/rules/types.ts   # 期望：有匹配

# 子项 c: audit-history.ts 有 actionGovernance 字段写入
grep -c "actionGovernance" engine/audit/src/audit-history.ts   # ≥1

# 子项 d: index.ts 实际写入 actionGovernance
grep -c "actionGovernance" engine/audit/src/index.ts   # ≥1

# 子项 e: 旧格式向后兼容测试（无 actionGovernance 的旧记录可加载）
grep -c "向后兼容\|undefined\|actionGovernance" engine/audit/src/audit-history.test.ts   # ≥3

# 子项 f: audit-history 测试用例数（测试数声称已被维度 13 SSOT 反查覆盖，此处只验证结构）
grep -c "  it(" engine/audit/src/audit-history.test.ts   # ≥11
```
#### 34. 文档头日期一致性扫描门禁（v1.1.7 新增 · BugFix 1）

> bump-version.sh 只改版本号不改日期——文档头日期反复漂移

```bash
# 子项 a: check-version.sh 有第 14 项日期扫描
grep -c "14\.\|日期一致性扫描\|文档头日期" tools/check-version.sh   # ≥1

# 子项 b: 扫描以发版日期为基准
grep -c "EXPECTED_DOC_DATE\|发版日期" tools/check-version.sh   # ≥2

# 子项 c: 跑 check-version 全绿（含第 14 项）
bash tools/check-version.sh 2>&1 | tail -5   # 期望：全部通过

# 子项 d: 文档头日期格式统一（> vX.Y · YYYY-MM-DD）
grep -rn "^> v[0-9]\+\.[0-9]\+\.[0-9]\+ · [0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}" --include="*.md" README.md SECURITY.md LIMITATIONS.md docs/*.md 2>/dev/null | head -5   # 期望：格式一致
```
#### 35. 文档数字 SSOT 一致性（v1.1.7 新增 · BugFix 5+7+8+10）

> 模糊数字（"700+"）和漂移数字都是 P0

```bash
# 子项 a: README 无模糊数字（700+ 等区间声称）
grep -n "[0-9]\++\|700+" README.md 2>/dev/null   # 期望：零命中

# 子项 b: test-count.sh 实测与文档声称比对
ACTUAL=$(bash tools/test-count.sh --quiet 2>&1 | grep -oE 'TOTAL_TESTS=[0-9]+' | cut -d= -f2)
echo "实测 workspace 测试数: $ACTUAL"   # 人工检查：FDE/FDE.md / LIMITATIONS.md 一致

# 子项 c: 三产品关系表述一致
grep -c "独立产品\|按需选用\|独立安装" README.md FDE/README.md LOOP/README.md 2>/dev/null   # 每个文档 ≥1

# 子项 d: README 使用精确数字（非模糊区间）
grep -oE "[0-9]+ 条规则\|[0-9]+ 条审计规则\|[0-9]+ 条 git-diff" README.md | head -5   # 期望：只有精确数字
```
#### 36. 跨产品 install 契约 CI 验证（v1.1.7 新增 · BugFix 11）

> FDE/LOOP 调用主 install.sh 的接口是跨产品契约——CI 应有专门 job 验证

```bash
# 子项 a: CI 有 cross-product-contract job
grep -c "cross-product-contract\|cross_product_contract" .github/workflows/*.yml 2>/dev/null   # ≥1

# 子项 b: FDE install.sh 引用主 install.sh
grep -c "install.sh" FDE/fde-install.sh 2>/dev/null   # ≥1

# 子项 c: LOOP install.sh 引用主 install.sh
grep -c "install.sh" LOOP/loop-install.sh 2>/dev/null   # ≥1

# 子项 d: 主 install.sh 标注被 FDE/LOOP 依赖
grep -c "FDE/LOOP\|被.*依赖\|跨产品" install.sh 2>/dev/null   # ≥1
```
#### 37. red-team 回归锁完整性（v1.1.7 新增 · BugFix 12）

> acceptance-test.sh 的 red-team 场景是安全基线

```bash
# 子项 a: A9 全角/leet 注入检测场景存在
grep -c "全角\|leet\|unicode" LOOP/releaser/acceptance-test.sh   # ≥3

# 子项 b: history.jsonl 篡改检测场景存在
grep -c "篡改\|tamper\|CHAIN_BREAK\|hash chain" LOOP/releaser/acceptance-test.sh   # ≥2

# 子项 c: hook 删除检测场景存在
grep -c "hook.*删除\|hook.*丢失\|删除.*hook" LOOP/releaser/acceptance-test.sh   # ≥1

# 子项 d: 非法 YAML → ConfigParseError 场景存在
grep -c "ConfigParseError\|非法.*YAML\|非法 YAML" LOOP/releaser/acceptance-test.sh   # ≥2

# 子项 e: 非 git 目录场景存在
grep -c "非.*git.*目录\|not.*a.*git.*repo\|非 git" LOOP/releaser/acceptance-test.sh   # ≥1

# 子项 f: 场景数声称 = 实际（归并至维度 24 子项 a 统一检查）
```
#### 38. daemon 审计集中收集 workaround + 安全文档时效性（v1.1.7 新增 · BugFix 9+13）

> SECURITY.md 必须诚实标注 daemon 审计推送的现状

```bash
SSOT_VER=$(node -e "console.log(require('./package.json').version)")

# 子项 a: SECURITY.md 有 filebeat/logstash workaround
grep -c "filebeat\|logstash" SECURITY.md   # ≥1

# 子项 b: Webhook 推送标企业采购阻塞（v1.2.x 才就绪）
grep -c "v1.2.x\|不推送\|企业.*阻塞\|待落地" SECURITY.md   # ≥1

# 子项 c: USB federation 标注 v1.1.6 当前状态（HMAC 签名已有）
grep -c "v1.1.6\|HMAC\|签名校验" SECURITY.md   # ≥2

# 子项 d: daemon 审计结果推送现状标注
grep -c "daemon.*审计.*推送\|仅本地\|daemon-notice" SECURITY.md   # ≥1

# 子项 e: SECURITY.md 版本标注与 SSOT 一致
grep "当前状态（v${SSOT_VER}" SECURITY.md   # 期望：有匹配

# 子项 f: SECURITY.md 覆盖本版本引入的数据处理/安全语义新能力（v1.1.8 教训）
SECURITY_REQUIRED_FEATURES=("Dream Cycle" "sensitivity" "ActionGovernance")
for feat in "${SECURITY_REQUIRED_FEATURES[@]}"; do
  count=$(grep -ci "$feat" SECURITY.md)
  [ "$count" -ge 1 ] && echo "✅ SECURITY.md 覆盖 '$feat'" || echo "❌ SECURITY.md 缺 '$feat' 安全声明"
done
```

#### 39. AES-256-GCM 加密 + ECDH 配对（v1.1.8 新增 · 交付一）

**背景**：联邦查询第 3 层防线——应用层加密。channel 明文无 TLS，AES-256-GCM 是唯一保密层。ECDH 协商密钥，人不手打。

```bash
# 子项 a: AES-256-GCM 加解密往返
grep -c "encryptPayload\|decryptPayload\|GCM_IV_BYTES" engine/core/src/crypto/aes-gcm.ts   # ≥3

# 子项 b: ECDH 密钥协商——双方独立 derive 出相同 key
grep -c "generateKeyPair\|deriveSharedKey\|prime256v1" engine/core/src/crypto/ecdh.ts   # ≥3

# 子项 c: 三配对路径（code/token/federation-file）+ 密钥轮换
grep -c "pairByCode\|pairByToken\|pairByFederationFile\|rotateKey" engine/core/src/crypto/pairing.ts engine/core/src/crypto/key-rotation.ts   # ≥3

# 子项 d: 密钥只存内存，不落盘明文（安全红线）
grep -r "sharedKey.*Buffer\|只存内存\|不落盘" engine/core/src/crypto/*.ts   # ≥1

# 子项 e: 验收场景覆盖（acceptance-test 场景 101-102）
grep -c "AES-256-GCM\|ECDH.*配对\|pairByToken" LOOP/releaser/acceptance-test.sh   # ≥3
```

#### 40. OpenClaw channel 联邦查询（v1.1.8 新增 · 交付二）

**背景**：两台设备互相 search_knowledge。Automerge CRDT 合并不手写三路（v1.0.5 教训）。离线降级不阻塞。

```bash
# 子项 a: federation 模块完整性（6 文件）
ls engine/daemon/src/federation/{channel,index,merge,offline-fallback,peers,query-router}.ts   # 全部存在

# 子项 b: 并发 fetch + 单 peer 超时（5s）
grep -c "PEER_QUERY_TIMEOUT_MS\|broadcastQuery" engine/daemon/src/federation/query-router.ts   # ≥2

# 子项 c: Automerge CRDTD 合并（不手写三路）
grep -c "automerge\|Automerge\|CRDT" engine/daemon/src/federation/merge.ts   # ≥1

# 子项 d: sensitivity 双重过滤（peer 端 + 本地端）
grep -c "isSensitivityVisible\|restricted.*不泄露\|sensitivity.*过滤" engine/daemon/src/federation/query-router.ts   # ≥1

# 子项 e: 离线降级不阻塞主流程
grep -c "offline\|fallback\|降级" engine/daemon/src/federation/offline-fallback.ts   # ≥1

# 子项 f: 验收场景覆盖（acceptance-test 场景 103）
grep -c "联邦.*sensitivity\|federation\|broadcastQuery" LOOP/releaser/acceptance-test.sh   # ≥2
```

#### 41. Prompt 注入 8 层防护（层 1 + 层 4 + 层 5）（v1.1.8 新增 · 交付三）

**背景**：8 层防护体系中的三层实现——外部内容标签包裹（层1）+ prompt 级脱敏（层4）+ 知识可信分级（层5）。memory-contract trust 字段联动。

```bash
# 子项 a: 层 1 wrapUntrusted + 防标签逃逸
grep -c "wrapUntrusted\|needsUntrustedWrap\|untrusted" engine/core/src/security/prompt-sanitizer.ts   # ≥3

# 子项 b: 层 4 redactForPrompt 脱敏规则库（sk- / AKIA / 手机号 / 邮箱）
grep -c "redactForPrompt\|REDACT_RULES\|RESTRICTED_PLACEHOLDER" engine/core/src/security/prompt-sanitizer.ts   # ≥2

# 子项 c: 层 5 trust 分级——web+restricted 组合丢弃（安全红线）
grep -c "isTrustEntryUsable\|sortByTrust\|web.*restricted" engine/core/src/security/trust-grading.ts   # ≥3

# 子项 d: memory-contract trust 字段（official > internal > user > web）
grep -c "TRUST_ORDER\|trust.*Trust\|official.*internal" engine/core/src/memory-contract.ts   # ≥1

# 子项 e: 验收场景覆盖（acceptance-test 场景 104-105）
grep -c "wrapUntrusted\|redactForPrompt\|trust.*分级\|isTrustEntryUsable" LOOP/releaser/acceptance-test.sh   # ≥4
```

#### 42. 编排引擎 dag-runner + compose --run（v1.1.8 新增 · 交付四）

**背景**：v1.0.7 退役 ao 时没接入 deepagents subagents 调度，compose 只打印不执行。v1.1.8 补上——compose --run 真正委派 Sub Agent。同文件冲突检测 WARN（裁决 #1）。

```bash
# 子项 a: dag-runner 核心函数
grep -c "runDAG\|detectFileConflicts\|ORCHESTRATOR_PROMPT" engine/orchestrator/src/dag-runner.ts   # ≥3

# 子项 b: workflow-parser（YAML → SubAgent 映射）
grep -c "parseWorkflowYaml\|toSubAgentConfigs\|ParsedWorkflow" engine/orchestrator/src/workflow-parser.ts   # ≥2

# 子项 c: compose --run + enterprise-workflow 参数
grep -c "\-\-run\|enterpriseWorkflow\|composeWithDeepAgents" engine/orchestrator/src/composer.ts   # ≥2

# 子项 d: A/B variants（一次生成多种拆解策略）
grep -c "variants\|variant\|VARIANT" engine/orchestrator/src/composer.ts   # ≥2

# 子项 e: SubAgent 四层约束注入
grep -c "buildConstrainedSystemPrompt\|约束.*加载链" engine/orchestrator/src/dag-runner.ts   # ≥1

# 子项 f: 验收场景覆盖（acceptance-test 场景 106）
grep -c "dag-runner\|detectFileConflicts\|compose.*DAG" LOOP/releaser/acceptance-test.sh   # ≥2
```

#### 43. pushKnowledgeSummary 主动通知（v1.1.8 新增 · 交付五）

**背景**：Dream Cycle / knowledge-health 跑完后主动推送摘要，无需用户主动 status。通知内容按 sensitivity 过滤，restricted 不出现。

```bash
# 子项 a: notify 模块核心函数
grep -c "pushKnowledgeSummary\|collectSummaryMaterial\|buildSummary" engine/daemon/src/notify.ts   # ≥3

# 子项 b: 两触发源接通（dream-cycle + knowledge-health）
grep -rn "pushKnowledgeSummary" engine/daemon/src/dream-cycle/state-machine.ts engine/daemon/src/inspectors/knowledge-health.ts   # 各 ≥1

# 子项 c: 通知内容 sensitivity 过滤
grep -c "sensitivity\|restricted\|NO_DATA_TEXT" engine/daemon/src/notify.ts   # ≥2

# 子项 d: best-effort 降级（通知失败不影响主流程）
grep -c "best-effort\|catch\|不影响主流程\|void pushKnowledgeSummary" engine/daemon/src/notify.ts   # ≥1

# 子项 e: 验收场景覆盖（acceptance-test 场景 107）
grep -c "pushKnowledgeSummary\|collectSummaryMaterial" LOOP/releaser/acceptance-test.sh   # ≥2
```

#### 44. USB 完整运行时——HMAC 签名 + AES-256 加密 + fail-closed 验签（v1.1.9 新增 · 交付一）

**背景**：U 盘便携运行时——全量文件 HMAC-SHA256 签名（确定性算法跨平台可复算），验签 fail-closed（篡改/缺失/多余/签名缺失四场景），knowledge/ AES-256-GCM 密文落盘（U 盘文件系统永为密文）。

```bash
# 子项 a: 签名模块核心函数
grep -c "collectFiles\|computeUsbSignature\|writeSignatureManifest\|verifyUsbSignature" engine/daemon/src/usb-signature.ts   # ≥4

# 子项 b: 确定性算法要素（POSIX 归一化 + 字典序 + timingSafeEqual）
grep -c "normalizePath\|sort.*relativePath\|timingSafeEqual" engine/daemon/src/usb-signature.ts   # ≥3

# 子项 c: verifyUsbSignature fail-closed 四 reason
grep -c "signature-missing\|signature-mismatch\|file-missing\|file-added" engine/daemon/src/usb-signature.ts   # ≥4

# 子项 d: AES-256-GCM 密文落盘（.enc 不含明文）
grep -c "encryptKnowledgeFile\|ENC_FRAME_MAGIC\|AES_KEY_BYTES" engine/daemon/src/usb-key.ts   # ≥3

# 子项 e: USB 运行时验签 + 内存解密 + 退出清密钥
grep -c "startUsbRuntime\|verifyUsbSignature\|decryptKnowledgeToMemory\|cleanupMemoryKeys\|setupPortableEnv" engine/daemon/src/usb-runtime.ts   # ≥5

# 子项 f: CLI 接入（create-usb-key + --usb-root）
grep -c "create-usb-key\|usb-root\|createUsbKey\|startUsbRuntime" engine/daemon/src/cli.ts   # ≥4

# 子项 g: 三平台启动脚本存在 + 可执行位
test -x engine/daemon/usb/start.command && test -x engine/daemon/usb/start.sh && test -f engine/daemon/usb/start.bat   # 全部通过

# 子项 h: 验收场景覆盖（acceptance-test 场景 108-113）
grep -c "usb-signature\|usb-key\|createUsbKey\|verifyUsbSignature" LOOP/releaser/acceptance-test.sh   # ≥4
```

#### 45. daemon A/B 自动调度器——四阶段状态机 + jsonl 持久化（v1.1.9 新增 · 交付二）

**背景**：真实任务探索-利用状态机（exploit→explore→judge→promote），跑企业真实日常任务而非专为 A/B 造的测试任务，连续胜出达阈值后自动 promote 并联动控制图状态落盘。

```bash
# 子项 a: 状态机核心函数
grep -c "initialState\|checkThreshold\|startExploration\|judgeAndPromote\|runABScheduledTask" engine/orchestrator/src/ab-scheduler.ts   # ≥5

# 子项 b: 四阶段定义（exploit/explore/judge/idle）
grep -c "'exploit'\|'explore'\|'judge'\|'idle'" engine/orchestrator/src/ab-scheduler.ts   # ≥4

# 子项 c: promote 阈值常量（CONSECUTIVE_WINS_REQUIRED=2）
grep -c "DEFAULT_PROMOTE_THRESHOLD\|promoteThreshold" engine/orchestrator/src/ab-scheduler.ts   # ≥2

# 子项 d: jsonl 持久化 + 滑窗聚合
grep -c "appendMetrics\|aggregateRecent\|truncateToLastK\|HISTORY_MAX_ENTRIES" engine/orchestrator/src/ab-history.ts   # ≥4

# 子项 e: daemon cron ab-schedule 分支
grep -c "ab-schedule\|runABScheduledTask" engine/daemon/src/cron.ts   # ≥2

# 子项 f: 依赖注入可测试性
grep -c "executePlan\|writeGraphState\|ABSchedulerDeps" engine/orchestrator/src/ab-scheduler.ts   # ≥3

# 子项 g: 验收场景覆盖（acceptance-test 场景 114-117）
grep -c "ab-scheduler\|ab-history\|judgeAndPromote\|ab-schedule" LOOP/releaser/acceptance-test.sh   # ≥4
```

#### 46. 控制图状态抽取 + 路径穿越安全防护（v1.1.9 新增 · 交付三）

**背景**：checkpoint → 可读 ControlGraphState JSON（带 version:'v1' schema），供 v1.2.x Dashboard 消费。loopId 消毒防路径穿越（QA 红队 POC-6 修复），ab-scheduler promote 后联动落盘。

```bash
# 子项 a: 抽取核心函数
grep -c "extractControlGraphState\|writeControlGraphState\|CONTROL_GRAPH_SCHEMA_VERSION" engine/orchestrator/src/loop-state-extractor.ts   # ≥3

# 子项 b: schema 版本 v1
grep "CONTROL_GRAPH_SCHEMA_VERSION = 'v1'" engine/orchestrator/src/loop-state-extractor.ts   # 命中

# 子项 c: sanitizeLoopId 消毒（[^a-zA-Z0-9_\-]→_ + 碰撞消除 8 位哈希后缀）
grep -c "sanitizeLoopId\|createHash.*sha256.*slice.*0.*8\|sanitized.*===.*loopId" engine/orchestrator/src/loop-state-extractor.ts   # ≥2

# 子项 d: assertWithinDir 路径穿越断言（resolve.startsWith 双重防护）
grep -c "assertWithinDir\|resolved.*startsWith\|路径穿越" engine/orchestrator/src/loop-state-extractor.ts   # ≥3

# 子项 e: ab-scheduler promote 联动 writeControlGraphState
grep -c "writeControlGraphState\|writeGraphState" engine/orchestrator/src/ab-scheduler.ts   # ≥2

# 子项 f: 波次拆分 + 节点状态映射 + 证据链
grep -c "splitWaves\|mapNodeStates\|buildEvidenceChain" engine/orchestrator/src/loop-state-extractor.ts   # ≥3

# 子项 g: 验收场景覆盖（acceptance-test 场景 118-119）
grep -c "extractControlGraphState\|sanitizeLoopId\|路径穿越" LOOP/releaser/acceptance-test.sh   # ≥3
```

#### 47. 产品叙事收敛红线 + BugFix 42 项核心回归锁（v1.1.9 新增 · 交付四+五）

**背景**：README 首屏叙事收敛（FDE Agent 定位 ≥5 次 + 审计引擎零 token + v1.1.8 已发布红线保留），BugFix 42 项中选取核心修复加回归锁防止回退。

```bash
# 子项 a: README FDE Agent 叙事收敛（≥5 处）
FDE_COUNT=$(grep -c "FDE Agent" README.md) && [ "$FDE_COUNT" -ge 5 ]   # 通过

# 子项 b: 审计引擎零 token 红线保留
grep -q "审计引擎零 token" README.md   # 命中

# 子项 c: v1.1.8 已发布标记保留
grep -q "v1.1.8" README.md   # 命中

# 子项 d: dag-runner SubAgent 不带 tools（assertSubAgentsNoEmptyTools 回归锁）
grep -c "assertSubAgentsNoEmptyTools" engine/orchestrator/src/dag-runner.ts   # ≥1

# 子项 e: prompt-sanitizer 9 条 REDACT_RULES（含 PEM 多行正则）
SANITIZER_COUNT=$(grep -c "name: '" engine/core/src/security/prompt-sanitizer.ts) && [ "$SANITIZER_COUNT" -ge 9 ]   # 通过

# 子项 f: workflow-parser schema limits（MAX_NODES=20 / MAX_TASK_LENGTH=2000）
grep -c "MAX_NODES = 20\|MAX_TASK_LENGTH = 2000" engine/orchestrator/src/workflow-parser.ts   # ≥2

# 子项 g: 验收场景覆盖（acceptance-test 场景 120-121）
grep -c "FDE Agent\|审计引擎零 token\|assertSubAgentsNoEmptyTools\|MAX_NODES" LOOP/releaser/acceptance-test.sh   # ≥4
```

#### 48. 文档时效性 + CHANGELOG 纯度 + 跨文档一致性（v1.1.9 fresh-eyes 三轮审查整合）

**背景**：v1.1.9 三轮 fresh-eyes 审查发现 20 个问题，其中可固化为回归检查的 8 项整合于此——防御文档滞后、审查元信息混入、跨文档数字漂移、感知层签名缺失等系统性缺陷。

```bash
# 子项 a: ROADMAP 版本头描述与当前版本一致（防御 F-01 P0）
# 版本头描述关键词应与 CHANGELOG 标题关键词显著重合
ROADMAP_DESC=$(sed -n '4p' ROADMAP.md)
CHANGELOG_TITLE=$(grep -m1 "^### \[v" CHANGELOG.md)
echo "$ROADMAP_DESC" | grep -qE "产品叙事|USB|A/B|控制图" || echo "⚠️ ROADMAP 版本头描述可能错配"

# 子项 b: README.en 与 README.md 关键比喻计数对齐（防御双语叙事断裂）
CN_RIVER=$(grep -c "堤坝\|自来水厂\|管网" README.md)
EN_RIVER=$(grep -c "embankment\|water.*plant\|pipeline\|River" README.en.md)
[ "$CN_RIVER" -gt 0 ] && [ "$EN_RIVER" -eq 0 ] && echo "⚠️ README.en River 比喻缺失"

# 子项 c: River 比喻非 README 文档计数 ≤ 阈值（防御跨文档重复展开）
for doc in docs/ARCHITECTURE.md docs/PHILOSOPHY.md FDE/FDE.md; do
  COUNT=$(grep -c "堤坝\|自来水厂\|管网" "$doc" 2>/dev/null || echo 0)
  [ "$COUNT" -gt 4 ] && echo "⚠️ $doc River 比喻 $COUNT 处（建议 ≤4）"
done

# 子项 d: SECURITY.md 旧描述清理（防御安全文档滞后）
grep -q "不做内容安全校验" SECURITY.md && echo "⚠️ SECURITY.md L86 措辞过时（v1.1.5+ 已加签名）"
grep -q "weekly-report\|lessons-extract" SECURITY.md && echo "⚠️ SECURITY.md daemon 清单含已移除文件"

# 子项 e: CHANGELOG 纯度——当前版本条目不含审查元信息（防御 F-14 P1）
LATEST_VER=$(grep -m1 "^### \[v" CHANGELOG.md | grep -oE 'v[0-9.]+')
sed -n "/^### \[$LATEST_VER\]/,/^### \[v/p" CHANGELOG.md | grep -qE "P[012]×|fresh-eyes|审查轮次|审查发现" && echo "⚠️ CHANGELOG 当前版本含审查元信息"

# 子项 f: 视觉模式 banner 状态行含 [sofagent] 前缀（防御感知层签名缺失 F-18）
grep -q "\[sofagent\]" <(grep "statusLabel" engine/audit/src/index.ts) || echo "⚠️ 视觉模式 statusLabel 缺 [sofagent] 前缀"

# 子项 g: SKILL.md 铁律/底线数标题声称与实际一致（防御跨图数字漂移 F-19）
SKILL_BOTTOM_CLAIMED=$(grep -oE "### ([0-9]+) 底线" SKILL/harness/SKILL.md | grep -oE "[0-9]+" || echo 0)
SKILL_BOTTOM_ACTUAL=$(sed -n '/^### [0-9] 底线/,/^### /p' SKILL/harness/SKILL.md | grep -cE "^- " || echo 0)
[ "$SKILL_BOTTOM_CLAIMED" != "$SKILL_BOTTOM_ACTUAL" ] && echo "⚠️ SKILL.md 底线数标题 $SKILL_BOTTOM_CLAIMED vs 实际 $SKILL_BOTTOM_ACTUAL"

# 子项 h: LIMITATIONS 覆盖最近版本新功能（防御文档滞后 F-05 P1）
NEW_FEATURES="Dream Cycle\|sensitivity\|knowledge-health\|ActionGovernance\|ab-scheduler"
LIMITATIONS_COV=$(grep -c "$NEW_FEATURES" LIMITATIONS.md || echo 0)
[ "$LIMITATIONS_COV" -lt 3 ] && echo "⚠️ LIMITATIONS 对 v1.1.7+ 新功能覆盖不足（$LIMITATIONS_COV 处）"
```

> **releasing.md 联动**：以下检查项已写入 `LOOP/releaser/releasing.md`，不在本清单重复——① 阶段八「LIMITATIONS 覆盖新功能」② 阶段八「evidence 文件存在且测试数一致」③ 阶段十一「tag 后零 commit 校验」。本维度只覆盖可自动化 grep 的文档一致性检查。

## 输出报告格式
> 审查日期 / 范围 / 环境验证（pre-push-check/npm test/check-docs/check-version）→ 问题清单（P0/P1/P2 分级，维度/文件:行/问题/建议）→ 通过统计 → 最终建议（可发版/需修复P0/需重大修复）。追加维度前先 grep 同类。
