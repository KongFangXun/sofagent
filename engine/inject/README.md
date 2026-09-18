# @sofagent/harness

sofagent 四层约束加载链——`buildConstrainedSystemPrompt()` 生成 Sub Agent 启动时的 context prompt。v1.2.0 从 audit 包的 subagents/launcher.ts 迁出。

## 加载链顺序

SKILL.md（宪法·不可改）→ fde.md（规范·可改）→ think.md（反思·自动生成）→ knowledge/（知识·自动积累）

## API

- `buildConstrainedSystemPrompt()` — 拼装四层约束 prompt
- 依赖关系：`@sofagent/core`
