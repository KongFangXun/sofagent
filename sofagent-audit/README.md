# sofagent-audit

> v0.91 · 提交时审计 MVP —— 扫描 git diff，检查 Agent 是否遵守 sofagent 铁律。

## 安装

```bash
cd sofagent-audit && npm ci && npm run build
```

## 用法

```bash
# 基本用法
npx sofagent-audit --diff HEAD~1..HEAD

# 带任务描述
npx sofagent-audit --diff HEAD~1..HEAD --task "修复登录页 bug"

# 检查 PR 变更
npx sofagent-audit --diff origin/main..HEAD
```

## 退出码

| 码 | 含义 |
|:--:|------|
| 0 | 全部铁律通过 |
| 1 | 有警告（铁律 #7 谨慎修改 / #10 如实汇报） |
| 2 | 有违规（铁律 #1 先读再用 / #3 验证再干） |

## 规则

| 铁律 | 判定 | 严重度 |
|------|------|:--:|
| #1 先读再用 | 被修改的文件是否有读取记录 | 违规 |
| #3 验证再干 | 构建文件变更后是否有测试记录 | 违规 |
| #7 谨慎修改 | 修改范围是否与任务描述匹配 | 警告 |
| #10 如实汇报 | commit message 质量 | 警告 |

## 设计原则

- **零运行时依赖**——只用 Node.js 内置模块
- **焊死的门**——检查规则独立只读，Agent 不可篡改
- **不依赖 Agent 配合**——看的是 git diff（已经发生的历史记录）

## 开发

```bash
npm run build    # 编译 TypeScript
npm run test     # 运行测试
npm run check    # 类型检查
```
