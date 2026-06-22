# 贡献指南

欢迎参与 sofagent！

首先要说明：**我不会写代码**——这个项目的所有文件都是用 DeepSeek V4 Pro 和 GLM-5.2 配合生成的。所以你看到的任何技术问题，都很可能是因为我不知道自己在干什么。请直接指出来，不必客气。

---

## 新人 30 秒快速开始

| 你想... | 怎么做 |
|------|------|
| 报 Bug / 提想法 | → [开 Issue](https://github.com/KongFangXun/sofagent/issues/new/choose) |
| 不知道怎么用 | → [Discussions 去问](https://github.com/KongFangXun/sofagent/discussions) |
| 不知道怎么测 | → 看 [TESTING.md](./docs/TESTING.md) 的 5 个标准化用例 |
| 想直接改代码 | → 跳到下面「提 PR」 |

> 💡 你不需要会写代码。跑一周 sofagent，回来告诉我们发生了什么——不管好坏。

---

## 怎么参与

### 提 Issue

如果你想：

- 报告文档中的错误（逻辑矛盾、术语不一致、交叉引用断裂）
- 建议新增设计点
- 问「这个东西到底怎么用」

→ 直接开 [Issue](https://github.com/KongFangXun/sofagent/issues)。

### 提 PR

如果你想直接改东西：

1. **Fork** 这个仓库
2. 创建你的分支：`git checkout -b fix/xxx` 或 `git checkout -b feature/xxx`
3. 改完提交：`git commit -m "fix: 修了 XX 的问题"`
4. 推到你自己的仓库：`git push origin fix/xxx`
5. 在 GitHub 上提 Pull Request

> 💡 提 PR 前请参考 [PR 模板](./.github/PULL_REQUEST_TEMPLATE.md)——含内容 checklist：同步文档 / 跑 verify / 非 OpenClaw 测试 / 部署循环。

### 文档修改须知

Handbook（`HANDBOOK.md`）有一项硬性约束：**改手册必须同步改 `sofagent/` 模板。反过来也一样。**

改之前看一眼 [Developer §七](./DEVELOPMENT.md#七数据文件架构) 的「维护规则」。涉及 § 交叉引用的修改，记得验证上下游一致性。

### 改 Skill 文件的注意事项

Skill 文件改了之后不会自动生效，需要三步：

1. **先改 `sofagent/`**（工作区源文件，唯一权威）
2. **重新安装同步**：`bash sofagent/scripts/install.sh --platform openclaw`（覆盖全部 Skill 文件到安装位置）

install.sh 已自动复制全部 6 个 Skill 文件（1 主 + 5 子）及子目录，无需手动 cp。修改后重新运行 install.sh 即可同步。

---

## 开发环境搭建

```bash
git clone https://github.com/KongFangXun/sofagent.git
cd sofagent

# OpenClaw：一键安装
bash sofagent/scripts/install.sh

# WorkBuddy：复制到 skills 目录
cp -r sofagent/ ~/.workbuddy/skills/sofagent/

# 验证安装
bash sofagent/scripts/verify.sh
```

> 改完 Skill 文件后，WorkBuddy 用户需手动同步到 `~/.workbuddy/skills/sofagent/`。OpenClaw 用户重新运行 install.sh 即可。

---

## 目前最需要的帮助

> ⚠️ 目前项目维护者为孔放勋一人，单点依赖风险已知，欢迎共同维护者加入——尤其需要 OpenClaw / WorkBuddy / Codex / Hermes Agent / Claude Code 跨平台测试和英文翻译方向的贡献者。

| 优先级 | 需要什么 | 你能得到什么 |
|:--:|------|------|
| 🔴 | **真实使用数据** | 在 docs/EVIDENCE.md 留名 + 出现在 README「实际效果」里 |
| 🟡 | **跨平台测试** | Codex / Hermes Agent / Claude Code 用户的运行报告 |
| 🟡 | **英文翻译** | Handbook 目前只有中文 |

> 你不需要会写代码。跑一周 sofagent，回来告诉我发生了什么——不管好坏。
> 不知道怎么测？→ [TESTING.md](./docs/TESTING.md) 有 5 个标准化用例。

---

## 主要贡献方向

| 方向 | 难度 | 说明 |
|------|:--:|------|
| 文档纠错 | ⭐ | 找矛盾、找遗漏、找术语不统一 |
| 设计补充 | ⭐⭐ | 模糊段落的精确化、新增设计要点 |
| Skill 精简 | ⭐⭐⭐ | 当前 5 个子 Skill 合计 246 行，token 预算偏紧。帮我们优化，不压缩语义 |
| 安装脚本 | ⭐⭐⭐ | install.sh（五平台 `--platform` 参数）/ verify.sh / uninstall.sh |

---

## Seeking Co-maintainers

sofagent 当前维护者为孔放勋一人。我们正在寻找愿意深度参与的 Co-maintainer。

**不设申请制**——贡献自然累积，作者主动邀请：

| 级别 | 条件 | 能做什么 |
|------|------|---------|
| **Contributor**（任何人） | 无门槛 | 提 Issue / 发 PR |
| **Triage** | 合并 PR ≥1 个 **或** 有效 Issue ≥3 个 | 分流 Issue / 打标签 / 回复用户问题 |
| **Co-maintainer** | 合并 PR ≥5 个 **+** 持续贡献 ≥2 个月 **+** 作者邀请 | review 和合并别人的 PR（不能直接 push main） |

版本发布和架构决策目前只有作者。等 Co-maintainer 稳定贡献 6 个月以上再谈权限升级。

**我们特别需要这些技能**：
- bash BSD/macOS 兼容性（install.sh 跨平台是最大的工程债）
- OpenClaw hook 开发（TypeScript）
- 安全审计（企业级落地的前置条件）
- 英文文档（国际化最大瓶颈）

从第一个 PR 开始，贡献自然累积，作者会主动邀请你进入下一级。

---

## 行为准则

一句话：**对人客气，对事尖锐。**

批评设计没问题，批评人不行。别把 Issue 区变成战场。

---

## License

本项目采用 MIT 许可证。你贡献的代码和文档默认跟随 MIT。详见 [LICENSE](./LICENSE)。
