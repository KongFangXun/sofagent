// ============================================================
// evolution-dynamic-tool.test.ts · L4 进化工具 MCP 动态面测试
// （v1.4.5 第七章三）
//
// 验收覆盖：
//   一、注册桥：registerEvolvedTools 把台账注册态候选注册进动态面
//       （getDynamicTools 面——默认空，运行时注册）
//   二、🔴 静态计数口径断言：L4 注册**不改变** tool-registry.ts 的
//       TOOLS 静态计数（83——check-version 只数顶层 name）；动态面
//       独立计数；tools/list 语义 = 静态 83 + 动态注册数
//   三、commons_invoke 可调：capability_id 命中 L4 动态工具时走
//       动态桥分发（真实生成器执行）
//   四、缺省语义：无注册态候选 → 注册零个（动态面默认空）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import { TOOLS } from '../tool-registry';
import { getDynamicTools, clearDynamicTools, getDynamicTool } from '../tools/memory-backend';
import { registerEvolvedTools, invokeEvolvedTool, resetEvolvedTools } from '../tools/evolution-dynamic-bridge';
import { commonsInvoke } from '../tools/commons-invoke';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), `l4-mcp-${Date.now()}-${randomBytes(4).toString('hex')}`));
}

/** 写一个可 require 的生成器模块（.mjs 动态写入——真实执行面） */
function writeGenerator(base: string, name: string): string {
  const dir = join(base, 'gens');
  if (!mkdirSync(dir, { recursive: true })) { /* mkdirSync 递归已建 */ }
  const file = join(dir, `${name}.cjs`);
  writeFileSync(
    file,
    `module.exports.default = async function (input) { return { echoed: input, by: '${name}' }; };\n`,
  );
  return file;
}

/** 加载生成器（生产形态的 loadGenerator——require 直载） */
const prodLoadGenerator = (modulePath: string): unknown => require(modulePath);

describe('L4 进化工具 MCP 动态面（第七章三）', () => {
  let base: string;

  beforeEach(() => {
    base = tmpDir();
    clearDynamicTools();
  });

  afterEach(() => {
    try { rmSync(base, { recursive: true, force: true }); } catch { /* */ }
    clearDynamicTools();
  });

  it('静态计数口径铁律：TOOLS 静态数=83 且 L4 注册后不变（动态面独立计数）', () => {
    // 前置锚：当前静态面恰为 83（本版 +train_serve/train_compliance/train_deliverable）
    // ——该断言是「不进 83 静态计数」验收口径的本体（check-version 只数
    // tool-registry.ts 顶层 name，动态面不在其守卫面）。
    expect(TOOLS.length).toBe(83);

    const generator = writeGenerator(base, 'regen_report');
    const registered = registerEvolvedTools({
      getTools: () => [
        {
          name: 'regen_report',
          description: '按模板重生成周报',
          inputSchema: { type: 'object', properties: {} },
          generatorModule: generator,
          generatorExport: 'default',
          candidateId: 'l4-regenreport',
        },
      ],
      loadGenerator: prodLoadGenerator,
    });

    expect(registered).toEqual(['regen_report']);
    // 静态面不变；动态面 +1；tools/list 语义 = 83 + 1
    expect(TOOLS.length).toBe(83);
    expect(getDynamicTools().length).toBe(1);
  });

  it('注册桥 + commons_invoke 可调：动态面命中 → 生成器真实执行', async () => {
    const generator = writeGenerator(base, 'regen_report');
    registerEvolvedTools({
      getTools: () => [
        {
          name: 'regen_report',
          description: '按模板重生成周报',
          inputSchema: { type: 'object', properties: {} },
          generatorModule: generator,
          generatorExport: 'default',
          candidateId: 'l4-regenreport',
        },
      ],
      loadGenerator: prodLoadGenerator,
    });

    // commons_invoke 命中动态面 → 动态桥分发（L4 验收：注册的工具可被 commons_invoke 调用）
    const result = await commonsInvoke({
      capability_id: 'regen_report',
      caller_agent_id: 'caller-001',
      input: { week: 37 },
    });
    expect(result.isError).toBeFalsy();
    expect(result.data.ok).toBe(true);
    expect(result.data.outcome).toBe('success');
    expect(result.data.output).toEqual({ echoed: { week: 37 }, by: 'regen_report' });
  });

  it('invokeEvolvedTool 出口：已注册可调 / 未注册明确报错', async () => {
    const generator = writeGenerator(base, 'csv_sanitize');
    registerEvolvedTools({
      getTools: () => [
        {
          name: 'csv_sanitize',
          description: 'CSV 脱敏',
          inputSchema: { type: 'object', properties: {} },
          generatorModule: generator,
          generatorExport: 'default',
          candidateId: 'l4-csvsanitize',
        },
      ],
      loadGenerator: prodLoadGenerator,
    });

    const hit = await invokeEvolvedTool('csv_sanitize', { rows: 10 }, { loadGenerator: prodLoadGenerator });
    expect(hit.ok).toBe(true);
    expect(hit.output).toEqual({ echoed: { rows: 10 }, by: 'csv_sanitize' });

    const miss = await invokeEvolvedTool('ghost_tool', {}, { loadGenerator: prodLoadGenerator });
    expect(miss.ok).toBe(false);
    expect(miss.error).toContain('未注册');
  });

  it('缺省语义：无注册态候选 → 注册零个（动态面默认空）', () => {
    const registered = registerEvolvedTools({ getTools: () => [], loadGenerator: prodLoadGenerator });
    expect(registered).toEqual([]);
    expect(getDynamicTools()).toEqual([]);
    expect(getDynamicTool('anything')).toBeUndefined();
  });

  it('resetEvolvedTools 清空动态面（测试隔离出口）', () => {
    const generator = writeGenerator(base, 'tmp_tool');
    registerEvolvedTools({
      getTools: () => [
        { name: 'tmp_tool', description: 'd', inputSchema: {}, generatorModule: generator, generatorExport: 'default', candidateId: 'c1' },
      ],
      loadGenerator: prodLoadGenerator,
    });
    expect(getDynamicTools().length).toBe(1);
    resetEvolvedTools();
    expect(getDynamicTools()).toEqual([]);
  });
});
