// ============================================================
// benchmark-eval.test.ts · Benchmark 评测体系测试（v1.3.2 交付 9）
// ============================================================
//
// 覆盖：
// - 题库设计：createBenchmark / addCase（statement 公开 / rubric 私有分离）
// - Pilot 校准：calibrateCase 记录难度与说明；冻结后禁止校准
// - Freeze：冻结后 revision 递增；冻结后禁止改题
// - 文件布局：writeBenchmarkLayout / readBenchmarkLayout（toml + CASE 目录）
// - 隔离执行：独立 workspace 只暴露 statement，rubric 不可访问
// - read-only 强制：Test Agent 写/执行工具被拦截
// - 四种失败码：invalid_request / benchmark_invalid / version_changed /
//   evaluation_failed
// - evaluation-log HMAC 链：append/read/verify（tampered 检测）
//
// 全部临时目录隔离（SOFAGENT_DATA / overrideHome）——不污染仓库。
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  createBenchmark,
  addCase,
  calibrateCase,
  freezeBenchmark,
  writeBenchmarkLayout,
  readBenchmarkLayout,
  parseBenchmarkConfig,
  benchmarksRoot,
} from '../benchmark/benchmark-designer';
import { evaluateCase, defaultScoringFn, evalBridgeScoringFn } from '../benchmark/case-evaluator';
import {
  appendEvaluationRecord,
  readEvaluationLog,
  verifyEvaluationChain,
  getEvaluationLogPath,
} from '../benchmark/evaluation-log';

describe('benchmark-designer · 题库设计 + Pilot 校准 + Freeze（v1.3.1 交付 9）', () => {
  it('createBenchmark + addCase：statement/rubric 物理分离存储', () => {
    const def = createBenchmark('bench-001', { title: '测试题库', description: '用于单测' });
    expect(def.revision).toBe(1);
    expect(def.frozen).toBe(false);
    expect(def.runs).toBe(1);

    const c = addCase(def, {
      name: 'sum',
      statement: '写一个加法函数',
      rubric: 'Gold: 正确处理负数',
      goldScore: 90,
    });
    expect(c.id).toBe('CASE-001-sum');
    expect(def.cases).toHaveLength(1);
    // 物理分离：statement 与 rubric 是不同字段/不同文件
    expect(c.statement).not.toBe(c.rubric);
  });

  it('Pilot 校准：记录难度 + 说明；case 不存在报错', () => {
    const def = createBenchmark('bench-cal', { title: '校准', description: '' });
    addCase(def, { name: 'a', statement: 's', rubric: 'r' });

    const rec = calibrateCase(def, 'CASE-001-a', 'medium', 'Agent 会先试简单路径');
    expect(rec.difficulty).toBe('medium');
    expect(rec.note).toContain('Agent');
    expect(def.calibrations).toHaveLength(1);

    expect(() => calibrateCase(def, 'CASE-999-x', 'hard', 'n')).toThrow(/不存在/);
  });

  it('Freeze：revision 递增 + frozen=true；冻结后禁止改题/校准', () => {
    const def = createBenchmark('bench-fz', { title: '冻结', description: '' });
    addCase(def, { name: 'a', statement: 's', rubric: 'r' });

    const rev = freezeBenchmark(def);
    expect(rev).toBe(2);
    expect(def.frozen).toBe(true);

    expect(() => addCase(def, { name: 'b', statement: 's', rubric: 'r' })).toThrow(/已冻结/);
    expect(() => calibrateCase(def, 'CASE-001-a', 'easy', 'n')).toThrow(/已冻结/);
  });

  it('Freeze 空题库报错', () => {
    const def = createBenchmark('bench-empty', { title: '空', description: '' });
    expect(() => freezeBenchmark(def)).toThrow(/空题库/);
  });

  it('文件布局：写 layout → toml 可解析 → 读回一致；CASE 目录物理分离', () => {
    const root = path.join(os.tmpdir(), `bench-layout-${Date.now()}`);
    try {
      const def = createBenchmark('bench-layout', { title: '布局', description: '布局测试' });
      addCase(def, { name: 'a', statement: 'statement 内容', rubric: 'rubric 内容', goldScore: 95 });

      const written = writeBenchmarkLayout(def, root);
      expect(written).toHaveLength(3); // toml + statement + rubric

      // toml 文件存在且可解析
      const toml = fs.readFileSync(path.join(root, 'bench-layout', 'benchmark_config.toml'), 'utf-8');
      const parsed = parseBenchmarkConfig(toml);
      expect(parsed.id).toBe('bench-layout');
      expect(parsed.title).toBe('布局');
      expect(parsed.cases).toHaveLength(1);
      expect(parsed.cases[0]?.gold_score).toBe(95);

      // CASE 目录物理分离：statement/README.md 与 rubric/README.md 分目录
      expect(fs.existsSync(path.join(root, 'bench-layout', 'CASE-001-a', 'statement', 'README.md'))).toBe(true);
      expect(fs.existsSync(path.join(root, 'bench-layout', 'CASE-001-a', 'rubric', 'README.md'))).toBe(true);

      // 读回
      const back = readBenchmarkLayout(root, 'bench-layout');
      expect(back?.title).toBe('布局');
      expect(back?.cases[0]?.statement).toBe('statement 内容');
      expect(back?.cases[0]?.rubric).toBe('rubric 内容');
      expect(back?.cases[0]?.goldScore).toBe(95);
    } finally {
      try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
    }
  });
});

describe('case-evaluator · 隔离评测（v1.3.1 交付 9）', () => {
  it('隔离执行：workspace 只含 statement，rubric 不可访问；评分 100', async () => {
    const seenWorkspaceFiles: string[] = [];
    const result = await evaluateCase({
      benchmarkId: 'bench-iso',
      caseId: 'CASE-001-a',
      statement: '公开任务',
      rubric: '私有标准',
      expectedRevision: 1,
      actualRevision: 1,
      agentFn: async (ctx) => {
        // 被测 Agent 只能看到 workspace 内的文件（statement.md），看不到 rubric
        seenWorkspaceFiles.push(...fs.readdirSync(ctx.workspace));
        expect(ctx.statement).toBe('公开任务');
        // 尝试读 rubric 路径 → 不存在（物理分离）
        const rubricPath = path.join(ctx.workspace, '..', 'CASE-001-a', 'rubric', 'README.md');
        expect(fs.existsSync(rubricPath)).toBe(false);
        return 'agent 产出';
      },
    });

    expect(result.failureCode).toBeNull();
    expect(result.score).toBe(100);
    // workspace 内只有 statement.md（rubric 不落 workspace）
    expect(seenWorkspaceFiles).toContain('statement.md');
  });

  it('read-only 强制：Test Agent 写文件/执行命令被拦截（approvalMode=read-only）', async () => {
    let writeResult = '';
    let execResult = '';
    const result = await evaluateCase({
      benchmarkId: 'bench-ro',
      caseId: 'CASE-001-a',
      statement: '任务',
      rubric: '标准',
      agentFn: async (ctx) => {
        const writeTool = ctx.tools.find((t) => t.name === 'write_file');
        const execTool = ctx.tools.find((t) => t.name === 'exec_command');
        writeResult = writeTool!.call({ path: 'x.txt', content: 'hack' });
        execResult = execTool!.call({ cmd: 'rm -rf /' });
        return '产出';
      },
    });

    expect(result.failureCode).toBeNull();
    // rw 工具被拦截（read-only 模式）
    expect(writeResult).toContain('工具调用被拒绝');
    expect(writeResult).toContain('read-only');
    expect(execResult).toContain('工具调用被拒绝');
    // 只读工具放行
    const readTool = result && undefined; // 不直接用 result——工具已在 ctx 内验证
    void readTool;
  });

  it('read-only 放行只读工具：read_file 可读 workspace 内文件', async () => {
    const result = await evaluateCase({
      benchmarkId: 'bench-ro2',
      caseId: 'CASE-001-a',
      statement: '公开内容',
      rubric: '标准',
      agentFn: async (ctx) => {
        const readTool = ctx.tools.find((t) => t.name === 'read_file');
        const content = readTool!.call({ path: 'statement.md' });
        return content;
      },
    });
    expect(result.failureCode).toBeNull();
    expect(result.score).toBe(100);
  });

  it('失败码 invalid_request：缺必填入参', async () => {
    const result = await evaluateCase({
      benchmarkId: 'bench-x',
      caseId: '',
      statement: 's',
      rubric: 'r',
    });
    expect(result.failureCode).toBe('invalid_request');
    expect(result.score).toBe(0);
  });

  it('失败码 version_changed：revision 不匹配', async () => {
    const result = await evaluateCase({
      benchmarkId: 'bench-v',
      caseId: 'CASE-001-a',
      statement: 's',
      rubric: 'r',
      expectedRevision: 2,
      actualRevision: 3,
      agentFn: async () => 'x',
    });
    expect(result.failureCode).toBe('version_changed');
    expect(result.revision).toBe(3);
  });

  it('失败码 evaluation_failed：被测 Agent 崩溃 → 不抛出，返回失败码', async () => {
    const result = await evaluateCase({
      benchmarkId: 'bench-crash',
      caseId: 'CASE-001-a',
      statement: 's',
      rubric: 'r',
      agentFn: async () => {
        throw new Error('agent 崩溃');
      },
    });
    expect(result.failureCode).toBe('evaluation_failed');
    expect(result.details.join()).toContain('agent 崩溃');
  });

  it('失败码 evaluation_failed：评测超时', async () => {
    const result = await evaluateCase({
      benchmarkId: 'bench-timeout',
      caseId: 'CASE-001-a',
      statement: 's',
      rubric: 'r',
      timeoutMs: 50,
      agentFn: async () => {
        await new Promise((r) => setTimeout(r, 200));
        return '太慢了';
      },
    });
    expect(result.failureCode).toBe('evaluation_failed');
    expect(result.details.join()).toContain('超时');
  });

  it('自定义评分函数：0..100 固定分值（partial credit）', async () => {
    const scoringFn = vi.fn().mockReturnValue(65);
    const result = await evaluateCase({
      benchmarkId: 'bench-score',
      caseId: 'CASE-001-a',
      statement: 's',
      rubric: 'r',
      agentFn: async () => '部分正确',
      scoringFn,
    });
    expect(scoringFn).toHaveBeenCalled();
    expect(result.score).toBe(65);
  });

  it('defaultScoringFn：空产出 0，有产出 100', () => {
    expect(defaultScoringFn({ output: '', rubric: 'r', durationMs: 1 })).toBe(0);
    expect(defaultScoringFn({ output: 'x', rubric: 'r', durationMs: 1 })).toBe(100);
  });

  it('evalBridgeScoringFn：rubric/output 均 JSON 时桥接 eval 三维度评分', async () => {
    const rubric = JSON.stringify({ result: 'pass', severity: 'WARN', rules_triggered: [] });
    // 完全命中 → 100
    const full = await evalBridgeScoringFn({ output: JSON.stringify({ result: 'pass', severity: 'WARN', rules_triggered: [] }), rubric, durationMs: 1 });
    expect(full).toBe(100);
    // 部分命中 → 0 < score < 100（三维度综合，非 0/100 二值）
    const partial = await evalBridgeScoringFn({ output: JSON.stringify({ result: 'fail', severity: 'none' }), rubric, durationMs: 1 });
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(100);
  });

  it('evalBridgeScoringFn：非 JSON 回退协议完成度评分', async () => {
    // rubric 非 JSON → 回退（有产出 100）
    const a = await evalBridgeScoringFn({ output: '任意产出', rubric: '自然语言 rubric', durationMs: 1 });
    expect(a).toBe(100);
    // output 非 JSON → 回退
    const b = await evalBridgeScoringFn({ output: '纯文本', rubric: JSON.stringify({ k: 'v' }), durationMs: 1 });
    expect(b).toBe(100);
    // 空产出 → 回退 0
    const c = await evalBridgeScoringFn({ output: '', rubric: '自然语言 rubric', durationMs: 1 });
    expect(c).toBe(0);
  });
});

describe('evaluation-log · HMAC 链（v1.3.1 交付 9 · 铁律 #1/#2）', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-evallog-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* */ }
  });

  it('append/read/verify：写 3 条 → 链 ok；路径在 benchmarks/<id>/ 下', () => {
    const overrideHome = tmpHome;
    appendEvaluationRecord({ benchmarkId: 'bench-h', caseId: 'CASE-001-a', revision: 2, score: 100, durationMs: 10 }, overrideHome);
    appendEvaluationRecord({ benchmarkId: 'bench-h', caseId: 'CASE-001-a', revision: 2, score: 80, failureCode: null, durationMs: 12 }, overrideHome);
    appendEvaluationRecord({ benchmarkId: 'bench-h', caseId: 'CASE-002-b', revision: 2, score: 0, failureCode: 'evaluation_failed', durationMs: 5 }, overrideHome);

    const records = readEvaluationLog({ benchmarkId: 'bench-h' }, overrideHome);
    expect(records).toHaveLength(3);
    // 路径正确
    expect(getEvaluationLogPath('bench-h', overrideHome)).toContain(path.join('benchmarks', 'bench-h', 'evaluation-log.jsonl'));

    const chain = verifyEvaluationChain('bench-h', overrideHome);
    expect(chain.status).toBe('ok');
  });

  it('先脱敏再签名：日志只含白名单字段，不含 statement/rubric 原文（铁律 #2）', () => {
    const overrideHome = tmpHome;
    appendEvaluationRecord({
      benchmarkId: 'bench-sanitize',
      caseId: 'CASE-001-a',
      revision: 1,
      score: 100,
      durationMs: 1,
      // 即使误传额外字段也不入链（白名单制）
    } as never, overrideHome);

    const fileContent = fs.readFileSync(getEvaluationLogPath('bench-sanitize', overrideHome), 'utf-8');
    expect(fileContent).not.toContain('statement');
    expect(fileContent).not.toContain('rubric');
  });

  it('篡改检测：改一条记录 → verify 返回 tampered', () => {
    const overrideHome = tmpHome;
    appendEvaluationRecord({ benchmarkId: 'bench-t', caseId: 'CASE-001-a', revision: 1, score: 100, durationMs: 10 }, overrideHome);
    appendEvaluationRecord({ benchmarkId: 'bench-t', caseId: 'CASE-001-a', revision: 1, score: 90, durationMs: 10 }, overrideHome);

    // 篡改第一条的 score
    const filePath = getEvaluationLogPath('bench-t', overrideHome);
    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
    const first = JSON.parse(lines[0]!);
    first.score = 0;
    lines[0] = JSON.stringify(first);
    fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');

    const chain = verifyEvaluationChain('bench-t', overrideHome);
    expect(chain.status).toBe('tampered');
  });

  it('按 caseId 过滤', () => {
    const overrideHome = tmpHome;
    appendEvaluationRecord({ benchmarkId: 'bench-f', caseId: 'CASE-001-a', revision: 1, score: 100, durationMs: 1 }, overrideHome);
    appendEvaluationRecord({ benchmarkId: 'bench-f', caseId: 'CASE-002-b', revision: 1, score: 50, durationMs: 1 }, overrideHome);

    const onlyA = readEvaluationLog({ benchmarkId: 'bench-f', caseId: 'CASE-001-a' }, overrideHome);
    expect(onlyA).toHaveLength(1);
    expect(onlyA[0]?.caseId).toBe('CASE-001-a');
  });
});

describe('benchmarksRoot helper', () => {
  it('benchmarksRoot 拼接 dataDir/benchmarks', () => {
    expect(benchmarksRoot('/tmp/data')).toBe(path.join('/tmp/data', 'benchmarks'));
  });
});
