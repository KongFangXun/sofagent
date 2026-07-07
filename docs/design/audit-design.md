# sofagent-audit 设计文档

> v0.99.9 · 2026-07-04 · 提交时审计
> v0.95 铁律从 10→6 条，原 #1/#3/#7/#10 迁移为审计 A3/A5/A7/A8。

v0.90 的约束 Agent 不理——干脆不看它，直接 audit git diff。

## 设计背景

运行时 MD 注入约束有三个硬伤：① Agent 不读就失效（CLI 实测 0/16）② 不可跨平台 ③ Agent 可绕过加载链。v0.91 从预防转向检测——提交时审计不依赖 Agent 配合，看的是已发生的 git diff。

## MVP 规则

| 审计规则 | 判定逻辑 | exit |
|------|------|:--:|
| A3 不改越界 | diff 文件是否在 --task 描述范围内 | 1 |
| A5 如实汇报 | commit message 是否空白/纯占位符 | 1 |
| A7 先读再用 | 被修改文件在修改前是否有 Read 记录 | 2 |
| A8 验证再干 | 构建文件变更后是否有 test/build 记录 | 2 |

## 技术选型

TypeScript，最小运行时依赖：仅 js-yaml（YAML 配置解析），其余用 Node.js 内置模块（child_process/fs/path）。主要是不想再写 bash 了。

## 焊死的门

检查规则独立只读——审计扫的是 git diff（已发生的历史记录），Agent 不可篡改。监控四种篡改：改断言匹配错误、删失败测试、加 lint-ignore、降覆盖率阈值。

> ⚠️ 日志检查（A7/A8）依赖 Agent 自我报告的 task/logs，Agent 可伪造。审计上限 = 日志真实性。详见 [LIMITATIONS.md](../../LIMITATIONS.md)。

## 已实现 / 未实现

| 功能 | 状态 |
|------|------|
| A1-A11 全量规则 | ✅ v0.97 |
| `--strict` / `--silent` / `--ci` 模式 | ✅ v0.93 |
| 误报率 FP=0%（27 cases） | ✅ v0.92 |
| A9 注入检测 / A10 毒源检测 | ✅ v0.97 |
| CI gate（GitHub Action） | ✅ v0.99 |
| A11 资源耗尽 | 推迟（daemon 运行时） |
| 审计报告 HTML/JSON | v1.x |
