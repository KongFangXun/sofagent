# 阶段五：审查体系合并更新

> **目的**：从本轮所有产出物中提取新发现，系统性升级四份审查文档。
>
> 审查体系运作原理（A/B/C 清单 / 模式提取 / 防膨胀 / 校准逻辑）见 [审查体系指南](../../guides/review-system.md)。

---

## 步骤

| # | 步骤 | 产物 |
|:--:|------|------|
| 1 | **来源提取**：过 5 个来源（fresh-eyes 报告 / BugFix 清单 / 新功能清单 / 复审报告 / CHANGELOG），产出 A/B/C 三类清单 + 问题模式清单。关键：新功能审查面零遗漏 + 每个真实发现都有模式归类 | A/B/C 清单 |
| 2 | **四份文档分发**：A+B 类 → regression-checklist + acceptance-test + check-version.sh（加法）；C 类 → fresh-eyes-review（校准非加法） | 四份文档更新 |
| 3 | **覆盖率确认**：grep 确认 CHANGELOG 每个交付关键词在审查文档中至少出现一次 | 零遗漏 |
| 4 | **防膨胀瘦身**：移除已被工具覆盖的维度 / 归并重叠维度 / 抽公共函数。行数警戒线：checklist≤1350（v1.3.2 从 1250 上调）/ acceptance≤2250（v1.3.2 从 2050 上调）/ fresh-eyes≤370。**超标上调 LIMIT 不删内容** | 自校验脚本全 PASS |
| 5 | **fresh-eyes-review 校准**：C 类走决策树（新视角 / 校准视角 / 历史教训），不往留白式审查里加精确检查项 | 校准完成 + 风格守护自检全 PASS |
| 6 | **README 新能力段人工语义交叉核对**：逐项对照 README.md/README.en.md「vX.Y 新能力」段与 CHANGELOG/changelog/vX.Y/vX.Y.Z.md 的交付清单——确保新能力段列出的每项都是**本版本真实交付**（不是上版本内容残留），且本版本所有核心交付**均已出现在新能力段**。check-version.sh 只校验版本号字面一致，无法检测语义错配（如 v1.3.2 段写了 v1.3.1 内容）。此项必须人工执行。 | README 新能力段与 changelog 逐项对齐 |

---

## fresh-eyes-review 风格守护自检（步骤 5 必跑）

```bash
# 1. 行数守护：不超过 370 行
WC=$(wc -l < FORGE/playbook/fresh-eyes-review.md)
[ "$WC" -gt 370 ] && echo "🔴 行数膨胀（$WC > 370）——检查是否在加精确检查项" || echo "✅ 行数正常（$WC）"

# 2. 反清单化守护：不应出现精确检查命令（fresh-eyes-review 是留白式直觉审查，不是 checklist）
CMD_COUNT=$(grep -cE '(grep|bash|npm|wc -l|test -)' FORGE/playbook/fresh-eyes-review.md || echo 0)
[ "$CMD_COUNT" -gt 5 ] && echo "🟡 命令引用偏多（$CMD_COUNT 处）——确认都是举例而非检查项" || echo "✅ 命令引用适度（$CMD_COUNT 处）"

# 3. 视角数守护：当前 12 个常规视角，新增需谨慎
VIEWS=$(grep -c '^### ' FORGE/playbook/fresh-eyes-review.md)
[ "$VIEWS" -ne 12 ] && echo "🟡 视角数变化（当前 $VIEWS，基线 12）——确认是刻意调整" || echo "✅ 视角数稳定（$VIEWS）"
```

> 💡 **什么时候 `git diff` 显示无变更也是正常的**：如果所有预料外发现都属于"可精确描述的具体问题模式"，它们全部进了 regression-checklist，fresh-eyes-review 本版本无需更新。零变更 = 审查体系稳定，不是遗漏。
