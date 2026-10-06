// ============================================================
// image-meta.ts · 图像元信息解析 + dsh-vision 视觉降级
// v1.3.9（七）随 Agentic Browser 交付，v1.5.7 章二起独立成模块：
// 浏览器实现底座（browser-tools.ts 四件套）退役删除，三件图像
// 能力属 dsh-vision 视觉降级本体、非四件套，先行迁出保留。
//
// 能力面（零依赖）：
// - readImageMeta：PNG IHDR / JPEG SOF0 手工头解析（宽高/字节）
// - degradeImageToText：颜色直方图采样 + 亮暗占比 + OCR 注入位
//   → 结构化文本交回文本模型推理（visionFn 不可用/失败时的退化链）
// - analyzeScreenshot：截图 → 多模态分析（visionFn 可用直读，
//   不可用/失败自动降级不抛——分析必须可用）
// ============================================================

import { readFileSync, existsSync } from 'fs';

// ── 截图多模态分析 + 视觉降级 ─────────────────────────────

/** 截图分析结果（多模态或降级） */
export interface ScreenshotAnalysis {
  /** 图片路径 */
  imagePath: string;
  /** 分析模式：multimodal（视觉模型直读）| degraded（工具层降级） */
  mode: 'multimodal' | 'degraded';
  /** 分析产出（multimodal=模型描述；degraded=结构化文本） */
  analysis: string;
}

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
