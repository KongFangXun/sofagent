# sofagent 版本开发 SOP

> 从「上一版发布完」到「下一版发布完」的完整操作手册。十二个阶段，每阶段一个独立文件。
>
> **防止 lost-in-the-middle**：每次执行时**先读下方进度追踪确认当前阶段**，然后只读当前阶段的独立文件——不要一次性读全文。

---

## 进度追踪

> 每次新 session 或新阶段开始时，先读这 12 行确认进度。打勾的 = 已完成，第一个未打勾的 = 当前要做。

- [x] 一 · 审查上版本（fresh-eyes-loop 自动化审查循环 · 新 session）→ [01-review.md](./releasing/01-review.md) · 四轮独立审查 + bugfix prompt
- [x] 二 · 开发 → [02-dev.md](./releasing/02-dev.md) · 6 大交付块全部完成
- [x] 三 · 基础自测 → [03-selftest.md](./releasing/03-selftest.md) · build EXIT=0 + test 2100/2100
- [x] 四 · fresh-eyes-loop 质量循环 + 代码审核 + 验收测试（新 session）→ [04-quality-loop.md](./releasing/04-quality-loop.md) · **v1.3.3 跳过 fresh-eyes-loop（项目负责人决定，下版恢复）；代码审核由项目负责人零信任复核完成**
- [x] 五 · 审查体系合并更新 → [05-review-system.md](./releasing/05-review-system.md) · regression-checklist / acceptance-test / fresh-eyes-review 已更新
- [x] 六 · release-gate-loop 发版闸门（新 session · 必须 PASS 才继续）→ [06-release-gate.md](./releasing/06-release-gate.md) · run-01 FAIL→修复→**run-04 verdict=PASS 三项全绿** · 7 项人工复核全部确认（维度 98/99 实测已修，96 一致，49/56/59/90 脚本健壮性不阻断）
- [x] 七 · 审查体系最终确认 → [07-final-confirm.md](./releasing/07-final-confirm.md) · regression 补维度 98-100 + fresh-eyes 补 v1.3.3 经验 + 警戒线上调（1400/2400/400）
- [ ] 八 · 开发日志定稿 + 文档收尾 → [08-doc-finalize.md](./releasing/08-doc-finalize.md)
- [ ] 九 · 工具脚本健康检查 → [09-tool-health.md](./releasing/09-tool-health.md)
- [ ] 十 · 确认关口 → [10-confirm.md](./releasing/10-confirm.md)
- [ ] 十一 · 发布（项目负责人或授权 AI）→ [11-publish.md](./releasing/11-publish.md)
- [ ] 十二 · 发布后（验证 + 三文档回写 + SOP 自迭代 + 下版 prompt）→ [12-post-publish.md](./releasing/12-post-publish.md)

> **铁律**：阶段六 verdict=PASS 前，不进阶段七~八。FAIL 回阶段五修复后重跑。
>
> **自迭代**：阶段十二步骤 10 是 releasing.md 的「Dream Cycle」——每次发版后用实际执行体验审查 SOP 自己（顺序一致/引用断裂/缺口吸收/冗余清理），持续进化。这是活文档的自我维护机制，不是一次性动作。

---

## 配套文档

- [审查体系指南](../guides/review-system.md)——A/B/C 清单 / 模式提取 / 防膨胀 / 校准逻辑
- [FORGE/playbook/version-bump.md](../../FORGE/playbook/version-bump.md)——bump 详细指南（13 类位置 + package-lock 同步）
- [FORGE/playbook/doc-sync.md](../../FORGE/playbook/doc-sync.md)——文档同步详细指南（LIMITATIONS 覆盖 + D6 闭环）
