// ============================================================
// redactor-load-rules.test.ts · loadRedactRules 坏配置发声回归测试（v1.5.0 TASK-20）
//
// 覆盖场景（任务书验收：两态测试绿）：
//   1. 损坏 JSON fixture → 非 strict：stderr 含警告（规则失效可感知）且返回 {}
//   2. 损坏 JSON fixture → SOFAGENT_REDACT_STRICT=1：throw（红死优于静默）
//   3. 正常 JSON → 无警告照常解析；文件不存在 → 空配置零噪音
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadRedactRules } from '../export/redactor';

describe('loadRedactRules 坏配置发声（v1.5.0 TASK-20）', () => {
  let dataDir: string;
  let rulesPath: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 't20-redact-'));
    mkdirSync(join(dataDir, 'config'), { recursive: true });
    rulesPath = join(dataDir, 'config', 'redact-rules.json');
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    delete process.env.SOFAGENT_REDACT_STRICT;
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('损坏 JSON → 非 strict：stderr 警告 + 返回 {}（降级但发声）', () => {
    writeFileSync(rulesPath, '{ this is not valid json !!!', 'utf-8');
    const r = loadRedactRules(dataDir);
    expect(r).toEqual({});
    const errOut = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(errOut).toContain('redact-rules.json 解析失败');
    expect(errOut).toContain(rulesPath);
    expect(errOut).toContain('自定义脱敏规则已全部失效');
    expect(errOut).toContain('请修复或删除该文件');
  });

  it('损坏 JSON → SOFAGENT_REDACT_STRICT=1：throw（红死优于静默）', () => {
    writeFileSync(rulesPath, '[[[ broken', 'utf-8');
    process.env.SOFAGENT_REDACT_STRICT = '1';
    expect(() => loadRedactRules(dataDir)).toThrow(/解析失败/);
    expect(() => loadRedactRules(dataDir)).toThrow(/SOFAGENT_REDACT_STRICT=1/);
  });

  it('正常 JSON → 无警告照常解析；文件不存在 → 空配置零噪音', () => {
    writeFileSync(rulesPath, JSON.stringify({ entities: [{ pattern: 'AcmeCorp', placeholder: '[企业名]' }] }), 'utf-8');
    const r = loadRedactRules(dataDir);
    expect(r.entities?.[0]?.pattern).toBe('AcmeCorp');
    expect(stderrSpy).not.toHaveBeenCalled();

    rmSync(rulesPath);
    const r2 = loadRedactRules(dataDir);
    expect(r2).toEqual({});
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});
