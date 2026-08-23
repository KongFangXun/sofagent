# 阶段二：开发 + 基础自测

---

## 步骤

| # | 步骤 | 产物 |
|:--:|------|------|
| 一 | 先修阶段一的 BugFix 批次（P0 先于一切新功能），再做新功能 | 代码 + 随修随记的回归维度 |
| 二 | changelog 作为活文档随改随记（定稿在阶段六） | 活文档 |

---

## 交付物清单闸门

开发 session 交付给发版 session 时，必须过 D1-D6 闸门。缺任一项 = 交付不完整。

| 闸门 | 检查项 |
|:--:|------|
| D1 | 实现纪要表（changelog 开头的交付→落点→说明表） |
| D2 | 测试数一致（changelog 声称数 = 实际 `npm test` 数） |
| D3 | changelog 章节序（新功能在前、BugFix 在后） |
| D4 | 版本号状态（changelog 头部标注当前版本号） |
| D5 | 文档日期（changelog 头部日期已更新） |
| D6 | 项目文档同步清单（changelog 每个功能点 → 对应文档有覆盖） |

---

## 开发期间纪律

改了什么，必须同步更新什么——否则发版时才发现遗漏：

| 改了什么 | 必须同步更新 |
|---------|------------|
| 审计规则（engine/audit/src/rules/） | 对应测试 + acceptance-test.sh 场景 + regression-checklist 维度 |
| MCP tool（engine/mcp/src/tools/） | SKILL.md 工具速查清单 + check-version.sh 工具数校验 |
| 审计维度数 / 测试数 / 包数 | README + CHANGELOG + ROADMAP + LIMITATIONS + evidence 数字声称 |
| bump-version / check-version / pre-push-check 脚本 | 三脚本覆盖范围一致性（check 能查的 bump 必须能改） |
| CI workflow（.github/workflows/） | 本地 pre-push-check 覆盖范围与 CI 对齐 |

---

## 基础自测（原阶段三 · 开发收尾必做）

> **定位**：开发完成即自测（原独立阶段三并入，同一会话连续动作）——bump 版本 → 构建 → 全量测试 → 文档数同步 → 依赖确认 → 卫生检查。

| # | 步骤 | 验证方式 |
|:--:|------|------|
| 一 | bump 版本号：`bash tools/release/bump-version.sh X Y`。bump 后检查 hook 文件头版本——`head -2 engine/audit/hooks/commit-msg engine/audit/hooks/post-commit` 的 v 标记必须与 package.json version 一致（check-version.sh 已覆盖） | `bash tools/check/check-version.sh` 全绿 |
| 二 | **changelog 状态转正**：`docs/changelog/v<major>.<minor>/vX.Y.md` 头部「⚠️ 尚未实现」+「状态：已排期」→ 改为「✅ 已开发」。删除「engine/ 下尚无对应代码」等过时警告，保留「前置依赖」 | 头部状态标注为已开发，无「尚未实现」残留 |
| 三 | `npm run build && npm test` | exit 0 + 全部通过 |
| 四 | **测试数文档同步门禁**（v1.3.4 教训：bugfix/dev/dsh 三阶段均漏此步）：`bash tools/check/check-test-count.sh --quiet` | 输出 OK / EXIT=0。FAIL = README/WIKI/LIMITATIONS/ARCHITECTURE 测试数与 test-count.sh SSOT 不一致，必须手动同步后再继续 |
| 五 | **关键依赖版本检查**：`bash tools/check/check-deps.sh`。检查 LangGraph 三件套 / automerge / zod / js-yaml / DSH 的当前版本 vs 最新版本——Dependabot 做周检查自动提 PR，本步做发版前快照确认 | 输出各依赖状态。automerge 标 🔒 精确锁（禁升 2.x），其余 ⚠️ 有新版本时按规则评估 |
| 六 | shellcheck：`bash tools/release/pre-push-check.sh --quick`。⚠️ 涉及 CLI 命令迁移时跳过，延后到阶段六 | 零 error |
| 七 | **工作区卫生检查**（2026-08-16 新增 · 根目录测试残留事件教训）：`npx sofagent-audit --diff-range HEAD --silent` 看「A18+ 工作区垃圾残留扫描」段（或直接跑 `git status --short` + 人工扫根目录） | 扫描零残留。有残留 = 先清理再发版（rm + `git rm --cached` + 补 .gitignore）——发版不带实验垃圾出门 |
| 八 | **dist 与 src 同步验证**：`diff <(grep "关键命令" engine/audit/src/index.ts) <(grep "关键命令" engine/audit/dist/index.js)` | 无实质差异（排除编译格式化） |
| 九 | 改动清单核对 | `git diff --stat` 确认只改了 changelog 规定的文件 |

> **编号说明**（2026-08-16 规范化）：原 3b/3c/4b 字母后缀步骤已并入纯数字序列（3b→4、3c→5、4b→7，原 4/5/6 顺延为 6/8/9）——步骤编号一律纯数字递延，不再使用字母后缀（字母后缀会让「步骤 N」引用歧义、脚本提示语错位）。

> **依赖升级决策规则**（步骤五 配套）：
> - ✅ **可当场升**：patch 版本 + 通用工具库（js-yaml / zod / archiver patch）——升完跑 `npm test` 全绿即可
> - 🟡 **评估后升**：LangChain 三件套（patch 也评估）——升完跑全量测试 + FORGE fresh-eyes 跑一轮 A/B 验证不回归
> - 🟡 **单独评估**：major 版本跳跃（如 archiver 7→8）——跑受影响包的专项测试（USB 打包）
> - ❌ **禁止自动升**：automerge（精确锁 1.0.1-preview.7，2.x API 不兼容）——升级需先写 multi-device-sync 回归测试
> - 📋 **DSH 依赖更新**：`@deepseek-ai/dsh` + `@deepseek-ai/cordis` 已发布到 npm（2026-08-14 确认），走 Dependabot 自动追踪 + check-deps.sh 手动确认

> ⚠️ **WorkBuddy 沙箱环境假失败**：在 WorkBuddy.app 内运行 `npm test` 时，genie-safe-delete.cjs shim 可能拦截测试清理用的 `fs.rmSync`，导致 ETIMEDOUT 假失败（测试断言本身已通过，只是 `finally` 清理块超时）。**这是环境问题，非源码 bug**——CI / 本地终端裸跑无此问题。v1.3.3 起，所有测试清理 `rmSync` 已 try-catch 包裹，WorkBuddy 下应稳定全绿；若仍偶现 FAIL，先在非 shim 环境复验（见 LIMITATIONS §四「safe-delete 环境下的测试预期失败」）。
