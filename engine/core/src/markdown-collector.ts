// ============================================================
// markdown-collector.ts · 目录递归收集 helper（.md / .jsonl）
// v1.8.0（Q18 收口批）：月目录读写同构的公共实现。
// ------------------------------------------------------------
// 背景：生产者 task-record.sh 写 task/logs/{MONTH}/{DAY}.md（月目录层级），
// 而消费者 log-checker.ts 曾用非递归 readdirSync（月目录名不以 .md 结尾被
// 滤掉 ⇒ A7/A8 日志证据源恒空）；cost-baseline.ts 对同路径自写了一份
// 两层递归（第二份重复实现）。本 helper 收敛两者：
//   - 语义：顶层文件 + 全部子目录内文件（月目录 YYYY-MM 一层为主，多一层
//     亦收——递归语义不把「恰好两层」写死）；只收文件、跳过符号链接。
//   - 返回带相对路径，调用方 join 后 mtime 排序照旧。
// ============================================================

import { readdirSync } from 'fs';
import { join } from 'path';

export interface CollectedFile {
  /** 相对于根目录的完整路径（可直接 readFileSync） */
  fullPath: string;
  /** 文件名（basename） */
  name: string;
}

/**
 * 递归收集目录下全部指定扩展名的文件。
 * @param dir 根目录
 * @param exts 扩展名白名单（如 ['.md', '.jsonl']）
 */
export function collectFilesRecursive(dir: string, exts: string[]): CollectedFile[] {
  const out: CollectedFile[] = [];
  try {
    const items = readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.isFile() && exts.some((e) => item.name.endsWith(e))) {
        out.push({ fullPath: join(dir, item.name), name: item.name });
      } else if (item.isDirectory()) {
        // 递归子目录（月目录形态 task/logs/2026-09/01.md）
        out.push(...collectFilesRecursive(join(dir, item.name), exts));
      }
    }
  } catch {
    // 读取失败返回已收集部分（与既有消费方的容错语义一致）
  }
  return out;
}
