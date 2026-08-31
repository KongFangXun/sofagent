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

  it('consolidate 三输入 → 全部注入 + 合计预算随输入数缩放（run-08 三修）', () => {
    // run-08 实证：固定总额 20000 下 12 份分片报告静默截断（s8~s12 未审），
    // verdict 升格 P1-10。修法：总额 = inputs.length × 12000（硬顶 150000）。
    // 本用例构造 >12000 字符的第一输入验证截断仍发生（单文件上限不变），
    // 且三输入总额 36000 足够三份小文件全部完整注入。
    const big = 'x'.repeat(13_000);
    writeFileSync(join(tmpRoot, 'acceptance.md'), big);
    writeFileSync(join(tmpRoot, 'regression.md'), 'R');
    writeFileSync(join(tmpRoot, 'coverage.md'), 'C');
    const out = buildEv(tmpRoot, { inputs: ['acceptance.md', 'regression.md', 'coverage.md'] });
    expect(out).toContain('acceptance.md');
    expect(out).toContain('截断');
    expect(out).toContain('regression.md');
  });

  it('12 输入（run-08 consolidate 实况回放）→ 全部完整注入无截断', () => {
    // run-08 实况：12 份分片报告各 ~9KB（均 12000 上限内），旧固定总额 20000
    // 只装得下 2 份 → s8~s12 截断。新预算 12×12000=144000 应全部完整注入。
    for (let i = 1; i <= 12; i++) {
      writeFileSync(join(tmpRoot, `s${i}.md`), `分片${i}：` + 'y'.repeat(9_000));
    }
    const inputs = Array.from({ length: 12 }, (_, i) => `s${i + 1}.md`);
    const out = buildEv(tmpRoot, { inputs });
    expect(out).not.toContain('截断');
    expect(out).toContain('分片1：');
    expect(out).toContain('分片12：');
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

// ═══════════════════════════════════════════════════════════
// run-06 P1-2 流程加固：产物完整性校验 + 分片全灭早停
// ═══════════════════════════════════════════════════════════
describe('run-06 P1-2 流程加固（产物校验 + 闸门早停）', () => {
  it('步骤完成后校验 outputs 存在且非空——worker exit 0 但产物缺失按失败记账', () => {
    // run-06 实证：regression worker 被 stall abort 后 agent 层吞错 exit 0，
    // regression.md 空文件一路流入合并/裁定步（V 拿到零证据输入）。
    expect(SOURCE_CODE).toContain('产物缺失或空文件');
    expect(SOURCE_CODE).toContain('statSync(join(runDir, f)).size === 0');
    // outputs 声明即契约：校验范围来自步骤定义
    expect(SOURCE_CODE).toContain("stepDef?.outputs || []");
  });

  it('分片全灭早停：0 成功即 LOOP_END(ERROR) 返回，不空转后续步骤', () => {
    // run-06 实证：S1 阻塞后 11 个分片同步空转烧完整轮预算。
    // 部分失败不早停（单分片问题不污染其他分片证据）。
    expect(SOURCE_CODE).toContain("shardOk === 0");
    expect(SOURCE_CODE).toContain("stopReason = 'shards-all-failed'");
    // 早停路径不走 parseVerdict（verdict.md 必为降级占位/缺失）
    const earlyStopBlock = SOURCE_CODE.slice(
      SOURCE_CODE.indexOf("stopReason === 'shards-all-failed'"),
      SOURCE_CODE.indexOf('const results = parseStepResults(runDir);'),
    );
    expect(earlyStopBlock).not.toContain('parseVerdict(');
    expect(earlyStopBlock).toContain("saveGateCheckpoint('verdict-done', 'ERROR', 0)");
  });
});

// ═══════════════════════════════════════════════════════════
//  8. run-07 四修测试组
// ═══════════════════════════════════════════════════════════
// 背景：run-07 零信任核验实锤四个基建问题——
//   ① acceptance 分片零证据（inputs:[] 且无 precheck → 双注入函数空串，
//      raw.log 从未注入）+ {runDir} 占位符无替换逻辑；
//   ② verdict 注入单文件 6000 截断（stage6-report.md 7397 字符，第 5 节丢失）；
//   ③ extractVerdictKeyword 漏抓「有条件通过」「全部通过」叙述句 → status 记 SKIP；
//   ④ V 把 13720 字节误读为 7397 字符——注入提示需显式注明「字符数非字节数」。

function createBuildShardEvidence() {
  const { fullBody } = extractFunctionBody(SOURCE_CODE, 'buildShardEvidence');
  const wrapper = new Function(
    'join', 'existsSync', 'readFileSync',
    fullBody + '\nreturn buildShardEvidence;'
  );
  return wrapper(join, existsSync, readFileSync);
}

describe('run-07 四修：acceptance 分片证据注入（buildShardEvidence）', () => {
  let tmpRoot;
  let buildShard;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), 'rg-bse-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
    mkdirSync(tmpRoot, { recursive: true });
    buildShard = createBuildShardEvidence();
  });

  afterEach(() => {
    if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  });

  // 与 driver 内场景标记正则同构（改实现时本组同步改）
  function sliceShard(raw, start, end) {
    const lines = raw.split(/\r?\n/);
    const sceneHeaderRe = /^━+\s*场景\s*(\d+)\s*[:：]/;
    const segments = [];
    let current = null;
    for (const line of lines) {
      const m = line.match(sceneHeaderRe);
      if (m) {
        if (current) segments.push(current);
        current = { num: parseInt(m[1], 10), lines: [line] };
      } else if (current) {
        current.lines.push(line);
      }
    }
    if (current) segments.push(current);
    return segments.filter(s => s.num >= start && s.num <= end);
  }

  it('非分片步骤返回空串（regression/verdict 不受影响）', () => {
    expect(buildShard(tmpRoot, { inputs: ['x.md'] })).toBe('');
    expect(buildShard(tmpRoot, {})).toBe('');
  });

  it('日志缺失 → 「数据不完整」+ 标 SKIP 指引（fail-closed 不 FAIL）', () => {
    const out = buildShard(tmpRoot, { shard: { id: 1, start: 1, end: 13 } });
    expect(out).toContain('文件不存在');
    expect(out).toContain('数据不完整');
    expect(out).toContain('SKIP');
  });

  it('按 shard 范围切出对应场景段（S1~S13 只含本段，不含 S14+）', () => {
    // run-08 二修后语义化尾部提取只抓权威汇总行（验收测试结果/SUMMARY/全部通过），
    // 不再整段截取日志尾部——S14 场景行天然不会泄入 tail。
    const raw = [
      '━━━ 场景 1: 基线检查 ━━━', '✅ PASS', '',
      '━━━ 场景 5: 审计规则 ━━━', '✅ PASS', '',
      '━━━ 场景 14: 不属于本分片 ━━━', '✅ PASS', '',
      '尾部统计：验收测试结果：3 通过 / 0 失败 / 共 3', '全部通过',
    ].join('\n');
    writeFileSync(join(tmpRoot, 'acceptance-raw.log'), raw);
    const out = buildShard(tmpRoot, { shard: { id: 1, start: 1, end: 13 } });
    expect(out).toContain('场景 1');
    expect(out).toContain('场景 5');
    // 场景正文段不泄入（tail 语义提取只带权威行）
    expect(out).not.toContain('━━━ 场景 14');
    expect(out).toContain('S1~S13');
    // 尾部汇总行必须注入（run-21「预跑日志是权威」）
    expect(out).toContain('验收测试结果：3 通过 / 0 失败');
    expect(out).toContain('全部通过');
  });

  it('范围全跳号 → 提示 SKIP 不视为 FAIL（编号跳号是设计模式）', () => {
    const raw = '━━━ 场景 50: 别的 ━━━\n✅ PASS';
    writeFileSync(join(tmpRoot, 'acceptance-raw.log'), raw);
    const out = buildShard(tmpRoot, { shard: { id: 1, start: 1, end: 13 } });
    expect(out).toContain('未找到 S1~S13');
    expect(out).toContain('SKIP');
    expect(out).toContain('不视为 FAIL');
  });

  it('同构切片器：数字解析稳定（多位数编号 / 全角冒号）', () => {
    const raw = '━━━ 场景 105: 多位数 ━━━\n✅\n━━━ 场景 106：全角冒号 ━━━\n✅';
    const segs = sliceShard(raw, 100, 110);
    expect(segs.map(s => s.num)).toEqual([105, 106]);
  });

  it('runWorker 注入链接线：shardEvidence 进入直连证据面与 userMessage', () => {
    // 源码级断言：三通道拼接（precheck + inputs + shard）
    expect(SOURCE_CODE).toContain("[precheckEvidence, inputsEvidence, shardEvidence].filter(Boolean).join('\\n\\n')");
    expect(SOURCE_CODE).toContain('const shardEvidence = buildShardEvidence(runDir, stepDef);');
    expect(SOURCE_CODE).toContain('shardEvidence,');
  });

  it('{runDir} 占位符统一替换（run-07 实证：旧代码无替换逻辑）', () => {
    expect(SOURCE_CODE).toContain(".replaceAll('{runDir}', runDir)");
  });
});

describe('run-07 四修：verdict 注入预算提升（6000→12000）', () => {
  it('stage6-report.md 7397 字符（run-07 实测体量）全量注入不截断', () => {
    const { fullBody } = extractFunctionBody(SOURCE_CODE, 'buildInputsEvidence');
    const wrapper = new Function(
      'join', 'existsSync', 'readFileSync',
      fullBody + '\nreturn buildInputsEvidence;'
    );
    const buildEv = wrapper(join, existsSync, readFileSync);
    const tmpRoot = join(tmpdir(), 'rg-b12000-' + Date.now());
    mkdirSync(tmpRoot, { recursive: true });
    try {
      const big = '# stage6\n'.repeat(900); // 7200+ 字符，超旧值 6000、低于新值 12000
      writeFileSync(join(tmpRoot, 'stage6-report.md'), big);
      const out = buildEv(tmpRoot, { inputs: ['stage6-report.md'] });
      expect(out).not.toContain('…（截断');
      // 截断提示以字符计量并显式注明（防 V 字节/字符误读复发）
      expect(SOURCE_CODE).toContain('字符数非字节数');
      expect(SOURCE_CODE).toContain('12_000');
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

describe('run-07 四修：extractVerdictKeyword 条件通过语义映射', () => {
  // 与 driver 内实现同构提取（改实现时本组同步改）
  function createExtractor() {
    const { fullBody } = extractFunctionBody(SOURCE_CODE, 'extractVerdictKeyword');
    const wrapper = new Function(fullBody + '\nreturn extractVerdictKeyword;');
    return wrapper();
  }

  it('「有条件通过（CONDITIONAL PASS）」→ PASS（run-07 coverage 实测措辞）', () => {
    const extract = createExtractor();
    expect(extract('## 一、总体结论\n\n**有条件通过（CONDITIONAL PASS）**。\n\n- 无 P0 阻塞项。')).toBe('PASS');
  });

  it('「96/96 维度全部通过」叙述句 → PASS（run-07 regression 实测措辞）', () => {
    const extract = createExtractor();
    expect(extract('## 一、总体结论\n\n- **96 / 96 维度全部通过**：所有维度退出码为 0。')).toBe('PASS');
  });

  it('否定组优先：不通过/不予放行仍判 FAIL（防肯定词抢先命中）', () => {
    const extract = createExtractor();
    expect(extract('## 结论\n\n不通过（BLOCKED）')).toBe('FAIL');
    expect(extract('## 结论\n\n不予放行，暂缓发布')).toBe('FAIL');
  });

  it('裸词 PASS/FAIL 既有路径不回归', () => {
    const extract = createExtractor();
    expect(extract('## 结论\nPASS')).toBe('PASS');
    expect(extract('## 终审结论\n\n❌ 不通过（BLOCKED）—— 维持发布冻结')).toBe('FAIL');
  });
});

// ═══════════════════════════════════════════════════════════
//  9b. run-08 三修测试组（真实产物回放）
// ═══════════════════════════════════════════════════════════
// 背景：run-08 完整跑通后零信任核验发现 driver 记账「全 PASS」与产物原文
// 「BLOCK」脱钩——三处根因（同构回放实锤）：
//   ① verdict.md L24 叙述句「三项上游判定（…coverage 有条件通过…）」被
//      run-07 宽松肯定组提前抓中 → return PASS，真裁决行「闸门最终状态：BLOCK」
//      无既有 marker 字样轮不到；
//   ② extractAcceptanceResult 日志权威（368/368 → PASS）覆盖 consolidate 的
//      BLOCK 裁决（run-21 口径未覆盖「日志与审查冲突」形态）；
//   ③ consolidate 固定 20000 注入总额 → 12 分片报告 s8~s12 静默截断。

describe('run-08 三修：verdict 强标记组前置 + 叙述句 BLOCK 否决', () => {
  // 与 driver 内实现同构提取（改实现时本组同步改）
  function createExtractor() {
    const { fullBody } = extractFunctionBody(SOURCE_CODE, 'extractVerdictKeyword');
    const wrapper = new Function(fullBody + '\nreturn extractVerdictKeyword;');
    return wrapper();
  }

  it('run-08 verdict.md 实录回放：叙述句混排不再抢 PASS，强组裁决 BLOCK 胜出', () => {
    const extract = createExtractor();
    // 按真实 verdict.md 结构构造：L14「最终裁定」标题、L16 真裁决行、L24 叙述句
    const doc = [
      '# sofagent 发版闸门最终裁定报告（verdict.md）',
      '',
      '## 一、最终裁定',
      '',
      '**🚫 发版闸门维持 BLOCK**',
      '',
      '三项上游判定（acceptance **BLOCK** / regression **PASS** / coverage **有条件通过**）在"任一关卡存在 P0 即整体阻塞"的闸门口径下。',
      '',
      '## 七、放行条件最终确认',
      '',
      '**闸门最终状态：BLOCK** ❌ —— 全部闭环前，禁止放行。',
    ].join('\n');
    expect(extract(doc)).toBe('FAIL');
  });

  it('叙述句窗口含英文 BLOCK 时肯定词拒判 → null（上层 fail-closed 记 SKIP/ERROR）', () => {
    const extract = createExtractor();
    // 「结论」标记的窗口内是叙述句：含「有条件通过」也含 BLOCK → 不得判 PASS；
    // 也不得判 FAIL（PASS 报告的结论窗口可能引用「acceptance BLOCK」叙述），
    // 返回 null 让上层按「未知」处理（parseStepResults→SKIP / parseVerdict→ERROR）。
    const doc = '## 结论\n\n三项上游判定（acceptance BLOCK / regression PASS / coverage 有条件通过）已复核。';
    expect(extract(doc)).toBeNull();
  });

  it('run-08 coverage.md 实录回放：闸门判定：有条件通过 → PASS（强组捕获）', () => {
    const extract = createExtractor();
    const doc = [
      '## 二、总体结论',
      '',
      '- **meta 自洽性：通过。** 与 modules=15 一致。',
      '',
      '## 六、闸门判定',
      '',
      '**有条件通过（PASS with conditions）。**',
    ].join('\n');
    expect(extract(doc)).toBe('PASS');
  });

  it('run-07 regression 实录回放不回归：「96/96 维度全部通过」仍 PASS', () => {
    const extract = createExtractor();
    // regression 无强组词，走普通组「结论」窗口 → BLOCK 否决不触发（窗口无英文否定词）
    const doc = '## 二、总体结论\n\n**PASS —— regression 关卡通过。**\n\n96/96 维度全部通过。';
    expect(extract(doc)).toBe('PASS');
  });

  it('源码级：强标记组必须先于普通组扫描', () => {
    const fnIdx = SOURCE_CODE.indexOf('function extractVerdictKeyword');
    const strongIdx = SOURCE_CODE.indexOf('strongMarkers', fnIdx);
    const plainIdx = SOURCE_CODE.indexOf("const plainMarkers = ['判定', '结论']", fnIdx);
    expect(strongIdx).toBeGreaterThan(-1);
    expect(plainIdx).toBeGreaterThan(strongIdx);
  });
});

describe('run-08 三修：acceptance 记账 fail-closed（日志 PASS + 审查 FAIL → 冲突即 FAIL）', () => {
  // 同构提取 extractAcceptanceResult（闭包依赖 extractResult/join/existsSync/readFileSync/runDir）
  const FAKE_LOG = '验收测试结果：368 通过 / 0 失败 / 共 368\n✅ 全部通过，可以进入发版流程';
  function createAcceptor(runDir, reportKeyword) {
    const { fullBody } = extractFunctionBody(SOURCE_CODE, 'extractAcceptanceResult');
    const extractResult = (filename) => reportKeyword;
    const fn = new Function(
      'join', 'existsSync', 'readFileSync', 'extractResult', 'runDir',
      fullBody + '\nreturn extractAcceptanceResult;'
    );
    return fn(
      (...a) => a.filter(Boolean).join('/'),
      () => true,
      () => FAKE_LOG, // 模拟可解析的预跑日志（368/368 + 全部通过 → logResult=PASS）
      extractResult,
      runDir,
    );
  }

  it('日志可解析 PASS + 合并报告 FAIL → 冲突即 FAIL（run-08 实录形态）', () => {
    const extract = createAcceptor('/tmp/whatever', 'FAIL');
    expect(extract()).toBe('FAIL');
  });

  it('日志 PASS + 报告 PASS → PASS（不回归）', () => {
    const extract = createAcceptor('/tmp/whatever', 'PASS');
    expect(extract()).toBe('PASS');
  });

  it('日志 PASS + 报告 SKIP → 日志权威 PASS（run-21 口径维持）', () => {
    const extract = createAcceptor('/tmp/whatever', 'SKIP');
    expect(extract()).toBe('PASS');
  });
});

// ═══════════════════════════════════════════════════════════
//  9. run-08 二修测试组（真实日志回放）
// ═══════════════════════════════════════════════════════════
// 背景：run-08 首跑实证两个新 bug——
//   ① raw.log 场景行带 ANSI 色码前缀（\x1b[0;36m）→ `^━` 锚定正则
//      291 场景段全数脱靶 → 分片全判 SKIP；
//   ② 尾部汇总行物理上在最后一个场景段内部（脚本末场景后直接打印统计），
//      按行索引反查段尾位置时段尾空行命中日志末尾 → tail 只剩空串。

describe('run-08 二修：ANSI 剥离 + 语义化尾部提取', () => {
  let tmpRoot;
  let buildShard;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), 'rg-ansi-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
    mkdirSync(tmpRoot, { recursive: true });
    buildShard = createBuildShardEvidence();
  });

  afterEach(() => {
    if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('ANSI 色码场景行可解析（run-08 实证：\\x1b[0;36m 前缀致 291 段全脱靶）', () => {
    const raw = [
      '\x1b[0;36m━━━ 场景 1: Fresh install（--install-hook） ━━━\x1b[0m',
      '  \x1b[0;32m✅ PASS\x1b[0m',
      '',
      '\x1b[0;36m━━━ 场景 2: --init 一键初始化 ━━━\x1b[0m',
      '  ✅ PASS',
      '',
      '  验收测试结果：2 通过 / 0 失败 / 共 2',
      'SUMMARY: 2/2 passed · EXIT: 0',
      '✅ 全部通过，可以进入发版流程',
    ].join('\n');
    writeFileSync(join(tmpRoot, 'acceptance-raw.log'), raw);
    const out = buildShard(tmpRoot, { shard: { id: 1, start: 1, end: 13 } });
    // 场景段必须被切出（ANSI 剥离生效）
    expect(out).toContain('场景 1');
    expect(out).toContain('场景 2');
    expect(out).not.toContain('未找到 S1~S13');
    // 尾部权威行必须进注入（语义提取生效）
    expect(out).toContain('SUMMARY: 2/2 passed');
    expect(out).toContain('全部通过');
  });

  it('汇总行带前导缩进也能抓到（真实日志为「  验收测试结果：…」）', () => {
    const raw = [
      '\x1b[0;36m━━━ 场景 1: x ━━━\x1b[0m',
      '  ✅ PASS',
      '  验收测试结果：368 通过 / 0 失败 / 共 368',
      'SUMMARY: 368/368 passed · EXIT: 0',
      '✅ 全部通过，可以进入发版流程',
    ].join('\n');
    writeFileSync(join(tmpRoot, 'acceptance-raw.log'), raw);
    const out = buildShard(tmpRoot, { shard: { id: 1, start: 1, end: 13 } });
    expect(out).toContain('368 通过 / 0 失败');
    expect(out).toContain('EXIT: 0');
  });

  it('语义提取失败时降级为尾部 5 行非空行（日志格式漂移不空手）', () => {
    const raw = '\x1b[0;36m━━━ 场景 1: x ━━━\x1b[0m\n✅ PASS\n未知格式尾部A\n未知格式尾部B';
    writeFileSync(join(tmpRoot, 'acceptance-raw.log'), raw);
    const out = buildShard(tmpRoot, { shard: { id: 1, start: 1, end: 13 } });
    expect(out).toContain('未知格式尾部');
  });

  it('源码级：buildShardEvidence 必须先剥离 ANSI 再切片', () => {
    // 剥离语句必须在场景头正则定义之前
    const stripIdx = SOURCE_CODE.indexOf("raw.replace(/\\x1b\\[[0-9;]*m/g, '')", SOURCE_CODE.indexOf('function buildShardEvidence'));
    const regexIdx = SOURCE_CODE.indexOf('sceneHeaderRe = ', SOURCE_CODE.indexOf('function buildShardEvidence'));
    expect(stripIdx).toBeGreaterThan(-1);
    expect(stripIdx).toBeLessThan(regexIdx);
  });
});

// ═══════════════════════════════════════════════════════════
//  9c. run-08 P0-1 修复测试组（场景 28 / --doctor flag / WARN 计数口径）
// ═══════════════════════════════════════════════════════════
// 背景：run-08 verdict P0-1 双面根因——
//   产品面：core CLI 只认裸词子命令（doctor），场景 28 用 --doctor flag →
//     Unknown subcommand（无 post-commit 字样）→ 断言不中；
//   harness 面：warn() 不计数 → WARN 场景从「共 N」分母蒸发 → 汇总
//     「368/368 全部通过」与场景 28 WARN 并存自相矛盾。
// 修复：cli.ts flag 别名路由（--doctor → doctor）+ warn 计数进汇总第三类
//   「N 跳过」+ 场景 28 断言失败改 fail + 「全部通过」判定加 WARNED=0 门槛。

describe('run-08 P0-1：core CLI --doctor flag 别名路由', () => {
  it('源码级：--doctor flag 归一到 doctor 子命令', () => {
    const cliSrc = readFileSync(new URL('../../engine/core/src/cli.ts', import.meta.url), 'utf-8');
    // flag 别名路由必须存在（rawArgs[0] === '--doctor' → 'doctor'）
    expect(cliSrc).toContain("rawArgs[0] === '--doctor' ? 'doctor'");
  });

  it('行为级：--doctor 输出 post-commit 检测行（dist 实测，场景 28 断言回放）', () => {
    // 场景 28 的断言词表：post-commit / post_commit / post commit 或 ❌/hook 缺
    const cliDist = new URL('../../engine/core/dist/cli.js', import.meta.url).pathname;
    if (!existsSync(cliDist)) return; // dist 未构建时跳过（CI 会构建）
    const { execFileSync } = require('child_process');
    const tmp = join(tmpdir(), 'rg-p01-' + Date.now());
    mkdirSync(tmp, { recursive: true });
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: tmp });
      // doctor 在 allOk=false 时 exit 1（如常）——不能让 execFileSync 因非零码抛错
      let out = '';
      try { out = execFileSync('node', [cliDist, '--doctor'], { encoding: 'utf-8', cwd: tmp }); }
      catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
      // 删 post-commit 后（新仓库本就没有）doctor 必须报 post-commit 未安装
      expect(out).toMatch(/post-commit hook 未安装/);
      expect(out).not.toMatch(/Unknown subcommand/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('run-08 P0-1：acceptance-test.sh WARN 计数口径', () => {
  const SH = readFileSync(new URL('../playbook/acceptance-test.sh', import.meta.url), 'utf-8');

  it('warn() 计数 WARNED（不再静默蒸发）', () => {
    // warn() 行内含 WARNED 计数（${YELLOW} 的 } 会截断 [^}]*——用行级断言）
    const warnLine = SH.split('\n').find(l => l.startsWith('warn()'));
    expect(warnLine).toBeTruthy();
    expect(warnLine).toContain('WARNED=$((WARNED + 1))');
  });

  it('汇总行含第三类「N 跳过」+ SUMMARY 行含 SKIP 数', () => {
    // 汇总行是 ${YELLOW}$WARNED 跳过${NC}——断言以 $WARNED 与「跳过」分别存在
    expect(SH).toContain('$WARNED 跳过');
    expect(SH).toContain('SKIP: ${WARNED}');
    expect(SH).toContain('PASSED + FAILED + WARNED');
  });

  it('「全部通过」判定加 WARNED=0 门槛（跳过存在不得宣称全过）', () => {
    expect(SH).toMatch(/\[ "\$WARNED" -gt 0 \]/);
    expect(SH).toContain('跳过（证据面不完整），放行前补跑');
  });

  it('场景 28 断言失败改 fail（fail-closed，不再降级 warn）', () => {
    const s28 = SH.slice(SH.indexOf('scenario 28'), SH.indexOf('scenario 29'));
    expect(s28).toContain('fail "--doctor 未检测到 post-commit hook 丢失"');
    expect(s28).not.toContain('warn "--doctor');
  });
});

describe('run-08 P0-1：driver 汇总行联动（跳过行进分片证据）', () => {
  let tmpRoot, buildShard;
  beforeEach(() => {
    tmpRoot = join(tmpdir(), 'rg-p01s-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
    mkdirSync(tmpRoot, { recursive: true });
    buildShard = createBuildShardEvidence();
  });
  afterEach(() => { if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true }); });

  it('新汇总三态行（含跳过）全部进入分片注入', () => {
    const raw = [
      '━━━ 场景 1: x ━━━',
      '  ✅ PASS',
      '  验收测试结果：368 通过 / 0 失败 / 6 跳过 / 共 374',
      'SUMMARY: 368/374 passed · SKIP: 6 · EXIT: 0',
      '⚠️  有 6 个场景因环境依赖跳过（证据面不完整），放行前补跑',
    ].join('\n');
    writeFileSync(join(tmpRoot, 'acceptance-raw.log'), raw);
    const out = buildShard(tmpRoot, { shard: { id: 1, start: 1, end: 13 } });
    expect(out).toContain('368 通过 / 0 失败 / 6 跳过');
    expect(out).toContain('SKIP: 6');
    expect(out).toContain('有 6 个场景因环境依赖跳过');
  });

  it('extractAcceptanceResult：跳过存在（无「全部通过」行）→ FAIL（证据面缺失 fail-closed）', () => {
    const { fullBody } = extractFunctionBody(SOURCE_CODE, 'extractAcceptanceResult');
    const extractResult = () => 'SKIP';
    const fn = new Function('join', 'existsSync', 'readFileSync', 'extractResult', 'runDir',
      fullBody + '\nreturn extractAcceptanceResult;');
    const extract = fn(
      (...a) => a.filter(Boolean).join('/'),
      () => true,
      () => '验收测试结果：368 通过 / 0 失败 / 6 跳过 / 共 374\nSUMMARY: 368/374 passed · SKIP: 6 · EXIT: 0\n⚠️  有 6 个场景因环境依赖跳过',
      extractResult,
      '/tmp/x',
    );
    expect(extract()).toBe('FAIL'); // 无「全部通过」行 → 不满足 PASS 三条件 → FAIL
  });
});
