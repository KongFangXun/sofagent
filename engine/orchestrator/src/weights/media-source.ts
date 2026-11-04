// ============================================================
// media-source.ts · 介质内读源（USB A 安装器档 · v1.8.0 L348 / F6.7 R7-3）
// ============================================================
// 为什么单独一个模块：`install.sh --media` 会把介质里的 weights/ 落位到
// `~/.sofagent/media/weights` 并 export `SOFAGENT_MEDIA_WEIGHTS`——但**落位不等于消费**。
// 权重真正的下载动作在 `weights-fetch.fetchVersion`：没有消费方时，安装仍会去联网拉权重，
// 判据原文「介质内**读源**替代联网下载」就不成立（这正是 R7-3 的缺口）。
//
// 语义（三条，缺一不可）：
//   ① 环境变量未设 ⇒ 返回 null，调用方按原路径联网（非介质档，行为不变）
//   ② 环境变量已设 ⇒ **只用介质**：目录不可读/缺件/sha 不符一律 fail-closed，
//      **不回退联网**（否则「介质档」与「联网档」无法从外部区分）
//   ③ 导入成功也要写 fetch-trace.ndjson（与联网路径同一份留痕，便于事后区分来源）
// ============================================================
import { createHash } from 'crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { FetchResult } from './weights-fetch';

/** 介质权重目录的环境变量名（install.sh 落位后 export；改这里必须同批改 install.sh 与文档） */
export const MEDIA_WEIGHTS_ENV = 'SOFAGENT_MEDIA_WEIGHTS';

/** 介质 DSH 节点目录的环境变量名（同上） */
export const MEDIA_DSH_ENV = 'SOFAGENT_MEDIA_DSH';

/**
 * B 档（便携运行时）权重目录的环境变量名：由 `engine/daemon/src/usb-runtime.ts` 在
 * USB 根下 `weights/manifest.json` 在场时写入。此前**全仓无读取方**（env-wiring 门禁报
 * 「只写不读」）——本模块是它的消费方：便携运行时同样不该联网拉权重。
 */
export const RUNTIME_WEIGHTS_ENV = 'SOFAGENT_WEIGHTS_DIR';

/** 读环境变量：空串视为未设置（`export FOO=` 与没写等价，避免把空路径当介质档） */
function envDir(v: string | undefined): string | null {
  return v && v.trim() !== '' ? v : null;
}

/**
 * 本地权重读源目录（null = 无本地读源，走联网）。
 *
 * 优先级：A 档安装器（`SOFAGENT_MEDIA_WEIGHTS`）> B 档便携运行时（`SOFAGENT_WEIGHTS_DIR`）。
 * 两者都是「权重已在本机」的场景，差别只在由谁落位（安装器 vs USB 运行时），故共用同一套
 * 读源语义（缺件/坏件 fail-closed，不回退联网）。
 */
export function mediaWeightsDir(): string | null {
  // 读方必须是**字面量** `process.env.SOFAGENT_*`：tools/check/check-env-wiring.mjs 按字面扫读方，
  // 写成 process.env[常量] 会被判「只写不读」（该门禁的意义正是防隐式间接）。
  return envDir(process.env.SOFAGENT_MEDIA_WEIGHTS) ?? envDir(process.env.SOFAGENT_WEIGHTS_DIR);
}

/** 当前读源来自哪一档（写进 trace，便于区分 A/B 档） */
export function weightsDirSource(): 'installer-media' | 'portable-runtime' | null {
  if (envDir(process.env.SOFAGENT_MEDIA_WEIGHTS) !== null) return 'installer-media';
  if (envDir(process.env.SOFAGENT_WEIGHTS_DIR) !== null) return 'portable-runtime';
  return null;
}

/** 介质 DSH 节点目录（null = 非介质档） */
export function mediaDshDir(): string | null {
  return envDir(process.env.SOFAGENT_MEDIA_DSH);
}

export interface MediaImportOpts {
  destDir: string;
  fileName: string;
  expectedSha256: string;
  expectedBytes?: number;
}

/**
 * 尝试从介质导入一个权重文件。
 *
 * @returns `null` —— 非介质档（未设 `SOFAGENT_MEDIA_WEIGHTS`），调用方继续联网下载；
 *          `FetchResult` —— 介质档：ok 表示已落盘；fail 表示**必须中止**（不回退联网）。
 */
export function tryImportWeightFromMedia(opts: MediaImportOpts): FetchResult | null {
  const dir = mediaWeightsDir();
  if (dir === null) return null;

  const src = join(dir, opts.fileName);
  const dest = join(opts.destDir, opts.fileName);
  const base: Record<string, unknown> = {
    ts: new Date().toISOString(),
    stage: 'media-source',
    mediaDir: dir,
    src,
    dest,
    expectedSha256: opts.expectedSha256,
  };
  const trace = (extra: Record<string, unknown>): Record<string, unknown> => {
    const t = { ...base, weightsSource: weightsDirSource(), ...extra };
    try {
      mkdirSync(opts.destDir, { recursive: true });
      appendFileSync(join(opts.destDir, 'fetch-trace.ndjson'), JSON.stringify(t) + '\n');
    } catch {
      /* 为何可静默：留痕失败不改变主结论（结论随返回值给出） */
    }
    return t;
  };

  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return {
      ok: false,
      issues: [`介质权重目录不可读：${dir}（介质档不回退联网——先重跑介质校验或修正 ${MEDIA_WEIGHTS_ENV}）`],
      trace: trace({ ok: false, error: 'media-dir-missing' }),
    };
  }
  if (!existsSync(src)) {
    return {
      ok: false,
      issues: [`介质缺件：${opts.fileName}（在 ${dir} 内未找到；介质档不回退联网）`],
      trace: trace({ ok: false, error: 'media-file-missing' }),
    };
  }

  const body = readFileSync(src);
  const actual = createHash('sha256').update(body).digest('hex');
  if (actual !== opts.expectedSha256) {
    return {
      ok: false,
      issues: [`介质件 sha256 不符：${opts.fileName}（期望 ${opts.expectedSha256.slice(0, 16)}… 实得 ${actual.slice(0, 16)}…）——拒绝落盘`],
      trace: trace({ ok: false, error: 'media-sha-mismatch', actualSha256: actual }),
    };
  }
  if (typeof opts.expectedBytes === 'number' && body.length !== opts.expectedBytes) {
    return {
      ok: false,
      issues: [`介质件字节数不符：${opts.fileName}（期望 ${opts.expectedBytes} 实得 ${body.length}）`],
      trace: trace({ ok: false, error: 'media-bytes-mismatch', bytes: body.length }),
    };
  }

  mkdirSync(opts.destDir, { recursive: true });
  writeFileSync(dest, body);
  return {
    ok: true,
    path: dest,
    sha256: actual,
    issues: [],
    trace: trace({ ok: true, source: 'media', sha256: actual, bytes: body.length }),
  };
}
