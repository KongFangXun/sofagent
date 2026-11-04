// ============================================================
// media-env.test.ts · 介质读源持久化读回（F6.7 R8-5）
// ============================================================
// 判据不是「install.sh 写了文件」，而是「新进程能把它们读回 process.env」——
// 这正是「重启后 daemon 还认不认介质」的可测代理。
// ============================================================
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MEDIA_ENV_KEYS, loadMediaEnv, mediaEnvPath } from '../media-env';

const KEYS = [...MEDIA_ENV_KEYS];

describe('media-env · 介质读源持久化', () => {
  let dataDir: string;
  let envDir: string;

  const clearEnv = (): void => {
    for (const k of KEYS) delete process.env[k];
  };

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'media-env-'));
    envDir = join(dataDir, 'media');
    mkdirSync(envDir, { recursive: true });
    clearEnv();
  });

  afterEach(() => {
    clearEnv();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('无 media.env ⇒ 不动 process.env（非介质档行为不变）', () => {
    const r = loadMediaEnv(dataDir);
    expect(r.loaded).toEqual([]);
    expect(process.env.SOFAGENT_MEDIA_WEIGHTS).toBeUndefined();
    expect(r.path).toBe(mediaEnvPath(dataDir));
  });

  it('读回 install.sh 写出的三个键', () => {
    writeFileSync(
      join(envDir, 'media.env'),
      [
        '# 注释行应被忽略',
        'SOFAGENT_MEDIA_ROOT=/Volumes/USB',
        'SOFAGENT_MEDIA_WEIGHTS=/Users/x/.sofagent/media/weights',
        'SOFAGENT_MEDIA_DSH=/Users/x/.sofagent/media/dsh',
        '',
      ].join('\n')
    );
    const r = loadMediaEnv(dataDir);
    expect(r.loaded.sort()).toEqual([...KEYS].sort());
    expect(process.env.SOFAGENT_MEDIA_WEIGHTS).toBe('/Users/x/.sofagent/media/weights');
    expect(process.env.SOFAGENT_MEDIA_DSH).toBe('/Users/x/.sofagent/media/dsh');
  });

  it('export 前缀与引号都被容忍（手改过的文件同样能读）', () => {
    writeFileSync(join(envDir, 'media.env'), `export SOFAGENT_MEDIA_WEIGHTS="/tmp/w"\nSOFAGENT_MEDIA_DSH='/tmp/d'\n`);
    const r = loadMediaEnv(dataDir);
    expect(r.loaded.sort()).toEqual(['SOFAGENT_MEDIA_DSH', 'SOFAGENT_MEDIA_WEIGHTS']);
    expect(process.env.SOFAGENT_MEDIA_WEIGHTS).toBe('/tmp/w');
    expect(process.env.SOFAGENT_MEDIA_DSH).toBe('/tmp/d');
  });

  it('已存在的同名环境变量不被覆盖（显式 env 优先，便于排障）', () => {
    process.env.SOFAGENT_MEDIA_WEIGHTS = '/tmp/explicit';
    writeFileSync(join(envDir, 'media.env'), 'SOFAGENT_MEDIA_WEIGHTS=/tmp/from-file\n');
    const r = loadMediaEnv(dataDir);
    expect(process.env.SOFAGENT_MEDIA_WEIGHTS).toBe('/tmp/explicit');
    expect(r.skipped).toContain('SOFAGENT_MEDIA_WEIGHTS');
    expect(r.loaded).not.toContain('SOFAGENT_MEDIA_WEIGHTS');
  });

  it('非 MEDIA_ENV_KEYS 的键一律忽略（不把任意环境变量灌进进程）', () => {
    // 注意：不假设这两个键「本来不存在」——runner 自己可能已设（如 NODE_OPTIONS=''）。
    // 判据只取「文件里的值没有写进进程」，与它们的初始值无关。
    const pathBefore = process.env.PATH;
    const nodeOptsBefore = process.env.NODE_OPTIONS;
    writeFileSync(join(envDir, 'media.env'), 'PATH=/evil\nSOFAGENT_MEDIA_ROOT=/ok\nNODE_OPTIONS=--inspect\n');
    const r = loadMediaEnv(dataDir);
    expect(r.loaded).toEqual(['SOFAGENT_MEDIA_ROOT']);
    expect(process.env.PATH).toBe(pathBefore);
    expect(process.env.NODE_OPTIONS).toBe(nodeOptsBefore);
  });
});
