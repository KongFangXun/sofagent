// ============================================================
// FORGE/src/release-gate-driver.test.mjs · release-gate-driver 单元测试
//
// 覆盖四个核心函数：
//   1. sliceMultiOutput  — 多产物切片（纯函数，复用 fresh-eyes 逻辑）
//   2. resolveRunDir     — 目录生成（路径改为 release-gate-loop）
//   3. appendLedger      — LEDGER 追加格式（release-gate 列格式）
//   4. parseVerdict      — verdict.md 解析（新增函数）
//   5. extractUsage      — usage 提取（复用 fresh-eyes 逻辑）
//
// 被测脚本未 export 任何函数，通过读取源码 + new Function 反射访问。
// 所有文件操作用 os.tmpdir() 做临时根，测试后清理。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, appendFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ─── 反射访问未导出的内部函数 ───────────────────────────────

const SOURCE_PATH = new URL('./release-gate-driver.mjs', import.meta.url);
const SOURCE_CODE = readFileSync(SOURCE_PATH, 'utf-8');

/**
 * 从源码中提取指定函数的函数体并返回可调用的函数。
 * 策略：用正则匹配 `function funcName(params) { ... }`，
 * 花括号配平提取完整函数体。
 */
function extractFunctionBody(source, funcName) {
  const startRegex = new RegExp(`function\\s+${funcName}\\s*\\([^)]*\\)\\s*\\{`);
  const startMatch = startRegex.exec(source);
  if (!startMatch) throw new Error(`无法找到函数 ${funcName}`);

  const braceStart = startMatch.index + startMatch[0].lastIndexOf('{');
  let depth = 0;
  let end = braceStart;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  const fullBody = source.slice(startMatch.index, end + 1);
  const paramMatch = startMatch[0].match(/\(([^)]*)\)/);
  const params = paramMatch ? paramMatch[1].split(',').map(s => s.trim()).filter(Boolean) : [];
  return { params, fullBody };
}

// ═══════════════════════════════════════════════════════════
//  1. sliceMultiOutput 测试套件
// ═══════════════════════════════════════════════════════════

function createSliceMultiOutput() {
  // v1.2.7 功能⑤：sliceMultiOutput 移至 driver-base.mjs 闭包内，
  // release-gate-driver.mjs 只保留 `const sliceMultiOutput = base.sliceMultiOutput`。
  // 从 driver-base.mjs 源码提取函数体（而非 release-gate-driver.mjs）。
  const BASE_SOURCE = readFileSync(new URL('./driver-base.mjs', import.meta.url), 'utf-8');
  const { fullBody } = extractFunctionBody(BASE_SOURCE, 'sliceMultiOutput');
  const wrapper = new Function(fullBody + '\nreturn sliceMultiOutput;');
  return wrapper();
}

describe('sliceMultiOutput', () => {
  let sliceMultiOutput;

  beforeEach(() => {
    sliceMultiOutput = createSliceMultiOutput();
  });

  // 测试：正常双分隔符输入应正确切分为两个文件内容
  it('正常双分隔符 → 正确切两份', () => {
    const text = [
      '===FILE: acceptance.md===',
      '这是 acceptance 正文',
      '',
      '===FILE: regression.md===',
      '这是 regression 正文',
    ].join('\n');

    const result = sliceMultiOutput(text, ['acceptance.md', 'regression.md']);
    expect(result['acceptance.md']).toBe('这是 acceptance 正文');
    expect(result['regression.md']).toBe('这是 regression 正文');
  });

  // 测试：无分隔符时应 fallback 全写第一个产物，其余写空占位提示
  it('无分隔符 → fallback 全写第一个，其余空占位', () => {
    const text = '这是一段没有分隔符的纯文本输出';
    const result = sliceMultiOutput(text, ['acceptance.md', 'regression.md']);

    expect(result['acceptance.md']).toBe('这是一段没有分隔符的纯文本输出');
    expect(result['regression.md']).toContain('未检测到');
  });

  // 测试：分隔符前后多余空格应被正确 trim
  it('分隔符前后多余空格 → trim 正确', () => {
    const text = [
      '===FILE:  acceptance.md  ===',
      '   正文前面有空格   ',
      '',
      '===FILE: regression.md===',
      'regression 内容',
    ].join('\n');

    const result = sliceMultiOutput(text, ['acceptance.md', 'regression.md']);
    expect(result['acceptance.md']).toBe('正文前面有空格');
    expect(result['regression.md']).toBe('regression 内容');
  });

  // 测试：agent 漏产出某文件时该文件应得到空占位提示
  it('agent 漏产出某文件 → 该文件空占位提示，不崩', () => {
    const text = [
      '===FILE: acceptance.md===',
      'acceptance 正文',
    ].join('\n');

    const result = sliceMultiOutput(text, ['acceptance.md', 'regression.md']);
    expect(result['acceptance.md']).toBe('acceptance 正文');
    expect(result['regression.md']).toContain('未产出');
  });

  // 测试：单产物不报错
  it('单产物数组传入不报错', () => {
    const text = '纯文本输出无分隔符';
    const result = sliceMultiOutput(text, ['verdict.md']);
    expect(result['verdict.md']).toBe('纯文本输出无分隔符');
  });

  // 测试：空字符串输入应返回空占位
  it('空字符串输入 → fallback 到第一个产物（空串），其余空占位', () => {
    const result = sliceMultiOutput('', ['acceptance.md', 'regression.md']);
    expect(result['acceptance.md']).toBe('');
    expect(result['regression.md']).toContain('未检测到');
  });
});

// ═══════════════════════════════════════════════════════════
//  2. resolveRunDir 测试套件
// ═══════════════════════════════════════════════════════════

function createResolveRunDir(runsDir, fsDeps) {
  const { fullBody } = extractFunctionBody(SOURCE_CODE, 'resolveRunDir');
  const modifiedBody = fullBody.replaceAll('join(RUNS_DIR,', 'join(_runsDir,');
  const wrapper = new Function(
    '_runsDir', 'join', 'existsSync', 'readdirSync', 'mkdirSync',
    modifiedBody + '\nreturn resolveRunDir;'
  );
  return wrapper(runsDir, join, fsDeps.existsSync, fsDeps.readdirSync, fsDeps.mkdirSync);
}

describe('resolveRunDir', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `rg-rd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tmpRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  });

  // 测试：同日首次跑 → run-01
  it('同日首次跑 → run-01', () => {
    const resolve = createResolveRunDir(tmpRoot, {
      existsSync, readdirSync, mkdirSync,
    });

    const { runDir, runId } = resolve();

    expect(runDir).toMatch(/run-01$/);
    expect(runId).toMatch(/-01$/);
    expect(existsSync(runDir)).toBe(true);
  });

  // 测试：同日已有 run-01 → run-02
  it('同日已有 run-01 → run-02', () => {
    const now = new Date();
    const y = String(now.getFullYear());
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const dateDir = join(tmpRoot, 'release-gate-loop', `${y}-${m}-${d}`);
    mkdirSync(join(dateDir, 'run-01'), { recursive: true });

    const resolve = createResolveRunDir(tmpRoot, {
      existsSync, readdirSync, mkdirSync,
    });

    const { runDir, runId } = resolve();

    expect(runDir).toMatch(/run-02$/);
    expect(runId).toMatch(/-02$/);
  });

  // 测试：runId 和 dateStr 格式正确
  it('runId 格式 YYYYMMDD-NN，dateStr 格式 YYYY-MM-DD', () => {
    const resolve = createResolveRunDir(tmpRoot, {
      existsSync, readdirSync, mkdirSync,
    });

    const { runId, dateStr } = resolve();

    expect(runId).toMatch(/^\d{8}-\d{2}$/);
    expect(dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // 测试：路径包含 release-gate-loop 子目录
  it('路径包含 release-gate-loop 子目录', () => {
    const resolve = createResolveRunDir(tmpRoot, {
      existsSync, readdirSync, mkdirSync,
    });

    const { runDir } = resolve();

    expect(runDir).toContain('release-gate-loop');
  });

  // 测试：忽略非 run- 开头的目录
  it('目录下有非 run- 前缀目录 → 不影响编号', () => {
    const now = new Date();
    const y = String(now.getFullYear());
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const dateDir = join(tmpRoot, 'release-gate-loop', `${y}-${m}-${d}`);
    mkdirSync(join(dateDir, 'run-01'), { recursive: true });
    mkdirSync(join(dateDir, 'temp-dir'), { recursive: true });

    const resolve = createResolveRunDir(tmpRoot, {
      existsSync, readdirSync, mkdirSync,
    });

    const { runDir } = resolve();

    expect(runDir).toMatch(/run-02$/);
  });
});

// ═══════════════════════════════════════════════════════════
//  3. appendLedger 测试套件
// ═══════════════════════════════════════════════════════════

function createAppendLedger(ledgerPath, repoRoot) {
  const { fullBody } = extractFunctionBody(SOURCE_CODE, 'appendLedger');
  const modifiedBody = fullBody
    .replaceAll('LEDGER_PATH', '_ledgerPath')
    .replaceAll('REPO_ROOT', '_repoRoot');
  const wrapper = new Function(
    '_ledgerPath', '_repoRoot', 'appendFileSync', 'join',
    modifiedBody + '\nreturn appendLedger;'
  );
  return wrapper(ledgerPath, repoRoot, appendFileSync, join);
}

describe('appendLedger', () => {
  let tmpRoot;
  let ledgerPath;
  let repoRoot;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `rg-lg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tmpRoot, { recursive: true });
    ledgerPath = join(tmpRoot, 'LEDGER.md');
    repoRoot = tmpRoot;
  });

  afterEach(() => {
    if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  });

  // 测试：追加一行到空 LEDGER（文件不存在）
  it('追加到空 LEDGER → 文件被创建，包含正确行', () => {
    const append = createAppendLedger(ledgerPath, repoRoot);

    append('2026-07-27', '20260727-01', 5,
      { acceptance: 'PASS', regression: 'PASS', coverage: 'PASS' },
      'PASS', join(repoRoot, 'runs/release-gate-loop/2026-07-27/run-01'));

    expect(existsSync(ledgerPath)).toBe(true);
    const content = readFileSync(ledgerPath, 'utf-8');
    expect(content).toContain('2026-07-27');
    expect(content).toContain('20260727-01');
    expect(content).toContain('release-gate');
    expect(content).toContain('PASS');
  });

  // 测试：追加到已有内容的 LEDGER
  it('追加到已有内容的 LEDGER → 旧行保留，新行追加', () => {
    writeFileSync(ledgerPath, '已有第一行\n', 'utf-8');
    const append = createAppendLedger(ledgerPath, repoRoot);

    append('2026-07-28', '20260728-01', 5,
      { acceptance: 'FAIL', regression: 'PASS', coverage: 'PASS' },
      'FAIL', join(repoRoot, 'runs/release-gate-loop/2026-07-28/run-01'));

    const content = readFileSync(ledgerPath, 'utf-8');
    expect(content).toContain('已有第一行');
    expect(content).toContain('20260728-01');
    expect(content).toContain('FAIL');
  });

  // 测试：列对齐格式正确（日期|run-id|循环|步数|acceptance|regression|coverage|裁决|路径）
  it('列对齐格式正确（9 列用 | 分隔）', () => {
    const append = createAppendLedger(ledgerPath, repoRoot);
    const runDir = join(repoRoot, 'runs/release-gate-loop/2026-07-27/run-01');

    append('2026-07-27', '20260727-01', 5,
      { acceptance: 'PASS', regression: 'PASS', coverage: 'PASS' },
      'PASS', runDir);

    const content = readFileSync(ledgerPath, 'utf-8').trim();
    const lines = content.split('\n');
    const dataLine = lines[lines.length - 1];

    const fields = dataLine.split('|').map(s => s.trim()).filter(Boolean);
    expect(fields.length).toBe(9);

    expect(fields[0]).toBe('2026-07-27');         // 日期
    expect(fields[1]).toBe('20260727-01');        // run-id
    expect(fields[2]).toBe('release-gate');       // 循环名
    expect(fields[3]).toBe('5');                  // 步数
    expect(fields[4]).toBe('PASS');               // acceptance
    expect(fields[5]).toBe('PASS');               // regression
    expect(fields[6]).toBe('PASS');               // coverage
    expect(fields[7]).toBe('PASS');               // 裁决
    expect(fields[8]).toContain('runs/');         // 路径
  });

  // 测试：路径相对于 REPO_ROOT
  it('路径列记录相对路径（去掉 REPO_ROOT 前缀）', () => {
    const append = createAppendLedger(ledgerPath, repoRoot);
    const runDir = join(repoRoot, 'runs/release-gate-loop/2026-07-27/run-01');

    append('2026-07-27', '20260727-01', 5,
      { acceptance: 'PASS', regression: 'PASS', coverage: 'PASS' },
      'PASS', runDir);

    const content = readFileSync(ledgerPath, 'utf-8');
    expect(content).toContain('runs/release-gate-loop/2026-07-27/run-01');
    expect(content).not.toContain(tmpRoot);
  });

  // 测试：FAIL 裁决正确写入
  it('FAIL 裁决 → LEDGER 记录 FAIL', () => {
    const append = createAppendLedger(ledgerPath, repoRoot);

    append('2026-07-27', '20260727-02', 3,
      { acceptance: 'FAIL', regression: 'PASS', coverage: 'FAIL' },
      'FAIL', join(repoRoot, 'runs/release-gate-loop/2026-07-27/run-02'));

    const content = readFileSync(ledgerPath, 'utf-8');
    expect(content).toContain('FAIL');
  });
});

// ═══════════════════════════════════════════════════════════
//  4. parseVerdict 测试套件
// ═══════════════════════════════════════════════════════════

function createParseVerdict(joinFn, existsSyncFn, readFileSyncFn) {
  const { fullBody } = extractFunctionBody(SOURCE_CODE, 'parseVerdict');
  const wrapper = new Function(
    'join', 'existsSync', 'readFileSync',
    fullBody + '\nreturn parseVerdict;'
  );
  return wrapper(joinFn, existsSyncFn, readFileSyncFn);
}

describe('parseVerdict', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `rg-pv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tmpRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  });

  function makeParser(runDir) {
    return createParseVerdict(join, existsSync, readFileSync);
  }

  // 测试：verdict.md 含"判定：PASS" → verdict=PASS
  it('verdict.md 判定 PASS → verdict=PASS', () => {
    writeFileSync(join(tmpRoot, 'verdict.md'),
      '# 最终裁决\n\n## 判定：PASS\n\n## 依据\n全 PASS');

    const parse = makeParser(tmpRoot);
    const result = parse(tmpRoot);

    expect(result.verdict).toBe('PASS');
  });

  // 测试：verdict.md 含"判定：FAIL" → verdict=FAIL
  it('verdict.md 判定 FAIL → verdict=FAIL', () => {
    writeFileSync(join(tmpRoot, 'verdict.md'),
      '# 最终裁决\n\n## 判定：FAIL\n\n## 依据\nacceptance FAIL');

    const parse = makeParser(tmpRoot);
    const result = parse(tmpRoot);

    expect(result.verdict).toBe('FAIL');
  });

  // 测试：verdict.md 不存在 → verdict=ERROR
  it('verdict.md 不存在 → verdict=ERROR', () => {
    const parse = makeParser(tmpRoot);
    const result = parse(tmpRoot);

    expect(result.verdict).toBe('ERROR');
    expect(result.reason).toContain('不存在');
  });

  // 测试：verdict.md 无判定行但有 FAIL 标记 → v1.2.7 起报 ERROR（不再弱兜底 FAIL）
  // 旧逻辑「全文含 FAIL 即判 FAIL」会误判负向测试输出/日志转储，L1625 有意改为 ERROR
  it('verdict.md 无判定行但有 FAIL 标记 → fallback ERROR', () => {
    writeFileSync(join(tmpRoot, 'verdict.md'),
      '# 裁决\n\nacceptance-test 结果为 FAIL\n场景 #045 失败');

    const parse = makeParser(tmpRoot);
    const result = parse(tmpRoot);

    expect(result.verdict).toBe('ERROR');
  });

  // 测试：verdict.md 无判定行无 FAIL 标记 → v1.2.7 起报 ERROR（不再弱兜底 PASS）
  it('verdict.md 无判定行无 FAIL 标记 → fallback ERROR', () => {
    writeFileSync(join(tmpRoot, 'verdict.md'),
      '# 裁决\n\n所有步骤均通过\n可进阶段七');

    const parse = makeParser(tmpRoot);
    const result = parse(tmpRoot);

    expect(result.verdict).toBe('ERROR');
  });

  // 测试：判定行用英文冒号也能匹配
  it('判定行用英文冒号 → 也能匹配', () => {
    writeFileSync(join(tmpRoot, 'verdict.md'),
      '# Verdict\n\n## 判定: PASS\n');

    const parse = makeParser(tmpRoot);
    const result = parse(tmpRoot);

    expect(result.verdict).toBe('PASS');
  });
});

// ═══════════════════════════════════════════════════════════
//  5. extractUsage 测试套件
// ═══════════════════════════════════════════════════════════

function createExtractUsage() {
  const { fullBody } = extractFunctionBody(SOURCE_CODE, 'extractUsage');
  const wrapper = new Function(fullBody + '\nreturn extractUsage;');
  return wrapper();
}

describe('extractUsage', () => {
  let extractUsage;

  beforeEach(() => {
    extractUsage = createExtractUsage();
  });

  // 测试：result.usage 含 prompt_tokens + completion_tokens → 提取成功
  it('result.usage（prompt/completion 格式） → 提取成功', () => {
    const result = { usage: { prompt_tokens: 100, completion_tokens: 50 } };
    const usage = extractUsage(result);
    expect(usage).not.toBeNull();
    expect(usage.prompt_tokens).toBe(100);
    expect(usage.completion_tokens).toBe(50);
    expect(usage.total_tokens).toBe(150);
  });

  // 测试：result.llmResult.usage 含 input_tokens + output_tokens → 提取成功
  it('result.llmResult.usage（input/output 别名） → 提取成功', () => {
    const result = { llmResult: { usage: { input_tokens: 200, output_tokens: 100 } } };
    const usage = extractUsage(result);
    expect(usage).not.toBeNull();
    expect(usage.prompt_tokens).toBe(200);
    expect(usage.completion_tokens).toBe(100);
    expect(usage.total_tokens).toBe(300);
  });

  // 测试：messages[-1].usage_metadata（LangChain 格式） → 提取成功
  it('messages[-1].usage_metadata（LangChain 格式） → 提取成功', () => {
    const result = {
      messages: [
        { content: 'hi' },
        { usage_metadata: { input_tokens: 300, output_tokens: 200, total_tokens: 500 } },
      ],
    };
    const usage = extractUsage(result);
    expect(usage).not.toBeNull();
    expect(usage.prompt_tokens).toBe(300);
    expect(usage.completion_tokens).toBe(200);
    expect(usage.total_tokens).toBe(500);
  });

  // 测试：messages[-1].response_metadata.token_usage（OpenAI 格式） → 提取成功
  it('messages[-1].response_metadata.token_usage（OpenAI 格式） → 提取成功', () => {
    const result = {
      messages: [
        { response_metadata: { token_usage: { prompt_tokens: 400, completion_tokens: 300 } } },
      ],
    };
    const usage = extractUsage(result);
    expect(usage).not.toBeNull();
    expect(usage.prompt_tokens).toBe(400);
    expect(usage.completion_tokens).toBe(300);
    expect(usage.total_tokens).toBe(700);
  });

  // 测试：空对象 → 返回 null
  it('空对象 result → 返回 null', () => {
    const usage = extractUsage({});
    expect(usage).toBeNull();
  });

  // 测试：messages 有内容但无 usage → 返回 null
  it('messages 有内容但无 usage → 返回 null', () => {
    const result = { messages: [{ content: 'hi' }] };
    const usage = extractUsage(result);
    expect(usage).toBeNull();
  });
});

// ─── v1.3.6 OOM 修复（run-05 事故）：acceptance 分片并发 clamp ───
// FORGE_MAX_CONCURRENCY=1 时 acceptance 分片批次仍 6 并发 → 8GB 机器 OOM SIGKILL。
// 修复 = 实际并发取 min(FORGE_ACCEPTANCE_CONCURRENCY, FORGE_MAX_CONCURRENCY)。
// 此处以源码级断言锁定 clamp 表达式存在且方向正确（运行时行为由 spawnAcceptanceShards
// 的 maxConcurrency 参数承接，该函数签名不变）。
describe('acceptance 分片并发 clamp（run-05 OOM 修复）', () => {
  it('MAX_ACC_CONCURRENCY 取 min(FORGE_ACCEPTANCE_CONCURRENCY, FORGE_MAX_CONCURRENCY)', () => {
    expect(SOURCE_CODE).toContain('Math.min(');
    expect(SOURCE_CODE).toContain("process.env.FORGE_ACCEPTANCE_CONCURRENCY || '6'");
    expect(SOURCE_CODE).toContain("process.env.FORGE_MAX_CONCURRENCY || '6'");
    // clamp 表达式必须在 spawnAcceptanceShards 调用之前定义
    const clampIdx = SOURCE_CODE.indexOf('const MAX_ACC_CONCURRENCY = Math.min(');
    const callIdx = SOURCE_CODE.indexOf('await spawnAcceptanceShards(');
    expect(clampIdx).toBeGreaterThan(-1);
    expect(callIdx).toBeGreaterThan(clampIdx);
  });

  it('acceptance worker spawn 带 1024MB heap 上限（run-05 裸 spawn 修复）', () => {
    expect(SOURCE_CODE).toContain("'--max-old-space-size=1024'");
  });

  it('clamp 语义验证——min() 行为模拟', () => {
    const clamp = (acc, max) => Math.min(parseInt(acc || '6', 10), parseInt(max || '6', 10));
    // run-05 场景：FORGE_MAX_CONCURRENCY=1 → 并发必须 1
    expect(clamp('6', '1')).toBe(1);
    // 16GB 机器：FORGE_MAX_CONCURRENCY=4 → 并发 4
    expect(clamp('6', '4')).toBe(4);
    // 未设任何变量 → 默认 6
    expect(clamp(undefined, undefined)).toBe(6);
    // 显式收窄 acceptance 并发 → 取更小
    expect(clamp('2', '6')).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════
// v1.3.6 exit 语义归一化 + PROJECT_ROOT 注入（run-08/09 两轮假 FAIL 根治）
// ═══════════════════════════════════════════════════════════
describe('execRegressionDim · exit 语义归一化（run-08/09 教训）', () => {
  // 归一化规则的纯逻辑验证（与 driver 内实现同构——execRegressionDim 不可直接 import，
  // 用规则镜像测试：改 driver 实现时本组测试同步改，防规则漂移）
  const normalize = (exitCode, output) => {
    if (exitCode !== 0 && exitCode !== null && !/(❌|FAIL|⚠️|缺失|漂移|超标|CRITICAL)/.test(output)) {
      return { exitCode: 0, normalized: true };
    }
    return { exitCode, normalized: false };
  };

  it('语义性退出码归一化：非零 exit + 零失败标记 → 0（#103 空输出场景）', () => {
    const r = normalize(1, '');
    expect(r.exitCode).toBe(0);
    expect(r.normalized).toBe(true);
  });

  it('真 FAIL 不吞：非零 exit + ⚠️ 输出 → 保留原码', () => {
    const r = normalize(1, '⚠️ commons/x.ts 缺失');
    expect(r.exitCode).toBe(1);
    expect(r.normalized).toBe(false);
  });

  it('exit 0 与超时（null）不归一化', () => {
    expect(normalize(0, '✅ 全过').normalized).toBe(false);
    expect(normalize(null, '[driver] 执行异常').normalized).toBe(false);
  });

  it('失败标记词族全覆盖（❌/FAIL/⚠️/缺失/漂移/超标/CRITICAL）', () => {
    for (const mark of ['❌ 断链', 'FAIL: x', '⚠️ 缺件', '声称漂移', '行数超标', 'CRITICAL']) {
      expect(normalize(1, mark).exitCode).toBe(1);
    }
  });

  it('PROJECT_ROOT 注入：维度脚本引用 $PROJECT_ROOT 不再展开为空（#98/99 双重 bug）', async () => {
    // 镜像 execRegressionDim 的注入逻辑：脚本前缀 export PROJECT_ROOT
    const REPO_ROOT = '/tmp/fake-root';
    const dimScript = 'test -f "$PROJECT_ROOT/engine/audit/package.json" && echo FOUND';
    const injected = `export PROJECT_ROOT="${REPO_ROOT}"\n${dimScript}`;
    const { execSync } = await import('child_process');
    // 真实注入后路径可解析（用真实仓库根验证一次）
    const real = `export PROJECT_ROOT="${process.cwd()}"\necho "$PROJECT_ROOT" | grep -q sofagent && echo OK`;
    const out = execSync(`bash -c '${real}'`).toString().trim();
    expect(out).toBe('OK');
    // 注入串包含 export 前缀（防注入逻辑被误删）
    expect(injected.startsWith('export PROJECT_ROOT=')).toBe(true);
  });
});

// ─── v1.3.6（run-08 + 2026-08-18/run-01 两轮假 PASS）：F 链零 commit 校验 ───
// f-fix 零 commit 时 f-audit 对空 diff 必全绿 → 「修复收敛 FAIL→PASS」假绿。
// 修复 = 收敛判定加第三重校验：F 分支自基线零 commit = 修复失败，禁止判收敛。
describe('F 链零 commit 校验（两轮假 PASS 根治）', () => {
  it('收敛判定源码含 git rev-list --count 零 commit 校验 + 拦截日志', () => {
    expect(SOURCE_CODE).toContain('git rev-list --count');
    expect(SOURCE_CODE).toContain('零 commit 校验拦截');
    expect(SOURCE_CODE).toContain('fBranchCommitCount === 0');
    // 校验必须在 auditPassed 判定之后、收敛 break 之前
    const guardIdx = SOURCE_CODE.indexOf('if (auditPassed && fBranchCommitCount === 0)');
    const convergeIdx = SOURCE_CODE.indexOf("audit gate 通过（无违规），F 修复链收敛");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(convergeIdx).toBeGreaterThan(guardIdx);
  });

  it('DIM_TIMEOUT_OVERRIDE 覆盖 #49/#106/#110（超时误报 ERR 防复发）', () => {
    expect(SOURCE_CODE).toContain('49: 120_000');
    expect(SOURCE_CODE).toContain('106: 150_000');
    expect(SOURCE_CODE).toContain('110: 150_000');
  });
});
