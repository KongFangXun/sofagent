// ============================================================
// ruleset-loader.test.ts · 规则集加载器 + 插件运行器单测
// v1.2.9 (⑧-2)
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { DiffFile } from '@sofagent/core';
import {
  validateRuleset,
  loadRulesetFile,
  loadRuleset,
  loadRulesetFromPath,
  listBuiltinRulesetNames,
  listLocalRulesetNames,
  listAvailableRulesets,
  runPatternRule,
  runRulesetRules,
  computeExitCode,
  formatRulesetList,
  RulesetLoadError,
  RulesetValidationError,
  type Ruleset,
  type RulesetRule,
} from './ruleset-loader';
import {
  loadPlugin,
  validatePluginResults,
  runPluginRule,
  _setModuleLoader,
  _resetModuleLoader,
  type PluginResult,
} from './plugin-runner';

// ============================================================
// 测试辅助——构造 DiffFile
// ============================================================

function makeDiffFile(
  path: string,
  lines: string[],
  status: 'added' | 'modified' | 'deleted' | 'renamed' = 'modified'
): DiffFile {
  return { path, status, lines };
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

// ============================================================
// validateRuleset
// ============================================================

describe('validateRuleset', () => {
  it('合法规则集通过校验', () => {
    const valid = {
      name: 'test',
      version: '1.0.0',
      rules: [
        { id: 'r1', name: '规则1', severity: 'FAIL', type: 'pattern', pattern: 'secret' },
        { id: 'r2', name: '规则2', severity: 'WARN', type: 'plugin', plugin: '@scope/pkg' },
      ],
    };
    expect(() => validateRuleset(valid)).not.toThrow();
  });

  it('缺少 name 时抛错', () => {
    expect(() => validateRuleset({ version: '1.0', rules: [] })).toThrow(RulesetValidationError);
  });

  it('rules 非数组时抛错', () => {
    expect(() => validateRuleset({ name: 'x', version: '1', rules: 'not-array' })).toThrow(RulesetValidationError);
  });

  it('规则缺少 id 时抛错', () => {
    expect(() => validateRuleset({
      name: 'x', version: '1', rules: [{ name: 'r', severity: 'FAIL', type: 'pattern', pattern: 'x' }],
    })).toThrow(RulesetValidationError);
  });

  it('pattern 类型缺少 pattern 时抛错', () => {
    expect(() => validateRuleset({
      name: 'x', version: '1', rules: [{ id: 'r1', name: 'r', severity: 'FAIL', type: 'pattern' }],
    })).toThrow(RulesetValidationError);
  });

  it('plugin 类型缺少 plugin 时抛错', () => {
    expect(() => validateRuleset({
      name: 'x', version: '1', rules: [{ id: 'r1', name: 'r', severity: 'FAIL', type: 'plugin' }],
    })).toThrow(RulesetValidationError);
  });

  it('severity 值非法时抛错', () => {
    expect(() => validateRuleset({
      name: 'x', version: '1', rules: [{ id: 'r1', name: 'r', severity: 'ERROR', type: 'pattern', pattern: 'x' }],
    })).toThrow(RulesetValidationError);
  });
});

// ============================================================
// loadRulesetFile
// ============================================================

describe('loadRulesetFile', () => {
  const tmpDir = join(tmpdir(), `sofagent-test-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
  });

  it('加载合法 JSON 规则集文件', () => {
    const filePath = join(tmpDir, 'test.json');
    writeFileSync(filePath, JSON.stringify({
      name: 'test',
      version: '1.0.0',
      description: '测试规则集',
      rules: [
        { id: 'r1', name: '规则1', severity: 'FAIL', type: 'pattern', pattern: 'secret' },
      ],
    }));

    const rs = loadRulesetFile(filePath);
    expect(rs.name).toBe('test');
    expect(rs.rules).toHaveLength(1);
    expect(rs.description).toBe('测试规则集');
  });

  it('文件不存在时抛 RulesetLoadError', () => {
    expect(() => loadRulesetFile(join(tmpDir, 'nonexistent.json'))).toThrow(RulesetLoadError);
  });

  it('JSON 格式错误时抛 RulesetValidationError', () => {
    const filePath = join(tmpDir, 'bad.json');
    writeFileSync(filePath, '{ invalid json }');
    expect(() => loadRulesetFile(filePath)).toThrow(RulesetValidationError);
  });
});

// ============================================================
// loadRulesetFromPath
// ============================================================

describe('loadRulesetFromPath', () => {
  const tmpDir = join(tmpdir(), `sofagent-test-path-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
  });

  it('优先加载 index.json', () => {
    writeFileSync(join(tmpDir, 'index.json'), JSON.stringify({
      name: 'index-rs', version: '1.0', rules: [],
    }));
    writeFileSync(join(tmpDir, 'other.json'), JSON.stringify({
      name: 'other-rs', version: '1.0', rules: [],
    }));

    const rs = loadRulesetFromPath(tmpDir);
    expect(rs.name).toBe('index-rs');
  });

  it('无 index.json 时加载第一个 .json', () => {
    writeFileSync(join(tmpDir, 'alpha.json'), JSON.stringify({
      name: 'alpha-rs', version: '1.0', rules: [],
    }));

    const rs = loadRulesetFromPath(tmpDir);
    expect(rs.name).toBe('alpha-rs');
  });

  it('指定 name 时加载对应文件', () => {
    writeFileSync(join(tmpDir, 'custom.json'), JSON.stringify({
      name: 'custom-rs', version: '1.0', rules: [],
    }));

    const rs = loadRulesetFromPath(tmpDir, 'custom');
    expect(rs.name).toBe('custom-rs');
  });

  it('空目录时抛错', () => {
    expect(() => loadRulesetFromPath(tmpDir)).toThrow(RulesetLoadError);
  });

  it('目录不存在时抛错', () => {
    expect(() => loadRulesetFromPath(join(tmpDir, 'no-exist'))).toThrow(RulesetLoadError);
  });
});

// ============================================================
// listBuiltinRulesetNames / listAvailableRulesets
// ============================================================

describe('listBuiltinRulesetNames', () => {
  it('返回内置规则集名称数组', () => {
    const names = listBuiltinRulesetNames();
    expect(names).toContain('sofagent');
    expect(names).toContain('security');
  });
});

describe('listAvailableRulesets', () => {
  it('包含内置规则集', () => {
    const infos = listAvailableRulesets();
    const names = infos.map((i) => i.name);
    expect(names).toContain('sofagent');
    expect(names).toContain('security');
  });

  it('包含本地规则集（如有）', () => {
    const tmpDir = join(tmpdir(), `sofagent-list-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'my-rs.json'), JSON.stringify({
      name: 'my-rs', version: '1.0', description: '自定义', rules: [],
    }));

    const infos = listAvailableRulesets(tmpDir);
    const localRs = infos.find((i) => i.name === 'my-rs' && i.source === 'local');
    expect(localRs).toBeDefined();
    expect(localRs?.description).toBe('自定义');

    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
  });
});

// ============================================================
// loadRuleset（内置）
// ============================================================

describe('loadRuleset (builtin)', () => {
  it('加载 sofagent 内置规则集', () => {
    const rs = loadRuleset('sofagent');
    expect(rs.name).toBe('sofagent');
    expect(rs.rules.length).toBeGreaterThanOrEqual(10);
  });

  it('加载 security 内置规则集', () => {
    const rs = loadRuleset('security');
    expect(rs.name).toBe('security');
    expect(rs.rules.length).toBeGreaterThanOrEqual(5);
  });

  it('不存在的规则集名时抛错', () => {
    expect(() => loadRuleset('nonexistent-xyz')).toThrow(RulesetLoadError);
  });
});

// ============================================================
// runPatternRule
// ============================================================

describe('runPatternRule', () => {
  it('命中 pattern 时返回 FAIL/WARN', () => {
    const rule = makePatternRule({
      pattern: 'password',
      severity: 'FAIL',
    });
    const files = [
      makeDiffFile('src/config.ts', [
        '+const password = "secret123"',
        '+const x = 1',
      ]),
    ];

    const result = runPatternRule(rule, files);
    expect(result.status).toBe('FAIL');
    expect(result.details.length).toBe(1);
    expect(result.details[0]).toContain('src/config.ts');
    expect(result.details[0]).toContain('password');
  });

  it('未命中时返回 PASS', () => {
    const rule = makePatternRule({ pattern: 'nonexistent_pattern_xyz' });
    const files = [makeDiffFile('src/app.ts', ['+const x = 1'])];

    const result = runPatternRule(rule, files);
    expect(result.status).toBe('PASS');
    expect(result.details).toHaveLength(0);
  });

  it('filePattern 过滤——只匹配指定文件', () => {
    const rule = makePatternRule({
      pattern: 'TODO',
      filePattern: '\\.ts$',
    });
    const files = [
      makeDiffFile('src/app.ts', ['+// TODO: fix this']),
      makeDiffFile('src/app.js', ['+// TODO: fix this']),
    ];

    const result = runPatternRule(rule, files);
    expect(result.status).toBe('FAIL');
    expect(result.details).toHaveLength(1);
    expect(result.details[0]).toContain('app.ts');
    expect(result.details[0]).not.toContain('app.js');
  });

  it('不检查删除行（- 开头）', () => {
    const rule = makePatternRule({ pattern: 'password' });
    const files = [
      makeDiffFile('src/config.ts', [
        '-const password = "old"',
        '+const config = {}',
      ]),
    ];

    const result = runPatternRule(rule, files);
    expect(result.status).toBe('PASS');
  });

  it('不检查 +++ 文件头行', () => {
    const rule = makePatternRule({ pattern: 'config' });
    const files = [
      makeDiffFile('src/config.ts', [
        '+++ b/src/config.ts',
        '+const x = 1',
      ]),
    ];

    const result = runPatternRule(rule, files);
    expect(result.status).toBe('PASS');
  });

  it('message 模板支持 {match} 占位符', () => {
    const awsPrefix = 'AKIA';
    const awsKey = awsPrefix + 'IOSFODNN7EXAMPLE';
    const rule = makePatternRule({
      pattern: awsPrefix + '[A-Z0-9]{16}',
      message: '检测到 AWS 密钥: {match}',
    });
    const files = [
      makeDiffFile('src/aws.ts', ['+const key = "' + awsKey + '"']),
    ];

    const result = runPatternRule(rule, files);
    expect(result.status).toBe('FAIL');
    expect(result.details[0]).toContain(awsKey);
  });

  it('无效正则返回 WARN', () => {
    const rule = makePatternRule({ pattern: '[' });
    const files = [makeDiffFile('src/app.ts', ['+hello'])];

    const result = runPatternRule(rule, files);
    expect(result.status).toBe('WARN');
    expect(result.details[0]).toContain('正则无效');
  });

  it('多文件多命中收集所有', () => {
    const rule = makePatternRule({ pattern: 'TODO', severity: 'WARN' });
    const files = [
      makeDiffFile('a.ts', ['+// TODO: a']),
      makeDiffFile('b.ts', ['+// TODO: b', '+// TODO: c']),
    ];

    const result = runPatternRule(rule, files);
    expect(result.status).toBe('WARN');
    expect(result.details).toHaveLength(3);
  });
});

// ============================================================
// runRulesetRules（集成 pattern + plugin）
// ============================================================

describe('runRulesetRules', () => {
  it('执行纯 pattern 规则集', () => {
    const ruleset: Ruleset = {
      name: 'test',
      version: '1.0.0',
      rules: [
        { id: 'r1', name: 'TODO 检测', severity: 'WARN', type: 'pattern', pattern: 'TODO' },
        { id: 'r2', name: '密钥检测', severity: 'FAIL', type: 'pattern', pattern: 'password' },
      ],
    };
    const files = [
      makeDiffFile('a.ts', ['+// TODO: fix', '+const password = "x"']),
    ];

    const results = runRulesetRules(files, ruleset);
    expect(results).toHaveLength(2);
    expect(results[0]!.status).toBe('WARN');
    expect(results[1]!.status).toBe('FAIL');
  });

  it('空规则集返回空数组', () => {
    const ruleset: Ruleset = { name: 'empty', version: '1.0', rules: [] };
    const results = runRulesetRules([], ruleset);
    expect(results).toHaveLength(0);
  });
});

// ============================================================
// computeExitCode
// ============================================================

describe('computeExitCode', () => {
  it('全 PASS → 0', () => {
    expect(computeExitCode([
      { name: 'a', number: 1, status: 'PASS', details: [] },
    ])).toBe(0);
  });

  it('有 WARN 无 FAIL → 1', () => {
    expect(computeExitCode([
      { name: 'a', number: 1, status: 'PASS', details: [] },
      { name: 'b', number: 2, status: 'WARN', details: ['x'] },
    ])).toBe(1);
  });

  it('有 FAIL → 2', () => {
    expect(computeExitCode([
      { name: 'a', number: 1, status: 'WARN', details: ['x'] },
      { name: 'b', number: 2, status: 'FAIL', details: ['y'] },
    ])).toBe(2);
  });

  it('空数组 → 0', () => {
    expect(computeExitCode([])).toBe(0);
  });
});

// ============================================================
// formatRulesetList
// ============================================================

describe('formatRulesetList', () => {
  it('空列表输出提示', () => {
    const out = formatRulesetList([]);
    expect(out).toContain('暂无');
  });

  it('有规则集时输出列表', () => {
    const out = formatRulesetList([
      { name: 'sofagent', source: 'builtin', description: '默认规则集' },
      { name: 'my-rs', source: 'local' },
    ]);
    expect(out).toContain('sofagent');
    expect(out).toContain('[内置]');
    expect(out).toContain('[本地]');
    expect(out).toContain('默认规则集');
  });
});

// ============================================================
// Plugin runner
// ============================================================

describe('validatePluginResults', () => {
  it('过滤无效条目', () => {
    const raw = [
      { file: 'a.ts', message: 'ok' },
      { file: '', message: 'empty file' },          // 无效：空 file
      { message: 'no file' },                        // 无效：无 file
      { file: 'b.ts', message: '' },                 // 无效：空 message
      { file: 'c.ts', message: 'ok', line: 42 },    // 有效：有行号
      { file: 'd.ts', message: 'ok', line: 'bad' }, // 无效：行号非数字
      null,                                           // 无效：null
      'string',                                       // 无效：非对象
    ];

    const valid = validatePluginResults(raw);
    expect(valid).toHaveLength(2);
    expect(valid[0]!.file).toBe('a.ts');
    expect(valid[1]!.file).toBe('c.ts');
    expect(valid[1]!.line).toBe(42);
  });

  it('非数组返回空', () => {
    expect(validatePluginResults(null)).toEqual([]);
    expect(validatePluginResults({})).toEqual([]);
    expect(validatePluginResults('string')).toEqual([]);
  });
});

describe('loadPlugin', () => {
  afterEach(() => {
    _resetModuleLoader();
  });

  it('默认导出函数——正确加载', () => {
    const mockFn = vi.fn(() => []);
    _setModuleLoader(() => mockFn);

    const plugin = loadPlugin('@test/plugin-default-fn');
    expect(plugin).toBe(mockFn);
  });

  it('命名导出 run——正确加载', () => {
    const mockRun = vi.fn(() => []);
    _setModuleLoader(() => ({ run: mockRun }));

    const plugin = loadPlugin('@test/plugin-named-run');
    expect(plugin).toBe(mockRun);
  });

  it('default 导出函数——正确加载', () => {
    const mockDefault = vi.fn(() => []);
    _setModuleLoader(() => ({ default: mockDefault }));

    const plugin = loadPlugin('@test/plugin-default-export');
    expect(plugin).toBe(mockDefault);
  });

  it('导出格式不符时抛错', () => {
    _setModuleLoader(() => ({ notAFunc: 42 }));
    expect(() => loadPlugin('@test/plugin-invalid')).toThrow();
  });

  it('包不存在时抛错', () => {
    _resetModuleLoader(); // 使用真实 require
    expect(() => loadPlugin('@test/nonexistent-package-xyz')).toThrow();
  });
});

describe('runPluginRule', () => {
  afterEach(() => {
    _resetModuleLoader();
  });

  it('插件正常返回结果——转为 details', () => {
    const mockResults: PluginResult[] = [
      { file: 'a.ts', line: 10, message: '发现安全风险' },
      { file: 'b.ts', message: '另一个风险' },
    ];
    _setModuleLoader(() => () => mockResults);

    const result = runPluginRule(
      {
        id: 'p1',
        name: '插件测试',
        plugin: '@test/plugin-ok',
        severity: 'FAIL',
      },
      [makeDiffFile('a.ts', ['+const x = 1'])]
    );

    expect(result.status).toBe('FAIL');
    expect(result.details).toHaveLength(2);
    expect(result.details[0]).toContain('a.ts:10');
    expect(result.details[0]).toContain('发现安全风险');
  });

  it('插件返回空数组——PASS', () => {
    _setModuleLoader(() => () => []);

    const result = runPluginRule(
      { id: 'p1', name: '空插件', plugin: '@test/plugin-empty', severity: 'FAIL' },
      []
    );

    expect(result.status).toBe('PASS');
  });

  it('插件加载失败——降级为 WARN', () => {
    _setModuleLoader(() => {
      throw new Error('module not found');
    });

    const result = runPluginRule(
      { id: 'p1', name: '失败插件', plugin: '@test/nonexistent-xyz-123', severity: 'FAIL' },
      []
    );

    expect(result.status).toBe('WARN');
    expect(result.details[0]).toContain('加载失败');
  });

  it('插件执行异常——降级为 WARN', () => {
    _setModuleLoader(() => () => {
      throw new Error('插件崩溃');
    });

    const result = runPluginRule(
      { id: 'p1', name: '崩溃插件', plugin: '@test/plugin-throws', severity: 'FAIL' },
      []
    );

    expect(result.status).toBe('WARN');
    expect(result.details[0]).toContain('执行异常');
  });

  it('插件返回无效格式——过滤后可能为空', () => {
    _setModuleLoader(() => () => [
      { invalid: true },
      null,
      'string',
    ]);

    const result = runPluginRule(
      { id: 'p1', name: '格式插件', plugin: '@test/plugin-bad-format', severity: 'WARN' },
      []
    );

    expect(result.status).toBe('PASS');
    expect(result.details).toHaveLength(0);
  });

  it('severity=WARN 时命中返回 WARN', () => {
    _setModuleLoader(() => () => [
      { file: 'x.ts', message: '警告级问题' },
    ]);

    const result = runPluginRule(
      { id: 'p1', name: '警告插件', plugin: '@test/plugin-warn', severity: 'WARN' },
      []
    );

    expect(result.status).toBe('WARN');
  });

  it('options 透传给插件', () => {
    const mockFn = vi.fn((_ctx) => []);
    _setModuleLoader(() => mockFn);

    runPluginRule(
      {
        id: 'p1', name: '选项插件', plugin: '@test/plugin-options',
        severity: 'FAIL', options: { threshold: 100 },
      },
      []
    );

    expect(mockFn).toHaveBeenCalledWith(
      expect.objectContaining({ options: { threshold: 100 } })
    );
  });
});
