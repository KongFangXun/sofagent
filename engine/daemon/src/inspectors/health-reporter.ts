// ============================================================
// health-reporter.ts · daemon 健康状态报告
// v1.3.7 新增
//
// 每次 daemon 运行时覆盖写入 data/dashboard/daemon-health.json
// 替代旧的非结构化 daemon-notice.md
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { resolveDaemonJson, DASHBOARD_DIR } from '@sofagent/core';

/** daemon 健康状态 */
export interface DaemonHealth {
  /** 最后一次运行时间（ISO 8601） */
  lastRun: string;
  /** 整体状态 */
  status: 'ok' | 'degraded' | 'error';
  /** 运行时长（如 "15d 6h"） */
  uptime: string;
  /** 最近告警数 */
  recentAlerts: number;
  /** 最近一次 promote 事件 */
  lastPromote?: {
    date: string;
    from: string;
    to: string;
    summary: string;
  };
  /** 各巡检器状态 */
  inspectors: Record<string, 'ok' | 'warn' | 'error'>;
}

/**
 * 解析 ISO 8601 时间差，返回人类可读的 uptime 字符串。
 *
 * @param startedAt daemon 首次启动时间（ISO 8601）
 * @param now 当前时间（ISO 8601）
 * @returns 如 "15d 6h" / "2h 30m" / "5m"
 */
function computeUptime(startedAt: string, now: string): string {
  const start = new Date(startedAt).getTime();
  const end = new Date(now).getTime();
  if (isNaN(start) || isNaN(end) || start > end) return 'unknown';

  const diffMs = end - start;
  const days = Math.floor(diffMs / 86_400_000);
  const hours = Math.floor((diffMs % 86_400_000) / 3_600_000);
  const minutes = Math.floor((diffMs % 3_600_000) / 60_000);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * 扫描 daemon-notice.md 最近 100 行，提取告警数和最近的 promote 事件。
 *
 * @param noticePath daemon-notice.md 的文件路径
 * @returns { recentAlerts, lastPromote }
 */
function scanDaemonNotice(noticePath: string): {
  recentAlerts: number;
  lastPromote?: DaemonHealth['lastPromote'];
} {
  if (!fs.existsSync(noticePath)) {
    return { recentAlerts: 0 };
  }

  try {
    const content = fs.readFileSync(noticePath, 'utf-8');
    const lines = content.split('\n');
    const tailLines = lines.slice(-Math.min(100, lines.length));

    // 统计告警行：以 "- [" 开头且包含时间戳的行
    let recentAlerts = 0;
    const promotePattern = /promote/i;
    const timestampPattern = /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\]/;

    for (const line of tailLines) {
      if (timestampPattern.test(line)) {
        recentAlerts++;
      }
    }

    // 搜索 promote 事件（从全文中查找最近一条）
    let lastPromote: DaemonHealth['lastPromote'] | undefined;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i] ?? '';
      if (promotePattern.test(line)) {
        const tsMatch = line.match(timestampPattern);
        const date = tsMatch ? tsMatch[1] ?? '' : '';

        // 尝试从行中提取 from/to/summary
        const fromMatch = line.match(/from[:\s]+(\S+)/i);
        const toMatch = line.match(/to[:\s]+(\S+)/i);
        const summaryMatch = line.match(/summary[:\s]+(.+?)(?:\s*$)/i);

        lastPromote = {
          date,
          from: fromMatch?.[1] ?? 'unknown',
          to: toMatch?.[1] ?? 'unknown',
          summary: summaryMatch?.[1] ?? line.trim(),
        };
        break;
      }
    }

    return { recentAlerts, lastPromote };
  } catch {
    return { recentAlerts: 0 };
  }
}

/**
 * 从 daemon.json 读取巡检器状态。
 * daemon.json 中可能包含 last_evidence_score 等字段，
 * 若没有则返回默认全 ok 状态。
 *
 * @param daemonJsonPath daemon.json 路径
 * @returns 巡检器状态映射
 */
function readInspectorStatuses(daemonJsonPath: string): Record<string, 'ok' | 'warn' | 'error'> {
  const defaultStatuses: Record<string, 'ok' | 'warn' | 'error'> = {
    'audit-history': 'ok',
    'conflict-check': 'ok',
    'doctor-health': 'ok',
    'knowledge-freshness': 'ok',
    'knowledge-health': 'ok',
    'skill-staleness': 'ok',
    'warn-accumulator': 'ok',
  };

  if (!fs.existsSync(daemonJsonPath)) return defaultStatuses;

  try {
    const raw = JSON.parse(fs.readFileSync(daemonJsonPath, 'utf-8')) as Record<string, unknown>;

    // 若 daemon.json 中有 inspectorStatuses 字段则使用
    if (raw.inspectorStatuses && typeof raw.inspectorStatuses === 'object') {
      const stored = raw.inspectorStatuses as Record<string, unknown>;
      for (const [key, value] of Object.entries(stored)) {
        if (value === 'ok' || value === 'warn' || value === 'error') {
          defaultStatuses[key] = value;
        }
      }
    }

    // 从 overall 状态推导（若 last_evidence_score 为 error 则整体 degraded）
    const evidenceScore = raw.last_evidence_score;
    if (evidenceScore === 'error') {
      for (const key of Object.keys(defaultStatuses)) {
        defaultStatuses[key] = 'error';
      }
    }

    return defaultStatuses;
  } catch {
    return defaultStatuses;
  }
}

/**
 * 生成并写入 daemon 健康报告到 data/dashboard/daemon-health.json。
 *
 * 每次 daemon 运行时覆盖写入（不是追加）。
 * 写入失败不影响 daemon 主流程（try/catch + console.warn）。
 *
 * @param projectDir 项目根目录
 * @returns 生成的健康报告对象；写入失败时返回 null
 */
export function runHealthReport(projectDir: string): DaemonHealth | null {
  // v1.2.1：daemon.json 从 .sofagent/ 迁移到 data/；
  // daemon-notice.md 是遗留非结构化日志（本模块正是其替代方案），仍读旧位置做兼容
  const sofagentDir = path.join(projectDir, '.sofagent');
  const daemonJsonPath = resolveDaemonJson(projectDir);
  const noticePath = path.join(sofagentDir, 'daemon-notice.md');
  const outputDir = DASHBOARD_DIR;
  const outputPath = path.join(outputDir, 'daemon-health.json');

  const now = new Date().toISOString();

  // 读取 daemon 首次启动时间
  let startedAt = '';
  if (fs.existsSync(daemonJsonPath)) {
    try {
      const daemonConfig = JSON.parse(fs.readFileSync(daemonJsonPath, 'utf-8')) as Record<string, unknown>;
      startedAt = typeof daemonConfig.started_at === 'string' ? daemonConfig.started_at : '';
    } catch {
      // daemon.json 损坏，继续
    }
  }

  // 若 daemon.json 中没有 started_at，从 daemon-notice.md 最老的时间戳推算
  if (!startedAt && fs.existsSync(noticePath)) {
    try {
      const noticeContent = fs.readFileSync(noticePath, 'utf-8');
      const firstTs = noticeContent.match(/\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\]/);
      if (firstTs?.[1]) {
        startedAt = firstTs[1];
      }
    } catch {
      // 读取失败，继续
    }
  }

  // 计算 uptime
  const uptime = startedAt
    ? computeUptime(startedAt, now)
    : 'unknown';

  // 扫描 daemon-notice.md 获取告警和 promote 事件
  const { recentAlerts, lastPromote } = scanDaemonNotice(noticePath);

  // 读取巡检器状态
  const inspectors = readInspectorStatuses(daemonJsonPath);

  // 判断整体状态
  let overallStatus: DaemonHealth['status'] = 'ok';
  const inspectorValues = Object.values(inspectors);
  if (inspectorValues.some((v) => v === 'error')) {
    overallStatus = 'error';
  } else if (inspectorValues.some((v) => v === 'warn') || recentAlerts > 50) {
    overallStatus = 'degraded';
  }

  const health: DaemonHealth & { process?: Record<string, unknown>; fatigue?: unknown } = {
    lastRun: now,
    status: overallStatus,
    uptime,
    recentAlerts,
    ...(lastPromote ? { lastPromote } : {}),
    inspectors,
  };

  // v1.5.5 批 19：单源化收口——报告并入进程心跳侧的关键字段（dashboard 一处读全）。
  // 此前双事实源：心跳写 {SOFAGENT_DATA}/daemon-health.json、报告写
  // {SOFAGENT_DATA}/dashboard/daemon-health.json，dashboard 只读后者 ⇒ pid/版本/
  // lastHeartbeat/fatigue 对 dashboard 不可见。并入不改心跳文件本体（双写方各司其
  // 职：心跳管进程活性、报告管巡检聚合），dashboard 侧自此单点可读。
  try {
    const { resolveHealthFilePath } = require('../daemon-health') as typeof import('../daemon-health');
    const heartbeatPath = resolveHealthFilePath();
    if (fs.existsSync(heartbeatPath)) {
      const hb = JSON.parse(fs.readFileSync(heartbeatPath, 'utf-8')) as Record<string, unknown>;
      health.process = {
        pid: hb.pid,
        version: hb.version,
        startTime: hb.startTime,
        lastHeartbeat: hb.lastHeartbeat,
        lastError: hb.lastError ?? null,
      };
      if (hb.fatigue !== null && typeof hb.fatigue === 'object') health.fatigue = hb.fatigue;
    }
  } catch {
    // 心跳文件缺失/损坏——报告照常落盘，process 字段缺省（可观测性增强，不阻塞）
  }

  // 写入 data/dashboard/daemon-health.json
  // F48-③（v1.5.7）：同日覆盖写 + 按周轮转（保留 4 份周档）——
  //   此前每次运行无条件覆盖，历史健康趋势不可回看（Dashboard 只见最后一帧）。
  //   轮转档命名 daemon-health-YYYY-Www.json（ISO 周号），新周首写时把当前档
  //   归位为上周档、删除超保留数的旧档。消费方（sofagent-dashboard.sh 与
  //   ARCHITECTURE 数据流速览表）读当前档不变——周档是追加的回看面，零迁移。
  //   写入频率 = daemon 每次巡检（ARCHITECTURE「数据流速览」表口径）。
  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    rotateWeeklyArchive(outputDir, 'daemon-health.json', now);
    fs.writeFileSync(outputPath, JSON.stringify(health, null, 2), 'utf-8');
    return health;
  } catch (err) {
    console.warn(`[health-reporter] 写入健康报告失败: ${(err as Error).message}`);
    return null;
  }
}

/** 周档保留数（F48-③：保留 4 份周档 ≈ 一个月回看窗） */
const WEEKLY_KEEP = 4;

/**
 * F48-③：按周轮转——当前档跨周时归位为上周档、清理超保留数旧档。
 * 纯文件操作：目录不存在/无旧档时零副作用；单步失败静默（轮转是回看增强，
 * 不阻断报告写主流程）。
 */
function rotateWeeklyArchive(dir: string, baseName: string, nowISO: string): void {
  try {
    const current = require('path').join(dir, baseName) as string;
    if (!fs.existsSync(current)) return;
    const stat = fs.statSync(current);
    // 当前档的写入周 vs 本周：跨周才归位（同周 = 覆盖写语义，不轮转）
    const isoWeek = (d: Date): string => {
      const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      const dayNum = t.getUTCDay() || 7;
      t.setUTCDate(t.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
      const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
      return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
    };
    const fileWeek = isoWeek(stat.mtime);
    const nowWeek = isoWeek(new Date(nowISO));
    if (fileWeek === nowWeek) return;
    // 归位：当前档 → daemon-health-<fileWeek>.json
    const archived = require('path').join(dir, baseName.replace(/\.json$/, `-${fileWeek}.json`)) as string;
    fs.copyFileSync(current, archived);
    // 清理超保留数旧档（按文件名排序 = 周序，删最旧）
    const prefix = baseName.replace(/\.json$/, '-');
    const oldArchives = fs.readdirSync(dir)
      .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
      .sort();
    for (let i = 0; i < oldArchives.length - WEEKLY_KEEP; i++) {
      try { fs.unlinkSync(require('path').join(dir, oldArchives[i]!) as string); } catch { /* 单档删除失败不阻断 */ }
    }
  } catch {
    // 轮转自身失败不阻断报告写（回看增强非依赖）
  }
}
