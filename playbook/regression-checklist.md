# sofagent 回归检查清单

> **用途**：每次发版前跑一遍，确认之前修过的问题没有回退。发现新问题用 [fresh-eyes-review](./fresh-eyes-review.md)。审查范围：全仓库状态检查（不是只看增量）。**编号规则**：归并项直接删除、编号不复用；演进历史 `git log -p` 可溯，本清单只维护当前状态。
> **当前 85 维 · 编号 1-145 · 59 个编号已归并删除（#9 已并入 #18 · 阶段四归并配额）**。维度流连续不中断，分组导航：基线组 → 审查约束组 → 环境敏感组（前置 vitest/沙箱铁律）。

## 🔒 维护公约（防膨胀铁律）

**追加新维度前，必须先 grep 同类**：有同类 → 扩展旧维度的子项，不新增编号；无同类 → 才新增编号 = 当前最大 +1。历史维度靠 `git log -p` 找回。

**归并配额（硬门槛）**：新增 N 维 → 本版必须先真实归并 ≥N 维（被并内容实际移入目标维度，git diff 可查；注释压缩不算）；🔴 **「实际移入」的判据是断言，不是行数**——归并提交须附「承接断言清单」（逐条写「原断言 → 目标维度承接位置 → 等价说明」），且每条原断言的关键词须能在目标维度里 `git -S <关键词>` 命中；**只删不承接 = 误删**（目标壳零承接断言时行数代理一律看不出来），故归并前后断言关键词计数不得下降；净增行数 > 警戒线余量 → 继续归并或移下一版——**只调警戒线不归并 = 不合格**。
**行数警戒线（当前值）**：`regression-checklist.md` ≤ 1950 行、`acceptance-test.sh` ≤ 4500 行（实测注记：checklist 1949→1960 被首轮修复批净增 11 行顶破 S426 结构锁——「口径105 注释演进链 + F6 动态窗口 + hook git-path 解析」均为真实判据内容，按「先归并对销」处理，见下方自检段）。

**维度脚本编写四铁律**（教训——7 个 FAIL 维度中 5 个是脚本自身缺陷，driver 白跑一轮）：
1. **显式收尾**：每个维度的检查命令必须以 `echo "✅ ..."` 或 `echo "❌ ..."; exit 1` 收尾——**禁用「期望：无输出」「期望：exit 1」这类依赖退出码语义的写法**。driver 只看 exitCode，`grep 无命中返回 1` / `for 循环尾判假返回 1` 都被误判 FAIL（#59/#96 实证——输出全 ✅ 仍记 FAIL）。
2. **禁写死 CLI 参数签名与数字**：检查命令引用 CLI 或计数（N tools / N 规则）时版本演进必漂（#56 `--golden-set` 被移除、#110 `48 tools` 在 52→60 后 FAIL）。写**动态对账**（读 tool-registry 实数比文档）或**可达性验证**（`--help` 含子命令名）。**已写死的历史锚**：工具数变更的版本发版中必漂——bump/工具数变更 commit 后逐锚跑受影响维度，锚过时改锚、真漂移修文档，不等 release-gate 轮才暴露。
3. **修改 checklist 的 commit 前最后跑一次 check-docs**：B 层预算会被修复净增顶破（实测一天两次 8880→8885→8895）——commit 后才发现 CD 红等于多一个 fix commit。
4. **跨进程边界只传退出码，不传变量**：`bash script.sh` 调子脚本时子进程内变量不回传（要读写须 `source` 同进程）。取证一律 `cmd > log 2>&1; echo $?`——**`cmd | tail; echo $?` 取到的是 `tail` 的退出码**（实证两案：`bash 守卫.sh` 后查 `FAIL` 恒 0 误判守卫生效；管道取退出码把「注入被拦 1」读成 0）。

**清单自身健康度自校验**（每次修改后跑）：
```bash
(
HEAD_VAL=$(grep -oE '当前 [0-9]+ 维' playbook/regression-checklist.md | grep -oE '[0-9]+' | head -1)
ACTUAL=$(grep -c "^#### " playbook/regression-checklist.md)
[ "$HEAD_VAL" = "$ACTUAL" ] && echo "✅ 维度数一致 ($HEAD_VAL)" || echo "❌ 头部声称 $HEAD_VAL ≠ 实际 $ACTUAL"

# 行数警戒线自检（越线即 FAIL——与 check-review-system.sh §1d 同口径；本段是速览，门禁是权威）
WC_CHK=$(wc -l < playbook/regression-checklist.md); WC_ACC=$(wc -l < playbook/acceptance-test.sh)
[ "$WC_CHK" -le 1950 ] && echo "✅ checklist $WC_CHK (≤1950)" || { echo "❌ checklist $WC_CHK 超 1950（check-review-system 判 FAIL——走归并，不走上调）"; RC=1; }; [ "$WC_ACC" -le 4500 ] && echo "✅ acceptance $WC_ACC (≤4500)" || { echo "❌ acceptance $WC_ACC 超 4500（同上）"; RC=1; }; exit ${RC:-0}  # 超线非零退出（人工执行可注释掉末行——防误伤终端后续命令）
) 2>&1 | tee "/tmp/regress-dim-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim-$$.log" && { rm -f "/tmp/regress-dim-$$.log"; echo "该维度收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim-$$.log"; true
```
## 你的身份

你是**回归测试工程师**——确认已知的修复没有回退，不是发现新问题。逐项核对，全 PASS 即通过。⏰ 时序：回归检查在阶段六跑，git tag/npm registry 未到位的项标 ⏳。🔍 维度 7f/17a-b/20 依赖真实环境（npm/git/OpenClaw），AI 审查标 `⏸️ 需人工环境`。

## 审查维度（85 维 · 编号规则见头部）

### 审查维度正文（#1-142 · 维度流连续不中断）

版本号全量一致 · 铁律措辞清零 · Skill 行数 ≤100 · 测试数一致（维度 13 SSOT 反查） · git status 零未提交修改

#### 1. CHANGELOG 纯度与完整性

```bash
# 子项 a: 纯度——不含审查过程元信息（历史版本交付的功能名不算——产品交付史非审查过程泄漏，用 -v 排除「交付」语境行）
# ⚠️ 裁剪规则（fresh-eyes A-9）：glob 由 docs/changelog/vX.Y.md 单层形态修正为嵌套目录形态（原 glob 零匹配 = 子项从未真正执行）。
# 修正后实测命中 ~365 行，全部位于已发版 devlog 历史区——devlog 对审查体系自身演进（fresh-eyes 视角更新 / 审查驱动修复等）的记述属**产品交付史正当记述**（历史冻结档案，豁免理由同 check-archaeology 的 E7 台账形态）；故 -v 排除面扩 devlog 目录，纯度判定面收敛到 CHANGELOG.md 索引 + docs/ROADMAP.md 现态（实测零命中）。
grep -rniE "GLM|DeepSeek|双视角|P[012]×|审查修复|陌生视角|fresh-eyes|审查轮次|审查×|审查驱动|审查吸收" CHANGELOG.md docs/ROADMAP.md 2>/dev/null | grep -viE "流程化|成本重构|B 侧复核|usage.jsonl|审查修复批|DeepSeek harness" || true # 期望：零命中（索引与现态文档；devlog 历史区豁免——见上裁剪规则。「审查修复批」= 章名形态的产品交付记述（历版发版后审查修复批均此形态）、「DeepSeek harness」= 节点构建技术选型——均非审查过程泄漏，入排除面）
# 子项 b: 孤儿 changelog 检测（glob 同修为嵌套目录形态；tag 名按 basename 推导——嵌套目录 vMajor.Minor/vX.Y.Z.md 映射 tag vX.Y.Z，对齐 dev-prompt-checklist 历史档案口径先例）
# ⚠️ 裁剪规则：规划中版本（devlog 头部标「尚未实现」）无 tag 是**预期态非孤儿**（发版时才打 tag）——已标「尚未实现」的文件跳过；仅「声称已发版却无 tag」才报孤儿。
for f in docs/changelog/v*/*.md; do v=$(basename "$f" .md); grep -q "尚未实现" "$f" && continue; git rev-parse "$v" >/dev/null 2>&1 || echo "⚠️ $v: 无对应 tag ($f)"; done || true
# 子项 c: CHANGELOG 索引含全部已发版 tag + 规划版独立分组
grep -A1 "## 规划中" CHANGELOG.md | head -1 # 期望：有「规划中」独立标题
# 子项 d: README 对核心文档链接可发现性
grep -c "ARCHITECTURE.md" README.md # 期望: ≥ 1
# 子项 e: 当前版本条目不含审查元信息（原维度 48e）
LATEST_VER=$(grep -m1 "^### \[v" CHANGELOG.md | grep -oE 'v[0-9.]+'); sed -n "/^### \[$LATEST_VER\]/,/^### \[v/p" CHANGELOG.md | grep -qE "P[012]×|fresh-eyes|审查轮次" && echo "⚠️ CHANGELOG 当前版本含审查元信息" || true
# 子项 f: ROADMAP 版本头描述与当前版本一致（原维度 48a）
sed -n '4p' docs/ROADMAP.md | grep -qE "后训模块|数据与评估|FDE Harness|六引擎|IM 桥" || echo "⚠️ ROADMAP 版本头描述可能错配" # 关键词须随发版同步更新（口径）
# 子项 g: SECURITY.md 旧描述清理（原维度 48d）
grep -q "不做内容安全校验" SECURITY.md && echo "⚠️ SECURITY.md L86 推辞过时" || true
# 子项 h: SKILL.md 铁律/底线数标题声称与实际一致（原维度 48g；底线是有序列表 `N. ` 格式） 防御（定谳尾判假）：`[ ] && echo ⚠️` 在健康态（相等）时 `[ ]` 返 1 → 整维度 exit=1 假红，改显式 if、健康态显式 exit 0
SKILL_BC=$(grep -oE "### ([0-9]+) 底线" SKILL/SKILL.md | grep -oE "[0-9]+" || echo 0); SKILL_BA=$(sed -n '/^### [0-9] 底线/,/^### /p' SKILL/SKILL.md | grep -cE "^[0-9]+\. " || echo 0); if [ "$SKILL_BC" != "$SKILL_BA" ]; then echo "⚠️ SKILL.md 底线数 $SKILL_BC vs $SKILL_BA"; exit 1; fi; echo "✅ SKILL.md 底线数一致 ($SKILL_BC)"
# 子项 i: CHANGELOG 索引条目 + 日期链（归并原维度 107——索引是 check-version 日期提取的上游，漏了整条链断）
CUR_VER=$(node -p "require('./package.json').version"); grep -q "\*\*v${CUR_VER}\*\* —" CHANGELOG.md || echo "⚠️ CHANGELOG 缺 v${CUR_VER} 索引条目（日期链会断）"; grep -m1 "v${CUR_VER}.*—" CHANGELOG.md | grep -oE "[0-9]{4}-[0-9]{2}-[0-9]{2}" > /dev/null || true
# 子项 j: README 中英文版本段同步（归并原维度 68——版本号与描述同段，修一层必核另一层）
CN_VER=$(grep -m1 -oE '^## v[0-9]+\.[0-9]+\.[0-9]+' README.md | grep -oE 'v[0-9.]+'); EN_VER=$(grep -m1 -oE '^## v[0-9]+\.[0-9]+\.[0-9]+' README.en.md | grep -oE 'v[0-9.]+'); [ -n "$CN_VER" ] && [ "$CN_VER" = "$EN_VER" ] && echo "✅ README 双语版本段一致 ($CN_VER)" || echo "⚠️ README 双语版本段不一致：CN=$CN_VER EN=$EN_VER"
# 子项 k: 新文件版本头匹配当前 SSOT（归并原维度 78——开发期禁超前写下一版本号，bump 时统一提升）
bash tools/check/check-version.sh 2>&1 | grep "TS 文件头" | grep -q "✓" && echo "✅ 版本头一致" || echo "⚠️ 参见 check-version TS 文件头段"
# 注：echo 变量插值禁全角括号——macOS bash 3.2 多字节展开 bug 吞「）」首字节+变量值（FFFD），半角安全
```

#### 3. 文档规范源与归属一致性

```bash
(
# 子项 a: think.md 始终为 Ledger/source（非 Views/派生视图） 注意：grep 须精确匹配"think.md 被标为 Views"，而非"think.md 和 Views 出现在同一行" 正确模式：think.md 后跟 Views/派生（think.md = Views）→ 误标；think.md 后跟 Ledger/source → 正确
grep -rnE "think\.md *= *(Views|派生视图)|think\.md（Views" docs/ARCHITECTURE.md docs/PHILOSOPHY.md docs/DEVELOPMENT.md FDE/GUIDE.md; # 期望：无匹配
# 正则收紧（实证）：原 `think\.md.* Views` 会跨语义单元误命中——正解行写的是
# 「task/logs + think.md = Ledger → knowledge/ = Views」，同行后续出现 Views 即被误判。
# 本注释上方原有「正确模式：think.md 后跟 Views/派生」的说明，正则却未按该意图实现，
# 属实现与注释不符，现按注释收紧为「think.md 紧邻 = Views/派生视图」形态。

# 子项 b: canonical source 一致性
grep -rn "Ledger-Views-Policy" docs/ARCHITECTURE.md docs/PHILOSOPHY.md docs/DEVELOPMENT.md | head # 期望：各文档描述一致

# 子项 f: WIKI.md 存在 + 七节结构完整（原维度一词归并）
[ -f docs/WIKI.md ] && echo "✅ WIKI.md 存在" || echo "❌ WIKI.md 缺失"
# 两处修正（实证）：① BSD grep 的中文方括号字符类 [一二三…] 恒 0 匹配——
# 改展开式交替；② `grep -c … || echo 0` 在无匹配时既输出 0 又返回 1，`|| echo 0` 会再补
# 一个 0 → 变量成两行，后续 [ -ge ] 报 integer expression expected。
WIKI_SECTIONS=$(grep -cE "^## (一|二|三|四|五|六|七)、" docs/WIKI.md 2>/dev/null || true); WIKI_SECTIONS=${WIKI_SECTIONS:-0}
[ "$WIKI_SECTIONS" -ge 7 ] || echo "❌ WIKI.md 节数不足（期望 ≥7，实际 $WIKI_SECTIONS）"
grep -c "WIKI" README.md # ≥1

# 子项 g: 归档内容旧术语口径声明——archive/ + changelog/v1.0-v1.1 含旧术语（四引擎/认知底座），WIKI.md 须有免责声明
grep -q "历史快照\|旧术语\|不代表现行设计" docs/WIKI.md # 期望：命中

# 子项 h: 版本归属级联一致性——活文档引用的 feature 版本须与 ROADMAP 权威表一致（教训：age 挂错版本 5 处）
grep -rn "v1\.[0-9]\.[0-9]" docs/ SECURITY.md LIMITATIONS.md README.md --include="*.md" 2>/dev/null | grep -v changelog | grep -v archive # 人工核对：与 ROADMAP 版本表一致

# 子项 i: 被引用权威源自含性——所有"见 ROADMAP"引用的 feature，ROADMAP 自身须含该项（教训：引用处写 age 但 ROADMAP 权威表缺此条）
grep -rn "见.*ROADMAP\|详见.*ROADMAP" docs/ SECURITY.md LIMITATIONS.md --include="*.md" 2>/dev/null | grep -v changelog # 人工核对：ROADMAP 含对应条目

# 子项 j: 内部件「XX引擎」旧称零回归——判据 = 是否指约束层内部件（五模块/五能力/子组件），指内部件即旧称，须改「模块/能力/流程」或直称其名
#   保留类（命中即正常，非回归）：六引擎（FDE 专名）· 绩效量化引擎（私有产品专名，代号不入开源文档）· 通用技术名（规则/搜索/存储/检测/AST/状态机/OCR/Git 引擎）·
#   外部系统转述（Microsoft AGT 等）· 历史快照区 · 记录旧名的说明行 · 代码 API 名（`AuditEngine` / `engine/audit` / `runAuditGate`）
#   词表含「引擎包」（→「模块包」；原 README 门禁锚定词，已随同批改门禁字面量后取消豁免，见 check-test-count.sh B13）
#   口径：git grep 全量（宽口径——`--include` 白名单会造假空，漏过 .html/.svg/.ps1/无扩展名脚本）；排除本清单自身（含旧称字面量，否则永久自命中）
git grep -nE "审计引擎|训练引擎|编排引擎|回溯引擎|自迭代引擎|质量评估引擎|场景匹配引擎|评测引擎|commons 引擎|instinct 引擎|rules 引擎|quick 引擎|audit 引擎|loop-agent 引擎|Onboard 引擎|归属引擎|入口引擎|文件扫描引擎|引擎包|生成引擎签名" -- . ':(exclude)docs/archive/*' ':(exclude)docs/changelog/*' ':(exclude)CHANGELOG.md' ':(exclude)docs/evidence/*' ':(exclude)playbook/regression-checklist.md' ':(exclude)*/dist/*' # 人工核对：命中须为上方保留类，否则即旧称回归（须改回新称）
) 2>&1 | tee "/tmp/regress-dim-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim-$$.log" && { rm -f "/tmp/regress-dim-$$.log"; echo "该维度收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim-$$.log"; true
```

#### 4. 审计规则分级与 ruleClass 多处声明一致性——index.ts ↔ README ↔ rule-*.ts（归并 #89 入此 · 源删 17 行 / 目标增 12 行，净减 5 行）

> **背景**：A3 ruleClass 在 index.ts（注册中心）/ rule-a3-*.ts（规则实现）/ README（文档）三处声明，版本演进时容易只改一处忘记其他——审查捕获 A3 在 index.ts 标"能力拐杖"、rule-a3-*.ts 标"业务底线"的不一致。

```bash
# 子项 a-c: A4=业务底线 / 规则总数=25（A20-A23 加入后 21→24，A24 加入后 24→25）/ A6=能力拐杖 A11=业务底线
grep -A5 "'A4\|name.*不删配置" engine/audit/src/rules/index.ts | grep "ruleClass" | grep "业务底线"
grep "name:" engine/audit/src/rules/index.ts | wc -l # 期望 25
grep "A6.*能力拐杖\|A11.*业务底线" engine/audit/README.md | wc -l # 期望 2

# 子项 d: ruleClass SSOT ↔ README 逐条比对（盲区 重写） 注：旧版用 `diff <(index.ts 代码) <(README 表格行)`——两种文本格式天生不同，永远报差异（误报 12 行）。 改为两侧归一化成「A编号 ruleClass」再比对，才是真正检查"每条规则分级两边一致"。
diff <(grep -E "name: 'A[0-9]+" engine/audit/src/rules/index.ts | sed -E "s/.*name: '(A[0-9]+)[^']*'.*ruleClass: '([^']+)'.*/\1 \2/" | sort) \
 <(grep -E "^\| A[0-9]+ " engine/audit/README.md | awk -F'|' '{n=split($2,arr," "); id=arr[1]; cls=$(NF-1); gsub(/^[ \t]+|[ \t]+$/,"",id); gsub(/^[ \t]+|[ \t]+$/,"",cls); print id, cls}' | sort) # 零差异

# 子项 e-g: evidenceMode 计数 + README 表行数 + MCP 规则数（教训）
echo "git-diff=$(grep -c "evidenceMode: 'git-diff'" engine/audit/src/rules/index.ts) hybrid=$(grep -c "evidenceMode: 'hybrid'" engine/audit/src/rules/index.ts) fs=$(grep -c "evidenceMode: 'filesystem'" engine/audit/src/rules/index.ts)" # 人工核对 README
INDEX=$(grep -cE "name:[[:space:]]*'A[0-9]|name:[[:space:]]*'E[0-9]" engine/audit/src/rules/index.ts)
TABLE=$(grep -cE "^\| A[0-9]+ |^\| E[0-9]+ " engine/audit/README.md)
echo "index=$INDEX / README表=$TABLE（期望 TABLE≥INDEX）" # 注：A18/A19 漏更新
grep "rulesCount" engine/mcp/src/tools/report-tools.ts | head -1 # MCP 数字动态化（拆分后非硬编码）|| true

# 子项 h: 口径一致性硬断言（校准：17/22/25 三口径并存防复发）—— 注册数 = 默认数 + 扩展数 = 25，且横幅签名已统一「N 项检查 · M 条规则」口径
RULE_CNT_OK=$(node -e "
const src = require('fs').readFileSync('engine/audit/src/rules/index.ts', 'utf8');
const cnt = (re) => { const m = src.match(re); if (!m) return -1; return (m[0].match(/name:\s*'(A|E)[0-9]+/g) || []).length; };
const d = cnt(/export const defaultRules[\s\S]*?^\];/m), e = cnt(/export const extendedRules[\s\S]*?^\];/m);
process.exit(d === 17 && e === 8 ? 0 : 1);
" 2>/dev/null && echo yes || echo no)
if [ "$RULE_CNT_OK" != "yes" ]; then echo "⚠️ 规则口径漂移：defaultRules≠17 或 extendedRules≠8"; exit 1; fi
grep -q "项检查" engine/audit/src/reporter.ts || { echo "⚠️ productSignature 未统一「N 项检查 · M 条规则」口径"; exit 1; }
echo "✅ 规则口径一致：17 默认 + 8 扩展 = 25 注册，签名口径已统一"

# 子项 i（原 #89 迁入）: 每条规则的 ruleClass 在 index.ts 和 rule-*.ts 必须一致 修复（校准：误报）：旧脚本 for 空格分词 + rule_name 恒空全报 ⚠️ → 改按 number 定位对比。
for n in $(grep -oE "number: [0-9]+" engine/audit/src/rules/index.ts | grep -oE "[0-9]+" | sort -un); do
 idx=$(grep -E "number: $n" engine/audit/src/rules/index.ts | grep -oE "ruleClass: '[^']+'" | head -1)
 impl=$(grep -hoE "ruleClass: '[^']+'" engine/audit/src/rules/rule-a${n}-*.ts 2>/dev/null | head -1)
 [ -z "$impl" ] && continue # 规则实现不存在（如 A12/A13 并入 A11）跳过
 [ "$idx" = "$impl" ] || echo "⚠️ rule-a${n}: index=$idx vs impl=$impl"
done # 期望：无 ⚠️ 输出（index.ts SSOT，rule-*.ts 对齐）
# 单源化 refactor 须保留派生导出（归并原维度 99——外部脚本/acceptance 依赖 AUDIT_PRIORITY.critical 形态查询）
node -e "const m=require('./engine/audit/dist/rules/runner.js');const c=m.AUDIT_PRIORITY?.critical;if(!c||!c.includes('A20'))process.exit(1)" || echo "⚠️ AUDIT_PRIORITY 向后兼容导出缺失"
```

#### 7. 感知层配置与推送链路

```bash
# 子项 a: 配置完整性（勘误：perception 段已随维度 42 移除——全代码库零读取点， config.yml 里只剩移除说明注释。本检查改为「移除说明在位」防 perception 借尸还魂 + audit.webhook 配置项健康）
if [ -f .sofagent/config.yml ]; then
 grep -q "perception" .sofagent/config.yml && grep -q "已移除" .sofagent/config.yml && echo "✅ perception 移除说明在位（防死配置回流）" || echo "⚠️ config.yml 无 perception 移除说明（可能是旧版配置残留，重跑 --init 刷新）"
else
 echo "⏸️ .sofagent/config.yml 不存在（运行时文件，需 sofagent-audit --init 生成）——跳过配置检查"
fi

# 子项 b: 推送目标（同上：config.yml 不存在时跳过）
[ -f .sofagent/config.yml ] && { grep "push_target:" .sofagent/config.yml | grep -q "webhook://" && echo "✅ 已配置" || echo "⏸️ 未配置 webhook（部署期用户自备参数，非缺陷态）"; } || echo "⏸️ config.yml 不存在，跳过 push_target 检查"

# 子项 c: MCP 返回值签名（追加—所有 sendToolResult text 必须带 [sofagent]）
grep -rn 'sendToolResult' engine/mcp/src/mcp-server.ts | head -5
# 人工检查：每个 sendToolResult 的 text 字段开头必须以 [sofagent] 或 sofagent 开头

# 子项 d: Webhook PASS 推送
grep -c "PASS" engine/audit/src/webhook.ts # 应 > 0

# 子项 e: MCP capabilities 准确性（被 check-docs.sh §7 跨文档对照覆盖）

# 子项 f: CLI stdout 签名一致性（教训—感知层废墟高发区）
node engine/audit/dist/index.js --version 2>&1 | grep -q "sofagent" && echo "✅ --version 签名存在"
grep -c "sofagent-audit.*v\|sofagent-audit ·" engine/audit/src/index.ts # 期望：≥ 1
grep -c "sofagent-audit · \|sofagent-audit v" engine/audit/src/index.ts # 期望：≥ 1（词形对齐 L3 现形——旧「审计模块」注释已改版）
# 人工跑一次 --doctor 和 --init，确认输出开头带 sofagent
```

#### 8. acceptance-test 健壮性

```bash
# 子项 a: 管道吞退出码保护（范围：acceptance-test.sh + tools/ + engine/scripts + install.sh）
# 判据收窄到**真坑形态**：管尾是 head/tail/wc/sort（恒返回 0）且随后判退出码。
# ⚠️ 三类**不是**坑、勿误报：① 管尾是 grep 的形态（`... | grep -q X && pass || fail`）——$? 即 grep 的码；
#    ② 命令替换取输出（`$(... | wc -l)`）不判码；③ 故意的 `|| true` / `|| echo` 兜底。
# 实证（本版）：全仓真坑 = 1 处（S317 的 `| head -1 >/dev/null ||` 恒 0 ⇒ 场景恒绿）→ 已修。
grep -rnE '\| *(head|tail|wc|sort)[^|]*(\|\||&&|; *\$\?)' --include="*.sh" playbook/ tools/ engine/scripts/ install.sh 2>/dev/null | grep -vE ':(#|.*grep -q ")' | grep -v '|| true' | grep -v '|| echo' || echo '✅ 无未保护管道（真坑形态判据 · 全仓脚本）' # 期望：✅ 行

# 子项 b: 场景间清理
grep -c "git rm --cached -f .env" playbook/acceptance-test.sh # 期望：≥ 2

# 子项 c: --init 烟测期望值与实际对齐（教训）
DEFAULT_COUNT=$(grep -cE "name:[[:space:]]*'A[0-9]" engine/audit/src/rules/index.ts | head -1)
grep -nE "期望.*[0-9]+[[:space:]]*项\|期望.*[0-9]+[[:space:]]*条\|expected.*[0-9]+" playbook/acceptance-test.sh | head
# 人工检查：acceptance-test 里所有"期望 N 项/条"的硬编码 N 是否与 index.ts 注册数一致

# 子项 d: check-version 文案扫描 baseline（教训—工具自身 SSOT 标签误导）
EXPECTED_DEFAULT=$(awk '/export const defaultRules/{f=1; next} f && /^[[:space:]]*\{.*name:/{c++} f && /^[[:space:]]*\];/{exit} END{print c+0}' engine/audit/src/rules/index.ts)
REPORTED_DEFAULT=$(bash tools/check/check-version.sh 2>&1 | grep -oE "defaultRules.length=[0-9]+" | grep -oE "[0-9]+")
echo "期望=$EXPECTED_DEFAULT 报告=$REPORTED_DEFAULT" # 期望：两者相等

# 子项 e: acceptance-test.sh JSON 输出不被 stderr 污染（教训）
grep -E "\-\-json.*2>&1|2>&1.*\-\-json" playbook/acceptance-test.sh # 期望：零命中

# 子项 f: init.ts 禁止硬编码规则条数常量（教训）
grep -nE "expectedDefaultRules[[:space:]]*=[[:space:]]*[0-9]+|expectedDefault[[:space:]]*=[[:space:]]*[0-9]+" engine/audit/src/commands/init.ts # 期望：零命中
grep -c "defaultRules\.length\|defaultRules\[.length\]" engine/audit/src/commands/init.ts # 期望：≥ 1

# 子项 g: acceptance-test.sh 绝不能与 npm run build 并发（build 首步 rm -rf dist 清产物，acceptance-test 读 dist/*.js 误报 6-7 个「文件不存在」假失败）——自测须串行：build 完成→dist 稳定→单独跑
# 「并发」无法单条 grep 干净断言（2>&1 / & 会误报），主体人工巡检铁律；下行只自动查 nohup/后台显式并发拉起
grep -rnE "nohup.*(build|acceptance-test)|npm run build[^&]*&[[:space:]]*$" tools/ .github/workflows/ 2>/dev/null || true # 期望：零命中=无并发隐患=PASS；🔴 || true 必须在命令部分（注释里的 || true 不生效——零命中 grep exit 1 会把代码块整体判 FAIL）

# 子项 h: 假绿 / 空转六形态扫描（假绿专项）——判据**收窄到真坑形态**，宽口径会满屏误报，勿扩
# 六形态与判定：
#   A 管尾恒 0 命令判退出码 —— 判据见子项 a（同源）
#   B 空值守卫静默跳过 —— 判据见下方脚本（**本轮唯一真坑形态**）
#   C find 字面量路径不存在（免费绿灯）—— 本轮扫 6 条字面量路径全部存在；LAYER_C/D 已退役（check-docs.sh 有退役注释）
#   D `grep -c ... || FAIL=1` 零匹配误用 —— 本轮 66 处命中均为「命令替换取输出 + || true 兜底 set -e」正确用法
#   E `|| true` 掩盖断言 —— 本轮 21 处可疑全为 ((FAIL++)) || true（set -e 标准写法，非掩盖）
#   F 宿主 profile 悬空软链（由维度 140 的 c2 归并入本子项——原位置属「模型与进化族」，错放）：
#     find ~/.dsh/profiles/*/node_modules -maxdepth 1 -type l ! -exec test -e {} \; -print
#     判据：悬空链不影响加载（bundles 只引当前名）但属残留噪音、pnpm install 遇它可能报错。
#     实证：聚合插件改名（-harness → -suite）后 web profile 留 2 条（本次改名残留 + 更早遗留）→ 已清。
#     处置：删前确认该名不在其 bundles/dependencies；非宿主环境（无 ~/.dsh/profiles）打 ⚠️ 跳过。
# 实证（本版）：B 形态真坑 = **1 处** → tools/check/check-test-count.sh 的 LIMITATIONS_ALL
#   （docs/LIMITATIONS.md 的「审计核心 N 个、全 workspace N 个」声明缺失时，整块校验静默消失而输出照旧 ✓ = 假绿）
#   → 已补 else「grep 未命中 → FAIL，禁止静默跳过」（与同文件 DEV_ORCH_LINE 同范式）。
#   反测：注入声明缺失 → EXIT=1 且报红；还原 → 「12 处校验通过 / EXIT=0」。
python3 - <<'PY'
import re, glob
bad = []
for f in sorted(glob.glob('tools/check/*.sh')) + ['playbook/acceptance-test.sh']:
    try:
        lines = open(f, encoding='utf-8', errors='replace').read().split('\n')
    except OSError:
        continue
    for i, l in enumerate(lines):
        m = re.search(r'if \[ -n "\$([A-Za-z_]+)" \]', l)
        if not m or l.strip().startswith('#'):
            continue
        blk = '\n'.join(lines[i:i + 25])
        # 真坑 = 块内含断言 且 无 else 分支（有 else = 已显式处置，不判）
        if re.search(r'FAIL=1|\(\(FAIL\+\+\)\)', blk) and not re.search(r'^\s*else\b', blk, re.M):
            bad.append(f"{f}:{i + 1} ${m.group(1)}")
print('\n'.join(bad) if bad else '✅ 无空值守卫静默跳过（真坑形态 B）')
PY

# 子项 i: 场景体例守卫（两代体例并存，新场景误用旧三行壳既不被判也不被计数而 REPORT 仍称已落地）
# 守卫已落 acceptance-test.sh 静态扫描（跑前扫全部 ^scenario 块，无任何判据即 FAIL 并打印场景号）；本子项锚守卫在位不回退
grep -q "场景体例 fail-loud 守卫" playbook/acceptance-test.sh && echo "✅ 场景体例守卫在位（缺判据即 FAIL）" || echo "❌ 场景体例守卫丢失——旧三行壳复活无门禁拦截"
```

#### 14. enterprise-deploy 完整性

```bash
(
for section in "批量安装" "集中下发" "CI 集成" "已落地"; do
 grep -q "$section" docs/guides/enterprise-deploy.md && echo "✅ $section" || echo "❌ 缺失: $section"
done
grep "enterprise-deploy" SECURITY.md | head -1
test -f docs/guides/enterprise-deploy.md && echo "✅ 文件存在"
) 2>&1 | tee "/tmp/regress-dim-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim-$$.log" && { rm -f "/tmp/regress-dim-$$.log"; echo "该维度收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim-$$.log"; true
```

#### 15. Agent 身份感知有效性

> 🔴 教训：原检查命令 grep 具体措辞（"露个脸就够了"），措辞改后命令失效得 0。
> 改为 grep 结构性标记（版本号签名 / 身份声明段落），不依赖具体文案。

```bash
# 修：检查结构性标记而非具体措辞（措辞易改，结构稳定）
grep -c "sofagent" SKILL/SKILL.md | head -1 # 期望：≥ 5（身份声明贯穿全文）
grep -c "质量搭档\|FDE\|约束" SKILL/harness/engage.md # 期望：≥ 1（角色定位存在）
grep -c "sofagent" engine/scripts/lib/post-install.sh # 期望：≥ 1（安装后身份提示）
node engine/audit/dist/index.js --version 2>&1 | grep -q "sofagent" && echo "✓ 版本签名" # CLI 身份
```

#### 16. 安全约束 fail-closed 与权限加固

> USB 专属 fail-closed 验签见维度 44。

```bash
# 子项 i: 审计 hook 的退出码契约（改码）——**崩溃必须与「警告」区分开**
#   契约：0=全绿 / 1=警告（放行）/ 2=违规（阻断）/ 3=非 git 仓库（cli-quick 口径）/ **4=引擎崩溃**。
#   崩溃码 3→4——原 3 与「非 git 仓库 ⇒ return 3」撞码（实测两义并存：非 git 目录跑 3、
#   SOFAGENT_HOME 越界崩溃也跑 3）。坑位：node 未捕获异常默认 exit 1 与「1=警告」撞码 ⇒
#   hook 的 `-eq 1` 分支把崩溃静默放行（fail-open 实测：含密钥 .env 入库）。防线：① CLI 顶部 handler
#   → exit 4（两 CLI 各自注册；双侧锁 src/__tests__/cli-crash-exit-code.test.ts）；② hook `-ne 0`
#   兜底；③ stderr 特征扫描降为**旧版引擎兜底**（新版有 4）。反测：`SOFAGENT_HOME=/tmp/x node engine/audit/dist/index.js --help` → **4**（core/data-paths `exitCode=3` 裸消费实测无效，未改）。
#   ⚠️ Release body **顶部与尾部各有一段元说明**（顶部「本节存在性=阶段六定稿必备项」/ 尾部「🔗 尾链…与 GitHub Release body 同源」）——剥时两段都要剥。
#   ⚠️ 分发命令**须在 bash 下执行**（zsh 不对未加引号的 `$MULTILINE_VAR` 分词 ⇒ publish 收到多行路径报「路径不存在」）。
# 子项 a: A15 actions 未声明时必须 FAIL（非 fail-open WARN）—— 二次验证确认已返回 FAIL，本项保留为回归锁
grep -n "nodesWithActions.length === 0\|nodesWithActions.length === 0" engine/audit/src/rules/rule-a15-action-constraint.ts
grep -A2 "nodesWithActions.length === 0" engine/audit/src/rules/rule-a15-action-constraint.ts | grep -c "FAIL" # 期望：≥ 1

# 子项 b: ~/.sofagent/ 目录权限 700 + install.sh chmod 700（路径迁移：.sofagent/ → ~/.sofagent/） 检查 1：install.sh 是否有 chmod 700 SOFAGENT_HOME
grep -c 'chmod 700.*SOFAGENT_HOME' install.sh # 期望：≥ 1
# 检查 2：已安装环境的 ~/.sofagent/ 权限（仅在本机已安装时检查）
ls -ld ~/.sofagent 2>/dev/null | grep -c 'drwx------' # 期望：1（700）

# 子项 c: A/B promote 守卫——overallImprovement > 0
grep -n "overallImprovement\|decidePromotion" engine/ab-test/src/*.ts 2>/dev/null
# 人工检查：decidePromotion() 必须有 overallImprovement > 0 守卫

# 子项 d: core 包 mkdirSync 权限加固——所有数据目录创建必须带 mode: 0o700 注意：fresh-eyes P0「数据明文存储」过渡防线——目录默认 755 时同机其他用户可读审计数据 注意：grep 须排除 import 行（import { mkdirSync } 也含关键词但非调用）
grep -rn "mkdirSync(" engine/core/src/ --include="*.ts" | grep -v "__tests__" | grep -v "mode:" # 期望：零命中（所有 mkdirSync( 调用都带 mode）
grep -rc "mkdirSync(.*mode: 0o700" engine/core/src/ --include="*.ts" | grep -v ":0" # 期望：≥ 5 处
grep -q "SPILL_FAILURE_CODE" engine/core/src/diff-parser.ts && grep -q "maxBuffer: 5 \* 1024 \* 1024" engine/core/src/diff-parser.ts && echo "✅ diff 拒审码 + stderr 容量在位" || { echo "❌ fail-closed 承重墙缺口（原 #143b · 快速路径空 diff 过审）"; exit 1; }
```

#### 17. npm 产物 + bin 权限 + tag commit message

```bash
(
SSOT_VER=$(node -e "console.log(require('./engine/audit/package.json').version)")

# 子项 a: bin 文件执行权限
for pkg in audit core orchestrator daemon mcp; do
 bin=$(node -e "const p=require('./engine/$pkg/package.json'); console.log(Object.keys(p.bin||{}).map(k=>p.bin[k]).join(' '))" 2>/dev/null)
 for b in $bin; do [ -x "engine/$pkg/$b" ] || ls -la "engine/$pkg/$b" 2>/dev/null | grep -q '^-.x' || echo "❌ $pkg/$b 无执行权限"; done
done

# 子项 b: npm registry vs git tag vs 工作树三方一致
# 防御：npm view 必须带完整 @sofagent scope（裸 /audit 非有效包名恒空值——探针自身缺陷非 registry 无数据）
# 发版时序：闸门在 SOP 阶段六、npm publish 在阶段十——候选版此刻未上 registry，npm 停在上一正式版属正常态（与 tag 滞后同源）
NPM_VER=$(npm view @sofagent/audit version 2>/dev/null)
TAG_VER=$(git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//')
echo "npm=$NPM_VER ssot=$SSOT_VER tag=$TAG_VER" # 期望：发版完成后三者一致（闸门期允许滞后一步）

# 子项 c/d/e: tag commit message 含版本号 + 工作树 clean — 被 tools/release/pre-push-check.sh 步骤 7 全量覆盖，不再重复
) 2>&1 | tee "/tmp/regress-dim-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim-$$.log" && { rm -f "/tmp/regress-dim-$$.log"; echo "该维度收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim-$$.log"; true
```

#### 18. 扩展审计规则源码回归锁——A19 commit 质量 + A18 垃圾文件（归并 18+19）

```bash
# 子项 a: A19 commit message 质量（原维度 18）
F19=engine/audit/src/rules/rule-a19-commit-msg-quality.ts
grep -c "MIN_LENGTH = 8" $F19 && grep -c "BLACKLIST" $F19 && grep "业务底线" $F19 # 长度检查+黑名单+分级
grep "!commitMsg || !commitMsg.trim" $F19 # 空 message 降级 PASS
grep "A19" engine/audit/src/rules/runner.ts # critical 层阻断

# 子项 b: A18 垃圾文件检测（原维度 19）
F18=engine/audit/src/rules/rule-a18-junk-file.ts
grep -c "JUNK_PATTERNS" $F18 # 3 组正则
grep -c "isExempt" $F18 # 豁免规则
grep "\"WARN\"" $F18 # 只产生 WARN
grep "A18" engine/audit/src/rules/runner.ts # extended 优先级 A18 排在 A17 之后
```
# [归并自维度9 · 阶段四] 代码侧规则注册一致性（文档侧声称已由 check-version §13b 机器化接管）
SSOT_TOTAL=$(grep -cE "name:[[:space:]]*'[AE][0-9]+" engine/audit/src/rules/index.ts) # A+E 全口径（25）
grep -oE "name:|ruleClass:" engine/audit/src/rules/index.ts | wc -l # 期望 50（字段完整性：name+ruleClass × 25）
grep -cE "evidenceMode:" engine/audit/src/rules/index.ts # 期望 25
grep -A20 "knownKeys = new Set" engine/core/src/config-loader.ts | grep -oE "'a[0-9]+'" | wc -l # 期望 ≥14（代码侧 knownKeys 与注册面对账）


#### 20. daemon plist + watch.yml 正确性 + --init 覆盖防护（归并 20+22）

```bash
# 子项 a: plist 内容正确（原维度 20） 修复（定谳假绿）：plist/daemon.log 缺失时 grep 报错但脚本继续 → exit 由后续命令决定， 无 daemon 环境静默记绿。改显式守卫：缺失即 ⏸️ 跳过标记（对照维度 7 规范），有 daemon 才检查内容。
PLIST=~/Library/LaunchAgents/com.sofagent.daemon.plist
if [ -f "$PLIST" ]; then
 grep "sofagent-daemon" "$PLIST" # ProgramArguments
 # WorkingDirectory 指向本仓库（路径无关，任何克隆位置可跑——B15 修复硬编码路径换机静默失效）
 REPO=$(git rev-parse --show-toplevel)
 grep -F "$REPO" "$PLIST" # WorkingDirectory
 ! grep -q "不支持的参数.*--daemon" ~/.sofagent/daemon.log 2>/dev/null # 无废弃参数
 tail -20 ~/.sofagent/daemon.log | grep "监控目录" # 监控目录正确
else
 echo "⏸️ plist 不存在（本机未装 daemon）——子项 a 跳过，不算失败"
fi
test -f .sofagent/watch.yml && grep "paths:" .sofagent/watch.yml # --init 生成

# 子项 b: --init 覆盖防护（原维度 22）——跑完 acceptance-test.sh 后重复检查
if launchctl list 2>/dev/null | grep -q sofagent; then
 launchctl list | grep sofagent | awk '{print $2}' # 期望=0（daemon 正常运行）
 # 跑完 acceptance-test.sh 后重复上述 grep，确认 plist 未被污染
else
 echo "⏸️ daemon 未运行——子项 b 跳过（CI/无 daemon 环境预期态）"
fi
```

#### 21. LOOP 工具注入 + 硬约束

```bash
F=engine/orchestrator/src/loop/nodes.ts
grep "DEFAULT_ENGINEER_MAX_TURNS = 20\|DEFAULT_REVIEWER_MAX_TURNS = 15" $F # maxTurns 常量
grep "ENGINEER_TOOLS\|REVIEWER_TOOLS" $F # 工具注入
grep -c "recordLoopAuditHistory" $F # WARN verdict 写入 audit history
grep "maxTurns: resolveMaxTurns" $F # maxTurns 注入
grep -c "checkDangerousCommand" engine/orchestrator/src/tools.ts # 高危命令黑名单
grep "break.*连续中断" engine/daemon/src/inspectors/warn-accumulator.ts # warn-accumulator
grep "SOFAGENT_LABEL" engine/daemon/src/usb-detect.ts # USB federation 基础检测
grep -c "createHmac\|timingSafeEqual\|applyFederation" engine/daemon/src/usb-detect.ts # USB HMAC
grep -c "audit_file\|auditEngine" engine/mcp/src/mcp-server.ts # MCP audit_file
grep -c "list_capabilities\|search_knowledge\|stats" engine/mcp/src/mcp-server.ts # MCP capabilities
grep -c "webhook:dingtalk\|webhook:feishu\|webhook:wecom\|openclaw:im\|daemon:notice" engine/daemon/src/push-target.ts # 5 种路由
grep "parseSubagentRunArgs\|--mode" engine/orchestrator/src/cli-args.ts # --mode 参数
grep -rl "sofagent-releaser\|releaser-skill" engine/scripts/lib/file-deploy.sh install.sh 2>/dev/null | wc -l # 期望=0（releaser 复制契约已移除）
```

## 分组：审查约束类（维度 #23-#77 · 标题行是该组一句话基线，非独立检查项）

版本号全量一致 · 铁律措辞清零 · Skill 行数 ≤100 · CHANGELOG 纯度 · 测试数一致 · 安全约束 fail-closed · npm 产物三方一致

#### 23. FDE/LOOP 跨产品声称一致性

> 暴露：FDE/LOOP 声称"独立产品"，但文档里步数、Agent 数、CLI 子命令存在矛盾

```bash
SSOT_VER=$(node -e "console.log(require('./package.json').version)")

# 子项 a: FDE 步数跨文档一致（已修复，固化防回退）
grep -oE "[0-9]+ 个阶段|[0-9]+ 个关键步骤|[0-9]+ 步" SKILL/SKILL.md SKILL/skills/*.md FDE/README.md FDE/GUIDE.md 2>/dev/null | sort | uniq -c # 期望：一致

# 子项 b: LOOP Agent 数跨文档一致（审查暴露）
ACTUAL_AGENTS=$(ls SKILL/agents/*/SKILL.md 2>/dev/null | wc -l); echo "实际安装 Agent 数: $ACTUAL_AGENTS"
grep -oE "[0-9]+ 个内置 Agent\|[0-9]+ 个 Agent" FORGE/README.md FORGE/quick-start.md 2>/dev/null # 人工核对一致

# 子项 c: LOOP 跨产品 install 契约已溶解（loop-install.sh 删除，LOOP 由 SKILL/<loop>/ 驱动）
[ -f FORGE/loop-install.sh ] && echo "⚠️ FORGE/loop-install.sh 仍存在（应删除）" || echo "✅ LOOP 无独立 install 脚本"

# 子项 d: 独立 install 闭环（FDE 仍依赖主 install.sh）
CLONE_NOTE=$(grep -rliE "完整 clone|完整仓库|需要.*sofagent.*仓库|clone.*完整" FDE/README.md FDE/GUIDE.md FORGE/README.md 2>/dev/null | head -1 || true)
[ -n "$CLONE_NOTE" ] && echo "✅ 文档已标注完整 clone 要求" || echo "⚠️ 未找到标注"
grep -q "被 FDE/LOOP 依赖\|FDE/LOOP\|FDE 部署时调用" install.sh 2>/dev/null && echo "✅ 主 install.sh 已标注" || echo "⚠️ 未标注"

# 子项 e: install 脚本版本号 = SSOT（审查暴露——install.sh 版本号漂移）
grep -H "v[0-9]\+\.[0-9]\+\.[0-9]\+" install.sh | head -4 # 期望：所有版本号 = SSOT_VER

# 子项 f: 跨产品 install CI 验证（原维度一词归并）
grep -c "cross-product-contract\|cross_product_contract" .github/workflows/*.yml 2>/dev/null # ≥1
```

#### 25. conflict-check 巡检器只读铁律 + schedule 正确性

```bash
# 子项 a: fail-closed 只读——源码零写操作（排除注释）
grep -n "writeFile\|writeFileSync\|unlink\|rmSync" engine/daemon/src/inspectors/conflict-check.ts | grep -v "^.*\/\/" # 期望：零命中

# 子项 b: schedule = @weekly（非 @daily）
grep -A1 "'conflict-check'" engine/daemon/src/inspectors/index.ts | grep -c "@weekly" # 期望：≥1

# 子项 c: runInspectors 调用链包含 conflict-check
grep -c "checkConflict\|conflict-check" engine/daemon/src/inspectors/index.ts # 期望：≥3

# 子项 d: 空 knowledge 目录优雅降级——🔴 隔离 HOME 实测（P1-14 后知识库是全局数据
# {SOFAGENT_HOME}/data/knowledge，不再挂 projectDir——裸跑 process.cwd() 会读到本机
# 真实知识库（孤儿/矛盾项）导致 triggered:true 假红。必须 SOFAGENT_HOME 指向隔离
# 空目录测「目录不存在 → info 降级」语义，对齐 S274 隔离手法）
D25_HOME=$(mktemp -d /tmp/sofagent-d25-XXXX); SOFAGENT_HOME="$D25_HOME" SOFAGENT_HOME_ALLOWED_PREFIXES="$D25_HOME" node -e "
const {checkConflict} = require('./engine/daemon/dist/inspectors/conflict-check.js');
const r = checkConflict(process.cwd());
if (r.triggered) throw new Error('Expected triggered:false');
if (r.severity !== 'info') throw new Error('Expected info');
console.log('OK');" && rm -rf "$D25_HOME" # 期望：OK
```

#### 28. Skill 元数据完整性

> SKILL.md 若缺必需字段，Agent 可能无法自动加载

```bash
for f in SKILL/agents/*/SKILL.md SKILL/skills/*.md SKILL/SKILL.md; do
 [ -f "$f" ] || continue
 miss=$(grep -cE "name:|slug:|displayName:|description:|version:|tags:|image:|triggers:|scenarios:|not_when:" "$f")
 echo "$f: 命中必需字段 $miss/9"
done # 期望：每个 SKILL.md 命中 9 个必需字段
```
#### 29. Dream Cycle 管道完整性 + 只读铁律

> Dream Cycle 是知识生成管道的核心——6 阶段缺一不可，think.md（Ledger）必须只读

```bash
(
# 子项 a: 6 阶段文件全部存在
for stage in extract-facts extract-atoms cluster-patterns synthesize-concepts evolve-backfill embed; do
 test -f "engine/daemon/src/dream-cycle/${stage}.ts" && echo "✅ ${stage}.ts" || echo "❌ 缺失: ${stage}.ts"
done

# 子项 b: 状态机存在且有断点续跑逻辑
grep -c "DREAM_CYCLE_STAGES\|fromStage\|loadState\|saveState" engine/daemon/src/dream-cycle/state-machine.ts # ≥4

# 子项 c: dream-cycle 源码对 think.md 只读（排除注释行 + state-machine 写 state.md/log.md + synthesize-concepts 写 entities/ 产物落盘）
grep -n "writeFile\|writeFileSync\|unlink\|rmSync" engine/daemon/src/dream-cycle/*.ts | grep -v "__tests__\|llm-mock\|state-machine\|synthesize-concepts" | grep -v "^.*/\/"
# 期望：零命中（synthesize-concepts 的 writeFileSync 是概念实体产物落盘，非 think.md 写入）

# 子项 d: 旧脚本 weekly-report / lessons-extract 引用清零
grep -rn "weekly-report\|lessons-extract" --include="*.ts" engine/daemon/src/ | grep -v node_modules | grep -v "memory-contract.ts" | grep -v "\.test\.\|__tests__" # 期望：零命中

# 子项 e: 6 阶段定义与 types.ts 一致
grep -c "extract_facts\|extract_atoms\|cluster_patterns\|synthesize_concepts\|evolve_backfill\|embed" engine/daemon/src/dream-cycle/types.ts # ≥6
) 2>&1 | tee "/tmp/regress-dim-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim-$$.log" && { rm -f "/tmp/regress-dim-$$.log"; echo "该维度收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim-$$.log"; true
```
#### 30. sensitivity frontmatter + 联邦过滤

> 缺省必须 internal，restricted 绝不默认

```bash
# 子项 a: core/src/ 有 sensitivity 三值定义
grep -c "'public'\|'internal'\|'restricted'" engine/core/src/memory-contract.ts # ≥3

# 子项 b: 缺省级别 = internal（safe-by-default）
grep "DEFAULT_SENSITIVITY.*=.*'internal'" engine/core/src/memory-contract.ts # 期望：有匹配

# 子项 c: resolveSensitivity 非法值回落 internal
grep -c "return DEFAULT_SENSITIVITY" engine/core/src/memory-contract.ts # ≥2

# 子项 d: isSensitivityVisible 实现 restricted 不泄露
grep -c "SENSITIVITY_ORDER\|isSensitivityVisible" engine/core/src/memory-contract.ts # ≥2

# 子项 e: 测试覆盖联邦过滤
grep -c "sensitivity\|restricted\|internal" engine/core/src/__tests__/memory-contract-sensitivity.test.ts # ≥3
```
#### 31. knowledge-health inspector 注册 + 五项检查 + 只读

> knowledge-health 巡检器必须注册为 @weekly，执行五项检查，且自身零写操作（除 health-report.md + index.md 自动修复）

```bash
# 子项 a: 注册在 inspectors/index.ts 且 schedule = @weekly
grep "'knowledge-health'" engine/daemon/src/inspectors/index.ts | grep "@weekly" # 期望：有匹配

# 子项 b: 5 项检查关键词全在源码
grep -c "孤立\|重复\|断链\|index 过旧\|缺源" engine/daemon/src/inspectors/knowledge-health.ts # ≥5

# 子项 c: knowledge-health.ts 无写操作（只读铁律，排除 health-report + index.md 断链修复/索引重建）
grep -n "writeFile\|writeFileSync\|unlink\|rmSync" engine/daemon/src/inspectors/knowledge-health.ts | grep -v "health-report\|writeReport\|saveReport\|appendReport\|indexPath\|generateIndexMarkdown\|^29:import" # 期望：零命中

# 子项 d: 测试用例 ≥8
grep -c " it(" engine/daemon/src/inspectors/__tests__/knowledge-health.test.ts # ≥8

# 子项 e: health-report.md 是巡检产物（LUI A 可感知）
grep -c "health-report" engine/daemon/src/inspectors/knowledge-health.ts # ≥1
```
#### 32. `sofagent knowledge status` 聚合命令 + restricted 不泄露

> 聚合命令自身必须只读，且不泄露 restricted 条目

```bash
(
# 子项 a: 命令文件存在
test -f engine/daemon/src/commands/knowledge-status.ts && echo "✅ 存在" || echo "❌ 缺失"

# 子项 b: 命令在 daemon CLI 中可发现
grep -c "knowledge.status\|knowledge-status\|knowledgeStatus" engine/daemon/src/cli.ts engine/daemon/src/index.ts 2>/dev/null # ≥1

# 子项 c: commands/knowledge-status.ts 无写操作（只读聚合）
grep -n "writeFile\|writeFileSync\|unlink\|rmSync" engine/daemon/src/commands/knowledge-status.ts # 期望：零命中

# 子项 d: 测试用例 ≥4
grep -c " it(" engine/daemon/src/commands/__tests__/knowledge-status.test.ts # ≥4

# 子项 e: 输出含受限条目不泄露提示（sensitivity 集成）
grep -c "restricted\|sensitivity\|隐藏\|不可见" engine/daemon/src/commands/knowledge-status.ts # ≥1
) 2>&1 | tee "/tmp/regress-dim-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim-$$.log" && { rm -f "/tmp/regress-dim-$$.log"; echo "该维度收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim-$$.log"; true
```
#### 33. ActionGovernance schema 完整性 + 向后兼容

> ActionGovernance 让审计记录从"结果"升级为"可问责的动作凭证"

```bash
# 子项 a: types.ts 有 ActionGovernance 接口 + 5 字段
grep -A15 "export interface ActionGovernance" engine/audit/src/rules/types.ts | grep -c "actor\|timestamp\|targetEntity\|beforeAfter\|context\|decisionProvenance" # ≥5

# 子项 b: DecisionProvenance 决策溯源组存在
grep "export interface DecisionProvenance" engine/audit/src/rules/types.ts # 期望：有匹配

# 子项 c: audit-history.ts 有 actionGovernance 字段写入
grep -c "actionGovernance" engine/audit/src/audit-history.ts # ≥1

# 子项 d: index.ts 实际写入 actionGovernance
grep -c "actionGovernance" engine/audit/src/index.ts # ≥1

# 子项 e: 旧格式向后兼容测试（无 actionGovernance 的旧记录可加载）
grep -c "向后兼容\|undefined\|actionGovernance" engine/audit/src/audit-history.test.ts # ≥3

# 子项 f: audit-history 测试用例数（测试数声称已被维度 13 SSOT 反查覆盖，此处只验证结构）
grep -c " it(" engine/audit/src/audit-history.test.ts # ≥11
```

#### 38. daemon 审计集中收集 workaround + 安全文档时效性

> SECURITY.md 必须诚实标注 daemon 审计推送的现状

```bash
(
SSOT_VER=$(node -e "console.log(require('./package.json').version)")

# 子项 a: SECURITY.md 有 filebeat/logstash workaround（大小写不敏感，文档中可能是 Filebeat/Logstash）
grep -ci "filebeat\|logstash\|fluentd" SECURITY.md # ≥1

# 子项 b: Webhook 企业平台推送标企业采购阻塞（本地三态已通；企业平台待就绪）
grep -c "v1.2.1\|不推送\|企业.*阻塞\|待落地\|本地三态.*已接通" SECURITY.md # ≥1

# 子项 c: USB federation 标注当前状态（HMAC 签名已有）
grep -c "v1.1.6\|HMAC\|签名校验" SECURITY.md # ≥2

# 子项 d: daemon 审计结果推送现状标注
grep -c "daemon.*审计.*推送\|仅本地\|daemon-notice" SECURITY.md # ≥1

# 子项 e: SECURITY.md 版本标注与 SSOT 一致
grep "当前状态（v${SSOT_VER}" SECURITY.md # 期望：有匹配

# 子项 f: SECURITY.md 覆盖本版本引入的数据处理/安全语义新能力（教训）
SECURITY_REQUIRED_FEATURES=("Dream Cycle" "sensitivity" "ActionGovernance")
for feat in "${SECURITY_REQUIRED_FEATURES[@]}"; do
 count=$(grep -ci "$feat" SECURITY.md)
 [ "$count" -ge 1 ] && echo "✅ SECURITY.md 覆盖 '$feat'" || echo "❌ SECURITY.md 缺 '$feat' 安全声明"
done
) 2>&1 | tee "/tmp/regress-dim-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim-$$.log" && { rm -f "/tmp/regress-dim-$$.log"; echo "该维度收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim-$$.log"; true
```

#### 39. AES-256-GCM 加密 + ECDH 配对

> 联邦查询第 3 层防线——channel 明文无 TLS，AES-256-GCM 唯一保密层。

```bash
# 子项 a: AES-256-GCM 加解密往返
grep -c "encryptPayload\|decryptPayload\|GCM_IV_BYTES" engine/core/src/crypto/aes-gcm.ts # ≥3

# 子项 b: ECDH 密钥协商——双方独立 derive 出相同 key
grep -c "generateKeyPair\|deriveSharedKey\|prime256v1" engine/core/src/crypto/ecdh.ts # ≥3

# 子项 c: 三配对路径（code/token/federation-file）+ 密钥轮换
grep -c "pairByCode\|pairByToken\|pairByFederationFile\|rotateKey" engine/core/src/crypto/pairing.ts engine/core/src/crypto/key-rotation.ts # ≥3

# 子项 d: 密钥只存内存，不落盘明文（安全红线）
grep -r "sharedKey.*Buffer\|只存内存\|不落盘" engine/core/src/crypto/*.ts # ≥1

# 子项 e: 验收场景覆盖（acceptance-test 场景 101-102）
grep -c "AES-256-GCM\|ECDH.*配对\|pairByToken" playbook/acceptance-test.sh # ≥3
```

#### 40. OpenClaw channel 联邦查询

> 两台设备互相 search_knowledge，Automerge CRDT 合并，离线降级不阻塞。

```bash
# 子项 a: federation 模块完整性（6 文件）
ls engine/daemon/src/federation/{channel,index,merge,offline-fallback,peers,query-router}.ts # 全部存在

# 子项 b: 并发 fetch + 单 peer 超时（5s）
grep -c "PEER_QUERY_TIMEOUT_MS\|broadcastQuery" engine/daemon/src/federation/query-router.ts # ≥2

# 子项 c: Automerge CRDTD 合并（不手写三路）
grep -c "automerge\|Automerge\|CRDT" engine/daemon/src/federation/merge.ts # ≥1

# 子项 d: sensitivity 双重过滤（peer 端 + 本地端）
grep -c "isSensitivityVisible\|restricted.*不泄露\|sensitivity.*过滤" engine/daemon/src/federation/query-router.ts # ≥1

# 子项 e: 离线降级不阻塞主流程
grep -c "offline\|fallback\|降级" engine/daemon/src/federation/offline-fallback.ts # ≥1

# 子项 f: 验收场景覆盖（acceptance-test 场景 103）
grep -c "联邦.*sensitivity\|federation\|broadcastQuery" playbook/acceptance-test.sh # ≥2
```

#### 41. Prompt 注入 8 层防护（层 1 + 层 4 + 层 5）

> 8 层防护三层实现——标签包裹(层1)+脱敏(层4)+可信分级(层5)。

```bash
# 子项 a: 层 1 wrapUntrusted + 防标签逃逸
grep -c "wrapUntrusted\|needsUntrustedWrap\|untrusted" engine/core/src/security/prompt-sanitizer.ts # ≥3

# 子项 b: 层 4 redactForPrompt 脱敏规则库（sk- / AKIA / 手机号 / 邮箱）
grep -c "redactForPrompt\|REDACT_RULES\|RESTRICTED_PLACEHOLDER" engine/core/src/security/prompt-sanitizer.ts # ≥2

# 子项 c: 层 5 trust 分级——web+restricted 组合丢弃（安全红线）
grep -c "isTrustEntryUsable\|sortByTrust\|web.*restricted" engine/core/src/security/trust-grading.ts # ≥3

# 子项 d: memory-contract trust 字段（official > internal > user > web）
grep -c "TRUST_ORDER\|trust.*Trust\|official.*internal" engine/core/src/memory-contract.ts # ≥1

# 子项 e: 验收场景覆盖（acceptance-test 场景 104-105）
grep -c "wrapUntrusted\|redactForPrompt\|trust.*分级\|isTrustEntryUsable" playbook/acceptance-test.sh # ≥4
```

#### 42. 编排模块 dag-runner + compose --run

> compose --run 委派 Sub Agent + 同文件冲突检测 WARN。

```bash
# 子项 a: dag-runner 核心函数
grep -c "runDAG\|detectFileConflicts\|ORCHESTRATOR_PROMPT" engine/orchestrator/src/dag-runner.ts # ≥3

# 子项 b: workflow-parser（YAML → SubAgent 映射）
grep -c "parseWorkflowYaml\|toSubAgentConfigs\|ParsedWorkflow" engine/orchestrator/src/workflow-parser.ts # ≥2

# 子项 c: compose --run + enterprise-workflow 参数
grep -c "\-\-run\|enterpriseWorkflow\|composeWithReactAgent" engine/orchestrator/src/composer.ts # ≥2

# 子项 d: A/B variants（一次生成多种拆解策略）
grep -c "variants\|variant\|VARIANT" engine/orchestrator/src/composer.ts # ≥2

# 子项 e: SubAgent 四层约束注入
grep -c "buildConstrainedSystemPrompt\|约束.*加载链" engine/orchestrator/src/dag-runner.ts # ≥1

# 子项 f: 验收场景覆盖（acceptance-test 场景 106）
grep -c "dag-runner\|detectFileConflicts\|compose.*DAG" playbook/acceptance-test.sh # ≥2
```

#### 44. USB 完整运行时——HMAC 签名 + AES-256 加密 + fail-closed 验签

> 发版后 hotfix 补丁（pr-check 抓获）：`ecdh.getPrivateKey()` 剥定长整数前导零——私钥首字节 0（概率 1/256）时 31 字节，CI 概率性红。已修 `ecdh.ts` 显式 pad 32 + 2000 次采样防复发锁（pairing.test.ts）。

> 通用安全 fail-closed 基线见维度 16。

> 全量文件 HMAC 签名 + 验签 fail-closed + knowledge/ AES-256 密文落盘。

```bash
# 子项 a: 签名模块核心函数
grep -c "collectFiles\|computeUsbSignature\|writeSignatureManifest\|verifyUsbSignature" engine/daemon/src/usb-signature.ts # ≥4

# 子项 b: 确定性算法要素（POSIX 归一化 + 字典序 + timingSafeEqual）
grep -c "normalizePath\|sort.*relativePath\|timingSafeEqual" engine/daemon/src/usb-signature.ts # ≥3

# 子项 c: verifyUsbSignature fail-closed 四 reason
grep -c "signature-missing\|signature-mismatch\|file-missing\|file-added" engine/daemon/src/usb-signature.ts # ≥4

# 子项 d: AES-256-GCM 密文落盘（.enc 不含明文）
grep -c "encryptKnowledgeFile\|ENC_FRAME_MAGIC\|AES_KEY_BYTES" engine/daemon/src/usb-key.ts # ≥3

# 子项 e: USB 运行时验签 + 内存解密 + 退出清密钥
grep -c "startUsbRuntime\|verifyUsbSignature\|decryptKnowledgeToMemory\|cleanupMemoryKeys\|setupPortableEnv" engine/daemon/src/usb-runtime.ts # ≥5

# 子项 f: CLI 接入（create-usb-key + --usb-root）
grep -c "create-usb-key\|usb-root\|createUsbKey\|startUsbRuntime" engine/daemon/src/cli.ts # ≥4

# 子项 g: 三平台启动脚本存在 + 可执行位
test -x engine/daemon/usb/start.command && test -x engine/daemon/usb/start.sh && test -f engine/daemon/usb/start.bat # 全部通过

# 子项 h: 验收场景覆盖（acceptance-test 场景 108-113）
grep -c "usb-signature\|usb-key\|createUsbKey\|verifyUsbSignature" playbook/acceptance-test.sh # ≥4
```

#### 45. 编排状态机 + 控制图——A/B 调度器 + 状态抽取 + 路径穿越防护（归并 45+46）

```bash
# 子项 a-g: A/B 调度器四阶段状态机（原维度 45）
grep -c "initialState\|checkThreshold\|startExploration\|judgeAndPromote\|runABScheduledTask" engine/orchestrator/src/ab-scheduler.ts # ≥5
grep -c "'exploit'\|'explore'\|'judge'\|'idle'" engine/orchestrator/src/ab-scheduler.ts # ≥4
grep -c "DEFAULT_PROMOTE_THRESHOLD\|promoteThreshold" engine/orchestrator/src/ab-scheduler.ts # ≥2
grep -c "appendMetrics\|aggregateRecent\|truncateToLastK\|HISTORY_MAX_ENTRIES" engine/orchestrator/src/ab-history.ts # ≥4
grep -c "ab-schedule\|runABScheduledTask" engine/daemon/src/cron.ts # ≥2
grep -c "executePlan\|writeGraphState\|ABSchedulerDeps" engine/orchestrator/src/ab-scheduler.ts # ≥3
grep -c "ab-scheduler\|ab-history\|judgeAndPromote\|ab-schedule" playbook/acceptance-test.sh # ≥4

# 子项 h-n: 控制图状态抽取 + 路径穿越安全（原维度 46）
grep -c "extractControlGraphState\|writeControlGraphState\|CONTROL_GRAPH_SCHEMA_VERSION" engine/orchestrator/src/loop-state-extractor.ts # ≥3
grep "CONTROL_GRAPH_SCHEMA_VERSION = 'v1'" engine/orchestrator/src/loop-state-extractor.ts
grep -c "sanitizeLoopId\|createHash.*sha256.*slice.*0.*8\|sanitized.*===.*loopId" engine/orchestrator/src/loop-state-extractor.ts # ≥2
grep -c "assertWithinDir\|resolved.*startsWith\|路径穿越" engine/orchestrator/src/loop-state-extractor.ts # ≥3
grep -c "writeControlGraphState\|writeGraphState" engine/orchestrator/src/ab-scheduler.ts # ≥2
grep -c "splitWaves\|mapNodeStates\|buildEvidenceChain" engine/orchestrator/src/loop-state-extractor.ts # ≥3
grep -c "extractControlGraphState\|sanitizeLoopId\|路径穿越" playbook/acceptance-test.sh # ≥3
```

#### 47. 产品叙事收敛红线 + BugFix 42 项核心回归锁

```bash
# 子项 a: README FDE Harness 叙事收敛（≥1 处，口径从 FDE Agent 升级）
FDE_COUNT=$(grep -c "FDE Harness" README.md) && [ "$FDE_COUNT" -ge 1 ] # 通过

# 子项 b: 审计模块零 token 红线保留
grep -q "审计模块零 token" README.md # 命中

# 子项 c: 历史已发布标记保留
grep -q "v1.1.8" README.md # 命中

# 子项 d: dag-runner SubAgent 不带 tools（assertSubAgentsNoEmptyTools 回归锁）
grep -c "assertSubAgentsNoEmptyTools" engine/orchestrator/src/dag-runner.ts # ≥1

# 子项 e: prompt-sanitizer 9 条 REDACT_RULES（含 PEM 多行正则）
SANITIZER_COUNT=$(grep -c "name: '" engine/core/src/security/prompt-sanitizer.ts) && [ "$SANITIZER_COUNT" -ge 9 ] # 通过

# 子项 f: workflow-parser schema limits（MAX_NODES=20 / MAX_TASK_LENGTH=2000）
grep -c "MAX_NODES = 20\|MAX_TASK_LENGTH = 2000" engine/orchestrator/src/workflow-parser.ts # ≥2

# 子项 g: 验收场景覆盖（acceptance-test 场景 120-121；品牌口径已升级为 FDE Harness）
grep -c "FDE Harness\|审计模块零 token\|assertSubAgentsNoEmptyTools\|MAX_NODES" playbook/acceptance-test.sh # ≥4
```

#### 49. 物理结构大重构——旧路径零残留 + 新结构就位

> ⚠️ 本维度 10 个子项（a–j）为 node 全树扫描，单机实测累计 **<1 秒**（实测验证）。若 worker 报「命令超时 120s exitCode=null」→ 是 worker 运行环境负载问题（大上下文加载/系统繁忙），**非检查本身慢**——人工复跑本维度命令即可确认。

```bash
# 子项 a: /sofagent/ 目录残留（node 扫描绕开 BSD grep 中文误判） 豁免：archive/changelog 为历史文档目录；`.sofagent/skill/`（含 ~/.sofagent/skill/）是用户 HOME 部署路径，非仓库旧路径
node -e "const fs=require('fs');const dirs=['engine','LOOP','FDE','SKILL','docs','tools','.github'];let hits=[];dirs.forEach(d=>{if(!fs.existsSync(d))return;function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','dist','target','archive','changelog'].includes(e.name))continue;const f=dir+'/'+e.name;if(e.isDirectory())walk(f);else if(e.name.endsWith('.md')||e.name.endsWith('.ts')||e.name.endsWith('.sh')){const c=fs.readFileSync(f,'utf8');c.split('\n').forEach((l,i)=>{if(l.includes('sofagent/skill/')&&!l.includes('.sofagent/skill/')&&!l.includes('已')&&!l.includes('旧')&&!l.includes('→')&&!l.includes('历史'))hits.push(f+':'+(i+1))})}}}walk(d)});['install.sh','SECURITY.md','README.md'].forEach(f=>{if(!fs.existsSync(f))return;const c=fs.readFileSync(f,'utf8');c.split('\n').forEach((l,i)=>{if(l.includes('sofagent/skill/')&&!l.includes('.sofagent/skill/')&&!l.includes('已')&&!l.includes('旧')&&!l.includes('→')&&!l.includes('历史'))hits.push(f+':'+(i+1))})});console.log(hits.length===0?'✅ sofagent/skill/ 零残留':'❌ FOUND '+hits.length);hits.forEach(h=>console.log(' '+h))"

# 子项 b: agents/SKILL/ 旧路径残留（应零命中，排除 changelog 历史 + acceptance-test 反向断言） 清理：engine/src + LOOP 目录 重构后已删除，从扫描数组移除
node -e "const fs=require('fs');const dirs=['engine/orchestrator/src','engine/rules/src','FDE','SKILL','docs','tools'];let hits=[];dirs.forEach(d=>{if(!fs.existsSync(d))return;function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','dist'].includes(e.name))continue;const f=dir+'/'+e.name;if(e.isDirectory())walk(f);else if(e.name.endsWith('.md')||e.name.endsWith('.ts')||e.name.endsWith('.sh')){const c=fs.readFileSync(f,'utf8');c.split('\n').forEach((l,i)=>{if(l.includes('agents/SKILL')&&!f.includes('changelog/')&&!(f.includes('acceptance-test')&&l.includes('! -d')))hits.push(f+':'+(i+1))})}}}walk(d)});console.log(hits.length===0?'✅ agents/SKILL/ 零残留':'❌ FOUND '+hits.length);hits.forEach(h=>console.log(' '+h))"

# 子项 c: SECURITY.md Dengine/ 残留（应零命中）
node -e "const fs=require('fs');const c=fs.readFileSync('SECURITY.md','utf8');let n=0;c.split('\n').forEach((l,i)=>{if(l.includes('Dengine')){console.log(' L'+(i+1)+': '+l.trim());n++}});console.log(n===0?'✅ SECURITY.md Dengine 零残留':'❌ FOUND '+n)"

# 子项 d: install.sh VERSION 变量（应为当前 SSOT 版本，发版时随 package.json）
grep '^VERSION=' install.sh | head -1

# 子项 e: engine/rules/package.json files 字段存在
node -e "const p=require('./engine/rules/package.json');console.log(p.files?'✅ rules files 字段存在':'❌ 缺 files 字段')"

# 子项 f: verify.yml CI 路径（应引用 SKILL/harness/ 而非 engine/skill/）
grep -n "engine/skill" .github/workflows/verify.yml # 期望：零输出

# 子项 g: shellcheck.yml 覆盖 install.sh + 无旧路径
grep -n "sofagent-lite\|'scripts/\*\*" .github/workflows/shellcheck.yml # 期望：零输出
grep -c "'install.sh'" .github/workflows/shellcheck.yml # 期望：2

# 子项 h: bump-version.sh 同版本号优雅退出（参数动态读 SSOT——旧写死 1.2.0 与 SSOT 不同会触发完整扫描，worker 超时诱因）
SSOT_V=$(grep '"version":' engine/audit/package.json | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
bash tools/release/bump-version.sh "$SSOT_V" "$SSOT_V" --dry-run 2>&1 | tail -3 # 期望：版本号相同，无变更 + 无 unbound variable

# 子项 i: install.sh 部署路径 vs handler.ts/checks.ts 读取路径对齐（P0①）
INSTALL_FDE=$(grep -oE 'skills/[a-z]+/fde\.md' install.sh | sort -u); HANDLER_FDE=$(grep -oE '"skills", "[a-z]+"' engine/hooks/sofagent-load-chain/src/handler.ts | head -2 | tr '\n' ' '); echo "install: $INSTALL_FDE / handler: $HANDLER_FDE" # 人工核对路径一致

# 子项 j: install.sh HMAC key 自动生成逻辑存在（P0⑥）
grep -c 'sofagent-key' engine/scripts/lib/post-install.sh # ≥2
grep -c 'chmod 600' engine/scripts/lib/post-install.sh # ≥1
```

#### 50. 乱码与 U+FFFD 零污染——文档五类扫描 + Agent 批量写入后必扫（归并 #63 入此）

```bash
# 五类乱码一次遍历（原 5 条独立 node -e 各遍历一遍 → 合并为单次遍历，等价且更快）
#   a U+FFFD 替换字符（编码损坏直接证据，与 acceptance S166 同源）· b C1 控制字符 U+0080-U+009F
#   c 孤立/颠倒代理对 · d 常见 mojibake（UTF-8 被按 Latin-1/GBK 误读）· e null byte（\x00 嵌入）
node -e "const fs=require('fs'),path=require('path');const dirs=['docs','SKILL','FDE','FORGE','tools'];const hits={a:[],b:[],c:[],d:[],e:[]};const walk=d=>{for(const f of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,f.name);if(f.isDirectory()){if(!/node_modules|\.git|archive/.test(p))walk(p);}else if(/\.(md|ts|js|mjs|sh|yml|json)$/.test(f.name)){const c=fs.readFileSync(p,'utf8');if(c.includes('\uFFFD'))hits.a.push(p);if(/[\u0080-\u009F]/.test(c))hits.b.push(p);if(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(c))hits.c.push(p);if(/[\u00C3\u00C2][\u0080-\u00BF]|[\uFFFD]{2,}/.test(c))hits.d.push(p);if(c.includes('\u0000'))hits.e.push(p);}}};for(const d of dirs)if(fs.existsSync(d))walk(d);const bad=Object.entries(hits).filter(([k,v])=>v.length);if(bad.length){for(const [k,v] of bad)console.error('  \u274c 乱码类'+k+': '+v.slice(0,3).join(', '));process.exit(1)}console.log('  \u2705 五类乱码零命中（a/b/c/d/e）')" 
```

> 教训：fresh-eyes-loop 批量修复 worker 多次产出含 U+FFFD 的文件——LLM 输出编码损坏时把无法表示的字节写成 U+FFFD。肉眼难辨（显示为 ▯ 或空白），但污染 grep、破坏锚点、影响 npm 产物。**任何 Agent 批量写入文件后，提交前必须扫一遍 U+FFFD，零容忍。**
>
> 阶段四判据①（冗余）：本维两条扫描命令与 acceptance 场景 S166（Markdown 格式完整性——代码块闭合 + 活跃文档无 U+FFFD）的 node 扫描命令**逐字符同款**——自动化已覆盖，命令体并入 S166 引用，本维保留纪律叙述（归并配额对销记录：#63 命令体 → S166，净减 5 行）。引擎源码侧扫描同 S304 的 FFFD 守卫场景覆盖（A2 审计规则含 FFFD 检测路径）。归并对销记录：#63 → #50（源删 6 行 / 目标增 4 行），净减 2 行。

#### 51. 审计链安全加固回归——HMAC 写读一致 + doctor 三态 + config 签名 + 版本自检 + key 强度

```bash
(
# a: HMAC 写读对称（写入侧先 sanitize 再签名）
grep -n "stableStringify\|sanitize\|脱敏" engine/core/src/audit-history.ts | grep -i "sign\|hmac\|签" && echo "✅ HMAC 写读对称" || echo "❌ HMAC 写读不对称"
grep -n "stableStringify\|sanitize" engine/audit/src/audit-history.ts | grep -i "sign\|hmac\|verify" && echo "✅ audit 包 HMAC 对称" || echo "⚠️ 检查 audit 包 HMAC"
# b: doctor 三态（ok/tampered/unverifiable）+ 使用 detailed 版本 注：unverifiable 枚举定义在 audit-history.ts（L132 ChainCheckStatus），doctor.ts 用 else 分支处理（L242），不含字面串——改查定义侧
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
# f: shadow 快照二进制安全（归并 112 入此——同为安全回归族；裂图事故：readFileSync(utf-8) 读二进制 PNG 0x89→U+FFFD 6 图损毁）
grep -q "isBinaryBuffer" engine/core/src/filesystem/isomorphic-git.ts && echo "✅ 跳过二进制" || echo "❌ 缺 isBinaryBuffer"
grep -qi "png" engine/core/src/__tests__/isomorphic-git-v2.test.ts && echo "✅ PNG 测试" || echo "❌ 缺 PNG 测试"
# g: HMAC key 熵检测用 Shannon 熵（归并原维度 87——唯一字符占比对 hex 天然误报：16 字符集重复度 75%）
grep -c "shannonEntropy" engine/core/src/audit-history.ts | grep -qvE "^0$" && echo "✅ Shannon 熵在位" || echo "⚠️ 熵检测回退到重复度占比"
grep -q "shannonEntropy < 3" engine/core/src/audit-history.ts && echo "✅ 阈值 3.0 bit/char" || echo "⚠️ 熵阈值缺失"
) 2>&1 | tee "/tmp/regress-dim-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim-$$.log" && { rm -f "/tmp/regress-dim-$$.log"; echo "该维度收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim-$$.log"; true
[ -f engine/audit/src/chain-kernel.diff.test.ts ] && grep -q "checkHistoryChainDetailed" engine/audit/src/chain-kernel.diff.test.ts && echo "✅ 验链差分一致性测试在位" || { echo "❌ 验链差分锁缺失（原 #143a · no-prevhash 分支漂移复发面）"; exit 1; }
```

#### 53. SSOT 零硬编码——产品代码不得绕过 data-paths.ts 拼路径

> ⚠️ **判定规则（防误报）**：data-paths.ts 管的是 `~/.sofagent/data/` **运行时数据路径**（resolveAuditDir/resolveDataDir 等）。包内自带的 fixture / golden-set 文件路径（如 `join(__dirname, '..', 'data', 'golden-set.yaml')`）是**随包发布的测试数据**，不是运行时数据，不适用此维度。仅当路径指向用户 home 下的运行时数据目录（如 `~/.sofagent/data/`、`data/audit/`）却绕过 data-paths.ts 时才算 FAIL。

```bash
# 产品代码零硬编码检查（排除测试文件、data-paths.ts 自身、注释、包内 fixture 路径）
grep -rn "join(.*'data'" engine/ --include="*.ts" | grep -v "data-paths.ts" | grep -v "\.test\." | grep -v "__tests__" | grep -v "// " | grep -v "新的路径"
# 期望：零命中或仅注释（注释需说明"原...迁移到..."）

# 防复发锚点：doctor.ts 全局路径读取收口 SSOT——直读 process.env.SOFAGENT_HOME 会绕过 sanitizeSofagentHome 白名单防护（path-traversal 面） 改走 resolveHomeDir() 后不得回潮
grep -c "process.env.SOFAGENT_HOME ||" engine/core/src/doctor.ts # 期望：0（直读形态清零）
grep -c "resolveHomeDir" engine/core/src/doctor.ts # 期望：≥3（L107/L362/L606 三处收口）

# 额外验证：data-paths.ts 存在且导出 resolve* 函数
grep -c "resolveAuditDir\|resolveDataDir\|resolveTaskDir\|DATA_ROOT" engine/core/src/data-paths.ts # ≥2

# env 命名纪律（归并原维度 54——Unix 全大写，禁驼峰前缀形态）
grep -rn "SOFAgent_" install.sh engine/ FORGE/ --include="*.sh" --include="*.ts" --include="*.mjs" || true # 期望：零命中
grep -rc "SOFAGENT_HOME\|SOFAGENT_DATA" engine/scripts/lib/platform-detect.sh engine/scripts/lib/config.sh # ≥2
```

#### 56. trust-but-verify——mock 单测全绿 ≠ 真实引擎匹配

> 教训：工程师用 mock 跑 eval 单元测试全绿（IS_PASS: YES），但 QA 跑真实 CLI 端到端通过率仅 14.3%——mock 未经过真实审计模块校验，未发现 golden set 与 audit 规则不匹配。逐条读 21 个 rule-*.ts 重写后 14.3% → 100%。
> 🔴 教训（回归审查挖出）：eval CLI 曾崩了 8 个版本没人发现——①cli.ts require 路径错 ②golden-set sha256 改 yaml 未重算 ③3 用例期望过时（规则演进了 golden 没跟）。**根因：本维度的检查结果长期被当"环境问题"跳过**。判定规则：本维度输出异常时先在非沙箱环境复跑（见环境验证铁律），确认非环境后才可跳过；golden set 变更必须同步重算 .sha256。

```bash
# mock 单测全绿后，必须额外跑真实 CLI 端到端 eval 包
(cd engine/eval && node dist/cli.js run 2>&1 | grep -E "passRate|通过率")
# 期望：passRate 100%，任何低于 100% 都说明 golden set 与真实规则不匹配 ab-test 包（修正：--golden-set 参数已移除，CLI 现要求 --current/--candidate； 无参 run 报参数缺失 exit 1——健康态改用 --help 可达性验证，对比实验属运行时功能由单测覆盖）
(cd engine/ab-test && node dist/cli.js --help 2>&1 | grep -q "Subcommands" && echo "✅ ab-test CLI 可用")
```

#### 57. A2/A9 fixture 敏感内容安全——占位符 + base64 编码

> 教训：golden set 的 fail 用例需含假密钥/injection 文本，但字面串会触发 A2/A9 扫源码本身 → commit hook 拦截。解法：YAML 用占位符（`{{SK_PREFIX}}`/`{{INJ_PHRASE}}`），运行时替换，映射值用 base64 编码存储（A9 扫不到 base64）。

```bash
# 1. golden set 不含字面密钥（A2 安全）
grep -rnE 'sk-[a-zA-Z0-9]{20,}' engine/eval/data/ engine/ab-test/src/__tests__/ 2>/dev/null # 期望零命中（勘误：原 engine/ab-test/data/ 已不存在，fixture 实际在 src/__tests__/——死路径会让 grep 静默通过=假绿）
# 2. golden set 不含字面 injection（A9 安全）
grep -rn "$(echo SWdub3JlIHByZXZpb3VzIGluc3RydWN0aW9ucw== | base64 -d)" engine/eval/data/golden-set.yaml 2>/dev/null # 期望零命中
# 3. 占位符替换机制存在
grep -c 'PLACEHOLDER_MAP\|SK_PREFIX\|INJ_PHRASE' engine/eval/src/eval-runner.ts # ≥3
# 4. A2 规则正则边界变体回归（原 #121 并入）——编码/大小写/前缀变体用例防正则漂移 路径勘误（定谳）：原锚 engine/audit/src/__tests__/a2-secret-leak.test.ts 不存在（实际 文件在 rules/ 下与实现同目录）——死路径 grep 静默通过 = 假绿，与本维度 #1 子项勘误同模式。
grep -qE '变体|variant|大小写|case|FFFD|base64' engine/audit/src/rules/rule-a2.test.ts 2>/dev/null && echo "✅ A2 边界变体用例在位" || echo "⚠️ A2 边界变体用例缺失（engine/audit/src/rules/rule-a2.test.ts）"
```

>
> 🔴 **再犯实录**：P0 补测试时 fixture 又写了字面量 `sk-abcdef...`，commit 被 A2 拦截 2 次。**此问题已复发两次（eval fixture + P0 补测试），铁律升级：测试文件中任何 secret-like 串（含 sk-/AKIA/ghp_ 前缀的假数据）必须运行时拼接（数组 join 或 base64 解码），绝不字面量。**

#### 58. convertAuditResult 三态——WARN 不应当 FAIL

> 教训：eval 的 convertAuditResult 原版把 WARN（exitCode 1）当 FAIL（exitCode 2）是 bug。三态：exitCode 0=PASS, 1=WARN, 2=FAIL。

> ⚠️ **判定规则（防误报）**：convertAuditResult 函数可能在不同文件中（cli.ts / eval-runner.ts / reporter.ts）。**先 grep 函数名定位文件**，再检查三态逻辑，不要假定文件名。

```bash
# 第一步：定位函数所在文件
grep -rn 'export function convertAuditResult\|export const convertAuditResult' engine/eval/src/
# 第二步：验证三态转换逻辑（用定位到的文件名替换 <file>）
grep -A10 'convertAuditResult' engine/eval/src/cli.ts | grep -E 'PASS|WARN|FAIL|exitCode'
# 期望：3 种状态都有分支处理（EXIT_CODE_TO_RESULT 含 0/1/2 三个映射）
```

#### 108. SOP hook 测试用例自身合格性——message 长度 + git add -f

**背景**：07-tool-health.md 的 hook 测试用例 message 用 `test`/`add app`（太短），被 A5+A19 正确拦截——**测试用例自己不合格导致假失败**，误判为 hook 坏了。且 `.env` 被 init 自带 .gitignore 挡住时不 `-f` 强加，hook 层 A1/A2 根本测不到（只测到 git 层双保险）。SOP 已修，本维度防 SOP 再漂移。

```bash
# SOP 用例 message 必须合格（≥8 有效字符，Conventional Commits）
grep -A2 "拦截验证" docs/changelog/releasing/07-tool-health.md | grep -oE 'commit -m "[^"]+"' | while read -r c; do
 msg=$(echo "$c" | grep -oE '"[^"]+"' | tr -d '"'); [ ${#msg} -lt 20 ] && echo "⚠️ SOP hook 测试 message 过短: $msg"
done
# -f 说明存在
grep -q "git add -f .env" docs/changelog/releasing/07-tool-health.md || echo "⚠️ 缺 git add -f 说明（hook 层测不到）"
# 子项 c：verify.sh 脱敏测试输入不被全局脱敏误伤（测试输入须真实手机号，非 1**REDACTED***）
grep -q "13812345678" engine/scripts/verify.sh || echo "⚠️ verify.sh 脱敏测试输入被误打码（脱敏误伤测试用例）"
```

#### 60. barrel re-export 一致性——新增导出 public-api.ts 和 index.ts 要同步

> P0 数据主权导出只在 public-api.ts，audit/src/index.ts 没同步 re-export，导致 daemon/mcp/orchestrator 的 tsc 报 TS2305。

> ⚠️ **判定规则（CRITICAL — 防误报）**：先检查 `package.json` 的 `exports` 字段——如果 `exports['.']` 已路由到 `public-api.ts`，则所有导出已对消费者暴露，**不需要在 index.ts 中重复 re-export**。`index.ts` 通常是 CLI 入口（含 `require.main === module`）。仅当 exports 指向 index.ts 且缺失 public-api.ts 导出时才算 FAIL。

```bash
# 显式判定版（校准：裸 grep 健康态语义 exit=1 被 driver 归一化旁路，改显式 if） 注：echo 变量插值处用半角括号（bash 3.2 全角吞字节 bug）；grep -c 配 || true + ${VAR:-0} 守卫
ENTRY=$(node -e "const p=require('./engine/audit/package.json'); console.log(p.exports?.['.']?.types || p.types || 'NOT_FOUND')")
if [ "$ENTRY" = "NOT_FOUND" ]; then echo "⚠️ audit package.json 无 exports/types 入口"; exit 1; fi
if echo "$ENTRY" | grep -q "public-api"; then echo "✅ exports 路由 public-api.ts，全导出已对消费者暴露"; exit 0; fi
DIFF_LINES=$(diff <(grep "^export " engine/audit/src/public-api.ts | sort) <(grep "^export " engine/audit/src/index.ts | sort) | grep -c "^<" || true)
if [ "${DIFF_LINES:-0}" -gt 0 ]; then echo "⚠️ index.ts 缺 re-export $DIFF_LINES 处"; exit 1; fi
echo "✅ barrel re-export 一致 (diff=$DIFF_LINES)"
```

#### 61. 新功能必须有自动化测试——禁止零覆盖交付

> P0 数据主权 1504 行源码零测试交付，靠手动验证兜底。fresh-eyes 12 视角没覆盖"测试是否存在"这个维度。

```bash
# 对每个交付项，检查是否有对应测试文件
for mod in data-sovereignty report-generator report-template model-router; do
 count=$(find engine/ -name "${mod}*.test.ts" | grep -v node_modules | grep -v dist | wc -l)
 echo "$mod: $count test files"
done
# 期望：每个模块 ≥1 test file
```

#### 62. 发版闸门裁决解析健壮性——禁止「全文含 FAIL 即判 FAIL」脆弱兜底

> 教训：release-gate-driver.mjs 的 parseVerdict / parseStepResults 曾有脆弱兜底——「报告全文含 \bFAIL\b 字样就判 FAIL」。但发版验证报告的真实结论是 PASS，正文却**必然**提到 FAIL（负向测试场景的预期输出 / 覆盖率表的 ❌ 标记 / 「无 FAIL 条目」这类措辞）。结果一次真实通过的验证被自动化误标成 FAIL，写进 LEDGER.md 和 status.json，靠读 verdict.md 权威产物才还原真相。根因：结论 PASS 的报告正文必然含 FAIL 字样，脆弱兜底把 PASS 误判 FAIL。**读发版裁决以 verdict.md 权威产物为准，别被 LEDGER / status.json 的自动化解析带偏。**

```bash
# 显式判定版（健康态语义 exit=1 被 driver 归一化旁路，须显式 if）；锚点以源码实况为准：slice 窗口在 extractVerdictKeyword 内仅 1 处，围栏剥离 replace(/```[\s\S]*?```/g
# 写法注：echo 变量插值用半角括号；grep -c 零命中配 || true + ${VAR:-0}（禁 || echo 0 双零形态）
FRAGILE=$(grep -cE "includes\('FAIL'\)|includes\(\"FAIL\"\)" FORGE/src/release-gate-driver.mjs || true)
if [ "${FRAGILE:-0}" -ne 0 ]; then echo "⚠️ 脆弱兜底未删尽 $FRAGILE 处"; exit 1; fi
KW=$(grep -c 'extractVerdictKeyword' FORGE/src/release-gate-driver.mjs || true)
if [ "${KW:-0}" -lt 2 ]; then echo "⚠️ 标记行窗口提取缺失 (count=$KW)"; exit 1; fi
WIN=$(grep -c 'slice(i, i + 4)' FORGE/src/release-gate-driver.mjs || true)
if [ "${WIN:-0}" -lt 1 ]; then echo "⚠️ 标记行窗口提取实现缺失 (count=$WIN)"; exit 1; fi
FENCE=$(grep -c '\[\\s\\S\]' FORGE/src/release-gate-driver.mjs || true)
if [ "${FENCE:-0}" -lt 1 ]; then echo "⚠️ 围栏剥离缺失 (count=$FENCE)"; exit 1; fi
echo "✅ 裁决解析健壮性四锚全过 (fragile=0 window≥1 fence≥1)"
```

#### 64. GitHub 锚点剥除规则——跨文档链接须匹配渲染后锚点（新盲区）

> 教训：7 处断链全因 GitHub 渲染剥除标题特殊字符——emoji 被整段剥除、`+` 被剥后相邻空格合并为双连字符 `--`、`/`/括号/冒号被剥除。链接作者按"看到的标题"写锚点，渲染后锚点不同→死链。**断言链接时须按 GitHub 规则推算锚点，不能照抄标题。**

```bash
# 子项 a: 扫描跨文档 markdown 链接的锚点，对照目标文件实际标题推算渲染锚点 规则：转小写→剥 emoji/标点→空格转连字符→连续连字符保留（剥除产生的双连字符不合并）
grep -rn '\]\(\./\?[A-Za-z0-9_/.-]*\.md#' docs/ README.md SECURITY.md LIMITATIONS.md --include="*.md" 2>/dev/null | grep -v changelog | grep -v archive # 人工核对：每条 # 后锚点 = 目标标题按 GitHub 规则渲染结果（docs/ 已含 ROADMAP.md）

# 子项 b: 标题含 emoji/+///括号/冒号 的高危锚点目标——这类标题最易产生断链
grep -rnE "^#{1,4} .*(🔮|🔄|🪟|✨|[+/（）():：])" docs/ README.md SECURITY.md LIMITATIONS.md --include="*.md" 2>/dev/null | grep -v changelog | grep -v archive # 人工核对：引用这些标题的链接锚点是否已按剥除规则调整（docs/ 已含 ROADMAP.md）
```

> **PASS 标准**：所有跨文档 `#锚点` 链接指向的标题，按 GitHub 渲染规则（剥 emoji/标点、空格→`-`）推算的锚点与链接一致。标题含特殊字符者重点核对。

#### 65. FORGE stream 迁移数据处理——finalState 须累积 delta + extractAgentText 须防御对象 content（归并 65+66）

> 教训（归并原 65+66）：FORGE stream 迁移有两个数据处理陷阱：① `stream(streamMode: 'updates')` 的 chunk 是 `{ nodeName: stateDelta }`，直接 `finalState = chunk` 会丢 `result.messages` → 输出 `[object Object]`——必须 `Object.entries(chunk)` 累积。② LangGraph message content 可能是 `Array<{type, text}>` 或嵌套对象，`extractAgentText` 只做 string 判断时会 fallback 到 `String(message)` → 同样输出 `[object Object]`。

```bash
# 验证两个 driver 的 stream chunk 处理含 Object.entries 解包（而非裸赋值）
grep -c 'Object.entries(chunk)' FORGE/src/fresh-eyes-driver.mjs FORGE/src/release-gate-driver.mjs # 期望：各 ≥1
grep 'finalState = chunk$' FORGE/src/fresh-eyes-driver.mjs FORGE/src/release-gate-driver.mjs # 期望：零命中
# 验证 extractAgentText 含数组检测 + 对象防御
grep -c 'Array.isArray(content)' FORGE/src/fresh-eyes-driver.mjs FORGE/src/release-gate-driver.mjs # 期望：各 ≥1
grep -c 'typeof content.*object' FORGE/src/fresh-eyes-driver.mjs FORGE/src/release-gate-driver.mjs # 期望：各 ≥1
```

#### 67. FORGE ReAct 步骤预算——reviewer ≤50 步 / engineer ≤30 步（效率铁律）

> 教训：FORGE ReAct Agent 在无步数约束时容易陷入重复读取循环——reviewer 反复读同一个文件、engineer 反复跑同一个测试。在 SKILL.md 中加入效率铁律（目标步数 + 禁止重复读取）后，平均执行步数下降 50-60%。**每个 sub-agent SKILL.md 必须有明确步数预算。**

```bash
# 验证 reviewer/engineer SKILL.md 含效率铁律
grep -q "效率铁律" SKILL/agents/reviewer/SKILL.md && echo "✓ reviewer" || echo "✗ reviewer"
grep -q "效率铁律" SKILL/agents/engineer/SKILL.md && echo "✓ engineer" || echo "✗ engineer"
```

#### 70. MCP tool 注册三处一致性——新增 tool 必须在 tool-registry + case dispatch + capabilities 三处都注册（修：跟上 tool-registry.ts 拆分）
> 📌 **归并记录（判据②·MCP 聚簇 5→4）**：原维度 93 与本维度同主题——注册一致性检查统一归此。93 的教训并入：三处 = tool-registry TOOLS 数组 + mcp-server switch case + import 语句；acceptance S270 已含四新 tool 的三处验证。

> 教训：新增 MCP tool 时每个 tool 必须在三处同步注册。mcp 拆分后工具注册从 mcp-server.ts 迁移到 **tool-registry.ts**（`import { TOOLS } from './tool-registry'`）——原检查命令查 mcp-server.ts 的 name: 字段恒得 0（架构迁移后该字段已移走），需改查 tool-registry.ts。验收测试 scenario 192 已覆盖此检查。

```bash
# 修：跟上架构迁移（mcp-server.ts → tool-registry.ts）
IMPORTS=$(grep -cE "import.*from.*'./(tools/)?" engine/mcp/src/mcp-server.ts | head -1)
TOOLS_ARRAY=$(grep -cE "name:[[:space:]]*'" engine/mcp/src/tool-registry.ts) # 注：改查 tool-registry.ts
CASES=$(grep -cE "case '" engine/mcp/src/mcp-server.ts)
echo "imports=$IMPORTS tools_array=$TOOLS_ARRAY cases=$CASES"
# 期望：tools_array（tool-registry.ts）≈ imports（mcp-server.ts 引用） + cases（dispatch）
# 补充：check-version.sh 的 MCP tool count 正则须精确匹配独立行
# 错误正则 name: '[a-z_]+' 会匹配 capabilities 数组内联条目（54 误报 vs 实际 27）
# 正确正则 ^\s+name: '[a-z_]+',$（行首缩进+逗号结尾=独立声明行）
```

#### 71. package.json build 脚本禁用 `|| true` 吞编译错误（新盲区）

> 教训`tsc && [...] || true` 末尾 `|| true` 会吞掉 tsc 编译失败的 exit code，导致 build 永远报成功。正确格式是子 shell 分组 `(...; true)`——在子 shell 内执行后返回 true，不影响外层 exit code 传递。

```bash
# 检测所有 package.json 的 build 脚本不含裸 || true 吞错误
BAD=$(grep -rE '"build".*\|\| true' engine/*/package.json 2>/dev/null | head -1)
[ -z "$BAD" ] && echo "✓ 无 || true 吞错误" || echo "✗ 发现: $BAD"
# 期望：零命中（正确格式是 (...; true) 子 shell 分组）
# 子项 b: 根 tsconfig outDir（归并原维度 88——根因未修时 .gitignore 过渡兜底须在位，防 tsc 写回 src）
grep -c '"outDir"' tsconfig.json; grep -c 'engine/\*/src/\*\*/\*.js' .gitignore # outDir 修后 ≥1（未修=0）；gitignore 兜底 ≥1
```

#### 72. 函数定义作用域 vs 引用位置——局部函数禁被模块级引用（新盲区）

> 教训`isReportText` 定义在 `runWorker` 局部作用域内，但模块级函数 `extractAgentText` 也调用了它 → `ReferenceError` 运行时崩溃。TS/JS 不会编译期报此错。

```bash
# 检查 FORGE driver：局部定义（缩进 function）是否被模块级区域引用
node -e "const fs=require('fs'),raw=fs.readFileSync('FORGE/src/fresh-eyes-driver.mjs','utf8');const src=raw.split('\\n').filter(l=>!l.trim().startsWith('//')).join('\\n');const mod=[...src.matchAll(/^function (\w+)/gm)].map(m=>m[1]);const loc=[...src.matchAll(/^\s+function (\w+)/gm)].map(m=>m[1]).filter(n=>!mod.includes(n));const bad=loc.filter(fn=>src.slice(0,src.indexOf('function '+fn)).includes(fn));console.log(bad.length?'ISSUE: '+bad.join(','):'OK')" 2>/dev/null
# 期望：OK
```

#### 73. ESM named export 完整性 + FORGE 模块加载烟测（归并 73+74）

> 教训（归并原 73+74）：FORGE/ 不在 npm workspaces → `npm test` 从不执行 FORGE/ 下的 `.test.mjs`。曾出过 `DEFAULT_BUDGET` 缺 `export` 关键字导致 3 个 driver 启动即崩溃的 P0 bug。补建 `tools/forge/forge-smoke-test.sh` 做 6 模块加载 + 3 测试文件烟测，集成到 pre-push-check（修正：脚本已迁 `tools/release/pre-push-check.sh`，tools/ 根下旧位置已不存在）。

```bash
(
# 确认 forge-smoke-test.sh 存在且集成到 pre-push
test -f tools/forge/forge-smoke-test.sh && echo "✅ smoke test 存在" || echo "❌ 缺失"
grep -q "forge-smoke-test" tools/release/pre-push-check.sh && echo "✅ 已集成" || echo "❌ 未集成"
# 烟测实跑（🔴 禁管道取退出码——教训`| tail -3` 吞 exit 1 假绿）
bash tools/forge/forge-smoke-test.sh > /tmp/forge-smoke.out 2>&1; SMOKE_RC=$?
[ "$SMOKE_RC" -eq 0 ] && echo "✅ 烟测全绿" || { echo "❌ 烟测失败（exit=$SMOKE_RC）："; tail -5 /tmp/forge-smoke.out; }
# ESM named export 检查（被 import 引用的符号须有 export 声明）
node -e "const fs=require('fs');const files=fs.readdirSync('FORGE/src').filter(f=>f.endsWith('.mjs'));let issues=[];for(const f of files){const s=fs.readFileSync('FORGE/src/'+f,'utf8');const exp=new Set([...s.matchAll(/export\s+(?:const|function|class)\s+(\w+)/g)].map(m=>m[1]));for(const f2 of files){if(f2===f)continue;const s2=fs.readFileSync('FORGE/src/'+f2,'utf8');const imp=[...s2.matchAll(/import\s*\{([^}]+)\}\s*from\s*['\"]\.\/([\w.-]+)['\"]/g)];for(const i of imp){if(i[2].replace('.mjs','')===f.replace('.m','')){for(const n of i[1].split(',').map(x=>x.trim().split(/\s+as\s+/)[0])){if(n&&!exp.has(n)&&n!=='default')issues.push(f2+' imports {'+n+'} from '+f);}}}}}console.log(issues.length?'ISSUE: '+issues.join('; '):'OK')" 2>/dev/null
) 2>&1 | tee "/tmp/regress-dim-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim-$$.log" && { rm -f "/tmp/regress-dim-$$.log"; echo "该维度收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim-$$.log"; true
```

#### 76. JS RegExp 不支持 grep 风格 (?i) 内联修饰符（新盲区）

> 教训：JSON ruleset 的 pattern 字段用 grep 风格 `(?i)` 前缀做大小写不敏感匹配，但 JS RegExp 原生不支持内联修饰符语法——`new RegExp('(?i)foo')` 不报错也不匹配，**13 条规则静默失效，形同虚设**。compilePattern() 在编译层统一剥离前导修饰符并转为 JS flags。

```bash
(
# 确认 ruleset-loader.ts 含 compilePattern（(?i) → JS flags 转换器）
grep -q 'compilePattern' engine/audit/src/ruleset-loader.ts && echo "✅ compilePattern 存在" || echo "❌ 缺失"
# 确认 compilePattern 处理 (?i) 修饰符
grep -q '?i' engine/audit/src/ruleset-loader.ts && echo "✅ 处理 (?i)" || echo "❌ 未处理"
) 2>&1 | tee "/tmp/regress-dim-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim-$$.log" && { rm -f "/tmp/regress-dim-$$.log"; echo "该维度收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim-$$.log"; true
```

#### 79. 运行时审计 tool wrapper——gate 拦截优先于 progress 埋点

> 运行时审计最小闭环：orchestrator 的 node-executor 通过 `wrapToolsWithGate` 包装每个 tool 调用，gate 在 tool 执行前调 `auditMw.check()` 拦截。**审计拦截必须在 progress 埋点之前执行**——否则 FAIL 的工具调用会先记录 progress 再被拦截，导致 audit log 与实际执行不一致。

```bash
# 子项 a: node-executor 含 wrapToolsWithGate + createToolGate
grep -c "wrapToolsWithGate\|createToolGate" engine/orchestrator/src/node-executor.ts # ≥2
# 子项 b: wrapToolsWithGate 在 tools.ts 中定义
grep -c "export function wrapToolsWithGate\|export.*wrapToolsWithGate" engine/orchestrator/src/tools.ts # ≥1
# 子项 c: FORGE audit-middleware.mjs 含 createAuditMiddleware + check()
grep -c "createAuditMiddleware" FORGE/src/audit-middleware.mjs # ≥2
grep -c "function check(" FORGE/src/audit-middleware.mjs # ≥1
# 子项 d: FORGE fresh-eyes-driver loadTools 中 auditMw.check 在 progress 回调之前（防 FAIL 漏拦）
grep -B5 -A5 "auditMw.check\|auditMiddleware.*check" FORGE/src/fresh-eyes-driver.mjs | head -15 # 人工核对：check 调用在 progress 之前
# 子项 e: HITL 审计记录（recordHitlAudit 存在）
grep -c "recordHitlAudit" FORGE/src/audit-middleware.mjs # ≥1
```

#### 80. 决策审计——emitDecision + HMAC 签名链 + 链验证 + 查询接口

> 意图层审计：每个 Agent 决策经 `emitDecision()` 写入 decision log，签名顺序为「先脱敏再 HMAC」——`sanitizeWhy(why)` 先剥离敏感内容，HMAC 基于已脱敏的 payload 计算。链式校验（prevHash）+ 三态判定（ok/tampered/unverifiable）与 audit-history 一致。

```bash
# 子项 a: decision-schema.ts 有 DecisionKind/DecisionWhy/DecisionProvenance 定义
grep -c "DecisionKind\|DecisionWhy\|DecisionProvenance" engine/audit/src/decision-schema.ts # ≥3
# 子项 b: emitDecision 签名顺序——先 sanitizeWhy 再 hmacSig（防泄漏→签名泄漏）
grep -c "sanitizeWhy\|hmacSig\|recordForSig" engine/audit/src/decision-log.ts # ≥3
# 子项 c: 签名基于脱敏后 payload——recordForSig 排除链字段（链协议收口至 chain-kernel 单一事实源，判据随迁）
grep "recordForSig" engine/audit/src/chain-kernel.ts # 期望：有匹配
# 子项 d: decision-chain.ts 含链式验证 + 三态（ok/tampered/unverifiable）
grep -c "'ok'\|'tampered'\|'unverifiable'" engine/audit/src/decision-chain.ts # ≥3
# 子项 e: decision-query.ts 查询接口存在（queryByKind/traceBack/getHighFrequencyPatterns）
grep -c "export function" engine/audit/src/decision-query.ts # ≥3
# 子项 f: 环境指纹参与签名 payload（防跨环境篡改）——decision-log 经 getEnvFingerprint 取值注入链内核
grep -c "getEnvFingerprint\|fingerprint" engine/audit/src/decision-log.ts # ≥2
```

#### 81. 外部记忆后端——动态 tool 注册 + sensitivity ACL 映射

> MCP 记忆后端：`getDynamicTools()` 从 config 读取 `memory_backends` 配置，动态注册 search/write tool。每个后端有独立的 sensitivity ACL——`mapSensitivityToACL()` 将 agent 的 sensitivity level 映射到后端可见范围。dynamic tools 与 static tools 合并注入 MCP server。

```bash
# 子项 a: getDynamicTools 函数存在 + 返回 DynamicToolDef[]
grep -c "getDynamicTools\|DynamicToolDef" engine/mcp/src/tools/memory-backend.ts # ≥2
# 子项 b: mapSensitivityToACL 存在
grep -c "mapSensitivityToACL" engine/mcp/src/tools/memory-backend.ts # ≥2
# 子项 c: registerMemoryBackends 从 config 读取注册
grep -c "registerMemoryBackends" engine/mcp/src/tools/memory-backend.ts # ≥1
# 子项 d: mcp-server.ts 合并 static + dynamic tools
grep -c "\.\.\.TOOLS.*getDynamicTools\|\.\.\.getDynamicTools" engine/mcp/src/mcp-server.ts engine/mcp/src/tool-registry.ts # ≥1
# 子项 e: sensitivity ACL 不泄露 restricted（mapSensitivityToACL 对 restricted 后端返回空/过滤）
grep -A5 "mapSensitivityToACL" engine/mcp/src/tools/memory-backend.ts | grep -c "restricted\|internal\|public" # ≥1
```

#### 82. 进化链路写保护——atomicWriteWithMergeSync 原子合并 + 锁机制

> 进化链路安全：think.md / entities/ 等进化产物写入必须经 `atomicWriteWithMergeSync()`——先读现有内容→深度合并新数据→写临时文件→原子 rename。锁机制防止并发写入冲突。**进化链路的写入不允许裸 writeFileSync，必须经过原子合并入口。**

```bash
# 子项 a: atomicWriteWithMergeSync 存在
grep -c "atomicWriteWithMergeSync" engine/core/src/shared/atomic-write.ts # ≥1
# 子项 b: 使用 writeFileSync→tmp→renameSync 原子模式（非裸写）
grep -c "writeFileSync(tmp\|renameSync(tmp" engine/core/src/shared/atomic-write.ts # ≥2
# 子项 c: 锁机制存在（lockfile + PID）
grep -c "lock\|PID\|process\.pid" engine/core/src/shared/atomic-write.ts # ≥2
# 子项 d: mergeDeep 深度合并函数存在
grep -c "mergeDeep\|deepMerge" engine/core/src/shared/atomic-write.ts # ≥1
# 子项 e: think.md 写入路径使用 atomicWriteWithMergeSync（而非裸 writeFileSync）
grep -rn "writeFileSync.*think\.md\|writeFile.*think\.md" engine/ --include="*.ts" | grep -v node_modules | grep -v dist | grep -v __tests__ | grep -v "atomic-write" # 期望：零命中（think.md 写入须经 atomicWriteWithMergeSync）
```

#### 83. 开源元数据完整性——package.json license + action.yml 版本锁定

> fresh-eyes 审查发现两个开源元数据缺陷：① package.json 缺少 `license` 字段（MIT 开源仓库缺 license 是硬伤）② action.yml 引用 `@sofagent/audit` 未锁定版本号（会导致 GitHub Action 拉到不兼容版本）。两者都是 check-version.sh 此前未覆盖的结构性检查点。

```bash
# 子项 a: package.json 含 license 字段
node -e "const p=require('./package.json'); console.log(p.license || 'MISSING')" # 期望：MIT（非 MISSING）
# 子项 b: action.yml 中 @sofagent/* 引用全部锁定到 vX.Y.Z（不能裸引用）
grep -E '@sofagent/' action.yml | grep -vE '@sofagent/[a-z-]+@[0-9]+\.[0-9]+\.[0-9]+' # 期望：零命中（裸引用 = 未锁定）
# 子项 c: action.yml 锁定版本 = SSOT 版本号
grep -oE '@sofagent/[a-z-]+@[0-9]+\.[0-9]+\.[0-9]+' action.yml | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | sort -u # 期望：仅一个版本号 = SSOT
```

#### 84. shouldAllow 拦截 API + 运行时审计日志仓库隔离

> shouldAllow 是 engine/rules 的运行时拦截入口——返回 `{ allow, reason, requireApproval }`，deny 时附带原因。运行时审计日志按 git 仓库 hash 隔离到 `data/audit/runtime/<repo-hash>/`——多仓库部署时审计日志不串。

```bash
# 子项 a: shouldAllow 函数存在 + 返回 InterceptVerdict
grep -c "shouldAllow\|InterceptVerdict\|requireApproval" engine/rules/src/should-allow.ts # ≥2
# 子项 b: shouldAllow 被 node-executor / gate 调用（不是死代码）
grep -rn "shouldAllow" engine/orchestrator/src/ --include="*.ts" | grep -v node_modules | grep -v dist | grep -v ".test." | wc -l # ≥1
# 子项 c: 运行时审计日志路径含 repo-hash 隔离
grep -c "data/audit/runtime" FORGE/src/audit-middleware.mjs # ≥1
# 子项 d: repo-hash 基于 git rev-parse（非硬编码路径）
grep -c "rev-parse\|repo.*hash\|resolveRuntimeAuditPath" FORGE/src/audit-middleware.mjs # ≥1
```

#### 85. FORGE driver run_bash cwd 强制——防 worker 路径错误大面积降级

**背景**：worker 模型自己写 `cd /Users/<拼错用户名>/...`，bash 大面积 No such file or directory → 24 worker 硬熔断降级，审查结论不可信。

```bash
# run_bash 包装层强制 cwd=REPO_ROOT + 剥离 cd 前缀
grep -c "cwd: REPO_ROOT" FORGE/src/fresh-eyes-driver.mjs # ≥1
grep -c "stripped.*replace.*cd" FORGE/src/fresh-eyes-driver.mjs # ≥1
```

#### 86. FORGE driver auto-commit 代码领域限定——防卷队友未提交内容

**背景**：driver 用 `git add -A` 把队友并行编辑的规划文档（docs/changelog/v1.4/*.md）一起卷进 auto-commit；修复改为只 add 代码领域（engine/FORGE/src/tools/SKILL）。**同族扩展（发版流程侧实锤）**：人工发版窗口的翻牌/收尾批 `git add <file>` 同样会裹挟并行 session 在该文件工作区的未提交 hunk——数字预改混入翻牌 commit 导致 CI 测试数漂移红；发版 SOP 已沉淀「commit 前 `git diff --cached` 逐 hunk 核对，非自己 hunk 不入」（docs/changelog/releasing/11-post-publish.md 步骤三）。

```bash
# driver-base runAuditGate 不含 git add -A
grep -c "git add -A" FORGE/src/driver-base.mjs # 0（仅注释引用）
# 改为显式代码领域 add
grep -c "git diff --name-only HEAD -- engine/" FORGE/src/driver-base.mjs # ≥1
# 发版 SOP 裹挟防御段在位（同族防复发——人工批与 driver 批同守则）
grep -q "git diff --cached" docs/changelog/releasing/11-post-publish.md && echo "✅ 发版 SOP 裹挟防御在位" || echo "⚠️ SOP 缺逐 hunk 核对纪律"
```

#### 90. shell 脚本 locale 防御——CI/sandbox 默认 LANG=C 导致中文乱码

**背景**：release-gate sandbox 默认 LANG=C，acceptance-test.sh 中文输出 ANSI 乱码 + 日志末尾截断，driver 无法解析结果。本地（LANG=en_US.UTF-8）无法复现——只在 CI/sandbox 暴露。

```bash
# 含中文输出的 shell 脚本必须头部 export LANG/LC_ALL 修复正则放宽匹配 `${LANG:-en_US.UTF-8}` 变量默认值写法（校准：误报根因——旧正则只匹配裸 `LANG=en_US.UTF-8`）
for f in playbook/acceptance-test.sh tools/check/check-version.sh tools/check/check-docs.sh; do
 head -10 "$f" | grep -qE "LANG=.*en_US\.UTF-8|LC_ALL=.*en_US\.UTF-8" || echo "⚠️ $f 缺 locale export"
done
# 期望：无 ⚠️ 输出
# 人读/机器输出分离（归并原维度 91——ANSI 色码夹在文本中间会破坏 driver grep）
grep -qE 'echo "SUMMARY:' playbook/acceptance-test.sh && echo "✅ 机器可解析 SUMMARY 在位" || echo "⚠️ 缺 ANSI-stripped 汇总行"
# b: bash 3.2 兼容模式（归并原维度 94——空数组+set -u = unbound；尾行 [[ ]] && + set -e = 成功也 exit 1）※ 新增脚本人工核对项
/bin/bash --version | head -1 # 确认为 3.2；危险模式：${arr[@]} 无守卫 / 尾行条件裸用
grep -rn 'declare -A' install.sh tools/ engine/scripts/ --include="*.sh" 2>/dev/null | grep -vE '^\S+:[0-9]+:\s*#' || true # 期望：零命中（bash 3.2 无关联数组）
```

#### 92. 审查文档自身检查命令的架构迁移同步

**背景**：维度 70 检查 MCP tool 注册查 mcp-server.ts，但架构迁移后工具注册移到 tool-registry.ts——检查命令得 tools_array=0 误报。这是"审查文档自身的检查命令也会过期"的元模式。

```bash
# 元检查：regression-checklist 中引用的 engine/ 路径是否都还存在
grep -oE 'engine/[a-zA-Z_/]+\.ts' playbook/regression-checklist.md | sort -u | while read f; do
 [ -f "$f" ] || echo "⚠️ 路径失效: $f（架构迁移后未更新检查命令）"
done
# 期望：无 ⚠️ 输出（所有引用路径有效） 🔴 每次架构迁移（文件改名/目录调整）后必须跑此元检查
```

#### 95. check-version 工具健康四盲区——语言覆盖/路径跟随/排除测试/日期动态提取（渐次暴露）

> 四次盲区教训：① 多语言文档的版本号检查须覆盖所有语言声明模式 ② 文件拆分时依赖该文件的检查脚本必须同步扫描路径 ③ 漂移扫描必须排除 `.test.` 文件 ④ EXPECTED_DOC_DATE 从 CHANGELOG 动态提取（禁硬编码发版日期）

```bash
(
grep -q "Current version" tools/check/check-version.sh && echo "✅ 英文检查" || echo "✗ 缺英文检查"   # 子项 a: 英文版正文版本号
grep -q 'tool-registry.ts' tools/check/check-version.sh && grep -q 'resources.ts' tools/check/check-version.sh && echo "✅ 扫描拆分文件" || echo "❌ 未扫描"   # 子项 b: MCP 计数拆分后定义文件
grep 'grep.*条规则' tools/check/check-version.sh | grep -q '\.test\.' && echo "❌ 未排除 .test." || echo "✅ 已排除 .test."   # 子项 c
grep "EXPECTED_DOC_DATE" tools/check/check-version.sh; grep "$(node -p "require('./package.json').version")" CHANGELOG.md | grep -oE "2026-[0-9]{2}-[0-9]{2}"   # 子项 d: 动态提取 + 与 CHANGELOG 发版日期一致
# 子项 e: §14b tag 日期提取须与时区解耦——合规形态 = unix 时间戳 + 固定偏移纯算术（禁 TZ 环境变量：ref 过滤器不认前缀 / GNU date -r 是 --reference / TZ 生效性依赖 runner）
grep -q "28800" tools/check/check-version.sh && echo "✅ 14b 时区解耦（unix ts + 固定偏移）" || echo "❌ 14b 可能依赖 TZ（跨环境真值不一致）"
# 子项 f: 容差/豁免类判据不得回退中性值——回退成 0/空 会让判据恒成立（fail-open 静默吞漂移），回退必须落到更严判据
grep -q "不放宽" tools/check/check-version.sh && echo "✅ 容差 fail-closed" || echo "❌ 容差可能 fail-open"
) 2>&1 | tee "/tmp/regress-dim-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim-$$.log" && { rm -f "/tmp/regress-dim-$$.log"; echo "该维度收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim-$$.log"; true
```
#### 96. 警戒线声明多处同步——单一 SSOT 引用

**背景**：acceptance 警戒线 2050→2250 时需同步改 4 处，漏改任一处导致 SOP 与实际不一致——复盘实锤：SOP 表格（1660）与 guides（1500 系）双双落后于 checklist 头部（1690），多处声明必然漂移。**收口**：警戒线数值只在 checklist 头部声明一处（SSOT，check-review-system.sh 动态提取校验），其余文档一律引用不写死。

```bash
(
# SSOT 声明完整性：checklist 头部必须有两条 ≤ 声明（门禁提取源，丢失 = warn 提示人工确认）
grep -oE '(regression-checklist\.md|acceptance-test\.sh)`? ≤ ?[0-9]+' playbook/regression-checklist.md | sort -u
# 期望恰好 2 行（checklist + acceptance 各一条）；非 2 行 = SSOT 声明被破坏，门禁将 warn

# 引用一致性：非 SSOT 文档不得写死警戒线数值（只许「见 checklist 头部」式引用 + 历史上调记录）
HARDCODED=$(grep -nE '(checklist|acceptance|fresh-eyes)[^0-9]{0,4}≤ ?1[0-9]{3}' docs/changelog/releasing/04-review-system.md docs/guides/review-system.md 2>/dev/null || true)
[ -z "$HARDCODED" ] && echo "✅ 非 SSOT 文档零写死警戒线" || { echo "❌ 写死值："; echo "$HARDCODED"; }
# 例外：头部/表格中的「历史上调记录」（如 1620→1660 箭头式演进）不算写死——箭头左值是历史事实
) 2>&1 | tee "/tmp/regress-dim-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim-$$.log" && { rm -f "/tmp/regress-dim-$$.log"; echo "该维度收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim-$$.log"; true
```

#### 97. npm publish workspace 限制——13 包分两批发布

**背景**：release.yml 只 auto-publish @sofagent/audit + @sofagent/mcp（Release 触发）；其余 11 包需手动 `cd engine/<pkg> && npm publish`（train 拆包后纳入，拓扑位次 orchestrator 后 daemon 前）。`npm publish --workspaces` 不支持 workspace 全局发布。

```bash
(
# 待发版窗口态分支（对齐 check-version F6 动态判据——SSOT 已发版 + 后继一版 devlog 在位 ⇒ 窗口开；
# 「13 包 == 目标版本」检查对象尚不成立（发布属 SOP 阶段十），硬判 FAIL 会把阶段五正常态误报 P0）：
CUR_V=$(node -p "require('./package.json').version")
NEXT_V=$(node -e "const p='${CUR_V}'.split('.').map(Number);console.log([p[0],p[1],p[2]+1].join('.')+'/'+[p[0],p[1]+1,0].join('.')+'/'+[p[0]+1,0,0].join('.'))")
PEND=0; for cand in ${NEXT_V//\// }; do seg=$(echo "$cand"|cut -d. -f1-2); [ -s "docs/changelog/v${seg}/v${cand}.md" ] && PEND=1 && break; done
if [ "$PEND" -eq 1 ] && git rev-parse "v${CUR_V}" >/dev/null 2>&1; then
  for pkg in audit core daemon inject ontology orchestrator train rules evolve think ab-test mcp; do
    V=$(npm view @sofagent/$pkg version 2>/dev/null || echo "未发布")
    echo " @sofagent/$pkg: $V"
  done
  echo "⏳ 待发版态：以上为 npm 现存版本；v${NEXT_V%%/*} 发布属阶段十，本维度在发版后复核「13 包 == 目标版本」"
else
  # 已发版态：验证 13 包全部到 npm
  for pkg in audit core daemon inject ontology orchestrator train rules evolve think ab-test mcp; do
    V=$(npm view @sofagent/$pkg version 2>/dev/null || echo "❌ 未发布")
    echo " @sofagent/$pkg: $V"
  done
fi
# 期望：全部 = 当前版本号；未到 → cd engine/<pkg> && npm publish --access public
# 🔴 对账口径（大包 CDN 传播坑）：publish 日志含 `+ <pkg>@<版本>` 即成功；对账查 `npm view <pkg> dist-tags --json` 的
# latest（registry 主记录先行于 CDN，view 缓存路径可报旧值假失败）；同版本重发 E409（staged ~5 分钟自动 finalize）。
) 2>&1 | tee "/tmp/regress-dim-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim-$$.log" && { rm -f "/tmp/regress-dim-$$.log"; echo "该维度收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim-$$.log"; true
```

#### 98. post-commit hook 对账逻辑——parentSha vs COMMIT_SHA 父子 SHA 不等

**背景**：阶段三发现 post-commit hook 假阳性——每次正常 commit 都警告"可能使用了 --no-verify 绕过"。根因：commit-msg 记录的 `parentSha` = 新 commit 的**父**提交，post-commit 的 `$COMMIT_SHA` = 新 commit **自己**——父子 SHA 永远不等。

```bash
# 修复post-commit 取 HEAD^ 作为 PARENT_SHA 对账
grep -q "PARENT_SHA\|HEAD\^" "$PROJECT_ROOT/engine/audit/src/commands/init.ts" || echo "⚠️ post-commit 未用 PARENT_SHA 对账"
# 首次 commit（unborn HEAD）用空树常量兜底
# 空树兜底双侧锚定：记录侧 index.ts 常量 + 对账侧 post-commit 首提回退（防 PARENT_SHA 空失配）
grep -q "4b825dc642cb6eb9a060e54bf8d69288fbee4904" "$PROJECT_ROOT/engine/audit/src/index.ts" || echo "⚠️ 记录侧（index.ts）空树兜底缺失"
grep -q 'PARENT_SHA=$(git hash-object -t tree /dev/null' "$PROJECT_ROOT/engine/audit/hooks/post-commit" || echo "⚠️ 对账侧（post-commit）首提空树回退缺失"
```

#### 101. check-docs 双面防复发——B 层行数超预算 + 锚点扫描环境降级（归并 #109 入此）

**背景**：阶段八内容增强（FDE 方法论/职业道德/评估体系）导致 B 层（开发者参考）行数从 8302→8437，超 LIMIT_B=8400，CI pr-check 失败。发版过程中才发现——本地 check-docs.sh 在 WorkBuddy 环境下超时跑不完，CI 上才暴露。

```bash
# CI 模拟：只跑 B 层行数检查。LIMIT_B 解析只抓「等号后第一个数字」（旧写法会把注释里版本号全抓出）——多片段换行致 integer expression expected。
LIMIT_VAL=$(grep -oE '^LIMIT_B=[0-9]+' tools/check/check-docs.sh | head -1 | cut -d= -f2 || true)
LIMIT_VAL=${LIMIT_VAL:-0}
AB=$(cat docs/ARCHITECTURE.md docs/DEVELOPMENT.md docs/HANDBOOK.md docs/PHILOSOPHY.md docs/WIKI.md SECURITY.md docs/VALIDATION.md docs/THANKS.md docs/ROADMAP.md docs/LIMITATIONS.md FDE/GUIDE.md FDE/README.md 2>/dev/null | wc -l)
echo "B 层: $AB 行 / LIMIT_B=$LIMIT_VAL"
[ "$AB" -le "$LIMIT_VAL" ] && echo "✅ 101-B-pass" || echo "❌ 101-B-fail-超标"
```

**子项（归并自原 #109）**：check-docs 锚点扫描在 WorkBuddy 被 shim 拖慢必超时——已加 SKIP_ANCHOR_SCAN=1 降级（与 node 版 check-anchors.mjs 功能重复）；本维度守护降级开关不被误删。

```bash
grep -q "SKIP_ANCHOR_SCAN" tools/check/check-docs.sh && echo "✅ 101-anchor-降级开关在位" || echo "❌ 101-anchor-降级开关丢失——WorkBuddy 下 pre-push 必失败"
```

## 输出报告格式
> 审查日期 / 范围 / 环境验证（tools/release/pre-push-check/npm test/check-docs/check-version）→ 问题清单（P0/P1/P2 分级，维度/文件:行/问题/建议）→ 通过统计 → 最终建议（可发版/需修复P0/需重大修复）。追加维度前先 grep 同类。

## 🔴 环境验证铁律（防误报 · 先读再跑下面维度）

> **测试框架铁律**：本项目用 **vitest** 非 Jest。正确命令：`npx vitest run --reporter=dot` 或 `npm test --workspace=engine/<pkg>`；❌ 禁止 `npx jest`。失败信息含 `from 'vitest'`/`import type` 解析错误 = 用了 Jest，换 vitest 重跑。

> **WorkBuddy 沙箱假失败铁律**：shim 可能拦截测试清理的 `fs.rmSync` 致 ETIMEDOUT 假失败（断言已过，仅清理块超时）——环境问题非源码 bug。判定：失败含 `ETIMEDOUT`/`rmSync` → 先在非 shim（终端/CI）复验；rmSync 已 try-catch 包裹，勿在 shim 下盲目改源码。

> **grep 匹配铁律**：检查文档是否包含某关键词时，**必须用 `-i`（大小写不敏感）**，因为文档中可能是 `Filebeat` 而不是 `filebeat`。漏匹配导致的误报会浪费修复轮次。

> **路径迁移感知**：`.sofagent/` 已迁移到 `~/.sofagent/`，数据子目录从 `.sofagent/audit` 变为 `~/.sofagent/data/audit`。检查路径权限时认准 `~/.sofagent/`。

### 分组：环境敏感与后期维度（#59 起，上面铁律适用于本组所有维度）

#### 102. 市场五环完整性——10 模块 + 6 MCP tool + inspector 双注册

**背景**：组织能力市场五环（发布→发现→调用→评价→养护）。模块文件、MCP 注册、daemon 巡检三处任一缺失都导致市场断环（如 invoker 缺失则调用环断，retire 缺失则养护环断）。教训：建了文件不注册 = 巡检不生效。MCP 注册一致性已由 #70/#93 覆盖，此处只查 market 专属 tool 名单。

```bash
for f in publisher catalog invoker rating owner retire skill-scan rule-harvest rule-jury rule-promote; do [ -f "engine/orchestrator/src/commons/$f.ts" ] || echo "⚠️ commons/$f.ts 缺失"; done
for t in commons_publish commons_search commons_invoke commons_rate commons_retire commons_harvest_rule; do grep -q "'$t'" engine/mcp/src/tool-registry.ts || echo "⚠️ $t 未注册"; done # 补：market→commons 更名同步（阶段五漏改本维）
grep -q "runCommonsCatalogDaily" engine/daemon/src/inspectors/index.ts || echo "⚠️ 目录日更未注册" # 更名同步
# 锚点修正（深模块批）：巡检项注册迁到 inspectors/registry.ts 的 INSPECTORS 单源
# （inspector-layers.ts 只保留 layer 划分与调度映射）——与 acceptance S269 同源重构。
grep -q "runCommonsHealth" engine/daemon/src/inspectors/registry.ts || echo "⚠️ 健康周检未挂载" # 更名同步
```

#### 103. SkillScan 三态链 + 版本守卫——DANGEROUS 拦截 / rc 投产决策落点

**背景**：SkillScan 安全门。两个高危点：① 文件不存在时必须判 DANGEROUS 不能默认 SAFE（扫描不到 ≠ 安全）；② DSH 候选包 rc 版本原须拦截——**拍板「DSH rc 直接投产」后语义反转**：依赖锁是刻意决策（npm 无正式版，预发布期内嵌路径已验证），守卫从「拦截预发布」改为「锁定已知可用版本 + 正式版发布后自动升级」。版本口径（当前锁定 0.1.2-rc.1 = npm latest，退出条件 = 0.1.2 正式版上架 npm）。**升级版本时须同步本 grep 锚与 package.json。**

```bash
grep -q "'SAFE' | 'SUSPICIOUS' | 'DANGEROUS'" engine/orchestrator/src/commons/skill-scan.ts || echo "⚠️ 三态枚举缺失"
grep -q "scanForPublish\|scanForInstall" engine/orchestrator/src/commons/skill-scan.ts || echo "⚠️ 双触发缺失"
grep -q "existsSync" engine/orchestrator/src/commons/skill-scan.ts || echo "⚠️ 存在性前置校验缺失"
grep -q "scanSkillSafety" engine/orchestrator/src/commons/skill-scan.ts || echo "⚠️ 未复用 scanSkillSafety"
grep -q "0\.1\.2-rc\.1" engine/orchestrator/package.json || echo "⚠️ DSH 依赖锁漂移（须为 0.1.2-rc.1——npm latest，d24dc15a 显式升级；退出条件=0.1.2 正式版上架 npm）"
grep -qE "正式版发布后自动|rc 期\*\*优先内嵌" engine/orchestrator/src/execution-backend.ts || echo "⚠️ rc 投产决策注释缺失（升正式版时须同步更新此处决策记录）"
```

#### 104. DecisionKind.COMMONS 语义分型——市场动作不与 ORCHESTRATION/EVOLUTION 混用

**背景**：铁律「市场调用走审计」。若市场事件塞进 ORCHESTRATION/EVOLUTION，`decision-log --kind MARKET` 查不到任何东西——审计语义分型失效。例外：退役走 EVOLUTION（生命周期事件非市场动作）是刻意设计。

```bash
grep -q "'COMMONS'" engine/audit/src/decision-schema.ts || echo "⚠️ DecisionKind.COMMONS 缺失"
grep -q "COMMONS" engine/audit/src/decision-log.ts || echo "⚠️ decision-log 未支持 COMMONS" # 更名同步
grep -q "EVOLUTION" engine/orchestrator/src/commons/retire.ts || echo "⚠️ 退役应走 EVOLUTION（刻意设计）"
```

#### 105. fresh-eyes worker 臆造链——b-fix 越界 + 碎片上下文编造

**背景**：b-fix worker 严重越界：臆造升级计划（automerge 排期）、新建 CI 配置（dependabot.yml）、改未来版本 changelog。根因：工具预算摸不完全仓 → 撞硬熔断 → 碎片上下文编报告。三重防护（预算上调 + 证据门槛 + 反臆造铁律）已修，此维度守护防护不回归（视角预算现为 50/60，断言同步）。

```bash
# 三重防护在位（driver 常量 + prompt 模板）——口径50/60，勿写死旧值
grep -q "PERSPECTIVE_TOOL_SOFT = 50" FORGE/src/fresh-eyes-driver.mjs || echo "⚠️ 预算回退到旧值"
grep -q "50 次工具调用" FORGE/SKILL/fresh-eyes-loop/prompts/a-check-perspective-1.md || echo "⚠️ prompt 预算未同步"
# b-fix 的 A3 审计拦截有效性（b-audit 对越界 commit FAILED）
grep -q "任务范围" engine/audit/src/rules/rule-a3*.ts 2>/dev/null || echo "ℹ️ A3 文件越界检测依赖规则引擎，人工抽查 b-fix diff 范围"
```

#### 110. bugfix 批防复发（多版汇总）——门禁盲区+假绿族+路径隔离+verify-commit/test-count/hook（B 类防回归 · 多版 38+26 项浓缩 · 归并 #116 入此：verify-commit 路径②收紧 + test-count 双层防御 + hook 成功回声）

**背景**：fresh-eyes 四份审查 38 项的防复发浓缩。三条核心防线：①守卫「找不到就跳过」= 空转四个版本无人知（#5）；②`| tail || true` 双保险吞退出码（#19）；③路径解析环境变量口径分裂污染真实数据（#38）。

```bash
(
# ① quick 规则数声称对账（防 #1）：README 声称与 dist 实测一致
README_N=$(grep -oE '17 条默认规则' README.md | head -1); [ -n "$README_N" ] || echo "⚠️ README quick 规则数口径漂移"
node -e "const m=require('./engine/audit/dist/rules/index.js');const d=m.defaultRules.length,x=m.extendedRules.length;if(d!==17||d+x!==25)process.exit(1)" || echo "⚠️ dist 规则数非 17/25，README 同步"
# ② check-version MCP 数含 ARCHITECTURE 能力总览（防 #3/#14）
bash tools/check/check-version.sh > /tmp/cv.log 2>&1; grep -qE "60 tools|MCP 工具数" /tmp/cv.log || echo "⚠️ MCP 工具数比对未含 ARCHITECTURE" # 注：48→60（52+8 新 tool），数字勿写死——check-version 自身会跟 SSOT
node -e "const fs=require('fs');const s=fs.readFileSync('docs/ARCHITECTURE.md','utf8');const reg=require('./engine/mcp/dist/tool-registry.js');const actual=Object.keys(reg.TOOLS||reg).length||60;s.split('\n').forEach(l=>{const mm=l.match(/（([0-9]+) tools）/);if(!mm)return;const v=+mm[1];if(v!==actual&&!/v1.[0-3].[0-9]/.test(l))console.log('⚠️ ARCHITECTURE tools 数漂移:',mm[0],'实际',actual)})" # 注：动态对账代替写死 48；行级版本豁免（含 v1.x.y 的历史演进行不算漂移——27=该时点真实数）
# ③ doctor dist 路径存在性 + 基线（防 #18）
node engine/audit/dist/index.js --doctor 2>&1 | grep -q "完整性校验通过" || echo "⚠️ 影子审计器基线链路失效"
[ -f ~/.sofagent/internal/audit-hash.txt ] || echo "⚠️ 哈希基线未生成"
# ④ 门禁失败路径自测（防 #5/#19/#27 假绿族）——守卫必须真的会红
grep -q "场景守卫" tools/check/check-test-count.sh || echo "⚠️ 场景守卫段消失" # 注：检查源码逻辑存在（正常路径输出无「场景守卫」字样，只有 FAIL 才输出——原输出 grep 恒误报）
grep -E "^[^#]*| tail.*|| true" install.sh >/dev/null 2>&1 && echo "⚠️ install.sh 假绿模式回潮" || echo "✅ install.sh 无假绿（注释提及旧模式不算）" # 注：排除注释行误报（#19 修复说明里引用了旧模式文本）
SOFAGENT_DATA=/tmp/rg-nonexist node engine/audit/dist/index.js --verify-chain > /tmp/vc.log 2>&1; [ $? -eq 1 ] || echo "⚠️ verify-chain 空链未 exit 1（假绿回潮）"; rm -rf /tmp/rg-nonexist /tmp/vc.log
# ⑤ SOFAGENT_DATA 隔离下 rule_disabled 落链断言（防 #38）
mkdir -p /tmp/rg-iso/data && printf 'rules:\n a4: false\n' > /tmp/rg-iso-cfg.yml 2>/dev/null
grep -q "getHistoryFilePath" engine/audit/src/index.ts || echo "⚠️ rule_disabled 路径口径回退到 resolveAuditDir"
# ⑥ hook 双副本同步（防 #2）：仓库模板与已装现场副本一致——改模板不重装即测旧副本=假绿
# worktree 下 .git 是文件，裸 .git/hooks 恒 miss——git rev-parse --git-path hooks 双形态解析真身
HOOKS_DIR=$(git rev-parse --git-path hooks 2>/dev/null || echo ".git/hooks")
diff <(grep -c "exitCode" engine/audit/hooks/post-commit) <(grep -c "exitCode" "$HOOKS_DIR/post-commit" 2>/dev/null) 2>/dev/null || echo "⚠️ post-commit 新旧副本逻辑不一致（模板改后未重装验证）"
# ⑦ archive 断链模式（防 #34）：压平迁移后引用路径必须跟着改
node -e "const fs=require('fs'),p=require('path');let bad=0;for(const f of fs.readdirSync('docs/archive/changelog-experimental')){if(!f.endsWith('.md'))continue;const c=fs.readFileSync(p.join('docs/archive/changelog-experimental',f),'utf8');for(const m of c.matchAll(/\]\((\.[^)]+)\)/g)){const t=p.resolve('docs/archive/changelog-experimental',m[1]);if(!fs.existsSync(t))bad++}}if(bad)console.log('⚠️ archive 断链 '+bad+' 处（迁移没跟引用）')"
# 原 #116 并入的 12 项 P0-P1 锚点（12 行 anchor grep → 单次批量断言，等价）
node -e "const fs=require('fs');const T=[['engine/audit/src/commands/verify.ts',['selfMatched','process.exit(1)','tampered']],['tools/check/test-count.sh',['FLAKY_PKGS=\"\"','漏收集']],['engine/audit/hooks/post-commit',['审计通过','含警告']],['engine/audit/src/rules/rule-a2-secret-leak.ts',['.bin','Binary files']],['engine/audit/src/rules/skill-safety-rules.ts',['(?!tmp|home']],['FORGE/src/driver-base.mjs',['timeout: 600_000']],['FORGE/src/fresh-eyes-driver.mjs',['timeout: 600_000']],['FORGE/src/release-gate-driver.mjs',['timeout: 600_000','loadResumePoint']],['playbook/acceptance-test.sh',['--max-old-space-size=2048']],['tools/check/check-version.sh',['ver == SSOT']]];const bad=[];for(const [f,pats] of T){let c='';try{c=fs.readFileSync(f,'utf8')}catch{bad.push(f+' 缺失');continue}for(const p of pats)if(!c.includes(p))bad.push(f+' 缺锚点: '+p)}if(bad.length){console.error('  \u274c 回植/漂移: '+bad.join(' | '));process.exit(1)}console.log('  \u2705 anchor 批全在位')" # ⑧ 门禁失败路径注入自测（归并原维度 100——set -u 下 $? 赋值曾判 unbound 崩溃，CI 常绿无感）
# 锚点勘误（阶段五复验）：①「审计通过」锚自 HOOK_TEMPLATE 删除后应指 hooks/ 唯一源（post-commit 成功回声双形态）②acceptance 锚改锚 NODE_OPTIONS 字面量——旧写法在双引号 node -e 里被 shell 展开成绝对路径再去匹配文件内字面 $PROJECT_ROOT，必假红（P1-1#2/P1-4 根因）③resume 锚自 fresh-eyes-driver 迁 release-gate-driver——多轮编排入口已归一退役（fresh-eyes-driver.mjs 文件头自述），resume 语义唯一活体=release-gate-driver loadResumePoint 断点续跑
sed 's|bash tools/check/test-count.sh|bash /nonexistent/test-count.sh|' tools/check/check-test-count.sh > /tmp/cct-t.sh; bash /tmp/cct-t.sh >/dev/null 2>&1; [ $? -eq 1 ] && echo "✅ 失败路径正确报红" || echo "⚠️ 失败路径崩溃或假绿"; rm -f /tmp/cct-t.sh
) 2>&1 | tee "/tmp/regress-dim-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim-$$.log" && { rm -f "/tmp/regress-dim-$$.log"; echo "该维度收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim-$$.log"; true
tmp_all=$( { grep -cF "[0-9;]*m//g" tools/check/test-count.sh 2>/dev/null || true; } | head -1 | tr -cd "0-9"); tmp_safe=$( { grep -cF "LC_ALL=C sed" tools/check/test-count.sh 2>/dev/null || true; } | head -1 | tr -cd "0-9"); [ "${tmp_all:-0}" = "${tmp_safe:-1}" ] && grep -q "解析失败，计数不可信" tools/check/test-count.sh && echo "✅ 计数解析 fail-loud 在位" || { echo "❌ 门禁吞数面回退（原 #143c · LC_ALL=C 覆盖 ${tmp_safe}/${tmp_all}）"; exit 1; }
```

**子项（归并自原 #106 · 测试数文档同步）**：该维度内容已被门禁覆盖（`bash tools/check/check-test-count.sh`）——降为引用一行；增量判据「新增/删除测试必须同步文档声称数」并入本维度计数防线。
#### 111. 新功能审查面——MCP 自进化+instinct+FDE 运维+沙箱/权限/并发/OKF（A 类 · 归并 #115 入此：沙箱五件套/权限三防线/并发三级来源/OKF 三件套为同版配套面）

**背景**：七大块交付的审查面。acceptance S270-S276 做执行级验证，本维度做静态一致性——两者成对构成新功能的完整回归网。

```bash
(
# ① MCP tools 三处口径（SKILL.md / ARCHITECTURE 能力表 / dist 实测）——口径随 SSOT 动态对账，勿写死
grep -q "103 tools" SKILL/SKILL.md || echo "⚠️ SKILL 工具速查漂移（口径103）" # 历史演进链 git log -p 可溯；锚词与 SKILL.md §MCP 工具速查同步升级
node -e "const m=require('./engine/mcp/dist/tool-registry.js');const doc=require('./package.json').version;console.log('✅ TOOLS='+m.TOOLS.length+'（registry 实数，勿写死——发版后人工对 SSOT 口径）')"
# ② snapshot tool 零 daemon 静态依赖（optionalDependencies 场景会炸）——排除注释行（🔴 import 铁律注释含 @sofagent/daemon；校准：grep -h 去前缀保排除生效）
grep -hE "@sofagent/daemon" engine/mcp/src/tools/snapshot-list.ts engine/mcp/src/tools/snapshot-restore.ts 2>/dev/null | grep -vE "^[[:space:]]*//" | head -1 | grep -q . && echo "⚠️ snapshot 静态 import daemon 回潮"
# ③ evolver 永不写仓库 SKILL/（发布源污染防线）
grep -qE "join\(REPO|join\(process\.cwd|['\"]\.?/?SKILL/['\"]" engine/orchestrator/src/instinct/evolver.ts && echo "⚠️ evolver 触达仓库 SKILL/" || echo "✅ evolver 只写 SOFAGENT_HOME/skill/custom（join(dir,'SKILL.md') 是合法 custom 文件名）" # 注：正则收窄——原 join.*SKILL 误伤 custom skill 的 SKILL.md 文件名
# ④ companion/fde-registry 的 daemon inspector 三步注册
grep -q "fde-companion-daily\|fde-registry" engine/daemon/src/inspector-layers.ts 2>/dev/null || grep -rq "runFdeCompanionDaily" engine/daemon/src/inspectors/ || echo "⚠️ FDE 巡检未注册 inspector"
# ⑤ 文档同步四件套（tools 数/测试数/新版 changelog 段/CHANGELOG 索引行） 教训（审查误报）：写死测试数必漂（2903→2937→3177）——改从 test-count.sh SSOT 读实际数对账，不写死。
TC=$(bash tools/check/test-count.sh 2>/dev/null | grep -oE 'TOTAL_TESTS=[0-9]+' | cut -d= -f2)
grep -q "$TC" README.md || echo "⚠️ README 测试数漂移（期望 $TC，见 tools/check/test-count.sh）" # 漂移实录：2903→2937→3177（12 包实测）
grep -q "\*\*v1.3.5\*\*" CHANGELOG.md || echo "⚠️ CHANGELOG 索引缺 v1.3.5"
# 原 #115 并入（沙箱五件套 / 场景权限三防线 / 并发三级来源 / OKF 三件套——同版配套面，acceptance S290-S292 同面端到端）
grep -q "dns.lookup\|dns\.resolve" engine/orchestrator/src/sandbox/network-gateway.ts && echo "✅ DNS 隧道拦截" || echo "❌ 网关漏 DNS"
grep -q "未注册" engine/orchestrator/src/sandbox/tool-gate.ts && echo "✅ 工具门 fail-closed" || echo "❌ 未注册放行"
grep -q "mask" engine/orchestrator/src/sandbox/virtual-key.ts && echo "✅ 虚拟 key 脱敏" || echo "❌ key 明文泄露面"
[ -f engine/orchestrator/src/sandbox/ATTACK-SURFACE.md ] && echo "✅ 攻击面声明在位" || echo "❌ 声明缺失"
grep -q "fail-closed" engine/orchestrator/src/permission/scenario-router.ts && echo "✅ 权限 fail-closed" || echo "❌ 权限开放默认"
grep -q "Shadow" engine/audit/src/agent-shield.ts && echo "✅ Shadow AI 三源" || echo "❌ 影子 agent 盲区"
grep -q "canAcceptTask" engine/orchestrator/src/sandbox/circuit-breaker.ts && echo "✅ ASI10 隔离联动" || echo "❌ 断路器孤立"
grep -q "migrateToTrunk" engine/ontology/src/merge-engine.ts && echo "✅ trunk 审阅门" || echo "❌ 直通 trunk"
grep -q "stale_after" engine/ontology/src/merge-engine.ts && echo "✅ OKF 时效字段" || echo "❌ 字段名漂移"
grep -rn "okfViolation" engine/mcp/src/tools/create-entity.ts > /dev/null && echo "✅ type 必填拒绝" || echo "❌ OKF① 缺失"
grep -q "resolveMaxConcurrency" FORGE/src/driver-base.mjs && echo "✅ 自适应并发" || echo "❌ ⑦ 未接线"
grep -q "SOFAGENT_PERSONA_SOURCE" engine/core/src/filesystem/memory-sync.ts && echo "✅ persona env 优先" || echo "❌ ⑨ 路径写死回退"
) 2>&1 | tee "/tmp/regress-dim-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim-$$.log" && { rm -f "/tmp/regress-dim-$$.log"; echo "该维度收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim-$$.log"; true
```

#### 113. 新功能审查面——八交付锚点一维收口（阶段五来源提取 A 类 · 归并 #114 入此：修复防复发三锚点为同版配套面）

> 十六项交付的核心面收口为一维（acceptance S282-S289 已有端到端断言，此处是快速 grep 版——审查 session 分钟级可跑）。检查命令全部指向**实际实现路径**（changelog 的涉及文件表是开发前预估，ontology 管线实际在 `import-pipeline.ts` 非 `writer.ts`——S283 初版就错在这）。**归并**：原 #114（修复防复发——脱敏两层同源 + 安全渠道 + worktree 信号清理）为同版配套修复面，三锚点并入本维（归并配额对销记录：#114 → #113，净减 13 行）。

```bash
(
# 引擎接口外化四件
test -f engine/orchestrator/src/workflow/container.ts && grep -q "ContainerDeps" engine/orchestrator/src/workflow/container.ts && echo "✅ ①容器+沙箱宿主位" || echo "❌ ①缺"
test -f engine/orchestrator/src/ontology/import-pipeline.ts && grep -q "D1-D5" engine/orchestrator/src/ontology/import-pipeline.ts && echo "✅ ②注入管线" || echo "❌ ②缺"
grep -q "allow-with-audit" engine/orchestrator/src/harness-sdk/wrap.ts && test -f engine/orchestrator/src/harness-sdk/builder-registry.ts && echo "✅ ③托管SDK" || echo "❌ ③缺"
test -f engine/orchestrator/src/model-registry.ts && grep -q "routeReason" engine/audit/src/decision-schema.ts && echo "✅ ④模型注册+路由可解释" || echo "❌ ④缺"
# 训练与验收
grep -q "SIGINT" engine/train/src/train-protocol.ts && grep -q "train_budget_exceeded" engine/train/src/train-budget.ts && echo "✅ ⑥⑦训练契约+预算" || echo "❌ ⑥⑦缺"
grep -q "define_acceptance" engine/mcp/src/tools/acceptance.ts && echo "✅ ⑨验收tool" || echo "❌ ⑨缺"
# 可靠性件
grep -q "postToolCall" engine/orchestrator/src/middleware/dual-gate-mw.ts && test -f engine/daemon/src/fatigue.ts && grep -q "safe-stop" engine/audit/src/degradation.ts && echo "✅ ⑫⑬⑭双闸+疲劳+降级" || echo "❌ 可靠性缺"
grep -q "DecisionCategory" engine/audit/src/decision-schema.ts && echo "✅ ⑮decisions五分类" || echo "❌ ⑮缺"
# 原 #114 并入：修复防复发三锚点（脱敏两层同源 + 安全渠道 + worktree 信号清理）
grep -q "SHARED_REDACTION_SAMPLES" engine/core/src/security/prompt-sanitizer.ts && echo "✅ 脱敏两层漂移断言在位" || echo "❌ 防漂移断言丢失"
grep -q "Security Advisory" SECURITY.md && ! grep -q "noreply.*备选" SECURITY.md && echo "✅ 漏洞渠道单通道" || echo "❌ 摆设渠道回潮"
grep -q "registerSignalCleanup" FORGE/src/driver-base.mjs && grep -q "createForgeDriverBase" FORGE/src/fresh-eyes-driver.mjs && grep -q "createForgeDriverBase" FORGE/src/release-gate-driver.mjs && echo "✅ 信号清理接线（driver-base 定义·双 driver 组合继承）" || echo "❌ 信号清理接线断裂"
) 2>&1 | tee "/tmp/regress-dim-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim-$$.log" && { rm -f "/tmp/regress-dim-$$.log"; echo "该维度收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim-$$.log"; true
```

#### 117. 新功能审查面——代理网关攻击面四项核对（阶段五来源提取 A 类）

> 交付①代理网关硬边界：唯一出入口须同时守住四项攻击面，缺一项即留绕过口。

```bash
(
GATE=engine/orchestrator/src/gateway/proxy-gateway.ts
[ -f "$GATE" ] || { echo "❌ proxy-gateway.ts 缺失"; exit 1; }
grep -qE '白名单|allow|deny' "$GATE" && echo "✅ 绕过防护（强制路由+白名单）" || echo "❌ 绕过防护回退"
grep -qE '限速|rateLimit|rate' "$GATE" && echo "✅ DDoS 限速" || echo "❌ 限速回退"
grep -qE '身份|agentId|identity|sign' "$GATE" && echo "✅ 请求伪造校验" || echo "❌ 身份校验回退"
grep -qE 'sanitize|append-only|append' "$GATE" && echo "✅ 日志注入防护" || echo "❌ 日志防护回退"
) 2>&1 | tee "/tmp/regress-dim-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim-$$.log" && { rm -f "/tmp/regress-dim-$$.log"; echo "该维度收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim-$$.log"; true
```

#### 118. bugfix 批防复发——原子写与单 writer 加固（阶段五来源提取 B 类 · B1+B2+B3 归并）

> 交付⑨快照写路径加固 + 审计并发写入：原子写（rename 切换）/ 跨进程串行写两道，缺一则留半恢复或行交错。

```bash
(
SNAP=engine/orchestrator/src/refine-agent/snapshot-manager.ts
[ -f "$SNAP" ] || { echo "❌ snapshot-manager.ts 缺失"; exit 1; }
grep -qE 'atomicWriteSync' "$SNAP" && echo "✅ 快照/回滚原子写" || echo "❌ 原子写回退"
AU=engine/audit/src/audit-history.ts
[ -f "$AU" ] || { echo "❌ audit-history.ts 缺失"; exit 1; }
grep -qE '串行|serialize' "$AU" && echo "✅ 审计历史跨进程串行写" || echo "❌ 串行写回退"
) 2>&1 | tee "/tmp/regress-dim-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim-$$.log" && { rm -f "/tmp/regress-dim-$$.log"; echo "该维度收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim-$$.log"; true
```

#### 119. 开发坑防复发——TS7 snapshot 缓存污染 + meta-harness deliveryPromise 形态 + DSH 适配（阶段五来源提取 B 类 · 归并 #120 入此：纯 CLI 包桥接 + pnpm 安装 + ESM require 桥接）

> ① TS7 对同一路径已打开的临时文件缓存首次内容——AST 引擎 extractExports 多次调用会串读；② meta-harness `new Promise(entry.resolve)` 把 resolve 当值立即 fulfilled，waitForDelivery 被提前唤醒。修复：AST 引擎唯一临时路径（${seq}-${path}）+ deliveryPromise 本体等待（orchestrator.ts）。public-api 无临时文件（固定 BASELINE 每次现读，不缓存内容）。

```bash
(
ASTE=engine/rules/src/ast/engine.ts
[ -f "$ASTE" ] || { echo "❌ ast/engine.ts 缺失"; exit 1; }
grep -qE 'seq|unique|uuid' "$ASTE" && echo "✅ AST 引擎唯一临时路径" || echo "❌ 临时路径复用风险"
PUB=tools/check/public-api.mjs
grep -qE 'readFileSync\(BASELINE|BASELINE' "$PUB" 2>/dev/null && grep -qE 'writeFileSync\(BASELINE' "$PUB" 2>/dev/null && echo "✅ public-api 固定 BASELINE 现读现写（无缓存串读）" || echo "❌ public-api BASELINE 机制回退"
MH=engine/orchestrator/src/meta-harness/orchestrator.ts
[ -f "$MH" ] || { echo "❌ meta-harness/orchestrator.ts 缺失"; exit 1; }
grep -qE 'deliveryPromise|new Promise\(res' "$MH" && echo "✅ deliveryPromise 本体等待" || echo "❌ promise 形态回退"
# 原 #120 并入（DSH rc.8 三坑——纯 CLI 包桥接 / npm 大依赖树 8GB OOM 走 pnpm / ESM require 桥接）
grep -qE 'createDshCliBackend|resolveDshCliBin|headless' engine/orchestrator/src/execution-backends/dsh-backend.ts && echo "✅ DSH CLI 桥接在位" || echo "❌ CLI 桥接回退"
grep -qE 'createRequire' engine/orchestrator/src/execution-backends/dsh-backend.ts && echo "✅ ESM require 桥接" || echo "❌ require 桥接回退"
grep -qE 'createRequire' FORGE/src/gate-tools.mjs 2>/dev/null && echo "✅ gate-tools ESM require 桥接" || echo "❌ gate-tools require 桥接回退"
) 2>&1 | tee "/tmp/regress-dim-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim-$$.log" && { rm -f "/tmp/regress-dim-$$.log"; echo "该维度收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim-$$.log"; true
```

#### 123. 新功能审查面——后训模块地基八大块一维收口（阶段四来源提取 A 类 · 参照 113/115/121 每版一维）

> 后训模块 · 地基核心面收口一维（acceptance S323-S327 端到端已断言 doctor/隔离/指纹/签名/安全基线五面，此处为分钟级快速 grep 版）。锚点全部实测存在。阶段 0 Metal 验证（@mlx-node/trl）定位 Mac-only 验证路径不入生产审查面。测试规模口径：workspace 3178 / 全量 3222（含 sandbox 证据链时序竞态回归锁，check-test-count 16/16 对账）。

```bash
(
# 块二 train-job 编排 + 块四隔离 + 块五指纹 + 块六签名 + 块七守卫/恢复 + 块八安全（协议/预算在 #113 ⑥⑦ 已锚）
test -f engine/train/src/train-scheduler.ts && grep -q "spawn" engine/train/src/train-scheduler.ts && echo "✅ 编排 spawn 在位" || echo "❌ scheduler 缺"
grep -q "assertEnterpriseAccess" engine/train/src/isolation-guard.ts && grep -q "assertSafePathSegment" engine/train/src/isolation-guard.ts && echo "✅ 企业隔离两级原语" || echo "❌ 隔离守卫缺"
grep -q "freezeTrainFingerprint" engine/train/src/train-fingerprint.ts && grep -q "datasetVersion" engine/train/src/train-fingerprint.ts && echo "✅ 指纹冻结+续跑版本锁" || echo "❌ 指纹缺"
grep -q "signArtifacts" engine/train/src/artifact-signing.ts && grep -q "manifestHmac" engine/train/src/artifact-signing.ts && grep -q "artifact_tampered\|tampered" engine/train/src/artifact-verify.ts && echo "✅ 签名+加载阻断" || echo "❌ 签名链缺"
grep -q "lastBeatMs" engine/train/src/process-guard.ts && grep -q "120_000\|120000" engine/train/src/process-guard.ts && echo "✅ 心跳回收（120s 阈值）" || echo "❌ 心跳守卫缺"
grep -q "resumeTrainJob" engine/train/src/crash-recovery.ts && echo "✅ 崩溃恢复三选项（checkpoint 续跑前置）" || echo "❌ 恢复缺"
grep -q "validateTrainPath" engine/train/src/security-baseline.ts && grep -q "sanitizeHyperparamsForSpawn" engine/train/src/security-baseline.ts && grep -q "maskCredentials" engine/train/src/security-baseline.ts && echo "✅ 安全基线三件" || echo "❌ 安全基线缺"
grep -q "train_submit" engine/mcp/src/tool-registry.ts && echo "✅ train_submit MCP 注册（66→67）" || echo "❌ train_submit 未注册"
grep -q "TrainAuditEventType\|train_job_submitted" engine/train/src/train-audit.ts && grep -q "hmacSig" engine/train/src/train-audit.ts && echo "✅ train 审计事件+HMAC 链（事件 union 本文件自持，audit 包无扩展点不动）" || echo "❌ 审计链缺"
) 2>&1 | tee "/tmp/regress-dim-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim-$$.log" && { rm -f "/tmp/regress-dim-$$.log"; echo "该维度收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim-$$.log"; true
```

#### 124. 发版防复发——install.sh 迁移/谎报守卫/安全披露/文档状态/双 manifest/bump 通配/新包 lock 同步一维收口（阶段四来源提取 B 类 · 阶段十一/十二回写 B11/B12 · 归并 #121 入此：插件家族目录/成本审计注册面已由 S331/S347 覆盖，dashboard worklog 弱锚收子项 k · 归并 #122 入此：workspace lock 同步 + DSH plugin 分发包装 + 限流）

> 阶段三全链路（fresh-eyes round-02 12 findings + f5430de4 修复 + 独立补审 + 3c61d980 次生修复）+ 阶段十一分发踩坑（B11 双 manifest 漂移 / B12 bump 通配误伤）的防复发锚点。B2/B3 端到端见 acceptance S328/S329；B1/B8 工具化见 check-version 检查项；B11/B12 端到端见 S331/S332；此处收口剩余面的快速 grep。

```bash
(
# B2 迁移纪律：复制成功才删源（cp -Rn 吞错+无条件 rm 的丢数据窗口已闭）
grep -q 'cp -Rn' install.sh && { echo "❌ cp -Rn 吞错语义回流"; exit 1; } || echo "✅ 迁移无 cp -Rn"
grep -A2 'cp -R "$old_data"' install.sh | grep -q 'rm -rf "$old_data"' && echo "✅ 删源在复制成功分支内" || { echo "❌ 删源脱离成功分支"; exit 1; }
# B3 谎报守卫：ln 调用无「失败仍报 ok」（4 处 sf 全守卫——BSD grep 下 sfn 前缀含 sf，显式计数）
SF_COUNT=$(grep -E 'ln -sf "' install.sh | grep -vc 'warn\|#' || true); [ "$SF_COUNT" = "4" ] && echo "✅ ln -sf 恰 4 处（均带守卫——多出即需人工核）" || echo "🟡 ln -sf 计数 $SF_COUNT（预期 4），逐处核对守卫"
# P1 次生修复：迁移中止叙事在位（err 话术 + 调用处接管退出）
grep -q '安装因迁移失败中止' install.sh && echo "✅ 迁移中止 err 叙事在位" || { echo "❌ 中止叙事缺失"; exit 1; }
# B4 安全披露：豁免开关必须在 .md 有披露
grep -rq "SOFAGENT_WEBHOOK_ALLOW_LOCALHOST" docs/LIMITATIONS.md && echo "✅ SSRF 豁免开关已披露" || { echo "❌ 隐藏开关回潮"; exit 1; }
# B5 注释数字不失实（LINES 变量并入断言行）
grep -o '~[0-9]* 行' bootstrap.sh | grep -o '[0-9]*' | awk -v n="$(wc -l < install.sh | tr -d ' ')" '{if ($1 > n * 1.05 || $1 < n * 0.95) exit 1}' && echo "✅ bootstrap 行数注释与实测偏差 <5%" || { echo "❌ 注释行数失实"; exit 1; }
# B6 无 untracked 残留（单行收口：状态与列举一次完成）
[ -z "$(git status --short | grep '^??')" ] && echo "✅ 无 untracked 残留" || { echo "❌ 残留：$(git status --short | grep '^??' | head -2)"; exit 1; }
# B9/B10 结构可发现性（两断言并一行收口）
grep -q "FORGE/SKILL" AGENTS.md && grep -q "releasing/" docs/changelog/releasing.md && head -5 docs/changelog/releasing.md | grep -q "入口" && echo "✅ FORGE/SKILL 区分 + releasing 入口指引在位" || { echo "❌ 结构可发现性缺失（FORGE/SKILL 或 releasing 入口）"; exit 1; }
# B11 双 manifest 版本一致（阶段十一 ClawHub 拒收实录：openclaw.plugin.json 从未被 bump 覆盖 4 款全漂移）——命令体见 acceptance S331
# B12 bump 跳过逻辑无通配误伤（阶段十一静默漏 bump 实录：通配误伤 sofagent-audit）——命令体见 acceptance S331（S332 已合族并入）
# k（原 #121）：dashboard 工作明细栏在位——插件目录已由 B11/S331 锁、cost_query 已由 S347/S348 锁
grep -q "worklog" tools/dashboard/dashboard.html && echo "✅ dashboard 工作明细栏在位" || { echo "❌ dashboard worklog 缺失"; exit 1; }
# 原 #122 并入（发版流程防复发——新 workspace 包 lock 同步 / DSH plugin 分发包装 / npm publish staged 等待 / lock 零本地部署树路径）
cd "$REPO_ROOT" && npm ci --dry-run 2>&1 | grep -c "^npm error Missing" | grep -q "^0$" && echo "✅ lock 与 workspace 同步" || echo "❌ lock 缺条目——npm install --package-lock-only 补齐"
node -e "const l=require('./package-lock.json');const p=JSON.parse(require('fs').readFileSync('package.json','utf8'));const miss=p.workspaces.flat().filter(w=>!l.packages[w]);if(miss.length){console.error('❌ lock 缺:',miss.join(','));process.exit(1)}console.log('✅ 全部 workspace 在 lock')"
grep -q "createArgv1Guard" engine/orchestrator/src/execution-backends/dsh-backend.ts && echo "✅ argv 守卫在位" || echo "❌ argv 守卫回退"
grep -c "dsh-deployed" package-lock.json | grep -q "^0$" && echo "✅ lock 零本地部署树路径" || echo "❌ lock 残留本地部署树 symlink——CI 必红 TS2307"
# B 类披露面批（B4/B5/B13/B14——新增网络面同 commit 披露 / 产物落点写全 / 旗舰能力同 commit 露出 / 明文清单逐文件）
# B4: 三条远程下发面 SECURITY + LIMITATIONS 披露在位（「下一版补」不接受）
grep -q "device.upgrade\|device.deploy" SECURITY.md && grep -q "device" docs/LIMITATIONS.md && echo "✅ 远程下发面双披露在位" || echo "❌ 新增网络面缺 SECURITY/LIMITATIONS 披露（B4：同 commit 补齐）"
grep -q "intent.jsonl" docs/LIMITATIONS.md && echo "✅ 明文清单含 intent.jsonl（B14：逐文件列全）" || echo "❌ intent.jsonl 未进 LIMITATIONS 明文清单"
# B5: 周报产物落点写全（落哪 + 有无消费方）
grep -q "digest-" engine/daemon/src/inspectors/weekly-digest.ts && grep -qE "无前端读取面|消费方" docs/changelog/v1.5/v1.5.1.md && echo "✅ 周报落点 + 消费方声明在位" || echo "🟡 周报落点声明人工复核（B5：只写目录名 = 声称不完整）"
# B13: 旗舰能力双语 README + WIKI 露出（「排期」vs 实物已交付不得并存）
grep -q "demo" README.md && grep -q "demo" docs/WIKI.md && echo "✅ demo 双面露出在位" || echo "🟡 demo README/WIKI 露出人工复核（B13：旗舰能力同 commit 露出）"
) 2>&1 | tee "/tmp/regress-dim-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim-$$.log" && { rm -f "/tmp/regress-dim-$$.log"; echo "该维度收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim-$$.log"; true
```

#### 125. 新功能审查面——训练九章+FDE 六引擎+IM 桥+FORGE 步零一维收口（阶段四来源提取 A 类 · 归并 #59 入此：dataDir 传参纪律为 SSOT 子项）

> 九大交付的静态一致性快查（执行级验证 acceptance S333-S339 已落，此处分钟级 grep）。子项 g 承接原 #59（resolve*Dir 传参纪律——与 N-1 dataDir SSOT 同主题族 归并）。

```bash
(
# a: FDE 六引擎 registry 注册 + 工作台数据层（S338 端到端的静态面）
for t in fde_interview fde_classify fde_quantify fde_derive fde_distill fde_deploy; do grep -q "name: '$t'" engine/mcp/src/tool-registry.ts || echo "❌ $t 未注册"; done; echo "✅ 六引擎注册（若上方无失败项）"
grep -q "fdeWorkbenchPaths" engine/orchestrator/src/fde/fde-workbench.ts && grep -q "emitFdeAudit" engine/orchestrator/src/fde/fde-workbench.ts && echo "✅ 工作台数据层" || echo "❌ 缺工作台"
# b: 三问判定（🔄/⚡/👤 三态 + 六步分解）
grep -q "classifyAutomation" engine/orchestrator/src/fde/compose-interview.ts && echo "✅ 判定能力在位" || echo "❌ 缺 classifyAutomation"
# c: 训练环境执行面在位（shell 安装脚本 + TS 探测/体检面——边界收缩后口径）
grep -q "trainDoctor" engine/train/src/env-manager.ts && test -f tools/train/train-env-init.sh && echo "✅ shell 安装 + TS 探测面齐备" || echo "❌ 缺一侧"
# d: 缩放律零依赖纪律（不引 ml 库）
grep -qE "levenberg|阻尼" engine/train/src/scale-curve.ts && ! grep -qE "from ['\"](ml|tensorflow|@tensorflow)" engine/train/src/scale-curve.ts && echo "✅ 手写拟合零 ml 依赖" || echo "❌ 依赖纪律破"
# e: IM 桥安全边界文档（凭据本机/命令白名单/可信用户）
grep -qE "白名单|凭据" docs/guides/im-bridge.md && echo "✅ 安全边界在档" || echo "❌ im-bridge.md 缺安全边界"
# f: FORGE 步零——worktree re-sync 三级降级 + 重复率熔断 + A 侧骨架先行
# f: FORGE 步零——重复率熔断阈值解析在位（re-sync 三级降级机制已退役：多轮编排入口归一，worktree 编排统一于 driver-base/release-gate；熔断逻辑内联保留于 driver 测试）
if grep -q "syncWorktreeToMain" FORGE/src/fresh-eyes-driver.mjs; then echo "❌ re-sync 退役机制回潮（编排已归一 driver-base/release-gate）"; elif grep -q "repeat-convergence" FORGE/src/fresh-eyes-driver.test.mjs; then echo "✅ 步零熔断阈值测试在位（re-sync 已退役·多轮编排入口归一）"; else echo "❌ FORGE 步零缺失"; fi
grep -q "先写报告骨架" FORGE/src/fresh-eyes-driver.mjs && echo "✅ A 侧收敛指令" || echo "❌ 缺骨架先行"
# g: dataDir SSOT 传承（原 #59 命令体迁入 + N-1 收编面）——禁止 process.cwd() 误传 overrideHome；MCP 工具禁本地 getSofagentDataDir（存量已清零，机械闸见 check-version 9d 零容忍）
_HITS=$(grep -rn "resolveAuditDir(process\|resolveKnowledgeDir(process\|resolveDataDir(process\|writeSessionReport.*process" engine/ --include="*.ts" | grep -v node_modules | grep -v dist | grep -v __tests__ || true)
[ -z "$_HITS" ] && echo "✅ 无 process.cwd() 误传" || { echo "$_HITS"; echo "❌ 存在误传"; }
grep -rn "function getSofagentDataDir" engine/mcp/src/ engine/think/src/ --include="*.ts" | grep -v __tests__ && echo "❌ 本地 dataDir 函数残留（应走 getDataDir SSOT）" || echo "✅ 零本地 dataDir（30 处已清零）"
DD_FILES=$(grep -rln "getDataDir" engine/mcp/src/ engine/think/src/ --include="*.ts" 2>/dev/null | grep -v __tests__ | grep -v "\.test\." | wc -l | tr -d ' '); [ "${DD_FILES:-0}" -ge 30 ] && echo "✅ ${DD_FILES} 文件全员 SSOT（原 #126 b 机械闸归并）" || echo "⚠️ SSOT 文件数 ${DD_FILES:-0} <30 复核"
# h: 卸载还原与面板版本口径（B 类安装卸载族并入）——卸载须备份且保留用户数据（只删 sofagent 产物）+ dashboard 版本活引用对账
grep -q "工作区数据" engine/scripts/uninstall.sh && grep -qE "备份|backup" engine/scripts/uninstall.sh && echo "✅ 卸载备份 + 用户数据保留" || echo "❌ 卸载语义缺失（误删用户数据风险）"
grep -q "dashboard.html" tools/check/check-version.sh && echo "✅ dashboard 版本对账在位" || echo "❌ dashboard 版本口径失守"
) 2>&1 | tee "/tmp/regress-dim-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim-$$.log" && { rm -f "/tmp/regress-dim-$$.log"; echo "该维度收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim-$$.log"; true
```

#### 127. 新功能审查面——训练运行九章+DSH 执行深化+审计聚合+反作弊基线一维收口（阶段四来源提取 A 类 · 归并「旧交付退役收口」入此：compose 旧别名下线与 fde_compose ontology 收窄为退役治理子项）

> 九章+清扫五件的静态一致性快查（执行级验证单测 138 用例已落 orchestrator/audit，此处分钟级 grep）。子项 h 承接清扫任务二/三的退役收口治理（别名承诺句式 + workflow-only 收窄——shim 移除的防遗忘锚）。**块级退出码防御**：子项行尾 `|| echo "❌"` 的 echo 恒 0 会吞失败退出码——整块必须包子 shell + tee 落盘 + 尾部 ❌ 扫描定 exit，严禁裸 echo 收尾。

```bash
(# a: 训练查询侧三 tools（train_status/train_list/train_diagnose 注册 + 分发）
# 分发面锚点修正（深模块批）：mcp-server 已由「逐 tool case 分支」改为消费 tool-registry
# 的 TOOLS 表动态分发（tools/list 与 tools/call 均走 TOOLS.find）。原 `case '$t'` 断言基于
# 旧实现——实测三 tool 均在 TOOLS（95 项）内且经 TOOLS.find 可达，故锚点改为
# 「注册表声明 + 动态分发链」双锚，覆盖面不变（注册面 + 分发面各一）。
for t in train_status train_list train_diagnose; do grep -q "name: '$t'" engine/mcp/src/tool-registry.ts && grep -q "TOOLS.find" engine/mcp/src/mcp-server.ts || echo "❌ $t 未注册/未分发"; done
# b: GPU 队列僵尸收割三判定（终态/无占位 queued/pid 死——防额度悬挂死锁）
grep -q "reapStaleGpuEntries" engine/train/src/train-scheduler.ts && grep -q "silentRelease" engine/train/src/gpu-queue.ts && echo "✅ 收割链在位" || echo "❌ 僵尸收割缺失"
# c: 诊断七类处方表（MiniMax-M1/ScaleRL 出处标注——处方口径可审计）
grep -q "MiniMax-M1" engine/train/src/train-diagnose.ts && grep -q "ScaleRL" engine/train/src/train-diagnose.ts && echo "✅ 处方出处标注" || echo "❌ 处方出处缺失"
# d: 审计聚合只读铁律（stats.ts 零写入 history.jsonl——appendFileSync 禁现）
! grep -qE "appendFileSync|writeFileSync" engine/audit/src/stats.ts && grep -q "computeAuditStats" engine/audit/src/cli-quick.ts && echo "✅ 聚合只读 + CLI 接线" || echo "❌ 聚合层有写或未接 CLI"
# e: 反作弊双防线默认化（train-env-init.sh 落 anticheat 节 + doctor 三项体检）
grep -q "anticheat" tools/train/train-env-init.sh && grep -q "checkAnticheatBaseline" engine/mcp/src/tools/train-doctor.ts && echo "✅ 双防线默认落盘" || echo "❌ 反作弊基线缺口"
# f: FORGE 步一二三（事件回放 + 全 step dsh + runtimeUsage 自动计量）
grep -q "replayEventsToStreamHandler" engine/orchestrator/src/execution-backends/dsh-backend.ts && grep -q "runtimeUsage" FORGE/src/fresh-eyes-driver.mjs && grep -q "return 'dsh'" FORGE/src/fresh-eyes-driver.mjs && echo "✅ DSH 三步在位" || echo "❌ DSH 深化缺口"
# g: onboarding 导览表（HANDBOOK 三线 × 是什么/从哪进/前置 + install 提示分层）
grep -q "新功能入口导览" docs/HANDBOOK.md && grep -q "后训模块（需要 GPU 环境）" install.sh && echo "✅ 导览+分层提示" || echo "❌ onboarding 断层"
# h: 退役收口治理（清扫二/三——别名与布尔链校验已按预告移除，收窄在位即过；回潮=旧标识复活）
! grep -qE "export (async )?function (composeWithDeepAgents|checkHistoryChainIntegrity)" engine/orchestrator/src/composer.ts engine/core/src/audit-history.ts && grep -q "action === 'ontology'" engine/mcp/src/tools/fde-compose.ts && grep -q "fde_derive" engine/mcp/src/tools/fde-compose.ts && echo "✅ 退役治理（别名+收窄）" || echo "❌ 退役收口回潮"
grep -q "checkHistoryChainIntegrity" CHANGELOG.md && echo "✅ 退役公告在 CHANGELOG 索引" || echo "❌ 公告丢失（v1.5.0 移除前置）") 2>&1 | tee "/tmp/regress-dim127-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim127-$$.log" && { rm -f "/tmp/regress-dim127-$$.log"; echo "维度127收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim127-$$.log"; echo "维度127收口:PASS"
```

#### 128. fresh-eyes 60+ 条修复防复发——门禁假红假绿族 + worktree 引用丢失 + 安全面六件 + dashboard 一致性（阶段四来源提取 B 类 · 参照 124/126 B 类一维收口惯例 · 归并 #142/#129 入此）

> 五轮审查（weighted-convergence 终态 0 P0/0 P1/1 P2 SKIP）修复的防复发锚点。文档数字面/npm 面已被 check-docs/check-version 工具覆盖不重复建维；vitest 并行假红/超时层已被 #110 覆盖。

```bash
(
# a: 门禁正则跨平台健壮性——\s 是 sed 表达式的真炸弹（GNU 认、BSD 不认），POSIX 类是正解；SSOT=check-guards.sh ①（perl 引擎 + find 递归 tools/playbook/engine/scripts + 注释行与 node/perl 内嵌行豁免）。本行只断言该守卫在位且当前干净，**不自建第二套 grep 判定**——grep 自身对 \s 的解释不可靠，正是 SSOT 选用 perl 的理由
bash tools/check/check-guards.sh 2>/dev/null | grep -q "✓ 无 BSD 不兼容正则残留" && echo "✅ 门禁 shell 无 BSD 不兼容正则残留（sed 上下文 · SSOT=check-guards ①）" || echo "❌ BSD 不兼容正则残留，或 SSOT 守卫 ① 未跑/失声（先单独跑 bash tools/check/check-guards.sh 看 ① 段）"
# 防御：正则只锚定审计命令形态——行首（忽略缩进）npx/node 调用 sofagent-audit 且同行挂 || true，才是「退出码被清 0」真假绿 宽匹配 `sofagent-audit.*|| true` 会误中 gh label 装饰行（描述字符串含产品名）；label 写操作挂 || true 是 fork PR 只读令牌的设计降级，非假绿
grep -rnE '^[[:space:]]*(npx|node.*)sofagent-audit.*\|\| true' .github/workflows/ 2>/dev/null | grep -vE "^[^:]+:[0-9]+:#" | grep -q . && echo "❌ CI 审计门禁残留 || true 假绿（exit_code 被清 0，FAIL 永不阻断）" || echo "✅ CI 审计无 || true 假绿"
# b: worktree 引用丢失防线（悬挂 commit 根因 80c94f64 + LEDGER worktree 副本蒸发）——teardown 固化 tip + driver 产物主仓落盘
grep -q "branch -f" FORGE/src/driver-base.mjs && echo "✅ teardown 固化分支 tip 在位" || echo "❌ teardown 前未固化 tip（悬挂 commit 回潮）"
grep -n "LEDGER" FORGE/src/driver-base.mjs | grep -qE "\\\$REPO_ROOT|repoRoot|主仓" && echo "✅ LEDGER 落盘主仓路径" || echo "⚠️ 复核 LEDGER 落盘路径（须主仓非 worktree 副本）"
# c: 安全面六件静态锚点（A23 symlink/A22 提权/data URI 脱敏/审计 fail-open/影子审计器基线/--revert 非 TTY）
grep -q "symlink\|realpath" engine/audit/src/rules/rule-a23-path-traversal.ts && grep -q "escalat\|setuid\|提权" engine/audit/src/rules/rule-a22-privilege-escalation.ts && echo "✅ A23/A22 规则面在位" || echo "❌ A22/A23 规则面缺失"
grep -q "escaped" engine/audit/src/permission/checker.ts && grep -q "ReDoS\|灾难性回溯\|正则注入" engine/audit/src/permission/checker.ts && echo "✅ 权限正则元字符转义加固在位" || echo "❌ 权限正则注入/ReDoS 防线丢失"
# d: dashboard 静态一致性（双版本/缺省态谎报/图例配色/scrollTop 非法 API）
grep -c "logo-version" tools/dashboard/dashboard.html | grep -qE "^[0-9]+$" && ! grep -q "document.scrollTop" tools/dashboard/dashboard.html && echo "✅ dashboard 版本单源 + 无非法 API" || echo "❌ dashboard 一致性回退"
# e: H-01 install 后形态（原 #126 a 归并）——双 hook 在位 + 旧 hook .bak 化（S16 接管语义）；worktree .git 是文件，raw path 必假阴——git-path 动态解析
HOOKS_DIR=$(git rev-parse --git-path hooks); test -f "$HOOKS_DIR/pre-commit" && test -f "$HOOKS_DIR/commit-msg" && echo "✅ 双 hook 在位（$HOOKS_DIR）" || echo "❌ hook 缺失（跑 install.sh）"
# f: 断言校准三同步 + CI 纯净 fixture（原 #126 c/d 归并）——判定/展示/引用三处同步；hook 对账类测试自带迷你 dist 防 CI 假绿
grep -q "450" playbook/acceptance-test.sh && grep -q "迷你 dist" engine/audit/src/commands/init.test.ts && echo "✅ 三同步示范 + 迷你 dist fixture" || echo "❌ 三同步/fixture 回潮"
) 2>&1 | tee "/tmp/regress-dim-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim-$$.log" && { rm -f "/tmp/regress-dim-$$.log"; echo "该维度收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim-$$.log"; true
```

**子项 g-i（归并自原 #142 · fresh-eyes 修复批安全豁免面防复发）**
fresh-eyes 修复批安全豁免面防复发——A1 豁免组合矩阵 + A2 转义对抗链（B 类）

> **本块覆盖**：A1 数据容器臂 / 扩展名尾锚定 / .env 前缀豁免叠加 / A2 转义链。核心方法论：任何新增豁免必须回答「与既有豁免叠加后最坏形态的阻断等级」。

```bash
(
FAIL=0
# a: 数据容器臂剔除（.env.json/.env.yaml/.env.yml 等 env dump 载体不得静默 PASS——豁免面组合矩阵实锤）
grep -qE "\.env\.json|\.env\.yaml|serverless\.env" engine/audit/src/rules/rule-a1-sensitive-files.ts && echo "✅ 数据容器臂已剔除" || { echo "❌ env dump 载体仍可逃逸"; FAIL=1; }
# b: 扩展名尾锚定 + basename .env 前缀不进豁免（目录组件绕过 / .env.test.js 放行回归双防）
grep -qE "代码扩展名尾锚定|尾锚定" engine/audit/src/rules/rule-a1-sensitive-files.ts && grep -q "必要非充分条件" engine/audit/src/rules/rule-a1-sensitive-files.ts && echo "✅ 豁免边界双防在位" || { echo "❌ 豁免边界回退"; FAIL=1; }
# c: A2 尾剥离/转义对抗回归样本在位（B 自报已修须有可复演样本——hex 转义还原 + 用例数不缩水）
grep -q "restoreHexEscapes" engine/audit/src/rules/rule-a2-secret-leak.ts && [ "$(grep -c 'it(' engine/audit/src/rules/rule-a2.test.ts)" -ge 10 ] && echo "✅ A2 转义还原 + 对抗用例在位" || { echo "❌ A2 对抗样本缺失"; FAIL=1; }
[ "${FAIL:-0}" = "1" ] && { echo "维度142:FAIL"; exit 1; }; echo "维度142:PASS"
) 2>&1 | tee "/tmp/regress-dim-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim-$$.log" && { rm -f "/tmp/regress-dim-$$.log"; echo "该维度收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim-$$.log"; true
**子项 j-p（归并自原 #129 · fresh-eyes 19 项修复防复发）**：fresh-eyes 19 项修复防复发——CLI 接线断链 + 供应链回滚路径 + nodeId/YAML 清洗 + 结构性收口（阶段四来源提取 A/B 类一维收口 · 行为面已由单测锁：weights-deploy/fde-workbench/export/corpus-export +9 用例）

> 19 项发现（P0×1 + P1×7 + P2×11，修复批 37cab2b9）防复发锚点。P0「声称命令三面零接线」的机械防线已落 check-docs §13（submitCompareJobs 生产调用 ≥1 断言在册）；行为面（回滚哈希直验/中文 nodeId 清洗/YAML 转义/scope 校验/auditEvent null/enterpriseId 正名）已由四包单测 +9 用例锁定，此处只收 grep 级结构性锚 + 新增声称点对账面。

```bash
(
# a: P0 接线断链族——CHANGELOG 声称的命令必须真实装可达（CLI 分支实装 + 帮助面 + 回填 API 三锚）
grep -q "v1.4.4 交付④：train compare" engine/orchestrator/src/cli.ts && grep -q "refreshCompareResults" engine/train/src/train-compare.ts && echo "✅ train compare CLI 接线 + 回填 API 在位" || echo "❌ compare 接线断链（P0 回潮）"
grep -q "submitCompareJobs" tools/check/check-docs.sh && echo "✅ §13 接线存在性断言在册（新声称点自动进对账面）" || echo "❌ §13 断言丢失——声称命令脱离门禁保护"
# b: 供应链回滚路径——三路径（注册/切换/回滚）哈希校验无旁路；止损路径校验强度不得弱于常规路径
grep -n "verifyHash: true" engine/orchestrator/src/model-registry.ts | grep -q "true" && grep -q "hashDir(targetDir)" engine/orchestrator/src/model-registry.ts && echo "✅ 回滚目标哈希直验在位（第三环闭合）" || echo "❌ 回滚路径校验旁路（供应链红线失守）"
# c: nodeId/YAML 双清洗——Skill 标识位（frontmatter name/文件名）与 ontology 插值必须走清洗/转义，模板路径与内置默认同一条规则
grep -q "sanitizeNodeId" engine/orchestrator/src/fde/fde-quantify.ts && grep -q "yamlScalar" engine/orchestrator/src/fde/fde-quantify.ts && echo "✅ 双清洗函数在位" || echo "❌ nodeId/YAML 清洗丢失（中文产物必非法）"
# d: 结构性 P2 簇——单源委托/跨包互链/fork 适配/死变量清除四锚
grep -q "return buildVerifiersWithOverrides({})" engine/audit/src/export/reward-mapping.ts && echo "✅ verifiers 单源委托" || echo "❌ 双份维护回潮"
grep -q "三件套全景" engine/audit/src/export/exporter.ts && echo "✅ 三件套跨包互链" || echo "❌ 导出三件套导航锚点丢失"
grep -q "GLM_API_KEY" FORGE/models/profile.mjs && echo "✅ fork 适配提示在位" || echo "❌ fork 者无 key 时降级链失效无提示"
! grep -q "benchRoot" engine/core/src/export/sample-aggregator.ts && echo "✅ benchRoot 死变量已清" || echo "❌ 死变量回潮"
) 2>&1 | tee "/tmp/regress-dim-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim-$$.log" && { rm -f "/tmp/regress-dim-$$.log"; echo "该维度收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim-$$.log"; true
```

```
#### 130. 发版流程与发版域教训防复发——sha256 预计算 + Marketplace 延续 + ClawHub 快照 + Edit 串行 + npm 对账缓存 + 干净态排查

> 发版四坑实录：① bootstrap.sh INSTALL_SHA256 回填走「tag 后算哈希再回填再重打 tag」两次 tag 往返——预计算 HEAD 哈希与 URL bump 同 commit 可让 tag 一次打自洽（install.sh/lib 无改动时 lib 哈希不变免回填）；② GitHub Marketplace listing 勾选自动延续（v1.4.2 起每版勾选后 listing 关联保持），版本页出现新版号即免网页操作；③ ClawHub verify 的 `security.status_not_clean` 可能是既有状态（1.4.3 时代已存在）——发布前先快照对照，新引入才需处置；④ 同一文件多处 Edit 并行调用发生读写竞态（5 处只落 2 处）——同文件多编辑必须串行。

```bash
(
# 原 #135 发版域教训四锚点整体并入（git log -p 可溯，断言零删减）；① sha256 自洽预检：bootstrap 内嵌哈希 == HEAD install.sh 哈希（打 tag 前跑，免重打）
EMB=$(sed -n 's/^INSTALL_SHA256="\([a-f0-9]*\)".*/\1/p' bootstrap.sh); HEAD_H=$(git show HEAD:install.sh | shasum -a 256 | cut -d' ' -f1)
if [ "$EMB" = "$HEAD_H" ]; then echo "✅ sha256 自洽（钉值 == HEAD install.sh 哈希）"
else
  # 待发版窗口态（对齐 check-version F6 动态判据——SSOT 已发版 + 后继一版 devlog 在位 ⇒ 窗口开；
  # install.sh 已随开发改动、钉值仍指向上一已发版 tag 属预期——回填与打 tag 同步于阶段九；硬判 FAIL 会把阶段五正常态误报 P0。
  CUR_V=$(node -p "require('./package.json').version")
  NEXT_CANDS=$(node -e "const p='${CUR_V}'.split('.').map(Number);console.log([p[0],p[1],p[2]+1].join('.')+' '+[p[0],p[1]+1,0].join('.')+' '+[p[0]+1,0,0].join('.'))")
  PEND=0; PEND_NAME=""; for cand in $NEXT_CANDS; do seg=$(echo "$cand"|cut -d. -f1-2); [ -s "docs/changelog/v${seg}/v${cand}.md" ] && PEND=1 && PEND_NAME="$cand" && break; done
  if [ "$PEND" -eq 1 ] && git rev-parse "v${CUR_V}" >/dev/null 2>&1; then
    echo "⏳ 待发版态（v${PEND_NAME} devlog 在位）：钉值 ${EMB:0:12}… ≠ HEAD 哈希 ${HEAD_H:0:12}…（install.sh 已随开发改动）——回填+打 tag 属阶段九，非阻塞"
  else
    echo "❌ sha256 不自洽（已发版态：钉值应等于 HEAD install.sh 哈希）"
  fi
fi
PREV_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo v1.4.3); git diff "$PREV_TAG"..HEAD --stat -- engine/scripts/lib/ | wc -l | grep -q "^0$" && echo "✅ lib 零改动（LIB_SHA256S 沿用）" || echo "🟡 lib 相对 $PREV_TAG 有改动——6 哈希须逐项回填（排期阶段九 tag 前）"  # ② 6 lib 哈希稳定：lib 无改动免回填
MKT_HTML=$(curl -s --max-time 10 https://github.com/marketplace/actions/sofagent); MKT_RC=$?; if [ $MKT_RC -ne 0 ]; then echo "🟡 网络不可达（curl exit $MKT_RC）——marketplace 对照跳过（网络态非仓库问题，有网时人工复核）"; elif echo "$MKT_HTML" | grep -q "$(node -p "require('./package.json').version")"; then echo "✅ marketplace 版本页已含本版"; else echo "🟡 版本页未见本版——按 SOP 网页勾选 Publish to Marketplace"; fi  # ③ Marketplace 版本页含本版号即免网页勾选（自动延续）
# ④ ClawHub 快照纪律：发布前 verify 落盘（clawhub skill verify <slug> > /tmp/clawhub-pre.json）对照处置；④b pending scan 显旧版+suspicious≠失败，转正判据走 API（clawhub.ai/api/v1/packages/<name>?ownerHandle=<handle>）
grep -q "prefer-online" docs/changelog/releasing/09-publish.md && grep -q "prefer-online" docs/changelog/releasing/11-post-publish.md && echo "✅ SOP 对账命令守卫在位" || echo "❌ SOP 对账命令退化为裸查询"  # ⑤ npm 对账带 --prefer-online（裸查询吃缓存误报漏发）
# ⑥ 构建拓扑序干净态自洽（本地 dist 残留会掩盖乱序）⑦ 环境特异失败先模拟 CI 干净态（三类排查序）⑧ 工具降级分支 fail-loud（降级必须可见）
node -e "const s=require('./package.json').scripts.build; const order=['inject','core','ontology','rules','audit','eval','think','evolve','orchestrator','train','daemon','ab-test','mcp','sofagent-load-chain']; let i=-1; for(const seg of s.split(' && ')){const m=seg.match(/--workspace=([^\s]+)/); if(!m) continue; const short=m[1].replace(/^engine\//,'').replace(/^hooks\//,''); if(short.startsWith('dsh-plugins/')||short.startsWith('openclaw-plugins/')) continue; const idx=order.indexOf(short); if(idx<0||idx<=i){console.error('❌ 拓扑序倒置或未知包: '+m[1]); process.exit(1);} i=idx;}" && echo "✅ build 序列满足 14 包拓扑序（dsh-plugins/openclaw-plugins 家族序由 check-cross-package-relative.mjs 独立钉住，不在此面）"
grep -q "rm -rf engine/\*/dist" docs/changelog/releasing/09-publish.md && echo "✅ 干净态排查法已写入 SOP" || echo "❌ 干净态排查法从 SOP 丢失"
git grep -q "regexWarned" -- tools/check/public-api.mjs && echo "✅ 降级 fail-loud 在位" || echo "❌ 降级静默"
) 2>&1 | tee "/tmp/regress-dim-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim-$$.log" && { rm -f "/tmp/regress-dim-$$.log"; echo "该维度收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim-$$.log"; true
```

#### 131. 后训服务与持续收口批防复发——train 五新面/进化实证/retention 加固/链锚一维收口（阶段四来源提取 A/B 合流 · 行为面已由单测锁：serve 21/compliance 19/deliverable 20/retention 15/session 17+2 用例）

```bash
(
# 逐锚语义：a = 交付面存在性（train 五新面/进化实证 sampler cursor + skill-impact 台账/quickstart 双件/fde-session lastCapturedAt/WIKI §数据文件架构指针）；b = retention 加固 + 链锚/SANITIZE 值形可证 + tools 双源动态对账
MISS=0; for f in train-serve train-compliance train-deliverable retention-policy train-continuous; do test -f "engine/train/src/$f.ts" || MISS=$((MISS+1)); done; [ "$MISS" -eq 0 ] && echo "✅ train 五新面在位" || echo "❌ train 新面缺 $MISS 文件"
test -f docs/guides/train-quickstart.md && test -f docs/guides/examples/quickstart-data.csv && grep -q "cursor" engine/daemon/src/dream-cycle/continuous-sampler.ts && test -f engine/orchestrator/src/skill-evolution/skill-impact-ledger.ts && grep -q "lastCapturedAt" engine/orchestrator/src/fde-session-mgr/index.ts && echo "✅ 进化实证 + quickstart + 会话时间戳在位" || echo "❌ 交付面缺口"
# tools 计数源/dist 双源动态对账（写死数字每版必漂——与 S426 同款债）
REG_N=$(grep -cE "^ {4}name: '" engine/mcp/src/tool-registry.ts); DIST_N=$(node -e "console.log(Object.keys(require('./engine/mcp/dist/tool-registry.js').TOOLS||require('./engine/mcp/dist/tool-registry.js')).length)" 2>/dev/null || echo 0)
grep -q "§数据文件架构" docs/WIKI.md && [ "$REG_N" = "$DIST_N" ] && [ "$REG_N" -gt 0 ] && echo "✅ WIKI 指针在位 + tools 计数源/dist 一致（${REG_N}）" || echo "⚠️ WIKI 指针缺失或 tools 源/dist 计数漂移（源 ${REG_N} / dist ${DIST_N}）——复核"
grep -q "isSymbolicLink" engine/train/src/retention-policy.ts && grep -q "realpathSync" engine/train/src/retention-policy.ts && [ "$(grep -c "resolvePointPath" engine/train/src/retention-policy.ts)" -ge 4 ] && grep -q "trainArchiveDir" engine/train/src/retention-policy.ts && echo "✅ retention 四词形在位" || echo "❌ retention 加固回潮"
test -f engine/audit/src/chain-head-anchor.test.ts && grep -q "shouldExempt(key: string, value: string)" engine/audit/src/audit-history.ts && grep -q "sanitizeFreeText(value) === value" engine/audit/src/audit-history.ts && echo "✅ 链锚测试 + SANITIZE 值校验在位" || echo "❌ 链锚/SANITIZE 回潮"
) 2>&1 | tee "/tmp/regress-dim-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim-$$.log" && { rm -f "/tmp/regress-dim-$$.log"; echo "该维度收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim-$$.log"; true
```

#### 132. bugfix 批与流程加固防复发——ruleset 渲染/版本动态读/空 diff 审计/uninstall 配对/PERSPECTIVES 对账一维收口（阶段四来源提取 B 类 · 行为面 S381 空 diff 三形态已锁 · B3 根 commit 补审归 S222 空树锚）

> 阶段三 8 finding + bugfix 29 文件的轻量锚。B1 ruleset A0 渲染、B2 版本硬编码双批、B4 openclaw 空 diff、B5 uninstall 漏平台、B6 双清单漂移——全部 grep 型快速检查，端到端行为面由 acceptance S381（空 diff 审计三形态）/S222（根 commit 空树补审）锁定。

```bash
(
# B1: ruleset 汇总行规则编号渲染（A0 乱显修复）——500+ 独立编号空间 + 四渲染面分支在位
# 渲染分支真实位置 = index/reporter/stats/webhook 四文件（ruleset-loader.ts:675 仅分配 500+ 编号，渲染在 reporter 渲染为 R1/R2）
# 渲染面锚点修正（深模块批）：R/E/A 三前缀渲染已从四文件内联 `number - 500` 比较重构为
# 单一函数 ruleCode()（engine/audit/src/rules/assemble.ts:25；注释明示「与历史多处逐字一致，
# 零行为变化」）。锚点改为「ruleCode 三前缀分支在位 + 四渲染面均消费 ruleCode」双锚——
# 覆盖面不变且更强（收敛为单一 SSOT，杜绝四份副本漂移）。
grep -q "R1" engine/audit/src/ruleset-loader.ts && grep -q "number >= 500" engine/audit/src/rules/assemble.ts && RCOUNT=$(grep -l "ruleCode(" engine/audit/src/index.ts engine/audit/src/reporter.ts engine/audit/src/stats.ts engine/audit/src/webhook.ts 2>/dev/null | wc -l | tr -d ' '); [ "${RCOUNT:-0}" -ge 4 ] && echo "✅ ruleset R 前缀渲染（ruleCode SSOT + 四渲染面 ${RCOUNT}/4）" || echo "❌ ruleset A0 渲染回潮（ruleCode SSOT 缺失或渲染面仅 ${RCOUNT:-0}/4）"
# B2: 版本动态读 ×8（CLI 1 + DSH 插件 7，plugins.json SSOT；plugin-kit 为基座非插件——hostPkg 参数收版本，不入动态读 glob）（engine/ab-test CLI + 9 dsh 插件 pluginMeta 均不硬编码版本）——插件为 _pkg.version 间接形态，锚词覆盖两种写法
DYN=$(grep -rlE "require\('\.\./package\.json'\)" engine/ab-test/src/cli.ts engine/dsh-plugins/cordis-plugin-sofagent*/src/index.ts 2>/dev/null | wc -l | tr -d ' '); [ "${DYN:-0}" -ge 8 ] && echo "✅ 版本动态读 ${DYN} 文件在位" || echo "❌ 版本硬编码回潮（动态读仅 ${DYN:-0}/8）"
# B4: openclaw execute 空数组绕过修复——按 scope 取真实 diff 非 runRules([])
grep -q "parseDiff" engine/openclaw-plugins/*/index.ts 2>/dev/null || grep -rq "parseDiff" engine/openclaw-plugins/ && echo "✅ openclaw execute 取真实 diff 在位" || echo "❌ execute 传空数组绕过回潮"
# B5: uninstall 回收清单与 install 支持面配对（cursor/gemini 不漏）——脚本在 engine/scripts/ 非仓库根
grep -q "cursor" install.sh && grep -q "cursor" engine/scripts/uninstall.sh && grep -q "gemini" install.sh && grep -q "gemini" engine/scripts/uninstall.sh && echo "✅ uninstall 平台清单配对（cursor/gemini 在册）" || echo "❌ uninstall 漏平台（装得上卸不掉）"
# B6: PERSPECTIVES 双清单启动对账在位（漂移 exit 1 自检内建）——脚本在 tools/gen/ 非 FORGE/src/
grep -q "assertPerspectivesMatchPlaybook" tools/gen/gen-fresh-eyes-draft.mjs && echo "✅ PERSPECTIVES 双清单对账自检在位" || echo "❌ 16 视角双清单漂移防线丢失"
) 2>&1 | tee "/tmp/regress-dim132-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim132-$$.log" && { rm -f "/tmp/regress-dim132-$$.log"; echo "维度132收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim132-$$.log"; echo "维度132收口:PASS"
```

#### 133. 审查面与修复批一维收口——新功能 46 锚点 + bugfix/质量循环防复发（阶段四来源 A 类 + #134 归并：断言零删减，git log -p 可溯）十组）

> 商业平台接口版十组交付的静态一致性快查（执行级验证已由包内单测锁：gap-analyzer / pr-store / visibility / workflow-container / train-channel / cloud-train / data-paths / audit-reducer / onboard-prompt；此处分钟级 grep）。**块级退出码防御**：子项行尾 `|| echo "❌"` 的 echo 恒 0 吞失败——整块包子 shell + tee 落盘 + 尾部 ❌ 扫描定 exit。

```bash
(# a: 能力缺口查询 + 绩效数据导出（G2/G4 · tool 注册 + orgId 语义分层并存；CHANGELOG「能力缺口与绩效」）
for t in workflow_gaps contribution_query; do grep -q "name: '$t'" engine/mcp/src/tool-registry.ts || echo "❌ $t 未注册"; done; grep -q "orgId" engine/core/src/agent-identity.ts && grep -q "enterpriseId" engine/core/src/agent-identity.ts && grep -q "orgId" engine/mcp/src/tools/contribution-query.ts && echo "✅ G2/G4 + orgId 过滤（enterpriseId 并存）" || echo "❌ 缺口/绩效字段缺失"
# b: 节点级可见性元数据 + 多租户抽象层（G6 三级枚举 + 审阅门 / G7 租户路径隔离 fail-loud；CHANGELOG「可见性与多租户 v0」）
grep -q "validateVisibility" engine/orchestrator/src/workflow/container.ts && grep -q "resolveTenantDataDir" engine/core/src/data-paths.ts && grep -q "SOFAGENT_TENANT" engine/core/src/data-paths.ts && echo "✅ G6/G7（审阅门 + 租户隔离）" || echo "❌ 可见性/租户隔离缺失"
# c: PR 生命周期接口（G13 三 tool + 合并门真判定 + branch→trunk 写回编排）
for t in pr_submit pr_review pr_merge; do grep -q "name: '$t'" engine/mcp/src/tool-registry.ts || echo "❌ $t 未注册"; done; grep -q "evaluateCriterion" engine/audit/src/pr-store.ts && grep -q "prRecordMergedVersion" engine/mcp/src/tools/pr-tools.ts && echo "✅ G13 三 tool + 真判定 + 写回" || echo "❌ PR 域缺口（恒真门/写回断链）"
# d: G14 workflow CRUD（四 tool + 校验门 + 变更留痕）
for t in workflow_create workflow_update workflow_node_add workflow_diff_preview; do grep -q "name: '$t'" engine/mcp/src/tool-registry.ts || echo "❌ $t 未注册"; done; git grep -q "ARTIFACT_EDIT" -- engine/ && echo "✅ G14 四 tool + ARTIFACT_EDIT 留痕" || echo "❌ G14 缺口"
# e: FDE 交付三件（workflow 烧进 USB + 首部署确定性 cron job 包 + 上岗 prompt 生成器）
git grep -q "create-usb-key" -- engine/ install.sh && grep -q "runDueTasks" engine/daemon/src/cron.ts && grep -q "with-first-deploy-cron" install.sh && test -f engine/daemon/src/templates.ts && test -f engine/daemon/src/billing.ts && test -f engine/mcp/src/tools/onboard-prompt.ts && echo "✅ FDE 三件齐备" || echo "❌ FDE 交付缺口"
# f: 云训练执行接线收口（TrainChannel 契约/ssh 适配/双通道归一/托管规范/daemon 真实消费；CHANGELOG「云训练执行收口」）
grep -q "interface TrainChannel" engine/train/src/train-channel.ts && grep -q "createSshTrainChannel" engine/daemon/src/cloud-exec.ts && grep -q "chainDualChannelEvent" engine/daemon/src/cloud-events.ts && test -f docs/guides/train-channel-spec.md && test -f engine/daemon/src/tasks/cloud-train.ts && echo "✅ 云通道五面齐备" || echo "❌ 云通道缺口（零调用回潮）"
# g: 静态加密全量接线 + data_push 入口接线（daemon 接线收口批：生产调用点 + 双闸消费）
grep -q "initDataEncryption" engine/daemon/src/cli.ts && grep -q "name: 'data_push'" engine/mcp/src/tool-registry.ts && echo "✅ 双接线收口（加密 + data_push）" || echo "❌ 接线回退（零调用）"
# h: 运行时审计约束层侧 repo-hash 隔离（引擎化 + 审计侧消费 + commit 级主链全局不动）
grep -q "computeRepoHash" engine/core/src/repo-hash.ts && grep -q "computeRepoHash" engine/audit/src/data-sovereignty.ts && grep -q "history.jsonl" engine/audit/src/audit-history.ts && echo "✅ repo-hash 引擎化 + 隔离消费（主链全局不动）" || echo "❌ 隔离缺口"
# i: audit 专职面文档化 + 审计留痕双层（角色配置文档 + 规约层过滤 + PROV-O 出口）
git grep -q "SOFAGENT_MCP_ROLES" -- docs/API.md && grep -q "reduceAuditHistory" engine/audit/src/audit-reducer.ts && grep -q "exportProvTurtle" engine/audit/src/audit-reducer.ts && echo "✅ 专职面 + 留痕双层" || echo "❌ audit 面缺失"
# j: 接线登记机制（新接线符号须在监控表——不登记=交付未完成）
for s in createSshTrainChannel chainDualChannelEvent gateDataPush; do grep -q "$s" tools/check/check-unwired-exports.sh || echo "❌ $s 未登记监控表"; done; echo "✅ 接线登记机制（上方零失败）") 2>&1 | tee "/tmp/regress-dim133-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim133-$$.log" && { rm -f "/tmp/regress-dim133-$$.log"; echo "维度133收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim133-$$.log"; echo "维度133收口:PASS"
```

#### 136. 依赖方向架构测试防复发——13 包边界清单 + 注入自测三态

> build 序列 13 包五层（核心 harness/core ← 领域 ont/rules ← 约束 audit/eval/think/evolve ← 编排 orch/daemon ← 展示 ab/mcp/load-chain）。三态实测：干净绿 / 注入 core→orchestrator 红 / 还原绿。

```bash
(
bash tools/check/dependency-direction.sh > /dev/null 2>&1 && echo "✅ 13 包方向合法" || echo "❌ 有违规边"  # a: 门禁干净态
[ -f tools/check/dependency-direction.yml ] && grep -q "dependency-direction" tools/release/pre-push-check.sh && grep -q "dependency-direction" .github/workflows/pr-check.yml && echo "✅ 清单+3e+CI 在位" || echo "❌ 清单或接线缺失"  # b+c
) 2>&1 | tee "/tmp/regress-dim-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim-$$.log" && { rm -f "/tmp/regress-dim-$$.log"; echo "该维度收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim-$$.log"; true
```

#### 137. 审查面 A 类——五族合一维收口（策略门/行为分级/成本压缩/模型进化/执行纪律 · 归并 #138-#141 入此：断言零删减，git log -p 可溯）

> 来源：devlog 一~十章（阶段四 A 类收拢——五族同为 fail-closed/显式失败语义；⑦ 段真聚簇实测**同版本**五维同题，按判据②归并对销；跨版本聚簇按判据④.4 不归并）。

```bash
(
FAIL=0
# ── 策略门族 ──
# a: 三类来源分类（git-url / host / local-path）——误分类即白名单绕过
node -e "const m=require('./engine/audit/dist/cli/plugin-gate.js');const k=[['https://github.com/org/*','git-url'],['github.com','host'],['/opt/plugins/*','local-path']];const bad=k.filter(p=>m.classifySource(p[0]).kind!==p[1]);if(bad.length){console.log('分类漂移',JSON.stringify(bad));process.exit(1)};console.log('三类来源分类正确')" || { echo "❌ 来源分类漂移"; FAIL=1; }
# b: install.sh --policy 三出口 fail-closed（文件缺失 / 校验器不可用 / --lint 解析失败各自 exit 1）
grep -q "安装中止（fail-closed）" install.sh && grep -q "校验器不可用" install.sh && grep -q "\-\-lint" install.sh && echo "✅ --policy 三出口在位" || { echo "❌ fail-closed 出口缺失"; FAIL=1; }
# c: app×tool 白名单未声明即拒绝（ToolGate 语义锚 + 单测在位）
grep -q "未出现在本表" engine/audit/src/cli/plugin-gate.ts && grep -rq "app_tool_policy" engine/audit/src/__tests__/ && echo "✅ 白名单矩阵语义在位" || { echo "❌ ToolGate 语义缺失"; FAIL=1; }
# ── 行为分级族（原 #138 归并）──
# d: 六阵型合法值 + 未识别阵型拒绝（schema 值域漂移 = 静默放行未知阵型）
node -e "const m=require('./engine/orchestrator/dist/formations/schema.js');const bad=[];if(m.FORMATION_NAMES.length!==6)bad.push('阵型数='+m.FORMATION_NAMES.length);const v=m.validateFormation({formation:'no-such-formation',members:[{id:'m1',role:'r'}],edges:[]});if(v.valid)bad.push('未识别阵型被放行');if(bad.length){console.log('阵型 schema 异常',bad.join('|'));process.exit(1)};console.log('六阵型 + 拒绝语义正确')" || { echo "❌ 阵型 schema 漂移"; FAIL=1; }
# e: 提权三态 action 值齐备（safe=allow / risky=require-approval / dangerous=forbid-until-approved）
grep -q "forbid-until-approved" engine/core/src/escalation/policy.ts && grep -q "require-approval" engine/core/src/escalation/policy.ts && grep -q "'allow'" engine/core/src/escalation/policy.ts && echo "✅ 三态 action 值齐备" || { echo "❌ 三态语义缺失"; FAIL=1; }
# ── 成本与压缩族（原 #139 归并）──
# f: 3% 预算检测 + 压缩 start/end 标记 + 回调出口 + 零依赖（压缩器不得 import audit 包）
node -e "const b=require('./engine/inject/dist/load-chain/budget.js');const c=require('./engine/inject/dist/load-chain/compactor.js');const fs=require('fs');const bad=[];if(typeof b.checkBudget!=='function')bad.push('缺 checkBudget');if(!c.COMPACT_START_MARKER||!c.COMPACT_END_MARKER)bad.push('缺压缩标记');const src=fs.readFileSync('engine/inject/src/load-chain/compactor.ts','utf8');if(/from\s+.[^.]*audit/.test(src))bad.push('压缩器耦审计包');if(bad.length){console.log(bad.join('|'));process.exit(1)};console.log('预算+标记+零依赖正确')" || { echo "❌ 压缩族锚点漂移"; FAIL=1; }
# g: quota WARN/HARD 双模式 + cost_query 三字段（余量/已用/周期）
grep -qE "'WARN' \| 'HARD'|WARN（放行" engine/core/src/cost/quota-gate.ts && grep -q "remaining" engine/mcp/src/tools/cost-query.ts && grep -qE "usedTokens|period" engine/mcp/src/tools/cost-query.ts && echo "✅ 双模式 + 三字段在位" || { echo "❌ quota 面缺失"; FAIL=1; }
# ── 模型与进化族（原 #140 归并）──
# h: required 未注册 → 抛 ModelPreferenceError（静默降级 = 模型漂移无感）
node -e "const m=require('./engine/orchestrator/dist/model-resolver.js');const fs=require('fs');const bad=[];if(typeof m.ModelPreferenceError!=='function')bad.push('缺 ModelPreferenceError');const src=fs.readFileSync('engine/orchestrator/src/model-resolver.ts','utf8');if(!/required/.test(src))bad.push('缺 required 语义');if(bad.length){console.log(bad.join('|'));process.exit(1)};console.log('模型偏好显式失败语义在位')" || { echo "❌ 模型偏好语义缺失"; FAIL=1; }
# i: 进化模块自研 gate 默认 native（零 Python 触点）
grep -q "SOFAGENT_EVOLVE_GATE ?? 'native'" engine/evolve/src/evolve-integration.ts && ! grep -rqE "python3?( |$)|spawnSync\('py" engine/evolve/src/ --include="*.ts" && echo "✅ native 默认 + 零 Python" || { echo "❌ evolve gate 默认值/Python 触点异常"; FAIL=1; }
# j: 旧包名 @sofagent/skillopt 零残留（更名 73 文件联动）——三面齐查（package.json / 锁文件 / node_modules）
{ grep -rq "@sofagent/skillopt" package.json engine/*/package.json FORGE/package.json package-lock.json 2>/dev/null \
  || [ -e node_modules/@sofagent/skillopt ]; } && { echo "❌ 旧包名残留（package.json / 锁文件 / node_modules 任一面）"; FAIL=1; } || echo "✅ 旧名清零（三面齐查）"
# k: loop 三形态定位边界互不重叠声明 + optimization-loop 实现保留（撤承诺 ≠ 删实现）+ --legacy 退役显式拒绝
for f in engine/orchestrator/src/loop/index.ts engine/orchestrator/src/loop-agent/driver.ts engine/orchestrator/src/refine-agent/refine-driver.ts; do grep -q "定位边界（v1.4.8 条目 10）" "$f" && grep -q "不合并" "$f" || { echo "❌ 三形态定位边界声明缺失: $f"; FAIL=1; }; done
grep -q "runOptimizationLoop" engine/orchestrator/src/refine-agent/optimization-loop.ts && echo "✅ optimization-loop 实现保留" || { echo "❌ optimization-loop 实现被误删"; FAIL=1; }
grep -q "已于 v1.5.0 移除" engine/orchestrator/src/cli.ts && grep -q "args.includes('--legacy')" engine/orchestrator/src/cli.ts && echo "✅ loop --legacy 退役显式拒绝（fail-closed 在位）" || { echo "❌ loop --legacy 退役拒绝缺失"; FAIL=1; }
# ── 执行机制纪律族（原 #141 归并）──
# l: 裸 id 结构化拒绝（SOFAGENT_SCOPE_REQUIRED——多实体系统撞名必然）
node -e "const m=require('./engine/core/dist/scope-names.js');const r=m.validateScopedName('bare-id-without-scope');if(r.valid){console.log('裸 id 被放行');process.exit(1)};if(r.error&&!/作用域显名/.test(r.error)){console.log('拒绝原因非显名语义');process.exit(1)};console.log('裸 id 结构化拒绝正确')" || { echo "❌ 作用域显名语义漂移"; FAIL=1; }
# m: Git 能力三态×两隔离矩阵 + 意图分类纯函数主判**行为判据**（章二改造：真调 classifyIntentByRules 验行为，非字符串锚——「靠 LLM 判定等于没判定」）
grep -q "planExecution" engine/orchestrator/src/exec/git-capability.ts && grep -qE "'none' \| 'local' \| 'remote'" engine/orchestrator/src/exec/git-capability.ts && node -e "const m=require('./engine/orchestrator/dist/dispatch/intent-classifier.js');const r=m.classifyIntentByRules('请帮我 review 一下这段代码');if(r.intent!=='review'||r.source!=='rules'){console.log('意图主判行为漂移:'+JSON.stringify(r));process.exit(1)}" && echo "✅ 三态×两隔离 + 纯函数主判行为判据在位" || { echo "❌ 纪律批缺失"; FAIL=1; }
[ "${FAIL:-0}" = "1" ] && { echo "维度137:FAIL"; exit 1; }; echo "维度137:PASS"
) 2>&1 | tee "/tmp/regress-dim-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim-$$.log" && { rm -f "/tmp/regress-dim-$$.log"; echo "该维度收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim-$$.log"; true
```

#### 144. 审查面一维收口——事件驱动/OTA/上行脱敏/意图通道/demo/退役扫尾 + B 类防复发 + 发版期插件配置/分发不可变/上游钉 + 章二/三/四/五/七/九新审查面（约束导出与证据链外部可验/运行时 should-run 判定链/审计结论失效语义/网络出口治理面/事前授权补环/DSH 插件 npm 首发面；章一 MCP 对外面由 `audit-query.test.ts` 只读断言 + check-wiring-guard 107/107 承接、章六文档面由 check-readme-parity 承接——判据①冗余不另立维）（阶段四 A/B 合流 · 行为面已由 S433–S444 锁 · 对齐 #131/#133 先例 · ③ 段只查单向，本维把 S433–S444 引进 checklist 补双向闭环；发版期四项自 #145 归并——同版收口主题，归并对销净增行）
```bash
(
FAIL=0
# a: S433–S444 引用闭环（场景调用位须全数在位，缺一即红——S440 章十五族锚 G-1 闭环 / S441 章十一发布链锚 G-10 闭环【本版审查面登记时归并入 S440 共壳，断言零删减】/ S442-S444 本版审查增量闭环 / S446 于本版阶段四归并入 S442 共壳，断言零删减）
grep -cE "scenario 43[3-9]|scenario 44[0-8]" playbook/acceptance-test.sh | grep -q "^14$" && echo "✅ S433–S448 十四场景调用位在位（S441 归并入 S440 · S446 归并入 S442 · S445–S448 本版审查增补）" || { echo "❌ S433–S448 场景号缺失"; FAIL=1; }
grep -rq "replayDeadLetter" engine/orchestrator/src/__tests__/events-bus.test.ts && grep -q "event-queue.jsonl" engine/orchestrator/src/events/bus.ts && grep -q "timer.tick" engine/orchestrator/src/events/adapters.ts && echo "✅ 事件总线三面在位" || { echo "❌ 事件总线面缺口"; FAIL=1; } # b: 章一·事件总线三面（重放/落盘/tick 源）
grep -q "平台公钥" engine/daemon/src/ota/upgrade-executor.ts && grep -q "设备注册表" engine/daemon/src/device-registry.ts && echo "✅ 验签三要素披露在位" || { echo "❌ 验签三要素披露缺失"; FAIL=1; } # c: 章四·OTA 验签对称/逐条披露（B1/B2 防复发）
grep -q "holdTaskDispatch" engine/daemon/src/ota/upgrade-policy.ts && grep -q "takeHeldTaskDispatches" engine/daemon/src/ota/upgrade-policy.ts && echo "✅ 双通道在位" || { echo "❌ 任务下发双通道缺口"; FAIL=1; } # d: 章五·任务下发双通道（在线推送 + 离线持有点 + 心跳捎带补收）
grep -q "routeReason" engine/core/src/export/sensitivity-classifier.ts && grep -q "canaryRouteRequest" engine/mcp/src/tools/device-data-push.ts && echo "✅ 三层检测 + 灰度在位" || { echo "❌ 上行管线锚点缺失"; FAIL=1; } # e: 章六·上行管线 L0/L1/L2 逐层降漏 + T9 灰度 hash 分流留痕
grep -q "skipReasons" engine/audit/src/intent-channel.ts && grep -q "inputChannels" engine/audit/src/intent-channel.ts && echo "✅ 意图通道 opt-in + 跳过留痕在位" || { echo "❌ 意图通道 opt-in/第三态黑洞修复缺失"; FAIL=1; } # f: 章七·意图通道 opt-in 无声明零变化 + B17 跳过留痕
grep -q "getDataDir" engine/audit/src/cli/demo.ts && grep -q "speed" engine/audit/src/cli/demo.ts && echo "✅ demo dataDir + speed 判据在位" || { echo "❌ demo dataDir/speed 缺失"; FAIL=1; } # g: 章八·demo 缺省路径 getDataDir 不落家目录（B20）+ --speed fast 判据一致
# h: 发布链两件套（章十一 A16——check-gate-inventory + heavy-gate-receipt）
test -f tools/check/check-gate-inventory.sh && test -f tools/release/heavy-gate-receipt.sh && echo "✅ 发布链两件套在位" || { echo "❌ 发布链两件套缺失"; FAIL=1; }
# i: 退役扫尾（B23——--legacy 拒绝面已在 #137 k 锚，此处只验失败链 lastError 落 health）
grep -q "lastError" engine/daemon/src/cli.ts && echo "✅ 失败链 lastError 在位" || { echo "❌ 失败链零告警回潮（B23）"; FAIL=1; }
# j: 死导出防线（B16/B24——check-unwired-exports --since 模式 + @internal 收窄面）
grep -q "\-\-since" tools/check/check-unwired-exports.sh && grep -q "@internal" engine/orchestrator/src/events/index.ts && echo "✅ 死导出防线双锚在位" || { echo "❌ 死导出防线缺失"; FAIL=1; }
# k: 哑守卫防御（B25——gen-fresh-eyes-draft 守卫双路径：playbook/ 权威源 + FORGE/ 旧位兜底）
grep -q "join(REPO_ROOT, 'playbook', 'fresh-eyes-review.md')" tools/gen/gen-fresh-eyes-draft.mjs && grep -q "FORGE', 'playbook', 'fresh-eyes-review.md'" tools/gen/gen-fresh-eyes-draft.mjs && echo "✅ 对账守卫双路径在位" || { echo "❌ 哑守卫修复回退（路径写死单源）"; FAIL=1; }
# l: 草稿版本串取发版目标版本（B26——显式 --version > 路径内嵌 > SSOT 兜底）
grep -q "resolveDraftVersion" tools/gen/gen-abc-draft.mjs && grep -q "发版目标版本" tools/gen/gen-abc-draft.mjs && echo "✅ 版本串三源解析在位" || { echo "❌ 版本串解析回退（直取 SSOT 标错版）"; FAIL=1; }
# m: SOP 阶段号权威源对齐（B27；B8 行数实测已由 literals.json devlog-demo-line-count 机器对账）
head -1 docs/changelog/releasing/04-review-system.md | grep -q "S4" && echo "✅ SOP 阶段编号权威源对齐" || echo "🟡 SOP 04 锚点漂移人工复核（B27 教训）"
_hit=$(grep -rn "ctx?.config?.plugins?.entries" engine/openclaw-plugins/*/src/index.ts 2>/dev/null | grep -vE '^[^:]+:[0-9]+:\s*(//|\*|/\*)' || true); [ -n "$_hit" ] && { echo "❌ 插件残留 ctx.config 代码读法"; FAIL=1; } || echo "✅ 零 ctx.config 代码读法" # n: 配置唯一读点 api.pluginConfig（ctx 白名单无 config；注释行引用字面量合法）
grep -q "pluginCfg?.projectRoot" engine/openclaw-plugins/sofagent-rollback/src/index.ts && grep -q "pluginCfg?.projectRoot" engine/openclaw-plugins/sofagent-audit/src/index.ts && grep -q "pluginCfg" engine/openclaw-plugins/sofagent-inject/src/index.ts && grep -q "api?.pluginConfig?.reflectHint" engine/openclaw-plugins/sofagent-evolve/src/index.ts && echo "✅ pluginConfig 读点在位" || { echo "❌ pluginConfig 读点缺失"; FAIL=1; } # o: 四款读点
grep -rq -- "--version 1\." engine/openclaw-plugins/*/README.md && { echo "❌ README 发布命令写死版本号"; FAIL=1; } || echo "✅ 发布命令零硬编码版本" # p: ClawHub 版本不可变
grep -q '"@deepseek-ai/dsh-web-app": "0.1.5-rc.2"' engine/orchestrator/package.json && echo "✅ dsh-web-app 钉在位" || { echo "❌ 上游钉缺失"; FAIL=1; } # q: 缺失则全新安装 ETARGET 回潮
# r: 本版审查面登记（章二~章九——约束导出与证据链外部可验 + 运行时 should-run 判定链 + 审计结论失效语义 + 网络出口治理面 + 事前授权补环 + DSH 插件 npm 首发面；行为面由 S442–S448 锁——S445–S448 为 coverage FAIL 补锚：BugFix 五族 / MCP audit 对外面 / README 结构锁 / 发布面 dry-run 对账，断言本体在 acceptance-node-probes.js）
grep -cE "scenario 44[2-8] " playbook/acceptance-test.sh | grep -q "^6$" && echo "✅ 本版审查面（S442–S448）在位（S445 BugFix 五族 / S446 MCP audit 对外面已归并入 S442 共壳 · S447 README 结构锁 / S448 发布面 dry-run 对账）" || { echo "❌ 本版审查面场景缺失"; FAIL=1; }
_p=$(printf '共 23 条规则\n不是第 25 条规则\n不是第 25、26、27 条规则\n24 条规则\n' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{process.stdout.write(s.replace(/第\s*[0-9]+(?:[、，,]\s*[0-9]+)*\s*条/g,""))})' | grep -oE '[0-9]+[[:space:]]*(条|个)[[:space:]]*规则|[0-9]+[[:space:]]*rules' | grep -oE '[0-9]+' | sort -u | tr '\n' ' '); [ "$_p" = "23 24 " ] && echo "✅ 数字抽取器自证通过（真值捕获 + 序数剥离）" || { echo "❌ 数字抽取器自证失败：实测 [$_p]（期望 23 24 ）"; FAIL=1; } # s: 数字抽取器自证（序数剥离既不能吃掉真值、也不能漏剥序数——真 23 必被捕获 /「第 25、26、27 条规则」必不命中）
[ "${FAIL:-0}" = "1" ] && { echo "维度144:FAIL"; exit 1; }; echo "维度144:PASS"
) 2>&1 | tee "/tmp/regress-dim-$$.log"; grep -qE "^[[:space:]]{0,2}❌" "/tmp/regress-dim-$$.log" && { rm -f "/tmp/regress-dim-$$.log"; echo "该维度收口:FAIL"; exit 1; }; rm -f "/tmp/regress-dim-$$.log"; true
```

#### 145. 判定底座三件——规则自测 schema / AuditScope / 判决成对门禁

> [归并记录] 本维度为阶段四新增（A2/A8/A9 吸收）；新增 1 维 + 归并 1 维（维度 9 → 18），净增本块行数由维度 9 释放对销（归并配额 1:1 满足）。

```bash
# 子项 a: 加载期自测 schema 通电性（A2）——坏样例拒载，锚串被删也拒载（防「断言在场恒不触发」）
node engine/audit/dist/rule-loader.js --self-test 2>/dev/null || node -e "const {loadAuditRules}=require('./engine/audit/dist/rule-loader.js')" # 模块可载
grep -c "RuleLoadError" engine/audit/src/rule-loader.ts # 加载期 fail-closed 异常在位
grep -c "examplesExecutable" engine/audit/src/rule-loader.ts # 覆盖边界声明在位（5/25 行为断言）
# 子项 b: AuditScope 唯一构造 + 规则侧零 git 直调（A8）
git grep -n "child_process\|execSync" -- engine/audit/src/rules/ | grep -v "检测\|test" | wc -l # 期望 ≤3（仅检测正则与夹具）
grep -c "createAuditScope" engine/audit/src/rules/assemble.ts # 唯一构造工厂接线
# 子项 c: 判决类成对门禁（A9）——盲区腐化已机器化
node tools/check/check-paired-records.mjs >/dev/null 2>&1; echo $? # 期望 0
grep -c "盲区登记已过时" tools/check/check-paired-records.mjs # 盲区退役检测在位
```
