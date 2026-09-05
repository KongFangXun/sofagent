// zip-writer.ts · v1.4.5 第五章/第四章共用 · 最小 ZIP 写入器（deflate 压缩 + CRC32）
//
// 定位：为两处「打包」需求提供同一实现，避免两份手写 ZIP 各自漂移：
//   一、第五章保留策略——归档冷存（checkpoint/旧训练集目录 → data/train/archive/ 的 .zip）
//   二、第四章交付包——train-deliverable 五件内容打成一个 zip
//
// 零新依赖纪律（对齐 data-ingest.ts 手写 ZIP 读取器先例）：写入侧用
// zlib.deflateRawSync（method 8）压缩 + 手写 CRC32 表 + 本地头/中央目录/
// EOCD 三段结构。读取侧不重写——直接复用 data-ingest.unzipEntries
// （支持 method 0/8，与本写入器互为读写对）。
//
// 结构规范（PKZIP APPNOTE 子集，与 unzipEntries 的解析面对齐）：
//   [本地头 30B + 文件名 + 数据]* + [中央目录 46B+文件名]* + [EOCD 22B]
//   - method：8（deflate）；压缩后反而更大时回落 0（stored）
//   - 不写 extra/comment 字段（长度 0）；不支持 zip64（归档与交付包
//     远小于 4GB；超限场景应分片，不是本模块职责）
//
// 接口签名（spec-first）：
//   buildZip(entries: ZipEntryInput[], opts?: { at?: Date }): Buffer
//   ZipEntryInput = { name: string; data: Buffer | string }
//   条目按入参顺序写入（确定性清单顺序——调用方排序后传入）。

import { deflateRawSync } from 'node:zlib';

/** 单条目入参（data 为字符串时按 utf8 编码） */
export interface ZipEntryInput {
  /** 条目名（zip 内相对路径，正斜杠分隔） */
  name: string;
  /** 条目内容 */
  data: Buffer | string;
}

/** buildZip 选项 */
export interface BuildZipOptions {
  /** 时间戳来源（缺省当前时间——只影响 zip 元数据不影响内容；测试可注入） */
  at?: Date;
}

// ── ZIP 结构签名（小端）——与 data-ingest 读取侧同源 ──
const ZIP_LOCAL_SIG = 0x04034b50;
const ZIP_CDIR_SIG = 0x02014b50;
const ZIP_EOCD_SIG = 0x06054b50;

// ── CRC32（标准查表法——0xEDB88320 多项式）──

/** CRC32 查找表（惰性单例——模块加载时构建一次） */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** 计算单段 Buffer 的 CRC32（写入本地头与中央目录——读取侧 inflate 后可复验） */
export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i] ?? 0; // noUncheckedIndexedAccess：Buffer 越界返回 undefined，兜底 0
    c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Date → DOS 时间/日期字段（zip 元数据格式——1980 纪元） */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  const date = (((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >>> 1)) & 0xffff;
  return { time, date };
}

/**
 * 构建完整 ZIP 文件（内存态 Buffer——条目内容由调用方保证规模可控：
 * 归档对象是 checkpoint/训练集目录，交付包是配置与手册类小文件；
 * GB 级权重不打交付包，清单走 manifest 引用而非内嵌）。
 *
 * 压缩策略：deflate level 6；压缩后 ≥ 原文时回落 stored（已压缩内容
 * 二次压缩无收益）。逐条目独立判定 method，中央目录如实登记。
 */
export function buildZip(entries: ZipEntryInput[], opts: BuildZipOptions = {}): Buffer {
  if (entries.length === 0) {
    throw new Error('[zip-writer] 拒绝构建空 zip（空包无校验意义）');
  }
  const at = opts.at ?? new Date();
  const { time, date } = dosDateTime(at);

  // ── 预处理：逐条目编码 + 压缩判定 ──
  interface Prepared {
    nameBuf: Buffer;
    method: number; // 8 deflate / 0 stored
    crc: number;
    comp: Buffer;
    uncompSize: number;
  }
  const prepared: Prepared[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (typeof entry.name !== 'string' || entry.name.length === 0) {
      throw new Error('[zip-writer] 条目名必须为非空字符串');
    }
    if (seen.has(entry.name)) {
      throw new Error(`[zip-writer] 条目名重复：${entry.name}（重复条目会让清单失真）`);
    }
    seen.add(entry.name);
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const deflated = deflateRawSync(raw, { level: 6 });
    const useDeflate = deflated.length < raw.length;
    prepared.push({
      nameBuf: Buffer.from(entry.name, 'utf8'),
      method: useDeflate ? 8 : 0,
      crc: crc32(raw),
      comp: useDeflate ? deflated : raw,
      uncompSize: raw.length,
    });
  }

  // ── 尺寸预算（一次分配——避免多段 concat 拷贝）──
  const localBytes = prepared.reduce((sum, p) => sum + 30 + p.nameBuf.length + p.comp.length, 0);
  const centralBytes = prepared.reduce((sum, p) => sum + 46 + p.nameBuf.length, 0);
  const out = Buffer.alloc(localBytes + centralBytes + 22);

  // ── 本地头 + 数据 ──
  let offset = 0;
  const localOffsets: number[] = [];
  for (const p of prepared) {
    localOffsets.push(offset);
    out.writeUInt32LE(ZIP_LOCAL_SIG, offset);
    out.writeUInt16LE(20, offset + 4); // version needed（deflate 最低 2.0）
    out.writeUInt16LE(0, offset + 6); // flags（无加密/无 data descriptor）
    out.writeUInt16LE(p.method, offset + 8);
    out.writeUInt16LE(time, offset + 10);
    out.writeUInt16LE(date, offset + 12);
    out.writeUInt32LE(p.crc, offset + 14);
    out.writeUInt32LE(p.comp.length, offset + 18);
    out.writeUInt32LE(p.uncompSize, offset + 22);
    out.writeUInt16LE(p.nameBuf.length, offset + 26);
    out.writeUInt16LE(0, offset + 28); // extra 长度
    p.nameBuf.copy(out, offset + 30);
    p.comp.copy(out, offset + 30 + p.nameBuf.length);
    offset += 30 + p.nameBuf.length + p.comp.length;
  }

  // ── 中央目录 ──
  const centralStart = offset;
  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i]!;
    out.writeUInt32LE(ZIP_CDIR_SIG, offset);
    out.writeUInt16LE(20, offset + 4); // version made by（MS-DOS/PKZIP 2.0 兼容档）
    out.writeUInt16LE(20, offset + 6); // version needed
    out.writeUInt16LE(0, offset + 8); // flags
    out.writeUInt16LE(p.method, offset + 10);
    out.writeUInt16LE(time, offset + 12);
    out.writeUInt16LE(date, offset + 14);
    out.writeUInt32LE(p.crc, offset + 16);
    out.writeUInt32LE(p.comp.length, offset + 20);
    out.writeUInt32LE(p.uncompSize, offset + 24);
    out.writeUInt16LE(p.nameBuf.length, offset + 28);
    out.writeUInt16LE(0, offset + 30); // extra
    out.writeUInt16LE(0, offset + 32); // comment
    out.writeUInt16LE(0, offset + 34); // disk start
    out.writeUInt16LE(0, offset + 36); // internal attrs
    out.writeUInt32LE(0, offset + 38); // external attrs
    out.writeUInt32LE(localOffsets[i]!, offset + 42); // 本地头偏移
    p.nameBuf.copy(out, offset + 46);
    offset += 46 + p.nameBuf.length;
  }

  // ── EOCD ──
  out.writeUInt32LE(ZIP_EOCD_SIG, offset);
  out.writeUInt16LE(0, offset + 4); // 当前磁盘
  out.writeUInt16LE(0, offset + 6); // 中央目录起始磁盘
  out.writeUInt16LE(prepared.length, offset + 8);
  out.writeUInt16LE(prepared.length, offset + 10);
  out.writeUInt32LE(centralBytes, offset + 12);
  out.writeUInt32LE(centralStart, offset + 16);
  out.writeUInt16LE(0, offset + 20); // comment 长度

  return out;
}
