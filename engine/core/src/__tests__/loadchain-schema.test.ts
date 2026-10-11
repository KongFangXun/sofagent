// ============================================================
// loadchain-schema.test.ts · 加载链四层配置面契约单测（v1.5.9 章三）
// ============================================================
// 三组（对齐 devlog 章三验收）：
//   ① 归属唯一：同字段两层声明 ⇒ 拒绝并具名
//   ② 未登记拒绝：实现引用未登记字段 ⇒ 拒绝并具名
//   ③ 越界具名：配置值写入非本层字段 ⇒ 拒绝并具名
// 另附：schema SSOT 四层全覆盖 + env 装载归属路由自检。
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  LOAD_CHAIN_LAYERS,
  LOAD_CHAIN_CONFIG_FIELDS,
  getFieldsByLayer,
  assertUniqueOwnership,
  assertAllRegistered,
  resolveOwner,
  assertLayerWrite,
  buildLayerConfig,
  loadChainDefaults,
  loadChainConfigFromEnv,
  validateLoadChainSchema,
  LoadChainOwnershipError,
  LoadChainUnregisteredFieldError,
  LoadChainBoundaryError,
  type LoadChainField,
} from '../loadchain-schema';

/** 合成字段（供拒绝路径断言） */
function field(key: string, layer: LoadChainField['layer']): LoadChainField {
  return {
    key,
    layer,
    type: 'string',
    default: '',
    implRef: { file: 'engine/inject/src/index.ts', needle: key },
    rationale: 'test',
  };
}

describe('loadchain-schema · SSOT 结构', () => {
  it('四层为固定四层且顺序即注入顺序', () => {
    expect(LOAD_CHAIN_LAYERS).toEqual(['SKILL.md', 'fde.md', 'think.md', 'knowledge']);
  });

  it('四层配置字段全部登记（每层至少一条）', () => {
    validateLoadChainSchema();
    for (const layer of LOAD_CHAIN_LAYERS) {
      expect(getFieldsByLayer(layer).length).toBeGreaterThan(0);
    }
  });

  it('真实 schema 通过归属唯一断言', () => {
    expect(() => assertUniqueOwnership()).not.toThrow();
  });

  it('每条字段都带实现引用锚点（配置面不悬空）', () => {
    for (const f of LOAD_CHAIN_CONFIG_FIELDS) {
      expect(f.implRef.file).toMatch(/^engine\//);
      expect(f.implRef.needle.length).toBeGreaterThan(0);
    }
  });

  it('loadChainDefaults 覆盖全部登记字段', () => {
    const d = loadChainDefaults();
    expect(Object.keys(d).sort()).toEqual(LOAD_CHAIN_CONFIG_FIELDS.map((f) => f.key).sort());
  });
});

describe('① 归属唯一（同字段两层声明 ⇒ 拒绝并具名）', () => {
  it('同名字段被两层声明 ⇒ 抛 LoadChainOwnershipError 并点名字段与两层', () => {
    const dup = [field('sharedKnob', 'SKILL.md'), field('sharedKnob', 'knowledge')];
    let caught: unknown;
    try {
      assertUniqueOwnership(dup);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LoadChainOwnershipError);
    const msg = (caught as Error).message;
    expect(msg).toContain('sharedKnob');
    expect(msg).toContain('SKILL.md');
    expect(msg).toContain('knowledge');
    expect(msg).toContain('归属不唯一');
  });

  it('同层重复声明同名亦判违规（仍具名）', () => {
    const dup = [field('x', 'fde.md'), field('x', 'fde.md')];
    expect(() => assertUniqueOwnership(dup)).toThrow(/归属不唯一.*x/s);
  });

  it('归属层名不在四层内 ⇒ 拒绝', () => {
    const bad = [field('y', 'SKILL.md'), field('z', 'bogus' as LoadChainField['layer'])];
    expect(() => assertUniqueOwnership(bad)).toThrow(/归属层非法/);
  });
});

describe('② 未登记拒绝（实现引用未登记字段 ⇒ 拒绝并具名）', () => {
  it('引用了未登记字段 ⇒ 抛 LoadChainUnregisteredFieldError 并点名', () => {
    let caught: unknown;
    try {
      assertAllRegistered(['skillDir', 'phantomKnob', 'fdeFileName']);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LoadChainUnregisteredFieldError);
    expect((caught as Error).message).toContain('phantomKnob');
    // 已登记字段不得被误报
    expect((caught as Error).message).not.toContain('skillDir');
  });

  it('引用集全在登记表内 ⇒ 放行', () => {
    const registered = LOAD_CHAIN_CONFIG_FIELDS.map((f) => f.key);
    expect(() => assertAllRegistered(registered)).not.toThrow();
  });

  it('resolveOwner 对未登记字段抛出', () => {
    expect(() => resolveOwner('nope')).toThrow(LoadChainUnregisteredFieldError);
    expect(resolveOwner('thinkFileName')).toBe('think.md');
  });
});

describe('③ 越界具名（配置值写入非本层字段 ⇒ 拒绝并具名）', () => {
  it('向 fde.md 写 knowledge 字段 ⇒ 抛 LoadChainBoundaryError 并点名字段 + 实际归属 + 越界层', () => {
    let caught: unknown;
    try {
      assertLayerWrite('fde.md', 'knowledgeHotEntries');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LoadChainBoundaryError);
    const msg = (caught as Error).message;
    expect(msg).toContain('knowledgeHotEntries');
    expect(msg).toContain('knowledge'); // 实际归属层
    expect(msg).toContain('fde.md'); // 越界写入层
    expect(msg).toContain('越界写入');
  });

  it('写本层字段 ⇒ 放行', () => {
    expect(() => assertLayerWrite('knowledge', 'knowledgeHotEntries')).not.toThrow();
    expect(() => assertLayerWrite('SKILL.md', 'skillDir')).not.toThrow();
  });

  it('写未登记字段 ⇒ 走未登记拒绝（越界与未登记可区分）', () => {
    expect(() => assertLayerWrite('SKILL.md', 'ghost')).toThrow(LoadChainUnregisteredFieldError);
  });

  it('buildLayerConfig 对本层字段放行、对越界字段拒绝', () => {
    expect(buildLayerConfig('fde.md', { fdeFileName: 'custom-fde.md' })).toEqual({
      fdeFileName: 'custom-fde.md',
    });
    expect(() => buildLayerConfig('fde.md', { knowledgeIndexMaxEntries: 9 })).toThrow(
      LoadChainBoundaryError,
    );
  });
});

describe('env 装载按 schema 归属路由', () => {
  it('SOFAGENT_HOME 归 SKILL.md / SOFAGENT_DATA 归 think.md', () => {
    const loaded = loadChainConfigFromEnv({
      SOFAGENT_HOME: '/tmp/home',
      SOFAGENT_DATA: '/tmp/data',
      SOFAGENT_CONTEXT_WINDOW_TOKENS: '128000',
    });
    expect(loaded['SOFAGENT_HOME']).toEqual({ layer: 'SKILL.md', value: '/tmp/home' });
    expect(loaded['SOFAGENT_DATA']).toEqual({ layer: 'think.md', value: '/tmp/data' });
    expect(loaded['SOFAGENT_CONTEXT_WINDOW_TOKENS']).toEqual({ layer: 'SKILL.md', value: 128000 });
  });

  it('非法数值按缺省处理（不落非法值）', () => {
    const loaded = loadChainConfigFromEnv({ SOFAGENT_CONTEXT_WINDOW_TOKENS: 'not-a-number' });
    expect(loaded['SOFAGENT_CONTEXT_WINDOW_TOKENS']).toBeUndefined();
  });
});
