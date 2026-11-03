// ============================================================
// usb-runtime.test.ts · v1.8.0 §五 USB B 档单测
// ------------------------------------------------------------
// 覆盖：ioMode 解析三源序（federation → env → 缺省 A-ram）/
// 权重定位段（manifest 在场设 env / 缺 manifest 留痕不阻断 /
// 无 weights 目录 = A 档纯引擎不设 env）。
// ============================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { setupPortableEnv, resolveUsbIoMode } from '../usb-runtime';

let dir: string;
// P2-4（review r2）：env 快照放 beforeEach 内逐用例重捕——顶层捕获发生在任何
// 用例跑之前（值=原始态），但用例间可能有别的文件改过 env；逐用例捕获/还原才精确
let savedData: string | undefined;
let savedOpenclaw: string | undefined;
let savedWeights: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'usb-rt-'));
  savedData = process.env.SOFAGENT_DATA;
  savedOpenclaw = process.env.OPENCLAW_HOME;
  savedWeights = process.env.SOFAGENT_WEIGHTS_DIR;
});
afterEach(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  for (const [k, v] of [['SOFAGENT_DATA', savedData], ['OPENCLAW_HOME', savedOpenclaw], ['SOFAGENT_WEIGHTS_DIR', savedWeights]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

describe('v1.8.0 §五 · usb.ioMode 三源解析序', () => {
  it('缺省 = A-ram（无 federation 无 env）', () => {
    delete process.env.SOFAGENT_USB_IOMODE;
    expect(resolveUsbIoMode({})).toBe('A-ram');
  });

  it('env 可设 B-self-extract（federation 未声明时）', () => {
    delete process.env.SOFAGENT_USB_IOMODE;
    process.env.SOFAGENT_USB_IOMODE = 'B-self-extract';
    expect(resolveUsbIoMode({})).toBe('B-self-extract');
  });

  it('federation.usb.ioMode 优先于 env', () => {
    process.env.SOFAGENT_USB_IOMODE = 'B-self-extract';
    expect(resolveUsbIoMode({ usb: { ioMode: 'A-ram' } })).toBe('A-ram');
  });

  it('非法值回退 A-ram（不抛错——fail-safe 到零残留档）', () => {
    expect(resolveUsbIoMode({ usb: { ioMode: 'C-what' } })).toBe('A-ram');
  });

  it('原文两档名互为别名：self-extract ⇒ B 档、media-run ⇒ A 档（配置了必生效，不静默落空）', () => {
    expect(resolveUsbIoMode({ usb: { ioMode: 'self-extract' } })).toBe('B-self-extract');
    expect(resolveUsbIoMode({ usb: { ioMode: 'media-run' } })).toBe('A-ram');
    delete process.env.SOFAGENT_USB_IOMODE;
    process.env.SOFAGENT_USB_IOMODE = 'self-extract';
    expect(resolveUsbIoMode({})).toBe('B-self-extract');
  });
});

describe('v1.8.0 §五 · 权重定位段（setupPortableEnv B 档）', () => {
  it('weights/manifest.json 在场 → SOFAGENT_WEIGHTS_DIR 指向它', () => {
    mkdirSync(join(dir, 'weights'));
    writeFileSync(join(dir, 'weights', 'manifest.json'), '{"schemaVersion":1}');
    setupPortableEnv(dir);
    expect(process.env.SOFAGENT_WEIGHTS_DIR).toBe(join(dir, 'weights'));
  });

  it('weights/ 存在但缺 manifest.json → 留痕 security-events、不设 env、不抛错', () => {
    mkdirSync(join(dir, 'weights'));
    setupPortableEnv(dir);
    expect(process.env.SOFAGENT_WEIGHTS_DIR).toBeUndefined();
    const events = readFileSync(join(dir, '.sofagent', 'security-events.jsonl'), 'utf-8');
    expect(events).toContain('weights-manifest-missing');
  });

  it('无 weights 目录（A 档纯引擎）→ 不设 env、不阻断', () => {
    setupPortableEnv(dir);
    expect(process.env.SOFAGENT_WEIGHTS_DIR).toBeUndefined();
    expect(process.env.SOFAGENT_DATA).toBe(join(dir, '.sofagent')); // 既有 env 照设
  });
});
