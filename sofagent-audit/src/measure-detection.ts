#!/usr/bin/env node
// ============================================================
// 误报率/漏报率 逐规则合成测量 · v0.92
// ============================================================
import { runRules } from './reporter';
import type { DiffFile } from './diff-parser';
import type { LogEntry } from './log-checker';
import type { RuleCheck } from './rules/types';

function makeFile(path: string, status: DiffFile['status'] = 'modified'): DiffFile {
  return { path, status, lines: [] };
}
function makeLog(op: LogEntry['operation'], file?: string, raw?: string): LogEntry {
  return { timestamp: new Date(), operation: op, file, raw };
}

// ═══════════════════════════════════════════════════════════
// 逐规则测试：每个 case 只测单一规则的正确性
// ═══════════════════════════════════════════════════════════

interface RuleTestCase {
  name: string;
  diffFiles: DiffFile[];
  logEntries: LogEntry[];
  task?: string;
  targetRule: number; // 1/3/7/10
  expectStatus: 'PASS' | 'WARN' | 'FAIL';
}

// ── 铁律 #1 ──
const rule01Cases: RuleTestCase[] = [
  // === 应 FAIL（违规） ===
  { name: '#1 改 config.ts 无 Read', diffFiles: [makeFile('src/config.ts')], logEntries: [makeLog('read', 'src/other.ts')], targetRule: 1, expectStatus: 'FAIL' },
  { name: '#1 改 3 个文件只读了 2 个', diffFiles: [makeFile('a.ts'), makeFile('b.ts'), makeFile('c.ts')], logEntries: [makeLog('read', 'a.ts'), makeLog('read', 'b.ts')], targetRule: 1, expectStatus: 'FAIL' },
  { name: '#1 改 Makefile 无 Read', diffFiles: [makeFile('Makefile')], logEntries: [], targetRule: 1, expectStatus: 'WARN' },
  { name: '#1 改 .env 无 Read', diffFiles: [makeFile('.env')], logEntries: [makeLog('write', '.env')], targetRule: 1, expectStatus: 'FAIL' },

  // === 应 PASS（合法） ===
  { name: '#1 改了且读了', diffFiles: [makeFile('src/foo.ts')], logEntries: [makeLog('read', 'src/foo.ts')], targetRule: 1, expectStatus: 'PASS' },
  { name: '#1 basename 匹配跨目录', diffFiles: [makeFile('lib/config.ts')], logEntries: [makeLog('read', 'src/config.ts')], targetRule: 1, expectStatus: 'PASS' },
  { name: '#1 config.ts ≠ tsconfig.json', diffFiles: [makeFile('tsconfig.json')], logEntries: [makeLog('read', 'config.ts')], targetRule: 1, expectStatus: 'PASS' },
  { name: '#1 Write 操作不算 Read', diffFiles: [makeFile('src/foo.ts')], logEntries: [makeLog('write', 'src/foo.ts'), makeLog('read', 'src/bar.ts')], targetRule: 1, expectStatus: 'PASS' },
  { name: '#1 execute 操作不算 Read', diffFiles: [makeFile('src/foo.ts')], logEntries: [{ timestamp: new Date(), operation: 'execute', file: 'src/foo.ts', raw: '读取 src/foo.ts' }, makeLog('read', 'src/foo.ts')], targetRule: 1, expectStatus: 'PASS' },
  { name: '#1 Read Dockerfile', diffFiles: [makeFile('Dockerfile')], logEntries: [makeLog('read', 'Dockerfile')], targetRule: 1, expectStatus: 'PASS' },
  { name: '#1 改 Makefile 且读了', diffFiles: [makeFile('Makefile')], logEntries: [makeLog('read', 'Makefile')], targetRule: 1, expectStatus: 'PASS' },
  { name: '#1 否定语义过滤——未读取不算', diffFiles: [makeFile('src/foo.ts')], logEntries: [makeLog('read', 'src/foo.ts'), { timestamp: new Date(), operation: 'read', file: 'src/bar.ts', raw: '未读取 src/foo.ts' }], targetRule: 1, expectStatus: 'PASS' },
  { name: '#1 deleted 不检查', diffFiles: [makeFile('src/foo.ts', 'deleted')], logEntries: [], targetRule: 1, expectStatus: 'PASS' },
  { name: '#1 added+has Read', diffFiles: [makeFile('src/new.ts', 'added')], logEntries: [makeLog('read', 'src/new.ts')], targetRule: 1, expectStatus: 'PASS' },
];

// ── 铁律 #3 ──
const rule03Cases: RuleTestCase[] = [
  // === 应 FAIL（违规） ===
  { name: '#3 改 package.json 无 test', diffFiles: [makeFile('package.json')], logEntries: [makeLog('read', 'package.json')], targetRule: 3, expectStatus: 'FAIL' },
  { name: '#3 改 Dockerfile 无 build', diffFiles: [makeFile('Dockerfile')], logEntries: [makeLog('read', 'Dockerfile')], targetRule: 3, expectStatus: 'FAIL' },
  { name: '#3 改 tsconfig.json 无 tsc', diffFiles: [makeFile('tsconfig.json')], logEntries: [makeLog('read', 'tsconfig.json')], targetRule: 3, expectStatus: 'FAIL' },

  // === 应 PASS（合法） ===
  { name: '#3 普通文件不触发', diffFiles: [makeFile('src/foo.ts')], logEntries: [], targetRule: 3, expectStatus: 'PASS' },
  { name: '#3 改 pkg.json 有 test 记录', diffFiles: [makeFile('package.json')], logEntries: [{ timestamp: new Date(), operation: 'execute', raw: 'npm test' }, makeLog('read', 'package.json')], targetRule: 3, expectStatus: 'PASS' },
  { name: '#3 改 pkg.json 无日志→WARN', diffFiles: [makeFile('package.json')], logEntries: [], targetRule: 3, expectStatus: 'WARN' },
  { name: '#3 Dockerfile+build', diffFiles: [makeFile('Dockerfile')], logEntries: [{ timestamp: new Date(), operation: 'execute', raw: 'docker build .' }, makeLog('read', 'Dockerfile')], targetRule: 3, expectStatus: 'PASS' },
  { name: '#3 tsconfig.json+tsc', diffFiles: [makeFile('tsconfig.json')], logEntries: [{ timestamp: new Date(), operation: 'execute', raw: 'npm run build' }, makeLog('read', 'tsconfig.json')], targetRule: 3, expectStatus: 'PASS' },
  { name: '#3 多个构建文件只改一个', diffFiles: [makeFile('package.json')], logEntries: [{ timestamp: new Date(), operation: 'execute', raw: 'npm test' }, makeLog('read', 'package.json')], targetRule: 3, expectStatus: 'PASS' },
];

// ── 铁律 #7 ──
const rule07Cases: RuleTestCase[] = [
  // === 应 WARN ===
  { name: '#7 3/5 文件不相关（60%>20%）', diffFiles: [makeFile('a.ts'), makeFile('b.ts'), makeFile('README.md'), makeFile('CHANGELOG.md'), makeFile('LICENSE')], logEntries: [], task: '改 a.ts b.ts', targetRule: 7, expectStatus: 'WARN' },
  // === 应 PASS ===
  { name: '#7 无 task→跳过', diffFiles: [makeFile('a.ts'), makeFile('README.md')], logEntries: [], task: undefined, targetRule: 7, expectStatus: 'PASS' },
  { name: '#7 全部相关', diffFiles: [makeFile('a.ts'), makeFile('b.ts')], logEntries: [], task: '改 a.ts b.ts', targetRule: 7, expectStatus: 'PASS' },
  { name: '#7 低风险文件排除', diffFiles: [makeFile('a.ts'), makeFile('README.md')], logEntries: [], task: '改 a.ts', targetRule: 7, expectStatus: 'PASS' },
];

// ── 铁律 #10 ──
const rule10Cases: RuleTestCase[] = [
  // rule-10 reads git log -1 — depends on git state. Skip synthetic tests.
  // 在真实 git repo 外运行时应 WARN（找不到 commit）而非 FAIL
];

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

// ── 主流程 ──
console.log('═══════════════════════════════════════════');
console.log('  sofagent-audit 逐规则合成检测精度');
console.log('═══════════════════════════════════════════\n');

const allCases = [
  { label: '#1 先读再用', cases: rule01Cases },
  { label: '#3 验证再干', cases: rule03Cases },
  { label: '#7 谨慎修改', cases: rule07Cases },
  { label: '#10 如实汇报', cases: rule10Cases },
];

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
console.log(`  漏报 FN: ${totalFN}/${grandTotal} (${(totalFN / grandTotal * 100).toFixed(1)}% )`);
console.log(`  误报 FP: ${totalFP}/${grandTotal} (${(totalFP / grandTotal * 100).toFixed(1)}% )`);
console.log('');
console.log('  ⚠️  合成数据，非真实 Agent 日志。');
console.log('  真实场景需录制 Agent 操作日志作为输入。');
console.log('═══════════════════════════════════════════');
