# @sofagent/skillopt

sofagent Skill 优化引擎——Skill 质量分析、安全审查、优化建议、自动重构。

## API

- `scanSkillSafety()` — Skill 文件安全扫描（注入检测 / 敏感信息泄漏 / 危险工具调用）
- `findFiles()` / `scanFile()` — 文件查找 + 单文件扫描（从 `@sofagent/audit` 引用）
- 依赖关系：`@sofagent/audit` + `@sofagent/core`
