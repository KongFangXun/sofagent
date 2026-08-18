// ============================================================
// memory-sync.test.ts · 内存同步测试
// v1.1.0 新增
// ============================================================

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { getPersonaContent } from '../filesystem/memory-sync';

describe('getPersonaContent', () => {
  it('返回 string 或 null', () => {
    const content = getPersonaContent();
    expect(content === null || typeof content === 'string').toBe(true);
  });

  it('函数可调用不抛错', () => {
    expect(() => getPersonaContent()).not.toThrow();
  });
});

// ============================================================
// v1.3.7 ⑨ 路径通用化——三级优先解析测试
//   env SOFAGENT_PERSONA_SOURCE > config persona_sources > 内置默认表
// ============================================================
import { resolvePersonaSources, syncPersona } from '../filesystem/memory-sync';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('resolvePersonaSources · 三级优先解析（v1.3.7 ⑨）', () => {
  const origEnv = process.env.SOFAGENT_PERSONA_SOURCE;
  afterEach(() => {
    if (origEnv === undefined) delete process.env.SOFAGENT_PERSONA_SOURCE;
    else process.env.SOFAGENT_PERSONA_SOURCE = origEnv;
  });

  it('① env 覆盖：SOFAGENT_PERSONA_SOURCE 单值最高优先', () => {
    process.env.SOFAGENT_PERSONA_SOURCE = '/custom/path/persona.md';
    const sources = resolvePersonaSources({ configSources: ['/cfg/persona.md'] });
    expect(sources).toEqual(['/custom/path/persona.md']);
  });

  it('② config 数组生效：env 缺省时 persona_sources[] 按序返回', () => {
    delete process.env.SOFAGENT_PERSONA_SOURCE;
    const sources = resolvePersonaSources({ configSources: ['/a/persona.md', '/b/persona.md'] });
    expect(sources).toEqual(['/a/persona.md', '/b/persona.md']);
  });

  it('③ 内置默认兜底：两级都缺省时落到原 3 路径（向后兼容）', () => {
    delete process.env.SOFAGENT_PERSONA_SOURCE;
    const sources = resolvePersonaSources();
    expect(sources.length).toBe(3);
    expect(sources[0]).toContain('.openclaw');
    expect(sources[1]).toContain('.workbuddy');
  });

  it('③ 优先级顺序交叉验证：env > config > 默认（逐级降级）', () => {
    process.env.SOFAGENT_PERSONA_SOURCE = '/env/persona.md';
    expect(resolvePersonaSources({ configSources: ['/cfg/persona.md'] })[0]).toBe('/env/persona.md');
    delete process.env.SOFAGENT_PERSONA_SOURCE;
    expect(resolvePersonaSources({ configSources: ['/cfg/persona.md'] })[0]).toBe('/cfg/persona.md');
    expect(resolvePersonaSources({})[0]).not.toBe('/cfg/persona.md');
  });

  it('空值防御：env 空串 / config 空数组均优雅降级', () => {
    process.env.SOFAGENT_PERSONA_SOURCE = '   ';
    expect(resolvePersonaSources({ configSources: [] }).length).toBe(3); // 落到默认
    delete process.env.SOFAGENT_PERSONA_SOURCE;
    expect(resolvePersonaSources({ configSources: ['', '  ', '/x/persona.md'] }).length).toBe(1);
  });
});

describe('syncPersona · 源解析消费（v1.3.7 ⑨）', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sofagent-msync-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('env 指定的源文件被同步（含质量合格内容）', () => {
    const src = join(dir, 'my-persona.md');
    writeFileSync(src, '资深后端工程师，十二年分布式系统经验，擅长高并发架构与性能调优，偏好简洁直接的代码风格，重视可观测性与灰度发布。');
    const r = syncPersona(join(dir, 'data'), { envSource: src });
    expect(r.synced).toBe(true);
    expect(r.sourcePath).toBe(src);
  });

  it('全部来源都不存在时 synced:false + reason（不 crash，与 v1.3.6 行为一致）', () => {
    const r = syncPersona(join(dir, 'data2'), { envSource: join(dir, 'nope.md'), configSources: [join(dir, 'nope2.md')] });
    expect(r.synced).toBe(false);
    expect(r.reason).toContain('未找到');
  });

  it('不传 opts 时与 v1.3.6 行为完全一致（签名向后兼容）', () => {
    // 内置默认路径在本测试机大概率不存在——期望优雅 false；存在则期望 true。两者都不 crash。
    const r = syncPersona(join(dir, 'data3'));
    expect(typeof r.synced).toBe('boolean');
    if (!r.synced) expect(r.reason).toBeTruthy();
  });
});
