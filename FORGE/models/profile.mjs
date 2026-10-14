// ─── 角色到模型的映射（换模型只改这里）─────────────────────────
// 切换模型：把 import 的模型变量改掉即可，不需要改 driver 代码。
// API key 会自动跟着模型走——每个模型文件标注了自己用哪个厂商的 key 变量。
//
// 🍴 fork 适配提示：当前全链走 GLM Coding Plan 端点（open.bigmodel.cn），
// 需自备 GLM_API_KEY（env.local.template 里配）。fork 后想换厂商：
// 复制任一模型文件改 baseURL/model/key 变量名，再在下方 import 即可。
//
// 角色说明：
//   A = 审查者（fresh-eyes-loop，需要最强推理）
//   B = 工程师（fresh-eyes-loop，侧重代码修复）
//   C = 验收者（fresh-eyes-loop 单盲改造：独立验收 B 的修复，取代 A 兼任 a-verify）
//   D = 复核者（fresh-eyes-loop 单盲改造：对抗性复核 P0/P1，裁决 CONFIRM/DOWNGRADE/REOPEN）
//   V = 验证者（release-gate-loop，跑测试+裁决）
//   F = 修复者（release-gate-loop v1.2.8，V FAIL 后读 verdict → 改代码 → 跑 audit）
//
// key 映射（自动）：
//   qwen3.8-max       → QWEN_API_KEY（env.local.template 里配）
//   glm-5.3           → GLM_API_KEY
//   glm-5.3-flash     → GLM_API_KEY（与 glm-5.3 共用；当前六角色全用本档）
//   deepseek-v4-pro   → DEEPSEEK_API_KEY
//   deepseek-flash    → DEEPSEEK_API_KEY（与 Pro 共用；即 V4.1-Flash）
//
// role 字段决定 agentSkillPath 和 toolsKey：
//   'reviewer'  → reviewer/SKILL.md + REVIEWER_TOOLS
//   'engineer'  → engineer/SKILL.md + ENGINEER_TOOLS

import glm53 from './glm-5.3.mjs';        // 备胎保留（切回 GLM 时恢复 import glm53flash 即可）
import dsv4flash from './deepseek-v4-flash.mjs';

export default {
  // 🔵 当前口径（2026-10-14 用户拍板）：六角色 A/B/C/D/V/F **统一 deepseek-flash（DeepSeek V4.1-Flash）**
  // ——V4.1 性能更强、价格更便宜（vision 原生 / 2500 并发 / off-peak $0.15 in $0.6 out），
  //    且全链单模型档简化运维；GLM Coding Plan 保留作备胎（端点探活 2026-10-14 实测可用）。
  // ⚠️ 工具预算 PERSPECTIVE_TOOL_SOFT/HARD=50/60 沿用旧 V4-Flash 期调参——V4.1 首轮 run 后
  //    按实际工具调用分布复核（lessons/models.md 记录），调参须有实测依据不预调。
  // 沿革（勿删）：
  // v1.4.2 起：A/B/V/F 统一切到 glm-5.3-flash（用户 2026-08-28 拍板，Coding Plan 额度 3 倍）。
  // 2026-09-05 用户拍板「GLM 流量不够，全切回 V4 Flash」→ 四角色切 deepseek-v4-flash（GLM 实测 429 余额不足）。
  // 2026-09-07 用户拍板「几个 loop 的所有模型切换成 5.3 flash」→ 四角色切回 glm-5.3-flash。
  // 2026-09-12~09-14：release-gate-loop 的 V/F 曾单独切 deepseek-flash（DeepSeek V4.1-Flash 的正式名；
  // V4-Flash 已退役，deepseek-v4-flash 仅作临时兼容别名）；2026-09-14 收回统一 glm-5.3-flash。
  // 2026-10-14：V4.1-Flash 发布（2026-09-10）后全链统一切入（本行）。
  // 双盲审查独立性通过 A/B 不同 prompt 视角保证（a-check.md ≠ b-check.md），不依赖不同模型。
  // 历史注记（勿删）：2026-08-30 晚 flash 端点间歇故障（45s 超时 / 500 code 1234 交替，run-20
  // 全 500 根因），曾临时切 glm-5.3 绕过（cde4ee27），次日凌晨双探确认恢复后切回。
  // run-07 验证 Qwen3.8-max 在工具循环里无法被 stateModifier 约束
  // （thinking-only 模型在工具循环中停不下来）→ 改回 GLM-5.2；GLM-5.2 在审查步骤调 60+ 次工具不收敛、靠软熔断兜底。
  // v1.3.9 曾切 deepseek-v4-flash（按量低成本档），v1.4.1 切 glm-5.3（用户 2026-08-26 拍板）。
  A: { model: dsv4flash, role: 'reviewer' },  // 审查者：deepseek-flash（V4.1-Flash）→ DEEPSEEK_API_KEY
  B: { model: dsv4flash, role: 'engineer' },  // 工程师：deepseek-flash（V4.1-Flash）→ DEEPSEEK_API_KEY
  // 单盲四角色流水线（A审→B修→C验→D复核）：C/D 与 A 同模型档，
  // 独立性靠「不同 worker 进程 + 零上下文 + 不同 prompt」保证，不依赖换模型。
  C: { model: dsv4flash, role: 'reviewer' },  // 验收者：独立验收 B 的修复（每条亲手实测）
  D: { model: dsv4flash, role: 'reviewer' },  // 复核者：对抗裁决 P0/P1（CONFIRM/DOWNGRADE/REOPEN）
  // release-gate-loop 专用：判断层默认「裸 LLM 直连」模式，模型取自本文件的 V/F 配置（走 DSH 桥接时
  // 才转读 ~/.dsh/settings.yaml）——故此处即为 release loop 的模型开关，改此两行不影响 fresh-eyes-loop 的 A/B/C/D。
  V: { model: dsv4flash, role: 'reviewer' },  // 验证者：deepseek-flash（V4.1-Flash）→ DEEPSEEK_API_KEY
  F: { model: dsv4flash, role: 'engineer' },  // 修复者：deepseek-flash（V4.1-Flash）→ DEEPSEEK_API_KEY
};
