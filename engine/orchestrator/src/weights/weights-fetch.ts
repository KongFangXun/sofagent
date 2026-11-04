// ============================================================
// weights-fetch.ts · 下载件（v1.8.0 §五 主缺口：从远端拉权重）
// ============================================================
// fetchVersion 自 weights-manifest.ts 迁入（既有四条取证不迁不改），
// 在其上补齐四能力：断点续传 / 失败重试 / 进度回调 / 来源白名单。
//
// 来源白名单（SSOT §五「两个替代源具名在位」——可枚举常量，可配置内网镜像）：
//   主载域 huggingface.co 及其 LFS/CDN 域 + 替代源 hf-mirror / ModelScope。
//   非白名单源须显式开启（allowAnySource=true）且留痕（trace.sourcePolicy）。
// ============================================================
import { createHash } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, appendFileSync, unlinkSync } from 'fs';
import { join } from 'path';

/** 来源白名单（可枚举——SSOT 判据①「两源在白名单面可枚举」；内网镜像可配置增补） */
export const WEIGHTS_SOURCE_WHITELIST: readonly string[] = [
  'huggingface.co',        // 既定主载域（SSOT v1.8.0.md:300）
  'cdn-lfs.huggingface.co', // HF LFS/CDN（漏掉会把 cdn-lfs 下载判成非白名单源）
  'cdn-lfs-us-1.huggingface.co',
  'cdn-lfs.hf.co',
  'hf-mirror.com',         // 替代源①：反向代理
  'modelscope.cn',         // 替代源②：ModelScope 魔搭（同批第二份制品按回执判）
  'www.modelscope.cn',
];

/** 判 URL 宿主是否白名单内（file:// 本地介质不属 http 域判——离线导入走 sha256 同一套校验） */
export function isWhitelistedSource(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') return true; // 本地介质导入（SSOT §五「离线介质导入走同一套 sha256 校验」）
    // 本机回环放行：本机测试桩与局域内网镜像先例（白名单面向「远端公网源」）
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]') return true;
    return WEIGHTS_SOURCE_WHITELIST.includes(u.hostname);
  } catch {
    return false;
  }
}

/** 断点续传：已落盘的部分文件存在则续传（Range: bytes=偏移-） */
function partialOffset(dest: string): number {
  try {
    const st = statSync(dest + '.part');
    return st.size;
  } catch {
    return 0;
  }
}

/** 拉取结果（fail-closed：任何一步不成立都不落文件） */
export interface FetchResult {
  ok: boolean;
  /** 落盘路径（ok=true 时非空） */
  path?: string;
  /** 实测 sha256（ok=true 时非空） */
  sha256?: string;
  /** 失败原因（逐条，非空即 ok=false） */
  issues: string[];
  /** 留痕：本条写入 <destDir>/fetch-trace.ndjson 的同一对象 */
  trace: Record<string, unknown>;
}

function appendTrace(destDir: string, entry: Record<string, unknown>): void {
  try {
    mkdirSync(destDir, { recursive: true });
    appendFileSync(join(destDir, 'fetch-trace.ndjson'), JSON.stringify(entry) + '\n');
  } catch {
    /* 为何可静默：留痕失败不掩盖主结果——trace 字段仍随返回值给出 */
  }
}

/**
 * 从远端拉取一个权重文件并校验（F5.3 ①）。
 *
 * 纪律（三条，缺一即失败，全部 fail-closed）：
 *   · 网络不可达 ⇒ 显式报错，**不回退本地旧文件**（不得静默用陈旧权重）；
 *   · sha256 不符（含篡改一字节）⇒ **不落盘**、留痕、可拒绝启用；
 *   · 字节数不符（给了 expectedBytes 时）⇒ 同 sha 不符处理。
 */
export interface FetchVersionOpts {
  url: string;
  destDir: string;
  fileName: string;
  expectedSha256: string;
  expectedBytes?: number;
  timeoutMs?: number;
  /** 来源白名单：默认开（非白名单源拒收）；显式 allowAnySource=true 才放行且留痕 */
  allowAnySource?: boolean;
  /** 失败重试次数（默认 2——断网/5xx 重试，sha256 不符不重试） */
  retries?: number;
  /** 进度回调（已收字节 / 总字节|null） */
  onProgress?: (received: number, total: number | null) => void;
}

export async function fetchVersion(opts: FetchVersionOpts): Promise<FetchResult> {
  // §五 白名单门（fail-closed）：非白名单源且未显式开启 → 拒收留痕
  if (!isWhitelistedSource(opts.url) && !opts.allowAnySource) {
    const t = { ts: new Date().toISOString(), url: opts.url, ok: false, stage: 'source-policy', sourcePolicy: 'denied-not-whitelisted' };
    try { mkdirSync(opts.destDir, { recursive: true }); appendTrace(opts.destDir, t); } catch { /* 为何可静默：trace 尽力——拒绝结论随返回值给出，不因留痕失败改变判定 */ }
    return { ok: false, issues: [`来源 ${new URL(opts.url).hostname} 不在白名单（WEIGHTS_SOURCE_WHITELIST）——非白名单源须显式 allowAnySource=true 且留痕`], trace: t };
  }
  const retries = opts.retries ?? 2;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const r = await fetchVersionOnce(opts, attempt);
    if (r.ok) return r;
    // sha256 不符不重试（篡改与网络无关——重试只会掩盖攻击面）
    if (r.issues.some((i) => i.includes('sha256 不符'))) return r;
    lastErr = r;
  }
  return lastErr as FetchResult;
}

/** 单次拉取（重试的单元——白名单已在外层判过） */
async function fetchVersionOnce(opts: FetchVersionOpts, attempt: number): Promise<FetchResult> {
  const startedAt = new Date().toISOString();
  const dest = join(opts.destDir, opts.fileName);
  const baseTrace: Record<string, unknown> = {
    ts: startedAt,
    url: opts.url,
    dest,
    expectedSha256: opts.expectedSha256,
    expectedBytes: opts.expectedBytes ?? null,
  };
  let body: Buffer;
  try {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    if (opts.url.startsWith('file://')) {
      body = readFileSync(new URL(opts.url));
    } else if (/^https?:\/\//.test(opts.url)) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const dest0 = join(opts.destDir, opts.fileName);
        const offset = partialOffset(dest0);
        const res = await fetch(opts.url, {
          signal: ctl.signal,
          ...(offset > 0 ? { headers: { Range: `bytes=${offset}-` } } : {}),   // 断点续传
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const total = res.headers.get('content-length') ? Number(res.headers.get('content-length')) + offset : null;
        opts.onProgress?.(offset, total);
        const buf = Buffer.from(await res.arrayBuffer());
        // P1-5（review r2）：断点续传闭环——分段写 .part（崩溃可续），完成时在下方
        // 校验通过后 rename 为 dest；此前 .part 只读不写，续传从未生效（offset 恒 0）。
        const partPath = dest0 + '.part';
        if (offset > 0 && res.status === 206) {
          const prev = readFileSync(partPath);
          body = Buffer.concat([prev, buf]);
          writeFileSync(partPath, body); // 追加后的全量回写 .part（崩溃点后移）
        } else {
          writeFileSync(partPath, buf); // 首段落 .part
          body = buf;
        }
        opts.onProgress?.(body.length, total);
      } finally {
        clearTimeout(timer);
      }
    } else {
      throw new Error('URL 必须是 http(s):// 或 file://');
    }
  } catch (err) {
    // 断网/不可达：显式失败，不静默回退
    const trace = { ...baseTrace, ok: false, stage: 'fetch', error: err instanceof Error ? err.message : String(err) };
    appendTrace(opts.destDir, trace);
    return { ok: false, issues: [`远端不可达（${trace.error}）——显式失败，不回退本地权重`], trace };
  }

  const actual = createHash('sha256').update(body).digest('hex');
  if (actual !== opts.expectedSha256) {
    // 校验失败先清 .part（best-effort）：篡改件/坏件残留 .part 会误导下次断点续传
    //（续传拼出的仍是坏件）；unlink 失败仅留痕，不影响失败结论返回。
    try { unlinkSync(dest + '.part'); } catch { /* 无 .part 或不可删——跳过（非本次校验结论的一部分） */ }
    const trace = { ...baseTrace, ok: false, stage: 'verify', actualSha256: actual, bytes: body.length, cleanup: 'verify-failed-cleanup' };
    appendTrace(opts.destDir, trace);
    return {
      ok: false,
      issues: [`sha256 不符（期望 ${opts.expectedSha256}，实际 ${actual}）——拒绝启用，未落盘`],
      trace,
    };
  }
  if (opts.expectedBytes !== undefined && body.length !== opts.expectedBytes) {
    try { unlinkSync(dest + '.part'); } catch { /* 同上——坏件不残留续传面 */ }
    const trace = { ...baseTrace, ok: false, stage: 'verify-bytes', actualSha256: actual, bytes: body.length, cleanup: 'verify-failed-cleanup' };
    appendTrace(opts.destDir, trace);
    return { ok: false, issues: [`字节数不符（期望 ${opts.expectedBytes}，实际 ${body.length}）——拒绝启用`], trace };
  }

  mkdirSync(opts.destDir, { recursive: true });
  writeFileSync(dest, body);
  // P1-5：校验通过后清 .part（本次拉取完整落盘，残留 .part 会误导下次续传）
  try { (await import('fs')).unlinkSync(dest + '.part'); } catch { /* 为何可静默：无 .part 即跳过（不存在不是错误，删除目标为可选残留） */ }
  writeFileSync(`${dest}.sha256`, `${actual}  ${opts.fileName}\n`);
  const trace = { ...baseTrace, ok: true, stage: 'done', actualSha256: actual, bytes: body.length };
  appendTrace(opts.destDir, trace);
  return { ok: true, path: dest, sha256: actual, issues: [], trace };
}