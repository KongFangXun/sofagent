# A/B/C 审查清单草稿 v1.5.8

> 生成方式：gen-abc-draft.mjs LLM 端点超时 → `.prompt.md` 降级 → 主 session 直接执行（素材 = 阶段三零信任三定性第一手结论；来源：fresh-eyes-draft-v1.5.8.md / v1.5.8-bugfix-report.md / docs/changelog/v1.5/v1.5.8.md）。

## A 类 · 回归维度候选（regression-checklist）

- [A1] **验收已勾但能力未接线**防复发——新增 `@public` 导出符号（或新判定函数）须先 `grep` 生产调用点 ≥1 才许勾验收条（judgeAdmission 案：符号在位、根 barrel 已导出、`optimize()` 零调用，验收照勾）。｜归属：并入 #130（发版流程域，验收纪律子项）。｜来源：阶段三 P0（草稿视角7-1 / 修复 9e24204b0）
- [A2] **acceptance 计数锚随能力变更升锚须同批注记依据**——行为锁钉死的计数（barrel 等价 N、场景数、规则数）被后续版本有意变更打破时，锚升与「依据注记」（谁加的、加在哪）必须同 commit（S476 core 308→310 案：BUG-03 有意新增 CURRENT_RULE_KEYS，root=uni 等价性成立）。｜归属：并入 #130（行为锁维护子项）。｜来源：阶段三 acceptance 482/483 唯一红（修复 28c930c67）
- [A3] **安全检查空操作**防复发——声称 fail-closed / 校验的 `if` 分支不得为空块或无动作路径（domain-verifier-registry 只读位案：`if (!(st.mode & 0o222)) { /* 空注释 */ }` 双向无动作）。审查口径：grep 安全关键词附近的分支体。｜归属：并入 #130（或既有安全审查域子项）。｜来源：阶段三 P1（草稿视角2-1 / 修复 43c6c2909-1）
- [A4] **文案不得复写单一来源数字**——凡声明「单一来源」的数值（severityWeightOf 权重、规则数、测试数）不得在 reason/basis/注释文案里硬编码第二份（reward-shaping basis 含 `critical=1.0/...` 案）。｜归属：并入 #130（数字纪律子项）。｜来源：阶段三 P1（草稿视角3-1 / 修复 43c6c2909-2）
- [A5] **devlog 同文件两表口径必须一致**——章交付表与涉及文件表对同一交付物的表述不得一旧一新并存（章三「第五种数据源」vs「旁挂适配器」案）。｜归属：并入 #130（文档一致性子项）。｜来源：阶段三 P2（草稿视角10-1 / 修复 53228f61e）
- [A6] **复验禁用旧提取快照**——从大文件（acceptance-test.sh）提取断言脚本复跑时必须按当前文件重提取（S476 修复后复跑旧 `/tmp/s476.js` 一度假红）。｜归属：并入 #130（复验纪律子项）。｜来源：阶段三执行实录

## B 类 · acceptance 场景候选

> ⚠️ 本版 acceptance 行数上限已满（4611/4611，error 级 checklist-acceptance-lines 守护）——**B 类全部顺延 v1.5.9**，随上限重估（「新上限=落位后实测+≥1 余量」）后落位。

- [B1] **准入门接线行为锁**——`optimize()` 无登记表 → skipReason 含「准入登记表不可用」（fail-closed）；登记 human-only 域达触发阈值 → skipReason 含「准入门阻断」且 triggered=false；deterministic 域 → 正常进主流程。｜断言：node 构造 tmp dataDir + 三档登记表跑 optimize 断言 skipReason/triggered。｜来源：P0 修复 9e24204b0（evolve 单测已锁，acceptance 场景补端到端面）。｜顺延 v1.5.9
- [B2] **只读位 fail-closed 锁**——chmod 0o644（内容与哈希不动）后 loadRegistry 必须 ok=false 且 reason 含「写权限位」。｜断言：node tmp 目录 initialize→chmod→load。｜来源：43c6c2909-1（单测已锁 23/23，场景补防回潮面）。｜顺延 v1.5.9
- [B3] **reward basis 无硬编码数字锁**——reward-shaping 产物 basis 字段不含 `critical=1.0` 类权重字样。｜断言：grep 源文件 reason 模板。｜来源：43c6c2909-2。｜顺延 v1.5.9

## C 类 · fresh-eyes 校准候选（calibration 笔记）

- [C1] 勾选验证看「接线证」不看「存在证」——符号存在 + barrel 导出 ≠ 生产接线；验收条勾选前先 grep 调用点。
- [C2] 保护面审查第一步：看声称校验的分支**体**是否为空——空注释块是最隐蔽的假防线形态（比缺检查更难发现）。
- [C3] 文案里的具体数字是单一来源的漂移面——凡是「以 X 为 SSOT」的数值，第二份出现处（注释/reason/文档）就是未来漂移点。

## 无法归类

- 阶段三误报 3 条（薄挂载行 / 测试数算术 / 版本号中间态）——非缺陷，无归类价值，仅记入校准直觉（C 类已覆盖同型判别）。
- 存疑 2 条（examiner 回调约束 / store 灌池面）——devlog 已声明属 v1.5.9 边界，登记不升级。

---

## 分发处置（步骤二预案）

- **A1-A6 → 全部并入 #130 子项**（零新增维度编号——归并配额 0:0，不触发棘轮）；#130 当前 81 行、regression-checklist 余量 24 行，六条子项按 3-4 行/条约需 20-24 行——**贴余量上限，写入时逐条压缩至 ≤3 行**，超量部分移 calibration/下版。
- **B1-B3 → 顺延 v1.5.9**（本版上限满，任务书已裁定）——落点：devlog「与后续版本的依赖」表补一行。
- **C1-C3 → playbook/fresh-eyes-calibration.md**（校准档案，worker 不加载）。
