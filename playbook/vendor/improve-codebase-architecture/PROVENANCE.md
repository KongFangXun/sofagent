# PROVENANCE · upstream vendoring 清单

> **这是 provenance 清单，不是规则文档。** commit / 日期 / 哈希是本文件的正文内容——
> 「规则文档不带版本号与日期」的纪律**不适用于此处**，请勿「清理」它们。
> 本地差异与适配说明见 [`../../deep-module-review.md`](../../deep-module-review.md)。

## 一、来源

| 项 | 值 |
|----|----|
| 上游仓库 | https://github.com/mattpocock/skills |
| 上游路径 | `skills/engineering/improve-codebase-architecture/` + 依赖闭包 |
| 钉版 commit | `3cca18b368ae95cdbdebbff572ccafa662551015` |
| 该 commit 日期 | 2026-09-04 |
| 抓取方式 | `raw.githubusercontent.com` 逐文件取原文（HTTP 200） |
| 抓取日期 | 2026-09-11 |
| 许可证 | MIT · Copyright (c) 2026 Matt Pocock —— 原文见同目录 [`LICENSE`](LICENSE) |

## 二、为什么 vendoring 而不是链接

上游 skill 是**方法论本体**，本地只写适配层（差异 + 编排），不转写方法论。vendoring 是为了：

- **可 diff 升级**：`upstream/` 保持上游相对路径 1:1，`diff -r` 直接看出上游改了什么
- **可分发给 FDE**：装完 sofagent 即拿到完整可跑的审查闭包，不依赖外网
- **升级断链可发现**：pin 写死在清单里，上游漂移一眼可见

## 三、文件清单（sha256）

**本地一律不得改写 `upstream/` 下的任何文件**——改了就失去 diff 能力。需要改行为 → 改适配层。

| 文件 | sha256 |
|------|--------|
| `upstream/improve-codebase-architecture/SKILL.md` | `d1ac25511a936ff4250a48dbcefda363837d6bb9321b3cba73df99fa37270a75` |
| `upstream/improve-codebase-architecture/HTML-REPORT.md` | `581e8bb5a521e46bbda8ca7e19b15948bed882187108092ebb90c62513b77528` |
| `upstream/codebase-design/SKILL.md` | `2c20617f87ec8af6a434859f381b2f061a69b530444e74eb39e78bb016a6d1e2` |
| `upstream/codebase-design/DEEPENING.md` | `f3dd099ce99289bd213914d8ee3e2429b78309c3957ca4583f7659551b1d53c1` |
| `upstream/codebase-design/DESIGN-IT-TWICE.md` | `8e740bf98446dbd4dfdc132ac4346d9a7eedaf93de6a495889171cf7f99f16bd` |
| `upstream/grilling/SKILL.md` | `10ff989e7498b23b5acb49d5048f11dcd906757d2f79c5cdf8a00001381296f2` |
| `upstream/grill-with-docs/SKILL.md` | `7de372c13488f1ee96cc11cd8907b56b6809cc93eef776eeddd37de6b6cbe3fe` |
| `upstream/domain-modeling/SKILL.md` | `327a2b50620e2fd70abc6893cd6965e76b20f8d0adb0dc2c8d5eb3845efb643e` |
| `upstream/domain-modeling/ADR-FORMAT.md` | `944c92aa790e8fbdc9199640b170979abb8a34ba8d0fe18c2a01a63bce140ca0` |
| `upstream/domain-modeling/CONTEXT-FORMAT.md` | `17ab16ce783e4d2801ee52fd9acdf550cbf44de65ae76797a93943bbedf22a13` |

校验：

```bash
cd playbook/vendor/improve-codebase-architecture/upstream && shasum -a 256 $(find . -type f -name '*.md' | sort)
```

**依赖闭包为何含这四个目录**：`improve-codebase-architecture` 的流程以 `Skill tool` 按名调用
`codebase-design`（受控词汇表，缺了它全文术语无定义）、`grilling`（第 3 步决策树）、
`domain-modeling`（第 3 步领域模型维护）；`codebase-design` 又下引 `DEEPENING.md` / `DESIGN-IT-TWICE.md`；
`grill-with-docs` 是 grilling + domain-modeling 的组合入口。闭包到此为止，无更深引用。

## 四、本地偏差（本清单最重要的部分）

上游原文**不改**，偏差全部落在适配层。以下是实际执行时的行为差异：

| # | 上游行为 | 本地行为 | 落点 |
|---|---------|---------|------|
| 1 | 写自包含 HTML 到 OS 临时目录并 `open` | **对话形式直出**，不落 HTML、不落仓库 | `deep-module-review.md` §三、§六-2 |
| 2 | 用户显式敲 `/improve-codebase-architecture` | 作为 fresh-eyes 审查的体系外挂按需执行 | `../fresh-eyes-review.md` 视角分层表后的「体系外挂」段 |
| 3 | 依赖 `CONTEXT.md` 领域词汇表 | 改用 README / COMMUNITY / PHILOSOPHY / ARCHITECTURE / 术语表 | `deep-module-review.md` §三 |
| 4 | 依赖 `docs/adr/` 做 ADR 冲突检查 | 改为对照既有设计决策文档 | 同上 |
| 5 | `Skill tool` 按名调用 sibling skills | 按路径读取 vendored 原文 | `deep-module-review.md` §二 |
| 6 | 选定候选后当场进入 grilling loop | 审查轮内不进入，候选去留由人裁定，施工另派 | `deep-module-review.md` §三 |
| 7 | 无「零信任抽验」环节 | 主理人逐条独立复测关键数字，否定式发现当轮重验 | `deep-module-review.md` §四-三 |

**HTML 输出的恢复路径**：若某次确实需要上游的 HTML 报告形态（例如给非技术干系人看），
按 `upstream/improve-codebase-architecture/HTML-REPORT.md` 原样执行即可——
偏差是「默认不写文件」，不是「禁止写文件」。

## 五、升级流程

```bash
# 1. 上游新检出到任意临时目录后，逐文件 diff（路径 1:1 对应）
diff -r <上游检出>/skills/engineering ./upstream
# 2. 差异逐条过：影响「四、本地偏差」表的 → 更新适配层；不影响的不动
# 3. 更新本清单第一节的 pin 与抓取日期，第三节重算哈希
```

**升级判据**：上游改了方法论 → 只要适配层的偏差表仍成立，本地**零改动**即完成升级。
若某次升级需要改适配层，说明偏差表已过期，改完必须回来更新本清单。

**升级后必跑门禁**：`bash tools/check/check-docs.sh`。

- §1b 全仓死链扫描**有意覆盖 `upstream/`**——它顺带验证闭包完整性：上游若新增指向闭包外文件的相对链接，门禁会报死链，此时要么补齐 vendoring，要么在本清单记下该链接为何可从缺。
- §4 文档预算：`playbook/vendor/` 已从 B 层排除（第三方原文不计入自研预算，理由见 `tools/check/check-docs.sh` LAYER_B 段注释）。

## 六、挂载点（两处，同一 pin）

| 落点 | 用途 | 位置 |
|------|------|------|
| 仓内 vendoring | 版本控制 + 可 diff 升级 + 随包分发 | 本目录 |
| 用户级安装 | 运行时可直接被 skill 机制加载 | `~/.workbuddy/skills/improve-codebase-architecture/` |

两处必须指向**同一 commit**。升级时两处同步，不允许只升一处。
