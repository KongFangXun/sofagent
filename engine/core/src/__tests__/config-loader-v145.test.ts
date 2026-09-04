// ============================================================
// v1.4.5 修复批单测 · T1（R4-P0 删除式绕过收紧）/ T2（数值类型注入）
//
// T1 覆盖场景（verifyConfigSignature strict 收紧）：
//   1. 有规则内容 + 无签名 + strict → 拒绝启动（fail-closed）
//   2. 有规则内容 + 无签名 + 普通模式 → WARN（向后兼容，不阻断）
//   3. 空配置（无规则内容）+ strict → 豁免（全新安装正常启动）
//   4. 签名不匹配 → 报错含「重新签名」逃生通道指引
//   5. audit.strict: true（config 内声明）+ 无签名 → 同样 fail-closed
//
// T2 覆盖场景（mergeWithDefaults 数值字段清洗）：
//   6. carefulModifyThreshold: "0.2 OR 1=1"（字符串注入）→ 回退安全默认 + WARN
//   7. loopCheckMaxRounds: "twenty"（非数字字符串）→ 回退 20 + WARN
//   8. 合法数值 → 原样通过（零误报）
//   9. A17.bulk_threshold: NaN 注入 → 回退默认 + WARN
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { loadConfig, safeDefaults } from '@sofagent/core';

describe('T1 · 删除式绕过收紧——「有规则内容但无签名」判定矩阵', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(process.cwd(), '.tmp-t1-strict-sig-' + Date.now());
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* 清理失败可接受 */ }
  });

  /** 写一个「有规则内容但无签名」的 config.yml */
  function writeUnsignedConfig(extraLines: string[] = []): void {
    const configDir = join(tmpDir, '.sofagent');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'config.yml'),
      [
        'audit:',
        '  carefulModifyThreshold: 0.2',
        '  rules:',
        '    a3: false',
        ...extraLines,
      ].join('\n'),
      'utf-8',
    );
  }

  it('有规则内容 + 无签名 + strict → 抛 ConfigSignatureError 拒绝启动', () => {
    writeUnsignedConfig();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let threw: unknown = null;
    try {
      loadConfig(tmpDir, true); // strict = true（模拟 CLI --strict / CI）
    } catch (err) {
      threw = err;
    }

    expect(threw).not.toBeNull();
    expect((threw as Error).name).toBe('ConfigSignatureError');
    expect((threw as Error).message).toContain('fail-closed');
    expect((threw as Error).message).toContain('sofagent-audit --sign-config');

    warnSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('有规则内容 + 无签名 + 普通模式 → WARN 不阻断（向后兼容）', () => {
    writeUnsignedConfig();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // 不应抛错——存量用户无签名配置不能被搞崩
    const config = loadConfig(tmpDir);
    expect(config.carefulModifyThreshold).toBe(0.2);

    // WARN 是多行框——整组输出合并后校验（框内含指引行）
    const allWarn = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allWarn).toContain('无防篡改签名');
    expect(allWarn).toContain('sofagent-audit --sign-config');

    warnSpy.mockRestore();
  });

  it('空配置（无规则内容）+ strict → 豁免正常启动（全新安装形态）', () => {
    const configDir = join(tmpDir, '.sofagent');
    mkdirSync(configDir, { recursive: true });
    // 只写一个非规则字段——无 audit 段、无任何已知 AuditConfig 字段
    writeFileSync(
      join(configDir, 'config.yml'),
      ['someRandomKey: whatever'].join('\n'),
      'utf-8',
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // strict 模式下空配置不抛错（豁免：无内容 = 无需防护）
    const config = loadConfig(tmpDir, true);
    expect(config).toBeDefined();

    // 且无「缺签名」告警（豁免是静默的——全新安装不该被吓到）
    const warnCalls = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warnCalls.includes('signature 缺失')).toBe(false);
    expect(warnCalls.includes('无防篡改签名')).toBe(false);

    warnSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('audit.strict: true（config 内声明）+ 无签名 → 同样 fail-closed（三来源合一）', () => {
    const configDir = join(tmpDir, '.sofagent');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'config.yml'),
      [
        'audit:',
        '  strict: true',
        '  carefulModifyThreshold: 0.2',
      ].join('\n'),
      'utf-8',
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let threw: unknown = null;
    try {
      loadConfig(tmpDir); // CLI 未传 strict——但 config 自己声明了 strict: true
    } catch (err) {
      threw = err;
    }

    expect(threw).not.toBeNull();
    expect((threw as Error).name).toBe('ConfigSignatureError');

    warnSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('签名不匹配报错文案 → 含「重新签名」逃生通道指引', () => {
    const { getHmacKey } = require('@sofagent/core');
    if (getHmacKey() === null) return; // 无密钥环境跳过（CI / 全新安装）

    writeUnsignedConfig(['signature: deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef']);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let threw: unknown = null;
    try {
      loadConfig(tmpDir);
    } catch (err) {
      threw = err;
    }

    expect(threw).not.toBeNull();
    expect((threw as Error).name).toBe('ConfigSignatureError');
    expect((threw as Error).message).toContain('sofagent-audit --sign-config');
    expect((threw as Error).message).toContain('重新签名');

    warnSpy.mockRestore();
    errSpy.mockRestore();
  });
});

describe('T2 · mergeWithDefaults 数值字段类型清洗（防 YAML 注入字符串）', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(process.cwd(), '.tmp-t2-numeric-' + Date.now());
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* 清理失败可接受 */ }
  });

  /** 写顶层 audit 段并 loadConfig（隔离 SOFAGENT_CONFIG 防串台） */
  function loadWithConfig(yaml: string): ReturnType<typeof loadConfig> {
    const configDir = join(tmpDir, '.sofagent');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.yml'), yaml, 'utf-8');
    const saved = process.env.SOFAGENT_CONFIG;
    delete process.env.SOFAGENT_CONFIG;
    try {
      return loadConfig(tmpDir);
    } finally {
      if (saved !== undefined) process.env.SOFAGENT_CONFIG = saved;
    }
  }

  it('carefulModifyThreshold: "0.2 OR 1=1"（字符串注入）→ 回退 safeDefaults + WARN', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const config = loadWithConfig([
      'audit:',
      '  carefulModifyThreshold: "0.2 OR 1=1"',
    ].join('\n'));

    // 回退到 safeDefaults 的 0.1（更严格），非注入字符串
    expect(config.carefulModifyThreshold).toBe(safeDefaults().carefulModifyThreshold);

    const calls = warnSpy.mock.calls.map((c) => String(c[0]));
    const injectWarn = calls.find((c) => c.includes('carefulModifyThreshold') && c.includes('非法'));
    expect(injectWarn).toBeDefined();
    expect(injectWarn).toContain('回退安全默认值');

    warnSpy.mockRestore();
  });

  it('loopCheckMaxRounds: "twenty"（非数字字符串）→ 回退 20 + WARN', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const config = loadWithConfig([
      'audit:',
      '  loopCheckMaxRounds: "twenty"',
    ].join('\n'));

    expect(config.loopCheckMaxRounds).toBe(20);

    const calls = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.includes('loopCheckMaxRounds') && c.includes('非法'))).toBe(true);
    warnSpy.mockRestore();
  });

  it('合法数值 → 原样通过零告警（无注入误报）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const config = loadWithConfig([
      'audit:',
      '  carefulModifyThreshold: 0.15',
      '  loopCheckMaxRounds: 30',
    ].join('\n'));

    expect(config.carefulModifyThreshold).toBe(0.15);
    expect(config.loopCheckMaxRounds).toBe(30);

    const calls = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.includes('数值字段') && c.includes('非法'))).toBe(false);
    warnSpy.mockRestore();
  });

  it('A17.bulk_threshold 字符串注入 → 回退默认 + WARN', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const config = loadWithConfig([
      'audit:',
      '  A17:',
      '    enabled: true',
      '    bulk_threshold: "999 OR SLEEP(5)"',
    ].join('\n'));

    expect(config.A17?.bulk_threshold).toBe(50);

    const calls = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.includes('A17.bulk_threshold') && c.includes('非法'))).toBe(true);
    warnSpy.mockRestore();
  });

  it('浮点数值（0.5）→ 通过（小数不误报）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const config = loadWithConfig([
      'audit:',
      '  carefulModifyThreshold: 0.5',
    ].join('\n'));

    expect(config.carefulModifyThreshold).toBe(0.5);
    const calls = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.includes('carefulModifyThreshold') && c.includes('非法'))).toBe(false);
    warnSpy.mockRestore();
  });
});
