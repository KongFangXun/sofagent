// ============================================================
// paired-records.test.ts · v1.5.3 第六章判决类记录成对门禁回归锁
// ============================================================
// 验收对位：
//   ① 门禁脚本自身可运行且当前树绿（子进程跑 check-paired-records.mjs）；
//   ② 故障注入实证（负向探针）：在 **os.tmpdir() 临时受试面**（--root 指向）注入
//      「未登记判决类 kind」文件 → 门禁 rc=1；还原 → rc=0。隔离到临时面后，
//      并行跑 vitest 不再向真实扫描面写文件、不再互相污染（W8 BUG-13）；
//   ③ 登记表腐化检测：受试面缺登记文件 → 必红（脚本判定①的文件在位核验）；
//   ④ 豁免登记语义：非判决 kind（SPEC_CHANGE）写入受试面 → 不红。
// 夹具形态：临时根内只放「登记表声明的最小写入面」+ decision-schema.ts——
//   门禁四判定在该面上与真实仓同构（读同一登记表、扫同一相对路径形态）。
// ============================================================
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const GATE = join(REPO_ROOT, 'tools', 'check', 'check-paired-records.mjs');

/** 跑门禁（同步子进程），返回 { rc, stdout, stderr } */
function runGate(extraArgs: string[] = []): { rc: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', [GATE, ...extraArgs], { encoding: 'utf-8' });
    return { rc: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer };
    return {
      rc: e.status ?? 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  }
}

/**
 * 构造临时受试面（--root 目标）：从真实仓拷入登记表声明的全部 writer 文件 +
 * decision-schema.ts（判定③④ 的读取锚），使四判定与真实仓同构。
 * 返回临时根路径；调用方负责 rmSync 清理。
 */
function makeSandbox(): string {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'paired-records-'));
  const gateSrc = readFileSync(GATE, 'utf-8');
  // 从 REGISTRY 提取登记文件相对路径（writers[].file）——夹具与登记表永不脱节
  const writerFiles = [...gateSrc.matchAll(/file:\s*'([^']+)'/g)].map((m) => m[1]);
  for (const rel of writerFiles) {
    const src = join(REPO_ROOT, rel);
    if (!existsSync(src)) continue; // 缺失即门禁①红——正是腐化检测语义，不替门禁遮掩
    cpSync(src, join(tmpRoot, rel), { recursive: true });
  }
  cpSync(join(REPO_ROOT, 'engine/audit/src/decision-schema.ts'), join(tmpRoot, 'engine/audit/src/decision-schema.ts'));
  return tmpRoot;
}

describe('D6 · 判决类记录成对门禁（check-paired-records.mjs）', () => {
  it('当前树：门禁通过（rc=0，N 态全实落 + 盲区显式登记）——真实仓只读，不注入', () => {
    const { rc, stdout } = runGate();
    expect(rc).toBe(0);
    expect(stdout).toContain('判决类记录成对门禁通过');
  });

  it('--self-test：脚本内故障注入（未登记 kind + 假家族缺侧）均被捕获且不改变退出码', () => {
    const { rc, stdout } = runGate(['--self-test']);
    expect(rc).toBe(0); // self-test 验证「能捕获」本身——捕获成功即绿
    expect(stdout).toContain('负向探针 PASS');
    expect(stdout.match(/负向探针 PASS/g)?.length).toBe(2);
  });

  it('故障注入（临时受试面）：注入未登记判决类 kind → 门禁 rc=1；还原 → rc=0', () => {
    const tmpRoot = makeSandbox();
    try {
      // 前置：受试面同构绿（拷入的登记面完整）
      const base = runGate(['--root', tmpRoot]);
      expect(base.rc).toBe(0);
      // 注入：未登记 kind 的写入点落在受试面内（真实扫描面零接触）
      const injectPath = join(tmpRoot, 'engine', 'audit', 'src', 'tmp-injected-unregistered-verdict.ts');
      writeFileSync(injectPath, `export const injected = { kind: 'INJECTED_TEST_VERDICT_KIND' };\n`, 'utf-8');
      const red = runGate(['--root', tmpRoot]);
      expect(red.rc).toBe(1);
      // 失败明细在 stderr（fail() 走 console.error）；stdout 载判定过程
      expect(red.stderr).toContain('INJECTED_TEST_VERDICT_KIND');
      expect(red.stderr).toContain('未登记');
      // 还原后必须回绿（证明红由注入引起，非环境漂移）
      rmSync(injectPath, { force: true });
      const green = runGate(['--root', tmpRoot]);
      expect(green.rc).toBe(0);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true }); // 清理临时面
    }
  });

  it('登记表腐化检测（临时受试面）：缺登记文件 → 门禁 rc=1（文件在位核验红）', () => {
    const tmpRoot = makeSandbox();
    try {
      // 抽走一个登记 writer（TOOL_GATE 家族的第一写入点）→ 判定① 必红
      const victim = join(tmpRoot, 'FORGE', 'src', 'audit-middleware.mjs');
      expect(existsSync(victim)).toBe(true); // 前置：夹具确实拷到了
      rmSync(victim, { force: true });
      const red = runGate(['--root', tmpRoot]);
      expect(red.rc).toBe(1);
      expect(red.stderr).toContain('登记的写入点文件不存在');
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('豁免登记语义：非判决 kind（如 SPEC_CHANGE）不在判决门禁面——写入受试面不红', () => {
    const tmpRoot = makeSandbox();
    try {
      // SPEC_CHANGE 属 NON_VERDICT_KINDS（观测/过程类整类豁免）——写入它不该触发判决门禁
      const injectPath = join(tmpRoot, 'engine', 'audit', 'src', 'tmp-injected-nonverdict.ts');
      writeFileSync(injectPath, `export const nv = { kind: 'SPEC_CHANGE' };\n`, 'utf-8');
      const r = runGate(['--root', tmpRoot]);
      expect(r.rc).toBe(0);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('登记表自身进版本库：两处盲区登记（RULE_TOGGLE / ESCALATE_REPORT 各带理由+触发条件）+ COST 已退役为正常家族', () => {
    const src = readFileSync(GATE, 'utf-8');
    for (const kind of ['RULE_TOGGLE', 'ESCALATE_REPORT']) {
      expect(src).toContain(`kind: '${kind}'`);
    }
    expect(src.match(/blindSpot:\s*\{/g)?.length).toBe(2);
    // COST 盲区按其 trigger 退役（写面已落地 = engine/audit/src/index.ts 主审计成本段）——
    // 锁退役形态：COST 转正常家族且 writers 指向真实写面文件（防盲区登记回潮）。
    expect(src).toContain("kind: 'COST'");
    expect(src).toContain("writers: [{ file: 'engine/audit/src/index.ts' }]");
    expect(src.match(/trigger:/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
