// ============================================================
// fde-registry-loader.ts · orchestrator FDE 注册表出口的本地薄封装（v1.3.7 交付 5 #4）
// ============================================================
//
// 依赖方向（dev-prompt 交付 5 #4）：fde-registry 的读取方是 daemon，
// 解析/校验函数从 orchestrator index.ts 公开出口导出。daemon 经
// **动态 import**（编译产物 dist）消费——与 cron.ts ab-schedule 同范式。
//
// 本封装把动态 import 收敛到一处，供 companion/inspector 同步调用面使用：
// 加载失败（orchestrator 未安装/dist 未构建）→ 返回 ok=false 的保守结果。
// ============================================================

import type { FDERegistryParseResult, FDERegistryNode } from './fde-registry-types';

export type { FDERegistryParseResult, FDERegistryNode, FDECadence, FDERisk } from './fde-registry-types';

// 动态加载的 orchestrator 出口形状（与 orchestrator/src/fde-registry.ts 对齐）
interface FDERegistryModule {
  loadFDERegistry: (projectDir: string) => FDERegistryParseResult;
  highRiskNodes: (nodes: FDERegistryNode[]) => FDERegistryNode[];
}

let _cached: FDERegistryModule | null = null;

/** 动态加载 orchestrator 的 FDE 注册表出口（成功后缓存） */
function loadModule(): FDERegistryModule | null {
  if (_cached) return _cached;
  try {
    // require 同步消费 orchestrator 编译产物（daemon → orchestrator 方向合法）
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@sofagent/orchestrator') as Partial<FDERegistryModule>;
    if (typeof mod.loadFDERegistry === 'function' && typeof mod.highRiskNodes === 'function') {
      _cached = mod as FDERegistryModule;
      return _cached;
    }
    return null;
  } catch {
    return null;
  }
}

/** 读取并解析 fde-registry.yaml（orchestrator 不可用时保守降级） */
export function loadFDERegistry(projectDir: string): FDERegistryParseResult {
  const mod = loadModule();
  if (!mod) {
    return {
      ok: false,
      nodes: [],
      errors: ['@sofagent/orchestrator 不可用（或 dist 未构建），FDE 注册表巡检降级跳过'],
    };
  }
  return mod.loadFDERegistry(projectDir);
}

/** 高风险节点过滤（同上降级） */
export function highRiskNodes(nodes: FDERegistryNode[]): FDERegistryNode[] {
  const mod = loadModule();
  return mod ? mod.highRiskNodes(nodes) : nodes.filter((n) => n.risk === 'high');
}
