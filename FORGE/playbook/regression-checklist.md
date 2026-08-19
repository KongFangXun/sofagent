# sofagent 回归检查清单

> **用途**：每次发版前跑一遍，确认之前修过的问题没有回退。发现新问题用 [fresh-eyes-review](./fresh-eyes-review.md)。审查范围：全仓库状态检查（不是只看增量）。
>
> **版本维度演进**（归并项直接删除，编号不复用；完整历史 `git log -p` 可溯）：

| 版本 | 新增 | 归并/移除 |
|:--|:--|:--|
| v1.2.5- | #1-69 基线 | — |
| v1.2.6-1.3.4 | #70-109（MCP 一致性 / ESM / 运行时审计 / HMAC / 市场五环 / SkillScan 等） | 48 子项 e-h、16+44、65+66、73+74 等 |
| v1.3.5 | #110-111（bugfix 防复发 / 新功能审查面） | 93→70、69/75/77→95（check-version 四盲区） |
| v1.3.6 | #113-114（八交付锚点一维收口 / run-03 修复防复发） | —（v1.3.5 发布后 hotfix 112 编入） |

> **当前 89 维 · 编号 1-116 · 27 个编号已归并删除（v1.3.7 阶段四 +2：115 新功能审查面 / 116 bugfix 批防复发——acceptance 同批 S290-S293，S293 为阶段四基建加固场景：LLM 超时四文件/resume 越轮守卫/rm-rf 口径同源）**。维度流连续不中断，分组导航：基线组 → 审查约束组 → 环境敏感组（前置 vitest/沙箱铁律）。
## 🔒 维护公约（防膨胀铁律）

**追加新维度前，必须先 grep 同类**：有同类 → 扩展旧维度的子项，不新增编号；无同类 → 才新增编号 = 当前最大 +1。历史维度靠 `git log -p` 找回。**行数警戒线**：`regression-checklist.md` ≤ 1580 行、`acceptance-test.sh` ≤ 2730 行（v1.3.7 阶段四上调 1540→1580 / 2600→2640：+39 维 115/116 新审查面 / +38 S290-S292；v1.3.8 阶段四 +9 场景 S294-S302 真实归并否、上调记录 2640→2730）；releasing.md 方针「超标上调 LIMIT 不删内容」。

**维度脚本编写三铁律**（v1.3.6 release-gate run-08 教训——7 个 FAIL 维度中 5 个是脚本自身缺陷而非仓库问题，driver 白跑一轮）：

1. **显式收尾**：每个维度的检查命令必须以 `echo "✅ ..."`（通过）或 `echo "❌ ..."; exit 1`（失败）收尾——**禁用「期望：无输出」「期望：exit 1」这类依赖退出码语义的写法**。driver 判定只看 exitCode，`grep 无命中返回 1` / `for 循环尾条件判假返回 1` 都会被误判 FAIL（#59/#96 实证——输出全 ✅ 仍记 FAIL）。
2. **禁写死 CLI 参数签名与数字**：检查命令引用 CLI（`node dist/cli.js <参数>`）或计数（N tools / N 规则）时，版本演进必漂——#56 的 `--golden-set` 参数被移除后老命令报参数缺失、#110 的 `48 tools` 在 52→60 后必然 FAIL。写**动态对账**（读 tool-registry 实数比文档）或**可达性验证**（`--help` 含子命令名），不锚定具体签名/数字。
3. **修改 checklist 的 commit 前最后跑一次 check-docs**：B 层预算会被修复净增顶破（v1.3.6 一天内两次：8880→8885→8895）——commit 后才发现 CD 红等于多一个 fix commit。

**清单自身健康度自校验**（每次修改后跑）：
```bash
HEAD_VAL=$(grep -oE '当前 [0-9]+ 维' FORGE/playbook/regression-checklist.md | grep -oE '[0-9]+' | head -1)
ACTUAL=$(grep -c "^#### " FORGE/playbook/regression-checklist.md)
[ "$HEAD_VAL" = "$ACTUAL" ] && echo "✅ 维度数一致 ($HEAD_VAL)" || echo "❌ 头部声称 $HEAD_VAL ≠ 实际 $ACTUAL"

# 行数警戒线自检（越线提醒瘦身，非失败；与 releasing.md 阶段五警戒线一致）
WC_CHK=$(wc -l < FORGE/playbook/regression-checklist.md); WC_ACC=$(wc -l < FORGE/playbook/acceptance-test.sh)
[ "$WC_CHK" -le 1580 ] && echo "✅ checklist $WC_CHK (≤1580)" || echo "⚠️ checklist $WC_CHK 超 1580"
[ "$WC_ACC" -le 2730 ] && echo "✅ acceptance $WC_ACC (≤2730)" || echo "⚠️ acceptance $WC_ACC 超 2730"
```
## 你的身份

你是**回归测试工程师**——确认已知的修复没有回退，不是发现新问题。逐项核对，全 PASS 即通过。⏰ 时序：回归检查在阶段六跑，git tag/npm registry 未到位的项标 ⏳。🔍 维度 7f/17a-b/20 依赖真实环境（npm/git/OpenClaw），AI 审查标 `⏸️ 需人工环境`。

## 审查维度（89 维 · 版本演进见头部表格）

### 审查维度正文（#1-106 · 按版本演进排列 · 分组小节为历史分类，维度流连续不中断）

版本号全量一致 · 铁律措辞清零 · Skill 行数 ≤100 · 测试数一致（维度 13 SSOT 反查） · git status 零未提交修改

#### 1. CHANGELOG 纯度与完整性

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

#### 3. 文档规范源与归属一致性

```bash
# 子项 a: think.md 始终为 Ledger/source（非 Views/派生视图）
# 注意：grep 须精确匹配"think.md 被标为 Views"，而非"think.md 和 Views 出现在同一行"
# 正确模式：think.md 后跟 Views/派生（think.md = Views）→ 误标；think.md 后跟 Ledger/source → 正确
grep -rn "think\.md.* Views\|think\.md.*派生视图\|think\.md（Views" docs/ARCHITECTURE.md docs/PHILOSOPHY.md docs/DEVELOPMENT.md FDE/GUIDE.md   # 期望：无匹配

# 子项 b: canonical source 一致性
grep -rn "Ledger-Views-Policy" docs/ARCHITECTURE.md docs/PHILOSOPHY.md docs/DEVELOPMENT.md | head   # 期望：各文档描述一致

# 子项 f: WIKI.md 存在 + 七节结构完整（原维度 27，v1.2.3 归并）
[ -f docs/WIKI.md ] && echo "✅ WIKI.md 存在" || echo "❌ WIKI.md 缺失"
WIKI_SECTIONS=$(grep -c "^## [一二三四五六七]、" docs/WIKI.md 2>/dev/null || echo 0)
[ "$WIKI_SECTIONS" -ge 7 ] || echo "⚠️ WIKI.md 节数不足（期望 7，实际 $WIKI_SECTIONS）"
grep -c "WIKI" README.md   # ≥1

# 子项 g: 归档内容旧术语口径声明——archive/ + changelog/v1.0-v1.1 含旧术语（四引擎/认知底座），WIKI.md 须有免责声明
grep -q "历史快照\|旧术语\|不代表现行设计" docs/WIKI.md   # 期望：命中

# 子项 h: 版本归属级联一致性——活文档引用的 feature 版本须与 ROADMAP 权威表一致（v1.2.4 教训：age 挂错版本 5 处）
grep -rn "v1\.[0-9]\.[0-9]" docs/ SECURITY.md LIMITATIONS.md README.md --include="*.md" 2>/dev/null | grep -v changelog | grep -v archive   # 人工核对：与 ROADMAP 版本表一致

# 子项 i: 被引用权威源自含性——所有"见 ROADMAP"引用的 feature，ROADMAP 自身须含该项（v1.2.4 教训：引用处写 age 但 ROADMAP 权威表缺此条）
grep -rn "见.*ROADMAP\|详见.*ROADMAP" docs/ SECURITY.md LIMITATIONS.md --include="*.md" 2>/dev/null | grep -v changelog   # 人工核对：ROADMAP 含对应条目
```

#### 4. 审计规则分级与 ruleClass 一致性

```bash
# 子项 a-c: A4=业务底线 / 规则总数=24（v1.2.0 加 A20-A23，21→24）/ A6=能力拐杖 A11=业务底线
grep -A5 "'A4\|name.*不删配置" engine/audit/src/rules/index.ts | grep "ruleClass" | grep "业务底线"
grep "name:" engine/audit/src/rules/index.ts | wc -l   # 期望 24
grep "A6.*能力拐杖\|A11.*业务底线" engine/audit/README.md | wc -l   # 期望 2

# 子项 d: ruleClass SSOT ↔ README 逐条比对（v1.1.3 盲区 · v1.3.8 重写）
# v1.2.5：旧版用 `diff <(index.ts 代码) <(README 表格行)`——两种文本格式天生不同，永远报差异（误报 12 行）。
# 改为两侧归一化成「A编号 ruleClass」再比对，才是真正检查"每条规则分级两边一致"。
diff <(grep -E "name: 'A[0-9]+" engine/audit/src/rules/index.ts | sed -E "s/.*name: '(A[0-9]+)[^']*'.*ruleClass: '([^']+)'.*/\1 \2/" | sort) \
     <(grep -E "^\| A[0-9]+ " engine/audit/README.md | awk -F'|' '{n=split($2,arr," "); id=arr[1]; cls=$(NF-1); gsub(/^[ \t]+|[ \t]+$/,"",id); gsub(/^[ \t]+|[ \t]+$/,"",cls); print id, cls}' | sort)   # 零差异

# 子项 e-g: evidenceMode 计数 + README 表行数 + MCP 规则数（v1.1.4 教训）
echo "git-diff=$(grep -c "evidenceMode: 'git-diff'" engine/audit/src/rules/index.ts) hybrid=$(grep -c "evidenceMode: 'hybrid'" engine/audit/src/rules/index.ts) fs=$(grep -c "evidenceMode: 'filesystem'" engine/audit/src/rules/index.ts)"   # 人工核对 README
INDEX=$(grep -cE "name:\s*'A[0-9]|name:\s*'E[0-9]" engine/audit/src/rules/index.ts)
TABLE=$(grep -cE "^\| A[0-9]+ |^\| E[0-9]+ " engine/audit/README.md)
echo "index=$INDEX / README表=$TABLE（期望 TABLE≥INDEX）"   # v1.1.4：A18/A19 漏更新
grep "rulesCount" engine/mcp/src/tools/report-tools.ts | head -1   # MCP 数字动态化（v1.2.9 拆分后非硬编码）|| true
```

#### 7. 感知层配置与推送链路

```bash
# 子项 a: 配置完整性（v1.3.5 run-07 勘误：perception 段已随 v1.3.1 #42 移除——全代码库零读取点，
# config.yml 里只剩移除说明注释。本检查改为「移除说明在位」防 perception 借尸还魂 + audit.webhook 配置项健康）
if [ -f .sofagent/config.yml ]; then
  grep -q "perception" .sofagent/config.yml && grep -q "已移除" .sofagent/config.yml && echo "✅ perception 移除说明在位（防死配置回流）" || echo "⚠️ config.yml 无 perception 移除说明（可能是旧版配置残留，重跑 --init 刷新）"
else
  echo "⏸️ .sofagent/config.yml 不存在（运行时文件，需 sofagent-audit --init 生成）——跳过配置检查"
fi

# 子项 b: 推送目标（同上：config.yml 不存在时跳过）
[ -f .sofagent/config.yml ] && { grep "push_target:" .sofagent/config.yml | grep -q "webhook://" && echo "✅ 已配置" || echo "⚠️ 未配置 webhook"; } || echo "⏸️ config.yml 不存在，跳过 push_target 检查"

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
grep -n 'grep.*|.*head\|grep.*|.*wc' FORGE/playbook/acceptance-test.sh | grep -v '|| true' | grep -v '|| echo' | grep -vE '^[0-9]+:(#|.*grep -q ")' || echo '✅ 无未保护管道'   # 期望：✅ 行（v1.3.6 收窄：|| echo 兜底的命令替换与 grep -q 字符串引用非真管道风险）

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

# 子项 g: acceptance-test.sh 绝不能与 npm run build 并发执行（v1.2.3 血泪教训）
# 注意：build 首步 rm -rf dist 清空产物，acceptance-test 此刻读 dist/*.js 会误报 6-7 个「文件不存在」假失败。
# 本项主体是人工巡检铁律（无法用单条 grep 干净断言「并发」——2>&1 / & 等会误报）：
#   自测流程必须串行——先 build 完成、dist 稳定，再单独跑 acceptance-test.sh。
# 辅助自动检查：确认没有脚本把两者用 nohup/后台符号显式并发拉起
grep -rnE "nohup.*(build|acceptance-test)|npm run build[^&]*&[[:space:]]*$" tools/ .github/workflows/ 2>/dev/null   # 期望：零命中 || true   # 零命中=无并发隐患=PASS（grep exit 1 语义反转防误报）
```

#### 9. 动态规则禁用逻辑 + 文档侧规则数声称一致性

> v1.1.5 扩展：覆盖**代码侧 + 文档侧**两个一致性面

```bash
SSOT_TOTAL=$(grep -cE "name:\s*'A[0-9]+" engine/audit/src/rules/index.ts)  # v1.3.5 run-08 勘误：去掉 ^ 行首锚定——index.ts 规则是对象字面量 { name: 'A4...'，行首锚定匹配 0 致 SSOT 总数失明
SSOT_MAX=$(grep -oE "name:\s*'A[0-9]+" engine/audit/src/rules/index.ts | grep -oE "[0-9]+" | sort -n | tail -1)
echo "SSOT 规则总数: $SSOT_TOTAL / 最大编号: A$SSOT_MAX"

# 代码侧：knownKeys = index.ts 注册号（A16-A19 两组各验证）
grep -c "a1[6-9]" engine/core/src/config-loader.ts   # ≥4
INDEX_RULES=$(grep -oE "name:\s*'A[0-9]+" engine/audit/src/rules/index.ts | grep -oE "[0-9]+" | sort -n | tr '\n' ',')
KNOWN_KEYS=$(grep -A20 "knownKeys = new Set" engine/core/src/config-loader.ts | grep -oE "'a[0-9]+'" | tr -d "'a" | sort -n | tr '\n' ',')
echo "index.ts: $INDEX_RULES / knownKeys: $KNOWN_KEYS"   # 期望：两集合相等

# 文档侧：声称型数字（v1.1.5 教训——6 文档漏改）
grep -rnE "A1-A11、A14-A1[0-9]|[0-9]+ 条审计规则" --include="*.md" README.md README.en.md docs/ FDE/ FORGE/ ROADMAP.md 2>/dev/null | grep -v "regression-checklist\|fresh-eyes-review\|changelog/"   # 人工核对：与 SSOT 一致

# 字段完整性（v1.1.6：name+ruleClass 各 24 条=48 · v1.3.8 修正 21→24）+ evidenceMode 计数（v1.1.4：期望 24）
grep -oE "name:|ruleClass:" engine/audit/src/rules/index.ts | wc -l   # 期望 48
grep -cE "evidenceMode:" engine/audit/src/rules/index.ts   # 期望 24
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

> 🔴 v1.3.1 教训：原检查命令 grep 具体措辞（"露个脸就够了"），措辞改后命令失效得 0。
> 改为 grep 结构性标记（版本号签名 / 身份声明段落），不依赖具体文案。

```bash
# v1.3.1 修：检查结构性标记而非具体措辞（措辞易改，结构稳定）
grep -c "sofagent" SKILL/SKILL.md | head -1           # 期望：≥ 5（身份声明贯穿全文）
grep -c "质量搭档\|FDE\|约束" SKILL/harness/engage.md  # 期望：≥ 1（角色定位存在）
grep -c "sofagent" engine/scripts/lib/post-install.sh  # 期望：≥ 1（安装后身份提示）
node engine/audit/dist/index.js --version 2>&1 | grep -q "sofagent" && echo "✓ 版本签名"  # CLI 身份
```

#### 16. 安全约束 fail-closed 与权限加固

> USB 专属 fail-closed 验签见维度 44。

```bash
# 子项 a: A15 actions 未声明时必须 FAIL（非 fail-open WARN）—— v1.1.7 二次验证确认已返回 FAIL，本项保留为回归锁
grep -n "nodesWithActions.length === 0\|nodesWithActions.length === 0" engine/audit/src/rules/rule-a15-action-constraint.ts
grep -A2 "nodesWithActions.length === 0" engine/audit/src/rules/rule-a15-action-constraint.ts | grep -c "FAIL"   # 期望：≥ 1

# 子项 b: ~/.sofagent/ 目录权限 700 + install.sh chmod 700（v1.2.1 路径迁移：.sofagent/ → ~/.sofagent/）
# 检查 1：install.sh 是否有 chmod 700 SOFAGENT_HOME
grep -c 'chmod 700.*SOFAGENT_HOME' install.sh   # 期望：≥ 1
# 检查 2：已安装环境的 ~/.sofagent/ 权限（仅在本机已安装时检查）
ls -ld ~/.sofagent 2>/dev/null | grep -c 'drwx------'   # 期望：1（700）

# 子项 c: A/B promote 守卫——overallImprovement > 0
grep -n "overallImprovement\|decidePromotion" engine/ab-test/src/*.ts 2>/dev/null
# 人工检查：decidePromotion() 必须有 overallImprovement > 0 守卫

# 子项 d: core 包 mkdirSync 权限加固——所有数据目录创建必须带 mode: 0o700（v1.2.3 新增）
# 注意：fresh-eyes P0「数据明文存储」过渡防线——目录默认 755 时同机其他用户可读审计数据
# 注意：grep 须排除 import 行（import { mkdirSync } 也含关键词但非调用）
grep -rn "mkdirSync(" engine/core/src/ --include="*.ts" | grep -v "__tests__" | grep -v "mode:"   # 期望：零命中（所有 mkdirSync( 调用都带 mode）
grep -rc "mkdirSync(.*mode: 0o700" engine/core/src/ --include="*.ts" | grep -v ":0"               # 期望：≥ 5 处
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

# 子项 c/d/e: tag commit message 含版本号 + 工作树 clean — 被 pre-push-check.sh 步骤 7 全量覆盖，不再重复
```

#### 18. 扩展审计规则源码回归锁——A19 commit 质量 + A18 垃圾文件（v1.2.1 归并 18+19）

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

#### 20. daemon plist + watch.yml 正确性 + --init 覆盖防护（v1.2.1 归并 20+22）

```bash
# 子项 a: plist 内容正确（原维度 20）
grep "sofagent-daemon" ~/Library/LaunchAgents/com.sofagent.daemon.plist   # ProgramArguments
# WorkingDirectory 指向本仓库（路径无关，任何克隆位置可跑——v1.3.6 B15 修复硬编码路径换机静默失效）
REPO=$(git rev-parse --show-toplevel)
grep -F "$REPO" ~/Library/LaunchAgents/com.sofagent.daemon.plist   # WorkingDirectory
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

## 分组：审查约束类（维度 #23-#77 · 标题行是该组一句话基线，非独立检查项）

版本号全量一致 · 铁律措辞清零 · Skill 行数 ≤100 · CHANGELOG 纯度 · 测试数一致 · 安全约束 fail-closed · npm 产物三方一致

#### 23. FDE/LOOP 跨产品声称一致性

> v1.1.4 暴露：FDE/LOOP 声称"独立产品"，但文档里步数、Agent 数、CLI 子命令存在矛盾

```bash
SSOT_VER=$(node -e "console.log(require('./package.json').version)")

# 子项 a: FDE 步数跨文档一致（v1.1.4 已修复，固化防回退）
grep -oE "[0-9]+ 个阶段|[0-9]+ 个关键步骤|[0-9]+ 步" SKILL/SKILL.md SKILL/skills/*.md FDE/README.md FDE/GUIDE.md 2>/dev/null | sort | uniq -c   # 期望：一致

# 子项 b: LOOP Agent 数跨文档一致（v1.1.4 暴露）
ACTUAL_AGENTS=$(ls SKILL/agents/*/SKILL.md 2>/dev/null | wc -l); echo "实际安装 Agent 数: $ACTUAL_AGENTS"
grep -oE "[0-9]+ 个内置 Agent\|[0-9]+ 个 Agent" FORGE/README.md FORGE/quick-start.md 2>/dev/null   # 人工核对一致

# 子项 c: LOOP 跨产品 install 契约已溶解（v1.2.0——loop-install.sh 删除，LOOP 由 SKILL/<loop>/ 驱动）
[ -f FORGE/loop-install.sh ] && echo "⚠️ FORGE/loop-install.sh 仍存在（应删除）" || echo "✅ LOOP 无独立 install 脚本"

# 子项 d: 独立 install 闭环（FDE 仍依赖主 install.sh）
CLONE_NOTE=$(grep -rliE "完整 clone|完整仓库|需要.*sofagent.*仓库|clone.*完整" FDE/README.md FDE/GUIDE.md FORGE/README.md 2>/dev/null | head -1 || true)
[ -n "$CLONE_NOTE" ] && echo "✅ 文档已标注完整 clone 要求" || echo "⚠️ 未找到标注"
grep -q "被 FDE/LOOP 依赖\|FDE/LOOP" install.sh 2>/dev/null && echo "✅ 主 install.sh 已标注" || echo "⚠️ 未标注"

# 子项 e: install 脚本版本号 = SSOT（v1.1.4 暴露——install.sh 版本号漂移）
grep -H "v[0-9]\+\.[0-9]\+\.[0-9]\+" install.sh | head -4   # 期望：所有版本号 = SSOT_VER

# 子项 f: 跨产品 install CI 验证（原维度 36，v1.2.3 归并）
grep -c "cross-product-contract\|cross_product_contract" .github/workflows/*.yml 2>/dev/null   # ≥1
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

#### 28. Skill 元数据完整性（v1.1.6 新增）

> SKILL.md 若缺必需字段，Agent 可能无法自动加载

```bash
for f in SKILL/agents/*/SKILL.md SKILL/skills/*.md SKILL/SKILL.md; do
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

#### 38. daemon 审计集中收集 workaround + 安全文档时效性（v1.1.7 新增 · BugFix 9+13）

> SECURITY.md 必须诚实标注 daemon 审计推送的现状

```bash
SSOT_VER=$(node -e "console.log(require('./package.json').version)")

# 子项 a: SECURITY.md 有 filebeat/logstash workaround（大小写不敏感，文档中可能是 Filebeat/Logstash）
grep -ci "filebeat\|logstash\|fluentd" SECURITY.md   # ≥1

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

#### 44. USB 完整运行时——HMAC 签名 + AES-256 加密 + fail-closed 验签（v1.1.9 新增 · 交付一）

> v1.3.6 发版后 hotfix 补丁（2026-08-18 pr-check 抓获）：`ecdh.getPrivateKey()` 剥定长整数前导零——私钥首字节 0（概率 1/256）时 31 字节，CI 概率性红。已修 `ecdh.ts` 显式 pad 32 + 2000 次采样防复发锁（pairing.test.ts）。

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

#### 49. v1.2.0 物理结构大重构——旧路径零残留 + 新结构就位（v1.2.0 新增 · fresh-eyes 三轮审查）

```bash
# 子项 a: /sofagent/ 目录残留（node 扫描绕开 BSD grep 中文误判）
# v1.2.5 豁免：archive/changelog 为历史文档目录；`.sofagent/skill/`（含 ~/.sofagent/skill/）是用户 HOME 部署路径，非仓库旧路径
node -e "const fs=require('fs');const dirs=['engine','LOOP','FDE','SKILL','docs','tools','.github'];let hits=[];dirs.forEach(d=>{if(!fs.existsSync(d))return;function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','dist','target','archive','changelog'].includes(e.name))continue;const f=dir+'/'+e.name;if(e.isDirectory())walk(f);else if(e.name.endsWith('.md')||e.name.endsWith('.ts')||e.name.endsWith('.sh')){const c=fs.readFileSync(f,'utf8');c.split('\n').forEach((l,i)=>{if(l.includes('sofagent/skill/')&&!l.includes('.sofagent/skill/')&&!l.includes('已')&&!l.includes('旧')&&!l.includes('→')&&!l.includes('历史'))hits.push(f+':'+(i+1))})}}}walk(d)});['install.sh','SECURITY.md','README.md'].forEach(f=>{if(!fs.existsSync(f))return;const c=fs.readFileSync(f,'utf8');c.split('\n').forEach((l,i)=>{if(l.includes('sofagent/skill/')&&!l.includes('.sofagent/skill/')&&!l.includes('已')&&!l.includes('旧')&&!l.includes('→')&&!l.includes('历史'))hits.push(f+':'+(i+1))})});console.log(hits.length===0?'✅ sofagent/skill/ 零残留':'❌ FOUND '+hits.length);hits.forEach(h=>console.log('  '+h))"

# 子项 b: agents/SKILL/ 旧路径残留（应零命中，排除 changelog 历史 + acceptance-test 反向断言）
# v1.2.7 清理：engine/src + LOOP 目录 v1.2.0 重构后已删除，从扫描数组移除
node -e "const fs=require('fs');const dirs=['engine/orchestrator/src','engine/rules/src','FDE','SKILL','docs','tools'];let hits=[];dirs.forEach(d=>{if(!fs.existsSync(d))return;function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','dist'].includes(e.name))continue;const f=dir+'/'+e.name;if(e.isDirectory())walk(f);else if(e.name.endsWith('.md')||e.name.endsWith('.ts')||e.name.endsWith('.sh')){const c=fs.readFileSync(f,'utf8');c.split('\n').forEach((l,i)=>{if(l.includes('agents/SKILL')&&!f.includes('changelog/')&&!(f.includes('acceptance-test')&&l.includes('! -d')))hits.push(f+':'+(i+1))})}}}walk(d)});console.log(hits.length===0?'✅ agents/SKILL/ 零残留':'❌ FOUND '+hits.length);hits.forEach(h=>console.log('  '+h))"

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

#### 50. 文档乱码扫描——U+FFFD + null byte + UTF-8 损坏检测（v1.2.0 新增）

```bash
# 子项 a: U+FFFD 替换字符全仓扫描（核心——编码损坏的直接证据）
node -e "const fs=require('fs'),path=require('path');const dirs=['docs','SKILL','FDE','FORGE','tools'];const rootFiles=['README.md','README.en.md','CHANGELOG.md','SECURITY.md','CODE_OF_CONDUCT.md','CONTRIBUTING.md','install.sh'];const skips=['node_modules','dist','target','.workbuddy','.sofagent','archive','changelog'];let hits=[];const REPL=String.fromCharCode(0xFFFD);function scan(f){try{const c=fs.readFileSync(f,'utf8');c.split('\n').forEach((l,i)=>{if(l.includes(REPL))hits.push(f+':'+(i+1)+': U+FFFD 替换字符')})}catch(e){}}function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(skips.includes(e.name))continue;const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else if(/\.(md|ts|sh|json|yml)$/.test(e.name))scan(f)}}dirs.forEach(d=>{if(fs.existsSync(d))walk(d)});rootFiles.forEach(f=>{if(fs.existsSync(f))scan(f)});console.log(hits.length===0?'✅ 零 U+FFFD 乱码':'❌ FOUND '+hits.length);hits.slice(0,20).forEach(h=>console.log('  '+h))"

# 子项 b: C1 控制字符扫描（U+0080-U+009F，非法 UTF-8 残留）
node -e "const fs=require('fs'),path=require('path');const dirs=['docs','SKILL','FDE','FORGE','tools'];let hits=[];function scan(f){try{const c=fs.readFileSync(f,'utf8');c.split('\n').forEach((l,i)=>{for(let j=0;j<l.length;j++){const code=l.charCodeAt(j);if(code>=0x80&&code<=0x9F){hits.push(f+':'+(i+1)+': C1 控制字符 U+'+code.toString(16));break}}})}catch(e){}}function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','dist','target','.workbuddy','.sofagent','archive','changelog'].includes(e.name))continue;const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else if(/\.(md|ts|sh|json|yml)$/.test(e.name))scan(f)}}dirs.forEach(d=>{if(fs.existsSync(d))walk(d)});console.log(hits.length===0?'✅ 零 C1 控制字符':'❌ FOUND '+hits.length);hits.slice(0,10).forEach(h=>console.log('  '+h))"

# 子项 c: 孤立代理对/颠倒代理对（surrogate pair 损坏）
node -e "const fs=require('fs'),path=require('path');const dirs=['docs','SKILL','FDE','FORGE','tools'];let hits=[];function scan(f){try{const c=fs.readFileSync(f,'utf8');const arr=[...c];arr.forEach((ch,idx)=>{const code=ch.codePointAt(0);if(code>=0xD800&&code<=0xDFFF){hits.push(f+':char#'+idx+': 孤立代理对 U+'+code.toString(16))}})}catch(e){}}function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','dist','target','.workbuddy','.sofagent','archive','changelog'].includes(e.name))continue;const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else if(/\.(md|ts|sh|json|yml)$/.test(e.name))scan(f)}}dirs.forEach(d=>{if(fs.existsSync(d))walk(d)});console.log(hits.length===0?'✅ 零孤立代理对':'❌ FOUND '+hits.length);hits.slice(0,10).forEach(h=>console.log('  '+h))"

# 子项 d: 常见 mojibake 模式（UTF-8 按 Latin-1/GBK 误读，正则用 codepoint 避免 CLI 编码问题）
node -e "const fs=require('fs'),path=require('path');const dirs=['docs','SKILL','FDE','FORGE'];const rootFiles=['README.md','README.en.md','CHANGELOG.md','ROADMAP.md','SECURITY.md'];const exempt=/regression-checklist\.md$|fresh-eyes-review\.md$/;let hits=[];const mojibake=/[\u00C0-\u00C3][\u0080-\u00BF]|\uFFFD\uFFFD|[\u00C2\u00C3][\u0080-\u00BF]|\u00ef\u00bf\u00bd/;function scan(f){if(exempt.test(f))return;try{const c=fs.readFileSync(f,'utf8');c.split('\n').forEach((l,i)=>{if(mojibake.test(l))hits.push(f+':'+(i+1)+': '+l.trim().slice(0,60))})}catch(e){}}function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','dist','target','.workbuddy','.sofagent','archive','changelog'].includes(e.name))continue;const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else if(/\.(md|ts|sh|json|yml)$/.test(e.name))scan(f)}}dirs.forEach(d=>{if(fs.existsSync(d))walk(d)});rootFiles.forEach(f=>{if(fs.existsSync(f))scan(f)});console.log(hits.length===0?'✅ 零 mojibake':'❌ FOUND '+hits.length);hits.slice(0,20).forEach(h=>console.log('  '+h))"

# 子项 e: null byte 扫描（\x00 嵌入——逐字节扫 Buffer，\x00 在 JSON 字符串里会被吞掉）
node -e "const fs=require('fs'),path=require('path');const dirs=['docs','SKILL','FDE','FORGE','tools'];const rootFiles=['README.md','README.en.md','CHANGELOG.md','ROADMAP.md','SECURITY.md','LIMITATIONS.md','CONTRIBUTING.md','install.sh'];const skips=['node_modules','dist','target','.workbuddy','.sofagent','archive','changelog'];let hits=[];function scan(f){try{const buf=fs.readFileSync(f);let line=1;for(let i=0;i<buf.length;i++){if(buf[i]===10)line++;if(buf[i]===0){const ctx=buf.slice(Math.max(0,i-10),Math.min(buf.length,i+10)).toString('utf8').replace(/\x00/g,'<NUL>');hits.push(f+':'+line+': null byte 上下文 ...'+ctx+'...');if(hits.length>20)break}}}catch(e){}}function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(skips.includes(e.name))continue;const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else if(/\.(md|ts|sh|json|yml)$/.test(e.name))scan(f)}}dirs.forEach(d=>{if(fs.existsSync(d))walk(d)});rootFiles.forEach(f=>{if(fs.existsSync(f))scan(f)});console.log(hits.length===0?'✅ 零 null byte':'❌ FOUND '+hits.length);hits.forEach(h=>console.log('  '+h))"
```

#### 51. v1.2.0 审计链安全加固回归——HMAC 写读一致 + doctor 三态 + config 签名 + 版本自检 + key 强度（v1.2.0 BugFix 批次新增）

```bash
# a: HMAC 写读对称（写入侧先 sanitize 再签名）
grep -n "stableStringify\|sanitize\|脱敏" engine/core/src/audit-history.ts | grep -i "sign\|hmac\|签" && echo "✅ HMAC 写读对称" || echo "❌ HMAC 写读不对称"
grep -n "stableStringify\|sanitize" engine/audit/src/audit-history.ts | grep -i "sign\|hmac\|verify" && echo "✅ audit 包 HMAC 对称" || echo "⚠️ 检查 audit 包 HMAC"
# b: doctor 三态（ok/tampered/unverifiable）+ 使用 detailed 版本
# v1.2.5：unverifiable 枚举定义在 audit-history.ts（L132 ChainCheckStatus），doctor.ts 用 else 分支处理（L242），不含字面串——改查定义侧
grep -q "tampered" engine/core/src/doctor.ts && grep -q "'unverifiable'" engine/core/src/audit-history.ts && echo "✅ 三态判定存在（doctor 消费 + audit-history 定义）" || echo "❌ 缺少三态判定"
grep -q "checkHistoryChainDetailed" engine/core/src/doctor.ts && echo "✅ detailed 版本" || echo "❌ 未使用 detailed 版本"
# c: config 签名（audit 段误放检测 + verifyConfigSignature）
grep -q "audit 段含 signature" engine/core/src/config-loader.ts && echo "✅ audit 段签名检测" || echo "❌ 缺少检测"
grep -q "function verifyConfigSignature" engine/core/src/config-loader.ts && echo "✅ verifyConfigSignature" || echo "❌ 缺少 verifyConfigSignature"
# d: 版本自检（advisory only，不阻断）
grep -q "checkVersionConsistency" engine/audit/src/index.ts && echo "✅ 版本自检存在" || echo "❌ 缺少版本自检"
grep -A3 "checkVersionConsistency" engine/audit/src/index.ts | grep -q "catch\|不阻断\|advisory" && echo "✅ 自检不阻断" || echo "⚠️ 检查是否阻断"
# e: HMAC key 强度（≥16 字节）
grep -q "validateHmacKey" engine/core/src/audit-history.ts && echo "✅ validateHmacKey" || echo "❌ 缺少 validateHmacKey"
grep -q "byteLen < 16\|16.*字节\|>=.*16" engine/core/src/audit-history.ts && echo "✅ 16 字节阈值" || echo "❌ 缺少阈值"
```

#### 53. SSOT 零硬编码——产品代码不得绕过 data-paths.ts 拼路径（v1.2.1 新增）

> ⚠️ **判定规则（防误报）**：data-paths.ts 管的是 `~/.sofagent/data/` **运行时数据路径**（resolveAuditDir/resolveDataDir 等）。包内自带的 fixture / golden-set 文件路径（如 `join(__dirname, '..', 'data', 'golden-set.yaml')`）是**随包发布的测试数据**，不是运行时数据，不适用此维度。仅当路径指向用户 home 下的运行时数据目录（如 `~/.sofagent/data/`、`data/audit/`）却绕过 data-paths.ts 时才算 FAIL。

```bash
# 产品代码零硬编码检查（排除测试文件、data-paths.ts 自身、注释、包内 fixture 路径）
grep -rn "join(.*'data'" engine/ --include="*.ts" | grep -v "data-paths.ts" | grep -v "\.test\." | grep -v "__tests__" | grep -v "// " | grep -v "新的路径"
# 期望：零命中或仅注释（注释需说明"原...迁移到..."）

# 额外验证：data-paths.ts 存在且导出 resolve* 函数
grep -c "resolveAuditDir\|resolveDataDir\|resolveTaskDir\|DATA_ROOT" engine/core/src/data-paths.ts   # ≥2
```

#### 54. 环境变量命名 Unix 全大写——禁止驼峰（v1.2.1 新增）

```bash
grep -rn "SOFAgent_" install.sh engine/ FORGE/ --include="*.sh" --include="*.ts" --include="*.mjs"   # 期望：零命中
grep -rc "SOFAGENT_HOME\|SOFAGENT_DATA" engine/scripts/lib/platform-detect.sh engine/scripts/lib/config.sh   # ≥2
```

#### 56. trust-but-verify——mock 单测全绿 ≠ 真实引擎匹配（v1.2.1 P0b 新增）

> v1.2.1 P0b 教训：工程师用 mock 跑 eval 单元测试全绿（IS_PASS: YES），但 QA 跑真实 CLI 端到端通过率仅 14.3%——mock 未经过真实审计引擎校验，未发现 golden set 与 audit 规则不匹配。逐条读 21 个 rule-*.ts 重写后 14.3% → 100%。
> 🔴 v1.3.4 教训（release-gate run-01 挖出）：eval CLI 自 v1.2.6 起崩了 8 个版本没人发现——①cli.ts require 路径错 ②golden-set sha256 改 yaml 未重算 ③3 用例期望过时（规则演进了 golden 没跟）。**根因：本维度的检查结果长期被当"环境问题"跳过**。判定规则：本维度输出异常时先在非沙箱环境复跑（见环境验证铁律），确认非环境后才可跳过；golden set 变更必须同步重算 .sha256。

```bash
# mock 单测全绿后，必须额外跑真实 CLI 端到端
# eval 包
(cd engine/eval && node dist/cli.js run 2>&1 | grep -E "passRate|通过率")
# 期望：passRate 100%，任何低于 100% 都说明 golden set 与真实规则不匹配
# ab-test 包（v1.3.6 修正：--golden-set 参数已移除，CLI 现要求 --current/--candidate；
# 无参 run 报参数缺失 exit 1——健康态改用 --help 可达性验证，对比实验属运行时功能由单测覆盖）
(cd engine/ab-test && node dist/cli.js --help 2>&1 | grep -q "Subcommands" && echo "✅ ab-test CLI 可用")
```

#### 57. A2/A9 fixture 敏感内容安全——占位符 + base64 编码（v1.2.1 P0b 新增）

> v1.2.1 P0b 教训：golden set 的 fail 用例需含假密钥/injection 文本，但字面串会触发 A2/A9 扫源码本身 → commit hook 拦截。解法：YAML 用占位符（`{{SK_PREFIX}}`/`{{INJ_PHRASE}}`），运行时替换，映射值用 base64 编码存储（A9 扫不到 base64）。

```bash
# 1. golden set 不含字面密钥（A2 安全）
grep -rnE 'sk-[a-zA-Z0-9]{20,}' engine/eval/data/ engine/ab-test/src/__tests__/ 2>/dev/null   # 期望零命中（v1.3.5 勘误：原 engine/ab-test/data/ 已不存在，fixture 实际在 src/__tests__/——死路径会让 grep 静默通过=假绿）
# 2. golden set 不含字面 injection（A9 安全）
grep -rn "$(echo SWdub3JlIHByZXZpb3VzIGluc3RydWN0aW9ucw== | base64 -d)" engine/eval/data/golden-set.yaml 2>/dev/null   # 期望零命中
# 3. 占位符替换机制存在
grep -c 'PLACEHOLDER_MAP\|SK_PREFIX\|INJ_PHRASE' engine/eval/src/eval-runner.ts  # ≥3
```

>
> 🔴 **v1.2.2 再犯**：P0 补测试时 fixture 又写了字面量 `sk-abcdef...`，commit 被 A2 拦截 2 次。**此问题已复发两次（v1.2.1 eval + v1.2.2 P0 测试），铁律升级：测试文件中任何 secret-like 串（含 sk-/AKIA/ghp_ 前缀的假数据）必须运行时拼接（数组 join 或 base64 解码），绝不字面量。**

#### 58. convertAuditResult 三态——WARN 不应当 FAIL（v1.2.1 P0b 新增）

> v1.2.1 P0b 教训：eval 的 convertAuditResult 原版把 WARN（exitCode 1）当 FAIL（exitCode 2）是 bug。三态：exitCode 0=PASS, 1=WARN, 2=FAIL。

> ⚠️ **判定规则（防误报）**：convertAuditResult 函数可能在不同文件中（cli.ts / eval-runner.ts / reporter.ts）。**先 grep 函数名定位文件**，再检查三态逻辑，不要假定文件名。

```bash
# 第一步：定位函数所在文件
grep -rn 'export function convertAuditResult\|export const convertAuditResult' engine/eval/src/
# 第二步：验证三态转换逻辑（用定位到的文件名替换 <file>）
grep -A10 'convertAuditResult' engine/eval/src/cli.ts | grep -E 'PASS|WARN|FAIL|exitCode'
# 期望：3 种状态都有分支处理（EXIT_CODE_TO_RESULT 含 0/1/2 三个映射）
```

---

#### 107. CHANGELOG 索引条目就位——版本 bump 后日期提取链（v1.3.4 发版流程 · 阶段六暴露）

**背景**：v1.3.4 bump 后 CHANGELOG.md 未及时补索引条目，check-version 的 EXPECTED_DOC_DATE 动态提取（从 CHANGELOG 当前版本行取日期）返回空——release-gate regression 维度 95 FAIL 才暴露。索引条目是日期链的上游，漏了整条链断。

```bash
CUR_VER=$(node -p "require('./package.json').version")
grep -q "\*\*v${CUR_VER}\*\* —" CHANGELOG.md || echo "⚠️ CHANGELOG 缺 v${CUR_VER} 索引条目（维度 95 日期链会断）"
grep -m1 "v${CUR_VER}.*—" CHANGELOG.md | grep -oE "[0-9]{4}-[0-9]{2}-[0-9]{2}" || echo "⚠️ 索引条目无日期"
```

---

#### 108. SOP hook 测试用例自身合格性——message 长度 + git add -f（v1.3.4 发版流程 · 阶段九暴露）

**背景**：09-tool-health.md 的 hook 测试用例 message 用 `test`/`add app`（太短），被 A5+A19 正确拦截——**测试用例自己不合格导致假失败**，误判为 hook 坏了。且 `.env` 被 init 自带 .gitignore 挡住时不 `-f` 强加，hook 层 A1/A2 根本测不到（只测到 git 层双保险）。SOP 已修，本维度防 SOP 再漂移。

```bash
# SOP 用例 message 必须合格（≥8 有效字符，Conventional Commits）
grep -A2 "拦截验证" docs/changelog/releasing/09-tool-health.md | grep -oE 'commit -m "[^"]+"' | while read -r c; do
  msg=$(echo "$c" | grep -oE '"[^"]+"' | tr -d '"'); [ ${#msg} -lt 20 ] && echo "⚠️ SOP hook 测试 message 过短: $msg"
done
# -f 说明存在
grep -q "git add -f .env" docs/changelog/releasing/09-tool-health.md || echo "⚠️ 缺 git add -f 说明（hook 层测不到）"
# v1.3.5 子项 c：verify.sh 脱敏测试输入不被全局脱敏误伤（测试输入须真实手机号，非 1**REDACTED***）
grep -q "13812345678" engine/scripts/verify.sh || echo "⚠️ verify.sh 脱敏测试输入被误打码（脱敏误伤测试用例）"
```

---

#### 109. check-docs 锚点扫描环境降级——WorkBuddy shim 超时（v1.3.4 发版流程 · 阶段十一暴露）

**背景**：check-docs.sh 第 11 项（bash 逐行嵌套循环锚点扫描）在 WorkBuddy 环境被 shim 拖慢必然超时，pre-push 因此失败——但它与 tools/check-anchors.mjs（node 版，pre-push 第 4 步独立跑）功能重复。已加 SKIP_ANCHOR_SCAN=1 降级。本维度守护降级开关不被误删 + CI 仍跑完整版。

```bash
grep -q "SKIP_ANCHOR_SCAN" tools/check-docs.sh || echo "⚠️ 降级开关丢失——WorkBuddy 下 pre-push 必失败"
# 本地 WorkBuddy 环境跑 pre-push 应带降级变量
```

---

## 输出报告格式
> 审查日期 / 范围 / 环境验证（pre-push-check/npm test/check-docs/check-version）→ 问题清单（P0/P1/P2 分级，维度/文件:行/问题/建议）→ 通过统计 → 最终建议（可发版/需修复P0/需重大修复）。追加维度前先 grep 同类。

---

## 🔴 环境验证铁律（防误报 · 先读再跑下面维度）

> **测试框架铁律**：本项目用 **vitest** 非 Jest。正确命令：`npx vitest run --reporter=dot` 或 `npm test --workspace=engine/<pkg>`；❌ 禁止 `npx jest`。失败信息含 `from 'vitest'`/`import type` 解析错误 = 用了 Jest，换 vitest 重跑。

> **WorkBuddy 沙箱假失败铁律（v1.3.3）**：shim 可能拦截测试清理的 `fs.rmSync` 致 ETIMEDOUT 假失败（断言已过，仅清理块超时）——环境问题非源码 bug。判定：失败含 `ETIMEDOUT`/`rmSync` → 先在非 shim（终端/CI）复验；v1.3.3 起 rmSync 已 try-catch 包裹，勿在 shim 下盲目改源码。

> **grep 匹配铁律**：检查文档是否包含某关键词时，**必须用 `-i`（大小写不敏感）**，因为文档中可能是 `Filebeat` 而不是 `filebeat`。漏匹配导致的误报会浪费修复轮次。

> **路径迁移感知**：v1.2.1 起 `.sofagent/` 迁移到 `~/.sofagent/`，数据子目录从 `.sofagent/audit` 变为 `~/.sofagent/data/audit`。检查路径权限时认准 `~/.sofagent/`。

### 分组：环境敏感与后期维度（#59 起 · 含 v1.3.x 全部新增，上面铁律适用于本组所有维度）

#### 59. resolve*Dir 调方传参——禁止传 process.cwd() 给 overrideHome 参数（v1.2.2 新增）

```bash
# 搜索所有传 process.cwd() 给 resolve*Dir 或 writeSessionReport 的地方（排除测试）
_HITS=$(grep -rn "resolveAuditDir(process\|resolveKnowledgeDir(process\|resolveDataDir(process\|writeSessionReport.*process" engine/ --include="*.ts" | grep -v node_modules | grep -v dist | grep -v __tests__ || true)
if [ -z "$_HITS" ]; then echo "✅ 无 process.cwd() 误传"; else echo "$_HITS"; echo "❌ 存在误传"; exit 1; fi   # v1.3.6 修正：显式收尾防 exit 歧义
```

#### 60. barrel re-export 一致性——新增导出 public-api.ts 和 index.ts 要同步（v1.2.2 F2 新增）

> P0 数据主权导出只在 public-api.ts，audit/src/index.ts 没同步 re-export，导致 daemon/mcp/orchestrator 的 tsc 报 TS2305。

> ⚠️ **判定规则（CRITICAL — 防误报）**：先检查 `package.json` 的 `exports` 字段——如果 `exports['.']` 已路由到 `public-api.ts`，则所有导出已对消费者暴露，**不需要在 index.ts 中重复 re-export**。`index.ts` 通常是 CLI 入口（含 `require.main === module`）。仅当 exports 指向 index.ts 且缺失 public-api.ts 导出时才算 FAIL。

```bash
# 第一步：检查 package.json exports 指向哪个入口
node -e "const p=require('./engine/audit/package.json'); console.log(p.exports?.['.']?.types || p.types || 'NOT_FOUND')"
# 含 public-api → PASS；含 index → 继续第二步
# 第二步（仅 exports 指向 index.ts 时）：对比导出差异
diff <(grep "^export " engine/audit/src/public-api.ts | sort) <(grep "^export " engine/audit/src/index.ts | sort) | grep "^<"   # 期望：无差异行
```

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

#### 62. 发版闸门裁决解析健壮性——禁止「全文含 FAIL 即判 FAIL」脆弱兜底（v1.2.3 阶段六新盲区）

> v1.2.3 阶段六教训：release-gate-driver.mjs 的 parseVerdict / parseStepResults 曾有脆弱兜底——「报告全文含 \bFAIL\b 字样就判 FAIL」。但发版验证报告的真实结论是 PASS，正文却**必然**提到 FAIL（负向测试场景的预期输出 / 覆盖率表的 ❌ 标记 / 「无 FAIL 条目」这类措辞）。结果一次真实通过的验证被自动化误标成 FAIL，写进 LEDGER.md 和 status.json，靠读 verdict.md 权威产物才还原真相。根因：结论 PASS 的报告正文必然含 FAIL 字样，脆弱兜底把 PASS 误判 FAIL。**读发版裁决以 verdict.md 权威产物为准，别被 LEDGER / status.json 的自动化解析带偏。**

```bash
# 1. 断言「全文含 FAIL 即判 FAIL」式脆弱兜底已删除（期望零命中）
grep -nE "includes\('FAIL'\)|includes\(\"FAIL\"\)" FORGE/src/release-gate-driver.mjs   # 期望：无输出
# 2. 已采用「判定/结论」标记行窗口提取（期望 ≥2）
grep -c 'extractVerdictKeyword' FORGE/src/release-gate-driver.mjs   # ≥2
# 3. 标记行窗口大小（标记行 + 后续 3 行，期望 ≥2）
grep -c 'slice(i, i + 4)' FORGE/src/release-gate-driver.mjs   # ≥2
# 4. 已先剥离围栏代码块再解析（期望 ≥2）
grep -Fc 'replace(/```[\s\S]*?```/g' FORGE/src/release-gate-driver.mjs   # ≥2
```

#### 63. Worker 批量输出 U+FFFD 零污染——每次批量修复后必扫（v1.2.3 新盲区）

> v1.2.3 教训：fresh-eyes-loop 批量修复 worker 多次产出含 U+FFFD 的文件——LLM 输出编码损坏时把无法表示的字节写成 U+FFFD。肉眼难辨（显示为 ▯ 或空白），但污染 grep、破坏锚点、影响 npm 产物。**任何 Agent 批量写入文件后，提交前必须扫一遍 U+FFFD，零容忍。**

```bash
# 1. 全仓活跃文档 U+FFFD 扫描（期望 CLEAN）
node -e "const fs=require('fs');const{execSync}=require('child_process');const files=execSync('git ls-files \"*.md\"').toString().split('\n').filter(f=>f&&!/archive|node_modules/.test(f));let bad=[];for(const f of files){try{if(fs.readFileSync(f,'utf8').includes('\uFFFD'))bad.push(f);}catch(e){}}if(bad.length){console.log('FAIL:',bad.join(','));process.exit(1);}console.log('CLEAN');"
# 2. 引擎源码 U+FFFD 扫描（期望无输出）
grep -rlP '\x{FFFD}' engine/*/src/ 2>/dev/null | grep -v node_modules || true   # 零命中=PASS（grep exit 1 语义反转防误报）
```

#### 64. GitHub 锚点剥除规则——跨文档链接须匹配渲染后锚点（v1.2.4 新盲区）

> v1.2.4 教训：7 处断链全因 GitHub 渲染剥除标题特殊字符——emoji 被整段剥除、`+` 被剥后相邻空格合并为双连字符 `--`、`/`/括号/冒号被剥除。链接作者按"看到的标题"写锚点，渲染后锚点不同→死链。**断言链接时须按 GitHub 规则推算锚点，不能照抄标题。**

```bash
# 子项 a: 扫描跨文档 markdown 链接的锚点，对照目标文件实际标题推算渲染锚点
# 规则：转小写→剥 emoji/标点→空格转连字符→连续连字符保留（剥除产生的双连字符不合并）
grep -rn '\]\(\./\?[A-Za-z0-9_/.-]*\.md#' docs/ README.md SECURITY.md LIMITATIONS.md ROADMAP.md --include="*.md" 2>/dev/null | grep -v changelog | grep -v archive   # 人工核对：每条 # 后锚点 = 目标标题按 GitHub 规则渲染结果

# 子项 b: 标题含 emoji/+///括号/冒号 的高危锚点目标——这类标题最易产生断链
grep -rnE "^#{1,4} .*(🔮|🔄|🪟|✨|[+/（）():：])" docs/ README.md SECURITY.md LIMITATIONS.md ROADMAP.md --include="*.md" 2>/dev/null | grep -v changelog | grep -v archive   # 人工核对：引用这些标题的链接锚点是否已按剥除规则调整
```

> **PASS 标准**：所有跨文档 `#锚点` 链接指向的标题，按 GitHub 渲染规则（剥 emoji/标点、空格→`-`）推算的锚点与链接一致。标题含特殊字符者重点核对。

#### 65. FORGE stream 迁移数据处理——finalState 须累积 delta + extractAgentText 须防御对象 content（v1.2.4 新盲区 · v1.3.1 归并 65+66）

> v1.2.4 教训（归并原 65+66）：FORGE stream 迁移有两个数据处理陷阱：① `stream(streamMode: 'updates')` 的 chunk 是 `{ nodeName: stateDelta }`，直接 `finalState = chunk` 会丢 `result.messages` → 输出 `[object Object]`——必须 `Object.entries(chunk)` 累积。② LangGraph message content 可能是 `Array<{type, text}>` 或嵌套对象，`extractAgentText` 只做 string 判断时会 fallback 到 `String(message)` → 同样输出 `[object Object]`。

```bash
# 验证两个 driver 的 stream chunk 处理含 Object.entries 解包（而非裸赋值）
grep -c 'Object.entries(chunk)' FORGE/src/fresh-eyes-driver.mjs FORGE/src/release-gate-driver.mjs   # 期望：各 ≥1
grep 'finalState = chunk$' FORGE/src/fresh-eyes-driver.mjs FORGE/src/release-gate-driver.mjs        # 期望：零命中
# 验证 extractAgentText 含数组检测 + 对象防御
grep -c 'Array.isArray(content)' FORGE/src/fresh-eyes-driver.mjs FORGE/src/release-gate-driver.mjs   # 期望：各 ≥1
grep -c 'typeof content.*object' FORGE/src/fresh-eyes-driver.mjs FORGE/src/release-gate-driver.mjs   # 期望：各 ≥1
```

#### 67. FORGE ReAct 步骤预算——reviewer ≤50 步 / engineer ≤30 步（v1.2.4 效率铁律）

> v1.2.4 教训：FORGE ReAct Agent 在无步数约束时容易陷入重复读取循环——reviewer 反复读同一个文件、engineer 反复跑同一个测试。在 SKILL.md 中加入效率铁律（目标步数 + 禁止重复读取）后，平均执行步数下降 50-60%。**每个 sub-agent SKILL.md 必须有明确步数预算。**

```bash
# 验证 reviewer/engineer SKILL.md 含效率铁律
grep -q "效率铁律" SKILL/agents/reviewer/SKILL.md && echo "✓ reviewer" || echo "✗ reviewer"
grep -q "效率铁律" SKILL/agents/engineer/SKILL.md && echo "✓ engineer" || echo "✗ engineer"
```

#### 68. 中英文 README 副标题描述同步——改中文版必须同步英文版（v1.2.5 新盲区）

> v1.2.5 教训：fresh-eyes-loop R01 修了英文版版本号，R02 修了中文版副标题描述，但没人回头看英文版的描述层是否也需同步。结果英文版版本号对了但描述还是上版本的"Knowledge Evolution"。**根因：同一行的两层问题（版本号 + 描述）分两轮独立发现，每轮只修自己发现的那层。**

```bash
# 验证中英文副标题关键词重合（至少包含相同的版本核心交付关键词）
CN=$(grep '当前版本' README.md | head -1)
EN=$(grep 'Current version' README.en.md | head -1)
# 手动比对：两者都应包含当前版本的核心交付描述（如 Activation Chain / Audit / Daemon）
```

#### 70. MCP tool 注册三处一致性——新增 tool 必须在 tool-registry + case dispatch + capabilities 三处都注册（v1.2.6 新盲区 · v1.3.1 修：跟上 v1.2.9 tool-registry.ts 拆分）
> 📌 **v1.3.5 归并（判据②·MCP 聚簇 5→4）**：原维度 93（v1.3.2 五轮审查发现：新 tool 漏注册 TOOLS 数组/switch）与本维度同主题——注册一致性检查统一归此。93 的教训并入：三处 = tool-registry TOOLS 数组 + mcp-server switch case + import 语句；acceptance S270 已含四新 tool 的三处验证。

> v1.2.6 教训：新增 MCP tool 时每个 tool 必须在三处同步注册。v1.2.9 mcp 拆分后工具注册从 mcp-server.ts 迁移到 **tool-registry.ts**（`import { TOOLS } from './tool-registry'`）——原检查命令查 mcp-server.ts 的 name: 字段恒得 0（架构迁移后该字段已移走），需改查 tool-registry.ts。验收测试 scenario 192 已覆盖此检查。

```bash
# v1.3.1 修：跟上 v1.2.9 架构迁移（mcp-server.ts → tool-registry.ts）
IMPORTS=$(grep -cE "import.*from.*'./(tools/)?" engine/mcp/src/mcp-server.ts | head -1)
TOOLS_ARRAY=$(grep -cE "name:\s*'" engine/mcp/src/tool-registry.ts)   # v1.3.1：改查 tool-registry.ts
CASES=$(grep -cE "case '" engine/mcp/src/mcp-server.ts)
echo "imports=$IMPORTS tools_array=$TOOLS_ARRAY cases=$CASES"
# 期望：tools_array（tool-registry.ts）≈ imports（mcp-server.ts 引用） + cases（dispatch）
# v1.2.8 补充：check-version.sh 的 MCP tool count 正则须精确匹配独立行
# 错误正则 name: '[a-z_]+' 会匹配 capabilities 数组内联条目（54 误报 vs 实际 27）
# 正确正则 ^\s+name: '[a-z_]+',$（行首缩进+逗号结尾=独立声明行）
```

#### 71. package.json build 脚本禁用 `|| true` 吞编译错误（v1.2.7 新盲区）

> v1.2.7 教训：`tsc && [...] || true` 末尾 `|| true` 会吞掉 tsc 编译失败的 exit code，导致 build 永远报成功。正确格式是子 shell 分组 `(...; true)`——在子 shell 内执行后返回 true，不影响外层 exit code 传递。

```bash
# 检测所有 package.json 的 build 脚本不含裸 || true 吞错误
BAD=$(grep -rE '"build".*\|\| true' engine/*/package.json 2>/dev/null | head -1)
[ -z "$BAD" ] && echo "✓ 无 || true 吞错误" || echo "✗ 发现: $BAD"
# 期望：零命中（正确格式是 (...; true) 子 shell 分组）
```

#### 72. 函数定义作用域 vs 引用位置——局部函数禁被模块级引用（v1.2.7 新盲区）

> v1.2.7 教训：`isReportText` 定义在 `runWorker` 局部作用域内，但模块级函数 `extractAgentText` 也调用了它 → `ReferenceError` 运行时崩溃。TS/JS 不会编译期报此错。

```bash
# 检查 FORGE driver：局部定义（缩进 function）是否被模块级区域引用
node -e "const fs=require('fs'),raw=fs.readFileSync('FORGE/src/fresh-eyes-driver.mjs','utf8');const src=raw.split('\\n').filter(l=>!l.trim().startsWith('//')).join('\\n');const mod=[...src.matchAll(/^function (\w+)/gm)].map(m=>m[1]);const loc=[...src.matchAll(/^\s+function (\w+)/gm)].map(m=>m[1]).filter(n=>!mod.includes(n));const bad=loc.filter(fn=>src.slice(0,src.indexOf('function '+fn)).includes(fn));console.log(bad.length?'ISSUE: '+bad.join(','):'OK')" 2>/dev/null
# 期望：OK
```

#### 73. ESM named export 完整性 + FORGE 模块加载烟测（v1.2.8 新盲区 · v1.3.1 归并 73+74）

> v1.2.9 教训（归并原 73+74）：FORGE/ 不在 npm workspaces → `npm test` 从不执行 FORGE/ 下的 `.test.mjs`。曾出过 `DEFAULT_BUDGET` 缺 `export` 关键字导致 3 个 driver 启动即崩溃的 P0 bug。补建 `tools/forge-smoke-test.sh` 做 6 模块加载 + 3 测试文件烟测，集成到 pre-push-check.sh。

```bash
# 确认 forge-smoke-test.sh 存在且集成到 pre-push
test -f tools/forge-smoke-test.sh && echo "✅ smoke test 存在" || echo "❌ 缺失"
grep -q "forge-smoke-test" tools/pre-push-check.sh && echo "✅ 已集成" || echo "❌ 未集成"
bash tools/forge-smoke-test.sh 2>&1 | tail -3
# ESM named export 检查（被 import 引用的符号须有 export 声明）
node -e "const fs=require('fs');const files=fs.readdirSync('FORGE/src').filter(f=>f.endsWith('.mjs'));let issues=[];for(const f of files){const s=fs.readFileSync('FORGE/src/'+f,'utf8');const exp=new Set([...s.matchAll(/export\s+(?:const|function|class)\s+(\w+)/g)].map(m=>m[1]));for(const f2 of files){if(f2===f)continue;const s2=fs.readFileSync('FORGE/src/'+f2,'utf8');const imp=[...s2.matchAll(/import\s*\{([^}]+)\}\s*from\s*['\"]\.\/([\w.-]+)['\"]/g)];for(const i of imp){if(i[2].replace('.mjs','')===f.replace('.m','')){for(const n of i[1].split(',').map(x=>x.trim().split(/\s+as\s+/)[0])){if(n&&!exp.has(n)&&n!=='default')issues.push(f2+' imports {'+n+'} from '+f);}}}}}console.log(issues.length?'ISSUE: '+issues.join('; '):'OK')" 2>/dev/null
```

#### 76. JS RegExp 不支持 grep 风格 (?i) 内联修饰符（v1.2.9 新盲区）

> v1.2.9 教训：JSON ruleset 的 pattern 字段用 grep 风格 `(?i)` 前缀做大小写不敏感匹配，但 JS RegExp 原生不支持内联修饰符语法——`new RegExp('(?i)foo')` 不报错也不匹配，**13 条规则静默失效，形同虚设**。compilePattern() 在编译层统一剥离前导修饰符并转为 JS flags。

```bash
# 确认 ruleset-loader.ts 含 compilePattern（(?i) → JS flags 转换器）
grep -q 'compilePattern' engine/audit/src/ruleset-loader.ts && echo "✅ compilePattern 存在" || echo "❌ 缺失"
# 确认 compilePattern 处理 (?i) 修饰符
grep -q '?i' engine/audit/src/ruleset-loader.ts && echo "✅ 处理 (?i)" || echo "❌ 未处理"
```

#### 78. 新文件版本头必须匹配 SSOT（v1.2.9 反复出现）

> v1.2.9 教训：开发期间 SSOT 还没 bump（仍 1.2.8），但工程师写的新文件头部注释写 `v1.2.9` → check-version 报版本不一致。**开发期间新文件的版本头必须匹配当前 SSOT，不能超前写下一版本号。** bump-version.sh 会在发版时统一提升。

```bash
# 跑 check-version.sh 确认 TS 文件头版本号与 SSOT 一致（零不一致）
bash tools/check-version.sh 2>&1 | grep "TS 文件头" | grep -q "✓" && echo "✅ 版本头一致" || echo "❌ 有不一致"
```

#### 79. 运行时审计 tool wrapper——gate 拦截优先于 progress 埋点（v1.3.0 新增 · 交付 1）

> v1.3.0 运行时审计最小闭环：orchestrator 的 node-executor 通过 `wrapToolsWithGate` 包装每个 tool 调用，gate 在 tool 执行前调 `auditMw.check()` 拦截。**审计拦截必须在 progress 埋点之前执行**——否则 FAIL 的工具调用会先记录 progress 再被拦截，导致 audit log 与实际执行不一致。

```bash
# 子项 a: node-executor 含 wrapToolsWithGate + createToolGate
grep -c "wrapToolsWithGate\|createToolGate" engine/orchestrator/src/node-executor.ts   # ≥2
# 子项 b: wrapToolsWithGate 在 tools.ts 中定义
grep -c "export function wrapToolsWithGate\|export.*wrapToolsWithGate" engine/orchestrator/src/tools.ts   # ≥1
# 子项 c: FORGE audit-middleware.mjs 含 createAuditMiddleware + check()
grep -c "createAuditMiddleware" FORGE/src/audit-middleware.mjs   # ≥2
grep -c "function check(" FORGE/src/audit-middleware.mjs   # ≥1
# 子项 d: FORGE fresh-eyes-driver loadTools 中 auditMw.check 在 progress 回调之前（防 FAIL 漏拦）
grep -B5 -A5 "auditMw.check\|auditMiddleware.*check" FORGE/src/fresh-eyes-driver.mjs | head -15   # 人工核对：check 调用在 progress 之前
# 子项 e: HITL 审计记录（recordHitlAudit 存在）
grep -c "recordHitlAudit" FORGE/src/audit-middleware.mjs   # ≥1
```

#### 80. 决策审计——emitDecision + HMAC 签名链 + 链验证 + 查询接口（v1.3.0 新增 · 交付 6）

> v1.3.0 意图层审计：每个 Agent 决策经 `emitDecision()` 写入 decision log，签名顺序为「先脱敏再 HMAC」——`sanitizeWhy(why)` 先剥离敏感内容，HMAC 基于已脱敏的 payload 计算。链式校验（prevHash）+ 三态判定（ok/tampered/unverifiable）与 audit-history 一致。

```bash
# 子项 a: decision-schema.ts 有 DecisionKind/DecisionWhy/DecisionProvenance 定义
grep -c "DecisionKind\|DecisionWhy\|DecisionProvenance" engine/audit/src/decision-schema.ts   # ≥3
# 子项 b: emitDecision 签名顺序——先 sanitizeWhy 再 hmacSig（防泄漏→签名泄漏）
grep -c "sanitizeWhy\|hmacSig\|recordForSig" engine/audit/src/decision-log.ts   # ≥3
# 子项 c: 签名基于脱敏后 payload（prevHash/hashVersion/hmacSig 排除后计算）
grep "recordForSig.*prevHash.*undefined\|recordForSig.*hmacSig.*undefined" engine/audit/src/decision-log.ts   # 期望：有匹配
# 子项 d: decision-chain.ts 含链式验证 + 三态（ok/tampered/unverifiable）
grep -c "'ok'\|'tampered'\|'unverifiable'" engine/audit/src/decision-chain.ts   # ≥3
# 子项 e: decision-query.ts 查询接口存在（queryByKind/traceBack/getHighFrequencyPatterns）
grep -c "export function" engine/audit/src/decision-query.ts   # ≥3
# 子项 f: envFingerprint 在签名 payload 中（防止跨环境篡改）
grep -c "envFingerprint" engine/audit/src/decision-log.ts   # ≥1
```

#### 81. 外部记忆后端——动态 tool 注册 + sensitivity ACL 映射（v1.3.0 新增 · 交付 10）

> v1.3.0 MCP 记忆后端：`getDynamicTools()` 从 config 读取 `memory_backends` 配置，动态注册 search/write tool。每个后端有独立的 sensitivity ACL——`mapSensitivityToACL()` 将 agent 的 sensitivity level 映射到后端可见范围。dynamic tools 与 static tools 合并注入 MCP server。

```bash
# 子项 a: getDynamicTools 函数存在 + 返回 DynamicToolDef[]
grep -c "getDynamicTools\|DynamicToolDef" engine/mcp/src/tools/memory-backend.ts   # ≥2
# 子项 b: mapSensitivityToACL 存在
grep -c "mapSensitivityToACL" engine/mcp/src/tools/memory-backend.ts   # ≥2
# 子项 c: registerMemoryBackends 从 config 读取注册
grep -c "registerMemoryBackends" engine/mcp/src/tools/memory-backend.ts   # ≥1
# 子项 d: mcp-server.ts 合并 static + dynamic tools
grep -c "\.\.\.TOOLS.*getDynamicTools\|\.\.\.getDynamicTools" engine/mcp/src/mcp-server.ts engine/mcp/src/tool-registry.ts   # ≥1
# 子项 e: sensitivity ACL 不泄露 restricted（mapSensitivityToACL 对 restricted 后端返回空/过滤）
grep -A5 "mapSensitivityToACL" engine/mcp/src/tools/memory-backend.ts | grep -c "restricted\|internal\|public"   # ≥1
```

#### 82. 进化链路写保护——atomicWriteWithMergeSync 原子合并 + 锁机制（v1.3.0 新增 · 交付 11）

> v1.3.0 进化链路安全：think.md / entities/ 等进化产物写入必须经 `atomicWriteWithMergeSync()`——先读现有内容→深度合并新数据→写临时文件→原子 rename。锁机制防止并发写入冲突。**进化链路的写入不允许裸 writeFileSync，必须经过原子合并入口。**

```bash
# 子项 a: atomicWriteWithMergeSync 存在
grep -c "atomicWriteWithMergeSync" engine/core/src/shared/atomic-write.ts   # ≥1
# 子项 b: 使用 writeFileSync→tmp→renameSync 原子模式（非裸写）
grep -c "writeFileSync(tmp\|renameSync(tmp" engine/core/src/shared/atomic-write.ts   # ≥2
# 子项 c: 锁机制存在（lockfile + PID）
grep -c "lock\|PID\|process\.pid" engine/core/src/shared/atomic-write.ts   # ≥2
# 子项 d: mergeDeep 深度合并函数存在
grep -c "mergeDeep\|deepMerge" engine/core/src/shared/atomic-write.ts   # ≥1
# 子项 e: think.md 写入路径使用 atomicWriteWithMergeSync（而非裸 writeFileSync）
grep -rn "writeFileSync.*think\.md\|writeFile.*think\.md" engine/ --include="*.ts" | grep -v node_modules | grep -v dist | grep -v __tests__ | grep -v "atomic-write"   # 期望：零命中（think.md 写入须经 atomicWriteWithMergeSync）
```

#### 83. 开源元数据完整性——package.json license + action.yml 版本锁定（v1.3.0 新增 · fresh-eyes run-21 P1-8/P1-10）

> v1.3.0 fresh-eyes run-21 发现两个开源元数据缺陷：① package.json 缺少 `license` 字段（MIT 开源仓库缺 license 是硬伤）② action.yml 引用 `@sofagent/audit` 未锁定版本号（会导致 GitHub Action 拉到不兼容版本）。两者都是 check-version.sh 此前未覆盖的结构性检查点。

```bash
# 子项 a: package.json 含 license 字段
node -e "const p=require('./package.json'); console.log(p.license || 'MISSING')"   # 期望：MIT（非 MISSING）
# 子项 b: action.yml 中 @sofagent/* 引用全部锁定到 vX.Y.Z（不能裸引用）
grep -E '@sofagent/' action.yml | grep -vE '@sofagent/[a-z-]+@[0-9]+\.[0-9]+\.[0-9]+'   # 期望：零命中（裸引用 = 未锁定）
# 子项 c: action.yml 锁定版本 = SSOT 版本号
grep -oE '@sofagent/[a-z-]+@[0-9]+\.[0-9]+\.[0-9]+' action.yml | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | sort -u   # 期望：仅一个版本号 = SSOT
```

#### 84. shouldAllow 拦截 API + 运行时审计日志仓库隔离（v1.3.0 新增 · 交付 2 + 交付 8）

> shouldAllow 是 engine/rules 的运行时拦截入口——返回 `{ allow, reason, requireApproval }`，deny 时附带原因。运行时审计日志按 git 仓库 hash 隔离到 `data/audit/runtime/<repo-hash>/`——多仓库部署时审计日志不串。

```bash
# 子项 a: shouldAllow 函数存在 + 返回 InterceptVerdict
grep -c "shouldAllow\|InterceptVerdict\|requireApproval" engine/rules/src/should-allow.ts   # ≥2
# 子项 b: shouldAllow 被 node-executor / gate 调用（不是死代码）
grep -rn "shouldAllow" engine/orchestrator/src/ --include="*.ts" | grep -v node_modules | grep -v dist | grep -v ".test." | wc -l   # ≥1
# 子项 c: 运行时审计日志路径含 repo-hash 隔离
grep -c "data/audit/runtime" FORGE/src/audit-middleware.mjs   # ≥1
# 子项 d: repo-hash 基于 git rev-parse（非硬编码路径）
grep -c "rev-parse\|repo.*hash\|resolveRuntimeAuditPath" FORGE/src/audit-middleware.mjs   # ≥1
```

---

#### 85. FORGE driver run_bash cwd 强制——防 worker 路径错误大面积降级（v1.3.1 新增 · fresh-eyes run-01 P0-1 教训）

**背景**：worker 模型自己写 `cd /Users/<拼错用户名>/...`，bash 大面积 No such file or directory → 24 worker 硬熔断降级，审查结论不可信。

```bash
# run_bash 包装层强制 cwd=REPO_ROOT + 剥离 cd 前缀
grep -c "cwd: REPO_ROOT" FORGE/src/fresh-eyes-driver.mjs   # ≥1
grep -c "stripped.*replace.*cd" FORGE/src/fresh-eyes-driver.mjs   # ≥1
```

#### 86. FORGE driver auto-commit 代码领域限定——防卷队友未提交内容（v1.3.1 新增 · fresh-eyes run-01/run-03 P0-2 教训）

**背景**：driver 用 `git add -A` 把队友并行编辑的规划文档（docs/changelog/v1.4/*.md）一起卷进 auto-commit；修复改为只 add 代码领域（engine/FORGE/src/tools/SKILL）。

```bash
# driver-base runAuditGate 不含 git add -A
grep -c "git add -A" FORGE/src/driver-base.mjs   # 0（仅注释引用）
# 改为显式代码领域 add
grep -c "git diff --name-only HEAD -- engine/" FORGE/src/driver-base.mjs   # ≥1
```

#### 87. HMAC 密钥熵检测——Shannon 熵替代唯一字符占比（v1.3.1 新增 · P2-1 真 bug）

**背景**：原 validateHmacKey 用"唯一字符占比"判断强度，但 openssl rand -hex 32 的 hex 字符集天然 16 种 → 官方推荐生成方式永远误报"弱密钥"（重复度 75%）。改用 Shannon 熵检测。

```bash
# audit-history.ts 用 Shannon 熵（非重复度占比）
grep -c "shannonEntropy" engine/core/src/audit-history.ts   # ≥1
# 阈值 3.0 bit/char（随机 hex ≈4.0 通过，弱密钥 <3.0 拦截）
grep -c "shannonEntropy < 3" engine/core/src/audit-history.ts   # ≥1
```

#### 88. 根 tsconfig.json outDir 缺失——tsc 误输出到 src（v1.3.1 新增 · C1 预料外盲区 · 根因待修）

**背景**：根 tsconfig.json 未设 outDir，若从根目录跑 tsc（而非各包 npm run build），产物输出到 src 旁（910 个文件）。v1.3.1 已用 .gitignore 防御（engine/*/src/**/*.js 等），但根因（根 tsconfig 加 outDir）待后续版本修。

```bash
# 根 tsconfig 有 outDir（v1.3.1 暂用 .gitignore 兜底，根因待修）
grep -c '"outDir"' tsconfig.json   # v1.3.1 期望 0（待修），修后期望 ≥1
# .gitignore 防御规则存在（过渡期）
grep -c "engine/\*/src/\*\*/\*.js" .gitignore   # ≥1
```

---

#### 89. 审计规则 ruleClass 多处声明一致性（v1.3.1 新增 · run-13 维度 4 阻断）

**背景**：A3 ruleClass 在 index.ts（注册中心）/ rule-a3-*.ts（规则实现）/ README（文档）三处声明，版本演进时容易只改一处忘记其他——run-13 捕获 A3 在 index.ts 标"能力拐杖"、rule-a3-*.ts 标"业务底线"的不一致。

```bash
# 每条规则的 ruleClass 在 index.ts 和 rule-*.ts 必须一致
for n in $(grep -oE "ruleClass: '[^']+'" engine/audit/src/rules/index.ts | sort -u); do
  rule_name=$(echo "$n" | grep -oE "^rule-a[0-9]")
  impl_class=$(grep -oE "ruleClass: '[^']+'" engine/audit/src/rules/${rule_name}*.ts 2>/dev/null | head -1)
  [ "$n" = "$impl_class" ] || echo "⚠️ $rule_name: index=$n vs impl=$impl_class"
done
# 期望：无 ⚠️ 输出（index.ts SSOT，rule-*.ts 对齐）
```

#### 90. shell 脚本 locale 防御——CI/sandbox 默认 LANG=C 导致中文乱码（v1.3.1 新增 · run-10 阻塞 1）

**背景**：release-gate sandbox 默认 LANG=C，acceptance-test.sh 中文输出 ANSI 乱码 + 日志末尾截断，driver 无法解析结果。本地（LANG=en_US.UTF-8）无法复现——只在 CI/sandbox 暴露。

```bash
# 含中文输出的 shell 脚本必须头部 export LANG/LC_ALL
for f in FORGE/playbook/acceptance-test.sh tools/check-version.sh tools/check-docs.sh; do
  head -10 "$f" | grep -q "LANG=en_US.UTF-8\|LC_ALL=en_US.UTF-8" || echo "⚠️ $f 缺 locale export"
done
# 期望：无 ⚠️ 输出
```

#### 91. 人读输出 vs 机器解析输出分离——ANSI 色码干扰 grep（v1.3.1 新增 · run-10 阻塞 2）

**背景**：acceptance-test.sh 汇总行 `验收测试结果：${GREEN}...${NC}` 带 ANSI 色码，driver 用 `grep '验收测试结果：N 通过'` 匹配失败（色码夹在中间）。修复：补一行 ANSI-stripped 纯文本 SUMMARY 供机器解析。

```bash
# 被自动化解析的脚本必须有 ANSI-stripped 纯文本汇总行
grep -q "^SUMMARY:" FORGE/playbook/acceptance-test.sh && echo "✓ 有纯文本 SUMMARY" || echo "⚠️ 缺机器可解析汇总行"
# 通用规则：任何被 driver/grep 解析的输出行，不应依赖 ANSI 色码
```

#### 92. 审查文档自身检查命令的架构迁移同步（v1.3.1 新增 · 元维度 · run-13 维度 70 误报）

**背景**：维度 70 检查 MCP tool 注册查 mcp-server.ts，但 v1.2.9 架构迁移后工具注册移到 tool-registry.ts——检查命令得 tools_array=0 误报。这是"审查文档自身的检查命令也会过期"的元模式。

```bash
# 元检查：regression-checklist 中引用的 engine/ 路径是否都还存在
grep -oE 'engine/[a-zA-Z_/]+\.ts' FORGE/playbook/regression-checklist.md | sort -u | while read f; do
  [ -f "$f" ] || echo "⚠️ 路径失效: $f（架构迁移后未更新检查命令）"
done
# 期望：无 ⚠️ 输出（所有引用路径有效）
# 🔴 每次架构迁移（文件改名/目录调整）后必须跑此元检查
```

#### 94. bash 3.2 兼容性——空数组 + set -u + 尾行条件（v1.3.2 新增 · 五轮审查 P0-B1）

**背景**：bootstrap.sh 在 macOS 默认 `/bin/bash` 3.2 下崩溃——空数组 `${arr[@]}` + `set -u` = unbound variable；尾行 `[[ ]] && cmd` + `set -e` = 成功也 exit 1。

```bash
# 新增 shell 脚本在 macOS 默认 bash 3.2 下测过
/bin/bash --version | head -1  # 确认 3.2
/bin/bash <script.sh> --help 2>&1; echo "EXIT=$?"
# 期望：EXIT=0
# 危险模式：${arr[@]} + set -u / [[ ]] && + set -e
```

#### 95. check-version 工具健康四盲区——语言覆盖/路径跟随/排除测试/日期动态提取（v1.2.5/v1.2.9/v1.3.2 渐次）

> 四次盲区教训：① v1.2.5 多语言文档的版本号检查须覆盖所有语言声明模式 ② v1.2.9 文件拆分时依赖该文件的检查脚本必须同步扫描路径 ③ v1.2.9 漂移扫描必须排除 `.test.` 文件 ④ v1.3.2 EXPECTED_DOC_DATE 从 CHANGELOG 动态提取（禁硬编码发版日期）

```bash
# 子项 a: 英文版正文版本号检查（v1.2.5 盲区）
grep -q "Current version" tools/check-version.sh && echo "✅ 英文检查" || echo "✗ 缺英文检查"
# 子项 b: MCP 计数扫描拆分后定义文件（v1.2.9 盲区）
grep -q 'tool-registry.ts' tools/check-version.sh && grep -q 'resources.ts' tools/check-version.sh && echo "✅ 扫描拆分文件" || echo "❌ 未扫描"
# 子项 c: 漂移扫描排除 .test. 文件（v1.2.9 盲区）
grep 'grep.*条规则' tools/check-version.sh | grep -q '\.test\.' && echo "❌ 未排除 .test." || echo "✅ 已排除 .test."
# 子项 d: EXPECTED_DOC_DATE 动态提取，与 CHANGELOG 发版日期一致（v1.3.2 盲区）
grep "EXPECTED_DOC_DATE" tools/check-version.sh
grep "$(node -p "require('./package.json').version")" CHANGELOG.md | grep -oE "2026-[0-9]{2}-[0-9]{2}"
```
#### 96. 警戒线声明多处同步——改一处要改 4 处（v1.3.2 新增 · 元维度）

**背景**：acceptance 警戒线 2050→2250 需同步改 4 处（regression-checklist + releasing/05 + guides/review-system + acceptance-test 头部），漏改任一处会导致发版 SOP 与实际不一致。

```bash
# 同步一致性检查：4 处声明的警戒线值一致
for v in "2500" "1500" "400"; do   # 警戒线（acceptance 2500 / checklist 1500）——改值时同步更新此处
  COUNT=$(grep -rn "$v" FORGE/playbook/regression-checklist.md docs/changelog/releasing/05-review-system.md docs/guides/review-system.md 2>/dev/null | wc -l | tr -d ' ')
  echo "  警戒线 $v: $COUNT 处声明"
  if [ "$COUNT" -lt 2 ]; then echo "  ⚠️ 声明不足 2 处——可能漏改"; _GATE96=1; fi
done
[ "${_GATE96:-0}" -eq 0 ] && echo "✅ 三条警戒线声明均 ≥2 处"   # v1.3.6 修正：显式收尾，防尾判假 exit 1 被 driver 误判 FAIL
```

#### 97. npm publish workspace 限制——12 包分两批发布（v1.3.2 新增 · 发版阻塞）

**背景**：release.yml 只 auto-publish @sofagent/audit + @sofagent/mcp（Release 触发）；其余 10 包需手动 `cd engine/<pkg> && npm publish`。`npm publish --workspaces` 不支持 workspace 全局发布。

```bash
# 发版后验证 12 包全部到 npm
for pkg in audit core daemon eval harness ontology orchestrator rules skillopt think ab-test mcp; do
  V=$(npm view @sofagent/$pkg version 2>/dev/null || echo "❌ 未发布")
  echo "  @sofagent/$pkg: $V"
done
# 期望：全部 = 当前版本号；未到 → cd engine/<pkg> && npm publish --access public
```

#### 98. post-commit hook 对账逻辑——parentSha vs COMMIT_SHA 父子 SHA 不等（v1.3.3 新增 · P0 产品 bug）

**背景**：v1.3.3 阶段三发现 post-commit hook 假阳性——每次正常 commit 都警告"可能使用了 --no-verify 绕过"。根因：commit-msg 记录的 `parentSha` = 新 commit 的**父**提交，post-commit 的 `$COMMIT_SHA` = 新 commit **自己**——父子 SHA 永远不等。

```bash
# v1.3.3 修复：post-commit 取 HEAD^ 作为 PARENT_SHA 对账
grep -q "PARENT_SHA\|HEAD\^" "$PROJECT_ROOT/engine/audit/src/commands/init.ts" || echo "⚠️ post-commit 未用 PARENT_SHA 对账"
# 首次 commit（unborn HEAD）用空树常量兜底
grep -q "4b825dc642cb6eb9a060e54bf8d69288fbee4904" "$PROJECT_ROOT/engine/audit/src/commands/init.ts" || echo "⚠️ 首次 commit 无空树兜底"
```

#### 99. AUDIT_PRIORITY 单源化后向后兼容导出（v1.3.3 新增 · release-gate S186）

**背景**：v1.3.3 #11 把规则 priority 字段并入 index.ts 规则定义，runner.ts 删除独立 AUDIT_PRIORITY 常量。但 acceptance-test.sh S186 / 外部脚本仍依赖 `require('runner.js').AUDIT_PRIORITY.critical.includes('A20')` 形态查询。单源化 refactor 必须保留派生导出。

```bash
node -e "const m=require('$PROJECT_ROOT/engine/audit/dist/rules/runner.js');const c=m.AUDIT_PRIORITY?.critical;if(!c||!c.includes('A20')){console.log('FAIL: AUDIT_PRIORITY 派生导出缺失');process.exit(1);}console.log('OK');" || echo "⚠️ AUDIT_PRIORITY 向后兼容导出缺失"
```

#### 100. check-test-count.sh 失败路径——set -u + $? 赋值 unbound（v1.3.3 新增 · 门禁假绿）

**背景**：v1.3.3 发现 check-test-count.sh L62 在 set -uo pipefail 下，命令替换 exit N 时 `$?` 赋值被判 unbound，脚本中途崩溃，CI 永远判绿。

```bash
# 强制触发失败路径（test-count.sh 不存在），验证 check-test-count.sh 能报红
sed 's|bash tools/test-count.sh|bash /nonexistent/test-count.sh|' tools/check-test-count.sh > /tmp/cct-test.sh
bash /tmp/cct-test.sh > /dev/null 2>&1; [ $? -eq 1 ] && echo "✅ 失败路径正确报红" || echo "⚠️ 失败路径崩溃或假绿"
rm -f /tmp/cct-test.sh
```

#### 101. check-docs.sh LIMIT 超标——内容增强后 B 层行数超预算（v1.3.3 新增 · CI 阻塞）

**背景**：v1.3.3 阶段八内容增强（FDE 方法论/职业道德/评估体系）导致 B 层（开发者参考）行数从 8302→8437，超 LIMIT_B=8400，CI pr-check 失败。发版过程中才发现——本地 check-docs.sh 在 WorkBuddy 环境下超时跑不完，CI 上才暴露。

```bash
# CI 模拟：只跑 B 层行数检查（不跑锚点段避免超时）
AB=$(cat docs/ARCHITECTURE.md docs/DEVELOPMENT.md docs/HANDBOOK.md docs/PHILOSOPHY.md docs/WIKI.md SECURITY.md docs/VALIDATION.md docs/THANKS.md docs/ROADMAP.md docs/LIMITATIONS.md FDE/GUIDE.md FDE/README.md 2>/dev/null | wc -l)
echo "B 层: $AB 行（LIMIT_B=$(grep '^LIMIT_B=' tools/check-docs.sh | grep -oE '[0-9]+')）"
[ "$AB" -le "$(grep '^LIMIT_B=' tools/check-docs.sh | grep -oE '[0-9]+')" ] && echo "✅" || echo "⚠️ 超标——内容增强后需上调 LIMIT_B"
```

---

#### 102. 市场五环完整性——10 模块 + 6 MCP tool + inspector 双注册（v1.3.4 新增 · A 类新功能面）

**背景**：v1.3.4 L3 组织能力市场五环（发布→发现→调用→评价→养护）。模块文件、MCP 注册、daemon 巡检三处任一缺失都导致市场断环（如 invoker 缺失则调用环断，retire 缺失则养护环断）。v1.3.1 教训：建了文件不注册 = 巡检不生效。MCP 注册一致性已由 #70/#93 覆盖，此处只查 market 专属 tool 名单。

```bash
for f in publisher catalog invoker rating owner retire skill-scan rule-harvest rule-jury rule-promote; do [ -f "engine/orchestrator/src/commons/$f.ts" ] || echo "⚠️ commons/$f.ts 缺失"; done
for t in commons_publish commons_search commons_invoke commons_rate commons_retire commons_harvest_rule; do grep -q "'$t'" engine/mcp/src/tool-registry.ts || echo "⚠️ $t 未注册"; done   # v1.3.6 补：market→commons 更名同步（阶段五漏改本维）
grep -q "runCommonsCatalogDaily" engine/daemon/src/inspectors/index.ts || echo "⚠️ 目录日更未注册"   # v1.3.6 更名同步
grep -q "runCommonsHealth" engine/daemon/src/inspector-layers.ts || echo "⚠️ 健康周检未挂载"   # v1.3.6 更名同步
```

---

#### 103. SkillScan 三态链 + 版本守卫——DANGEROUS 拦截 / rc 禁入（v1.3.4 新增 · A 类新功能面）

**背景**：v1.3.4 SkillScan 安全门。两个高危点：① 文件不存在时必须判 DANGEROUS 不能默认 SAFE（扫描不到 ≠ 安全）；② DSH 候选包 rc 版本（rc/beta/alpha/pre）必须被守卫拦截——否则骨架 runCordisAgent 被调用直接 throw，FORGE loop 崩溃。

```bash
grep -q "'SAFE' | 'SUSPICIOUS' | 'DANGEROUS'" engine/orchestrator/src/commons/skill-scan.ts || echo "⚠️ 三态枚举缺失"
grep -q "scanForPublish\|scanForInstall" engine/orchestrator/src/commons/skill-scan.ts || echo "⚠️ 双触发缺失"
grep -q "existsSync" engine/orchestrator/src/commons/skill-scan.ts || echo "⚠️ 存在性前置校验缺失"
grep -q "scanSkillSafety" engine/orchestrator/src/commons/skill-scan.ts || echo "⚠️ 未复用 scanSkillSafety"
grep -q "rc|beta|alpha|pre" engine/orchestrator/src/execution-backend.ts || echo "⚠️ rc 版本守卫缺失"
grep -q "@deepseek-ai/dsh" engine/orchestrator/package.json && echo "⚠️ DSH rc 版进了依赖声明"
```

---

#### 104. DecisionKind.COMMONS 语义分型——市场动作不与 ORCHESTRATION/EVOLUTION 混用（v1.3.4 新增 · A 类新功能面）

**背景**：v1.3.4 铁律「市场调用走审计」。若市场事件塞进 ORCHESTRATION/EVOLUTION，`decision-log --kind MARKET` 查不到任何东西——审计语义分型失效。例外：退役走 EVOLUTION（生命周期事件非市场动作）是刻意设计。

```bash
grep -q "'COMMONS'" engine/audit/src/decision-schema.ts || echo "⚠️ DecisionKind.COMMONS 缺失"
grep -q "COMMONS" engine/audit/src/decision-log.ts || echo "⚠️ decision-log 未支持 COMMONS"   # v1.3.6 更名同步
grep -q "EVOLUTION" engine/orchestrator/src/commons/retire.ts || echo "⚠️ 退役应走 EVOLUTION（刻意设计）"
```

---

#### 105. fresh-eyes worker 臆造链——b-fix 越界 + 碎片上下文编造（v1.3.4 新增 · B 类防回归 · run-01 事故）

**背景**：v1.3.4 run-01 的 b-fix worker 严重越界：臆造升级计划（automerge 排期）、新建 CI 配置（dependabot.yml）、改未来版本 changelog（v1.3.5/v1.4.x）。根因：工具预算 15/20 摸不完 2870 文件 → 撞硬熔断 → 碎片上下文编报告。be131c9e 三重防护（预算 40/50 + 证据门槛 + 反臆造铁律）已修，此维度守护防护不回归。

```bash
# 三重防护在位（driver 常量 + prompt 模板）
grep -q "PERSPECTIVE_TOOL_SOFT = 40" FORGE/src/fresh-eyes-driver.mjs || echo "⚠️ 预算回退到旧值"
grep -q "40 次工具调用" FORGE/SKILL/fresh-eyes-loop/prompts/a-check-perspective-1.md || echo "⚠️ prompt 预算未同步"
# b-fix 的 A3 审计拦截有效性（b-audit 对越界 commit FAILED）
grep -q "任务范围" engine/audit/src/rules/rule-a3*.ts 2>/dev/null || echo "ℹ️ A3 文件越界检测依赖规则引擎，人工抽查 b-fix diff 范围"
```

---

#### 106. 测试数文档同步——新增测试后文档声称数漂移（v1.3.4 新增 · B 类防回归 · 三次同坑）

**背景**：v1.3.4 周期三次犯同一错误：bugfix +31 测试（8 处漂移）/ dev +93（11 处）/ dsh +11（7 处）——每次新增测试后 README/WIKI/LIMITATIONS/ARCHITECTURE 的声称数都没同步，check-test-count.sh FAIL。已写入 SOP 阶段三步骤 4 强制门禁，此维度做双重保险。

```bash
bash tools/check-test-count.sh --quiet   # 期望 OK / EXIT=0
# 原则：新增/删除测试 = 必须同步文档声称数，check-test-count 不绿不算开发完成
```

#### 110. v1.3.5 bugfix 防复发五件——门禁盲区+假绿族+路径隔离（v1.3.5 新增 · B 类防回归 · 四份审查 38 项的浓缩 · 编号勘误：初版误用 107 与 v1.3.4 的 107 撞号，2026-08-16 阶段五修正为 110=当时最大 109+1）

**背景**：fresh-eyes 四份审查 38 项的防复发浓缩。三条核心防线：①守卫「找不到就跳过」= 空转四个版本无人知（#5）；②`| tail || true` 双保险吞退出码（#19）；③路径解析环境变量口径分裂污染真实数据（#38）。

```bash
# ① quick 规则数声称对账（防 #1）：README 声称与 dist 实测一致
README_N=$(grep -oE '17 条默认规则' README.md | head -1); [ -n "$README_N" ] || echo "⚠️ README quick 规则数口径漂移"
node -e "const m=require('./engine/audit/dist/rules/index.js');const d=m.defaultRules.length,x=m.extendedRules.length;if(d!==17||d+x!==24)process.exit(1)" || echo "⚠️ dist 规则数非 17/24，README 同步"
# ② check-version MCP 数含 ARCHITECTURE 能力总览（防 #3/#14）
bash tools/check-version.sh > /tmp/cv.log 2>&1; grep -qE "60 tools|MCP 工具数" /tmp/cv.log || echo "⚠️ MCP 工具数比对未含 ARCHITECTURE"   # v1.3.6：48→60（52+8 新 tool），数字勿写死——check-version 自身会跟 SSOT
node -e "const fs=require('fs');const s=fs.readFileSync('docs/ARCHITECTURE.md','utf8');const reg=require('./engine/mcp/dist/tool-registry.js');const actual=Object.keys(reg.TOOLS||reg).length||60;s.split('\n').forEach(l=>{const mm=l.match(/（([0-9]+) tools）/);if(!mm)return;const v=+mm[1];if(v!==actual&&!/v1.[0-3].[0-9]/.test(l))console.log('⚠️ ARCHITECTURE tools 数漂移:',mm[0],'实际',actual)})"   # v1.3.6：动态对账代替写死 48；行级版本豁免（含 v1.x.y 的历史演进行不算漂移——27=v1.2.5 时点真实数）
# ③ doctor dist 路径存在性 + 基线（防 #18）
node engine/audit/dist/index.js --doctor 2>&1 | grep -q "完整性校验通过" || echo "⚠️ 影子审计器基线链路失效"
[ -f ~/.sofagent/internal/audit-hash.txt ] || echo "⚠️ 哈希基线未生成"
# ④ 门禁失败路径自测（防 #5/#19/#27 假绿族）——守卫必须真的会红
_CTC=$(bash tools/check-test-count.sh 2>&1); echo "$_CTC" | grep -q "场景守卫" || echo "⚠️ 场景守卫段消失"; echo "$_CTC" | grep "场景守卫" | grep -qE "FAIL|✗" && echo "⚠️ 场景守卫在报红（先修再验）" || true   # v1.3.6：单次跑缓存输出判双条件（原两次全量 ~110s 必超时）
grep -E "^[^#]*| tail.*|| true" install.sh >/dev/null 2>&1 && echo "⚠️ install.sh 假绿模式回潮" || echo "✅ install.sh 无假绿（注释提及旧模式不算）"   # v1.3.6：排除注释行误报（#19 修复说明里引用了旧模式文本）
SOFAGENT_DATA=/tmp/rg-nonexist node engine/audit/dist/index.js --verify-chain > /tmp/vc.log 2>&1; [ $? -eq 1 ] || echo "⚠️ verify-chain 空链未 exit 1（假绿回潮）"; rm -rf /tmp/rg-nonexist /tmp/vc.log
# ⑤ SOFAGENT_DATA 隔离下 rule_disabled 落链断言（防 #38）
mkdir -p /tmp/rg-iso/data && printf 'rules:\n  a4: false\n' > /tmp/rg-iso-cfg.yml 2>/dev/null
grep -q "getHistoryFilePath" engine/audit/src/index.ts || echo "⚠️ rule_disabled 路径口径回退到 resolveAuditDir"
# ⑥ hook 双副本同步（防 #2）：仓库模板与已装现场副本一致——改模板不重装即测旧副本=假绿
diff <(grep -c "exitCode" engine/audit/hooks/post-commit) <(grep -c "exitCode" .git/hooks/post-commit 2>/dev/null) 2>/dev/null || echo "⚠️ post-commit 新旧副本逻辑不一致（模板改后未重装验证）"
# ⑦ archive 断链模式（防 #34）：压平迁移后引用路径必须跟着改
node -e "const fs=require('fs'),p=require('path');let bad=0;for(const f of fs.readdirSync('docs/archive/changelog-experimental')){if(!f.endsWith('.md'))continue;const c=fs.readFileSync(p.join('docs/archive/changelog-experimental',f),'utf8');for(const m of c.matchAll(/\]\((\.[^)]+)\)/g)){const t=p.resolve('docs/archive/changelog-experimental',m[1]);if(!fs.existsSync(t))bad++}}if(bad)console.log('⚠️ archive 断链 '+bad+' 处（迁移没跟引用）')"
```

---

#### 111. v1.3.5 新功能审查面——MCP 自进化+instinct+FDE 运维（v1.3.5 新增 · A 类 · 与 acceptance S270-S276 成对）

**背景**：v1.3.5 七大块交付的审查面。acceptance S270-S276 做执行级验证，本维度做静态一致性——两者成对构成新功能的完整回归网。

```bash
# ① MCP 52 tools 三处口径（SKILL.md / ARCHITECTURE 能力表 / dist 实测）
grep -q "60 tools" SKILL/SKILL.md || echo "⚠️ SKILL 工具速查漂移（v1.3.6 口径 60）"   # v1.3.6：52→60 勿写死，改版时随 SSOT
node -e "const m=require('./engine/mcp/dist/tool-registry.js');const doc=require('./package.json').version;console.log('✅ TOOLS='+m.TOOLS.length+'（registry 实数，勿写死——发版后人工对 SSOT 口径）')"   # v1.3.6：写死 52 必漂，改打印实数
# ② snapshot tool 零 daemon 静态依赖（optionalDependencies 场景会炸）
grep -q "@sofagent/daemon" engine/mcp/src/tools/snapshot-list.ts engine/mcp/src/tools/snapshot-restore.ts && echo "⚠️ snapshot 静态 import daemon 回潮"
# ③ evolver 永不写仓库 SKILL/（发布源污染防线）
grep -qE "join\(REPO|join\(process\.cwd|['\"]\.?/?SKILL/['\"]" engine/orchestrator/src/instinct/evolver.ts && echo "⚠️ evolver 触达仓库 SKILL/" || echo "✅ evolver 只写 SOFAGENT_HOME/skill/custom（join(dir,'SKILL.md') 是合法 custom 文件名）"   # v1.3.6：正则收窄——原 join.*SKILL 误伤 custom skill 的 SKILL.md 文件名
# ④ companion/fde-registry 的 daemon inspector 三步注册
grep -q "fde-companion-daily\|fde-registry" engine/daemon/src/inspector-layers.ts 2>/dev/null || grep -rq "runFdeCompanionDaily" engine/daemon/src/inspectors/ || echo "⚠️ FDE 巡检未注册 inspector"
# ⑤ 文档同步四件套（52 tools/2286 测试/v1.3.5 段/CHANGELOG 索引行）
grep -q "2286" README.md || echo "⚠️ README 测试数漂移"
grep -q "\*\*v1.3.5\*\*" CHANGELOG.md || echo "⚠️ CHANGELOG 索引缺 v1.3.5"
```


<!-- 瘦身判据记录 v1.3.5（阶段五步骤4 · SOP 首份执行）
①冗余：检查本版新增 2 维（110/111）——均为新审查面，无工具覆盖重复 → 无删
②重叠：MCP 聚簇 5 个（70/75/93/102/111）→ 归并 93 入 70（同主题重犯史），净 -10 行；check-version 聚簇 4 个（69/75/77/95）主题各异（英文版号/扫描路径/排除测试/日期硬编码）不并
③增长性质：110（bugfix 防复发）111（新功能面）均属新审查面非模式重复 → 保留独立维度
结论（v1.3.5 最终）：checklist 1499 行 ≤1500、acceptance 2497 行 ≤2500——靠真实归并消化增量（check-version 四盲区 69/75/77→95 净 -28 行、acceptance 注释/装饰框/冗余分组 -42 行），警戒线未上调
-->

#### 112. shadow 快照二进制安全——isBinaryBuffer 跳过二进制（v1.3.5 发布后 hotfix）

> 裂图事故：shadow 快照 `readFileSync(utf-8)` 读二进制 PNG，0x89 被静默替换 U+FFFD 致 6 图永久损毁——二进制必须跳过不进文本快照。

```bash
grep -q "isBinaryBuffer" engine/core/src/filesystem/isomorphic-git.ts && echo "✅ 跳过二进制" || echo "❌ 缺 isBinaryBuffer"
grep -qi "png" engine/core/src/__tests__/isomorphic-git-v2.test.ts && echo "✅ PNG 测试" || echo "❌ 缺 PNG 测试"
```

#### 113. v1.3.6 新功能审查面——八交付锚点一维收口（阶段五来源提取 A 类）

> v1.3.6 十六项交付的核心面收口为一维（acceptance S282-S289 已有端到端断言，此处是快速 grep 版——审查 session 分钟级可跑）。检查命令全部指向**实际实现路径**（changelog 的涉及文件表是开发前预估，ontology 管线实际在 `import-pipeline.ts` 非 `writer.ts`——S283 初版就错在这）。

```bash
# 引擎接口外化四件
test -f engine/orchestrator/src/workflow/container.ts && grep -q "ContainerDeps" engine/orchestrator/src/workflow/container.ts && echo "✅ ①容器+沙箱宿主位" || echo "❌ ①缺"
test -f engine/orchestrator/src/ontology/import-pipeline.ts && grep -q "D1-D5" engine/orchestrator/src/ontology/import-pipeline.ts && echo "✅ ②注入管线" || echo "❌ ②缺"
grep -q "allow-with-audit" engine/orchestrator/src/harness-sdk/wrap.ts && test -f engine/orchestrator/src/harness-sdk/builder-registry.ts && echo "✅ ③托管SDK" || echo "❌ ③缺"
test -f engine/orchestrator/src/model-registry.ts && grep -q "routeReason" engine/audit/src/decision-schema.ts && echo "✅ ④模型注册+路由可解释" || echo "❌ ④缺"
# 训练与验收
grep -q "SIGINT" engine/orchestrator/src/train/train-protocol.ts && grep -q "train_budget_exceeded" engine/orchestrator/src/train/train-budget.ts && echo "✅ ⑥⑦训练契约+预算" || echo "❌ ⑥⑦缺"
grep -q "define_acceptance" engine/mcp/src/tools/acceptance.ts && echo "✅ ⑨验收tool" || echo "❌ ⑨缺"
# 可靠性件
grep -q "postToolCall" engine/orchestrator/src/middleware/dual-gate-mw.ts && test -f engine/daemon/src/fatigue.ts && grep -q "safe-stop" engine/audit/src/degradation.ts && echo "✅ ⑫⑬⑭双闸+疲劳+降级" || echo "❌ 可靠性缺"
grep -q "DecisionCategory" engine/audit/src/decision-schema.ts && echo "✅ ⑮decisions五分类" || echo "❌ ⑮缺"
```

#### 114. v1.3.6 run-03 修复防复发——脱敏两层同源 + 安全渠道 + worktree 信号清理

> fresh-eyes run-03 的 3 条 P1 修复锚点（finding-01 安装 URL 属发版中间态不在此列——阶段十一 4b 消解）。

```bash
# finding-02：prompt 层与 tool 层脱敏同源（模块加载级行为断言在 prompt-sanitizer.ts 内）
grep -q "sk_live_\|sk_(live|test)" engine/core/src/security/prompt-sanitizer.ts && echo "✅ prompt 层 Stripe 覆盖" || echo "❌ 脱敏不对称回退"
grep -q "SHARED_REDACTION_SAMPLES" engine/core/src/security/prompt-sanitizer.ts && echo "✅ 两层漂移断言在位" || echo "❌ 防漂移断言丢失"
# finding-03：noreply 邮箱不得复列为联系渠道（commit 邮箱无妨）
grep -q "Security Advisory" SECURITY.md && ! grep -q "noreply.*备选" SECURITY.md && echo "✅ 漏洞渠道单通道" || echo "❌ 摆设渠道回潮"
# worktree 留存根治（双 driver 均接线）
grep -q "registerSignalCleanup" FORGE/src/driver-base.mjs && grep -q "registerSignalCleanup\|cleanupStaleWorktrees" FORGE/src/fresh-eyes-driver.mjs && grep -q "registerSignalCleanup\|cleanupStaleWorktrees" FORGE/src/release-gate-driver.mjs && echo "✅ 信号清理双 driver" || echo "❌ 镜像漂移回退"

#### 115. v1.3.7 新功能审查面——沙箱五件套/权限三防线/并发三级来源/OKF 三件套（阶段四来源提取 A 类）

> v1.3.7 八项硬交付的核心锚点一维收口（acceptance S290-S292 同面端到端，分层同 113/282 先例）。⑧ TDAI 触发器型零动作不设锚点（条件未到）。

```bash
# ① 沙箱五件套：DNS+raw socket 全拦 / fail-closed / key 脱敏 / 原子合并 / 攻击面声明
grep -q "dns.lookup\|dns\.resolve" engine/orchestrator/src/sandbox/network-gateway.ts && echo "✅ DNS 隧道拦截" || echo "❌ 网关漏 DNS"
grep -q "未注册" engine/orchestrator/src/sandbox/tool-gate.ts && echo "✅ 工具门 fail-closed" || echo "❌ 未注册放行"
grep -q "mask" engine/orchestrator/src/sandbox/virtual-key.ts && echo "✅ 虚拟 key 脱敏" || echo "❌ key 明文泄露面"
[ -f engine/orchestrator/src/sandbox/ATTACK-SURFACE.md ] && echo "✅ 攻击面声明在位" || echo "❌ 声明缺失"
# ② 场景权限三道防线 + ③④⑤ Shield/overlay/断路器
grep -q "fail-closed" engine/orchestrator/src/permission/scenario-router.ts && echo "✅ 权限 fail-closed" || echo "❌ 权限开放默认"
grep -q "Shadow" engine/audit/src/agent-shield.ts && echo "✅ Shadow AI 三源" || echo "❌ 影子 agent 盲区"
grep -q "canAcceptTask" engine/orchestrator/src/sandbox/circuit-breaker.ts && echo "✅ ASI10 隔离联动" || echo "❌ 断路器孤立"
# ⑥ lifecycle 审阅门 + OKF（spec 字段名 stale_after 非 valid_after）
grep -q "migrateToTrunk" engine/ontology/src/merge-engine.ts && echo "✅ trunk 审阅门" || echo "❌ 直通 trunk"
grep -q "stale_after" engine/ontology/src/merge-engine.ts && echo "✅ OKF 时效字段" || echo "❌ 字段名漂移"
grep -rn "okfViolation" engine/mcp/src/tools/create-entity.ts > /dev/null && echo "✅ type 必填拒绝" || echo "❌ OKF① 缺失"
# ⑦ 并发三级来源（CLI>env>adaptive>fallback 后写者胜）+ ⑨ persona 三级
grep -q "resolveMaxConcurrency" FORGE/src/driver-base.mjs && echo "✅ 自适应并发" || echo "❌ ⑦ 未接线"
grep -q "SOFAGENT_PERSONA_SOURCE" engine/core/src/filesystem/memory-sync.ts && echo "✅ persona env 优先" || echo "❌ ⑨ 路径写死回退"
```

#### 116. v1.3.7 bugfix 批防复发——verify-commit 路径②收紧 + test-count 双层防御 + hook 成功回声

> 阶段一 26 项 bugfix 的 P0 级锚点（其余文档类由 check-version/check-docs 覆盖）。

```bash
# P0-1：路径②（selfMatched）必须 ⚠️ EXIT=1 不放绿灯
grep -q "selfMatched" engine/audit/src/commands/verify.ts && grep -q "process.exit(1)" engine/audit/src/commands/verify.ts && echo "✅ 洗白链已堵" || echo "❌ 归因歧义回退"
# P0-3：FLAKY_PKGS 头部初始化 + Test Files 漏收集拒采
grep -q 'FLAKY_PKGS=""' tools/test-count.sh && echo "✅ set -u 初始化" || echo "❌ unbound 炸弹回植"
grep -q "漏收集" tools/test-count.sh && echo "✅ 漏收集防御" || echo "❌ 静默变小回退"
# P1：HOOK_TEMPLATE 成功回声（可感知性）
grep -q "审计通过" engine/core/src/config-template.ts && echo "✅ 成功回声在位" || echo "❌ 静默保护回退"
# 红队四项：追加伪造判篡改 + A2 二进制 WARN
grep -q "tampered" engine/audit/src/commands/verify.ts && echo "✅ 追加伪造拦截" || echo "❌ legacy 容忍回退"
grep -qE "\.bin|Binary files" engine/audit/src/rules/rule-a2-secret-leak.ts && echo "✅ 二进制边界 WARN" || echo "❌ blob 绕过回开"
# rm -rf 正则口径统一：两扫描器豁免必须同源
grep -q '(?!tmp|home' engine/audit/src/rules/skill-safety-rules.ts && grep -q '(?!tmp|home' engine/audit/src/agent-shield.ts && echo "✅ rm-rf 豁免同源" || echo "❌ 口径漂移回退"
# FORGE driver LLM 超时：四文件实例化点缺一即挂死风险回植
# （注意：不用 awk 管道——driver bash -c 注入场景 \$ 转义会炸，改用逐文件 grep -q 链，无转义依赖）
grep -q 'timeout: 600_000' FORGE/src/driver-base.mjs && grep -q 'timeout: 600_000' FORGE/src/fresh-eyes-driver.mjs && grep -q 'timeout: 600_000' FORGE/src/release-gate-driver.mjs && grep -q 'timeout: 600_000' FORGE/src/tool-output-budget.mjs && echo "✅ LLM 超时四文件全覆盖" || echo "❌ 超时保护缺失"
# FORGE resume 越轮泄漏 + S146 cwd 漂移 + check-version 溯源豁免（v1.3.7 三实录防复发）
grep -q 'round === resumeState?.round' FORGE/src/fresh-eyes-driver.mjs && echo "✅ resume 守卫" || echo "❌ 越轮泄漏回植"
grep -q 'cd "\$PROJECT_ROOT" && NODE_OPTIONS' FORGE/playbook/acceptance-test.sh && echo "✅ S146 cwd 回位" || echo "❌ 漂移回植"
grep -q 'ver == SSOT' tools/check-version.sh && grep -q '新增|增强' tools/bump-version.sh && echo "✅ 溯源豁免" || echo "❌ 溯源误报回植"
```
<!-- 瘦身判据（v1.3.6 详录见 git 历史；v1.3.7：①②③全否——116 子项 3 条+S293 均三死实录新审查面；checklist 触 1585>1580 且本版已上调一次触发冻结 → 压缩 v1.3.6 注释 13→3 行真实归并达标未再上调；acceptance 2633<2640 ✓ / fresh-eyes 400=400 ✓）
-->
