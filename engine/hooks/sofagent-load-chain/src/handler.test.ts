// ============================================================
// handler.test.ts · sofagent-load-chain handler 基本测试（P1-11）
// ============================================================
// 说明：hooks 包无 package test script（"12 包"SSOT = 有测试的包，hooks 不计入），
// 本测试供 IDE/手动 vitest 运行（npx vitest run engine/hooks/...）。
// 覆盖：
//   1. agent:bootstrap 事件 → 注入 SKILL.md + think.md + fde.md 三层
//   2. 非 bootstrap 事件 → 不注入（幂等跳过）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import handler, { type LoadChainEvent } from './handler';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-loadchain-'));
}

function makeEvent(workspaceRoot: string): LoadChainEvent {
  return {
    type: 'agent',
    action: 'bootstrap',
    workspaceRoot,
    context: { bootstrapFiles: [] },
  };
}

describe('sofagent-load-chain handler', () => {
  let dir: string;
  let savedOpenclaw: string | undefined;
  let savedData: string | undefined;

  beforeEach(() => {
    dir = tmpDir();
    savedOpenclaw = process.env.OPENCLAW_STATE_DIR;
    savedData = process.env.SOFAGENT_DATA;
    process.env.OPENCLAW_STATE_DIR = path.join(dir, '.openclaw');
    process.env.SOFAGENT_DATA = path.join(dir, '.sofagent', 'data');
    // 构造三层素材：SKILL.md + fde.md 在 openclaw skills 目录；think.md 在 SOFAGENT_DATA
    const skillsDir = path.join(process.env.OPENCLAW_STATE_DIR, 'skills', 'sofagent');
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(path.join(skillsDir, 'SKILL.md'), '# SKILL\n4 底线\n');
    fs.writeFileSync(path.join(skillsDir, 'fde.md'), '# 用户规则\n');
    fs.mkdirSync(process.env.SOFAGENT_DATA, { recursive: true });
    fs.writeFileSync(path.join(process.env.SOFAGENT_DATA, 'think.md'), '# 反思\n');
  });

  afterEach(() => {
    if (savedOpenclaw === undefined) delete process.env.OPENCLAW_STATE_DIR;
    else process.env.OPENCLAW_STATE_DIR = savedOpenclaw;
    if (savedData === undefined) delete process.env.SOFAGENT_DATA;
    else process.env.SOFAGENT_DATA = savedData;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('agent:bootstrap → 注入三层加载链（SKILL/think/fde）', async () => {
    const event = makeEvent(dir);
    await handler(event as LoadChainEvent);
    const names = event.context.bootstrapFiles.map((f) => f.name);
    expect(names.some((n) => n.includes('SKILL.md'))).toBe(true);
    expect(names.some((n) => n.includes('think.md'))).toBe(true);
    expect(names.some((n) => n.includes('fde.md'))).toBe(true);
    // 内容带层标识
    const skill = event.context.bootstrapFiles.find((f) => f.name.includes('SKILL.md'));
    expect(skill?.content).toContain('sofagent 第 1 层');
  });

  it('v1.3.8 rules/ 收敛 → rules/core-rules.md 优先注入，SKILL.md 仅作 legacy fallback', async () => {
    // 构造 rules/ 子目录（v1.3.8 权威路径）
    const skillsDir = path.join(process.env.OPENCLAW_STATE_DIR as string, 'skills', 'sofagent');
    const rulesDir = path.join(skillsDir, 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(path.join(rulesDir, 'core-rules.md'), '# 核心铁律\n4 底线 + 7 铁律\n');
    const event = makeEvent(dir);
    await handler(event as LoadChainEvent);
    const pushed = event.context.bootstrapFiles.map((f) => f.name);
    // rules/core-rules.md 注入为第 1 层（优先于 SKILL.md legacy 路径）
    expect(pushed.some((n) => n === 'sofagent-core-rules.md')).toBe(true);
    // 有 rules/ 时不再 fallback 到 SKILL.md 全文（避免双份注入）
    expect(pushed.some((n) => n === 'sofagent-SKILL.md')).toBe(false);
    const core = event.context.bootstrapFiles.find((f) => f.name === 'sofagent-core-rules.md');
    expect(core?.content).toContain('sofagent 第 1 层');
    expect(core?.content).toContain('4 底线 + 7 铁律');
  });

  it('v1.3.8 老安装升级 → 无 rules/ 时 fallback SKILL.md 全文（升级连续性）', async () => {
    // 老安装形态：只有扁平 SKILL.md（v1.3.7 前部署），无 rules/ 子目录
    // （beforeEach 已构造该形态——skills/sofagent/ 下仅 SKILL.md + fde.md）
    const event = makeEvent(dir);
    await handler(event as LoadChainEvent);
    const pushed = event.context.bootstrapFiles.map((f) => f.name);
    expect(pushed.some((n) => n === 'sofagent-SKILL.md')).toBe(true);
    const legacy = event.context.bootstrapFiles.find((f) => f.name === 'sofagent-SKILL.md');
    expect(legacy?.content).toContain('兼容旧安装');
  });

  it('非 bootstrap 事件 → 不注入，bootstrapFiles 保持为空', async () => {
    const event = makeEvent(dir);
    event.type = 'agent';
    event.action = 'other';
    await handler(event as LoadChainEvent);
    expect(event.context.bootstrapFiles.length).toBe(0);
  });
});
