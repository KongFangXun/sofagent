# Pull Request

> 请确认以下检查项全部通过后再合并。

## 自检清单

- [ ] **文档同步**：相关手册（`HANDBOOK.md` / `DEVELOPMENT.md` / `ARCHITECTURE.md`）已更新，交叉引用一致
- [ ] **验证通过**：`bash sofagent/scripts/verify.sh` 全部通过，无语法错误
- [ ] **部署循环**：跑过一次完整的安装→卸载→重装流程（`install.sh` + `uninstall.sh`）

### 脚本 / Skill 改动额外检查（纯文档改动可跳过）

> 仅当本 PR 修改了 `sofagent/scripts/` 或 `sofagent/*.md` 时勾选

- [ ] **非 OpenClaw 平台测试**：在至少一个非 OpenClaw 平台（Claude Code / WorkBuddy / Codex）验证过行为
- [ ] **参数兑现检查**：文档中描述的脚本参数（`--help` 输出）在代码中真实存在，没有虚构参数
- [ ] **脱敏回归**：如修改了 `sanitize()`，跑过 `verify.sh` 脱敏测试用例全部通过

## 变更说明

<!-- 简述此 PR 做了什么、为什么这样做 -->

## 影响范围

<!-- 标记受影响的模块： -->
- [ ] 宪法 / 规则层（rules.md、SKILL.md）
- [ ] 脚本层（scripts/）
- [ ] Skill / Hook 层
- [ ] 数据文件模板（.sofagent/）
- [ ] 文档 / 手册
- [ ] CI / 基础设施
