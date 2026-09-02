// model-downloader.ts · v1.4.4 章四 · 基座模型下载管理（断点续传 + 版本清单 + 磁盘空间预检）
//
// 定位：基座模型（Qwen3-8B/14B 等，十数 GB）下载 / 版本清单 / 断点续传
// ——train doctor 只查缓存，「没有时怎么拿到」是本文件的职责边界。
// 重试模式对齐 v1.2.5 daemon 推送重试（指数退避 + 上限放弃）。
//
// 断点续传实现（HTTP Range——对齐 v1.2.5 daemon 推送重试的工程模式）：
//   1. 下载前磁盘空间预检（HEAD Content-Length + statfs 可用空间——
//      空间不足结构化拒绝，不下一半崩）
//   2. .part 部分文件 + .part.meta 断点元数据（已收字节数 + url + etag）
//   3. 每次续传带 Range: bytes=<已收>-（服务端 206 续传；200 全量重下兜底）
//   4. 完成后原子 rename .part → 最终文件 + 写版本清单 models.json
//
// 版本清单：{dataDir}/models/<name>/model-manifest.json（模型名 / 来源
// url / sha256（可选）/ 大小 / 下载时间）——train doctor 与 train job
// 环境引用的缓存判据。
//
// 可测试性：HTTP 层（fetchRange）与磁盘层（statFreeSpace）全部依赖注入
// ——单测零真实下载零真实大文件（对齐 train-env ExecFn 模式）。

import { existsSync, mkdirSync, statSync, writeFileSync, renameSync, readFileSync, appendFileSync, openSync, closeSync, statfsSync } from 'fs';
import { join, dirname } from 'path';
import { atomicWriteSync } from '@sofagent/core';

// ══════════════════════════════════════
// 依赖注入接口（测试零真实网络零真实大文件）
// ══════════════════════════════════════

/** Range 请求响应（fetchRange 的归一形态） */
export interface RangeResponse {
  /** HTTP 状态（200 全量 / 206 续传） */
  status: number;
  /** 响应体字节（Buffer——生产流式追加；测试注入固定分片） */
  chunk: Buffer;
  /** 资源总大小（Content-Length 或 Content-Range total；未知 null） */
  totalSize: number | null;
}

/**
 * 可注入的 Range 拉取函数——下载的唯一 IO 出口。
 * 语义：请求从 offset 开始的字节流；200 = 服务器不支持 Range（全量），
 * 206 = 正常续传。默认实现 node:fetch + Range 头。
 */
export type FetchRangeFn = (url: string, offset: number) => Promise<RangeResponse>;

/**
 * 默认 FetchRangeFn：node:fetch 带 Range 头。
 * 206 → chunk 为续传段；200 → chunk 为全量（调用方从 offset=chunk 全量
 * 重写的语义处理——downloader 内部统一）。大文件分片拉取：每次拉固定
 * 32MB 减小测试与内存峰值（Range 上界 offset+CHUNK-1）。
 */
export const DEFAULT_CHUNK_BYTES = 32 * 1024 * 1024;

export function makeDefaultFetchRange(chunkBytes = DEFAULT_CHUNK_BYTES): FetchRangeFn {
  return async (url: string, offset: number): Promise<RangeResponse> => {
    const upper = offset + chunkBytes - 1;
    const res = await fetch(url, {
      headers: { Range: `bytes=${offset}-${upper}` },
    });
    const buf = Buffer.from(await res.arrayBuffer());
    let totalSize: number | null = null;
    if (res.status === 206) {
      const cr = res.headers.get('content-range'); // bytes start-end/total
      const m = /\/(\d+)$/.exec(cr ?? '');
      totalSize = m ? Number.parseInt(m[1] ?? '0', 10) : null;
    } else {
      totalSize = Number.parseInt(res.headers.get('content-length') ?? '', 10) || null;
    }
    return { status: res.status, chunk: buf, totalSize };
  };
}

/** 磁盘可用空间查询（字节；statfs 封装——可注入 mock） */
export type FreeSpaceFn = (dirPath: string) => number;

/** 默认实现：fs.statfs（bavail * bsize——POSIX/Node 均支持） */
export const defaultFreeSpace: FreeSpaceFn = (dirPath) => {
  try {
    const s = statfsSync(dirPath);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return Number.POSITIVE_INFINITY; // 查询失败按「不限制」——预检降级不阻断下载
  }
};

// ══════════════════════════════════════
// 版本清单（models manifest）
// ══════════════════════════════════════

/** 单模型版本清单（model-manifest.json） */
export interface ModelManifest {
  schemaVersion: 'v1';
  /** 模型名（目录名） */
  name: string;
  /** 下载来源 url */
  sourceUrl: string;
  /** 文件字节数 */
  sizeBytes: number;
  /** 内容指纹（来源头或计算；未知 null） */
  sha256: string | null;
  /** 下载完成时间（ISO） */
  downloadedAt: string;
}

/** 模型目录：{dataDir}/models/<name>/（doctor 查缓存同路径） */
export function modelDir(dataDir: string, name: string): string {
  return join(dataDir, 'models', name);
}

/** 模型权重文件路径（单文件形态 safetensors/bin；多文件模型打包为单包） */
export function modelFilePath(dataDir: string, name: string): string {
  return join(modelDir(dataDir, name), 'model.safetensors');
}

/** 版本清单路径 */
export function modelManifestPath(dataDir: string, name: string): string {
  return join(modelDir(dataDir, name), 'model-manifest.json');
}

/** 断点元数据（.part.meta——续传状态） */
export interface PartMeta {
  url: string;
  receivedBytes: number;
  totalSize: number | null;
  updatedAt: string;
}

/** .part 与 .part.meta 路径 */
export function partPaths(dataDir: string, name: string): { part: string; meta: string } {
  return {
    part: `${modelFilePath(dataDir, name)}.part`,
    meta: `${modelFilePath(dataDir, name)}.part.meta`,
  };
}

/** 读断点元数据（不存在/坏数据 → null——从头下载） */
export function readPartMeta(dataDir: string, name: string): PartMeta | null {
  const { meta } = partPaths(dataDir, name);
  if (!existsSync(meta)) return null;
  try {
    const parsed = JSON.parse(readFileSync(meta, 'utf-8')) as PartMeta;
    if (typeof parsed.receivedBytes === 'number' && typeof parsed.url === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/** 写断点元数据（每次分片落盘后更新） */
function writePartMeta(dataDir: string, name: string, meta: PartMeta): void {
  const { meta: metaPath } = partPaths(dataDir, name);
  atomicWriteSync(metaPath, JSON.stringify(meta));
}

// ══════════════════════════════════════
// 磁盘空间预检
// ══════════════════════════════════════

/** 预检结论 */
export interface DiskPreflightResult {
  ok: boolean;
  freeBytes: number;
  needBytes: number;
  message: string;
}

/**
 * 磁盘空间预检：需求 = totalSize − 已收（续传只查增量）+ 5% 膨胀余量。
 * totalSize 未知（服务器不给长度）→ 跳过预检（ok=true 标注）。
 */
export function preflightDiskSpace(
  dirPath: string,
  totalSize: number | null,
  receivedBytes: number,
  freeSpaceFn: FreeSpaceFn = defaultFreeSpace,
): DiskPreflightResult {
  if (totalSize === null || !Number.isFinite(totalSize) || totalSize <= 0) {
    return {
      ok: true,
      freeBytes: freeSpaceFn(dirPath),
      needBytes: 0,
      message: '资源总大小未知——跳过空间预检（下载中按实际增量落盘）',
    };
  }
  const remaining = Math.max(0, totalSize - receivedBytes);
  const need = Math.ceil(remaining * 1.05);
  const free = freeSpaceFn(dirPath);
  if (free >= need) {
    return {
      ok: true,
      freeBytes: free,
      needBytes: need,
      message: `空间充足：剩余需 ${need} bytes，可用 ${free} bytes（含 5% 余量）`,
    };
  }
  return {
    ok: false,
    freeBytes: free,
    needBytes: need,
    message: `磁盘空间不足：剩余需 ${need} bytes，可用仅 ${free} bytes——清理 {dataDir}/models/ 后重试`,
  };
}

// ══════════════════════════════════════
// 下载主流程（断点续传）
// ══════════════════════════════════════

/** 下载入参 */
export interface DownloadModelInput {
  dataDir: string;
  /** 模型名（目录名——doctor 候选清单口径一致） */
  name: string;
  /** 下载 url（直链权重文件） */
  url: string;
  /** 依赖注入（缺省 node:fetch Range 实现） */
  fetchRange?: FetchRangeFn;
  freeSpaceFn?: FreeSpaceFn;
  /** 最大重试次数（分片级——对齐 v1.2.5 推送重试 3 次语义；缺省 3） */
  maxRetries?: number;
  /** 重试退避基数 ms（缺省 1000；测试注 0 提速） */
  retryBaseDelayMs?: number;
  /** 时钟（测试可注入固定值） */
  now?: () => number;
  /** 进度回调（每分片一次——IM 桥/daemon 推送消费） */
  onProgress?: (received: number, total: number | null) => void;
}

/** 下载结果 */
export interface DownloadModelResult {
  ok: boolean;
  /** 最终文件路径（失败时 null） */
  filePath: string | null;
  /** 版本清单（成功时写入） */
  manifest: ModelManifest | null;
  /** 本次会话新收字节数（续传增量——进度报表用） */
  receivedThisSession: number;
  /** 结构化失败信息（ok=false 时给） */
  error?: string;
}

/**
 * 下载基座模型（断点续传 + 磁盘预检 + 版本清单）。
 *
 * 流程：读断点 → 预检空间 → 分片循环（Range 拉 → 追加 .part → 更新
 * 断点元数据 → 进度回调；分片失败指数退避重试至上限）→ 完成后原子
 * rename + 写 model-manifest.json。
 * 已完整下载（manifest 存在）→ 幂等返回不重下。
 */
export async function downloadModel(input: DownloadModelInput): Promise<DownloadModelResult> {
  const { dataDir, name, url } = input;
  const fetchRange = input.fetchRange ?? makeDefaultFetchRange();
  const freeSpaceFn = input.freeSpaceFn ?? defaultFreeSpace;
  const maxRetries = input.maxRetries ?? 3;
  const baseDelay = input.retryBaseDelayMs ?? 1000;

  const dir = modelDir(dataDir, name);
  const finalPath = modelFilePath(dataDir, name);
  const { part, meta: metaPath } = partPaths(dataDir, name);

  // ── 幂等：已有版本清单（完整下载过）→ 直接返回 ──
  if (existsSync(modelManifestPath(dataDir, name))) {
    try {
      const manifest = JSON.parse(readFileSync(modelManifestPath(dataDir, name), 'utf-8')) as ModelManifest;
      return {
        ok: true,
        filePath: finalPath,
        manifest,
        receivedThisSession: 0,
      };
    } catch {
      // 清单损坏按未下载处理——重下
    }
  }

  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // ── 读断点（.part.meta——url 变更则作废重来） ──
  let partMeta = readPartMeta(dataDir, name);
  if (partMeta && partMeta.url !== url) {
    partMeta = null; // 换源重下（断点只对同一 url 有效）
    if (existsSync(part)) {
      // 断点作废——旧分片一并清零（防旧字节残留在 .part 里污染新下载）
      const fd = openSync(part, 'w');
      closeSync(fd);
    }
  }
  let received = partMeta?.receivedBytes ?? 0;
  const sessionStart = received;

  // ── 首次拉取（探总大小 + 空间预检） ──
  let totalSize: number | null = partMeta?.totalSize ?? null;
  if (totalSize === null) {
    let first: RangeResponse;
    try {
      first = await fetchRangeWithRetry(url, received, fetchRange, maxRetries, baseDelay);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, filePath: null, manifest: null, receivedThisSession: 0, error: `[model-downloader] ${msg}` };
    }
    totalSize = first.totalSize;
    const preflight = preflightDiskSpace(dir, totalSize, received, freeSpaceFn);
    if (!preflight.ok) {
      return { ok: false, filePath: null, manifest: null, receivedThisSession: 0, error: `[model-downloader] ${preflight.message}` };
    }
  }

  // ── 分片循环（append .part + 断点元数据 + 进度回调） ──
  const appendChunk = (chunk: Buffer): void => {
    appendFileSync(part, chunk);
    received += chunk.length;
    writePartMeta(dataDir, name, {
      url,
      receivedBytes: received,
      totalSize,
      updatedAt: new Date().toISOString(),
    });
  };

  while (totalSize === null || received < totalSize) {
    let res: RangeResponse;
    try {
      res = await fetchRangeWithRetry(url, received, fetchRange, maxRetries, baseDelay);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        filePath: null,
        manifest: null,
        receivedThisSession: received - sessionStart,
        error: `[model-downloader] ${msg}`,
      };
    }
    if (res.status !== 206 && res.status !== 200) {
      return {
        ok: false,
        filePath: null,
        manifest: null,
        receivedThisSession: received - sessionStart,
        error: `[model-downloader] 下载失败：HTTP ${res.status}（offset=${received}，重试 ${maxRetries} 次后放弃）`,
      };
    }
    if (res.status === 200 && received > 0) {
      // 服务器不支持 Range（回 200 全量）——作废断点重写
      received = 0;
      if (existsSync(part)) {
        // truncate 语义：删除重建
        const fd = openSync(part, 'w');
        closeSync(fd);
      }
    }
    if (totalSize === null && res.totalSize !== null) totalSize = res.totalSize;
    if (res.chunk.length === 0) break; // 拉空 = 尾部已到（防御：totalSize 缺失场景）
    appendChunk(res.chunk);
    input.onProgress?.(received, totalSize);
    if (res.chunk.length < DEFAULT_CHUNK_BYTES && totalSize === null) break; // 短分片 + 无总长 → 视为到尾
  }

  // ── 完整性核对（totalSize 已知时） ──
  if (totalSize !== null && received !== totalSize) {
    return {
      ok: false,
      filePath: null,
      manifest: null,
      receivedThisSession: received - sessionStart,
      error: `[model-downloader] 下载不完整：${received}/${totalSize} bytes（断点已存，重跑续传）`,
    };
  }

  // ── 完成：原子 rename + 版本清单 ──
  renameSync(part, finalPath);
  const manifest: ModelManifest = {
    schemaVersion: 'v1',
    name,
    sourceUrl: url,
    sizeBytes: statSync(finalPath).size,
    sha256: null,
    downloadedAt: new Date(input.now ? input.now() : Date.now()).toISOString(),
  };
  atomicWriteSync(modelManifestPath(dataDir, name), JSON.stringify(manifest, null, 2));
  if (existsSync(metaPath)) {
    try {
      renameSync(metaPath, `${metaPath}.done`); // 断点元数据留档（.done 后缀——审计可查下载轨迹）
    } catch {
      // 留档失败不阻断
    }
  }

  return { ok: true, filePath: finalPath, manifest, receivedThisSession: received - sessionStart };
}

/** 分片级带重试拉取（指数退避——对齐 v1.2.5 withRetry 模式） */
async function fetchRangeWithRetry(
  url: string,
  offset: number,
  fetchRange: FetchRangeFn,
  maxRetries: number,
  baseDelayMs: number,
): Promise<RangeResponse> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fetchRange(url, offset);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries - 1 && baseDelayMs > 0) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw new Error(
    `[model-downloader] 分片拉取重试 ${maxRetries} 次仍失败（offset=${offset}）：${lastError?.message ?? 'unknown'}`,
  );
}
