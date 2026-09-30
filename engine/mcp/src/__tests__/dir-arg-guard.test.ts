// ============================================================
// dir-arg-guard.test.ts · v1.5.5 批 20 · 目录类入参校验的失效模式锁
//
// 目的：把「越界/非法目录入参必须被拒」变成可重复的机械断言（批 20 判据：
// 传入越界目录时工具返回明确错误，而非写入成功）。三态齐备：
//   ① 正常态：合法路径通过（含「目标不存在但最近祖先可写」——允许按需创建）
//   ② 失效态：非法形态 / 越界 / 不可写 逐类必拒
//   ③ 缺省态：undefined 视为合法（可选入参缺省走调用方默认值）
// ============================================================
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkDirArg } from '../tools/dir-arg-guard';

describe('checkDirArg · 目录类入参校验', () => {
  it('① 合法路径通过：已存在目录 / 不存在但祖先可写 / 缺省 undefined', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dirguard-'));
    expect(checkDirArg(tmp, 'outDir').ok).toBe(true);
    expect(checkDirArg(path.join(tmp, 'a', 'b', 'c'), 'outDir').ok).toBe(true);  // 多层不存在 → 最近祖先 tmp 可写
    expect(checkDirArg(undefined, 'outDir').ok).toBe(true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('② 非法形态必拒：非字符串 / 空串 / NUL / 换行', () => {
    for (const [value, tag] of [[123, 'number'], [{}, 'object'], ['', 'empty'], ['   ', 'space'], ['/tmp/a\u0000b', 'nul'], ['/tmp/a\nb', 'newline']] as const) {
      const v = checkDirArg(value, 'dataDir');
      expect(v.ok, `${tag} 应被拒`).toBe(false);
      expect(v.reason && v.reason.length > 0, `${tag} 须给出原因`).toBe(true);
    }
  });

  it('③ 越界必拒：文件系统根 / 受保护系统目录', () => {
    expect(checkDirArg('/', 'outDir').ok).toBe(false);
    expect(checkDirArg('/etc', 'outDir').ok).toBe(false);
    expect(checkDirArg('/etc/sofagent-export', 'outDir').ok).toBe(false);   // 前缀命中亦拒
    expect(checkDirArg('/usr/local/share/x', 'outDir').ok).toBe(false);
  });

  it('④ 可写性必拒：最近已存在祖先不是目录（以文件为祖先）', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dirguard-'));
    const filePath = path.join(tmp, 'plain.txt');
    fs.writeFileSync(filePath, 'x');
    const v = checkDirArg(path.join(filePath, 'child'), 'outDir');
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('不是目录');
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
