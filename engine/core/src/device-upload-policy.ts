// ============================================================
// device-upload-policy.ts · G11 数据上行通道采集声明（v1.5.1 T3）
// ============================================================
//
// 设备向平台「推」数据的授权边界：采集声明（opt-in）。
//
// 与 T2（device-data-policy.ts）同源纪律（任务书 T3 原文「与 T2 同源」）：
//   - 判定语义一致：默认空 = 不上行（fail-closed 铁律 4）——配置不存在/
//     损坏/字段非法 → 拒绝一切 push。
//   - 配置形态一致：version + deviceId + 采集类别清单。
//   - 边界攻击面一致：类别名精确匹配（无前缀语义——类别是枚举值非路径）。
//
// 采集声明（changelog 三章）：声明「哪些数据类别可上行」——数据类别 +
// 频率 + 目的地。本版策略面判定「类别是否可上行」；频率调度与目的地
// 推送归 daemon 侧 upload-wal / tool 调用方（策略层不持时钟不持网络）。
//
// 配置落 <dataDir>/config/device-upload-policy.json，由 FDE 交付时声明。
// ============================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { join } from 'path';
import { getDataDir } from './data-paths';

/** 采集声明配置文件相对路径（<dataDir>/config/device-upload-policy.json） */
export const DEVICE_UPLOAD_POLICY_FILE = 'config/device-upload-policy.json';

/** 单条采集声明（一个可上行的数据类别） */
export interface UploadDeclaration {
  /** 数据类别（枚举语义：'metrics' 计量摘要 / 'audit-digest' 审计摘要 / 'inference-result' 推理结论） */
  category: string;
  /** 采集频率（cron 表达式或宏——调度归调用方，策略层只做声明登记） */
  frequency?: string;
  /** 目的地（平台端点标识——上行时透传给 push 层校验） */
  destination?: string;
}

/** 采集声明配置（config/device-upload-policy.json 顶层结构） */
export interface DeviceUploadPolicyConfig {
  /** 配置版本（格式演进预留） */
  version: number;
  /** 声明归属设备（deviceId = AgentIdentity.agentId） */
  deviceId: string;
  /** 可上行数据类别清单（空 = 不上行） */
  declarations: UploadDeclaration[];
}

/** 上行授权判定结果（fail-closed 语义显式化） */
export interface DeviceUploadAuthResult {
  /** true = 放行（声明内） */
  ok: boolean;
  /** 拒绝原因（ok=false 时有值） */
  reason?: 'empty-policy' | 'device-not-in-policy' | 'category-not-declared' | 'invalid-params' | 'destination-mismatch';
  /** 命中的声明条目（ok=true 时有值——审计留痕用「依据什么声明」） */
  declaration?: UploadDeclaration;
  message: string;
}

/** 采集声明文件路径（<dataDir>/config/device-upload-policy.json） */
export function deviceUploadPolicyPath(dataDir?: string): string {
  return join(getDataDir(dataDir), DEVICE_UPLOAD_POLICY_FILE);
}

/**
 * 读取采集声明配置。
 *
 * fail-closed：文件不存在 / JSON 损坏 / 结构非法 → null（无声明 = 全拒）。
 * 损坏 warn 留证不抛异常——与 device-data-policy 同纪律。
 */
export function loadDeviceUploadPolicy(dataDir?: string): DeviceUploadPolicyConfig | null {
  const p = deviceUploadPolicyPath(dataDir);
  if (!existsSync(p)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(p, 'utf-8'));
  } catch (err) {
    console.warn(
      `[device-upload-policy] 配置损坏（${p}）：${err instanceof Error ? err.message : String(err)}——按空声明处理（不上行）`,
    );
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const cfg = raw as Partial<DeviceUploadPolicyConfig>;
  if (typeof cfg.deviceId !== 'string' || cfg.deviceId.length === 0) return null;
  if (!Array.isArray(cfg.declarations)) return null;
  // 声明条目运行时校验（category 必须非空字符串；坏条目剔除不整表丢弃）
  const declarations = cfg.declarations.filter((d): d is UploadDeclaration => {
    if (!d || typeof d !== 'object') return false;
    const e = d as unknown as Record<string, unknown>;
    return typeof e.category === 'string' && (e.category as string).length > 0;
  });
  return {
    version: typeof cfg.version === 'number' ? cfg.version : 1,
    deviceId: cfg.deviceId,
    declarations,
  };
}

/**
 * 写入采集声明配置（FDE 声明面 / 运维增删）。
 * 目录 0o700 / 文件 0o600。
 */
export function saveDeviceUploadPolicy(config: DeviceUploadPolicyConfig, dataDir?: string): void {
  const p = deviceUploadPolicyPath(dataDir);
  const dir = join(p, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  writeFileSync(p, JSON.stringify(config, null, 2), 'utf-8');
  try {
    chmodSync(p, 0o600);
  } catch {
    /* 为何可静默：非 POSIX 平台（Windows）无 chmod 语义，0o600 权限收紧为尽力而为，失败不阻断写入主流程 */
  }
}

/**
 * 上行授权判定（G11 核心——验收 ①②）。
 *
 * 判定顺序（fail-closed 逐层收口）：
 *   1. 参数缺失 → invalid-params
 *   2. 无声明 / 声明损坏 → empty-policy（默认空 = 不上行）
 *   3. 声明不归属该设备 → device-not-in-policy
 *   4. 类别未声明 → category-not-declared
 *   5. 目的地与声明不符（声明有 destination 且与请求不一致）→ destination-mismatch
 *
 * 与 T2 authorizeDeviceRead 的差异：类别是枚举精确匹配（非路径前缀），
 * 且多一道目的地核对——上行的数据流向也要在声明范围内。
 */
export function authorizeDeviceUpload(
  deviceId: string,
  category: string,
  opts: { destination?: string; dataDir?: string } = {},
): DeviceUploadAuthResult {
  if (!deviceId || typeof deviceId !== 'string' || !category || typeof category !== 'string') {
    return { ok: false, reason: 'invalid-params', message: 'deviceId / category 参数缺失' };
  }
  const policy = loadDeviceUploadPolicy(opts.dataDir);
  if (!policy) {
    return { ok: false, reason: 'empty-policy', message: '采集声明为空（默认不上行，opt-in）' };
  }
  if (policy.deviceId !== deviceId) {
    return { ok: false, reason: 'device-not-in-policy', message: '声明不归属该设备（deviceId 不匹配）' };
  }
  const decl = policy.declarations.find((d) => d.category === category);
  if (!decl) {
    return { ok: false, reason: 'category-not-declared', message: `数据类别未声明可上行：${category}` };
  }
  // 目的地核对：声明带 destination 时请求必须一致（声明未指定则放行——
  // 目的地管控是声明可选项，不强制 FDE 填写）
  if (decl.destination && opts.destination && decl.destination !== opts.destination) {
    return { ok: false, reason: 'destination-mismatch', message: `目的地与声明不符：请求 ${opts.destination} ≠ 声明 ${decl.destination}` };
  }
  return { ok: true, declaration: decl, message: '声明内放行' };
}
