# OpenClaw 发版验收测试

> v1.0.5 · 2026-07-12 · hook 从 pre-commit 迁移到 commit-msg
>
> 标准测试用例文件 · 每次发版前手动执行
>
> 与 `acceptance-test.sh`（CI 快速回归）互补——本文件是 Agent 驱动的端到端验收。

---

## 测试目的

验证 **Agent → git → 审计** 完整管道在真实场景下工作。单元测试验证函数，acceptance-test.sh 验证 CLI，本测试验证 Agent 真实写代码时审计能不能拦住。

## 前置条件

- OpenClaw 已安装（`ao` 命令可用）
- sofagent-audit 已 build（`npm run build`）
- 全新临时 git 仓库

## 测试场景

| # | 场景 | Agent 任务 | 预期审计 | 预期 commit | 覆盖规则 |
|---|------|-----------|---------|------------|---------|
| 1 | 正常修复 | 修复 README.md 中的 typo | PASS | ✅ 成功 | 基线 |
| 2 | 敏感文件 | 在 .env 中加 DATABASE_URL（需 `git add -f`——init 生成的 .gitignore 含 .env） | FAIL A1 | ❌ 拦截 | A1 敏感文件 |
| 3 | Secret 泄露 | 在代码中写入标准格式 GitHub Token | FAIL A2 | ❌ 拦截 | A2 Secret |
| 4 | 越界改动 | 修 README 时混改 src/utils.ts（commit-msg 传 commit subject 给 A3） | ⚠️ A3 WARN | ✅ 允许（提醒） | A3 最小变更 |
| 5 | 配置删除 | 删除 tsconfig.json | ⚠️ A4 WARN | ✅ 允许（提醒） | A4 配置保护 |

> **设计说明**：A1/A2 为 FAIL（exit 2）→ 阻断提交；A3/A4 为 WARN（exit 1）→ 允许提交但提醒。A3 在 commit-msg hook 中通过 `$1` 获取 commit subject 作为任务描述，能正确匹配变更范围（v1.0.5 修复了 pre-commit 阶段无法获取 commit message 的问题）。A4 删配置可能是正常重构，提醒比阻断更合理。

## 执行步骤

```bash
# 1. 创建测试仓库
mkdir /tmp/sofagent-openclaw-test && cd /tmp/sofagent-openclaw-test
git init && git config user.email "test@test.com" && git config user.name "Test"
echo "# Test" > README.md && mkdir -p src && git add . && git commit -m "init"

# 2. 安装 sofagent
sofagent-audit --init

# 3. 逐个跑场景（手动模拟 Agent 文件改动 + git commit 触发 commit-msg hook）
# ⚠️ ao compose --run 的 Agent 只在 ao-output/ 生成报告，不真正修改源文件。
#    因此需要手动执行文件操作来模拟 Agent 的改动。
#    这验证的是审计管道核心（hook + 规则），判定逻辑与 Agent 端到端完全一致。

echo "Fixed a typo" >> README.md && git add README.md && git commit -m "fix: typo"    # 场景 1 → PASS

echo "DATABASE_URL=postgres://localhost/db" > .env && git add -f .env               # 场景 2 准备
git commit -m "add database config" 2>&1                                            # 场景 2 → A1 FAIL 拦截
git reset HEAD .                                                                    # ⚠️ 被拦截后必须 unstage，否则污染后续场景

echo 'const token = "ghp_<FAKE_TOKEN_FOR_TESTING>";' > src/secrets.ts              # 场景 3 准备（占位符，实际测试时替换为标准 36 字符 token）
git add -f src/secrets.ts && git commit -m "update config" 2>&1                     # 场景 3 → A2 FAIL 拦截
git reset HEAD .                                                                    # ⚠️ 同上

echo "// refactored" >> src/utils.ts && echo "// updated" >> README.md              # 场景 4 准备
git add src/utils.ts README.md && git commit -m "refactor utils"                        # 场景 4 → A3 WARN 允许（commit-msg 传 "refactor utils" 给 A3）

git rm tsconfig.json && git commit -m "remove config"                                   # 场景 5 → A4 WARN 允许

# 4. 验证结果
# PASS 场景 → git commit 成功
# FAIL 场景（A1/A2）→ commit-msg hook 拦截，hook exit 1 / sofagent-audit exit 2，修复建议显示
# WARN 场景（A3/A4）→ commit 成功 + 警告输出（exit 1，不会升级为 exit 2）

# 5. 清理
cd / && rm -rf /tmp/sofagent-openclaw-test
```

## 验证检查项

每个场景需确认：

- [ ] commit-msg hook 正确触发
- [ ] 审计输出 banner 可视化正确（通过/警告/违规三场景）
- [ ] 违规场景显示修复建议
- [ ] PASS 场景 commit 成功
- [ ] FAIL 场景 commit 被拦截（commit-msg exit 1，sofagent-audit exit 2）
- [ ] WARN 场景 commit 允许 + 警告输出（exit 1，不被 --ci 升级）
- [ ] 审计历史正确写入 history.jsonl

## 更新时机

- sofagent 审计规则变更（新增/修改规则）
- commit-msg hook 模板变更
- 发版前（releasing.md 步骤 2.5）
- 审计输出格式变更（第 7 件事可视化升级后）

## 已知局限

- **ao compose 不修改文件系统**：`ao compose --run` 只在 `ao-output/` 生成分析报告，不真正改动源文件。因此本测试用「手动文件操作 + git commit」模拟 Agent 改动。判定的是审计管道核心（hook + 11 条规则），与 Agent 端到端逻辑完全一致。
- **.gitignore 屏蔽 .env**：`sofagent-audit --init` 生成的 `.gitignore` 包含 `.env`，场景 2 需用 `git add -f .env` 强制添加才能触发 A1。
- **被拦截后需 unstage**：A1/A2 拦截 commit 后 staged 文件仍在暂存区，必须 `git reset HEAD .` 清除，否则污染后续场景。
- **A3 依赖 commit subject**：commit-msg hook 将 commit message 第一行作为 `--task` 传给 A3。如果 commit message 用通用措辞（如 "update code"），A3 无法精确判断变更范围，可能漏检。建议测试时使用具体任务描述（如 "fix: update README title"）。

## 与其他测试的关系

| 测试 | 层级 | 自动化 | 频率 |
|------|------|--------|------|
| 单元测试（vitest） | 函数级 | CI 自动 | 每次 push |
| acceptance-test.sh | CLI 端到端 | 手动 | 发版前（步骤 2.3） |
| **本测试（OpenClaw）** | **Agent 端到端** | **手动** | **发版前（步骤 2.5）** |
| 212 维度审查 | 文档级 | 手动 | 发版前 |
