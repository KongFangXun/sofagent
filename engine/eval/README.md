# @sofagent/eval

sofagent 质量评估引擎——量化指标、评分逻辑、evals 接口。v1.2.0 从 audit 包迁出。

## CLI

```bash
# 运行 golden set 评估（使用 audit 引擎作为 runner）
sofagent-eval run [options]

# 选项
sofagent-eval run --golden-set <path>   # 指定 golden set YAML 路径
sofagent-eval run --verbose              # 详细输出

# golden set 路径解析优先级：
#   1. --golden-set 参数
#   2. 环境变量 SOFAGENT_EVAL_GOLDEN_SET
#   3. 默认值: engine/eval/data/golden-set.yaml
```

运行结果：
- 退出码 0 = 全部通过，1 = 有失败
- 结果持久化到 `data/eval/latest.json`（覆盖写）和 `data/eval/history.jsonl`（追加写）

## API

- `runEval()` — 运行评估用例集，返回 `EvalResult`
- `evalCase()` — 单条测试用例评分
- `defaultRunFunction()` — 默认模拟 runner（测试用）
- 类型：`TestCase` / `EvalResult` / `EvalBreakdown` / `EvalConfig`
- 依赖关系：`@sofagent/core`（核心），`@sofagent/audit`（CLI 层适配器）

## Golden Set YAML 格式

golden set 是一个 YAML 数组，每条用例的 `input` 和 `expected` 都是嵌套对象：

```yaml
- id: A1-pass-01
  description: "A1 正常用例：修改普通源码文件"
  tags: [A1, pass]
  input:
    diffFiles:
      - path: "src/utils/helper.ts"
        status: "modified"
        lines:
          - "--- a/src/utils/helper.ts"
          - "+++ b/src/utils/helper.ts"
          - "+const newValue = 'updated';"
    task: "更新 helper 工具函数"
    logEntries: []
  expected:
    result: "PASS"
    rules_triggered: []
    severity: ""
```

**关键约定**：
- `DiffFile.lines` 必须是 unified-diff 格式行数组（带 `+`/`-`/`---`/`+++` 前缀）
- A7/A8/A14/A15 是 hybrid 规则，pass 用例需给足够的 `logEntries`，fail 用例给空 `logEntries`
- `expected.rules_triggered` 存规则 ID（A1/A2/E1 等），不是完整规则名
- `expected.severity` 取 ruleClass 映射：业务底线→P0, 能力拐杖→P1, 工程规范→P2

## latest.json Schema

```json
{
  "timestamp": "2025-07-01T10:00:00.000Z",
  "total": 42,
  "passed": 40,
  "failed": 2,
  "passRate": 0.952,
  "duration": 1500,
  "failures": [
    {
      "testId": "A2-fail-01",
      "description": "",
      "overallScore": 0.3,
      "expected": { "result": "FAIL", "rules_triggered": ["A2"], "severity": "P0" },
      "actual": { "result": "PASS", "rules_triggered": [] },
      "error": "optional error message"
    }
  ]
}
```

## history.jsonl Schema

每行一个 JSON 对象：

```json
{"timestamp":"2025-07-01T10:00:00.000Z","total":42,"passed":40,"failed":2,"passRate":0.952,"duration":1500}
```
