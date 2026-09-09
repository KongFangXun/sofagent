// ============================================================
// cli-quick-unknown-args.test.ts · quick 模式未知参数 fail-loud 行为锁
// v1.4.7 批次 M 任务二：--ruleset* 等语义拼错形态 exit 2（用法错误），
// 纯未知 flag 保留 warn exit 0——CI 假绿直通车封堵。
//
// 实测路径：spawn 真实 dist 产物（对齐仓内「行为面 dist 直调」先例），
// 三形态断言：--rulesets 复数 / --ruleset=security 等号 / --bogus-flag 噪声。
// ============================================================

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
// dist/cli-quick.js（build 产物——本测试在 npm test 前置 build 后运行）
const QUICK_BIN = join(here, '..', '..', 'dist', 'cli-quick.js');

describe('cli-quick 未知参数 fail-loud（v1.4.7 M）', () => {
  it('dist 产物存在（前置：npm run build --workspace=engine/audit）', () => {
    if (!existsSync(QUICK_BIN)) {
      throw new Error(`dist 产物缺失: ${QUICK_BIN}——先 npm run build --workspace=engine/audit`);
    }
  });

  it('--rulesets 复数拼错 → exit 2（安全语义形态不静默放行）', () => {
    try {
      execFileSync(process.execPath, [QUICK_BIN, '--rulesets', 'security'], { encoding: 'utf-8' });
      throw new Error('应 exit 2 但 exit 0');
    } catch (err) {
      const e = err as { status?: number; stderr?: string; stdout?: string };
      expect(e.status).toBe(2);
      expect(`${e.stdout ?? ''}${e.stderr ?? ''}`).toContain('未知参数');
    }
  });

  it('--ruleset=security 等号拼错 → exit 2', () => {
    try {
      execFileSync(process.execPath, [QUICK_BIN, '--ruleset=security'], { encoding: 'utf-8' });
      throw new Error('应 exit 2 但 exit 0');
    } catch (err) {
      const e = err as { status?: number };
      expect(e.status).toBe(2);
    }
  });

  it('--bogus-flag 纯噪声 → warn 但 exit 0/1（不升级中断）', () => {
    // 在 git 仓库内跑 quick 审计——审计自身发现决定 exit 0/1，未知 flag 只 warn
    const out = execFileSync(process.execPath, [QUICK_BIN, '--bogus-flag', '--version'], {
      encoding: 'utf-8',
    });
    // --version 走版本打印分支（快路径），未知 flag 不中断
    expect(out).toBeTruthy();
  });
});
