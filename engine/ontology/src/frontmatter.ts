// ============================================================
// frontmatter.ts · Markdown 头信息（frontmatter）解析单源
// v1.5.5 批 19：三处同名/近名实现收敛为一处——
//   · engine/mcp/src/tools/knowledge-page.ts  parseFrontmatter（导出）
//   · engine/ontology/src/merge-engine.ts     parseFrontmatter（私有）
//   · engine/ontology/src/query.ts            parseFrontmatterSafe（私有，近名）
//   三者语义逐字一致（去 BOM → CRLF 归一 → `---` 段匹配 → YAML 解析；失败返回 null），
//   但各写一份、漂移无门禁可查。现以本模块为唯一实现（本体包为 SSOT）。
// ============================================================

import { load as yamlLoad } from 'js-yaml';

/**
 * 解析 Markdown 文件头的 YAML frontmatter。
 *
 * 管线：去 BOM（\uFEFF）→ CRLF 归一为 LF（防 Windows 创建的文件解析失败）
 *   → 匹配首个 `---\n…\n---` 段 → YAML 解析。
 *
 * @param content 文件全文
 * @returns 解析出的对象；无 frontmatter / 空段 / YAML 语法错时返回 null（不抛）
 */
export function parseFrontmatter(content: string): Record<string, unknown> | null {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---/);
  if (!match || !match[1]) return null;
  try {
    return yamlLoad(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}
