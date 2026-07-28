# sofagent 回归检查清单

> **用途**：每次发版前跑一遍，确认之前修过的问题没有回退。发现新问题用[fresh-eyes-review](./fresh-eyes-review.md)。
> ⚠️ **v1.2.x 归并记录**：维度 48 子项 e-h 并入维度 1；维度 16+44 加交叉引用（通用 fail-closed vs USB fail-closed）。
> **审查对象**：sofagent 仓库（main 分支）+ npm 包 · **审查范围**：全仓库状态检查（不是只看增量）
## 🔒 维护公约（防膨胀铁律）

**追加新维度前，必须先 grep 同类**：有同类 → 扩展旧维度的子项，不新增编号；无同类 → 才新增编号 = 当前最大 +1。历史维度靠 `git show 43fac89:FORGE/playbook/regression-checklist.md` 找回。**行数警戒线**：`regression-checklist.md` ≤ 1000 行、`acceptance-test.sh` ≤ 1500 行，越线触发瘦身（releasing.md 阶段五 Tier 2）。

**清单自身健康度自校验**（每次修改后跑）：
```bash
HEAD_VAL=$(grep -oE '审查维度（[0-9]+ 项' FORGE/playbook/regression-checklist.md | grep -oE '[0-9]+')
ACTUAL=$(grep -c "^#### " FORGE/playbook/regression-checklist.md)
[ "$HEAD_VAL" = "$ACTUAL" ] && echo "✅ 维度数一致 ($HEAD_VAL)" || echo "❌ 标题声称 $HEAD_VAL ≠ 实际 $ACTUAL"

# 行数警戒线自检（越线提醒瘦身，非失败）
WC_CHK=$(wc -l < FORGE/playbook/regression-checklist.md); WC_ACC=$(wc -l < FORGE/playbook/acceptance-test.sh)
[ "$WC_CHK" -le 1000 ] && echo "✅ checklist $WC_CHK (≤1000)" || echo "⚠️ checklist $WC_CHK 超 1000"
[ "$WC_ACC" -le 1500 ] && echo "✅ acceptance $WC_ACC (≤1500)" || echo "⚠️ acceptance $WC_ACC 超 1500"
```
## 你的身份

你是**回归测试工程师**——确认已知的修复没有回退，不是发现新问题。逐项核对，全 PASS 即通过。⏰ 时序：回归检查在阶段六跑，git tag/npm registry 未到位的项标 ⏳。🔍 维度 7f/17a-b/20 依赖真实环境（npm/git/OpenClaw），AI 审查标 `⏸️ 需人工环境`。

## 审查维度（46 项 · 编号 1–61，15 个归并/移除项已转为 HTML 注释）

### 跨版本核心维度（每次必跑基线，不编号）

版本号全量一致 · 铁律措辞清零 · Skill 行数 ≤100 · 测试数一致（维度 13 SSOT 反查） · git status 零未提交修改

#### 1. CHANGELOG 纯度与完整性

> 归并自维度 48（v1.2.0 瘦身）。子项 a-d 原维度 1 + 子项 e-h 原维度 48。

```bash
# 子项 a: 纯度——不含审查元信息
grep -rniE "GLM|DeepSeek|双视角|P[012]×|审查修复|陌生视角|fresh-eyes|审查轮次|审查×|审查驱动|审查吸收" CHANGELOG.md docs/changelog/v*.md ROADMAP.md   # 期望：零命中
# 子项 b: 孤儿 changelog 检测
for f in docs/changelog/v*.md; do v=$(basename $f .md); git rev-parse $v >/dev/null 2>&1 || echo "⚠️ $v: 无对应 tag"; done
# 子项 c: CHANGELOG 索引含全部已发版 tag + 规划版独立分组
grep -A1 "## 规划中" CHANGELOG.md | head -1   # 期望：有「规划中」独立标题
# 子项 d: README 对核心文档链接可发现性
grep -c "ARCHITECTURE.md" README.md   # 期望: ≥ 1
# 子项 e: 当前版本条目不含审查元信息（原维度 48e）
LATEST_VER=$(grep -m1 "^### \[v" CHANGELOG.md | grep -oE 'v[0-9.]+'); sed -n "/^### \[$LATEST_VER\]/,/^### \[v/p" CHANGELOG.md | grep -qE "P[012]×|fresh-eyes|审查轮次" && echo "⚠️ CHANGELOG 当前版本含审查元信息"
# 子项 f: ROADMAP 版本头描述与当前版本一致（原维度 48a）
sed -n '4p' ROADMAP.md | grep -qE "产品叙事|USB|A/B|控制图" || echo "⚠️ ROADMAP 版本头描述可能错配"
# 子项 g: SECURITY.md 旧描述清理（原维度 48d）
grep -q "不做内容安全校验" SECURITY.md && echo "⚠️ SECURITY.md L86 措辞过时"
# 子项 h: SKILL.md 铁律/底线数标题声称与实际一致（原维度 48g）
SKILL_BC=$(grep -oE "### ([0-9]+) 底线" SKILL/SKILL.md | grep -oE "[0-9]+" || echo 0); SKILL_BA=$(sed -n '/^### [0-9] 底线/,/^### /p' SKILL/SKILL.md | grep -cE "^- " || echo 0); [ "$SKILL_BC" != "$SKILL_BA" ] && echo "⚠️ SKILL.md 底线数 $SKILL_BC vs $SKILL_BA"
```

<!-- #2  [v1.2.1 移除：被 check-docs.sh 维度 1b 死链扫描全量覆盖] -->

#### 3. 文档规范源与归属一致性

```bash
# 子项 a: think.md 始终为 Ledger/source（非 Views/派生视图）
# 注意：grep 须精确匹配"think.md 被标为 Views"，而非"think.md 和 Views 出现在同一行"
# 正确模式：think.md 后跟 Views/派生（think.md = Views）→ 误标；think.md 后跟 Ledger/source → 正确
grep -rn "think\.md.* Views\|think\.md.*派生视图\|think\.md（Views" docs/ARCHITECTURE.md docs/PHILOSOPHY.md docs/DEVELOPMENT.md FDE/FDE.md   # 期望：无匹配

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

<!-- #5  [v1.2.1 归并至维度 33：审计输出链路检查重叠] -->
<!-- #6  [v1.2.1 移除：被 check-version.sh 13 类位置全量覆盖] -->

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
grep -n 'grep.*|.*head\|grep.*|.*wc' FORGE/playbook/acceptance-test.sh | grep -v '|| true'   # 期望：零命中

# 子项 b: 场景间清理
grep -c "git rm --cached -f .env" FORGE/playbook/acceptance-test.sh   # 期望：≥ 2

# 子项 c: --init 烟测期望值与实际对齐（v1.1.4 教训）
DEFAULT_COUNT=$(grep -cE "name:\s*'A[0-9]" engine/audit/src/rules/index.ts | head -1)
grep -nE "期望.*[0-9]+\s*项\|期望.*[0-9]+\s*条\|expected.*[0-9]+" FORGE/playbook/acceptance-test.sh | head
# 人工检查：acceptance-test 里所有"期望 N 项/条"的硬编码 N 是否与 index.ts 注册数一致

# 子项 d: check-version 文案扫描 baseline（v1.1.6 教训——工具自身 SSOT 标签误导）
EXPECTED_DEFAULT=$(awk '/export const defaultRules/{f=1; next} f && /^[[:space:]]*\{.*name:/{c++} f && /^[[:space:]]*\];/{exit} END{print c+0}' engine/audit/src/rules/index.ts)
REPORTED_DEFAULT=$(bash tools/check-version.sh 2>&1 | grep -oE "defaultRules.length=[0-9]+" | grep -oE "[0-9]+")
echo "期望=$EXPECTED_DEFAULT 报告=$REPORTED_DEFAULT"   # 期望：两者相等

# 子项 e: acceptance-test.sh JSON 输出不被 stderr 污染（v1.1.5 教训）
grep -E "\-\-json.*2>&1|2>&1.*\-\-json" FORGE/playbook/acceptance-test.sh   # 期望：零命中

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
grep -rnE "A1-A11、A14-A1[0-9]|[0-9]+ 条审计规则" --include="*.md" README.md README.en.md docs/ FDE/ FORGE/ ROADMAP.md 2>/dev/null | grep -v "regression-checklist\|fresh-eyes-review\|changelog/"   # 人工核对：与 SSOT 一致

# 字段完整性（v1.1.6：name+ruleClass 各 21 条=42）+ evidenceMode 计数（v1.1.4：期望 21）
grep -oE "name:|ruleClass:" engine/audit/src/rules/index.ts | wc -l   # 期望 42
grep -cE "evidenceMode:" engine/audit/src/rules/index.ts   # 期望 21
```

<!-- #10 [v1.2.1 移除：被 pre-push-check.sh 步骤 7+8 全量覆盖] -->

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

<!-- #13 [v1.2.1 移除：被 check-test-count.sh 一键校验全量覆盖] -->

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
grep -c "露个脸就够了" SKILL/SKILL.md          # 期望：≥ 1
grep -c "质量搭档" SKILL/harness/engage.md              # 期望：≥ 1
grep -c "sofagent 已就绪" engine/scripts/lib/post-install.sh  # 期望：≥ 1
grep -c "Agent 身份感知" FDE/FDE.md                      # 期望：≥ 1
```

#### 16. 安全约束 fail-closed 与权限加固

> USB 专属 fail-closed 验签见维度 44。

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

#### 18. 扩展审计规则源码回归锁——A19 commit 质量 + A18 垃圾文件（v1.2.1 归并 18+19）

> 归并原因：两者结构完全平行（单规则源码检查），合并为"扩展规则回归锁"。

```bash
# 子项 a: A19 commit message 质量（原维度 18）
F19=engine/audit/src/rules/rule-a19-commit-msg-quality.ts
grep -c "MIN_LENGTH = 8" $F19 && grep -c "BLACKLIST" $F19 && grep "业务底线" $F19   # 长度检查+黑名单+分级
grep "!commitMsg || !commitMsg.trim" $F19   # 空 message 降级 PASS
grep "A19" engine/audit/src/rules/runner.ts   # critical 层阻断

# 子项 b: A18 垃圾文件检测（原维度 19）
F18=engine/audit/src/rules/rule-a18-junk-file.ts
grep -c "JUNK_PATTERNS" $F18   # 3 组正则
grep -c "isExempt" $F18   # 豁免规则
grep "\"WARN\"" $F18   # 只产生 WARN
grep "A18" engine/audit/src/rules/runner.ts   # extended 优先级 A18 排在 A17 之后
```

<!-- #19 [v1.2.1 归并至维度 18：A19+A18 结构平行，合并为扩展规则回归锁] -->

#### 20. daemon plist + watch.yml 正确性 + --init 覆盖防护（v1.2.1 归并 20+22）

> 归并原因：20 和 22 都检查 plist/WorkingDirectory，grep 目标文件 100% 重叠。

```bash
# 子项 a: plist 内容正确（原维度 20）
grep "sofagent-daemon" ~/Library/LaunchAgents/com.sofagent.daemon.plist   # ProgramArguments
grep "Workbuddy/sofagent" ~/Library/LaunchAgents/com.sofagent.daemon.plist   # WorkingDirectory
test -f .sofagent/watch.yml && grep "paths:" .sofagent/watch.yml   # --init 生成
! grep -q "不支持的参数.*--daemon" ~/.sofagent/daemon.log   # 无废弃参数
tail -20 ~/.sofagent/daemon.log | grep "监控目录"   # 监控目录正确

# 子项 b: --init 覆盖防护（原维度 22）——跑完 acceptance-test.sh 后重复检查
launchctl list | grep sofagent | awk '{print $2}'   # 期望=0（daemon 正常运行）
# 跑完 acceptance-test.sh 后重复上述 grep，确认 plist 未被污染
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
grep -rl "sofagent-releaser\|releaser-skill" engine/scripts/lib/file-deploy.sh install.sh 2>/dev/null | wc -l   # 期望=0（releaser 复制契约已移除，v1.2.0）
```

## 审查约束（每次发版必验铁律）

版本号全量一致 · 铁律措辞清零 · Skill 行数 ≤100 · CHANGELOG 纯度 · 测试数一致 · 安全约束 fail-closed · npm 产物三方一致

<!-- #22 [v1.2.1 归并至维度 20：plist 检查 grep 目标 100% 重叠] -->

#### 23. FDE/LOOP 跨产品声称一致性

> v1.1.4 暴露：FDE/LOOP 声称"独立产品"，但文档里步数、Agent 数、CLI 子命令存在矛盾

```bash
SSOT_VER=$(node -e "console.log(require('./package.json').version)")

# 子项 a: FDE 步数跨文档一致（v1.1.4 已修复，固化防回退）
grep -oE "[0-9]+ 个阶段|[0-9]+ 个关键步骤|[0-9]+ 步" FDE/SKILL.md FDE/README.md FDE/FDE.md 2>/dev/null | sort | uniq -c   # 期望：一致

# 子项 b: LOOP Agent 数跨文档一致（v1.1.4 暴露）
ACTUAL_AGENTS=$(ls SKILL/agents/*/SKILL.md 2>/dev/null | wc -l); echo "实际安装 Agent 数: $ACTUAL_AGENTS"
grep -oE "[0-9]+ 个内置 Agent\|[0-9]+ 个 Agent" FORGE/README.md FORGE/quick-start.md 2>/dev/null   # 人工核对一致

# 子项 c: LOOP 跨产品 install 契约已溶解（v1.2.0——loop-install.sh 删除，LOOP 由 SKILL/<loop>/ 驱动）
[ -f FORGE/loop-install.sh ] && echo "⚠️ FORGE/loop-install.sh 仍存在（应删除）" || echo "✅ LOOP 无独立 install 脚本"

# 子项 d: 独立 install 闭环（FDE 仍依赖主 install.sh）
CLONE_NOTE=$(grep -rliE "完整 clone|完整仓库|需要.*sofagent.*仓库|clone.*完整" FDE/README.md FDE/SKILL.md FORGE/README.md 2>/dev/null | head -1 || true)
[ -n "$CLONE_NOTE" ] && echo "✅ 文档已标注完整 clone 要求" || echo "⚠️ 未找到标注"
grep -q "被 FDE/LOOP 依赖\|FDE/LOOP" install.sh 2>/dev/null && echo "✅ 主 install.sh 已标注" || echo "⚠️ 未标注"

# 子项 e: install 脚本版本号 = SSOT（v1.1.4 暴露——install.sh 版本号漂移）
grep -H "v[0-9]\+\.[0-9]\+\.[0-9]\+" install.sh | head -4   # 期望：所有版本号 = SSOT_VER
```

<!-- #24 [v1.2.0 移除：被 SOP 步骤 13 Step D 覆盖] -->
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

#### 27. WIKI.md 存在 + 内容完整性（v1.2.1 新增）

```bash
# 子项 a: 文档存在
[ -f docs/WIKI.md ] && echo "EXISTS" || echo "MISSING"

# 子项 b: 七节结构完整
WIKI_SECTIONS=$(grep -c "^## [一二三四五六七]、" docs/WIKI.md)
[ "$WIKI_SECTIONS" -ge 7 ] || echo "⚠️ WIKI.md 节数不足（期望 7）"

# 子项 c: 版本号与当前版本一致
grep -q "v1\\.2\\.[0-9]" docs/WIKI.md || echo "⚠️ WIKI.md 版本号缺失"

# 子项 d: 核心文档引用链存在（README + ARCHITECTURE 可发现）
grep -c "WIKI" README.md   # ≥1
grep -c "WIKI.md" docs/ARCHITECTURE.md   # ≥1（可选，ARCHITECTURE 已通过数据流图间接引用）
```

<!-- #27b [v1.2.1 移除：被 pre-push-check.sh 步骤 1 + CI shellcheck.yml 全量覆盖] -->

#### 28. Skill 元数据完整性（v1.1.6 新增）

> SKILL.md 若缺必需字段，Agent 可能无法自动加载

```bash
for f in SKILL/agents/*/SKILL.md FDE/SKILL.md SKILL/SKILL.md; do
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
#### 34. 文档头日期 + 文档数字 SSOT 一致性（v1.2.0 归并自 34+35）

> v1.2.0 瘦身：原维度 34（日期门禁）+ 35（数字 SSOT）合并。

```bash
# 子项 a: check-version.sh 有日期扫描 + 跑 check-version 全绿
grep -c "日期一致性扫描\|文档头日期" tools/check-version.sh   # ≥1
bash tools/check-version.sh 2>&1 | tail -5   # 期望：全部通过
# 子项 b: README 无模糊数字（700+ 等区间声称）+ 使用精确数字
grep -n "[0-9]\++\|700+" README.md 2>/dev/null   # 期望：零命中
# 子项 c: test-count.sh 实测与文档声称比对
ACTUAL=$(bash tools/test-count.sh --quiet 2>&1 | grep -oE 'TOTAL_TESTS=[0-9]+' | cut -d= -f2); echo "实测 workspace 测试数: $ACTUAL"
# 子项 d: 三产品关系表述一致
grep -c "独立产品\|按需选用\|独立安装" README.md FDE/README.md FORGE/README.md 2>/dev/null   # 每个文档 ≥1
```
<!-- #35 [v1.2.0 归并至维度 34] -->
#### 36. 跨产品 install 契约 CI 验证（v1.1.7 新增 · BugFix 11）

> FDE/LOOP 调用主 install.sh 的接口是跨产品契约——CI 应有专门 job 验证

```bash
# 子项 a: CI 有 cross-product-contract job
grep -c "cross-product-contract\|cross_product_contract" .github/workflows/*.yml 2>/dev/null   # ≥1

# 子项 b: install.sh 是主安装器（含 FDE 逻辑）
grep -c "\-\-base-only" install.sh 2>/dev/null   # ≥1

# 子项 c: LOOP 无独立 install 脚本（v1.2.0——已由 SKILL/<loop>/ 驱动）
[ -f FORGE/loop-install.sh ] && echo "⚠️ FORGE/loop-install.sh 仍存在" || echo "✅ LOOP 无独立 install 脚本"

# 子项 d: 主 install.sh 标注被 FDE/LOOP 依赖
grep -c "FDE/LOOP\|被.*依赖\|跨产品" install.sh 2>/dev/null   # ≥1
```
<!-- #37 [v1.2.1 归并至维度 8：red-team 场景检查是 acceptance-test 健壮性的子集] -->

#### 38. daemon 审计集中收集 workaround + 安全文档时效性（v1.1.7 新增 · BugFix 9+13）

> SECURITY.md 必须诚实标注 daemon 审计推送的现状

```bash
SSOT_VER=$(node -e "console.log(require('./package.json').version)")

# 子项 a: SECURITY.md 有 filebeat/logstash workaround
grep -c "filebeat\|logstash" SECURITY.md   # ≥1

# 子项 b: Webhook 企业平台推送标企业采购阻塞（本地三态 v1.1.6 已通；企业平台 v1.2.1 才就绪）
grep -c "v1.2.1\|不推送\|企业.*阻塞\|待落地\|本地三态.*已接通" SECURITY.md   # ≥1

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

> 联邦查询第 3 层防线——channel 明文无 TLS，AES-256-GCM 唯一保密层。

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
grep -c "AES-256-GCM\|ECDH.*配对\|pairByToken" FORGE/playbook/acceptance-test.sh   # ≥3
```

#### 40. OpenClaw channel 联邦查询（v1.1.8 新增 · 交付二）

> 两台设备互相 search_knowledge，Automerge CRDT 合并，离线降级不阻塞。

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
grep -c "联邦.*sensitivity\|federation\|broadcastQuery" FORGE/playbook/acceptance-test.sh   # ≥2
```

#### 41. Prompt 注入 8 层防护（层 1 + 层 4 + 层 5）（v1.1.8 新增 · 交付三）

> 8 层防护三层实现——标签包裹(层1)+脱敏(层4)+可信分级(层5)。

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
grep -c "wrapUntrusted\|redactForPrompt\|trust.*分级\|isTrustEntryUsable" FORGE/playbook/acceptance-test.sh   # ≥4
```

#### 42. 编排引擎 dag-runner + compose --run（v1.1.8 新增 · 交付四）

> compose --run 委派 Sub Agent + 同文件冲突检测 WARN。

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
grep -c "dag-runner\|detectFileConflicts\|compose.*DAG" FORGE/playbook/acceptance-test.sh   # ≥2
```

<!-- #43 [v1.2.1 归并至维度 29：pushKnowledgeSummary 依赖 dream-cycle/knowledge-health 触发] -->

#### 44. USB 完整运行时——HMAC 签名 + AES-256 加密 + fail-closed 验签（v1.1.9 新增 · 交付一）

> 通用安全 fail-closed 基线见维度 16。

> 全量文件 HMAC 签名 + 验签 fail-closed + knowledge/ AES-256 密文落盘。

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
grep -c "usb-signature\|usb-key\|createUsbKey\|verifyUsbSignature" FORGE/playbook/acceptance-test.sh   # ≥4
```

#### 45. 编排状态机 + 控制图——A/B 调度器 + 状态抽取 + 路径穿越防护（v1.2.1 归并 45+46）

> 归并原因：45（ab-scheduler）和 46（loop-state-extractor）都检查 orchestrator 状态机，grep 目标重叠 ab-scheduler.ts。

```bash
# 子项 a-g: A/B 调度器四阶段状态机（原维度 45）
grep -c "initialState\|checkThreshold\|startExploration\|judgeAndPromote\|runABScheduledTask" engine/orchestrator/src/ab-scheduler.ts   # ≥5
grep -c "'exploit'\|'explore'\|'judge'\|'idle'" engine/orchestrator/src/ab-scheduler.ts   # ≥4
grep -c "DEFAULT_PROMOTE_THRESHOLD\|promoteThreshold" engine/orchestrator/src/ab-scheduler.ts   # ≥2
grep -c "appendMetrics\|aggregateRecent\|truncateToLastK\|HISTORY_MAX_ENTRIES" engine/orchestrator/src/ab-history.ts   # ≥4
grep -c "ab-schedule\|runABScheduledTask" engine/daemon/src/cron.ts   # ≥2
grep -c "executePlan\|writeGraphState\|ABSchedulerDeps" engine/orchestrator/src/ab-scheduler.ts   # ≥3
grep -c "ab-scheduler\|ab-history\|judgeAndPromote\|ab-schedule" FORGE/playbook/acceptance-test.sh   # ≥4

# 子项 h-n: 控制图状态抽取 + 路径穿越安全（原维度 46）
grep -c "extractControlGraphState\|writeControlGraphState\|CONTROL_GRAPH_SCHEMA_VERSION" engine/orchestrator/src/loop-state-extractor.ts   # ≥3
grep "CONTROL_GRAPH_SCHEMA_VERSION = 'v1'" engine/orchestrator/src/loop-state-extractor.ts
grep -c "sanitizeLoopId\|createHash.*sha256.*slice.*0.*8\|sanitized.*===.*loopId" engine/orchestrator/src/loop-state-extractor.ts   # ≥2
grep -c "assertWithinDir\|resolved.*startsWith\|路径穿越" engine/orchestrator/src/loop-state-extractor.ts   # ≥3
grep -c "writeControlGraphState\|writeGraphState" engine/orchestrator/src/ab-scheduler.ts   # ≥2
grep -c "splitWaves\|mapNodeStates\|buildEvidenceChain" engine/orchestrator/src/loop-state-extractor.ts   # ≥3
grep -c "extractControlGraphState\|sanitizeLoopId\|路径穿越" FORGE/playbook/acceptance-test.sh   # ≥3
```

<!-- #46 [v1.2.1 归并至维度 45：编排状态机 grep 目标重叠 ab-scheduler.ts] -->

> 归并去向：维度 45 子项 h-n。

#### 47. 产品叙事收敛红线 + BugFix 42 项核心回归锁（v1.1.9 新增 · 交付四+五）

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
grep -c "FDE Agent\|审计引擎零 token\|assertSubAgentsNoEmptyTools\|MAX_NODES" FORGE/playbook/acceptance-test.sh   # ≥4
```

<!-- #48 [v1.2.0 归并至维度 1：子项 e-h 全部归入维度 1] -->

---

#### 49. v1.2.0 物理结构大重构——旧路径零残留 + 新结构就位（v1.2.0 新增 · fresh-eyes 三轮审查）

```bash
# 子项 a: /sofagent/ 目录残留（node 扫描绕开 BSD grep 中文误判）
node -e "const fs=require('fs');const dirs=['engine','LOOP','FDE','SKILL','docs','tools','.github'];let hits=[];dirs.forEach(d=>{if(!fs.existsSync(d))return;function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','dist','target'].includes(e.name))continue;const f=dir+'/'+e.name;if(e.isDirectory())walk(f);else if(e.name.endsWith('.md')||e.name.endsWith('.ts')||e.name.endsWith('.sh')){const c=fs.readFileSync(f,'utf8');c.split('\n').forEach((l,i)=>{if(l.includes('sofagent/skill/')&&!l.includes('已')&&!l.includes('旧')&&!l.includes('→')&&!l.includes('历史'))hits.push(f+':'+(i+1))})}}}walk(d)});['install.sh','SECURITY.md','README.md'].forEach(f=>{if(!fs.existsSync(f))return;const c=fs.readFileSync(f,'utf8');c.split('\n').forEach((l,i)=>{if(l.includes('sofagent/skill/')&&!l.includes('已')&&!l.includes('旧')&&!l.includes('→')&&!l.includes('历史'))hits.push(f+':'+(i+1))})});console.log(hits.length===0?'✅ sofagent/skill/ 零残留':'❌ FOUND '+hits.length);hits.forEach(h=>console.log('  '+h))"

# 子项 b: agents/SKILL/ 旧路径残留（应零命中，排除 changelog 历史 + acceptance-test 反向断言）
node -e "const fs=require('fs');const dirs=['engine/src','engine/orchestrator/src','engine/rules/src','LOOP','FDE','SKILL','docs','tools'];let hits=[];dirs.forEach(d=>{if(!fs.existsSync(d))return;function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','dist'].includes(e.name))continue;const f=dir+'/'+e.name;if(e.isDirectory())walk(f);else if(e.name.endsWith('.md')||e.name.endsWith('.ts')||e.name.endsWith('.sh')){const c=fs.readFileSync(f,'utf8');c.split('\n').forEach((l,i)=>{if(l.includes('agents/SKILL')&&!f.includes('changelog/')&&!(f.includes('acceptance-test')&&l.includes('! -d')))hits.push(f+':'+(i+1))})}}}walk(d)});console.log(hits.length===0?'✅ agents/SKILL/ 零残留':'❌ FOUND '+hits.length);hits.forEach(h=>console.log('  '+h))"

# 子项 c: SECURITY.md Dengine/ 残留（应零命中）
node -e "const fs=require('fs');const c=fs.readFileSync('SECURITY.md','utf8');let n=0;c.split('\n').forEach((l,i)=>{if(l.includes('Dengine')){console.log('  L'+(i+1)+': '+l.trim());n++}});console.log(n===0?'✅ SECURITY.md Dengine 零残留':'❌ FOUND '+n)"

# 子项 d: install.sh VERSION 变量（应为 1.2.0）
grep '^VERSION=' install.sh | head -1

# 子项 e: engine/rules/package.json files 字段存在
node -e "const p=require('./engine/rules/package.json');console.log(p.files?'✅ rules files 字段存在':'❌ 缺 files 字段')"

# 子项 f: verify.yml CI 路径（应引用 SKILL/harness/ 而非 engine/skill/）
grep -n "engine/skill" .github/workflows/verify.yml   # 期望：零输出

# 子项 g: shellcheck.yml 覆盖 install.sh + 无旧路径
grep -n "sofagent-lite\|'scripts/\*\*" .github/workflows/shellcheck.yml   # 期望：零输出
grep -c "'install.sh'" .github/workflows/shellcheck.yml   # 期望：2

# 子项 h: bump-version.sh 同版本号优雅退出
bash tools/bump-version.sh 1.2.0 1.2.0 --dry-run 2>&1 | tail -3   # 期望：无 unbound variable

# 子项 i: install.sh 部署路径 vs handler.ts/checks.ts 读取路径对齐（v1.2.0 P0①）
INSTALL_FDE=$(grep -oE 'skills/[a-z]+/fde\.md' install.sh | sort -u); HANDLER_FDE=$(grep -oE '"skills", "[a-z]+"' engine/hooks/sofagent-load-chain/src/handler.ts | head -2 | tr '\n' ' '); echo "install: $INSTALL_FDE / handler: $HANDLER_FDE"   # 人工核对路径一致

# 子项 j: install.sh HMAC key 自动生成逻辑存在（v1.2.0 P0⑥）
grep -c 'sofagent-key' engine/scripts/lib/post-install.sh   # ≥2
grep -c 'chmod 600' engine/scripts/lib/post-install.sh       # ≥1
```

> **fresh-eyes 教训**：物理结构大重构最容易在边缘文件留下旧路径残留（install.sh 写 A，handler.ts 读 B → 约束层静默失效）。

---

#### 50. 文档乱码扫描——U+FFFD + null byte + UTF-8 损坏检测（v1.2.0 新增）

> v1.2.0 发版中反复发现 UTF-8 损坏（U+FFFD 乱码 + null byte 嵌入）。bsd grep 无法检测，必须 node 逐字符扫描。

```bash
# 子项 a: U+FFFD 替换字符全仓扫描（核心——编码损坏的直接证据）
node -e "const fs=require('fs'),path=require('path');const dirs=['docs','SKILL','FDE','FORGE','tools'];const rootFiles=['README.md','README.en.md','CHANGELOG.md','ROADMAP.md','SECURITY.md','LIMITATIONS.md','CODE_OF_CONDUCT.md','CONTRIBUTING.md','install.sh'];const skips=['node_modules','dist','target','.workbuddy','.sofagent','archive','changelog'];let hits=[];const REPL=String.fromCharCode(0xFFFD);function scan(f){try{const c=fs.readFileSync(f,'utf8');c.split('\n').forEach((l,i)=>{if(l.includes(REPL))hits.push(f+':'+(i+1)+': U+FFFD 替换字符')})}catch(e){}}function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(skips.includes(e.name))continue;const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else if(/\.(md|ts|sh|json|yml)$/.test(e.name))scan(f)}}dirs.forEach(d=>{if(fs.existsSync(d))walk(d)});rootFiles.forEach(f=>{if(fs.existsSync(f))scan(f)});console.log(hits.length===0?'✅ 零 U+FFFD 乱码':'❌ FOUND '+hits.length);hits.slice(0,20).forEach(h=>console.log('  '+h))"

# 子项 b: C1 控制字符扫描（U+0080-U+009F，非法 UTF-8 残留）
node -e "const fs=require('fs'),path=require('path');const dirs=['docs','SKILL','FDE','FORGE','tools'];let hits=[];function scan(f){try{const c=fs.readFileSync(f,'utf8');c.split('\n').forEach((l,i)=>{for(let j=0;j<l.length;j++){const code=l.charCodeAt(j);if(code>=0x80&&code<=0x9F){hits.push(f+':'+(i+1)+': C1 控制字符 U+'+code.toString(16));break}}})}catch(e){}}function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','dist','target','.workbuddy','.sofagent','archive','changelog'].includes(e.name))continue;const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else if(/\.(md|ts|sh|json|yml)$/.test(e.name))scan(f)}}dirs.forEach(d=>{if(fs.existsSync(d))walk(d)});console.log(hits.length===0?'✅ 零 C1 控制字符':'❌ FOUND '+hits.length);hits.slice(0,10).forEach(h=>console.log('  '+h))"

# 子项 c: 孤立代理对/颠倒代理对（surrogate pair 损坏）
node -e "const fs=require('fs'),path=require('path');const dirs=['docs','SKILL','FDE','FORGE','tools'];let hits=[];function scan(f){try{const c=fs.readFileSync(f,'utf8');const arr=[...c];arr.forEach((ch,idx)=>{const code=ch.codePointAt(0);if(code>=0xD800&&code<=0xDFFF){hits.push(f+':char#'+idx+': 孤立代理对 U+'+code.toString(16))}})}catch(e){}}function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','dist','target','.workbuddy','.sofagent','archive','changelog'].includes(e.name))continue;const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else if(/\.(md|ts|sh|json|yml)$/.test(e.name))scan(f)}}dirs.forEach(d=>{if(fs.existsSync(d))walk(d)});console.log(hits.length===0?'✅ 零孤立代理对':'❌ FOUND '+hits.length);hits.slice(0,10).forEach(h=>console.log('  '+h))"

# 子项 d: 常见 mojibake 模式（UTF-8 按 Latin-1/GBK 误读，正则用 codepoint 避免 CLI 编码问题）
node -e "const fs=require('fs'),path=require('path');const dirs=['docs','SKILL','FDE','FORGE'];const rootFiles=['README.md','README.en.md','CHANGELOG.md','ROADMAP.md','SECURITY.md'];const exempt=/regression-checklist\.md$|fresh-eyes-review\.md$/;let hits=[];const mojibake=/[\u00C0-\u00C3][\u0080-\u00BF]|\uFFFD\uFFFD|[\u00C2\u00C3][\u0080-\u00BF]|\u00ef\u00bf\u00bd/;function scan(f){if(exempt.test(f))return;try{const c=fs.readFileSync(f,'utf8');c.split('\n').forEach((l,i)=>{if(mojibake.test(l))hits.push(f+':'+(i+1)+': '+l.trim().slice(0,60))})}catch(e){}}function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','dist','target','.workbuddy','.sofagent','archive','changelog'].includes(e.name))continue;const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else if(/\.(md|ts|sh|json|yml)$/.test(e.name))scan(f)}}dirs.forEach(d=>{if(fs.existsSync(d))walk(d)});rootFiles.forEach(f=>{if(fs.existsSync(f))scan(f)});console.log(hits.length===0?'✅ 零 mojibake':'❌ FOUND '+hits.length);hits.slice(0,20).forEach(h=>console.log('  '+h))"

# 子项 e: null byte 扫描（\x00 嵌入——逐字节扫 Buffer，\x00 在 JSON 字符串里会被吞掉）
node -e "const fs=require('fs'),path=require('path');const dirs=['docs','SKILL','FDE','FORGE','tools'];const rootFiles=['README.md','README.en.md','CHANGELOG.md','ROADMAP.md','SECURITY.md','LIMITATIONS.md','CONTRIBUTING.md','install.sh'];const skips=['node_modules','dist','target','.workbuddy','.sofagent','archive','changelog'];let hits=[];function scan(f){try{const buf=fs.readFileSync(f);let line=1;for(let i=0;i<buf.length;i++){if(buf[i]===10)line++;if(buf[i]===0){const ctx=buf.slice(Math.max(0,i-10),Math.min(buf.length,i+10)).toString('utf8').replace(/\x00/g,'<NUL>');hits.push(f+':'+line+': null byte 上下文 ...'+ctx+'...');if(hits.length>20)break}}}catch(e){}}function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(skips.includes(e.name))continue;const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else if(/\.(md|ts|sh|json|yml)$/.test(e.name))scan(f)}}dirs.forEach(d=>{if(fs.existsSync(d))walk(d)});rootFiles.forEach(f=>{if(fs.existsSync(f))scan(f)});console.log(hits.length===0?'✅ 零 null byte':'❌ FOUND '+hits.length);hits.forEach(h=>console.log('  '+h))"
```

> **修复指南**：发现乱码后不要手删——找到原始未损坏版本（git show）整文件覆盖恢复，再跑维度 50 确认。

---

#### 51. v1.2.0 审计链安全加固回归——HMAC 写读一致 + doctor 三态 + config 签名 + 版本自检 + key 强度（v1.2.0 BugFix 批次新增）

> v1.2.0 BugFix 批次锁定 5 个 HMAC/审计链回归点——写侧与读侧对称性（改了签名逻辑忘了改验签→永久不可复验）。

```bash
# 子项 a: HMAC 写读一致性——写入侧先 sanitize 再签名（P0-3 教训：改了写入侧没改读取侧→永久验签失败）
grep -n "stableStringify\|sanitize\|脱敏" engine/core/src/audit-history.ts | grep -i "sign\|hmac\|签" && echo "✅ HMAC 写读对称" || echo "❌ HMAC 写读不对称"
grep -n "stableStringify\|sanitize" engine/audit/src/audit-history.ts | grep -i "sign\|hmac\|verify" && echo "✅ audit 包 HMAC 对称" || echo "⚠️ 检查 audit 包 HMAC"

# 子项 b: doctor 三态判定——ok/tampered/unverifiable（不可复验 ≠ 篡改）
grep -q "tampered" engine/core/src/doctor.ts && grep -q "unverifiable" engine/core/src/doctor.ts && echo "✅ 三态判定存在" || echo "❌ 缺少三态判定"
grep -q "checkHistoryChainDetailed" engine/core/src/doctor.ts && echo "✅ 使用 detailed 版本" || echo "❌ 未使用 detailed 版本"

# 子项 c: config 签名位置——signature 只允许顶层，audit 段内误放要 warn
grep -q "audit 段含 signature" engine/core/src/config-loader.ts && echo "✅ audit 段签名检测存在" || echo "❌ 缺少 audit 段签名检测"
grep -q "function verifyConfigSignature" engine/core/src/config-loader.ts && echo "✅ verifyConfigSignature 存在" || echo "❌ 缺少 verifyConfigSignature"

# 子项 d: 版本一致性自检（advisory only，不阻断主流程）
grep -q "checkVersionConsistency" engine/audit/src/index.ts && echo "✅ 版本自检存在" || echo "❌ 缺少版本自检"
grep -A3 "checkVersionConsistency" engine/audit/src/index.ts | grep -q "catch\|不阻断\|advisory" && echo "✅ 自检不阻断" || echo "⚠️ 检查是否阻断"

# 子项 e: HMAC key 强度校验——≥16 字节
grep -q "validateHmacKey" engine/core/src/audit-history.ts && echo "✅ validateHmacKey 存在" || echo "❌ 缺少 validateHmacKey"
grep -q "byteLen < 16\|16.*字节\|>=.*16" engine/core/src/audit-history.ts && echo "✅ 16 字节阈值存在" || echo "❌ 缺少 16 字节阈值"
```

> **HMAC 写读一致性教训**（v1.2.0 P0-3）：改了签名算法的一侧**必须同时改另一侧**，否则写入的记录永久「不可复验」。

---

<!-- #52 [v1.2.1 移除：方法论指导，非可执行巡检] -->

---

#### 53. SSOT 零硬编码——产品代码不得绕过 data-paths.ts 拼路径（v1.2.1 新增）

> v1.2.1 教训：产品代码（非测试文件）出现 `join(cwd, 'data', ...)` / `join(projectDir, 'data', 'audit')` 等硬编码，绕过 SSOT。

```bash
# 产品代码零硬编码检查（排除测试文件、data-paths.ts 自身、注释）
grep -rn "join(.*'data'" engine/ --include="*.ts" | grep -v "data-paths.ts" | grep -v "\.test\." | grep -v "__tests__" | grep -v "// " | grep -v "新的路径"
# 期望：零命中或仅注释（注释需说明"原...迁移到..."）

# 额外验证：data-paths.ts 存在且导出 resolve* 函数
grep -c "resolveAuditDir\|resolveDataDir\|resolveTaskDir\|DATA_ROOT" engine/core/src/data-paths.ts   # ≥2
```

> **PASS 标准**：产品代码零硬编码路径拼接，全部走 data-paths.ts 常量或 resolve* 函数。

---

#### 54. 环境变量命名 Unix 全大写——禁止驼峰（v1.2.1 新增）

> v1.2.1 教训：`SOFAgent_HOME`（驼峰）违反 Unix 环境变量全大写+下划线约定，应为 `SOFAGENT_HOME`。

```bash
# 全仓搜索驼峰环境变量（shell/ts/mjs 文件）
grep -rn "SOFAgent_" install.sh engine/ FORGE/ --include="*.sh" --include="*.ts" --include="*.mjs"
# 期望：零命中

# 确认正确命名已就位
grep -rc "SOFAGENT_HOME\|SOFAGENT_DATA" engine/scripts/lib/platform-detect.sh engine/scripts/lib/config.sh   # ≥2
```

> **PASS 标准**：零驼峰环境变量命中。

---

#### 55. 未定义变量检查——set -euo pipefail 陷阱（v1.2.1 新增）

> v1.2.1 教训：shell 脚本在 `set -u` 下引用未定义变量会立即退出。install.sh 曾引用未定义的 PROJECT_DIR（只定义了 PROJECT_ROOT）。

```bash
# shellcheck 覆盖（已在 pre-push-check.sh 步骤 1）
shellcheck install.sh engine/scripts/*.sh tools/*.sh 2>&1 | grep "SC2155\|SC2034"
# SC2155 = 声明并赋值同一条命令 declare 并 assign
# 额外检查：手动 grep 可能未定义的变量
grep -rn '\$PROJECT_DIR\b' install.sh  # 期望零命中（只有 PROJECT_ROOT）
# 更通用：bash -u 模式跑脚本 --dry-run
bash -n install.sh  # 语法检查

# 交叉验证：确认定义的变量名与引用的变量名一致
grep -oE '\b[A-Z_]{3,}=' install.sh engine/scripts/lib/*.sh | sort -u   # 定义侧
grep -ohE '\$\{?[A-Z_]{3,}\}?' install.sh engine/scripts/lib/*.sh | sed 's/[${}]//g' | sort -u   # 引用侧
# 人工核对：引用侧不应出现定义侧没有的变量名
```

> **PASS 标准**：shellcheck 零 SC2155/SC2034 + 手动抽查关键变量定义完整。

---

#### 56. trust-but-verify——mock 单测全绿 ≠ 真实引擎匹配（v1.2.1 P0b 新增）

> v1.2.1 P0b 教训：工程师用 mock 跑 eval 单元测试全绿（IS_PASS: YES），但 QA 跑真实 CLI 端到端通过率仅 14.3%——mock 未经过真实审计引擎校验，未发现 golden set 与 audit 规则不匹配。逐条读 21 个 rule-*.ts 重写后 14.3% → 100%。

```bash
# mock 单测全绿后，必须额外跑真实 CLI 端到端
# eval 包
(cd engine/eval && node dist/cli.js run 2>&1 | grep -E "passRate|通过率")
# 期望：passRate 100%，任何低于 100% 都说明 golden set 与真实规则不匹配
# ab-test 包
(cd engine/ab-test && node dist/cli.js run --golden-set 2>&1 | grep -E "passRate|通过率")
```

> **PASS 标准**：真实 CLI 端到端 passRate = 100%，而非仅 mock 单测全绿。

---

#### 57. A2/A9 fixture 敏感内容安全——占位符 + base64 编码（v1.2.1 P0b 新增）

> v1.2.1 P0b 教训：golden set 的 fail 用例需含假密钥/injection 文本，但字面串会触发 A2/A9 扫源码本身 → commit hook 拦截。解法：YAML 用占位符（`{{SK_PREFIX}}`/`{{INJ_PHRASE}}`），运行时替换，映射值用 base64 编码存储（A9 扫不到 base64）。

```bash
# 1. golden set 不含字面密钥（A2 安全）
grep -rnE 'sk-[a-zA-Z0-9]{20,}' engine/eval/data/golden-set.yaml engine/ab-test/data/ 2>/dev/null
# 期望：零命中（用 {{SK_PREFIX}} 占位符）

# 2. golden set 不含字面 injection（A9 安全）
grep -rn "$(echo SWdub3JlIHByZXZpb3VzIGluc3RydWN0aW9ucw== | base64 -d)" engine/eval/data/golden-set.yaml 2>/dev/null
# 期望：零命中（用 {{INJ_PHRASE}} 占位符）

# 3. 占位符替换机制存在
grep -c 'PLACEHOLDER_MAP\|SK_PREFIX\|INJ_PHRASE' engine/eval/src/eval-runner.ts  # ≥3
```

> **PASS 标准**：golden set 零字面密钥/injection + 占位符替换机制存在 + audit 运行时检测有效。
>
> 🔴 **v1.2.2 再犯**：P0 补测试时 fixture 又写了字面量 `sk-abcdef...`，commit 被 A2 拦截 2 次。**此问题已复发两次（v1.2.1 eval + v1.2.2 P0 测试），铁律升级：测试文件中任何 secret-like 串（含 sk-/AKIA/ghp_ 前缀的假数据）必须运行时拼接（数组 join 或 base64 解码），绝不字面量。**

---

#### 58. convertAuditResult 三态——WARN 不应当 FAIL（v1.2.1 P0b 新增）

> v1.2.1 P0b 教训：eval-runner.ts 的 convertAuditResult 原版把 WARN（exitCode 1）当 FAIL（exitCode 2）是 bug。三态：exitCode 0=PASS, 1=WARN, 2=FAIL。

```bash
# 验证三态转换逻辑存在
grep -A5 'convertAuditResult' engine/eval/src/eval-runner.ts | grep -E 'PASS|WARN|FAIL|exitCode'
# 期望：3 种状态都有分支处理
```

> **PASS 标准**：convertAuditResult 含 PASS/WARN/FAIL 三态分支，WARN 不映射为 FAIL。

---

## 输出报告格式
> 审查日期 / 范围 / 环境验证（pre-push-check/npm test/check-docs/check-version）→ 问题清单（P0/P1/P2 分级，维度/文件:行/问题/建议）→ 通过统计 → 最终建议（可发版/需修复P0/需重大修复）。追加维度前先 grep 同类。

---

#### 59. resolve*Dir 调用方传参——禁止传 process.cwd() 给 overrideHome 参数（v1.2.2 F-39 新增）

> v1.2.1 把 data-paths.ts 的 resolveAuditDir/resolveKnowledgeDir/resolveDataDir 参数从 projectRoot 改为 overrideHome。6 个调用方没跟上，仍传 process.cwd()，导致运行时数据写进项目目录而非 ~/.sofagent/。

```bash
# 搜索所有传 process.cwd() 给 resolve*Dir 或 writeSessionReport 的地方（排除测试）
grep -rn "resolveAuditDir(process\|resolveKnowledgeDir(process\|resolveDataDir(process\|writeSessionReport.*process" engine/ --include="*.ts" | grep -v node_modules | grep -v dist | grep -v __tests__
# 期望：无输出（exit 1）
```

> **PASS 标准**：grep 结果为空，所有 resolve*Dir 调用方不传 process.cwd()。

---

#### 60. barrel re-export 一致性——新增导出 public-api.ts 和 index.ts 要同步（v1.2.2 F2 新增）

> P0 数据主权导出只在 public-api.ts，audit/src/index.ts 没同步 re-export，导致 daemon/mcp/orchestrator 的 tsc 报 TS2305。

```bash
# 对比 public-api.ts 和 index.ts 的 export 差异
diff <(grep "^export " engine/audit/src/public-api.ts | sort) <(grep "^export " engine/audit/src/index.ts | sort) | grep "^<"
# 期望：无差异行（或仅有 CLI-only 函数如 printResults 差异）
```

> **PASS 标准**：public-api.ts 的公共导出在 index.ts 中均有 re-export。

---

#### 61. 新功能必须有自动化测试——禁止零覆盖交付（v1.2.2 F1 新增）

> P0 数据主权 1504 行源码零测试交付，靠手动验证兜底。fresh-eyes 12 视角没覆盖"测试是否存在"这个维度。

```bash
# 对每个交付项，检查是否有对应测试文件
for mod in data-sovereignty report-generator report-template model-router; do
  count=$(find engine/ -name "${mod}*.test.ts" | grep -v node_modules | grep -v dist | wc -l)
  echo "$mod: $count test files"
done
# 期望：每个模块 ≥1 test file
```

> **PASS 标准**：每个交付模块至少有 1 个 test file，核心逻辑（写入/解析/路由）有自动化断言。
