# sofagent 版本开发 SOP

> 从「上一版发布完」到「下一版发布完」的完整操作手册。十二个阶段，每阶段一个独立文件。
>
> **防止 lost-in-the-middle**：每次执行时**先读下方进度追踪确认当前阶段**，然后只读当前阶段的独立文件——不要一次性读全文。

---

## 进度追踪

> 每次新 session 或新阶段开始时，先读这 12 行确认进度。打勾的 = 已完成，第一个未打勾的 = 当前要做。

- [x] 一 · 审查上版本（fresh-eyes-loop 自动化审查循环 · 新 session）→ [01-review.md](./releasing/01-review.md) · **v1.3.5：四份 16 视角独立审查 38 项 bugfix（影子审计器/门禁假绿/泄漏清理）**
- [x] 二 · 开发 → [02-dev.md](./releasing/02-dev.md) · **v1.3.5：10 大块（MCP 四 tool 自进化运维闭环 + instinct→skill + FDE 五件 + DSH 互通 + vitest/automerge 依赖升级）**
- [x] 三 · 基础自测 → [03-selftest.md](./releasing/03-selftest.md) · **v1.3.5：bump 1.3.4→1.3.5 + test 2286/2286 + CV 72/72 + CTC 双口径 + postbuild 三包权限根治**
- [x] 四 · fresh-eyes-loop 质量循环 + 代码审核 + 验收测试（新 session）→ [04-quality-loop.md](./releasing/04-quality-loop.md) · **v1.3.5：run-07（R1 完整闭环 + P0=0 + 四份审查收敛）+ acceptance S270-S281（209→214 场景，291 断言）**
- [x] 五 · 审查体系合并更新 → [05-review-system.md](./releasing/05-review-system.md) · **v1.3.5：维度 110/111 + 93→70 归并 + check-version 四盲区 69/75/77→95 + checklist 瘦身回 1500**
- [x] 六 · release-gate-loop 发版闸门（新 session · 必须 PASS 才继续）→ [06-release-gate.md](./releasing/06-release-gate.md) · **v1.3.5：run-01 假 PASS 根治（driver 收敛判定改保守）→ run-07 四失败项 → run-08 手工裁决 PASS（86 维 0 FAIL）**
- [x] 七 · 审查体系最终确认 → [07-final-confirm.md](./releasing/07-final-confirm.md) · **v1.3.5：三文档闭环核对（86 维 ↔ 214 场景 ↔ 5 方向）+ acceptance 线上调撤销改瘦身回 2500**
- [x] 八 · 开发日志定稿 + 文档收尾 → [08-doc-finalize.md](./releasing/08-doc-finalize.md) · **v1.3.5：定稿（速览表 10 项 + Release Notes 三段式含破坏性变更 4 条）+ ROADMAP 五步 + 日期 15 文件**
- [x] 九 · 工具脚本健康检查 → [09-tool-health.md](./releasing/09-tool-health.md) · **v1.3.5：新增文件排查 + bump dry-run 纯只读 + 死路径修正（维度57 ab-test/data）+ hook 端到端实测**
- [x] 十 · 确认关口 → [10-confirm.md](./releasing/10-confirm.md) · **v1.3.5：481 文件 31 commit 复核 + 发布清单 22 勾 2 留 rc + 门禁全绿**
- [ ] 十一 · 发布（项目负责人或授权 AI）→ [11-publish.md](./releasing/11-publish.md) · **v1.3.5：Git Data API 绕行 push（死代理）→ CI 全绿 → tag → Release（三段式标准化）→ npm 13/13 包（load-chain 补 4 版）→ Skill 双分发** · **v1.3.6：新增步骤 4b 安装入口随版同步（bootstrap.sh INSTALL_URL + README 双语安装段三处 bump + curl 实测 200，根治 v1.3.5 tag 漂移断链）**
- [ ] 十二 · 发布后（验证 + 三文档回写 + SOP 自迭代 + 下版 prompt）→ [12-post-publish.md](./releasing/12-post-publish.md)

> **铁律**：阶段六 verdict=PASS 前，不进阶段七~八。FAIL 回阶段五修复后重跑。
>
> **自迭代**：阶段十二步骤 10 是 releasing.md 的「Dream Cycle」——每次发版后用实际执行体验审查 SOP 自己（顺序一致/引用断裂/缺口吸收/冗余清理），持续进化。这是活文档的自我维护机制，不是一次性动作。

---

## Release Note 三层分工速查（v1.3.5 发版定稿 · 2026-08-16）

> 完整规则见 [08 铁律 N1-N7](./releasing/08-doc-finalize.md) + [11 Title/Body 规范](./releasing/11-publish.md)。本节是速查——写 note 前先看这页。

| 层 | 形态 | v1.3.5 示例 |
|:--|:--|:--|
| **Release title** | `vX.Y.Z — {名词化主题短语带 emoji}`（≤3 个，不逐项罗列交付名） | v1.3.5 — 🧬 自进化与运维闭环触手可及 |
| **Body 首行定位句** | `{emoji 主题短语呼应 title}——{一句人话价值}`；禁止旧 title 清单复读 | 🧬 自进化与运维闭环触手可及——Agent 摸得到进化的方向盘和回退的安全绳，四条 MCP 工具补上最后一块。 |
| **changelog H1** | `vX.Y.Z 开发日志 — {动词化故事句}`（主语+变化/动作+括号内涵，无 emoji） | v1.3.5 开发日志 — 自进化与运维闭环触手可及（MCP 四 tool + 依赖安全升级 + 38 项加固） |

**三层刻意不同**：title 点主题 / 定位句说人话 / H1 讲故事。交付名逐项罗列只出现在 note 新功能段。历史教训：v1.3.1-1.3.3 的 body 首行挂旧 title 清单（title 改了 body 没跟）——改 title 必须连带检查 body 首行。

## 配套文档

- [ROADMAP 同步规则](./releasing/08-roadmap-sync.md)——阶段八步骤 5 配套：本版移出规划表 / 探索方向清理 / 迭代表瘦身 / 发版后体检清单
- [审查体系指南](../guides/review-system.md)——A/B/C 清单 / 模式提取 / 防膨胀 / 校准逻辑
- [FORGE/playbook/version-bump.md](../../FORGE/playbook/version-bump.md)——bump 详细指南（13 类位置 + package-lock 同步）
- [FORGE/playbook/doc-sync.md](../../FORGE/playbook/doc-sync.md)——文档同步详细指南（LIMITATIONS 覆盖 + D6 闭环）
