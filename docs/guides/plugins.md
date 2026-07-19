# 5 分钟加一条审计规则

> sofagent-audit 用注册表模式管理规则——每条规则是独立文件 + 独立测试，不需要理解整个系统就能加。

## 规则是什么

一条审计规则就是一个实现 `Rule` 接口的 TypeScript 文件（`sofagent/audit/src/rules/types.ts`）：

- `name`: 规则名称（如 `A22 不留 console`）
- `number`: 规则编号
- `evidenceMode`: 证据来源——`'git-diff'`（纯 diff 判定）/ `'logs'`（纯日志判定）/ `'hybrid'`（混合回退）
- `ruleClass`: 规则分级——`'业务底线'`（违反即破坏交付完整性）或 `'能力拐杖'`（帮助 Agent 走完正确流程）
- `check(ctx)`: 检查函数，接收 `AuditContext`，返回 `RuleCheck`（status: PASS/WARN/FAIL + details 数组）

## 4 步加规则

以「A22 不留 console」为例——检查 diff 新增行里有没有 `console.log`。

### Step 1：创建规则文件

在 `sofagent/audit/src/rules/` 下创建 `rule-a22-no-console.ts`：

```typescript
import type { AuditContext, RuleCheck } from './types';

const CONSOLE_PATTERNS: RegExp[] = [/console\.(log|debug|info)\s*\(/];

export function checkRuleA22(ctx: AuditContext): RuleCheck {
  const rule: RuleCheck = {
    name: 'A22 不留 console', number: 22, status: 'PASS',
    details: [], evidenceMode: 'git-diff', ruleClass: '能力拐杖',
  };
  for (const file of ctx.diffFiles) {
    for (const line of file.lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        for (const pattern of CONSOLE_PATTERNS) {
          if (pattern.test(line.substring(1))) {
            rule.status = 'WARN';
            rule.details.push(`${file.path}: 检测到 console 调用`);
          }
        }
      }
    }
  }
  return rule;
}
```

### Step 2：写测试

在同级目录创建 `rule-a22-no-console.test.ts`，用 `makeDiffFile` 和 `makeCtx`（来自 `src/test-utils.ts`）造 mock 数据。覆盖：新增 console.log → WARN、无 console → PASS、删除行中的 console 不触发、evidenceMode 标注正确。

### Step 3：注册规则

在 `sofagent/audit/src/rules/index.ts` 的 import 区和 `extendedRules`（或 `defaultRules`）数组中各加一行。业务底线规则放 `defaultRules`，代码质量类放 `extendedRules`。

### Step 4：验证

```bash
cd sofagent/audit
npm test && npm run build
node dist/index.js --diff HEAD~1..HEAD --silent
```

## AuditContext 有什么

| 字段 | 类型 | 说明 |
|------|------|------|
| `diffFiles` | `DiffFile[]` | git diff 解析出的文件变更 |
| `logEntries` | `LogEntry[]` | 任务日志条目 |
| `task` | `string` (可选) | `--task` 参数传入的任务描述 |
| `strict` | `boolean` (可选) | 无日志时相关规则返回 FAIL 而非 WARN |
| `silent` | `boolean` (可选) | 跳过日志依赖规则 |
| `commitMsg` | `string` (可选) | commit message |
| `config` | `AuditConfig` (可选) | `.sofagent/config.yml` 加载的审计配置 |

## 发布

规则写好后提 PR。合并后会在下个版本发布。

> 有问题？在 [GitHub Discussions](https://github.com/KongFangXun/sofagent/discussions) 问。
