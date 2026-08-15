# sofagent 版本开发 SOP

> 从「上一版发布完」到「下一版发布完」的完整操作手册。十二个阶段，每阶段一个独立文件。
>
> **防止 lost-in-the-middle**：每次执行时**先读下方进度追踪确认当前阶段**，然后只读当前阶段的独立文件——不要一次性读全文。

---

## 进度追踪

> 每次新 session 或新阶段开始时，先读这 12 行确认进度。打勾的 = 已完成，第一个未打勾的 = 当前要做。

- [ ] 一 · 审查上版本（fresh-eyes-loop 自动化审查循环 · 新 session）→ [01-review.md](./releasing/01-review.md) · **v1.3.4：4 轮独立审查（3 单人 + 1 团队 16 视角）+ bugfix prompt 整合 48 项问题**
- [ ] 二 · 开发 → [02-dev.md](./releasing/02-dev.md) · **v1.3.4：bugfix 34 commit + dev 10 commit + dsh 2 commit（L3 市场 + SkillScan + 评估三步 + 编排层分离）**
- [ ] 三 · 基础自测 → [03-selftest.md](./releasing/03-selftest.md) · **v1.3.4：bump 1.3.3→1.3.4 + changelog 转正 + build EXIT=0 + test 2235/2235 + check-version 71/71 + check-test-count 14/14 + check-anchors 88/88**
- [ ] 四 · fresh-eyes-loop 质量循环 + 代码审核 + 验收测试（新 session）→ [04-quality-loop.md](./releasing/04-quality-loop.md) · **v1.3.4：run-01（臆造回滚+13 finding 终局判定）+ run-02（新防护 driver，20 finding 全实测证据，P0 vitest 排 v1.3.5）+ acceptance S263-S269 新增（195→202 场景，279 断言）**
- [ ] 五 · 审查体系合并更新 → [05-review-system.md](./releasing/05-review-system.md) · **v1.3.4：维度 102-106（A 类市场/SkillScan/MARKET + B 类臆造链/测试数同步）+ 覆盖率 18 关键词零遗漏 + README 新能力段换版**
- [ ] 六 · release-gate-loop 发版闸门（新 session · 必须 PASS 才继续）→ [06-release-gate.md](./releasing/06-release-gate.md) · **v1.3.4：run-01 FAIL（3 真 + 5 误报甄别修复，commit 56a08d0c）→ run-04 PASS（83 维 0 FAIL / acceptance 279 / coverage 0 高风险）**
- [ ] 七 · 审查体系最终确认 → [07-final-confirm.md](./releasing/07-final-confirm.md) · **v1.3.4：三文档闭环核对（83 维 ↔ 202 场景 ↔ 5 方向）+ 维度 56 补 v1.3.4 教训**
- [ ] 八 · 开发日志定稿 + 文档收尾 → [08-doc-finalize.md](./releasing/08-doc-finalize.md) · **v1.3.4：定稿（速览表+39 项打勾+Release Notes）+ ROADMAP 五步 + 日期 14 文件 + HANDBOOK 能力表**
- [ ] 九 · 工具脚本健康检查 → [09-tool-health.md](./releasing/09-tool-health.md) · **v1.3.4：7 文件类型排查 + bump dry-run 纯只读 + dist v1.3.4 + hook 三测全过（拦密钥/放合格/短 message 拦）**
- [ ] 十 · 确认关口 → [10-confirm.md](./releasing/10-confirm.md) · **v1.3.4：469 文件 71 commit 全量复核 + 发布清单 39/39 勾 + 五门禁终验全绿**
- [ ] 十一 · 发布（项目负责人或授权 AI）→ [11-publish.md](./releasing/11-publish.md) · **v1.3.4：push（71 commit）→ CI 8/8 全绿 → tag 零游离 → GitHub Release（质量表 7 项）→ npm 12/12 包 1.3.4 → ClawHub + SkillHub 双分发**
- [ ] 十二 · 发布后（验证 + 三文档回写 + SOP 自迭代 + 下版 prompt）→ [12-post-publish.md](./releasing/12-post-publish.md)

> **铁律**：阶段六 verdict=PASS 前，不进阶段七~八。FAIL 回阶段五修复后重跑。
>
> **自迭代**：阶段十二步骤 10 是 releasing.md 的「Dream Cycle」——每次发版后用实际执行体验审查 SOP 自己（顺序一致/引用断裂/缺口吸收/冗余清理），持续进化。这是活文档的自我维护机制，不是一次性动作。

---

## 配套文档

- [ROADMAP 同步规则](./releasing/08-roadmap-sync.md)——阶段八步骤 5 配套：本版移出规划表 / 探索方向清理 / 迭代表瘦身 / 发版后体检清单
- [审查体系指南](../guides/review-system.md)——A/B/C 清单 / 模式提取 / 防膨胀 / 校准逻辑
- [FORGE/playbook/version-bump.md](../../FORGE/playbook/version-bump.md)——bump 详细指南（13 类位置 + package-lock 同步）
- [FORGE/playbook/doc-sync.md](../../FORGE/playbook/doc-sync.md)——文档同步详细指南（LIMITATIONS 覆盖 + D6 闭环）
