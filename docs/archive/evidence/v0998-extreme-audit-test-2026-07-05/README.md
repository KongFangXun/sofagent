# Case 021 — v0.99.8 审计引擎极限测试（Windows，OpenClaw 代 Cedric 执行）

> **测试日期**：2026-07-05
> **平台**：Windows 10.0.26200 (x64), Node v24.16.0
> **版本**：@sofagent/audit@0.99.8
> **测试人**：OpenClaw（AI 代 Cedric 执行）
> **性质**：审计引擎技术能力验证（非外部用户体验验证）

---

## ⚠️ 定位说明

本 Case 是**审计引擎的极端场景技术能力验证**，不是 ROADMAP 准入条件 #7（外部用户体验验证）的交付物。原因：

1. 平台是 Windows（测试计划排除 Windows）
2. 测试人是 AI 代执行（非真实开发者按测试计划走）
3. 场景全是自编极限测试（不对应测试计划的 8 个场景）
4. 缺安装体验、daemon、FDE、编排引擎等核心场景

作为**技术能力证据**归档，价值很高。

---

## 测试矩阵

### 🔥 检出能力

| 极限场景 | 结果 | 细节 |
|---------|:---:|------|
| 100 文件海量变更 + 2 处 secret | ✅ | 8.76s 精准定位 file_50.js (OpenAI key) + file_99.js (AWS key)，零误报，A11 告警文件数超阈值 |
| 200KB 单行中嵌入 secret | ✅ | 无截断，A2 检出 ultra-long-line.txt 中的 OpenAI key |
| HTML 中 4 种不同 secret | ✅ | OpenAI + AWS×2 + GitHub Token 全部检出 |
| sk- + AKIA 前缀重命名 | ✅ | 不误报（正确设计行为） |
| Base64 编码的 secret | ⚠️ | 未检出（当前设计不做 base64 解码） |

### 📊 模式覆盖

| 模式 | exit code | 结果 |
|------|:---------:|:---:|
| 默认 --diff | 2 | ✅ A2 FAIL + A11 WARN |
| --ci (strict + silent) | 2 | ✅ A2 FAIL, A7 静默 PASS |
| --strict | 2 | ✅ A2 FAIL + A7 FAIL（严格模式正确） |
| --json | 2 | ✅ 结构化输出（PowerShell 编码问题非功能缺陷） |
| --root-cause | 0 | ✅ 趋势分析 + 热点文件 + 白名单建议 |
| --install-hook | 0 | ✅ pre-commit 已安装 |

### Windows verify.ps1

23 通过 / 7 警告 / 0 失败。

---

## 发现的改进建议

| 优先级 | 建议 | 影响 |
|:--:|------|------|
| P1 | pre-commit hook 应支持全局 npm 包路径（当前硬编码本地 dist） | Windows 用户 hook 失效 |
| P2 | JSON 输出应支持纯 ASCII 转义 | PowerShell CI 集成困难 |
| P3 | A2 规则扩展至 base64 编码内容 | 对抗性绕过 |
| P4 | A2 规则扩展至 `sk-proj-` 格式 | 新版 OpenAI key 覆盖 |

---

## 总体评估

| 维度 | 评分 | 说明 |
|------|:---:|------|
| Secret 检出精度 | 10/10 | 100 文件零误报，200KB 单行突破 |
| 模式覆盖 | 9/10 | 所有工作模式通过 |
| 大压力容错 | 9/10 | 100 文件 8.76s |
| Windows 兼容性 | 7/10 | 核心审计路径全通，hook 路径需修复 |
| 用户体验 | 8/10 | CLI 输出清晰，JSON 编码待修 |
| 文档准确性 | 9/10 | 测试步骤可复现 |
