# GitHub Action：PR 提交时自动审计

> sofagent-audit 作为 GitHub Action，在每个 PR 上自动检查：AI 有没有跳过测试、有没有乱改不相关的文件、有没有引入安全风险。

## 30 秒接入

在你的仓库根目录创建 `.github/workflows/sofagent-audit.yml`，复制以下内容：

```yaml
name: sofagent-audit

on:
  pull_request:
    branches: [main]

jobs:
  audit:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout 代码
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: 安装 Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: 运行审计
        run: |
          # 通过 npx 拉取已发布的 @sofagent/audit（与 action.yml 一致）。
          # ⚠️ 把 <LATEST> 换成当前发布版本（查 npm：npm view @sofagent/audit version）。
          #    锁定版本号可避免上游 patch 引入行为变更。
          npx -y -p @sofagent/audit@<LATEST> sofagent-audit-full \
            --diff origin/${{ github.base_ref }}..HEAD --ci --strict
```

提交。下一个 PR 就会自动触发审计。

> **两种用法**：
> - **npx 方式（推荐）**：如上，直接拉取已发布的 `@sofagent/audit` npm 包，无需仓库内含源码——适合大多数团队。
> - **本地构建方式**：若你的仓库已包含 `engine/audit/` 子目录（如作为 submodule 引入），也可 `cd engine/audit && npm ci && npm run build` 后 `node dist/index.js --diff origin/${{ github.base_ref }}..HEAD --ci --strict`。两种方式的审计能力完全一致。

---

## 它检查什么

sofagent-audit 检查 24 条规则（A1-A11、A14-A23 + E1-E2/E4），覆盖安全、边界、追溯：

| 规则 | 内容 | 级别 |
|------|------|:--:|
| A1 | 敏感文件（`.env`/`*.pem`/`*.key`） | FAIL |
| A2 | 密钥泄露（AWS Key / Token / Password） | FAIL |
| A3 | 改动范围越界（超出 `--task` 描述） | WARN |
| A4 | 关键配置文件被删除 | WARN |
| A5 | Commit message 空白/占位符 | WARN |
| A6 | 构建配置被破坏性修改 | WARN |
| A7 | 修改前无 Read 记录 | FAIL |
| A8 | 构建文件变更后无 test/build 记录 | FAIL |
| A9 | Prompt injection 模式 | FAIL |
| A10 | 非官方源依赖（GitHub raw URL 等） | FAIL |
| A11 | 异常资源消耗（新增>50 文件/单文件>10K行） | WARN/FAIL |

> FAIL = 阻止合并，WARN = 可合并有标注。`--ci --strict` 下 A7/A8 无 Agent 日志时降级为 WARN。

---

## exit code

| 0 | 1 | 2 |
|:--:|:--:|:--:|
| ✅ 绿灯 | ⚠️ 黄灯 | ❌ 红灯，阻止合并 |

---

## 配置（`.sofagent/config.yml`）

```yaml
audit:
  lowRiskPatterns: [package-lock.json, yarn.lock, "*.log", "docs/**"]
  testPatterns: [npm test, npm run test, npm run build, pytest, go test]
  carefulModifyThreshold: 0.2  # A3 触发阈值
  extendedRulesEnabled: false   # E1-E4 扩展规则
```

> 三级 fallback：`${cwd}/.sofagent/config.yml` → `~/.sofagent/config.yml` → 内置默认值。`--ci` = `--silent`（CI 友好输出），需零容忍时加 `--strict`。

---

## 常见问题

| 问题 | 解决 |
|------|------|
| 跳过某 PR | commit message 加 `[skip audit]` |
| "not found" | 确认 `engine/audit/` 子目录存在 + `package-lock.json` 已提交 |
| GitHub Enterprise | 支持，零外部 API 依赖 |
| 审计太慢 | `npm ci`+build ~20 秒，审计 ~2 秒 |
| 本地测试 | `cd engine/audit && npm ci && npm run build && node dist/index.js --diff main..HEAD --ci` |
| JSON 输出 | 加 `--json` 参数 |
