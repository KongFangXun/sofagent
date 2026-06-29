# sofagent-audit

> v0.97 · 提交时审计 —— 扫描 git diff，检查 Agent 是否遵守工作纪律。

## 安装

```bash
cd sofagent/audit && npm ci && npm run build
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
| 0 | 全部规则通过 |
| 1 | 有警告（A3 不改越界 / A5 不瞒真相） |
| 2 | 有违规（A7 不存盲改 / A8 不逃验证） |

## 规则

v0.95 起 8 条默认审计规则（A1-A8）+ 4 条扩展规则（E1-E4）：

| 审计规则 | 判定 | 严重度 |
|------|------|:--:|
| A1 敏感文件 | .env / *.pem / id_rsa 被修改 | 违规 |
| A2 测试缺失 | 源码改了但测试没动 | 警告 |
| A3 不改越界 | 修改范围是否与任务描述匹配 | 警告 |
| A4 低注释率 | 新增 >200 行注释率 <5% | 警告 |
| A5 不瞒真相 | commit message 质量 | 警告 |
| A6 不坏构建 | 构建文件改动后构建是否通过 | 违规 |
| A7 不存盲改 | 被修改的文件是否有读取记录 | 违规 |
| A8 不逃验证 | 构建文件变更后是否有测试记录 | 违规 |

> v0.95 前的 #1/#3/#7/#10 铁律编号已迁移为 A7/A8/A3/A5。详见 [v0.95 开发日志](../docs/changelog/v0.95.md)。

## 设计原则

- **零运行时依赖**——只用 Node.js 内置模块
- **焊死的门**——检查规则独立只读，Agent 不可篡改
- **不依赖 Agent 运行时配合**——看的是 git diff（已经发生的历史记录）。A7/A8 的日志检查依赖 Agent 写入的 `.sofagent/task/logs/` 文件

## 开发

```bash
npm run build    # 编译 TypeScript
npm run test     # 运行测试
npm run check    # 类型检查
```
