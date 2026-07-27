// ============================================================
// FORGE/src/fresh-eyes-driver.test.mjs
// splitFindings / chunk 单元测试
//
// 用法：node FORGE/src/fresh-eyes-driver.test.mjs
// ============================================================

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// ─── 内联被测函数（与 fresh-eyes-driver.mjs 保持一致）────────
// driver 没有导出，这里内联一份以做单元测试。
// 如果 driver 的 splitFindings 变了，这里也要同步。
function splitFindings(resultText) {
  const findings = [];
  const re = /^### finding-(\d+)[：:]?/gm;
  const marks = [];
  let m;
  while ((m = re.exec(resultText)) !== null) {
    marks.push({ id: m[1], start: m.index });
  }

  for (let i = 0; i < marks.length; i++) {
    const end = (i + 1 < marks.length) ? marks[i + 1].start : resultText.length;
    const content = resultText.slice(marks[i].start, end).trimEnd();
    findings.push({ id: marks[i].id, content });
  }

  return findings;
}

function chunk(arr, size) {
  const batches = [];
  for (let i = 0; i < arr.length; i += size) {
    batches.push(arr.slice(i, i + size));
  }
  return batches;
}

// ─── 测试用例 ────────────────────────────────────────────────

function testBasicSplit() {
  const text = [
    '# result.md',
    '',
    '## P0 修复',
    '',
    '### finding-01: 标题 A',
    '内容 A 第一行',
    '内容 A 第二行',
    '',
    '### finding-02: 标题 B',
    '内容 B',
    '',
    '### finding-03',
    '内容 C',
  ].join('\n');

  const findings = splitFindings(text);
  assert.strictEqual(findings.length, 3, '应切出 3 条 finding');
  assert.strictEqual(findings[0].id, '01');
  assert.strictEqual(findings[1].id, '02');
  assert.strictEqual(findings[2].id, '03');
  assert.ok(findings[0].content.includes('finding-01'), 'content 应包含 ### 行');
  assert.ok(findings[0].content.includes('内容 A'), 'content 应包含正文');
  assert.ok(findings[1].content.includes('内容 B'), 'finding-02 content 应包含正文');
  assert.ok(!findings[0].content.includes('内容 B'), 'finding-01 content 不应包含 finding-02 内容');
  console.log('  ✓ testBasicSplit');
}

function testEmptyInput() {
  const findings = splitFindings('');
  assert.strictEqual(findings.length, 0, '空输入应返回空数组');
  console.log('  ✓ testEmptyInput');
}

function testNoFindings() {
  const text = '# result.md\n\n没有 finding 的文本\n\n## P0\n\n一些内容';
  const findings = splitFindings(text);
  assert.strictEqual(findings.length, 0, '无 finding 标记应返回空数组');
  console.log('  ✓ testNoFindings');
}

function testChunk() {
  const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  const batches = chunk(arr, 5);
  assert.strictEqual(batches.length, 3, '13 条按 5 分批应得 3 批');
  assert.deepStrictEqual(batches[0], [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(batches[1], [6, 7, 8, 9, 10]);
  assert.deepStrictEqual(batches[2], [11, 12, 13]);
  console.log('  ✓ testChunk');
}

function testChunkExactDivision() {
  const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const batches = chunk(arr, 5);
  assert.strictEqual(batches.length, 2);
  assert.deepStrictEqual(batches[0], [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(batches[1], [6, 7, 8, 9, 10]);
  console.log('  ✓ testChunkExactDivision');
}

function testChunkEmpty() {
  assert.deepStrictEqual(chunk([], 5), []);
  console.log('  ✓ testChunkEmpty');
}

// ─── 集成测试：用 run-01 实际 result.md 验证 ─────────────────
function testRealResultMd() {
  const realPath = join(
    process.env.HOME,
    '.sofagent/data/forge-runs/fresh-eyes-loop/2026-07-28/run-01/round-01/result.md'
  );

  let text;
  try {
    text = readFileSync(realPath, 'utf-8');
  } catch {
    console.log('  ⊘ testRealResultMd 跳过（找不到实际 result.md）');
    return;
  }

  const findings = splitFindings(text);
  console.log(`  [实际数据] 切出 ${findings.length} 条 finding`);

  // run-01 result.md 应该有 16 条 finding（finding-01 ~ finding-16）
  assert.ok(findings.length >= 14, `run-01 应至少切出 14 条 finding，实际 ${findings.length}`);

  // 验证 id 序列
  const ids = findings.map(f => parseInt(f.id, 10));
  for (let i = 0; i < ids.length; i++) {
    assert.ok(ids[i] >= 1 && ids[i] <= 16, `finding id 应在 1-16 范围内，实际 ${ids[i]}`);
  }

  // 验证分片后每批 5 条
  const batches = chunk(findings, 5);
  console.log(`  [实际数据] 分 ${batches.length} 批，各批大小: ${batches.map(b => b.length).join(', ')}`);

  // 每批内容不含其他批次的 finding
  for (let i = 0; i < batches.length; i++) {
    const batchIds = batches[i].map(f => parseInt(f.id, 10));
    for (const otherBatch of batches) {
      if (otherBatch === batches[i]) continue;
      for (const otherF of otherBatch) {
        assert.ok(!batchIds.includes(parseInt(otherF.id, 10)),
          `批次 ${i + 1} 不应包含其他批次的 finding`);
      }
    }
  }

  console.log('  ✓ testRealResultMd');
}

// ─── 运行测试 ────────────────────────────────────────────────
console.log('\n🧪 fresh-eyes-driver splitFindings / chunk 单元测试\n');

let passCount = 0;
let failCount = 0;

const tests = [
  testBasicSplit,
  testEmptyInput,
  testNoFindings,
  testChunk,
  testChunkExactDivision,
  testChunkEmpty,
  testRealResultMd,
];

for (const test of tests) {
  try {
    test();
    passCount++;
  } catch (err) {
    console.error(`  ✗ ${test.name} 失败: ${err.message}`);
    failCount++;
  }
}

console.log(`\n结果: ${passCount} 通过, ${failCount} 失败\n`);
process.exit(failCount > 0 ? 1 : 0);
