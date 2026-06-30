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

      - name: 构建 sofagent-audit
        working-directory: ./sofagent/audit
        run: |
          npm ci
          npm run build

      - name: 运行审计
        run: |
          cd sofagent/audit
          node dist/index.js --diff origin/${{ github.base_ref }}..HEAD --ci --strict
```

提交。下一个 PR 就会自动触发审计。

> **前提**：你的仓库中需要有 `sofagent/audit/` 子目录（包含可构建的源码）。如果 sofagent 是作为 submodule 引入的，将 `working-directory` 路径调整为实际的子目录路径即可。

---

## 它检查什么

sofagent-audit 检查 11 条规则（A1-A11），覆盖安全底线、边界约束、过程追溯三大维度：

| 规则 | 名称 | 检查内容 | 严重程度 |
|------|------|---------|---------|
| A1 | 不碰敏感 | diff 是否触碰 `.env` / `*.pem` / `*.key` / `id_rsa` / `credentials.*` 等敏感文件 | FAIL |
| A2 | 不泄密钥 | diff 新增行中是否含 AWS Key / Private Key / OpenAI Key / GitHub Token 等密钥字符串 | FAIL |
| A3 | 不改越界 | diff 中是否有不在 `--task` 任务描述范围内的文件（超过阈值比例时告警） | WARN |
| A4 | 不删配置 | 关键配置/lock 文件（`.gitignore` / `tsconfig.json` / `Dockerfile` / `*.lock` 等）是否被删除 | WARN |
| A5 | 不瞒真相 | commit message 是否为空或纯占位符（`fix` / `update` / `wip` / `test` 等） | WARN |
| A6 | 不坏构建 | 构建配置文件（`vite.config` / `webpack.config` / `tsconfig.json` / `package.json`）是否被破坏性修改（删除行 > 5） | WARN |
| A7 | 不存盲改 | 被修改的文件在修改前是否有读取（Read）操作记录 | FAIL |
| A8 | 不逃验证 | `package.json` / `build.gradle` 等构建文件变更后是否有 test/build 命令执行记录 | FAIL |
| A9 | 不纳注入 | diff 新增行中是否含 prompt injection 模式（"ignore previous instructions" / DAN 越狱等） | FAIL |
| A10 | 不引毒源 | 依赖文件中是否新增非官方源依赖（GitHub raw URL / `git+http` / 个人服务器包） | FAIL |
| A11 | 不滥资源 | 是否有异常资源消耗（新增文件 > 50 / 单文件新增 > 10000 行 / 删除文件 > 20） | WARN / FAIL |

> **严重程度说明**：FAIL = 阻止合并；WARN = 可合并但有标注。A11 根据具体指标动态判定——新增/大文件过多为 WARN，删除文件 > 20 为 FAIL。

### CI 模式下的规则行为

GitHub Action 默认使用 `--ci --strict` 参数运行，等同于 `--strict --silent` 模式。在此模式下：

- **纯 git-diff 规则**（A1, A2, A3, A4, A5, A6, A9, A10, A11）正常运行，不依赖 Agent 日志。
- **日志依赖规则**（A7 不存盲改、A8 不逃验证）在 CI 环境中无 Agent 操作日志，会降级为 WARN 提示而非 FAIL。

---

## exit code 说明

| exit code | 含义 | GitHub Action 表现 |
|-----------|------|-------------------|
| 0 | 全部通过 | ✅ 绿灯 |
| 1 | 有 WARN | ⚠️ 黄灯，可合并 |
| 2 | 有 FAIL | ❌ 红灯，阻止合并 |

> 在 GitHub 上，exit code 2 会让该 check 显示为失败（❌）。如果分支保护规则中勾选了该 check 为必需状态检查（required status check），则红灯会阻止 PR 合并。WARN（exit code 1）只显示为警告，不阻止合并。

---

## 配置

### 跳过特定文件（`.sofagent/config.yml`）

在仓库根目录创建 `.sofagent/config.yml`，可以自定义审计行为：

```yaml
audit:
  # 低风险文件模式——匹配这些模式的文件不计入「A3 不改越界」检查
  # 支持 glob 风格：精确文件名（package-lock.json）、通配符后缀（*.log）、路径模式（docs/**）
  lowRiskPatterns:
    - package-lock.json
    - yarn.lock
    - pnpm-lock.yaml
    - "*.log"
    - "docs/**"

  # 测试/构建命令模式——用于「A8 不逃验证」规则匹配日志中的执行记录
  testPatterns:
    - npm test
    - npm run test
    - npm run build
    - pytest
    - go test

  # 「A3 不改越界」阈值——不相关文件占比超过此比例时触发 WARN（0.0-1.0）
  carefulModifyThreshold: 0.2

  # 是否启用扩展规则（E1-E4）
  # 扩展规则：E1 无测试文件 / E2 TODO 未声明 / E3 大量删除 / E4 低注释率
  extendedRulesEnabled: false
```

> **配置文件查找顺序**（三级 fallback）：`${cwd}/.sofagent/config.yml` → `~/.sofagent/config.yml` → 内置默认值。

### `--strict` vs 默认模式

| 模式 | `--strict` | 默认（无 `--strict`） |
|------|-----------|---------------------|
| A7 无日志时 | **FAIL**：未找到任务日志，「不存盲改」检查失败 | **WARN**：跳过检查，仅提示 |
| 适用场景 | CI 环境、生产级审计 | 本地开发、首次使用 |

GitHub Action 模板中 `--ci` 参数已隐含 `--strict`（`--ci` = `--strict` + `--silent`），无需额外配置。

---

## 常见问题

### Q: 我不想检查某个 PR

在 commit message 里加 `[skip audit]`，该 PR 不会触发审计：

```
git commit -m "hotfix: 紧急修复线上问题 [skip audit]"
```

### Q: Action 报错 "sofagent-audit not found" / "Cannot find module './dist/index.js'"

确保你的仓库有 `sofagent/audit/` 子目录且包含完整源码。常见原因：

1. **sofagent 是作为 submodule 引入的**：调整 workflow 中的 `working-directory` 路径。例如 submodule 挂载在 `vendor/sofagent`，则改为 `./vendor/sofagent/audit`。
2. **没有提交 `package.json` / `package-lock.json`**：`npm ci` 依赖 lock 文件，确保它们已提交。
3. **构建失败**：检查 Action 日志中 "构建 sofagent-audit" 步骤的报错信息。

### Q: 能用在 GitHub Enterprise 吗？

可以。sofagent-audit 只依赖 Node.js 22 和 git，不调用任何外部 API。`actions/checkout` 和 `actions/setup-node` 在 GitHub Enterprise Server 上同样可用。

### Q: 审计时间太长怎么办？

`npm ci` + `npm run build` 通常在 10-20 秒内完成。审计本身的运行时间取决于 diff 大小，通常在 2 秒以内。如果 diff 极大（如初始提交），审计时间会相应增加但一般不超过 10 秒。

### Q: 如何在本地测试这个 Action？

在本地用相同参数运行审计即可模拟 CI 行为：

```bash
cd sofagent/audit
npm ci && npm run build
node dist/index.js --diff main..HEAD --ci --strict
```

### Q: WARN 太多但不想全部关掉

调整 `carefulModifyThreshold`（默认 0.2）来控制 A3 不改越界的灵敏度。增大该值（如 0.5）会降低 A3 触发频率，但不影响其他规则。

### Q: 我想看 JSON 格式的审计结果

添加 `--json` 参数，审计会输出 `{ exitCode, rules }` 格式的 JSON，适合 CI 系统进一步解析处理：

```yaml
- name: 运行审计（JSON 输出）
  run: |
    cd sofagent/audit
    node dist/index.js --diff origin/${{ github.base_ref }}..HEAD --ci --json
```
