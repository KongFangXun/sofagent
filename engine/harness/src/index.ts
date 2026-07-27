/**
 * @sofagent/harness — 四层约束加载链
 * 生成 Sub Agent 启动时的 context prompt：SKILL.md → fde.md → think.md → knowledge/
 * v1.2.0 从 sofagent/audit/src/subagents/launcher.ts 迁出
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
 * 3.5 用户层：custom/*-overrides.md（v1.2.1 新增——追加在官方规则之后，不是替换）
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

  // 3.5 用户自定义层：custom/*-overrides.md（v1.2.1 新增）
  // 加载顺序：引擎层（宪法/规范/反思）→ 用户层（custom/ 私有规则）。
  // 后加载 = 优先级更高——custom/ 规则追加在官方规则之后，不是替换。
  const customRules = listCustomOverrides(path.join(skillDir, 'custom'));
  for (const rule of customRules) {
    parts.push(`# 用户自定义规则（custom/）\n${rule}`);
  }

  // 4a. knowledge/shared/ top-3（跨设备共享经验，优先注入）
  const sharedDir = path.join(skillDir, 'knowledge', 'shared');
  const sharedKnowledge = listKnowledgeTopN(sharedDir, 3);

  // 4a+. v1.1.8 新增：联邦知识注入（第 3 层——低于 SKILL.md 宪法层，
  // 高于本地 knowledge/）。来源：knowledge/federation/ 目录
  // （daemon 联邦查询落盘的 peer 知识快照）。联邦内容是外部来源，
  // 强制 <untrusted> 包裹（prompt 注入防线层 1，与 trust 分级层 5 联动）。
  const federationDir = path.join(skillDir, 'knowledge', 'federation');
  const federationKnowledge = listKnowledgeTopN(federationDir, 3).map(
    (content) => `<untrusted source="federation">\n${content}\n</untrusted>`,
  );

  // 4b. knowledge/ top-5（本机知识）
  const knowledgeDir = path.join(skillDir, 'knowledge');
  const localKnowledge = listKnowledgeTopN(knowledgeDir, 5);

  // 合并去重（按内容前 100 字符），shared + federation 排在前（联邦低于
  // 宪法层但优先于本地 knowledge/）
  const MAX_PARTS = 20;
  const seen = new Set<string>();
  for (const file of [...sharedKnowledge, ...federationKnowledge, ...localKnowledge]) {
    const key = file.slice(0, 100);
    if (!seen.has(key) && parts.length < MAX_PARTS) {
      parts.push(file);
      seen.add(key);
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
