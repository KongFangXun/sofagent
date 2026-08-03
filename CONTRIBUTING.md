# 贡献指南

> 📖 新贡献者？先看 [COMMUNITY.md](./docs/COMMUNITY.md) 了解社区现状和贡献路径。

欢迎参与 sofagent！这个项目的代码由 AI 模型辅助生成（详见[致谢](./docs/THANKS.md#生成伙伴)），作者做产品决策和终审。你看到的任何技术问题，请直接指出来，不必客气。

---

## 新人 30 秒快速开始

| 你想... | 怎么做 |
|------|------|
| 报 Bug / 提想法 | → [开 Issue](https://github.com/KongFangXun/sofagent/issues/new/choose) |
| 不知道怎么用 | → [Discussions 去问](https://github.com/KongFangXun/sofagent/discussions) |
| 不知道怎么测 | → 看 [testing.md](./docs/guides/testing.md) 的 5 个标准化用例 |
| 想直接改代码 | → 看下面「贡献者 10 分钟速览」 |
| 想理解概念 | → 看 [ARCHITECTURE.md](./docs/ARCHITECTURE.md) |
| 想跑实验 | → 看 docs/evidence/benchmark/ 的实验记录模板 |

### 贡献者 10 分钟速览

**只看 3 个文件**：

| 顺序 | 文件 | 看什么 | 约几分钟 |
|:--:|------|------|:--:|
| 1 | [SKILL.md](./SKILL/SKILL.md) | 4 底线 + 7 则铁律 | 3 min |
| 2 | [CHANGELOG.md](./CHANGELOG.md) | 最新版本的变更 | 5 min |
| 3 | [LIMITATIONS.md](./LIMITATIONS.md) | 已知局限 | 2 min |

**先改 2 个脚本（最低门槛）**：

| 脚本 | 改什么 | 难度 |
|------|------|:--:|
| `install.sh` | BSD/macOS 兼容性修复 | ⭐⭐ |
| `engine/scripts/verify.sh` | 新增检查项（bash 版，安装流程内调用） | ⭐ |
| `engine/audit/src/verify.ts` | TS 版验证（npm bin `sofagent-verify`） | ⭐ |

**跑 1 条命令验证**：

```bash
bash install.sh && bash engine/scripts/verify.sh
# 或 TS 版：cd engine/audit && npm run build && node dist/verify.js
```

> 💡 **首次 clone 后**：先 `npm install && npm run build`，再 `npm test`。测试依赖构建产物（`dist/`），未 build 直接跑测试会报模块找不到。

> ⚠️ **本地测试用 `node dist/index.js` 而非全局二进制**——全局 `sofagent-audit` 可能是旧版本（npm publish 后才更新）。改代码后先 `npm run build`，再用 `node engine/audit/dist/index.js --diff HEAD~1..HEAD` 测试。

### 仓库目录结构（P1-38 新增——新贡献者先看文件放哪）

| 目录 | 内容 |
|------|------|
| `engine/` | 12 个 npm 子包（`audit` 审计引擎 / `core` 底座 / `daemon` 守护 / `orchestrator` 编排 / `mcp` / `rules` / `eval` / `think` / `skillopt` / `ontology` / `harness` / `ab-test`）+ `hooks/sofagent-load-chain` |
| `engine/audit/src/rules/` | 审计规则实现（`rule-a*.ts` A1-A23 + `skill-safety-engine.ts`）；A20 网络外传 / A21 持久化后门 / A22 权限提升 / A23 路径穿越（v1.2.5 新增） |
| `engine/audit/src/` | 审计核心：`audit-trail.ts` 审计轨迹聚合 + `protocol-neutrality.ts` 协议中立声明（v1.2.5 新增） |
| `engine/audit/src/permission/` | 权限配置加载与检查 |
| `engine/core/src/` | 底座：配置加载 / 原子写入 / 审计历史哈希链 / 联邦合并 / 安全脱敏；`agent-identity.ts` Agent 身份码（v1.2.5 新增） |
| `engine/daemon/src/` | 守护进程：cron / fs 监听 / 联邦查询 / Dream Cycle / 巡检器；`with-retry.ts` 推送重试 + `daemon-health.ts` 健康自检（v1.2.5 新增） |
| `engine/orchestrator/src/` | 编排引擎：`activate.ts` 激活链 Phase 1（v1.2.5 新增——读 FDE 交付物 → 注册企业 SubAgent） |
| `tools/` | 门禁脚本（`check-docs.sh` / `check-test-count.sh` / `pre-push-check.sh` / `sofagent-dashboard.sh`） |
| `FORGE/` | 项目自迭代工具链（LOOP 流水线 / playbook / fresh-eyes 审查体系） |
| `FDE/` | 前线部署方法论（GUIDE + templates） |
| `SKILL/` | 技能文件（SKILL.md 宪法 + harness 模板 + 子 Skill） |
| `docs/` | 文档（ARCHITECTURE / HANDBOOK / WIKI / changelog / evidence / guides） |

### 微任务清单（5-15 分钟）

| # | 任务 | 文件 | 难度 | 时间 |
|:--:|------|------|:--:|:--:|
| 1 | 改一条审计规则的正则 | `engine/audit/src/rules/rule-a*.ts` | ⭐ | 5 min |
| 2 | 给 install.sh lib 模块加参数校验 | `engine/scripts/lib/*.sh` | ⭐ | 10 min |
| 3 | 修复一个 ShellCheck 警告 | 见 ShellCheck Action 报告 | ⭐⭐ | 10 min |
| 4 | 补一个规则示例 | `docs/guides/plugins.md` | ⭐ | 15 min |
| 5 | 翻译一段 README 到英文 | `README.en.md` | ⭐⭐ | 15 min |

---

## 怎么参与

**提 PR**：Fork → `git checkout -b fix/xxx` → 提交 → 推送 → GitHub 提 PR。参照 [PR 模板](./.github/PULL_REQUEST_TEMPLATE.md)。

**Commit Message 规范**（Conventional Commits）：

```
<type>(<scope>): <subject>
```

| type | 用于 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档变更 |
| `refactor` | 重构（不改功能不修 Bug） |
| `test` | 测试相关 |
| `chore` | 构建/工具/依赖 |
| `style` | 格式调整（不改逻辑） |
| `ci` | CI 配置 |
| `perf` | 性能优化 |

> 自定义前缀（如 `evidence:` `index:`）不强制禁止，但推荐用标准 type。**纯描述性 commit（无前缀）不可接受。**
>
> 示例：`docs: evidence Case 023-025 外部用户验证归档` ✅ / `evidence 归档` ❌

**改 Skill 文件**：先改 `SKILL/harness/`（唯一权威），再 `bash install.sh` 同步。

**文档修改**：改 HANDBOOK 必须同步更新 `SKILL/harness/` 下模板。详见 [DEVELOPER §七](./docs/DEVELOPMENT.md#七数据文件架构)。

## 项目维护模型

代码主要由 AI 模型辅助生成，作者做产品决策和终审。PR 经 AI review 后作者终审。**Co-maintainer 诱因**：合入 5 个 PR → Admin；贡献跨平台修复 → README 留名；完成英文翻译 → 英文文档 Owner。

## 开发环境 + 发版

```bash
git clone https://github.com/KongFangXun/sofagent.git
cd sofagent && bash install.sh && bash engine/scripts/verify.sh
```

发版：`docs/changelog/vX.Y.md` 写日志 → `CHANGELOG.md` 加索引 → `tools/bump-version.sh` 升级版本号 → `cp -r sofagent/ ~/.workbuddy/skills/sofagent/` → `git tag vX.Y && git push` → `gh release create vX.Y`

---

## 目前最需要的帮助

| 优先级 | 需要什么 | 你能得到什么 |
|:--:|------|------|
| 🔴 | **真实使用数据** | 在 docs/evidence/evidence.md 留名 |
| 🟡 | **跨平台测试** | Codex / Hermes / Claude Code 运行报告 |
| 🟡 | **英文翻译** | Handbook 目前只有中文 |

> 你不需要会写代码。跑一周 sofagent，回来告诉我们发生了什么——不管好坏。

---

## Seeking Co-maintainers

sofagent 当前维护者为孔放勋一人。不设申请制——贡献自然累积，作者主动邀请：

| 级别 | 条件 | 能做什么 |
|------|------|---------|
| **Contributor** | 无门槛 | 提 Issue / 发 PR |
| **Triage** | 合并 PR ≥1 或有效 Issue ≥3 | 分流 Issue / 打标签 |
| **Co-maintainer** | 合并 PR ≥5 + 持续 ≥2 月 + 作者邀请 | review 和合并 PR |

**急需的技能方向**：

| 方向 | 具体做什么 | 每周时间 |
|------|------|:--:|
| **bash BSD/macOS 兼容** | install/verify/uninstall 跨平台修复 | 2-4 小时 |
| **安全审计** | 审查 SECURITY.md + 企业合规缺口 | 不限 |
| **OpenClaw hook (TS)** | handler.ts 回归测试 + 升级适配 | 2-3 小时 |
| **英文文档** | HANDBOOK + README 英文翻译 | 不限 |

> 🔴 如果你是 bash 方向开发者，直接开 Issue 说「我想做 Co-maintainer」——不用走正常流程。

---

## 行为准则

> **对人客气，对事尖锐。** 批评设计没问题，批评人不行。别把 Issue 区变成战场——但设计决策值得被尖锐地质疑，礼貌地。

完整行为准则基于 [Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct.html)，详见 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。

---

## License

本项目采用 MIT 许可证。你贡献的代码和文档默认跟随 MIT。详见 [LICENSE](./LICENSE)。

---

## 成为维护者

sofagent 当前 bus factor = 1（唯一维护者）。如果你以下条件满足至少 2 条，欢迎联系维护者讨论成为 co-maintainer：

- 提交过 3+ 个被合并的 PR
- 熟悉 bash 兼容性 / OpenClaw hook / 安全审计 / 英文文档 中至少一个领域
- 能独立 review 他人的 PR

联系方式：开 [Discussion](https://github.com/KongFangXun/sofagent/discussions) 或邮件 kong.yao@evfrey.com
