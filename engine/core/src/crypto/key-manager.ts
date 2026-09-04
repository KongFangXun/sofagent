// ============================================================
// crypto/key-manager.ts · 数据静态加密密钥管理
// v1.3.8 交付二 新增
//
// 密钥文件布局（SOFAGENT_HOME 下，与 data/ 平级——密钥不进数据目录，
// 备份数据目录时不会把密钥一起带走）：
//   ~/.sofagent/keys/data.key            当前数据密钥（32 字节随机，0600）
//   ~/.sofagent/keys/data.key.*.bak      轮换归档的旧密钥（base64 文本）
//   ~/.sofagent/keys/initialized         初始化标记（存在 = 已完成首启引导）
//
// 生命周期：
//   1. 首次运行（无密钥）→ crypto-init（daemon）引导生成
//   2. 生成时打印 SHA-256 指纹前 16 位并**要求确认已备份**——
//      confirmBackup !== true 则抛错不落盘（强制备份，防密钥丢失后
//      加密数据全部不可读）
//   3. 轮换：新密钥上位 + 旧密钥归档（不删除——历史密文仍需旧密钥解密）
//
// 零 npm 依赖——Node 内建 crypto/fs/path。
// ============================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, readdirSync } from 'fs';
import { join } from 'path';
import { createHash, randomBytes } from 'crypto';

/** 密钥目录：{sofagentHome}/keys/ */
export function keysDirPath(sofagentHome: string): string {
  return join(sofagentHome, 'keys');
}

/** 当前数据密钥路径：{sofagentHome}/keys/data.key */
export function dataKeyPath(sofagentHome: string): string {
  return join(keysDirPath(sofagentHome), 'data.key');
}

/** 初始化标记路径：{sofagentHome}/keys/initialized */
export function initializedMarkerPath(sofagentHome: string): string {
  return join(keysDirPath(sofagentHome), 'initialized');
}

/** 密钥长度（字节）——与 age-wrapper AES_KEY_BYTES 一致 */
export const DATA_KEY_BYTES = 32;

/**
 * 密钥丢失恢复指引（错误信息附带——用户能自助恢复，不至于对着报错发呆）。
 */
export const DATA_KEY_RECOVERY_HINT =
  '数据加密密钥丢失：请从备份恢复 ~/.sofagent/keys/data.key（若曾轮换，keys/*.bak 归档内有历史密钥）。' +
  '若无任何备份，已加密数据（含 data/audit/history.jsonl 加密行）将永久不可读——' +
  '只能重置数据目录重新开始（新生成密钥后，旧加密条目将无法解密读取）。';

/** 生成结果 */
export interface KeyOperationResult {
  /** 新密钥（32 字节随机——调用方转交 age-wrapper） */
  key: Buffer;
  /** SHA-256 指纹前 16 位 hex（打印给用户核对备份） */
  fingerprint: string;
  /** 本次操作归档的旧密钥文件名（首次生成为 null） */
  archivedAs?: string;
}

export interface KeyOperationOptions {
  /**
   * 确认已备份（强制备份门）。
   * 必须显式传 true 才落盘——生成/轮换的调用方（crypto-init）须先向用户
   * 展示指纹并取得「已备份」确认。
   */
  confirmBackup: boolean;
}

/**
 * 计算密钥指纹——SHA-256 前 16 位 hex。
 * 指纹用于人工核对（打印/对账），不可逆推密钥。
 */
export function keyFingerprint(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/**
 * 生成数据密钥（首次初始化用）。
 *
 * @param sofagentHome SOFAGENT_HOME 目录（如 ~/.sofagent）
 * @param options confirmBackup 必须 true——否则抛错且不落任何文件
 * @returns 新密钥 + 指纹
 * @throws confirmBackup !== true / 已存在密钥 / 落盘失败
 */
export function generateDataKey(sofagentHome: string, options: Partial<KeyOperationOptions> = {}): KeyOperationResult {
  if (options.confirmBackup !== true) {
    throw new Error(
      '生成数据密钥前必须确认已备份策略：请先记录密钥指纹并确认离线备份方案，' +
      '再以 confirmBackup=true 调用（密钥丢失 = 加密数据永久不可读）。',
    );
  }
  const kp = dataKeyPath(sofagentHome);
  if (existsSync(kp)) {
    throw new Error(`数据密钥已存在（${kp}）——如需更换请用 rotateDataKey（旧密钥归档不删除）`);
  }
  return writeNewKey(sofagentHome);
}

/**
 * 加载数据密钥。
 *
 * @returns 32 字节密钥；不存在/内容非法时返回 null（调用方决定是否引导生成）
 */
export function loadDataKey(sofagentHome: string): Buffer | null {
  const kp = dataKeyPath(sofagentHome);
  if (!existsSync(kp)) return null;
  try {
    const b64 = readFileSync(kp, 'utf-8').trim();
    const key = Buffer.from(b64, 'base64');
    if (key.length !== DATA_KEY_BYTES) {
      // v1.4.5 (T3): 密钥损坏降级告警——此前静默 return null，调用方无法区分
      // 「未初始化」与「已损坏」，排障体验差且损坏可能被长期忽略（静默降级 = 风险累积）。
      // 仍返回 null（不抛错——保持既有调用方契约），但必须显眼告警 + 指引。
      console.warn(
        `[sofagent] ⚠️ 数据密钥内容损坏（长度 ${key.length} 字节，应为 ${DATA_KEY_BYTES}）: ${kp}\n` +
        `    以损坏密钥继续将解不开任何密文。修复路径：\n` +
        `    1. 检查是否编辑过该文件（base64 是否被截断/换行）\n` +
        `    2. 从离线备份恢复后重试\n` +
        `    3. 确认放弃旧数据后运行 rotateDataKey 生成新密钥`,
      );
      return null;
    }
    return key;
  } catch {
    // v1.4.5 (T3): 读失败（IO 错误）同属「密钥不可用但非未初始化」——告警而非静默
    console.warn(
      `[sofagent] ⚠️ 数据密钥读取失败（IO 错误，文件存在但不可读）: ${kp}\n` +
      `    请检查文件权限与磁盘状态。`,
    );
    return null;
  }
}

/**
 * 轮换数据密钥：新密钥上位，旧密钥归档为 data.key.<YYYYMMDD>.bak。
 *
 * 旧密钥**不删除**——历史密文仍需旧密钥解密（v1.3.8 不做全量重加密，
 * 读侧遇到解不开的旧行会按「密钥丢失」路径报错并给出恢复指引）。
 *
 * @param sofagentHome SOFAGENT_HOME 目录
 * @param options confirmBackup 必须 true（与生成同门——新密钥同样要先备份）
 * @returns 新密钥 + 指纹 + 归档文件名
 * @throws confirmBackup !== true / 密钥不存在（轮换前置条件是先有密钥）
 */
export function rotateDataKey(sofagentHome: string, options: Partial<KeyOperationOptions> = {}): KeyOperationResult {
  if (options.confirmBackup !== true) {
    throw new Error('轮换数据密钥前必须确认已备份新密钥方案（confirmBackup=true）');
  }
  const old = loadDataKey(sofagentHome);
  if (old === null) {
    throw new Error(`无可轮换的密钥（${dataKeyPath(sofagentHome)} 不存在或非法）——请先 generateDataKey`);
  }
  // 归档旧密钥（同日多次轮换加序号后缀，不覆盖）
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let archiveName = `data.key.${stamp}.bak`;
  const dir = keysDirPath(sofagentHome);
  if (existsSync(join(dir, archiveName))) {
    let seq = 2;
    while (existsSync(join(dir, `data.key.${stamp}.${seq}.bak`))) seq += 1;
    archiveName = `data.key.${stamp}.${seq}.bak`;
  }
  writeFileSync(join(dir, archiveName), old.toString('base64') + '\n', { encoding: 'utf-8', mode: 0o600 });

  const result = writeNewKey(sofagentHome);
  return { ...result, archivedAs: archiveName };
}

/**
 * 确保密钥目录存在且权限恒 0700。
 *
 * v1.3.9 四十六：mkdirSync 仅在「创建时」设 mode——目录已存在且被外部改松权限
 * （如 chmod 755 / 恢复备份）时不会重设。显式 chmod 收紧到 0700（纵深防御，
 * 防同机其他用户读密钥）。chmod 失败不阻断密钥生成（密钥文件自身 0600 是最后防线）。
 */
function ensureKeysDir(sofagentHome: string): void {
  const dir = keysDirPath(sofagentHome);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch (e) {
    console.warn(`[key-manager] 密钥目录权限收紧失败（${dir}）: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 写入新密钥（生成/轮换共用——32 字节随机 + 0600 + 指纹） */
function writeNewKey(sofagentHome: string): KeyOperationResult {
  const key = randomBytes(DATA_KEY_BYTES);
  ensureKeysDir(sofagentHome);
  const kp = dataKeyPath(sofagentHome);
  // tmp+rename 原子写防半写密钥；mode 0600 仅当前用户可读。
  // v1.3.9 四十六：tmp 名加随机后缀 + 'wx'（O_EXCL）防可预测名竞态/预创建。
  const tmp = `${kp}.tmp.${process.pid}.${randomBytes(6).toString('hex')}`;
  writeFileSync(tmp, key.toString('base64') + '\n', { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
  const { renameSync } = require('fs') as typeof import('fs');
  renameSync(tmp, kp);
  try {
    chmodSync(kp, 0o600); // rename 保留 tmp 的 mode，双保险（umask 差异场景）
  } catch {
    /* chmod 失败不阻断——tmp 已按 0600 创建 */
  }
  return { key, fingerprint: keyFingerprint(key) };
}

/** 写初始化标记（首启引导完成后调用——此后不再重复引导） */
export function writeInitializedMarker(sofagentHome: string): void {
  const marker = initializedMarkerPath(sofagentHome);
  ensureKeysDir(sofagentHome); // 0700 与 keyManagerEnsureDir 对齐（S153：密钥目录权限一致性；v1.3.9 目录已存在也收紧）
  writeFileSync(marker, new Date().toISOString() + '\n', 'utf-8');
}

/** 是否已完成初始化引导（标记存在即 true） */
export function isInitialized(sofagentHome: string): boolean {
  return existsSync(initializedMarkerPath(sofagentHome));
}

/** 列出归档密钥文件名（恢复指引用——data.key.*.bak） */
export function listArchivedKeys(sofagentHome: string): string[] {
  const dir = keysDirPath(sofagentHome);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.startsWith('data.key.') && f.endsWith('.bak'));
}
