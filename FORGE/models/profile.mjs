// ─── 角色到模型的映射（换模型只改这里）─────────────────────────
// 切换模型：把 import 的模型变量改掉即可，不需要改 driver 代码。
// API key 会自动跟着模型走——每个模型文件标注了自己用哪个厂商的 key 变量。
//
// 角色说明：
//   A = 审查者（fresh-eyes-loop，需要最强推理）
//   B = 工程师（fresh-eyes-loop，侧重代码修复）
//   V = 验证者（release-gate-loop，跑测试+裁决）
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

import qwen from './qwen3.8-max.mjs';
import glm from './glm-5.2.mjs';

export default {
  // A 审查者用 Qwen3.8-max（阿里百炼 thinking-only 模型）——与 B 工程师(GLM-5.2)不同厂商，
  // 保持双盲审查的模型独立性。run-06 曾临时改成全 GLM（B 模型自我审查=退步），恢复双模型。
  A: { model: qwen, role: 'reviewer' },  // 审查者：Qwen3.8-max → QWEN_API_KEY
  B: { model: glm, role: 'engineer' },   // 工程师：GLM-5.2 → GLM_API_KEY
  V: { model: glm, role: 'reviewer' },   // 验证者：GLM-5.2 → GLM_API_KEY（与 B 共用，key 跟模型走自动一致）
};
