# tests/

> 这个目录是空的，不是忘写了——是故意的。

## 为什么不放测试

sofagent-audit 的四条规则都是纯函数（`DiffFile[]` + `LogEntry[]` → `RuleCheck`），直接 mock 数据就能测，不需要 mock `execSync` 或 `fs`。35 个 case 已经跑通并通过，但**没有接 CI**。

sofagent 的原则：尺子没挂墙上，不做量尺。等 `.github/workflows/sofagent-audit.yml` 里加了 `npm test` 步骤，测试文件再放回来。

## 如果想加测试

四条规则的可测试接口：

| 规则 | 函数名 | 输入 | 输出 |
|------|------|------|------|
| #1 先读再用 | `checkRule01(diffFiles, logEntries)` | 变更文件列表 + 操作日志 | `{ status: PASS\|WARN\|FAIL, details: [] }` |
| #3 验证再干 | `checkRule03(diffFiles, logEntries)` | 变更文件列表 + 操作日志 | 同上 |
| #7 谨慎修改 | `checkRule07(diffFiles, task?)` | 变更文件列表 + 任务描述 | 同上 |
| #10 如实汇报 | `checkRule10()` | 无（读 git log -1） | 同上 |

聚合函数 `runRules()` 调四条规则，返回 `{ rules: RuleCheck[], exitCode: 0|1|2 }`。

## 测试后发现的已知局限

1. **铁律 #7 中英不互通**：task 写"修复登录页"，文件名 `login.ts`——因为"登录"≠"login"，判定为不相关
2. **铁律 #3 构建文件白名单不完整**：`tsconfig.json` 不在 `BUILD_FILES` 里，改了 tsconfig 触发了构建但审计不查
3. **铁律 #1 对新项目友好但可能漏判**：无日志 → WARN 而非 FAIL，新项目不被误杀，但 Agent 真没读文件也只会看到 WARN

这三个已知局限已记录在 [audit-design.md](../docs/audit-design.md) 的「已知局限」段。
