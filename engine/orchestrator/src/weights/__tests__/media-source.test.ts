// ============================================================
// media-source.test.ts · 介质内读源（F6.7 R7-3 · USB A 安装器档）
// ============================================================
// 判据不是「函数存在」，而是「weights 下载路径真的会先看介质」：
//   ① 未设环境变量 ⇒ null（原联网行为不变）
//   ② 已设且件对 ⇒ 落盘 + sha 校验通过，trace 标明 source=media
//   ③ 已设但缺件 ⇒ 失败且**不回退联网**（这是「介质档」可区分的关键）
//   ④ 已设但 sha 不符 ⇒ 失败、不落盘
// ============================================================
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { mediaDshDir, mediaWeightsDir, tryImportWeightFromMedia } from '../media-source';
import { fetchVersion } from '../weights-fetch';

const ENV_W = 'SOFAGENT_MEDIA_WEIGHTS';
const ENV_D = 'SOFAGENT_MEDIA_DSH';
const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

describe('media-source · 介质内读源', () => {
  let root: string;
  let mediaDir: string;
  let destDir: string;
  const body = Buffer.from('fake-weights-bytes\n');
  const goodSha = sha(body);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'media-src-'));
    mediaDir = join(root, 'media-weights');
    destDir = join(root, 'dest');
    mkdirSync(mediaDir, { recursive: true });
    writeFileSync(join(mediaDir, 'model.safetensors'), body);
  });

  afterEach(() => {
    delete process.env[ENV_W];
    delete process.env[ENV_D];
    delete process.env.SOFAGENT_WEIGHTS_DIR;
    rmSync(root, { recursive: true, force: true });
  });

  it('未设环境变量 ⇒ 返回 null（非介质档，联网路径行为不变）', () => {
    expect(mediaWeightsDir()).toBeNull();
    const r = tryImportWeightFromMedia({ destDir, fileName: 'model.safetensors', expectedSha256: goodSha });
    expect(r).toBeNull();
    expect(existsSync(destDir)).toBe(false);
  });

  it('设了环境变量但为空串 ⇒ 仍按非介质档处理（export FOO= 不等价于介质档）', () => {
    process.env[ENV_W] = '';
    expect(mediaWeightsDir()).toBeNull();
    expect(tryImportWeightFromMedia({ destDir, fileName: 'model.safetensors', expectedSha256: goodSha })).toBeNull();
  });

  it('介质件齐全且 sha 一致 ⇒ 落盘、sha 回传、trace 标 source=media', () => {
    process.env[ENV_W] = mediaDir;
    const r = tryImportWeightFromMedia({ destDir, fileName: 'model.safetensors', expectedSha256: goodSha, expectedBytes: body.length });
    expect(r?.ok).toBe(true);
    expect(r?.path).toBe(join(destDir, 'model.safetensors'));
    expect(r?.sha256).toBe(goodSha);
    expect(readFileSync(join(destDir, 'model.safetensors'))).toEqual(body);
    expect(r?.trace.source).toBe('media');
    // 留痕与联网路径同一份文件
    expect(existsSync(join(destDir, 'fetch-trace.ndjson'))).toBe(true);
  });

  it('介质缺件 ⇒ 失败且不回退联网（issues 明说介质档）', () => {
    process.env[ENV_W] = mediaDir;
    const r = tryImportWeightFromMedia({ destDir, fileName: 'missing.bin', expectedSha256: goodSha });
    expect(r).not.toBeNull();          // 非 null = 已拦截，不会继续去联网
    expect(r?.ok).toBe(false);
    expect(r?.issues.join()).toContain('介质缺件');
    expect(existsSync(join(destDir, 'missing.bin'))).toBe(false);
  });

  it('介质件 sha 不符 ⇒ 失败、不落盘', () => {
    process.env[ENV_W] = mediaDir;
    const r = tryImportWeightFromMedia({ destDir, fileName: 'model.safetensors', expectedSha256: sha('other') });
    expect(r?.ok).toBe(false);
    expect(r?.issues.join()).toContain('sha256 不符');
    expect(existsSync(join(destDir, 'model.safetensors'))).toBe(false);
  });

  it('介质目录不可读 ⇒ 失败（不静默当作非介质档）', () => {
    process.env[ENV_W] = join(root, 'nope');
    const r = tryImportWeightFromMedia({ destDir, fileName: 'model.safetensors', expectedSha256: goodSha });
    expect(r?.ok).toBe(false);
    expect(r?.issues.join()).toContain('介质权重目录不可读');
  });

  it('fetchVersion 在介质档下先读介质（连非白名单 URL 也不再判来源违规）', async () => {
    process.env[ENV_W] = mediaDir;
    const r = await fetchVersion({
      url: 'https://example.invalid/not-whitelisted/model.safetensors',
      destDir,
      fileName: 'model.safetensors',
      expectedSha256: goodSha,
    });
    expect(r.ok).toBe(true);
    expect(r.trace.source).toBe('media');
  });

  it('fetchVersion 在非介质档下仍走白名单门（行为未被改写）', async () => {
    const r = await fetchVersion({
      url: 'https://example.invalid/not-whitelisted/model.safetensors',
      destDir,
      fileName: 'model.safetensors',
      expectedSha256: goodSha,
    });
    expect(r.ok).toBe(false);
    expect(r.issues.join()).toContain('不在白名单');
  });

  it('B 档便携运行时（SOFAGENT_WEIGHTS_DIR）同样被读取（此前只写不读）', () => {
    process.env.SOFAGENT_WEIGHTS_DIR = mediaDir;
    expect(mediaWeightsDir()).toBe(mediaDir);
    const r = tryImportWeightFromMedia({ destDir, fileName: 'model.safetensors', expectedSha256: goodSha });
    expect(r?.ok).toBe(true);
    expect(r?.trace.weightsSource).toBe('portable-runtime');
  });

  it('A 档优先于 B 档（安装器落位胜过便携运行时目录）', () => {
    process.env.SOFAGENT_WEIGHTS_DIR = join(root, 'nope');
    process.env[ENV_W] = mediaDir;
    expect(mediaWeightsDir()).toBe(mediaDir);
    expect(tryImportWeightFromMedia({ destDir, fileName: 'model.safetensors', expectedSha256: goodSha })?.trace.weightsSource).toBe('installer-media');
  });

  it('DSH 介质目录走同一套环境变量读取', () => {
    expect(mediaDshDir()).toBeNull();
    process.env[ENV_D] = join(root, 'media-dsh');
    expect(mediaDshDir()).toBe(join(root, 'media-dsh'));
  });
});
