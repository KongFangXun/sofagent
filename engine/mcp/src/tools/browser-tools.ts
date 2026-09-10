// ============================================================
// browser-tools.ts · Agentic Browser MCP 适配（自 mcp-server.ts 拆出）
// ============================================================
//
// v1.4.0 交付十：Playwright 惰性加载 + 视觉降级。
// browser-tools 的 BrowserSession 需要 Playwright driver——MCP 侧动态加载，
// Playwright 不可用时返回降级结果（不抛），对齐「视觉降级路径可用」验收。
// v1.4.7 质量循环：自 mcp-server.ts 拆出独立模块（S219 拆分充分性——
// 主文件只保留传输/协议骨架，browser 适配属于工具实现面）。
// ============================================================

import type { ToolResult } from './audit-tools';

type BrowserToolResult = ToolResult;

async function lazyBrowserSession(): Promise<{ session: { playwrightNavigate(u: string): Promise<unknown>; playwrightClick(s: string): Promise<unknown>; playwrightScreenshot(name?: string): Promise<unknown>; playwrightAssert(c: string): Promise<unknown> } } | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BrowserSession } = require('@sofagent/orchestrator');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { chromium } = require('playwright');
    if (!chromium) return null;
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const driver = {
      navigate: async (url: string) => {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        return { url: page.url(), title: await page.title(), status: 200 };
      },
      click: async (selector: string) => {
        await page.click(selector, { timeout: 5000 });
        return { clicked: true };
      },
      screenshot: async (name?: string) => {
        const p = `/tmp/sofagent-browser-${name ?? Date.now()}.png`;
        await page.screenshot({ path: p });
        return { imagePath: p, bytes: 0 };
      },
      assert: async (condition: string) => {
        const passed = await page.locator(condition).count().then((count: number) => count > 0).catch(() => false);
        return { passed, detail: passed ? `找到 ${condition}` : `未找到 ${condition}` };
      },
    };
    const session = new BrowserSession(driver, () => { /* MCP 场景审计留痕可后续接 decision-log */ });
    return { session };
  } catch {
    return null; // Playwright 未安装 → 降级
  }
}

export async function browserNavigate(url: string): Promise<BrowserToolResult> {
  const s = await lazyBrowserSession();
  if (!s) return { text: '[sofagent] 浏览器导航不可用——需安装 Playwright（npm i playwright && npx playwright install chromium）。已返回降级结果。', data: { degraded: true, tool: 'playwright_navigate' } };
  try { return { text: '[sofagent] 浏览器导航（Playwright）', data: await s.session.playwrightNavigate(url) as Record<string, unknown> }; }
  catch (err) { return { text: `[sofagent] 浏览器导航失败：${err instanceof Error ? err.message : String(err)}`, data: { error: true } }; }
}
export async function browserClick(selector: string): Promise<BrowserToolResult> {
  const s = await lazyBrowserSession();
  if (!s) return { text: '[sofagent] 浏览器点击不可用——需安装 Playwright。已返回降级结果。', data: { degraded: true, tool: 'playwright_click' } };
  try { return { text: '[sofagent] 浏览器点击（Playwright）', data: await s.session.playwrightClick(selector) as Record<string, unknown> }; }
  catch (err) { return { text: `[sofagent] 浏览器点击失败：${err instanceof Error ? err.message : String(err)}`, data: { error: true } }; }
}
export async function browserScreenshot(name?: string): Promise<BrowserToolResult> {
  const s = await lazyBrowserSession();
  if (!s) return { text: '[sofagent] 浏览器截图不可用——需安装 Playwright。已返回降级结果。', data: { degraded: true, tool: 'playwright_screenshot' } };
  try { return { text: '[sofagent] 浏览器截图（Playwright）', data: await s.session.playwrightScreenshot(name) as Record<string, unknown> }; }
  catch (err) { return { text: `[sofagent] 浏览器截图失败：${err instanceof Error ? err.message : String(err)}`, data: { error: true } }; }
}
export async function browserAssert(condition: string): Promise<BrowserToolResult> {
  const s = await lazyBrowserSession();
  if (!s) return { text: '[sofagent] 浏览器断言不可用——需安装 Playwright。已返回降级结果。', data: { degraded: true, tool: 'playwright_assert' } };
  try { return { text: '[sofagent] 浏览器断言（Playwright）', data: await s.session.playwrightAssert(condition) as Record<string, unknown> }; }
  catch (err) { return { text: `[sofagent] 浏览器断言失败：${err instanceof Error ? err.message : String(err)}`, data: { error: true } }; }
}
