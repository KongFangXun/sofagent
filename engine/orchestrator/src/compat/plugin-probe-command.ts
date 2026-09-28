// ============================================================
// compat/plugin-probe-command.ts · 插件可用性预检 CLI 子命令（v1.5.4 第五章 · A-4 真接线）
// ============================================================
// 用途：给第五章的 **cordis 双桥 + 四段预检** 一个可执行生产入口（对齐 formations/command.ts
//   先例）——此前 createCordisEventBridge / createCordisServiceBridge / probePluginMount
//   零生产消费（「地基面已交付、消费入口未接线」）。
//
// 命令形态（由 cli.ts 的 case 'plugin-probe' 转交）：
//   plugin-probe --self              进程内自检：真建双桥 + 真跑四段预检 → 两态结论
//   plugin-probe --services          打印 services 桥默认命名空间面（@sofagent/* @public 投影）
//   plugin-probe <decl.json> [--json] 读插件声明 JSON → 四段预检（无 apply/fireProbe 槽则如实报缺口）
// 失败语义：诊断入口——verdict='mounted-inert' 返回 1（用户看到「读不出 + 缺口明细」），
//   'usable' 返回 0；参数/schema 错误返回 1（禁静默放行）。
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { getDataDir } from '@sofagent/core';
import { EventBus } from '../events/bus';
import { createCordisEventBridge } from './cordis-event-bridge';
import { createCordisServiceBridge, DEFAULT_SERVICE_DECLARATIONS } from './cordis-service-bridge';
import {
  probePluginMount,
  DSH_HOST_CTX_EVENTS,
  type PluginProbeDeclaration,
  type PluginProbeContext,
} from './plugin-mount-probe';
import { publishAiNodeToolCall } from '../ai-node-events';

export interface PluginProbeCommandIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

const USAGE = [
  '用法:',
  '  plugin-probe --self                进程内自检：真建事件桥/services 桥 + 真跑四段预检',
  '  plugin-probe --services            打印 services 桥默认命名空间面（@sofagent/* @public 投影）',
  '  plugin-probe <decl.json> [--json]  读插件声明 JSON → 四段预检（两态结论 + 缺口明细）',
].join('\n');

/** 建真双桥（事件桥挂真事件总线 / services 桥注册宿主默认 @public 面） */
function buildBridges(dataDir: string) {
  const bus = new EventBus({ dataDir });
  const eventBridge = createCordisEventBridge(bus);
  const serviceBridge = createCordisServiceBridge();
  for (const d of DEFAULT_SERVICE_DECLARATIONS) {
    serviceBridge.register(d.pkg, d.namespace, d.apis);
  }
  return { bus, eventBridge, serviceBridge };
}

/** 打印四段预检结论（两态 + 逐段读数 + 缺口） */
function printVerdict(
  verdict: Awaited<ReturnType<typeof probePluginMount>>,
  out: (s: string) => void,
): void {
  const icon = verdict.verdict === 'usable' ? '✅' : '⚠️';
  out(`${icon} ${verdict.summary}`);
  for (const s of verdict.segments) {
    out(`  ${s.ok ? '✓' : '✗'} ${s.label}：${s.detail}`);
  }
  if (verdict.gaps.length > 0) {
    out('  缺口明细:');
    for (const g of verdict.gaps) out(`    · ${g}`);
  }
  out(
    `  对照源快照：宿主事件名 ${verdict.hostInterface.eventCount} 条 · 服务命名空间 ` +
      `${verdict.hostInterface.serviceNamespaces.length} 个 · 事件桥累计转发 ${verdict.hostInterface.bridgeForwarded}`,
  );
}

/**
 * 插件预检子命令入口。
 * @param args 完整 argv（含首项 'plugin-probe'）
 * @param io   输出通道（缺省 console；测试注入以捕获输出）
 * @returns 退出码：0 可用 / 1 只挂载不生效 或 参数错误
 */
export async function runPluginProbeCommand(
  args: string[],
  io?: Partial<PluginProbeCommandIo>,
): Promise<number> {
  const out = io?.out ?? ((s: string) => console.log(s));
  const err = io?.err ?? ((s: string) => console.error(s));
  const rest = args.slice(1);

  if (rest.length === 0 || rest.includes('--help') || rest.includes('-h')) {
    out(USAGE);
    return rest.length === 0 ? 1 : 0;
  }

  const dataDir = getDataDir();

  // ── --services：打印 services 桥默认命名空间面 ──
  if (rest.includes('--services')) {
    const { serviceBridge } = buildBridges(dataDir);
    out(`services 桥默认命名空间 ${DEFAULT_SERVICE_DECLARATIONS.length} 个（@sofagent/* @public 面投影）：`);
    for (const d of DEFAULT_SERVICE_DECLARATIONS) {
      out(`  sofagent.${d.namespace} ← ${d.pkg} [${d.hostCategory}]：${d.apis.join(', ')}`);
    }
    out(`已注册命名空间：${serviceBridge.namespaces().join(', ') || '（无）'}`);
    return 0;
  }

  // ── --self：进程内自检（真双桥 + 真预检）──
  if (rest.includes('--self')) {
    const { bus, eventBridge, serviceBridge } = buildBridges(dataDir);
    const decl: PluginProbeDeclaration = {
      pluginId: '<self-probe>',
      declaredEvents: DSH_HOST_CTX_EVENTS.slice(0, 3),
      declaredServices: [{ pkg: '@sofagent/core', api: 'getDataDir' }],
      apply: async () => ({ ok: true }),
      fireProbe: async () => {
        await publishAiNodeToolCall(bus, {
          nodeId: 'self-probe',
          tool: 'plugin-probe',
          argsDigest: 'sha256:0000000000000000',
          outcome: 'ok',
        });
        return { fired: true, produced: eventBridge.stats.forwarded };
      },
    };
    const ctx: PluginProbeContext = { serviceBridge, eventBridge };
    const verdict = await probePluginMount(decl, ctx);
    printVerdict(verdict, out);
    return verdict.verdict === 'usable' ? 0 : 1;
  }

  // ── <decl.json>：读声明 JSON 跑预检 ──
  const path = rest.find((a) => !a.startsWith('--'));
  if (!path) {
    err('❌ plugin-probe 需要 --self / --services / <decl.json> 之一');
    err(USAGE);
    return 1;
  }
  if (!existsSync(path)) {
    err(`❌ 插件声明文件不存在: ${path}`);
    return 1;
  }
  let declaration: PluginProbeDeclaration;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<PluginProbeDeclaration>;
    if (!raw.pluginId || !Array.isArray(raw.declaredEvents) || !Array.isArray(raw.declaredServices)) {
      err('❌ 插件声明非法：须含 pluginId(string) / declaredEvents(string[]) / declaredServices({pkg,api}[])');
      return 1;
    }
    declaration = {
      pluginId: raw.pluginId,
      declaredEvents: raw.declaredEvents,
      declaredServices: raw.declaredServices,
    };
  } catch (e) {
    err(`❌ 插件声明解析失败：${(e as Error).message}`);
    return 1;
  }
  const { eventBridge, serviceBridge } = buildBridges(dataDir);
  const verdict = await probePluginMount(declaration, { serviceBridge, eventBridge });
  if (rest.includes('--json')) {
    out(JSON.stringify(verdict, null, 2));
  } else {
    printVerdict(verdict, out);
  }
  return verdict.verdict === 'usable' ? 0 : 1;
}
