// ============================================================
// upload-wal.ts · G11 数据上行 WAL 暂存 + 断点续传 + 加密上行（v1.5.0 T3）
// ============================================================
//
// 设备「推」数据的可靠性层：断网不丢、恢复续传、出设备加密。
//
// 设计决策（任务书 §二 T3 + changelog 三章）：
//   - WAL 语义复用 engine/orchestrator/src/durable/wal-writer.ts 的
//     协议形态（append-only JSONL / 坏行跳过 / 尾行补换行 / 0600 权限），
//     但 daemon 侧自实现、不跨包 import durable/——long-tasks.ts 同款
//     纪律（orchestrator devDependencies 有 daemon，跨包会循环）。
//   - WAL 文件独立：<dataDir>/upload-wal.jsonl（不占用 orchestrator 的
//     wal.jsonl——防 readUnfinishedWalEntries 把上行条目误当事务恢复）。
//   - 三段记录协议（对齐 durable WAL 的 begin/commit/abort）：
//       enqueue  载荷入队（断网暂存——落盘即不丢）
//       ack      平台确认收到（游标推进——已 ack 段不重传）
//       fail     上行失败（留在队列重试或人工处置）
//   - 断点续传游标：ackedSeq 单调递增。pendingUpgrades() 只取
//     seq > ackedSeq 的 enqueue 记录——已 ack 段天然不重传。
//   - 加密上行：enqueue 时即对脱敏后明文做 AES-256-GCM（复用 core
//     crypto/aes-gcm 的 encryptPayload——v1.2.0 联邦栈已交付的加解密面）。
//     密钥派生：HMAC 主密钥（.sofagent-key 同源）→ sha256 派生 32 字节
//     AES key（HMAC 与 AES 用途分离——直接复用 HMAC key 字节做 AES
//     密钥会跨用途密钥复用，派生一层是标准做法）。WAL 里只存密文——
//     明文不出内存、不落盘（「原始数据不出设备」的字面语义）。
//   - 计量：上行成功（ack）时 emitDecision（decision-log 是 worklog
//     聚合三源之一）——数据量/次数经 evidence 字段进 worklog/cost 视野。
// ============================================================

import { existsSync, readFileSync, appendFileSync, mkdirSync, statSync, chmodSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { createHash, randomBytes } from 'crypto';
import { getDataDir, getHmacKey, encryptPayload, decryptPayload } from '@sofagent/core';

/** 上行 WAL 文件相对路径（<dataDir>/upload-wal.jsonl） */
export const UPLOAD_WAL_FILE = 'upload-wal.jsonl';

/** 上行 WAL 记录类型：enqueue（入队暂存）/ ack（平台确认）/ fail（上行失败） */
export type UploadWalType = 'enqueue' | 'ack' | 'fail';

/** 上行 WAL 单条记录（JSONL 每行） */
export interface UploadWalRecord {
  /** 记录类型 */
  type: UploadWalType;
  /** 全局递增序号（enqueue 时分配——游标续传的锚点） */
  seq: number;
  /** 设备 ID（AgentIdentity.agentId） */
  deviceId: string;
  /** 数据类别（采集声明的 category；ack/fail 记录可缺省——它们作用于 seq 不作用于类别） */
  category?: string;
  /** 目的地（平台端点标识） */
  destination?: string;
  /** ISO 8601 时间戳 */
  ts: string;
  /** enqueue：载荷密文（AES-256-GCM，base64——明文不落盘） */
  ciphertext?: string;
  /** enqueue：GCM IV（base64——与密文配对） */
  iv?: string;
  /** enqueue：GCM 认证标签（base64） */
  tag?: string;
  /** enqueue：脱敏命中统计（审计/计量用——不含载荷内容） */
  redactHits?: number;
  /** enqueue：明文字节长度（计量用——密文长度不可回推） */
  payloadBytes?: number;
  /** ack：确认的 seq */
  ackedSeq?: number;
  /** fail：失败原因 */
  reason?: string;
}

/** WAL 文件路径（<dataDir>/upload-wal.jsonl） */
export function uploadWalPath(dataDir?: string): string {
  return join(getDataDir(dataDir), UPLOAD_WAL_FILE);
}

/**
 * 从 HMAC 主密钥派生上行加密 AES-256 密钥。
 *
 * 同源纪律：与审计链同一密钥文件（HOME 下 .sofagent-key，支持
 * SOFAGENT_KEY_PATH 覆盖——测试隔离同源）。派生而非直用：HMAC 与
 * AES 用途分离，sha256 派生一层（HKDF 单轮的简化形态——本版不引
 * crypto 模块外的依赖）。
 *
 * 无密钥 → null（调用方 fail-closed：不可加密 = 不可上行——
 * 「不加密的明文上行」不是可接受的降级态）。
 */
export function deriveUploadAesKey(): Buffer | null {
  const raw = getHmacKey();
  if (!raw || raw.length === 0) return null;
  return createHash('sha256').update(raw, 'utf-8').update('device-upload-aes-v1').digest();
}

/** 读 WAL 全部合法记录（坏行跳过——崩溃半行是典型形态，对齐 durable WalWriter.readAll） */
function readAllRecords(dataDir?: string): UploadWalRecord[] {
  const p = uploadWalPath(dataDir);
  if (!existsSync(p)) return [];
  const out: UploadWalRecord[] = [];
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec = JSON.parse(trimmed) as UploadWalRecord;
      if (rec && typeof rec.seq === 'number' && (rec.type === 'enqueue' || rec.type === 'ack' || rec.type === 'fail')) {
        out.push(rec);
      }
    } catch {
      /* 为何可静默：WAL 逐行回放的坏行跳过——单行损坏不阻断其余记录回放，seq 连续性由消费侧校验 */
    }
  }
  return out;
}

/** 分配下一个递增 seq（max(existing) + 1，起始 1） */
function nextSeq(dataDir?: string): number {
  const records = readAllRecords(dataDir);
  let max = 0;
  for (const r of records) {
    if (r.seq > max) max = r.seq;
  }
  return max + 1;
}

/** 追加一行（自动建目录 + 尾行换行补丁 + 0600——对齐 durable WalWriter.append） */
function appendRecord(record: UploadWalRecord, dataDir?: string): void {
  const p = uploadWalPath(dataDir);
  const dir = dirname(p);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  // 尾行完整性防御：末行无换行（崩溃半行）先补——本条不拼进坏行
  if (existsSync(p) && statSync(p).isFile()) {
    const content = readFileSync(p, 'utf-8');
    if (content.length > 0 && !content.endsWith('\n')) {
      appendFileSync(p, '\n', 'utf-8');
    }
  }
  appendFileSync(p, JSON.stringify(record) + '\n', 'utf-8');
  try {
    chmodSync(p, 0o600);
  } catch {
    /* 为何可静默：非 POSIX 平台（Windows）无 chmod 语义，0o600 权限收紧为尽力而为，失败不阻断写入主流程 */
  }
}

/** 入队结果 */
export interface EnqueueUploadResult {
  ok: boolean;
  /** WAL 序号（ok=true 时有值——ack 时引用） */
  seq?: number;
  reason?: 'no-aes-key' | 'invalid-params';
  message: string;
}

/**
 * 载荷入队（断网暂存 + 出设备加密）。
 *
 * 流程：明文（调用方已脱敏）→ AES-256-GCM 加密 → 密文落 WAL。
 * 明文不落盘、不进 WAL——「原始数据不出设备」在存储面的字面语义。
 *
 * fail-closed：无 HMAC 密钥（→ 无 AES key）→ 拒绝入队（不可加密 =
 * 不可上行，不做明文降级）。参数缺失 → invalid-params。
 *
 * @param deviceId 设备 ID
 * @param category 数据类别（采集声明内）
 * @param redactedPayload 已脱敏明文（redact() 产物）
 * @param opts.redactHits 脱敏命中数（计量面）
 * @param opts.destination 目的地（透传声明核对）
 */
export function enqueueUpload(
  deviceId: string,
  category: string,
  redactedPayload: string,
  opts: { redactHits?: number; destination?: string; dataDir?: string; nowIso?: string } = {},
): EnqueueUploadResult {
  if (!deviceId || !category || typeof redactedPayload !== 'string') {
    return { ok: false, reason: 'invalid-params', message: 'deviceId / category / payload 参数缺失' };
  }
  const aesKey = deriveUploadAesKey();
  if (!aesKey) {
    return { ok: false, reason: 'no-aes-key', message: '无 HMAC 主密钥——无法派生上行加密密钥（fail-closed：不加密不上行）' };
  }
  const enc = encryptPayload(aesKey, Buffer.from(redactedPayload, 'utf-8'));
  const seq = nextSeq(opts.dataDir);
  appendRecord(
    {
      type: 'enqueue',
      seq,
      deviceId,
      category,
      ...(opts.destination ? { destination: opts.destination } : {}),
      ts: opts.nowIso ?? new Date().toISOString(),
      ciphertext: enc.ciphertext.toString('base64'),
      iv: enc.iv.toString('base64'),
      tag: enc.tag.toString('base64'),
      redactHits: opts.redactHits ?? 0,
      payloadBytes: Buffer.byteLength(redactedPayload, 'utf-8'),
    },
    opts.dataDir,
  );
  return { ok: true, seq, message: '已入队暂存（加密落盘）' };
}

/**
 * 平台确认收到（游标推进——已 ack 段不重传）。
 *
 * ackedSeq 语义：≤ ackedSeq 的 enqueue 均已确认。ack 记录本身
 * 也落 WAL（审计面：何时确认了多少段）。
 */
export function ackUpload(
  ackedSeq: number,
  opts: { deviceId: string; dataDir?: string; nowIso?: string } = { deviceId: '' },
): { ok: boolean; message: string } {
  if (typeof ackedSeq !== 'number' || !Number.isFinite(ackedSeq) || ackedSeq < 1) {
    return { ok: false, message: 'ackedSeq 非法' };
  }
  const seq = nextSeq(opts.dataDir);
  appendRecord(
    {
      type: 'ack',
      seq,
      deviceId: opts.deviceId,
      ts: opts.nowIso ?? new Date().toISOString(),
      ackedSeq,
    },
    opts.dataDir,
  );
  return { ok: true, message: `已确认至 seq=${ackedSeq}（此段不再重传）` };
}

/** 上行失败记录（留在队列——下轮重试或人工处置） */
export function failUpload(
  seq: number,
  reason: string,
  opts: { deviceId: string; dataDir?: string; nowIso?: string } = { deviceId: '' },
): void {
  appendRecord(
    {
      type: 'fail',
      seq: nextSeq(opts.dataDir),
      deviceId: opts.deviceId,
      ts: opts.nowIso ?? new Date().toISOString(),
      ...(seq ? { ackedSeq: undefined, reason: `${reason}（原 seq=${seq}）` } : { reason }),
    },
    opts.dataDir,
  );
}

/** 待上传条目视图（pendingUpgrades 出口——密文 + 元数据，供传输层发送） */
export interface PendingUpload {
  seq: number;
  deviceId: string;
  category: string;
  destination?: string;
  ts: string;
  ciphertext: string;
  iv: string;
  tag: string;
  redactHits: number;
  payloadBytes: number;
}

/**
 * 读游标（当前 ackedSeq——最近一条 ack 的值，无 ack = 0）。
 */
export function readUploadCursor(dataDir?: string): number {
  const records = readAllRecords(dataDir);
  let cursor = 0;
  for (const r of records) {
    if (r.type === 'ack' && typeof r.ackedSeq === 'number' && r.ackedSeq > cursor) {
      cursor = r.ackedSeq;
    }
  }
  return cursor;
}

/**
 * 待上传条目（seq > 游标的 enqueue——断点续传：已 ack 段不重传）。
 *
 * fail 不回退游标：失败条目留在 pending 集（下轮重试），ack 才出队。
 */
export function pendingUploads(dataDir?: string): PendingUpload[] {
  const cursor = readUploadCursor(dataDir);
  return readAllRecords(dataDir)
    .filter((r) => r.type === 'enqueue' && r.seq > cursor && typeof r.ciphertext === 'string' && typeof r.category === 'string')
    .map((r) => ({
      seq: r.seq,
      deviceId: r.deviceId,
      category: r.category!,
      ...(r.destination ? { destination: r.destination } : {}),
      ts: r.ts,
      ciphertext: r.ciphertext!,
      iv: r.iv ?? '',
      tag: r.tag ?? '',
      redactHits: r.redactHits ?? 0,
      payloadBytes: r.payloadBytes ?? 0,
    }));
}

/**
 * 解密一条待上传条目（测试/平台侧对称面——daemon 内部不用于回传明文）。
 *
 * 无密钥 → null（fail-closed：不可解密 = 报不可用，不做明文降级）。
 * 认证失败（tag 校验）→ null（密文被篡改不返回部分明文——对齐
 * decryptPayload 的抛错语义，此处包为 null 返回）。
 */
export function decryptPendingUpload(entry: Pick<PendingUpload, 'ciphertext' | 'iv' | 'tag'>): string | null {
  const aesKey = deriveUploadAesKey();
  if (!aesKey) return null;
  try {
    const plain = decryptPayload(
      aesKey,
      Buffer.from(entry.iv, 'base64'),
      Buffer.from(entry.ciphertext, 'base64'),
      Buffer.from(entry.tag, 'base64'),
    );
    return plain.toString('utf-8');
  } catch {
    return null;
  }
}

/** WAL 完整性快照（观测面——记录数 / 游标 / 待传量） */
export function uploadWalStats(dataDir?: string): {
  total: number;
  enqueued: number;
  acked: number;
  failed: number;
  cursor: number;
  pending: number;
} {
  const records = readAllRecords(dataDir);
  const enqueued = records.filter((r) => r.type === 'enqueue').length;
  const acked = records.filter((r) => r.type === 'ack').length;
  const failed = records.filter((r) => r.type === 'fail').length;
  const cursor = readUploadCursor(dataDir);
  const pending = records.filter((r) => r.type === 'enqueue' && r.seq > cursor).length;
  return { total: records.length, enqueued, acked, failed, cursor, pending };
}

/**
 * 清空 WAL（测试用——生产面不提供清空入口：append-only 是审计语义）。
 */
export function resetUploadWal(dataDir?: string): void {
  const p = uploadWalPath(dataDir);
  if (existsSync(p)) {
    writeFileSync(p, '', 'utf-8');
  }
}
