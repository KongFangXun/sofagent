// ============================================================
// warn-accumulator.ts · WARN 累积报告巡检器
// 扫描 history.jsonl，检测连续未处理的 WARN。
// v1.3.5 新增 · v1.2.0 修正连续性判定语义
// v1.3.5 增强：文件级追踪——WARN 涉及的文件已被删除/修复时不计入累积
//
// 判定逻辑（v1.3.5 修正 + v1.2.0 文件级）：
//   连续性 = 从时间序列末尾往前数 WARN，遇到 PASS/FAIL 则清零。
//   文件级过滤 = 末尾连续 WARN 中，若某条 WARN 涉及的所有文件已被删除
//              （fs.existsSync 返回 false）或后续 history 有该文件的
//              delete 记录，则该条 WARN 不计入"未处理"。
//
// 配合 v1.1.4 FORGE audit 三态全写 history（PASS/WARN/FAIL），
// warn-accumulator 现在能正确识别「WARN 之后有 PASS 清理」的情况。
// ============================================================

import * as fs from 'fs';
import * as path from 'path';

import type { InspectorResult } from './types';

/**
 * 检测连续 WARN 累积（v1.1.5 文件级追踪版）
 *
 * @param projectDir 项目根目录
 * @param threshold 连续 WARN 触发阈值（默认 3）
 * @returns 巡检结果——末尾连续 N 条 WARN（中间无 PASS/FAIL，且涉及文件仍存在）时 triggered=true
 */
export function accumulateWarnings(
  projectDir: string,
  threshold = 3,
): InspectorResult {
  const historyPath = path.join(
    projectDir,
    '.sofagent',
    'audit',
    'history.jsonl',
  );

  if (!fs.existsSync(historyPath)) {
    return {
      name: 'warn-accumulator',
      triggered: false,
      message: 'No audit history found',
      severity: 'info',
    };
  }

  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const lines = fs
    .readFileSync(historyPath, 'utf-8')
    .split('\n')
    .filter(Boolean);

  // 解析近 7 天所有审计记录（含 PASS/WARN/FAIL），按时间升序排列
  interface AuditRecord {
    timestamp: string;
    exitCode: number; // 0=PASS / 1=WARN / 2=FAIL
    task: string;
    files: string[];
    /** v1.1.5: 从 ruleResults[].details 提取的涉及文件 */
    involvedFiles: string[];
  }
  const records: AuditRecord[] = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as {
        timestamp?: string;
        exitCode?: number;
        task?: string;
        commitMsg?: string;
        diffRange?: string;
        ruleResults?: Array<{ name?: string; status?: string; details?: string[] }>;
      };
      if (
        typeof entry.exitCode === 'number' &&
        entry.timestamp &&
        new Date(entry.timestamp).getTime() > sevenDaysAgo
      ) {
        // v1.1.5: 从 ruleResults[].details 提取涉及文件（而非仅 task/commitMsg 文本）
        const involved = new Set<string>();
        if (Array.isArray(entry.ruleResults)) {
          for (const r of entry.ruleResults) {
            if (r.status === 'WARN' && Array.isArray(r.details)) {
              for (const detail of r.details) {
                for (const f of extractFilePaths(detail)) {
                  involved.add(f);
                }
              }
            }
          }
        }
        records.push({
          timestamp: entry.timestamp,
          exitCode: entry.exitCode,
          task: entry.task ?? entry.commitMsg ?? entry.diffRange ?? '(unknown)',
          files: extractFileHints(entry.task ?? entry.commitMsg ?? ''),
          involvedFiles: Array.from(involved),
        });
      }
    } catch {
      // 跳过损坏的 JSON 行
    }
  }

  if (records.length === 0) {
    return {
      name: 'warn-accumulator',
      triggered: false,
      message: 'No audit records in last 7 days',
      severity: 'info',
    };
  }

  // 按时间升序排序（旧→新）
  records.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // v1.1.4 修正：真正的连续性判定——从末尾往前数 WARN，遇到 PASS/FAIL 中断
  // v1.1.5 文件级过滤：末尾连续 WARN 中剔除「涉及文件已不存在」的条目
  let consecutiveWarn = 0;
  const unresolvedRecords: AuditRecord[] = [];
  for (let i = records.length - 1; i >= 0; i--) {
    const rec = records[i];
    if (!rec) break;
    if (rec.exitCode !== 1) break; // 遇到 PASS/FAIL 中断

    // 文件级追踪：该条 WARN 涉及的所有文件是否仍存在于项目？
    // 全部已删除 → 视为已处理，不计入累积
    if (rec.involvedFiles.length > 0) {
      const anyExists = rec.involvedFiles.some((f) =>
        fs.existsSync(path.join(projectDir, f)),
      );
      if (!anyExists) {
        // 所有涉及文件都已删除——这条 WARN 已自然消解
        continue;
      }
    }
    consecutiveWarn++;
    unresolvedRecords.unshift(rec);
  }

  // 统计近 7 天总 WARN 数（用于 message 信息量）
  const totalWarn = records.filter((r) => r.exitCode === 1).length;

  if (consecutiveWarn >= threshold) {
    const recentFiles = unresolvedRecords
      .flatMap((r) => [...r.files, ...r.involvedFiles])
      .filter(Boolean);
    const fileHint = recentFiles.length > 0
      ? ` 涉及文件：${[...new Set(recentFiles)].slice(0, 5).join(', ')}`
      : '';
    return {
      name: 'warn-accumulator',
      triggered: true,
      message: `连续 ${consecutiveWarn} 条 WARN 未处理（近 7 天共 ${totalWarn} 条 WARN，末尾连续 ${consecutiveWarn} 条无 PASS 清理且涉及文件仍存在），建议人工跟进。${fileHint}`,
      severity: 'warning',
    };
  }

  return {
    name: 'warn-accumulator',
    triggered: false,
    message: `No consecutive WARN accumulation (近 7 天 ${totalWarn} 条 WARN，末尾连续 ${consecutiveWarn} 条（文件级过滤后），阈值 ${threshold})`,
    severity: 'info',
  };
}

/**
 * 从 task/commitMsg 文本中提取文件路径提示（用于告警信息）
 */
function extractFileHints(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/[^\s:,;()"'`]+\/[^\s:,;()"'`]+/g);
  return matches ? matches.slice(0, 3) : [];
}

/**
 * v1.1.5: 从 ruleResults[].details 文本中提取文件路径
 * 匹配形式：
 *   - 含路径分隔符：path/to/file.ts / path/to/file.ts:12
 *   - 单独文件名（含扩展名）：a.txt / bak.log / file.test.ts
 * 排除：
 *   - URL（http/https）
 *   - 通配符模式（含 * 或 ?）
 */
function extractFilePaths(text: string): string[] {
  if (!text) return [];
  const results = new Set<string>();

  // 1. 含 / 的路径
  const pathMatches = text.match(/[a-zA-Z0-9_\-./]+\/[a-zA-Z0-9_\-./]+/g);
  if (pathMatches) {
    for (const m of pathMatches) {
      const cleaned = m.replace(/:\d+$/, '').replace(/\s.*$/, '');
      if (!cleaned.includes('://') && !cleaned.includes('*') && !cleaned.includes('?')) {
        results.add(cleaned);
      }
    }
  }

  // 2. 单独文件名（word.ext 形式，ext 为 1-10 字母数字）
  const fileMatches = text.match(/\b[a-zA-Z0-9_\-]+\.[a-zA-Z0-9]{1,10}\b/g);
  if (fileMatches) {
    for (const m of fileMatches) {
      // 排除版本号 (1.1.5) / IP 段 / 纯数字小数
      if (/^\d+\.\d+/.test(m)) continue;
      results.add(m);
    }
  }

  return Array.from(results).slice(0, 5);
}
