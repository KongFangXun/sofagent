# 阶段三：基础自测

---

## 步骤

| # | 步骤 | 验证方式 |
|:--:|------|------|
| 1 | bump 版本号：`bash tools/bump-version.sh X Y`。bump 后检查 hook 文件头版本——`head -2 engine/audit/hooks/commit-msg engine/audit/hooks/post-commit` 的 v 标记必须与 package.json version 一致（check-version.sh 已覆盖） | `bash tools/check-version.sh` 全绿 |
| 2 | **changelog 状态转正**：`docs/changelog/v<major>.<minor>/vX.Y.md` 头部「⚠️ 尚未实现」+「状态：已排期」→ 改为「✅ 已开发」。删除「engine/ 下尚无对应代码」等过时警告，保留「前置依赖」 | 头部状态标注为已开发，无「尚未实现」残留 |
| 3 | `npm run build && npm test` | exit 0 + 全部通过 |
| 4 | shellcheck：`bash tools/pre-push-check.sh --quick`。⚠️ 涉及 CLI 命令迁移时跳过，延后到阶段八 | 零 error |
| 5 | **dist 与 src 同步验证**：`diff <(grep "关键命令" engine/audit/src/index.ts) <(grep "关键命令" engine/audit/dist/index.js)` | 无实质差异（排除编译格式化） |
| 6 | 改动清单核对 | `git diff --stat` 确认只改了 changelog 规定的文件 |
