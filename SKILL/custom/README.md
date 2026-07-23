# 用户自定义 Skill 层

本目录用于用户自定义覆盖，升级时不会被覆盖。

## 加载顺序
1. 引擎层（/SKILL/SKILL.md → /SKILL/harness/ → /SKILL/agents/）
2. 用户层（本目录，/SKILL/custom/）

## 文件示例
- `engineer-overrides.md`：追加到 engineer 之后（类似 CSS !important）
- `fde-overrides.md`：追加到 FDE 之后

## 升级策略
| 策略 | 行为 |
|------|------|
| 安全升级（默认） | 只覆盖引擎层；用户层不动 |
| 强制覆盖（--force） | 覆盖所有层 |
| diff 合并（--merge） | 自动合并用户层 |

