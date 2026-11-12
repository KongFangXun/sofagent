// notify.ts · daemon 通知模块（v1.9.0）
// 所有 daemon 对外通知统一走此模块，确保 sofagent 品牌归属
// ============================================================

const VERSION = '1.9.0';

/** 通知级别 */
export type NotifyLevel = 'info' | 'warn' | 'error';

/** 通知选项 */
export interface NotifyOptions {
  /** 通知级别 */
  level?: NotifyLevel;
  /** 来源模块 */
  source: string;
}

const EMOJI: Record<NotifyLevel, string> = {
  info: 'ℹ️',
  warn: '⚠️',
  error: '❌',
};

/**
 * 发送 daemon 通知——所有输出以 sofagent 品牌开头
 *
 * @param message 通知内容
 * @param options 通知选项
 */
export function notify(
  message: string,
  options: NotifyOptions = { source: 'daemon' }
): void {
  const level = options.level ?? 'info';
  const emoji = EMOJI[level];
  const prefix = `[sofagent-daemon v${VERSION}]`;
  console.log(`${emoji} ${prefix} [${options.source}] ${message}`);
}

/**
 * daemon 启动 banner
 */
export function banner(projectDir: string): void {
  console.log(`sofagent daemon v${VERSION} — 守护进程通知面`);
  console.log(`  监控目录: ${projectDir}`);
  console.log('');
}

// ============================================================
// v1.1.8 新增：知识沉淀主动通知（T05）
//
// 触发源：dream-cycle cycle_complete / knowledge-health 跑完。
// 素材：log.md（本周学习摘要）+ health-report.md（健康报告）。
// 通道：复用 push-target.ts（单机出口 = daemon:notice + openclaw:im outbox）。
// 语义：best-effort（不阻断主流程，但失败必须 notify 留痕）；
//       素材缺失降级"尚无数据"；restricted 不进通知。
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/** 知识摘要素材 */
export interface KnowledgeSummaryMaterial {
  /** dream-cycle 周志摘要（log.md 尾部）；缺失为 null */
  weeklyLog: string | null;
  /** 健康报告摘要（health-report.md 尾部）；缺失为 null */
  healthReport: string | null;
}

/** 素材缺失时的降级文案 */
export const NO_DATA_TEXT = '尚无数据';

/** 通知正文最大长度（防超长推送） */
const SUMMARY_MAX_CHARS = 1500;

/**
 * 读取素材文件尾部（最后 maxChars 字符）；文件不存在/读取失败返回 null
 */
function readTail(filePath: string, maxChars: number): string | null {
  try {
    if (!existsSync(filePath)) return null;
    const content = readFileSync(filePath, 'utf-8').trim();
    if (!content) return null;
    return content.length > maxChars ? content.slice(-maxChars) : content;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null; // existsSync 与 read 之间被删：确为无数据
    // 读失败 ≠ 文件不存在：前者必须留痕，否则正文静默退化为「尚无数据」
    notify(`读取失败（不视为无数据）: ${filePath} — ${(err as Error).message}`, {
      source: 'notify',
      level: 'warn',
    });
    return null;
  }
}

/**
 * 收集知识摘要素材（log.md + health-report.md）
 *
 * @param projectDir 项目根目录（.sofagent 数据目录锚点）
 * @returns 素材对象（缺失字段为 null）
 */
export function collectSummaryMaterial(projectDir: string): KnowledgeSummaryMaterial {
  // F-35：env 读取收敛 SSOT 形态（getDataDir(explicitBase) 语义 = base || env || resolveDataDir）——
  // 但本项目回退语义特殊（项目目录优先于 home），保留显式回退链
  const dataDir = process.env.SOFAGENT_DATA || join(projectDir, '.sofagent');
  return {
    weeklyLog: readTail(join(dataDir, 'log.md'), 800),
    healthReport: readTail(join(dataDir, 'health-report.md'), 800),
  };
}

/**
 * 构建知识摘要通知正文
 *
 * 降级规则：两个素材都缺失 → "尚无数据"占位；单个缺失 → 该节用占位文案。
 * restricted 条目在素材生产侧（dream-cycle/health inspector）已被
 * isSensitivityVisible 过滤，本函数不再二次处理（单一职责）。
 *
 * @param material 素材
 * @returns 通知正文（≤ SUMMARY_MAX_CHARS）
 */
export function buildSummary(material: KnowledgeSummaryMaterial): string {
  const weekly = material.weeklyLog ?? NO_DATA_TEXT;
  const health = material.healthReport ?? NO_DATA_TEXT;
  const body = `📚 知识沉淀周报\n\n── 本周学习 ──\n${weekly}\n\n── 知识库健康 ──\n${health}`;
  return body.length > SUMMARY_MAX_CHARS ? body.slice(0, SUMMARY_MAX_CHARS) + '…' : body;
}

/**
 * 推送知识摘要（best-effort：不阻断主流程，失败返回 false 并 notify 留痕）
 *
 * 单机出口双通道：daemon:notice（本地 console）+ openclaw:im（IM outbox）。
 * pushToTarget 经参数注入（依赖倒置——notify.ts 不直接依赖 push-target，
 * 测试可注入收集器）。
 *
 * @param projectDir 项目根目录
 * @param pushFn 推送函数（签名同 push-target 的 pushToTarget；target 用结构化
 *        字符串类型以便直接传入 pushToTarget——其 PushTargetKind 是字符串字面量
 *        联合，与本签名兼容）
 * @returns 是否至少一个通道推送成功
 */
export async function pushKnowledgeSummary(
  projectDir: string,
  pushFn: (options: { target: 'daemon:notice' | 'openclaw:im'; title: string; message: string }) => Promise<boolean>,
): Promise<boolean> {
  try {
    const summary = buildSummary(collectSummaryMaterial(projectDir));
    const results = await Promise.all([
      pushFn({ target: 'daemon:notice', title: '知识沉淀周报', message: summary }).catch(() => false),
      pushFn({ target: 'openclaw:im', title: '知识沉淀周报', message: summary }).catch(() => false),
    ]);
    return results.some((ok) => ok);
  } catch (err) {
    // best-effort：不阻断 dream-cycle / health 主流程，但必须留痕
    // 可达性：本 catch 只在注入的 pushFn **违约同步抛**时命中；生产注入的 pushToTarget
    // 是 async（永不 reject，失败归一为 Promise<false>）⇒ 本层是防御层，不是主留痕路径。
    // 主留痕在 push-target.ts:86（pushToTarget 的 catch：未配置/SSRF/HTTP 非 2xx/请求失败）。
    notify(`知识摘要推送失败（best-effort，未阻断主流程）: ${(err as Error).message}`, {
      source: 'notify',
      level: 'warn',
    });
    return false;
  }
}
