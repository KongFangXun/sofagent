# @sofagent/ab-test

sofagent A/B 测试框架——对比实验、指标显著性分析、自动 promote 决策。

## CLI

```bash
# 运行 A/B 对比测试（从 golden-set YAML 加载测试用例）
sofagent-ab-test run --current <skill-path> --candidate <skill-path> [options]

# 选项
sofagent-ab-test run --current <path>    # 当前版本 Agent Skill 路径
sofagent-ab-test run --candidate <path>  # 候选版本 Agent Skill 路径
sofagent-ab-test run --eval-set <path>   # golden-set YAML 路径（默认从 @sofagent/eval 的 golden-set.yaml 加载）
sofagent-ab-test run --threshold <n>     # 晋升阈值（默认 2）

# 测试用例不足时报错退出（不再使用硬编码默认用例）
```

运行结果持久化到 `data/ab-test/latest.json`（覆盖写）。

## Golden Set 接通

v1.2.4 起，ab-test CLI 的 `run` 子命令从 `@sofagent/eval` 的 golden-set YAML 加载测试用例，
与 eval 共享同一套 input + expected。ab-test 的 runner 是 Agent Skill 对比（current vs candidate），
不是 audit runRules——ab-test 只复用 golden set 作为 TestCase 来源。

## API

- `decidePromotion()` — 对比 A/B 方案指标，连续 2 轮胜出 → auto promote
- `persistABTestResult()` — 持久化 A/B 测试结果到 latest.json
- `DEFAULT_SCORE_WEIGHTS` — 默认评分权重
- 类型：`ABConfig` / `ABTestResult` / `PromotionDecision` / `ScoreWeights`
- 依赖关系：`@sofagent/eval` / `@sofagent/core` / `@sofagent/harness` / `@sofagent/orchestrator`
