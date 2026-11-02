// ============================================================
// f5-weights-remote.test.ts · F5.3 权重分发四条（S1 施工取证）
// ------------------------------------------------------------
// 判据 c：① 远端拉通且 sha256 落盘 ② 篡改一字节 ⇒ 拒绝启用并留痕
//         ③ 断网 ⇒ 显式报错、不静默回退 ④ 版本不符 ⇒ 拒绝启用
// 网络面：本测试起一个 **本机 HTTP 服务**（loopback）——走真 fetch 真 socket，
// 但不是公网远端；§二 回执须写明「loopback 而非公网」这一边界。
// ============================================================

import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendVersion, checkWeightsDir, fetchVersion, hashDir } from '../weights-manifest';

const GOOD = Buffer.from('sofa-s1m weight payload v1\n');
const GOOD_SHA = createHash('sha256').update(GOOD).digest('hex');
const TAMPERED = Buffer.from('sofa-s1m weight payload v2\n'); // 与 GOOD 差一个字符

describe('F5.3 · 权重分发四条', () => {
  let server: Server;
  let base = '';
  let root = '';

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'f5-weights-'));
    server = createServer((req, res) => {
      if (req.url === '/good.bin') {
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        res.end(GOOD);
      } else if (req.url === '/tampered.bin') {
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        res.end(TAMPERED);
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    server?.close();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('① 远端拉通：落盘 + .sha256 旁注 + fetch-trace 记 ok', async () => {
    const dest = join(root, 'case1');
    const r = await fetchVersion({ url: `${base}/good.bin`, destDir: dest, fileName: 'w.bin', expectedSha256: GOOD_SHA });
    expect(r.ok).toBe(true);
    expect(r.sha256).toBe(GOOD_SHA);
    expect(readFileSync(join(dest, 'w.bin'))).toEqual(GOOD);
    expect(readFileSync(join(dest, 'w.bin.sha256'), 'utf-8')).toContain(GOOD_SHA);
    const trace = readFileSync(join(dest, 'fetch-trace.ndjson'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
    expect(trace.at(-1).ok).toBe(true);
    expect(trace.at(-1).stage).toBe('done');
  });

  it('② 篡改一字节/内容不符 ⇒ 拒绝启用且不落盘、留痕为 verify 失败', async () => {
    const dest = join(root, 'case2');
    const r = await fetchVersion({ url: `${base}/tampered.bin`, destDir: dest, fileName: 'w.bin', expectedSha256: GOOD_SHA });
    expect(r.ok).toBe(false);
    expect(r.issues.join('；')).toContain('sha256 不符');
    expect(existsSync(join(dest, 'w.bin'))).toBe(false);
    const trace = readFileSync(join(dest, 'fetch-trace.ndjson'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
    expect(trace.at(-1).stage).toBe('verify');
    expect(trace.at(-1).actualSha256).not.toBe(GOOD_SHA);
  });

  it('③ 断网/不可达 ⇒ 显式报错、不静默回退（本地已有旧文件也不采用）', async () => {
    const dest = join(root, 'case3');
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'w.bin'), 'STALE-LOCAL-COPY'); // 预置旧文件：验证「不回退」
    // 127.0.0.1:1 在本机不会有人监听 ⇒ 连接被拒，等价于断网
    const r = await fetchVersion({ url: 'http://127.0.0.1:1/w.bin', destDir: dest, fileName: 'w.bin', expectedSha256: GOOD_SHA });
    expect(r.ok).toBe(false);
    expect(r.issues.join('；')).toContain('远端不可达');
    expect(r.issues.join('；')).toContain('不回退');
    expect(readFileSync(join(dest, 'w.bin'), 'utf-8')).toBe('STALE-LOCAL-COPY'); // 未被覆盖，也未被采用
    const trace = readFileSync(join(dest, 'fetch-trace.ndjson'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
    expect(trace.at(-1).stage).toBe('fetch');
  });

  it('④ 版本不符 ⇒ 拒绝启用（manifest.current 指向缺失版本 / 目录哈希不符）', () => {
    const dir = join(root, 'weights');
    const v1 = join(dir, 'v1');
    mkdirSync(v1, { recursive: true });
    writeFileSync(join(v1, 'model.bin'), GOOD);
    appendVersion(dir, { id: 'v1', createdAt: new Date().toISOString(), sha256: hashDir(v1), sizeBytes: GOOD.length, remote: { url: `${base}/good.bin`, sha256: GOOD_SHA } }, { model: 'p12-test' });
    expect(checkWeightsDir(dir, { verifyHash: true }).ok).toBe(true);

    // 版本不符 a：current 指向不存在的版本
    const mf = join(dir, 'manifest.json');
    const m = JSON.parse(readFileSync(mf, 'utf-8'));
    m.current = 'v999';
    writeFileSync(mf, JSON.stringify(m));
    const bad = checkWeightsDir(dir, { verifyHash: true });
    expect(bad.ok).toBe(false);
    expect(bad.issues.join('；')).toContain('不在 versions 列表内');

    // 版本不符 b：目录内容被改（哈希不符）
    m.current = 'v1';
    writeFileSync(mf, JSON.stringify(m));
    writeFileSync(join(v1, 'model.bin'), Buffer.concat([GOOD, Buffer.from('x')]));
    const bad2 = checkWeightsDir(dir, { verifyHash: true });
    expect(bad2.ok).toBe(false);
    expect(bad2.issues.join('；')).toContain('完整性校验失败');
  });
});
