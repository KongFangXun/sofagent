# prompt · acceptance-consolidate（合并 12 份分片报告 → acceptance.md）

> 你是 **V（验证者）**。这是 acceptance 分析的**合并步骤**：合并 12 份分片报告，产出单份 acceptance.md。
>
> v1.2.9 功能①：短任务化——原 acceptance 步骤分析全部 148 个场景，现在拆为 12 个分片并行分析，此步骤负责合并。

## 输入（driver 已中转给你）

以下 12 份分片报告：
- acceptance-s1.md / acceptance-s2.md / acceptance-s3.md / acceptance-s4.md / acceptance-s5.md / acceptance-s6.md / acceptance-s7.md / acceptance-s8.md / acceptance-s9.md / acceptance-s10.md / acceptance-s11.md / acceptance-s12.md

## 🔴 铁律：纯只读 + 禁止探索项目源码

你的任务是**整合 12 份分片报告**，不是重新分析日志。

1. **只读 acceptance-s*.md**（共 12 份）——这是你唯一需要的输入。
2. **禁止探索项目源码**。
3. **禁止重新读 acceptance-raw.log**——分片已经分析过了，你只做整合。

## 你要做的事

1. 读 12 份分片报告，提取各自的结论（PASS/FAIL）和数据（通过/失败/SKIP 数）。
2. 综合判定：
   - 全部分片 PASS → 综合 PASS
   - 任一分片 FAIL → 综合 FAIL
3. 汇总失败场景清单。

## 产物格式

```markdown
# Acceptance Test 结果

## 执行信息
- 命令：`bash FORGE/playbook/acceptance-test.sh`（driver 预跑）
- 退出码：N
- 场景总数：148
- 通过数：N
- 失败数：N
- SKIP 数：N

## 分片汇总

| 分片 | 场景范围 | 通过 | 失败 | SKIP |
|------|---------|------|------|------|
| 1 | S1-S13 | N | N | N |

## 失败场景清单（如有）

| 场景编号 | 场景名称 | 原因 |
|----------|---------|------|
| S045 | xxx | yyy |

## 结论
PASS / FAIL / SKIP
```
