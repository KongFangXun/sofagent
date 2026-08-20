// ─── 角色到模型的映射（换模型只改这里）─────────────────────────
// 切换模型：把 import 的模型变量改掉即可，不需要改 driver 代码。
// API key 会自动跟着模型走——每个模型文件标注了自己用哪个厂商的 key 变量。
//
// 角色说明：
//   A = 审查者（fresh-eyes-loop，需要最强推理）
//   B = 工程师（fresh-eyes-loop，侧重代码修复）
//   V = 验证者（release-gate-loop，跑测试+裁决）
//   F = 修复者（release-gate-loop v1.2.8，V FAIL 后读 verdict → 改代码 → 跑 audit）
//
// key 映射（自动）：
//   qwen3.8-max       → QWEN_API_KEY（env.local.template 里配）
//   glm-5.2           → GLM_API_KEY
//   deepseek-v4-pro   → DEEPSEEK_API_KEY
//   deepseek-v4-flash → DEEPSEEK_API_KEY（与 Pro 共用）
//
// role 字段决定 agentSkillPath 和 toolsKey：
//   'reviewer'  → reviewer/SKILL.md + REVIEWER_TOOLS
//   'engineer'  → engineer/SKILL.md + ENGINEER_TOOLS

import deepseekV4Flash from './deepseek-v4-flash.mjs';

export default {
  // v1.3.9 起：A/B/V/F 统一切到 deepseek-v4-flash（DeepSeek API，按量计费，低成本档）。
  // 双盲审查独立性仍通过 A/B 不同 prompt 视角保证（a-check.md ≠ b-check.md），不依赖不同模型。
  // 历史注记（勿删）：run-07 验证 Qwen3.8-max 在工具循环里无法被 stateModifier 约束
  // （thinking-only 模型在工具循环中停不下来）→ 改回 GLM-5.2；GLM-5.2 在审查步骤调 60+ 次工具不收敛、靠软熔断兜底。
  // 现切 V4 Flash 需重点观察：重型循环（16 视角 × 多轮）收敛性、以及按量计费下的成本。
  A: { model: deepseekV4Flash, role: 'reviewer' },  // 审查者：deepseek-v4-flash → DEEPSEEK_API_KEY
  B: { model: deepseekV4Flash, role: 'engineer' },  // 工程师：deepseek-v4-flash → DEEPSEEK_API_KEY
  V: { model: deepseekV4Flash, role: 'reviewer' },  // 验证者：deepseek-v4-flash → DEEPSEEK_API_KEY（与 B 共用，key 跟模型走自动一致）
  F: { model: deepseekV4Flash, role: 'engineer' },  // v1.2.8 修复者：deepseek-v4-flash → DEEPSEEK_API_KEY（与 B 共用 ENGINEER_TOOLS）
};
