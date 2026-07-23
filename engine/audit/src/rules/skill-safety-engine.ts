// ============================================================
// skill-safety-engine.ts · Skill 安全审查——文件扫描引擎
// ============================================================

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { COMPILED_RULES, SCANNABLE_EXTENSIONS, type SafetyHit } from './skill-safety-rules';

/**
 * 递归找出所有需扫描的文件。
 * 跳过隐藏目录和 node_modules。
 */
export function findFiles(target: string): string[] {
  if (!existsSync(target)) return [];

  const stat = statSync(target);
  if (stat.isFile()) {
    const ext = extname(target).toLowerCase();
    if (SCANNABLE_EXTENSIONS.has(ext)) return [target];
    if (ext === '') return [target]; // 无扩展名（Makefile、Dockerfile 等）
    return [];
  }

  if (stat.isDirectory()) {
    const files: string[] = [];
    try {
      for (const entry of readdirSync(target, { withFileTypes: true })) {
        const fullPath = join(target, entry.name);
        if (entry.isDirectory()) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          files.push(...findFiles(fullPath));
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (SCANNABLE_EXTENSIONS.has(ext) || ext === '') files.push(fullPath);
        }
      }
    } catch { /* 跳过无法读取的目录 */ }
    return files;
  }

  return [];
}

/**
 * 扫描单个文件，返回命中列表。
 */
export function scanFile(filePath: string): SafetyHit[] {
  const hits: SafetyHit[] = [];

  let lines: string[];
  try {
    lines = readFileSync(filePath, 'utf-8').split('\n');
  } catch {
    return hits;
  }

  for (const rule of COMPILED_RULES) {
    const re = rule.regex;
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const lineText = lines[lineNum];
      if (lineText !== undefined && re && re.test(lineText)) {
        hits.push({
          file: filePath,
          line: lineNum + 1,
          category: rule.category,
          severity: rule.severity,
          pattern: rule.pattern.source,
          description: rule.description,
        });
      }
    }
  }

  return hits;
}
