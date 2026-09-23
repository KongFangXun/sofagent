// ============================================================
// evaluate.test.ts · MCP evaluate tool 测试（v1.3.2 交付 9）
// ============================================================
//
// 覆盖：
// - 触发模式：有题库布局 → 隔离评测（fake agent）→ 写 HMAC 链日志
// - 查询模式：query:true → 读评测日志
// - benchmark 不存在 → isError
//
// 全部临时目录隔离（SOFAGENT_DATA + overrideHome）；fake agent 不调 LLM。
// ============================================================

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { evaluate, setEvaluateTestAgent } from '../tools/evaluate';
import { evaluateOutput } from '../tools/evaluate-output';
// 直接用 orchestrator 建题库布局（测试 fixture——不是文档）
import {
  createBenchmark,
  addCase,
  freezeBenchmark,
  writeBenchmarkLayout,
  benchmarksRoot,
} from '@sofagent/orchestrator/benchmark';
import { EVAL_DIR, loadEnvConfig } from '@sofagent/core';

// ── evaluate_output 数据面隔离 ──
// evaluate-output.ts 会把 latest.json / history.jsonl 写到 EVAL_DIR（core 在**模块加载期**
// 基于 SOFAGENT_HOME 解析到真实 ~/.sofagent/data/eval），且 mkdirSync 在 try/catch 之外。
// 不重定向就会污染真实用户数据目录（仓内「hook test leak」纪律）。故部分 mock core，
// 只把三个 EVAL_* 常量指向 mkdtemp 目录，其余 export 经 importOriginal 保真。
vi.mock('@sofagent/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sofagent/core')>();
  const osMod = await import('os');
  const fsMod = await import('fs');
  const pathMod = await import('path');
  const isoDir = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'sofagent-eval-out-'));
  const evalDir = pathMod.join(isoDir, 'eval');
  return {
    ...actual,
    EVAL_DIR: evalDir,
    EVAL_LATEST: pathMod.join(evalDir, 'latest.json'),
    EVAL_HISTORY: pathMod.join(evalDir, 'history.jsonl'),
  };
});

describe('evaluate · Benchmark 评测（v1.3.1 交付 9）', () => {
  let tmpDir: string;
  let originalData: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-eval-'));
    originalData = process.env.SOFAGENT_DATA;
    vi.stubEnv('SOFAGENT_DATA', tmpDir);
    vi.clearAllMocks();
    setEvaluateTestAgent(null);
  });

  afterEach(() => {
    setEvaluateTestAgent(null);
    vi.stubEnv('SOFAGENT_DATA', originalData ?? '');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('触发模式：建题库布局 → 评测全部 cases → 写 HMAC 链日志', async () => {
    // 建题库布局（fixture）
    const root = benchmarksRoot(loadEnvConfig().dataDir);
    const def = createBenchmark('bench-mcp', { title: 'MCP 评测', description: '单测' });
    addCase(def, { name: 'a', statement: '任务 A', rubric: '标准 A' });
    addCase(def, { name: 'b', statement: '任务 B', rubric: '标准 B' });
    freezeBenchmark(def);
    writeBenchmarkLayout(def, root);

    // fake agent：返回产出（read-only 工具面放行读，拦截写）
    setEvaluateTestAgent(async (ctx) => {
      expect(fs.existsSync(path.join(ctx.workspace, 'statement.md'))).toBe(true);
      return 'agent 产出';
    });

    const result = await evaluate({ benchmark_id: 'bench-mcp' });

    expect(result.data.isError).toBe(false);
    expect(result.data.mode).toBe('run');
    expect(result.data.evaluations).toHaveLength(2);
    expect(result.data.evaluations?.[0]?.score).toBe(100);
    expect(result.text).toContain('[sofagent]');

    // HMAC 链日志已写
    const logPath = path.join(root, 'bench-mcp', 'evaluation-log.jsonl');
    expect(fs.existsSync(logPath)).toBe(true);
    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('查询模式：query:true 读评测日志', async () => {
    const root = benchmarksRoot(loadEnvConfig().dataDir);
    const def = createBenchmark('bench-q', { title: '查询', description: '' });
    addCase(def, { name: 'a', statement: '任务', rubric: '标准' });
    writeBenchmarkLayout(def, root);

    setEvaluateTestAgent(async () => '产出');
    await evaluate({ benchmark_id: 'bench-q' });

    const q = await evaluate({ benchmark_id: 'bench-q', query: true });
    expect(q.data.isError).toBe(false);
    expect(q.data.mode).toBe('query');
    expect(q.data.records?.length).toBe(1);
    expect(q.data.records?.[0]?.caseId).toContain('CASE-001');
  });

  it('benchmark 不存在 → isError（不崩溃）', async () => {
    const result = await evaluate({ benchmark_id: 'bench-nonexistent' });
    expect(result.data.isError).toBe(true);
    expect(result.text).toContain('不存在');
  });

  it('缺 benchmark_id → isError', async () => {
    const result = await evaluate({ benchmark_id: '' });
    expect(result.data.isError).toBe(true);
  });
});

// ============================================================
// evaluate_output · 真 runner 回归（静默假绿守卫）
// ============================================================
// 背景：runEval(config, runFunction?) 的 runner 是**第二个位置参数**。曾漏传 ⇒ 落到
// defaultRunFunction（mock，只读 input['diff']）⇒ 对结构化 golden set（diffFiles）
// 取不到 diff ⇒ 一律 PASS ⇒ 假绿。本块锁定「必须走真实 audit runner」。
describe('evaluate_output · 走真实 audit runner（不落 mock）', () => {
  afterAll(() => {
    try { fs.rmSync(path.dirname(EVAL_DIR), { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it('含违规输入的 golden set → 报 FAIL 而非 PASS', async () => {
    // golden set 落在隔离目录（EVAL_DIR 的父目录）——不进仓库、不污染真实数据
    const goldenSetPath = path.join(path.dirname(EVAL_DIR), 'golden-set.yaml');
    // 故意把 expected 写成 mock 的形态（PASS）：真实 runner 对 .env 硬编码密钥判 FAIL
    // （参 engine/eval/data/golden-set.yaml 的 A1-fail-01）⇒ 该用例必然报失败（failed=1）。
    // 若仍旧静默假绿（mock 取不到 diff ⇒ PASS），本用例会「通过」⇒ 断言必红。
    // {{SK_PREFIX}} 由 eval-runner 加载期替换为真实前缀，避免字面密钥进仓源码（fixture 铁律）。
    fs.writeFileSync(goldenSetPath, [
      '- id: probe-violation-01',
      '  description: 违规输入（.env 硬编码密钥）——真 runner 必须判 FAIL',
      '  input:',
      '    diffFiles:',
      '    - path: .env',
      '      status: modified',
      '      lines:',
      "      - '--- a/.env'",
      "      - '+++ b/.env'",
      "      - '+API_KEY={{SK_PREFIX}}somekey1234567890abcdef'",
      '    task: 修改环境配置文件 .env',
      '    logEntries: []',
      '  expected:',
      '    result: PASS',
      '    rules_triggered: []',
      '',
    ].join('\n'), 'utf-8');

    const r = await evaluateOutput({ golden_set_path: goldenSetPath });

    expect(r.data.totalTests).toBe(1);
    expect(r.data.failed).toBe(1);
    expect(r.data.failures[0]?.testId).toBe('probe-violation-01');
    // 失败来自「判定不符」而非 mock 形态自证抛错 ⇒ 证明走了真实 runner
    expect(r.data.failures[0]?.error).toBeUndefined();
    expect(r.text).toContain('❌');
  });
});
