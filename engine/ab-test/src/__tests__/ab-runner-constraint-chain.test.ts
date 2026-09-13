// ============================================================
// ab-runner-constraint-chain.test.ts · v1.4.9 P1-5 回归锁
// ============================================================
// 缺陷：runReactAgent 把 `dirname(skillPath)` 当 **projectRoot** 传给
// buildConstrainedSystemPrompt，而 harness 还会再 join 一层（默认 '.sofagent'）
// ⇒ 实读 `<dirname(skillPath)>/.sofagent/*` ⇒ 约束链**结构性读空**。
// 更糟的是降级链：方案 C（读空、静默）是**主路径**，只有它抛错才降级到方案 B
// （而 B 才是 fail-loud 的那条）——即主路径恰好是最静默的一条。
//
// 本文件锁两件事：
//   ① 约束链读空 → **抛哨兵错误且不降级**（runABTest 直接 reject，不当 tie/不当降级）
//   ② 良构 skillPath 的派生正确：createReactAgent 拿到的 prompt 里**真有**宪法层
//      （旧实现的派生必然给出空串——反向注入可测出红）
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { TestCase } from '@sofagent/eval';
import { runABTest } from '../ab-runner';
import { DEFAULT_SCORE_WEIGHTS } from '../types';

/** createReactAgent 收到的 prompt 采集（vi.mock 工厂被提升，须用 vi.hoisted 共享） */
const captured = vi.hoisted(() => ({ prompts: [] as string[] }));

vi.mock('@langchain/langgraph/prebuilt', () => ({
  createReactAgent: async (cfg: { prompt: string }) => {
    captured.prompts.push(cfg.prompt);
    return {
      invoke: async () => ({ messages: [{ role: 'assistant', content: '{"ok":true}' }] }),
    };
  },
}));

// 让 LLM 解析不依赖真实环境（本测试只关心中间那条约束链）
vi.mock('@sofagent/orchestrator', () => ({
  resolveLLMModel: async () => ({ model: { mocked: true } }),
}));

const CASES: TestCase[] = [1, 2, 3].map((i) => ({
  id: `case-${i}`,
  description: `样本 ${i}`,
  input: { task: `任务 ${i}` },
  expected: { ok: true },
}));

function makeConfig(skillPath: string) {
  return {
    current: skillPath,
    candidate: skillPath,
    evalSet: 'unused-in-this-test.yaml',
    promoteThreshold: 2,
    minSampleSize: 3,
    scoreWeights: DEFAULT_SCORE_WEIGHTS,
  };
}

describe('P1-5 · A/B 方案 C 约束链读空（不静默降级）', () => {
  let tmpDir: string;

  beforeEach(() => {
    captured.prompts.length = 0;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-p15-ab-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort 清理 */ }
  });

  it('① skillPath 所在目录无约束文件 → reject 且错误为约束链哨兵（不降级到方案 B）', async () => {
    const skillPath = path.join(tmpDir, 'proj', 'agent.md');
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(skillPath, '# 随便一个 Agent 定义', 'utf-8');

    await expect(runABTest(makeConfig(skillPath), CASES)).rejects.toThrow(/约束链读空/);
    // 未降级：方案 B 一次也没跑（B 会把这个文件当 system prompt 用）
    expect(captured.prompts).toHaveLength(0);
  });

  it('② 良构 skillPath（约束目录内有 SKILL.md）→ 派生正确：prompt 里真有宪法层', async () => {
    const constraintDir = path.join(tmpDir, 'proj', '.sofagent');
    const skillPath = path.join(constraintDir, 'SKILL.md');
    fs.mkdirSync(constraintDir, { recursive: true });
    fs.writeFileSync(skillPath, '# 底线\n- 不越权（P1-5 探针标记）', 'utf-8');
    fs.writeFileSync(path.join(constraintDir, 'fde.md'), '# 企业规则探针', 'utf-8');

    const result = await runABTest(makeConfig(skillPath), CASES);
    expect(result.winner).toBe('tie'); // 三样本同分，不裁决
    expect(captured.prompts.length).toBeGreaterThan(0);
    const prompt = captured.prompts[0]!;
    expect(prompt).toContain('# 宪法约束');
    expect(prompt).toContain('P1-5 探针标记');
    expect(prompt).toContain('# 企业规则');
    expect(prompt).toContain('企业规则探针');
  });

  it('② 非默认约束目录名也能派生（.sofagent 之外的 skillDir）', async () => {
    const constraintDir = path.join(tmpDir, 'proj', 'my-skill');
    const skillPath = path.join(constraintDir, 'agent.md');
    fs.mkdirSync(constraintDir, { recursive: true });
    fs.writeFileSync(skillPath, 'x', 'utf-8');
    fs.writeFileSync(path.join(constraintDir, 'SKILL.md'), '# 自定义目录探针', 'utf-8');

    await runABTest(makeConfig(skillPath), CASES);
    expect(captured.prompts[0]).toContain('自定义目录探针');
  });
});
