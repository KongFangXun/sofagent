# sofagent 版本开发 SOP

> 本文件是发布流程总览入口；逐步操作细则在 [`releasing/`](./releasing/) 目录（01-review.md → 11-post-publish.md，共 11 步）。

> 从「上一版发布完」到「下一版发布完」的完整操作手册。十一个阶段，每阶段一个独立文件。
>
> **防止 lost-in-the-middle**：每次执行时**先读下方进度追踪确认当前阶段**，然后只读当前阶段的独立文件——不要一次性读全文。
>
> **编号口径（十一阶段制）**：ROADMAP 同步随阶段六步骤五执行（无独立阶段）；历史 changelog 快照中的阶段七 = ROADMAP 同步（已并入阶段六），旧阶段八~十二 = 现阶段七~十一。
>
> **🔴 断点重述协议**：session 中断（网络断/超时/用户离开）后用户说「继续」时，授权范围 = **中断前正在执行的那一个步骤**，不是剩余全部流程。执行者动手前必须先重述确认：「当前阶段 X 步骤 Y，接下来只做 Z，完成后停在 [下一个需拍板的点]」。外部不可逆动作（push / npm publish / Skill 分发 / 文件删除）前的硬确认永不因「继续」而豁免——确认颗粒度对准不可逆性，可逆动作（commit/改文档）可连续跑。
>
> **🔴 阶段间确认关口**：单个阶段的授权到该阶段收尾即止——完成即停下汇报，**等作者明确确认（「继续」「开始阶段 X」）后才开下一阶段**。阶段内的可逆动作（读文件、跑门禁、commit）可连续执行；阶段边界是硬停点。同一轮回复里「问是否继续」却紧接着把下一阶段做完 = 假确认，等同越权。汇报可以预告下一阶段将做什么，动手必须等确认。

---

## 十一阶段一览（编号 SSOT —— 引用阶段时以本表为准）

> **为什么需要本表**：阶段编号曾被现场纠正（「七=ROADMAP 同步 / 八=tool health」与实际不符），
> 后续执行中也出现过编号困惑。**根因 = 没有一个"编号 → 文件 → 一句话职责"的总表**，
> 每次都要翻文件数序号。本表是编号的唯一 SSOT，本目录下所有文件引用阶段时以此为准。

| # | 文件 | 一句话职责 | 关口 |
|:--:|---|---|:--:|
| 一 | [01-review](./releasing/01-review.md) | 复盘：上一版遗留 + 本轮待办梳理 | |
| 二 | [02-dev](./releasing/02-dev.md) | 开发：功能实现 + 随开发实时补场景/维度 | |
| 三 | [03-quality-loop](./releasing/03-quality-loop.md) | 质量循环：fresh-eyes-loop 多视角盲审 + 修复批 + 豁免 | |
| 四 | [04-review-system](./releasing/04-review-system.md) | 审查体系升级：从产出物提取新发现，更新四份审查文档 | |
| 五 | [05-release-gate](./releasing/05-release-gate.md) | 发布闸门：脚本层 + 判定层，verdict=PASS 才放行 | 🔴 |
| 六 | [06-doc-finalize](./releasing/06-doc-finalize.md) | 文档定稿：devlog / Release Notes **规范源头** / 文档同步 | 🔴 |
| 七 | [07-tool-health](./releasing/07-tool-health.md) | 工具健康：全部门禁脚本体检 + 新增目录收录 | |
| 八 | [08-confirm](./releasing/08-confirm.md) | 确认关口：三问拍板（发版窗口 / 收口项 / 放行） | 🔴 |
| 九 | [09-publish](./releasing/09-publish.md) | **发布流水线**：bump → 入口同步 → tag → release → npm publish | 🔴 |
| 十 | [10-distribute](./releasing/10-distribute.md) | 分发：Skill（ClawHub/SkillHub）+ DSH plugin + OpenClaw plugin + Marketplace + 设备端 | |
| 十一 | [11-post-publish](./releasing/11-post-publish.md) | 发布后：验证 + 三文档回写 + SOP 迭代 + dev-prompt + hook/daemon | |
| （附） | [auto-converge-protocol](./releasing/auto-converge-protocol.md) | 自动收敛协议（阶段三/五通用的循环收敛规则） | |

> 🔴 **关口标记**：带 🔴 的阶段是**人（项目负责人）确认关口**——AI 不得越过。
> 一揽子放行（阶段九的授权边界）只覆盖**发布链本身的动作**，不覆盖关口决策。

---

## 进度追踪

> 每次新 session 或新阶段开始时，先读这 11 行确认进度。打勾的 = 已完成，第一个未打勾的 = 当前要做。

- [ ] 一 · 审查上版本（fresh-eyes 独立审查 · 新 session 或对话式多轮）→ [01-review.md](./releasing/01-review.md)
- [ ] 二 · 开发 + 基础自测（开发收尾即自测）→ [02-dev.md](./releasing/02-dev.md)
- [ ] 三 · fresh-eyes-loop 质量循环 + 代码审核 + 验收测试（入口裁定一次 · A 快速直收 / B 盲审复制一次 prompt）→ [03-quality-loop.md](./releasing/03-quality-loop.md)（走对话式多轮审查等价形态：22 视角分层取用 + 零信任复验通过）
- [ ] 四 · 审查体系合并更新 + 最终确认 → [04-review-system.md](./releasing/04-review-system.md)
- [ ] 五 · release-gate-loop 发版闸门（新 session · 自动收敛循环 · 必须 PASS 才继续）→ [05-release-gate.md](./releasing/05-release-gate.md)
- [ ] 六 · 开发日志定稿 + 文档收尾 → [06-doc-finalize.md](./releasing/06-doc-finalize.md)
- [ ] 七 · 工具脚本健康检查 → [07-tool-health.md](./releasing/07-tool-health.md)
- [ ] 八 · 发布放行关口（作者一次性放行 + 三拍板）→ [08-confirm.md](./releasing/08-confirm.md)
- [ ] 九 · 发布流水线（狗粮→检查→push→tag→release→npm publish · 项目负责人或授权 AI）→ [09-publish.md](./releasing/09-publish.md)
- [ ] 十 · 分发（Skill / DSH plugin / OpenClaw plugin / 设备端安装 · 项目负责人或授权 AI）→ [10-distribute.md](./releasing/10-distribute.md)
- [ ] 十一 · 发布后（验证 + 三文档回写 + SOP 自迭代 + 下版 prompt）→ [11-post-publish.md](./releasing/11-post-publish.md)

> **铁律**：阶段五 verdict=PASS 前，不进阶段六~八。FAIL 由执行 session 按该阶段 SOP 的「修复批协议」自动收敛修复（03/05 均内建循环+红线+停手条件），命中停手条件才回阶段四交主 session 接手。
>
> 🔴 **阶段十不可跨**：阶段九 npm publish 完成后最容易直接跳进阶段十一——分发（Skill 双平台 / DSH plugin 家族 / OpenClaw plugin 家族 / Marketplace 核查）是用户实际安装的通道，跳过 = 新版只存在于 npm，所有生态渠道停在旧版。步骤一发布后验证里的「分发渠道对账」段是事后报警面，进度追踪本行打勾是事前防线——**跨阶段十进十一 = 发布没走完**。

> **onboarding 走查检查项（多条新产品线同版落地时必走）**：
> 当一版同时落地 ≥2 条新产品线时，阶段六文档收尾前必走「陌生人视角」入口走查：
> 一、以新用户视角走「装 → 找到各产品线入口 → 每条线 10 分钟内进入第一步」，逐项记录断点（命令不存在 / 文档无指引 / 依赖未声明）——断点即修，修复有 commit；
> 二、HANDBOOK「新功能入口导览」表逐行核对：入口命令逐条真实存在（无断头路）、前置要求逐条可执行；
> 三、install.sh 完成提示分层核对：提示的每个命令真实可跑（核心即用 / 可选线各有前置指引）；
> 四、Dashboard 空数据引导核对：全新安装态给「先做 X」引导而非直接退出；
> 五、走查执行记录随发版检查清单落盘（devlog 或 06 文档收尾段）。
>
> **自迭代**：阶段十一「步骤十」是 releasing.md 的「Dream Cycle」——每次发版后用实际执行体验审查 SOP 自己（顺序一致/引用断裂/缺口吸收/冗余清理），持续进化。这是活文档的自我维护机制，不是一次性动作。

---

## SOP 维护规约（写给维护 SOP 的模型与人）

> 这套 SOP 的第一读者是**模型**（执行 session / fresh-eyes worker / 下一版发版的 AI），第二读者才是人。维护时两条可读性都要管。

**结构规约（每阶段文件必须遵守）**：

| 规约 | 说明 |
|------|------|
| **机器锚不删** | 每文件头部 `<!-- SOP-ANCHOR: SN | ... -->` 是模型 grep 一跳定位的锚——改阶段编号/顺序时同步改锚，删锚 = 模型失明 |
| **步骤表必有勾选列** | 执行时逐格打勾防漏（11-post-publish 教训：无勾选列曾整批漏做）——新加步骤必须带 `[ ]` 格 |
| **单文件 ≤650 行** | 超限 = 拆子文件（如 auto-converge-protocol.md 先例），不往单文件堆——模型上下文有限，文件越长中段步骤越容易被跳过（lost-in-the-middle） |
| **判据可 grep** | 写「验证方式」时优先给命令/字面判据（`EXIT=0`、`grep -c X 文件`），少写「人工确认」——模型执行不了「人工确认」，会跳过或假装做过 |
| **禁考古** | 规则正文不带版本号/日期/run 编号（check-archaeology 强制；机器字面量/能力门槛除外）；「为什么有这条」的叙事放 blockquote 且一句话内讲完 |
| **引用用相对链接** | 跨阶段引用写 `[04 打勾前置产物核对](./releasing/04-review-system.md)`，不写「见阶段四某节」——模型跟链接跳，不跟模糊引用 |

**修改 SOP 时的自检三问**：
1. 新内容是**规则**（长期有效）还是**考古**（一次性叙事）？后者进 changelog 不进 SOP
2. 加了这个步骤，步骤表同步加行加勾选格了吗？机器锚的阶段流转（next 指向）变了吗？
3. 一个从没读过本 SOP 的模型，只读这一个文件能执行完本阶段吗？（答不能 = 缺前置依赖说明）

## Release Note 三层分工速查

> 完整规则见 [06 铁律 N1-N7](./releasing/06-doc-finalize.md) + [09 Title/Body 规范](./releasing/09-publish.md)。本节是速查——写 note 前先看这页。

| 层 | 形态 | 示例 |
|:--|:--|:--|
| **Release title** | `vX.Y.Z — {名词化主题短语带 emoji}`（≤3 个，不逐项罗列交付名） | vX.Y.Z — 🧬 自进化与运维闭环触手可及 |
| **Body 首行定位句** | `{emoji 主题短语呼应 title}——{一句人话价值}`；禁止旧 title 清单复读 | 🧬 自进化与运维闭环触手可及——Agent 摸得到进化的方向盘和回退的安全绳，四条 MCP 工具补上最后一块。 |
| **changelog H1** | `vX.Y.Z 开发日志 — {动词化故事句}`（主语+变化/动作+括号内涵，无 emoji） | vX.Y.Z 开发日志 — 自进化与运维闭环触手可及（MCP 四 tool + 依赖安全升级 + 38 项加固） |

**三层刻意不同**：title 点主题 / 定位句说人话 / H1 讲故事。交付名逐项罗列只出现在 note 新功能段。**改 title 必须连带检查 body 首行**——曾出现 title 更新、body 首行漏跟的漂移。

## 配套文档

- [ROADMAP 同步手册](./releasing/06-doc-finalize.md)——阶段六「步骤五」配套：本版移出规划表 / 探索方向清理 / 迭代表瘦身 / 发版后体检清单
- [审查体系指南](../guides/review-system.md)——A/B/C 清单 / 模式提取 / 防膨胀 / 校准逻辑
- [playbook/version-bump.md](../../playbook/version-bump.md)——bump 详细指南（13 类位置 + package-lock 同步）
- [playbook/doc-sync.md](../../playbook/doc-sync.md)——文档同步详细指南（LIMITATIONS 覆盖 + D6 闭环）
