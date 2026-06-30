# 5 分钟加一条审计规则

> sofagent-audit 用注册表模式管理规则——每条规则是独立文件 + 独立测试，不需要理解整个系统就能加。

## 规则是什么

一条审计规则就是一个实现了 `Rule` 接口的 TypeScript 文件。接口定义在 `sofagent/audit/src/rules/types.ts`：

```typescript
/**
 * 单条规则的检查结果
 */
export interface RuleCheck {
  name: string;
  number: number;
  status: 'PASS' | 'WARN' | 'FAIL';
  details: string[];
  /** 证据模式标注（用于输出显示） */
  evidenceMode?: EvidenceMode;
  /** 规则分级标签（用于 reporter 输出 [底线]/[拐杖] 前缀） */
  ruleClass?: RuleClass;
}

/**
 * 规则统一接口
 * 新增审计项时只需实现此接口并注册到 rules/index.ts
 */
export interface Rule {
  name: string;
  number: number;
  /** 证据模式标注 */
  evidenceMode: EvidenceMode;
  /** 规则分级标签 */
  ruleClass?: RuleClass;
  check(ctx: AuditContext): RuleCheck;
}
```

几个关键字段：

- `name`：规则名称（如 `A12 不留 console`）
- `number`：规则编号（如 `12`）
- `evidenceMode`：证据来源——`'git-diff'`（纯 diff 判定）/ `'logs'`（纯日志判定）/ `'hybrid'`（有日志走精确检查，无日志走 diff 启发式回退）
- `ruleClass`：规则分级——`'业务底线'`（违反即破坏交付完整性）或 `'能力拐杖'`（帮助 Agent 走完正确流程，违反不一定是事故）
- `check(ctx)`：检查函数，接收 `AuditContext`，返回 `RuleCheck`
- `status` 三种：`'PASS'`（通过）/ `'WARN'`（警告）/ `'FAIL'`（违规）

## 4 步加规则

下面以「A12 不留 console」为例——检查 diff 新增行里有没有 `console.log`。

### Step 1：创建规则文件

在 `sofagent/audit/src/rules/` 下创建 `rule-a12-no-console.ts`：

```typescript
// ============================================================
// A12 不留 console（扩展规则 · 能力拐杖）
// 检测 diff 新增行是否含 console.log → 命中 → WARN
// evidenceMode: git-diff
// ============================================================

import type { AuditContext, RuleCheck } from './types';

/** console 调用检测正则 */
const CONSOLE_PATTERNS: RegExp[] = [
  /console\.(log|debug|info)\s*\(/,
];

export function checkRuleA12(ctx: AuditContext): RuleCheck {
  const rule: RuleCheck = {
    name: 'A12 不留 console',
    number: 12,
    status: 'PASS',
    details: [],
    evidenceMode: 'git-diff',
    ruleClass: '能力拐杖',
  };

  const { diffFiles } = ctx;

  const detected: string[] = [];

  for (const file of diffFiles) {
    for (const line of file.lines) {
      // 只检查新增行（以 + 开头且不是 +++）
      if (line.startsWith('+') && !line.startsWith('+++')) {
        const content = line.substring(1);
        for (const pattern of CONSOLE_PATTERNS) {
          if (pattern.test(content)) {
            detected.push(`${file.path}: 检测到 console 调用`);
          }
        }
      }
    }
  }

  if (detected.length > 0) {
    rule.status = 'WARN';
    rule.details.push(
      `检测到 console 调用: ${detected.join('; ')}。生产代码不应残留 console.log。`
    );
  }

  return rule;
}
```

> 写法参照现有规则（如 `rule-a2-secret-leak.ts`）：初始化一个 `PASS` 的 `RuleCheck` 对象，遍历 `ctx.diffFiles`，命中条件就往 `details` 推消息并改 `status`。

### Step 2：写测试

在同级目录创建 `rule-a12-no-console.test.ts`：

```typescript
// ============================================================
// rule-a12.test.ts · A12 不留 console——测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { checkRuleA12 } from './rule-a12-no-console';
import { makeDiffFile, makeCtx } from '../test-utils';

describe('A12 不留 console', () => {
  it('新增行含 console.log → WARN', () => {
    const ctx = makeCtx([makeDiffFile('src/index.ts', ['+console.log("hello");'])]);
    const result = checkRuleA12(ctx);
    expect(result.status).toBe('WARN');
  });

  it('新增行含 console.debug → WARN', () => {
    const ctx = makeCtx([makeDiffFile('src/debug.ts', ['+console.debug(x);'])]);
    const result = checkRuleA12(ctx);
    expect(result.status).toBe('WARN');
  });

  it('无 console 调用 → PASS', () => {
    const ctx = makeCtx([makeDiffFile('src/index.ts', ['+const x = 1;'])]);
    const result = checkRuleA12(ctx);
    expect(result.status).toBe('PASS');
  });

  it('删除行中的 console 不触发 → PASS', () => {
    const ctx = makeCtx([makeDiffFile('src/index.ts', ['-console.log("old");'])]);
    const result = checkRuleA12(ctx);
    expect(result.status).toBe('PASS');
  });

  it('evidenceMode 标注为 git-diff', () => {
    const ctx = makeCtx([makeDiffFile('src/index.ts', ['+const x = 1;'])]);
    const result = checkRuleA12(ctx);
    expect(result.evidenceMode).toBe('git-diff');
  });
});
```

> `makeDiffFile` 和 `makeCtx` 是 `src/test-utils.ts` 提供的测试辅助函数，不用自己造 mock 数据。

### Step 3：注册规则

在 `sofagent/audit/src/rules/index.ts` 里加两行：

```typescript
// 1. 顶部 import 区加一行
import { checkRuleA12 } from './rule-a12-no-console';

// 2. 在 defaultRules 或 extendedRules 数组里加一个对象
export const extendedRules: Rule[] = [
  // ... 已有规则 ...
  { name: 'A12 不留 console', number: 12, evidenceMode: 'git-diff', ruleClass: '能力拐杖', check: checkRuleA12 },
];
```

> 业务底线规则放 `defaultRules`（始终生效）；非核心规则放 `extendedRules`（需 config 开启）。console 检查属于代码质量，放 `extendedRules` 合适。

### Step 4：验证

```bash
cd sofagent/audit
npm test    # 确认新测试通过
npm run build
node dist/index.js --diff HEAD~1..HEAD --silent
```

## AuditContext 有什么

`check` 函数接收的 `ctx` 包含以下字段（定义在 `types.ts`）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `diffFiles` | `DiffFile[]` | git diff 解析出的文件变更（每个含 `path`、`status`、`lines`） |
| `logEntries` | `LogEntry[]` | `.sofagent/task/logs/` 中解析出的任务日志条目 |
| `task` | `string` (可选) | `--task` 参数传入的任务描述（用于判断是否改了不相关的文件） |
| `strict` | `boolean` (可选) | `--strict` 模式：无日志时相关规则返回 FAIL 而非 WARN |
| `silent` | `boolean` (可选) | `--silent` 模式：跳过日志依赖规则，走 diff 启发式回退 |
| `commitMsg` | `string` (可选) | commit message（用于检查提交信息规范） |
| `config` | `AuditConfig` (可选) | `.sofagent/config.yml` 加载的审计配置（三级 fallback） |

## 发布

规则写好后提 PR。合并后会在下个版本发布。

> 有问题？在 [GitHub Discussions](https://github.com/KongFangXun/sofagent/discussions) 问。
