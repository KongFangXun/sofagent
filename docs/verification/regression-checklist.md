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

**⏰ 时序**：回归检查在 releasing.md 阶段六（acceptance-test + regression-checklist）跑，此时 git tag / npm registry / 全局二进制版本 / 工作目录 clean 都还没到位——遇到这些检查项标 ⏳（待发版），不标 FAIL。

---

> **🔍 环境依赖标注（v1.1.6+）**
> 以下维度依赖真实环境（需装 npm / 需真跑 git 仓库 / 需 OpenClaw），AI 审查环境难自动化执行，每次跑时标 `需人工环境`：
> - 维度 5（exit code 实跑）· 维度 7 子项 f（--doctor/--init 输出）· 维度 17 子项 a/b（bin 权限 + npm registry 三方一致）· 维度 20（daemon plist）· 维度 22（plist 不被覆盖）
> - 这些维度在 AI 审查中可标 `⏸️ 需人工环境`，不重复列在每次审查报告里。人工审查时必跑。

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

## 审查维度（38 项 · 编号 1–38）

> 2026-07-18 治理：从原 35 维度归并同类项而来。2026-07-18 追加维度 16-17（安全约束 + 发布产物验证）。2026-07-19 追加维度 23（独立产品声称一致性）+ 维度 24（验收测试覆盖率与时效性），扩展维度 2/4/6/7/8/9 子项（v1.1.4 审查发现）。2026-07-20 追加维度 29-38（v1.1.7：Dream Cycle / sensitivity / knowledge-health / knowledge-status / ActionGovernance / 文档时效性 / 产品关系 / red-team / 安全文档）。

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

# 子项 b: 「回溯引擎」诚实化检查（v1.1.6 更新——不要求零命中，只要求有诚实说明）
# 「回溯引擎」后应跟"本质：git snapshot"或已改为「回溯能力」
grep -rn "回溯引擎" --include="*.md" . | grep -v node_modules | grep -v ".sofagent/" | grep -v "docs/changelog" | grep -v "CHANGELOG.md" | grep -v ".workbuddy/" | grep -v "regression-checklist.md" | grep -v "git snapshot\|revert 包装\|本质"
# 期望：零命中（所有保留「回溯引擎」的地方都附了诚实说明；改为「回溯能力」的使用不用匹配）

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

# 子项 f: README 对核心文档的链接可发现性（v1.1.6 教训——llm-wiki-mapping.md 存在但 README 零引用）
grep -c "llm-wiki-mapping" README.md   # 期望: ≥ 1
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
# 自动对账（v1.1.6）：从 README 提取声称的 git-diff/hybrid/filesystem 数量，与 index.ts 实际计数比对
README_GD=$(grep -hoE "[0-9]+ 条为纯 git-diff" README.md sofagent/audit/README.md 2>/dev/null | grep -oE "^[0-9]+" | head -1)
README_HY=$(grep -hoE "[0-9]+ 条 hybrid" README.md sofagent/audit/README.md 2>/dev/null | grep -oE "^[0-9]+" | head -1)
README_FS=$(grep -hoE "[0-9]+ 条 filesystem" README.md sofagent/audit/README.md 2>/dev/null | grep -oE "^[0-9]+" | head -1)
if [ -n "$README_GD" ] && [ -n "$README_HY" ] && [ -n "$README_FS" ]; then
  if [ "$README_GD" = "$ACTUAL_GITDIFF" ] && [ "$README_HY" = "$ACTUAL_HYBRID" ] && [ "$README_FS" = "$ACTUAL_FS" ]; then
    echo "  ✅ evidenceMode 计数一致（git-diff=$ACTUAL_GITDIFF hybrid=$ACTUAL_HYBRID filesystem=$ACTUAL_FS）"
  else
    echo "  ❌ evidenceMode 不一致: README 声称 git-diff=$README_GD hybrid=$README_HY fs=$README_FS；实际 git-diff=$ACTUAL_GITDIFF hybrid=$ACTUAL_HYBRID fs=$ACTUAL_FS"
  fi
else
  echo "  ⚠️ 未在 README 找到 evidenceMode 计数声称，跳过自动对账（人工核对）"
fi

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

# 子项 d: check-version 文案扫描 baseline 用真实正则计算（v1.1.6 教训——曾输出 defaultRules.length=17 实为 13）
# 防御：工具自身的 SSOT 标签误导会让审查者误信
EXPECTED_DEFAULT=$(awk '/export const defaultRules/{f=1; next} f && /^[[:space:]]*\{.*name:/{c++} f && /^[[:space:]]*\];/{exit} END{print c+0}' sofagent/audit/src/rules/index.ts)
REPORTED_DEFAULT=$(bash tools/check-version.sh 2>&1 | grep -oE "defaultRules.length=[0-9]+" | grep -oE "[0-9]+")
echo "期望=$EXPECTED_DEFAULT 报告=$REPORTED_DEFAULT"
# 期望：两者相等。不相等 = check-version 的正则有 bug

# 子项 e: acceptance-test.sh 自身 JSON 输出不被 stderr 污染（v1.1.5 教训——stderr 的 config.yml 警告污染 JSON 首行）
grep -E "\-\-json.*2>&1|2>&1.*\-\-json" tools/acceptance-test.sh   # 期望：零命中（场景 6/26 已用 2>/dev/null）
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

# 子项: 规则定义字段完整性（v1.1.6 教训——规则定义突然丢失字段）
# 每条规则应有 name + ruleClass 两字段，21 规则 × 2 = 42
FIELD_COUNT=$(grep -oE "name:|ruleClass:" sofagent/audit/src/rules/index.ts | wc -l | tr -d ' ')
echo "字段出现次数: $FIELD_COUNT（期望 42 = 21 规则 × 2 字段）"
# 期望：42。name: 与 ruleClass: 同行时 grep -c 按行计=21 会误报，必须用 -o 按匹配计

# 子项: evidenceMode 计数一致性（v1.1.4 教训——声称 17 实际 16）
# index.ts 里 evidenceMode 字段数 = README/audit-README 声称的分类数（16 git-diff + 4 hybrid + 1 filesystem = 21）
EXPECTED_EM=$(grep -cE "evidenceMode:" sofagent/audit/src/rules/index.ts)
echo "evidenceMode 字段数: $EXPECTED_EM（期望 21，与 README 声称分类数一致）"
# 建议未来自动化入 pre-push-check（本项当前为人工核对）
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

# 子项: changelog 规划中标注（v1.1.6 教训——未来版本 changelog 忘了标"规划中"会被误认为已发版）
for f in docs/changelog/v*.md; do
  v=$(basename "$f" .md)
  git rev-parse "$v" >/dev/null 2>&1 || echo "⚠️ $v: 规划中"
done
# 期望：输出仅含 v1.1.7+ 等未来版本（已正确标注"规划中"）。若输出含已发版版本号 = 漏标规划中
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

#### 13. 测试数声称一致性（SSOT 反查 · v1.1.6 扩）

> 原 309（只查 audit/README）。v1.1.4 暴露盲区：文档声称测试数与实测漂移
> （FDE.md 一度写 343、LIMITATIONS 写 660，实测 audit=388 / workspace 与文档声称漂移）。
> 现覆盖所有声称型位置，SSOT = vitest 实测（与 test-count.sh 同源）。

```bash
# SSOT：audit 包实测 + workspace 总数（test-count.sh 同源）
AUDIT=$(cd sofagent/audit && npx vitest run 2>&1 | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' | head -1)
WS=$(bash tools/test-count.sh --quiet 2>&1 | grep -oE 'TOTAL_TESTS=[0-9]+' | cut -d= -f2)
echo "SSOT → audit=$AUDIT  workspace=$WS"
# 逐文档核对 audit 数
# v1.1.6 调整：文档若已改为「见 test-count.sh」引用（去硬编码），则跳过数字反查，确认 SSOT 引用存在即可
for f in sofagent/audit/README.md FDE/FDE.md LIMITATIONS.md; do
  if grep -q "test-count.sh" "$f"; then
    echo "✅ $f 已 SSOT 化（引用 test-count.sh，跳过数字反查）"
    continue
  fi
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

# 子项 e: 全量历史 tag commit message 含版本号（v1.1.6+ 自动化 · pre-push-check 步骤 7 扩展）
# 防御：v1.1.5 等历史 tag 曾缺版本号。非 HEAD 历史 tag 一律 WARN 豁免，HEAD tag 不含版本号 → FAIL
git tag -l "v1.*" | while read t; do
  v=$(echo $t | sed 's/^v//')
  msg=$(git log -1 "$t^{commit}" --format=%s 2>/dev/null)
  hc=$(git rev-parse "$t^{commit}" 2>/dev/null)
  hhead=$(git rev-parse HEAD 2>/dev/null)
  if ! echo "$msg" | grep -q "$v"; then
    if [ "$hc" = "$hhead" ]; then echo "❌ $t: 当前发版 tag commit msg 不含 $v"; else echo "⚠️ $t: 历史污点（已豁免）"; fi
  fi
done
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
# v1.1.6 自动化：检查 FDE/LOOP install.sh 仍依赖主 install.sh（契约未变），且文档已诚实标注"需完整 clone"
FDE_DEP=$(grep -c "sofagent/scripts/install.sh" FDE/fde-install.sh 2>/dev/null || echo 0)
LOOP_DEP=$(grep -c "sofagent/scripts/install.sh" LOOP/loop-install.sh 2>/dev/null || echo 0)
echo "FDE 依赖主 install.sh: $FDE_DEP 处 / LOOP 依赖: $LOOP_DEP 处"
CLONE_NOTE=$(grep -rliE "完整 clone|完整仓库|需要.*sofagent.*仓库|clone.*完整" FDE/README.md FDE/SKILL.md LOOP/README.md 2>/dev/null | head -1 || true)
if [ -n "$CLONE_NOTE" ]; then
  echo "  ✅ 文档已标注完整 clone 要求（$CLONE_NOTE）"
else
  echo "  ⚠️ 未在 FDE/LOOP 文档找到『需完整 clone』诚实标注——独立产品声称可能误导（人工确认）"
fi
grep -q "被 FDE/LOOP 依赖\|FDE/LOOP" sofagent/scripts/install.sh 2>/dev/null \
  && echo "  ✅ 主 install.sh 已标注被 FDE/LOOP 依赖" \
  || echo "  ⚠️ 主 install.sh 未标注被 FDE/LOOP 依赖（建议在头部注释补充契约说明）"

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
> ℹ️ 本子项属「文档数字漂移」类，单一 SSOT 见维度 13（测试数）+ 维度 4（规则数/evidenceMode）。acceptance 场景数对齐保留在此因 acceptance-test.sh 是独立产物。

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
# 例：sofagent-audit --daemon（v1.1.4 废弃）、模板市场/（v1.1.4 更名，已 revert 回 work模板市场/）
grep -rn "sofagent-audit --daemon\|模板市场/" tools/acceptance-test.sh
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

#### 25. conflict-check 巡检器只读铁律 + schedule 正确性（v1.1.6 新增）

```bash
# 子项 a: fail-closed 只读——源码零写操作（排除注释）
grep -n "writeFile\|writeFileSync\|unlink\|rmSync" \
  sofagent/daemon/src/inspectors/conflict-check.ts | grep -v "^.*\/\/"
# 期望：零命中（只在注释中提及"绝不调用"属合规，>0 = P0）

# 子项 b: schedule = @weekly（非 @daily）
grep -A1 "'conflict-check'" sofagent/daemon/src/inspectors/index.ts | grep -c "@weekly"
# 期望：≥1

# 子项 c: runInspectors 调用链包含 conflict-check
grep -c "checkConflict\|conflict-check" sofagent/daemon/src/inspectors/index.ts
# 期望：≥3（DEFAULT_INSPECTOR_CONFIG + runInspectors + export）

# 子项 d: 空 knowledge 目录优雅降级（真实环境跑一次）
node -e "
const {checkConflict} = require('./sofagent/daemon/dist/inspectors/conflict-check.js');
const r = checkConflict(process.cwd());
if (r.triggered) throw new Error('Expected triggered:false but got true');
if (r.severity !== 'info') throw new Error('Expected info');
console.log('OK');
"
# 期望：OK
```

#### 26. llm-wiki-mapping.md 存在 + 内容完整性（v1.1.6 新增）

```bash
# 子项 a: 文档存在
[ -f docs/llm-wiki-mapping.md ] && echo "EXISTS" || echo "MISSING"

# 子项 b: 三层映射齐全
grep -c "Ledger\|Views\|Policy" docs/llm-wiki-mapping.md
# 期望：≥3

# 子项 c: 数据流图存在（mermaid）
grep -c "mermaid\|flowchart" docs/llm-wiki-mapping.md
# 期望：≥1

# 子项 d: ROADMAP v1.1.6 行链接到文档
grep -c "llm-wiki-mapping.md" ROADMAP.md
# 期望：≥1

# 子项 e: 文档不重新定义三层（引用 PHILOSOPHY §五 为权威源）
grep -c "唯一权威\|不重新定义\|PHILOSOPHY.md.*§五" docs/llm-wiki-mapping.md
# 期望：≥1
```

---

#### 27. pre-push-check shellcheck 扫描范围与 CI 一致性（v1.1.6 新增）

> v1.1.6 教训：`LOOP/` 有 `.sh` 但 pre-push-check 的 shellcheck `find` 只扫了 `sofagent/scripts tools FDE`——CI 的 `shellcheck.yml` 扫全仓抓住了 SC2155，本地门禁却放行。本地 shellcheck 版本 v0.10.0 与 CI v0.11.0 不一致也导致判定差异。

```bash
# 子项 a: pre-push-check 的 find 命令含全部含 .sh 的目录
# 对比 CI .github/workflows/shellcheck.yml 的 files 配置，确保一致
FIND_LINE=$(grep "find.*\.sh" tools/pre-push-check.sh)
echo "当前扫描范围: $FIND_LINE"

# 子项 b: 确认 LOOP/ 在扫描范围内（v1.1.6 补上后的基线）
echo "$FIND_LINE" | grep -q "LOOP" && echo "LOOP 已纳入扫描" || echo "❌ LOOP 漏扫"

# 子项 c: CI shellcheck.yml 是否存在
[ -f .github/workflows/shellcheck.yml ] && echo "CI 配置存在" || echo "❌ CI 配置缺失"

# 子项 d: shellcheck 版本检测（≥0.11.0 与 CI 一致）
SC_VER=$(shellcheck --version 2>/dev/null | grep -oE "[0-9]+\.[0-9]+\.[0-9]+" | head -1)
if [ -n "$SC_VER" ]; then
  major=$(echo "$SC_VER" | cut -d. -f1)
  minor=$(echo "$SC_VER" | cut -d. -f2)
  if [ "$major" -eq 0 ] && [ "$minor" -lt 11 ] 2>/dev/null; then
    echo "⚠️  shellcheck $SC_VER < 0.11.0（CI 用 v0.11.0），建议升级"
  else
    echo "✅ shellcheck $SC_VER ≥ 0.11.0"
  fi
fi
```

---

#### 28. Skill 元数据完整性（v1.1.6 新增 · 来自审查建议）

> 子 Agent / Skill 的 SKILL.md 若缺必需字段，Agent 可能无法自动加载或触发词失效

```bash
for f in agents/SKILL/*/SKILL.md FDE/SKILL.md LOOP/SKILL.md sofagent/skill/SKILL.md; do
  [ -f "$f" ] || continue
  miss=$(grep -cE "name:|slug:|displayName:|description:|version:|tags:|image:|triggers:|scenarios:|not_when:" "$f")
  echo "$f: 命中必需字段 $miss/9"
done
# 期望：每个 SKILL.md 命中 9 个必需字段（name/slug/displayName/description/version/tags/image/triggers/scenarios/not_when）
```

---

### v1.1.7 新增维度（29-38）

---

#### 29. Dream Cycle 管道完整性 + 只读铁律（v1.1.7 新增 · 交付一）

> Dream Cycle 是 v1.1.7 知识生成管道的核心——6 阶段缺一不可，且 think.md（Ledger）必须只读

```bash
# 子项 a: 6 阶段文件全部存在
for stage in extract-facts extract-atoms cluster-patterns synthesize-concepts skillopt-backfill embed; do
  test -f "sofagent/daemon/src/dream-cycle/${stage}.ts" && echo "✅ ${stage}.ts" || echo "❌ 缺失: ${stage}.ts"
done
# 期望：6 个全在

# 子项 b: 状态机存在且有断点续跑逻辑
grep -c "DREAM_CYCLE_STAGES\|fromStage\|loadState\|saveState" sofagent/daemon/src/dream-cycle/state-machine.ts
# 期望：≥4（阶段枚举 + 续跑 + 加载 + 保存）

# 子项 c: dream-cycle 源码对 think.md 只读（排除注释行）
grep -n "writeFile\|writeFileSync\|unlink\|rmSync" sofagent/daemon/src/dream-cycle/*.ts \
  | grep -v "__tests__\|llm-mock\|state-machine" \
  | grep -v "^.*/\/"
# 期望：仅 state-machine.ts 的 saveState/appendWeeklyLog 出现（写 .sofagent/dream-cycle/state.md + knowledge/log.md，不写 think.md）

# 子项 d: 旧脚本 weekly-report / lessons-extract 引用清零
grep -rn "weekly-report\|lessons-extract" --include="*.ts" sofagent/daemon/src/ | grep -v node_modules | grep -v "memory-contract.ts" | grep -v "\.test\.\|__tests__"
# 期望：零命中（旧脚本已被 Dream Cycle 替代，源码中不应残留引用）
# 注：memory-contract.ts 注释中的 readers 列表属文档说明，不在此扫描范围

# 子项 e: 6 阶段定义与 types.ts 一致
grep -c "extract_facts\|extract_atoms\|cluster_patterns\|synthesize_concepts\|skillopt_backfill\|embed" sofagent/daemon/src/dream-cycle/types.ts
# 期望：≥6（DREAM_CYCLE_STAGES 数组中 6 个阶段全在）
```

---

#### 30. sensitivity frontmatter + 联邦过滤（v1.1.7 新增 · 交付二）

> sensitivity 分级决定 restricted 条目是否在联邦查询中泄露——缺省必须 internal，restricted 绝不默认

```bash
# 子项 a: core/src/ 有 sensitivity 三值定义
grep -c "'public'\|'internal'\|'restricted'" sofagent/core/src/memory-contract.ts
# 期望：≥3（三值枚举定义存在）

# 子项 b: 缺省级别 = internal（safe-by-default）
grep "DEFAULT_SENSITIVITY.*=.*'internal'" sofagent/core/src/memory-contract.ts
# 期望：有匹配

# 子项 c: resolveSensitivity 非法值回落 internal
grep -c "return DEFAULT_SENSITIVITY" sofagent/core/src/memory-contract.ts
# 期望：≥2（无 frontmatter / 非 string / 非法枚举值 三种回落路径）

# 子项 d: isSensitivityVisible 实现 restricted 不泄露
grep -c "SENSITIVITY_ORDER\|isSensitivityVisible" sofagent/core/src/memory-contract.ts
# 期望：≥2（全序权重表 + 可见性判定函数）

# 子项 e: 测试覆盖联邦过滤
grep -c "sensitivity\|restricted\|internal" sofagent/core/src/__tests__/memory-contract-sensitivity.test.ts
# 期望：≥3（sensitivity 测试文件存在且有内容）
```

---

#### 31. knowledge-health inspector 注册 + 五项检查 + 只读（v1.1.7 新增 · 交付三）

> knowledge-health 巡检器必须注册为 @weekly，执行五项检查，且自身零写操作（除 health-report.md 产物）

```bash
# 子项 a: 注册在 inspectors/index.ts 且 schedule = @weekly
grep "'knowledge-health'" sofagent/daemon/src/inspectors/index.ts | grep "@weekly"
# 期望：有匹配

# 子项 b: 5 项检查关键词全在源码
grep -c "孤立\|重复\|断链\|index 过旧\|缺源" sofagent/daemon/src/inspectors/knowledge-health.ts
# 期望：≥5（五项检查全部实现）

# 子项 c: knowledge-health.ts 无写操作（只读铁律）
# 注：health-report.md 是 LUI A 产物，写在 knowledge-health.ts 中——排除该行后应零写操作
grep -n "writeFile\|writeFileSync\|unlink\|rmSync" sofagent/daemon/src/inspectors/knowledge-health.ts \
  | grep -v "health-report\|writeReport\|saveReport\|appendReport"
# 期望：零命中（health-report.md 写入是允许的 LUI A 产物，其余文件零写）

# 子项 d: 测试用例 ≥8
grep -c "  it(" sofagent/daemon/src/inspectors/__tests__/knowledge-health.test.ts
# 期望：≥8（10 个测试用例）

# 子项 e: health-report.md 是巡检产物（LUI A 可感知）
grep -c "health-report" sofagent/daemon/src/inspectors/knowledge-health.ts
# 期望：≥1（生成 health-report.md）
```

---

#### 32. `sofagent knowledge status` 聚合命令 + restricted 不泄露（v1.1.7 新增 · 交付四）

> `knowledge status` 命令聚合各巡检器结果，输出一页可读报告——自身必须只读，且不泄露 restricted 条目

```bash
# 子项 a: 命令文件存在
test -f sofagent/daemon/src/commands/knowledge-status.ts && echo "✅ 存在" || echo "❌ 缺失"

# 子项 b: 命令在 daemon CLI 中可发现
grep -c "knowledge.status\|knowledge-status\|knowledgeStatus" sofagent/daemon/src/cli.ts sofagent/daemon/src/index.ts 2>/dev/null
# 期望：≥1（CLI 入口注册了该子命令）

# 子项 c: commands/knowledge-status.ts 无写操作（只读聚合）
grep -n "writeFile\|writeFileSync\|unlink\|rmSync" sofagent/daemon/src/commands/knowledge-status.ts
# 期望：零命中（聚合命令只读，绝不修改源数据）

# 子项 d: 测试用例 ≥4
grep -c "  it(" sofagent/daemon/src/commands/__tests__/knowledge-status.test.ts
# 期望：≥4（5 个测试用例）

# 子项 e: 输出含受限条目不泄露提示（sensitivity 集成）
grep -c "restricted\|sensitivity\|隐藏\|不可见" sofagent/daemon/src/commands/knowledge-status.ts
# 期望：≥1（聚合时过滤 restricted 条目或有提示）
```

---

#### 33. ActionGovernance schema 完整性 + 向后兼容（v1.1.7 新增 · 交付六）

> ActionGovernance 让审计记录从"结果"升级为"可问责的动作凭证"——schema 字段必须完整，旧记录必须向后兼容

```bash
# 子项 a: types.ts 有 ActionGovernance 接口 + 5 字段
grep -A15 "export interface ActionGovernance" sofagent/audit/src/rules/types.ts | grep -c "actor\|timestamp\|targetEntity\|beforeAfter\|context\|decisionProvenance"
# 期望：≥5（actor + timestamp + targetEntity + beforeAfter + context + decisionProvenance）

# 子项 b: DecisionProvenance 决策溯源组存在
grep "export interface DecisionProvenance" sofagent/audit/src/rules/types.ts
# 期望：有匹配

# 子项 c: audit-history.ts 有 actionGovernance 字段写入
grep -c "actionGovernance" sofagent/audit/src/audit-history.ts
# 期望：≥1（AuditHistoryEntry 接口含 actionGovernance 可选字段）

# 子项 d: index.ts 实际写入 actionGovernance
grep -c "actionGovernance" sofagent/audit/src/index.ts
# 期望：≥1（审计主流程实际填充 actionGovernance）

# 子项 e: 旧格式向后兼容测试（无 actionGovernance 的旧记录可加载）
grep -c "向后兼容\|undefined\|actionGovernance" sofagent/audit/src/audit-history.test.ts
# 期望：≥3（测试覆盖了旧格式兼容场景）

# 子项 f: audit 测试不回归（总数 ≥407）
grep -c "  it(" sofagent/audit/src/audit-history.test.ts
# 期望：≥13（actionGovernance 相关测试用例数）
```

---

#### 34. 文档头日期一致性扫描门禁（v1.1.7 新增 · BugFix 1）

> bump-version.sh 只改版本号不改日期——文档头日期反复漂移。check-version.sh 第 14 项为门禁

```bash
# 子项 a: check-version.sh 有第 14 项日期扫描
grep -c "14\.\|日期一致性扫描\|文档头日期" tools/check-version.sh
# 期望：≥1（第 14 项检查存在）

# 子项 b: 扫描以发版日期为基准
grep -c "EXPECTED_DOC_DATE\|发版日期" tools/check-version.sh
# 期望：≥2（发版日期作为基准使用）

# 子项 c: 跑 check-version 全绿（含第 14 项）
bash tools/check-version.sh 2>&1 | tail -5
# 期望：全部通过（含「文档头日期一致」）

# 子项 d: 文档头日期格式统一（> vX.Y · YYYY-MM-DD）
grep -rn "^> v[0-9]\+\.[0-9]\+\.[0-9]\+ · [0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}" --include="*.md" README.md SECURITY.md LIMITATIONS.md docs/*.md 2>/dev/null | head -5
# 期望：每个文档头日期格式一致
```

---

#### 35. 文档数字 SSOT 一致性（v1.1.7 新增 · BugFix 5+7+8+10）

> 文档中的数字声称（规则数、测试数等）必须以代码 SSOT 为准——模糊数字（"700+"）和漂移数字都是 P0

```bash
# 子项 a: README 无模糊数字（700+ 等区间声称）
grep -n "[0-9]\++\|700+" README.md 2>/dev/null
# 期望：零命中（不应有模糊区间声称）

# 子项 b: test-count.sh 实测与文档声称比对
ACTUAL=$(bash tools/test-count.sh --quiet 2>&1 | grep -oE 'TOTAL_TESTS=[0-9]+' | cut -d= -f2)
echo "实测 workspace 测试数: $ACTUAL"
# 人工检查：FDE/FDE.md / LIMITATIONS.md 中声称的测试数与此一致

# 子项 c: 三产品（sofagent / FDE / LOOP）关系表述一致
grep -c "独立产品\|按需选用\|独立安装" README.md FDE/README.md LOOP/README.md 2>/dev/null
# 期望：每个文档 ≥1（三产品关系表述一致，都声称独立产品按需选用）

# 子项 d: README 使用精确数字（非模糊区间）
grep -oE "[0-9]+ 条规则\|[0-9]+ 条审计规则\|[0-9]+ 条 git-diff" README.md | head -5
# 期望：只有精确数字，无 "约"/"超过"/"+" 等模糊修饰
```

---

#### 36. 跨产品 install 契约 CI 验证（v1.1.7 新增 · BugFix 11）

> FDE/LOOP 调用主 install.sh 的接口（路径/参数/退出码）是跨产品契约——CI 应有专门 job 验证

```bash
# 子项 a: CI 有 cross-product-contract job
grep -c "cross-product-contract\|cross_product_contract" .github/workflows/*.yml 2>/dev/null
# 期望：≥1（CI 配置含跨产品契约验证 job）

# 子项 b: FDE install.sh 引用主 install.sh
grep -c "sofagent/scripts/install.sh" FDE/fde-install.sh 2>/dev/null
# 期望：≥1

# 子项 c: LOOP install.sh 引用主 install.sh
grep -c "sofagent/scripts/install.sh" LOOP/loop-install.sh 2>/dev/null
# 期望：≥1

# 子项 d: 主 install.sh 标注被 FDE/LOOP 依赖
grep -c "FDE/LOOP\|被.*依赖\|跨产品" sofagent/scripts/install.sh 2>/dev/null
# 期望：≥1（头部注释标注了契约关系）
```

---

#### 37. red-team 回归锁完整性（v1.1.7 新增 · BugFix 12）

> acceptance-test.sh 的 red-team 场景是安全基线——场景数声称必须与实际一致，且覆盖关键攻击面

```bash
# 子项 a: A9 全角/leet 注入检测场景存在
grep -c "全角\|leet\|unicode" tools/acceptance-test.sh
# 期望：≥3（场景标题 + 代码注释 + 断言）

# 子项 b: history.jsonl 篡改检测场景存在
grep -c "篡改\|tamper\|CHAIN_BREAK\|hash chain" tools/acceptance-test.sh
# 期望：≥2

# 子项 c: hook 删除检测场景存在
grep -c "hook.*删除\|hook.*丢失\|删除.*hook" tools/acceptance-test.sh
# 期望：≥1

# 子项 d: 非法 YAML → ConfigParseError 场景存在
grep -c "ConfigParseError\|非法.*YAML\|非法 YAML" tools/acceptance-test.sh
# 期望：≥2

# 子项 e: 非 git 目录场景存在
grep -c "非.*git.*目录\|not.*a.*git.*repo\|非 git" tools/acceptance-test.sh
# 期望：≥1

# 子项 f: 场景数声称 = 实际
DECLARED=$(head -5 tools/acceptance-test.sh | grep -oE "[0-9]+ 个端到端" | grep -oE "[0-9]+")
ACTUAL=$(grep -c "^scenario " tools/acceptance-test.sh)
echo "声称: $DECLARED / 实际: $ACTUAL"
# 期望：两者相等
```

---

#### 38. daemon 审计集中收集 workaround + 安全文档时效性（v1.1.7 新增 · BugFix 9+13）

> SECURITY.md 必须诚实标注 daemon 审计推送的现状（workaround + Webhook 阻塞 + USB federation 状态）

```bash
# 子项 a: SECURITY.md 有 filebeat/logstash workaround
grep -c "filebeat\|logstash" SECURITY.md
# 期望：≥1（企业集中收集 workaround 已文档化）

# 子项 b: Webhook 推送标企业采购阻塞（v1.2.x 才就绪）
grep -c "v1.2.x\|不推送\|企业.*阻塞\|待落地" SECURITY.md
# 期望：≥1（诚实标注推送能力当前不可用）

# 子项 c: USB federation 标注 v1.1.6 当前状态（HMAC 签名已有）
grep -c "v1.1.6\|HMAC\|签名校验" SECURITY.md
# 期望：≥2（USB federation 安全模型已含 v1.1.6 状态）

# 子项 d: daemon 审计结果推送现状标注
grep -c "daemon.*审计.*推送\|仅本地\|daemon-notice" SECURITY.md
# 期望：≥1（诚实标注当前推送限制）

# 子项 e: SECURITY.md 版本标注与 SSOT 一致
SSOT_VER=$(node -e "console.log(require('./package.json').version)")
grep "当前状态（v${SSOT_VER}" SECURITY.md
# 期望：有匹配（版本标注 = SSOT）
```

## 输出报告格式

```markdown
# sofagent 回归检查报告

## 总览
- 审查日期 / 审查范围（38 维度 + 跨版本核心维度）
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
