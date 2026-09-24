// ============================================================
// health-endpoint.ts · /health 三态健康巡检端点（v1.5.2 T1 验收 ⑥）
// ============================================================
//
// 任务书 T1 验收 ⑥ + changelog 一章扩展项：
//   设备 daemon 暴露本地 HTTP 健康巡检端点——返回结构化健康快照，
//   三态判定可注入测试（单模型不可达 → degraded 而非 down），
//   loopback 默认绑定（外部不可达默认安全）。
//
// 三态分层（changelog 一章）：
//   healthy  —— 全部巡检项通过
//   degraded —— 部分巡检项降级（如单模型不可达）——**降级不误报死亡**
//   dead     —— 核心能力全部不可用（引擎自身/全部模型不可达）
//
// 判定纪律（fail-closed 铁律 4 的三态化）：
//   - 巡检项状态不确定（探测超时/异常）按 degraded 计（不因探测失败
//     误报 healthy），核心项探测失败按 dead 计。
//   - 判定函数是纯函数（buildHealthVerdict——注入检查结果数组），
//     可独立单测；HTTP 端点只是它的薄壳。
//
// 架构对齐：与 daemon-health.json 心跳（在线判定）不合并——心跳管
// 「活着吗」，巡检管「活得怎么样」（changelog 一章原文）。
// ============================================================

import * as http from 'http';
import { verifyDeviceEventsChain } from './device-registry';
import { resolveDaemonVersion } from './daemon-health';

// ────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────

/** 三态（changelog 一章：ok / degraded / down——对外字段名沿用 ok/degraded/down） */
export type HealthVerdict = 'healthy' | 'degraded' | 'dead';

/** 单个巡检项的状态 */
export type CheckStatus = 'ok' | 'degraded' | 'dead';

/** 巡检项（注入式——端点侧组装，判定纯函数消费） */
export interface HealthCheckItem {
  /** 巡检项标识（如 'model:qwen3' / 'disk' / 'audit-chain' / 'engine'） */
  id: string;
  /** 巡检项状态（探测结果——注入） */
  status: CheckStatus;
  /** 人读说明（状态原因） */
  detail?: string;
}

/** /health 结构化快照（响应体） */
export interface HealthSnapshot {
  /** 三态汇总（判定纯函数产出） */
  status: HealthVerdict;
  /** 引擎版本（daemon dist 运行时版本戳） */
  version: string;
  /** 巡检时间（ISO 8601） */
  checkedAt: string;
  /** 逐项明细（单项降级不整体误报 down——分层语义） */
  checks: HealthCheckItem[];
  /** 汇总摘要（人读） */
  summary: string;
}

// ────────────────────────────────────────────────────────────
// 三态判定（纯函数——可注入测试）
// ────────────────────────────────────────────────────────────

/**
 * 三态判定纯函数。
 *
 * 规则（「单模型不可达 → degraded 而非 down」的形式化）：
 *   - 空 checks：状态不明（fail-closed → dead，不因无数据误报 healthy）
 *   - 全部 ok → healthy
 *   - 存在 dead：若 dead 全部是**非核心项**（id 不以 'engine' 开头）→ degraded
 *     （外围能力死亡不拖垮整体死亡判定）；存在核心项 dead → dead
 *   - 其余（有 degraded 无 dead / 空）→ degraded
 *
 * @param items 巡检项数组（注入）
 * @returns 三态 + 汇总文案
 */
export function buildHealthVerdict(
  items: HealthCheckItem[],
): { status: HealthVerdict; summary: string } {
  if (items.length === 0) {
    return { status: 'dead', summary: '无巡检数据（fail-closed：不因缺数据误报健康）' };
  }
  const deadItems = items.filter((i) => i.status === 'dead');
  const degradedItems = items.filter((i) => i.status === 'degraded');
  const coreDead = deadItems.some((i) => i.id.startsWith('engine'));
  if (deadItems.length === 0 && degradedItems.length === 0) {
    return { status: 'healthy', summary: `${items.length} 项巡检全部通过` };
  }
  if (deadItems.length > 0 && !coreDead) {
    // 外围项死亡（如单模型不可达）→ degraded 而非 down（验收 ⑥ 原文语义）
    return {
      status: 'degraded',
      summary: `${deadItems.length} 项不可用（${deadItems.map((i) => i.id).join('、')}）——核心能力正常，整体降级`,
    };
  }
  if (coreDead) {
    return { status: 'dead', summary: `核心能力不可用：${deadItems.map((i) => i.id).join('、')}` };
  }
  return {
    status: 'degraded',
    summary: `${degradedItems.length} 项降级（${degradedItems.map((i) => i.id).join('、')}）`,
  };
}

// ────────────────────────────────────────────────────────────
// 巡检项采集（真实探测——daemon 启动接线用，测试可注入替代）
// ────────────────────────────────────────────────────────────

/**
 * 采集巡检项（真实探测）。
 *
 * 巡检面（changelog 一章：引擎版本 / 模型可用性 / 审计链尾部 HMAC 校验）：
 *   - engine:core —— resolveDaemonVersion 能解析版本 → ok（解析失败 → dead）
 *   - audit-chain —— 设备事件链 verifyDeviceEventsChain → ok / degraded
 *   - model:* —— 由 opts.models 注入（模型可达性探测归调用方——daemon 侧
 *     经 fetch 探测注册表内端点；此处只收结果，不内置 HTTP 探测逻辑，
 *     保持本模块零网络依赖、可测）。
 *
 * @param opts.dataDir 数据目录（事件链巡检用）
 * @param opts.models 模型可达性探测结果（注入——daemon 侧接线见 cli.ts）
 */
export function collectHealthChecks(
  opts: { dataDir?: string; models?: Array<{ id: string; reachable: boolean; detail?: string }> } = {},
): HealthCheckItem[] {
  const items: HealthCheckItem[] = [];
  // 引擎核心：版本可解析 = 引擎活着的最低证据
  const version = resolveDaemonVersion();
  items.push(
    version === 'unknown'
      ? { id: 'engine:core', status: 'dead', detail: 'daemon dist 无法定位 package.json' }
      : { id: 'engine:core', status: 'ok', detail: `v${version}` },
  );
  // 审计链完整性（尾部校验——事件链断链 → degraded 不 dead）
  const chain = verifyDeviceEventsChain(opts.dataDir);
  items.push(
    chain.ok
      ? { id: 'audit-chain', status: 'ok', detail: `${chain.total} 条记录链完整` }
      : { id: 'audit-chain', status: 'degraded', detail: `链断裂于第 ${chain.brokenAt} 条（${chain.reason}）` },
  );
  // 模型可达性（注入面——单模型不可达 → 该项 dead；判定层归 degraded）
  for (const m of opts.models ?? []) {
    items.push(
      m.reachable
        ? { id: `model:${m.id}`, status: 'ok' }
        : { id: `model:${m.id}`, status: 'dead', detail: m.detail ?? '不可达' },
    );
  }
  return items;
}

// ────────────────────────────────────────────────────────────
// HTTP 端点（loopback 默认绑定）
// ────────────────────────────────────────────────────────────

/** /health 端点配置 */
export interface HealthEndpointOptions {
  /** 绑定地址（默认 '127.0.0.1'——loopback 默认，外部不可达默认安全） */
  host?: string;
  /** 端口（默认 8787） */
  port?: number;
  /** 巡检项采集器（默认 collectHealthChecks——测试可注入替代） */
  collectChecks?: () => HealthCheckItem[];
  /** dataDir（事件链巡检用——透传给默认采集器） */
  dataDir?: string;
}

/** 运行中的 /health 端点句柄 */
export interface HealthEndpointHandle {
  /** 实际绑定地址 */
  host: string;
  /** 实际绑定端口 */
  port: number;
  /** 关闭端点（幂等） */
  close(): void;
}

/**
 * 启动 /health 三态端点（loopback 默认绑定）。
 *
 * 单端点 daemon（GET /health → JSON 快照；其余路径 404）。判定纯函数 +
 * 采集器注入——端点本身是薄壳，三态语义全部在纯函数层（可注入测试）。
 *
 * ⚠️ 生产接线见 cli.ts：daemon start 时拉起（默认关闭，SOFAGENT_HEALTH_PORT
 * 显式配置才启用——默认不占用端口，安全面优先）。
 *
 * @returns 端点句柄（close 幂等）
 */
export function startHealthEndpoint(options: HealthEndpointOptions = {}): HealthEndpointHandle {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 8787;
  const collect = options.collectChecks ?? (() => collectHealthChecks({ dataDir: options.dataDir }));
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/health/')) {
      const items = collect();
      const verdict = buildHealthVerdict(items);
      const snapshot: HealthSnapshot = {
        status: verdict.status,
        version: resolveDaemonVersion(),
        checkedAt: new Date().toISOString(),
        checks: items,
        summary: verdict.summary,
      };
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(snapshot));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  server.listen(port, host);
  return {
    host,
    port,
    close(): void {
      server.close();
    },
  };
}
