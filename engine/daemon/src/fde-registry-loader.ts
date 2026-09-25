// ============================================================
// fde-registry-loader.ts · orchestrator FDE 注册表出口的本地薄封装（v1.3.7 交付 5 #4）
// ============================================================
//
// 依赖方向（dev-prompt 交付 5 #4）：fde-registry 的读取方是 daemon，
// 解析/校验函数从 orchestrator index.ts 公开出口导出。daemon 经
// **动态 import**（编译产物 dist）消费——与 cron.ts ab-schedule 同范式。
//
// 本封装把动态 import 收敛到一处，供 companion/inspector 同步调用面使用：
// 加载失败 → 返回 ok=false 的保守结果（消费方 fde-registry-daily 据此
// triggered=false，不按空表继续——F-49 核实）。
//
// F-49 修复（报错说谎）：loadModule 的两条 null 路径（模块级 require 抛错 /
// barrel 未导出目标函数）此前归同一句「orchestrator 不可用（或 dist 未构建）」——
// 真发生 API 漂移时，运维按提示「重编 dist」永远查不到根因（模块在、导出名没了）。
// 现拆两态：模块级失败（未安装 / dist 未构建）与导出面缺失（API 漂移）分别报错，
// 后者明确指向「@sofagent/orchestrator 导出面变更」。
// ============================================================

import type { FDERegistryParseResult, FDERegistryNode } from './fde-registry-types';

export type { FDERegistryParseResult, FDERegistryNode, FDECadence, FDERisk } from './fde-registry-types';

// 动态加载的 orchestrator 出口形状（与 orchestrator/src/fde-registry.ts 对齐）
interface FDERegistryModule {
  loadFDERegistry: (projectDir: string) => FDERegistryParseResult;
  highRiskNodes: (nodes: FDERegistryNode[]) => FDERegistryNode[];
}

/** 加载结果：成功带模块，失败带可区分的失败原因（F-49 报错分因） */
type ModuleLoad =
  | { ok: true; mod: FDERegistryModule }
  | { ok: false; reason: 'module-unavailable' | 'export-drift'; detail: string };

let _cached: ModuleLoad | null = null;

/** 动态加载 orchestrator 的 FDE 注册表出口（成功后缓存——含失败态，避免重复探测） */
function loadModule(): ModuleLoad {
  if (_cached) return _cached;
  let mod: Partial<FDERegistryModule>;
  try {
    // require 同步消费 orchestrator 编译产物（daemon → orchestrator 方向合法）
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require('@sofagent/orchestrator') as Partial<FDERegistryModule>;
  } catch (err) {
    // 态一：模块级失败——未安装 / dist 未构建 / 依赖解析失败
    _cached = {
      ok: false,
      reason: 'module-unavailable',
      detail: `@sofagent/orchestrator 模块不可加载（未安装或 dist 未构建）：${err instanceof Error ? err.message : String(err)}`,
    };
    return _cached;
  }
  if (typeof mod.loadFDERegistry !== 'function' || typeof mod.highRiskNodes !== 'function') {
    // 态二：导出面缺失——模块在但目标函数不在（API 漂移，重编 dist 无用）
    const present = Object.keys(mod).filter((k) => k.includes('FDERegistry') || k.includes('Risk'));
    _cached = {
      ok: false,
      reason: 'export-drift',
      detail:
        '@sofagent/orchestrator 已加载但导出面变更——缺 loadFDERegistry / highRiskNodes。' +
        `检查 orchestrator 的 fde-registry 导出（当前含相关名的导出：${present.join(', ') || '无'}）`,
    };
    return _cached;
  }
  _cached = { ok: true, mod: mod as FDERegistryModule };
  return _cached;
}

/** 测试用：清空模块缓存（缓存含失败态，测试需逐态探测） */
export function _resetFdeRegistryModuleCache(): void {
  _cached = null;
}

/** 读取并解析 fde-registry.yaml（orchestrator 不可用时保守降级） */
export function loadFDERegistry(projectDir: string): FDERegistryParseResult {
  const loaded = loadModule();
  if (!loaded.ok) {
    return {
      ok: false,
      nodes: [],
      errors: [loaded.detail],
    };
  }
  return loaded.mod.loadFDERegistry(projectDir);
}

/**
 * 高风险节点过滤（同降级）。
 * F-49：降级实现与正典（orchestrator/src/fde-registry.ts highRiskNodes）
 * 必须同语义——对账测试见 fde-registry-loader-parity.test.ts。
 */
export function highRiskNodes(nodes: FDERegistryNode[]): FDERegistryNode[] {
  const loaded = loadModule();
  return loaded.ok ? loaded.mod.highRiskNodes(nodes) : nodes.filter((n) => n.risk === 'high');
}
