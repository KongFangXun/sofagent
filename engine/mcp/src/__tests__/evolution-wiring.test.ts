// ============================================================
// evolution-wiring.test.ts · L4 进化工具启动接线回归测试（v1.5.0 TASK-6）
//
// 验收覆盖：
//   一、启动接线：mcp-server start() 启动序列自动调
//       registerEvolvedTools（SOFAGENT_DATA 台账 → 动态面）
//   二、台账空则零注册（幂等——不影响 104 静态工具）
//   三、真实启动态：spawn server 子进程 → tools/list
//       自然含动态工具（运行态全链路）
// ============================================================

import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

// 被测产物：dist/mcp-server.js（接线编译后的真实启动序列）
const MCP_SERVER_DIST = resolve(__dirname, '../../dist/mcp-server.js');

function tmpDataDir(): string {
  return mkdtempSync(join(tmpdir(), `l4-wiring-${Date.now()}-${randomBytes(4).toString('hex')}`));
}

/** 经 orchestrator 台账写入一个注册态候选（不走 mock——真实台账链） */
async function seedLedgerViaOrchestrator(data: string, toolName: string): Promise<void> {
  const { nominateToolCandidate, reviewToolCandidate, registerApprovedTool } = await import('@sofagent/orchestrator');
  const skill = join(data, 'skill-src');
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, 'SKILL.md'), '# 测试技能\n');
  const nom = nominateToolCandidate(
    { candidate: { toolName, invokeCount: 12, heat: 6, hint: '测试' }, sourcePath: skill, description: '接线测试', nominatedBy: 'wiring-test' },
    data,
  );
  if (!nom.ok) throw new Error(`nominate 失败: ${nom.status} ${nom.reason ?? ''}`);
  const rv = reviewToolCandidate({ candidateId: nom.candidateId, reviewer: 'wiring-test', verdict: 'approved' }, data);
  if (!rv.ok) throw new Error(`review 失败: ${rv.status}`);
  const gens = join(data, 'gens');
  mkdirSync(gens, { recursive: true });
  const gen = join(gens, 'gen.cjs');
  writeFileSync(gen, 'module.exports.default = async (i) => ({ ok: true, got: i });\n');
  const rg = registerApprovedTool({ candidateId: nom.candidateId, generatorModule: gen }, data);
  if (!rg.ok) throw new Error(`register 失败: ${rg.status}`);
}

describe('L4 进化工具启动接线（v1.5.0 TASK-6）', () => {
  const dirsToClean: string[] = [];

  afterEach(() => {
    for (const d of dirsToClean.splice(0)) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* */ }
    }
  });

  it('启动接线：台账有注册态候选 → server 子进程 tools/list 自然含动态工具', async () => {
    const data = tmpDataDir();
    dirsToClean.push(data);
    await seedLedgerViaOrchestrator(data, 'wiring_evolved_tool');

    const listJson = await launchAndListTools(data);
    const names = listJson.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('wiring_evolved_tool');
    // 动态工具描述带 L4 标识（registerEvolvedTools 装配面）
    const dyn = listJson.result.tools.find((t: { name: string }) => t.name === 'wiring_evolved_tool');
    expect(String(dyn.description)).toContain('L4 进化工具');
  }, 20000);

  it('缺省语义：台账空 → server 启动后零注册（tools/list 不含 L4 动态工具）', async () => {
    const data = tmpDataDir();
    dirsToClean.push(data);
    // 台账空——不 seed

    const listJson = await launchAndListTools(data);
    const l4Tools = listJson.result.tools.filter((t: { description?: string }) => String(t.description ?? '').includes('L4 进化工具'));
    expect(l4Tools).toEqual([]);
  }, 20000);
});

/** 启动真实 server 子进程（SOFAGENT_DATA=data），发 initialize + tools/list，返回 tools/list 响应 JSON */
function launchAndListTools(data: string): Promise<{ result: { tools: Array<{ name: string; description?: string }> } }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MCP_SERVER_DIST], { env: { ...process.env, SOFAGENT_DATA: data } });
    let out = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('tools/list 超时')); }, 15000);
    child.stdout.on('data', (c) => {
      out += c;
      // 响应行完整后解析——找 tools/list 的响应（id:2）
      for (const line of out.split('\n')) {
        if (!line.trim()) continue;
        try {
          const resp = JSON.parse(line);
          if (resp.id === 2 && resp.result?.tools) {
            clearTimeout(timer);
            child.kill();
            resolve(resp);
            return;
          }
        } catch { /* 未完整行 */ }
      }
    });
    child.stderr.on('data', () => { /* 吞掉启动日志 */ });
    child.on('error', reject);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
  });
}
