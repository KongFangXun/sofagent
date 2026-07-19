// ============================================================
// usb-detect.ts · USB federation 检测 + 安全层（v1.1.6 增强）
// v1.1.6 基础版无签名校验——任何人制作 SOFAGENT 卷标 U 盘即可注入任意配置
// v1.1.6 补上：
//   - HMAC-SHA256 签名校验（federation.json 配 .sig sidecar）
//   - 密钥独立存放 ~/.sofagent/usb-secret.key（install 时生成，不进 git）
//   - exportToUSB 自动签名
//   - FederationConfig schema 校验
//   - applyFederation 实现（nodes → orchestrator/nodes/、policies → audit/policies/，
//     不覆盖已有文件只 warning）
// ============================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

/** SOFAGENT USB 设备卷标标识 */
const SOFAGENT_LABEL = 'SOFAGENT';

/** federation 配置文件名 */
const FEDERATION_FILE = 'federation.json';

/** 签名 sidecar 文件名 */
const SIGNATURE_FILE = 'federation.json.sig';

/** 用户密钥路径（~/.sofagent/usb-secret.key） */
function getSecretKeyPath(): string {
  return path.join(os.homedir(), '.sofagent', 'usb-secret.key');
}

/** federation 配置（v1.1.5 schema） */
export interface FederationConfig {
  /** schema 版本（当前 1） */
  version: number;
  /** 联邦节点（FDE 客户侧节点定义） */
  nodes?: Array<{ name: string; platform: string; description?: string }>;
  /** 审计策略（A1-A19 / E1-E4 配置覆盖） */
  policies?: Record<string, unknown>;
  /** 备注 */
  notes?: string;
}

/** 检测结果 */
export interface UsbDetectResult {
  detected: boolean;
  message: string;
  mountPoint?: string;
  /** v1.1.5: 验签 / schema 校验失败原因 */
  error?: 'no-device' | 'no-file' | 'json-parse' | 'signature-missing' | 'signature-mismatch' | 'schema-invalid' | 'secret-missing';
}

/** applyFederation 结果 */
export interface ApplyResult {
  applied: boolean;
  warnings: string[];
  message: string;
}

// ============================================================
// 密钥管理
// ============================================================

/**
 * 加载用户密钥；不存在时自动生成（32 字节随机 hex）
 * @returns 密钥 Buffer
 */
export function loadOrCreateSecretKey(): Buffer {
  const keyPath = getSecretKeyPath();
  if (fs.existsSync(keyPath)) {
    const hex = fs.readFileSync(keyPath, 'utf-8').trim();
    return Buffer.from(hex, 'hex');
  }
  // 首次生成
  const dir = path.dirname(keyPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyPath, key.toString('hex'), { mode: 0o600 });
  return key;
}

/**
 * 计算 federation.json 的 HMAC-SHA256 签名
 */
export function signFederation(content: string, key: Buffer): string {
  return crypto.createHmac('sha256', key).update(content, 'utf-8').digest('hex');
}

/**
 * 校验签名（恒定时间比较防时序攻击）
 */
export function verifySignature(content: string, signature: string, key: Buffer): boolean {
  const expected = signFederation(content, key);
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, 'utf-8'), Buffer.from(signature, 'utf-8'));
}

// ============================================================
// Schema 校验
// ============================================================

/**
 * 校验 federation.json 是否符合 FederationConfig schema
 */
export function validateFederationSchema(data: unknown): data is FederationConfig {
  if (typeof data !== 'object' || data === null) return false;
  const cfg = data as Record<string, unknown>;
  if (typeof cfg.version !== 'number') return false;
  if (cfg.nodes !== undefined) {
    if (!Array.isArray(cfg.nodes)) return false;
    for (const node of cfg.nodes) {
      if (typeof node !== 'object' || node === null) return false;
      const n = node as Record<string, unknown>;
      if (typeof n.name !== 'string' || typeof n.platform !== 'string') return false;
    }
  }
  if (cfg.policies !== undefined && (typeof cfg.policies !== 'object' || cfg.policies === null)) return false;
  if (cfg.notes !== undefined && typeof cfg.notes !== 'string') return false;
  return true;
}

// ============================================================
// USB 检测（含验签 + schema）
// ============================================================

/**
 * 检测 SOFAGENT USB 设备并导入 federation 配置
 * v1.1.5: 加 HMAC 签名校验 + schema 校验，任何一环失败拒绝导入
 */
export async function detectSofagentUsb(): Promise<UsbDetectResult> {
  try {
    const platform = process.platform;
    let mountPoint: string | null = null;

    if (platform === 'darwin') {
      mountPoint = await findUsbMountMacos();
    } else if (platform === 'linux') {
      mountPoint = findUsbMountLinux();
    } else {
      return {
        detected: false,
        message: `不支持的平台：${platform}`,
        error: 'no-device',
      };
    }

    if (!mountPoint) {
      return {
        detected: false,
        message: '未检测到 SOFAGENT 卷标的可移动存储设备',
        error: 'no-device',
      };
    }

    // 1. 读取 federation.json
    const federationPath = path.join(mountPoint, FEDERATION_FILE);
    if (!fs.existsSync(federationPath)) {
      return {
        detected: false,
        message: `设备已挂载但未找到 ${FEDERATION_FILE}`,
        mountPoint,
        error: 'no-file',
      };
    }

    const rawContent = fs.readFileSync(federationPath, 'utf-8');

    // 2. 验签（v1.1.5 新增——拒绝无签名/签名错误）
    const sigPath = path.join(mountPoint, SIGNATURE_FILE);
    if (!fs.existsSync(sigPath)) {
      return {
        detected: false,
        message: `缺少 ${SIGNATURE_FILE} 签名文件——拒绝导入（v1.1.5 起强制验签）`,
        mountPoint,
        error: 'signature-missing',
      };
    }
    const signature = fs.readFileSync(sigPath, 'utf-8').trim();

    let key: Buffer;
    try {
      key = loadOrCreateSecretKey();
    } catch (err) {
      return {
        detected: false,
        message: `密钥加载失败：${(err as Error).message}`,
        mountPoint,
        error: 'secret-missing',
      };
    }

    if (!verifySignature(rawContent, signature, key)) {
      return {
        detected: false,
        message: '签名不匹配——拒绝导入（federation.json 可能被篡改）',
        mountPoint,
        error: 'signature-mismatch',
      };
    }

    // 3. JSON 解析
    let federationConfig: unknown;
    try {
      federationConfig = JSON.parse(rawContent);
    } catch {
      return {
        detected: false,
        message: `${FEDERATION_FILE} JSON 解析失败`,
        mountPoint,
        error: 'json-parse',
      };
    }

    // 4. Schema 校验
    if (!validateFederationSchema(federationConfig)) {
      return {
        detected: false,
        message: `${FEDERATION_FILE} schema 校验失败（缺 version / nodes 字段类型错）`,
        mountPoint,
        error: 'schema-invalid',
      };
    }

    // 5. 写入 ~/.sofagent/federation.json（同时写 .sig）
    const homeDir = os.homedir();
    const targetDir = path.join(homeDir, '.sofagent');
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, FEDERATION_FILE);
    fs.writeFileSync(targetPath, JSON.stringify(federationConfig, null, 2), 'utf-8');
    fs.writeFileSync(path.join(targetDir, SIGNATURE_FILE), signature, 'utf-8');

    return {
      detected: true,
      message: `成功从 ${mountPoint} 导入 federation 配置（验签通过）→ ${targetPath}`,
      mountPoint,
    };
  } catch (err) {
    return {
      detected: false,
      message: `USB federation 检测失败：${err instanceof Error ? err.message : String(err)}`,
      error: 'no-device',
    };
  }
}

// ============================================================
// exportToUSB（自动签名）
// ============================================================

/**
 * 导出 federation.json 到 USB 设备（自动生成 .sig 签名）
 *
 * @param mountPoint USB 挂载点（如 /Volumes/SOFAGENT）
 * @param config federation 配置
 * @returns 导出结果
 */
export function exportToUSB(mountPoint: string, config: FederationConfig): { success: boolean; message: string } {
  if (!fs.existsSync(mountPoint)) {
    return { success: false, message: `USB 挂载点不存在: ${mountPoint}` };
  }
  if (!validateFederationSchema(config)) {
    return { success: false, message: 'config 不符合 FederationConfig schema' };
  }
  const content = JSON.stringify(config, null, 2);
  const key = loadOrCreateSecretKey();
  const signature = signFederation(content, key);
  try {
    fs.writeFileSync(path.join(mountPoint, FEDERATION_FILE), content, 'utf-8');
    fs.writeFileSync(path.join(mountPoint, SIGNATURE_FILE), signature, 'utf-8');
    return { success: true, message: `已导出到 ${mountPoint}（含签名）` };
  } catch (err) {
    return { success: false, message: `写入失败: ${(err as Error).message}` };
  }
}

// ============================================================
// applyFederation（v1.1.5 实现）
// ============================================================

/**
 * 应用 federation 配置：
 *   - nodes → ~/.sofagent/orchestrator/nodes/<name>.yml
 *   - policies → ~/.sofagent/audit/policies/<name>.yml
 * 不覆盖已有文件——目标存在时 warning 跳过
 */
export function applyFederation(config: FederationConfig): ApplyResult {
  const warnings: string[] = [];
  const homeDir = os.homedir();
  const nodesDir = path.join(homeDir, '.sofagent', 'orchestrator', 'nodes');
  const policiesDir = path.join(homeDir, '.sofagent', 'audit', 'policies');

  let applied = 0;

  // 应用 nodes
  if (config.nodes && config.nodes.length > 0) {
    if (!fs.existsSync(nodesDir)) fs.mkdirSync(nodesDir, { recursive: true });
    for (const node of config.nodes) {
      const target = path.join(nodesDir, `${node.name}.json`);
      if (fs.existsSync(target)) {
        warnings.push(`node "${node.name}" 已存在，跳过（不覆盖）`);
        continue;
      }
      fs.writeFileSync(target, JSON.stringify(node, null, 2), 'utf-8');
      applied++;
    }
  }

  // 应用 policies
  if (config.policies) {
    if (!fs.existsSync(policiesDir)) fs.mkdirSync(policiesDir, { recursive: true });
    for (const [name, policy] of Object.entries(config.policies)) {
      const target = path.join(policiesDir, `${name}.json`);
      if (fs.existsSync(target)) {
        warnings.push(`policy "${name}" 已存在，跳过（不覆盖）`);
        continue;
      }
      fs.writeFileSync(target, JSON.stringify(policy, null, 2), 'utf-8');
      applied++;
    }
  }

  return {
    applied: applied > 0,
    warnings,
    message: `应用 ${applied} 项配置，${warnings.length} 项跳过`,
  };
}

// ============================================================
// USB 挂载点查找（平台特定）
// ============================================================

async function findUsbMountMacos(): Promise<string | null> {
  try {
    const output = execSync('diskutil list external', { encoding: 'utf-8', timeout: 10_000 });
    if (!output.includes(SOFAGENT_LABEL)) return null;

    const volumesDir = '/Volumes';
    if (!fs.existsSync(volumesDir)) return null;

    const entries = fs.readdirSync(volumesDir);
    for (const entry of entries) {
      if (entry.toUpperCase().includes(SOFAGENT_LABEL)) {
        const mountPath = path.join(volumesDir, entry);
        if (fs.statSync(mountPath).isDirectory()) return mountPath;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function findUsbMountLinux(): string | null {
  try {
    if (!fs.existsSync('/proc/mounts')) return null;
    const mounts = fs.readFileSync('/proc/mounts', 'utf-8');
    const lines = mounts.split('\n');

    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length < 4) continue;
      const mountpoint = parts[1];
      const device = parts[0] ?? '';
      if (
        device.toUpperCase().includes(SOFAGENT_LABEL) ||
        (mountpoint && mountpoint.toUpperCase().includes(SOFAGENT_LABEL))
      ) {
        return mountpoint ?? null;
      }
    }
    return null;
  } catch {
    return null;
  }
}
