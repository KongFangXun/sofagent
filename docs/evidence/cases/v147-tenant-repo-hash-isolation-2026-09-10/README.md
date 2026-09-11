# Case 021 — v1.4.7 运行时审计 repo-hash 隔离实测（章十五）

> **回补案例**：事件发生于 v1.4.7 开发批（2026-09-10），整理于 v1.4.8 bugfix 批（2026-09-11）——诚实标注回补身份，非当时留痕。

## 测试人信息

| 字段 | 填写 |
|------|------|
| 测试人 | KongFangXun |
| 事件日期 | 2026-09-10（commit 7d181083） |
| 整理日期 | 2026-09-11 |
| 测试环境 | macOS + Node v22+ |
| 测试版本 | v1.4.7 开发批（commit 7d181083） |
| 测试类型 | 运行时审计仓库隔离功能验证 |

---

## 验证内容（全部有 git 与代码锚点可溯）

| # | 验证项 | 结果 | 证据锚点 |
|:--:|--------|:--:|------|
| 1 | computeRepoHash 引擎化（git show-toplevel sha256 前 12 位 / nogit- 回退 / 3s 超时 / 静默降级） | ✅ | `engine/core/src/repo-hash.ts`（commit 7d181083 新建） |
| 2 | data-sovereignty 落盘插段 `data/audit/data-sovereignty/<repo-hash>/{年}/{月}/` | ✅ | resolveSovereigntyLogPath 加 repoHash 参数（同 commit） |
| 3 | llm-calls Trace 同款插段 | ✅ | 同 commit 双日志插段 |
| 4 | 读侧 fallback（旧无段结构历史原地可读，不迁移不回填） | ✅ | queryRecent/queryRange 双根扫描（当前段 + 旧无段结构，他仓段不读） |
| 5 | commit 级主链（history.jsonl）保持全局不插段 | ✅ | 同 commit 设计说明 |

---

## 边界（与 G7 多租户 v0 的关系）

本案例只覆盖**仓库维度**隔离（repo-hash 插段）；**租户维度**隔离（G7 `data/<tenant>/` 路径 + orgId 过滤）是同批另一交付（commit 24298c0a），其 v0 边界为「查询侧隔离，写入侧仍全局分区」——两案不混。

---

## 意义

运行时审计日志按仓库分目录后，多仓库共用一台设备时各仓库的 cloud 调用与 LLM Trace 互不污染，dashboard 趋势按仓归因——「审计可拦截（HMAC）」之后的又一数据主权闭环件。
