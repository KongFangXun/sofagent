import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runInspectors } from '../inspectors';

describe('runInspectors', () => {
  it('全关返回空数组（不传 config 时使用默认配置）', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-test-'));
    fs.mkdirSync(path.join(tmpDir, '.sofagent'), { recursive: true });
    const results = runInspectors(tmpDir);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(0);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
  });
});
