// ============================================================
// usb-key.ts · create-usb-key —— U 盘完整运行时写入器
// v1.3.2 新增
// ============================================================
//
// 交付一（USB 完整运行时）的写入侧：
//   1. 复制 Node 便携版到 <U盘>/runtime/node（--node-binary-path 缺省
//      复制本机 process.execPath——同平台场景；跨平台需用户提供
//      目标平台官方 prebuilt 二进制路径）
//   2. 复制 sofagent 编译产物（daemon/orchestrator/core dist + 生产
//      node_modules 子集）到 <U盘>/sofagent/
//   3. 复制三平台启动脚本（daemon/usb/ 下的 start.command/.sh/.bat）
//      到 U 盘根
//   4. 写入 federation.json——若缺 key（AES）/ hmacKey（签名）字段，
//      用 crypto.randomBytes(32) 生成并写入（Q6 决策）
//   5. 创建空 knowledge/ 目录结构（预置 .gitkeep 加密落盘样例）
//   6. knowledge/ 全部明文文件经 AES-256-GCM 加密为 .enc 落盘，
//      明文原件删除（U 盘文件系统永为密文）
//   7. 全量 HMAC 签名（usb-signature.ts）写入 .sofagent-signature
//
// 安全模型（U2「U 盘即信任根」）：AES key / hmacKey 明文存 U 盘
// federation.json——防的是「U 盘丢失后 knowledge/ 被非授权读取」
// 之外的篡改/注入场景；物理持有 U 盘 = 信任。
//
// 零 runtime npm 依赖：全部复用 Node 内置 crypto/fs + core/crypto。
// ============================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { encryptPayload, AES_KEY_BYTES, GCM_IV_BYTES, GCM_TAG_BYTES } from '@sofagent/core';
import { collectFiles, computeUsbSignature, writeSignatureManifest } from './usb-signature';
import type { FederationConfig } from './usb-detect';

/** 支持的目标平台 */
export type UsbPlatform = 'macos' | 'linux' | 'win';

/** U 盘 federation.json 扩展字段（在 v1.1.4 FederationConfig 基础上加密钥） */
export interface UsbFederationConfig extends FederationConfig {
  /** AES-256 knowledge/ 磁盘加密密钥（hex，32 字节）——缺省时 create-usb-key 生成写入 */
  key?: string;
  /** HMAC-SHA256 全量签名密钥（hex，32 字节）——缺省时生成写入 */
  hmacKey?: string;
}

/** createUsbKey 入参 */
export interface CreateUsbKeyOpts {
  /** 节点角色名（如 "财务审计节点"）——写入 federation.json notes */
  role: string;
  /** U 盘挂载路径（如 /Volumes/SOFAGENT） */
  target: string;
  /** 目标平台（决定复制哪个 Node 二进制 + 启动脚本命名） */
  platform: UsbPlatform;
  /** Node 便携版二进制路径——缺省复制本机 process.execPath（仅同平台可用） */
  nodeBinaryPath?: string;
  /** federation 配置——缺省读 {SOFAGENT_DATA}/federation.json，再缺省生成最小配置 */
  federationConfig?: UsbFederationConfig;
  /** sofagent 产物来源目录（含 daemon/orchestrator/core 子目录的 monorepo 根）；
   *  缺省从本模块所在包向上推断（daemon/../.. = sofagent/ 目录） */
  sofagentSourceDir?: string;
}

/** createUsbKey 结果 */
export interface UsbKeyResult {
  /** U 盘根目录 */
  usbRoot: string;
  /** 目标平台 */
  platform: UsbPlatform;
  /** 写入文件总数（含 runtime / sofagent / 启动脚本 / federation.json / 签名） */
  filesWritten: number;
  /** 签名文件路径（<usbRoot>/.sofagent-signature） */
  signatureFile: string;
  /** knowledge/ 是否已加密落盘 */
  knowledgeEncrypted: boolean;
  /** 非致命警告（如 Node 二进制平台不匹配提示、可选文件缺失） */
  warnings: string[];
}

/** .enc 帧头 magic（"SGE1" = SofagentGcmEnc v1）——运行时解密前校验 */
export const ENC_FRAME_MAGIC = Buffer.from([0x53, 0x47, 0x45, 0x31]);

/**
 * 加密单个 knowledge 文件为 .enc 二进制帧：
 *   [magic 4B][iv 12B][tag 16B][ciphertext NB]
 * 复用 v1.1.8 联邦 payload 帧格式（core/crypto/aes-gcm.ts）。
 */
export function encryptKnowledgeFile(aesKey: Buffer, plaintext: Buffer): Buffer {
  const { iv, ciphertext, tag } = encryptPayload(aesKey, plaintext);
  return Buffer.concat([ENC_FRAME_MAGIC, iv, tag, ciphertext]);
}

/** .enc 帧解析（运行时解密用）——magic/长度校验失败返回 null */
export function parseEncFrame(frame: Buffer): { iv: Buffer; tag: Buffer; ciphertext: Buffer } | null {
  const headerLen = ENC_FRAME_MAGIC.length + GCM_IV_BYTES + GCM_TAG_BYTES;
  if (frame.length < headerLen) return null;
  if (!frame.subarray(0, ENC_FRAME_MAGIC.length).equals(ENC_FRAME_MAGIC)) return null;
  const iv = frame.subarray(ENC_FRAME_MAGIC.length, ENC_FRAME_MAGIC.length + GCM_IV_BYTES);
  const tag = frame.subarray(ENC_FRAME_MAGIC.length + GCM_IV_BYTES, headerLen);
  const ciphertext = frame.subarray(headerLen);
  return { iv, tag, ciphertext };
}

/**
 * 写入 U 盘完整运行时（主入口）。
 *
 * 失败语义：目标路径不存在 / federation.json schema 非法 → 抛错；
 * 其余单文件复制失败聚合进 warnings（best-effort）。
 */
export async function createUsbKey(opts: CreateUsbKeyOpts): Promise<UsbKeyResult> {
  const warnings: string[] = [];
  const usbRoot = path.resolve(opts.target);

  if (!fs.existsSync(usbRoot) || !fs.statSync(usbRoot).isDirectory()) {
    throw new Error(`U 盘挂载路径不存在或不是目录：${usbRoot}`);
  }

  let filesWritten = 0;

  // ── Step 1: Node 便携版 → runtime/ ──────────────────────────
  const runtimeDir = path.join(usbRoot, 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  const nodeSrc = opts.nodeBinaryPath ?? process.execPath;
  const nodeDestName = opts.platform === 'win' ? 'node.exe' : 'node';
  const nodeDest = path.join(runtimeDir, nodeDestName);
  if (fs.existsSync(nodeSrc)) {
    fs.copyFileSync(nodeSrc, nodeDest);
    if (opts.platform !== 'win') fs.chmodSync(nodeDest, 0o755);
    filesWritten++;
    if (!opts.nodeBinaryPath) {
      warnings.push(
        `Node 便携版复制自本机 ${process.execPath}（${process.platform}/${process.arch}）——` +
        `仅当目标机器同平台时可直接运行；跨平台请用 --node-binary-path 指定官方 prebuilt 二进制`,
      );
    }
  } else {
    warnings.push(`Node 二进制不存在：${nodeSrc}——runtime/ 为空，需手动放置`);
  }

  // ── Step 2: sofagent 编译产物 → sofagent/ ───────────────────
  const srcRoot = opts.sofagentSourceDir ?? inferSofagentSourceDir();
  filesWritten += copySofagentDist(srcRoot, path.join(usbRoot, 'sofagent'), warnings);

  // ── Step 3: 三平台启动脚本 → U 盘根 ─────────────────────────
  filesWritten += copyStartScripts(srcRoot, usbRoot, warnings);

  // ── Step 4: federation.json（补齐 key / hmacKey） ────────────
  const federation = resolveFederationConfig(opts);
  let generatedAes = false;
  let generatedHmac = false;
  if (!federation.key) {
    federation.key = crypto.randomBytes(AES_KEY_BYTES).toString('hex');
    generatedAes = true;
  }
  if (!federation.hmacKey) {
    federation.hmacKey = crypto.randomBytes(AES_KEY_BYTES).toString('hex');
    generatedHmac = true;
  }
  const aesKey = Buffer.from(federation.key, 'hex');
  const hmacKey = Buffer.from(federation.hmacKey, 'hex');
  if (aesKey.length !== AES_KEY_BYTES || hmacKey.length !== AES_KEY_BYTES) {
    throw new Error('federation.json 的 key / hmacKey 必须是 32 字节 hex（64 字符）');
  }
  fs.writeFileSync(path.join(usbRoot, 'federation.json'), JSON.stringify(federation, null, 2), 'utf-8');
  filesWritten++;
  if (generatedAes) warnings.push('federation.json 缺 key 字段——已生成随机 AES-256 密钥写入');
  if (generatedHmac) warnings.push('federation.json 缺 hmacKey 字段——已生成随机 HMAC 密钥写入');

  // ── Step 5: knowledge/ 目录结构 + 预置文件加密落盘 ───────────
  const knowledgeDir = path.join(usbRoot, 'knowledge');
  fs.mkdirSync(knowledgeDir, { recursive: true });
  // 预置一个最小 README（加密后落盘）——保证空 knowledge/ 也有
  // 至少一个 .enc 文件供运行时解密冒烟自检
  const seedPlaintext = Buffer.from(
    `# ${opts.role} knowledge/\n\n本目录由 sofagent create-usb-key 初始化。\n` +
    `U 盘文件系统上永远只有 AES-256-GCM 密文（.enc），明文只存在 daemon 内存中。\n`,
    'utf-8',
  );
  const encFrame = encryptKnowledgeFile(aesKey, seedPlaintext);
  fs.writeFileSync(path.join(knowledgeDir, 'README.md.enc'), encFrame);
  filesWritten++;
  // 加密 U 盘上已有的明文 knowledge 文件（管理员预先放入的场景）
  const encryptedExtra = encryptPlaintextKnowledgeInPlace(knowledgeDir, aesKey);
  filesWritten += encryptedExtra;

  // ── Step 6: 全量 HMAC 签名 ──────────────────────────────────
  const files = collectFiles(usbRoot);
  const manifest = writeSignatureManifest(usbRoot, hmacKey, files);
  filesWritten++; // .sofagent-signature 本身
  // 确定性自检：同一密钥同一文件集合复算必须一致
  const recomputed = computeUsbSignature(files, hmacKey);
  if (recomputed !== manifest.signature) {
    throw new Error('签名自检失败——computeUsbSignature 不具备确定性');
  }

  return {
    usbRoot,
    platform: opts.platform,
    filesWritten,
    signatureFile: path.join(usbRoot, '.sofagent-signature'),
    knowledgeEncrypted: true,
    warnings,
  };
}

// ============================================================
// 内部实现
// ============================================================

/** 推断 sofagent monorepo 产物根（含 daemon/orchestrator/core 子目录） */
function inferSofagentSourceDir(): string {
  // 本文件编译后位于 <repo>/sofagent/daemon/dist/，向上两级 = sofagent/
  return path.resolve(__dirname, '..', '..');
}

/**
 * 复制 daemon/orchestrator/core 三包的 dist + package.json 到 U 盘 sofagent/，
 * 并复制三包生产依赖的 node_modules 最小子集（workspace 根 node_modules 中
 * 按各包 dependencies 闭包收集，best-effort——缺失的依赖聚合进 warnings）。
 */
function copySofagentDist(srcRoot: string, destRoot: string, warnings: string[]): number {
  let written = 0;
  const packages = ['daemon', 'orchestrator', 'core'] as const;
  const depClosure = new Set<string>();

  for (const pkg of packages) {
    const pkgSrc = path.join(srcRoot, pkg);
    const pkgDest = path.join(destRoot, pkg);
    const distSrc = path.join(pkgSrc, 'dist');
    if (!fs.existsSync(distSrc)) {
      warnings.push(`${pkg}/dist 不存在（${distSrc}）——请先 npm run build`);
      continue;
    }
    copyDir(distSrc, path.join(pkgDest, 'dist'));
    written += countFiles(path.join(pkgDest, 'dist'));
    // package.json 一并带上（运行时 require 解析版本/入口用）
    const pkgJsonSrc = path.join(pkgSrc, 'package.json');
    if (fs.existsSync(pkgJsonSrc)) {
      fs.copyFileSync(pkgJsonSrc, path.join(pkgDest, 'package.json'));
      written++;
      // 收集依赖闭包（仅外部 npm 包；@sofagent/* 内部包已由三包 dist 覆盖）
      try {
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonSrc, 'utf-8')) as {
          dependencies?: Record<string, string>;
        };
        for (const dep of Object.keys(pkgJson.dependencies ?? {})) {
          if (!dep.startsWith('@sofagent/')) depClosure.add(dep);
        }
      } catch {
        warnings.push(`${pkg}/package.json 解析失败——依赖闭包可能不完整`);
      }
    }
  }

  // 生产 node_modules 子集（从 workspace 根 node_modules 复制依赖闭包）
  const repoNodeModules = path.resolve(srcRoot, '..', 'node_modules');
  const destNodeModules = path.join(destRoot, 'node_modules');
  for (const dep of depClosure) {
    const depSrc = path.join(repoNodeModules, dep);
    if (!fs.existsSync(depSrc)) {
      warnings.push(`依赖 ${dep} 未在 ${repoNodeModules} 找到——U 盘运行时可能缺依赖`);
      continue;
    }
    copyDir(depSrc, path.join(destNodeModules, dep));
    written += countFiles(path.join(destNodeModules, dep));
  }
  return written;
}

/** 复制 daemon/usb/ 下三平台启动脚本到 U 盘根 */
function copyStartScripts(srcRoot: string, usbRoot: string, warnings: string[]): number {
  let written = 0;
  const scriptsDir = path.join(srcRoot, 'daemon', 'usb');
  const scripts: Array<{ name: string; executable: boolean }> = [
    { name: 'start.command', executable: true },
    { name: 'start.sh', executable: true },
    { name: 'start.bat', executable: false },
  ];
  for (const script of scripts) {
    const src = path.join(scriptsDir, script.name);
    const dest = path.join(usbRoot, script.name);
    if (!fs.existsSync(src)) {
      warnings.push(`启动脚本缺失：${src}`);
      continue;
    }
    fs.copyFileSync(src, dest);
    if (script.executable) fs.chmodSync(dest, 0o755);
    written++;
  }
  return written;
}

/** 解析 federation 配置：入参 > {SOFAGENT_DATA}/federation.json > 最小生成 */
function resolveFederationConfig(opts: CreateUsbKeyOpts): UsbFederationConfig {
  if (opts.federationConfig) return { ...opts.federationConfig };
  const dataDir = process.env.SOFAGENT_DATA ?? path.join(os.homedir(), '.sofagent');
  const fedPath = path.join(dataDir, 'federation.json');
  if (fs.existsSync(fedPath)) {
    try {
      return JSON.parse(fs.readFileSync(fedPath, 'utf-8')) as UsbFederationConfig;
    } catch {
      // 解析失败降级到最小生成
    }
  }
  return {
    version: 1,
    nodes: [{ name: opts.role, platform: opts.platform, description: `USB 节点（${opts.role}）` }],
    notes: `create-usb-key 生成 · role=${opts.role} · ${new Date().toISOString()}`,
  };
}

/**
 * 加密 knowledge/ 下所有明文文件为 .enc（原地删除明文）。
 * 幂等：已有 .enc 文件跳过。
 * @returns 新加密的文件数
 */
export function encryptPlaintextKnowledgeInPlace(knowledgeDir: string, aesKey: Buffer): number {
  let encrypted = 0;
  for (const name of fs.readdirSync(knowledgeDir)) {
    if (name.endsWith('.enc')) continue;
    const absPath = path.join(knowledgeDir, name);
    if (!fs.statSync(absPath).isFile()) continue;
    const plaintext = fs.readFileSync(absPath);
    fs.writeFileSync(`${absPath}.enc`, encryptKnowledgeFile(aesKey, plaintext));
    // 明文原件安全擦除后删除（先覆写 0 再 unlink——U 盘闪存上
    // 不能根治磨损均衡残留，但优于直接 unlink）
    fs.writeFileSync(absPath, Buffer.alloc(plaintext.length));
    fs.unlinkSync(absPath);
    encrypted++;
  }
  return encrypted;
}

// ============================================================
// 文件系统工具
// ============================================================

/** 递归复制目录（保留可执行位） */
function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const srcPath = path.join(src, name);
    const destPath = path.join(dest, name);
    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (stat.isFile()) {
      fs.copyFileSync(srcPath, destPath);
      // 保留可执行位（bin 脚本）
      if (stat.mode & 0o111) fs.chmodSync(destPath, stat.mode & 0o777);
    }
  }
}

/** 统计目录下文件总数（递归） */
function countFiles(dir: string): number {
  let count = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const name of fs.readdirSync(dir)) {
    const absPath = path.join(dir, name);
    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) count += countFiles(absPath);
    else if (stat.isFile()) count++;
  }
  return count;
}
