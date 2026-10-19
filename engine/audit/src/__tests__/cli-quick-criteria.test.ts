// ============================================================
// cli-quick-criteria.test.ts · --criteria 只读出口行为锁（v1.7.0 BUG-56）
// ------------------------------------------------------------
// 背景：36 条判据已是 SSOT（src/rules/criteria/audit-criteria.ts 导出
//   AUDIT_CRITERIA）但对 CLI 用户零入口。--criteria 给一层只读出口：
//   不动判定逻辑、不落数、不依赖 git 仓库。
// 本文件锁三面：
//   ① 行数契约 = 判据数 + 表头 + 合计（数字从 AUDIT_CRITERIA.length 动态
//     对账，禁硬编码——判据表演进时本测试零改动仍有效）；
//   ② id 集双向对账（输出 ↔ SSOT，漏一条/多一条都红）；
//   ③ 无阈值条目（A19-1 手写 stay-code）阈值列显 '—'，其余带版本锚。
//
// 实测路径：spawn 真实 dist 产物（对齐 cli-quick-unknown-args.test.ts
// 的「行为面 dist 直调」先例）；id 对账基准从 src 直接 import（vitest
// 直跑 src 形态——与 cli-quick-skip-hint.test.ts 同源引用方式）。
// ============================================================

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { AUDIT_CRITERIA, AUDIT_CRITERIA_RECONCILIATION } from '../rules/criteria/audit-criteria';

const here = dirname(fileURLToPath(import.meta.url));
// dist/cli-quick.js（build 产物——本测试在 npm test 前置 build 后运行）
const QUICK_BIN = join(here, '..', '..', 'dist', 'cli-quick.js');

interface RunResult { status: number | undefined; output: string }

/** 跑 dist 产物取「退出码 + stdout/stderr 合流」——非 0 退出不抛。 */
function run(args: string[]): RunResult {
  try {
    const output = execFileSync(process.execPath, [QUICK_BIN, ...args], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output: String(output) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('cli-quick --criteria 只读出口（v1.7.0 BUG-56）', () => {
  it('dist 产物存在（前置：npm run build --workspace=engine/audit）', () => {
    if (!existsSync(QUICK_BIN)) {
      throw new Error(`dist 产物缺失: ${QUICK_BIN}——先 npm run build --workspace=engine/audit`);
    }
  });

  it('输出行数 = 判据数 + 表头 + 合计（动态对账，禁硬编码）', () => {
    const r = run(['--criteria']);
    expect(r.status).toBe(0);
    const lines = r.output.trimEnd().split('\n');
    // 表头 1 + 判据 N + 合计 1（判据数从 SSOT 动态取——判据表演进本断言零改动）
    expect(lines.length).toBe(AUDIT_CRITERIA.length + 2);
    // 表头列契约（六列：ID/RULE/PRIMITIVE/QUESTION/DISPOSITION/THRESHOLD）
    expect(lines[0]).toContain('ID');
    expect(lines[0]).toContain('QUESTION');
    expect(lines[0]).toContain('THRESHOLD');
    // 末行合计：判据数 / 规则覆盖数 / 阈值版本锚（均动态算得）
    const total = lines[lines.length - 1];
    expect(total).toContain(`${AUDIT_CRITERIA.length} 条判据`);
    expect(total).toContain(`${AUDIT_CRITERIA_RECONCILIATION.totalRules} 规则全覆盖`);
  });

  it('id 集双向对账：输出 id 集 ↔ AUDIT_CRITERIA id 集（漏一条/多一条都红）', () => {
    const r = run(['--criteria']);
    expect(r.status).toBe(0);
    const lines = r.output.trimEnd().split('\n');
    // 判据行 = 去掉表头（首行）与合计（末行）的中间段
    const bodyLines = lines.slice(1, lines.length - 1);
    const outputIds = new Set(bodyLines.map((l) => l.split(' | ')[0]));
    const ssotIds = new Set(AUDIT_CRITERIA.map((c) => c.id));
    // 双向：输出 ⊆ SSOT（无多印）且 SSOT ⊆ 输出（无漏印）
    const extra = [...outputIds].filter((id) => !ssotIds.has(id));
    const missing = [...ssotIds].filter((id) => !outputIds.has(id));
    expect(extra, `输出多出 SSOT 外的 id: ${extra.join(',')}`).toEqual([]);
    expect(missing, `SSOT 判据未出现在输出: ${missing.join(',')}`).toEqual([]);
    expect(outputIds.size).toBe(AUDIT_CRITERIA.length);
  });

  it('无阈值条目（stay-code）阈值列显「—」，带阈值条目显 版本锚', () => {
    const r = run(['--criteria']);
    expect(r.status).toBe(0);
    const lines = r.output.trimEnd().split('\n');
    const bodyLines = lines.slice(1, lines.length - 1);
    for (const c of AUDIT_CRITERIA) {
      const row = bodyLines.find((l) => l.startsWith(`${c.id} |`));
      expect(row, `判据 ${c.id} 无输出行`).toBeDefined();
      if (row === undefined) continue;
      if (c.thresholds.length === 0) {
        // A19-1 手写 stay-code 无阈值——阈值列 '—'（disposition 同步核）
        expect(row).toContain(`| ${c.disposition} | —`);
      } else {
        for (const t of c.thresholds) {
          expect(row).toContain(`${t.value}@${t.boundDistribution}`);
        }
      }
    }
  });

  it('非 git 仓库内仍可用（判据表是引擎自带数据，与被审仓库无关）', () => {
    const os = require('node:os') as typeof import('node:os');
    const fs = require('node:fs') as typeof import('node:fs');
    const dir = fs.mkdtempSync(join(os.tmpdir(), 'sofagent-criteria-nogit-'));
    try {
      const r = ((): RunResult => {
        try {
          const output = execFileSync(process.execPath, [QUICK_BIN, '--criteria'], {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'pipe'],
            cwd: dir,
          });
          return { status: 0, output: String(output) };
        } catch (err) {
          const e = err as { status?: number; stdout?: string; stderr?: string };
          return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
        }
      })();
      expect(r.status).toBe(0);
      expect(r.output).toContain('条判据');
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
    }
  });
});
