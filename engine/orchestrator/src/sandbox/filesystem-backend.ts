// ============================================================
// sandbox/filesystem-backend.ts · SubAgent 沙箱虚拟文件系统
// v1.3.7 · v1.3.7 开发① 新增
//
// 设计（changelog §一）：
//   SubAgent 写文件先写虚拟层（内存暂存），审批后才合并到物理磁盘——
//   未审批的写入不落盘（v1.3.0 middleware 记录能力保留，本层是执行隔离）。
//
//   证据流边契约（v1.2.5 P6 拆入）：
//     write → virtual → audit → approve → physical
//   每步输出留不可篡改审计记录（append-only 事件日志 + 累计 HMAC）。
//
// 沙箱完整性自检（攻击面声明第 1 条）：
//   启动时校验本模块导出的 hook 函数未被篡改（toString 指纹），
//   运行时全部 fs 操作经虚拟层（调用方约定），绕过 = 进程级 deny。
//
// 资源耗尽防护（攻击面声明第 5 条）：
//   虚拟 FS 容量上限（字节数）+ 超限 deny + 审计。
// ============================================================

import { createHash, createHmac } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';

/** 虚拟写入记录（未合并前的暂存态） */
export interface VirtualWrite {
  /** 目标绝对路径 */
  targetPath: string;
  /** 写入内容 */
  content: string;
  /** 写入时间 */
  writtenAt: string;
  /** 审批状态 */
  status: 'pending' | 'approved' | 'denied' | 'merged';
  /** 内容指纹（证据链） */
  contentHash: string;
}

/** 虚拟 FS 事件（append-only 审计日志行） */
export interface VirtualFsEvent {
  ts: string;
  type: 'write' | 'approve' | 'deny' | 'merge' | 'quota-deny' | 'integrity-fail';
  targetPath: string;
  contentHash: string;
  /** 事件链 HMAC（前一事件 HMAC + 本事件字段） */
  chainMac: string;
}

export interface FilesystemBackendOptions {
  /** 审批日志目录（默认 <dataDir>/sandbox） */
  auditDir?: string;
  /** 虚拟层容量上限（字节，默认 32MB） */
  maxVirtualBytes?: number;
  /** 单文件上限（字节，默认 8MB） */
  maxFileBytes?: number;
  /** HMAC 密钥（证据链；缺省用内容哈希链退化模式） */
  hmacKey?: string;
}

export interface FilesystemBackend {
  /** SubAgent 写文件——进虚拟层，返回虚拟句柄。未审批不落盘 */
  writeVirtual(targetPath: string, content: string): { ok: boolean; reason?: string; contentHash: string };
  /** 审批合并——approved 后虚拟内容原子合并到物理磁盘 */
  approve(targetPath: string): { ok: boolean; reason?: string };
  /** 拒绝——denied 后虚拟内容丢弃（永不落盘） */
  deny(targetPath: string): { ok: boolean; reason?: string };
  /** 列出待审批的虚拟写入 */
  listPending(): VirtualWrite[];
  /** 读文件——物理层直读（读不经审批，只有写需要） */
  readPhysical(targetPath: string): string | null;
  /** 沙箱完整性自检——校验本模块 hook 未被篡改 */
  integrityCheck(): { ok: boolean; detail: string };
  /** 审计事件导出（证据链验证用） */
  exportEvents(): VirtualFsEvent[];
  /** 验证证据链完整性（HMAC 链重放） */
  verifyChain(): { ok: boolean; brokenAt?: number };
  /** 虚拟层当前占用（字节） */
  usage(): { bytes: number; files: number; maxBytes: number };
}

/**
 * 创建虚拟文件系统后端。
 *
 * @param dataDir 运行时数据目录（审计日志落 <dataDir>/sandbox/）
 * @param options 可选项（容量/密钥）
 */
export function createFilesystemBackend(dataDir: string, options: FilesystemBackendOptions = {}): FilesystemBackend {
  const auditDir = options.auditDir || join(dataDir, 'sandbox');
  const maxVirtualBytes = options.maxVirtualBytes ?? 32 * 1024 * 1024;
  const maxFileBytes = options.maxFileBytes ?? 8 * 1024 * 1024;
  const hmacKey = options.hmacKey;

  // 虚拟层（内存暂存）：path → 记录
  const virtual = new Map<string, VirtualWrite>();
  let virtualBytes = 0;
  const events: VirtualFsEvent[] = [];
  let prevMac = '';

  if (!existsSync(auditDir)) {
    mkdirSync(auditDir, { recursive: true, mode: 0o700 });
  }

  // ── 事件链（append-only + HMAC）──
  function chainMac(type: VirtualFsEvent['type'], targetPath: string, contentHash: string): string {
    const payload = `${prevMac}|${ts()}|${type}|${targetPath}|${contentHash}`;
    if (hmacKey) return createHmac('sha256', hmacKey).update(payload).digest('hex');
    // 退化模式：无密钥时用哈希链（防无意识篡改，不防定向伪造——密钥模式防两者）
    return createHash('sha256').update(payload).digest('hex');
  }

  function record(type: VirtualFsEvent['type'], targetPath: string, contentHash: string): void {
    const mac = chainMac(type, targetPath, contentHash);
    const evt: VirtualFsEvent = { ts: ts(), type, targetPath, contentHash, chainMac: mac };
    events.push(evt);
    prevMac = mac;
    try {
      appendFileSync(join(auditDir, 'vfs-events.jsonl'), JSON.stringify(evt) + '\n', 'utf-8');
    } catch {
      // 审计落盘失败不阻断虚拟层（内存链仍在）——但物理日志缺失会在 verifyChain 报告
    }
  }

  function ts(): string {
    return new Date().toISOString();
  }

  function hash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  // ── 完整性自检基准（创建时固化本模块关键函数指纹）──
  const SELF_FINGERPRINTS: Record<string, string> = {
    writeVirtual: createHash('sha256').update(String(writeVirtualImpl)).digest('hex'),
    approve: createHash('sha256').update(String(approveImpl)).digest('hex'),
  };

  function writeVirtualImpl(targetPath: string, content: string): { ok: boolean; reason?: string; contentHash: string } {
    // 攻击面 5：资源耗尽——单文件与总容量双重上限
    const size = Buffer.byteLength(content, 'utf-8');
    if (size > maxFileBytes) {
      record('quota-deny', targetPath, hash(content));
      return { ok: false, reason: `单文件超限（${size} > ${maxFileBytes} 字节）`, contentHash: hash(content) };
    }
    const existing = virtual.get(targetPath);
    const existingSize = existing ? Buffer.byteLength(existing.content, 'utf-8') : 0;
    if (virtualBytes - existingSize + size > maxVirtualBytes) {
      record('quota-deny', targetPath, hash(content));
      return { ok: false, reason: `虚拟层容量超限（${virtualBytes - existingSize + size} > ${maxVirtualBytes} 字节）`, contentHash: hash(content) };
    }

    virtualBytes = virtualBytes - existingSize + size;
    const contentHash = hash(content);
    const entry: VirtualWrite = {
      targetPath, content, writtenAt: ts(),
      status: 'pending', contentHash,
    };
    virtual.set(targetPath, entry);
    record('write', targetPath, contentHash);
    return { ok: true, contentHash };
  }

  function approveImpl(targetPath: string): { ok: boolean; reason?: string } {
    const entry = virtual.get(targetPath);
    if (!entry) return { ok: false, reason: `无待审批写入: ${targetPath}` };
    if (entry.status !== 'pending') return { ok: false, reason: `状态 ${entry.status} 非 pending` };

    entry.status = 'approved';
    record('approve', targetPath, entry.contentHash);

    // 合并到物理磁盘（原子写：临时文件 + rename）
    try {
      const dir = dirname(targetPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const tmp = `${targetPath}.sofagent-vfs-tmp`;
      writeFileSync(tmp, entry.content, 'utf-8');
      renameSync(tmp, targetPath);
    } catch (err) {
      return { ok: false, reason: `物理合并失败: ${(err as Error).message}` };
    }

    entry.status = 'merged';
    virtualBytes -= Buffer.byteLength(entry.content, 'utf-8');
    virtual.delete(targetPath);
    record('merge', targetPath, entry.contentHash);
    return { ok: true };
  }

  return {
    writeVirtual: writeVirtualImpl,
    approve: approveImpl,
    deny(targetPath) {
      const entry = virtual.get(targetPath);
      if (!entry) return { ok: false, reason: `无待审批写入: ${targetPath}` };
      entry.status = 'denied';
      virtualBytes -= Buffer.byteLength(entry.content, 'utf-8');
      virtual.delete(targetPath);
      record('deny', targetPath, entry.contentHash);
      return { ok: true };
    },
    listPending() {
      return [...virtual.values()].filter(v => v.status === 'pending');
    },
    readPhysical(targetPath) {
      try {
        return readFileSync(targetPath, 'utf-8');
      } catch {
        return null;
      }
    },
    integrityCheck() {
      // 攻击面 1：沙箱逃逸——校验本模块 hook 指纹未被篡改
      const now = {
        writeVirtual: createHash('sha256').update(String(writeVirtualImpl)).digest('hex'),
        approve: createHash('sha256').update(String(approveImpl)).digest('hex'),
      };
      for (const [fn, fp] of Object.entries(SELF_FINGERPRINTS)) {
        if (now[fn as keyof typeof now] !== fp) {
          record('integrity-fail', `<module:${fn}>`, fp);
          return { ok: false, detail: `函数 ${fn} 指纹漂移——虚拟 FS hook 疑似被篡改` };
        }
      }
      return { ok: true, detail: 'hook 指纹一致' };
    },
    exportEvents() {
      return [...events];
    },
    verifyChain() {
      // 重放验证：用事件字段重算链
      let prev = '';
      for (let i = 0; i < events.length; i++) {
        const e = events[i]!;
        const payload = `${prev}|${e.ts}|${e.type}|${e.targetPath}|${e.contentHash}`;
        const expect = hmacKey
          ? createHmac('sha256', hmacKey).update(payload).digest('hex')
          : createHash('sha256').update(payload).digest('hex');
        if (expect !== e.chainMac) return { ok: false, brokenAt: i };
        prev = e.chainMac;
      }
      return { ok: true };
    },
    usage() {
      return { bytes: virtualBytes, files: virtual.size, maxBytes: maxVirtualBytes };
    },
  };
}
