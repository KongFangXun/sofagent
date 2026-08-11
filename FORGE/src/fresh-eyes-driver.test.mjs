// ============================================================
// FORGE/src/fresh-eyes-driver.test.mjs
// splitFindings / chunk 单元测试
//
// 用法：node FORGE/src/fresh-eyes-driver.test.mjs
// ============================================================

import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import assert from 'assert';

// testParseStopConditionFallbackForFreeFormHeadings 使用 fs.*Sync 全套 + os.tmpdir()
// 这里 alias 给内部用 fs 命名空间访问的代码
const fs = { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync, statSync };
const os = { tmpdir };

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// ─── 内联被测函数（与 fresh-eyes-driver.mjs 保持一致）────────
// driver 没有导出，这里内联一份以做单元测试。
// 如果 driver 的 splitFindings 变了，这里也要同步。
function splitFindings(resultText) {
  const findings = [];
  // 匹配 ### finding-01 / ### finding-P0-01 / ### finding-P1-02 等格式
  // Accept: pure digits (01) or level-prefixed (P0-01, P1-02)
  const re = /^### finding-([A-Z0-9-]+)[：:]?/gm;
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

/**
 * 测试 splitFindings 支持 finding-P0-01 / finding-P1-02 带级别前缀格式。
 * Test that splitFindings accepts level-prefixed formats like finding-P0-01.
 * 这是 R2-R4 实际产出的格式，修复前会导致切出 0 条 finding。
 */
function testPrefixedFindingFormat() {
  const resultText = `
### finding-P0-01: 问题一
内容一

### finding-P1-02: 问题二
内容二

### finding-03: 问题三
内容三
`;
  const findings = splitFindings(resultText);
  assert.strictEqual(findings.length, 3, '应切出 3 条 finding（含 P0/P1 前缀和纯数字）');
  assert.strictEqual(findings[0].id, 'P0-01', '第 1 条 id 应为 P0-01');
  assert.strictEqual(findings[1].id, 'P1-02', '第 2 条 id 应为 P1-02');
  assert.strictEqual(findings[2].id, '03', '第 3 条 id 应为 03（纯数字）');
  assert.ok(findings[0].content.includes('内容一'), 'finding-P0-01 content 应包含正文');
  assert.ok(findings[1].content.includes('内容二'), 'finding-P1-02 content 应包含正文');
  assert.ok(!findings[0].content.includes('内容二'), 'finding-P0-01 content 不应包含 finding-P1-02 内容');
  console.log('  ✓ testPrefixedFindingFormat');
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

// ─── a-verify 分片逻辑测试 ───────────────────────────────────

/**
 * 模拟 runAVerifySharded 的分批构造逻辑（不实际 spawn worker）。
 *
 * 验证：
 *   1. 输入文件名格式：result-verify-batch-N.md
 *   2. 输出文件名格式：result-verified-batch-N.md
 *   3. 分片输入内容只包含本批的 findings
 *   4. 合并结果包含所有批次
 *   5. finding 切不出时走 fallback
 */
function testAVerifyShardBatchConstruction() {
  const BATCH_SIZE = 5;

  // 构造 12 条 finding 的 result.md
  const lines = ['# result.md', '', '## 修复结果', ''];
  for (let i = 1; i <= 12; i++) {
    lines.push(`### finding-${String(i).padStart(2, '0')}: 问题 ${i}`, `问题 ${i} 的描述`, '');
  }
  const resultText = lines.join('\n');

  const findings = splitFindings(resultText);
  assert.strictEqual(findings.length, 12, '应切出 12 条 finding');

  const batches = chunk(findings, BATCH_SIZE);
  assert.strictEqual(batches.length, 3, '12 条按 5 分批应得 3 批');
  assert.strictEqual(batches[0].length, 5, '第 1 批 5 条');
  assert.strictEqual(batches[1].length, 5, '第 2 批 5 条');
  assert.strictEqual(batches[2].length, 2, '第 3 批 2 条');

  // 验证分片输入文件名和内容
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchNum = i + 1;
    const inputFileName = `result-verify-batch-${batchNum}.md`;
    const outputFileName = `result-verified-batch-${batchNum}.md`;

    // 文件名格式检查
    assert.ok(inputFileName.includes(`batch-${batchNum}`),
      `输入文件名应包含 batch-${batchNum}`);
    assert.ok(outputFileName.includes(`batch-${batchNum}`),
      `输出文件名应包含 batch-${batchNum}`);
    assert.ok(inputFileName.includes('verify'),
      `a-verify 输入文件名应含 verify`);
    assert.ok(outputFileName.includes('verified'),
      `a-verify 输出文件名应含 verified`);

    // 分片内容只包含本批 finding
    const batchContent = batch.map(f => f.content).join('\n\n---\n\n');
    for (const f of batch) {
      assert.ok(batchContent.includes(`finding-${f.id}`),
        `分片 ${batchNum} 应包含 finding-${f.id}`);
    }
    // 验证不包含其他批次的 finding
    for (let j = 0; j < batches.length; j++) {
      if (j === i) continue;
      for (const otherF of batches[j]) {
        assert.ok(!batchContent.includes(`finding-${otherF.id}`),
          `分片 ${batchNum} 不应包含 finding-${otherF.id}`);
      }
    }
  }

  // 验证合并：模拟合并回填 result.md
  const mergedHeader = '# result.md · a-verify 分片合并（已回填 verify 列）';
  const mergedMeta = `> 共 ${batches.length} 批，${findings.length} 条 finding`;
  const fakeBatchResults = batches.map((_, i) => `## 分片 ${i + 1} 验证结果`);
  const mergedResult = [mergedHeader, '', mergedMeta, '', ...fakeBatchResults].join('\n');

  assert.ok(mergedResult.includes(mergedHeader), '合并结果应包含标题');
  assert.ok(mergedResult.includes('3 批'), '合并结果应包含批次数');
  assert.ok(mergedResult.includes('12 条 finding'), '合并结果应包含 finding 总数');
  for (let i = 1; i <= 3; i++) {
    assert.ok(mergedResult.includes(`分片 ${i}`), `合并结果应包含分片 ${i}`);
  }

  console.log('  ✓ testAVerifyShardBatchConstruction');
}

/**
 * 验证 a-verify 分片 fallback：result.md 无 finding 标记 → 单 session。
 */
function testAVerifyShardFallback() {
  const resultText = '# result.md\n\n## 修复结果\n\n一些没有 finding 标记的文本\n';
  const findings = splitFindings(resultText);
  assert.strictEqual(findings.length, 0, '无 finding 标记应返回空数组');

  // 模拟 runAVerifySharded 的 fallback 判断
  const shouldFallback = findings.length === 0;
  assert.ok(shouldFallback, 'findings 为空时应触发 fallback');

  console.log('  ✓ testAVerifyShardFallback');
}

/**
 * 验证 a-verify 分片的单批失败不中断（容错）。
 *
 * 模拟 3 批，第 2 批失败，验证最终仍合并所有结果（失败的批写错误信息）。
 */
function testAVerifyShardBatchFailure() {
  const BATCH_SIZE = 5;

  const lines = ['# result.md', ''];
  for (let i = 1; i <= 12; i++) {
    lines.push(`### finding-${String(i).padStart(2, '0')}: 问题 ${i}`, `内容 ${i}`, '');
  }
  const findings = splitFindings(lines.join('\n'));
  const batches = chunk(findings, BATCH_SIZE);

  const batchResults = [];
  // 模拟第 2 批失败
  for (let i = 0; i < batches.length; i++) {
    const batchNum = i + 1;
    if (batchNum === 2) {
      batchResults.push(
        `## 分片 ${batchNum} 验证失败\n\n` +
        `错误: worker a-verify 退出码 1\n\n` +
        `涉及 finding: ${batches[i].map(f => f.id).join(', ')}\n`
      );
    } else {
      batchResults.push(`## 分片 ${batchNum} 验证结果\n\n成功验证 ${batches[i].length} 条`);
    }
  }

  // 合并
  const mergedResult = [
    '# result.md · a-verify 分片合并',
    '',
    `> 共 ${batches.length} 批，${findings.length} 条 finding`,
    '',
    ...batchResults,
  ].join('\n');

  // 失败的批被保留，不中断
  assert.ok(mergedResult.includes('分片 2 验证失败'), '合并结果应包含失败分片信息');
  assert.ok(mergedResult.includes('worker a-verify 退出码 1'), '应保留错误信息');
  assert.ok(mergedResult.includes('分片 1 验证结果'), '成功批 1 应在合并结果中');
  assert.ok(mergedResult.includes('分片 3 验证结果'), '成功批 3 应在合并结果中');

  console.log('  ✓ testAVerifyShardBatchFailure');
}

/**
 * 验证 a-verify 分片大小恰好整除（无尾批）。
 */
function testAVerifyShardExactDivision() {
  const BATCH_SIZE = 5;
  const lines = ['# result.md', ''];
  for (let i = 1; i <= 10; i++) {
    lines.push(`### finding-${String(i).padStart(2, '0')}: 问题 ${i}`, `内容 ${i}`, '');
  }
  const findings = splitFindings(lines.join('\n'));
  const batches = chunk(findings, BATCH_SIZE);

  assert.strictEqual(batches.length, 2, '10 条按 5 分批应得 2 批');
  assert.strictEqual(batches[0].length, 5);
  assert.strictEqual(batches[1].length, 5);

  console.log('  ✓ testAVerifyShardExactDivision');
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

// 🔴 v1.3.2 run-11 回归测试：worker 用 "### 1. xxx" 自由编号（splitFindings 切 0 条）时，
// parseStopCondition 必须走 fallback 路径，不能误判 isClean=true。
// 复现场景：worker 不按 "### finding-XXX" 格式写，driver 旧逻辑会 P0/P1 全 0 → 假阳性 clean。
function testParseStopConditionFallbackForFreeFormHeadings() {
  const tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'fe-fallback-'));
  try {
    // 复刻 driver 里 parseStopCondition 的 fallback 逻辑（splitFindings 切 0 条时的回退路径）。
    // 注意：driver 没 export 这些函数（main 是无条件触发的，import 会跑 main），
    // 测试必须内联实现 —— 与文件头 splitFindings 同理：driver 改了 fallback 这里也要同步。
    const resultMd = `# result.md · a-verify 分片合并（已回填 verify 列）

## 📊 发现统计

| 优先级 | 数量 | 说明 |
|--------|------|------|
| **P0** | 1 | 严重缺陷导致核心功能不可用（阻塞） |
| **P1** | 2 | 应该修复的问题 |
| **P2** | 1 | 观察项 |

## 🔴 P0 阻塞项

### 1. CLI 核心入口文件缺失
- 内容...
`;
    writeFileSync(join(tmpDir, 'result.md'), resultMd);

    // 内联 parseStopCondition 的 fallback 段（与 fresh-eyes-driver.mjs:parseStopCondition 同步）
    const findingsList = splitFindings(resultMd);  // 自由编号会切 0 条
    assert.strictEqual(findingsList.length, 0, '前置条件：自由编号格式 splitFindings 必须切 0 条');

    // fallback 路径（与 driver 同一段逻辑）
    let p0 = 0, p1 = 0, p2 = 0;
    for (const text of [resultMd]) {
      const p0TableMatches = text.match(/\|\s*\**P0\**\s*\|/gi) || [];
      const p1TableMatches = text.match(/\|\s*\**P1\**\s*\|/gi) || [];
      const p2TableMatches = text.match(/\|\s*\**P2\**\s*\|/gi) || [];
      const p0HeadingMatches = text.match(/^#{1,4}\s+.*\bP0\b/gm) || [];
      const p1HeadingMatches = text.match(/^#{1,4}\s+.*\bP1\b/gm) || [];
      p0 += Math.max(p0TableMatches.length, p0HeadingMatches.length);
      p1 += Math.max(p1TableMatches.length, p1HeadingMatches.length);
      p2 += p2TableMatches.length;
    }
    const isClean = (p0 === 0 && p1 === 0 && p2 === 0);

    // 关键断言：fallback 必须能数到 P0/P1（旧逻辑因为 splitFindings 返回空直接判 isClean=true 是 bug）
    assert.ok(!isClean,
      `自由编号格式不应被误判 isClean=true，但 fallback 计数 P0=${p0} P1=${p1} P2=${p2} 全 0`);
    assert.ok(p0 >= 1,
      `P0 计数应 ≥ 1（表格里有 | **P0** | 1 |），实际 P0=${p0}`);
    assert.ok(p1 >= 1,
      `P1 计数应 ≥ 1（表格里有 | **P1** | 2 |），实际 P1=${p1}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  console.log('  ✓ testParseStopConditionFallbackForFreeFormHeadings');
}

// ─── 运行测试 ────────────────────────────────────────────────
console.log('\n🧪 fresh-eyes-driver splitFindings / chunk / a-verify 分片单元测试\n');

let passCount = 0;
let failCount = 0;

const tests = [
  testBasicSplit,
  testPrefixedFindingFormat,
  testEmptyInput,
  testNoFindings,
  testChunk,
  testChunkExactDivision,
  testChunkEmpty,
  // a-verify 分片逻辑测试
  testAVerifyShardBatchConstruction,
  testAVerifyShardFallback,
  testAVerifyShardBatchFailure,
  testAVerifyShardExactDivision,
  testRealResultMd,
  // v1.3.2 run-11 回归：parseStopCondition fallback for 自由编号格式
  testParseStopConditionFallbackForFreeFormHeadings,
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
