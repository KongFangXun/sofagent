# 阶段七：审查体系最终确认

---

## 步骤

| # | 步骤 | 验证方式 |
|:--:|------|------|
| 1 | regression-checklist.md 与 fresh-eyes-review.md 状态一致、无遗漏 | 两份文档交叉核对 |
| 2 | **审查体系闭环确认**：regression 维度 → acceptance 场景 → fresh-eyes 5 方向（数字漂移/搬迁残留/叙事不一致/静默失效/假绿假阳性）三者形成闭环 | 对照三份文件确认覆盖链完整 |

> 审查文档自身也会过时——每次发版后审视 `fresh-eyes-review.md` 和 `regression-checklist.md` 的数字、路径、维度是否还有效。`acceptance-test.sh` 的场景数和覆盖范围必须与 changelog 功能点对齐。
