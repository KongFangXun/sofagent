# sofagent 回归检查清单

> **用途**：每次发版前跑一遍，确认之前修过的问题没有回退。这不是"发现新问题"的工具——发现新问题用[发布后审查](./fresh-eyes-review.md)。
>
> **审查对象**：sofagent 仓库（main 分支）+ npm 包
> **审查范围**：全仓库状态检查（不是只看增量）——所有维度逐项核对

---

## 🔒 维护公约（防膨胀铁律）

**追加新维度前，必须先 grep 同类**：有同类 → 扩展旧维度的子项（用 `# 子项:` 注释分隔），不新增编号；无同类 → 才新增编号 = 当前最大 +1。历史维度靠 `git show 43fac89:docs/verification/regression-checklist.md` 找回。

**清单自身健康度自校验**（每次修改后跑）：
```bash
HEAD_VAL=$(grep -oE '审查维度（[0-9]+ 项' docs/verification/regression-checklist.md | grep -oE '[0-9]+')
ACTUAL=$(grep -c "^#### " docs/verification/regression-checklist.md)
[ "$HEAD_VAL" = "$ACTUAL" ] && echo "✅ 维度数一致 ($HEAD_VAL)" || echo "❌ 标题声称 $HEAD_VAL ≠ 实际 $ACTUAL"
```

---

## 你的身份

你是**回归测试工程师**——任务是确认已知的修复没有回退，不是发现新问题。逐项核对，全 PASS 即通过。

**⏰ 时序**：回归检查在 releasing.md 阶段四（审核）跑，此时 git tag / npm registry / 全局二进制版本 / 工作目录 clean 都还没到位——遇到这些检查项标 ⏳（待发版），不标 FAIL。

---

## 审查步骤

### 步骤 1：环境验证
```bash
cd /Users/kongfangxun/Workbuddy/sofagent
bash tools/pre-push-check.sh                    # 期望：N/N 全绿（项数随版本演进，以脚本尾部"共 N 项"为准）
# ⚠️ v1.1.4 教训：检查过程中如发现 check-docs.sh 把模板占位符（vX.Y.Z.md 类）当死链导致门禁不绿，
# 不要当"误报"忽略——占位符不是真死链，但门禁不绿就是发版诚信问题。
# 正解：要么 check-docs.sh 排除占位符，要么把模板里的占位符路径改成反引号包裹的纯文本。见维度 2 子项 c。
cd sofagent/audit && npm test && cd ../..        # 期望：全部 passed
node sofagent/core/dist/verify.js 2>&1 | tail -10  # 期望：无 FAIL（verify.js 不支持 --list，直接输出全量结果）
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

## 审查维度（24 项 · 编号 1–24）

> 2026-07-18 治理：从原 35 维度归并同类项而来。2026-07-18 追加维度 16-17（安全约束 + 发布产物验证）。2026-07-19 追加维度 23（独立产品声称一致性）+ 维度 24（验收测试覆盖率与时效性），扩展维度 2/4/6/7/8/9 子项（v1.1.4 审查发现）。

### 跨版本核心维度（每次必跑基线，不编号）

- **版本号全量一致**：`check-version.sh` → 0 不一致；`pre-push-check.sh` → 7/7 全绿
- **铁律措辞清零**：grep「建议/应该/尽量」→ 无输出
- **Skill 文件行数 ≤100**：每个文件 ≤100 行
- **测试数一致**：`tools/test-count.sh` 实测 audit/workspace 数与 FDE/LIMITATIONS/audit-README 声称一致（维度 13 SSOT 反查）
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

# 子项 c: 占位符死链豁免（v1.1.4 教训——check-docs.sh 曾把 releasing.md 的 vX.Y.Z.md 占位符当死链）
# 即使当前已修复（pre-push-check 17/17 全绿），仍需警惕回退——模板文件里的占位符路径易被死链扫描误判
grep -n "vX\.Y\.Z\|<.*>\.md\|EXAMPLE.*\.md" docs/verification/releasing.md docs/guides/*.md 2>/dev/null | head
# 人工检查：check-docs.sh 的死链扫描逻辑是否对占位符路径（含大写变量名/<>/{}/X.Y.Z）做豁免
# 若没有豁免规则 → 追加排除逻辑，或把模板里的占位符路径改成反引号包裹的纯文本（代码 span 不被当链接）
```

#### 3. 文档规范源与归属一致性

> 归并自：303+304

```bash
# 子项 a: think.md 始终为 Ledger/source
grep -rn "think.md.*Views\|think.md.*派生视图" docs/ARCHITECTURE.md docs/PHILOSOPHY.md docs/DEVELOPMENT.md FDE/FDE.md
# 期望：无匹配（若匹配 = P0）

# 子项 b: canonical source 一致性
grep -rn "Ledger-Views-Policy" docs/ARCHITECTURE.md docs/PHILOSOPHY.md docs/DEVELOPMENT.md | head
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

# 子项 d: ruleClass SSOT ↔ README 逐行 diff（v1.1.3 盲区，A6/A11 反复漂移）
diff <(grep -E "name:|ruleClass:" sofagent/audit/src/rules/index.ts | paste - - | sort) \
     <(grep -oE "A[0-9]+ .*  \|  (业务底线|能力拐杖|工程规范)" sofagent/audit/README.md | sort)
# 期望：零差异

# 子项 e: evidenceMode 计数对账（v1.1.4 暴露——README:169 声称 17 条 git-diff，实际 16 条）
ACTUAL_GITDIFF=$(grep -c "evidenceMode: 'git-diff'" sofagent/audit/src/rules/index.ts)
ACTUAL_HYBRID=$(grep -c "evidenceMode: 'hybrid'" sofagent/audit/src/rules/index.ts)
ACTUAL_FS=$(grep -c "evidenceMode: 'filesystem'" sofagent/audit/src/rules/index.ts)
echo "实际: git-diff=$ACTUAL_GITDIFF hybrid=$ACTUAL_HYBRID filesystem=$ACTUAL_FS"
grep -oE "[0-9]+ 条为纯 git-diff\|[0-9]+ 条纯 git-diff\|[0-9]+ 条需 Agent" README.md sofagent/audit/README.md 2>/dev/null
# 人工检查：README 声称的 git-diff/hybrid/filesystem 数量与 index.ts 实际计数一致

# 子项 f: audit/README.md 规则表完整性（v1.1.4 教训——A18/A19 新增后规则表漏更新）
# 规则表应覆盖所有已注册规则，不能漏新增规则
INDEX_COUNT=$(grep -cE "name:\s*'A[0-9]|name:\s*'E[0-9]" sofagent/audit/src/rules/index.ts)
README_TABLE_ROWS=$(grep -cE "^\| A[0-9]+ |^\| E[0-9]+ " sofagent/audit/README.md)
echo "index.ts 注册 $INDEX_COUNT 条 / audit/README 规则表 $README_TABLE_ROWS 行"
# 期望：两者相等（或 README 表行数 ≥ INDEX_COUNT，多出的属分多行展示）
# 若 README 表行数 < INDEX_COUNT → 新增规则没写进规则表（A18/A19 当年就这么漏的）

# 子项 g: MCP 工具描述规则数同步（v1.1.4 暴露——MCP run_audit 描述里的规则数要与 index.ts 一致）
INDEX_COUNT2=$(grep -cE "name:\s*'A[0-9]|name:\s*'E[0-9]" sofagent/audit/src/rules/index.ts)
grep "run_audit" sofagent/mcp/src/mcp-server.ts | grep -oE "[0-9]+ 条规则"
# 人工检查：MCP 描述里的数字 = index.ts 注册数
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

# 子项 c: .sh 脚本版本号扫描（v1.1.4 暴露——LOOP/loop-install.sh:3 写 v1.1.5 但发 v1.1.4）
# check-version.sh 只扫 .ts/.json/.md，不扫 .sh——install 脚本头部注释的版本号会漂移
grep -rn "v[0-9]\+\.[0-9]\+\.[0-9]\+" FDE/fde-install.sh LOOP/loop-install.sh sofagent/scripts/install.sh sofagent/scripts/verify.sh 2>/dev/null | grep -v "^.*:#" | head
# 只看非注释行的版本号（注释里的版本号也查，但要对照 SSOT）
grep -E "v[0-9]+\.[0-9]+\.[0-9]+" FDE/fde-install.sh LOOP/loop-install.sh | while read line; do
  echo "$line" | grep -q "v${SSOT_VER}" || echo "⚠️ 版本号非 SSOT: $line"
done
# 期望：所有 .sh 里的版本号 = SSOT_VER

# 子项 d: README 正文版本引用一致（v1.1.4 教训——正文残留旧版本号）
grep -oE "v1\.[0-9]+\.[0-9]+" README.md | sort | uniq -c
# 期望：只有一个版本号（= SSOT_VER），或多个但都在"历史变更说明"语境下
# 特别检查"当前版本（vX.Y.Z）"类声称：
grep -E "当前版本.*v[0-9]+\.[0-9]+\.[0-9]+\|当前版本（v[0-9]+\.[0-9]+\.[0-9]+）" README.md
# 期望：括号内版本号 = SSOT_VER
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

# 子项 c: MCP 返回值签名（v1.1.3 追加：所有 sendToolResult text 必须带 [sofagent]）
grep -rn 'sendToolResult' sofagent/mcp/src/mcp-server.ts | head -5
# 人工检查：每个 sendToolResult 的 text 字段开头必须以 [sofagent] 或 sofagent 开头
# 特别查 think.md 回读工具（get_think/write_think）的返回——这是感知层废墟高发区

# 子项 d: Webhook PASS 推送
grep -c "PASS" sofagent/audit/src/webhook.ts  # 应 > 0

# 子项 e: MCP capabilities 准确性
grep "run_audit" sofagent/mcp/src/mcp-server.ts | grep -c "21 条规则"  # 应 ≥ 1
grep "run_audit" sofagent/mcp/src/mcp-server.ts | grep -c "A1-A14"      # 应 = 0

# 子项 f: CLI stdout 签名一致性（v1.1.4 暴露——所有面向用户的判定行必须带 sofagent 身份）
# 感知层废墟高发区：用户跑了 sofagent 但输出里看不到 sofagent 名字 = 废墟功能
node sofagent/audit/dist/index.js --version 2>&1 | grep -q "sofagent" && echo "✅ --version 签名存在"
# 核心判定输出框（╔══╗ 那个）必须含 "sofagent-audit · vX.Y.Z"
grep -c "sofagent-audit.*v\|sofagent-audit ·" sofagent/audit/src/index.ts  # 期望：≥ 1
# 最终判定行（"判定: ✅/⚠️/❌ ..."）所在文件应同时输出"审计引擎: sofagent-audit vX.Y.Z"
grep -c "审计引擎.*sofagent-audit\|审计引擎:.*sofagent" sofagent/audit/src/index.ts  # 期望：≥ 1
# --doctor / --init / --timeline 的输出开头也要带 sofagent（不是裸的"检查完成"）
# 人工跑一次 --doctor 和 --init，确认输出能让人知道"这是 sofagent 在跑"
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

# 子项 c: --init 烟测期望值与实际 defaultRules 对齐（v1.1.4 教训——A19 加入后 --init 的"期望 12 项"类硬编码值易漂移）
# acceptance-test 里若写了 "期望 12 项检查" 之类，要和 index.ts 的 defaultRules.length 对齐
DEFAULT_COUNT=$(grep -cE "name:\s*'A[0-9]" sofagent/audit/src/rules/index.ts | head -1)
# 注：defaultRules 在 index.ts 前段，实际计法见维度 4
grep -nE "期望.*[0-9]+\s*项\|期望.*[0-9]+\s*条\|expected.*[0-9]+" tools/acceptance-test.sh | head
# 人工检查：acceptance-test 里所有"期望 N 项/条"的硬编码 N，是否与当前 index.ts 注册数一致
# 新增规则后必须同步更新 acceptance-test 的期望值——否则烟测永远失败或永远假绿
```

#### 9. 动态规则禁用逻辑 + 文档侧规则数声称一致性

> 原 312。v1.1.5 扩展：v1.1.4 加 A18/A19 时代码侧 knownKeys 同步了，但文档侧 6 个文档的"19 条 / A14-A17"声称全漏改（P0 发版诚信）。本维度现在覆盖**代码侧 + 文档侧**两个一致性面。

```bash
grep -c "a16\|a17" sofagent/core/src/config-loader.ts   # 期望: ≥ 2
grep -c "A16\|A17" sofagent/audit/src/rules/index.ts     # 期望: ≥ 2

# v1.1.4 追加：A18/A19 同步检查（v1.0.9 曾漏 A16/A17，v1.1.4 又漏 A18/A19——同类问题第三次复发）
# 每新增一条规则，config-loader.ts 的 knownKeys 集合必须同步更新
grep -c "a18\|a19" sofagent/core/src/config-loader.ts   # 期望: ≥ 2
grep -c "A18\|A19" sofagent/audit/src/rules/index.ts     # 期望: ≥ 2

# 实测验证：在 config.yml 禁用 a18，跑审计确认不误报"未知规则名"
# cd /tmp && mkdir -p test-knownkeys && cd test-knownkeys && git init -q
# printf 'extendedRulesEnabled: true\nrules:\n  a18: false\n' > .sofagent/config.yml
# node $REPO/sofagent/audit/dist/index.js --diff HEAD~1..HEAD 2>&1 | grep -i "未知"
# 期望：无"未知规则名 a18"告警

# 通用化检查（防同类问题第四次复发）：
# config-loader knownKeys 集合应 = index.ts 注册的所有规则号
INDEX_RULES=$(grep -oE "name:\s*'A[0-9]+" sofagent/audit/src/rules/index.ts | grep -oE "[0-9]+" | sort -n | tr '\n' ',')
KNOWN_KEYS=$(grep -A20 "knownKeys = new Set" sofagent/core/src/config-loader.ts | grep -oE "'a[0-9]+'" | tr -d "'a" | sort -n | tr '\n' ',')
echo "index.ts 注册: $INDEX_RULES"
echo "knownKeys 集合: $KNOWN_KEYS"
# 期望：两集合相等（knownKeys 应覆盖所有已注册规则号，可多于但不能少于）

# 子项: 文档侧规则数声称全仓同步（v1.1.5 追加——v1.1.4 加 A18/A19 时只改 README，
# HANDBOOK/DEVELOPMENT/FDE/LOOP 共 6 文档仍写"19 条 / A14-A17"，P0 发版诚信问题）
# 规则数变更时必须全仓 grep 所有"声称型"数字同步：规则总数 + 规则编号区间 + 各类规则数
SSOT_TOTAL=$(grep -cE "^\s*name:\s*'A[0-9]+" sofagent/audit/src/rules/index.ts)
SSOT_MAX=$(grep -oE "name:\s*'A[0-9]+" sofagent/audit/src/rules/index.ts | grep -oE "[0-9]+" | sort -n | tail -1)
echo "SSOT 规则总数: $SSOT_TOTAL / 最大编号: A$SSOT_MAX"
# 全仓扫描所有声称型数字（规则总数 + A14-A1X 区间）
grep -rnE "A1-A11、A14-A1[0-9]|[0-9]+ 条审计规则" --include="*.md" README.md README.en.md docs/ FDE/ LOOP/ ROADMAP.md 2>/dev/null | grep -v "regression-checklist\|fresh-eyes-review\|changelog/"
# 人工核对：每处声称的数字必须与 SSOT 一致。命中旧数字 = P0（check-version.sh 只查版本号不查规则数，门禁盲区）
# 已知历史漏改位置：README.md / docs/HANDBOOK.md / docs/DEVELOPMENT.md / docs/ARCHITECTURE.md / FDE/FDE.md / LOOP/LOOP.md
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

#### 13. 测试数声称一致性（SSOT 反查 · v1.1.5 扩）

> 原 309（只查 audit/README）。v1.1.4 暴露盲区：文档声称测试数与实测漂移
> （FDE.md 一度写 343、LIMITATIONS 写 660，实测 audit=388 / workspace 与文档声称漂移）。
> 现覆盖所有声称型位置，SSOT = vitest 实测（与 test-count.sh 同源）。

```bash
# SSOT：audit 包实测 + workspace 总数（test-count.sh 同源）
AUDIT=$(cd sofagent/audit && npx vitest run 2>&1 | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' | head -1)
WS=$(bash tools/test-count.sh --quiet 2>&1 | grep -oE 'TOTAL_TESTS=[0-9]+' | cut -d= -f2)
echo "SSOT → audit=$AUDIT  workspace=$WS"
# 逐文档核对 audit 数（出现 "N tests 全绿" 或 "N 个测试" 的位置）
for f in sofagent/audit/README.md FDE/FDE.md LIMITATIONS.md; do
  c=$(grep -oE '[0-9]+ tests 全绿|[0-9]+ 个测试' "$f" | grep -oE '[0-9]+' | head -1)
  [ "$c" = "$AUDIT" ] && echo "✅ $f audit=$c" || echo "❌ $f audit=$c ≠ SSOT $AUDIT"
done
# 核对 workspace 总数（"全 workspace N"）
for f in FDE/FDE.md LIMITATIONS.md; do
  c=$(grep -oE '全 workspace [0-9]+' "$f" | grep -oE '[0-9]+' | head -1)
  [ "$c" = "$WS" ] && echo "✅ $f workspace=$c" || echo "❌ $f workspace=$c ≠ SSOT $WS"
done
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

### 安全约束（v1.1.3 追加）

#### 16. 安全约束 fail-closed 与权限加固

> 归并自：v1.1.3 审查建议——A15 actions 绕过 + .sofagent 权限 + A/B promote 守卫

```bash
# 子项 a: A15 actions 未声明时必须 FAIL（非 fail-open WARN）
# 防御：Agent 通过"不声明 actions"绕过所有约束检查
grep -n "nodesWithActions.length === 0\|nodesWithActions.length === 0" sofagent/audit/src/rules/rule-a15-action-constraint.ts
# 人工检查：该分支返回 FAIL 或 WARN。返回 PASS = P0 安全红线违反

# 子项 b: .sofagent/ 子目录权限 700
ls -ld .sofagent .sofagent/audit .sofagent/task 2>/dev/null
# 期望：drwx------（700）。drwxr-xr-x（755）= P1，审计日志目录权限过宽

# 子项 c: A/B promote 守卫——overallImprovement > 0
grep -n "overallImprovement\|decidePromotion" sofagent/ab-test/src/*.ts 2>/dev/null
# 人工检查：decidePromotion() 必须有 overallImprovement > 0 守卫
# 防御：窄 eval 集连胜 2 次即晋升更差版本
```

---

### 发布产物验证（v1.1.3 追加）

#### 17. npm 产物 + bin 权限 + tag commit message

> 归并自：v1.1.3 审查建议——bin 执行权限 + npm registry 与工作树一致性 + tag commit msg

```bash
# 子项 a: bin 文件执行权限（doctor/verify 不可用风险）
for pkg in audit core orchestrator daemon mcp; do
  bin=$(node -e "const p=require('./sofagent/$pkg/package.json'); console.log(Object.keys(p.bin||{}).map(k=>p.bin[k]).join(' '))" 2>/dev/null)
  for b in $bin; do
    [ -x "sofagent/$pkg/$b" ] || ls -la "sofagent/$pkg/$b" 2>/dev/null | grep -q '^-.x' || echo "❌ $pkg/$b 无执行权限"
  done
done

# 子项 b: npm registry 版本 vs git tag vs 工作树三方一致
NPM_VER=$(npm view @sofagent/audit version 2>/dev/null)
SSOT_VER=$(node -e "console.log(require('./sofagent/audit/package.json').version)")
TAG_VER=$(git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//')
echo "npm=$NPM_VER ssot=$SSOT_VER tag=$TAG_VER"
# 期望：三者一致。npm < ssot = 工作树修复未发布（P0）

# 子项 c: tag 指向的 commit message 含版本号（v1.1.3 盲区——tag 自身 msg 对但 commit msg 错）
git tag -l "v*" | while read t; do
  v=$(echo $t | sed 's/^v//')
  msg=$(git log -1 --format=%s $t^{commit})
  echo "$msg" | grep -q "$v" || echo "❌ $t: commit message 不含 $v — $msg"
done

# 子项 d: 发版前工作树 clean
git diff --quiet || echo "⚠️ 工作树有未提交修改——发版前必须 commit"
```

### 审计规则扩展（v1.1.4 追加）

#### 18. A19 commit message 质量

| 检查项 | 验证方式 |
|--------|----------|
| message 长度 < 8 字符 → FAIL | `grep -c "MIN_LENGTH = 8" sofagent/audit/src/rules/rule-a19-commit-msg-quality.ts` |
| 黑名单 8 词（add/fix/test/update/change/wip/tmp/asdf）→ FAIL | `grep -c "BLACKLIST" sofagent/audit/src/rules/rule-a19-commit-msg-quality.ts` |
| 黑名单优先于长度检查 | `grep -A 2 "检查 1：黑名单" sofagent/audit/src/rules/rule-a19-commit-msg-quality.ts \| grep "优先"` |
| A19 在 defaultRules（始终生效） | `grep "A19" sofagent/audit/src/rules/index.ts \| head -1` |
| critical 层阻断序列含 A19 | `grep -c "A19" sofagent/audit/src/rules/runner.ts` |
| 空 message 降级 PASS（不误杀） | `grep "!commitMsg \|\| !commitMsg.trim" sofagent/audit/src/rules/rule-a19-commit-msg-quality.ts` |
| ruleClass = 业务底线 | `grep "业务底线" sofagent/audit/src/rules/rule-a19-commit-msg-quality.ts` |

```bash
# 验证命令
grep "MIN_LENGTH = 8" sofagent/audit/src/rules/rule-a19-commit-msg-quality.ts
grep "BLACKLIST.*=.*\[" sofagent/audit/src/rules/rule-a19-commit-msg-quality.ts
# 期望：两者都存在
```

#### 19. A18 垃圾文件检测

| 检查项 | 验证方式 |
|--------|----------|
| 3 组正则模式（单字母/临时前缀/可疑命名） | `grep -c "JUNK_PATTERNS" sofagent/audit/src/rules/rule-a18-junk-file.ts` |
| 豁免规则（测试目录 + .test.ts/spec.ts 后缀） | `grep -c "isExempt" sofagent/audit/src/rules/rule-a18-junk-file.ts` |
| 不区分 file.status（modified 也告警——v1.1.4 审查修正） | `grep -c "isExempt(file.path)" sofagent/audit/src/rules/rule-a18-junk-file.ts` |
| A18 在 extendedRules（需 config 开启） | `grep "A18" sofagent/audit/src/rules/index.ts \| tail -1` |
| extended 优先级 A18 排在 A17 之后 | `grep "A18" sofagent/audit/src/rules/runner.ts` |
| 只产生 WARN 不产生 FAIL | `grep "\"WARN\"" sofagent/audit/src/rules/rule-a18-junk-file.ts` |

### daemon 可见性（v1.1.4 追加）

#### 20. daemon plist + watch.yml 正确性

| 检查项 | 验证方式 |
|--------|----------|
| plist ProgramArguments = sofagent-daemon（不再调 sofagent-audit --daemon） | `grep "sofagent-daemon" ~/Library/LaunchAgents/com.sofagent.daemon.plist` |
| plist WorkingDirectory = 项目目录（非 $HOME） | `grep "Workbuddy/sofagent" ~/Library/LaunchAgents/com.sofagent.daemon.plist` |
| --init 生成 watch.yml | `test -f .sofagent/watch.yml && grep "paths:" .sofagent/watch.yml` |
| daemon 日志无 "不支持的参数 --daemon" | `! grep -q "不支持的参数.*--daemon" ~/.sofagent/daemon.log` |
| daemon 运行时监控目录正确 | `tail -20 ~/.sofagent/daemon.log \| grep "监控目录"` |

### LOOP 工具注入（v1.1.4 追加）

#### 21. LOOP 工具注入 + 硬约束

| 检查项 | 验证方式 |
|--------|----------|
| maxTurns 常量（v1.1.5 拆分） | `grep "DEFAULT_ENGINEER_MAX_TURNS = 20" sofagent/orchestrator/src/loop/nodes.ts` + `grep "DEFAULT_REVIEWER_MAX_TURNS = 15" sofagent/orchestrator/src/loop/nodes.ts` |
| engineer 使用 ENGINEER_TOOLS（6 个） | `grep "ENGINEER_TOOLS" sofagent/orchestrator/src/loop/nodes.ts` |
| reviewer 使用 REVIEWER_TOOLS（3 个，只读） | `grep "REVIEWER_TOOLS" sofagent/orchestrator/src/loop/nodes.ts` |
| WARN verdict 写入 audit history（三态全写） | `grep -c "recordLoopAuditHistory" sofagent/orchestrator/src/loop/nodes.ts` |
| maxTurns 注入（resolveMaxTurns 函数） | `grep "maxTurns: resolveMaxTurns" sofagent/orchestrator/src/loop/nodes.ts` |
| run_bash 高危命令黑名单（5 类） | `grep -c "checkDangerousCommand" sofagent/orchestrator/src/tools.ts` |
| warn-accumulator 真正连续性（遇 PASS/FAIL 中断） | `grep "break.*连续中断" sofagent/daemon/src/inspectors/warn-accumulator.ts` |
| USB federation 基础检测（SOFAGENT 卷标） | `grep "SOFAGENT_LABEL" sofagent/daemon/src/usb-detect.ts` |
| USB federation 签名校验标注为 v1.1.5+ | `grep "无签名校验\|v1.1.5" SECURITY.md` |
| USB federation HMAC 实现（v1.1.5 新增） | `grep "createHmac\|timingSafeEqual\|mode: 0o600\|applyFederation" sofagent/daemon/src/usb-detect.ts` |
| MCP audit_file pipe（v1.1.5 新增） | `grep "audit_file\|auditEngine" sofagent/mcp/src/mcp-server.ts` |
| MCP list_capabilities 能力清单（v1.1.5 新增） | `grep "list_capabilities\|search_knowledge\|read_entity\|stats" sofagent/mcp/src/mcp-server.ts` |
| daemon push-target 5 种路由（v1.1.5 新增） | `grep "webhook:dingtalk\|webhook:feishu\|webhook:wecom\|openclaw:im\|daemon:notice" sofagent/daemon/src/push-target.ts` |
| orchestrator --mode 参数（v1.1.5 新增） | `grep "parseSubagentRunArgs\|--mode" sofagent/orchestrator/src/cli-args.ts` |
| sofagent-releaser Skill 复制契约（v1.1.5 新增） | `grep "sofagent-releaser" sofagent/scripts/lib/file-deploy.sh FDE/fde-install.sh LOOP/loop-install.sh` |

```bash
# 验证命令（v1.1.5 重构：DEFAULT_ENGINEER_MAX_TURNS=20 + DEFAULT_REVIEWER_MAX_TURNS=15 + resolveMaxTurns）
grep "DEFAULT_ENGINEER_MAX_TURNS = 20" sofagent/orchestrator/src/loop/nodes.ts
grep "DEFAULT_REVIEWER_MAX_TURNS = 15" sofagent/orchestrator/src/loop/nodes.ts
grep "maxTurns: resolveMaxTurns" sofagent/orchestrator/src/loop/nodes.ts
grep "checkDangerousCommand" sofagent/orchestrator/src/tools.ts
grep "recordLoopAuditHistory" sofagent/orchestrator/src/loop/nodes.ts
# v1.1.5 追加：USB HMAC + MCP audit_file + list_capabilities + push-target + cli --mode + releaser
grep -c "createHmac\|timingSafeEqual\|mode: 0o600\|applyFederation" sofagent/daemon/src/usb-detect.ts  # 期望：≥4
grep -c "audit_file\|auditEngine" sofagent/mcp/src/mcp-server.ts  # 期望：≥2
grep -c "list_capabilities\|search_knowledge\|stats" sofagent/mcp/src/mcp-server.ts  # 期望：≥3
grep -c "webhook:dingtalk\|webhook:wecom\|daemon:notice" sofagent/daemon/src/push-target.ts  # 期望：≥3
grep -c "parseSubagentRunArgs" sofagent/orchestrator/src/cli-args.ts  # 期望：≥1
grep -l "sofagent-releaser" sofagent/scripts/lib/file-deploy.sh FDE/fde-install.sh LOOP/loop-install.sh 2>/dev/null | wc -l  # 期望：3
# 期望：全部存在
```

## 审查约束

- **版本号全量一致**——`check-version.sh` 0 不一致，`pre-push-check.sh` 7/7 全绿
- **铁律措辞必须用 grep 验证**——不能凭感觉
- **Skill 文件行数 ≤100**——每次发版必须验证
- **CHANGELOG 纯度**——只写产品变更，不含审查元信息
- **测试数一致**——FDE/LIMITATIONS/audit-README 声称数与 test-count.sh 实测一致（维度 13 SSOT 反查）
- **安全约束 fail-closed**——A15 未声明 actions 时必须 FAIL 或 WARN（v1.1.3 追加）
- **npm 产物三方一致**——npm registry = SSOT = git tag = 工作树 clean（v1.1.3 追加）

---

### 发版流程（v1.1.4 阶段六暴露）

#### 22. plist 不被外来 --init 覆盖

| 检查项 | 验证方式 |
|--------|----------|
| plist WorkingDirectory 指向当前项目 | `grep "Workbuddy/sofagent" ~/Library/LaunchAgents/com.sofagent.daemon.plist` |
| plist ProgramArguments = sofagent-daemon（不复古） | `grep "sofagent-daemon" ~/Library/LaunchAgents/com.sofagent.daemon.plist` |
| daemon 进程正常运行（非 exit 78） | `launchctl list \| grep sofagent \| awk '{print $2}'` 期望 = 0 |
| 验收测试后 plist 未被污染 | 跑完 acceptance-test.sh 后重复上述检查，期望不变 |

```bash
# 验证命令
grep "Workbuddy/sofagent" ~/Library/LaunchAgents/com.sofagent.daemon.plist
launchctl list | grep sofagent | awk '{print $2}'
# 期望：第一行有匹配，第二行 = 0
```

---

### 独立产品声称一致性（v1.1.4 追加）

#### 23. FDE/LOOP 跨产品声称一致性

> v1.1.4 暴露：FDE/LOOP 声称"独立产品"，但文档里步数、Agent 数、CLI 子命令、版本号、跨产品 install 契约存在多处矛盾。grep 无同类，新增维度。

```bash
# 子项 a: FDE 步数跨文档一致（v1.1.4 已修复，固化防回退）
# 三处声称：FDE/SKILL.md（阶段+步数）/ FDE/README.md（12 步）/ FDE/FDE.md（4 阶段 12 步）
grep -oE "[0-9]+ 个阶段|[0-9]+ 个关键步骤|[0-9]+ 步" FDE/SKILL.md FDE/README.md FDE/FDE.md 2>/dev/null | sort | uniq -c
# 期望：步数声称一致（目前 = 4 阶段 12 步）

# 子项 b: LOOP Agent 数跨文档一致（v1.1.4 暴露——quick-start 说 3、README 列 2、实际装 4）
ACTUAL_AGENTS=$(ls agents/SKILL/sofagent-* -d 2>/dev/null | wc -l)
echo "实际安装 Agent 数: $ACTUAL_AGENTS"
grep -oE "[0-9]+ 个内置 Agent\|[0-9]+ 个 Agent" LOOP/SKILL.md LOOP/README.md LOOP/quick-start.md 2>/dev/null
# 人工检查：文档声称的数字与实际安装数一致。LOOP 核心流程用 engineer+audit+reviewer，
# 但 agents/SKILL/ 下还装了 sofagent-fde——文档要说清"3 个 LOOP 核心 + 1 个 FDE 共用"

# 子项 c: 跨产品 install.sh 契约稳定性（v1.1.4 暴露——FDE/LOOP 调主 install.sh 无契约文档）
grep -n "sofagent/scripts/install.sh\|PROJECT_ROOT.*install.sh" FDE/fde-install.sh LOOP/loop-install.sh
# 人工检查：这个跨产品调用接口（路径/参数/退出码/依赖文件位置）有没有契约文档？
# 主 install.sh 改了 --platform 参数命名或输出路径，会不会悄悄打断 FDE/LOOP？
# 建议有 pin commit 或契约文档。若都没有，至少在 install.sh 头部注释标注"被 FDE/LOOP 依赖"

# 子项 d: 独立 install 闭环（v1.1.4 暴露——只 clone FDE/ 子目录能否跑通 fde-install.sh）
# FDE/fde-install.sh:52 调 $PROJECT_ROOT/sofagent/scripts/install.sh
# LOOP/loop-install.sh:54 调 $PROJECT_ROOT/sofagent/scripts/install.sh
# 如果用户只 clone 了 FDE/ 或 LOOP/ 子目录，绝对跑不通——"独立产品"声称打折
# 人工验证：在仅含 FDE/ 的环境跑 bash fde-install.sh，记录失败点
# 文档应诚实标注"需要完整 clone 仓库"或提供独立安装包

# 子项 e: install 脚本版本号 = SSOT（v1.1.4 暴露——loop-install.sh:3 写 v1.1.5 但发 v1.1.4）
SSOT_VER=$(node -e "console.log(require('./package.json').version)")
grep -H "v[0-9]\+\.[0-9]\+\.[0-9]\+" FDE/fde-install.sh LOOP/loop-install.sh | head -4
# 期望：所有 .sh 头部版本号 = SSOT_VER
```

---

### 验收测试覆盖率与时效性（v1.1.4 追加，v1.1.5 合并更新）

#### 24. acceptance-test.sh 与 changelog 功能对齐（单文件）

> v1.1.5 更新：原 `docs/verification/openclaw-acceptance-test.md` 已合并入 `tools/acceptance-test.sh`（79 场景），不再有两份验收测试文件。以下检查全部针对 `acceptance-test.sh` 单文件。

```bash
# 子项 a: 场景数声称与实际对齐（v1.1.4 教训——acceptance-test.sh 头部声明场景数但 grep 实际场景数不一致）
DECLARED_COUNT=$(head -5 tools/acceptance-test.sh | grep -oE "[0-9]+ 个端到端" | grep -oE "[0-9]+")
ACTUAL_COUNT=$(grep -c "^scenario " tools/acceptance-test.sh)
echo "声明: $DECLARED_COUNT / 实际: $ACTUAL_COUNT"
# 期望：两者相等。acceptance-test.sh 头部第 4 行的场景数必须与 grep '^scenario ' 的实际数一致

# 子项 b: 本版本 changelog 功能点逐条对照 acceptance-test 覆盖
# 读 docs/changelog/vX.Y.md 的「核心变更/交付」章节，提取每条功能关键词
# 逐条 grep tools/acceptance-test.sh
# 例：v1.1.4 新增 A18 → grep A18 acceptance-test.sh，期望有场景
CHANGELOG_FEATURES=$(grep -E "^### |^## 交付" docs/changelog/v$(node -e "console.log(require('./package.json').version)").md | head -20)
echo "$CHANGELOG_FEATURES"
# 人工检查：每个功能点在 acceptance-test.sh 里都有对应场景。
# 零覆盖 = P0（验收测试无法发现本版本功能的回归）

# 子项 c: 失效场景清理（acceptance test 里的旧命令/旧路径）
# 代码演进后，旧场景可能引用已废弃的 CLI 子命令或已迁移的文件路径——跑起来必然 FAIL
# 例：sofagent-audit --daemon（v1.1.4 废弃）、workflow-hub/（v1.1.4 更更名为 FLOWHUB/）
grep -rn "sofagent-audit --daemon\|workflow-hub/" tools/acceptance-test.sh
# 期望：零命中。命中 = 场景引用了已废弃命令/已迁移路径，必然 FAIL

# 子项 d: acceptance-test.sh 场景间清理健壮性（v1.1.3 教训——scenario() 函数的清理逻辑）
# 每个 scenario() 调用都应清理上一场景的残留（git reset + rm .env + unstage）
# v1.1.3 曾出现 scenario 间 .env 残留导致后续场景误判
grep -A5 "^scenario()" tools/acceptance-test.sh | grep -c "git rm --cached -f .env\|git reset --hard"
# 期望：≥ 1（scenario 函数含清理逻辑）

# 子项 e: JSON 输出场景的 stderr 隔离（v1.1.5 追加——场景 6/26 教训）
# 所有用 --json 模式的 acceptance-test 场景，必须用 2>/dev/null 丢弃 stderr，
# 不能用 2>&1 合并——config-loader.ts:146 的 console.warn 会污染 JSON 首行。
# v1.1.5 实证：场景 6/26 用 2>&1，临时空目录触发 config 警告，python3 json.load() 失败
grep -n "\-\-json.*2>&1\|2>&1.*\-\-json" tools/acceptance-test.sh
# 期望：零命中（所有 --json 场景都用 2>/dev/null）
# 同理扫描 --format json
grep -n "format json.*2>&1\|2>&1.*format json" tools/acceptance-test.sh
# 期望：零命中
```

---

## 输出报告格式

```markdown
# sofagent 回归检查报告

## 总览
- 审查日期 / 审查范围（23 维度 + 跨版本核心维度）
- 环境验证：pre-push-check / npm test / check-docs / check-version / Fresh clone 各项 [✅/❌]
- 整体结论：[已发布无遗留 / 需修复后补发 / 阻塞]

## 问题清单（按 P0/P1/P2 分级，列：维度 / 文件:行 / 问题 / 建议）

## 维度通过统计
- 通过：X / ⚠️：X / ❌：X / 🔴 P0：X / 🟡 P1：X / 🟢 P2：X

## 最终建议
- [ ] 可以发版 / [ ] 需修复 P0 后发版 / [ ] 需重大修复

## 审查体系更新建议
> 追加前请先 grep 同类维度（见维护公约）。有同类则扩展旧维度的子项，不新增编号。
```
