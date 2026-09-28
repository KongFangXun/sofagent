// ============================================================
// compat/cordis-service-bridge.ts · cordis 兼容层·services 桥
// ============================================================
//
// `@sofagent/*` 的 @public 面以 `ctx.provider` 形态暴露，插件可 `ctx.get()`
// 取得判定/审计/沉淀能力（形态=通道：桥接协议在本仓、插件本体在外）。
//
// 🔴 兼容面向「接口集」不面向「具体插件」（红线 A-2①）：
//   对照全集 = 宿主公开服务面七类（skills / llm / tools / system-prompt /
//   commands / subagent / session——cordis ctx 面的既有服务类目），主干侧
//   把 @sofagent/* 的 @public 能力映射进这七类的**语义对应位**；不为任何
//   具体第三方插件写特例分支。
//
// 桥的语义（provider/get 双面）：
//   - provider 侧：宿主/主干把能力注册为 `sofagent.<域>` 命名空间服务
//     （与 plugin-kit 的 provide('sofagent.<short>') 同款命名空间形态）；
//   - get 侧：插件 `ctx.get('sofagent.<域>')` 取得能力对象（invoke 面）。
//
// 降级红线：桥不 import cordis 类型、不要求宿主面在场——纯 TS 对象桥，
// 挂载方（宿主装配点）决定把 provider 面接到真实 ctx.provide 还是仅作
// 进程内服务表（预检/测试消费）。
// ============================================================

/** 服务提供者形态（@sofagent/* @public 面在桥上的投影） */
export interface SofagentServiceProvider {
  /** 服务调用面（桥内动态 import 目标包的 @public 函数——懒加载红线） */
  invoke(api: string, ...args: unknown[]): Promise<unknown>;
  /** 该服务的能力面自述（预检/对账用——非函数清单） */
  meta: { pkg: string; namespace: string; apis: readonly string[] };
}

/** services 桥读数（「services 桥可调用」验收的机判面） */
export interface CordisServiceBridgeStats {
  /** 已注册的服务命名空间数 */
  registered: number;
  /** 累计 invoke 调用数 */
  invocations: number;
  /** 累计调用失败数（目标 API 缺席/抛错——降级可见） */
  failures: number;
}

/** services 桥句柄 */
export interface CordisServiceBridge {
  stats: CordisServiceBridgeStats;
  /** 注册一个 @sofagent/* 包的 @public 面为命名空间服务 */
  register(pkg: string, namespace: string, apis: readonly string[]): SofagentServiceProvider;
  /** ctx.get 等价面：按命名空间取服务（未注册返回 undefined） */
  get(namespace: string): SofagentServiceProvider | undefined;
  /** 已注册命名空间清单（预检段 ②「调的服务在不在」的对照源） */
  namespaces(): readonly string[];
  dispose(): void;
}

/**
 * 建一个 services 桥（主干 @public 面 → cordis ctx.provider 形态）。
 *
 * 使用形态（宿主装配点）：
 *   const bridge = createCordisServiceBridge();
 *   bridge.register('@sofagent/audit', 'audit', ['runRules', 'emitDecision']);
 *   bridge.register('@sofagent/core', 'skills', ['getDataDir']);
 *   // 宿主有 provide 面时逐命名空间挂接：
 *   //   ctx.provide(`sofagent.${ns}`, provider)
 *   // 插件侧：ctx.get('sofagent.audit').invoke('runRules', ...)
 *
 * invoke 语义：动态 import 目标包（懒加载——缺依赖时该包的服务可注册但
 * 调用抛可读错误，不阻断其余命名空间），函数缺席同样抛可读错误（fail-loud
 * ——静默成功会造「能力在场」假象）。
 */
export function createCordisServiceBridge(): CordisServiceBridge {
  const services = new Map<string, SofagentServiceProvider>();
  const dynamicImports = new Map<string, Promise<Record<string, unknown>>>();
  let invocations = 0;
  let failures = 0;

  const loadPkg = (pkg: string): Promise<Record<string, unknown>> => {
    let p = dynamicImports.get(pkg);
    if (!p) {
      p = import(pkg) as Promise<Record<string, unknown>>;
      dynamicImports.set(pkg, p);
    }
    return p;
  };

  return {
    stats: {
      get registered() {
        return services.size;
      },
      get invocations() {
        return invocations;
      },
      get failures() {
        return failures;
      },
    },
    register(pkg: string, namespace: string, apis: readonly string[]): SofagentServiceProvider {
      const provider: SofagentServiceProvider = {
        meta: { pkg, namespace, apis: [...apis] },
        async invoke(api: string, ...args: unknown[]): Promise<unknown> {
          invocations += 1;
          try {
            const mod = await loadPkg(pkg);
            const fn = mod[api];
            if (typeof fn !== 'function') {
              throw new Error(`${pkg}.${api} 不是可调用函数（services 桥：目标不在 @public 面声明内）`);
            }
            return await (fn as (...a: unknown[]) => unknown)(...args);
          } catch (err) {
            failures += 1;
            throw err instanceof Error
              ? err
              : new Error(`services 桥调用失败（${pkg}.${api}）：${String(err)}`);
          }
        },
      };
      services.set(namespace, provider);
      return provider;
    },
    get(namespace: string): SofagentServiceProvider | undefined {
      return services.get(namespace);
    },
    namespaces(): readonly string[] {
      return [...services.keys()];
    },
    dispose(): void {
      services.clear();
      dynamicImports.clear();
    },
  };
}

/**
 * 主干默认服务注册表声明（宿主 ctx 面七类的语义对应位——接口集口径）。
 *
 * 🔴 声明纪律（与「兼容面向接口集」同源）：`apis` 内每个符号**必须是目标包
 *   @public 面的真实导出**（宿主公开服务面口径）——桥经动态 import 取
 *   `mod[api]`，声明了不存在的符号会让插件调用抛「不是可调用函数」的假缺口。
 *   落笔前逐符号 `git grep` 复核（本版）：
 *     · @sofagent/audit ： runRules（public-api.ts:23）· emitDecision（:96）
 *     · @sofagent/evolve： runEvolve（index.ts:30）——⚠️ 非 `runEvolutionCycle`
 *     · @sofagent/inject： buildConstrainedSystemPrompt（index.ts:191）
 *     · @sofagent/core  ： getDataDir（index.ts:205）· getHmacKey（:400）·
 *                          verifyAgentIdentity（:44）
 *
 * 对照关系（skills / llm / tools / system-prompt / commands / subagent /
 * session 七类是 cordis 宿主面类目；主干 @public 面按语义归位，非一一映射）：
 *   - tools 语义位（判定/审计能力）→ @sofagent/audit 的规则面 + 决策留痕面
 *   - skills 语义位（沉淀能力）→ @sofagent/evolve 的进化集成面
 *   - system-prompt 语义位（注入约束）→ @sofagent/inject 的约束注入面
 *   - session 语义位（身份与目录）→ @sofagent/core 的数据面 + 身份验签面
 * llm / commands / subagent 三类是宿主原生域（模型调用/命令/子代理编排），
 * 主干不越界提供——保留类目名以示对照全集，映射留空。
 *
 * ⚠️ 出站留痕面（egress-audit 的 recordEgressDecision）不入本表——它不在
 * `@sofagent/audit` 的 @public 面（见 ai-node-egress.ts 的接线决策：留痕走
 * 注入式 sink，不越 API 分级红线）。裸声明非 @public 符号会造「能力在场」假象。
 */
export const DEFAULT_SERVICE_DECLARATIONS: ReadonlyArray<{
  pkg: string;
  namespace: string;
  hostCategory: 'tools' | 'skills' | 'system-prompt' | 'session';
  apis: readonly string[];
}> = Object.freeze([
  Object.freeze({
    pkg: '@sofagent/audit',
    namespace: 'audit',
    hostCategory: 'tools',
    apis: Object.freeze(['runRules', 'emitDecision']),
  }),
  Object.freeze({
    pkg: '@sofagent/evolve',
    namespace: 'evolve',
    hostCategory: 'skills',
    apis: Object.freeze(['runEvolve']),
  }),
  Object.freeze({
    pkg: '@sofagent/inject',
    namespace: 'inject',
    hostCategory: 'system-prompt',
    apis: Object.freeze(['buildConstrainedSystemPrompt']),
  }),
  Object.freeze({
    pkg: '@sofagent/core',
    namespace: 'core',
    hostCategory: 'session',
    apis: Object.freeze(['getDataDir', 'getHmacKey', 'verifyAgentIdentity']),
  }),
] as ReadonlyArray<{ pkg: string; namespace: string; hostCategory: 'tools' | 'skills' | 'system-prompt' | 'session'; apis: readonly string[] }>);
