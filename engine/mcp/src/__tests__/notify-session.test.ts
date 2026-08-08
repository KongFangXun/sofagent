// ============================================================
// notify-session.test.ts · MCP notify_session tool 测试（v1.2.8 S5 新增）
// ============================================================
//
// 覆盖：
// - 返回值首行含 [sofagent] 前缀
// - think_ref=true 时自动查 think.md 相关历史教训
// - PASS/WARN/FAIL 三态展示
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock think 依赖
vi.mock('@sofagent/think', () => ({
  generateDataThink: vi.fn(),
}));

import { notifySession } from '../tools/notify-session';

describe('notify_session', () => {
  let tmpDir: string;
  let originalData: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-ns-'));
    originalData = process.env.SOFAGENT_DATA;
    vi.stubEnv('SOFAGENT_DATA', tmpDir);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.stubEnv('SOFAGENT_DATA', originalData ?? '');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('返回值首行含 [sofagent] 前缀', () => {
    const result = notifySession({
      audit_type: 'code',
      verdict: 'PASS',
      summary: '全部审计规则通过',
    });
    expect(result.text.startsWith('[sofagent]')).toBe(true);
  });

  it('PASS 判定展示 ✅', () => {
    const result = notifySession({
      audit_type: 'code',
      verdict: 'PASS',
      summary: '审计通过',
    });
    expect(result.text).toContain('PASS');
    expect(result.data.verdict).toBe('PASS');
  });

  it('WARN 判定展示 ⚠️ 和详情', () => {
    const result = notifySession({
      audit_type: 'code',
      verdict: 'WARN',
      summary: '2 项警告',
      details: ['A3 文件大小超限', 'A11 资源超标'],
    });
    expect(result.text).toContain('WARN');
    expect(result.text).toContain('A3 文件大小超限');
    expect(result.text).toContain('A11 资源超标');
  });

  it('FAIL 判定展示 ❌ 和修复建议', () => {
    const result = notifySession({
      audit_type: 'data',
      verdict: 'FAIL',
      summary: '数据审计拦截',
      details: ['D1 domain 为空'],
    });
    expect(result.text).toContain('FAIL');
    expect(result.text).toContain('建议');
  });

  it('think_ref=true 时附上相关历史教训', () => {
    // 创建 think.md 含历史教训
    fs.writeFileSync(
      path.join(tmpDir, 'think.md'),
      '## 2026-01-01 任务: test\n\n- #教训: A3 预算上调惯例——贴边超标按先例上调预算\n\n',
      'utf-8',
    );

    const result = notifySession({
      audit_type: 'code',
      verdict: 'WARN',
      summary: 'A3 文件大小超限',
      think_ref: true,
    });

    expect(result.data.thinkRefAttached).toBe(true);
    expect(result.data.relatedLessons.length).toBeGreaterThan(0);
    expect(result.text).toContain('历史教训');
  });

  it('think_ref=false 时不附历史教训', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'think.md'),
      '## 2026-01-01 任务: test\n\n- #教训: some lesson\n\n',
      'utf-8',
    );

    const result = notifySession({
      audit_type: 'code',
      verdict: 'PASS',
      summary: '通过',
      think_ref: false,
    });

    expect(result.data.thinkRefAttached).toBe(false);
    expect(result.text).not.toContain('历史教训');
  });
});
