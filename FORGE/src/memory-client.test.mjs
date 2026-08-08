// ============================================================
// memory-client.test.mjs · FORGE Memory 客户端测试（v1.3.0 交付 10 MA4）
//
// 覆盖：
//   - FORGE_MEMORY_BACKEND unset → 不启用（与 v1.2.9 行为一致）
//   - endpoint 不可达 → 优雅降级（warn + 空结果，不 crash）
//   - memory_search / memory_write 正常路径（mock server）
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'http';

import { getMemoryBackendEndpoint, memorySearch, memoryWrite, callMemoryTool } from './memory-client.mjs';

async function withEndpoint(endpoint, fn) {
  const saved = process.env.FORGE_MEMORY_BACKEND;
  process.env.FORGE_MEMORY_BACKEND = endpoint;
  try { return await fn(); }
  finally {
    if (saved === undefined) delete process.env.FORGE_MEMORY_BACKEND;
    else process.env.FORGE_MEMORY_BACKEND = saved;
  }
}

test('getMemoryBackendEndpoint: unset → null（缺省关闭）', () => {
  delete process.env.FORGE_MEMORY_BACKEND;
  assert.equal(getMemoryBackendEndpoint(), null);
  process.env.FORGE_MEMORY_BACKEND = '   ';
  assert.equal(getMemoryBackendEndpoint(), null);
  delete process.env.FORGE_MEMORY_BACKEND;
});

test('memorySearch: endpoint 不可达 → 空数组不 crash', async () => {
  await withEndpoint('http://127.0.0.1:1', async () => {
    const hits = await memorySearch('forge/fresh-eyes/a-check', 'test');
    assert.deepEqual(hits, []);
  });
});

test('memoryWrite: endpoint 不可达 → 返回 ok:false 不 crash', async () => {
  await withEndpoint('http://127.0.0.1:1', async () => {
    const r = await memoryWrite('forge/fresh-eyes/a-check', '发现内容');
    assert.equal(r.ok, false);
  });
});

test('callMemoryTool: mock server 正常响应', async () => {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      res.setHeader('content-type', 'application/json');
      if (parsed.tool === 'memory_search') {
        res.end(JSON.stringify({ ok: true, results: [{ content: '历史经验 A' }, { content: '历史经验 B' }] }));
      } else {
        res.end(JSON.stringify({ ok: true, data: { written: true } }));
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    await withEndpoint(`http://127.0.0.1:${port}`, async () => {
      const hits = await memorySearch('forge/fresh-eyes/a-check', 'test');
      assert.equal(hits.length, 2);
      assert.equal(hits[0].content, '历史经验 A');

      const w = await memoryWrite('forge/fresh-eyes/all', '本次发现');
      assert.equal(w.ok, true);
    });
  } finally {
    server.close();
  }
});

test('memorySearch: FORGE_MEMORY_BACKEND unset → 空数组（不发起请求）', async () => {
  delete process.env.FORGE_MEMORY_BACKEND;
  const hits = await memorySearch('forge/fresh-eyes/a-check', 'test');
  assert.deepEqual(hits, []);
});
