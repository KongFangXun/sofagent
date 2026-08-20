// ============================================================
// browser-tools.test.ts · Agentic Browser 测试（headless stub，零浏览器二进制）
// v1.3.9（七）：验收——四工具可用 / requires_browser 触发 / 审计写入 /
// 截图多模态链路 / 视觉降级
// ============================================================

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Buffer } from 'buffer';
import {
  BrowserSession,
  analyzeScreenshot,
  readImageMeta,
  degradeImageToText,
  ruleSetRequiresBrowser,
  createBrowserSessionForRules,
  type BrowserDriver,
  type BrowserAuditSink,
} from '../refine-agent/browser-tools';

// ── stub 驱动（CI 约束：不下载 Playwright 浏览器二进制）──

function makeStubDriver(): BrowserDriver {
  return {
    async navigate(url) { return { url, title: 'Stub Page', status: 200 }; },
    async click(selector) { return { clicked: selector !== '#missing' }; },
    async screenshot(name) {
      const p = path.join(os.tmpdir(), `sofagent-shot-${name ?? 'auto'}.png`);
      // 造一个最小合法 PNG 头（8 签名 + IHDR 宽高）供 meta 解析
      const png = Buffer.alloc(32);
      png.write('\x89PNG\r\n\x1a\n', 0, 'binary');
      png.writeUInt32BE(12, 8);        // IHDR 长度
      png.write('IHDR', 12, 'binary');
      png.writeUInt32BE(640, 16);      // width
      png.writeUInt32BE(480, 20);      // height
      fs.writeFileSync(p, png);
      return { imagePath: p, bytes: png.length };
    },
    async assert(condition) { return { passed: condition.includes('visible'), detail: `stub: ${condition}` }; },
  };
}

function makeAuditLog(): { sink: BrowserAuditSink; entries: Array<{ tool: string; result: string; summary: string }> } {
  const entries: Array<{ tool: string; result: string; summary: string }> = [];
  return {
    entries,
    sink: (e) => entries.push({ tool: e.tool, result: e.result, summary: e.summary }),
  };
}

describe('BrowserSession · 四核心工具', () => {
  it('playwright_navigate / click / screenshot / assert 全链路可用', async () => {
    const session = new BrowserSession(makeStubDriver(), makeAuditLog().sink);
    const nav = await session.playwrightNavigate('https://example.com');
    expect(nav.status).toBe(200);
    expect(nav.title).toBe('Stub Page');

    const click = await session.playwrightClick('#submit');
    expect(click.clicked).toBe(true);
    const miss = await session.playwrightClick('#missing');
    expect(miss.clicked).toBe(false);

    const shot = await session.playwrightScreenshot('login');
    expect(shot.imagePath).toContain('sofagent-shot-login.png');
    expect(shot.bytes).toBeGreaterThan(0);

    const pass = await session.playwrightAssert('button is visible');
    expect(pass.passed).toBe(true);
    const fail = await session.playwrightAssert('text exists');
    expect(fail.passed).toBe(false);
  });

  it('浏览器操作全程审计：每次操作一条审计记录（与 wrapToolCall 通道统一语义）', async () => {
    const { sink, entries } = makeAuditLog();
    const session = new BrowserSession(makeStubDriver(), sink);
    await session.playwrightNavigate('https://example.com');
    await session.playwrightClick('#submit');
    await session.playwrightScreenshot();
    await session.playwrightAssert('x visible');
    expect(entries).toHaveLength(4);
    expect(entries.map((e) => e.tool)).toEqual([
      'playwright_navigate', 'playwright_click', 'playwright_screenshot', 'playwright_assert',
    ]);
    expect(entries.every((e) => e.summary.length > 0)).toBe(true);
  });

  it('操作异常也落审计（result=error 不静默）', async () => {
    const { sink, entries } = makeAuditLog();
    const boomDriver: BrowserDriver = {
      ...makeStubDriver(),
      async navigate() { throw new Error('net::ERR_CONNECTION_REFUSED'); },
    };
    const session = new BrowserSession(boomDriver, sink);
    await expect(session.playwrightNavigate('https://down.test')).rejects.toThrow('ERR_CONNECTION_REFUSED');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.result).toBe('error');
    expect(entries[0]?.summary).toContain('ERR_CONNECTION_REFUSED');
  });
});

describe('requires_browser · 规则集声明', () => {
  it('任一规则声明 requires_browser 即触发', () => {
    expect(ruleSetRequiresBrowser([{ id: 'a' }, { id: 'b', requires_browser: true }])).toBe(true);
    expect(ruleSetRequiresBrowser([{ id: 'a' }, { id: 'b' }])).toBe(false);
    expect(ruleSetRequiresBrowser([])).toBe(false);
  });

  it('createBrowserSessionForRules 组装会话（driver + 审计 sink）', async () => {
    const { sink, entries } = makeAuditLog();
    const session = createBrowserSessionForRules(makeStubDriver(), sink);
    await session.playwrightNavigate('https://x.test');
    expect(entries).toHaveLength(1);
  });
});

describe('截图多模态分析与视觉降级', () => {
  it('visionFn 可用：多模态直读（图片输入链路）', async () => {
    const tmpPng = path.join(os.tmpdir(), 'sofagent-mm-test.png');
    const png = Buffer.alloc(32);
    png.write('\x89PNG\r\n\x1a\n', 0, 'binary');
    png.writeUInt32BE(12, 8);
    png.write('IHDR', 12, 'binary');
    png.writeUInt32BE(800, 16);
    png.writeUInt32BE(600, 20);
    fs.writeFileSync(tmpPng, png);
    const result = await analyzeScreenshot(tmpPng, {
      visionFn: async (p, prompt) => `vision(${p.slice(-20)}, ${prompt.slice(0, 10)}…): 登录页正常`,
    });
    expect(result.mode).toBe('multimodal');
    expect(result.analysis).toContain('登录页正常');
    fs.rmSync(tmpPng, { force: true });
  });

  it('visionFn 失败：自动降级不抛（degraded 结构化文本）', async () => {
    const tmpPng = path.join(os.tmpdir(), 'sofagent-degrade-test.png');
    const png = Buffer.alloc(1024, 0x80);
    png.write('\x89PNG\r\n\x1a\n', 0, 'binary');
    png.writeUInt32BE(12, 8);
    png.write('IHDR', 12, 'binary');
    png.writeUInt32BE(320, 16);
    png.writeUInt32BE(240, 20);
    fs.writeFileSync(tmpPng, png);
    const result = await analyzeScreenshot(tmpPng, {
      visionFn: async () => { throw new Error('vision gateway 502'); },
    });
    expect(result.mode).toBe('degraded');
    expect(result.analysis).toContain('PNG 320×240');
    fs.rmSync(tmpPng, { force: true });
  });

  it('readImageMeta：PNG 头解析（宽高/字节），JPEG 与未知格式', () => {
    const tmpPng = path.join(os.tmpdir(), 'meta-png.bin');
    const png = Buffer.alloc(32);
    png.write('\x89PNG\r\n\x1a\n', 0, 'binary');
    png.writeUInt32BE(12, 8);
    png.write('IHDR', 12, 'binary');
    png.writeUInt32BE(1024, 16);
    png.writeUInt32BE(768, 20);
    fs.writeFileSync(tmpPng, png);
    expect(readImageMeta(tmpPng)).toEqual({ format: 'png', width: 1024, height: 768, bytes: 32 });

    // JPEG SOF0
    const tmpJpg = path.join(os.tmpdir(), 'meta-jpg.bin');
    const jpg = Buffer.alloc(64, 0xab);
    jpg[0] = 0xff; jpg[1] = 0xd8;
    jpg[20] = 0xff; jpg[21] = 0xc0;          // SOF0 marker
    jpg.writeUInt16BE(720, 25);               // height
    jpg.writeUInt16BE(1280, 27);              // width
    fs.writeFileSync(tmpJpg, jpg);
    const jm = readImageMeta(tmpJpg);
    expect(jm.format).toBe('jpeg');
    expect(jm.width).toBe(1280);
    expect(jm.height).toBe(720);

    // 未知格式 + 不存在文件
    expect(readImageMeta('/nonexistent/x.png').format).toBe('unknown');
    fs.rmSync(tmpPng, { force: true });
    fs.rmSync(tmpJpg, { force: true });
  });

  it('degradeImageToText：颜色统计 + 亮暗扫描 + OCR 注入位标注', () => {
    const tmpPng = path.join(os.tmpdir(), 'degrade-full.png');
    // 半暗半亮的缓冲（前半 0x20 暗字节，后半 0xE0 亮字节）
    const png = Buffer.alloc(4096);
    png.fill(0x20, 0, 2048);
    png.fill(0xe0, 2048);
    png.write('\x89PNG\r\n\x1a\n', 0, 'binary');
    png.writeUInt32BE(12, 8);
    png.write('IHDR', 12, 'binary');
    png.writeUInt32BE(64, 16);
    png.writeUInt32BE(64, 20);
    fs.writeFileSync(tmpPng, png);
    const text = degradeImageToText(tmpPng);
    expect(text).toContain('[视觉降级]');
    expect(text).toContain('PNG 64×64');
    expect(text).toContain('颜色统计');
    expect(text).toContain('暗区');
    expect(text).toContain('OCR：unavailable');
    expect(text).toContain('非解码头像素——如实标注'); // 口径诚实标注
    fs.rmSync(tmpPng, { force: true });
  });
});
