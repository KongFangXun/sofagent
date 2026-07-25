// ============================================================
// FORGE/src/fresh-eyes-driver.test.mjs · fresh-eyes-driver 单元测试
//
// 覆盖四个核心函数：
//   1. sliceMultiOutput  — 多产物切片（纯函数）
//   2. parseStopCondition — 停止条件判定（文件 IO）
//   3. resolveRunDir     — 目录生成（文件 IO + 路径逻辑）
//   4. appendLedger      — LEDGER 追加格式（文件 IO）
//
// 被测脚本未 export 任何函数，通过读取源码 + new Function 反射访问。
// 所有文件操作用 os.tmpdir() 做临时根，测试后清理。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ─── 反射访问未导出的内部函数 ───────────────────────────────
// 被测脚本没有 export，但函数体是自包含的纯逻辑。
// 我们读源码，提取函数体，用 new Function 在可控作用域中执行。

const SOURCE_PATH = new URL('./fresh-eyes-driver.mjs', import.meta.url);
const SOURCE_CODE = readFileSync(SOURCE_PATH, 'utf-8');

/**
 * 从源码中提取指定函数的函数体并返回可调用的函数。
 *
 * 策略：用正则匹配 `function funcName(params) { ... }`，
 * 花括号配平提取完整函数体。由于被测函数内部不依赖外部 import
 * （sliceMultiOutput 是纯函数，parseStopCondition 只依赖 join/readFileSync/existsSync），
 * 我们把这些依赖通过参数注入。
 */
function extractFunctionBody(source, funcName) {
  // 匹配 function funcName(...) {
  const startRegex = new RegExp(`function\\s+${funcName}\\s*\\([^)]*\\)\\s*\\{`);
  const startMatch = startRegex.exec(source);
  if (!startMatch) throw new Error(`无法找到函数 ${funcName}`);

  // 从 `{` 开始花括号配平，提取完整函数体
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
  // 提取参数列表
  const paramMatch = startMatch[0].match(/\(([^)]*)\)/);
  const params = paramMatch ? paramMatch[1].split(',').map(s => s.trim()).filter(Boolean) : [];
  return { params, fullBody };
}

/**
 * 构建 sliceMultiOutput 的可测试包装。
 *
 * sliceMultiOutput 内部只用了：trim(), 正则匹配, 数组操作 — 全是纯 JS。
 * 直接提取函数体，用 new Function 包装。
 */
function createSliceMultiOutput() {
  const { params, fullBody } = extractFunctionBody(SOURCE_CODE, 'sliceMultiOutput');
  // 构造函数：参数 + 函数体，通过 new Function 执行
  // fullBody 是完整的 `function sliceMultiOutput(text, outputs) { ... }`
  const wrapper = new Function(fullBody + '\nreturn sliceMultiOutput;');
  return wrapper();
}

/**
 * 构建 parseStopCondition 的可测试包装。
 *
 * parseStopCondition 内部依赖：join, existsSync, readFileSync。
 * 我们提供这些依赖的实现（可指向临时目录），然后调用真实逻辑。
 */
function createParseStopCondition(joinFn, existsSyncFn, readFileSyncFn) {
  const { fullBody } = extractFunctionBody(SOURCE_CODE, 'parseStopCondition');
  // 用字符串替换把 join/existsSync/readFileSync 替换为注入版本
  // 更安全的方式：包装一层，在函数内 shadow 这些依赖
  const wrapper = new Function(
    'join', 'existsSync', 'readFileSync',
    fullBody + '\nreturn parseStopCondition;'
  );
  return wrapper(joinFn, existsSyncFn, readFileSyncFn);
}

// ═══════════════════════════════════════════════════════════
//  1. sliceMultiOutput 测试套件
// ═══════════════════════════════════════════════════════════

describe('sliceMultiOutput', () => {
  let sliceMultiOutput;

  beforeEach(() => {
    sliceMultiOutput = createSliceMultiOutput();
  });

  // ─── 正常路径 ───────────────────────────────────────────

  // 测试：正常双分隔符输入应正确切分为两个文件内容
  // 输入：包含 ===FILE: findings.md=== 和 ===FILE: result.md=== 的文本
  // 预期：返回 { 'findings.md': '<findings正文>', 'result.md': '<result正文>' }
  it('正常双分隔符 → 正确切两份', () => {
    const text = [
      '===FILE: findings.md===',
      '这是 findings 正文',
      '',
      '===FILE: result.md===',
      '这是 result 正文',
    ].join('\n');

    const result = sliceMultiOutput(text, ['findings.md', 'result.md']);
    expect(result['findings.md']).toBe('这是 findings 正文');
    expect(result['result.md']).toBe('这是 result 正文');
  });

  // 测试：无分隔符时应 fallback 全写第一个产物，其余写空占位提示
  // 输入：没有任何 ===FILE: 分隔符的纯文本
  // 预期：outputs[0] 得到完整文本，其余得到空占位提示
  it('无分隔符 → fallback 全写第一个，其余空占位', () => {
    const text = '这是一段没有分隔符的纯文本输出';
    const result = sliceMultiOutput(text, ['findings.md', 'result.md']);

    expect(result['findings.md']).toBe('这是一段没有分隔符的纯文本输出');
    expect(result['result.md']).toContain('未检测到');
    expect(result['result.md']).toContain('===FILE:');
  });

  // 测试：分隔符前后多余空格应被正确 trim
  // 输入：===FILE:  findings.md  === 带额外空格
  // 预期：文件名正确提取为 findings.md，正文前后空白被 trim
  it('分隔符前后多余空格 → trim 正确', () => {
    const text = [
      '===FILE:  findings.md  ===',
      '   正文前面有空格   ',
      '',
      '===FILE: result.md===',
      'result 内容',
    ].join('\n');

    const result = sliceMultiOutput(text, ['findings.md', 'result.md']);
    expect(result['findings.md']).toBe('正文前面有空格');
    expect(result['result.md']).toBe('result 内容');
  });

  // 测试：agent 漏产出某文件时该文件应得到空占位提示，不崩溃
  // 输入：只有 findings.md 的分隔符，期望列表含 result.md
  // 预期：findings.md 正常，result.md 得到 "agent 未产出此文件" 提示
  it('agent 漏产出某文件 → 该文件空占位提示，不崩', () => {
    const text = [
      '===FILE: findings.md===',
      'findings 正文',
    ].join('\n');

    const result = sliceMultiOutput(text, ['findings.md', 'result.md']);
    expect(result['findings.md']).toBe('findings 正文');
    expect(result['result.md']).toContain('未产出');
  });

  // 测试：单产物（outputs.length===1）时不应走切片逻辑
  // 输入：有分隔符但 outputs 只有一个元素
  // 预期：分隔符文本正常解析，第一个产物拿到分隔符后内容
  // 注：sliceMultiOutput 不区分单/多——调用方（runWorker）在调用前判断。
  //     这里验证即使传单元素数组也能正常工作不报错。
  it('单产物数组传入不报错', () => {
    const text = '纯文本输出无分隔符';
    const result = sliceMultiOutput(text, ['summary.md']);
    expect(result['summary.md']).toBe('纯文本输出无分隔符');
  });

  // 测试：分隔符在文本中间但前后有正文时，前言应被丢弃
  // 输入：前面有一段前言，然后才是 ===FILE: findings.md===
  // 预期：前言不写入任何产物，findings 只取分隔符之后内容
  it('分隔符前有前言 → 前言丢弃', () => {
    const text = [
      '这是前言，不应出现在任何产物中',
      '',
      '===FILE: findings.md===',
      'findings 正文',
      '',
      '===FILE: result.md===',
      'result 正文',
    ].join('\n');

    const result = sliceMultiOutput(text, ['findings.md', 'result.md']);
    expect(result['findings.md']).toBe('findings 正文');
    expect(result['result.md']).toBe('result 正文');
    // 前言不应出现在任何 slice 中
    expect(result['findings.md']).not.toContain('前言');
    expect(result['result.md']).not.toContain('前言');
  });

  // ─── 边界情况 ───────────────────────────────────────────

  // 测试：空字符串输入应返回空占位
  // 输入：''
  // 预期：第一个产物得到空字符串，其余得到空占位提示
  it('空字符串输入 → fallback 到第一个产物（空串），其余空占位', () => {
    const result = sliceMultiOutput('', ['findings.md', 'result.md']);
    expect(result['findings.md']).toBe('');
    expect(result['result.md']).toContain('未检测到');
  });

  // 测试：只有分隔符没有内容
  // 输入：===FILE: findings.md===\n\n===FILE: result.md===
  // 预期：两个文件都得到空字符串（trim 后）
  it('只有分隔符没有内容 → 两文件都为空串', () => {
    const text = [
      '===FILE: findings.md===',
      '',
      '===FILE: result.md===',
      '',
    ].join('\n');

    const result = sliceMultiOutput(text, ['findings.md', 'result.md']);
    expect(result['findings.md']).toBe('');
    expect(result['result.md']).toBe('');
  });

  // 测试：三分隔符（三产物）场景应正确切片
  // 输入：三个 ===FILE: 分隔符，三个产物
  // 预期：每个文件得到正确内容
  it('三产物场景 → 正确切三份', () => {
    const text = [
      '===FILE: a.md===',
      '内容A',
      '',
      '===FILE: b.md===',
      '内容B',
      '',
      '===FILE: c.md===',
      '内容C',
    ].join('\n');

    const result = sliceMultiOutput(text, ['a.md', 'b.md', 'c.md']);
    expect(result['a.md']).toBe('内容A');
    expect(result['b.md']).toBe('内容B');
    expect(result['c.md']).toBe('内容C');
  });

  // 测试：分隔符大小写不一致（应不匹配——正则是大小写敏感的）
  // 输入：===file: findings.md===（小写 file）
  // 预期：不匹配分隔符，走 fallback
  it('分隔符大小写不一致 → 不匹配，走 fallback', () => {
    const text = [
      '===file: findings.md===',
      '内容',
    ].join('\n');

    const result = sliceMultiOutput(text, ['findings.md', 'result.md']);
    // 小写 file 不匹配 → 走 fallback：全文写入第一个
    expect(result['findings.md']).toContain('内容');
    expect(result['result.md']).toContain('未检测到');
  });

  // 测试：产物列表中文件名与分隔符文件名不完全匹配时的补齐
  // 输入：agent 产出了 a.md 和 c.md，但期望列表是 a.md, b.md, c.md
  // 预期：a.md 和 c.md 正常，b.md 得到空占位提示
  it('期望列表多出的文件名 → 得到空占位提示', () => {
    const text = [
      '===FILE: a.md===',
      '内容A',
      '',
      '===FILE: c.md===',
      '内容C',
    ].join('\n');

    const result = sliceMultiOutput(text, ['a.md', 'b.md', 'c.md']);
    expect(result['a.md']).toBe('内容A');
    expect(result['c.md']).toBe('内容C');
    expect(result['b.md']).toContain('未产出');
  });
});

// ═══════════════════════════════════════════════════════════
//  2. parseStopCondition 测试套件
// ═══════════════════════════════════════════════════════════

describe('parseStopCondition', () => {
  let tmpRoot;

  beforeEach(() => {
    // 每个测试用独立临时目录
    tmpRoot = join(tmpdir(), `fest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tmpRoot, { recursive: true });
  });

  afterEach(() => {
    // 清理临时目录
    if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  });

  // 辅助：在临时 roundDir 中创建 parseStopCondition 的可调用实例
  function makeParser(roundDir) {
    return createParseStopCondition(
      join,
      existsSync,
      readFileSync
    );
  }

  // 测试：findings.md 含 P0 标记 → p0>0, isClean=false
  // 输入：findings.md 包含 "P0" 标记
  // 预期：p0 >= 1, isClean === false
  it('findings.md 有 P0 → p0>0, isClean=false', () => {
    const roundDir = join(tmpRoot, 'round-01');
    mkdirSync(roundDir, { recursive: true });
    writeFileSync(join(roundDir, 'findings.md'), '# 审查发现\n\n## P0 严重问题\n这是一个 P0 级别的缺陷\n');

    const parse = makeParser(roundDir);
    const result = parse(roundDir);

    expect(result.p0).toBeGreaterThanOrEqual(1);
    expect(result.isClean).toBe(false);
  });

  // 测试：findings.md 有 P1 但无 P0 → isClean=false
  // 输入：findings.md 包含 "P1" 但不含 "P0"
  // 预期：p1 >= 1, p0 === 0, isClean === false
  it('findings.md 有 P1 无 P0 → isClean=false', () => {
    const roundDir = join(tmpRoot, 'round-01');
    mkdirSync(roundDir, { recursive: true });
    writeFileSync(join(roundDir, 'findings.md'), '# 审查发现\n\n## P1 一般问题\n这是一个 P1 级别的问题\n');

    const parse = makeParser(roundDir);
    const result = parse(roundDir);

    expect(result.p1).toBeGreaterThanOrEqual(1);
    expect(result.p0).toBe(0);
    expect(result.isClean).toBe(false);
  });

  // 测试：findings.md 只有 P2 → isClean=true
  // 输入：findings.md 只包含 "P2" 标记
  // 预期：p2 >= 1, p0 === 0, p1 === 0, isClean === true
  it('findings.md 只有 P2 → isClean=true', () => {
    const roundDir = join(tmpRoot, 'round-01');
    mkdirSync(roundDir, { recursive: true });
    writeFileSync(join(roundDir, 'findings.md'), '# 审查发现\n\n## P2 建议优化\n这是一个 P2 级别的建议\n');

    const parse = makeParser(roundDir);
    const result = parse(roundDir);

    expect(result.p2).toBeGreaterThanOrEqual(1);
    expect(result.p0).toBe(0);
    expect(result.p1).toBe(0);
    expect(result.isClean).toBe(true);
  });

  // 测试：result.md verify 列含 FAIL → hasFail=true, isClean=false
  // 输入：result.md 包含 "FAIL" 标记
  // 预期：hasFail === true, isClean === false
  it('result.md verify 列有 FAIL → hasFail=true, isClean=false', () => {
    const roundDir = join(tmpRoot, 'round-01');
    mkdirSync(roundDir, { recursive: true });
    writeFileSync(join(roundDir, 'result.md'), '# 验证结果\n\n| 项目 | verify |\n|------|--------|\n| 模块A | FAIL |\n');
    writeFileSync(join(roundDir, 'findings.md'), '# 无严重问题\n仅有 P2 建议\n');

    const parse = makeParser(roundDir);
    const result = parse(roundDir);

    expect(result.hasFail).toBe(true);
    expect(result.isClean).toBe(false);
  });

  // 测试：findings.md 和 result.md 都不存在 → 返回默认值
  // 输入：空 roundDir（无 findings.md，无 result.md）
  // 预期：p0=0, p1=0, p2=0, hasFail=false, isClean=true
  it('findings.md + result.md 都不存在 → 返回默认值（全零, isClean=true）', () => {
    const roundDir = join(tmpRoot, 'round-01');
    mkdirSync(roundDir, { recursive: true });

    const parse = makeParser(roundDir);
    const result = parse(roundDir);

    expect(result.p0).toBe(0);
    expect(result.p1).toBe(0);
    expect(result.p2).toBe(0);
    expect(result.hasFail).toBe(false);
    expect(result.isClean).toBe(true);
  });

  // 测试：混合场景 P0 + P2 + FAIL → 准确计数
  // 输入：findings.md 含 2个 P0 标记 + 1个 P2 标记（正文不含额外优先级字样），result.md 含 FAIL
  // 预期：p0=2, p1=0, p2=1, hasFail=true, isClean=false
  // 注意：正则 /\bP0\b/g 匹配所有出现位置（含正文），故测试数据正文中不写 P0/P1/P2 字样避免歧义
  it('混合 P0+P2+FAIL → 准确计数', () => {
    const roundDir = join(tmpRoot, 'round-01');
    mkdirSync(roundDir, { recursive: true });
    writeFileSync(join(roundDir, 'findings.md'), [
      '# 审查发现',
      '',
      '## P0 严重问题一',
      '这是第一个严重缺陷的描述',
      '',
      '## P0 严重问题二',
      '这是第二个严重缺陷的描述',
      '',
      '## P2 建议优化',
      '这是一个建议级别的事项',
      '',
    ].join('\n'));
    writeFileSync(join(roundDir, 'result.md'), '| verify |\n|--------|\n| FAIL |\n');

    const parse = makeParser(roundDir);
    const result = parse(roundDir);

    expect(result.p0).toBe(2);
    expect(result.p1).toBe(0);
    expect(result.p2).toBe(1);
    expect(result.hasFail).toBe(true);
    expect(result.isClean).toBe(false);
  });

  // 测试：FAIL 不区分大小写
  // 输入：result.md 含小写 "fail"
  // 预期：hasFail === true（正则用了 /i 标志）
  it('result.md 含小写 fail → hasFail=true（大小写不敏感）', () => {
    const roundDir = join(tmpRoot, 'round-01');
    mkdirSync(roundDir, { recursive: true });
    writeFileSync(join(roundDir, 'result.md'), '| verify |\n|--------|\n| fail |\n');

    const parse = makeParser(roundDir);
    const result = parse(roundDir);

    expect(result.hasFail).toBe(true);
  });

  // 测试：多个 P1 标记准确计数
  // 输入：findings.md 含 3 个 P1 标记
  // 预期：p1 === 3
  it('多个 P1 标记 → 准确计数为 3', () => {
    const roundDir = join(tmpRoot, 'round-01');
    mkdirSync(roundDir, { recursive: true });
    writeFileSync(join(roundDir, 'findings.md'), [
      '# 审查发现',
      'P1 问题一',
      'P1 问题二',
      'P1 问题三',
    ].join('\n'));

    const parse = makeParser(roundDir);
    const result = parse(roundDir);

    expect(result.p1).toBe(3);
    expect(result.p0).toBe(0);
    expect(result.isClean).toBe(false);
  });

  // 测试：完全干净的 findings + result → isClean=true
  // 输入：findings.md 只有 P2，result.md verify 全 PASS
  // 预期：isClean === true
  it('findings 只有 P2 + result 全 PASS → isClean=true', () => {
    const roundDir = join(tmpRoot, 'round-01');
    mkdirSync(roundDir, { recursive: true });
    writeFileSync(join(roundDir, 'findings.md'), '# 审查发现\nP2 建议优化\n');
    writeFileSync(join(roundDir, 'result.md'), '| verify |\n|--------|\n| PASS |\n');

    const parse = makeParser(roundDir);
    const result = parse(roundDir);

    expect(result.p2).toBe(1);
    expect(result.hasFail).toBe(false);
    expect(result.isClean).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
//  3. resolveRunDir 测试套件
// ═══════════════════════════════════════════════════════════
//
// resolveRunDir 内部使用硬编码的 RUNS_DIR 常量，无法通过参数注入。
// 我们通过 new Function 重建函数，注入自定义的 RUNS_DIR 指向临时目录，
// 同时注入 existsSync / readdirSync / mkdirSync 等依赖。

function createResolveRunDir(runsDir, fsDeps) {
  const { fullBody } = extractFunctionBody(SOURCE_CODE, 'resolveRunDir');
  // 在函数体内，RUNS_DIR 是闭包外部的常量，我们无法直接替换。
  // 策略：提取函数体逻辑，用 new Function 重新构建，注入所有依赖。
  // 函数体中用到了：existsSync, readdirSync, mkdirSync, join, new Date()
  // RUNS_DIR 需要从 join(RUNS_DIR, y, m, d) 替换为 join(runsDir, y, m, d)
  //
  // 最干净的方式：把函数体中所有 join(RUNS_DIR 替换为 join(runsDir
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
    tmpRoot = join(tmpdir(), `fest-rd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tmpRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  });

  // 测试：同日首次跑 → run-01
  // 输入：空的日期目录（同日无历史 run）
  // 预期：生成 run-01 目录，runId 含 -01
  it('同日首次跑 → run-01', () => {
    const resolve = createResolveRunDir(tmpRoot, {
      existsSync, readdirSync, mkdirSync,
    });

    const { runDir, runId } = resolve();

    // 目录路径以 run-01 结尾
    expect(runDir).toMatch(/run-01$/);
    // runId 格式 YYYYMMDD-01
    expect(runId).toMatch(/-01$/);
    // 目录实际被创建
    expect(existsSync(runDir)).toBe(true);
  });

  // 测试：同日已有 run-01 → run-02
  // 输入：日期目录下已有 run-01
  // 预期：生成 run-02
  it('同日已有 run-01 → run-02', () => {
    // 先创建今天的日期目录并放一个 run-01
    const now = new Date();
    const y = String(now.getFullYear());
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const dateDir = join(tmpRoot, y, m, d);
    mkdirSync(join(dateDir, 'run-01'), { recursive: true });

    const resolve = createResolveRunDir(tmpRoot, {
      existsSync, readdirSync, mkdirSync,
    });

    const { runDir, runId } = resolve();

    expect(runDir).toMatch(/run-02$/);
    expect(runId).toMatch(/-02$/);
    expect(existsSync(runDir)).toBe(true);
  });

  // 测试：同日已有 run-01 和 run-02 → run-03
  // 输入：日期目录下已有 run-01, run-02
  // 预期：生成 run-03
  it('同日已有 run-01 + run-02 → run-03', () => {
    const now = new Date();
    const y = String(now.getFullYear());
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const dateDir = join(tmpRoot, y, m, d);
    mkdirSync(join(dateDir, 'run-01'), { recursive: true });
    mkdirSync(join(dateDir, 'run-02'), { recursive: true });

    const resolve = createResolveRunDir(tmpRoot, {
      existsSync, readdirSync, mkdirSync,
    });

    const { runDir, runId } = resolve();

    expect(runDir).toMatch(/run-03$/);
    expect(runId).toMatch(/-03$/);
  });

  // 测试：runId 和 dateStr 格式正确
  // 输入：正常调用
  // 预期：runId = YYYYMMDD-NN，dateStr = YYYY-MM-DD
  it('runId 格式 YYYYMMDD-NN，dateStr 格式 YYYY-MM-DD', () => {
    const resolve = createResolveRunDir(tmpRoot, {
      existsSync, readdirSync, mkdirSync,
    });

    const { runId, dateStr } = resolve();

    // runId: YYYYMMDD-NN
    expect(runId).toMatch(/^\d{8}-\d{2}$/);
    // dateStr: YYYY-MM-DD
    expect(dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // 测试：忽略非 run- 开头的目录
  // 输入：日期目录下有 run-01 和其他非标准目录名
  // 预期：正确生成 run-02（不受非标准目录干扰）
  it('目录下有非 run- 前缀目录 → 不影响编号', () => {
    const now = new Date();
    const y = String(now.getFullYear());
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const dateDir = join(tmpRoot, y, m, d);
    mkdirSync(join(dateDir, 'run-01'), { recursive: true });
    mkdirSync(join(dateDir, 'temp-dir'), { recursive: true });
    mkdirSync(join(dateDir, 'README.md'.replace('.', '_')), { recursive: true });

    const resolve = createResolveRunDir(tmpRoot, {
      existsSync, readdirSync, mkdirSync,
    });

    const { runDir, runId } = resolve();

    expect(runDir).toMatch(/run-02$/);
    expect(runId).toMatch(/-02$/);
  });

  // 测试：忽略无法解析为数字的 run- 目录
  // 输入：日期目录下有 run-01 和 run-abc
  // 预期：正确生成 run-02（run-abc 被过滤掉）
  it('run-abc 非数字后缀 → 被过滤不影响编号', () => {
    const now = new Date();
    const y = String(now.getFullYear());
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const dateDir = join(tmpRoot, y, m, d);
    mkdirSync(join(dateDir, 'run-01'), { recursive: true });
    mkdirSync(join(dateDir, 'run-abc'), { recursive: true });

    const resolve = createResolveRunDir(tmpRoot, {
      existsSync, readdirSync, mkdirSync,
    });

    const { runDir } = resolve();

    expect(runDir).toMatch(/run-02$/);
  });
});

// ═══════════════════════════════════════════════════════════
//  4. appendLedger 测试套件
// ═══════════════════════════════════════════════════════════
//
// appendLedger 内部使用硬编码的 LEDGER_PATH 和 REPO_ROOT。
// 通过 new Function 重建，注入临时 LEDGER_PATH 和 REPO_ROOT。

function createAppendLedger(ledgerPath, repoRoot) {
  const { fullBody } = extractFunctionBody(SOURCE_CODE, 'appendLedger');
  // 替换硬编码常量引用
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
    tmpRoot = join(tmpdir(), `fest-lg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tmpRoot, { recursive: true });
    ledgerPath = join(tmpRoot, 'LEDGER.md');
    repoRoot = tmpRoot; // REPO_ROOT 指向临时目录
  });

  afterEach(() => {
    if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  });

  // 测试：追加一行到空 LEDGER（文件不存在）
  // 输入：不存在的 LEDGER.md 文件
  // 预期：文件被创建，包含追加的行
  it('追加到空 LEDGER（文件不存在） → 文件被创建，包含正确行', () => {
    const append = createAppendLedger(ledgerPath, repoRoot);

    append('2025-01-15', '20250115-01', 3, { p0: 1, p1: 2, p2: 0 }, '2-rounds-clean', join(repoRoot, 'runs/2025/01/15/run-01'));

    expect(existsSync(ledgerPath)).toBe(true);
    const content = readFileSync(ledgerPath, 'utf-8');
    expect(content).toContain('2025-01-15');
    expect(content).toContain('20250115-01');
    expect(content).toContain('fresh-eyes');
    expect(content).toContain('2-rounds-clean');
  });

  // 测试：追加到已有内容的 LEDGER
  // 输入：LEDGER.md 已有一行
  // 预期：新行追加在末尾，旧行保留
  it('追加到已有内容的 LEDGER → 旧行保留，新行追加', () => {
    writeFileSync(ledgerPath, '已有第一行\n', 'utf-8');
    const append = createAppendLedger(ledgerPath, repoRoot);

    append('2025-01-16', '20250116-01', 2, { p0: 0, p1: 0, p2: 3 }, 'max-rounds', join(repoRoot, 'runs/2025/01/16/run-01'));

    const content = readFileSync(ledgerPath, 'utf-8');
    expect(content).toContain('已有第一行');
    expect(content).toContain('20250116-01');
    expect(content).toContain('max-rounds');
  });

  // 测试：列对齐格式正确（日期|run-id|循环|轮数|P0|P1|P2|停止原因|路径）
  // 输入：标准参数
  // 预期：输出行用 | 分隔，包含所有 9 列
  it('列对齐格式正确（9 列用 | 分隔）', () => {
    const append = createAppendLedger(ledgerPath, repoRoot);
    const runDir = join(repoRoot, 'runs/2025/01/15/run-01');

    append('2025-01-15', '20250115-01', 3, { p0: 1, p1: 2, p2: 0 }, '2-rounds-clean', runDir);

    const content = readFileSync(ledgerPath, 'utf-8').trim();
    const lines = content.split('\n');
    const dataLine = lines[lines.length - 1]; // 最后一行是数据行

    // 用 | 分隔应有 9 个字段
    const fields = dataLine.split('|').map(s => s.trim()).filter(Boolean);
    expect(fields.length).toBe(9);

    // 验证各列内容
    expect(fields[0]).toBe('2025-01-15');       // 日期
    expect(fields[1]).toBe('20250115-01');      // run-id
    expect(fields[2]).toBe('fresh-eyes');       // 循环名
    expect(fields[3]).toBe('3');                // 轮数
    expect(fields[4]).toBe('1');                // P0
    expect(fields[5]).toBe('2');                // P1
    expect(fields[6]).toBe('0');                // P2
    expect(fields[7]).toBe('2-rounds-clean');   // 停止原因
    expect(fields[8]).toContain('runs/');       // 路径
  });

  // 测试：路径相对于 REPO_ROOT
  // 输入：runDir = REPO_ROOT/runs/.../run-01
  // 预期：LEDGER 中记录的路径是相对路径 runs/.../run-01（不含 REPO_ROOT 前缀）
  it('路径列记录相对路径（去掉 REPO_ROOT 前缀）', () => {
    const append = createAppendLedger(ledgerPath, repoRoot);
    const runDir = join(repoRoot, 'runs/2025/01/15/run-01');

    append('2025-01-15', '20250115-01', 1, { p0: 0, p1: 0, p2: 0 }, 'dry-run', runDir);

    const content = readFileSync(ledgerPath, 'utf-8');
    // 路径应为 runs/2025/01/15/run-01（不含 tmpRoot 前缀）
    expect(content).toContain('runs/2025/01/15/run-01');
    // 不应包含绝对路径的 tmpRoot
    expect(content).not.toContain(tmpRoot);
  });

  // 测试：多次追加累积写入
  // 输入：连续追加 3 行
  // 预期：文件包含全部 3 行数据，按追加顺序排列
  it('多次追加累积写入 → 全部保留且有序', () => {
    const append = createAppendLedger(ledgerPath, repoRoot);

    for (let i = 1; i <= 3; i++) {
      append(`2025-01-1${i}`, `2025011${i}-01`, i, { p0: i, p1: 0, p2: 0 }, 'test', join(repoRoot, `runs/run-0${i}`));
    }

    const content = readFileSync(ledgerPath, 'utf-8');
    expect(content).toContain('20250111-01');
    expect(content).toContain('20250112-01');
    expect(content).toContain('20250113-01');

    // 验证顺序：第一行在前
    const idx1 = content.indexOf('20250111-01');
    const idx3 = content.indexOf('20250113-01');
    expect(idx1).toBeLessThan(idx3);
  });
});

// ═══════════════════════════════════════════════════════════
//  5. extractUsage 测试套件
// ═══════════════════════════════════════════════════════════
//
// extractUsage 是纯函数，从 DeepAgent invoke 结果中多级 fallback 提取 usage。
// 支持四种路径：result.usage / result.llmResult.usage /
// result.messages[-1].usage_metadata / result.messages[-1].response_metadata.token_usage
// 无法提取时返回 null。

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

  // ─── 路径 1：result.usage ──────────────────────────────

  // 测试：result.usage 含 prompt_tokens + completion_tokens → 提取成功
  // 输入：result = { usage: { prompt_tokens: 100, completion_tokens: 50 } }
  // 预期：返回 { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
  it('result.usage（prompt/completion 格式） → 提取成功，total=150', () => {
    const result = { usage: { prompt_tokens: 100, completion_tokens: 50 } };
    const usage = extractUsage(result);
    expect(usage).not.toBeNull();
    expect(usage.prompt_tokens).toBe(100);
    expect(usage.completion_tokens).toBe(50);
    expect(usage.total_tokens).toBe(150);
  });

  // ─── 路径 2：result.llmResult.usage（input/output 别名） ──

  // 测试：result.llmResult.usage 含 input_tokens + output_tokens → 提取成功
  // 输入：result = { llmResult: { usage: { input_tokens: 200, output_tokens: 100 } } }
  // 预期：返回 { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 }
  it('result.llmResult.usage（input/output 别名） → 提取成功，total=300', () => {
    const result = { llmResult: { usage: { input_tokens: 200, output_tokens: 100 } } };
    const usage = extractUsage(result);
    expect(usage).not.toBeNull();
    expect(usage.prompt_tokens).toBe(200);
    expect(usage.completion_tokens).toBe(100);
    expect(usage.total_tokens).toBe(300);
  });

  // ─── 路径 3：result.messages[-1].usage_metadata ───────

  // 测试：messages 末尾消息含 usage_metadata（LangChain 格式） → 提取成功
  // 输入：result = { messages: [{ content: 'hi' }, { usage_metadata: { input_tokens: 300, output_tokens: 200, total_tokens: 500 } }] }
  // 预期：返回 { prompt_tokens: 300, completion_tokens: 200, total_tokens: 500 }
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

  // ─── 路径 4：result.messages[-1].response_metadata.token_usage ──

  // 测试：messages 末尾消息含 response_metadata.token_usage（OpenAI 格式） → 提取成功
  // 输入：result = { messages: [{ response_metadata: { token_usage: { prompt_tokens: 400, completion_tokens: 300 } } }] }
  // 预期：返回 { prompt_tokens: 400, completion_tokens: 300, total_tokens: 700 }
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

  // ─── 无法提取的场景 ─────────────────────────────────

  // 测试：result 为空对象 → 返回 null
  // 输入：result = {}
  // 预期：返回 null（无任何 usage 字段）
  it('空对象 result → 返回 null', () => {
    const usage = extractUsage({});
    expect(usage).toBeNull();
  });

  // 测试：messages 有内容但末尾消息无 usage 信息 → 返回 null
  // 输入：result = { messages: [{ content: 'hi' }] }
  // 预期：返回 null（message 无 usage_metadata 也无 token_usage）
  it('messages 有内容但无 usage → 返回 null', () => {
    const result = { messages: [{ content: 'hi' }] };
    const usage = extractUsage(result);
    expect(usage).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
//  6. recordUsage 测试套件
// ═══════════════════════════════════════════════════════════
//
// recordUsage 内部依赖：
//   - MODEL_PRICING（模块级常量，闭包引用）
//   - extractUsage（同文件内函数）
//   - join（path 模块）
//   - appendFileSync（fs 模块）
//
// 反射策略：extractFunctionBody 提取 recordUsage 函数体后，函数体内引用了
// MODEL_PRICING 和 extractUsage —— 这两者不在 recordUsage 函数体内定义。
// 我们从源码中提取这两个定义的源码片段，一起注入到 wrapper 中。

/**
 * 从源码中提取 MODEL_PRICING 常量定义的源码文本。
 * 用于注入到 recordUsage 的反射包装中。
 */
function extractModelPricingSource(source) {
  // MODEL_PRICING 定义格式：const MODEL_PRICING = { ... };
  const startIdx = source.indexOf('const MODEL_PRICING');
  if (startIdx === -1) throw new Error('无法找到 MODEL_PRICING 定义');
  // 找到对应的分号结尾（从 = { 开始花括号配平）
  const assignIdx = source.indexOf('=', startIdx);
  const braceStart = source.indexOf('{', assignIdx);
  let depth = 0;
  let end = braceStart;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  // 包含末尾分号
  return source.slice(startIdx, end + 1) + ';';
}

/**
 * 从源码中提取 MODEL_CONFIGS 常量定义的源码文本，并做清理。
 *
 * MODEL_CONFIGS 原文含 join(AGENTS_DIR, ...) 调用——依赖外部常量 AGENTS_DIR。
 * recordUsage 只用 cfg.model 和 cfg.billing，agentSkillPath 的值不影响测试。
 * 所以把 join(AGENTS_DIR, '...') 替换为占位字符串，消除外部依赖。
 */
function extractModelConfigsSource(source) {
  const startIdx = source.indexOf('const MODEL_CONFIGS');
  if (startIdx === -1) throw new Error('无法找到 MODEL_CONFIGS 定义');
  const assignIdx = source.indexOf('=', startIdx);
  const braceStart = source.indexOf('{', assignIdx);
  let depth = 0;
  let end = braceStart;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  let body = source.slice(startIdx, end + 1) + ';';
  // 把 join(AGENTS_DIR, '...') 替换为占位字符串（recordUsage 不依赖 agentSkillPath 的值）
  body = body.replace(/join\(AGENTS_DIR,\s*'[^']*'\)/g, "'<placeholder>'");
  return body;
}

/**
 * 构建 recordUsage 的可测试包装。
 *
 * 注入依赖：join（路径拼接）、appendFileSync（写文件）。
 * MODEL_CONFIGS、MODEL_PRICING 和 extractUsage 通过提取源码定义一并注入。
 */
function createRecordUsage(fsDeps) {
  const modelConfigsSrc = extractModelConfigsSource(SOURCE_CODE);
  const modelPricingSrc = extractModelPricingSource(SOURCE_CODE);
  const { fullBody: extractUsageBody } = extractFunctionBody(SOURCE_CODE, 'extractUsage');
  const { fullBody: recordUsageBody } = extractFunctionBody(SOURCE_CODE, 'recordUsage');

  // 组装：先定义常量，再定义 extractUsage，最后定义 recordUsage
  const combined = modelConfigsSrc + '\n' + modelPricingSrc + '\n' + extractUsageBody + '\n' + recordUsageBody;
  const wrapper = new Function('join', 'appendFileSync', combined + '\nreturn recordUsage;');
  return wrapper(join, fsDeps.appendFileSync);
}

describe('recordUsage', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `fest-usage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tmpRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  });

  // 辅助：读取 usage.jsonl 并解析为对象数组
  function readUsageJsonl(runDir) {
    const usagePath = join(runDir, 'usage.jsonl');
    if (!existsSync(usagePath)) return [];
    return readFileSync(usagePath, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
  }

  // 测试：正常 usage + glm-5.2（订阅制）→ cost_cny 为 null，price_confidence = 'subscription'
  // 输入：result = { usage: { prompt_tokens: 1000, completion_tokens: 500 } }，model = 'glm-5.2'
  // 预期：usage.jsonl 有一行，含 prompt_tokens=1000, completion_tokens=500,
  //       cost_cny === null（订阅制不按 token 扣费）, price_confidence === 'subscription'
  it('正常 usage + glm-5.2（订阅制）→ cost_cny=null, price_confidence=subscription', () => {
    const record = createRecordUsage({ appendFileSync });
    const result = { usage: { prompt_tokens: 1000, completion_tokens: 500 } };

    record(tmpRoot, 'a-check', 1, 'A', 'glm-5.2', result, 1234, 'v1.2.0');

    const records = readUsageJsonl(tmpRoot);
    expect(records.length).toBe(1);

    const rec = records[0];
    expect(rec.prompt_tokens).toBe(1000);
    expect(rec.completion_tokens).toBe(500);
    expect(rec.total_tokens).toBe(1500);
    // glm-5.2 = Coding Plan 订阅制，cost_cny 记 null（不适用按量计价）
    expect(rec.cost_cny).toBeNull();
    expect(rec.price_confidence).toBe('subscription');
    expect(rec.model).toBe('glm-5.2');
    expect(rec.role).toBe('A');
    expect(rec.step).toBe('a-check');
    expect(rec.round).toBe(1);
    expect(rec.target).toBe('v1.2.0');
    expect(rec.latency_ms).toBe(1234);
  });

  // 测试：未知模型 → cost_cny 为 null，price_confidence 标 "no-pricing"
  // 输入：result 有 usage，model = 'unknown-model-xyz'
  // 预期：cost_cny === null, price_confidence === 'no-pricing'
  it('未知模型 → cost_cny 为 null，price_confidence=no-pricing', () => {
    const record = createRecordUsage({ appendFileSync });
    const result = { usage: { prompt_tokens: 200, completion_tokens: 100 } };

    record(tmpRoot, 'b-fix', 2, 'B', 'unknown-model-xyz', result, 567, 'v1.2.0');

    const records = readUsageJsonl(tmpRoot);
    expect(records.length).toBe(1);

    const rec = records[0];
    expect(rec.prompt_tokens).toBe(200);
    expect(rec.completion_tokens).toBe(100);
    expect(rec.cost_cny).toBeNull();
    expect(rec.price_confidence).toBe('no-pricing');
  });

  // 测试：usage 为 null（API 未返回）→ 记录 usage:null + note，不崩溃
  // 输入：result = {}（无 usage 字段），extractUsage 返回 null
  // 预期：usage.jsonl 有一行，usage === null，含 note 字段
  it('API 未返回 usage → 记录 null + note，不崩溃', () => {
    const record = createRecordUsage({ appendFileSync });
    const result = {};  // 无任何 usage 字段

    record(tmpRoot, 'a-verify', 3, 'A', 'glm-5.2', result, 999, 'v1.2.0');

    const records = readUsageJsonl(tmpRoot);
    expect(records.length).toBe(1);

    const rec = records[0];
    expect(rec.usage).toBeNull();
    expect(rec.note).toContain('API 未返回 usage');
    expect(rec.model).toBe('glm-5.2');
    expect(rec.latency_ms).toBe(999);
    // usage 为 null 时不应有 cost_cny 字段（或为 undefined）
    expect(rec.cost_cny).toBeUndefined();
  });

  // 测试：连续 recordUsage 两次 → usage.jsonl 有两行，都能 JSON.parse
  // 输入：两次调用，不同 step/round
  // 预期：文件有 2 行，每行可独立 parse，内容正确
  it('连续两次 recordUsage → 两行可各自 parse', () => {
    const record = createRecordUsage({ appendFileSync });

    const result1 = { usage: { prompt_tokens: 100, completion_tokens: 50 } };
    const result2 = { llmResult: { usage: { input_tokens: 200, output_tokens: 100 } } };

    record(tmpRoot, 'a-check', 1, 'A', 'glm-5.2', result1, 100, 'v1.0.0');
    record(tmpRoot, 'b-fix', 1, 'B', 'deepseek-v4-pro', result2, 200, 'v1.0.0');

    const records = readUsageJsonl(tmpRoot);
    expect(records.length).toBe(2);

    // 第一行
    expect(records[0].step).toBe('a-check');
    expect(records[0].role).toBe('A');
    expect(records[0].prompt_tokens).toBe(100);

    // 第二行
    expect(records[1].step).toBe('b-fix');
    expect(records[1].role).toBe('B');
    expect(records[1].prompt_tokens).toBe(200);
  });

  // 测试：DeepSeek V4 Pro 定价计算正确（缓存未命中：input=3, output=6 per 1M tokens）
  // 输入：prompt_tokens=1000000(1M), completion_tokens=500000(0.5M), model='deepseek-v4-pro'
  // 预期：cost = 1M*3 + 0.5M*6 = 3 + 3 = 6.0 CNY（估算值，缓存命中时实际更低）
  it('DeepSeek V4 Pro 定价 → 正确计算 6.0 CNY', () => {
    const record = createRecordUsage({ appendFileSync });
    const result = { usage: { prompt_tokens: 1_000_000, completion_tokens: 500_000 } };

    record(tmpRoot, 'b-fix', 1, 'B', 'deepseek-v4-pro', result, 5000, 'v2.0.0');

    const records = readUsageJsonl(tmpRoot);
    expect(records.length).toBe(1);
    // 缓存未命中：1M * 3 + 0.5M * 6 = 6.0（成本上界估算）
    expect(records[0].cost_cny).toBeCloseTo(6.0, 5);
    expect(records[0].price_confidence).toBe('estimated');
  });
});
