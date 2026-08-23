// ── API 分级契约（v1.4.0 四）────────────────────────────
// `/* @public */`：公开 API——semver 锁定，变更必须 bump 版本 + CHANGELOG 记录
//                 （外部依赖方与跨平台适配器只许 import 这一层）
// `/* @internal */`：内部 API——不承诺稳定性，破坏性变更无需 bump
// 未标记的导出视为 @public（保守默认：宁可多承诺不可漏承诺）
// ────────────────────────────────────────────────────────
/**
 * @sofagent/harness — 四层约束加载链
 * 生成 Sub Agent 启动时的 context prompt：SKILL.md → fde.md → think.md → knowledge/
 * v1.2.0 从 sofagent/audit/src/subagents/launcher.ts 迁出
 *
 * ⚠️ 职责分工（v1.3.8 P0-R11）：
 *   本文件是 **npm API 形态**的加载链实现（createReactAgent 构建 system prompt 时
 *   调用 buildConstrainedSystemPrompt）。
 *   OpenClaw 平台 hook 部署形态由 engine/hooks/sofagent-load-chain/src/handler.ts
 *   （.openclaw/hooks/sofagent-load-chain/handler.ts）负责——两份实现职责不同、
 *   服务不同部署形态，**不要合并**。改动加载链逻辑时需两处同步评估。
 */
import * as fs from 'fs';
import * as path from 'path';
// v1.3.2 交付 14：L4 经验层渐进加载增强——知识索引构建（文件名 + frontmatter 摘要 + 首行）
import {
  buildKnowledgeIndex,
  formatKnowledgeIndex,
  topKnowledgeByMtime,
  INDEX_ENTRY_MAX_CHARS,
} from './knowledge-index';

// ============================================================
// 辅助函数
// ============================================================

/**
 * 尝试读取文件——文件不存在时返回 null（静默跳过）
 */
function tryRead(filePath: string): string | null {
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8');
  }
  return null;
}

/**
 * 扫描 custom/ 用户自定义层，读取全部 *-overrides.md（v1.2.1 新增）
 *
 * 只认 custom/README.md 命名表约定的 *-overrides.md 文件（其余文件名忽略），
 * 按文件名排序保证注入顺序稳定；每篇截取前 2000 字符。
 * 目录不存在/无匹配文件 → 空数组（静默跳过，与知识库行为一致）。
 *
 * @param dir custom/ 目录绝对路径
 * @param maxFiles 最多注入文件数（默认 4，防 prompt 膨胀）
 */
function listCustomOverrides(dir: string, maxFiles = 4): string[] {
  const results: string[] = [];
  try {
    if (!fs.existsSync(dir)) return results;

    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('-overrides.md'))
      .sort()
      .map(f => path.join(dir, f))
      .filter(f => {
        try { return fs.statSync(f).isFile(); } catch { return false; }
      });

    for (let i = 0; i < Math.min(files.length, maxFiles); i++) {
      const content = tryRead(files[i]!);
      if (content) {
        results.push(content.slice(0, 2000));
      }
    }
  } catch {
    // 目录不存在等异常静默跳过
  }
  return results;
}

// ============================================================
// 四层约束加载链
// ============================================================

/**
 * 构建带约束的 system prompt（四层加载链）
 *
 * 纯文件系统读取，不依赖任何 Agent 平台的 Skill 注入机制。
 * 总注入量控制在 ~4000 token 以内。
 *
 * 加载顺序：
 * 1. 宪法层：SKILL.md（4 底线 + 7 铁律）
 * 2. 规范层：fde.md（企业专属规则）
 * 3. 反思层：think.md（历史踩坑）
 * 3.5 用户层：custom/*-overrides.md（v1.2.1 新增——追加在官方规则之后，不是替换）
 * 4. 知识库：knowledge/ top-N（按 mtime 排序，每篇截取前 2000 字符）
 * 5. v1.0.8: persona.md（Agent 记忆，前 500 字符）
 *
 * @param projectRoot 项目根目录
 * @param opts.skillDir 约束文件子目录名（默认 ".sofagent"），相对于 projectRoot
 * @returns 拼接后的 system prompt 字符串
 */
/* @public */ export function buildConstrainedSystemPrompt(
  projectRoot: string,
  opts?: { skillDir?: string },
): string {
  const skillDir = path.join(projectRoot, opts?.skillDir ?? '.sofagent');
  const parts: string[] = [];
  const MAX_PARTS = 20;

  // 1. 宪法层：SKILL.md
  const skillContent = tryRead(path.join(skillDir, 'SKILL.md'));
  if (skillContent) parts.push(`# 宪法约束\n${skillContent}`);

  // 2. 规范层：fde.md
  const fdeContent = tryRead(path.join(skillDir, 'fde.md'));
  if (fdeContent) parts.push(`# 企业规则\n${fdeContent}`);

  // 3. 反思层：think.md
  const thinkContent = tryRead(path.join(skillDir, 'think.md'));
  if (thinkContent) parts.push(`# 历史经验\n${thinkContent}`);

  // 3.5 用户自定义层：custom/*-overrides.md（v1.2.1 新增）
  // 加载顺序：引擎层（宪法/规范/反思）→ 用户层（custom/ 私有规则）。
  // 后加载 = 优先级更高——custom/ 规则追加在官方规则之后，不是替换。
  const customRules = listCustomOverrides(path.join(skillDir, 'custom'));
  for (const rule of customRules) {
    parts.push(`# 用户自定义规则（custom/）\n${rule}`);
  }

  // 4. 知识库：knowledge/（v1.3.1 交付 14：渐进加载增强——「热点全文 + 索引」）
  //    热点 2 篇：全文注入（mtime 最新，保持现有注入语义）；
  //    索引 9 条：只注入文件名 + frontmatter 摘要 + 首行（每条 ≤150 字符），
  //    需要完整内容时用 read_file 按文件名拉全文。
  const knowledgeDir = path.join(skillDir, 'knowledge');
  const knowledgeParts: string[] = [];

  // 4a. 热点 2 篇全文（跨 shared/federation/local 按 mtime 最新）
  const hotEntries = topKnowledgeByMtime(knowledgeDir, 2);
  for (const entry of hotEntries) {
    const filePath = path.join(
      entry.kind === 'shared'
        ? path.join(knowledgeDir, 'shared')
        : entry.kind === 'federation'
          ? path.join(knowledgeDir, 'federation')
          : knowledgeDir,
      `${entry.fileName}.md`,
    );
    let content = tryRead(filePath) ?? '';
    content = content.slice(0, 2000); // 每篇截取前 2000 字符（保持现有行为）
    if (!content) continue;
    // 联邦来源强制 <untrusted> 包裹（prompt 注入防线层 1，与 trust 分级联动）
    knowledgeParts.push(
      entry.kind === 'federation'
        ? `<untrusted source="federation">\n${content}\n</untrusted>`
        : content,
    );
  }

  // 4b. 知识索引（shared 3 + federation 3 + local 3 = 9 条摘要）
  const indexEntries = buildKnowledgeIndex(knowledgeDir);
  const indexText = formatKnowledgeIndex(indexEntries, 9);

  // 4c. 组装知识库段——热点全文在前，索引在后（总注入量从 ~4000 降到 ~1500 token）。
  //     无任何知识内容时整个知识库段不注入（保持「无约束目录返回空串」契约）。
  const hasKnowledgeContent = knowledgeParts.length > 0 || indexText.length > 0;
  if (hasKnowledgeContent) {
    const knowledgeSection = [
      '# 知识库（L4 经验层）',
      '## 当前任务热点（全文注入，top-2 by mtime）',
      ...knowledgeParts,
      '## 知识索引（按需读取）',
      indexText
        ? `${indexText}\n\n需要完整内容时用 read_file 读取 knowledge/ 下对应文件。`
        : '（暂无知识索引）',
    ].filter((p) => p.length > 0);
    for (const part of knowledgeSection) {
      if (parts.length < MAX_PARTS) {
        parts.push(part);
      }
    }
  }

  // 5. v1.0.8: persona.md（Agent 记忆，前 500 字符）
  try {
    const personaPath = path.join(skillDir, 'persona.md');
    if (fs.existsSync(personaPath)) {
      const personaContent = fs.readFileSync(personaPath, 'utf-8').slice(0, 500);
      if (personaContent) {
        parts.push(`# 用户画像 (persona)\n${personaContent}`);
      }
    }
  } catch {
    // persona 注入失败不影响主流程
  }

  return parts.join('\n\n---\n\n');
}
