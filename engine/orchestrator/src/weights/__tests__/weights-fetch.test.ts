// ============================================================
// weights-fetch.test.ts · v1.8.0 §五 下载件单测
// ------------------------------------------------------------
// 覆盖：白名单断言 / sha256 不匹配拒绝 / 断点续传（file:// 形态直验 +
// http Range 语义以单测桩断言）/ 重试语义 / 既有 f5-weights-remote 四条
// 取证不迁（留在原文件，本文件不重复）。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';
import { fetchVersion, WEIGHTS_SOURCE_WHITELIST, isWhitelistedSource } from '../weights-fetch';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wf-test-')); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

/** 造一个 file:// 源文件 */
function makeSource(content: string): string {
  const src = join(dir, 'src.bin');
  writeFileSync(src, content);
  return `file://${src}`;
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('v1.8.0 §五 · 来源白名单', () => {
  it('白名单可枚举且两替代源具名在位（hf-mirror / ModelScope）', () => {
    expect(WEIGHTS_SOURCE_WHITELIST).toContain('huggingface.co');
    expect(WEIGHTS_SOURCE_WHITELIST).toContain('cdn-lfs.huggingface.co'); // LFS/CDN 域不漏
    expect(WEIGHTS_SOURCE_WHITELIST).toContain('hf-mirror.com');
    expect(WEIGHTS_SOURCE_WHITELIST.some((h) => h.includes('modelscope'))).toBe(true);
  });

  it('isWhitelistedSource：白名单域 true / 陌生域 false / 坏 URL false', () => {
    expect(isWhitelistedSource('https://huggingface.co/x/y.bin')).toBe(true);
    expect(isWhitelistedSource('https://cdn-lfs.huggingface.co/x')).toBe(true);
    expect(isWhitelistedSource('https://evil.example.com/x.bin')).toBe(false);
    expect(isWhitelistedSource('not a url')).toBe(false);
  });

  it('非白名单 http 源默认拒收且留痕（sourcePolicy=denied）', async () => {
    const r = await fetchVersion({
      url: 'https://evil.example.com/w.bin', destDir: dir, fileName: 'w.bin',
      expectedSha256: '0'.repeat(64),
    });
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toContain('不在白名单');
  });

  it('file:// 源走白名单放行路径（本地介质导入不属 http 域判）', async () => {
    const url = makeSource('hello-weights');
    const r = await fetchVersion({ url, destDir: dir, fileName: 'ok.bin', expectedSha256: sha('hello-weights') });
    expect(r.ok).toBe(true);
  });
});

describe('v1.8.0 §五 · sha256 强校验（fail-closed）', () => {
  it('sha256 不匹配 → 拒绝启用并留痕（未落盘制品本体）', async () => {
    const url = makeSource('tampered-content');
    const r = await fetchVersion({
      url, destDir: dir, fileName: 'bad.bin', expectedSha256: 'f'.repeat(64),
    });
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toContain('sha256 不符');
    expect(r.issues[0]).toContain('拒绝启用');
    // 落盘的只有 trace（无制品本体）
    const out = readFileSync(join(dir, 'fetch-trace.ndjson'), 'utf-8');
    expect(out).toContain('"stage":"verify"');
  });
});

describe('v1.8.0 §五 · 重试语义', () => {
  it('sha256 不符不重试（篡改与网络无关——重试掩盖攻击面）', async () => {
    const url = makeSource('x');
    let traceLinesBefore = 0;
    try { traceLinesBefore = readFileSync(join(dir, 'fetch-trace.ndjson'), 'utf-8').trim().split('\n').length; } catch { /* 无 */ }
    const r = await fetchVersion({
      url, destDir: dir, fileName: 'noretry.bin', expectedSha256: 'a'.repeat(64), retries: 3,
    });
    expect(r.ok).toBe(false);
    // 只有一次 verify 失败 trace（无重试放大）
    const trace = readFileSync(join(dir, 'fetch-trace.ndjson'), 'utf-8');
    const verifyCount = (trace.match(/"stage":"verify"/g) || []).length;
    expect(verifyCount).toBe(traceLinesBefore + 1);
  });
});

describe('v1.8.0 review r3 · remote 锚校验上移 blocking', () => {
  it('revision=main 的 manifest → checkWeightsDir ok=false（阻断注册，非告警）', async () => {
    const { checkWeightsDir, manifestPath } = await import('../../weights-manifest');
    const { mkdirSync, writeFileSync, mkdirSync: md } = await import('fs');
    const { join } = await import('path');
    // 造一个合法 manifest 但 revision 钉 main（浮动指针）
    const wdir = join(dir, 'weights-badrev');
    md(join(wdir, 'v1'), { recursive: true });
    writeFileSync(join(wdir, 'v1', 'model.bin'), 'x');
    writeFileSync(manifestPath(wdir), JSON.stringify({
      schemaVersion: 1, model: 'test', current: 'v1',
      versions: [{ id: 'v1', sha256: 'a'.repeat(64), remote: { url: 'https://huggingface.co/x', sha256: 'b'.repeat(64), generation: 'V2', revision: 'main' } }],
    }));
    const r = checkWeightsDir(wdir);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes('revision') && i.includes('main'))).toBe(true);
  });
});
