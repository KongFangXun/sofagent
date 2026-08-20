# sofagent 版本开发 SOP

> 从「上一版发布完」到「下一版发布完」的完整操作手册。十二个阶段，每阶段一个独立文件。
>
> **防止 lost-in-the-middle**：每次执行时**先读下方进度追踪确认当前阶段**，然后只读当前阶段的独立文件——不要一次性读全文。

---

## 进度追踪

> 每次新 session 或新阶段开始时，先读这 12 行确认进度。打勾的 = 已完成，第一个未打勾的 = 当前要做。

- [ ] 一 · 审查上版本（fresh-eyes-loop 自动化审查循环 · 新 session）→ [01-review.md](./releasing/01-review.md) · **v1.3.5：四份 16 视角独立审查 38 项 bugfix（影子审计器/门禁假绿/泄漏清理）** · **v1.3.7：四轮 16 视角独立审查（3 轮手动 + 1 轮团队协作）→ 26 项 bugfix prompt v3 全数修复（4 P0：verify-commit 洗白链/verify.sh 安装断链/daemon 路径断链/test-count 三态薛定谔；另根治红队四项：verify-chain 追加伪造判篡改 + A2 二进制 WARN + A9 伪造签名 + 验签 fail-closed）+ 复检 PASS + 遗留 3 项闭环** · **v1.3.8：四份报告审查上版（3 轮 16 视角 + 1 轮团队并行）→ V1.3.8-bugfix-prompt 4P0+28P1 全修（安装链三重修复/A1 后缀/A2 FFFD/声称断裂改声称）+ 零信任复验通过**
- [ ] 二 · 开发 → [02-dev.md](./releasing/02-dev.md) · **v1.3.5：10 大块（MCP 四 tool 自进化运维闭环 + instinct→skill + FDE 五件 + DSH 互通 + vitest/automerge 依赖升级）** · **v1.3.7：9 项交付（⑦自适应并发/①沙箱五件套/②场景权限/③AgentShield/④行业 overlay/⑤断路器/⑥ontology lifecycle+OKF/⑨memory-sync 通用化 完成 + ⑧TDAI 触发器按设计零动作）· 49 项验收全 [x] · 测试 2535→2655 · 复检 PASS** · **v1.3.8：9 交付全完成（网关/age加密/WAL/长任务/保活三件套/SDK sandbox/judgment-only 瘦身/fresh-eyes 计量/快照加固）· 寇豆码 A-D 四人分工（A 配额中断 D 接手）· 测试 2672→2782 · 零信任检查 14 项验收亲验通过 · 双实例环境债根治（1236 编译产物）**
- [ ] 三 · 基础自测 → [03-selftest.md](./releasing/03-selftest.md) · **v1.3.5：bump 1.3.4→1.3.5 + test 2286/2286 + CV 72/72 + CTC 双口径 + postbuild 三包权限根治** · **v1.3.7：bump 1.3.6→1.3.7（hooks 头/action.yml/root devDep/4 文档头手动补漏 + npm install 刷 lock）+ build 0 错 + 2655 全绿 + CV 71/71 + CTC OK + deps 全最新 + dist 基准重置（--doctor --reset-baseline）** · **v1.3.8：bump 1.3.7→1.3.8（253 处 + 手动补漏 6 处：hooks 头×2/AGENTS/evidence/LIMITATIONS/action.yml 含注释号）+ changelog 状态行转已开发 + CHANGELOG 索引行 + 文档头日期 08-20 批量 + 集成点/age 豁免声明 + build 0 错 + 2782 全绿 + CV 71/71 + dist 基准重置**
- [ ] 四 · fresh-eyes-loop 质量循环 + 代码审核 + 验收测试（新 session）→ [04-quality-loop.md](./releasing/04-quality-loop.md) · **v1.3.5：run-07（R1 完整闭环 + P0=0 + 四份审查收敛）+ acceptance S270-S281（209→214 场景，291 断言）** · **v1.3.7：run-27/28 双 abort（沙箱回收）但 24 视角资产完整落盘——主 session 零信任复验 15 finding（2 真修复：rm -rf 正则口径统一 + VALIDATION 零依赖矛盾 / 2 中间态 SKIP / 5 假阳性 / 6 观察）+ acceptance S290-S292（302/302）+ checklist 维度 115/116（89 维）；loop 无 verdict，阶段六 release-gate 仍须完整 PASS**
- [ ] 五 · 审查体系合并更新 → [05-review-system.md](./releasing/05-review-system.md) · **v1.3.5：维度 110/111 + 93→70 归并 + check-version 四盲区 69/75/77→95 + checklist 瘦身回 1500** · **v1.3.7：116 扩 3 子项+S293（三死实录）+ fresh-eyes-review +1 教训（400 压线）+ README 双语新能力段 v1.3.7；冻结条款触发→压缩 v1.3.6 判据注释真实归并未上调；顺修 BSD grep 嵌套计数 ×2；S146 深夜挂起根因根治（scenario() cwd 漂移→registry 拉远端 vitest，显式 cd 回主仓——同一深夜窗口 303/303 全绿实锤；推翻"环境态"初判）** · **v1.3.8：A16/B3/C7 分发（#117 网关攻击面四项 + #118 原子写单writer 归并）+ S303/S304 bugfix 防回归补齐（A1 后缀绕过/A2 FFFD 端到端，acceptance 314/314）+ 无法归类 7 项逐项定夺 + README 双语 v1.3.8 新能力段 + 草稿产物迁桌面（SOP/工具默认值 6 处）**
- [ ] 六 · release-gate-loop 发版闸门（新 session · 必须 PASS 才继续）→ [06-release-gate.md](./releasing/06-release-gate.md) · **v1.3.5：run-01 假 PASS 根治（driver 收敛判定改保守）→ run-07 四失败项 → run-08 手工裁决 PASS（86 维 0 FAIL）** · **v1.3.7：run-01/04 两轮 loop FAIL 零信任复验全部改判检查器侧债（dim106 SSOT 漏跟/dim116 awk 转义炸/跳号误报/coverage worker 偶发）已修 → 主 session 手工裁决 PASS：regression 89/89 全绿（driver 同款语义亲跑）+ coverage 12 关键词矩阵全命中 + acceptance 303/303 EXIT=0** · **v1.3.8：run-03 环境崩溃（运行窗口 HEAD 漂移 8 次/OOM，零信任复验定谳）→ run-06/10 driver 两修复（judgment-only 注入 acceptance 结果/紧凑格式写盘防截断）→ run-13 verdict=PASS（regression 91 维 86PASS/0FAIL + coverage 9 覆盖 + acceptance 314/314 实证）· 三 ⚠️（dim49/94/101）复验全为检查器侧已修**
- [ ] 七 · 审查体系最终确认 → [07-final-confirm.md](./releasing/07-final-confirm.md) · **v1.3.5：三文档闭环核对（86 维 ↔ 214 场景 ↔ 5 方向）+ acceptance 线上调撤销改瘦身回 2500** · **v1.3.7：CRS 5 FAIL 全修（87→89 维/scenario 计数口径 [a-z]? 对齐/自校验警戒线同步）→ CRS=0；89 维↔226 场景↔16 视角闭环确认** · **v1.3.8：CRS 13/13 全绿 + 三文档闭环（维度 117/118 → S294-S304 → fresh-eyes 5 方向）**
- [ ] 八 · 开发日志定稿 + 文档收尾 → [08-doc-finalize.md](./releasing/08-doc-finalize.md) · **v1.3.5：定稿（速览表 10 项 + Release Notes 三段式含破坏性变更 4 条）+ ROADMAP 五步 + 日期 15 文件** · **v1.3.7：发布检查清单段补全（fresh-eyes 三连/手工裁决如实记录）+ ROADMAP 三处 + WIKI 状态表 + HANDBOOK 三处 + A 层预算 6510→6530** · **v1.3.8：发布检查清单全勾 + Release Notes（9 新功能/破坏性变更 3 条）+ 三件套版本同步 + ROADMAP 交付即移出（清 v1.3.7/v1.3.8 规划行）+ SECURITY/LIMITATIONS age 措辞改已落地**
- [ ] 九 · 工具脚本健康检查 → [09-tool-health.md](./releasing/09-tool-health.md) · **v1.3.5：新增文件排查 + bump dry-run 纯只读 + 死路径修正（维度57 ab-test/data）+ hook 端到端实测** · **v1.3.7：CTH 6 项全过 + bump dry-run 零改动 + build dist v1.3.7 + hook 双测（拦截+放行）+ CJK 15 脚本绿** · **v1.3.8：tool-health 6 项绿 + hook 端到端实测双态（SECRET=WARN 放行 / AKIA FAIL 拦截）+ CJK 定界 1 修 + bump dry-run 只读复核**
- [ ] 十 · 确认关口 → [10-confirm.md](./releasing/10-confirm.md) · **v1.3.5：481 文件 31 commit 复核 + 发布清单 22 勾 2 留 rc + 门禁全绿** · **v1.3.8：92 commits/329 文件复核（五组分类）+ 发布检查清单 11 勾 + CI 本地模拟 + Release Notes N1-N7 双检查全绿 → 发布 prompt 交接（10-confirm 补防漂移铁律：gh release 段必须逐字引用 SOP 11 工序模板）**
- [ ] 十一 · 发布（项目负责人或授权 AI）→ [11-publish.md](./releasing/11-publish.md) · **v1.3.5：Git Data API 绕行 push（死代理）→ CI 全绿 → tag → Release（三段式标准化）→ npm 13/13 包（load-chain 补 4 版）→ Skill 双分发** · **v1.3.6：新增「安装入口随版同步」步骤（现步骤五）（bootstrap.sh INSTALL_URL + README 双语安装段三处 bump + curl 实测 200，根治 v1.3.5 tag 漂移断链）** · **v1.3.7：剥代理直连 push（Git Data API 绕行更简解）+ CI 7/7 轮询全绿（shellcheck runner apt stall 取消重跑一次）+ Release Note 三道工序（自检脚本+与 v1.3.6 骨架同构）+ 13/13 包 npm 全 1.3.7 + ClawHub/SkillHub 双分发；坑位：「安装入口先于 tag」的铁律本次执行顺序反了（先 tag 后安装入口）→ forced update tag + release 重建修正**
- [ ] 十二 · 发布后（验证 + 三文档回写 + SOP 自迭代 + 下版 prompt）→ [12-post-publish.md](./releasing/12-post-publish.md)

> **铁律**：阶段六 verdict=PASS 前，不进阶段七~八。FAIL 回阶段五修复后重跑。
>
> **自迭代**：阶段十二「步骤十」是 releasing.md 的「Dream Cycle」——每次发版后用实际执行体验审查 SOP 自己（顺序一致/引用断裂/缺口吸收/冗余清理），持续进化。这是活文档的自我维护机制，不是一次性动作。

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

- [ROADMAP 同步规则](./releasing/08-roadmap-sync.md)——阶段八「步骤五」配套：本版移出规划表 / 探索方向清理 / 迭代表瘦身 / 发版后体检清单
- [审查体系指南](../guides/review-system.md)——A/B/C 清单 / 模式提取 / 防膨胀 / 校准逻辑
- [FORGE/playbook/version-bump.md](../../FORGE/playbook/version-bump.md)——bump 详细指南（13 类位置 + package-lock 同步）
- [FORGE/playbook/doc-sync.md](../../FORGE/playbook/doc-sync.md)——文档同步详细指南（LIMITATIONS 覆盖 + D6 闭环）
