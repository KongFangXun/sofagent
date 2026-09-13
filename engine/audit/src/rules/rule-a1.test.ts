// ============================================================
// rule-a1.test.ts · A1 不碰敏感——敏感文件检测测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { scanA1 } from './rule-a1-sensitive-files';
import type { AuditContext } from './types';
import type { DiffFile } from '@sofagent/core';
import { makeDiffFile, makeCtx } from '../test-utils';

describe('A1 不碰敏感', () => {
  it('.env → FAIL', () => {
    const result = scanA1(makeCtx([makeDiffFile('.env')]));
    expect(result.status).toBe('FAIL');
  });

  it('.env.local → FAIL', () => {
    const result = scanA1(makeCtx([makeDiffFile('.env.local')]));
    expect(result.status).toBe('FAIL');
  });

  it('.env.production → FAIL', () => {
    const result = scanA1(makeCtx([makeDiffFile('.env.production')]));
    expect(result.status).toBe('FAIL');
  });

  // v1.4.8 fresh-eyes（finding-12）：<prefix>.env.<suffix> 夹心形态不再绕过两条旧锚定
  it('config.env.production → FAIL（finding-12 夹心形态收口）', () => {
    const result = scanA1(makeCtx([makeDiffFile('config/config.env.production')]));
    expect(result.status).toBe('FAIL');
  });

  it('shared.env.backup → FAIL（finding-12 夹心形态收口）', () => {
    const result = scanA1(makeCtx([makeDiffFile('deploy/shared.env.backup')]));
    expect(result.status).toBe('FAIL');
  });

  it('id_rsa → FAIL', () => {
    const result = scanA1(makeCtx([makeDiffFile('id_rsa')]));
    expect(result.status).toBe('FAIL');
  });

  it('id_ed25519 → FAIL', () => {
    const result = scanA1(makeCtx([makeDiffFile('id_ed25519')]));
    expect(result.status).toBe('FAIL');
  });

  it('credentials.json → FAIL', () => {
    const result = scanA1(makeCtx([makeDiffFile('credentials.json')]));
    expect(result.status).toBe('FAIL');
  });

  it('*.pem → FAIL', () => {
    const result = scanA1(makeCtx([makeDiffFile('cert/server.pem')]));
    expect(result.status).toBe('FAIL');
  });

  it('*.key → FAIL', () => {
    const result = scanA1(makeCtx([makeDiffFile('ssl/private.key')]));
    expect(result.status).toBe('FAIL');
  });

  it('普通文件 → PASS', () => {
    const result = scanA1(makeCtx([makeDiffFile('src/index.ts')]));
    expect(result.status).toBe('PASS');
  });

  it('.env_backup → FAIL（下划线后缀）', () => {
    const result = scanA1(makeCtx([makeDiffFile('.env_backup')]));
    expect(result.status).toBe('FAIL');
  });

  it('.env-backup → FAIL（连字符后缀）', () => {
    const result = scanA1(makeCtx([makeDiffFile('.env-backup')]));
    expect(result.status).toBe('FAIL');
  });

  it('.env2 → FAIL（数字后缀）', () => {
    const result = scanA1(makeCtx([makeDiffFile('.env2')]));
    expect(result.status).toBe('FAIL');
  });

  it('.еnv（西里尔同形字）→ FAIL（ASCII-only 检查）', () => {
    const result = scanA1(makeCtx([makeDiffFile('.\u0435nv')]));
    expect(result.status).toBe('FAIL');
  });

  // v1.3.8 P0-3 回归：后缀式 .env 文件名——原模式 /^\.env[\w.-]*$/ 锚定 basename 点开头，
  // settings.env / production.env / config.env / 财务.env（含 SECRET=/API_KEY= 内容）全部漏检。
  // 修复：SENSITIVE_PATTERNS 补 /\.env$/i 后缀模式（保留原模式，不破坏 .env.local 前缀匹配）。
  describe('后缀式 .env 文件名（P0-3 回归）', () => {
    const suffixCases = ['settings.env', 'production.env', 'config.env', '财务.env', 'deploy/prod.env'];

    it.each(suffixCases)('%s → FAIL（后缀式 .env 不再绕过）', (path) => {
      const result = scanA1(makeCtx([makeDiffFile(path)]));
      expect(result.status).toBe('FAIL');
    });

    it('普通非 .env 文件不误报：env-sample.md → PASS', () => {
      // .env 必须是结尾后缀，env-sample.md / environments.ts 这类词中含 env 的不受影响
      const result = scanA1(makeCtx([makeDiffFile('docs/env-sample.md')]));
      expect(result.status).toBe('PASS');
    });

    it('前缀式 .env.local 仍 FAIL（原模式无回归）', () => {
      const result = scanA1(makeCtx([makeDiffFile('.env.local')]));
      expect(result.status).toBe('FAIL');
    });
  });

  // round-2 finding-01：合法 .env 子串命名不误杀（allowlist 负例）
  describe('allowlist 负例（finding-01）', () => {
    const negativeCases = [
      'config.env.ts',
      'app.env.js',
      'schema.env.example',
      'types/env.d.ts',
      'fixtures/test.env.ts',
    ];

    it.each(negativeCases)('%s → PASS（不命中）', (path) => {
      const result = scanA1(makeCtx([makeDiffFile(path)]));
      expect(result.status).toBe('PASS');
    });

    it('finding-12 夹心形态收口不回退：config.env.production / shared.env.backup 仍 FAIL', () => {
      expect(scanA1(makeCtx([makeDiffFile('config/config.env.production')])).status).toBe('FAIL');
      expect(scanA1(makeCtx([makeDiffFile('deploy/shared.env.backup')])).status).toBe('FAIL');
    });
  });

  // round-3 finding-01/02/03/08：allowlist 收口回归——数据容器命名族与 .test./.spec. 绕过面
  describe('allowlist 收口回归（round-3 finding-01/02/03/08）', () => {
    const dataContainerCases = [
      'serverless.env.yml',
      'secrets.env.json',
      'production.env.yaml',
      'config.env.toml',
      'notes.env.md',
      '.env.json',
    ];

    it.each(dataContainerCases)('%s → FAIL（json/ya?ml/toml/md 数据容器臂已剔除）', (path) => {
      expect(scanA1(makeCtx([makeDiffFile(path)])).status).toBe('FAIL');
    });

    const testSpecBypassCases = [
      'prod.test.env.local',
      'creds.test.pem',
      'server.spec.p12',
      'src/foo.test.js/.env',
    ];

    it.each(testSpecBypassCases)('%s → FAIL（.test./.spec. 尾锚定 + 仅 basename 判定）', (path) => {
      expect(scanA1(makeCtx([makeDiffFile(path)])).status).toBe('FAIL');
    });

    // round-3 finding-08：basename 以 .env 开头者不进 allowlist——.env.test.js 旧版
    // FAIL(拦截)→allowlist 放行后 WARN(通过)，叠加 finding-11 降级 + hook WARN 放行
    // 构成阻断→放行回归；恢复 .env 前缀族的整体拦截保证
    const envPrefixAllowlistCases = [
      '.env.test.js',
      '.env.spec.ts',
      '.env.ts',
      '.env.production.js',
    ];

    it.each(envPrefixAllowlistCases)('%s → FAIL（finding-08：.env 开头 basename 不进 allowlist）', (path) => {
      expect(scanA1(makeCtx([makeDiffFile(path)])).status).toBe('FAIL');
    });

    it('finding-08 不误伤：config.env.test.js 等前缀形态仍 PASS', () => {
      expect(scanA1(makeCtx([makeDiffFile('config/config.env.test.js')])).status).toBe('PASS');
      expect(scanA1(makeCtx([makeDiffFile('src/config.env.ts')])).status).toBe('PASS');
    });

    it('锚定后的良性 test/spec 源码命名仍 PASS', () => {
      expect(scanA1(makeCtx([makeDiffFile('utils/math.test.ts')])).status).toBe('PASS');
      expect(scanA1(makeCtx([makeDiffFile('components/Button.spec.tsx')])).status).toBe('PASS');
    });
  });
});

// ============================================================
// v1.4.9 P1-10 · 按 DiffFile.status 的**方向**分级
// ============================================================
// 移除方向（deleted / 改名离开敏感区）= 补救动作 → WARN；
// 引入方向（added / modified / 改名进入敏感区）= 泄漏面 → FAIL（现行为不变）。
describe('A1 · status 方向分级（v1.4.9 P1-10）', () => {
  const del = (p: string): DiffFile => makeDiffFile(p, undefined, 'deleted');
  const add = (p: string): DiffFile => makeDiffFile(p, undefined, 'added');
  const ren = (oldPath: string, p: string): DiffFile => ({ path: p, oldPath, status: 'renamed', lines: [] });

  it('deleted 敏感文件 → WARN（补救 commit 不再被 exit 2 硬阻断）', () => {
    const r = scanA1(makeCtx([del('.env')]));
    expect(r.status).toBe('WARN');
    expect(r.details.join(' ')).toContain('.env');
    expect(r.details.join(' ')).toContain('已移除');
  });

  it('deleted 非敏感文件 → PASS（不误报）', () => {
    expect(scanA1(makeCtx([del('src/index.ts')])).status).toBe('PASS');
  });

  it('renamed 离开敏感区（.env → docs/notes.md）→ WARN', () => {
    const r = scanA1(makeCtx([ren('.env', 'docs/notes.md')]));
    expect(r.status).toBe('WARN');
    expect(r.details.join(' ')).toContain('.env');
    expect(r.details.join(' ')).toContain('已移除');
  });

  it('renamed 进入敏感区（docs/notes.md → .env）→ FAIL', () => {
    expect(scanA1(makeCtx([ren('docs/notes.md', '.env')])).status).toBe('FAIL');
  });

  it('renamed 敏感 → 敏感（.env → .env.production）→ FAIL（仍在敏感区）', () => {
    expect(scanA1(makeCtx([ren('.env', '.env.production')])).status).toBe('FAIL');
  });

  it('added 敏感文件 → FAIL（现行为不变）', () => {
    expect(scanA1(makeCtx([add('.env')])).status).toBe('FAIL');
  });

  it('modified 敏感文件 → FAIL（现行为不变）', () => {
    expect(scanA1(makeCtx([makeDiffFile('.env')])).status).toBe('FAIL');
  });

  it('同时有引入与移除 → FAIL 且两行都在（最严者胜）', () => {
    const r = scanA1(makeCtx([del('.env'), add('credentials.json')]));
    expect(r.status).toBe('FAIL');
    expect(r.details.join(' ')).toContain('credentials.json');
    expect(r.details.join(' ')).toContain('.env');
    expect(r.details.join(' ')).toContain('已移除');
  });
});
