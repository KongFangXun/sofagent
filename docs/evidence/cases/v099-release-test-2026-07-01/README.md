# Case 013 — v0.99 发版前三线并行全量测试

## 测试人信息

| 字段 | 填写 |
|------|------|
| 姓名/昵称 | KongFangXun |
| 测试日期 | 2026-07-01 |
| 平台 | WorkBuddy + OpenClaw (ao compose) |
| sofagent 版本 | v0.99 |
| 模型 | deepseek-chat (DeepSeek V4 Pro) |
| 操作系统 | macOS |

---

## 测试方法

三线并行审查：

1. **确定性命令行测试**：10 轮 49 用例，覆盖编译/版本/审计规则/MCP Server/Webhook/脚本/Skill/边界/npm/回归
2. **DeepSeek 代码审查**：独立审查 prompt 驱动，9 维度逐文件检查
3. **ao compose 多智能体审查**：4 并行 Agent（安全工程师/代码审查员/后端架构师/版本号检查）+ 幕僚长汇总

---

## 核心结果

| 维度 | 结果 |
|------|:----:|
| 全量单元测试 | ✅ 398/398 通过 |
| TypeScript 类型检查 (strict + noUncheckedIndexedAccess) | ✅ 零错误 |
| 确定性测试（10 轮 49 用例） | ✅ 42 通过 / 2 P0 当场修复 / 其余通过 |
| 版本号一致性（check-version.sh） | ✅ 34/34 一致 |
| Skill 文件 ≤90 行铁律 | ✅ 全部通过 |
| 零运行时依赖 | ✅ 属实 |
| npm pack 打包干净度 | ✅ 187 文件（零源码泄露） |
| bin 可执行权限 + shebang | ✅ 全部 -rwxr-xr-x |

---

## 发现并修复的问题

### P0（发版阻断，全部修复）

| # | 问题 | 修复 |
|---|------|------|
| 1 | engage-fde.md 版本号 v0.98（应为 v0.99） | 改为 v0.99 |
| 2 | engage.md 缺少 Gotcha 章节 | 补 3 条陷阱提示 |
| 3 | fde.md 缺少 Gotcha 章节 | 补 3 条陷阱提示 |
| 4 | npm pack 打包 273 文件（含 src/ + tests/） | 加 `files` 字段，打包后 187 文件零泄露 |
| 5 | bin 文件无可执行权限 | chmod +x + prepublishOnly 钩子 |

### P1（代码安全 + 文档一致性，全部修复）

| # | 问题 | 修复 |
|---|------|------|
| 6 | mcp-server.ts stdin 无大小限制 | 加 10MB 单行上限 |
| 7 | write_think lesson 未做内容清洗 | 加换行注入防护 + 10K 长度上限 |
| 8 | toolName 用 as string 无运行时验证 | 加 typeof 守卫 |
| 9 | parseArgs 6 处 `!` 断言 | 改为 `as string` |
| 10 | files[0]! 绕过 noUncheckedIndexedAccess | 安全 undefined 检查 |
| 11 | task-record.sh BSD `\b` 不兼容 | 运行时检测 sed 类型 |
| 12 | entry-gate.md 引用不存在的 engine.md | 改为 engage.md |
| 13 | HANDBOOK.md「违法」vs SKILL.md「有害」不一致 | 统一为「有害」 |
| 14 | SECURITY.md #信任模型 锚点断裂 | 改文字描述指向章节名 |
| 15 | ARCHITECTURE.md 宣称 17 条局限，实际 18 条 | 改为 18 条 |

### P2（体验优化，全部修复）

| # | 问题 | 修复 |
|---|------|------|
| 16 | MCP checkInitialized 发送 error + result 重复响应 | 改为 boolean 返回 + break |
| 17 | MCP audit://last-report 读 audit-history/ 目录但实际写入 audit/history.jsonl | 改用 loadHistory() 复用真实路径 |
| 18 | 非 git 仓库 dump git 帮助文本 exit 0 | 加 isInGitRepo() 前置检查，exit 2 |

---

## ao compose 多智能体审查发现

ao compose 工作流（4 并行 + 幕僚长汇总）结构正确，76 秒完成，消耗 57,795 token。

**关键限制**：4 个审查 Agent 均无法读取项目实际源码，基于「模拟场景」做了推测性审查，产出 19 个「通用模式」问题而非针对实际代码的确认问题。这是 ao compose 的能力边界——Agent 需要文件注入才能做有效代码审查。

**结论**：ao compose 编排链路可用（v0.99 MCP Server + ao compose 跑通），但代码审查场景需要后续增加文件注入能力（如 `--context-files` 参数）。

---

## 发版评估

**结论**：✅ 修复全部 P0 + P1 + P2 后，v0.99 可打 tag 发布。

核心代码健壮性经过三线验证：398 测试全绿、类型安全零错误、零运行时依赖属实、命令注入防护到位、版本号 34 项全一致、npm 打包干净。
