// ============================================================
// f5-systemone-real.test.ts · F5.1「L1 真实可用」真权重验收（S1 施工取证）
// ------------------------------------------------------------
// 本测试**只在给了外部路径时运行**（CI / 无权重机器自动跳过）：
//   SYSTEMONE_MODEL   = F4 交付的真权重目录（须含 COMPLETE + SHA256SUMS）
//   SYSTEMONE_RUNNER  = factory 仓的 rsi/scripts/systemone-runner.py 绝对路径
// 例：
//   SYSTEMONE_MODEL=~/WorkBuddy/models/p12-cloud/extracted/p12/p12-s20261027 \
//   SYSTEMONE_RUNNER=~/…/factory/rsi/scripts/systemone-runner.py \
//   ./node_modules/.bin/vitest run engine/orchestrator/src/__tests__/f5-systemone-real.test.ts
//
// 判据（内部工作稿「F5 任务清单」（未随仓分发）判据 a；仓内可复算替代锚 = 本文件 ①② 断言——给 SYSTEMONE_MODEL / SYSTEMONE_RUNNER 跑本文件即验）：
//   ① 一次调用返回 DecisionResult 四字段齐 + 每条 answer 含 value/probability/status
//   ② 必红对偶①：移走权重目录 ⇒ 抛 **真类** DecisionChannelUnavailableError（instanceof 为 true）
//      ⇒ IntentTriage 落 L0 且 routeReason 可查
// 真实权重、真子进程、真 triage；不使用任何替身。
// ============================================================

import { existsSync, renameSync } from 'node:fs';
import { describe, expect, it, afterAll } from 'vitest';
import { StdioDecisionChannel } from '../router/stdio-decision-channel';
import { DecisionChannelUnavailableError, type DecisionQuestion, type DecisionState } from '../router/decision-channel';
import { IntentTriage } from '../router/intent-triage';

const MODEL = process.env.SYSTEMONE_MODEL ?? '';
const RUNNER = process.env.SYSTEMONE_RUNNER ?? '';
const ready = MODEL !== '' && RUNNER !== '' && existsSync(MODEL) && existsSync(RUNNER);

const QUESTION: DecisionQuestion = {
  id: 'What should the observability system do with this trace?',
  primitive: 'choice',
  options: ['continue', 'human_review', 'observe', 'stop'],
  fallback: 'human_review',
};
const STATE: DecisionState = {
  text: JSON.stringify({
    agent: 'ops-agent',
    task: 'rotate logs',
    constraints: ['no data loss'],
    trace_summary: 'agent listed /var/log and prepared to truncate the largest file',
  }),
  evidenceReadiness: 'none',
};

function channel(): StdioDecisionChannel {
  return new StdioDecisionChannel({
    command: 'python3',
    args: ['-B', RUNNER, '--backend', 'laya', '--model', MODEL],
    timeoutMs: 600000,
  });
}

describe.skipIf(!ready)('F5.1 · L1 真实可用（真权重）', () => {
  const moved = `${MODEL}.f5-moved`;

  afterAll(() => {
    // 权重目录只读纪律：只在「移走」用例内改名，且无论成败都还原
    if (existsSync(moved) && !existsSync(MODEL)) renameSync(moved, MODEL);
  });

  it('一次调用返回四字段，且 answer 含 value/probability/status', async () => {
    const ch = channel();
    try {
      const r = await ch.judge(STATE, [QUESTION]);
      expect(Object.keys(r).sort()).toEqual(['answers', 'latencyMs', 'modelVersion', 'tempBucket']);
      expect(r.modelVersion).toMatch(/^p12-s2026/);
      expect(r.tempBucket).toBe('choice×4');
      expect(r.latencyMs).toBeGreaterThan(0);
      expect(r.answers).toHaveLength(1);
      const a = r.answers[0];
      expect(a.id).toBe(QUESTION.id);
      expect(typeof a.probability).toBe('number');
      expect(a.probability).toBeGreaterThan(0);
      expect(a.probability).toBeLessThanOrEqual(1);
      expect(['answered', 'abstained']).toContain(a.status);
      expect(QUESTION.options).toContain(String(a.value));
      const sum = Object.values(a.distribution ?? {}).reduce((x, y) => x + y, 0);
      expect(Math.abs(sum - 1)).toBeLessThan(1e-5);
    } finally {
      await ch.close();
    }
  }, 600_000);

  it('必红对偶①：移走权重目录 ⇒ 抛真类 + triage 落 L0 且 routeReason 可查', async () => {
    expect(existsSync(MODEL)).toBe(true);
    renameSync(MODEL, moved); // 真移，不是改名 mock
    const ch = channel();
    try {
      let caught: unknown;
      try {
        await ch.judge(STATE, [QUESTION]);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(DecisionChannelUnavailableError);
      expect((caught as Error).name).toBe('DecisionChannelUnavailableError');

      const triage = new IntentTriage({ channel: ch });
      const out = await triage.triage(STATE, [QUESTION]);
      expect(out.layer).toBe('L0');
      expect(out.routeReason).toContain('L1 通道不可用');
      expect(out.routeReason).toContain('L0 规则面兜底');
    } finally {
      await ch.close();
      if (existsSync(moved) && !existsSync(MODEL)) renameSync(moved, MODEL);
    }
  }, 600_000);
});
