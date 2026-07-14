/**
 * @sofagent/harness — 四层约束加载链
 * 生成 Sub Agent 启动时的 context prompt：SKILL.md → fde.md → think.md → knowledge/
 * v1.1.0 从 sofagent/audit/src/subagents/launcher.ts 迁出
 */
import * as fs from 'fs';
import * as path from 'path';

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
 * 扫描知识库目录，按 mtime 降序取前 N 个 .md 文件
 * 每篇截取前 2000 字符
 */
function listKnowledgeTopN(dir: string, n: number): string[] {
  const results: string[] = [];
  try {
    if (!fs.existsSync(dir)) return results;

    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.md'))
      .map(f => path.join(dir, f))
      .filter(f => {
        try { return fs.statSync(f).isFile(); } catch { return false; }
      })
      .sort((a, b) => {
        try {
          return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
        } catch {
          return 0;
        }
      });

    for (let i = 0; i < Math.min(files.length, n); i++) {
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
 * 4. 知识库：knowledge/ top-N（按 mtime 排序，每篇截取前 2000 字符）
 * 5. v1.0.8: persona.md（Agent 记忆，前 500 字符）
 *
 * @param projectRoot 项目根目录
 * @param opts.skillDir 约束文件子目录名（默认 ".sofagent"），相对于 projectRoot
 * @returns 拼接后的 system prompt 字符串
 */
export function buildConstrainedSystemPrompt(
  projectRoot: string,
  opts?: { skillDir?: string },
): string {
  const skillDir = path.join(projectRoot, opts?.skillDir ?? '.sofagent');
  const parts: string[] = [];

  // 1. 宪法层：SKILL.md
  const skillContent = tryRead(path.join(skillDir, 'SKILL.md'));
  if (skillContent) parts.push(`# 宪法约束\n${skillContent}`);

  // 2. 规范层：fde.md
  const fdeContent = tryRead(path.join(skillDir, 'fde.md'));
  if (fdeContent) parts.push(`# 企业规则\n${fdeContent}`);

  // 3. 反思层：think.md
  const thinkContent = tryRead(path.join(skillDir, 'think.md'));
  if (thinkContent) parts.push(`# 历史经验\n${thinkContent}`);

  // 4. 知识库：knowledge/ top-N（按 mtime 排序）
  const knowledgeFiles = listKnowledgeTopN(path.join(skillDir, 'knowledge'), 5);
  for (const file of knowledgeFiles) {
    parts.push(file);
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
