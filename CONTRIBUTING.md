# 贡献指南

> 📖 新贡献者？先看 [COMMUNITY.md](./COMMUNITY.md) 了解社区现状和贡献路径。

欢迎参与 sofagent！

首先要说明：**我不会写代码**——这个项目的所有文件都是用 DeepSeek V4 Pro 和 GLM-5.2 配合生成的。所以你看到的任何技术问题，都很可能是因为我不知道自己在干什么。请直接指出来，不必客气。

---

## 新人 30 秒快速开始

| 你想... | 怎么做 |
|------|------|
| 报 Bug / 提想法 | → [开 Issue](https://github.com/KongFangXun/sofagent/issues/new/choose) |
| 不知道怎么用 | → [Discussions 去问](https://github.com/KongFangXun/sofagent/discussions) |
| 不知道怎么测 | → 看 [TESTING.md](./docs/TESTING.md) 的 5 个标准化用例 |
| 想直接改代码 | → 看下面「贡献者 10 分钟速览」 |
| 想理解概念但不知道从哪看 | → 看 [ARCHITECTURE.md §五bis](./ARCHITECTURE.md)（评审洞察，概念地图） |

### 贡献者 10 分钟速览

> v0.85 新增。评审指出：「一个开发者想贡献代码，先要搞懂宪法、铁律、编排、daemon、断路器……概念太多了。」这是精简路径——只看这 3 个文件，改这 2 个脚本，跑这 1 条命令验证。

**只看 3 个文件**：

| 顺序 | 文件 | 看什么 | 约几分钟 |
|:--:|------|------|:--:|
| 1 | [SKILL.md](./sofagent/SKILL.md)（宪法内联） | 4 底线 + 10 铁律——项目的灵魂，所有概念从这里展开 | 3 min |
| 2 | [docs/changelog/v0.85.md](./docs/changelog/v0.85.md) | 当前版本做了什么 + 定位校准 + 下一步方向 | 5 min |
| 3 | [LIMITATIONS.md](./LIMITATIONS.md) | 已知局限——看完你就知道哪些坑可以帮忙填 | 2 min |

**先改 2 个脚本（最低门槛）**：

| 脚本 | 改什么 | 难度 |
|------|------|:--:|
| `sofagent/scripts/install.sh` | BSD/macOS 兼容性修复（见 [MEMORY.md 脚本工程教训](./.workbuddy/memory/MEMORY.md)） | ⭐⭐ |
| `sofagent/scripts/verify.sh` | 新增检查项（加 `--quick` 模式的检查项） | ⭐ |

**跑 1 条命令验证**：

```bash
bash sofagent/scripts/install.sh && bash sofagent/scripts/verify.sh
```

通过就可以提 PR。

> 💡 你不需要会写代码。跑一周 sofagent，回来告诉我们发生了什么——不管好坏。

---

## 怎么参与

### 提 Issue

如果你想：

- 文档里有写错的地方直接提 issue——不用讲究。
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

改之前看一眼 [Developer §七](./DEVELOPMENT.md#七数据文件架构) 的「维护规则」。涉及 § 交叉引用的修改，看看引用的地方有没有坏链。

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

## 版本发布流程

从 v0.81 起每个版本发布时同步完成以下步骤：

| 步骤 | 命令 / 操作 | 说明 |
|------|------|------|
| ① 详细开发日志 | `docs/changelog/vX.Y.md` | 记录一下：改了什么、为什么改、文件清单 |
| ② CHANGELOG 索引 | `CHANGELOG.md` 顶部加条目 | 一句话摘要 + 链接到 ① |
| ③ 版本号统一 | 脚本 `VERSION=` + 文档头 `> vX.Y` | 见 [MEMORY.md 版本号升级检查清单](./.workbuddy/memory/MEMORY.md) |
| ④ 安装副本同步 | `cp -r sofagent/ ~/.workbuddy/skills/sofagent/` | 工作区 → 安装副本 |
| ⑤ git tag | `git tag vX.Y && git push origin vX.Y` | 打标签并推送 |
| ⑥ GitHub Release | `gh release create vX.Y --title "..." --notes "..."` | 内容从 CHANGELOG.md 拉，让访客看到项目活跃度 |

> 💡 步骤 ⑤⑥ 容易漏——v0.82 发版时漏了 tag 和 Release，后来才发现补上。**每个版本都必须有 GitHub Release。**

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
| 文档纠错 | ⭐ | |
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

**我们特别需要这些技能**（v0.85 具体化）：

| 技能方向 | 具体做什么 | 每周时间 | 为什么急需 |
|------|------|:--:|------|
| **bash BSD/macOS 兼容** | install/verify/uninstall 跨平台 bug 修复 + 公共函数库重构 | 2-4 小时 | 评审指出「纯 bash 不是大多数人想碰的」，作者也不懂——这是最大工程债 |
| **安全审计** | 审查 SECURITY.md + 提出企业级合规缺口 | 不限 | 企业落地的前置条件——v0.9 合规三件套需要安全专家 review |
| **OpenClaw hook (TS)** | handler.ts 回归测试 + Hook 架构升级适配 | 2-3 小时 | OpenClaw 每 3-4 周一个版本，hook 兼容性需要持续维护 |
| **英文文档** | HANDBOOK + README 英文翻译 | 不限 | 国际化最大瓶颈 |

> 🔴 **v0.85 评审强调**：「你是项目最大的瓶颈。不要等，现在就需要。」如果你是 bash 方向的开发者，每周能投入 2-4 小时，**直接开 Issue 说「我想做 Co-maintainer」**——不用走 Contributor → Triage 的正常流程，我们直接谈。

从第一个 PR 开始，贡献自然累积，作者会主动邀请你进入下一级。

---

## 行为准则

一句话：**对人客气，对事尖锐。**

批评设计没问题，批评人不行。别把 Issue 区变成战场。
我们连自己都会骂（上面那段「我不会写代码」），你骂设计完全 OK。✌️

---

## License

本项目采用 MIT 许可证。你贡献的代码和文档默认跟随 MIT。详见 [LICENSE](./LICENSE)。
