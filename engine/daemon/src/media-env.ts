// ============================================================
// media-env.ts · 介质读源环境变量的持久化读回（F6.7 R8-5）
// ============================================================
// 问题：`install.sh --media` 只在**安装进程内** export 三个变量，进程退出即消失。
//   daemon 若是被 launchd / systemd / 新终端拉起，进程环境里没有这三个键，
//   `media-source.ts` 就退回联网路径 —— 「介质内读源」只在装完那一瞬间成立。
//
// 做法：安装时把三个变量写进 `<dataDir>/media/media.env`（纯文本 KEY=VALUE），
//   daemon 启动第一步读回。选文件而不选 plist/systemd 的理由：
//     · 三种拉起方式（launchd / systemd / 手动）共用一条路径，不必为每个 OS 写一份；
//     · 文件在数据目录内，随卸载一起清，不会在系统里留孤儿配置；
//     · 可被测试直接构造（plist 不能）。
// 纪律：**已存在的同名环境变量不覆盖**——显式 env 优先于持久化文件（便于排障时临时改指向）。
// ============================================================
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/** 介质环境变量文件名（与 install.sh 写入处必须一致） */
export const MEDIA_ENV_FILE = 'media.env';

/** 介质环境变量清单（改这里必须同批改 install.sh 的写入块） */
export const MEDIA_ENV_KEYS = [
  'SOFAGENT_MEDIA_ROOT',
  'SOFAGENT_MEDIA_WEIGHTS',
  'SOFAGENT_MEDIA_DSH',
] as const;

/** `<dataDir>/media/media.env` 的绝对路径 */
export function mediaEnvPath(dataDir: string): string {
  return join(dataDir, 'media', MEDIA_ENV_FILE);
}

/**
 * 从 `<dataDir>/media/media.env` 读回介质环境变量并写入 process.env。
 *
 * @returns `{ path, loaded, skipped }`：loaded = 实际写入的键；skipped = 文件里有但环境已存在的键。
 */
export function loadMediaEnv(dataDir: string): { path: string; loaded: string[]; skipped: string[] } {
  const path = mediaEnvPath(dataDir);
  const loaded: string[] = [];
  const skipped: string[] = [];
  if (!existsSync(path)) return { path, loaded, skipped };

  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    // 读不到（权限/竞态）⇒ 当作无此文件：调用方会走联网路径，且 trace 里能看到未设
    return { path, loaded, skipped };
  }

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const body = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const eq = body.indexOf('=');
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    if (!(MEDIA_ENV_KEYS as readonly string[]).includes(key)) continue;
    let value = body.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] !== undefined && process.env[key] !== '') {
      skipped.push(key);
      continue;
    }
    process.env[key] = value;
    loaded.push(key);
  }
  return { path, loaded, skipped };
}
