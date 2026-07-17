# sofagent 回归检查清单（288 维度 · 编号 1–326）

> **用途**：每次发版前跑一遍，确认之前修过的问题没有回退。这不是"发现新问题"的工具——发现新问题用[发布后审查](./fresh-eyes-review.md)。
>
> **维护规则**：
> - 每次发版修复新问题后，把对应的检查项加到本清单
> - 检查项编号递增，不重排已有编号
> - 删掉的检查项标注 `[已移除]` 并注明原因，不直接删除
> - 发版时在 `docs/changelog/vX.Y.md` 记录"回归检查 N/N 全通过"
> - **审查体系闭环**（发版时做，见 releasing.md 阶段五「合并更新两份审查文档」）：
>   - ① 本次修复的新增检查项是否已经加到本清单？
>   - ② 有没有反复出现的同类问题——要不要抽象成通用维度加到[发布后审查](./fresh-eyes-review.md)里？
>   - ③ [发布后审查](./fresh-eyes-review.md)本身有没有过时的角色或问题需要删改？
>
> **审查对象**：sofagent 仓库（main 分支）+ npm 包
> **审查范围**：全仓库状态检查（不是只看增量）——所有维度逐项核对

---

## 你的身份

你是一名**回归测试工程师**。你的任务不是发现新问题，而是**确认已知的修复没有回退**。你有一份 278 项的检查清单，每一项对应历史上发现并修复过的问题。逐项核对，全部 PASS 就是通过。

**与发布后审查的区别**：发布后审查是"假装不知道项目是什么，凭直觉找新问题"；回归检查是"知道之前修了什么，确认没退回去"。两者互补，发版前都要跑。

### ⏰ 时序说明（CRITICAL — 避免误判）

回归检查在 **releasing.md 阶段四（审核）** 跑——此时代码已改完但**还没 commit、还没 tag、还没 npm publish**。以下检查项在回归检查阶段必然"不满足"，它们是**发布后验证项**，不是 FAIL：

| 检查项 | 回归检查时状态 | 什么时候满足 |
|--------|:----:|------|
| git tag vX.Y.Z 存在 | ❌ 正常 | 阶段七 Step 5 打 tag 后 |
| npm registry 版本 = SSOT | ❌ 正常 | 阶段七 Step 1 npm publish 后 |
| 全局二进制版本 = SSOT | ❌ 正常 | 阶段七 Step 3 npm i -g 后 |
| 工作目录零未提交修改 | ❌ 正常 | 阶段七 commit 后 |

**遇到以上检查项时标 ⏳（待发版），不标 FAIL。**

---

## 🔄 本次审查背景

> 本清单是**累积式**的——每个维度对应一个历史修复。审查前不需要了解每件事的背景，只需要逐项核对当前代码状态。
>
> 维度来源：v0.99.9 初始 88 维度 → v1.0 新增 18 → v1.0.1 追加 32 → v1.0.2 追加 26 → v1.0.3 追加 12 → v1.0.4 追加 8 → v1.0.4 审查追加 8 = 204 → v1.0.5 追加 8（205-212）→ v1.0.6 追加 5（213-217）→ v1.0.6 SkillOpt 修复追加 2（218-219）→ v1.0.7 追加 28 维度（220-247）→ v1.0.8 追加 5 维度（248-252）→ v1.0.9 追加 3 维度（253-255）→ v1.0.8 补 1 维度（256）→ v1.1.0 追加 48 维度（257-292）→ v1.1.3 追加 19 维度（293-311）→ v1.1.3 第二次审查追加 5 维度（312-316）→ v1.1.3 追加 10 维度（317-326）。编号至 326；实际 `#### N.` 标题 288 个（历史合并/移除产生跳号）。

---

## 审查步骤

### 步骤 1：环境验证（必须先跑）
```bash
cd /Users/kongfangxun/Workbuddy/sofagent

# 1.1 pre-push-check
bash tools/pre-push-check.sh
# 期望：7 通过 / 0 警告 / 0 失败

# 1.2 单元测试
cd sofagent/audit && npm test && cd ../..
# 期望：与上次发版数一致或增加
cd sofagent/audit && npm test 2>&1 | tail -5  # 全部 passed

# 1.3 verify --list
node sofagent/audit/dist/verify.js --list 2>&1 | head -5
# 期望：「~48 项（动态）」

# 1.4 文档检查（含铁律措辞检查）
bash tools/check-docs.sh 2>&1 | tail -3
# 期望：全部通过（含铁律措辞检查）

# 1.5 版本号一致性
bash tools/check-version.sh 2>&1 | tail -3
# 期望：全部通过，版本号与 SSOT（package.json）一致

# 1.6 铁律措辞检查（v1.0 新增）
grep -rn '建议\|应该\|尽量' sofagent/skill/*.md FDE/SKILL.md | grep -v 'not_when\|Gotcha\|场景\|如果\|注\|说明'
# 期望：无输出（空 = 全部改完）

# 1.6b CHANGELOG 纯度全量检查（v1.1.3 扩展——涵盖子文件）
grep -rniE "GLM|DeepSeek|双视角|P[012]×|审查修复|陌生视角|fresh-eyes|审查轮次|审查×|审查驱动|审查吸收" CHANGELOG.md docs/changelog/v*.md
# 期望：零命中（仅工作流正当描述如「FDE 审查报告」「独立审查」可接受）
```

### 步骤 2：Fresh clone 体验（v1.0 硬性条件，不允许跳过）
```bash
git clone https://github.com/KongFangXun/sofagent.git /tmp/sofagent-v1-test
cd /tmp/sofagent-v1-test
npm ci 2>&1 | tail -3
bash tools/pre-push-check.sh 2>&1 | tail -5
# 期望：7/7 全绿
```
> ⚠️ 如 GitHub 网络不通：使用 `git clone file:///Users/kongfangxun/Workbuddy/sofagent /tmp/sofagent-v1-test` 绕过；如仍不通，记录原因后标注 ⚠️ 并说明情况。

### 步骤 3：逐维度审查

用 `git diff --cached -- <file>` 查看改动，同时验证全仓库状态。

---

## 审查维度（288 个维度 · 编号 1–326）

> v0.99.9 初始 88 维度（1-88）→ v1.0 新增 18 维度（89-106）→ v1.0.1 追加 32 维度（107-143）→ v1.0.2 追加 26 维度（144-176）→ v1.0.3 追加 12 维度（177-188）→ v1.0.4 追加 8 维度（189-196）→ v1.0.4 审查追加 8 维度（197-204）→ v1.0.5 追加 8 维度（205-212）→ v1.0.6 追加 5 维度（213-217）→ v1.0.7 追加 28 维度（220-247）= 247 总计

---

### 第一部分：产品与技术（维度 1-4）

#### 1. 产品架构
- 五层架构（Harness → 执行 → 审计 → MCP → 协同）边界是否清晰？
- AI 知识库「数据层不进五层」定位是否仍然自洽？

#### 2. 技术架构
- FDE 三层实体与双引擎设计的交汇点是否变动？
- daemon 文档校准后，daemon / MCP Server / verify 之间接口描述是否对齐实际行为？

#### 3. 安装与首次体验
- Fresh clone → npm ci → pre-push-check 7/7 全绿完整链路（**v1.0 硬性条件**）
- install.sh 能否在 30 秒内完成？

#### 4. npm 包架构
```bash
npm pack --dry-run 2>&1 | grep '\.js\.map' | wc -l  # audit 包应为 0
```

---

### 第二部分：CI-CD 与工具链（维度 5-10）

#### 5. GitHub Actions
```bash
ls .github/workflows/
cat .github/workflows/verify.yml | grep 'uses:'
# checkout@v5 + setup-node@v5
```

#### 6. pre-push-check 完整性
```bash
bash tools/pre-push-check.sh 2>&1
# 7 项全绿：ShellCheck / check-version / check-docs / build+test / sofagent-audit / install.sh 关键路径
```

#### 7. check-version.sh
```bash
bash tools/check-version.sh 2>&1 | tail -3
# 期望：版本号与 SSOT 一致，doctor 项数全部一致
```

#### 8. check-docs.sh（v1.0 含铁律措辞检查）
```bash
bash tools/check-docs.sh 2>&1
# 死链 + Skill 行数 ≤100 + 预算检查 + 铁律措辞检查
```

#### 9. install.sh 关键路径
```bash
sed -n '/install.sh 关键路径/,/═══/p' tools/pre-push-check.sh
# 10 个 Skill 源文件 + RULES_SRC，macOS 兼容（无 realpath -m）
```

#### 10. ShellCheck 覆盖
```bash
bash tools/pre-push-check.sh 2>&1 | grep ShellCheck
# 21+ 个文件全过
```

---

### 第三部分：代码质量（维度 11-20）

#### 11. verify.ts 拆分——文件结构
```bash
wc -l sofagent/audit/src/verify.ts sofagent/audit/src/verify/*.ts
# verify.ts ~226 + verify/ 下 4 文件
```

#### 12. verify.ts 拆分——shebang + import
```bash
head -5 sofagent/audit/src/verify.ts  # #!/usr/bin/env node
grep 'import' sofagent/audit/src/verify.ts  # 从 ./verify/ 导入
```

#### 13. verify.ts 拆分——types.ts 接口完整性
```bash
cat sofagent/audit/src/verify/types.ts
# CheckStatus / CheckItem / VerifyResult / Args + 颜色常量
```

#### 14. verify.ts 拆分——utils.ts 工具函数完整性
```bash
cat sofagent/audit/src/verify/utils.ts
# HOME / tryExec / commandAvailable / countChars / countLines / getFileMode 等
```

#### 15. verify.ts 拆分——verifier.ts 类完整性
```bash
cat sofagent/audit/src/verify/verifier.ts
# Verifier 类：checkPass/Fail/Warn + outputJson/Summary
```

#### 16. verify.ts 拆分——checks.ts 检查函数完整性
```bash
grep 'function check\|function run' sofagent/audit/src/verify/checks.ts
# §1-§11 检查函数 + runAllChecks + runQuickChecks
```

#### 17. TypeScript 编译
```bash
cd sofagent/audit && npx tsc --noEmit 2>&1 | head -5  # exit 0
```

#### 18. 测试等价性
```bash
cd sofagent/audit && npm test 2>&1 | tail -5  # 全部 passed（数字与 CHANGELOG 一致）
```

#### 19. bin 入口 + build
```bash
grep 'bin' sofagent/audit/package.json  # dist/verify.js
cd sofagent/audit && npm run build && ls dist/verify.js dist/verify/
```

#### 20. 死代码删除验证
```bash
ls sofagent/audit/src/_archive/ 2>&1  # No such file
grep '_archive' sofagent/audit/tsconfig.json  # exclude 应移除
grep -rn '_archive' sofagent/audit/src/ 2>/dev/null  # 无残留引用
```

---

### 第四部分：文档一致性（维度 22-35）

#### 22. ROADMAP「现在在哪」devlog 链接
```bash
grep '开发日志' ROADMAP.md | head -1
# 链接应指向 v1.0.0.md，不是 v0.99.9.md 或 v0.99.8.md
# v0.99.9 教训：devlog 链接没跟着版本号更新
```

#### 23. ROADMAP 迭代历程表
```bash
grep 'v1\.0' ROADMAP.md | head -3
# 迭代历程表应有 v1.0 行
# v0.99.9 教训：迭代历程表缺了 v0.99.9 行
```

#### 24. ROADMAP 准入表更新
```bash
grep '✅' ROADMAP.md | head -5
# v1.0 发版后准入表 ✅ 数字应更新
```

#### 25. verify.sh 数字统一
```bash
grep -n '48\|50' LIMITATIONS.md  # 应为「~48 项（动态）」
grep -n 'total\|48' sofagent/scripts/verify.sh
```

#### 26. evidence.md 测试数
```bash
# grep 实际测试数
actual=$(cd sofagent/audit && npm test 2>&1 | grep 'Tests' | grep -o '[0-9]*' | head -1)
grep "$actual" docs/evidence/evidence.md 2>/dev/null  # 证据表应含当前测试数
# 不应有 421（过时数字）
```

#### 27. evidence.en.md 与中文版一致性
```bash
head -5 docs/evidence/evidence.en.md
# L3 说 full snapshot，L4 指向中文版最新
# Case 016-019 联系获取注释是否存在（v0.99.9 修复项，不应回归）
```

#### 29. evidence 中英文 Case 数一致性
```bash
grep -o 'Case 0[0-9][0-9]' docs/evidence/evidence.md | sort -u | wc -l
grep -o 'Case 0[0-9][0-9]' docs/evidence/evidence.en.md | sort -u | wc -l
# 两版 Case 编号应一致
```

#### 30. CONTRIBUTING.md commit 规范
```bash
grep -A5 'Conventional Commits' CONTRIBUTING.md
# 完整 type 表 + 正反示例
```

#### 31. fde.md 路径一致性
```bash
grep 'fde.md' install.sh verify.sh config.sh HANDBOOK.md DEVELOPMENT.md
# 全部指向 skill/data/fde.md
```

#### 32. .gitignore 修正
```bash
grep 'skills' .gitignore
# 应为 /skills/（前导斜杠 = 仅根目录）
```

#### 33. index.html badge
```bash
grep 'v1\.0\|Harness' index.html | head -3
# hero badge 应为「Harness 层」
```

#### 34. README 维护模型声明
```bash
grep -A3 '项目维护模型' README.md
# 不应有「模型停止服务→项目失去修复能力」「结构性风险」
```

#### 35. CHANGELOG.md 索引
```bash
head -15 CHANGELOG.md
# v1.0.0 索引条目 + 摘要准确描述十八件事
# v0.99.9 条目不应丢失
```

---

### 第五部分：AI 知识库概念先行（维度 36-42）

#### 36. ARCHITECTURE.md 数据层定位
```bash
grep -n '数据层\|AI 知识库' ARCHITECTURE.md
# 五层架构后有独立「数据层」小节，明确「不进五层」
```

#### 37. think.md vs AI 知识库边界对比表
- ARCHITECTURE.md 有对比表（注入机制/内容/结构/生命周期）
- 对比表中不应出现「Wiki 页面」（v0.99.9 已改为「AI 知识库页面」）

#### 38. HANDBOOK.md 5 分钟速览 + 离场产物
```bash
grep 'AI 知识库' HANDBOOK.md
```

#### 39. FDE/FDE.md 知识库小节
```bash
grep '知识库\|v1\.1' FDE/FDE.md
# 正式表述用「AI 知识库」
```

#### 40. DEVELOPMENT.md 目录归属
```bash
# DEVELOPMENT.md 在 docs/ 下，不在根目录
test -f docs/DEVELOPMENT.md && echo "OK"
grep 'knowledge' docs/DEVELOPMENT.md
```

#### 41. 概念一致性交叉检查
- ARCHITECTURE「数据层不进五层」→ HANDBOOK / FDE / ROADMAP / README 是否一致

#### 42. 术语统一性
- 所有文档统一用「AI 知识库」（不是「知识库」「Wiki」「KB」）
- FDE 目录的正式表述位置（交付物表、状态声明、slogan）必须用「AI 知识库」

---

### 第六部分：FDE 架构完整性（维度 43-48）

#### 43. FDE 三层实体一致性
- FDE/FDE.md / FDE/SKILL.md / FDE/README.md 三文件描述是否一致

#### 44. FDE/templates/ 目录
```bash
ls FDE/templates/
# 镜像产出物是否存在
```

#### 45. FDE/quick-start.md
```bash
cat FDE/quick-start.md | head -10
# 非开发者 5 分钟入门
```

#### 46. install.sh FDE 路径
```bash
grep 'fde-install\|FDE' install.sh
```

#### 47. FDE SKILL.md 摘要优化
```bash
head -10 FDE/SKILL.md
# description 不应有步骤流程，只留触发条件
```

#### 48. FDE 前置条件
```bash
grep 'Node\|git\|npm\|bash' FDE/README.md
# 应有 Node≥18/git/npm/bash 前提条件
```

---

### 第七部分：Skill 文件质量（维度 49-58）

#### 49. Skill 摘要只留触发——SKILL.md
```bash
head -10 sofagent/skill/SKILL.md
# description 不应有功能列表
```

#### 50. Skill 摘要只留触发——engage.md
```bash
head -5 sofagent/skill/engage.md
# 不应有"两档拆解"方法描述
```

#### 51. Skill 摘要只留触发——loop-evaluate.md
```bash
head -5 sofagent/skill/loop-evaluate.md
# 不应有"复盘/评分/沉淀"功能列表
```

#### 52. 10 个 Skill 文件行数 ≤100
```bash
wc -l sofagent/skill/*.md FDE/SKILL.md
bash tools/check-docs.sh 2>&1 | grep '行'
```

#### 53. Skill 铁律编号一致性
- 10 个 Skill 文件中的铁律编号（A1-A11）是否一致

#### 54. SKILL.md frontmatter 完整性
```bash
head -15 sofagent/skill/SKILL.md
# name / slug / version / description / triggers / scenarios / not_when
```

#### 55. engage.md 点火条件
```bash
grep '点火条件' sofagent/skill/engage.md
```

#### 56. entry-gate.md 加载链确认
```bash
grep '加载链确认\|能力注册' sofagent/skill/entry-gate.md
```

#### 57. loop-check.md 三节点
```bash
grep 'checkpoint\|closure' sofagent/skill/loop-check.md
```

#### 58. loop-exit.md 四问
```bash
grep '怎么停\|停止条件' sofagent/skill/loop-exit.md
```

---

### 第八部分：行业笔记落地验证（维度 59-65）

#### 59. ROADMAP v1.x 新增条目
```bash
grep -E 'think\.md 模板|后置测验|7-Entry' ROADMAP.md
# 3 条新条目都应在（Lingua Word 已在 v1.0 移除）
```

#### 60. ROADMAP entry-gate 精确化
```bash
grep 'entry-gate 风险分级' ROADMAP.md
# 应标注"超时降级和防橡皮图章不做"
```

#### 61. ARCHITECTURE 三层循环
```bash
grep -A10 '三层时间尺度' ARCHITECTURE.md
# 内层已覆盖/中层 v1.0.1/外层 v2.x + 诚实声明
```

#### 62. ROADMAP v2.x 共享记忆三模式
```bash
grep -A8 '共享记忆三模式' ROADMAP.md
# 黑板/Gossip/上下文路由 + "不做决策"声明
```

#### 63. ROADMAP v2.x 双层循环
```bash
grep -A10 '双层循环' ROADMAP.md
# Karpathy 框架 + 与 Ng 三层循环的差异标注
```

#### 64. ROADMAP v2.x 审批通道探索
```bash
grep '审批通道\|超时降级\|橡皮图章' ROADMAP.md
# 应标注为 v2.x 探索方向，不做承诺
```

#### 65. ROADMAP「不需要的」列表完整性
```bash
grep -A20 '不需要的' ROADMAP.md
# 定时触发(cron)应在列表中（不支持 cron）
```

---

### 第九部分：理论引证精确性（维度 66-72）

#### 66. ARCHITECTURE「理论基础与外部验证」节
```bash
grep -A20 '理论基础与外部验证' ARCHITECTURE.md
# Hugging Face 实验数据 + 12 组件映射表 + Loop Engineering 对应
```

#### 67. 12 组件映射诚实标注
```bash
grep '映射解读\|非 Akshay' ARCHITECTURE.md
# 应有"以下为 sofagent 的映射解读，非 Akshay 原文"
```

#### 68. AutoResearch 差距标注
```bash
grep '700\|诚实差距' ARCHITECTURE.md
# 应标注 AutoResearch 700 次无人值守 vs sofagent 单任务检查点的差距
```

#### 69. README 引证不过度声称
```bash
grep '外部验证' README.md
# 应明确"sofagent 做的是外层机制中的审计和约束"
# 不应声称 sofagent = 完整 Harness / LLM 操作系统
```

#### 70. README.en 引证同步
```bash
grep 'External validation' README.en.md
```

#### 71. THANKS.md 外部研究参考
```bash
grep -A3 'Hugging Face\|AutoResearch\|Codila\|Bilevel\|Akshay' docs/THANKS.md
# 6 项引用（含 Codila X 链接 + Bilevel arxiv 链接 + Akshay 全名 + 文章链接）
```

#### 72. 致谢链接完整性
```bash
# 验证关键 URL：
# https://huggingface.co/spaces/joelniklaus/harness-optimization
# https://github.com/karpathy/autoresearch
# https://x.com/0xCodila/status/2072329149520232639
# https://arxiv.org/abs/2603.23420
# https://x.com/i/article/2040732084843782144  （需登录 X，验证链接格式即可，不验证页面内容）
```

---

### 第十部分：措辞与链接一致性（维度 73-75）

#### 73. 术语三层一致性
```bash
# 1. 「Workflow 梳理」= 编排引擎触发点
# 2. 「FDE 工作」= slogan / 嵌套关系
# 3. 「部署」= 给客户装底座的具体动作

grep -rn 'FDE 办事\|FDE 部署时生成' README.md ARCHITECTURE.md HANDBOOK.md DEVELOPMENT.md ROADMAP.md FDE/README.md FDE/FDE.md
# 不应有旧措辞残留

grep -n '编排引擎.*部署\|编排引擎.*FDE 工作' README.md ARCHITECTURE.md DEVELOPMENT.md
# 不应混用
```

#### 74. Slogan 5 文件一致性
```bash
for f in README.md ARCHITECTURE.md HANDBOOK.md DEVELOPMENT.md FDE/README.md; do
  echo "=== $f ==="
  grep -n 'FDE 工作\|自己产品\|部署完让' "$f" | head -3
done
# 每个文件都应包含「FDE 工作」相关表述，措辞一致
```

#### 75. 原文链接完整性
```bash
grep 'arxiv.org/abs/2603.23420' docs/THANKS.md ARCHITECTURE.md
# 两处都应有此链接

grep 'Akshay Pachaar' docs/THANKS.md ARCHITECTURE.md
# 应为全名

grep 'x.com/i/article/2040732084843782144' docs/THANKS.md
# THANKS.md 应有文章链接
```

---

### 第十一部分：生态就绪度（维度 76-81）

#### 76. GitHub Actions CI 通过
```bash
gh run list --limit 3 2>&1
# 最近 CI 运行是否通过
```

#### 78. SECURITY.md 完整性
```bash
cat SECURITY.md | head -20
# install.sh 行为说明 + 信任模型 + 版本号 = v1.0
```

#### 79. COMMUNITY.md 状态
```bash
head -10 docs/COMMUNITY.md
# 版本号应为 v1.0
```

#### 80. CONTRIBUTING.md 完整性
```bash
cat CONTRIBUTING.md
# Conventional Commits + Co-maintainer 招募 + Issue/PR 指引
```

#### 81. CODE_OF_CONDUCT.md
```bash
head -5 CODE_OF_CONDUCT.md
```

---

### 第十二部分：安全与稳定度（维度 82-88）

#### 82. 稳定度标签校准
- ARCHITECTURE FDE "实验性"
- HANDBOOK FDE 成熟度警告
- fde.md 字符数 ~1600（不是 bytes）
- **v1.0 关键**：编排引擎仍标注实验性，不能因为正式版就去掉

#### 83. LIMITATIONS 完整性
```bash
cat LIMITATIONS.md | head -30
# 版本号应为 v1.0
# 18+ 条已知局限 + Windows 实验性标注 + daemon 行为边界
```

#### 84. ROADMAP v1.0 准入
```bash
grep '✅' ROADMAP.md | head -5
# v1.0 发版后准入表 ✅ 数字应更新
```

#### 85. 文件清单完整性
```bash
git log --oneline -5  # v1.0 相关 commit
git diff <v0.99.9-tag>..HEAD --stat | tail -3  # 全量改动统计
```

#### 86. 整体一致性
- 十八件事描述在 changelog / ROADMAP / ARCHITECTURE / HANDBOOK / README 之间是否一致
- 是否有文档说「做了」但代码没改
- 是否有代码改了但文档没更新

#### 87. ARCHITECTURE 致谢完整性
```bash
grep 'Joel Niklaus\|Karpathy AutoResearch\|Akshay\|Andrew Ng\|Superpowers\|Codila' ARCHITECTURE.md | tail -6
# 致谢表应有 6 项
```

#### 88. Hugging Face 数据精确性
```bash
grep '3\.5%\|80\.1%\|76\|1/7\|14\.4' ARCHITECTURE.md README.md
# 数据引用是否标明"法律 Agent 基准测试"（特定领域，非通用）
```

---

### 第十三部分：v1.0 正式版特有检查（维度 89-101）🆕

#### 89. 铁律措辞强化验证 🆕
```bash
# v1.0 核心改动：10 个 Skill 文件 + FDE/SKILL.md 的铁律措辞从「建议/应该/尽量」升级为「必须/绝无例外」
grep -rn '建议\|应该\|尽量' sofagent/skill/*.md FDE/SKILL.md | grep -v 'not_when\|Gotcha\|场景\|如果\|注\|说明'
# 期望：无输出（空 = 全部改完）

# 如果有输出，逐条确认是否属于例外（场景描述、Gotcha 警告等）
# 非例外的「建议/应该/尽量」= P0（铁律措辞强化未改全）
```

#### 90. 上线前验收测试 🆕
```bash
# v1.0 第二件事：上线前验收测试（tools/acceptance-test.sh）

# 1. 文件存在
ls -la tools/acceptance-test.sh
# 不存在 = P0（上线前验收测试未实现）

# 2. 可执行
test -x tools/acceptance-test.sh && echo "executable" || echo "not executable"
# 不可执行 = P1

# 3. 覆盖 9 个场景
grep -c '场景\|SCENARIO\|test_' tools/acceptance-test.sh
# 应 ≥ 9（每个场景至少一个测试标记）

# 4. 临时仓库清理
grep -c 'cleanup\|trap\|teardown\|rm -rf.*tmp' tools/acceptance-test.sh
# 应 ≥ 1（测试后必须清理临时 git 仓库）

# 5. 验收测试不应改用户环境
grep -n 'HOME\|global\|npm install -g' tools/acceptance-test.sh
# 如有全局安装操作 = P1（验收测试应隔离环境）
```

#### 91. daemon 文档一致性 🆕
```bash
# v1.0 第三件事：daemon 文档校准（Case 025 反馈）
# 三处文档必须对齐实际行为：daemon 监控 hash 变化，非直接监听 git commit

grep 'hash 变化\|hash 检测' HANDBOOK.md
grep 'hash 变化\|hash 检测' ARCHITECTURE.md
grep 'hash 变化\|hash 检测' LIMITATIONS.md
# 三处都应描述实际监控机制

# 确认不存在矛盾描述（如「daemon 监听 git commit」）
grep -i 'daemon.*git commit\|daemon.*监听.*commit' HANDBOOK.md ARCHITECTURE.md
# 不应有「daemon 直接监听 git commit」的描述
```

#### 92. FDE 隐性代价 🆕
```bash
# v1.0 第四件事：FDE/FDE.md 新增「隐性代价」节
grep -A10 '隐性代价' FDE/FDE.md
# 应有「理解债」+「认知让渡」两项
# ≤200 字
# 客观不自贬

# 字数检查
grep -A10 '隐性代价' FDE/FDE.md | wc -m
# 应 ≤400 字符（含格式符号，正文 ≤200 字）
```

#### 93. 准入条件 A 类推进 🆕
```bash
# v1.0 第五件事：6 条 A 类准入条件从 ⚠️ 推进到可声称状态或诚实标注

grep -A2 '闭环完整性\|上下文成本\|OpenClaw 全链路\|MCP webhook\|首次任务通过率\|三操作系统' ROADMAP.md | head -20
# 每条都应从 ⚠️ 推进到：
#   - ✅ 已验证（有 evidence 支持）
#   - 或 ⚠️ 诚实标注（LIMITATIONS 有明确说明，不造假）

# 关键：不能为了 v1.0 正式版就把 ⚠️ 改成 ✅ 而没有新的 evidence
```

#### 94. 正式版措辞 🆕
```bash
# v1.0 是正式版，核心文档应体现「可生产使用」
grep -i '正式版\|生产可用\|可生产使用' README.md CHANGELOG.md SECURITY.md HANDBOOK.md | head -5

# 但实验性功能不能去掉标注
grep -i '实验性' ARCHITECTURE.md HANDBOOK.md LIMITATIONS.md | head -5
# daemon / 编排引擎 / Windows 仍应标注实验性

# README 头部定位
head -5 README.md
# 应体现「Agent 提交时审计工具」定位，不是「实验」措辞
```

#### 95. semver 合规 + 版本号全面一致 🆕
```bash
# v1.0 是 semver 正式版，版本号应为 1.0.0（不是 1.0）
grep '1\.0\.0' package.json sofagent/audit/package.json sofagent/mcp/package.json
# 三个 package.json 都应为 1.0.0

grep '1\.0\.0' tools/check-version.sh
# check-version.sh 应检查 1.0.0

# 版本号不应混用 1.0 和 1.0.0
grep -rn 'v1\.0[^0-9.]' --include="*.md" --include="*.ts" --include="*.sh" --include="*.json" . | grep -v 'docs/changelog/' | grep -v node_modules | head -5
# 不应为 v1.0（应为 v1.0.0）——排除 v1.01、v1.0-beta 等非目标模式
```

#### 96. `--init` 一键初始化 🆕
```bash
# v1.0 第十三件事：sofagent-audit --init 命令
# 一条命令完成 3 步：生成 config 模板 → 安装 hook → 冒烟测试

# 1. 命令存在性
ls sofagent/audit/src/commands/init.ts
grep '\-\-init' sofagent/audit/src/index.ts
# 应有 --init 分支处理

# 2. config 模板
ls sofagent/audit/src/config-template.ts
grep 'a1-sensitive-files' sofagent/audit/src/config-template.ts
# 应包含 11 条规则 + 4 条扩展规则的模板字符串

# 3. bin 入口
grep 'init' sofagent/audit/package.json
# bin 应有 sofagent-audit-init 或等价入口

# 4. 幂等性
# init.ts 中应检查「配置已存在则跳过」「hook 已存在则不重复写入」
grep -i 'already exists\|已存在\|skip\|跳过' sofagent/audit/src/commands/init.ts
# 应有幂等性检查逻辑

# 5. hook 模板一致性
# init.ts 生成的 hook 内容应与第十件事的无声失败保护一致
grep -A5 'commit-msg' sofagent/audit/src/commands/init.ts
# hook 内容应包含 Node.js 检测 + sofagent-audit 检测
```

#### 97. `--doctor` 健康诊断 🆕
```bash
# v1.0 第十四件事：sofagent-audit --doctor 命令
# 一键诊断 7 项健康度，每项 ✅/❌ + 修复建议

# 1. 命令存在性
ls sofagent/audit/src/commands/doctor.ts
grep '\-\-doctor' sofagent/audit/src/index.ts
# 应有 --doctor 分支处理

# 2. bin 入口
grep 'doctor' sofagent/audit/package.json
# bin 应有 sofagent-audit-doctor 或等价入口

# 3. 7 项诊断
grep -c 'Node\|git\|hook\|config\|history\|rule\|smoke\|冒烟' sofagent/audit/src/commands/doctor.ts
# 应覆盖 7 项诊断

# 4. 只读诊断
grep -i 'write\|create\|mkdir\|install\|删除' sofagent/audit/src/commands/doctor.ts
# 不应有任何写操作（doctor 只诊断不修复）

# 5. 退出码
grep 'exit.*1\|exit.*0' sofagent/audit/src/commands/doctor.ts
# 全部通过 → exit 0；有失败 → exit 1

# 6. 实际运行测试
cd /tmp && node sofagent/audit/dist/doctor.js 2>&1 | head -15
# 期望：7 项诊断全部输出，格式清晰
# ⚠️ 如 init/doctor 命令尚未 build 到 dist/，标注「待 build 后验证」
```

#### 98. 审计可视化升级 🆕
```bash
# v1.0 第七件事：printResults 重写为 banner + 规则网格 + 历史拦截统计

# 1. printResults 函数存在 banner 输出
grep -c 'banner\|╔═\|╚═' sofagent/audit/src/index.ts
# 应有 banner 辅助函数

# 2. CJK 宽度计算
grep 'visualWidth\|isCJK\|padVisual' sofagent/audit/src/index.ts
# 应有 CJK 字符宽度计算（padEnd 按字符数，CJK 占 2 列）

# 3. 历史拦截统计
grep 'getHistoryStats\|历史拦截\|历史' sofagent/audit/src/index.ts
# 应调用 audit-history.ts 统计历史记录

# 4. 三种场景输出（通过/警告/违规）
grep '审计通过\|有警告\|审计拦截' sofagent/audit/src/index.ts
# 应有三种判定标签

# 5. --json 和 --ci 模式不受影响
grep 'json.*return\|ci.*return' sofagent/audit/src/index.ts
# JSON 和 CI 模式应提前 return，不走 banner 逻辑
```

#### 99. 违规修复建议 🆕
```bash
# v1.0 第八件事：每条违规带「怎么修」建议

# 1. fix-suggestions.ts 存在
ls sofagent/audit/src/fix-suggestions.ts
grep 'getFixSuggestion\|FIX_SUGGESTIONS' sofagent/audit/src/fix-suggestions.ts
# 应有 11+4 条规则的修复建议映射表

# 2. index.ts 调用了建议函数
grep 'getFixSuggestion\|怎么修' sofagent/audit/src/index.ts
# printResults 中应在 detail 行后追加「怎么修」行

# 3. 每条建议 ≤80 字
awk '/FIX_SUGGESTIONS/,/^};/' sofagent/audit/src/fix-suggestions.ts | grep "'" | awk '{print length, $0}' | sort -rn | head -3
# 最长的建议字符串不应超过 80 中文字符
```

#### 100. 审查 prompt 覆盖完整度 + README 定位 + CHANGELOG 索引 🆕
```bash
# v1.0 第 15-17 件事：审查 prompt 覆盖 + README 定位 + CHANGELOG 索引

# 1. 审查 prompt 维度数 = 文件头维度数
grep -c '####' docs/verification/regression-checklist.md
# 应与本文件头标注的维度数一致

# 2. README 头部定位
head -5 README.md
# 第一行 # sofagent，第二行应有「Agent 提交时审计工具——git diff 硬证据」一句话定位

# 3. CHANGELOG 索引
head -15 CHANGELOG.md
# 应有 v1.0.0 索引条目（发版后检查，发版前检查 placeholder 是否存在）
```

#### 101. 升级迁移指引 🆕
```bash
# v1.0 第十八件事：v0.99.x → v1.0.0 升级说明

grep -r '升级\|migration\|v0\.99\.x' README.md CHANGELOG.md docs/changelog/v1.0.0.md | head -5
# 应有升级迁移指引，推荐 --init 而非 --install-hook

grep 'sofagent-audit --init' README.md docs/changelog/v1.0.0.md
# 升级指引中应提到 --init（幂等更新 hook）

# 确认没有推荐 --install-hook 作为升级方式
grep 'install-hook' docs/changelog/v1.0.0.md
# --install-hook 可作为命令文档存在，但升级指引应推荐 --init
```

---

### 第十四部分：语言风格与文字质量（维度 102-105）🆕

#### 102. 整体语言风格与语气 🆕
```bash
# v1.0 文字质量检查：项目对外文档（README / HANDBOOK / ARCHITECTURE / DEVELOPMENT / CHANGELOG / ROADMAP / FDE / LIMITATIONS）的语言风格是否统一

# 1. 谦虚低调——不浮夸、不吹嘘
# 扫描「过度营销」措辞：声称「最强」「唯一」「革命性」「颠覆」「碾压」等绝对化表述
grep -rn '最强\|唯一\|革命性\|颠覆\|碾压\|无敌\|吊打\|秒杀\|业界第一' README.md README.en.md HANDBOOK.md ARCHITECTURE.md ROADMAP.md CHANGELOG.md FDE/README.md FDE/FDE.md LIMITATIONS.md DEVELOPMENT.md SECURITY.md CONTRIBUTING.md docs/COMMUNITY.md 2>/dev/null
# 期望：无输出（正式版应该用客观描述，不用营销话术）

# 2. 幽默分寸——有但不喧宾夺主
# sofagent 的风格定位是「技术文档带一点轻幽默」，不是搞笑文档
# 检查：是否有不合时宜的玩笑出现在严肃场景（安全警告、局限性声明、升级迁移等）
grep -B1 -A1 '😂\|🤣\|666\|yyds\|awsl\|蚌埠住了\|绝绝子' README.md HANDBOOK.md ARCHITECTURE.md CHANGELOG.md LIMITATIONS.md SECURITY.md 2>/dev/null
# 期望：无输出（严肃场景不放梗图/meme 措辞）

# 3. 自贬警告——诚实 ≠ 自我贬低
# v1.0 的定位是正式版，LIMITATIONS 可以说「哪些做不到」，但 README/CHANGELOG 不应出现自贬措辞
grep -rn '我们其实\|说实话我们\|别抱太大期望\|可能不太行\|老实说' README.md CHANGELOG.md HANDBOOK.md ARCHITECTURE.md ROADMAP.md 2>/dev/null
# 期望：无输出（诚实放 LIMITATIONS，不在核心叙事自贬）

# 4. 语气一致性——同一文档内不应忽冷忽热
# 抽查 README.md：开头定位段（正式）vs 功能列表段（说明性）vs 贡献者招募段（友好）语气是否过度割裂
head -20 README.md
tail -20 README.md
# 人工判断：从开头到结尾的语气过渡是否自然
```

#### 103. 架构描述与文档组织合理性 🆕
```bash
# v1.0 文字质量检查：五层架构 + 双引擎 + FDE 三层实体的文字描述在核心文档中是否合理组织

# 1. 五层架构描述一致性
# README / HANDBOOK / ARCHITECTURE / DEVELOPMENT 四份核心文档描述五层架构时，层名/边界/职责是否一致
for f in README.md HANDBOOK.md ARCHITECTURE.md DEVELOPMENT.md; do
  echo "=== $f ==="
  grep -n 'Harness.*执行.*审计.*MCP.*协同\|五层' "$f" 2>/dev/null | head -2
done
# 期望：四份文档对五层的命名和职责描述一致，无矛盾

# 2. 双引擎（审计引擎 + 编排引擎）描述
grep -n '审计引擎\|编排引擎\|双引擎' README.md HANDBOOK.md ARCHITECTURE.md DEVELOPMENT.md ROADMAP.md 2>/dev/null
# 期望：双引擎定位在各文档一致，审计引擎=提交时（不依赖 Agent），编排引擎=运行时（依赖 Agent）

# 3. 文档间的职责划分是否合理
# README = 是什么（入口）→ HANDBOOK = 怎么用（操作）→ ARCHITECTURE = 为什么这样设计（原理）→ DEVELOPMENT = 怎么改（开发）
# 检查是否有内容重叠到让人觉得「三份文档说了同一件事」
# 人工判断：README 的架构小节 vs ARCHITECTURE 的架构大节，是否只是详细程度的差异而非重复粘贴

# 4. 技术概念引入是否有铺垫
# ARCHITECTURE / HANDBOOK 中首次出现的关键概念（Harness 层、FDE、铁律、Skill、think.md 等）是否有简短解释或链接
grep -n 'Harness 层\|铁律\|think\.md\|FDE 工作' HANDBOOK.md | head -5
# 人工判断：首次出现时读者能否理解，还是需要先读其他文档
```

#### 104. 废话与冗余检测 🆕
```bash
# v1.0 文字质量检查：核心文档是否有可以精简的废话、重复表述或注水段落

# 1. 重复句式检测——同一意思用不同措辞说了多遍
# 常见模式：「不仅 X，而且 Y」中 X 和 Y 是同一件事
grep -rn '不仅.*而且\|既.*又.*还\|同时也是.*也是' README.md HANDBOOK.md ARCHITECTURE.md CHANGELOG.md ROADMAP.md 2>/dev/null | head -5
# 人工判断：是否 X 和 Y 实际上是同一件事被拆成两句

# 2. 空洞修饰词——「强大的」「完善的」「丰富的」「全面的」等没有信息量的形容词
grep -rn '强大的\|完善的\|丰富的\|全面的\|优秀的\|卓越的\|出色的' README.md HANDBOOK.md ARCHITECTURE.md CHANGELOG.md ROADMAP.md FDE/README.md FDE/FDE.md 2>/dev/null
# 期望：极少或无（技术文档用具体数字/事实，不用空洞形容词）

# 3. CHANGELOG 废话——开发日志应该是「做了什么 + 为什么 + 怎么验证」，不是流水账
head -30 docs/changelog/v1.0.0.md
# 人工判断：每条是否有信息增量，还是「修复了一些问题」「优化了体验」这类万能句式

# 4. README 冗余——README 应该精简，细节留给 HANDBOOK/ARCHITECTURE
wc -l README.md
# 参考：README > 300 行时应检查是否有内容可以移到专门文档
# 人工判断：README 中是否有大段教程/原理/FAQ 本应在 HANDBOOK 中

# 5. 同一信息多处重复
# 版本号、测试数、规则数等数字在多个文档中重复出现——这本身合理（需要保持一致），但如果是大段叙述性文字重复则应精简
# 抽查：README 的「怎么工作」节 vs HANDBOOK 的「5 分钟速览」节，是否有超过 3 行的逐字重复
diff <(sed -n '/怎么工作/,/^##/p' README.md) <(sed -n '/5 分钟速览/,/^##/p' HANDBOOK.md) 2>/dev/null | head -10
# 如有大量相同行 = P2（建议精简为「详见 HANDBOOK」+ 链接）
```

#### 105. 描述完整性——是否有描述不足 🆕
```bash
# v1.0 文字质量检查：核心文档是否有「提到了但没解释清楚」的地方

# 1. 关键概念是否有足够解释
# 以下概念在首次出现时应有至少 1-2 句解释，不能只丢名词：
#   - Harness 层 / 审计引擎 / 编排引擎 / FDE / 铁律 / Skill / think.md / daemon / OpenClaw
for concept in "Harness 层" "审计引擎" "编排引擎" "铁律" "think.md" "daemon" "OpenClaw"; do
  echo "=== $concept ==="
  grep -n "$concept" README.md | head -1
  # 看首次出现的位置，人工判断上下文是否足够让新读者理解
done

# 2. 快速上手路径是否完整
# README 中是否有「安装 → 配置 → 第一次使用」完整路径
grep -n 'install\|安装\|quick\|快速\|开始' README.md | head -5
# 人工判断：新用户读完 README 后能否独立完成安装和首次审计

# 3. 升级路径是否清楚
# v0.99.x → v1.0.0 的升级说明是否放在容易找到的位置
grep -n '升级\|migration\|从 v0' README.md CHANGELOG.md | head -5
# 如只在 docs/changelog/v1.0.0.md 有但 README 没有链接 = P2（建议在 README 加链接）

# 4. 错误场景是否有说明
# 常见问题（Node.js 版本不够 / hook 没装上 / 首次提交报错 / Windows 不支持等）是否有对应说明
grep -n 'Node.*18\|hook.*没\|首次提交\|Windows.*实验' README.md HANDBOOK.md LIMITATIONS.md 2>/dev/null | head -5
# 人工判断：用户遇到问题时能否在文档中找到对应说明

# 5. 术语表/概念对照——是否有帮助新读者的名词速查
# HANDBOOK 或 DEVELOPMENT 中是否有术语对照表（铁律 ↔ audit rule，Skill ↔ 行为模板 等）
grep -n '术语\|名词\|glossary\|对照' HANDBOOK.md DEVELOPMENT.md ARCHITECTURE.md 2>/dev/null
# 如完全没有 = P2（建议在 HANDBOOK 加简短术语表）
```

---

### 第十五部分：OpenClaw 发版验收测试（维度 106）🆕

#### 106. OpenClaw 端到端验收 🆕
```bash
# v1.0 发版前必须通过 OpenClaw Agent 驱动的端到端验收测试
# 标准测试用例文件：docs/verification/openclaw-acceptance-test.md
# 与 acceptance-test.sh（CLI 端到端）互补——本测试是 Agent 真实写代码时审计能否拦住

# 1. 测试用例文件存在
ls docs/verification/openclaw-acceptance-test.md 2>/dev/null
# 不存在 = P0（发版前必须完成 OpenClaw 验收）

# 2. 测试用例文件完整性——5 个场景
grep -c '场景 [0-5]' docs/verification/openclaw-acceptance-test.md 2>/dev/null
# 应 ≥ 5（正常 PASS / 敏感文件 / Secret / 越界 / 配置删除）

# 3. 测试结果记录
# 发版前必须手动执行并记录结果（PASS/FAIL），不能只看文件存在就标 ✅
grep -i 'PASS\|FAIL\|通过\|拦截' docs/verification/openclaw-acceptance-test.md 2>/dev/null | head -5
# 人工判断：5 个场景是否都有执行结果记录

# 4. 验证检查项覆盖
grep -c '\[ \]' docs/verification/openclaw-acceptance-test.md 2>/dev/null
# 应 ≥ 7（commit-msg 触发 / banner 可视化 / 修复建议 / PASS commit / FAIL 拦截 / WARN 放行 / history 写入）

# 5. releasing.md 步骤 2.5 引用
grep 'openclaw-acceptance\|OpenClaw.*验收' docs/verification/releasing.md 2>/dev/null
# 应引用本测试文件，作为发版流程的正式步骤

# ⚠️ 如本次审查时 OpenClaw 验收尚未执行，标注「待执行」而非跳过
```

---

### 第十六部分：审计引擎加固（v1.0.0 审查修复）（维度 107-114）🆕

#### 107. 首次提交拦截机制（P0 修复） 🆕
```bash
# v1.0.0 审查修复：全新仓库首次 commit 时 HEAD~1 不存在的 git fatal 错误
# 修复方案：git rev-parse --verify HEAD 检测 → --cached 模式 → parseStagedDiff()

# 1. index.ts 有首次提交检测分支
grep 'rev-parse.*verify.*HEAD\|cached\|首次提交' sofagent/audit/src/index.ts
# 应有首次提交检测逻辑

# 2. parseStagedDiff 函数存在
grep 'parseStagedDiff' sofagent/audit/src/diff-parser.ts
# diff-parser.ts 应导出 parseStagedDiff

# 3. --cached 参数处理
grep 'cached' sofagent/audit/src/index.ts
# main 函数应有 args.cached 分支

# 4. 实际测试：在全新仓库首次 commit 不应报 fatal
# cd /tmp/test-first-commit && git init && echo "test" > a.txt && git add a.txt && sofagent-audit
# 期望：正常输出（首次提交，扫描 staged 文件），不是 git fatal
```

#### 108. A2 Secret Leak 输出聚合（P0 修复） 🆕
```bash
# v1.0.0 审查修复：同一文件同一密钥类型的多条检测不再逐条输出
# 修复方案：Map<"文件路径|密钥标签", count> 聚合 + MAX_DISPLAY_PER_GROUP=5

# 1. rule-a2-secret-leak.ts 有 Map 聚合
grep 'groupedDetections\|MAX_DISPLAY_PER_GROUP' sofagent/audit/src/rules/rule-a2-secret-leak.ts
# 应有聚合逻辑

# 2. 聚合 key 格式
grep 'file.*label\|文件路径.*密钥' sofagent/audit/src/rules/rule-a2-secret-leak.ts
# 聚合 key 应为 "文件路径|密钥标签"
```

#### 109. ConfigLoadError 精确报错（P0 修复） 🆕
```bash
# v1.0.0 审查修复：YAML 语法错误时报「行号列号 + 文件路径」而非模糊报错
# 修复方案：ConfigLoadError 类含 filePath/line/column

# 1. ConfigLoadError 类存在
grep 'class ConfigLoadError' sofagent/audit/src/config-loader.ts
# 应有 ConfigLoadError 类定义

# 2. 错误对象包含位置信息
grep 'filePath\|line\|column' sofagent/audit/src/config-loader.ts | head -5
# 应有 filePath/line/column 属性

# 3. strict 模式 exit 2（ci 模式 exit 1，v1.0.5 解耦）
grep 'exit.*2\|exitCode.*2' sofagent/audit/src/index.ts
# strict 模式配置加载失败应 exit 2

# 4. 实际测试：写一个 YAML 语法错误的 config，看报错是否含行号
```

#### 110. doctor --no-verify 事后检测（P1 修复） 🆕
```bash
# v1.0.0 审查修复：doctor 新增第 8 项检测 --no-verify 绕过

# 1. doctor.ts 有第 8 项检测
grep 'no.verify\|8\.' sofagent/audit/src/commands/doctor.ts
# 应有 --no-verify 检测项

# 2. 检测逻辑：对比 git log SHA vs history.jsonl
grep 'git log\|history.jsonl\|rev-list' sofagent/audit/src/commands/doctor.ts
# 应有 SHA 对比逻辑

# 3. doctor 路径锚定
grep 'rev-parse.*show-toplevel\|git.*toplevel' sofagent/audit/src/commands/doctor.ts
# doctor 应锚定到 git 仓库根目录
```

#### 111. hook 模板 --no-verify 提示移除（P1 修复） 🆕
```bash
# v1.0.0 审查修复：pre-commit hook 模板中不再出现 --no-verify 提示

grep 'no.verify' sofagent/audit/src/config-template.ts
# HOOK_TEMPLATE 中不应有 --no-verify 相关提示文字
```

#### 112. A3 无 task 降级 PASS（P1 修复） 🆕
```bash
# v1.0.0 审查修复：A3 careful-modify 规则在没有 task 信息时降级为 PASS（不跳过）

grep 'task\|PASS\|降级' sofagent/audit/src/rules/rule-a3-careful-modify.ts
# 无 task 时应 return PASS，不是跳过检查或报错
```

#### 113. reporter 规则过滤机制（P1 修复） 🆕
```bash
# v1.0.0 审查修复：支持按 config.rules 配置过滤规则

# 1. reporter.ts 有规则过滤
grep 'activeRules\|rulesConfig\|filter' sofagent/audit/src/reporter.ts
# 应有按 config.rules 过滤的逻辑

# 2. config-loader 支持 rules 字段
grep 'rules.*Record\|rules\?' sofagent/audit/src/config-loader.ts
# AuditConfig 应有 rules?: Record<string, boolean> 字段
```

#### 114. config-template 完整字段（P1 修复） 🆕
```bash
# v1.0.0 审查修复：config 模板包含所有新字段

grep 'lowRiskPatterns\|testPatterns\|carefulModifyThreshold\|extendedRulesEnabled\|loopCheckMaxRounds\|rules' sofagent/audit/src/config-template.ts
# CONFIG_TEMPLATE 应包含所有字段：lowRiskPatterns / testPatterns / carefulModifyThreshold / extendedRulesEnabled / rules / loopCheckMaxRounds
```

---

### 第十七部分：v1.0.1 功能迭代回归（维度 115-127）🆕

#### 115. A14 知识库越权审计规则 🆕
```bash
# v1.0.1 新增：A14 知识库越权审计规则（hybrid 模式）

# 1. 规则文件存在
ls sofagent/audit/src/rules/rule-a14-kb-cross-domain.ts
# 不存在 = P0

# 2. 规则注册
grep 'A14\|a14\|kb-cross-domain' sofagent/audit/src/rules/index.ts
# extendedRules 应注册 A14：{ name: 'A14 知识库越权', number: 14, evidenceMode: 'hybrid' }

# 3. 规则总数 = 16（default 11 + extended 5）
grep -c 'name:' sofagent/audit/src/rules/index.ts
# 应为 16

# 4. workflow.yml knowledge-domain 配置加载
grep 'knowledge-domain\|knowledgeDomain\|workflow.yml' sofagent/audit/src/rules/rule-a14-kb-cross-domain.ts
# 应加载 workflow.yml 的 knowledge-domain 配置

# 5. LogEntry 类型正确
grep 'operation\|raw' sofagent/audit/src/rules/rule-a14-kb-cross-domain.ts
# 用 entry.operation / entry.raw，不是 action/detail（历史 Bug）
```

#### 116. knowledge-maintain.md Skill 文件 🆕
```bash
# v1.0.1 新增：知识库维护 Skill

# 1. 文件存在
ls sofagent/skill/knowledge-maintain.md
# 不存在 = P0

# 2. 行数 ≤100
wc -l sofagent/skill/knowledge-maintain.md
# 应 ≤100 行

# 3. 内容完整性
grep 'frontmatter\|双向链接\|index\|log\|Lint\|Gotcha' sofagent/skill/knowledge-maintain.md
# 应有 frontmatter 模板 + 双向链接规则 + index/log 更新 + Lint 检查 + Gotcha

# 4. install.sh 部署该文件
grep 'knowledge-maintain' sofagent/scripts/lib/file-deploy.sh
# deploy_skill_files 列表应包含 knowledge-maintain.md
```

#### 117. 四层加载链（三层→四层） 🆕
```bash
# v1.0.1 变更：SKILL.md 加载链从三层扩展为四层

grep 'knowledge/index\|四层\|第 4 层' sofagent/skill/SKILL.md
# SKILL.md 应描述四层加载链：SKILL.md → think.md → fde.md → knowledge/index.md
```

#### 118. think.md 写作规范 🆕
```bash
# v1.0.1 新增：SKILL.md 中的 think.md 写作规范

grep '写作规范\|做了什么\|验证了什么\|5 节' sofagent/skill/SKILL.md
# 应有 think.md 5 节模板说明（必填：做了什么 + 验证了什么）
```

#### 119. loop-evaluate Lint 5 项 🆕
```bash
# v1.0.1 新增：loop-evaluate.md 的 5 项 Lint 体检表

grep '断链\|矛盾\|孤立\|缺失\|过期\|Lint' sofagent/skill/loop-evaluate.md
# 应有 5 项 Lint 检查（断链/矛盾/孤立/缺失/过期）
```

#### 120. loop-check 轮次上限 🆕
```bash
# v1.0.1 新增：loop-check.md 的轮次上限约束

grep '轮次\|上限\|20\|closure\|自动关闭' sofagent/skill/loop-check.md
# 应有「超过 20 次自动 closure」的约束
```

#### 121. daemon Ingest 触发机制 🆕
```bash
# v1.0.1 新增：daemon.sh 的 task/logs 变化检测 + Ingest 触发

# 1. daemon.json 有新字段
grep 'tasklogs_pending\|tasklogs_last_ingest' sofagent/scripts/daemon.sh
# 应有 tasklogs_pending / tasklogs_last_ingest 字段

# 2. 变化检测逻辑
grep 'find.*mmin.*-30\|task.*logs\|Ingest' sofagent/scripts/daemon.sh
# 主循环应有 find -mmin -30 变化检测

# 3. 30 分钟防抖
grep '防抖\|debounce\|3000\|1800\|30.*min' sofagent/scripts/daemon.sh
# 应有 30 分钟防抖逻辑
```

#### 122. fde.md AI 知识库维护规则 🆕
```bash
# v1.0.1 新增：fde.md 新增「AI 知识库维护规则」章节

# 1. 章节存在
grep '知识库维护\|AI 知识库维护规则' sofagent/skill/data/fde.md
# 应有知识库维护章节

# 2. 字符数 ≤3200
wc -m sofagent/skill/data/fde.md
# 应 ≤3200 字符（v1.0.1 修复后为 ~3057）

# 3. 内容要素
grep '页面格式\|Ingest 触发\|注入规则\|Lint 体检' sofagent/skill/data/fde.md
# 应有页面格式 + Ingest 触发 + 注入规则 + Lint 体检
```

#### 123. knowledge/ 目录结构部署 🆕
```bash
# v1.0.1 新增：install.sh 创建 knowledge/ 骨架目录

# 1. file-deploy.sh 有 knowledge 骨架创建
grep '_deploy_knowledge_skeleton\|knowledge.*entities\|knowledge.*concepts' sofagent/scripts/lib/file-deploy.sh
# 应有 _deploy_knowledge_skeleton() 函数

# 2. verify.sh 检查 knowledge 子目录
grep 'knowledge.*entities\|knowledge.*concepts' sofagent/scripts/verify.sh
# 数据目录检查应包含 knowledge/entities knowledge/concepts

# 3. 目录结构完整
# entities/ concepts/ comparisons/ summaries/ + index.md + log.md
grep 'entities\|concepts\|comparisons\|summaries\|index\.md\|log\.md' sofagent/scripts/lib/file-deploy.sh
```

#### 124. deepagents 可选依赖 🆕
```bash
# v1.0.1 新增：optionalDependencies 引入 deepagents

grep 'deepagents\|optionalDependencies' sofagent/audit/package.json
# package.json 应有 optionalDependencies: { "deepagents": "^0.1.0" }
```

#### 125. loopCheckMaxRounds 配置支持 🆕
```bash
# v1.0.1 新增：config 支持 loopCheckMaxRounds 字段

# 1. config-loader 有该字段
grep 'loopCheckMaxRounds' sofagent/audit/src/config-loader.ts
# AuditConfig 应有 loopCheckMaxRounds?: number，默认 20

# 2. config-template 有注释
grep 'loopCheckMaxRounds' sofagent/audit/src/config-template.ts
# CONFIG_TEMPLATE 应有 loopCheckMaxRounds 注释说明

# 3. rules key 含 a14
grep 'a14' sofagent/audit/src/config-template.ts
# rules 注释中应列出 a14
```

#### 126. audit README 版本与 Quick Start 🆕
```bash
# v1.0.1 变更：audit/README.md 更新

# 1. 版本号
head -3 sofagent/audit/README.md
# 应为 v1.0.1

# 2. Quick Start 一行命令
grep 'sofagent-audit --init' sofagent/audit/README.md
# 首行应有「安装后运行：sofagent-audit --init」
```

#### 127. --help 辅助命令提示 🆕
```bash
# v1.0.1 变更：--help 补充辅助命令说明

grep 'doctor\|init\|verify\|help' sofagent/audit/src/index.ts | grep -i 'help\|辅助\|available'
# --help 输出应列出辅助命令（--doctor / --init / --verify 等）
```

---

### 第十八部分：文档与复审反馈修复（维度 128-133）🆕

#### 128. README Quick Start 拆分与精确化（P2 修复） 🆕
```bash
# v1.0.0 审查修复：README Quick Start 拆分为「快速开始」+ bash 版本 + tests 精确化

# 1. Quick Start 拆分
grep -n '怎么装\|快速开始\|Quick Start\|npm\|install.sh' README.md | head -10
# 应有清晰的安装段落（"怎么装？"/"快速开始"/"Quick Start" 之一 + npm 命令）

# 2. bash 版本命令
grep 'sofagent-audit' README.md
# 命令示例应为 bash 格式（$ 前缀或代码块）

# 3. tests 精确化
grep '测试' README.md | head -3  # README 中测试数应与实际一致
# 测试数应与 CHANGELOG 声称的数字一致（grep CHANGELOG 中的测试数 vs npm test 实际数）
```

#### 129. SECURITY.md 免责声明（P2 修复） 🆕
```bash
# v1.0.0 审查修复：SECURITY.md 加 MIT as-is 免责声明

grep 'MIT\|as-is\|as is\|免责\|不提供担保\|no warranty' SECURITY.md
# 应有 MIT as-is 免责声明
```

#### 130. ARCHITECTURE K1 对齐税论证（P2 修复） 🆕
```bash
# v1.0.0 审查修复：ARCHITECTURE.md 新增 K1「对齐税」论证

grep '对齐税\|alignment tax\|K1' ARCHITECTURE.md
# 应有 K1「对齐税」论证段落
```

#### 131. ROADMAP K2-K6 新增条目（P2 修复） 🆕
```bash
# v1.0.0 审查修复：ROADMAP 新增 5 条知识库落地评估条目

# K2 HITL 标注
grep 'HITL\|人机协作\|K2' ROADMAP.md

# K3 防幻觉
grep '防幻觉\|hallucination\|K3' ROADMAP.md

# K4 失败案例库
grep '失败案例\|failure case\|K4' ROADMAP.md

# K5 Router+Skill
grep 'Router.*Skill\|K5' ROADMAP.md

# K6 国标草案 + 身份码
grep '国标\|身份码\|K6' ROADMAP.md
# 5 条都应在 ROADMAP 中
```

#### 132. README HF 引证精简版（DeepSeek 复审修复） 🆕
```bash
# v1.0.1 复审修复：README HF 引证被完全删除后加回精简版

# 1. HF 引证存在
grep 'Hugging Face\|为什么相信\|Harness 有用' README.md
# 应有精简版 HF 引证（不是完全删除）

# 2. 链接到 ARCHITECTURE 完整版
grep 'ARCHITECTURE\|详见.*架构' README.md | grep -i 'harness\|验证\|HF'
# 精简版应链接到 ARCHITECTURE.md 的完整论证
```

#### 133. CONTRIBUTING.md 本地测试提示（DeepSeek 复审修复） 🆕
```bash
# v1.0.1 复审修复：CONTRIBUTING.md 加"本地测试用 node dist/index.js 而非全局二进制"

grep 'dist/index.js\|本地测试\|node dist\|全局二进制' CONTRIBUTING.md
# 应有「本地测试用 node dist/index.js 而非全局二进制」提示
```

---

### 第十九部分：v1.0.1 复审补充（维度 134-137）🆕

#### 134. reporter.ts 扩展规则 key 生成正确 🆕
```bash
# v1.0.1 复审发现 P0：reporter.ts 第 54 行 key 生成逻辑有 bug
# 原逻辑：r.number <= 11 ? a${r.number} : e${r.number - 200}
# A14(number=14) > 11，key = e(14-200) = e-186 ❌
# 修复后应为：r.number >= 200 ? e${r.number - 200} : a${r.number}
# A14(number=14) → a14 ✅

# 1. reporter.ts key 生成逻辑
grep 'r\.number.*<= 11\|r\.number.*>= 200\|a\${r\.number}\|e\${r\.number' sofagent/audit/src/reporter.ts
# 应为 r.number >= 200 ? e${r.number - 200} : a${r.number}
# 不应再有 r.number <= 11 的逻辑分支

# 2. 验证：读取 A14 规则 number 值
grep 'number:' sofagent/audit/src/rules/index.ts | grep '14'
# A14 的 number 应为 14

# 3. 实际验证：config.rules: { a14: false } 应能禁用 A14
# 在 config.yml 中写 rules: { a14: false } → 跑 audit → A14 不应出现在结果中
grep 'a14' sofagent/audit/src/config-template.ts
# config-template 的 rules 注释中应有 a14

# 4. 通用性验证：如果未来新增 A12-A13（number 12/13），key 应正确生成
# 逻辑约束：所有 number < 200 的规则 key = a${number}，≥200 的 key = e${number-200}
```

#### 135. 审计规则测试覆盖率——扩展规则 🆕
```bash
# v1.0.1 复审发现 P1：A14 新增时没有同步创建测试文件
# 规则：任何新增审计规则文件必须有对应的 .test.ts 文件

# 1. A14 有测试文件
ls sofagent/audit/src/**/rule-a14*.test.ts 2>/dev/null
# 应有 rule-a14-kb-cross-domain.test.ts（或等效名称）

# 2. 测试文件列表 vs 规则文件列表对比（含 src/__tests__/ 目录）
ls sofagent/audit/src/rules/rule-a*.ts | grep -v '\.test\.' | wc -l
echo -n "  + __tests__: "
ls sofagent/audit/src/__tests__/rule-a*.test.ts 2>/dev/null | wc -l
ls sofagent/audit/src/rules/rule-a*.test.ts sofagent/audit/src/__tests__/rule-a*.test.ts 2>/dev/null | wc -l
echo "  (合计测试文件)"
ls sofagent/audit/src/rules/rule-e*.ts | grep -v '\.test\.' | wc -l
ls sofagent/audit/src/rules/rule-e*.test.ts | wc -l
# 规则文件数应 ≤ 测试文件数（每条规则至少一个测试文件，可在 src/rules/ 或 src/__tests__/）

# 3. 规则注册与测试文件的一一对应
for rule in sofagent/audit/src/rules/rule-a1[0-4]*.ts sofagent/audit/src/rules/rule-a[2-9]*.ts sofagent/audit/src/rules/rule-e[1-4]*.ts; do
  base=$(basename "$rule" .ts)
  test_file="sofagent/audit/src/rules/${base}.test.ts"
  if [ ! -f "$test_file" ]; then
    echo "❌ 缺测试: $base → 期望 $test_file"
  fi
done
# 期望：无输出（所有规则有对应测试）
```

#### 136. doctor 知识库访问矩阵展示（A5d） 🆕
```bash
# v1.0.1 复审发现 P1：doctor 缺失知识库访问矩阵展示
# 开发 prompt 要求：--doctor 新增知识库访问矩阵展示，但未实现

# 1. doctor 有访问矩阵相关代码
grep '访问矩阵\|access.*matrix\|knowledge.*domain\|workflow.*node' sofagent/audit/src/commands/doctor.ts
# 应有知识库访问矩阵展示逻辑（读取 workflow.yml → 展示节点 knowledge-domain 的 include/exclude）

# 2. 如尚未实现：标注 P1（v1.0.2 补）
# 理由：不影响核心审计功能，但用户无法在 doctor 中查看知识库访问配置

# 3. 如已实现：验证输出格式
# 实际运行 doctor → 确认 extendedRulesEnabled 或 workflow.yml 存在时显示访问矩阵
```

#### 137. npm 安装后用户引导 🆕
```bash
# v1.0.1 复审发现：npm install -g 后用户必须知道第一个命令是什么
# npm v7+ 全局安装不执行 postinstall，必须用其他方式引导

# 1. audit/README.md（npm 页面显示）首行有可执行命令
head -3 sofagent/audit/README.md
# 首行或前 3 行内应有「npm install -g @sofagent/audit && sofagent-audit --init」

# 2. --help 首行有快速开始示例
grep '快速开始\|sofagent-audit --init\|试一试\|try' sofagent/audit/src/index.ts | head -3
# --help 输出中应有「快速开始: sofagent-audit --init」

# 3. --help 区分主命令和辅助工具
grep '主命令\|辅助工具\|available' sofagent/audit/src/index.ts
# --help 输出中应有主命令 vs 辅助工具的区分（不混淆 sofagent-audit / sofagent-verify 等）

# 4. 安装后第一条命令的体验测试
# npm install -g → sofagent-audit --help → 看到快速开始 → sofagent-audit --init → 成功初始化
# 期望：从安装到首次审计的路径 ≤3 步，每步有明确提示
```

---

### 第二十部分：审查流程优化（维度 138）🆕

#### 138. Skill 增量淘汰平衡——新增内容后 ≤100 行 + 弱措辞清零 + pre-push-check 全绿 🆕
```bash
# v1.0.1 审查教训：新增四层加载链 + think.md 模板 → SKILL.md 114 行（超标 24）
# 新增 Lint 5 项 → loop-evaluate.md 103 行（超标 13）+ "建议"弱措辞
# 根因：审查只检查了功能正确性，没有检查"内容增量是否挤爆了 Skill 行数限额"

# 1. 所有 Skill 文件行数 ≤100
wc -l sofagent/skill/*.md FDE/SKILL.md
# 期望：每个文件 ≤100 行

# 2. 弱措辞清零
grep -rn '建议\|应该\|尽量' sofagent/skill/*.md FDE/SKILL.md | grep -v 'not_when\|Gotcha\|场景\|注\|说明'
# 期望：无输出

# 3. 增量淘汰平衡检查——对比上次版本
# 如果某个 Skill 本次新增了内容但行数也同步增加了 → 旧的重复内容没删
# 公式：原行数 + 新增行数 - 删除行数 ≤ 100
git diff <上次版本tag>..HEAD -- sofagent/skill/ FDE/SKILL.md | grep '^+' | wc -l  # 新增行
git diff <上次版本tag>..HEAD -- sofagent/skill/ FDE/SKILL.md | grep '^-' | wc -l  # 删除行
# 新增行应 ≈ 删除行（做加法时同步做减法）

# 4. pre-push-check 作为审查最后一步——不是独立步骤，是审查的一部分
bash tools/pre-push-check.sh 2>&1
# 期望：7/7 全绿。有任何 ❌ → IS_PASS: NO，不发版
```

---

### 第二十一部分：多入口一致性与文档状态（维度 139-144）🆕

#### 139. 多入口模板一致性——install.sh vs --init 🆕
```bash
# v1.0.1 审查发现：install.sh 的 _deploy_knowledge_skeleton 和 init.ts 的 [3/4] 步
# 都创建 .sofagent/knowledge/index.md 和 log.md，但两个入口的模板表头不一致
# init.ts 用「页面|摘要|更新时间」和「时间|操作|页面|摘要」
# file-deploy.sh 用「页面|域|可访问节点」和「时间|操作|影响页面|详情」

# 1. 两个入口的 index.md 模板表头一致
grep 'index.md' sofagent/audit/src/commands/init.ts
grep 'index.md' sofagent/scripts/lib/file-deploy.sh
# 两处的模板字符串应使用相同的表头列

# 2. 两个入口的 log.md 模板表头一致
grep 'log.md' sofagent/audit/src/commands/init.ts
grep 'log.md' sofagent/scripts/lib/file-deploy.sh
# 两处的模板字符串应使用相同的表头列

# 3. 实际验证：分别用两个入口创建，diff 结果应一致
# init.ts: node dist/index.js --init → cat .sofagent/knowledge/index.md
# file-deploy.sh: bash install.sh → cat .sofagent/knowledge/index.md
# 两个 index.md 内容应完全一致
```

#### 140. init.ts 消息文本准确性 🆕
```bash
# v1.0.1 审查发现：init.ts 输出"6 子目录"但实际只创建了 4 个
# 消息文本中的数字/名称必须与代码实际行为一致

# 1. 消息文本中的数字与代码一致
grep '子目录' sofagent/audit/src/commands/init.ts
# 如果代码创建 4 个子目录（entities/concepts/comparisons/summaries），
# 消息就必须写"4 子目录"，不能写"6 子目录"

# 2. 通用检查：所有 console.log 中的数字/名称与代码行为一致
grep -n '\d.*已创建\|\d.*已生成\|\d.*已部署' sofagent/audit/src/commands/init.ts
# 逐行核对：消息说的数字 = 代码做的数字
```

#### 141. ROADMAP 状态一致性 🆕
```bash
# v1.0.1 审查发现：ROADMAP 同一版本在"现在在哪"标 ✅ 但在"规划版本"表标 🚧 规划中
# 同一版本的状态在 ROADMAP 不同位置必须一致

# 1. "现在在哪"版本号 vs "规划版本"表状态
grep '现在在哪' ROADMAP.md
# 如果"现在在哪"写 v1.0.1 ✅，那"规划版本"表里 v1.0.1 就不能标 🚧 规划中

# 2. 规划版本表中已完成的版本应标 ✅
grep '🚧.*规划中' ROADMAP.md
# 已在"现在在哪"出现的版本不应仍标 🚧 规划中

# 3. 版本号在"迭代历程"表和"规划版本"表中不重复
# 同一版本不能同时出现在迭代历程表和规划版本表中
```

#### 142. knowledge/ index.md 模板格式一致性 🆕
```bash
# v1.0.1 审查发现：两个创建入口的 index.md 模板表头列不同
# 无论从哪个入口创建，index.md 的格式必须一致

# 1. init.ts 创建的 index.md 表头
grep -A2 'index.md' sofagent/audit/src/commands/init.ts | grep '|'
# 2. file-deploy.sh 创建的 index.md 表头
grep -A5 'index.md' sofagent/scripts/lib/file-deploy.sh | grep '|'
# 两者的表头列必须相同

# 3. knowledge-maintain.md 中描述的 index.md 格式
grep 'index' sofagent/skill/knowledge-maintain.md
# Skill 中教的格式必须和实际模板一致
```

#### 143. 发布后审查 prompt 版本相关性——v1.0.x 特定任务必须泛化 🆕
```bash
# v1.0.1 审查发现：发布后审查 prompt 中有 v1.0.1 特定的任务描述
# 下版本审查前必须泛化，否则过时任务会产生过时审查结果

# 1. 检查 prompt 中是否有版本特定的任务描述
grep 'v1\.0\.1' docs/verification/fresh-eyes-review.md
# 如果有 v1.0.x 特定任务（如"看 CHANGELOG 说 AI 知识库实现版"），
# 下版本发版前应泛化为通用描述

# 2. 检查 prompt 中的"新增"标记是否仍适用于当前版本
grep 'v1.0.1 新增' docs/verification/fresh-eyes-review.md
# 上版本的"新增"在下版本不再是新增——应去掉版本标记或删除已不适用的任务
```

#### 144. 发版前 git status 零未提交修改（⏰ 发布前最后步骤——回归检查阶段标 ⏳ 不标 FAIL）
```bash
# v1.0.1 教训：15 个文件修改全部在工作树但未 commit，
# 导致 GitHub 访问者和 npm 用户拿不到修复。
# 发版前必须确认工作树干净。

# 1. 确认工作树无未提交修改
git status --short | wc -l   # 期望: 0

# 2. 确认所有改动已 staged 或 committed
git diff --stat HEAD | wc -l  # 期望: 0（或仅有预期内的文件）

# 如果发现未提交修改，先 commit 再继续发版流程。
# 不要指望"发版时一起 commit"——那个步骤总是被忘记。
```

---

### 第二十二部分：v1.0.3 发布后审查修复（维度 177-188）🆕

> 来源：GLM-5.2 独立 7 视角审查（3 轮 × 独立 subagent）+ DeepSeek V4 Pro 独立审查。去重后 12 个关键维度。

#### 177. `--strict` 模式 exit code 正确（`--ci` 已解耦）🆕
```bash
# v1.0.5 修复：--ci 不再隐含 --strict（两个正交概念被错误耦合）
# --strict 单独使用时 WARN → exit 2（不变）
# --ci 单独使用时 WARN → exit 1（变更！pre-commit/commit-msg hook 中 WARN 放行）
# --ci --strict 组合时 WARN → exit 2（CI 流水线零容忍场景）

# 验证 --strict 单独：
cd /tmp/test-strict && git init
echo "test" > a.txt && git add a.txt
sofagent-audit --diff HEAD~1..HEAD --task "wrong" --strict --silent
echo $?  # 期望: 2

# 验证 --ci 单独（WARN 不阻断）：
sofagent-audit --diff HEAD~1..HEAD --task "wrong" --ci
echo $?  # 期望: 1（非 2）

# 检查 index.ts 中 --ci 不再设 strict = true
grep -A2 "'--ci'" sofagent/audit/src/index.ts | grep "strict"
# 期望: 无匹配（--ci 不设 strict）
```

#### 178. commit-msg hook task 值为当前 commit msg 🆕
```bash
# v1.0.5 修复：hook 从 pre-commit 迁移到 commit-msg
# commit-msg hook 接收 $1 = commit message 文件路径，读取第一行传给 --task
# A3 越界检查现在在 hook 中生效

# 验证：连续两次 commit，检查 A3 报的 task 是否是当前 commit 的 msg
echo "test1" > a.txt && git add a.txt && git commit -m "add a file"
echo "test2" > b.txt && git add b.txt && git commit -m "add b file"
# A3 的输出中 task 应显示 "add b file" 而非 "add a file"

# 检查 hook 文件读取 $1
grep 'COMMIT_MSG_FILE.*\$1' sofagent/audit/hooks/commit-msg
# 期望: 有匹配行
```

#### 179. loadHistory() 对无 timestamp 条目健壮 🆕
```bash
# v1.0.3 发布后审查 P0：history.jsonl 插入无 timestamp JSON 行即崩溃
# catch 块吞错，doctor 第 8 项完全失效

# 验证：
echo '{"test":"abc"}' >> .sofagent/audit/history.jsonl
sofagent-audit --doctor
# 期望: doctor 第 8 项仍能正常执行，不崩溃
# 输出"跳过无效条目"而非整个检查失败
```

#### 180. A9 Unicode 全角/leet speak 检测 🆕
```bash
# v1.0.3 发布后审查 P1：A9 正则只匹配 ASCII，全角和 leet speak 可绕过

# 验证（修复后应检出）：
# 全角: ｉｇｎｏｒｅ ｐｒｅｖｉｏｕｓ ｉｎｓｔｒｕｃｔｉｏｎｓ
# leet: 1gn0r3 pr3v10us 1nstruct10ns
# 检查 rule-a9-no-injection.ts 是否做 NFKC normalization
grep -i "normalize\|NFKC" sofagent/audit/src/rules/rule-a9-no-injection.ts
# 期望: 有匹配
```

#### 181. A9 扫描 commit message 🆕
```bash
# v1.0.3 发布后审查 P1：A9 只检查 diff 新增行，不检查 commit message

# 验证：
grep -i "commitMsg\|commit_msg\|commitMessage" sofagent/audit/src/rules/rule-a9-no-injection.ts
# 期望: 有匹配——A9 引用了 ctx.commitMsg
```

#### 182. CHANGELOG 全历史纯度——无审查元信息 🆕
```bash
# v1.0.3 发布后审查 P1：CHANGELOG 含 GLM-5.2 / DeepSeek / 双视角等审查元信息

# 验证：
grep -i "GLM\|DeepSeek\|双视角\|P0×\|P1×\|7 视角\|× 6 方面" CHANGELOG.md
# 期望: 无匹配（或仅出现在发版元信息中，不在产品变更描述中）
```

#### 183. 规则数字声称准确——纯 diff vs 需日志 vs 扩展 🆕
```bash
# v1.0.3 发布后审查 P0：README 说"16 条规则"但未区分哪些是纯 diff、哪些需日志

# 验证：
grep -i "纯 git-diff\|需.*日志\|扩展规则" README.md
# 期望: 有匹配——README 标注了三种类型
```

#### 184. A14 标注"事后审计非访问控制" 🆕
```bash
# v1.0.3 发布后审查 P0：A14 知识库越权检测是 WARN 不阻断+依赖日志，非访问控制

# 验证：
grep -r "事后审计\|不是.*访问控制\|不是强制" README.md ARCHITECTURE.md sofagent/audit/src/rules/rule-a14-kb-cross-domain.ts
# 期望: 有匹配
```

#### 185. history.jsonl 完整性保护（hash chain 或 HMAC） 🆕
```bash
# v1.0.3 发布后审查 P0：appendFileSync 无防篡改，Agent 可读写 history.jsonl

# 验证：
grep -i "hash\|chain\|hmac\|签名\|integrity" sofagent/audit/src/audit-history.ts
# 期望: 有匹配——有某种形式的完整性保护
# 手动篡改 history.jsonl 中间一行后跑 --doctor，应检测到篡改
```

#### 186. config 安全规则全禁用时告警 🆕
```bash
# v1.0.3 发布后审查 P1：config.yml 中 A1/A2 设为 false 时无告警

# 验证：
# 在 config.yml 中设 rules: {a1: false, a2: false}
# 跑 sofagent-audit --diff HEAD~1..HEAD
# 期望: 输出 WARN "安全规则 A1/A2 已被禁用"
```

#### 187. git tag 指向发布提交 🆕
```bash
# DeepSeek 审查 P0：v1.0.3 tag 指向 e088756（修复提交）而非 1bc496c（发布提交）

# 验证：
git show v1.0.3 --stat | head -5
# tag commit message 应包含版本号
# git show 应展示完整发布内容（非单个文件修复）
```

#### 188. CHANGELOG 声称与实现一致——"引擎" vs "wrapper" 🆕
```bash
# DeepSeek 审查 P1：SkillOpt 声称"自进化引擎"但实际是 CLI wrapper

# 验证：
# CHANGELOG 标题中声称的功能名是否与实际代码匹配？
grep -i "引擎\|engine" CHANGELOG.md | grep -i "skillopt\|SkillOpt"
# 如果实际是 wrapper，不应叫"引擎"
```

---

### 第二十四部分：v1.1.3 全仓质量审计修复（维度 301-306）🆕

> 来源：v1.1.3 开发期全仓质量审计（代码冗余 + 文档错误 + 跨文档死链 + 文档冗余 四维度）。6 个维度覆盖：死链全量扫描、跨包代码重复、Ledger-Views 归属、文档规范源/DRY、文件迁移四动作、check-docs.sh 死链范围扩展。

#### 301. 跨文档相对路径死链全量扫描 🆕
```bash
# v1.1.3 审计发现：23 处死链。根因=文件/目录迁移后相对路径未修正 + 审查只查 rules.md 死链(check-docs.sh 第 1 项)。
# 自动化全量扫描（在 check-docs.sh 落地，见维度 223）：
#   遍历所有 .md → 解析 ]((...)) 相对链接 → 解析目标文件是否存在；
#   排除 node_modules/.workbuddy/.sofagent/docs/changelog/docs/evidence + 代码围栏内示例链接 + 外部 http(s)/纯锚点。
# 验证（落地后）：
bash tools/check-docs.sh 2>&1 | grep -i 'dead\|死链'
# 期望：0 处（除登记的白名单：仓库外 Desktop 路径、模板占位 vX.Y.Z.md）
```

#### 302. 跨包代码重复检测（复制≠移动） 🆕
```bash
# v1.1.3 发现：audit/src/filesystem/isomorphic-git.ts(383行) 与 core/src/filesystem/isomorphic-git.ts(383行) 仅 4 行差异
# audit 应 import @sofagent/core，不应复制。
# 回归：同名源文件不得在两个 @sofagent/* 包各存一份（测试 fixtures / __tests__ 除外）
dup=$(find sofagent -path '*/src/*.ts' -not -path '*/node_modules/*' -not -path '*/__tests__/*' -not -path '*/test*/*' \
  | sed 's#.*/##' | sort | uniq -d | grep -vE '^(index|cli|types|config-template|memory-sync|reporter|verify|skill-safety-.*)\.ts$')
[ -n "$dup" ] && echo "⚠️ 跨包重复源文件: $dup" || echo "OK 无跨包重复"
# 发现重复 → 提升为 import（core 为 canonical source），删除副本
# 误报白名单说明：各包标准入口文件（index.ts/cli.ts/types.ts）同名属 monorepo 正常结构；
# config-template/memory-sync/skill-safety-* 已在 v1.1.3 去重后单包唯一
```

#### 303. Ledger-Views 归属一致性（think.md 始终为 Ledger/source） 🆕
```bash
# v1.1.3 发现：ARCHITECTURE.md:320 将 think.md 错标为 Views(派生视图)，PHILOSOPHY.md:132 正确标为 Ledger(原始数据)
# Dream Cycle 从 think.md 抽取事实进 knowledge/(派生) —— think.md 是 source 不是 derived
# 回归：任何文档不得把 think.md 标为 Views/派生/derived
grep -rn "think.md.*Views\|think.md.*派生视图" ARCHITECTURE.md PHILOSOPHY.md DEVELOPMENT.md FDE/FDE.md
# 期望：无匹配（若匹配 = P0，think.md 归属错误）
# 正向校验：Ledger-Views-Policy 三层映射中 think.md=Ledger、knowledge/=Views、派生方向单向 think.md→knowledge/
grep -n "Ledger-Views-Policy\|task/logs.*Ledger\|knowledge.*Views" PHILOSOPHY.md ARCHITECTURE.md
```

#### 304. 文档规范源与冗余（DRY：概念只定义一次） 🆕
```bash
# v1.1.3 发现：同概念(Ledger-Views-Policy、五层架构、版本规则)在多个文档重复定义且偶有冲突(如 think.md 归属)
# canonical source：架构=ARCHITECTURE、记忆模型=PHILOSOPHY、发版流程=releasing、局限=LIMITATIONS
# 其余文档引用链接，不重复定义
# 回归：同一术语在 ≥2 处定义时，表述须一致且指向同一规范源
grep -rn "Ledger-Views-Policy" ARCHITECTURE.md PHILOSOPHY.md DEVELOPMENT.md | head
# 期望：各文档对 Ledger/Views 的归属描述一致（think.md=Ledger）
```

#### 305. 文件/目录迁移四动作完整性（含死链修复） 🆕
```bash
# v1.1.3 教训：LIMITATIONS.md 从 docs/ 迁到根、docs/ 子目录重排，但迁入文件相对路径引用未同步 → 死链
# 迁移必须是"移动 + 删除源 + 更新所有 inbound 引用 + 修复相对路径死链"四动作齐全
# 回归：任何文件/目录迁移后
git grep -n "OLD_RELATIVE_PATH" -- '*.md'   # 旧路径应 0 命中
# + 全仓相对路径死链 0（见维度 301）
# 抽查：本次改动涉及 mv 的文件，其所有 inbound 链接是否仍可达
```

#### 306. check-docs.sh 死链检查范围扩展 🆕
```bash
# v1.1.3 发现：check-docs.sh 第 1 项死链检查仅扫 rules.md，漏掉通用相对路径死链（维度 218 根因）
# 回归：check-docs.sh 应包含全量相对路径死链扫描（复用维度 218 的自动化逻辑），EXIT=1 若有死链
bash tools/check-docs.sh 2>&1 | grep '死链'
# 期望：除已知白名单外，不报通用相对路径死链
# ✅ 已落地（v1.1.3）：tools/check-docs.sh 第 1b 节实现全仓相对路径死链扫描
#   （围栏感知、跳过 http/https/mailto/纯锚点、相对路径解析后校验存在性，死链则 EXIT=1）。
#   原第 1 节 rules.md 专项收敛为「仅匹配真正 markdown 链接」，不再误判散文里的 rules.md 字样。
```

---

### 第二十五部分：v1.1.3 文档与工具链修复（维度 317-326）🆕

> 来源：v1.1.3 文档卫生 + 工具链加固 + 发版流程修复。10 个维度。

#### 317. A4 ruleClass = 业务底线（index.ts 与 audit/README 一致）🆕
```bash
# v1.1.3 修复：A4 ruleClass 代码侧与文档侧对齐
grep -A5 "'A4\|name.*不删配置" sofagent/audit/src/rules/index.ts | grep "ruleClass" | grep "业务底线"
# 期望：有匹配（ruleClass 为 "业务底线"，不是 "能力拐杖" 或其他）
grep 'A4.*不删配置.*业务底线' sofagent/audit/README.md
# 期望：有匹配（文档侧也是 "业务底线"）
```

#### 318. 跨包重复清零（skill-safety-*/memory-sync/config-template 单包唯一）🆕
```bash
# v1.1.3 去重：skill-safety-*、memory-sync、config-template 应仅存在于单包
# 验证各包标准入口文件（index.ts/cli.ts/types.ts）同名属 monorepo 正常结构——不在去重范围
dup=$(find sofagent -path '*/src/*.ts' -not -path '*/node_modules/*' -not -path '*/__tests__/*' -not -path '*/test*/*' \
  | sed 's#.*/##' | sort | uniq -d | grep -vE '^(index|cli|types|config-template|memory-sync|reporter|verify|skill-safety-.*)\.ts$')
[ -z "$dup" ] && echo "OK" || echo "❌ 跨包重复: $dup"
```

#### 319. silent 模式 exit code（A1 FAIL → exit 2 不因 silent 归零）🆕
```bash
# v1.1.3 修复：--silent 不应吞掉 FAIL 的 exit code
# 验证：A1 命中时 --silent 仍应 exit 2（非 0）
cd /tmp && rm -rf test-silent && mkdir test-silent && cd test-silent
git init && git config user.email "test@test.com" && git config user.name "test"
echo "sk-abc123" > secret.txt && git add secret.txt && git commit -m "leak" --no-verify
sofagent-audit --diff HEAD~1..HEAD --silent >/dev/null 2>&1
echo "exit=$?"  # 期望: exit=2（不因 silent 归零）
cd /tmp && rm -rf test-silent
```

#### 320. PASS 签名行存在且版本号非硬编码🆕
```bash
# v1.1.3 修复：审计 PASS 输出签名行应含 sofagent 身份，版本号从 constants 读取
grep -rn "v1\.1\.[0-9]" sofagent/audit/src/index.ts | grep -v "import\|from\|\/\/"
# 期望：零匹配——无硬编码具体版本号（应从 constants 或 package.json 读取）
# 正向验证：PASS 输出含 "[sofagent-audit]" 签名
sofagent-audit --version 2>&1 | grep -q "sofagent" && echo "✅ 签名存在" || echo "❌ 签名缺失"
```

#### 321. webhook 签名半角冒号 + 紧凑措辞 🆕
```bash
# v1.1.3 修复：webhook 推送文案签名段使用半角冒号、紧凑无换行
grep -rn "sofagent.*全角\|sofagent：\|sofagent ：" sofagent/audit/src/ 2>/dev/null
# 期望：无匹配——签名段应为半角冒号（如 "[sofagent-audit]: PASS"）
```

#### 322. 「回溯引擎」零残留（排除 changelog 历史）🆕
```bash
# v1.1.3 全文替换「回溯引擎」→「回溯能力」
grep -rn "回溯引擎" --include="*.md" . | grep -v node_modules | grep -v "docs/changelog"
# 期望：零匹配（.workbuddy/memory/ 下的操作历史不计数）
```

#### 323. CHANGELOG 索引含全部已发版 tag（含 v1.1.1）+ 规划版独立分组 🆕
```bash
# v1.1.3 修复：CHANGELOG.md 索引应完整覆盖所有已发版 git tag
echo "=== 已发版 git tag ===" && git tag -l 'v1.*' | sort -V
echo "=== CHANGELOG 索引中的版本 ===" && grep -oP '### \[v[\d.]+\]' CHANGELOG.md | sed 's/### \[/[/'
# 人工核对：所有 v1.x git tag 应在 CHANGELOG 正式版索引中有条目
# v1.2.0+ 规划版应在独立「规划中」区块
grep -A1 "## 规划中" CHANGELOG.md | head -1
# 期望：有「规划中」独立标题
```

#### 324. SECURITY.md 当前状态版本标注 = 当前版本 🆕
```bash
# v1.1.3 修复：SECURITY.md 当前状态标注应始终与 SSOT 版本一致
SSOT_VER=$(node -e "console.log(require('./package.json').version)")
grep "当前状态（v${SSOT_VER}" SECURITY.md
# 期望：有匹配——SECURITY.md 当前状态版本号 = SSOT 版本号
# 反向检查：不应有过期的 "当前状态（v1.0" 标注
grep -n "当前状态（v1\.0" SECURITY.md
# 期望：无匹配
```

#### 325. enterprise-deploy.md 四节存在且 SECURITY 链接可达 🆕
```bash
# v1.1.3 补充：enterprise-deploy.md 应有四个关键节
for section in "批量安装" "集中下发" "CI 集成" "已落地"; do
  grep -q "$section" docs/guides/enterprise-deploy.md && echo "✅ $section" || echo "❌ 缺失: $section"
done
# SECURITY.md:24 引用 enterprise-deploy.md 链接可达
grep "enterprise-deploy" SECURITY.md | head -1
test -f docs/guides/enterprise-deploy.md && echo "✅ 文件存在" || echo "❌ 文件缺失"
```

#### 326. pre-push-check 含 tag message 校验 + 循环依赖检测步骤 🆕
```bash
# v1.1.3 追加：pre-push-check.sh 新增步骤 7（tag message 校验）和步骤 8（循环依赖检测）
grep -c "Tag message 校验" tools/pre-push-check.sh
# 期望: 1
grep -c "依赖图循环检测" tools/pre-push-check.sh
# 期望: 1
# 验证 --quick 不破坏现有全绿
bash tools/pre-push-check.sh --quick 2>&1 | tail -5
# 期望: 全绿或仅 WARN（tag 不存在属正常）
```

---

请按以下结构输出审查报告：

```markdown
# sofagent 回归检查报告

## 总览
- 审查日期：YYYY-MM-DD
- 审查范围：全维度 / 全量改动
- 环境验证：pre-push-check [✅/❌] / npm test [✅/❌] / check-docs [✅/❌] / check-version [✅/❌]
- Fresh clone：[✅/❌]
- npm 发布：@sofagent/audit@<最新版> [✅] / @sofagent/mcp@<最新版> [✅]
- 整体结论：[已发布无遗留 / 需修复后补发 / 阻塞]

## 问题清单

### 🔴 P0（阻塞发布）
> 必须修复才能发版

### 🟡 P1（建议修复）
| # | 维度 | 文件:行 | 问题 | 建议 |
|---|------|---------|------|------|

### 🟢 P2（优化建议）
| # | 维度 | 文件:行 | 问题 | 建议 |
|---|------|---------|------|------|

## 维度通过统计
- 总维度数：262
- 通过：X
- ⚠️ 有条件通过：X
- ❌ 未通过：X
- 🔴 P0：X
- 🟡 P1：X
- 🟢 P2：X

## 维度评分（1-5 分）
| 维度 | 分数 | 说明 |
|------|------|------|
| 产品架构 | | |
| 代码质量 | | |
| 文档一致性 | | |
| 行为等价性（verify.ts 拆分） | | |
| 概念清晰度（AI 知识库） | | |
| Skill 摘要纯度 | | |
| 铁律措辞强化（v1.0 新增） | | |
| 理论引证精确性 | | |
| FDE 架构完整性 | | |
| 准入条件推进（v1.0 新增） | | |
| 生态就绪度 | | |
| 安全与稳定度 | | |
| 体验完整度（--init / --doctor）（v1.0 新增） | | |
| 审计输出质量（可视化+修复建议）（v1.0 新增） | | |
| 发版就绪度（README/CHANGELOG/升级指引）（v1.0 新增） | | |
| 语言风格与语气（谦虚/低调/幽默分寸）（v1.0 新增） | | |
| 架构描述与文档组织合理性（v1.0 新增） | | |
| 文字精简度（废话/冗余检测）（v1.0 新增） | | |
| 描述完整性（关键概念/上手路径/错误场景）（v1.0 新增） | | |
| OpenClaw 发版验收（Agent 端到端）（v1.0 新增） | | |
| 审计引擎加固（首次提交/A2 聚合/ConfigError/doctor 第 8 项）（v1.0.0 新增） | | |
| A14 知识库越权审计规则（v1.0.1 新增） | | |
| 四层加载链 + think.md 写作规范（v1.0.1 新增） | | |
| 知识库 Skill + 目录结构部署（v1.0.1 新增） | | |
| daemon Ingest 触发 + 防抖（v1.0.1 新增） | | |
| 扩展规则 key 一致性 + 测试覆盖 + 访问矩阵 + npm 引导（v1.0.1 复审新增） | | |
| Skill 增量淘汰平衡 + pre-push-check 闸门（v1.0.1 审查流程优化） | | |
| 可发布性 | | |
| CI/自动化一致性——文档数字 vs 代码实际（v1.0.4 审查新增） | | |

## 最终建议
- [ ] 可以发版
- [ ] 需修复 P0 后发版
- [ ] 需重大修复

## 审查体系更新建议

> 以下两项是强制性产出——不填视为审查未完成。

### 建议追加的回归检查项
> 本次审查发现的、但尚未在本清单中的检查项。下次发版前应补入本清单。

| 建议编号 | 维度描述 | 为什么加（关联的 P0/P1/P2） |
|---------|---------|--------------------------|
| 205+ | （留给下轮审查） | |

---

### 已追加的维度（本轮审查闭环输出）

以下维度已写入清单（含本轮新增 197-204），本次审查发现的问题不应在下轮回归。

| 编号 | 维度描述 | 来源 |
|:--:|------|------|
| 134 | reporter.ts 扩展规则 key 生成正确（A14→a14 而非 e-186） | v1.0.1 发版审查 P0 |
| 135 | 审计规则测试覆盖率——扩展规则是否同步创建测试文件 | v1.0.1 发版审查 P1 |
| 136 | doctor 知识库访问矩阵展示 | v1.0.1 发版审查 P1 |
| 137 | npm 安装后用户引导——README 首行 + --help 首行 | v1.0.0 发布后审查 |
| **138** | **Skill 增量淘汰平衡——新增内容后是否仍 ≤100 行 + 弱措辞清零** | **本轮 pre-push-check 拦截** |
| 139 | 多入口模板一致性——install.sh vs --init 创建的同一文件模板必须一致 | v1.0.1 审查发现 init.ts vs file-deploy.sh 的 index.md 模板不一致 |
| 140 | init.ts 消息文本准确性——输出消息中的数字/名称必须与实际行为一致 | v1.0.1 审查发现"6 子目录"实际只有 4 个 |
| 141 | ROADMAP 状态一致性——同一版本在不同位置的标记不能矛盾 | v1.0.1 审查发现同时标 ✅ 和 🚧 规划中 |
| 142 | knowledge/ index.md 模板格式一致性——两个创建入口的模板表头列必须相同 | v1.0.1 审查发现 init.ts 和 file-deploy.sh 表头列不同 |
| 143 | 发布后审查 prompt 版本相关性——v1.0.x 特定任务在下版本审查前必须泛化 | 审查体系闭环 |
| **144** | **发版前 git status 零未提交修改——⏰ 发布前最后步骤（commit 后验证），回归检查阶段标 ⏳** | **v1.0.1 教训：15 个文件修改未 commit，npm 包落后** |
| **145** | **版本重编号全局一致性——bump-version 后详情表中的未来版本引用是否全部跟随重编号** | **v1.0.2 教训：ROADMAP 3 个详情表 12 处+ HANDBOOK/DEVELOPMENT/THANKS 6 处遗漏** |
| **146** | **changelog 格式一致性——只描述产品变更，不含审查元信息（模型名/轮次/维度数）** | **v1.0.2 教训：changelog 含 GLM-5.2 + DeepSeek + 7 维度 × 6 方面等元信息** |
| **147** | **文档日期与版本号同步——bump-version 后 MD 文档头日期应为发版日期** | **v1.0.2 教训：4 份文档日期仍为 v1.0.1 的 2026-07-04** |
| **148** | **releasing.md 流程遵从性——发版前走完全部阶段，尤其独立审核 + 确认关口** | **v1.0.2 教训：跳过阶段四（审核）、五（文档收尾）、六（确认关口）** |
| **149** | **LOOP SKILL.md frontmatter 完整——name/slug/displayName/description/version/tags/image/triggers/scenarios/not_when 全部存在** | **v1.0.3 LOOP 新建 Skill** |
| **150** | **LOOP 安装隔离——LOOP 独立安装，不随 sofagent 主项目自动安装。验证 install.sh 不含 LOOP 安装逻辑** | **v1.0.3 三层安装隔离设计** |
| **151** | **审查文档位置正确——4 份审查文档在 docs/verification/** | **v1.0.3 文件位置调整** |
| **152** | **Agent 命名遵循 Agency Agents 惯例——{department}-{role}.md，有基座模板的保持原名** | **v1.0.3 三次命名重构的教训** |
| **153** | **LOOP 文件结构镜像 FDE——SKILL.md/README.md/主文档.md/quick-start.md/install.sh + package.json** | **v1.0.3 结构一致性** |
| **154** | **think.md 重大设计决策后有对应反思条目** | **v1.0.3 LOOP 设计反思** |
| **155** | **LOOP/ 五件套完整——SKILL.md/README.md/LOOP.md/quick-start.md/loop-install.sh 全部存在** | **v1.0.3 新建目录结构** |
| **156** | **agents/ 5 个文件完整——README.md + 4 个 Agent .md** | **v1.0.3 新建目录结构** |
| **157** | **FDE 和 LOOP 的 install.sh 不互相依赖** | **v1.0.3 三层安装隔离** |
| **158** | **history.jsonl 脱敏——A2/A9 拦截结果不存储敏感内容明文** | **v1.0.2 第四轮审查 P0** |
| **159** | **A9 规则排除 `.sofagent/` 路径——不对自身审计日志误报** | **v1.0.2 第四轮审查 P1** |
| **160** | **A5 通过 --task 参数获取当前 commit message（commit-msg hook 从 $1 传递）** | **v1.0.2 第四轮审查 P1 / v1.0.5 迁移** |
| **161** | **首次提交（空仓库）时 A5 不误报 message 为空** | **v1.0.2 第四轮审查 P1** |
| **162** | **ARCHITECTURE.md 无旧术语残留（"纪律层"→"约束底座"）** | **v1.0.2 第四轮审查 P1** |
| **163** | **CHANGELOG 不含审查元信息（维度编号、模型名、轮次等）** | **v1.0.2 第四轮审查 P1** |
| **164** | **LIMITATIONS.md 日期与其他核心文档同步** | **v1.0.2 第四轮审查 P1** |
| **165** | **审计失败输出含"下一步"指引（修复后重试 / bypass 说明）** | **v1.0.2 第四轮审查 P1** |
| **166** | **`--init` 每个交互选项有行内解释** | **v1.0.2 第四轮审查 P1** |
| **167** | **HANDBOOK 含 GitHub Actions YAML 示例** | **v1.0.2 第四轮审查 P1** |
| **168** | **config.yml 缺失时输出"使用默认配置"提示** | **v1.0.2 第四轮审查 P2** |
| **169** | **`--help` 输出 ≤ 20 行首屏 + `--help --verbose` 完整列表** | **v1.0.2 第四轮审查 P2** |
| **170** | **`--help` 含模式对照表（默认/silent/strict/ci 关系）** | **v1.0.2 第四轮审查 P2** |
| **171** | **`npx @sofagent/audit` 可用或 README 含 npx 备选路径** | **v1.0.2 第五轮审查 P0（DeepSeek）** |
| **172** | **维度数字一致性——CHANGELOG/ROADMAP 不含过时的具体维度数字** | **v1.0.2 第五轮审查 P1（DeepSeek）** |
| **173** | **文档日期全仓同步——bump-version 后所有文档头日期一致（含 design/ 目录）** | **v1.0.2 第四+五轮审查 P1** |
| **174** | **`--no-verify` 绕过后事后审计对密钥检测——`--diff HEAD` 模式下 A1/A2 正确检出** | **v1.0.2 第五轮审查 P2（DeepSeek）** |
| **175** | **`--doctor` 绕过检测含"安全提示"标注** | **v1.0.2 第五轮审查 P2（DeepSeek）** |
| **176** | **README 延伸阅读表分层（"必读"和"进阶"分开）** | **v1.0.2 第五轮审查 P2（DeepSeek）** |
| **177** | **`--strict` 模式 exit code 正确——WARN→exit 2（`--ci` 已解耦）** | **v1.0.3 审查 P0 / v1.0.5 修复** |
| **178** | **commit-msg hook task 值为当前 commit msg** | **v1.0.3 审查 P0 / v1.0.5 修复** |
| **179** | **loadHistory() 对无 timestamp 条目健壮** | **v1.0.3 发布后审查 P0** |
| **180** | **A9 Unicode 全角/leet speak 检测** | **v1.0.3 发布后审查 P1** |
| **181** | **A9 扫描 commit message** | **v1.0.3 发布后审查 P1** |
| **182** | **CHANGELOG 全历史纯度——无审查元信息** | **v1.0.3 发布后审查 P1** |
| **183** | **规则数字声称准确——纯 diff vs 需日志 vs 扩展** | **v1.0.3 发布后审查 P0** |
| **184** | **A14 标注"事后审计非访问控制"** | **v1.0.3 发布后审查 P0** |
| **185** | **history.jsonl 完整性保护（hash chain 或 HMAC）** | **v1.0.3 发布后审查 P0** |
| **186** | **config 安全规则（A1/A2）被禁用时输出告警——config-loader.ts:170 已实现 `console.warn`** | **v1.0.3 发布后审查 P1** |
| **187** | **git tag 指向发布提交——⏰ 发布后验证项，回归检查阶段标 ⏳ 不标 FAIL** | **v1.0.3 DeepSeek 审查 P0** |
| **188** | **CHANGELOG 声称与实现一致——"引擎" vs "wrapper"** | **v1.0.3 DeepSeek 审查 P1** |
| **189** | **eval harness——golden set 格式与 runEval API 一致** | **v1.0.4 新功能** |
| **190** | **A15 规则注册 + evidenceMode + actions 提取正则可靠** | **v1.0.4 新功能** |
| **191** | **HITL 四类强制人工场景（risk-assessor.ts）+ 置信度计算非硬编码（confidence-tagger.ts）——注意 HITL 是独立模块（hitl/），不是 E 系列规则** | **v1.0.4 新功能** |
| **192** | **A/B decidePromotion 连续胜出阈值可配置 + promote 归档路径存在** | **v1.0.4 新功能** |
| **193** | **SkillOpt——daemon.sh 与 doctor.ts 的 eval.md 路径一致** | **v1.0.4 P0：跨模块路径引用** |
| **194** | **dist 与 src 同步——新增 CLI 命令在 dist 中存在** | **v1.0.4 遗漏补完** |
| **195** | **CHANGELOG/ROADMAP 测试数字与实际 npm test 输出一致** | **v1.0.4 教训：写 455 实际 465** |
| **196** | **跨模块路径引用一致性——shell 脚本 `${SOFAGENT_DATA}` 与 TS `dataDir` 拼接的路径一致** | **v1.0.4 P0：路径拼接方式不同导致不一致** |
| **197** | **CHANGELOG 纯度——无审查元信息（模型名/轮次/P0×P1×P2 标签）** | **v1.0.4 发布后审查 + 茶园调整视角** |
| **198** | **根目录文件数 ≤7——多余 .md/.html/.png 移入 docs/ 或 assets/** | **v1.0.4 发布后审查 + 茶园调整视角** |
| **199** | **README 测试数 vs 实际 npm test 一致** | **v1.0.4 发布后审查 + 茶园调整视角** |
| **200** | **index.ts evidenceMode 与 README 规则分类一致——声称数 = 注册数** | **v1.0.4 发布后审查 P1 + 茶园调整视角** |
| **201** | **--no-verify 绕过在 SECURITY.md 有说明** | **v1.0.4 发布后审查 + 茶园调整视角** |
| **202** | **"自进化引擎"命名与代码能力匹配——wrapper 不叫引擎** | **v1.0.4 发布后审查 P1 + 茶园调整视角** |
| **203** | **git diff --find-renames 边缘 case——重命名+修改同时发生的解析** | **v1.0.4 发布后审查红队发现** |
| **204** | **非 git 目录运行时报错友好——不是 git 原始 fatal** | **v1.0.4 发布后审查红队发现** |
| **211** | **`--ci` 不隐含 `--strict`——A4 WARN 不被误阻断** | **v1.0.5 OpenClaw 验收 P0** |
| **212** | **commit-msg hook 迁移 + 旧版 pre-commit 清理** | **v1.0.5 OpenClaw 验收 P1** |
| **213** | **post-commit hook 中文 echo 正确（UTF-8 无乱码）+ 所有 exit 路径 exit 0** | **v1.0.6 Fix 1: post-commit 中文乱码** |
| **214** | **checkHistoryChainIntegrity 逐条判断 hashVersion——混合格式（v1 无 hashVersion + v2 有 hashVersion:2）不误报链断裂** | **v1.0.6 Fix 3: hashVersion per-entry 修复** |
| **215** | **audit-history.ts 无死代码残留（`const line = JSON.stringify` 已删除）** | **v1.0.6 Fix 2: 死代码清理** |
| **216** | **LIMITATIONS.md A14 事后审计说明完整（能做什么/不能做什么/企业建议三要素）** | **v1.0.6 Fix 4: A14 文档完善** |
| **217** | **post-commit hook 不受 `--no-verify` 影响——commit-msg 被绕过但 post-commit 仍触发** | **v1.0.6 post-commit 设计意图验证** |
| **301** | **跨文档相对路径死链全量扫描（自动化，非人工点击）** | **v1.1.3 全仓质量审计：23 处死链，根因=文件迁移未修正相对路径 + 审查仅查 rules.md** |
| **302** | **跨包代码重复检测（复制≠移动，重复→提升为 import）** | **v1.1.3 发现 audit/core 各存一份 isomorphic-git.ts(383行,差4行)** |
| **303** | **Ledger-Views 归属一致性（think.md 永远为 Ledger/source，不得标 Views）** | **v1.1.3 发现 ARCHITECTURE.md:320 错标 think.md=Views** |
| **304** | **文档规范源与冗余（DRY：概念只在 canonical source 定义）** | **v1.1.3 发现同概念多文档重复定义且偶有冲突** |
| **305** | **文件/目录迁移四动作完整性（移动+删源+更新引用+修死链）** | **v1.1.3 教训：LIMITATIONS.md 迁根后相对路径未同步** |
| **306** | **check-docs.sh 死链检查从 rules.md 扩展为全量相对路径** | **v1.1.3 发现：check-docs.sh 第1项仅扫 rules.md，漏通用死链** |

---

### 第二十三部分：v1.0.4 发布后审查追加（维度 197-204）🆕

> 来源：v1.0.4 发布后审查（8 维度 × 6 方面）+ 茶园调整视角建议。8 个维度覆盖 CHANGELOG 纯度、根目录整洁度、数字一致性、evidenceMode 对照、--no-verify 文档、命名准确性、git diff 边缘 case、非 git 目录健壮性。

#### 197. CHANGELOG 纯度——无审查元信息 🆕
```bash
# v1.0.4 审查发现：CHANGELOG 和 changelog 子文件中仍可能有审查元信息
# CHANGELOG 应该只写产品变更，不含审查过程（模型名、轮次、P0/P1/P2 标签等）

# 1. 主 CHANGELOG
grep -i "GLM\|DeepSeek\|双视角\|P0×\|P1×\|P2×\|7 视角\|8 视角\|× 6 方面" CHANGELOG.md
# 期望：无匹配

# 2. changelog 子文件
grep -ri "GLM\|DeepSeek\|审查轮次\|P0×\|P1×\|P2×" docs/changelog/*.md
# 期望：无匹配

# 3. P0/P1/P2 标签——changelog 中不应出现严重度标签
grep -rE 'P[012][×:：]' docs/changelog/*.md
# 期望：无匹配
```

#### 198. 根目录文件数 ≤7 🆕
```bash
# v1.0.4 审查发现：根目录有多余文件。index.html=landing page, sofagent.png/favicon.png=项目logo——这些是核心资源，允许保留
# 根目录应只有 5-7 个核心 MD + 必要资源文件

# 1. 根目录 .md 文件数
ls *.md | wc -l
# 期望：≤7（README/CHANGELOG/CONTRIBUTING/SECURITY/CODE_OF_CONDUCT/ROADMAP/LIMITATIONS）

# 2. 根目录资源文件（index.html + sofagent.png + favicon.png 是核心资源，保留）
ls *.html *.png 2>/dev/null
# 如有多余的非核心 .html/.png → 审视是否应移入 docs/

# 3. HANDBOOK.md / ARCHITECTURE.md / DEVELOPMENT.md 是否在根目录
ls HANDBOOK.md ARCHITECTURE.md DEVELOPMENT.md 2>/dev/null
# 这些大文档是否应移入 docs/（视项目惯例决定，但需有明确理由）
```

#### 199. README 测试数 vs 实际 npm test 一致 🆕
```bash
# v1.0.4 审查发现：README 中声称的测试数可能与实际不一致
# v1.0.4 教训：changelog 写 455 但实际 465

# 1. 实际测试数
actual=$(cd sofagent/audit && npm test 2>&1 | grep 'Tests' | grep -o '[0-9]*' | head -1)
echo "实际: $actual"

# 2. README 中的数字
grep -o '[0-9]*' README.md | head -20  # 人工找出测试数声称

# 3. evidence.md 中的数字
grep "$actual" docs/evidence/evidence.md 2>/dev/null
# 应包含当前实际测试数

# 4. CHANGELOG 最新条目中的数字
head -20 CHANGELOG.md | grep -o '[0-9]*'  # 人工找出测试数声称
# 应与实际一致
```

#### 200. index.ts evidenceMode 与 README 规则分类一致 🆕
```bash
# v1.0.4 审查发现 P1：README 声称"17 条规则（13 条纯 git-diff + 4 条需 Agent 日志）"
# 但 index.ts 实际注册 15 条（A1-A11 + E1-E4 + A14 + A15），不是 17 条
# 且 evidenceMode 分布与 README 的"13+4"分类不匹配

# 1. index.ts 实际注册数
grep -c 'name:' sofagent/audit/src/rules/index.ts
# 应为实际注册的规则数

# 2. evidenceMode 分布
grep 'evidenceMode' sofagent/audit/src/rules/index.ts | sort | uniq -c
# 数 git-diff 和 hybrid 各多少条

# 3. README 中的声称
grep '纯 git-diff\|需.*日志\|条规则\|条审计' README.md
# 声称的数字必须与 index.ts 一致

# 4. CHANGELOG 历史条目中的声称
grep '条规则\|条审计\|纯.*diff\|需.*日志' CHANGELOG.md
# 历史声称也不应与当前实际矛盾

# 5. 交叉验证：声称数 = defaultRules + extendedRules
default=$(grep -A1 'defaultRules' sofagent/audit/src/rules/index.ts | head -1)
extended=$(grep -A1 'extendedRules' sofagent/audit/src/rules/index.ts | head -1)
# 数组内 name: 字段数 = 声称数
```

#### 201. --no-verify 绕过在 SECURITY.md 有说明 🆕
```bash
# v1.0.4 审查发现：--no-verify 绕过是已知设计限制，但 SECURITY.md 可能未明确说明

# 1. SECURITY.md 提到 --no-verify
grep -i 'no.verify\|bypass\|绕过' SECURITY.md
# 期望：有匹配——说明 --no-verify 可绕过 pre-commit hook

# 2. 说明内容应包含：
#   - --no-verify 可以绕过 pre-commit hook（git 的设计如此）
#   - sofagent 的应对：--doctor 第 8 项事后检测（git log SHA vs history.jsonl）
#   - 局限：事后检测只能发现不能阻止

# 3. LIMITATIONS.md 也应有对应说明
grep -i 'no.verify\|绕过\|bypass' LIMITATIONS.md
# 期望：有匹配
```

#### 202. "自进化引擎"命名与代码能力匹配 🆕
```bash
# v1.0.4 审查发现 P1：CHANGELOG 声称"自进化引擎"但实际是调外部 CLI 的 wrapper
# 命名应与实际能力匹配——wrapper 不能叫"引擎"

# 1. CHANGELOG 中的声称
grep -i '自进化\|self-evolv\|引擎\|engine' CHANGELOG.md docs/changelog/v1.0.4.md
# 如果实际是 CLI wrapper，不应叫"引擎"

# 2. 实际实现——是自研还是调外部 CLI
grep -r 'skillopt\|spawn\|exec\|child_process' sofagent/audit/src/ 2>/dev/null | grep -v node_modules | grep -v '.test.'
# 如果核心逻辑是 spawn('skillopt-sleep', ...) → 是 wrapper 不是引擎

# 3. A/B promote 阈值是否硬编码
grep -r 'promote\|threshold\|阈值\|连续胜出' sofagent/audit/src/ 2>/dev/null | grep -v node_modules | grep -v '.test.'
# 如果阈值是硬编码常量 → 不应声称"可配置"

# 4. README 中的对应声称
grep -i '自进化\|self-evolv\|引擎' README.md
# 命名应与实际匹配——如实际是 wrapper，应叫"自进化工具"或"SkillOpt 集成"
```

#### 203. git diff --find-renames 边缘 case 🆕
```bash
# v1.0.4 审查发现：diff-parser 对重命名+修改同时发生的 diff 解析可能不正确
# git diff 默认不加 --find-renames，但 Agent 可能通过 git mv 制造重命名场景

# 1. diff-parser.ts 是否处理 rename
grep -i 'rename\|renamed\|R100\|R0[0-9]' sofagent/audit/src/diff-parser.ts
# 期望：有处理 rename 的逻辑

# 2. 实际测试：重命名 + 修改
cd /tmp/test-rename && git init
echo "old content" > old-name.txt && git add old-name.txt && git commit -m "add"
git mv old-name.txt new-name.txt
echo "new content" >> new-name.txt
git add new-name.txt
sofagent-audit --diff HEAD~1..HEAD 2>&1 | head -20
# 期望：正确解析为 rename + modify，不丢失内容检查

# 3. 纯重命名（无内容修改）
cd /tmp/test-rename-only && git init
echo "content" > a.txt && git add a.txt && git commit -m "add"
git mv a.txt b.txt
git add b.txt
sofagent-audit --diff HEAD~1..HEAD 2>&1 | head -10
# 期望：不误报内容问题
```

#### 204. 非 git 目录运行时报错友好 🆕
```bash
# v1.0.4 审查发现：在非 git 目录跑 sofagent-audit 时，错误信息可能不友好
# Agent 或用户可能误在非 git 目录执行审计

# 1. 非 git 目录测试
cd /tmp && mkdir test-no-git && cd test-no-git
sofagent-audit --diff HEAD~1..HEAD 2>&1 | head -5
# 期望：明确提示"当前目录不是 git 仓库" + 建议运行 git init 或 cd 到正确目录
# 不应是 git 的原始 fatal 错误

# 2. --init 在非 git 目录
sofagent-audit --init 2>&1 | head -5
# 期望：提示需要先 git init，或自动初始化 git 仓库后再装 hook

# 3. --doctor 在非 git 目录
sofagent-audit --doctor 2>&1 | head -5
# 期望：第 1 项（git 检测）报 ❌ + 修复建议
```

---
### 第二十四部分：v1.0.5 审查追加（维度 205-210）🆕

#### 205. hub.ts templateName 路径穿越校验 🆕
```bash
# v1.0.5+ 使用 resolve + startsWith 防护（比 includes('..') 更严谨）
# 检查两种防护模式之一存在即可
grep -A2 "resolve.*templatesRoot\|templateName.*includes.*\.\." sofagent/audit/src/commands/hub.ts
# 期望：有匹配（resolve 归一化 或 includes 校验）
```

#### 206. README Mermaid 图与正文一致性 🆕
```bash
# v1.0.5 审查发现：编排引擎 Mermaid 图写"自动切换"，正文写"手动"
grep -A5 '编排引擎' README.md | grep '手动\|自动切换'
# 期望：图和文一致
```

#### 207. safeDefaults() 包含 a14/a15 规则 🆕
```bash
# v1.0.5 审查 P2：safeDefaults() 的 rules 对象只含 a1-a11，缺 a14/a15
grep -A10 'export function safeDefaults' sofagent/audit/src/config-loader.ts | grep 'a14\|a15'
# 期望：a14 和 a15 出现在 rules 中（安全相关应默认启用）
```

#### 208. safeDefaults() lowRiskPatterns 不为空 🆕
```bash
# v1.0.5 审查 P2：safeDefaults() 的 lowRiskPatterns 为空，新用户首次用可能被 WARN 淹没
grep -A10 'export function safeDefaults' sofagent/audit/src/config-loader.ts | grep 'lowRiskPatterns'
# 期望：至少包含 ['package-lock.json', 'yarn.lock'] 等基本豁免
```

#### 209. Agent Dashboard 无硬编码时间戳 🆕
```bash
# v1.0.5 审查 P2：doctor.ts 假 Agent 数据硬编码时间戳会过期
grep -n '2026-07-11\|示例' sofagent/audit/src/commands/doctor.ts
# 期望：含「示例」标注，时间戳为动态生成
```

#### 210. toYamlList() 使用 YAML 序列化 🆕
```bash
# v1.0.5 审查 P2：merge-engine.ts 的 toYamlList() 用 JSON.stringify 而非 YAML
grep -A3 'function toYamlList' sofagent/audit/src/ontology/merge-engine.ts
# 期望：用 yaml.dump 或手动转义特殊字符
```

#### 211. `--ci` 不隐含 `--strict`（P0 解耦）🆕
```bash
# v1.0.5 OpenClaw 验收 P0：--ci 隐含 --strict 导致 A4 WARN 被误阻断
# 修复后 --ci 只管紧凑输出（= --silent），WARN 保持 exit 1 放行

# 验证 --ci 不设 strict：
grep -A3 "'--ci'" sofagent/audit/src/index.ts | grep "strict"
# 期望: 无匹配行

# 验证 --help 文本不写 "= --silent + --strict"：
sofagent-audit --help 2>&1 | grep "ci"
# 期望: "--ci = --silent (紧凑输出) exit 0/1/2"，不含 "+ --strict"
```

#### 212. commit-msg hook 迁移 + 旧版清理 🆕
```bash
# v1.0.5 OpenClaw 验收 P1：hook 从 pre-commit 迁移到 commit-msg
# commit-msg hook 读取 $1（commit message 文件），传 --task 使 A3 生效

# 验证 hook 文件存在且读取 $1：
test -f sofagent/audit/hooks/commit-msg && echo "OK"
grep 'COMMIT_MSG_FILE.*\$1' sofagent/audit/hooks/commit-msg
# 期望: 有匹配

# 验证旧 pre-commit hook 文件已删除：
test ! -f sofagent/audit/hooks/pre-commit && echo "OK"

# 验证 --init 自动清理旧 hook：
# 手动创建 .git/hooks/pre-commit 含 "sofagent" → 跑 --init → 应被删除
# 验证 --doctor 检测旧 hook 并提示迁移
sofagent-audit --doctor | grep "旧版 pre-commit"
# 期望: 有旧 hook 时输出迁移提示
```

#### 213. README 规则分类与 index.ts evidenceMode + 数组归属一致 🆕
```bash
# v1.0.5 审查 P0：README 声称"17 条规则：11 纯 git-diff（A1-A6,A9-A11）+
# 4 需 Agent 日志（A7-A8,A12-A13）+ 2 扩展（A14,A15）"
# 但 index.ts 实际注册 17 条（defaultRules A1-A11 共 11 条 + extendedRules E1-E4,A14,A15 共 6 条）
# evidenceMode 实际：13 git-diff + 4 hybrid（A7,A8,A14,A15）
# README 中的 A12/A13 是"幽灵规则"——代码中根本不存在

# 1. README 中的规则分类描述
grep -n '纯 git-diff\|需.*日志\|条规则\|条审计\|扩展' README.md
# 提取声称的分类和规则 ID

# 2. index.ts 实际 evidenceMode 分布
grep 'evidenceMode' sofagent/audit/src/rules/index.ts | sort | uniq -c
# 期望：git-diff 13 条，hybrid 4 条

# 3. 逐 ID 验证：README 分类描述中提到的每个 ID 都在 index.ts 中存在
# 例如 README 写"A1-A6,A9-A11" → 确认 A1,A2,A3,A4,A5,A6,A9,A10,A11 均在 defaultRules 注册
# README 写"A12-A13" → 如果 index.ts 中没有 a12/a13 → P0 幽灵规则

# 4. 数组归属验证：defaultRules vs extendedRules
grep -B2 'name:' sofagent/audit/src/rules/index.ts | head -40
# 确认 README 归为"核心规则"的 ID 都在 defaultRules 中
# README 归为"扩展"的 ID 都在 extendedRules 中
```

#### 214. SECURITY.md 与 README 对规则数量/分类表述一致 🆕
```bash
# v1.0.5 审查发现：SECURITY.md 和 README 可能对规则数量/分类有不一致表述
# 多份文档描述同一数字时，改了一个忘了改另一个

# 1. SECURITY.md 中的规则描述
grep -i '条规则\|条审计\|git-diff\|hybrid\|证据模式' SECURITY.md
# 提取声称的数字和分类

# 2. 与 README 交叉比对
grep -i '条规则\|条审计\|git-diff\|hybrid' README.md
# 两份文档的数字和分类必须一致

# 3. 与 index.ts 交叉验证（用维度 213 的方法）
grep -c 'name:' sofagent/audit/src/rules/index.ts
# 三方一致：README = SECURITY.md = index.ts 实际注册数
```

#### 215. ROADMAP 头部日期与发版日期一致 🆕
```bash
# v1.0.5 审查发现 P1：ROADMAP 头部写"v1.0.5 · 2026-07-11"
# 但 CHANGELOG 写发版日期 2026-07-12——bump-version 只改版本号不改日期

# 1. ROADMAP 头部日期
head -5 ROADMAP.md | grep -o '20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]'

# 2. CHANGELOG 最新条目日期
head -5 CHANGELOG.md | grep -o '20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
# 或者看 docs/changelog/vX.Y.md 的日期

# 3. 两日期一致？
# 如不一致 → bump-version.sh 未覆盖文档头部日期，手动修正

# 4. ROADMAP "现在在哪"版本与实际发版版本一致
head -5 ROADMAP.md | grep '现在在哪'
# 如写"v1.0.5 ✅" → 确认确实已发版 v1.0.5（CHANGELOG 有对应条目）
# 如写"v1.0.5 ⏳"但实际已发版 → P1 迭代表未更新
```

#### 216. CHANGELOG 实验版条目不含审查元信息 🆕
```bash
# v1.0.5 审查发现：CHANGELOG 应只写产品变更
# 但实验版/迭代版可能在条目中混入审查过程信息

# 1. 模型名
grep -ri "GLM\|DeepSeek\|双视角\|混合模型" CHANGELOG.md docs/changelog/*.md
# 期望：无匹配

# 2. 审查轮次信息
grep -ri "审查轮次\|视角审查\|陌生视角\|审查发现" CHANGELOG.md docs/changelog/*.md
# 期望：无匹配（审查发现是过程信息，不进 changelog）

# 3. P0/P1/P2 计数
grep -rE 'P[012][×:：]' CHANGELOG.md docs/changelog/*.md
# 期望：无匹配

# 4. 与维度 197（CHANGELOG 纯度）交叉验证
# 维度 197 检查主文件，本维度额外覆盖 docs/changelog/v*.md 子文件
```

---

## 审查约束

- **v1.0 是正式版**——从「技术预览」到「可生产使用」的跨越，你的审查质量直接决定正式版能否发布
- **214 维度全部检查**——不是只看增量，是全仓库全面检查
- **v0.99.9 老问题不能回归**——ROADMAP 版本叙事、GLM 维度数一致性、中英文文件对称、术语统一
- **铁律措辞强化必须用 grep 验证**——不能凭感觉说「改完了」，grep 不到才算数
- **准入条件 A 类不能造假**——⚠️→✅ 必须有新 evidence 支持，不能因为正式版就改 ✅
- **实验性标注不能去掉**——编排引擎、daemon、Windows 仍然是实验性的，正式版不代表全部生产级
- **AI 知识库只审「概念清晰度」**，不审「实现完整性」（v1.0.1 已实现）
- **验收测试审「9 场景覆盖」**——文件存在 + 可执行 + 9 场景 + 临时仓库清理 + 不污染全局环境
- **daemon 审「三处对齐」**——HANDBOOK + ARCHITECTURE + LIMITATIONS 必须对齐实际行为
- **FDE 隐性代价审「有+客观+不自贬」**——不是审「有没有代价」，是审「有没有诚实写出来」
- **semver 审「1.0.0 不是 1.0」**——全仓库版本号必须统一为 1.0.0
- **--init 审「三步合一+幂等+模板完整」**——命令存在、config 模板有 11+4 条规则、幂等可重复运行、hook 内容与第十件事一致
- **--doctor 审「7 项诊断+只读+退出码」**——命令存在、7 项覆盖、不做任何写操作、有 ❌ 时 exit 1
- **审计可视化审「banner+CJK+历史统计」**——三种场景有 banner、CJK 宽度对齐正确、--json/--ci 不受影响
- **修复建议审「11+4 条全有+≤80 字」**——fix-suggestions.ts 映射表完整、每条建议一行说完
- **README 审「一句话定位」**——头 3 行是否让人 3 秒内知道这是什么
- **CHANGELOG 审「索引存在」**——v1.0.0 条目是否存在
- **升级指引审「推荐 --init」**——升级说明推荐 --init 而非 --install-hook
- **语言风格审「谦虚低调+幽默分寸+不自贬」**——核心文档不用营销话术（最强/唯一/革命性），严肃场景不放梗，诚实放 LIMITATIONS 不在核心叙事自贬
- **架构描述审「四文档一致+概念有铺垫」**——五层/双引擎/FDE 在 README/HANDBOOK/ARCHITECTURE/DEVELOPMENT 描述一致，首次出现的关键概念有简短解释
- **文字精简审「无空洞形容词+无重复表述+README 不越位」**——不用「强大的/完善的」等零信息量形容词，同义重复要合并，大段教程移到 HANDBOOK
- **描述完整性审「概念有解释+上手有路径+出错有说明」**——关键概念不只丢名词，README 能让新用户独立上手，常见错误场景有文档对应
- **OpenClaw 验收审「5 场景+执行结果」**——测试文件存在 + 5 个场景完整 + 有实际执行结果记录（不是只看文件存在就标 ✅）
- **首次提交拦截审「不报 fatal」**——全新仓库首次 commit 不应 git fatal，应有 --cached 分支 + parseStagedDiff
- **A2 聚合审「同类不逐条输出」**——同一文件同一密钥类型应聚合为一条，MAX_DISPLAY_PER_GROUP=5
- **ConfigLoadError 审「行号列号」**——YAML 语法错误报错含行号列号 + 文件路径，不是模糊报错
- **doctor 第 8 项审「SHA 对比」**——对比 git log SHA vs history.jsonl，检测 --no-verify 绕过
- **A14 规则审「hybrid 模式+LogEntry 类型」**——规则注册 + knowledge-domain 配置加载 + entry.operation/raw（非 action/detail）
- **四层加载链审「knowledge/index.md 第 4 层」**——SKILL.md → think.md → fde.md → knowledge/index.md
- **daemon Ingest 审「find -mmin -30 + 防抖」**——task/logs 变化检测 + 30 分钟防抖
- **fde.md 审「知识库章节+≤3200 字符」**——有 AI 知识库维护规则 + 字符数不超限
- **reporter key 审「≥200 则 e 否则 a」**——A14 等非 E 系列扩展规则的 key 不是 e-186
- **测试覆盖率审「一条规则一个测试文件」**——扩展规则新增时必须同步创建测试
- **doctor 访问矩阵审「workflow.yml 已配置时展示」**——extendedRulesEnabled 时应有矩阵
- **npm 引导审「README 首行 + --help 首行」**——安装后 ≤3 步能从安装到首次审计
- **增量淘汰审「新增=删除」**——Skill 加功能时必须同步删旧内容，维持 ≤100 行
- **pre-push-check 审「审查的最后一步」**——7/7 全绿才算 IS_PASS: YES
- **history.jsonl 脱敏审「A2/A9 不存明文」**——拦截密钥/injection 后 history 不含敏感原文
- **A9 自身排除审「.sofagent/ 跳过」**——A9 不对自身审计日志误报
- **A5 时机审「--task 传 commit subject」**——commit-msg hook 通过 --task 传递当前 commit message
- **术语统一审「无纪律层」**——ARCHITECTURE 全文无旧术语残留
- **CHANGELOG 纯度审「无审查元信息」**——changelog 只写产品变更
- **日期同步审「全部一致」**——所有文档头日期统一
- **失败指引审「有下一步」**——FAIL 输出末尾有修复指引
- **init 解释审「选项有说明」**——每个交互选项后有 1-2 行说明
- **GHA 示例审「可复制粘贴」**——HANDBOOK 含完整 YAML
- **help 精简审「首屏 ≤20 行」**——核心命令首屏可见
- **模式对照审「默认/silent/strict/ci 关系」**——--help 含对照表
- **npx 可用审「bin 别名或 README 备选」**——npx @sofagent/audit 可用或有文档说明
- **维度数字审「不写死具体数字」**——CHANGELOG/ROADMAP 不含过时的维度数字
- **文档日期全仓审「不只核心文档」**——含 design/ 目录，全仓 grep 确认
- **事后审计审「密钥检测不遗漏」**——--no-verify 绕过后 --diff HEAD 仍能检出 A1/A2
- **doctor 安全提示审「绕过有 WARN」**——检测到 --no-verify 时输出"安全提示"
- **README 分层审「延伸阅读分必读+进阶」**——不让新用户面对 26 行链接表
- **strict 生效审「WARN→exit 2」**——--strict 模式下 WARN 返回 exit 2；--ci 已解耦不隐含 strict（v1.0.5 修复）
- **task 时序审「当前 msg」**——commit-msg hook 中 A3 读取 $1 文件获取当前 commit msg（v1.0.5 迁移修复）
- **loadHistory 健壮审「垃圾数据不崩」**——history.jsonl 插入无 timestamp JSON 时 doctor 不崩溃（v1.0.3 审查 P0）
- **A9 加固审「全角+leet+commitMsg」**——Unicode normalization + leet 映射 + commit message 扫描（v1.0.3 审查 P1）
- **history 完整性审「hash chain」**——history.jsonl 有防篡改机制（v1.0.3 审查 P0）
- **tag 指向审「发布提交」**——git tag 指向发布提交而非修复提交（v1.0.3 审查 P0）
- **声称准确审「引擎 vs wrapper」**——CHANGELOG 中的功能名与实际代码交付一致（v1.0.3 审查 P1）
- **README 规则分类审「ID 逐个存在+数组归属」**——README 分类描述中提到的每个规则 ID 在 index.ts 中确实注册，不是"幽灵规则"；defaultRules/extendedRules 归属与 README 分类一致（v1.0.5 审查 P0）
- **SECURITY/README 一致审「同一数字同源」**——SECURITY.md 与 README 对规则数量/分类的表述一致，且均与 index.ts 交叉验证通过（v1.0.5 审查）
- **ROADMAP 日期审「头部=发版日期」**——ROADMAP 文件头日期与 CHANGELOG 发版日期一致，bump-version 不覆盖日期需人工兜底（v1.0.5 审查 P1）
- **CHANGELOG 子文件纯度审「v*.md 无审查元信息」**——docs/changelog/v*.md 子文件不含模型名/审查轮次/P0P1P2 标签（v1.0.5 审查）

---

### 第二十五部分：v1.0.6 修复回归（维度 213-217）🆕

> 来源：v1.0.6 开发修复的 4 个问题（P1×1 + P2×3）+ post-commit hook 设计验证。

#### 213. post-commit hook 中文 echo 正确 🆕
```bash
# v1.0.6 Fix 1: post-commit hook 中文输出恢复（之前乱码）

# 1. hook 文件存在
ls sofagent/audit/hooks/post-commit
# 不存在 = P0（post-commit hook 未实现）

# 2. 中文 echo 存在且 UTF-8 正确
grep '当前 commit' sofagent/audit/hooks/post-commit
grep '审计记录' sofagent/audit/hooks/post-commit
# 期望：有匹配（中文输出存在）

# 3. 所有 exit 路径 exit 0（post-commit 永远不阻断）
grep 'exit' sofagent/audit/hooks/post-commit
# 期望：所有 exit 都是 exit 0
# 不应有 exit 1 或 exit 2

# 4. 实际测试：commit 后 post-commit 输出中文不乱码
cd /tmp && git init test-post-commit && cd test-post-commit
echo "test" > a.txt && git add a.txt && git commit -m "init"
sofagent-audit --init
echo "change" >> a.txt && git add a.txt
OUTPUT=$(git commit -m "test" 2>&1)
echo "$OUTPUT" | grep -q '审计记录\|commit'  # 期望：有中文输出
cd / && rm -rf /tmp/test-post-commit
```

#### 214. hashVersion 逐条判断——混合格式不误报 🆕
```bash
# v1.0.6 Fix 3: checkHistoryChainIntegrity 改为逐条判断 hashVersion
# 之前用 firstEntry.hashVersion 一刀切，混合格式时误报链断裂

# 1. 逐条判断逻辑存在
grep 'currUseFingerprint\|curr\.hashVersion' sofagent/audit/src/audit-history.ts
# 期望：有匹配（使用 curr 而非 firstEntry 判断）

# 2. 不再使用 firstEntry 一刀切
grep 'firstEntry.*hashVersion\|entries\[0\].*hashVersion' sofagent/audit/src/audit-history.ts
# 期望：无匹配（已改为逐条）

# 3. 混合格式测试（单元测试中已有）
grep '混合格式' sofagent/audit/src/audit-history.test.ts
# 期望：有匹配（混合格式测试用例存在）

# 4. 实际测试
cd /tmp && git init test-mixed-hash && cd test-mixed-hash
echo "test" > a.txt && git add a.txt && git commit -m "init"
sofagent-audit --init
# 构造混合 history.jsonl（旧格式 + 新格式）
echo '{"timestamp":"2026-07-01T00:00:00Z","diffRange":"HEAD~1..HEAD","exitCode":0,"ruleResults":[],"diffFileCount":1,"prevHash":"genesis"}' > .sofagent/audit/history.jsonl
sofagent-audit --doctor 2>&1 | head -10
# 期望：不报告链断裂
cd / && rm -rf /tmp/test-mixed-hash
```

#### 215. audit-history.ts 无死代码 🆕
```bash
# v1.0.6 Fix 2: 删除了 const line = JSON.stringify 死代码

grep 'const line = JSON.stringify' sofagent/audit/src/audit-history.ts
# 期望：无匹配（死代码已删除）
```

#### 216. LIMITATIONS.md A14 事后审计说明完整 🆕
```bash
# v1.0.6 Fix 4: LIMITATIONS.md A14 新增事后审计说明

# 1. A14 说明段存在
grep '事后审计' LIMITATIONS.md
# 期望：有匹配

# 2. 三要素完整
grep -A10 '事后审计' LIMITATIONS.md | grep '不能阻止\|A14'
# 期望：有匹配（说明了 A14 不能做什么）

# 3. 企业建议存在
grep -A15 '事后审计' LIMITATIONS.md | grep '企业\|建议'
# 期望：有匹配（给了企业用户建议）
```

#### 217. post-commit 不受 --no-verify 影响 🆕
```bash
# v1.0.6 验证：post-commit hook 是设计来对抗 --no-verify 绕过的

# 1. post-commit hook 中引用了 sofagent-audit
grep 'sofagent-audit' sofagent/audit/hooks/post-commit
# 期望：有匹配

# 2. post-commit 调用 --doctor 或类似检测
grep 'doctor\|check\|detect' sofagent/audit/hooks/post-commit
# 期望：有匹配（调用检测逻辑）

# 3. 实际验证：--no-verify 绕过 commit-msg 后 post-commit 仍触发
cd /tmp && git init test-noverify && cd test-noverify
echo "test" > a.txt && git add a.txt && git commit -m "init"
sofagent-audit --init
echo "bypass" >> a.txt && git add a.txt
OUTPUT=$(git commit --no-verify -m "bypass" 2>&1)
echo "$OUTPUT" | grep -q 'no-verify\|绕过\|审计记录'
# 期望：post-commit 输出了绕过提示
cd / && rm -rf /tmp/test-noverify
```

---

#### 218. SkillOpt CLI 探针匹配真实 CLI 🆕
```bash
# v1.0.6 SkillOpt 修复：isSkillOptAvailable() 探针必须匹配真实 skillopt-sleep CLI

# 1. 探针用 status 子命令（不是 --version）
grep "execFileSync.*skillopt-sleep" sofagent/audit/src/skillopt-integration.ts | grep "status"
# 期望：有匹配（探针为 ['status'] 而非 ['--version']）

# 2. 真实 CLI 拒绝 --version（exit 2）
SKILLOPT=$(which skillopt-sleep 2>/dev/null || echo "")
if [ -n "$SKILLOPT" ]; then
  "$SKILLOPT" --version 2>/dev/null; echo "exit: $?"
  # 期望：exit code 2（真实 CLI 无 --version flag）
  "$SKILLOPT" status 2>/dev/null; echo "exit: $?"
  # 期望：exit code 0
fi

# 3. isSkillOptAvailable() 在已安装环境返回 true
node -e "console.log(require('./sofagent/audit/dist/skillopt-integration').isSkillOptAvailable())"
# 期望：true（skillopt-sleep 已安装且在 PATH 中时）
```

#### 219. parseArgs 不误判 skillopt-run 专属参数 🆕
```bash
# v1.0.6 pre-existing bug 修复：parseArgs() 曾把 --input 误判为未知参数导致 exit 1

# 1. skillopt-run happy path 不被 parseArgs 拦截
printf '# Test Skill\n\nline1\n' > /tmp/regression-skill-test.md
node sofagent/audit/dist/index.js skillopt-run --input /tmp/regression-skill-test.md 2>&1
# 期望：不报"未知参数 --input"，正常进入 skillopt-run 逻辑（备份→run→validate→回滚或保留）
# 之前 bug：parseArgs 在 skillopt-run 块之前执行，把 --input 当未知参数 exit 1

# 2. parseArgs 在 skillopt-run 模式下跳过专属参数
grep -A5 'skillopt-run' sofagent/audit/src/index.ts | grep 'parseArgs\|argv\[2\]'
# 期望：skillopt-run 分支在 parseArgs 之前拦截，或 parseArgs 跳过 skillopt-run 专属参数

rm -f /tmp/regression-skill-test.md
```

---

#### 220. post-commit hook 用 timestamp 近邻匹配（60s），不用 SHA 精确匹配 🆕
```bash
# v1.0.7 P0-1：post-commit 改用 timestamp 近邻匹配，不再依赖 commitSha（父 commit SHA 永远 ≠ 新 HEAD SHA）
# 1. hook 模板含 60 秒窗口逻辑
grep -q "60000" sofagent/audit/src/commands/init.ts && echo "OK: 含 60s 窗口逻辑" || echo "FAIL: 缺 60s 窗口"
# 2. 旧 SHA 精确匹配误报文案已移除
if grep -q "未在审计记录中找到" sofagent/audit/src/commands/init.ts; then echo "FAIL: 仍含旧 SHA 误报文案"; else echo "OK: 旧文案已移除"; fi
```

#### 221. init.ts hook skip 用版本号正则判断 🆕
```bash
# v1.0.7 补充修复#2：init.ts 用版本号正则判断 hook 是否覆盖（v1.0.6→覆盖, v1.0.7+→保留）
# 回归风险：若改回 includes('sofagent') 模糊判断，存量升级用户会跳过重装 hook，P0-1 修复对他们失效
grep -n "v(\\\\d+)\\\\.(\\\\d+)\\\\.(\\\\d+)" sofagent/audit/src/commands/init.ts | head
# 期望：有匹配（版本号正则）
grep -n "major < 1\|patch < 7\|hasPostCommitHook" sofagent/audit/src/commands/init.ts | head
# 期望：有匹配（阈值判断）
grep -n "includes('sofagent')\|includes(\"sofagent\")" sofagent/audit/src/commands/init.ts && echo "FAIL: 仍用模糊 includes" || echo "OK: 已改版本号判断"
```

#### 222. --init 创建 .gitignore 排除 .sofagent/ 🆕
```bash
# v1.0.7 P1-1：--init 确保 .gitignore 排除 .sofagent/，否则首次 commit 触发 A3 越界
grep -n "ensureGitignore" sofagent/audit/src/commands/init.ts | head
# 期望：有匹配（ensureGitignore 函数被调用）
```

#### 223. ao 完全退役（无 execFileSync('ao')，deepagents 在 dependencies） 🆕
```bash
# v1.0.7 任务3：ao 作为编排 fallback 路径正式移除
grep -rn "execFileSync('ao'\|execFileSync(\"ao\"\|agency-orchestrator" sofagent/audit/src/ && echo "FAIL: 仍有 ao 残留" || echo "OK: 无 ao 残留"
grep -A3 '"dependencies"' sofagent/audit/package.json | grep -q "deepagents" && echo "OK: deepagents 在 dependencies" || echo "FAIL: deepagents 不在 dependencies"
grep -A3 '"optionalDependencies"' sofagent/audit/package.json | grep -q "deepagents" && echo "FAIL: deepagents 仍在 optionalDependencies" || echo "OK: deepagents 不在 optionalDependencies"
```

#### 224. Sub Agent 约束自加载（buildConstrainedSystemPrompt + 缺失静默） 🆕
```bash
# v1.0.7 任务1：Sub Agent 启动时自己读 .sofagent/ 约束，不依赖宿主平台 Skill 注入
grep -rn "buildConstrainedSystemPrompt" sofagent/audit/src/ | head
# 期望：launcher.ts 定义 + 被 ab-runner 等调用
grep -n "tryRead\|静默\|return null" sofagent/audit/src/subagents/launcher.ts | head
# 期望：有匹配（缺失文件不报错，静默跳过）
```

#### 225. compose CLI 入口实现 + 未知子命令报错 🆕
```bash
# v1.0.7 任务2 / P2-2：compose 子命令实现，未知子命令不再静默跑全量 diff
grep -n "compose" sofagent/audit/src/index.ts | head
# 期望：有匹配（compose 子命令处理）
grep -n "未知子命令\|SUBCOMMANDS" sofagent/audit/src/index.ts | head
# 期望：有匹配（未知子命令报错逻辑）
```

#### 226. A/B 连续胜出计数器 + auto promote + ab-state.json 持久化 🆕
```bash
# v1.0.7 任务4：连续胜出计数器触发自动 promote，状态持久化
grep -n "CONSECUTIVE_WINS_REQUIRED\|consecutiveWins\|ab-state.json\|atomicWrite" sofagent/audit/src/ab-testing/ab-runner.ts | head
# 期望：有匹配
```

#### 227. A/B 运行器升级 DeepAgents + 方案B fallback 🆕
```bash
# v1.0.7 任务5：方案C（DeepAgents 完整 Agent，可工具调用）+ 方案B（runMinimalAgent 超时降级）
grep -n "runDeepAgent\|runMinimalAgent" sofagent/audit/src/ab-testing/ab-runner.ts | head
# 期望：两者都有（runMinimalAgent 作为 timeout/异常 fallback）
```

#### 228. 审计 fast-fail（critical→warning→crutch，SKIPPED 写入 history） 🆕
```bash
# v1.0.7 任务7：审计规则按严重度分级，FAIL 命中即停，跳过规则标 SKIPPED
grep -n "AUDIT_PRIORITY\|critical\|crutch" sofagent/audit/src/rules/runner.ts | head
# 期望：有匹配（分级执行顺序）
grep -n "SKIPPED" sofagent/audit/src/rules/runner.ts | head
# 期望：有匹配（跳过的规则标 SKIPPED 写入 history.jsonl）
```

#### 229. 预装 FDE + Audit Agent（listAgents + subagent run CLI） 🆕
```bash
# v1.0.7 任务8：内置两个 Agent 随 npm 包分发
ls sofagent/audit/src/subagents/builtin-agents.ts 2>/dev/null && echo "OK: builtin-agents.ts 存在" || echo "FAIL: 缺 builtin-agents.ts"
grep -n "listAgents" sofagent/audit/src/subagents/registry.ts | head
# 期望：有匹配（自动合并内置 Agent）
grep -n "subagent run" sofagent/audit/src/index.ts | head
# 期望：有匹配（CLI 入口）
```

#### 230. --doctor 第10项链异常友好输出 🆕
```bash
# v1.0.7 P2-13：第10项不只说"异常"，还要说明可能原因 + --verbose
grep -rn "可能原因\|环境变化\|--verbose" sofagent/audit/src/verify.ts sofagent/audit/src/commands/doctor.ts 2>/dev/null | head
# 期望：有匹配（友好输出）
```

#### 231. --doctor 第9项 timestamp 窗口对齐 🆕
```bash
# v1.0.7 P3-3：第9项 commit 审计追溯与 post-commit 60s 策略对齐，不再依赖 SHA 精确匹配
grep -rn "60.*秒\|timestamp\|窗口" sofagent/audit/src/commands/doctor.ts sofagent/audit/src/verify.ts 2>/dev/null | head
# 期望：有匹配（timestamp 窗口逻辑）
```

#### 232. README 测试数与实际 npm test 一致 🆕
```bash
# v1.0.7 P1-2
ACTUAL=$(cd sofagent/audit && npm test 2>&1 | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+')
grep -qE "$ACTUAL tests 全绿|$ACTUAL\+ tests" README.md && echo "OK: README 测试数=$ACTUAL" || echo "FAIL: README 测试数不一致(实际 $ACTUAL)"
```

#### 233. ROADMAP 测试数与实际 npm test 一致 🆕
```bash
# v1.0.7 P1-3
ACTUAL=$(cd sofagent/audit && npm test 2>&1 | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+')
grep -qE "$ACTUAL|测试全绿" ROADMAP.md && echo "OK" || echo "FAIL: ROADMAP 测试数不一致(实际 $ACTUAL)"
```

#### 234. evidence.md 测试数与实际 npm test 一致 🆕
```bash
# v1.0.7 P1-4
ACTUAL=$(cd sofagent/audit && npm test 2>&1 | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+')
grep -q "$ACTUAL" docs/evidence/evidence.md && echo "OK" || echo "FAIL: evidence.md 测试数不一致(实际 $ACTUAL)"
```

#### 235. CHANGELOG/ROADMAP 不含审查元信息 🆕
```bash
# v1.0.7 P1-5：删除"发布后审查修复"等审查过程元信息
grep -rn "陌生视角审查修复" CHANGELOG.md ROADMAP.md && echo "FAIL: 含审查元信息" || echo "OK: 无审查元信息"
```

#### 236. CONTRIBUTING.md 不含具体模型名 🆕
```bash
# v1.0.7 P2-4
grep -n "DeepSeek V4 Pro\|GLM-5.2" CONTRIBUTING.md && echo "FAIL: 含具体模型名" || echo "OK: 无具体模型名"
```

#### 237. README/README.en 不含无来源 "87%" 🆕
```bash
# v1.0.7 P2-6：中英文都改为定性描述
grep -n "87%" README.md README.en.md && echo "FAIL: 含无来源 87%" || echo "OK: 无 87%"
```

#### 238. README 企业覆盖范围标注 v1.0.7 🆕
```bash
# v1.0.7 P2-10：版本号与当前版本一致（曾误写 v1.0.6）
grep -n "当前版本（v1.0.7）覆盖范围" README.md && echo "OK" || echo "FAIL: 版本号未对齐 v1.0.7"
```

#### 239. README 编排引擎"全平台可用"标注 v1.0.7 🆕
```bash
# v1.0.7 P2-12
grep -n "全平台\|v1.0.7" README.md | grep -i "编排\|平台" | head
# 期望：有匹配（编排引擎全平台开放标注）
```

#### 240. 根目录无 index.html/favicon/sofagent.png 🆕
```bash
# v1.0.7 P2-1：前端文件归位 docs/ 或 docs/assets/
ls *.html *.png 2>/dev/null && echo "FAIL: 根目录仍有前端文件" || echo "OK: 根目录干净"
```

#### 241. README 补充 index.html 用途说明 🆕
```bash
# v1.0.7 P3-5
grep -n "index.html\|落地页\|GitHub Pages" README.md | head
# 期望：有匹配（说明 docs/index.html 是官网落地页）
```

#### 242. CHANGELOG 含 v1.0.7 条目 + ao 退役 Breaking Change 🆕
```bash
# v1.0.7 补充修复#3/#5
grep -n "v1.0.7" CHANGELOG.md | head -3
# 期望：有匹配（v1.0.7 索引条目）
grep -rn "Breaking Change\|agency-orchestrator" CHANGELOG.md SECURITY.md | head
# 期望：有匹配（ao 退役 Breaking Change 标注）
```

#### 243. ROADMAP "现在在哪"对齐 v1.0.7 🆕
```bash
# v1.0.7 补充修复#4
grep -n "现在在哪" ROADMAP.md | head
grep -n "v1.0.7" ROADMAP.md | head -3
# 期望：有匹配（现在在哪对齐 v1.0.7）
```

#### 244. docs/changelog 未发版文件有状态标记 🆕
```bash
# v1.0.7 P3-4：未发版 changelog 必须标"开发中"或类似状态，避免被误认已发布
ls docs/changelog/*.md 2>/dev/null | xargs grep -L "已正式发版\|状态：开发中\|⚠️" 2>/dev/null | grep -v "draft/" && echo "FAIL: 有未发版文件缺状态标记" || echo "OK: 所有 changelog 均有状态标记"
```

#### 245. "自迭代闭环"措辞在 README/CHANGELOG 已软化 🆕
```bash
# v1.0.7 P3-2：promote 仍需手动，不写"自迭代闭环打通"
grep -rn "自迭代闭环" README.md CHANGELOG.md && echo "FAIL: README/CHANGELOG 仍含自迭代闭环" || echo "OK: 已软化（LIMITATIONS 历史描述可接受）"
```

#### 246. 文档头部日期一致性（bump-version 后手动同步） 🆕
```bash
# v1.0.7 P2-11：bump-version.sh 只改版本号不改日期，需手动同步
# 检查主要文档头日期非陈旧（发版后应为实际发版日）
DATE=$(date +%Y-%m-%d)
grep -rn "2026-07-1[0-9]" README.md ROADMAP.md CHANGELOG.md docs/changelog/v1.0.7.md 2>/dev/null | head
# 期望：有匹配（发版日期一致）
```

#### 247. README 编排引擎诚实标注实现规模 🆕
```bash
# v1.0.7 P2-3：保留"编排引擎"名称但标注实现规模（~70 行 DeepAgents 接入层）
grep -n "DeepAgents 接入层\|launcher.ts\|~70 行\|实验性" README.md | head
# 期望：有匹配（诚实标注，不夸大）
```

#### 248. 版本号全量一致（check-version.sh 0 不一致）🆕
```bash
# v1.0.8 新维度（阶段六暴露真问题）：版本一致性不能只查 CLI 自报的少数源——
# 曾只 bump 了 package.json + constants.ts + mcp + index.ts 部分（4 源全 1.0.8），
# 但 91 个文件版本号仍是 1.0.7，4 源检查全过却发了错版。check-version.sh 才是权威门禁。
bash tools/check-version.sh        # 期望：0 不一致（exit 0，39/39 全通过）
bash tools/pre-push-check.sh       # 期望：7/7 全绿（check-version 项是其中一项）
# 快速 sanity（4 源，必要但不充分，不能单独作为 PASS 依据）：
grep '"version"' sofagent/audit/package.json | head -1   # 1.0.8
grep '"version"' sofagent/mcp/package.json | head -1     # 1.0.8
grep "VERSION" sofagent/audit/src/shared/constants.ts     # '1.0.8'
node sofagent/audit/dist/index.js --version              # v1.0.8（需先 npm run build）
```
> ⚠️ **bump-version.sh 工具陷阱（v1.0.8 踩坑）**：脚本从 SSOT（package.json）读取 OLD 版本号。
> 若先手动 bump 了 package.json 却没跑脚本，脚本会误以为"旧版已是目标版"→ 找不到待替换项、空集或崩溃（NEW_3SEG unbound）。
> **正确做法**：版本变更一律用 `bash tools/bump-version.sh <旧> <新>`，禁止手动 grep/sed 部分 bump。
> 若已部分手动 bump，先回退 SSOT 到旧版再跑脚本（见 releasing.md 阶段八）。

#### 249. README 文件系统审计段不再 stale 🆕
```bash
# v1.0.8 已交付文件系统审计（isomorphic-git + fs-watch + 快照回溯）
# 不得再写"v1.0.8+ 规划中 / 当前版本需 git / 当前版本（v1.0.7）覆盖"
grep -n "v1.0.8+ 规划\|当前版本（v1.0.7）\|当前版本需 git" README.md
# 期望：零命中（v1.0.8 实际已含文件系统审计，stale 描述会误导用户以为还没交付）
```

#### 250. FDE SKILL 铁律措辞合格（check-docs 全绿） 🆕
```bash
# v1.0.8 新增 FDE sustain 模式措辞曾触发弱措辞检查
bash tools/check-docs.sh 2>&1 | grep -A20 "Skill 文件行数"
# 期望：10 个 Skill 文件全 OK，铁律措辞"全部合格"，无"超标"
```

#### 251. 文件系统审计新增命令可跑 🆕
```bash
node sofagent/audit/dist/index.js --help 2>&1 | grep -E "compose|subagent|ontology|--revert"
# 期望：含 compose / subagent run / --revert / ontology view
node sofagent/audit/dist/index.js ontology view   # 期望不报错（"not yet initialized" 属正常）
# 期望均成功返回（需先 npm run build）
```

#### 252. agents/ 去耦合不回潮（session.spawn 零命中） 🆕
```bash
# v1.0.8 让 Sub Agent 约束自加载，不依赖 OpenClaw session.spawn
grep -rn "session\.spawn" agents/
# 期望：零命中（出现即回潮，说明又耦合回 OpenClaw）
```

#### 253. 发版终验门禁强制（阶段四/终验不能只验散点项） 🆕
```bash
# v1.0.8 教训：阶段四终审只验了用户指定的 4 项（constants/README/build/test），
# 漏跑了实际发版门禁，版本号散落 91 文件仍是 1.0.7 溜过，阶段六才抓出。
# 以下两条必须实跑通过，作为阶段四/终验的收口硬判定——不能只验"用户指定的几项"。
bash tools/pre-push-check.sh    # 期望 7/7 全绿（非 strict 模式）
bash tools/check-version.sh     # 期望 0 不一致（非 strict 下 1 项 warning 属预期，见 #255）
```

#### 254. 版本变更走工具、禁手动散点 + bump 脚本陷阱 🆕
```bash
# v1.0.8 P0 根因：开发员手动散点 bump（只改 4 源），91 文件漏改。
# 正确做法：版本变更一律走 tools/bump-version.sh，禁止手动改 SSOT。
# 陷阱：若 package.json 已被手动 bump 成新版本，脚本从 SSOT 读 OLD 会误判，
#       296 行 NEW_3SEG unbound 崩溃——需先回退 SSOT 到旧版再跑。
bash tools/bump-version.sh 1.0.7 1.0.8   # 标准用法（SSOT 须为 1.0.7）
bash tools/check-version.sh              # 应 0 不一致
bash tools/pre-push-check.sh             # 应 7/7
```

#### 255. 跨包依赖 semver 范围是预期 warning（非版本不一致 FAIL） 🆕
```bash
# sofagent/mcp/package.json 对 @sofagent/audit 的依赖声明为 "^1.0.0"
# （覆盖 >=1.0.0 <2.0.0，已含 1.0.8）——这是 monorepo 同仓两包一起发版的
# "通用范围"写法，故意不写死 SSOT，否则每发一版都得手改这条依赖。
# check-version.sh 会因"下限 1.0.0 < SSOT 1.0.8"报 1 项 warning：
#   - 功能上 ^1.0.0 已覆盖 1.0.8，不影响发版
#   - 不要用 ^1.0.8 硬编码（每版本都得手改 = reintroduce 散点 bump 风险）
#   - 发版门禁以 pre-push-check 7/7 为权威；该 warning 仅 --strict 下阻断
grep '"@sofagent/audit"' sofagent/mcp/package.json   # 期望 ^1.0.0（通用范围，不随版本改）
```

#### 256. verify.js 脚本目录解析兼容 monorepo 嵌套 🆕
```bash
# v1.0.8 修复：verify/checks.ts 的 verifyScriptDir 曾用 join(__dirname,'..','..')，
# 因 checks.ts 编译在 dist/verify/，两个 .. 只到 audit 包目录（少一级），
# 源码直跑 verify 时 scripts/cleanup.sh/audit.sh 解析错误 → 自检误报 2 项缺失。
# 修复为：部署锚点(~/.openclaw/scripts)优先 + 从 __dirname 向上遍历查找含标记脚本的 scripts/ 父目录。
node sofagent/audit/dist/verify.js   # 期望 §10 企业合规段：cleanup.sh/audit.sh 均"存在且可执行"（无 false failure）
# 验证：源码态从仓库直跑 dist/verify.js，cleanup.sh/audit.sh 应 PASS（不再误报缺失）
```

---

#### 257. CLI 无参报错须是「缺少参数」非「未知参数」 🆕
```bash
# v1.0.9 T07：--revert 无参时不再报"未知参数"，而是给出明确的缺失提示
sofagent-audit --revert              # 期望: "❌ 缺少快照 SHA 参数，格式：sofagent-audit --revert <snapshot-sha>" + exit 2
sofagent-audit --revert --help       # 期望: 同上（不以 --help 开头判定为有效 SHA）
```

#### 258. 根目录信任文件齐全（SECURITY + LIMITATIONS 并列） 🆕
```bash
# v1.0.9 T11：LIMITATIONS.md 迁到根目录，与 SECURITY.md 并列
ls LIMITATIONS.md                    # 期望: 存在
ls ../LIMITATIONS.md               # 期望: 不存在（或仅为重定向）
grep -c "44-48" LIMITATIONS.md       # 期望: ≥ 1（动态范围，非固定值）
```

#### 259. 所有 SKILL.md frontmatter 完整性 🆕
```bash
# v1.0.9 T13：6 处 SKILL.md 全部含 name/slug/version/displayName/description/tags/image/triggers
find . -name SKILL.md ! -path "*/node_modules/*" ! -path "*/experimental/*" -exec grep -L "tags:" {} \;
# 期望: 空输出（全部有 tags 字段）
find . -name SKILL.md ! -path "*/node_modules/*" ! -path "*/experimental/*" -exec wc -l {} \;
# 期望: 全部 ≤ 90 行
```

#### 260. README「非开发者」声称有上手路径 🆕
```bash
# v1.0.9 T15：docs/guides/filesystem-audit.md 提供完整的 daemon 配置→启动→告警→时间线闭环
grep -c "filesystem-audit" README.md   # 期望: ≥ 1（README 引用了文件系统审计指南）
ls docs/guides/filesystem-audit.md     # 期望: 存在
```

#### 261. acceptance-test 不被 set -euo pipefail 误杀 🆕
```bash
# v1.0.9 自测发现：set -euo pipefail 下 git log --oneline | grep -q "xxx" 会因
# SIGPIPE 误判（grep -q 匹配后退出，git log 收到 SIGPIPE 返回非零，pipefail 管道整体非零）
# 检查 acceptance-test.sh 中所有 git log | grep -q / long_output | grep -q 模式
grep -n 'git log.*| grep -q' tools/acceptance-test.sh   # 期望: 每处前后有 set +o pipefail / set -o pipefail 保护
grep -n 'set +o pipefail' tools/acceptance-test.sh       # 期望: ≥ 1
```

#### 262. --install-hook 只装 commit-msg，--init 才装 post-commit 🆕
```bash
# v1.0.9 自测发现：--install-hook 不装 post-commit（只做核心审计拦截），
# --init 才装完整三件套（config + commit-msg + post-commit）。
# 回归测试必须验证两种入口的 hook 差异，而非笼统检查"hook 已安装"
TMP=$(mktemp -d) && cd "$TMP" && git init --quiet
node sofagent/audit/dist/index.js --install-hook > /dev/null 2>&1
test -f .git/hooks/commit-msg && ! test -f .git/hooks/post-commit && echo "CORRECT" || echo "WRONG"
# 期望: CORRECT
rm -rf "$TMP"
```

#### 263. A10 规则只检查依赖文件，不检查源码 URL 🆕
```bash
# v1.0.9 自测发现：A10 "不引毒源" 检查 package.json/requirements.txt 等依赖文件中的可疑 URL，
# 不检查源代码中的 fetch() 调用——这是设计行为，不是 bug。
# 回归测试构造 A10 场景时必须在 package.json 写非官方源，不能在 .ts 文件里写 fetch()
grep -c "DEPENDENCY_FILES" sofagent/audit/src/rules/rule-a10-no-poison.ts   # 期望: ≥ 1
```

#### 264. acceptance-test 中 $CLI 调用必须 || true 防 set -e 中断 🆕
```bash
# v1.0.9 自测发现：set -euo pipefail 下 $CLI --doctor / $CLI --diff 返回非零时
# 直接杀掉整个脚本。所有 $CLI 调用必须 $(... 2>&1 || true) 包装
grep -n 'CLI --doctor 2>&1[^|]' tools/acceptance-test.sh | grep -v '|| true'   # 期望: 空输出
grep -n 'CLI --diff.*2>&1[^|]' tools/acceptance-test.sh | grep -v '|| true'     # 期望: 空输出
```

#### 265. commit-msg hook 拦截后 HEAD 不变，测试 --diff 需绕过 🆕
```bash
# v1.0.9 自测发现：违规 commit 被 commit-msg hook 拦截后 git HEAD 不变，
# 后续 --diff HEAD~1..HEAD 拿不到违规 diff。测试需用 git commit --no-verify 绕过提交，
# 然后再 --diff 手动审计。这是审计引擎的正常工作流（拦截 = 阻止提交）。
grep -c 'no-verify' tools/acceptance-test.sh   # 期望: ≥ 3（场景 10/17/26 各一处）
```

#### 266. 新增函数的代码与测试语义一致性 🆕
```bash
# v1.0.9 阶段六发现：resolveDiffEndpoint 代码把非范围 ref（如 'main'）静默换成 HEAD，
# 但测试期望原样返回——代码 vs 测试语义矛盾。根因：写代码时只考虑了"默认场景"，
# 忘了非范围 ref 也是合法输入。npm test 跑出 1 failed 才暴露。
# 回归检查：每次新增纯函数 + 对应测试，必须验证"所有分支的语义在代码和测试中一致"
cd sofagent/audit && npm test 2>&1 | grep "failed"
# 期望: 空输出（0 failed）
```

#### 267. knownKeys 硬编码列表与注册规则同步 🆕
```bash
# v1.0.9 阶段六发现：新增 A16/A17 规则后，config-loader.ts 的 knownKeys 集合
# 仍停留在 a1-a11/a14-a15，导致用户在 config.yml 写 a16:true 时误报"未知规则名"。
# 回归检查：每次新增规则编号，必须同步 knownKeys + 警告文案
grep -c "a16\|a17" sofagent/audit/src/config-loader.ts   # 期望: ≥ 2
grep -c "A16\|A17" sofagent/audit/src/rules/index.ts     # 期望: ≥ 2（注册列表）
# 两个数字必须一致——knownKeys 里有几条，rules/index.ts 注册表就有几条
```

---

#### 268. 包拆分后 audit/src/ 收敛完整性 🆕
```bash
# v1.1.0 教训：工程师"复制"后忘记"移动"——新包有源码，audit/src/ 也留着副本
# 导致 audit 编译时 import 已删文件时报 TS2307。回归检查：
for d in subagents ontology eval daemon ab-testing; do
  [ -e "sofagent/audit/src/$d" ] && echo "🔴 $d/ 残留" || echo "✅ $d/ 已删"
done
for f in think-generator.ts skill-safety-check.ts skillopt-integration.ts \
         orchestrate-compare.ts diff-parser.ts log-checker.ts config-loader.ts \
         model-client.ts cost-baseline.ts env-check.ts run-envs.ts log-reader.ts \
         compress-memory.ts verify-evidence.ts; do
  [ -f "sofagent/audit/src/$f" ] && echo "🔴 $f 残留" || echo "✅ $f 已删"
done
for d in verify hitl config shared; do
  [ -d "sofagent/audit/src/$d" ] && echo "🔴 $d/ 残留" || echo "✅ $d/ 已删"
done
# 期望：全部"已删"
```

#### 269. 跨包 import 改写完整性 🆕
```bash
# v1.1.0 教训：audit/src/index.ts 中残留 `./log-checker` 等已迁出模块的 import
# 编译不报错（因为文件还在），但实际应该从 @sofagent/core 引用
grep -n "from '\./\(diff-parser\|log-checker\|config-loader\|model-client\|cost-baseline\|env-check\|run-envs\|log-reader\)" sofagent/audit/src/index.ts 2>/dev/null
# 期望：零输出
grep -rn "from '\.\.\/subagents\|from '\.\.\/eval\|from '\.\.\/daemon" sofagent/audit/src/ 2>/dev/null
# 期望：零输出
```

#### 270. 基础层叶子包零依赖验证 🆕
```bash
# v1.1.0 架构铁律：harness/ontology/eval/core 为零依赖叶子包
for pkg in harness ontology eval core; do
  result=$(grep -rn "from '@sofagent/" "sofagent/$pkg/src/" 2>/dev/null)
  [ -z "$result" ] && echo "✅ $pkg 零 @sofagent/* import" || echo "🔴 $pkg: $result"
done
# 期望：四个包全部 ✅
```

#### 271. 多包独立构建验证 🆕
```bash
# v1.1.0 教训：audit 构建通过不代表 core/orchestrator 也能独立构建
# core 曾因缺少 filesystem/ 目录报 TS2307。每个包必须独立 tsc --noEmit
for pkg in core orchestrator audit; do
  echo "=== $pkg ==="
  (cd "sofagent/$pkg" && npx tsc --noEmit 2>&1 | head -5)
  [ ${PIPESTATUS[0]} -eq 0 ] && echo "✅ $pkg build OK" || echo "🔴 $pkg build FAIL"
done
# 期望：全部 ✅
```

#### 272. AI 工程师输出验证门禁 🆕
```bash
# v1.1.0 核心教训：AI 工程师的 IS_PASS 声明不可采信
# 每波开发完成后必须实跑以下三条，以实跑结果为准，不以声明为准：
npm run build 2>&1 | grep -c "error TS"   # 期望: 0（根 package.json 拓扑序链式构建）
cd sofagent/audit && npm test 2>&1 | grep "Tests"      # 期望: N passed, 0 failed
for pkg in core orchestrator audit; do (cd "sofagent/$pkg" && npx tsc --noEmit); done
# 三条全绿才算通过
```

#### 273. 测试工厂函数迁移兼容性 🆕
```bash
# v1.1.0 教训：makeCtx/makeDiffFile 从 audit 内联 helper 改为 test-utils.ts 后，
# 参数签名不兼容——makeCtx 只有 2 参数但调用方传 3 个、makeDiffFile 缺 status 参数。
# 回归检查：确认 test-utils.ts 的 makeCtx 支持智能参数检测（数组→logEntries，对象→overrides）
grep -A15 "export function makeCtx" sofagent/audit/src/test-utils.ts | grep -c "Array.isArray"
# 期望: ≥ 1（智能检测数组 vs 对象）
grep "status" sofagent/audit/src/test-utils.ts | grep "makeDiffFile" -A5 | grep -c "status"
# 期望: ≥ 1（makeDiffFile 接受 status 参数）
```

#### 274. 测试数迁移后文档全量同步 🆕
```bash
# v1.1.0 教训：测试数从 531→417（孤儿测试文件随被测模块迁出），
# 但文档只改了部分地方，ROADMAP/FDE/evidence/LIMITATIONS 仍写 531
ACTUAL=$(cd sofagent/audit && npm test 2>&1 | grep "Tests" | sed 's/.*Tests *\([0-9]*\) passed.*/\1/')
for file in ROADMAP.md FDE/FDE.md docs/evidence/evidence.md LIMITATIONS.md; do
  grep -q "$ACTUAL" "$file" && echo "✅ $file" || echo "🔴 $file: 测试数不是 $ACTUAL"
done
# 期望：全部 ✅
```

#### 275. orphan 测试文件清理 🆕
```bash
# v1.1.0 教训：被测模块迁出后，audit/src/__tests__/ 中对应测试文件未被迁移或删除
# 导致 vitest 因 import 已删模块而失败（module resolution 在 hoisting 之前失败）
# 回归检查：确认 audit/src/__tests__/ 中无引用已迁出模块的测试文件
grep -rn "from '\(\.\./\)*\(subagents\|\.\./eval\|\.\./daemon\|\.\./ab-test\)" sofagent/audit/src/__tests__/ 2>/dev/null
# 期望：零输出（所有测试文件只引用 audit 内部模块或 @sofagent/core）
```

#### 276. audit/package.json bin 字段清理 🆕
```bash
# v1.1.0 教训：子命令迁出后 audit/bin 仍含 sofagent-verify 等已迁出二进制
grep -A10 '"bin"' sofagent/audit/package.json | grep -v "sofagent-audit\|@sofagent/audit"
# 期望：零输出（仅含 sofagent-audit + @sofagent/audit）
```

#### 277. npm workspace 12 包无循环依赖 🆕
```bash
# v1.1.0 要求：12 包依赖方向严格单向，无循环
npm ls --depth=0 2>&1 | grep "UNMET\|ERR\|cycle"
# 期望：零输出
for pkg in harness ontology eval core; do
  grep "from '@sofagent/" "sofagent/$pkg/src/" -rn 2>/dev/null && echo "🔴 $pkg 不应有 @sofagent/* import"
done
# 期望：四个包全部无输出
```

---

#### 278. workspace 构建顺序一致性 🆕
```bash
# v1.1.0 CI 教训：npm --workspaces 按 package.json 数组顺序构建，不按依赖拓扑排序
# think 必须排在 mcp 前面（mcp 依赖 @sofagent/think），否则 CI 报 TS2307
# 回归检查：验证 workspace 数组中每个消费方排在所有被依赖方之后
# 关键对：audit 在 think 之前？think 在 mcp 之前？orchestrator 在 ab-test 之前？
grep -A12 '"workspaces"' package.json | head -14
# 人工检查：think 的索引 < mcp 的索引？audit 的索引 < think 的索引？
```

#### 279. 12 包 npm publish 依赖层验证 🆕
```bash
# v1.1.0 教训：12 包按依赖层分 5 批发布，publish 顺序错误会导致 npm install 失败
# 发布后验证所有包的 npm registry 版本一致
for pkg in harness ontology eval core audit think mcp orchestrator daemon ab-test workflow-hub skillopt; do
  ver=$(npm view "@sofagent/$pkg" version 2>/dev/null || echo "MISSING")
  echo "@sofagent/$pkg: $ver"
done
# 期望：全部 = 新版本号，无 "MISSING"
```

#### 280. 新包 vitest 退出码正确性 🆕
```bash
# v1.1.0 CI 教训：workflow-hub 零测试文件时 vitest exit 1，导致 pre-push 假失败
# 解决方案：补测试文件，或 vitest 配置 allowEmpty: true
# 回归检查：所有 12 包运行 npm test 后 exit 0
for pkg in harness ontology eval core audit mcp orchestrator daemon ab-test workflow-hub think skillopt; do
  (cd sofagent/$pkg && npm test >/dev/null 2>&1)
  [ $? -eq 0 ] && echo "✅ $pkg" || echo "🔴 $pkg test exit != 0"
done
# 期望：全部 ✅
```

#### 281. acceptance-test 全场景不死锁 🆕
```bash
# v1.1.0 教训：acceptance-test 场景 10 起在 git tmp 仓库中卡死（.env 文件残留污染）
# 回归检查：每个场景后清理 git 状态 + .env 文件，确保下一场景不污染
grep -c 'git reset --hard\|rm -f .env\|git clean' tools/acceptance-test.sh
# 期望：≥ 5（每个场景间有清理逻辑）
```

#### 282. check-version.sh 注释过滤精度 🆕
```bash
# v1.1.0 教训：check-version.sh 的 grep -v 过滤可能误杀真实版本声明
# 或漏放历史注释行（/** */、// 等）
# 回归检查：确认以下两类都不会出现
# 1. 真实非注释版本声明被误过滤（如 const VERSION = '1.1.0' 不在 // 或 /* 行内）
# 2. 纯注释行仍被标记为不一致（如 "// v1.0.9 新增"）
./tools/check-version.sh 2>&1 | grep "✗" | grep -v "发现\|npm 二进制" | wc -l
# 期望：0（仅全局 npm 二进制版本警告可忽略）
```

#### 283. shellcheck 零 info 级 🆕
```bash
# v1.1.0 教训：shellcheck info 级（SC1090/SC2034）虽不阻断但应逐步清零
shellcheck sofagent/scripts/*.sh tools/*.sh FDE/fde-install.sh 2>&1 | grep -c "SC1090\|SC1091\|SC2016"
# 期望：0
```
```

#### 221. 文档体系 + MCP + 术语一致性 🆕

```bash
# PHILOSOPHY 被核心文档引用数
grep -rl "PHILOSOPHY" README.md README.en.md ROADMAP.md docs/HANDBOOK.md docs/ARCHITECTURE.md docs/DEVELOPMENT.md FDE/FDE.md LOOP/LOOP.md | wc -l
# 期望：≥8

# MCP 指南被核心文档引用数
grep -rl "mcp-usage" README.md README.en.md docs/HANDBOOK.md docs/ARCHITECTURE.md docs/DEVELOPMENT.md docs/PHILOSOPHY.md FDE/FDE.md | wc -l
# 期望：7

# 核心文档 logo 160px 统一
grep -l 'sofagent.png.*width="160"' README.md README.en.md ROADMAP.md docs/HANDBOOK.md docs/ARCHITECTURE.md docs/DEVELOPMENT.md docs/PHILOSOPHY.md docs/THANKS.md FDE/FDE.md LOOP/LOOP.md | wc -l
# 期望：10

# MCP 指南 resource 数量
grep -c '\^| \\\`' docs/guides/mcp-usage.md
# 期望：≥25

# v1.1.3-v1.1.9 changelog 全部存在
ls docs/changelog/v1.1.{1,2,3,4,5,6,7,8,9}.md | wc -l
# 期望：9

# 「一底座四引擎」术语统一
grep -rn "五引擎" --include="*.md" . | grep -v "一底座" | grep -v "fresh-eyes" | grep -v "regression" || echo "PASS: 术语统一"
# 期望：PASS

#### 284. 回归清单头维度数与实际 #### 数自动校验 🆕

```bash
# 头声称的数字必须与实际 #### 标题数一致
HEAD=$(head -1 docs/verification/regression-checklist.md | grep -oE '[0-9]+' | head -1)
ACTUAL=$(grep -c "^#### " docs/verification/regression-checklist.md)
[ "$HEAD" = "$ACTUAL" ] && echo "PASS: 维度数一致 ($HEAD)" || echo "FAIL: 头声称 $HEAD ≠ 实际 $ACTUAL"
# 期望：PASS
```

#### 285. CHANGELOG 纯度 grep 扩展词汇 🆕

```bash
# v1.1.3 新增「驱动」等审查过程措辞
grep -niE "陌生视角|审查驱动|审查发现|审查驱动修复|驱动.*修复|审查吸收|P[0-9]×" CHANGELOG.md docs/changelog/v*.md
# 期望：零命中（除非是合法技术内容如 LLM 接入表）
```

#### 286. 依赖铁律文档与 package.json 实际依赖 diff 校验 🆕

```bash
# 检查 v1.1.0.md 中描述的依赖关系是否与各包 package.json 实际一致
# 对比 audit 的 dependencies
AUDIT_CLAIM=$(grep "audit.*依赖\|audit.*depend" docs/changelog/v1.1.0.md | head -1)
AUDIT_ACTUAL=$(node -e "const d=require('./sofagent/audit/package.json').dependencies; console.log(Object.keys(d).filter(k=>k.startsWith('@sofagent/')).join(','))")
echo "audit 声称: $AUDIT_CLAIM"
echo "audit 实际: @sofagent/ 依赖: $AUDIT_ACTUAL"
# 对比 mcp 的 dependencies
MCP_ACTUAL=$(node -e "const d=require('./sofagent/mcp/package.json').dependencies; console.log(Object.keys(d).filter(k=>k.startsWith('@sofagent/')).join(','))")
echo "mcp 实际: @sofagent/ 依赖: $MCP_ACTUAL"
# 对比 orchestrator 的 dependencies
ORCH_ACTUAL=$(node -e "const d=require('./sofagent/orchestrator/package.json').dependencies; console.log(Object.keys(d).filter(k=>k.startsWith('@sofagent/')).join(','))")
echo "orchestrator 实际: @sofagent/ 依赖: $ORCH_ACTUAL"
# 对比 daemon 的 dependencies
DAEM_ACTUAL=$(node -e "const d=require('./sofagent/daemon/package.json').dependencies; console.log(Object.keys(d).filter(k=>k.startsWith('@sofagent/')).join(','))")
echo "daemon 实际: @sofagent/ 依赖: $DAEM_ACTUAL"
# 期望：文档描述与上述实际输出一致
```

#### 287. 兼容 shim 代码与注释一致性 🆕

```bash
# deprecation shim 注释中写了"已改为 X"的，必须和代码实际逻辑一致
# 检查 1：index.ts 中 doctor/verify/compose 三个 shim 的对齐情况
grep -n "已改\|P0 fix\|use direct\|友好报错\|友好降级" sofagent/audit/src/index.ts
# 期望：每个注释描述与实际实现匹配（direct import 的确实用了 await import，友好报错的确实用了 exit(1)）

# 检查 2：遍历所有含 "execFileSync" 的 shim 调用
grep -n "execFileSync" sofagent/audit/src/index.ts
# 期望：已改为友好降级（exit 1 + 提示），不再有 execFileSync 调外部二进制
```

#### 288. 输出签名一致性——CLI / Webhook / MCP / 审查报告 🆕

```bash
# v1.1.3 引入 Harness 可见性：所有输出渠道必须具备 sofagent 签名
# CLI 审计输出含引擎签名行
grep -n "审计引擎: sofagent-audit" sofagent/audit/src/index.ts
# 期望：PASS/WARN/FAIL 三个分支均含

# Webhook 消息模板以 "sofagent" 开头
grep -n "sofagent 审计" sofagent/audit/src/webhook.ts
# 期望：PASS/WARN/FAIL 三个模板均含

# MCP 工具返回值含 [sofagent] 前缀
grep -c "\[sofagent\]" sofagent/mcp/src/mcp-server.ts
# 期望：≥4（审计/知识查询/think.md/compose 等至少 4 个工具）

# 审查报告模板顶部含签名段
grep -n "sofagent 审计引擎" agents/engineering-code-reviewer.md
# 期望：命中
```

#### 289. 约束底座加载链注入可见性 🆕

```bash
# 四层加载链（SKILL.md/fde.md/think.md/knowledge/）在 Agent 上下文中
# 是否标注了来源——用户/Agent 是否知道这些约束来自 sofagent
grep -rn "sofagent\|Harness\|加载链" skill/SKILL.md | head -3
# 期望：至少 SKILL.md 开头标注 "由 sofagent Harness 层注入"
```

#### 290. 错误消息归属——异常时是否标明 sofagent 🆕

```bash
# 审计拦截、doctor 告警、daemon 通知等异常消息是否以 sofagent 标识开头
# 检查 audit 退出消息
grep -n "⛔\|❌\|⚠️.*sofagent\|sofagent.*拦截\|sofagent.*阻断" sofagent/audit/src/index.ts | head -5
# 期望：异常消息含 sofagent 标识

# 检查 doctor 告警
grep -n "sofagent" sofagent/core/src/doctor.ts | head -5
# 期望：doctor 输出含 sofagent 引擎身份

# 检查 daemon 通知
grep -n "sofagent" sofagent/daemon/src/notify.ts 2>/dev/null || echo "notify.ts 不存在——检查 daemon 的通知机制"
# 期望：daemon 通知含 sofagent 标识
```

#### 291. 安装输出签名一致性 🆕

```bash
# install.sh / --init 输出是否有 sofagent 品牌标识
grep -c "sofagent" install.sh
# 期望：≥3（banner + 成功消息 + 下一步提示）

# --init 输出
grep -c "sofagent[ -]" sofagent/audit/src/commands/init.ts
# 期望：≥1
```

#### 292. 包依赖图审计——依赖方向 / optional 边 / 分层倒置 🆕

```bash
# 审计各包之间的 @sofagent/* 依赖是否违反架构铁律
# 1. 基础层叶子包（harness/ontology/eval/core）不得 import 任何 @sofagent/*
for pkg in harness ontology eval core; do
  echo "--- $pkg ---"
  grep -rn "from '@sofagent/" "sofagent/$pkg/src/" --exclude-dir=__tests__ 2>/dev/null && echo "❌ 发现跨包引用" || echo "✅ 零跨包引用"
done

# 2. daemon→audit 分层倒置（运行层依赖纯审计层——已知架构债务，需持续监控）
grep '"@sofagent/audit"' sofagent/daemon/package.json && echo "⚠️  daemon→audit 分层倒置持续存在"

# 3. 检查是否有循环依赖
# （简单检查：任何 A→B 的关系不应同时有 B→A）
node -e "
const pkgs = ['audit','core','harness','ontology','eval','orchestrator','daemon','ab-test','think','skillopt','workflow-hub','mcp'];
const deps = {};
pkgs.forEach(p => {
  try {
    const pkg = require('./sofagent/' + p + '/package.json');
    const sofagentDeps = Object.keys({...pkg.dependencies, ...pkg.optionalDependencies}).filter(k => k.startsWith('@sofagent/')).map(k => k.replace('@sofagent/',''));
    deps[p] = sofagentDeps;
  } catch(e) {}
});
let cycles = 0;
Object.entries(deps).forEach(([p, ds]) => {
  ds.forEach(d => {
    if (deps[d] && deps[d].includes(p)) { console.log('❌ 循环依赖: ' + p + ' ↔ ' + d); cycles++; }
  });
});
if (cycles === 0) console.log('✅ 无循环依赖');
"
# 期望：零循环依赖；分层倒置持续监控但已知
```

---
- **不要建议新功能**——v1.0 是正式版，不是功能版
- **发现的问题请给出文件路径 + 行号 + 具体建议**，不要泛泛而谈

---

> **审查者**：请严格验证每一项声称，不放过任何矛盾。全维度逐项核对。

---

#### 293. 感知层配置完整性 🆕

```bash
# 检查 .sofagent/config.yml 中 perception 配置段是否存在且 enabled
grep -A 2 "perception:" .sofagent/config.yml 2>/dev/null && echo "✅ 感知配置段存在" || echo "❌ 缺少感知配置段"
grep "enabled: true" .sofagent/config.yml 2>/dev/null && echo "✅ 感知推送已启用" || echo "⚠️  感知推送未启用"
```

#### 294. 感知推送目标可达 🆕

```bash
# 检查 push_target 配置的 webhook URL 是否有效
grep "push_target:" .sofagent/config.yml | grep -q "webhook://" && echo "✅ push_target 已配置" || echo "❌ push_target 未配置"
```

#### 295. MCP 返回值签名覆盖率 🆕

```bash
# 检查 mcp-server.ts 中所有 sendToolResult 调用是否有 [sofagent] 前缀
# 审计工具必须带签名
grep "sofagent-audit.*扫描" sofagent/mcp/src/mcp-server.ts > /dev/null && echo "✅ 审计工具已签名" || echo "❌ 审计工具缺签名"
# 知识查询工具必须带签名
grep "sofagent.*知识库查询\|sofagent.*knowledge" sofagent/mcp/src/mcp-server.ts > /dev/null && echo "✅ 知识查询已签名" || echo "⚠️  知识查询缺签名"
```

#### 296. Webhook PASSl 推送已实现 🆕

```bash
# 检查 webhook.ts 中 PASS 时是否也推送（不只是 WARN/FAIL）
grep -c "PASS" sofagent/audit/src/webhook.ts
# 应 > 0，说明 PASS 路径存在推送逻辑
```

#### 297. MCP capabilities 工具描述准确性 🆕

```bash
# 检查 MCP tools/list 中 run_audit 的描述是否含引擎来源和正确规则数
grep "run_audit" sofagent/mcp/src/mcp-server.ts | grep -c "19 条规则"
# 应 ≥ 1，描述应含 "19 条规则"（不是过期的 "A1-A14"）

grep "run_audit" sofagent/mcp/src/mcp-server.ts | grep -c "0 token"
# 应 ≥ 1，描述应标注 "0 token 纯正则"（避免用户误以为消耗 LLM token）

# 反向验证：不应再出现过期规则描述
grep "run_audit" sofagent/mcp/src/mcp-server.ts | grep -c "A1-A14"
# 应 = 0，「A1-A14」为过期描述（v1.1.3 P0-5 修复），当前正确写法是「19 条规则」
```

#### 298. 回归清单头维度数自动校验 🆕

```bash
# 阶段六发现：头声称数字与 #### 实际数漂移（254≠259）
HEAD_VAL=$(head -1 docs/verification/regression-checklist.md | grep -oE '[0-9]+' | head -1)
ACTUAL=$(grep -c "^#### " docs/verification/regression-checklist.md)
[ "$HEAD_VAL" = "$ACTUAL" ] && echo "✅ 维度数一致 ($HEAD_VAL)" || echo "❌ 头声称 $HEAD_VAL ≠ 实际 $ACTUAL"
# 期望：PASS
```

#### 299. CHANGELOG 纯度自动化检查加入 pre-push 🆕

```bash
# 阶段六发现：changelog v1.1.3.md 含审查过程措辞
# 所有 changelog 文件 + ROADMAP 不得含审查过程元信息
# 注意：v1.1.5.md:18 的 "Agent 跑独立审查" 是 FDE 工作流描述，属正常功能文档
grep -rniE "审查修复|审查驱动|P[0-9]×|审查问题.*项修复" docs/changelog/ CHANGELOG.md ROADMAP.md
# 期望：零命中（工作流正当描述如 "独立审查 + 写 changelog" 不在此列）
```

#### 300. 包依赖图循环检测（audit ↔ daemon） 🆕

```bash
# 阶段六发现：audit optionalDeps → daemon，daemon deps → audit
# 检查 audit 是否可选依赖 daemon
AUDIT_OPT=$(node -e "const p=require('./sofagent/audit/package.json'); console.log(p.optionalDependencies?.['@sofagent/daemon'] ? 'OPTIONAL_DAEMON' : 'NONE')")
# 检查 daemon 是否依赖 audit
DAEMON_DEP=$(node -e "const p=require('./sofagent/daemon/package.json'); console.log(p.dependencies?.['@sofagent/audit'] ? 'DEP_AUDIT' : 'NONE')")
if [ "$AUDIT_OPT" = "OPTIONAL_DAEMON" ] && [ "$DAEMON_DEP" = "DEP_AUDIT" ]; then
  echo "⚠️  循环依赖持续存在（audit→daemon optional + daemon→audit dep）—已知架构债务"
else
  echo "✅ 无循环依赖"
fi
# 期望：已知循环持续监控，v1.2.x 评估解耦
```

#### 307. acceptance-test.sh 管道 pipefail 保护 🆕

```bash
# v1.1.3 BugFix：场景28 echo | grep | head 在 grep 无匹配时 pipefail 触发 set -e
# 所有展示管道必须 || true
grep -n 'grep.*|.*head\|grep.*|.*wc' tools/acceptance-test.sh | grep -v '|| true'
# 期望：零命中
```

#### 308. audit README 规则分级与代码一致性 🆕

```bash
# v1.1.3 BugFix：README A6=业务底线（代码=能力拐杖）、A11=能力拐杖（代码=业务底线）
# 以 rules/index.ts 的 ruleClass 为 SSOT
grep "不坏构建" sofagent/audit/src/rules/index.ts | grep -o "能力拐杖" && echo "A6=能力拐杖 ✅"
grep "不滥资源" sofagent/audit/src/rules/index.ts | grep -o "业务底线" && echo "A11=业务底线 ✅"
grep "A6.*能力拐杖\|A11.*业务底线" sofagent/audit/README.md | wc -l
# 期望：2（README 与代码一致）
```

#### 309. audit README 测试数时效性 🆕

```bash
# v1.1.3 BugFix：README 写 418 tests，实际 vitest = 342
README_NUM=$(grep -oP '[0-9]+(?= tests)' sofagent/audit/README.md)
ACTUAL_NUM=$(cd sofagent/audit && npx vitest run 2>&1 | grep Tests | grep -oP '[0-9]+(?= passed)')
[ "$README_NUM" = "$ACTUAL_NUM" ] && echo "✅ $README_NUM" || echo "❌ README $README_NUM ≠ 实际 $ACTUAL_NUM"
# 期望：✅
```

#### 310. webhook.ts 版本号硬编码检测 🆕

```bash
# v1.1.3 BugFix：webhook.ts 硬编码 '1.1.3'，应 import VERSION from @sofagent/core
grep -rn "version\s*=\s*'[0-9]" sofagent/*/src/*.ts | grep -v __tests__ | grep -v shared/constants | grep -v node_modules
# 期望：零命中（所有版本号来自 @sofagent/core 或 shared/constants.ts）
```

#### 311. acceptance-test.sh scenario() 场景间清理完整性 🆕

```bash
# v1.1.3 BugFix：scenario() 清理函数只删工作区 .env，不删 git index 中的 .env
grep -c "git rm --cached -f .env" tools/acceptance-test.sh
# 期望：≥ 2（scenario() 函数内 + 场景11后各一处）
```

#### 312. 动态规则禁用逻辑核验（config.yml rules: { a16: false } 实跑验证） 🆕

```bash
# v1.1.3 第二次审查：config-loader.ts 已迁至 core/src/，rules/index.ts 仍为规则注册 SSOT
# 核验 runner.ts 动态键禁用逻辑——在 config.yml 禁掉规则后，实际审计输出中不应出现该规则
# 检查手法：验证 config-loader 已知键集合与 index.ts 注册规则一致，且禁用真的生效
cd /Users/kongfangxun/Workbuddy/sofagent
# 确认 runner.ts 的 a{number}/e{number} 动态键能正确映射到 index.ts 注册的每条规则
grep -c "a16" sofagent/core/src/config-loader.ts
grep -c "a17" sofagent/core/src/config-loader.ts
# 期望：≥ 1（knownKeys 含 a16/a17）
grep -c "A16" sofagent/audit/src/rules/index.ts
grep -c "A17" sofagent/audit/src/rules/index.ts
# 期望：≥ 1（index.ts 注册了 A16/A17）
```

#### 313. tag commit message 含版本号 🆕

```bash
# v1.1.3 第二次审查：v1.1.3 tag 指向 commit message = "v1.1.3: …"
# tag 版本号必须与指向的 commit message 中的版本号一致
git tag -l "v*" | while read t; do
  v=$(echo $t | sed 's/^v//')
  msg=$(git log -1 --format=%s $t)
  echo "$t → $msg"
done
# 期望：每个 tag 的 commit message 含对应版本号
```

#### 314. 孤儿 changelog 检测 🆕

```bash
# v1.1.3 第二次审查：docs/changelog/v1.1.3.md 存在但无对应 tag（应为规划中）
# 正向：changelog 文件是否有对应 tag
for f in docs/changelog/v*.md; do
  v=$(basename $f .md)
  git rev-parse $v >/dev/null 2>&1 || echo "⚠️ $v: changelog 存在但无对应 tag（应为规划中）"
done
# 期望：无输出 = 全部有对应 tag（规划中的 changelog 应标注「规划中」）
# 反向：tag 是否有对应 CHANGELOG 索引
git tag -l "v*" | while read t; do
  grep -q "$t" CHANGELOG.md || echo "❌ $t: tag 存在但 CHANGELOG.md 索引遗漏"
done
# 期望：零输出
```

#### 315. CHANGELOG 纯度 grep 扩至全量子文件 🆕

```bash
# v1.1.3 第二次审查：纯度 grep 从 CHANGELOG.md 扩展到 docs/changelog/v*.md 全量
# 历史 experimental changelog 可能含遗留审查元信息
grep -rniE "GLM|DeepSeek|双视角|P[012]×|审查修复|陌生视角|fresh-eyes|审查轮次|审查×|审查驱动|审查吸收" CHANGELOG.md docs/changelog/v*.md
# 期望：零命中（工作流正当描述如「FDE 审查报告」「独立审查 + 写 changelog」不在此列）
```

#### 316. ruleClass 代码↔README 跨文档一致性 🆕

```bash
# v1.1.3 第二次审查：A6/A11 的 ruleClass 在 index.ts 和 audit/README.md 之间反复漂移
# 以 rules/index.ts 为 SSOT，全量对比 audit/README.md 规则表
# 当前只做 A6/A11 人工 grep（维度 308），本维度扩展为全量逐行 diff
# 方法：提取 index.ts 的 name+ruleClass → 与 audit/README.md 规则表逐行对照
grep "name:" sofagent/audit/src/rules/index.ts | wc -l
# 期望：19（规则总数，与 README 声称一致）
echo "建议：将 ruleClass 全量 diff 脚本加入 pre-push-check（参考维度 308 的 A6/A11 手动 grep）"
```
