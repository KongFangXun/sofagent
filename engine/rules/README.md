# @sofagent/rules

sofagent 规则引擎纯函数包——从 audit 包抽出，零 fs/git 依赖，供编排引擎 tool call 事前拦截。

## API

- `RulesEngine` — 规则引擎类，接受规则集 + tool call context，返回拦截裁决
- `defaultToolRules` — 默认规则集
- `InterceptVerdict` / `ToolCallContext` / `ToolRule` — 核心类型定义
