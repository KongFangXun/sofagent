// ============================================================
// warn-accumulator.ts · WARN 累积报告巡检器
// 扫描 history.jsonl，检测连续未处理的 WARN。
// v1.1.4 新增 · v1.1.4 修正连续性判定语义
//
// 判定逻辑（v1.1.4 修正）：
//   连续性 = 从时间序列末尾往前数 WARN，遇到 PASS/FAIL 则清零。
//   即「最近 N 条审计全是 WARN」才触发告警。
//   v1.1.4 版本只过滤 WARN 后计数——任何 N 条 WARN 都触发，语义错误。
//
// 配合 v1.1.4 LOOP audit 三态全写 history（PASS/WARN/FAIL），
// warn-accumulator 现在能正确识别「WARN 之后有 PASS 清理」的情况。
// ============================================================

import * as fs from 'fs';
import * as path from 'path';

import type { InspectorResult } from './types';

/**
 * 检测连续 WARN 累积（v1.1.4 修正版）
 *
 * @param projectDir 项目根目录
 * @param threshold 连续 WARN 触发阈值（默认 3）
 * @returns 巡检结果——末尾连续 N 条 WARN（中间无 PASS/FAIL）时 triggered=true
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
      };
      if (
        typeof entry.exitCode === 'number' &&
        entry.timestamp &&
        new Date(entry.timestamp).getTime() > sevenDaysAgo
      ) {
        records.push({
          timestamp: entry.timestamp,
          exitCode: entry.exitCode,
          task: entry.task ?? entry.commitMsg ?? entry.diffRange ?? '(unknown)',
          files: extractFileHints(entry.task ?? entry.commitMsg ?? ''),
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
  // 末尾连续 N 条 WARN（中间无 PASS/FAIL）才触发
  let consecutiveWarn = 0;
  for (let i = records.length - 1; i >= 0; i--) {
    const rec = records[i];
    if (rec && rec.exitCode === 1) {
      consecutiveWarn++;
    } else {
      break; // 遇到 PASS/FAIL 或无效记录，连续中断
    }
  }

  // 统计近 7 天总 WARN 数（用于 message 信息量）
  const totalWarn = records.filter((r) => r.exitCode === 1).length;

  if (consecutiveWarn >= threshold) {
    const recentRecords = records.slice(-consecutiveWarn);
    const recentFiles = recentRecords
      .flatMap((r) => r.files)
      .filter(Boolean);
    const fileHint = recentFiles.length > 0
      ? ` 涉及文件：${[...new Set(recentFiles)].slice(0, 5).join(', ')}`
      : '';
    return {
      name: 'warn-accumulator',
      triggered: true,
      message: `连续 ${consecutiveWarn} 条 WARN 未处理（近 7 天共 ${totalWarn} 条 WARN，末尾连续 ${consecutiveWarn} 条无 PASS 清理），建议人工跟进。${fileHint}`,
      severity: 'warning',
    };
  }

  return {
    name: 'warn-accumulator',
    triggered: false,
    message: `No consecutive WARN accumulation (近 7 天 ${totalWarn} 条 WARN，末尾连续 ${consecutiveWarn} 条，阈值 ${threshold})`,
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
