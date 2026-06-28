#!/usr/bin/env node
// ============================================================
// 误报率/漏报率 逐规则合成测量 · v0.93
// 从 test-fixtures/detection-cases.json 加载测试用例
// ============================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import { runRules } from './reporter';
import type { DiffFile } from './diff-parser';
import type { LogEntry } from './log-checker';

// ═══════════════════════════════════════════════════════════
// JSON 类型定义
// ═══════════════════════════════════════════════════════════

interface JsonLogEntry {
  timestamp: string;
  operation: string;
  file?: string;
  raw: string;
}

interface JsonDiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  lines: string[];
}

interface JsonTestCase {
  name: string;
  diffFiles: JsonDiffFile[];
  logEntries: JsonLogEntry[];
  task?: string;
  targetRule: number;
  expectStatus: 'PASS' | 'WARN' | 'FAIL';
}

interface JsonRuleGroup {
  label: string;
  cases: JsonTestCase[];
}

interface JsonDetectionCases {
  version: string;
  updated: string;
  rules: Record<string, JsonRuleGroup>;
}

// ═══════════════════════════════════════════════════════════
// 运行时类型
// ═══════════════════════════════════════════════════════════

interface RuleTestCase {
  name: string;
  diffFiles: DiffFile[];
  logEntries: LogEntry[];
  task?: string;
  targetRule: number;
  expectStatus: 'PASS' | 'WARN' | 'FAIL';
}

// ═══════════════════════════════════════════════════════════
// JSON 加载与类型转换
// ═══════════════════════════════════════════════════════════

/**
 * 从 JSON fixture 加载检测用例，将 ISO timestamp 字符串转为 Date 对象。
 * fixturePath 通过 __dirname/../test-fixtures/detection-cases.json 定位，
 * 兼容 ts-node（src/）和编译后 node（dist/）两种运行方式。
 */
function loadDetectionCases(): { version: string; rules: Array<{ label: string; cases: RuleTestCase[] }> } {
  const fixturePath = join(__dirname, '..', 'test-fixtures', 'detection-cases.json');
  let json: JsonDetectionCases;

  try {
    json = JSON.parse(readFileSync(fixturePath, 'utf-8')) as JsonDetectionCases;
  } catch {
    console.error('无法加载检测用例 JSON，请检查 test-fixtures/detection-cases.json');
    process.exit(1);
  }

  const rules: Array<{ label: string; cases: RuleTestCase[] }> = [];

  for (const [, rule] of Object.entries(json.rules)) {
    const cases: RuleTestCase[] = rule.cases.map((c: JsonTestCase) => ({
      name: c.name,
      diffFiles: c.diffFiles.map((df: JsonDiffFile) => ({
        path: df.path,
        status: df.status,
        lines: df.lines,
      })) as DiffFile[],
      logEntries: c.logEntries.map((le: JsonLogEntry) => ({
        timestamp: new Date(le.timestamp),
        operation: le.operation,
        file: le.file,
        raw: le.raw,
      })) as LogEntry[],
      task: c.task,
      targetRule: c.targetRule,
      expectStatus: c.expectStatus,
    }));

    rules.push({ label: rule.label, cases });
  }

  return { version: json.version, rules };
}

// ═══════════════════════════════════════════════════════════
// 运行与统计
// ═══════════════════════════════════════════════════════════

function runRuleTests(cases: RuleTestCase[]): { fpCount: number; fnCount: number; total: number; fpCases: string[]; fnCases: string[] } {
  let fpCount = 0, fnCount = 0;
  const fpCases: string[] = [], fnCases: string[] = [];

  for (const tc of cases) {
    const result = runRules(tc.diffFiles, tc.logEntries, tc.task);
    const ruleResult = result.rules.find(r => r.number === tc.targetRule);

    if (!ruleResult) {
      console.error(`  ⚠️  规则 ${tc.targetRule} 未注册: ${tc.name}`);
      continue;
    }

    if (tc.expectStatus === 'PASS' && ruleResult.status !== 'PASS') {
      fpCount++;
      fpCases.push(`${tc.name} (expected PASS, got ${ruleResult.status})`);
    } else if ((tc.expectStatus === 'FAIL' || tc.expectStatus === 'WARN') && ruleResult.status === 'PASS') {
      fnCount++;
      fnCases.push(`${tc.name} (expected ${tc.expectStatus}, got PASS)`);
    }
  }

  return { fpCount, fnCount, total: cases.length, fpCases, fnCases };
}

// ═══════════════════════════════════════════════════════════
// 主流程
// ═══════════════════════════════════════════════════════════

function main(): void {
  const { version, rules: allCases } = loadDetectionCases();

  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  sofagent-audit 逐规则合成检测精度 · v${version}`);
  console.log(`═══════════════════════════════════════════\n`);

  let totalFP = 0, totalFN = 0, grandTotal = 0;

  for (const { label, cases } of allCases) {
    if (cases.length === 0) continue;
    const r = runRuleTests(cases);
    grandTotal += r.total;
    totalFP += r.fpCount;
    totalFN += r.fnCount;

    console.log(`  ${label}: ${r.total} cases, FP=${r.fpCount} FN=${r.fnCount}`);
    if (r.fpCases.length > 0) for (const c of r.fpCases) console.log(`    ⚠️  FP: ${c}`);
    if (r.fnCases.length > 0) for (const c of r.fnCases) console.log(`    ⚠️  FN: ${c}`);
    console.log('');
  }

  console.log('───────────────────────────────────────────');
  console.log(`  总计: ${grandTotal} cases`);
  if (grandTotal > 0) {
    console.log(`  漏报 FN: ${totalFN}/${grandTotal} (${(totalFN / grandTotal * 100).toFixed(1)}%)`);
    console.log(`  误报 FP: ${totalFP}/${grandTotal} (${(totalFP / grandTotal * 100).toFixed(1)}%)`);
  }
  console.log('');

  if (totalFP === 0 && totalFN === 0) {
    console.log('  ✅ 全部通过——无漏报、无误报');
  } else if (totalFP <= Math.ceil(grandTotal * 0.05)) {
    console.log('  ✅ FP ≤ 5%——可接受');
  } else {
    console.log('  ❌ FP > 5%——需修复');
  }
  console.log('═══════════════════════════════════════════');
}

main();
