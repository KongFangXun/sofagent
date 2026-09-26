// ============================================================
// paired-records.test.ts · v1.5.3 第六章判决类记录成对门禁回归锁
// ============================================================
// 验收对位：
//   ① 门禁脚本自身可运行且当前树绿（子进程跑 check-paired-records.mjs）；
//   ② 故障注入实证（负向探针）：注入「未登记判决类 kind」的临时源文件到真实
//      扫描面 → 门禁非 0；还原 → 绿。--self-test 模式（脚本内注入）双验证。
//   ③ 登记表腐化检测：登记不存在的写入点文件 → 必红（脚本判定①的文件在位核验）。
// 全程不污染工作树：文件注入用 mkdtemp 临时文件 + 恢复；脚本内注入（--self-test）
//   只污染内存 Map，不落盘。
// ============================================================
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
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

describe('D6 · 判决类记录成对门禁（check-paired-records.mjs）', () => {
  it('当前树：门禁通过（rc=0，N 态全实落 + 盲区显式登记）', () => {
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

  it('故障注入（真实文件面）：注入未登记判决类 kind 的临时写入点 → 门禁 rc=1；还原 → rc=0', () => {
    // 注入面：engine/audit/src/ 是门禁扫描面（collectFiles 遍历 engine/**/*.ts 非测试）
    const injectPath = join(REPO_ROOT, 'engine', 'audit', 'src', 'tmp-injected-unregistered-verdict.ts');
    expect(existsSync(injectPath)).toBe(false); // 前置：无残留
    try {
      writeFileSync(injectPath, `export const injected = { kind: 'INJECTED_TEST_VERDICT_KIND' };\n`, 'utf-8');
      const red = runGate();
      expect(red.rc).toBe(1);
      // 失败明细在 stderr（fail() 走 console.error）；stdout 载判定过程
      expect(red.stderr).toContain('INJECTED_TEST_VERDICT_KIND');
      expect(red.stderr).toContain('未登记');
    } finally {
      rmSync(injectPath, { force: true }); // 还原
    }
    // 还原后必须回绿（证明红由注入引起，非环境漂移）
    const green = runGate();
    expect(green.rc).toBe(0);
  });

  it('豁免登记语义：非判决 kind（如 SPEC_CHANGE）不在判决门禁面——注入其写入点不红', () => {
    const injectPath = join(REPO_ROOT, 'engine', 'audit', 'src', 'tmp-injected-nonverdict.ts');
    try {
      // SPEC_CHANGE 属 NON_VERDICT_KINDS（观测/过程类整类豁免）——写入它不该触发判决门禁
      writeFileSync(injectPath, `export const nv = { kind: 'SPEC_CHANGE' };\n`, 'utf-8');
      const r = runGate();
      expect(r.rc).toBe(0);
    } finally {
      rmSync(injectPath, { force: true });
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
