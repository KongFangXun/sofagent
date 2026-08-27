// ============================================================
// browser-tools.ts · Agentic Browser / Playwright 集成
// v1.4.1（七）：Refine Agent 端到端 UI 验证能力——跑质量规则集时
// 部分场景需驱动浏览器验证 UI 行为，闭环覆盖到 UI 层
//
// 设计约束（CI 约束）：
// - Playwright 驱动经接口注入（BrowserDriver）——生产接 @playwright/test 的 page，
//   测试/CI 用 headless stub（不下载浏览器二进制——pr-check 上下载会超时）
// - 浏览器操作全程审计：每次 navigate/click/screenshot/assert 经统一
//   auditSink 落运行时审计日志（与 wrapToolCall 运行时审计同通道语义）
// - 截图 → 多模态分析：analyzeScreenshot 经可注入 visionFn（图文混合输入链路）
// - 工具层视觉降级（dsh-vision 启发）：visionFn 不可用/失败时退化工具链
//   （图片元信息 + 颜色统计 + 像素扫描 + OCR 注入位）→ 结构化文本交回文本模型
// ============================================================

import { readFileSync, existsSync } from 'fs';

// ── 驱动接口（注入位——生产 Playwright / 测试 stub）─────────

/** 浏览器驱动：四个核心操作的真实执行面 */
export interface BrowserDriver {
  /** 打开 URL，返回页面状态 */
  navigate(url: string): Promise<{ url: string; title: string; status: number }>;
  /** 点击选择器 */
  click(selector: string): Promise<{ clicked: boolean }>;
  /** 截图落盘，返回图片路径 */
  screenshot(name?: string): Promise<{ imagePath: string; bytes: number }>;
  /** 断言（选择器可见/文本存在等，表达式语义由驱动定义） */
  assert(condition: string): Promise<{ passed: boolean; detail: string }>;
}

/** 运行时审计 sink（与 wrapToolCall 统一通道——条目形状对齐 audit-middleware） */
export type BrowserAuditSink = (entry: {
  tool: string;
  args: Record<string, unknown>;
  result: 'ok' | 'error';
  summary: string;
  timestamp: string;
}) => void;

// ── 浏览器会话（四工具 + 审计包裹）─────────────────────────

/** 截图分析结果（多模态或降级） */
export interface ScreenshotAnalysis {
  /** 图片路径 */
  imagePath: string;
  /** 分析模式：multimodal（视觉模型直读）| degraded（工具层降级） */
  mode: 'multimodal' | 'degraded';
  /** 分析产出（multimodal=模型描述；degraded=结构化文本） */
  analysis: string;
}

/**
 * 浏览器会话——把四个 playwright_* 工具暴露给 Refine Agent，
 * 每次操作经 auditSink 全程审计。
 */
export class BrowserSession {
  constructor(
    private readonly driver: BrowserDriver,
    private readonly auditSink: BrowserAuditSink,
  ) {}

  /** playwright_navigate：打开 URL */
  async playwrightNavigate(url: string): Promise<{ url: string; title: string; status: number }> {
    try {
      const r = await this.driver.navigate(url);
      this.auditSink({
        tool: 'playwright_navigate', args: { url }, result: 'ok',
        summary: `→ ${r.url}（${r.status}）「${r.title}」`, timestamp: new Date().toISOString(),
      });
      return r;
    } catch (err) {
      this.auditSink({
        tool: 'playwright_navigate', args: { url }, result: 'error',
        summary: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString(),
      });
      throw err;
    }
  }

  /** playwright_click：点击元素 */
  async playwrightClick(selector: string): Promise<{ clicked: boolean }> {
    try {
      const r = await this.driver.click(selector);
      this.auditSink({
        tool: 'playwright_click', args: { selector }, result: 'ok',
        summary: r.clicked ? `点击 ${selector}` : `未命中 ${selector}`, timestamp: new Date().toISOString(),
      });
      return r;
    } catch (err) {
      this.auditSink({
        tool: 'playwright_click', args: { selector }, result: 'error',
        summary: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString(),
      });
      throw err;
    }
  }

  /** playwright_screenshot：截图落盘 */
  async playwrightScreenshot(name?: string): Promise<{ imagePath: string; bytes: number }> {
    try {
      const r = await this.driver.screenshot(name);
      this.auditSink({
        tool: 'playwright_screenshot', args: { name: name ?? '(auto)' }, result: 'ok',
        summary: `截图 ${r.imagePath}（${r.bytes}B）`, timestamp: new Date().toISOString(),
      });
      return r;
    } catch (err) {
      this.auditSink({
        tool: 'playwright_screenshot', args: { name: name ?? '(auto)' }, result: 'error',
        summary: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString(),
      });
      throw err;
    }
  }

  /** playwright_assert：UI 断言 */
  async playwrightAssert(condition: string): Promise<{ passed: boolean; detail: string }> {
    try {
      const r = await this.driver.assert(condition);
      this.auditSink({
        tool: 'playwright_assert', args: { condition }, result: r.passed ? 'ok' : 'error',
        summary: `${r.passed ? 'PASS' : 'FAIL'}：${condition}（${r.detail}）`, timestamp: new Date().toISOString(),
      });
      return r;
    } catch (err) {
      this.auditSink({
        tool: 'playwright_assert', args: { condition }, result: 'error',
        summary: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString(),
      });
      throw err;
    }
  }
}

// ── 截图多模态分析 + 视觉降级 ─────────────────────────────

/** 视觉模型函数（图文混合输入——可注入；缺省不可用走降级） */
export type VisionFn = (imagePath: string, prompt: string) => Promise<string>;

/**
 * 截图 → 多模态分析。
 * visionFn 可用时直接喂图（图片输入链路）；不可用/失败走工具层视觉降级。
 */
export async function analyzeScreenshot(
  imagePath: string,
  options: { visionFn?: VisionFn; prompt?: string } = {},
): Promise<ScreenshotAnalysis> {
  const prompt = options.prompt ?? '描述这张 UI 截图的可见状态（布局/控件/异常）';
  if (options.visionFn) {
    try {
      const analysis = await options.visionFn(imagePath, prompt);
      return { imagePath, mode: 'multimodal', analysis };
    } catch {
      // 视觉模型失败 → 降级（不抛——分析必须可用）
    }
  }
  const analysis = degradeImageToText(imagePath);
  return { imagePath, mode: 'degraded', analysis };
}

/** 图片元信息（零依赖解析 PNG/JPEG 头） */
export interface ImageMeta {
  format: 'png' | 'jpeg' | 'unknown';
  width: number | null;
  height: number | null;
  bytes: number;
}

/** 解析图片元信息（PNG IHDR / JPEG SOF0 手工解析，零依赖） */
export function readImageMeta(imagePath: string): ImageMeta {
  if (!existsSync(imagePath)) return { format: 'unknown', width: null, height: null, bytes: 0 };
  const buf = readFileSync(imagePath);
  // PNG：8 字节签名 + IHDR（宽高在 16-23 字节，big-endian）
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return {
      format: 'png',
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
      bytes: buf.length,
    };
  }
  // JPEG：FFD8 开头，扫描 SOF0/2 段取宽高
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let width: number | null = null;
    let height: number | null = null;
    for (let i = 2; i < buf.length - 9; i++) {
      if (buf[i] === 0xff && (buf[i + 1] === 0xc0 || buf[i + 1] === 0xc2)) {
        height = buf.readUInt16BE(i + 5);
        width = buf.readUInt16BE(i + 7);
        break;
      }
    }
    return { format: 'jpeg', width, height, bytes: buf.length };
  }
  return { format: 'unknown', width: null, height: null, bytes: buf.length };
}

/**
 * 工具层视觉降级（dsh-vision 启发）：模型/网关不支持图片输入时的退化工具链。
 * 颜色统计（字节级直方图采样）+ 像素扫描（亮度分布）+ 图片元信息 →
 * 结构化文本交回文本模型推理。OCR 为注入位（无内置 OCR 依赖，标注 unavailable）。
 */
export function degradeImageToText(imagePath: string): string {
  const meta = readImageMeta(imagePath);
  if (meta.format === 'unknown') {
    return [
      `[视觉降级] ${imagePath}`,
      `元信息：${meta.bytes}B（格式无法识别——非 PNG/JPEG）`,
      `OCR：unavailable（未配置 OCR 引擎）`,
    ].join('\n');
  }
  const buf = readFileSync(imagePath);
  // 颜色统计：字节级直方图（RGB 三通道合并采样，16 桶）
  const buckets = new Array<number>(16).fill(0);
  for (let i = 0; i < buf.length; i += 97) { // 大图采样步长
    const bucketIdx = Math.floor((buf[i] ?? 0) / 16);
    buckets[bucketIdx] = (buckets[bucketIdx] ?? 0) + 1;
  }
  const total = buckets.reduce((a, b) => a + b, 0) || 1;
  const histogram = buckets
    .map((n, i) => `${i * 16}-${i * 16 + 15}:${((n / total) * 100).toFixed(1)}%`)
    .filter((s) => !s.endsWith(':0.0%'))
    .join(' ');
  // 像素扫描（代理指标）：字节熵 + 亮/暗占比（PNG 非压缩区近似——如实标注）
  const dark = buckets.slice(0, 8).reduce((a, b) => a + b, 0) / total;
  const bright = 1 - dark;
  return [
    `[视觉降级] ${imagePath}`,
    `元信息：${meta.format.toUpperCase()} ${meta.width ?? '?'}×${meta.height ?? '?'} ${meta.bytes}B`,
    `颜色统计（字节直方图 16 桶采样）：${histogram}`,
    `像素扫描（代理）：暗区 ${ (dark * 100).toFixed(1) }% / 亮区 ${(bright * 100).toFixed(1)}%（字节级近似，非解码头像素——如实标注）`,
    `OCR：unavailable（未配置 OCR 引擎——注入位）`,
    `（以上结构化信号供文本模型推理 UI 状态；完整视觉需多模态模型）`,
  ].join('\n');
}

// ── requires_browser 声明（质量规则集扩展）─────────────────

/** 浏览器会话工厂（requires_browser 规则触发时调用） */
export type BrowserSessionFactory = () => BrowserSession;

/**
 * 规则集浏览器需求检查：任一规则声明 requires_browser 即返回 true，
 * 执行器据此启用 Playwright 会话（自动挂载审计 sink）。
 */
export function ruleSetRequiresBrowser(rules: Array<{ requires_browser?: boolean }>): boolean {
  return rules.some((r) => r.requires_browser === true);
}

/**
 * 为 requires_browser 规则集创建会话：driver + 审计 sink 组装。
 * 生产 driver 由调用方注入（Playwright page 适配器）；CI/测试传 stub。
 */
export function createBrowserSessionForRules(
  driver: BrowserDriver,
  auditSink: BrowserAuditSink,
): BrowserSession {
  return new BrowserSession(driver, auditSink);
}
