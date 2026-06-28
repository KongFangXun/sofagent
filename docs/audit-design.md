# sofagent-audit 设计文档

> v0.96 · 2026-06-27 · 提交时审计
> **v0.95 更新**：铁律从 10 条减为 6 条，原 #1/#3/#7/#10 迁移为审计 A3/A5/A7/A8。下文铁律编号为 v0.94 历史设计记录。

写这篇 doc 的原因是：v0.90 的约束 Agent 根本不理我。所以干脆不看它，直接 audit git diff。

## 📖 设计背景

sofagent v0.90 之前的架构是**运行时管 Agent**——通过 MD 文件注入约束来指导 Agent 行为。这套架构有三个硬伤：

1. **依赖 Agent 配合**——Agent 不读 MD 文件就全失效，CLI 实测结果是 0/16，一条都没读。
2. **不可跨平台**——Hook 和断路器只在 OpenClaw 生效，换个环境就废了。
3. **Agent 可绕过**——CLI 场景下 Agent 直接跳过加载链，约束形同虚设。

v0.91 换了思路：**从预防转向检测**。提交时审计不依赖 Agent 配合——它看的是已经发生的 git diff，不是 Agent 声称它做了什么。

## 🎯 MVP 规则集

从旧版 10 条铁律中选出 4 条可程序化判定的（已迁移为审计 A3/A5/A7/A8），本文件是 v0.94 前的设计记录。

| 铁律 | 判定逻辑 | exit code |
|------|------|:--:|
| #1 先读再用 | diff 中被修改的文件，修改前是否有 Read 操作记录。检查 .sofagent/task/logs/ 目录 | 2（违规） |
| #3 验证再干 | package.json 或 build.gradle 等构建文件变更后，是否有 test 或 build 命令执行记录 | 2（违规） |
| #7 谨慎修改 | diff 中是否有不在 --task 描述关键词范围内的文件 | 1（警告） |
| #10 如实汇报 | commit message 是否为空，或者是否为纯占位符。比如 "fix"、"update"、"wip" 这些 | 1（警告） |

不可程序化的铁律 #2、#4、#5、#6、#8、#9 属于 MVP 不覆盖范围，v0.92 加 LLM 辅助判定。

## 🔧 技术选型

**TypeScript**，不是 bash。

- git diff 解析需要结构化处理
- GitHub Action 集成需要 npm 包生态
- 零运行时依赖，只用 Node.js 内置模块：child_process、fs、path

其实主要原因是不想再写 bash 了（以及终于理解了一点 TypeScript——至少能看懂编译报错了）。

## ⚠️ 误报率

误报率小于 10%，达不到就少检查几条，宁可准不能多。比如只检查「先读再用」一条，不做广度优先全面检查。

## 🔒 焊死的门

检查规则独立只读——Agent 不可篡改检查标准。审计脚本扫的是 git diff，这是已经发生的历史记录，不是 Agent 的工作目录。Agent 即使在运行时绕过约束，审计仍能通过 diff 回溯发现问题。

监控四种篡改：
- 改断言来匹配错误行为
- 删掉失败的测试
- 加 lint-ignore 绕过检查
- 降低覆盖率阈值

> ⚠️ **信任模型声明（v0.92）**：上述"焊死的门"仅适用于 git diff 审计——diff 是已发生的客观记录，Agent 无法篡改。但铁律 #1/#3 的日志检查依赖 `.sofagent/task/logs/*.md`，这些日志是 **Agent 自我报告**，不是系统级工具调用日志。Agent 可在日志中伪造"已读取""已测试"记录来绕过检测。审计工具的可靠性上限 = Agent 日志的真实性。详见 [LIMITATIONS.md](../LIMITATIONS.md)。

## 🚫 暂不包含

| 功能 | 状态 |
|------|------|
| LLM 辅助判定（#2/#4/#5/#6/#8/#9） | v0.94+ |
| 误报率优化 | v0.92 ✅（27 cases FP=0%）|
| CI gate——PR 合并前强制检查 | v0.94 |
| 审计报告（HTML/JSON） | v0.94 |
| 跨项目基线——多 repo 对比 | v1.x |
| `--strict` 模式（无日志直接 FAIL） | v0.93 ✅ |
| OWASP Top 10 合规检查 | v1.x |

> 💡 **设计灵感：Bun 的反驳姿态**。Bun 团队迁移 75 万行 Zig→Rust 时，评审者拿到的不是完整上下文，只是最终 diff——看不到生成过程，不会沿执行者的推理路径走。核心原则：不是「检查写得对不对」，而是「假设写错了，找证据证伪」。v0.93 可探索「假设错误」模式。

## 🐛 已知局限

以下三个局限在 v0.92 已修复：

1. ~~铁律 #7 中英不互通~~ → **v0.92 修复**（P1-6：中文文件名精确匹配 + 路径模式匹配）
2. ~~铁律 #3 构建文件白名单不完整~~ → **v0.92 修复**（P1-9：BUILD_FILES 扩展 7 项含 tsconfig.json 等）
3. ~~铁律 #1 对新项目友好但可能漏判~~ → **v0.92 修复**（P0-3：无日志 WARN 降级 + 精确 basename 匹配）

---

## 🔮 扩展审计规则草案

> v0.96 只写规则定义。代码实现推 v0.97。

### A9 · 不纳注入（No Prompt Injection）

**问题**：Agent 从外部网页、Issue、PR 描述等读取内容时，可能被注入恶意指令（「忽略之前的指令」「你现在是 DAN」等），导致生成代码中嵌入后门或越权操作。A1-A8 覆盖了「Agent 粗心」，无法覆盖「Agent 被攻击」。

**触发条件**（二选一即 WARN，同时命中即 FAIL）：

| 条件 | 检测方式 | 证据类型 |
|------|------|:--:|
| 特征匹配 | git diff 内容中出现注入特征串 | git-diff |
| 范围偏离 | diff 改了文件，但改动内容与 `--task` 声明的任务描述相似度过低 | git-diff |

**「相似度过低」的判定方法**（v0.97 实现时定）：

草案阶段只给方向，不给阈值——避免过早锁死实现。候选方案：

| 方案 | 思路 | 优点 | 缺点 |
|------|------|------|------|
| **token 级 Jaccard** | task 描述和 diff 内容分别分词 → 交集/并集 → 相似度 < 0.1 判为零交集 | 稳健，对词序不敏感 | 中文分词需要分词器（jieba 等） |
| 全词匹配 | task 关键词在 diff 中出现的比例 < 阈值 | 零依赖 | 英文大小写 / 中文无空格容易误判 |
| 子串匹配 | task 描述的子串在 diff 中命中 | 简单 | 误报率高（短 task 描述几乎都有子串命中） |

**推荐**：token 级 Jaccard，阈值 < 0.1。中文场景用字符级 bigram 替代分词器——零额外依赖。最终方案在 v0.97 实现时用真实 fixture 数据验证后确定。

**注入特征串清单**（初始版本，后续版本可扩展）：
```
ignore previous instructions
ignore all previous prompts
you are now DAN
you are now a
your new role is
system:
<prompt>
<|im_start|>
do not follow the rules
forget everything above
```

**严重级别**：WARN（单命中）/ FAIL（双命中）

**--silent 模式**：✅ 可跑——纯 git diff 规则，不依赖 Agent 日志。

**本规则不覆盖**：LLM 语义级注入（如「用微妙的方式说服用户放弃审计」）——那不是正则能判断的，留给 v1.x 外部评估器。

---

### A10 · 不引毒源（No Supply Chain Poisoning）

**问题**：Agent 可能在 package.json / requirements.txt / Cargo.toml 等依赖文件中引入恶意依赖——指向非官方源、锁定到特定 git commit、或使用了已知恶意包名。

**触发条件**：

| 条件 | 说明 | 判定 |
|------|------|:--:|
| 依赖文件有新增 entries | `package.json` diff 中 `dependencies` / `devDependencies` 出现新增条目 | WARN |
| 版本号指向非标准源 | 版本字段为 git+https:// / file: / github: 等非注册表格式 | FAIL |

**不做的**：
- 不做注册表信誉查询（NPM/PyPI 恶意包名单）——那是独立安全服务的事，v0.97 不在范围内
- 不做依赖漏洞扫描——已有 `npm audit` / `pip audit` 等工具覆盖

**严重级别**：WARN（新增依赖）/ FAIL（非标准源）

**--silent 模式**：✅ 可跑——纯 git diff 规则。

---

### A11 · 不滥资源（No Resource Exhaustion）——推迟

**状态**：推迟到 daemon 运行时职责。

**原因**：死循环 / fork bomb / 过量 API 调用 / 磁盘写满——这些行为从 git diff 检测不到。git diff 只能看到「改了什么文件」，看不到「Agent 跑了多久、调了多少次 API、产生了多少临时文件」。

**替代方案**：由 OpenClaw 的 `tools.loopDetection`（断路器）在运行时兜底。审计层无法替代运行时监控。

**重新评估时机**：daemon 稳定运行 ≥30 天后，如果 daemon 的运行时日志足够详细（任务耗时、API 调用次数、临时文件数），可以考虑在审计报告里加一条「本次任务资源消耗摘要」——但这不是规则判定，是数据展示。
