// driver-base.test.mjs · FORGE driver 公共编排层测试
// v1.2.7 新建 · 功能 ⑤

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createForgeDriverBase } from './driver-base.mjs';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

describe('createForgeDriverBase', () => {
  const base = createForgeDriverBase({
    driverName: 'test-driver',
    loopDir: '/tmp/loop',
    repoRoot: process.cwd(),
    modelConfigs: {
      A: { model: 'test-model-a', baseURL: 'http://localhost:1', maxTokens: 1000 },
      V: { model: 'test-model-v', baseURL: 'http://localhost:2', maxTokens: 2000 },
    },
    modelPricing: {
      'test-model-a': { input: 1, output: 2, billing: 'usage' },
    },
  });

  describe('parseDriverArgs', () => {
    it('解析 --target 参数', () => {
      const args = base.parseDriverArgs(['--target', 'v1.2.7']);
      expect(args.target).toBe('v1.2.7');
    });

    it('解析 --dry-run flag', () => {
      const args = base.parseDriverArgs(['--dry-run']);
      expect(args.dryRun).toBe(true);
    });

    it('解析 --worker flag', () => {
      const args = base.parseDriverArgs(['--worker', '--step', 'a-check']);
      expect(args.worker).toBe(true);
      expect(args.step).toBe('a-check');
    });

    it('解析 --max-rounds 参数', () => {
      const args = base.parseDriverArgs(['--max-rounds', '5']);
      expect(args.maxRounds).toBe(5);
    });

    it('未识别参数存入 extra', () => {
      const args = base.parseDriverArgs(['--custom-flag', 'value']);
      expect(args.extra['custom-flag']).toBe('value');
    });
  });

  describe('resolvePaths', () => {
    it('返回路径常量', () => {
      const paths = base.resolvePaths();
      expect(paths.repoRoot).toBe(process.cwd());
      expect(paths.loopDir).toBe('/tmp/loop');
      expect(paths.promptsDir).toBe(join('/tmp/loop', 'prompts'));
    });
  });

  describe('createModelFromConfig', () => {
    it('角色不存在返回 null', () => {
      const model = base.createModelFromConfig('X');
      expect(model).toBeNull();
    });

    it('无 API key 返回 null', () => {
      const savedKey = process.env.SOFAGENT_LLM_A_API_KEY;
      delete process.env.SOFAGENT_LLM_A_API_KEY;
      delete process.env.SOFAGENT_LLM_API_KEY;
      delete process.env.OPENAI_API_KEY;
      const model = base.createModelFromConfig('A');
      expect(model).toBeNull();
      if (savedKey) process.env.SOFAGENT_LLM_A_API_KEY = savedKey;
    });
  });

  describe('createCircuitBreaker', () => {
    it('使用默认阈值', () => {
      const cb = base.createCircuitBreaker();
      expect(cb.softLimit).toBe(50);
      expect(cb.hardLimit).toBe(60);
    });

    it('shouldSoftBreak 正确判定', () => {
      const cb = base.createCircuitBreaker({ softLimit: 10 });
      expect(cb.shouldSoftBreak(5)).toBe(false);
      expect(cb.shouldSoftBreak(10)).toBe(true);
    });

    it('shouldHardBreak 正确判定', () => {
      const cb = base.createCircuitBreaker({ hardLimit: 20 });
      expect(cb.shouldHardBreak(15)).toBe(false);
      expect(cb.shouldHardBreak(20)).toBe(true);
    });

    it('buildSoftBreakMessage 返回 HumanMessage', () => {
      const cb = base.createCircuitBreaker();
      const msg = cb.buildSoftBreakMessage();
      expect(msg.type).toBe('human');
      expect(msg.content).toContain('写报告');
    });
  });

  describe('truncateToolOutput', () => {
    it('短文本不截断', () => {
      const text = 'line1\nline2\nline3';
      const result = base.truncateToolOutput(text);
      expect(result).toBe(text);
    });

    it('长文本截断', () => {
      const lines = Array.from({ length: 300 }, (_, i) => `line${i}`);
      const text = lines.join('\n');
      const result = base.truncateToolOutput(text, 100);
      expect(result).toContain('truncated');
      // 100 行预算 = head 50 + tail 50 + 截断消息行（消息含前后 \n 展开为 3 行）= ≤103
      expect(result.split('\n').length).toBeLessThanOrEqual(103);
    });

    it('空文本返回空字符串', () => {
      expect(base.truncateToolOutput('')).toBe('');
      expect(base.truncateToolOutput(null)).toBe('');
    });
  });

  describe('resolveVisibleFiles', () => {
    it('合并 inputs 和 outputs', () => {
      const files = base.resolveVisibleFiles('test-step', {
        inputs: ['a.md', 'b.md'],
        outputs: ['result.md'],
      });
      expect(files).toHaveLength(3);
      expect(files).toContain('a.md');
      expect(files).toContain('b.md');
      expect(files).toContain('result.md');
    });

    it('空配置返回空数组', () => {
      const files = base.resolveVisibleFiles('test-step', {});
      expect(files).toEqual([]);
    });
  });

  describe('extractAgentText', () => {
    it('string 直接返回', () => {
      expect(base.extractAgentText('hello')).toBe('hello');
    });

    it('从 content 字段提取', () => {
      expect(base.extractAgentText({ content: 'text' })).toBe('text');
    });

    it('从 messages 数组提取最后一条 assistant', () => {
      const result = {
        messages: [
          { role: 'user', content: 'q' },
          { role: 'assistant', content: 'a1' },
          { role: 'assistant', content: 'a2' },
        ],
      };
      expect(base.extractAgentText(result)).toBe('a2');
    });
  });

  describe('appendLedger', () => {
    let tmpDir;
    beforeAll(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'driver-base-'));
    });
    afterAll(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('追加行到 LEDGER.md', () => {
      // 创建临时 base 指向 tmpDir
      const tmpBase = createForgeDriverBase({
        driverName: 'test',
        loopDir: tmpDir,
        repoRoot: tmpDir,
      });
      tmpBase.appendLedger('2026-01-01', 'run-01', { rounds: 3, p0: 0, p1: 1, p2: 2 }, 'clean', join(tmpDir, 'run-01'));
      const ledger = readFileSync(join(tmpDir, 'FORGE', 'LEDGER.md'), 'utf-8');
      expect(ledger).toContain('run-01');
      expect(ledger).toContain('test');
      expect(ledger).toContain('clean');
    });
  });

  describe('updateLatestPointer', () => {
    let tmpDir;
    beforeAll(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'driver-base-ptr-'));
    });
    afterAll(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('写入 latest.json', () => {
      const tmpBase = createForgeDriverBase({
        driverName: 'test',
        loopDir: tmpDir,
        repoRoot: tmpDir,
      });
      const runDir = join(tmpDir, 'runs', '2026-01-01', 'run-01');
      tmpBase.updateLatestPointer(runDir, { stopReason: 'clean', totalRounds: 3, counts: { p0: 0 } });
      const pointerPath = join(tmpDir, 'runs', '2026-01-01', 'latest.json');
      expect(existsSync(pointerPath)).toBe(true);
      const pointer = JSON.parse(readFileSync(pointerPath, 'utf-8'));
      expect(pointer.driver).toBe('test');
      expect(pointer.stopReason).toBe('clean');
    });
  });

  // ─── v1.2.8 功能⑦：断点续跑（saveResumePoint / loadResumePoint）───
  describe('resume point（断点续跑）', () => {
    let tmpDir;
    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'driver-base-resume-'));
    });
    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    // 最小参数集——resume 函数不依赖模型配置
    const resumeBase = createForgeDriverBase({
      driverName: 'resume-test',
      loopDir: '/tmp/loop',
      repoRoot: process.cwd(),
    });

    it('saveResumePoint 写入 resume-point.json（round/completedWorkers/counts/timestamp）', () => {
      // v1.2.9 功能②：worker 级断点——state 从 completed: boolean 升级为 completedWorkers: string[]
      const state = {
        round: 3,
        completedWorkers: ['a-check-p1', 'a-check-p2', 'b-check-p1'],
        workers: {
          'a-check-p1': { status: 'done', output: 'check-a-p1.md' },
          'a-check-p2': { status: 'done', output: 'check-a-p2.md' },
          'b-check-p1': { status: 'done', output: 'check-b-p1.md' },
        },
        counts: { p0: 0, p1: 2, p2: 5 },
        cleanStreak: 1,
        consecutiveDegraded: 0,
        severityHistory: [4, 2],
        target: 'v1.2.9',
        maxRounds: 10,
      };
      resumeBase.saveResumePoint(tmpDir, state);

      const resumePath = join(tmpDir, 'resume-point.json');
      expect(existsSync(resumePath)).toBe(true);

      const saved = JSON.parse(readFileSync(resumePath, 'utf-8'));
      expect(saved.round).toBe(3);
      // v1.2.9 功能②：completedWorkers 是数组
      expect(saved.completedWorkers).toEqual(['a-check-p1', 'a-check-p2', 'b-check-p1']);
      expect(saved.workers).toBeDefined();
      expect(saved.workers['a-check-p1']).toEqual({ status: 'done', output: 'check-a-p1.md' });
      expect(saved.counts).toEqual({ p0: 0, p1: 2, p2: 5 });
      expect(saved.cleanStreak).toBe(1);
      expect(saved.severityHistory).toEqual([4, 2]);
      expect(saved.target).toBe('v1.2.9');
      expect(saved.maxRounds).toBe(10);
      // timestamp 由 saveResumePoint 自动注入（ISO 格式）
      expect(typeof saved.timestamp).toBe('string');
      expect(Number.isNaN(Date.parse(saved.timestamp))).toBe(false);
    });

    it('saveResumePoint 原子写：不留 .tmp 残留', () => {
      resumeBase.saveResumePoint(tmpDir, { round: 1, completedWorkers: [] });
      expect(existsSync(join(tmpDir, 'resume-point.json.tmp'))).toBe(false);
      expect(existsSync(join(tmpDir, 'resume-point.json'))).toBe(true);
    });

    it('loadResumePoint 读取有效断点（v1.2.9 worker 级格式）', () => {
      const state = {
        round: 2,
        completedWorkers: ['a-check-p1', 'b-check-p3'],
        counts: { p0: 1, p1: 1, p2: 0 },
      };
      resumeBase.saveResumePoint(tmpDir, state);

      const loaded = resumeBase.loadResumePoint(tmpDir);
      expect(loaded).not.toBeNull();
      expect(loaded.round).toBe(2);
      expect(loaded.completedWorkers).toEqual(['a-check-p1', 'b-check-p3']);
      expect(loaded.counts).toEqual({ p0: 1, p1: 1, p2: 0 });
    });

    it('loadResumePoint 文件不存在返回 null', () => {
      expect(resumeBase.loadResumePoint(tmpDir)).toBeNull();
    });

    it('loadResumePoint 文件损坏返回 null 不 throw', () => {
      writeFileSync(join(tmpDir, 'resume-point.json'), '{ "round": 3, "completedWorkers": ["a-check-p1"', 'utf-8');
      // 不 throw，返回 null
      expect(resumeBase.loadResumePoint(tmpDir)).toBeNull();
    });

    it('loadResumePoint 字段缺失（只有 round 没有 completedWorkers/completed）返回 null', () => {
      writeFileSync(join(tmpDir, 'resume-point.json'), JSON.stringify({ round: 3 }) + '\n', 'utf-8');
      expect(resumeBase.loadResumePoint(tmpDir)).toBeNull();
    });

    it('loadResumePoint 字段类型错误（round 非 number）返回 null', () => {
      writeFileSync(
        join(tmpDir, 'resume-point.json'),
        JSON.stringify({ round: 'three', completedWorkers: ['a-check-p1'] }) + '\n',
        'utf-8'
      );
      expect(resumeBase.loadResumePoint(tmpDir)).toBeNull();
    });

    // v1.2.9 功能②：向后兼容——旧格式（completed: boolean）仍然可读
    it('loadResumePoint 向后兼容旧格式（completed: boolean 无 completedWorkers）', () => {
      writeFileSync(
        join(tmpDir, 'resume-point.json'),
        JSON.stringify({ round: 3, completed: true, counts: { p0: 0 } }) + '\n',
        'utf-8'
      );
      const loaded = resumeBase.loadResumePoint(tmpDir);
      expect(loaded).not.toBeNull();
      expect(loaded.round).toBe(3);
      expect(loaded.completed).toBe(true);
    });

    it('parseDriverArgs 解析 --resume flag', () => {
      const args = resumeBase.parseDriverArgs(['--target', 'v1.2.8', '--resume']);
      expect(args.resume).toBe(true);
    });

    it('parseDriverArgs 默认 resume=false', () => {
      const args = resumeBase.parseDriverArgs(['--target', 'v1.2.8']);
      expect(args.resume).toBe(false);
    });
  });
});
