// ============================================================
// exec-discipline.test.ts · 扩展三四件验收（v1.4.8）
// ① 调度判定关 LLM 纯规则跑通 ② Git 九组合逐组合断言
// ③ Agent B 不带 A 已暂存文件 ④ 裸 id 被拒
// ============================================================
import { describe, expect, it } from 'vitest';
import { classifyIntent, classifyIntentByRules } from '../dispatch/intent-classifier';
import { planExecution, type GitCapability, type IsolationMode } from '../exec/git-capability';
import { checkPathspecDiscipline, detectForeignStaged } from '@sofagent/audit';
import { validateScopedName, assertScopedName } from '@sofagent/core';

describe('扩展三 · 调度判定双层（纯函数主判 + LLM 仅增强）', () => {
  it('规则命中——纯规则跑通（关 LLM）', async () => {
    const v = await classifyIntent('帮我 fix 这个 bug 并重构一下');
    expect(v.intent).toBe('code');
    expect(v.source).toBe('rules');
  });

  it('规则未命中 + LLM 增强——改判', async () => {
    const v = await classifyIntent('那个事情咋整', async () => 'ops');
    expect(v.intent).toBe('ops');
    expect(v.source).toBe('llm');
  });

  it('规则未命中 + LLM 失败——回落规则结果（注入失败测试）', async () => {
    const v = await classifyIntent('那个事情咋整', async () => { throw new Error('LLM 不可用'); });
    expect(v.intent).toBe('chat');
    expect(v.source).toBe('fallback');
  });

  it('规则命中时 LLM 不参与（主判即单一事实源）', async () => {
    let llmCalled = false;
    const v = await classifyIntent('review 这个 PR', async () => { llmCalled = true; return 'chat'; });
    expect(v.source).toBe('rules');
    expect(llmCalled).toBe(false);
  });
});

describe('扩展三 · Git 能力 × 隔离 九组合矩阵', () => {
  const caps: GitCapability[] = ['none', 'local', 'remote'];
  const modes: IsolationMode[] = ['worktree', 'original-dir'];

  it('九组合全部产出计划（逐组合断言）', () => {
    for (const cap of caps) {
      for (const mode of modes) {
        const plan = planExecution(cap, mode);
        expect(plan).toBeDefined();
        // 不变式：推送/PR 仅 remote
        expect(plan.autoPush).toBe(cap === 'remote');
        expect(plan.canOpenPR).toBe(cap === 'remote');
        // 不变式：提交仅 non-none
        expect(plan.autoCommit).toBe(cap !== 'none');
        // 不变式：worktree 隔离需要 git + worktree 模式
        expect(plan.worktreeIsolation).toBe(cap !== 'none' && mode === 'worktree');
      }
    }
  });

  it('none + worktree → 硬阻塞显式提示（不静默建空目录）', () => {
    const plan = planExecution('none', 'worktree');
    expect(plan.blockers.length).toBe(1);
    expect(plan.blockers[0]).toContain('显式降级');
  });

  it('local → 降级说明含 PR 通道关闭', () => {
    const plan = planExecution('local', 'worktree');
    expect(plan.degradations.some((d) => d.includes('PR 通道关闭'))).toBe(true);
    expect(plan.blockers).toHaveLength(0);
  });

  it('remote + original-dir → 提示竞态风险建议 worktree', () => {
    const plan = planExecution('remote', 'original-dir');
    expect(plan.degradations.some((d) => d.includes('竞态风险'))).toBe(true);
  });
});

describe('扩展三 · 并发 Git 纪律（pathspec + 暂存隔离）', () => {
  it('git add -A / . / commit -a 被拒', () => {
    expect(checkPathspecDiscipline('git add -A').ok).toBe(false);
    expect(checkPathspecDiscipline('git add .').ok).toBe(false);
    expect(checkPathspecDiscipline('git commit -a -m x').ok).toBe(false);
  });

  it('精确 pathspec 通过', () => {
    expect(checkPathspecDiscipline('git add src/a.ts src/b.ts').ok).toBe(true);
    expect(checkPathspecDiscipline('git commit -m x -- src/a.ts').ok).toBe(true);
  });

  it('Agent B 提交不带 A 已暂存文件（暂存隔离检测）', () => {
    // A 暂存了 a.ts 与 shared.ts；B 只改了 b.ts
    const staged = ['a.ts', 'shared.ts', 'b.ts'];
    const bFiles = ['b.ts'];
    const { foreign, ok } = detectForeignStaged(staged, bFiles);
    expect(ok).toBe(false);
    expect(foreign).toEqual(['a.ts', 'shared.ts']);
  });

  it('B 独占暂存区 → 无外来文件', () => {
    const { ok } = detectForeignStaged(['b.ts', 'c.ts'], ['b.ts', 'c.ts']);
    expect(ok).toBe(true);
  });
});

describe('扩展三 · 作用域显名（裸 id 拒绝）', () => {
  it('带作用域通过', () => {
    expect(validateScopedName('workflowId:order-flow').valid).toBe(true);
    expect(validateScopedName('PRId:42').valid).toBe(true);
  });

  it('裸 id 被拒（结构化报错）', () => {
    const v = validateScopedName('order-flow');
    expect(v.valid).toBe(false);
    expect(v.error).toContain('缺作用域显名');
  });

  it('未知 kind 被拒', () => {
    expect(validateScopedName('unknown:x').valid).toBe(false);
  });

  it('assertScopedName 抛结构化错误（code 可编程消费）', () => {
    expect(() => assertScopedName('naked-id')).toThrow();
    try {
      assertScopedName('naked-id');
    } catch (e) {
      expect((e as Error & { code: string }).code).toBe('SOFAGENT_SCOPE_REQUIRED');
    }
  });
});
