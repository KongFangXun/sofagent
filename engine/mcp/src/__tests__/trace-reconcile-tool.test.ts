// ============================================================
// trace-reconcile-tool.test.ts · v1.5.0 章八：trace_reconcile MCP tool
// ============================================================
//
// 验收：tool 注册面（105th）+ 对账执行链路 + COVERAGE decision 落盘。
// DSH 源经 SOFAGENT_TRACE_EVIDENCE=off 环境默认关（vitest-setup）——
// tool 走 dataDir 缓存路径，真实 ~/.dsh 不触达（SOFAGENT_DATA 隔离）。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { traceReconcileTool } from '../tools/trace-reconcile';
import { TOOLS } from '../tool-registry';

describe('trace_reconcile tool（v1.5.0 章八 · 105th）', () => {
  let tmpDir: string;
  let repoDir: string;
  let prevData: string | undefined;
  let prevTrace: string | undefined;
  let prevDshHome: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-trace-reconcile-'));
    repoDir = path.join(tmpDir, 'repo');
    fs.mkdirSync(repoDir, { recursive: true });
    // git 仓库 + 一个未提交变更（对账 diff 源）
    execSync('git init -q && git config user.email t@t && git config user.name t', { cwd: repoDir });
    fs.writeFileSync(path.join(repoDir, 'committed.ts'), 'export const a = 1;\n');
    execSync('git add -A && git commit -qm init', { cwd: repoDir });
    fs.writeFileSync(path.join(repoDir, 'committed.ts'), 'export const a = 2;\n');

    prevData = process.env.SOFAGENT_DATA;
    process.env.SOFAGENT_DATA = path.join(tmpDir, 'data');
    prevTrace = process.env.SOFAGENT_TRACE_EVIDENCE;
    // DSH_HOME 隔离——空目录替代真实 ~/.dsh（936 session 全扫会拖垮测试）
    prevDshHome = process.env.DSH_HOME;
    fs.mkdirSync(path.join(tmpDir, 'dsh-empty', 'sessions'), { recursive: true });
    process.env.DSH_HOME = path.join(tmpDir, 'dsh-empty');
  });

  afterEach(() => {
    if (prevData === undefined) delete process.env.SOFAGENT_DATA;
    else process.env.SOFAGENT_DATA = prevData;
    if (prevTrace === undefined) delete process.env.SOFAGENT_TRACE_EVIDENCE;
    else process.env.SOFAGENT_TRACE_EVIDENCE = prevTrace;
    if (prevDshHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prevDshHome;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it('test_toolRegistry_105th注册面', () => {
    const entry = TOOLS.find((t) => t.name === 'trace_reconcile');
    expect(entry).toBeDefined();
    expect(entry!.roles).toContain('ops');
  });

  it('test_traceReconcileTool_对账执行_无session时漏报呈现', async () => {
    // 无 DSH session 命中（隔离 dataDir）→ 唯一 diff 文件呈漏报
    const result = await traceReconcileTool({ repo_root: repoDir });

    expect(result.data.isError).toBe(false);
    expect(result.data.ok).toBe(true);
    expect(result.data.report!.diffSet).toContain('committed.ts');
    const omitted = result.data.report!.discrepancies.filter((d) => d.verdict === 'omitted');
    expect(omitted.length).toBe(1);
    expect(omitted[0]!.path).toBe('committed.ts');
    expect(result.text).toContain('漏报');
  });

  it('test_traceReconcileTool_COVERAGE决策落盘', async () => {
    const result = await traceReconcileTool({ repo_root: repoDir });

    expect(result.data.decisionLogged).toBe(true);
    const logPath = path.join(process.env.SOFAGENT_DATA!, 'audit', 'decision-log.jsonl');
    expect(fs.existsSync(logPath)).toBe(true);
    const content = fs.readFileSync(logPath, 'utf-8');
    expect(content).toContain('"COVERAGE"');
    expect(content).toContain('sofagent-trace-reconcile');
  });

  it('test_traceReconcileTool_异常路径_failGracefully', async () => {
    // repo_root 指向不存在目录——isomorphic-git 内部 catch 返回空 diff，
    // 不抛异常（对账空集 = 全一致）
    const result = await traceReconcileTool({ repo_root: path.join(tmpDir, 'nope') });
    expect(result.data.isError).toBe(false);
    expect(result.data.report!.consistencyRate).toBe(1);
  });
});
