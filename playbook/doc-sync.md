# 文档同步操作手册

> 发版时 changelog 功能点 → 项目文档覆盖检查的操作手册。releasing.md 阶段九（09-publish 步骤五）引用本文件。

### LIMITATIONS 新功能覆盖检查（🔴 fresh-eyes 教训）

LIMITATIONS.md 必须覆盖本版本引入的核心新功能带来的已知局限。fresh-eyes 审查发现 v1.1.7+ 的 5 个新功能（Dream Cycle / sensitivity / USB / knowledge-health / A/B 调度器）在 LIMITATIONS 中零覆盖。

**检查手法**：
1. 读 `docs/changelog/vX.Y.md` 的核心变更，提取每个新功能关键词
2. `grep -c "关键词" LIMITATIONS.md` 确认覆盖
3. 零覆盖的新功能 = 遗漏，需补录对应局限（每条 2-4 句，含风险描述+缓解措施）

### 内容新鲜度检查

版本号更新不代表内容没变质。每次发布前逐项核对：

- [ ] 效果证据表——数据是否包含最新版本？
- [ ] 「vX.Y 不修 / 待修」的局限标注——是否已经修了但标注没动？
- [ ] 「尚无第三方实测数据」「尚无 ≥1 周样本」等事实断言——是否已经变了？
- [ ] README FDE 完成度——是否与交付层数匹配？
- [ ] 🔴 README「当前版本」= 本次 git tag（文档版本号不得领先未打 tag 的版本；v1.1.0 起固化此核对项）
- [ ] 前置依赖表——新增工具是否需要新依赖？
- [ ] 英文版（README.en / EVIDENCE.en）内容是否与中文版同步？
- [ ] COMMUNITY.md 实验状态、contributor 数是否为当前实际状态？
- [ ] 🔴 **序位 / 最值 / 时序量主张复核**——星数、下载量、榜位、排名这类必须带 `@时点`；「首个 / 唯一 / 最快」这类必须先过三条件（见下节「事实主张纪律」）
- [ ] 🔴 **LIMITATIONS 覆盖新功能**（fresh-eyes 教训——文档滞后 P1）：LIMITATIONS.md 必须覆盖近 3 个版本引入的核心新功能。检查方式：
 ```bash
 # 从最近版本 changelog 提取核心功能关键词，逐个 grep LIMITATIONS.md
 NEW_FEATURES="Dream Cycle\|sensitivity\|knowledge-health\|ActionGovernance\|ab-scheduler"
 COV=$(grep -c "$NEW_FEATURES" LIMITATIONS.md || echo 0)
 [ "$COV" -lt 3 ] && echo "⚠️ LIMITATIONS 新功能覆盖不足（$COV 处）" || echo "✅ $COV 处"
 ```
- [ ] 🔴 **evidence 文件存在且测试数一致**（fresh-eyes 教训）：证据文件路径是 `docs/evidence/evidence.md`（单文件，非按版本拆分），测试数由 `check-test-count.sh` 自动校验。检查方式：
 ```bash
 test -f docs/evidence/evidence.md && echo "✅ evidence 文件存在" || echo "❌ evidence 文件缺失"
 bash tools/check/check-test-count.sh # 期望：全绿（CHANGELOG/ROADMAP/LIMITATIONS/evidence.md 声称数 vs 实际值）
 ```

### 事实主张纪律（序位 / 最值 / 时序量）

对外事实类措辞有三种**可被一个反例推翻**的写法，落笔前逐条对照。共同的判据是：**能推翻又无判据支撑的，一律改写**。

**一、序位与最值主张（首个 / 唯一 / 最快 / 最大 / 最强）**

三条件同时满足才可写这类话：① **有可复算的时点判据**——用平台 API 的客观字段（仓建仓时点、release 发布时点、制品上传时点），不靠转述与人说；② **口径单一且写进句子里**（「按 X 口径」）；③ **断言对象是可枚举的封闭集合**（同期同类能全部列名）。

缺任一条 → 降级为**并列原值**：逐源列数字 + 出处 + 口径，**不排名、不拼合出第三写法**。

**不可枚举的最值一律不主张**（「唯一同集同口径」「无人做到」「业界最强」）——反例只要能举出一个即被证伪。改写为可证伪的定量表述（「在 X 口径下 A 六项中五项优于 B，第三项低 0.4」）。

「第 N 家」「第二玩家」同属序位——须给**口径 + 可枚举名单**，否则只写「同期活跃件之一」。

**二、转述外部主张必标「自称」**

引用对方的自我定性（「首个企业级平台」「由自主 agent 建成」）时，写成「**自述**……」，并注明本仓未复算。禁止把对方主张叙述成本仓的结论。

**三、时序量必带引用时点**

星数 / 下载量 / 榜位 / 排名这类**必然随时间变化**的数字，必须写 `@YYYY-MM-DD 实测`。**无时点即视为不成立的论据**——数字会陈旧到失真，而读者无从判断它是现值还是历史值。榜单类还须**同时带榜自身的版本号**（榜会改口径与重排）。

**四、复核实操**

```bash
# ① 扫出全部序位/最值措辞（受跟踪面），逐条过上面的三条件
git grep -nE "(首个|首款|首家|首创|唯一|最快|最强|最大)" -- docs/ playbook/
# ② 扫出无时点的时序数字，逐个补 @时点或标注为历史快照
git grep -nE "[0-9]+(\.[0-9]+)? ?(万星|k stars|万 stars|万下载)" -- docs/ README.md
```

> **三条共同的失效方向**：把「当时的快照」读成「现在的事实」、把「对方的主张」读成「公认的结论」、把「某个口径下的序位」读成「绝对的第一」。三者都会在品类快速迭代时迅速失真。

### 文档同步闭环（D6 闸门 · 详见 releasing.md 索引段）

> 🔴 教训：changelog 写了新功能但项目文档零提及 = 用户不知道有这功能。本步骤与 D3 对称——D3 做「changelog→验收场景」对照，本步骤做「changelog→项目文档」对照。

**Step A — 从 D6 清单提取功能关键词**

开发 session 在 D6 已产出「功能点 → 应在哪个文档出现」对照表。如果开发 session 标了「待补」，此时必须补上。

```bash
# 从本版本 changelog 提取功能关键词
# 读 docs/changelog/vX.Y.md 的「核心变更/交付」章节
# 列出每条功能 + 其应在的项目文档（按归属原则）
```

**归属原则**：

| 功能类型 | 权威文档（写详细机制 + 配置方法） | 其他文档（一句话 + 链接引用） |
|---------|------|------|
| 审计规则/约束层内部机制 | DEVELOPMENT.md | HANDBOOK 速览表 + ARCHITECTURE 引用 |
| FDE 企业操作流程 | FDE/GUIDE.md | README 企业段 + HANDBOOK 速览表 |
| 编排/调度/运行时 | ARCHITECTURE.md + DEVELOPMENT.md | README 引擎段引用 |
| 理念/定位叙事 | PHILOSOPHY.md | README 开篇引用 |
| 安全机制 | SECURITY.md | docs/ARCHITECTURE.md 引用 |
| 用户日常使用 | HANDBOOK.md | README 快速上手段引用 |

**Step B — 逐条 grep 验证覆盖**

```bash
# 对每个功能关键词，grep 对应文档确认有提及
# 例子：Dream Cycle 应在 DEVELOPMENT.md 有详细说明，HANDBOOK 有速览表条目
grep -l "Dream Cycle" docs/HANDBOOK.md docs/DEVELOPMENT.md docs/ARCHITECTURE.md
# 期望：权威文档命中 + 引用文档命中
```

**Step C — 补齐零覆盖功能点**

对 Step B 发现零覆盖的功能点，按归属原则写入对应文档：
- **权威文档**：写详细机制 + 配置方法 + 版本标注（如「v1.1.7+」）
- **引用文档**：一句话说明 + 版本标注 + 链接到权威文档
- **不重复展开**：同一个功能点只在权威文档写一次详细内容，其他文档只引用

**🔴 Step D — 覆盖率闭环判定**

对 changelog 里每条新功能，判定以下三项：

| 判定项 | 要求 | 不满足 |
|--------|------|--------|
| ① 权威文档命中 | 功能点在归属原则指定的权威文档中有详细说明 | P0（用户无处查阅） |
| ② 引用文档命中 | 功能点在 HANDBOOK 速览表 / README 相关段有引用（一句话 + 链接） | P1（入口缺失） |
| ③ 无重复展开 | 同一功能详细内容只出现在一个权威文档，其他文档只引用不复制 | P2（维护负担） |

> **判定后**：①② 不满足 → 补齐才能进阶段九；③ 不满足 → 标注遗留下版本瘦身。与 D3 对称——两闭环确保 changelog 每条新功能既有测试守护也有文档说明。
