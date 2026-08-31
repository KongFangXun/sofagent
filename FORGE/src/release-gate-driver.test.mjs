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
  // v1.4.3：extractVerdictKeyword 已从 parseVerdict 内部提到模块级（原本
  // parseVerdict 与 parseStepResults 各存一份相同副本）。本测试是把 parseVerdict
  // 的函数体单独抠出来用 new Function 构造，抠出的片段不含模块级依赖，故需显式
  // 把该函数一并注入，否则 ReferenceError。
  const { fullBody: verdictKeywordFn } = extractFunctionBody(SOURCE_CODE, 'extractVerdictKeyword');
  const wrapper = new Function(
    'join', 'existsSync', 'readFileSync',
    verdictKeywordFn + '\n' + fullBody + '\nreturn parseVerdict;'
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

  // ── v1.4.3（run-19 原生复跑教训）：HOLD 同义裁决词 → FAIL ──
  // LLM 审查者按安全审查惯例写「HOLD（不放行）」，解析器未认 → driver 记账
  // ERROR 与真实裁决脱钩。HOLD/不放行/暂缓放行 均等价 FAIL（fail-closed）。
  it('verdict.md 判定 HOLD（run-19 真实形态回放） → verdict=FAIL', () => {
    writeFileSync(join(tmpRoot, 'verdict.md'),
      '# sofagent 发版闸门审查报告\n\n| **总体结论** | **HOLD（不放行）** |\n\n## 一、总体结论\n\n**本次发版闸门判定为 HOLD，不予放行。**');

    const parse = makeParser(tmpRoot);
    const result = parse(tmpRoot);

    expect(result.verdict).toBe('FAIL');
    expect(result.reason).toBe('verdict.md 裁决');
  });

  it('verdict.md 判定「不放行」（中文同义词） → verdict=FAIL', () => {
    writeFileSync(join(tmpRoot, 'verdict.md'),
      '# 最终裁决\n\n## 总体结论：不放行\n\n依据略');

    const parse = makeParser(tmpRoot);
    expect(parse(tmpRoot).verdict).toBe('FAIL');
  });

  it('正文提及 HOLD 但判定行是 PASS → 不误抓（窗口纪律保持）', () => {
    writeFileSync(join(tmpRoot, 'verdict.md'),
      '# 最终裁决\n\n## 判定：PASS\n\n## 附注\nHOLD 是安全审查常见措辞，本报告未采用');

    const parse = makeParser(tmpRoot);
    expect(parse(tmpRoot).verdict).toBe('PASS');
  });

  // ── v1.4.3（run-01 实证）：表格行「终审裁决」形态 → FAIL ──
  // LLM 把裁决写进表格行 `| **终审裁决** | ❌ **FAIL（阻塞）—— 维持…** |`，
  // 结论词前夹中文（阻塞），严格正则（中文即中断）抓不到 → driver 记
  // ERROR 与内容裁决 FAIL 脱钩。「终审裁决」标记单独放宽（允许中文前缀
  // + \b 断词），「判定/结论」维持严格纪律防引述误抓。
  it('verdict.md 表格行「终审裁决」（run-01 真实形态回放） → verdict=FAIL', () => {
    writeFileSync(join(tmpRoot, 'verdict.md'),
      '# sofagent 发版闸门终审裁决报告 · verdict（角色 V）\n\n| **终审裁决** | ❌ **FAIL（阻塞）—— 维持，本轮放行** |\n\n## 一、终审裁决\n\n**❌ FAIL（阻塞）。** 本轮发版候选**不予放行**。');

    const parse = makeParser(tmpRoot);
    const result = parse(tmpRoot);
    expect(result.verdict).toBe('FAIL');
  });

  it('verdict.md 表格行「终审裁决」PASS 形态 → verdict=PASS', () => {
    writeFileSync(join(tmpRoot, 'verdict.md'),
      '# verdict\n\n| **终审裁决** | ✅ **PASS（放行）** |');

    const parse = makeParser(tmpRoot);
    expect(parse(tmpRoot).verdict).toBe('PASS');
  });

  // ── v1.4.3（run-02 实证）：表格行「最终裁决」第四形态 → FAIL ──
  // 同一 LLM 不同 run 会换表格标记词：run-02 用「最终裁决」而非「终审裁决」，
  // markers 未命中 → driver 记 ERROR 与内容裁决脱钩。收编进表格组同款放宽
  // （允许中文前缀 + \b 断词），结论词「不通过（BLOCKED）」走同义词链等价 FAIL。
  it('verdict.md 表格行「最终裁决」+「不通过（BLOCKED）」（run-02 真实形态回放） → verdict=FAIL', () => {
    writeFileSync(join(tmpRoot, 'verdict.md'),
      '# V1.4.3 阶段五判断层最终裁决 · verdict（角色 V）\n\n| **最终裁决** | ❌ **不通过（BLOCKED）** |\n\n回归 PASS 但 coverage FAIL，三 P0 闭环前不予放行。');

    const parse = makeParser(tmpRoot);
    const result = parse(tmpRoot);
    expect(result.verdict).toBe('FAIL');
  });

  it('verdict.md 表格行「最终裁决」PASS 形态 → verdict=PASS', () => {
    writeFileSync(join(tmpRoot, 'verdict.md'),
      '# verdict\n\n| **最终裁决** | ✅ **PASS（放行）** |');

    const parse = makeParser(tmpRoot);
    expect(parse(tmpRoot).verdict).toBe('PASS');
  });

  // ── v1.4.3（run-04 实证）：表格行「终审结论」+「阻断（BLOCKED）」第五形态 → FAIL ──
  // run-04 verdict.md 第 9 行：`| 终审结论 | **🚫 阻断（BLOCKED）——…** |`——
  // 「终审结论」不在 markers（「结论」子串命中但属严格组，被「阻断」中文中断）；
  // 「阻断」不在同义词链（只有「阻塞」）——三路全 miss，driver 记 ERROR 与
  // 内容裁决脱钩。收编：markers 增「终审结论」进表格组 + 同义词链增「阻断」。
  it('verdict.md 表格行「终审结论」+「阻断（BLOCKED）」（run-04 真实形态回放） → verdict=FAIL', () => {
    writeFileSync(join(tmpRoot, 'verdict.md'),
      '# V1.4.3 阶段五判断层终审报告 · verdict（角色 V）\n\n| 终审结论 | **🚫 阻断（BLOCKED）—— 2 项 P0 未消除，v1.4.3 不得发版。** |\n\n**最终裁决：🚫 阻断（BLOCKED）。2 项 P0 未消除、5 项 P1 未闭环、版本基准未闭合之前，v1.4.3 不得发版。**');

    const parse = makeParser(tmpRoot);
    const result = parse(tmpRoot);
    expect(result.verdict).toBe('FAIL');
  });

  it('verdict.md 表格行「终审结论」PASS 形态（「放行」不误判 FAIL） → verdict=PASS', () => {
    writeFileSync(join(tmpRoot, 'verdict.md'),
      '# verdict\n\n| 终审结论 | ✅ **通过（PASS）—— 放行。** |');

    const parse = makeParser(tmpRoot);
    expect(parse(tmpRoot).verdict).toBe('PASS');
  });

  it('「判定」标记维持严格纪律：引述句含中文+FAIL 不误抓', () => {
    writeFileSync(join(tmpRoot, 'verdict.md'),
      '# 裁决\n\n判定截断段不可见，维持 P1 观察项\n\n## 判定：PASS');

    const parse = makeParser(tmpRoot);
    expect(parse(tmpRoot).verdict).toBe('PASS');
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
  it('MAX_ACC_CONCURRENCY 取 min(FORGE_ACCEPTANCE_CONCURRENCY, resolveMaxConcurrency)', () => {
    expect(SOURCE_CODE).toContain('Math.min(');
    // v1.3.7 ⑦ 起 FORGE_MAX_CONCURRENCY 的解析升级为 resolveMaxConcurrency()
    // （显式 CLI/env > totalmem 预算表 > 兜底 1），不再写死 env || '6'
    expect(SOURCE_CODE).toContain("process.env.FORGE_ACCEPTANCE_CONCURRENCY || '6'");
    expect(SOURCE_CODE).toContain('resolveMaxConcurrency({ defaultConcurrency: 1 })');
    expect(SOURCE_CODE).toContain('GATE_CONCURRENCY_RESOLVED.concurrency');
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

// ═══════════════════════════════════════════════════════════
//  6. buildPrecheckEvidence 测试套件（v1.4.0 DSH 证据注入防回归）
// ═══════════════════════════════════════════════════════════
// 背景：run-04~07 连续失败根因 = DSH CLI 桥接无法注入自定义工具 → worker 读不到
// precheck.json → 「0 条工具结果」判 FAIL。修复 = 证据内容由 driver 注入 userMessage。
// 本套件防回归：注入逻辑被改坏（截断/漏注入/只注入路径不注入内容）时测试能抓住。

function createBuildPrecheckEvidence() {
  const { fullBody } = extractFunctionBody(SOURCE_CODE, 'buildPrecheckEvidence');
  const wrapper = new Function(
    'join', 'existsSync', 'readFileSync',
    fullBody + '\nreturn buildPrecheckEvidence;'
  );
  return wrapper(join, existsSync, readFileSync);
}

describe('buildPrecheckEvidence（DSH 证据注入）', () => {
  let tmpRoot;
  let buildEv;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `rg-bpe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tmpRoot, { recursive: true });
    buildEv = createBuildPrecheckEvidence();
  });

  afterEach(() => {
    if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('非 precheck 步骤返回空串（acceptance/consolidate/verdict 不受影响）', () => {
    const stepDef = { prompt: 'consolidate.md', outputs: ['stage6-report.md'], inputs: ['acceptance.md', 'regression.md'] };
    expect(buildEv(tmpRoot, stepDef)).toBe('');
  });

  it('precheck 步骤但输入文件缺失 → 返回提示不崩溃', () => {
    const stepDef = { precheck: true, inputs: ['regression-precheck.json'] };
    const out = buildEv(tmpRoot, stepDef);
    expect(out).toContain('文件不存在');
  });

  it('regression-precheck.json → 逐维度注入（含维度号/标题/exitCode + 汇总行）', () => {
    const dims = {
      '1': { num: 1, title: 'CHANGELOG 纯度', exitCode: 0, output: 'ok' },
      '2': { num: 2, title: '文档一致性', exitCode: 1, output: 'fail', truncated: false },
    };
    writeFileSync(join(tmpRoot, 'regression-precheck.json'), JSON.stringify({ meta: { dims: 2 }, dims }));
    const stepDef = { precheck: true, inputs: ['regression-precheck.json'] };
    const out = buildEv(tmpRoot, stepDef);
    expect(out).toContain('维度 1');
    expect(out).toContain('CHANGELOG 纯度');
    expect(out).toContain('exit=0');
    expect(out).toContain('exit=1');
    expect(out).toContain('1 个失败（非零退出码或超时 ERR');
  });

  it('run-05 fail-closed：exitCode=null（超时/异常）计入 failCount，不再静默放过', () => {
    const dims = {
      '1': { num: 1, title: '正常维度', exitCode: 0, output: 'ok' },
      '2': { num: 2, title: '超时维度', exitCode: null, output: '[driver] 执行异常: 命令超时', truncated: false },
    };
    writeFileSync(join(tmpRoot, 'regression-precheck.json'), JSON.stringify({ meta: { dims: 2 }, dims }));
    const stepDef = { precheck: true, inputs: ['regression-precheck.json'] };
    const out = buildEv(tmpRoot, stepDef);
    expect(out).toContain('exit=ERR(超时/异常)');
    expect(out).toContain('1 个失败（非零退出码或超时 ERR');
  });

  it('coverage-precheck.json → 模块+场景全量注入（不 slice 截断——P1-1/P1-2 防回归）', () => {
    const changelog = Array.from({ length: 18 }, (_, i) => ({ title: '模块' + (i + 1) }));
    const scenarios = Array.from({ length: 252 }, (_, i) => ({ num: i + 1, title: '场景' + (i + 1) }));
    writeFileSync(join(tmpRoot, 'coverage-precheck.json'), JSON.stringify({
      meta: { modules: 18, scenarios: 252, changelogPath: 'x' },
      changelog, scenarios,
    }));
    const stepDef = { precheck: true, inputs: ['acceptance.md', 'coverage-precheck.json'] };
    const out = buildEv(tmpRoot, stepDef);
    expect(out).toContain('模块18');
    expect(out).toContain('场景252');
    expect(out).not.toContain('acceptance.md 内容');
  });

  it('注入文本含「precheck 证据」标题（worker 可识别为判定依据）', () => {
    writeFileSync(join(tmpRoot, 'regression-precheck.json'), JSON.stringify({
      meta: { dims: 1 }, dims: { '1': { num: 1, title: 'x', exitCode: 0, output: '' } },
    }));
    const out = buildEv(tmpRoot, { precheck: true, inputs: ['regression-precheck.json'] });
    expect(out).toContain('precheck 证据');
  });
});

// ═══════════════════════════════════════════════════════════
//  7. buildInputsEvidence 测试套件（v1.4.3 run-19 verdict 零证据根因防回归）
// ═══════════════════════════════════════════════════════════
// 背景：v1.4.3 直连模式（跳过 DSH 桥接）下，verdict/consolidate 等 非 precheck
// 步骤既无工具结果也无 precheck 证据 → generateReportWithoutTools 永远「零证据」
// → verdict 必然 ERROR（run-19 实证）。修复 = 上一步产物内容由 driver 注入。

function createBuildInputsEvidence() {
  const { fullBody } = extractFunctionBody(SOURCE_CODE, 'buildInputsEvidence');
  const wrapper = new Function(
    'join', 'existsSync', 'readFileSync',
    fullBody + '\nreturn buildInputsEvidence;'
  );
  return wrapper(join, existsSync, readFileSync);
}

describe('buildInputsEvidence（run-19 verdict 零证据根因）', () => {
  let tmpRoot;
  let buildEv;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `rg-bie-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tmpRoot, { recursive: true });
    buildEv = createBuildInputsEvidence();
  });

  afterEach(() => {
    if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('precheck 步骤返回空串（regression/coverage 不受影响——已由 buildPrecheckEvidence 覆盖）', () => {
    expect(buildEv(tmpRoot, { precheck: true, inputs: ['regression-precheck.json'] })).toBe('');
  });

  it('verdict 步骤 → stage6-report.md 内容注入（run-19 场景复现）', () => {
    writeFileSync(join(tmpRoot, 'stage6-report.md'), '# 综合报告\n判定：FAIL\nF-1 P0 缺口');
    const out = buildEv(tmpRoot, { inputs: ['stage6-report.md'] });
    expect(out).toContain('上一步产物证据');
    expect(out).toContain('stage6-report.md');
    expect(out).toContain('F-1 P0 缺口');
  });

  it('consolidate 三输入 → 全部注入 + 合计预算控制（单文件 6000 截断）', () => {
    const big = 'x'.repeat(10_000);
    writeFileSync(join(tmpRoot, 'acceptance.md'), big);
    writeFileSync(join(tmpRoot, 'regression.md'), 'R');
    writeFileSync(join(tmpRoot, 'coverage.md'), 'C');
    const out = buildEv(tmpRoot, { inputs: ['acceptance.md', 'regression.md', 'coverage.md'] });
    expect(out).toContain('acceptance.md');
    expect(out).toContain('截断');
    expect(out).toContain('regression.md');
  });

  it('输入文件缺失 → 「数据不完整」提示（verdict prompt 契约：缺失即 FAIL）', () => {
    const out = buildEv(tmpRoot, { inputs: ['stage6-report.md'] });
    expect(out).toContain('文件不存在');
    expect(out).toContain('数据不完整');
  });

  it('runWorker 直连模式证据面拼接（precheck + inputs 双通道）', () => {
    // 源码级断言：直连分支与兜底分支都用 [precheckEvidence, inputsEvidence] 拼接
    expect(SOURCE_CODE).toContain("[precheckEvidence, inputsEvidence].filter(Boolean).join('\\n\\n')");
    // 直连分支必须存在（v1.4.3 性能优化）
    expect(SOURCE_CODE).toContain("process.env.FORGE_WORKER !== 'dsh'");
  });
});

// ═══════════════════════════════════════════════════════════
//  7b. precheck 输出智能截断（v1.4.3 run-01 P1-4 修复）
// ═══════════════════════════════════════════════════════════
// 背景：raw.slice(0, 400) 在多字节字符中间切开 → U+FFFD 乱码（run-01 维度 101
// LIMIT_B= 值被切半不可读）；判定行横跨截断点时两段都匹配不上 → 关键证据丢失。
// 修正 = 码点边界回退 + 关键行（LIMIT_B=/期望=/报告=）从原文整行补尾。

describe('precheck 输出智能截断（run-01 P1-4）', () => {
  const MAX_DIM_CHARS = 400;
  // 与 driver 内实现同构（改实现时本组同步改）
  const smartTruncate = (output, truncatedOutput) => {
    if (truncatedOutput.length <= MAX_DIM_CHARS) return truncatedOutput;
    let cut = MAX_DIM_CHARS;
    while (cut > 0 && (truncatedOutput.codePointAt(cut) & 0xfc00) === 0xdc00) cut--;
    while (cut > 0 && (truncatedOutput.codePointAt(cut - 1) >= 0xd800 && truncatedOutput.codePointAt(cut - 1) <= 0xdbff)) cut--;
    const head = truncatedOutput.slice(0, cut);
    const keyLineRe = /^[^\n]{0,80}(LIMIT_B?=|期望[=：]|报告[=：])[^\n]{0,40}$/gm;
    const tailKeep = (output.match(keyLineRe) || [])
      .filter(l => !head.includes(l) && !/^\s*$/.test(l)).slice(0, 5);
    return head + (tailKeep.length ? '\n' + tailKeep.join('\n') : '') + `\n…[${truncatedOutput.length - cut} 字符截断${tailKeep.length ? '，关键行已保留' : ''}]`;
  };

  it('多字节字符截断不产 FFFD（run-01 维度 101 乱码回放）', () => {
    const cjk = '门'.repeat(250) + '关键行';
    expect(smartTruncate(cjk, cjk)).not.toContain('\u{FFFD}');
  });

  it('判定行横跨截断点 → 从原文整行补尾（run-01 维度 8「期望=17 报告=17」形态）', () => {
    const withKey = 'a'.repeat(390) + '\nLIMIT_B=1250\n其余内容' + 'b'.repeat(50);
    expect(smartTruncate(withKey, withKey)).toContain('LIMIT_B=1250');
  });

  it('关键行在尾部深处 → 仍保留', () => {
    const tail = 'x'.repeat(300) + '\nfiller\n'.repeat(30) + '期望=17 报告=17\n' + 'y'.repeat(20);
    expect(smartTruncate(tail, tail)).toContain('期望=17 报告=17');
  });

  it('短文本原样返回（不截断）', () => {
    expect(smartTruncate('short', 'short')).toBe('short');
  });

  it('纯 ASCII 无关键行 → 截断标记无「关键行已保留」', () => {
    const r = smartTruncate('z'.repeat(500), 'z'.repeat(500));
    expect(r).toContain('字符截断');
    expect(r).not.toContain('关键行已保留');
  });
});

// ═══════════════════════════════════════════════════════════
//  8. 反向防御假红豁免三家族（v1.4.3 run-19/20 全量定谳）
// ═══════════════════════════════════════════════════════════
// 背景：反向防御防的是 run-16 形态的假绿（`cmd || echo "❌ ..."` 收尾，❌ 漏
// 网）。但整文 /❌/ 匹配误伤三类健康形态，run-19/20 实测九维假红：
// ① ✅ 行内引用（125/127）② [driver] 自我消息（60/62）③ grep 内容引用
// （1/3/8/64/95——grep 命中文档正文自带 ❌，如能力对照表）。修正 = ❌ 判定
// 改「行首锚定」（行首 + 空白/markdown 前缀）+ 剥 [driver] 行。

describe('execRegressionDim · 反向防御假红豁免三家族（run-19/20 假红根因）', () => {
  // 与 driver 内实现同构的规则镜像（改实现时本组同步改）
  const hasGenuineFail = (output) => {
    const userOutput = output.split('\n').filter(l => !l.startsWith('[driver]')).join('\n');
    return /^[\s>*#•·-]*❌/m.test(userOutput);
  };

  it('① ✅ 行内引用 → 不翻转（run-19 dim125/127 回放）', () => {
    expect(hasGenuineFail('✅ 三 tools 齐（若上方无 ❌）\n✅ 六引擎注册（若上方无 ❌）\n✅ DSH 三步在位')).toBe(false);
  });

  it('② [driver] 自我消息污染 → 不翻转（run-20 dim60 回放）', () => {
    const real60 = [
      './dist/public-api.d.ts',
      '[driver] exit 语义归一化：原 exit=1 但输出无失败标记——若该维度确有问题，请在维度脚本补显式 ❌ 输出。',
      '[driver] 反向防御：原 exit=0 但输出含显式 ❌——重写为 1。',
    ].join('\n');
    expect(hasGenuineFail(real60)).toBe(false);
  });

  it('③ grep 内容引用 → 不翻转（run-19 dim3/95 回放——文档正文/脚本源码自带 ❌）', () => {
    expect(hasGenuineFail('enterprise-deploy.md:47:| 数据加密 | ❌ 当前明文 | 加密能力已实现但接线未启用 |')).toBe(false);
    expect(hasGenuineFail('      echo "  ❌ $md : 文档头日期漂移"')).toBe(false);
  });

  it('真失败保形：❌ 独立行 → 触发翻转（run-16 假绿形态）', () => {
    expect(hasGenuineFail('✅ 收割链在位\n❌ 僵尸收割缺失')).toBe(true);
  });

  it('真失败保形：缩进/markdown 列表前缀的行首 ❌ → 触发', () => {
    expect(hasGenuineFail('  ❌ file.md : 文档头日期漂移')).toBe(true);
    expect(hasGenuineFail('- ❌ 列表项失败')).toBe(true);
  });

  it('混合形态：✅ 引用行 + 真失败行并存 → 仍触发（不吞真失败）', () => {
    expect(hasGenuineFail('✅ 三 tools 齐（若上方无 ❌）\n❌ train_status 未注册/未分发\n✅ 处方出处标注')).toBe(true);
  });

  it('用户输出真 ❌ + [driver] 说明并存 → 仍触发（不吞真失败）', () => {
    const mixed = [
      '✅ 检查项 A',
      '❌ audit-rule-registry.ts 未见 zod parse',
      '[driver] exit 语义归一化：原 exit=1 但输出无失败标记——若该维度确有问题，请在维度脚本补显式 ❌ 输出。',
    ].join('\n');
    expect(hasGenuineFail(mixed)).toBe(true);
  });

  it('纯健康输出零 ❌ → 不触发（语义不变）', () => {
    expect(hasGenuineFail('✅ A\n✅ B')).toBe(false);
  });

  it('源码级断言：判定前剥 [driver] 行 + 行首锚定正则', () => {
    expect(SOURCE_CODE).toContain("filter(l => !l.startsWith('[driver]'))");
    expect(SOURCE_CODE).toContain('/^[\\s>*#•·-]*❌/m');
  });
});

// ═══════════════════════════════════════════════════════════
//  9. assertNativeToolchain 自愈模式（v1.4.3 用户拍板：WorkBuddy 内可跑）
// ═══════════════════════════════════════════════════════════
// 背景：run-15/16/17 沙箱 toybox 污染三连假红后，首版防御是 fail-fast 拒跑；
// 用户拍板「修复成可以在 WorkBuddy 里跑的状态」→ 升级为自愈：净化 PATH（剥
// brokered-bin/toybox 段）+ 剥 BASH_ENV → 复测三指纹 → 通过继续跑。
// 烟测三用例（正常/自愈/拒跑）在开发期已验证；本套件锁源码关键结构。

describe('assertNativeToolchain 自愈模式（run-18+ WorkBuddy 内可跑）', () => {
  it('源码级断言：自愈三要素在位（净化 PATH / 剥 BASH_ENV / 复测）', () => {
    expect(SOURCE_CODE).toContain('启动自愈（净化 PATH + 剥 BASH_ENV）');
    expect(SOURCE_CODE).toContain("filter(seg => seg && !/brokered-bin|toybox/i.test(seg))");
    expect(SOURCE_CODE).toContain('delete process.env.BASH_ENV');
    expect(SOURCE_CODE).toContain('自愈成功');
    expect(SOURCE_CODE).toContain('自愈失败');
  });

  it('自愈失败仍拒跑（fail-closed 语义保留——净化后不可信照样拒）', () => {
    const failIdx = SOURCE_CODE.indexOf('自愈失败');
    const exitIdx = SOURCE_CODE.indexOf('process.exit(1)', failIdx);
    expect(failIdx).toBeGreaterThan(-1);
    expect(exitIdx).toBeGreaterThan(failIdx);
  });

  it('指纹探测保留三件套（BRE 交替 / wc 补齐 / PATH 首段——run-17 教训）', () => {
    expect(SOURCE_CODE).toContain('grep -q "a\\\\|x"');
    expect(SOURCE_CODE).toContain('echo hi | wc -l');
    expect(SOURCE_CODE).toContain('brokered-bin|toybox');
  });
});

// ═══════════════════════════════════════════════════════════
// run-05 实证三修：precheck 注入 fail-closed + V 步骤预算 800 + dim 111 超时放宽
// ═══════════════════════════════════════════════════════════
describe('run-05 三修（fail-closed 注入口径 + 证据审读预算 + 超时 override）', () => {
  it('buildPrecheckEvidence fail-closed：exitCode=null（超时）计入 failCount，不再 `!== 0 && !== null` 旧口径', () => {
    // 旧口径把超时当「非失败」，汇总「0 失败」与 dim exit=ERR 自相矛盾——
    // V 判定输入不完整，fail-closed 语义在注入层断裂。
    expect(SOURCE_CODE).not.toContain('d.exitCode !== 0 && d.exitCode !== null');
    expect(SOURCE_CODE).toContain('const isFail = d.exitCode !== 0;');
    expect(SOURCE_CODE).toContain('fail-closed：超时=证据缺失=未通过');
  });

  it('release-gate V 证据审读预算统一 800（acceptance/coverage/consolidate/verdict）', () => {
    const BUDGET_CODE = readFileSync(new URL('./tool-output-budget.mjs', import.meta.url), 'utf-8');
    // 三处截断根因（run-05）：verdict 100 / acceptance 200 / coverage 200 头尾截断
    // → P2 尾部与中段不可见 → V 以证据链不完整阻断。对齐 regression 800 先例。
    expect(BUDGET_CODE).toContain("'acceptance':    800,");
    expect(BUDGET_CODE).toContain("'coverage':      800,");
    expect(BUDGET_CODE).toContain("'consolidate':   800,");
    expect(BUDGET_CODE).toContain("'verdict':       800,");
    // 防误伤：fresh-eyes 与 F 诊断预算不动
    expect(BUDGET_CODE).toContain("'a-consolidate': 500,");
    expect(BUDGET_CODE).toContain("'f-diagnose':    200,");
    expect(BUDGET_CODE).not.toContain("'verdict':       100,");
  });

  it('dim 111 超时 override 150s→240s（run-05 实测全量 test-count >150s）', () => {
    expect(SOURCE_CODE).toContain('111: 240_000,');
    expect(SOURCE_CODE).not.toContain('111: 150_000,');
  });
});
