// ============================================================
// usb-signature.ts · U 盘全量文件 HMAC-SHA256 签名模块
// v1.3.0 新增
// ============================================================
//
// 交付一（USB 完整运行时）的信任根：
//   - create-usb-key 写入完成后，对 U 盘全部受保护文件算一个聚合签名，
//     写入 <U盘根>/.sofagent-signature
//   - daemon USB 模式启动时先验签——任一文件被篡改/删除/新增，
//     签名即不匹配 → fail-closed 拒绝启动
//
// 确定性算法（跨平台可复算）：
//   1. 相对路径统一转 POSIX 风格（Windows `\` → `/`）
//   2. 路径按字典序排序（与遍历顺序无关）
//   3. 每个文件算 SHA-256 内容哈希
//   4. 按 `relativePath + "\n" + contentHash + "\n"` 串联后算 HMAC-SHA256
//   5. 不含 mtime / 权限位 / 文件属主——同一文件集合在任何机器上
//      算出的签名一致
//
// 排除项（不纳入签名）：
//   - runtime/（Node 便携版二进制，各平台不同，本身不可复算）
//   - .sofagent-signature（签名文件自身）
//   - .sofagent/security-events.jsonl（运行时追加的安全事件日志，
//     验签后写入，若纳入签名会导致第二次启动必然验签失败）
//
// 密钥源双轨制（见架构设计 §7.1）：
//   - 本机 daemon 场景：~/.sofagent/usb-secret.key（loadOrCreateSecretKey）
//   - U 盘运行时场景：U 盘 federation.json 的 hmacKey 字段
//   本模块不决定密钥来源——密钥经参数注入（依赖倒置）。
// ============================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/** 签名文件名（落 U 盘根目录，hex 编码 HMAC-SHA256） */
export const USB_SIGNATURE_FILE = '.sofagent-signature';

/** 默认排除目录/文件（相对 U 盘根，POSIX 风格前缀匹配） */
export const DEFAULT_EXCLUDES: readonly string[] = [
  'runtime/',
  USB_SIGNATURE_FILE,
  '.sofagent/security-events.jsonl',
];

/** 受保护文件条目（相对路径 + 内容哈希） */
export interface FileEntry {
  /** 相对 U 盘根的路径，POSIX 风格（`/` 分隔） */
  relativePath: string;
  /** 文件内容的 SHA-256 hex */
  contentHash: string;
}

/** 验签结果 */
export interface VerifyResult {
  /** true = 签名匹配（或签名文件存在且全部文件一致） */
  ok: boolean;
  /** 失败原因分类 */
  reason?:
    | 'signature-missing'   // .sofagent-signature 不存在（整盘格式化/未初始化）
    | 'signature-mismatch'  // 聚合签名不匹配（文件被篡改）
    | 'file-missing'        // 签名清单中的文件被删除
    | 'file-added'          // 多余文件被拖入（签名清单之外）
    | 'parse-error';        // 签名文件内容损坏（非 JSON）
  /** 不一致的文件列表（reason 为 file-missing / file-added / signature-mismatch 时给出） */
  mismatchedFiles?: string[];
}

/** 签名清单文件格式（.sofagent-signature 内部 JSON） */
export interface SignatureManifest {
  /** schema 版本（固定 1，未来演进用） */
  version: 1;
  /** 聚合 HMAC-SHA256 hex */
  signature: string;
  /** 参与签名的文件条目（验签时用于区分 file-missing / file-added） */
  files: FileEntry[];
}

// ============================================================
// 文件收集
// ============================================================

/**
 * 递归收集 root 下全部受保护文件（排除 exclude 前缀）。
 *
 * @param root    U 盘根目录绝对路径
 * @param exclude 排除前缀数组（POSIX 风格，如 ['runtime/', '.sofagent-signature']）；
 *                缺省用 DEFAULT_EXCLUDES
 * @returns FileEntry 数组——按 relativePath 字典序排序（确定性）
 */
export function collectFiles(root: string, exclude: readonly string[] = DEFAULT_EXCLUDES): FileEntry[] {
  const entries: FileEntry[] = [];
  const normalizedExcludes = exclude.map((e) => normalizePath(e));

  function walk(absDir: string): void {
    let names: string[];
    try {
      names = fs.readdirSync(absDir);
    } catch {
      return; // 不可读目录跳过（best-effort）
    }
    for (const name of names) {
      const absPath = path.join(absDir, name);
      const relPath = normalizePath(path.relative(root, absPath));
      if (normalizedExcludes.some((ex) => relPath === ex || relPath.startsWith(ex))) continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(absPath);
      } catch {
        continue; // 悬空 symlink 等跳过
      }
      if (stat.isDirectory()) {
        walk(absPath);
      } else if (stat.isFile()) {
        entries.push({
          relativePath: relPath,
          contentHash: hashFileContent(absPath),
        });
      }
    }
  }

  walk(root);
  // 字典序排序——确定性第 2 条：与文件系统遍历顺序无关
  entries.sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));
  return entries;
}

/**
 * 计算文件集合的聚合 HMAC-SHA256 签名（确定性）。
 *
 * 算法：`HMAC(key, concat(path + "\n" + hash + "\n"))`——
 * 相同文件集合在任何机器上算出相同签名（路径已归一化 + 排序，
 * 不含 mtime/权限位）。
 *
 * @param files FileEntry 数组（调用方负责排序；本函数内部再排一次兜底）
 * @param key   HMAC 密钥（双轨制密钥源由调用方决定）
 * @returns hex 编码签名
 */
export function computeUsbSignature(files: FileEntry[], key: Buffer): string {
  const sorted = [...files].sort((a, b) =>
    a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0,
  );
  const hmac = crypto.createHmac('sha256', key);
  for (const entry of sorted) {
    hmac.update(normalizePath(entry.relativePath), 'utf-8');
    hmac.update('\n', 'utf-8');
    hmac.update(entry.contentHash, 'utf-8');
    hmac.update('\n', 'utf-8');
  }
  return hmac.digest('hex');
}

// ============================================================
// 签名清单写入 / 验签
// ============================================================

/**
 * 生成签名清单并写入 <root>/.sofagent-signature（原子写）。
 *
 * @param root  U 盘根目录
 * @param key   HMAC 密钥
 * @param files 受保护文件集合（缺省 collectFiles(root) 自动收集）
 * @returns 签名清单（含聚合签名 + 文件条目）
 */
export function writeSignatureManifest(root: string, key: Buffer, files?: FileEntry[]): SignatureManifest {
  const entries = files ?? collectFiles(root);
  const manifest: SignatureManifest = {
    version: 1,
    signature: computeUsbSignature(entries, key),
    files: entries,
  };
  const manifestPath = path.join(root, USB_SIGNATURE_FILE);
  const tmp = `${manifestPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf-8');
  try {
    fs.renameSync(tmp, manifestPath);
  } catch (err) {
    // EXDEV（跨设备 rename）降级 copy + unlink
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      fs.copyFileSync(tmp, manifestPath);
      try { fs.unlinkSync(tmp); } catch { /* 清理失败可忽略 */ }
    } else {
      throw err;
    }
  }
  return manifest;
}

/**
 * 验签 U 盘全量文件（fail-closed 判定由调用方执行）。
 *
 * 判定顺序：
 *   1. .sofagent-signature 不存在 → signature-missing（整盘格式化/未初始化）
 *   2. 清单 JSON 损坏 → parse-error
 *   3. 清单内文件被删除 → file-missing
 *   4. 清单外多余文件 → file-added
 *   5. 内容哈希不一致 → signature-mismatch
 *
 * @param root U 盘根目录
 * @param key  HMAC 密钥（与写入时同密钥）
 * @returns VerifyResult
 */
export function verifyUsbSignature(root: string, key: Buffer): VerifyResult {
  const manifestPath = path.join(root, USB_SIGNATURE_FILE);

  // 1. 签名文件缺失——整盘格式化 / 非 sofagent U 盘
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, reason: 'signature-missing' };
  }

  // 2. 清单解析
  let manifest: SignatureManifest;
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as SignatureManifest;
    if (raw.version !== 1 || typeof raw.signature !== 'string' || !Array.isArray(raw.files)) {
      return { ok: false, reason: 'parse-error' };
    }
    manifest = raw;
  } catch {
    return { ok: false, reason: 'parse-error' };
  }

  // 3. 现场重收集（与写入时同样的排除规则）
  const current = collectFiles(root);
  const manifestMap = new Map(manifest.files.map((f) => [normalizePath(f.relativePath), f.contentHash]));
  const currentMap = new Map(current.map((f) => [f.relativePath, f.contentHash]));

  // 4. 清单有而现场无 → file-missing
  const missing = [...manifestMap.keys()].filter((p) => !currentMap.has(p));
  if (missing.length > 0) {
    return { ok: false, reason: 'file-missing', mismatchedFiles: missing.sort() };
  }

  // 5. 现场有而清单无 → file-added
  const added = [...currentMap.keys()].filter((p) => !manifestMap.has(p));
  if (added.length > 0) {
    return { ok: false, reason: 'file-added', mismatchedFiles: added.sort() };
  }

  // 6. 内容哈希逐一比对 + 聚合签名重算（恒定时间比较）
  const recomputed = computeUsbSignature(current, key);
  const expected = manifest.signature;
  const mismatch =
    expected.length !== recomputed.length ||
    !crypto.timingSafeEqual(Buffer.from(expected, 'utf-8'), Buffer.from(recomputed, 'utf-8'));
  if (mismatch) {
    const tampered = current.filter((f) => manifestMap.get(f.relativePath) !== f.contentHash).map((f) => f.relativePath);
    return { ok: false, reason: 'signature-mismatch', mismatchedFiles: tampered.sort() };
  }

  return { ok: true };
}

// ============================================================
// 内部工具
// ============================================================

/**
 * 路径归一化：Windows `\` → POSIX `/`，去掉前导 `./`。
 * 确定性第 1 条——同一文件在不同平台写出相同相对路径。
 */
export function normalizePath(p: string): string {
  const posix = p.split(path.sep).join('/').replace(/\\/g, '/');
  return posix.startsWith('./') ? posix.slice(2) : posix;
}

/** 单文件 SHA-256 内容哈希（流式读，避免大文件爆内存） */
function hashFileContent(absPath: string): string {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(absPath, 'r');
  try {
    const buf = Buffer.allocUnsafe(64 * 1024);
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}
