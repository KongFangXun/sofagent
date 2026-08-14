# 阶段三：基础自测

---

## 步骤

| # | 步骤 | 验证方式 |
|:--:|------|------|
| 1 | bump 版本号：`bash tools/bump-version.sh X Y`。bump 后检查 hook 文件头版本——`head -2 engine/audit/hooks/commit-msg engine/audit/hooks/post-commit` 的 v 标记必须与 package.json version 一致（check-version.sh 已覆盖） | `bash tools/check-version.sh` 全绿 |
| 2 | **changelog 状态转正**：`docs/changelog/v<major>.<minor>/vX.Y.md` 头部「⚠️ 尚未实现」+「状态：已排期」→ 改为「✅ 已开发」。删除「engine/ 下尚无对应代码」等过时警告，保留「前置依赖」 | 头部状态标注为已开发，无「尚未实现」残留 |
| 3 | `npm run build && npm test` | exit 0 + 全部通过 |
| 3b | **测试数文档同步门禁**（v1.3.4 教训：bugfix/dev/dsh 三阶段均漏此步）：`bash tools/check-test-count.sh --quiet` | 输出 OK / EXIT=0。FAIL = README/WIKI/LIMITATIONS/ARCHITECTURE 测试数与 test-count.sh SSOT 不一致，必须手动同步后再继续 |
| 3c | **关键依赖版本检查**：`bash tools/check-deps.sh`。检查 LangGraph 三件套 / automerge / zod / js-yaml / DSH 的当前版本 vs 最新版本——Dependabot 做周检查自动提 PR，本步做发版前快照确认 | 输出各依赖状态。automerge 标 🔒 精确锁（禁升 2.x），其余 ⚠️ 有新版本时按规则评估 |

> **依赖升级决策规则**（步骤 3c 配套）：
> - ✅ **可当场升**：patch 版本 + 通用工具库（js-yaml / zod / archiver patch）——升完跑 `npm test` 全绿即可
> - 🟡 **评估后升**：LangChain 三件套（patch 也评估）——升完跑全量测试 + FORGE fresh-eyes 跑一轮 A/B 验证不回归
> - 🟡 **单独评估**：major 版本跳跃（如 archiver 7→8）——跑受影响包的专项测试（USB 打包）
> - ❌ **禁止自动升**：automerge（精确锁 1.0.1-preview.7，2.x API 不兼容）——升级需先写 multi-device-sync 回归测试
> - 📋 **DSH 依赖更新**：`@deepseek-ai/dsh` + `@deepseek-ai/cordis` 已发布到 npm（2026-08-14 确认），走 Dependabot 自动追踪 + check-deps.sh 手动确认

> ⚠️ **WorkBuddy 沙箱环境假失败**：在 WorkBuddy.app 内运行 `npm test` 时，genie-safe-delete.cjs shim 可能拦截测试清理用的 `fs.rmSync`，导致 ETIMEDOUT 假失败（测试断言本身已通过，只是 `finally` 清理块超时）。**这是环境问题，非源码 bug**——CI / 本地终端裸跑无此问题。v1.3.3 起，所有测试清理 `rmSync` 已 try-catch 包裹，WorkBuddy 下应稳定全绿；若仍偶现 FAIL，先在非 shim 环境复验（见 LIMITATIONS §四「safe-delete 环境下的测试预期失败」）。
| 4 | shellcheck：`bash tools/pre-push-check.sh --quick`。⚠️ 涉及 CLI 命令迁移时跳过，延后到阶段八 | 零 error |
| 5 | **dist 与 src 同步验证**：`diff <(grep "关键命令" engine/audit/src/index.ts) <(grep "关键命令" engine/audit/dist/index.js)` | 无实质差异（排除编译格式化） |
| 6 | 改动清单核对 | `git diff --stat` 确认只改了 changelog 规定的文件 |
