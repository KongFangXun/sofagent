// sofagent load-chain hook · OpenClaw 2026.6.x
// 注入三层加载链到 agent:bootstrap：
//   L1 core-rules.md（核心铁律 ~30 行，始终注入）+ 按 task type 追加岗位规范（v1.3.0 渐进式加载）
//   L2 think.md（反思区）
//   L3 fde.md（用户规则）
// 由 DeepSeek V4 Pro 和 GLM-5.2 配合生成。
//
// v1.3.0 渐进式加载改造：
//   L1 从"注入完整 SKILL.md（149 行）"改为"注入 core-rules.md（~30 行核心铁律）"
//   + 根据 event.context 中的 task description 判断 task type
//   + 按需追加注入对应岗位规范文件（role-audit.md / role-fde.md / role-orchestrate.md）
//   L2/L3 的 think.md 和 fde.md 注入逻辑原样保留
//
// fde.md 路径优先级（v0.73 扁平化）：
//   1. skills/sofagent/fde.md（install.sh 部署目标，权威路径）
//   2. skills/sofagent/constitution/fde.md（兼容 v0.72 前老安装，fallback）
//   3. openclawDir/fde.md（兼容 v0.70 前老安装，已降级为 fallback）
import * as fs from "node:fs";
import * as path from "node:path";

export interface LoadChainEvent {
  type?: string;
  action?: string;
  workspaceRoot: string;
  context: {
    bootstrapFiles: Array<{
      name: string;
      path: string;
      content: string;
    }>;
    /** task description / agent bootstrap 信息（用于渐进式加载 task type 判定） */
    taskDescription?: string;
    [key: string]: unknown;
  };
}

/**
 * v1.2.7: task type 判定——轻量关键词匹配（非 LLM 调用）
 * @returns 'audit' | 'deploy' | 'orchestrate' | 'general'
 */
function detectTaskType(event: LoadChainEvent): 'audit' | 'deploy' | 'orchestrate' | 'general' {
  // 从 event.context 中提取任务描述文本（兼容多种字段名）
  const sources = [
    event.context.taskDescription,
    (event.context as Record<string, unknown>).task as string,
    (event.context as Record<string, unknown>).prompt as string,
    (event.context as Record<string, unknown>).userInput as string,
  ].filter((s): s is string => typeof s === 'string' && s.length > 0);

  const text = sources.join(' ').toLowerCase();

  // 关键词匹配（按优先级）
  if (/审计|audit|检查|巡检|inspect|doctor|verify/.test(text)) return 'audit';
  if (/部署|install|activate|fde|进场|交付|deploy/.test(text)) return 'deploy';
  if (/编排|compose|workflow|orchestrat|loop/.test(text)) return 'orchestrate';

  return 'general';
}

/**
 * v1.2.7: 按 task type 解析需要追加注入的岗位规范文件
 */
function resolveRoleFile(taskType: 'audit' | 'deploy' | 'orchestrate' | 'general'): string | null {
  switch (taskType) {
    case 'audit': return 'role-audit.md';
    case 'deploy': return 'role-fde.md';
    case 'orchestrate': return 'role-orchestrate.md';
    default: return null; // general 不额外注入
  }
}

const handler = async (event: LoadChainEvent) => {
  try {
    if (event.type !== "agent" || event.action !== "bootstrap") {
      return;
    }

    const home =
      process.env.HOME ||
      process.env.USERPROFILE ||
      (process.platform === "win32" ? "C:\\Users\\Default" : "/tmp");
    const openclawDir =
      process.env.OPENCLAW_STATE_DIR || path.join(home, ".openclaw");
    const sofagentSkillDir = path.join(openclawDir, "skills", "sofagent");
    const pushed: string[] = [];

    // ── 第 1 层：核心铁律（core-rules.md ~30 行，始终注入）+ 按需岗位规范 ──
    // v1.2.7: 从"注入完整 SKILL.md（149 行）"改为"注入 core-rules.md（~30 行核心铁律）"
    const coreRulesFile = path.join(sofagentSkillDir, "core-rules.md");
    if (fs.existsSync(coreRulesFile)) {
      const content = fs.readFileSync(coreRulesFile, "utf-8");
      event.context.bootstrapFiles.push({
        name: "sofagent-core-rules.md",
        path: coreRulesFile,
        content: `<!-- ===== sofagent 第 1 层：核心铁律（core-rules.md）===== -->\n${content}`,
      });
      pushed.push("core-rules.md");
    } else {
      // 兼容旧安装：core-rules.md 不存在时 fallback 到 SKILL.md 全文
      const skillMdFile = path.join(sofagentSkillDir, "SKILL.md");
      if (fs.existsSync(skillMdFile)) {
        const content = fs.readFileSync(skillMdFile, "utf-8");
        event.context.bootstrapFiles.push({
          name: "sofagent-SKILL.md",
          path: skillMdFile,
          content: `<!-- ===== sofagent 第 1 层：宪法（SKILL.md · 兼容旧安装）===== -->\n${content}`,
        });
        pushed.push("SKILL.md(legacy)");
      }
    }

    // v1.2.7: 按 task type 追加注入岗位规范
    const taskType = detectTaskType(event);
    const roleFile = resolveRoleFile(taskType);
    if (roleFile) {
      const rolePath = path.join(sofagentSkillDir, roleFile);
      if (fs.existsSync(rolePath)) {
        const roleContent = fs.readFileSync(rolePath, "utf-8");
        event.context.bootstrapFiles.push({
          name: `sofagent-${roleFile}`,
          path: rolePath,
          content: `<!-- ===== sofagent 第 1 层（按需）：${roleFile}（task type=${taskType}）===== -->\n${roleContent}`,
        });
        pushed.push(roleFile);
      }
    }

    // ── 第 2 层：反思区（think.md）──
    // v1.2.1 安装路径分离后，think.md 权威位置 = SOFAGENT_HOME/data/think.md
    // （对齐 core/data-paths.ts 的 THINK_MD）。install.sh 不导出 SOFAGENT_DATA，
    // 旧 fallback 到 cwd/.sofagent/think.md 会落到不存在的 cwd 路径，第 2 层静默失效。
    // 解析优先级：SOFAGENT_DATA（显式）→ SOFAGENT_HOME/data → ~/.sofagent/data。
    const sofagentHome =
      process.env.SOFAGENT_HOME || path.join(home, ".sofagent");
    const sofagentData =
      process.env.SOFAGENT_DATA || path.join(sofagentHome, "data");
    const thinkFile = path.join(sofagentData, "think.md");
    if (fs.existsSync(thinkFile)) {
      let content = fs.readFileSync(thinkFile, "utf-8");
      // [LLM自评] 条目降权——在每个自评标记后追加提醒（不写回原文件，保持原文件干净）
      // 用非贪婪 + 全局匹配，覆盖同行及跨行的多个自评标记，避免贪婪吞掉整段内容。
      content = content.replace(
        /(\[LLM自评[^\]]*\])/g,
        "$1（⚠️ 权重×0.3，LLM自评未经外部验证，仅供参考）",
      );
      event.context.bootstrapFiles.push({
        name: "sofagent-think.md",
        path: thinkFile,
        content: `<!-- ===== sofagent 第 2 层：反思区（think.md）===== -->\n${content}`,
      });
      pushed.push("think.md");
    }

    // ── 第 3 层：用户规则（fde.md）──
    // 优先读 install.sh 部署的扁平化路径（权威路径）
    // fallback 读旧 constitution 路径（兼容 v0.72 前老安装）
    // 最后 fallback 读旧路径 openclawDir/fde.md（兼容 v0.70 前老安装）
    const rulesCandidates = [
      path.join(openclawDir, "skills", "sofagent", "fde.md"),
      path.join(openclawDir, "skills", "sofagent", "constitution", "fde.md"),
      path.join(openclawDir, "fde.md"),
    ];
    let rulesFile = "";
    for (const candidate of rulesCandidates) {
      if (fs.existsSync(candidate)) {
        rulesFile = candidate;
        break;
      } else {
        console.log(`[sofagent-load-chain] fde.md 未找到: ${candidate}`);
      }
    }
    if (rulesFile) {
      const content = fs.readFileSync(rulesFile, "utf-8");
      event.context.bootstrapFiles.push({
        name: "sofagent-fde.md",
        path: rulesFile,
        content: `<!-- ===== sofagent 第 3 层：用户规则（fde.md）===== -->\n${content}`,
      });
      pushed.push("fde.md");
    }

    if (pushed.length > 0) {
      console.log(
        `[sofagent-load-chain] injected: ${pushed.join(", ")} (layer 2-3)`,
      );
    }
  } catch (err) {
    console.error("[sofagent] hook 加载失败", err);
    throw err;
  }
};

export default handler;
