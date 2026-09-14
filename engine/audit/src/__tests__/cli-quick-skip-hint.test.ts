// ============================================================
// cli-quick-skip-hint.test.ts · quick 模式「跳过」解释串锁（v1.4.9 P2-13）
// ------------------------------------------------------------
// 缺陷（两层，改前现场 = cli-quick.ts:224 与 :242）：
//   ① 定性缺失——原串只答「跳过的是什么」（归因类规则缺席），未答「为什么可接受」。
//      企业 IT 视角下「N 条跳过」读作「N 条没查」，无法据此判断审计是否够用。
//   ② 漂移面 ×2——同一串在 PASS 分支与非 PASS 分支各写一份字面量，改一处漏一处
//      即形成「同一 CLI 两种解释」。
// 修法：提取为单一导出常量 QUICK_SKIP_HINT（QUICK_SKIP_HINT）并补
//   「git diff 硬证据类规则已全量执行，跳过项非漏检」的定性句。
//
// 实测路径：直调导出的 generateQuickOutput（纯函数，无需 spawn dist）——
//   「两个分支都发出同一定性」是本项真正的行为面，故两分支各锁一次。
// ⚠️ 本文件是本项**唯一的漂移兜底**：常量被删、分支退回字面量、或定性句被
//   抹掉，都会让下列用例变红。
// ============================================================

import { describe, it, expect } from 'vitest';
import { generateQuickOutput, QUICK_SKIP_HINT } from '../cli-quick';
import type { AuditResult, RuleCheck } from '../reporter';

/** 造一条指定状态的规则结果（其余字段取最小可满足值）。 */
function rule(number: number, status: RuleCheck['status']): RuleCheck {
  return { name: `规则${number}`, number, status, details: [] };
}

/** 造审计结果：passCount 条 PASS + skipCount 条 SKIPPED（可选 1 条 FAIL 走非 PASS 分支）。 */
function result(passCount: number, skipCount: number, failCount = 0): AuditResult {
  const rules: RuleCheck[] = [];
  for (let i = 0; i < passCount; i++) rules.push(rule(i + 1, 'PASS'));
  for (let i = 0; i < skipCount; i++) rules.push(rule(passCount + i + 1, 'SKIPPED'));
  for (let i = 0; i < failCount; i++) rules.push(rule(passCount + skipCount + i + 1, 'FAIL'));
  const exitCode = failCount > 0 ? 2 : 0;
  return { rules, exitCode };
}

describe('quick 跳过解释串（v1.4.9 P2-13）', () => {
  it('常量含定性句：明示「硬证据类全量执行」「跳过项非漏检」', () => {
    expect(QUICK_SKIP_HINT).toContain('硬证据');
    expect(QUICK_SKIP_HINT).toContain('全量');
    expect(QUICK_SKIP_HINT).toContain('非漏检');
  });

  it('常量保留 v1.4.3 F-08 归因口径与两条升级路径（本条不得覆盖前项）', () => {
    expect(QUICK_SKIP_HINT).toContain('归因分析');
    expect(QUICK_SKIP_HINT).toContain('--task');
    expect(QUICK_SKIP_HINT).toContain('--init');
  });

  it('PASS 分支（有跳过）：输出含定性句', () => {
    const out = generateQuickOutput(result(16, 1), 'abcdef1');
    expect(out).toContain('条跳过');
    expect(out).toContain(QUICK_SKIP_HINT);
  });

  it('非 PASS 分支（有违规 + 有跳过）：输出同样含定性句——两分支不得漂移', () => {
    const out = generateQuickOutput(result(15, 1, 1), 'abcdef1');
    expect(out).toContain('条跳过');
    expect(out).toContain(QUICK_SKIP_HINT);
  });

  it('无跳过时不得出现该提示（避免无条件打印的假回声）', () => {
    const out = generateQuickOutput(result(17, 0), 'abcdef1');
    expect(out).not.toContain('条跳过');
    expect(out).not.toContain(QUICK_SKIP_HINT);
  });
});
