# 审查体系运作指南

> 本文档说明 sofagent 审查体系的**运作原理**——四份审查文档各自什么逻辑、怎么从每轮开发中提取新发现、防膨胀怎么控。
> 发版时的**操作步骤**见 [releasing.md](../changelog/releasing.md) 阶段三/四。

---

## 四份文档，四套逻辑

| 文档 | 性质 | 加法？ | 用途 |
|------|------|:------:|------|
| `regression-checklist.md` | 精确清单（人工巡检） | ✅ 加法 | 每发现一个问题加一条维度，需要人工判断上下文的检查项 |
| `acceptance-test.sh` | 自动化验证（机器跑） | ✅ 加法 | 能用 CLI/grep/bash 自动检出的场景，编号递增 |
| `check-version.sh` | 结构性门禁（机器跑） | ✅ 加法 | 新增的结构性检查点（新文件/新字段/新配置/新对外声称数字） |
| `fresh-eyes-review.md` | 留白式直觉审查（人工） | ❌ 校准 | 凭直觉发现、无法精确化的系统性问题 |

**核心区分**：前三份是「加法」——每轮只增不减，膨胀靠防膨胀瘦身控制。第四份是「校准」——不加检查项，只调整视角和提示词，保持留白式直觉审查的特质。

---

## A/B/C 三类清单：从哪里提取新发现

每轮开发完成后（releasing.md 阶段四），从以下 5 个来源提取新发现，归入 A/B/C 三类：

### 5 个来源

| 来源 | 内容 |
|------|------|
| ① fresh-eyes-loop 审查报告 | 每个 P0/P1 finding 对应的问题模式 |
| ② BugFix 交付清单 | 每个修复项是否已有 regression-checklist 覆盖 |
| ③ 新功能交付清单 | 每个新交付引入的新代码路径/API/行为契约/对外声称 |
| ④ fresh-eyes 复审报告 | 预料外盲区 |
| ⑤ CHANGELOG 开发日志 | 交叉验证交付列表每项都有审查内容 |

### 三类清单

| 类别 | 含义 | 分发到 |
|------|------|--------|
| **A 类：新功能审查面** | 新功能/新代码路径/API/行为契约在四份文档中有没有检查面？ | regression-checklist + acceptance-test + check-version.sh |
| **B 类：Bug 防回归** | 下次怎么防止回退？ | regression-checklist + acceptance-test |
| **C 类：预料外盲区** | 凭直觉发现、无法精确化的系统性问题 | fresh-eyes-review |

---

## 两个关键检查

### 检查 1：新功能审查面覆盖率

打开 changelog 交付列表，逐条问：
- 这个交付引入的新代码路径/API/行为契约，在 regression-checklist 里有对应的检查维度吗？
- 在 acceptance-test 里有对应的验证场景吗？
- 新增的对外声称数字，check-version.sh 能对账吗？

有遗漏 → 必须补上。

### 检查 2：问题模式系统性提取

手里有本轮所有审查报告（fresh-eyes findings / release-gate verdict / 人工审查），逐份过一遍，每个真实发现（非误报）问三个问题：

1. 这个问题属于什么**模式**？（如"同一属性多处声明漂移""检查命令依赖具体措辞""架构迁移后检查命令没跟上"）
2. 这个模式在四份文档里有对应的检查面吗？→ 没有就是新维度/场景/视角
3. 如果是"审查文档自身的检查命令过期"（如 grep 已不存在的措辞、查已迁移的路径）→ 这是**元模式**，需修旧检查命令 + 加元检查维度

**禁止只做功能覆盖检查不做模式提取**——功能覆盖只防"新功能没测"，模式提取防"同样的坑踩第二次"。

---

## 防膨胀瘦身

四份文档持续加法会膨胀。每轮（阶段四步骤 4-6）执行瘦身：

### 行数警戒线

> 数值以 `regression-checklist.md` 头部声明为**唯一 SSOT**（check-review-system.sh 动态提取校验），本表不写死——v1.4.0 收口：多处声明必然漂移（本指南曾落后实际值两个版本）。历史上调记录见 checklist 头部警戒线段。

| 文档 | 上限 | 超标怎么办 |
|------|:----:|-----------|
| regression-checklist.md | 见 checklist 头部 SSOT | **超标靠归并不删内容**（v1.3.5 check-version 四盲区归并消化等，演进记录见 SSOT） |
| acceptance-test.sh | 见 checklist 头部 SSOT | 同上（v1.3.5 注释/装饰框/冗余分组瘦身消化等） |
| fresh-eyes-review.md | 见 04-review-system.md 步骤五自检 | 同上（v1.3.3 从 370 上调，v1.4.0 至 410） |

### 瘦身三步

1. **移除已被工具覆盖的维度**——某维度如果 check-version.sh / acceptance-test.sh 已全自动检出，从 regression-checklist 移除（人工清单不该重复机器能查的）
2. **归并重叠维度**——两个维度查的是同一个问题的不同表述 → 合并
3. **抽公共函数**——acceptance-test.sh 里重复的 bash 代码段 → 抽成函数

### 自验证

瘦身后跑自校验脚本确认没误删：
- regression-checklist 的 grep 命令仍能匹配
- acceptance-test 的场景编号无跳号
- fresh-eyes-review 的视角数标注与实际一致

---

## 环境注意事项（README 迁入 · 2026-08-29）

`npm test` 直跑全量时，个别包（mcp/audit）在低内存机器可能出现超时闪红——单独重跑该包即绿，属环境并发问题，非产品缺陷。遇 audit 包偶发「首跑无汇总」时，先清缓存再跑对照组：`rm -rf engine/audit/node_modules/.vitest`（2026-08-29 三轮审查实证 1 次、复验未复现，疑似 vitest 缓存竞争；详见 test-count.sh 头部追因登记）。测试总数以 `tools/check/test-count.sh` 判定为准（flaky 复跑机制见脚本内 FLAKY_PKGS 容错设计）。

---

## fresh-eyes-review 校准（C 类专用）

fresh-eyes-review 是**留白式直觉审查**——不加检查项，只调整视角。

C 类（预料外盲区）按决策树处理：

| C 类发现类型 | 怎么处理 |
|-------------|---------|
| **新视角**（从没看过的角度） | 加到 fresh-eyes-review 的视角列表 |
| **校准现有视角**（已有视角但提示词不够锐） | 调整该视角的提示词，让它更可能发现这类问题 |
| **历史教训**（以前踩过的坑的变体） | 加到该视角的"警惕"提示里，但不写成精确检查项 |

**不要往 fresh-eyes-review 里加精确检查项**——加了它就退化成第二个 regression-checklist，失去直觉审查的价值。
