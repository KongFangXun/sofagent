// artifact-verify.ts · v1.4.1 块六 · 训练产物完整性校验（加载前阻断 + 篡改审计）
//
// 定位：model_register / 部署加载权重前的最后一道完整性闸门——重算逐文件
// SHA-256 与 artifact-manifest.json 比对，任何产物文件变动（改/删/加）或
// manifest 本身被篡改都返回 ok=false，调用方拿到 ok=false **不得挂载**。
//
// 判定分类（巡检报告四类，因果清晰排障）：
//   ok                 全部一致（可挂载）
//   tampered           产物文件内容变（sha256/size 失配——红色告警）
//   missing            manifest 登记的文件消失（被删/被挪）
//   unregistered       现场存在但 manifest 未登记的文件（产物目录被塞东西）
//   manifestTampered   manifest 本身 HMAC 失配（清单被改——单独归类，
//                      与产物篡改区分：前者攻击校验基准，后者攻击产物）
//   unverifiable       环境指纹漂移（换机器/密钥轮换——历史不可复验）
//
// artifact_tampered 审计：发现 tampered/missing/unregistered/manifestTampered
// 任一异常 → 写块三 train-audit 的 artifact_tampered 事件（union 已占位，
// enterpriseId 强制——块四隔离规则）。
//
// 本文件只导出函数（CLI 接线归 eng-deps 的 train verify 收尾波）。

import { existsSync, statSync, readdirSync, type Dirent } from 'fs';
import { join } from 'path';
import { createHmac } from 'crypto';
import { getEnvFingerprint, getHmacKey, stableStringify } from '@sofagent/core';
import { trainJobDir } from './train-job';
import {
  artifactManifestPath,
  loadArtifactManifest,
  hashArtifactFile,
  type ArtifactManifest,
  type ArtifactManifestBody,
} from './artifact-signing';
import { emitTrainAudit } from './train-audit';
import { loadTrainFingerprint } from './train-fingerprint';

// ════════════════════════════════════════
// 校验结果结构
// ════════════════════════════════════════

/** 单文件校验明细（巡检报告用——全部文件都列，不只异常） */
export interface ArtifactFileCheck {
  /** 相对 job 目录路径 */
  path: string;
  /** ok = hash+size 全匹配；tampered = 内容变；missing = 文件消失 */
  status: 'ok' | 'tampered' | 'missing';
  /** manifest 登记值 */
  expected: { sha256: string; sizeBytes: number };
  /** 现场实测值（missing 时为 null） */
  actual: { sha256: string; sizeBytes: number } | null;
}

/** manifest 完整性判定（单独归类——清单本身 vs 清单内容的篡改区分） */
export type ManifestIntegrity = 'valid' | 'manifestTampered' | 'unverifiable';

/** 巡检报告（结构化——CLI 巡检 / model_register 阻断共用） */
export interface ArtifactVerifyReport {
  trainJobId: string;
  enterpriseId: string;
  /**
   * 总闸门：false = 存在任何异常（tampered/missing/unregistered/
   * manifestTampered/unverifiable）——调用方拿到 ok=false 不得挂载。
   */
  ok: boolean;
  /** manifest 本身完整性（valid = 清单可信，清单内比对才有意义） */
  manifestIntegrity: ManifestIntegrity;
  /** 逐文件校验明细（manifestIntegrity=valid 时有意义；否则空数组） */
  files: ArtifactFileCheck[];
  /** 内容被篡改的文件（sha256 失配——红色） */
  tampered: string[];
  /** 登记过但消失的文件 */
  missing: string[];
  /** 现场有但 manifest 未登记的文件（产物目录被塞东西） */
  unregistered: string[];
  /** 指纹关联状态（manifest 引用的 fingerprintHmac 与现场指纹 hmac 比对） */
  fingerprintLinked: boolean;
  /** 拒绝挂载原因（ok=false 时必有——调用方直接展示给人） */
  rejectionReason: string | null;
  /** 判定说明（人读） */
  detail: string;
}

// ════════════════════════════════════════
// manifest 完整性（HMAC 复算——清单被改单独判定）
// ════════════════════════════════════════

/** 校验 manifest 本身 HMAC（区分：清单被改 / 环境漂移 / 清单可信） */
export function verifyManifestIntegrity(
  manifest: ArtifactManifest,
  dataDir: string,
): { integrity: ManifestIntegrity; detail: string } {
  const hmacKey = getHmacKey();
  if (!hmacKey) {
    return { integrity: 'unverifiable', detail: 'HMAC 密钥不可用（无法复验 manifest）' };
  }
  const currentEnvFingerprint = getEnvFingerprint(dataDir);
  if (manifest.envFingerprint !== currentEnvFingerprint) {
    return {
      integrity: 'unverifiable',
      detail: `环境指纹漂移（记录 ${manifest.envFingerprint} / 当前 ${currentEnvFingerprint}）——换机器或密钥轮换，manifest 不可复验`,
    };
  }
  // 复算 HMAC（签名输入 = body——排除三个链字段）
  const body: ArtifactManifestBody = {
    schemaVersion: manifest.schemaVersion,
    trainJobId: manifest.trainJobId,
    enterpriseId: manifest.enterpriseId,
    files: manifest.files,
    fingerprintHmac: manifest.fingerprintHmac,
    fingerprintFile: manifest.fingerprintFile,
    createdAt: manifest.createdAt,
  };
  const expected = createHmac('sha256', hmacKey)
    .update(stableStringify(body) + '|' + currentEnvFingerprint)
    .digest('hex')
    .slice(0, 32);
  if (manifest.manifestHmac !== expected) {
    return {
      integrity: 'manifestTampered',
      detail: `manifest HMAC 失配（记录 ${manifest.manifestHmac} / 复算 ${expected}）——校验基准清单本身被篡改`,
    };
  }
  return { integrity: 'valid', detail: 'manifest 签名有效（校验基准可信）' };
}

// ════════════════════════════════════════
// 主校验函数（verifyArtifacts——model_register 加载闸门）
// ════════════════════════════════════════

/**
 * 校验训练产物完整性（加载前调用——ok=false 时调用方不得挂载）。
 *
 * 流程：
 *   1. 读 manifest（不存在 → ok=false，拒绝原因「无签名清单」）
 *   2. manifest 本身 HMAC 校验（清单被改 → manifestTampered 单独归类，
 *      不再做清单内比对——基准不可信时比对无意义）
 *   3. 逐文件重算 sha256 比对（tampered / missing）
 *   4. 现场扫描 output/+checkpoints/ 对照 manifest（unregistered）
 *   5. 指纹关联校验（manifest.fingerprintHmac vs 现场指纹 hmac）
 *   6. 任一异常 → emitTrainAudit(artifact_tampered)（高严重度留痕）
 *
 * @param opts.dataDir 数据目录
 * @param opts.enterpriseId 企业标识（审计事件强制）
 * @param opts.trainJobId 任务标识
 * @param opts.dataSourceHash 审计事件携带的数据源 hash（缺省 'unknown'）
 */
export async function verifyArtifacts(opts: {
  dataDir: string;
  enterpriseId: string;
  trainJobId: string;
  /** 审计事件的数据源指纹（缺省 unknown——审计可读性优先） */
  dataSourceHash?: string;
}): Promise<ArtifactVerifyReport> {
  const { dataDir, enterpriseId, trainJobId } = opts;
  const jobDir = trainJobDir(dataDir, enterpriseId, trainJobId);
  const dataSourceHash = opts.dataSourceHash ?? 'unknown';

  // ── 1. manifest 存在性 ──
  const manifest = loadArtifactManifest(dataDir, enterpriseId, trainJobId);
  if (!manifest) {
    const manifestExists = existsSync(artifactManifestPath(dataDir, enterpriseId, trainJobId));
    const reason = manifestExists
      ? 'artifact-manifest.json 存在但解析失败（schema 损坏）——校验基准不可读'
      : 'artifact-manifest.json 不存在——产物未经签名（或签名后被删）';
    await emitTamperAudit(
      { dataDir, enterpriseId, trainJobId, dataSourceHash },
      reason,
      [],
    );
    return {
      trainJobId,
      enterpriseId,
      ok: false,
      manifestIntegrity: 'manifestTampered',
      files: [],
      tampered: [],
      missing: [],
      unregistered: [],
      fingerprintLinked: false,
      rejectionReason: `拒绝挂载：${reason}`,
      detail: reason,
    };
  }

  // ── 2. manifest 本身完整性 ──
  const integrity = verifyManifestIntegrity(manifest, dataDir);
  if (integrity.integrity !== 'valid') {
    await emitTamperAudit(
      { dataDir, enterpriseId, trainJobId, dataSourceHash },
      integrity.detail,
      [],
    );
    return {
      trainJobId,
      enterpriseId,
      ok: false,
      manifestIntegrity: integrity.integrity,
      files: [],
      tampered: [],
      missing: [],
      unregistered: [],
      fingerprintLinked: false,
      rejectionReason:
        integrity.integrity === 'manifestTampered'
          ? `拒绝挂载：${integrity.detail}`
          : `拒绝挂载：${integrity.detail}（保守拒绝——无法证明产物完整）`,
      detail: integrity.detail,
    };
  }

  // ── 3. 逐文件比对（tampered / missing） ──
  const files: ArtifactFileCheck[] = [];
  const tampered: string[] = [];
  const missing: string[] = [];
  for (const entry of manifest.files) {
    const absPath = join(jobDir, entry.path);
    if (!existsSync(absPath)) {
      files.push({
        path: entry.path,
        status: 'missing',
        expected: { sha256: entry.sha256, sizeBytes: entry.sizeBytes },
        actual: null,
      });
      missing.push(entry.path);
      continue;
    }
    const actual = await hashArtifactFile(absPath);
    const fileOk = actual.sha256 === entry.sha256 && actual.sizeBytes === entry.sizeBytes;
    files.push({
      path: entry.path,
      status: fileOk ? 'ok' : 'tampered',
      expected: { sha256: entry.sha256, sizeBytes: entry.sizeBytes },
      actual,
    });
    if (!fileOk) tampered.push(entry.path);
  }

  // ── 4. 现场未登记文件（output/+checkpoints/ 内 manifest 没有的） ──
  const registered = new Set(manifest.files.map((f) => f.path));
  const unregistered: string[] = [];
  for (const dirName of ['output', 'checkpoints']) {
    const dir = join(jobDir, dirName);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    for (const found of collectDirFiles(dir)) {
      const rel = `${dirName}/${found}`;
      if (!registered.has(rel)) unregistered.push(rel);
    }
  }

  // ── 5. 指纹关联 ──
  let fingerprintLinked = false;
  try {
    const fingerprint = loadTrainFingerprint(dataDir, enterpriseId, trainJobId);
    fingerprintLinked = fingerprint !== null && fingerprint.hmac === manifest.fingerprintHmac;
  } catch {
    fingerprintLinked = false; // 读取失败视为未关联（保守）
  }

  // ── 6. 汇总 + 拒绝原因 + 篡改审计 ──
  const anomalies: string[] = [];
  if (tampered.length > 0) anomalies.push(`${tampered.length} 个文件内容被篡改`);
  if (missing.length > 0) anomalies.push(`${missing.length} 个登记文件缺失`);
  if (unregistered.length > 0) anomalies.push(`${unregistered.length} 个未登记文件`);
  if (!fingerprintLinked) anomalies.push('指纹关联断裂');

  const ok = anomalies.length === 0;
  const detail = ok
    ? `产物完整（${manifest.files.length} 个文件全匹配，指纹已关联）`
    : `产物异常：${anomalies.join('；')}`;

  if (!ok) {
    await emitTamperAudit(
      { dataDir, enterpriseId, trainJobId, dataSourceHash },
      detail,
      [...tampered, ...missing, ...unregistered],
    );
  }

  return {
    trainJobId,
    enterpriseId,
    ok,
    manifestIntegrity: 'valid',
    files,
    tampered,
    missing,
    unregistered,
    fingerprintLinked,
    rejectionReason: ok ? null : `拒绝挂载：${detail}`,
    detail,
  };
}

// ════════════════════════════════════════
// 内部工具
// ════════════════════════════════════════

/** 递归收集目录文件相对路径（verify 侧——与 signing 侧同序规则） */
function collectDirFiles(rootDir: string, prefix = ''): string[] {
  const out: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(join(rootDir, prefix), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...collectDirFiles(rootDir, rel));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * 篡改审计（artifact_tampered——块三 union 占位的实装调用）。
 * 审计写失败降级不阻断校验结果返回（校验结论优先——留痕缺失由链
 * 校验 doctor 暴露）。
 */
async function emitTamperAudit(
  ctx: { dataDir: string; enterpriseId: string; trainJobId: string; dataSourceHash: string },
  reason: string,
  affectedFiles: string[],
): Promise<void> {
  try {
    emitTrainAudit(
      {
        type: 'artifact_tampered',
        trainJobId: ctx.trainJobId,
        enterpriseId: ctx.enterpriseId, // 🔴 强制——块四隔离审计规则
        dataSourceHash: ctx.dataSourceHash,
        hyperparams: {},
        reason: `产物完整性校验失败（拒绝挂载）：${reason}`,
        ...(affectedFiles.length > 0
          ? { rollback: { rollbackTo: null, quarantined: affectedFiles } } // 复用 rollback 字段承载受影响文件清单
          : {}),
      },
      ctx.dataDir,
    );
  } catch {
    // 审计失败不阻断校验（结果已得出——留痕降级）
  }
}
