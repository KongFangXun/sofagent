// ============================================================
// usb-detect.ts · USB federation 基础检测
// v1.1.4 新增 · v1.1.4 审查标注（基础版，无签名校验——企业环境见 SECURITY.md）
//
// 功能（基础版，不做签名校验）：
//   - 扫描挂载的可移动存储设备
//     · macOS：diskutil list external
//     · Linux：读取 /proc/mounts
//   - 检测设备卷标是否为 SOFAGENT
//   - 如果是 → 读取 <mountpoint>/federation.json
//            → 写入 ~/.sofagent/federation.json
//            → 返回检测成功
//
// 错误处理：设备不存在、文件不存在、JSON 解析失败都 try-catch
// 返回明确错误信息，不抛异常。
// ============================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';

/** SOFAGENT USB 设备卷标标识 */
const SOFAGENT_LABEL = 'SOFAGENT';

/** federation 配置文件名 */
const FEDERATION_FILE = 'federation.json';

/** 检测结果 */
export interface UsbDetectResult {
  detected: boolean;
  message: string;
  mountPoint?: string;
}

/**
 * 检测 SOFAGENT USB 设备并导入 federation 配置
 *
 * @returns 检测结果——detected=true 表示成功导入 federation.json
 */
export async function detectSofagentUsb(): Promise<UsbDetectResult> {
  try {
    const platform = process.platform;
    let mountPoint: string | null = null;

    if (platform === 'darwin') {
      // macOS：用 diskutil 扫描外置设备
      mountPoint = await findUsbMountMacos();
    } else if (platform === 'linux') {
      // Linux：读取 /proc/mounts
      mountPoint = findUsbMountLinux();
    } else {
      return {
        detected: false,
        message: `不支持的平台：${platform}（USB federation 仅支持 macOS / Linux）`,
      };
    }

    if (!mountPoint) {
      return {
        detected: false,
        message: '未检测到 SOFAGENT 卷标的可移动存储设备',
      };
    }

    // 读取 federation.json
    const federationPath = path.join(mountPoint, FEDERATION_FILE);
    if (!fs.existsSync(federationPath)) {
      return {
        detected: false,
        message: `设备已挂载（${mountPoint}）但未找到 ${FEDERATION_FILE}`,
        mountPoint,
      };
    }

    const rawContent = fs.readFileSync(federationPath, 'utf-8');
    let federationConfig: unknown;
    try {
      federationConfig = JSON.parse(rawContent);
    } catch {
      return {
        detected: false,
        message: `${FEDERATION_FILE} 解析失败（JSON 格式错误）`,
        mountPoint,
      };
    }

    // 写入 ~/.sofagent/federation.json
    const homeDir = os.homedir();
    const targetDir = path.join(homeDir, '.sofagent');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const targetPath = path.join(targetDir, FEDERATION_FILE);
    fs.writeFileSync(targetPath, JSON.stringify(federationConfig, null, 2), 'utf-8');

    return {
      detected: true,
      message: `成功从 ${mountPoint} 导入 federation 配置 → ${targetPath}`,
      mountPoint,
    };
  } catch (err) {
    return {
      detected: false,
      message: `USB federation 检测失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * macOS：扫描外置设备，查找 SOFAGENT 卷标
 * 返回挂载点路径，未找到返回 null
 */
async function findUsbMountMacos(): Promise<string | null> {
  try {
    // 列出外置磁盘
    const output = execSync('diskutil list external', {
      encoding: 'utf-8',
      timeout: 10_000,
    });

    // 检查卷标是否包含 SOFAGENT
    if (!output.includes(SOFAGENT_LABEL)) {
      return null;
    }

    // 查找挂载点——通过 df 或 mount 确认实际挂载路径
    // 扫描 /Volumes/ 目录下的挂载卷
    const volumesDir = '/Volumes';
    if (!fs.existsSync(volumesDir)) return null;

    const entries = fs.readdirSync(volumesDir);
    for (const entry of entries) {
      if (entry.toUpperCase().includes(SOFAGENT_LABEL)) {
        const mountPath = path.join(volumesDir, entry);
        if (fs.statSync(mountPath).isDirectory()) {
          return mountPath;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Linux：读取 /proc/mounts，查找 SOFAGENT 卷标
 * 返回挂载点路径，未找到返回 null
 */
function findUsbMountLinux(): string | null {
  try {
    if (!fs.existsSync('/proc/mounts')) return null;
    const mounts = fs.readFileSync('/proc/mounts', 'utf-8');
    const lines = mounts.split('\n');

    for (const line of lines) {
      // 格式：device mountpoint fstype options dump pass
      const parts = line.split(/\s+/);
      if (parts.length < 4) continue;
      const mountpoint = parts[1];
      const device = parts[0] ?? '';

      // 检查设备名或挂载点是否含 SOFAGENT 标识
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
