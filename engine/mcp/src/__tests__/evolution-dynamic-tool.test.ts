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

  it('静态计数口径铁律：TOOLS 静态数=103（tool-registry 顶层 name）+ 1 动态（evolution-dynamic-bridge 运行时注册）= 108，L4 注册后静态数不变（动态面独立计数）', () => {
    // 前置锚：静态数=103（v1.4.7 G14 84→88 + G2 89 + 章八 90 + G13 93 + G4 94 + 章十三 95 + v1.4.9 G9 设备注册面 97 + G10/G11 数据面 99 + G5b/G1 连接器与模板 103 + 批 5 router_session_push 104 + v1.5.0 章八 trace_reconcile 105 + v1.5.2 章一/章二 audit_query/ruleset_export 107；2026-09-26 浏览器四件套退役 -4 → 103；tool-registry TOOLS 顶层 name）
    // + 1 动态（evolution-dynamic-bridge 运行时注册）= 108
    // ——该断言是「不进静态计数」验收口径的本体（check-version 只数
    // tool-registry.ts 顶层 name，动态面不在其守卫面）。
    expect(TOOLS.length).toBe(103);

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
    // 静态面不变；动态面 +1；tools/list 语义 = 103 + 1（浏览器四件套退役后静态基线 103）
    expect(TOOLS.length).toBe(103);
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
