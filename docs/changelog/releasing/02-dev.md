# 阶段二：开发

---

## 步骤

| # | 步骤 | 产物 |
|:--:|------|------|
| 一 | 先修阶段一的 BugFix 批次（P0 先于一切新功能），再做新功能 | 代码 + 随修随记的回归维度 |
| 二 | changelog 作为活文档随改随记（定稿在阶段八） | 活文档 |

---

## 交付物清单闸门

开发 session 交付给发版 session 时，必须过 D1-D6 闸门。缺任一项 = 交付不完整。

| 闸门 | 检查项 |
|:--:|------|
| D1 | 实现纪要表（changelog 开头的交付→落点→说明表） |
| D2 | 测试数一致（changelog 声称数 = 实际 `npm test` 数） |
| D3 | changelog 章节序（新功能在前、BugFix 在后） |
| D4 | 版本号状态（changelog 头部标注当前版本号） |
| D5 | 文档日期（changelog 头部日期已更新） |
| D6 | 项目文档同步清单（changelog 每个功能点 → 对应文档有覆盖） |

---

## 开发期间纪律

改了什么，必须同步更新什么——否则发版时才发现遗漏：

| 改了什么 | 必须同步更新 |
|---------|------------|
| 审计规则（engine/audit/src/rules/） | 对应测试 + acceptance-test.sh 场景 + regression-checklist 维度 |
| MCP tool（engine/mcp/src/tools/） | SKILL.md 工具速查清单 + check-version.sh 工具数校验 |
| 审计维度数 / 测试数 / 包数 | README + CHANGELOG + ROADMAP + LIMITATIONS + evidence 数字声称 |
| bump-version / check-version / pre-push-check 脚本 | 三脚本覆盖范围一致性（check 能查的 bump 必须能改） |
| CI workflow（.github/workflows/） | 本地 pre-push-check 覆盖范围与 CI 对齐 |
