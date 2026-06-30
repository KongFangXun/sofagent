# 反案例

不是所有任务都会成功。这里记录装了 sofagent 但仍然失败的案例。比 PASS 更诚实。

| # | 标题 | 日期 |
|---|------|------|
| 001 | [benchmark 自测循环论证](./001-benchmark-self-test-circularity.md) | 2026-06-20 |
| 002 | [CLI 一击全失效（架构边界）](./002-cli-one-shot-ineffective.md) | 2026-06-23 |
| 003 | [正向组测试方法论陷阱（满分但不可信）](./003-test-methodology-pitfalls.md) | 2026-06-24 |
| 004 | [纪律层实验两次 100 次对照仍无法验证（实验设计天花板）](./004-discipline-experiment-inconclusive.md) | 2026-06-30 |

> 反面教材但不在本目录：benchmark 的 [WorkBuddy A/B](../benchmark/2026-06-23-workbuddy-ab.md) — 同 session 固定顺序测试，知识传递效应未排除，已被 v0.85 降级。

---

## 模板

新建案例时复制以下骨架：

```markdown
# 反案例：{一句话标题}

| 字段 | 内容 |
|------|------|
| 日期 | YYYY-MM-DD |
| 平台 | OpenClaw / WorkBuddy / ... |
| 任务 | 做了什么 |
| 期望 | 应该发生什么 |
| 实际 | 实际发生了什么 |
| 为什么没拦住 | 是约束不到位？拆解不对？还是单纯的模型能力不足？ |
| 修了吗 | 如果是 sofagent 的问题 — 修了没？哪个版本？ |
```