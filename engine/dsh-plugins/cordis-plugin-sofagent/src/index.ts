// cordis-plugin-sofagent · DSH 反向插件（v1.5.0 第8批 · 聚合编排层；v1.5.0 P2 合并批：SUITE 9→6）
// seam 挂载：non-seam:plugin-suite    # 语义：非宿主事件接入（插件聚合）——一次 apply 逐个挂载 6 个原子插件；能力仍由各原子插件 provide
// 清单生成源 = engine/dsh-plugins/plugins.json（生成 package.json 的 description/sofagent/dsh/optionalDependencies 段与 cordis.patch.yml）；本文件的 seam 字面量由生成器 --check 与之对账。
//
// 🔴 三条硬约束（缺一不可）：
//   ① 只编排，不重实现——每个能力仍由原子插件 provide，本层只依次调用它们的 apply；
//   ② 逐个降级，不整挂失败——缺任一原子插件只记入 failed 数组，其余 5 个照常加载；
//   ③ 不替代细粒度插件——6 个原子插件全部保留，本插件是**新增的整装选项**，不是替代品。
//
// v1.5.0 P2 合并说明：原 -ontology/-commons 并入 -fde（厚插件三域），
// 原 -gate 并入 -audit（验收 seam 四值）——原子插件 9→6，本 SUITE 同批收口。

const SUITE: ReadonlyArray<readonly [string, string]> = [
  ['inject', 'cordis-plugin-sofagent-inject'],
  ['audit', 'cordis-plugin-sofagent-audit'],
  ['evolve', 'cordis-plugin-sofagent-evolve'],
  ['rollback', 'cordis-plugin-sofagent-rollback'],
  ['daemon', 'cordis-plugin-sofagent-daemon'],
  ['fde', 'cordis-plugin-sofagent-fde'],
];

/** 插件自己的 package.json（版本 SSOT 在插件自身，与其余 6 个插件同形） */
const HOST_PKG = require('../package.json') as { version?: string };

/**
 * 插件元数据（DSH profile / 注册表消费）。
 * 纯声明——本层**不注册任何自己的能力**，故此处只有身份与 seam，没有 bridge 字段。
 */
export const pluginMeta = {
  id: 'cordis-plugin-sofagent',
  version: HOST_PKG.version ?? '0.0.0-unknown',
  description: '一次挂载 sofagent 全套能力（聚合编排层，只编排不重实现）（seam: non-seam:plugin-suite）',
  seam: 'non-seam:plugin-suite',
} as const;

/** 依赖的 sofagent 能力说明（DSH skill 引导链展示） */
export const capability = '一次挂载 sofagent 全套能力（6 项）';

/** 被编排的原子插件清单（短名 → 包名）——供外部只读查阅（与 plugins.json 的 suite 段同源） */
export const suite: ReadonlyArray<readonly [string, string]> = SUITE;

/**
 * 一次 apply 的结果快照：哪几个挂上了、哪几个没挂上（失败**逐个可见**，不静默）。
 * 另记「走的哪条挂载路径」与「卸载钩子形态」——三条信息合起来才看得出是否有静默降级。
 */
export interface SuiteReport {
  /** 成功挂载的原子插件短名，如 ['inject', 'audit', …]（宿主路径=宿主已收；回落路径=apply 已执行） */
  readonly loaded: string[];
  /** 未挂上的原子插件（短名 + 失败原因）——非空即说明该能力缺席，但其余能力不受影响 */
  readonly failed: Array<{ name: string; reason: string }>;
  /** 原子插件总数（恒为 6） */
  readonly total: number;
  /** 能力说明（与 capability 同值） */
  readonly capability: string;
  /** 经宿主惯用法 `ctx.plugin()` 挂载的短名——这些拿到 inject 就绪门控 + 宿主托管卸载 */
  readonly viaHost: string[];
  /** 经回落路径「直呼 apply」挂载的短名——裸 ctx / 宿主无 ctx.plugin 时即全部 6 个 */
  readonly viaDirect: string[];
  /** 卸载钩子形态：`ctx.on` = 宿主生命周期事件；`apply-return` = 仅靠 apply 返回值（宿主据 _execute 登记） */
  readonly unloadHook: 'ctx.on' | 'apply-return';
}

/** 子插件的可调用面（鸭子类型：apply 可调用 + 可选的 inject/name；不 import cordis / 宿主类型） */
type SubPlugin = {
  apply?: (c: unknown, config?: unknown) => unknown;
  inject?: readonly string[];
  name?: string;
};

/**
 * 宿主 Cordis 上下文的最小结构面（鸭子类型）。
 * 🔴 刻意不 import cordis / 宿主 SDK 的类型——只用结构描述（适配层红线）。
 */
interface HostCtx {
  /** 宿主惯用法：挂载一个插件，返回 ForkScope（含 dispose）或 disposer */
  plugin?: (p: SubPlugin, config?: unknown) => unknown;
  /** 宿主生命周期事件（unload 钩子） */
  on?: (event: string, listener: (...a: unknown[]) => unknown) => unknown;
  provide?: (name: string, service: unknown) => unknown;
  sofagent?: Record<string, unknown>;
  [key: string]: unknown;
}


/**
 * 跨模块形态取「插件对象」。
 *
 * 🔴 为什么不能直接写 `mod.default?.apply`（实测结论，见 tools/gen 与本批汇报）：
 *    6 个原子插件是 TS 编译出的 **CJS** 模块（`exports.default = kit.plugin` + `__esModule`），
 *    而 `await import(pkg)` 在 **CJS 里被 TS 保留为原生动态 import**（`module: node16`）。
 *    Node 对 CJS 的 ESM 互操作把 `default` 指向 `module.exports` 整体，于是
 *      · `mod.default`            = `{ __esModule, default: kit.plugin, pluginMeta, … }`
 *      · `mod.default.apply`      = **undefined**  ← 直呼只会静默空转（?. 兜住，不报错也不生效）
 *      · `mod.default.default.apply` = kit.plugin.apply ← 真正的插件面
 *    故这里逐层解一层 default；对「真 ESM（default 即插件）」形态同样成立。
 */
function pluginOf(mod: unknown): SubPlugin {
  const layer1 = ((mod ?? {}) as { default?: unknown }).default ?? mod;
  const layer2 = ((layer1 ?? {}) as { default?: unknown }).default ?? layer1;
  return (layer2 ?? {}) as SubPlugin;
}

/**
 * DSH Cordis 插件契约：一次 apply 把 6 个原子插件逐个挂到同一个 ctx 上。
 *
 * 🔴 挂载路径（A2 修复）：**优先宿主惯用法 `ctx.plugin(插件)`**——由宿主按各原子插件自己声明的
 *    `inject` 做就绪门控，并把它挂成独立 fiber（卸载时宿主按 fiber 托管反注册其服务）；
 *    宿主无 `ctx.plugin`（裸 ctx）或宿主拒收时才**回落直呼 `apply`**，且仅在 apply 真正可调用时执行。
 *
 * 🔴 卸载路径：apply 返回一条幂等复合 disposer（宿主的 `Fiber._execute` 把「apply 返回函数」
 *    登记为 effect disposer）；宿主另有 `ctx.on` 时再登记一条 `dispose` 监听做双保险（幂等，重复触发只生效一次）。
 *
 * 🔴 适配层红线（与 plugin-kit 同口径）：`ctx: unknown` + 运行时鸭子类型，
 *    不 import cordis / 宿主 SDK 的**类型**；宿主 API 缺席时降级不抛。
 *
 * @param ctx 宿主上下文（鸭子类型：plugin / on / provide 任一缺席都不崩）
 * @returns 幂等复合 disposer（卸载本层时反注册它经手的服务）
 */
export default {
  async apply(ctx: unknown): Promise<() => Promise<void>> {
    const c = (ctx ?? {}) as HostCtx;
    const loaded: string[] = [];
    const failed: Array<{ name: string; reason: string }> = [];
    const viaHost: string[] = [];
    const viaDirect: string[] = [];
    /** 卸载时逆序执行的 disposer（子插件句柄 / 宿主注册 API 返回值 / 本层命名空间条目） */
    const disposers: Array<() => unknown> = [];
    /** 收集宿主返回的可卸载句柄：函数直接用；ForkScope 形态取 .dispose */
    const collect = (ret: unknown): void => {
      if (typeof ret === 'function') {
        disposers.push(ret as () => unknown);
        return;
      }
      const handle = ret as { dispose?: unknown } | null | undefined;
      if (handle && typeof handle.dispose === 'function') {
        disposers.push(() => (handle.dispose as () => unknown).call(handle));
      }
    };
    const mountViaHost = typeof c.plugin === 'function';

    for (const [key, pkg] of SUITE) {
      let sub: SubPlugin;
      try {
        const mod = await import(pkg); // 懒加载：缺哪个报哪个，不整挂失败
        sub = pluginOf(mod);
      } catch (err) {
        // 逐个降级：单个原子插件缺席（未装 / 未 build）不阻断其余 5 个
        failed.push({ name: key, reason: err instanceof Error ? err.message : String(err) });
        continue;
      }

      // ① 宿主惯用法优先：拿到 inject 就绪门控 + 独立 fiber + 宿主托管卸载
      let hostReject: string | null = null;
      if (mountViaHost) {
        try {
          collect(c.plugin?.(sub));
          loaded.push(key);
          viaHost.push(key);
          continue;
        } catch (err) {
          hostReject = `宿主 ctx.plugin 拒收：${err instanceof Error ? err.message : String(err)}`;
        }
      }

      // ② 回落直呼 apply —— 仅当 apply **真正可调用**（apply 缺席时不得计入 loaded：那就是静默空转）
      if (typeof sub.apply !== 'function') {
        failed.push({
          name: key,
          reason: hostReject ? `${hostReject}；且插件无 apply（不可调用）` : '插件无 apply（不可调用）——未挂载',
        });
        continue;
      }
      try {
        collect(await sub.apply(ctx));
        loaded.push(key);
        viaDirect.push(key);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        failed.push({ name: key, reason: hostReject ? `${hostReject}；回落直呼亦失败：${reason}` : reason });
      }
    }

    // ③ 卸载路径：先建幂等 disposer（闭包按引用读 disposers，故此处可先于「本层服务注册」定义）
    let disposed = false;
    const dispose = async (): Promise<void> => {
      if (disposed) return;
      disposed = true;
      for (const undo of disposers.splice(0).reverse()) {
        try {
          await undo();
        } catch (err) {
          console.error('[sofagent-suite] 卸载失败:', err instanceof Error ? err.message : String(err));
        }
      }
    };

    // ④ 宿主生命周期钩子（鸭子类型）——与 apply 返回值双保险
    let unloadHook: SuiteReport['unloadHook'] = 'apply-return';
    if (typeof c.on === 'function') {
      try {
        c.on('dispose', dispose);
        unloadHook = 'ctx.on';
      } catch {
        // 为何可静默：apply 返回值仍在——宿主按 _execute 登记 disposer，
        // c.on 只是双保险；登记失败不等于卸载能力缺失，无降级告警可报。
      }
    }

    // ⑤ 本层自己的报告服务（同样收 disposer，卸载时反注册）
    const report: SuiteReport = { loaded, failed, total: SUITE.length, capability, viaHost, viaDirect, unloadHook };
    if (typeof c.provide === 'function') {
      collect(c.provide('sofagent.suite', report));
    } else {
      c.sofagent = { ...(c.sofagent ?? {}), suite: report };
      disposers.push(() => {
        const now = (c.sofagent ?? {}) as Record<string, unknown>;
        const next: Record<string, unknown> = { ...now };
        delete next.suite;
        c.sofagent = next;
      });
    }

    return dispose;
  },
};
