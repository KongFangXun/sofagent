# 阶段八：开发日志定稿 + 文档收尾

---

## 开发日志标准结构

定稿时照抄以下骨架（开发期间作为活文档持续追加，此时归位）：

```markdown
# vX.Y.Z 开发日志 — {新功能一句话} + {BugFix 概要}

> 状态：已发布（tag vX.Y.Z）· 作者 · 日期
> 前置依赖：{上一版本能力}
> 开发完成快照：{交付数 + 测试数 + 版本 bump 状态}

## 实现纪要
| 交付 | 落点 | 说明 |

## 背景
{两行概述：先新功能、后 BugFix}

## 交付一：{新功能A}
### 问题诊断 / 实现 / 测试 / 明确不做（按需）
### 发布检查清单

## BugFix 批次（阶段一 · {上一版} 审查 N 项）
### 问题模式 / P0 清单 / 执行顺序 / 发布检查清单

## 发布检查清单（汇总）
```

**强制项**：文件命名三段式 `vX.Y.Z.md` · 实现纪要表不可省 · BugFix 独立章置后不编号为零 · 测试数与 CHANGELOG/ROADMAP/LIMITATIONS/evidence 一致。

---

## 操作步骤

| # | 步骤 | 验证方式 |
|:--:|------|------|
| 1 | **开发日志定稿**：按上方骨架归位，发布检查清单全部打勾 | 结构完整 + 清单打勾 |
| 2 | **CHANGELOG 索引**：根 CHANGELOG.md 新增本版本索引条目（目录非详情） | 索引条目存在 |
| 3 | **发版日期同步**（详见下方脚本） | `bash tools/check-version.sh` 全绿 |
| 4 | **测试数一致性**：`bash tools/check-test-count.sh --quiet` 确认声称数与实际一致。**禁止手动报数——必须跑脚本** | 全绿 |
| 5 | **ROADMAP 五步**：「现在在哪」叙事 + 开发日志链接 + 迭代历程表 + 版本号 + 发版日期。⚠️ **未来版本的 changelog 引用一律用纯文本，不用 markdown 链接**（指向不存在的文件 = 死链）。已发版的才用链接 | ROADMAP 更新 |
| 6 | **全项目版本号扫描**：所有 package.json + 文档头版本号一致 | check-version.sh 全绿 |
| 7 | **文档同步闭环**：changelog 每个功能点 → 对应项目文档有覆盖（详见下方按需文档表） | D6 清单零遗漏 |
| 8 | **changelog 文件命名一致性**：`ls docs/changelog/**/*.md \| grep -v -E 'v[0-9]+\.[0-9]+\.[0-9]+\.md'` 期望无输出（全三段式） | 无输出 |

---

## 发版日期同步脚本（步骤 3）

```bash
TODAY=$(date -u +%Y-%m-%d)

# 1. 找到 bump 写入的旧日期（从 package.json 的首次提交日期推断）
OLD_DATE=$(git log --format="%ci" -1 --diff-filter=A -- package.json | grep -oE "[0-9]{4}-[0-9]{2}-[0-9]{2}" | head -1)
# 如果找不到，手动指定：OLD_DATE="2026-08-09"

# 2. check-version.sh 的 EXPECTED_DOC_DATE 改为今天
sed -i '' "s/EXPECTED_DOC_DATE=\"[0-9-]*\"/EXPECTED_DOC_DATE=\"$TODAY\"/" tools/check-version.sh

# 3. 批量更新文档头日期（旧日期 → 今天，只改 > vX.Y 开头的文档头行）
grep -rl "^> v[0-9].*· ${OLD_DATE}" --include="*.md" . \
  | grep -v "docs/changelog/" \
  | grep -v "docs/evidence/" \
  | xargs sed -i '' "s/· ${OLD_DATE}/· ${TODAY}/g" 2>/dev/null || true

# 4. 验证
bash tools/check-version.sh   # 期望：日期一致项全绿
```

> bump 详细指南（13 类位置 + package-lock 同步 + npm 铁律）见 [FORGE/playbook/version-bump.md](../../../FORGE/playbook/version-bump.md)。
> 文档同步详细指南（LIMITATIONS 覆盖 + 归属原则 + D6 闭环）见 [FORGE/playbook/doc-sync.md](../../../FORGE/playbook/doc-sync.md)。

---

## 按需文档

| 文档 | 什么时候更新 |
|------|------|
| `README.md` | FDE 完成度变化、效果证据更新、**新功能入口（新增能力段 + changelog 链接）** · **新能力段只留最新版本——旧版直接删不堆叠** · 每版开发完成后顺手优化 README 表达/结构/视觉 |
| `README.en.md` | **与 README.md 同步**——badge 自动改，但新能力段 + 测试数 + 规则数需手动同步（英文版易漏）· 同样只留最新版本新能力段 |
| `ARCHITECTURE.md` | 架构决策或设计思路有变更 · 13/12 包口径一致性（13=npm 发布总数，12=有 test script） |
| `DEVELOPMENT.md` | 开发流程有变更 · 正文测试数声称同步（grep `XX 测试`，bump 后数字会过时） |
| `LIMITATIONS.md` | 新发现的局限或旧局限被消除 · 已知问题标注修复版本落点（写具体 v1.3.x，不写「未来版本」） |
| `HANDBOOK.md` | 用户使用习惯、FAQ 有变化 · 「已经能替你干的事」版本号 + 新能力列表 · 「现在还干不了的事」移除本版交付项 |
| `ROADMAP.md` | 五步更新（见上） |
| `CHANGELOG.md` | 新增版本索引条目（版本历史唯一权威入口） |

---

## 文档日期检查

bump-version.sh 只改版本号**不改日期**。每次 bump 后必须检查文档头日期：

```bash
DATE="$(date +%Y-%m-%d)"
grep -rn "$DATE" *.md docs/archive/design/*.md | grep -v "docs/changelog/" | grep -v "docs/evidence/"
# 期望：主要文档都匹配到当天日期
# 排除 changelog 历史（里面记的是发版当天日期，不该改）和 evidence 案例日期
```

## changelog 文件命名一致性

```bash
# 检查 docs/changelog/ 下所有文件名都是三段式 vX.Y.Z.md
ls docs/changelog/*.md | grep -v -E 'v[0-9]+\.[0-9]+\.[0-9]+\.md'
# 期望：无输出（所有文件都是三段式）
```
