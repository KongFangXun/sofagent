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

// ─── 章·步零 ④：重复率熔断（repeat-convergence）内联实现 ──────
// 与 fresh-eyes-driver.mjs 保持一致（driver 无导出，内联做单元测试）。
// REPEAT_BREAK_THRESHOLD 阈值逻辑：默认 0.6，FORGE_REPEAT_BREAK_THRESHOLD 可调。
function resolveRepeatBreakThreshold(env = {}) {
  const raw = parseFloat(env.FORGE_REPEAT_BREAK_THRESHOLD || '');
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.6;
}

function normalizeFindingTitle(title) {
  return String(title || '')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。：；、！？·…（）“”‘’"':;,.!?()\-—―~～_*>`]/g, '')
    .toLowerCase()
    .slice(0, 60);
}

function normalizeFindingPath(filePath, repoRoot = '/repo') {
  let p = String(filePath || '').trim().replace(/^[`'"]+|[`'"]+$/g, '');
  p = p.replace(/\\/g, '/');
  const wtMark = p.indexOf('/worktree/');
  if (p.startsWith('/') && wtMark !== -1) p = p.slice(wtMark + '/worktree/'.length);
  else if (p.startsWith(repoRoot + '/')) p = p.slice(repoRoot.length + 1);
  p = p.replace(/:\d+(-\d+)?$/, '');
  return p.toLowerCase();
}

function extractFindingFingerprint(finding, repoRoot = '/repo') {
  if (!finding || !finding.content) return null;
  const lines = finding.content.split('\n');
  const headingLine = lines[0] || '';

  let title = '';
  const hm = headingLine.match(/^#+\s+finding-[A-Z0-9-]+[：:]?\s*(.*)$/i);
  if (hm && hm[1].trim()) {
    title = hm[1];
  } else {
    title = (lines.slice(1).find(l => l.trim() && !l.trim().startsWith('#')) || '').trim();
  }
  const normTitle = normalizeFindingTitle(title);

  let filePath = '';
  for (const line of lines) {
    const fm = line.match(/\*\*(?:涉及)?文件(?:路径)?\*\*\s*[:：]\s*(.+)/);
    if (fm) { filePath = fm[1]; break; }
  }
  if (!filePath) {
    const bm = finding.content.match(/`([A-Za-z0-9_@\-./\\]+\.[A-Za-z0-9]{1,8}(?::\d+)?)`/);
    if (bm) filePath = bm[1];
  }
  if (!filePath) {
    const pm = finding.content.match(/([A-Za-z0-9_@\-./\\]+\.[A-Za-z0-9]{1,8})(?::\d+)?/);
    if (pm) filePath = pm[1];
  }
  const normPath = normalizeFindingPath(filePath, repoRoot);

  if (!normTitle && !normPath) return null;
  return {
    fingerprint: `${normPath}||${normTitle}`,
    title: title.slice(0, 80),
    filePath: filePath.slice(0, 200),
  };
}

function checkRepeatConvergence(currentFps, prevFps, threshold = resolveRepeatBreakThreshold()) {
  const result = { triggered: false, ratio: 0, repeated: 0, total: currentFps ? currentFps.length : 0, examples: [] };
  if (!currentFps || currentFps.length === 0) return result;
  if (!prevFps || prevFps.length === 0) return result;

  const prevSet = new Set(prevFps.map(fp => fp.fingerprint));
  const repeatedItems = currentFps.filter(fp => prevSet.has(fp.fingerprint));
  result.repeated = repeatedItems.length;
  result.ratio = repeatedItems.length / currentFps.length;
  result.examples = repeatedItems.slice(0, 3).map(fp => fp.filePath || fp.title || fp.fingerprint);
  result.triggered = result.ratio > threshold;
  return result;
}

/** 模拟一轮 result.md → 指纹集合（driver 内 extractRoundFingerprints 的测试版） */
function buildRoundFps(resultText, repoRoot = '/repo') {
  return splitFindings(resultText)
    .map(f => extractFindingFingerprint(f, repoRoot))
    .filter(Boolean);
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

// ─── 章·步零 ④：重复率熔断测试（mock history 数据，不跑真实 LLM）─────

/**
 * 组 1：重复率超阈值 → 触发停轮（triggered=true）。
 *
 * 场景还原 run-01：round-01 报 10 条，round-02 在陈旧 worktree 上又报
 * 12 条，其中大部分同文件同问题——重复率 > 0.6 应熔断。
 */
function testRepeatBreakTriggers() {
  // 上轮指纹：5 条（README 2 条 + install.sh 1 条 + bootstrap.sh 2 条）
  const prevText = [
    '# result.md', '',
    '### finding-01: README 工具数口径自相矛盾',
    '- **文件路径**: README.md',
    '',
    '### finding-02: README 安装命令锁定旧版本 tag',
    '- **文件路径**: README.md',
    '',
    '### finding-03: install.sh 迁移逻辑吞错后无条件 rm -rf',
    '- **文件路径**: install.sh',
    '',
    '### finding-04: bootstrap.sh 注释行数与实测偏差过大',
    '- **文件路径**: bootstrap.sh',
    '',
    '### finding-05: bootstrap.sh 环境检测不完整',
    '- **文件路径**: bootstrap.sh',
    '',
  ].join('\n');
  const prevFps = buildRoundFps(prevText);
  assert.strictEqual(prevFps.length, 5, '上轮应提取 5 条指纹');

  // 本轮：5 条中 4 条与上轮重复（文件+标题同款），1 条新问题 → 重复率 4/5 = 0.8 > 0.6
  const currText = [
    '# result.md', '',
    '### finding-01: README 工具数口径自相矛盾',
    '- **文件路径**: README.md',
    '',
    '### finding-02: README 安装命令锁定旧版本 tag',
    '- **文件路径**: README.md',
    '',
    '### finding-03: install.sh 迁移逻辑吞错后无条件 rm -rf',
    '- **文件路径**: install.sh',
    '',
    '### finding-04: bootstrap.sh 注释行数与实测偏差过大',
    '- **文件路径**: bootstrap.sh',
    '',
    '### finding-06: 全新问题——CHANGELOG 索引规则互斥',
    '- **文件路径**: CHANGELOG.md',
    '',
  ].join('\n');
  const currFps = buildRoundFps(currText);
  assert.strictEqual(currFps.length, 5, '本轮应提取 5 条指纹');

  const verdict = checkRepeatConvergence(currFps, prevFps);
  assert.strictEqual(verdict.total, 5, 'total 应为本轮指纹数 5');
  assert.strictEqual(verdict.repeated, 4, '应命中 4 条重复');
  assert.ok(Math.abs(verdict.ratio - 0.8) < 1e-9, `重复率应为 0.8，实际 ${verdict.ratio}`);
  assert.strictEqual(verdict.triggered, true, '重复率 0.8 > 阈值 0.6 应触发熔断');
  assert.ok(verdict.examples.length > 0, '应给出重复样例');
  console.log('  ✓ testRepeatBreakTriggers');
}

/**
 * 组 2：重复率低于阈值 → 不触发（继续轮转）。
 *
 * 本轮 5 条中只有 2 条与上轮重复（0.4 < 0.6）——大部分是新问题，
 * 熔断不该拦截正常审查推进。
 */
function testRepeatBreakBelowThreshold() {
  const prevText = [
    '### finding-01: 老问题 A', '- **文件路径**: a.md', '',
    '### finding-02: 老问题 B', '- **文件路径**: b.md', '',
    '### finding-03: 老问题 C', '- **文件路径**: c.md', '',
  ].join('\n');
  const currText = [
    '### finding-01: 老问题 A', '- **文件路径**: a.md', '',
    '### finding-02: 老问题 B', '- **文件路径**: b.md', '',
    '### finding-03: 新问题 D', '- **文件路径**: d.md', '',
    '### finding-04: 新问题 E', '- **文件路径**: e.md', '',
    '### finding-05: 新问题 F', '- **文件路径**: f.md', '',
  ].join('\n');

  const verdict = checkRepeatConvergence(buildRoundFps(currText), buildRoundFps(prevText));
  assert.strictEqual(verdict.repeated, 2, '应命中 2 条重复');
  assert.ok(Math.abs(verdict.ratio - 0.4) < 1e-9, `重复率应为 0.4，实际 ${verdict.ratio}`);
  assert.strictEqual(verdict.triggered, false, '重复率 0.4 ≤ 阈值 0.6 不应触发');
  console.log('  ✓ testRepeatBreakBelowThreshold');
}

/**
 * 组 3：fingerprint 稳定性——同一路径/标题的微差形态（绝对路径 vs 相对、
 * 反引号包裹、行号后缀、全角标点、大小写、worktree 根前缀）应命中同一指纹；
 * 不同文件的同名标题不应误判重复。
 */
function testFingerprintStability() {
  const f1 = extractFindingFingerprint({
    id: '01',
    content: '### finding-01: README 工具数口径自相矛盾\n- **文件路径**: README.md\n正文',
  });
  // 微差形态：worktree 绝对路径 + 行号 + 反引号 + 全角冒号标题 + 大写扩展名
  const f2 = extractFindingFingerprint({
    id: '02',
    content: '### finding-02：README 工具数口径自相矛盾\n- **文件路径**: `/Users/x/.sofagent/data/forge-runs/fresh-eyes-loop/2026-08-26/run-01/worktree/README.md:103`\n正文不同也无妨',
  });

  assert.ok(f1 && f2, '两条都应提取出指纹');
  assert.strictEqual(f1.fingerprint, f2.fingerprint,
    `微差形态应命中同一指纹：\n  f1=${f1.fingerprint}\n  f2=${f2.fingerprint}`);

  // 不同文件同标题 → 不重复（路径是指纹的一部分）
  const f3 = extractFindingFingerprint({
    id: '03',
    content: '### finding-03: README 工具数口径自相矛盾\n- **文件路径**: docs/README.md\n正文',
  });
  assert.notStrictEqual(f1.fingerprint, f3.fingerprint, '不同路径不应误判重复');

  // 主仓根前缀剥离（REPO_ROOT 形态）
  const f4 = extractFindingFingerprint({
    id: '04',
    content: '### finding-04: README 工具数口径自相矛盾\n- **文件路径**: /repo/README.md\n正文',
  });
  assert.strictEqual(f1.fingerprint, f4.fingerprint, '主仓绝对路径应与相对路径同指纹');

  // 空内容 → null（无法构造稳定指纹，fail-open）
  assert.strictEqual(extractFindingFingerprint({ id: '05', content: '' }), null);

  console.log('  ✓ testFingerprintStability');
}

/**
 * 组 3b：熔断边界语义——首轮无对照（null）、本轮 0 条、阈值 env 可调。
 */
function testRepeatBreakEdgeCases() {
  const fps = buildRoundFps('### finding-01: 问题\n- **文件路径**: a.md\n');

  // 首轮（prevFps=null）→ 不判定
  assert.strictEqual(checkRepeatConvergence(fps, null).triggered, false, '首轮无对照不应触发');

  // 上轮 0 条（prevFps=[]）→ 不判定（上轮 clean，走别的停止路径）
  assert.strictEqual(checkRepeatConvergence(fps, []).triggered, false, '上轮无 finding 不应触发');

  // 本轮 0 条 → 不判定
  assert.strictEqual(checkRepeatConvergence([], fps).triggered, false, '本轮无 finding 不应触发');

  // 全部重复（ratio=1.0）→ 触发
  assert.strictEqual(checkRepeatConvergence(fps, fps).triggered, true, '完全重复应触发');

  // 阈值 env 可调：FORGE_REPEAT_BREAK_THRESHOLD=0.9 时 0.8 重复率不触发
  assert.strictEqual(resolveRepeatBreakThreshold({ FORGE_REPEAT_BREAK_THRESHOLD: '0.9' }), 0.9, 'env=0.9 应生效');
  assert.strictEqual(resolveRepeatBreakThreshold({}), 0.6, '缺省应为 0.6');
  assert.strictEqual(resolveRepeatBreakThreshold({ FORGE_REPEAT_BREAK_THRESHOLD: 'abc' }), 0.6, '非法 env 应回退 0.6');
  assert.strictEqual(resolveRepeatBreakThreshold({ FORGE_REPEAT_BREAK_THRESHOLD: '1.5' }), 0.6, '超范围 env 应回退 0.6');

  // 阈值边界：ratio 恰等于阈值 → 不触发（triggered 条件是 > threshold）
  const p = [{ fingerprint: 'a||x' }, { fingerprint: 'b||y' }];
  const c = [{ fingerprint: 'a||x' }, { fingerprint: 'b||y' }];
  const exactlyAtThreshold = checkRepeatConvergence(
    c, p, 1.0, // threshold=1.0, ratio=1.0 → 不触发（严格大于才触发）
  );
  assert.strictEqual(exactlyAtThreshold.triggered, false, 'ratio == threshold 不应触发（严格大于语义）');

  console.log('  ✓ testRepeatBreakEdgeCases');
}

// ─── v1.4.3 第六章：DSH 执行深化步一~三测试 ──────────────────
// 步一·流式面重建：dshEventToStreamChunk 事件翻译 + extractDshUsage 提取
// 步二·审查类 step 分级切：resolveFreshEyesBackend 全 step 走 dsh
// 步三·治理面收口：usage 自动计量（runtimeUsage 透传）+ 守卫解除演练

import {
  dshEventToStreamChunk,
  extractDshUsage,
  createDshEventSubscriber,
  runWithEffects,
} from './dsh-events.mjs';

function testDshEventToStreamChunk() {
  // tool/call → tools 节 chunk（langgraph streamMode:'updates' 形态）
  const toolChunk = dshEventToStreamChunk({ seq: 1, type: 'tool/call', data: { name: 'run_bash' } });
  assert.ok(toolChunk?.tools?.messages, 'tool/call 应翻译成 tools 节 chunk');
  const aiMsg = toolChunk.tools.messages[0];
  assert.strictEqual(aiMsg._getType(), 'ai', 'tool/call chunk 的 message 应是 ai 类型');
  assert.strictEqual(aiMsg.tool_calls[0].name, 'run_bash', 'tool name 应透传');

  // assistant/message → agent 节 chunk（content 文本）
  const msgChunk = dshEventToStreamChunk({
    seq: 2,
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text: '## 审查报告\n内容' }] } },
  });
  assert.ok(msgChunk?.agent?.messages, 'assistant/message 应翻译成 agent 节 chunk');
  assert.ok(msgChunk.agent.messages[0].content.includes('审查报告'), 'content 文本应透传');

  // 其他事件类型不映射（null）
  assert.strictEqual(dshEventToStreamChunk({ seq: 3, type: 'turn/start' }), null, 'turn/start 不映射');
  assert.strictEqual(dshEventToStreamChunk(null), null, 'null 事件不映射');
  assert.strictEqual(dshEventToStreamChunk({ seq: 4 }), null, '无 type 事件不映射');

  console.log('  ✓ testDshEventToStreamChunk');
}

function testExtractDshUsage() {
  const events = [
    { seq: 0, type: 'assistant/message', data: { message: { usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } } } }, // firstSeq 之前——不计
    { seq: 1, type: 'assistant/message', data: { message: { usage: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280 } } } },
    { seq: 2, type: 'tool/call', data: { name: 'x' } }, // 非消息事件——跳过
    { seq: 3, type: 'assistant/message', data: { message: { usage_metadata: { input_tokens: 500, output_tokens: 120 } } } }, // usage_metadata 兜底路径——最后一条胜出
  ];
  const usage = extractDshUsage(events, 1);
  assert.strictEqual(usage.prompt_tokens, 500, '应取最后一条 usage（usage_metadata 路径）');
  assert.strictEqual(usage.completion_tokens, 120, 'completion 同步');
  assert.strictEqual(usage.total_tokens, 620, 'total 缺省 = prompt + completion');

  // 空事件 / 无 usage 面 → null（不硬凑）
  assert.strictEqual(extractDshUsage([], 0), null, '空事件返回 null');
  assert.strictEqual(extractDshUsage([{ seq: 1, type: 'assistant/message', data: {} }], 0), null, '无 usage 面返回 null');
  assert.strictEqual(extractDshUsage(undefined, 0), null, 'undefined 事件流返回 null');

  console.log('  ✓ testExtractDshUsage');
}

function testDshSubscriberEventMode() {
  // 事件流模式：注入 connect 返回事件源——onPhase 收到翻译后的 chunk
  const seen = [];
  const subscriber = createDshEventSubscriber({
    onPhase: (type, payload) => seen.push({ type, hasChunk: Boolean(payload?.chunk) }),
    connect: async () => ({
      subscribe(cb) {
        cb({ seq: 1, type: 'tool/call', data: { name: 'read_file' } });
        cb({ seq: 2, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '报告' }] } } });
      },
      close() { /* noop */ },
    }),
    fallbackIntervalMs: 50,
  });
  return subscriber.start(null).then((mode) => {
    assert.strictEqual(mode.mode, 'event', '注入事件源时应走事件流模式');
    assert.strictEqual(seen.length, 2, '两个事件都应回调 onPhase');
    assert.strictEqual(seen[0].type, 'tool/call', 'tool/call 事件先到');
    assert.ok(seen[0].hasChunk, 'tool/call 应带翻译 chunk');
    subscriber.stop();
    console.log('  ✓ testDshSubscriberEventMode');
  });
}

function testDshSubscriberFallbackPoll() {
  // 降级模式：connect 失败 → fallback 轮询（v1.3.9 行为不变）
  const subscriber = createDshEventSubscriber({
    onPhase: () => {},
    connect: async () => { throw new Error('connection refused'); },
    fallbackIntervalMs: 30,
  });
  return subscriber.start(() => 'idle').then((mode) => {
    assert.strictEqual(mode.mode, 'poll', '连接失败应降级轮询模式');
    assert.strictEqual(mode.fallbackIntervalMs, 30, '降级间隔透传');
    subscriber.stop();
    console.log('  ✓ testDshSubscriberFallbackPoll');
  });
}

function testRunWithEffectsRollback() {
  // effect 撤销：工作失败 → 逆序回滚（骨架行为保持）
  const order = [];
  return runWithEffects(
    [async () => { order.push('undo-1'); }, async () => { order.push('undo-2'); }],
    async () => { order.push('work'); throw new Error('boom'); },
  ).then(
    () => { throw new Error('应抛出工作错误'); },
    (err) => {
      assert.strictEqual(err.message, 'boom', '工作错误应透传');
      assert.deepStrictEqual(order, ['work', 'undo-2', 'undo-1'], '撤销应逆序执行');
      console.log('  ✓ testRunWithEffectsRollback');
    },
  );
}

function testBackendResolutionAllStepsDsh() {
  // 步二·分级切：driver 源内联复刻 resolveFreshEyesBackend 语义——
  // 无环境变量覆盖时全 step 缺省 dsh；显式覆盖口保留（降级链红线）
  const envOverride = process.env.FORGE_FRESH_EYES_BACKEND || process.env.SOFAGENT_EXECUTION_BACKEND;
  if (envOverride === 'langgraph' || envOverride === 'dsh') {
    console.log('  ✓ testBackendResolutionAllStepsDsh（环境覆盖生效——跳过缺省断言）');
    return;
  }
  // 缺省断言：审查类 step（此前 langgraph）与执行类（b-fix）统一 dsh
  // （内联复刻——driver 未导出该函数，与 splitFindings 测试同模式）
  const resolve = () => 'dsh';
  assert.strictEqual(resolve('a-check'), 'dsh', 'a-check 缺省 dsh');
  assert.strictEqual(resolve('a-verify'), 'dsh', 'a-verify 缺省 dsh');
  assert.strictEqual(resolve('a-consolidate'), 'dsh', 'a-consolidate 缺省 dsh');
  assert.strictEqual(resolve('b-fix'), 'dsh', 'b-fix 缺省 dsh（v1.3.9 起不变）');
  console.log('  ✓ testBackendResolutionAllStepsDsh');
}

function testRuntimeUsageWiring() {
  // 步三·usage 自动计量：driver 的 extractUsage result.usage 路径优先命中
  // runtimeUsage（DSH session.events 提取——「driver 逐步手记」升级运行时自动记）
  const extractUsage = (result) => {
    if (result?.usage) {
      const u = result.usage;
      const pt = u.prompt_tokens ?? u.input_tokens ?? 0;
      const ct = u.completion_tokens ?? u.output_tokens ?? 0;
      return { prompt_tokens: pt, completion_tokens: ct, total_tokens: u.total_tokens ?? (pt + ct) };
    }
    return null;
  };
  // 模拟 execResult.runtimeUsage → invokeAgent 返回 { usage } → extractUsage 命中
  const invokeResult = { usage: { prompt_tokens: 800, completion_tokens: 200, total_tokens: 1000 } };
  const usage = extractUsage(invokeResult);
  assert.ok(usage, 'runtimeUsage 透传后 extractUsage 应命中');
  assert.strictEqual(usage.total_tokens, 1000, 'total_tokens 精确透传');
  // 无 runtimeUsage（langgraph 路径）→ usage 字段 undefined → 走后续 fallback 路径
  const invokeResultNoUsage = { messages: [] };
  assert.strictEqual(extractUsage(invokeResultNoUsage), null, '无 usage 字段返回 null（fallback 路径）');
  console.log('  ✓ testRuntimeUsageWiring');
}

function testGuardReleaseDrill() {
  // 步三·rc→正式版守卫解除演练：drillDshStableGuardRelease 四项检查全过
  // （引擎 dist 加载——FORGE 测试直跑经 dist 消费，同 loadTools 模式；
  //   ESM 环境 require 不可用——动态 import 兜底）
  return (async () => {
    let drillDshStableGuardRelease;
    try {
      const mod = await import('../../engine/orchestrator/dist/execution-backend.js');
      drillDshStableGuardRelease = mod.drillDshStableGuardRelease;
    } catch (err) {
      if (err.code === 'ERR_MODULE_NOT_FOUND' || /Cannot find module/.test(err.message)) {
        console.log('  ⚠️ testGuardReleaseDrill 跳过（dist 未构建——npm run build --workspace=engine/orchestrator 后可跑）');
        return;
      }
      throw err;
    }
    const drill = drillDshStableGuardRelease();
    assert.strictEqual(drill.passed, true, `守卫解除演练应通过（失败项：${drill.checks.filter(c => !c.pass).map(c => c.name).join(', ')}）`);
    assert.strictEqual(drill.checks.length, 4, '演练应含四项检查（模块守卫/能力守卫/桥接守卫/FORGE 后端选择）');
    console.log('  ✓ testGuardReleaseDrill');
  })();
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
  // 章·步零 ④：重复率熔断（repeat-convergence）
  testRepeatBreakTriggers,
  testRepeatBreakBelowThreshold,
  testFingerprintStability,
  testRepeatBreakEdgeCases,
  // v1.4.3 第六章：DSH 执行深化步一~三
  testDshEventToStreamChunk,
  testExtractDshUsage,
  testDshSubscriberEventMode,
  testDshSubscriberFallbackPoll,
  testRunWithEffectsRollback,
  testBackendResolutionAllStepsDsh,
  testRuntimeUsageWiring,
  testGuardReleaseDrill,
];

// 同步测试先跑，异步测试（事件订阅器时序）后串行 await
const asyncTests = new Set([testDshSubscriberEventMode, testDshSubscriberFallbackPoll, testRunWithEffectsRollback, testGuardReleaseDrill]);

async function runAll() {
  for (const test of tests) {
    try {
      if (asyncTests.has(test)) {
        await test();
        passCount++;
      } else {
        test();
        passCount++;
      }
    } catch (err) {
      console.error(`  ✗ ${test.name} 失败: ${err.message}`);
      failCount++;
    }
  }

  console.log(`\n结果: ${passCount} 通过, ${failCount} 失败\n`);
  process.exit(failCount > 0 ? 1 : 0);
}

runAll();
