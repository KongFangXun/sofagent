# 文档同步操作手册

> 发版时 changelog 功能点 → 项目文档覆盖检查的操作手册。releasing.md 阶段八引用本文件。

### LIMITATIONS 新功能覆盖检查（🔴 F-11 / fresh-eyes F-05 教训）

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
- [ ] 🔴 **LIMITATIONS 覆盖新功能**（v1.1.9 fresh-eyes 教训——文档滞后 P1）：LIMITATIONS.md 必须覆盖近 3 个版本引入的核心新功能。检查方式：
  ```bash
  # 从最近版本 changelog 提取核心功能关键词，逐个 grep LIMITATIONS.md
  NEW_FEATURES="Dream Cycle\|sensitivity\|knowledge-health\|ActionGovernance\|ab-scheduler"
  COV=$(grep -c "$NEW_FEATURES" LIMITATIONS.md || echo 0)
  [ "$COV" -lt 3 ] && echo "⚠️ LIMITATIONS 新功能覆盖不足（$COV 处）" || echo "✅ $COV 处"
  ```
- [ ] 🔴 **evidence 文件存在且测试数一致**（v1.1.9 fresh-eyes 教训）：证据文件路径是 `docs/evidence/evidence.md`（单文件，非按版本拆分），测试数由 `check-test-count.sh` 自动校验。检查方式：
  ```bash
  test -f docs/evidence/evidence.md && echo "✅ evidence 文件存在" || echo "❌ evidence 文件缺失"
  bash tools/check-test-count.sh   # 期望：全绿（CHANGELOG/ROADMAP/LIMITATIONS/evidence.md 声称数 vs 实际值）
  ```

### 文档同步闭环（v1.1.9 D6 闸门 · 详见 releasing.md 索引段）

> 🔴 v1.1.9 教训：changelog 写了新功能但项目文档零提及 = 用户不知道有这功能。本步骤与 D3 对称——D3 做「changelog→验收场景」对照，本步骤做「changelog→项目文档」对照。

**Step A — 从 D6 清单提取功能关键词**

开发 session 在 D6 已产出「功能点 → 应在哪个文档出现」对照表。如果开发 session 标了「待补」，此时必须补上。

```bash
# 从本版本 changelog 提取功能关键词
# 读 docs/changelog/vX.Y.md 的「核心变更/交付」章节
# 列出每条功能 + 其应在的项目文档（按归属原则）
```

**归属原则**（v1.1.9 定稿）：

| 功能类型 | 权威文档（写详细机制 + 配置方法） | 其他文档（一句话 + 链接引用） |
|---------|------|------|
| 审计规则/引擎内部机制 | DEVELOPMENT.md | HANDBOOK 速览表 + ARCHITECTURE 引用 |
| FDE 企业操作流程 | FDE/GUIDE.md | README 企业段 + HANDBOOK 速览表 |
| 编排/调度/运行时 | ARCHITECTURE.md + DEVELOPMENT.md | README 引擎段引用 |
| 理念/定位叙事 | PHILOSOPHY.md | README 开篇引用 |
| 安全机制 | SECURITY.md | FDE/ARCHITECTURE 引用 |
| 用户日常使用 | HANDBOOK.md | README 快速上手段引用 |
| 开发循环工具 | FORGE/archive/self-evolution-design.md | DEVELOPMENT 引用 |

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
