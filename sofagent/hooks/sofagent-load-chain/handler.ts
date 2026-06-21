// sofagent load-chain hook · OpenClaw 2026.6.x
// 注入第 2 层（think.md）+ 第 3 层（rules.md）到 agent bootstrap
// 由 DeepSeek V4 Pro 和 GLM-5.2 配合生成。
//
// rules.md 路径优先级（v0.73 扁平化）：
//   1. skills/sofagent/rules.md（install.sh 部署目标，权威路径）
//   2. skills/sofagent/constitution/rules.md（兼容 v0.72 前老安装，fallback）
//   3. openclawDir/rules.md（兼容 v0.70 前老安装，已降级为 fallback）
import * as fs from "node:fs";
import * as path from "node:path";

const handler = async (event: any) => {
  if (event.type !== "agent" || event.action !== "bootstrap") {
    return;
  }

  const home = process.env.HOME || "/tmp";
  const openclawDir =
    process.env.OPENCLAW_STATE_DIR || path.join(home, ".openclaw");
  const pushed: string[] = [];

  // ── 第 2 层：反思区（think.md）──
  // 从 .sofagent/ 数据目录读取。优先 SOFAGENT_DATA 环境变量，其次 process.cwd()。
  const sofagentData =
    process.env.SOFAGENT_DATA || path.join(process.cwd(), ".sofagent");
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

  // ── 第 3 层：用户规则（rules.md）──
  // 优先读 install.sh 部署的扁平化路径（权威路径）
  // fallback 读旧 constitution 路径（兼容 v0.72 前老安装）
  // 最后 fallback 读旧路径 openclawDir/rules.md（兼容 v0.70 前老安装）
  const rulesCandidates = [
    path.join(openclawDir, "skills", "sofagent", "rules.md"),
    path.join(openclawDir, "skills", "sofagent", "constitution", "rules.md"),
    path.join(openclawDir, "rules.md"),
  ];
  let rulesFile = "";
  for (const candidate of rulesCandidates) {
    if (fs.existsSync(candidate)) {
      rulesFile = candidate;
      break;
    }
  }
  if (rulesFile) {
    const content = fs.readFileSync(rulesFile, "utf-8");
    event.context.bootstrapFiles.push({
      name: "sofagent-rules.md",
      path: rulesFile,
      content: `<!-- ===== sofagent 第 3 层：用户规则（rules.md）===== -->\n${content}`,
    });
    pushed.push("rules.md");
  }

  if (pushed.length > 0) {
    console.log(
      `[sofagent-load-chain] injected: ${pushed.join(", ")} (layer 2-3)`,
    );
  }
};

export default handler;
