// ============================================================
// ruleset-redos.test.ts · ReDoS 防护单测
// v1.3.4 P1-10：验证自定义 JSON 规则的邪恶 pattern 被拒绝加载
//
// 覆盖场景：
//   1. (a+)+ 邪恶 pattern → 被静态检测拒绝 + 告警
//   2. (a*)* 邪恶 pattern → 被静态检测拒绝
//   3. 正常 pattern（如 AKIA[A-Z0-9]+）→ 不受影响，正常执行
//   4. runPatternRule 对 ReDoS pattern 返回 WARN（而非挂死）
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import type { DiffFile } from '@sofagent/core';
import {
  detectReDoSPattern,
  isPatternReDoSSafe,
  runPatternRule,
  type RulesetRule,
} from '../ruleset-loader';

function makeDiffFile(
  p: string,
  lines: string[],
  status: 'added' | 'modified' | 'deleted' | 'renamed' = 'modified',
): DiffFile {
  return { path: p, status, lines };
}

function makePatternRule(overrides: Partial<RulesetRule> = {}): RulesetRule {
  return {
    id: 'test-rule',
    name: '测试规则',
    severity: 'FAIL',
    type: 'pattern',
    pattern: 'TODO',
    message: '命中: {match}',
    ...overrides,
  };
}

describe('ReDoS 防护（P1-10）', () => {
  describe('detectReDoSPattern —— 静态检测', () => {
    it('(a+)+ 邪恶 pattern → 检测到嵌套量词', () => {
      const result = detectReDoSPattern('(a+)+');
      expect(result).not.toBeNull();
      expect(result).toContain('嵌套量词');
    });

    it('(a*)* 邪恶 pattern → 检测到嵌套量词', () => {
      const result = detectReDoSPattern('(a*)*');
      expect(result).not.toBeNull();
      expect(result).toContain('嵌套量词');
    });

    it('(a+)* 邪恶 pattern → 检测到嵌套量词', () => {
      const result = detectReDoSPattern('(a+)*');
      expect(result).not.toBeNull();
      expect(result).toContain('嵌套量词');
    });

    it('(\\w+)+$ 邪恶 pattern → 检测到嵌套量词', () => {
      const result = detectReDoSPattern('(\\w+)+$');
      expect(result).not.toBeNull();
      expect(result).toContain('嵌套量词');
    });

    it('正常 pattern AKIA[A-Z0-9]+ → 安全（null）', () => {
      const result = detectReDoSPattern('AKIA[A-Z0-9]+');
      expect(result).toBeNull();
    });

    it('正常 pattern password|secret|token → 安全（null）', () => {
      const result = detectReDoSPattern('password|secret|token');
      expect(result).toBeNull();
    });

    it('正常 pattern TODO → 安全（null）', () => {
      const result = detectReDoSPattern('TODO');
      expect(result).toBeNull();
    });
  });

  describe('isPatternReDoSSafe —— 运行时 timeout 检测', () => {
    it('正常 pattern → 返回 true', () => {
      const regex = /AKIA[A-Z0-9]+/;
      expect(isPatternReDoSSafe(regex)).toBe(true);
    });

    it('简单 pattern → 返回 true', () => {
      const regex = /password/g;
      expect(isPatternReDoSSafe(regex)).toBe(true);
    });
  });

  describe('runPatternRule —— ReDoS pattern 拒绝加载', () => {
    it('(a+)+ pattern → 返回 WARN（不挂死）+ 含 ReDoS 告警', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const rule = makePatternRule({
        name: '邪恶规则',
        pattern: '(a+)+$',
      });
      const files = [makeDiffFile('a.ts', ['+aaaaaaaaaaaaaa!'])];

      const result = runPatternRule(rule, files);

      // 不应挂死——应快速返回 WARN
      expect(result.status).toBe('WARN');
      expect(result.details[0]).toContain('ReDoS');

      // 应输出显著告警
      const redosWarn = warnSpy.mock.calls.some(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('ReDoS'),
      );
      expect(redosWarn).toBe(true);

      warnSpy.mockRestore();
    });

    it('(a*)* pattern → 返回 WARN（不挂死）', () => {
      const rule = makePatternRule({
        name: '邪恶规则2',
        pattern: '(a*)*',
      });
      const files = [makeDiffFile('b.ts', ['+aaaaaaa'])];

      const result = runPatternRule(rule, files);

      expect(result.status).toBe('WARN');
      expect(result.details[0]).toContain('ReDoS');
    });

    it('正常 pattern 不受 ReDoS 检测影响——正常命中', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const rule = makePatternRule({
        name: '密钥检测',
        pattern: 'AKIA[A-Z0-9]+',
        severity: 'FAIL',
      });
      const files = [
        makeDiffFile('config.ts', ['+const key = "AKIAIOSFODNN7EXAMPLE"']),
      ];

      const result = runPatternRule(rule, files);

      expect(result.status).toBe('FAIL');
      expect(result.details.length).toBeGreaterThanOrEqual(1);

      // 不应有 ReDoS 告警
      const redosWarn = warnSpy.mock.calls.some(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('ReDoS'),
      );
      expect(redosWarn).toBe(false);

      warnSpy.mockRestore();
    });
  });
});
