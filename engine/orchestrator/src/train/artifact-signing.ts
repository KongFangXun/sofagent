// artifact-signing.ts · v1.4.3 块六 · 训练产物签名（权重逐文件 SHA-256 + manifest HMAC）
//
// 定位：训练产出的模型权重（adapter.safetensors / 量化权重）在落盘后到
// 被加载（model_register / 部署）之间，任何静默篡改都要可检测——「这个
// 权重还是训出来的那个权重吗」。与块五指纹的分工：fingerprint 冻结
// 「训练输入」（可复现口径），artifact manifest 冻结「训练输出」（完整性
// 口径）——两者经 fingerprintRef 双向关联（input↔output 可溯）。
//
// 签名结构：
//   逐文件 SHA-256（createReadStream 分块 update——GB 级权重不爆内存）
//     → manifest.files: [{path, sizeBytes, sha256}]
//     → manifestHmac = HMAC(sha256, key)(stableStringify(body) + '|' + envFingerprint).slice(0,32)
//     → artifact-manifest.json（job 目录，chmod 0o600）
//
// 与块五/块三同源纪律：
//   - 同 HMAC 密钥（~/.sofagent-key / SOFAGENT_KEY_PATH）、同环境指纹、
//     同 stableStringify、同 0o600 失败告警不阻断
//   - 宁缺毋滥：无 train-fingerprint.json 的 job 拒绝生成 manifest
//     （无指纹的产物不做完整性背书——校验链从输入到输出必须闭合）
//
// 验证侧（artifact-verify.ts）消费本文件的结构；篡改审计走块三
// train-audit 的 artifact_tampered 事件（union 已占位）。

import { createHash, createHmac } from 'crypto';
import { createReadStream, existsSync, statSync, mkdirSync, chmodSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { atomicWriteSync, getEnvFingerprint, getHmacKey, stableStringify } from '@sofagent/core';
import { trainJobDir } from './train-job';
import { trainFingerprintPath, loadTrainFingerprint } from './train-fingerprint';

// ════════════════════════════════════════
// manifest schema（zod——读侧校验，坏 manifest 判定损坏）
// ════════════════════════════════════════

/** 单产物文件条目 */
export const ArtifactFileEntrySchema = z
  .object({
    /** 相对 job 目录的路径（如 output/adapter.safetensors） */
    path: z.string().min(1),
    /** 文件字节数（size 变化即内容变化的前置信号） */
    sizeBytes: z.number().int().nonnegative(),
    /** 文件内容 SHA-256（hex） */
    sha256: z.string().length(64),
  })
  .strict();

/** manifest 主体（签名输入——不含 manifestHmac） */
export const ArtifactManifestBodySchema = z
  .object({
    /** manifest schema 版本 */
    schemaVersion: z.literal('v1'),
    /** 训练任务标识 */
    trainJobId: z.string().min(1),
    /** 企业标识 */
    enterpriseId: z.string().min(1),
    /** 产物文件清单（逐文件签名） */
    files: z.array(ArtifactFileEntrySchema).min(1),
    /** 指纹关联（train-fingerprint.json 的 hmac——input↔output 双向可溯） */
    fingerprintHmac: z.string().length(32),
    /** 指纹文件名（相对 job 目录——路径引用兜底） */
    fingerprintFile: z.string().min(1),
    /** 生成时间（ISO） */
    createdAt: z.string().min(1),
  })
  .strict();

/** 完整 manifest（body + 签名链字段） */
export const ArtifactManifestSchema = ArtifactManifestBodySchema.extend({
  /** manifest 整体 HMAC（body 全量签名——manifest 本身被改即失配） */
  manifestHmac: z.string().length(32),
  /** 环境指纹（三态判定依据） */
  envFingerprint: z.string().min(1),
  /** 签名算法标记 */
  hmacAlgo: z.literal('stable'),
});

export type ArtifactFileEntry = z.infer<typeof ArtifactFileEntrySchema>;
export type ArtifactManifestBody = z.infer<typeof ArtifactManifestBodySchema>;
export type ArtifactManifest = z.infer<typeof ArtifactManifestSchema>;

// ════════════════════════════════════════
// 错误类型
// ════════════════════════════════════════

/** manifest 生成失败（前置条件不满足/输入非法）——不写文件 */
export class ArtifactSigningError extends Error {
  constructor(message: string) {
    super(`[artifact-signing] ${message}`);
    this.name = 'ArtifactSigningError';
  }
}

/** manifest 写入失败（IO）——向上传播 */
export class ArtifactSigningWriteError extends Error {
  constructor(message: string, cause?: unknown) {
    super(
      `[artifact-signing] 写入失败: ${message}${cause instanceof Error ? `（${cause.message}）` : ''}`,
    );
    this.name = 'ArtifactSigningWriteError';
  }
}

// ════════════════════════════════════════
// 流式文件 SHA-256（大文件内存安全）
// ════════════════════════════════════════

/**
 * 流式计算单文件 SHA-256（createReadStream 分块 update）。
 * 与块三 computeDataSourceHash 的同步分块读不同——产物权重可达数 GB，
 * 流式异步读让事件循环不被长阻塞（巡检 CLI 场景多文件批量校验）。
 * 文件不存在/读失败返回 'unknown'（可审计占位——校验侧判不匹配）。
 */
export function hashArtifactFile(filePath: string): Promise<{ sha256: string; sizeBytes: number }> {
  return new Promise((resolve) => {
    try {
      const stat = statSync(filePath);
      if (!stat.isFile()) {
        resolve({ sha256: 'unknown', sizeBytes: 0 });
        return;
      }
      const hash = createHash('sha256');
      const stream = createReadStream(filePath, { highWaterMark: 1024 * 1024 }); // 1MB 块
      stream.on('data', (chunk: string | Buffer) => {
        // 未设 encoding——运行时恒为 Buffer；hash.update 接受两型（类型层兼容 @types/node 事件签名）
        hash.update(chunk);
      });
      stream.on('end', () => {
        resolve({ sha256: hash.digest('hex'), sizeBytes: stat.size });
      });
      stream.on('error', () => {
        resolve({ sha256: 'unknown', sizeBytes: stat.size });
      });
    } catch {
      resolve({ sha256: 'unknown', sizeBytes: 0 });
    }
  });
}

// ════════════════════════════════════════
// manifest 生成（签名侧）
// ════════════════════════════════════════

/** manifest 路径：job 目录 artifact-manifest.json（单一出口） */
export function artifactManifestPath(dataDir: string, enterpriseId: string, trainJobId: string): string {
  return join(trainJobDir(dataDir, enterpriseId, trainJobId), 'artifact-manifest.json');
}

/** 递归收集目录下全部文件相对路径（排序——确定性清单顺序） */
function collectFilesRel(rootDir: string, prefix = ''): string[] {
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(join(rootDir, prefix), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...collectFilesRel(rootDir, rel));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * 生成产物 manifest（训练完成后调用——逐文件签名 + 指纹关联）。
 *
 * 前置条件（宁缺毋滥——与块五口径一致）：
 *   1. 同 job 的 train-fingerprint.json 必须存在（无指纹的产物不做完整性
 *      背书——校验链 input→output 必须闭合），缺失时抛
 *      ArtifactSigningError 并明确指引
 *   2. 指纹文件可读且 hmac 有效（坏指纹同样拒绝）
 *
 * 扫描范围：job 目录下 output/ 与 checkpoints/ 子目录（训练产物规范落点）；
 * failed-artifacts/（块三回滚封存区）与 manifest/指纹/事件文件本身不签。
 *
 * 幂等语义：manifest 已存在时拒绝重新生成（签名冻结不可变——产物变动
 * 应走 verify 暴露而非重签覆盖；确需重签先人工删除）。
 */
export async function signArtifacts(input: {
  dataDir: string;
  enterpriseId: string;
  trainJobId: string;
  /** 生成时间（缺省当前——测试可注入固定值） */
  createdAt?: string;
}): Promise<ArtifactManifest> {
  const jobDir = trainJobDir(input.dataDir, input.enterpriseId, input.trainJobId);
  if (!existsSync(jobDir)) {
    throw new ArtifactSigningError(`job 目录不存在：${jobDir}`);
  }

  // ── 前置 1：指纹关联（无指纹拒绝生成——宁缺毋滥） ──
  const fingerprint = loadTrainFingerprint(input.dataDir, input.enterpriseId, input.trainJobId);
  if (!fingerprint) {
    throw new ArtifactSigningError(
      `拒绝生成 manifest：未找到 train-fingerprint.json（${trainFingerprintPath(input.dataDir, input.enterpriseId, input.trainJobId)}）——无指纹的产物不做完整性背书，请先冻结指纹（freezeTrainFingerprint）`,
    );
  }

  const manifestFile = artifactManifestPath(input.dataDir, input.enterpriseId, input.trainJobId);
  if (existsSync(manifestFile)) {
    throw new ArtifactSigningError(
      `manifest 已存在（签名冻结不可变）：${manifestFile}——产物变动应由 verify 暴露，确需重签请先人工删除`,
    );
  }

  // ── 扫描产物文件（output/ + checkpoints/——训练产物规范落点） ──
  const candidateDirs = ['output', 'checkpoints'];
  const relFiles: string[] = [];
  for (const dirName of candidateDirs) {
    const dir = join(jobDir, dirName);
    if (!existsSync(dir)) continue;
    for (const rel of collectFilesRel(dir)) {
      relFiles.push(`${dirName}/${rel}`);
    }
  }
  if (relFiles.length === 0) {
    throw new ArtifactSigningError(
      `job 目录无产物文件（output/ 与 checkpoints/ 均空或不存在）——无产物即无签名对象`,
    );
  }

  // ── 逐文件流式 SHA-256 ──
  const files: ArtifactFileEntry[] = [];
  for (const rel of relFiles) {
    const { sha256, sizeBytes } = await hashArtifactFile(join(jobDir, rel));
    files.push({ path: rel, sizeBytes, sha256 });
  }

  // ── manifest body + HMAC（与块五指纹同签名构造） ──
  const body: ArtifactManifestBody = {
    schemaVersion: 'v1',
    trainJobId: input.trainJobId,
    enterpriseId: input.enterpriseId,
    files,
    fingerprintHmac: fingerprint.hmac,
    fingerprintFile: 'train-fingerprint.json',
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  const parsed = ArtifactManifestBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ArtifactSigningError(
      `manifest 输入非法（拒绝签名）：${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；')}`,
    );
  }

  const envFingerprint = getEnvFingerprint(input.dataDir);
  const hmacKey = getHmacKey();
  if (!hmacKey) {
    throw new ArtifactSigningError(
      'HMAC 密钥不可用（~/.sofagent-key 缺失）——无法签名，拒绝生成无签名 manifest',
    );
  }
  const manifestHmac = createHmac('sha256', hmacKey)
    .update(stableStringify(body) + '|' + envFingerprint)
    .digest('hex')
    .slice(0, 32);

  const manifest: ArtifactManifest = {
    ...body,
    manifestHmac,
    envFingerprint,
    hmacAlgo: 'stable',
  };

  // ── 落盘 + 权限 ──
  try {
    mkdirSync(jobDir, { recursive: true }); // 已存在时无害（幂等）
    atomicWriteSync(manifestFile, JSON.stringify(manifest, null, 2));
  } catch (err) {
    throw new ArtifactSigningWriteError(`manifest 落盘失败 ${manifestFile}`, err);
  }
  try {
    chmodSync(manifestFile, 0o600);
  } catch (err) {
    // 权限失败告警不阻断（与块三/块五同语义）
    console.error(
      `[artifact-signing] manifest 权限设置失败: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return manifest;
}

/** 读取 manifest（不存在/坏数据返回 null——调用方判空） */
export function loadArtifactManifest(
  dataDir: string,
  enterpriseId: string,
  trainJobId: string,
): ArtifactManifest | null {
  const file = artifactManifestPath(dataDir, enterpriseId, trainJobId);
  if (!existsSync(file)) return null;
  try {
    const parsed = ArtifactManifestSchema.safeParse(JSON.parse(readFileSync(file, 'utf-8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
