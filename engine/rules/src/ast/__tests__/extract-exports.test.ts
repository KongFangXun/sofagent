// ============================================================
// extract-exports.test.ts · API 语义解析复用测试（v1.3.9 四）
// AST 引擎提取 export 符号——public API 门禁（tools/check/public-api.mjs）复用
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AstRuleEngine } from '../engine';

let engine: AstRuleEngine;

beforeAll(() => {
  engine = new AstRuleEngine();
});

afterAll(() => {
  engine.close();
});

describe('extractExports · export 符号提取', () => {
  it('export {} 块：具名导出 + type 导出 + as 重命名', () => {
    const src = [
      "export { a, b } from './x';",
      "export type { T1, T2 } from './types';",
      "export { localName as exportedName } from './y';",
    ].join('\n');
    const syms = engine.extractExports('index.ts', src);
    expect(syms.map((s) => s.name).sort()).toEqual(['T1', 'T2', 'a', 'b', 'exportedName']);
  });

  it('声明式导出：const / function / class / type / interface', () => {
    const src = [
      'export const foo = 1;',
      'export function bar() {}',
      'export class Baz {}',
      'export type Q = number;',
      'export interface IQux {}',
    ].join('\n');
    const syms = engine.extractExports('index.ts', src);
    expect(syms.map((s) => s.name).sort()).toEqual(['Baz', 'IQux', 'Q', 'bar', 'foo']);
  });

  it('export default / export * 形态', () => {
    const src = [
      "export * from './star';",
      'export default 42;',
    ].join('\n');
    const syms = engine.extractExports('index.ts', src);
    expect(syms.map((s) => s.name)).toEqual(['*', 'default']);
  });

  it('行号对齐（1-based）——供 @public/@internal 分级标记定位', () => {
    const src = [
      '// line 1 comment',
      '',
      'export const first = 1;',
      'export const second = 2;',
    ].join('\n');
    const syms = engine.extractExports('index.ts', src);
    expect(syms.find((s) => s.name === 'first')?.line).toBe(3);
    expect(syms.find((s) => s.name === 'second')?.line).toBe(4);
  });

  it('本仓库真实入口：rules index 提取出全部公开符号', () => {
    const src = [
      "/* @public */ export { RulesEngine } from './engine';",
      "/* @public */ export type { ToolRule } from './types';",
      '/* @internal */ export const _hidden = 1;',
    ].join('\n');
    const syms = engine.extractExports('index.ts', src);
    // 提取器不管 tier（那是门禁脚本的职责）——三个符号都出来
    expect(syms.map((s) => s.name).sort()).toEqual(['RulesEngine', 'ToolRule', '_hidden']);
  });

  it('多文件连续调用互不串扰（TS7 同路径缓存回归）', () => {
    const a = engine.extractExports('a.ts', 'export const fromA = 1;');
    const b = engine.extractExports('b.ts', 'export const fromB1 = 1;\nexport const fromB2 = 2;');
    const c = engine.extractExports('c.ts', 'export const fromC = 1;');
    expect(a.map((s) => s.name)).toEqual(['fromA']);
    expect(b.map((s) => s.name)).toEqual(['fromB1', 'fromB2']);
    expect(c.map((s) => s.name)).toEqual(['fromC']);
  });
});
