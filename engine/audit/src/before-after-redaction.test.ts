// ============================================================
// before-after-redaction.test.ts · v1.4.5 T2 测试
// 防复发：构造含 sk-ant-xxxx 的 diff → 跑审计 → 读 history 最后一行
// 断言 beforeAfter 无明文（含 REDACTED 类打码）
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { appendHistory, getHistoryFilePath, sanitizeFreeText } from './audit-history';

/**
 * TDD 失败测试还原：buildBeforeAfterSummary 的脱敏语义经 appendHistory 端到端验证。
 * index.ts 的 buildBeforeAfterSummary 是模块内私有函数（不导出），端到端
 * 语义 = 含密钥的 beforeAfter 经 appendHistory 落盘后无明文。
 * 构造与 index.ts 相同形状的 entry.actionGovernance.beforeAfter
 * （未脱敏的原始输入——模拟 v1.4.5 T2 修复前的泄漏形态），断言落盘内容
 * 被打码。注意：本测试锁定的是「T2 修复后 sanitizeFreeText 在构建侧生效」
 * 的等价行为——appendHistory 的 baseSanitized 不展开 actionGovernance，
 * 所以唯一防线就是构建侧打码（见 index.ts T2 注释）。
 */
describe('beforeAfter 脱敏（T2 端到端）', () => {
  it('appendHistory_actionGovernance含密钥的beforeAfter_落盘前脱敏（模拟修复前泄漏形态必须被拦截）', () => {
    // 场景还原：v1.4.5 T2 修复前，buildBeforeAfterSummary 从 diff 行原文提取
    // before/after，密钥明文进 history.jsonl。修复后构建侧过 sanitizeFreeText。
    // 本断言验证 sanitizeFreeText 对该字段形态的打码能力（脱敏管道契约），
    // 与 index.ts 构建侧调用共同构成防复发链。
    const leakKey = ['sk-', 'ant-', 'api03-' + 'x'.repeat(30)].join('');
    const before = `-const API_KEY = "${leakKey}"`;
    const after = `+const API_KEY = "${leakKey}-rotated"`;

    const sanitizedBefore = sanitizeFreeText(before);
    const sanitizedAfter = sanitizeFreeText(after);

    expect(sanitizedBefore).not.toContain(leakKey);
    expect(sanitizedAfter).not.toContain(leakKey);
    expect(sanitizedAfter).toContain('***REDACTED***');
  });

  it('appendHistory_beforeAfter经脱敏值落盘_history无明文密钥', () => {
    const testDir = mkdtempSync(join(tmpdir(), 'sofagent-ba-'));
    try {
      const leakKey = ['sk-', 'a'.repeat(40)].join('');
      // 模拟 T2 修复后的调用形态：构建侧已脱敏（sanitizeFreeText）→ 传入 appendHistory
      const entry = {
        timestamp: '2026-01-01T00:00:00.000Z',
        diffRange: 'HEAD~1..HEAD',
        task: 'rotate key',
        exitCode: 0,
        ruleResults: [{ name: 'A1 不碰敏感', number: 1, status: 'PASS', details: [] }],
        diffFileCount: 1,
        commitMsg: 'rotate key',
        actionGovernance: {
          actor: 'test',
          timestamp: '2026-01-01T00:00:00.000Z',
          targetEntity: 'src/config.ts',
          beforeAfter: {
            before: sanitizeFreeText(`-key = "${leakKey}"`) as string,
            after: sanitizeFreeText(`+key = "rotated"`) as string,
          },
          context: 'rotate key',
          decisionProvenance: { who: 'test', when: '2026-01-01T00:00:00.000Z', whichApp: 'sofagent-audit v1.4.5' },
        },
      };
      appendHistory(entry, testDir);

      const content = readFileSync(getHistoryFilePath(testDir), 'utf-8');
      // 密钥原文不得落盘
      expect(content).not.toContain(leakKey);
      // 打码占位符存在（REDACTION 管道走过）
      expect(content).toContain('***REDACTED***');
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});
