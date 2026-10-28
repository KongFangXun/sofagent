// ============================================================
// daily-health.test.ts · BUG-24：repoRoot 双形态（src/dist）解析行为锁
// ============================================================
// 缺陷形态：repoRoot() 用「__dirname 末段 === 'src'」分流，src 态上四级（对）、
// dist 态上三级（= engine/，错）——拼出 engine/engine/scripts/daily-health.sh
// （不存在），仓库态 dist 永远走 $SOFAGENT_HOME/scripts/ 兜底，上游无感。
// 修复后：src 与 dist 的 __dirname 深度相同（tsc rootDir=src/outDir=dist 原样
// 镜像层级），统一上四级到仓库根。
// 验收判据：两种 __dirname 形态（src/inspectors 与 dist/inspectors，均以真实
// 仓库根 process.cwd() 为参照）解析出的 script 路径都指向仓库根下真实存在的
// engine/scripts/daily-health.sh。
// ============================================================

import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { existsSync } from 'fs';
import { repoRoot } from '../inspectors/daily-health';

describe('BUG-24 · daily-health repoRoot 双形态解析', () => {
  /** 仓库根参照：vitest 从 engine/daemon 起跑（npm test / npx vitest run 均如此） */
  const REPO_ROOT = join(process.cwd(), '..', '..');

  it('src 形态（<repo>/engine/daemon/src/inspectors）→ 上四级 = 仓库根', () => {
    const srcForm = join(REPO_ROOT, 'engine', 'daemon', 'src', 'inspectors');
    expect(repoRoot(srcForm)).toBe(REPO_ROOT);
  });

  it('dist 形态（<repo>/engine/daemon/dist/inspectors）→ 上四级 = 仓库根（原三级 = engine/ 死路）', () => {
    const distForm = join(REPO_ROOT, 'engine', 'daemon', 'dist', 'inspectors');
    // 原实现此形态上三级 = <repo>/engine —— 拼出 engine/engine/scripts/*.sh 不存在
    expect(join(repoRoot(distForm), 'engine')).toBe(join(REPO_ROOT, 'engine'));
  });

  it('两形态拼出的脚本路径均指向仓库根下真实存在的 engine/scripts/daily-health.sh', () => {
    for (const form of ['src', 'dist'] as const) {
      const script = join(
        repoRoot(join(REPO_ROOT, 'engine', 'daemon', form, 'inspectors')),
        'engine', 'scripts', 'daily-health.sh',
      );
      expect(script).toBe(join(REPO_ROOT, 'engine', 'scripts', 'daily-health.sh'));
      expect(existsSync(script)).toBe(true);
    }
  });

  it('旧实现死路复现（负向锚）：dist 形态上三级拼出的路径必然不存在', () => {
    const distForm = join(REPO_ROOT, 'engine', 'daemon', 'dist', 'inspectors');
    const deadEnd = join(join(distForm, '..', '..', '..'), 'engine', 'scripts', 'daily-health.sh');
    expect(deadEnd).toBe(join(REPO_ROOT, 'engine', 'engine', 'scripts', 'daily-health.sh'));
    expect(existsSync(deadEnd)).toBe(false);
  });
});
