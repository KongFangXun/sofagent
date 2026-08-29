# @sofagent/skillopt

sofagent Skill 优化引擎——Skill 质量分析、安全审查、优化建议、自动重构。

## 安装

```bash
npm install -g @sofagent/skillopt
```

安装后获得 `sofagent-skillopt` 命令。Node.js 18+。

## API

- `scanSkillSafety()` — Skill 文件安全扫描（注入检测 / 敏感信息泄漏 / 危险工具调用）
- `findFiles()` / `scanFile()` — 文件查找 + 单文件扫描（从 `@sofagent/audit` 引用）
- 依赖关系：`@sofagent/audit` + `@sofagent/core`

## 文档

- [架构总览](../../docs/ARCHITECTURE.md) — skillopt 在约束层中的位置
- [使用手册（WIKI）](../../docs/WIKI.md) — 面向 FDE 的完整用法
