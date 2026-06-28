// ============================================================
// evidence-mode.test.ts · evidenceMode 双路径切换测试
// v0.95 新增
// ============================================================

import { describe, it, expect } from 'vitest';
import { checkRuleA7 } from './rules/rule-a7-read-before-write';
import { checkRuleA8 } from './rules/rule-a8-verify-before-continue';
import { checkRuleA3 } from './rules/rule-a3-careful-modify';
import { checkRuleA1 } from './rules/rule-a1-sensitive-files';
import { rules } from './rules';
import type { AuditContext } from './rules/types';
import type { DiffFile } from './diff-parser';
import type { LogEntry } from './log-checker';
import { makeDiffFile } from './test-utils';

function makeReadEntry(file: string): LogEntry {
  return {
    timestamp: new Date(),
    operation: 'read',
    file,
    raw: `读取文件 ${file}`,
  };
}

function makeExecEntry(raw: string): LogEntry {
  return {
    timestamp: new Date(),
    operation: 'execute',
    raw,
  };
}

describe('evidenceMode 双路径切换', () => {
  describe('铁律 #1 先读再用（hybrid）', () => {
    it('有日志 → 走精确检查（现有逻辑）', () => {
      const ctx: AuditContext = {
        diffFiles: [makeDiffFile('src/config.ts')],
        logEntries: [makeReadEntry('src/config.ts')],
      };
      const result = checkRuleA7(ctx);
      expect(result.status).toBe('PASS');
    });

    it('无日志 + silent → 走 diff 回退，只 WARN 不 FAIL', () => {
      const ctx: AuditContext = {
        diffFiles: [makeDiffFile('src/index.ts')],
        logEntries: [],
        silent: true,
      };
      const result = checkRuleA7(ctx);
      expect(result.status).toBe('WARN');
      expect(result.details[0]).toContain('--silent');
      // 关键：不应该是 FAIL
      expect(result.status).not.toBe('FAIL');
    });

    it('无日志 + 非 silent + 非 strict → WARN（现有行为）', () => {
      const ctx: AuditContext = {
        diffFiles: [makeDiffFile('src/index.ts')],
        logEntries: [],
      };
      const result = checkRuleA7(ctx);
      expect(result.status).toBe('WARN');
      expect(result.details[0]).toContain('未找到');
    });

    it('无日志 + 非 silent + strict → FAIL（现有行为）', () => {
      const ctx: AuditContext = {
        diffFiles: [makeDiffFile('src/index.ts')],
        logEntries: [],
        strict: true,
      };
      const result = checkRuleA7(ctx);
      expect(result.status).toBe('FAIL');
    });

    it('silent 优先于 strict——无日志 + silent + strict → WARN 不 FAIL', () => {
      const ctx: AuditContext = {
        diffFiles: [makeDiffFile('src/index.ts')],
        logEntries: [],
        silent: true,
        strict: true,
      };
      const result = checkRuleA7(ctx);
      expect(result.status).toBe('WARN');
    });

    it('evidenceMode 标注为 hybrid', () => {
      const ctx: AuditContext = {
        diffFiles: [makeDiffFile('src/config.ts')],
        logEntries: [makeReadEntry('src/config.ts')],
      };
      const result = checkRuleA7(ctx);
      expect(result.evidenceMode).toBe('hybrid');
    });
  });

  describe('铁律 #3 验证再干（hybrid）', () => {
    it('有日志 + 有构建执行 → PASS', () => {
      const ctx: AuditContext = {
        diffFiles: [makeDiffFile('package.json')],
        logEntries: [makeExecEntry('npm test')],
      };
      const result = checkRuleA8(ctx);
      expect(result.status).toBe('PASS');
    });

    it('无日志 + silent + 构建文件变更 → WARN 不 FAIL', () => {
      const ctx: AuditContext = {
        diffFiles: [makeDiffFile('package.json')],
        logEntries: [],
        silent: true,
      };
      const result = checkRuleA8(ctx);
      expect(result.status).toBe('WARN');
      expect(result.details[0]).toContain('--silent');
      expect(result.status).not.toBe('FAIL');
    });

    it('无日志 + 非 silent + 构建文件变更 → WARN（现有行为）', () => {
      const ctx: AuditContext = {
        diffFiles: [makeDiffFile('package.json')],
        logEntries: [],
      };
      const result = checkRuleA8(ctx);
      expect(result.status).toBe('WARN');
    });

    it('有日志 + 无构建执行 + 构建文件变更 → FAIL（现有行为）', () => {
      const ctx: AuditContext = {
        diffFiles: [makeDiffFile('package.json')],
        logEntries: [makeReadEntry('package.json')],
      };
      const result = checkRuleA8(ctx);
      expect(result.status).toBe('FAIL');
    });

    it('evidenceMode 标注为 hybrid', () => {
      const ctx: AuditContext = {
        diffFiles: [makeDiffFile('package.json')],
        logEntries: [makeExecEntry('npm test')],
      };
      const result = checkRuleA8(ctx);
      expect(result.evidenceMode).toBe('hybrid');
    });
  });

  describe('evidenceMode 标注', () => {
    it('每条规则注册时带 evidenceMode 字段', () => {
      for (const rule of rules) {
        expect(rule.evidenceMode).toBeDefined();
        expect(['git-diff', 'logs', 'hybrid']).toContain(rule.evidenceMode);
      }
    });

    it('A7 和 A8 是 hybrid', () => {
      const a7 = rules.find((r) => r.number === 7);
      const a8 = rules.find((r) => r.number === 8);
      expect(a7?.evidenceMode).toBe('hybrid');
      expect(a8?.evidenceMode).toBe('hybrid');
    });

    it('A3 和 A1 是 git-diff', () => {
      const a3 = rules.find((r) => r.number === 3);
      const a1 = rules.find((r) => r.number === 1);
      expect(a3?.evidenceMode).toBe('git-diff');
      expect(a1?.evidenceMode).toBe('git-diff');
    });

    it('git-diff 规则返回的 RuleCheck 带 evidenceMode 字段', () => {
      const ctx: AuditContext = {
        diffFiles: [makeDiffFile('.env')],
        logEntries: [],
      };
      const result = checkRuleA1(ctx);
      expect(result.evidenceMode).toBe('git-diff');
    });

    it('R1 无关文件返回的 RuleCheck 带 evidenceMode 字段', () => {
      const files = Array.from({ length: 15 }, (_, i) => makeDiffFile(`src/unrelated${i}.ts`));
      const ctx: AuditContext = {
        diffFiles: files,
        logEntries: [],
        task: 'login',
      };
      const result = checkRuleA3(ctx);
      expect(result.evidenceMode).toBe('git-diff');
    });
  });
});
