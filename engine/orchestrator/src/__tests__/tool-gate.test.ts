// ============================================================
// TDD_PRE_CODE: 此测试文件在功能代码编写之前创建
// 预期：v1.2.9 目标行为相关断言当前 FAIL。工程师编写/补全功能代码后应全部 PASS。
// 工程师铁律：严禁修改此测试文件中的任何断言和测试用例。
//
// tool-gate.test.ts · ToolGate 运行时接入验证（v1.2.9 · P0）
//
// 🔴 TDD Red 状态说明：
//   v1.2.9 已交付 wrapToolsWithGate() 单元行为（FAIL/WARN/PASS 三分支），
//   但 nodes.ts 运行时接入尚未达到 v1.2.9 验收标准
//   （changelog v1.2.1 要求 nodes.ts 内 grep wrapToolsWithGate ≥4 处命中，
//    当前仅 3 处：import × 1 + engineer × 1 + reviewer × 1）。
//   因此本文件预期：单测用例大部分 PASS，运行时接线用例 FAIL——
//   工程师完成 v1.2.1 接线后应全部转绿。
//
// 被测契约（来自 changelog v1.2.1 设计表 + tools.ts 导出签名）：
//   wrapToolsWithGate(tools: ExecutableTool[], gate): ExecutableTool[]
//   gate = (toolName, args) => { allowed: boolean; reason?: string }
//     FAIL（allowed=false）→ 不执行原 func，返回 ⛔ 拦截信息字符串
//     WARN（allowed=true 且带 reason）→ 执行 func，返回值前拼 ⚠️ 警告
//     PASS（allowed=true 且无 reason）→ 正常执行，原样返回
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  wrapToolsWithGate,
  createToolGate,
  ENGINEER_TOOLS,
  type ExecutableTool,
} from '../tools';

// ════════════════════════════════════════
// Helper — 构造假工具与假 gate
// ════════════════════════════════════════

/** 构造一个最小 ExecutableTool（DeepAgents 风格：name/description/schema/func） */
function makeFakeTool(name: string, funcResult = 'ok'): ExecutableTool {
  return {
    name,
    description: `fake ${name} tool for gate test`,
    schema: { type: 'object', properties: {} },
    func: () => funcResult,
  };
}

/** gate 函数类型（与 createToolGate 返回值签名一致） */
type GateFn = (
  toolName: string,
  args: Record<string, unknown>,
) => { allowed: boolean; reason?: string };

/** 永远 FAIL 的 gate */
const failGate: GateFn = () => ({ allowed: false, reason: '[test-rule] 测试拦截原因' });
/** 永远 WARN 的 gate */
const warnGate: GateFn = () => ({ allowed: true, reason: '[test-rule] 测试告警原因' });
/** 永远 PASS 的 gate */
const passGate: GateFn = () => ({ allowed: true });

// ════════════════════════════════════════
// Tests
// ════════════════════════════════════════

describe('ToolGate · wrapToolsWithGate 拦截语义（v1.2.1 P0）', () => {
  // ────────────────────────────────────────
  // 用例 1 · gate FAIL 拦截
  // ────────────────────────────────────────

  // 测试：gate 判定 FAIL 时，tool 的原 func 不得执行，返回值是拦截信息字符串。
  // 输入：func 带 spy 的假工具 + failGate → 预期：func 调用次数为 0，返回值为含 ⛔ 的拦截串。
  // 边界：这是硬拦截的核心语义——被拦工具绝不能产生副作用。
  it('testWrapToolsWithGate_gateFail_funcNotExecuted_returnsInterceptMessage', () => {
    let callCount = 0;
    const tool: ExecutableTool = {
      ...makeFakeTool('sf_write'),
      func: () => {
        callCount += 1;
        return 'should-never-happen';
      },
    };

    const [wrapped] = wrapToolsWithGate([tool], failGate);
    const result = wrapped.func({ path: 'x.ts', content: 'y' });

    // 原 func 零调用——FAIL 时禁止执行
    expect(callCount).toBe(0);
    // 返回拦截信息字符串（⛔ + ToolGate 拦截标识）
    expect(typeof result).toBe('string');
    expect(result).toContain('⛔');
    expect(result).toMatch(/ToolGate 拦截/);
  });

  // 测试：FAIL 拦截信息必须携带被拦工具名与拦截原因，让 Agent 能读懂"谁被拦、为什么"。
  // 输入：工具名 sf_edit + failGate(reason='[test-rule] 测试拦截原因')
  // 预期：返回串同时包含 'sf_edit' 与 '测试拦截原因'。
  it('testWrapToolsWithGate_gateFail_messageContainsToolNameAndReason', () => {
    const [wrapped] = wrapToolsWithGate([makeFakeTool('sf_edit')], failGate);
    const result = wrapped.func({ path: 'a.ts' });

    expect(result).toContain('sf_edit');
    expect(result).toContain('测试拦截原因');
  });

  // ────────────────────────────────────────
  // 用例 2 · gate WARN 放行但加警告前缀
  // ────────────────────────────────────────

  // 测试：gate 判定 WARN 时，tool 的原 func 照常执行，但返回值前面拼接 ⚠️ 警告前缀。
  // 输入：func 返回 'edit-ok' 的假工具 + warnGate → 预期：func 被调用 1 次，
  //       返回值以 ⚠️ 开头、包含告警原因，且原始结果 'edit-ok' 仍在尾部。
  // 边界：WARN 是"放行 + 留痕"语义——结果必须可达，警告必须前置（Agent 先看到警告再看到结果）。
  it('testWrapToolsWithGate_gateWarn_funcExecuted_resultHasWarnPrefix', () => {
    let callCount = 0;
    const tool: ExecutableTool = {
      ...makeFakeTool('sf_edit'),
      func: () => {
        callCount += 1;
        return 'edit-ok';
      },
    };

    const [wrapped] = wrapToolsWithGate([tool], warnGate);
    const result = wrapped.func({ path: 'a.ts' });

    // func 正常执行
    expect(callCount).toBe(1);
    // 警告前缀在前
    expect(result.startsWith('⚠️')).toBe(true);
    expect(result).toContain('测试告警原因');
    // 原始执行结果保留在警告之后
    expect(result).toContain('edit-ok');
    expect(result.indexOf('⚠️')).toBeLessThan(result.indexOf('edit-ok'));
  });

  // ────────────────────────────────────────
  // 用例 3 · gate PASS 正常执行
  // ────────────────────────────────────────

  // 测试：gate 判定 PASS 时，tool 正常执行且返回值原样返回，不添加任何前缀。
  // 输入：func 返回 'read-ok' 的假工具 + passGate → 预期：返回值严格等于 'read-ok'，
  //       不含 ⛔ 也不含 ⚠️。
  it('testWrapToolsWithGate_gatePass_funcExecuted_resultPlain', () => {
    const [wrapped] = wrapToolsWithGate([makeFakeTool('sf_read', 'read-ok')], passGate);
    const result = wrapped.func({ path: 'README.md' });

    expect(result).toBe('read-ok');
    expect(result).not.toContain('⛔');
    expect(result).not.toContain('⚠️');
  });

  // ────────────────────────────────────────
  // 用例 4 · 包装 purity：不改原工具数组
  // ────────────────────────────────────────

  // 测试：wrapToolsWithGate 返回新数组/新工具对象，不污染原数组——
  //       避免同一个 ENGINEER_TOOLS 被多处包装后互相影响（双重包装会导致警告叠加）。
  // 输入：一个假工具数组 → 预期：返回数组不是同一引用，原工具的 func 引用不变。
  it('testWrapToolsWithGate_wrapping_returnsNewArray_originalUntouched', () => {
    const original = makeFakeTool('sf_read');
    const tools = [original];

    const wrapped = wrapToolsWithGate(tools, passGate);

    expect(wrapped).not.toBe(tools);
    expect(wrapped[0]).not.toBe(original);
    // 原工具 func 未被替换
    expect(tools[0].func).toBe(original.func);
    // 包装后 func 是另一个函数
    expect(wrapped[0].func).not.toBe(original.func);
  });

  // ────────────────────────────────────────
  // 用例 5 · 真实 gate 集成：RulesEngine 拦截敏感文件写入
  // ────────────────────────────────────────

  // 测试：用 createToolGate() 创建的真实 gate（接 @sofagent/rules RulesEngine）
  //       包装真实 sf_write 后，向 .env 写入会被规则 tool-sensitive-file 拦截。
  // 输入：sf_write + { path: '<tmp>/.env', content: 'SECRET=1' }（tmp 目录隔离，绝不在仓库内写）
  // 预期：返回 ⛔ 拦截串，且 .env 文件未被创建（func 未执行的物理证据）。
  // 边界：这是 v1.2.1 LUI 感知用例——"custom 写的规则真的生效了"。
  it('testCreateToolGate_realGate_sfWriteDotEnv_blockedAndFileNotCreated', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-gate-it-'));
    try {
      const gate = createToolGate({ agentName: 'engineer', taskDesc: 'qa tdd', cwd: tmpDir });
      const gated = wrapToolsWithGate(ENGINEER_TOOLS, gate);
      const sfWrite = gated.find((t) => t.name === 'sf_write');
      expect(sfWrite).toBeDefined();

      const envPath = path.join(tmpDir, '.env');
      const result = sfWrite!.func({ path: envPath, content: 'SECRET=1' });

      // 规则引擎判定 FAIL → 返回拦截信息
      expect(result).toMatch(/⛔|ToolGate 拦截/);
      // func 未执行的物理证据：.env 文件不存在
      expect(fs.existsSync(envPath)).toBe(false);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
    }
  });

  // 测试：真实 gate 对正常文件写入放行——确保 gate 不误伤合法操作。
  // 输入：sf_write + { path: '<tmp>/hello.txt', content: 'hi' } → 预期：写入成功，文件落盘。
  it('testCreateToolGate_realGate_sfWriteNormalFile_allowedAndFileCreated', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-gate-it-'));
    try {
      const gate = createToolGate({ agentName: 'engineer', taskDesc: 'qa tdd', cwd: tmpDir });
      const gated = wrapToolsWithGate(ENGINEER_TOOLS, gate);
      const sfWrite = gated.find((t) => t.name === 'sf_write');
      expect(sfWrite).toBeDefined();

      const filePath = path.join(tmpDir, 'hello.txt');
      const result = sfWrite!.func({ path: filePath, content: 'hi' });

      // 未被拦截（无 ⛔），文件真实落盘
      expect(result).not.toContain('⛔');
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('hi');
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
    }
  });
});

// ════════════════════════════════════════
// 运行时接线验证（v1.2.1 半闭环修复的核心验收）
// v1.4.8 深模块条目 4：gate 接线从 loop/nodes.ts 收编到
//   loop/middleware-registry.ts（公共接线入口 gateToolsForRole）
//   + loop/agent-runner.ts（engineer/reviewer 两角色执行骨架各自接线）
// 断言强度不变，仅跟随符号落点更新扫描目标。
// ════════════════════════════════════════

describe('ToolGate · LOOP gate 运行时接线（v1.2.1 验收标准）', () => {
  const wiringSources = ['middleware-registry.ts', 'agent-runner.ts']
    .map((f) => fs.readFileSync(path.resolve(__dirname, '..', 'loop', f), 'utf-8'))
    .join('\n');

  // 测试：engineer + reviewer 两个 LOOP 角色都必须接入 gate——
  //       静态验证接线源中 wrapToolsWithGate 出现 ≥4 次。
  // 依据：changelog v1.2.1 质量验证表——"grep wrapToolsWithGate 在接线源有 4 处命中"
  //       （每个接线位点：import × 1 + 调用 + 接线模式注释）。
  it('testLoopGateWiring_wrapToolsWithGate_atLeast4Hits', () => {
    const hits = wiringSources.match(/wrapToolsWithGate/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(4);
  });

  // 测试：engineer 与 reviewer 各自创建独立 gate——
  //       静态验证接线源中 createToolGate 至少被调用 2 次（每角色一个 gate 实例）。
  // 依据：changelog v1.2.1 修复表——"defaultRunEngineer + defaultRunReviewer 均调用
  //       createToolGate() 创建 gate → wrapToolsWithGate() 包装工具集"。
  it('testLoopGateWiring_createToolGate_calledAtLeastTwice', () => {
    const hits = wiringSources.match(/createToolGate\(/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });
});

// ════════════════════════════════════════
// v1.4.8 第二章：app_tool_policy 策略维度（双实现同步——sandbox 中介版 + tools.ts 规则接线版）
// ════════════════════════════════════════

import { createToolGate as createSandboxGate } from '../sandbox/tool-gate';

describe('ToolGate · app_tool_policy（v1.4.8 第二章 · sandbox 中介版）', () => {
  const APP_POLICY = {
    apps: {
      'clawhub-plugin-a': ['run_audit', 'get_think'],
    },
  };

  it('策略声明的 app×tool → allow，事件带 appName + policySource', () => {
    const gate = createSandboxGate({ appToolPolicy: APP_POLICY });
    const id = gate.register('run_audit', 'low');
    const v = gate.check(id, 'clawhub-plugin-a');
    expect(v.action).toBe('allow');
    const ev = gate.exportEvents().find((e) => e.toolName === 'run_audit');
    expect(ev?.appName).toBe('clawhub-plugin-a');
    expect(ev?.policySource).toBe('app_tool_policy');
  });

  it('策略外的 tool（app 声明但 tool 未列）→ deny，reason 可追溯', () => {
    const gate = createSandboxGate({ appToolPolicy: APP_POLICY });
    const id = gate.register('write_think', 'low'); // low 风险本会 allow——策略优先拦截
    const v = gate.check(id, 'clawhub-plugin-a');
    expect(v.action).toBe('deny');
    if (v.action === 'deny') expect(v.reason).toContain('未声明调用 tool「write_think」');
  });

  it('未声明的 app → deny（fail-closed）', () => {
    const gate = createSandboxGate({ appToolPolicy: APP_POLICY });
    const id = gate.register('run_audit', 'low');
    const v = gate.check(id, 'unknown-app');
    expect(v.action).toBe('deny');
    if (v.action === 'deny') expect(v.reason).toContain('未在 app_tool_policy 中声明');
  });

  it('配置策略但调用未声明 app → deny（fail-closed 拒无归属调用）', () => {
    const gate = createSandboxGate({ appToolPolicy: APP_POLICY });
    const id = gate.register('run_audit', 'low');
    const v = gate.check(id); // 不带 appName
    expect(v.action).toBe('deny');
  });

  it('未配置 appToolPolicy（单机默认）→ 行为与现版一致', () => {
    const gate = createSandboxGate(); // 无策略
    const id = gate.register('run_audit', 'low');
    expect(gate.check(id).action).toBe('allow');
    expect(gate.check(id, 'any-app').action).toBe('allow');
    // 无归属事件不带 appName 字段
    const ev = gate.exportEvents()[0]!;
    expect(ev.appName).toBeUndefined();
  });
});

describe('ToolGate · app_tool_policy（v1.4.8 第二章 · tools.ts 规则接线版）', () => {
  const APP_POLICY = {
    apps: {
      'clawhub-plugin-a': ['sf_read'],
    },
  };

  it('策略声明 tool → 规则引擎照常判定（allow 路径）', () => {
    const gate = createToolGate({ appToolPolicy: APP_POLICY, appName: 'clawhub-plugin-a' });
    const v = gate('sf_read', { path: '/tmp/any.txt' });
    expect(v.allowed).toBe(true);
  });

  it('策略外 tool → deny，reason 带 app+tool+策略来源', () => {
    const gate = createToolGate({ appToolPolicy: APP_POLICY, appName: 'clawhub-plugin-a' });
    const v = gate('sf_write', { path: '/tmp/x.txt', content: 'y' });
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain('[app_tool_policy]');
    expect(v.reason).toContain('clawhub-plugin-a');
    expect(v.reason).toContain('sf_write');
  });

  it('未声明 app → deny（fail-closed）', () => {
    const gate = createToolGate({ appToolPolicy: APP_POLICY, appName: 'unknown-app' });
    const v = gate('sf_read', { path: '/tmp/a' });
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain('未在策略中声明');
  });

  it('未配置 appToolPolicy → 行为与现版一致', () => {
    const gate = createToolGate(); // 无策略
    expect(gate('sf_read', { path: '/tmp/a' }).allowed).toBe(true);
  });
});
