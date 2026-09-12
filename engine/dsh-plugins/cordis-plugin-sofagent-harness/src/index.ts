// cordis-plugin-sofagent-harness · DSH 反向插件（v1.4.8 第8批 · 聚合编排层）
// seam 挂载：non-seam:plugin-suite    # 语义：非宿主事件接入（插件聚合）——一次 apply 逐个挂载 9 个原子插件；能力仍由各原子插件 provide
// 清单生成源 = engine/dsh-plugins/plugins.json（生成 package.json 的 description/sofagent/dsh/optionalDependencies 段与 cordis.patch.yml）；本文件的 seam 字面量由生成器 --check 与之对账。
//
// 🔴 三条硬约束（缺一不可）：
//   ① 只编排，不重实现——每个能力仍由原子插件 provide，本层只依次调用它们的 apply；
//   ② 逐个降级，不整挂失败——缺任一原子插件只记入 failed 数组，其余 8 个照常加载；
//   ③ 不替代细粒度插件——9 个原子插件全部保留，本插件是**新增的整装选项**，不是替代品。

const SUITE: ReadonlyArray<readonly [string, string]> = [
  ['inject', 'cordis-plugin-sofagent-inject'],
  ['audit', 'cordis-plugin-sofagent-audit'],
  ['gate', 'cordis-plugin-sofagent-gate'],
  ['ontology', 'cordis-plugin-sofagent-ontology'],
  ['commons', 'cordis-plugin-sofagent-commons'],
  ['evolve', 'cordis-plugin-sofagent-evolve'],
  ['rollback', 'cordis-plugin-sofagent-rollback'],
  ['daemon', 'cordis-plugin-sofagent-daemon'],
  ['fde', 'cordis-plugin-sofagent-fde'],
];

/** 插件自己的 package.json（版本 SSOT 在插件自身，与其余 9 个插件同形） */
const HOST_PKG = require('../package.json') as { version?: string };

/**
 * 插件元数据（DSH profile / 注册表消费）。
 * 纯声明——本层**不注册任何自己的能力**，故此处只有身份与 seam，没有 bridge 字段。
 */
export const pluginMeta = {
  id: 'cordis-plugin-sofagent-harness',
  version: HOST_PKG.version ?? '0.0.0-unknown',
  description: '一次挂载 sofagent 全套能力（聚合编排层，只编排不重实现）（seam: non-seam:plugin-suite）',
  seam: 'non-seam:plugin-suite',
} as const;

/** 依赖的 sofagent 能力说明（DSH skill 引导链展示） */
export const capability = '一次挂载 sofagent 全套能力（9 项）';

/** 被编排的原子插件清单（短名 → 包名）——供外部只读查阅（与 plugins.json 的 suite 段同源） */
export const suite: ReadonlyArray<readonly [string, string]> = SUITE;

/** 一次 apply 的结果快照：哪几个挂上了、哪几个没挂上（失败**逐个可见**，不静默） */
export interface HarnessReport {
  /** 成功挂载的原子插件短名，如 ['inject', 'audit', …] */
  readonly loaded: string[];
  /** 未挂上的原子插件（短名 + 失败原因）——非空即说明该能力缺席，但其余能力不受影响 */
  readonly failed: Array<{ name: string; reason: string }>;
  /** 原子插件总数（恒为 9） */
  readonly total: number;
  /** 能力说明（与 capability 同值） */
  readonly capability: string;
}

/** 子插件的可调用面（鸭子类型：只要 apply 可调用；不 import cordis / 宿主类型） */
type SubPlugin = { apply?: (c: unknown) => unknown };

/**
 * 跨模块形态取「插件对象」。
 *
 * 🔴 为什么不能直接写 `mod.default?.apply`（实测结论，见 tools/gen 与本批汇报）：
 *    9 个原子插件是 TS 编译出的 **CJS** 模块（`exports.default = kit.plugin` + `__esModule`），
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
 * DSH Cordis 插件契约：一次 apply 把 9 个原子插件逐个挂到同一个 ctx 上。
 *
 * 🔴 适配层红线（与 plugin-kit 同口径）：`ctx: unknown` + 运行时鸭子类型，
 *    不 import cordis / 宿主 SDK 的**类型**；宿主 API 缺席时降级不抛。
 *
 * @param ctx 宿主上下文（鸭子类型：只用 provide；缺席时不崩，用 ctx.sofagent.harness 兜底）
 */
export default {
  async apply(ctx: unknown): Promise<void> {
    const loaded: string[] = [];
    const failed: Array<{ name: string; reason: string }> = [];

    for (const [key, pkg] of SUITE) {
      try {
        const mod = await import(pkg); // 懒加载：缺哪个报哪个，不整挂失败
        await pluginOf(mod).apply?.(ctx);
        loaded.push(key);
      } catch (err) {
        // 逐个降级：单个原子插件缺席（未装 / 未 build / apply 抛错）不阻断其余 8 个
        failed.push({ name: key, reason: err instanceof Error ? err.message : String(err) });
      }
    }

    const report: HarnessReport = { loaded, failed, total: SUITE.length, capability };
    const c = (ctx ?? {}) as {
      provide?: (name: string, service: unknown) => unknown;
      sofagent?: Record<string, unknown>;
    };
    if (typeof c.provide === 'function') {
      c.provide('sofagent.harness', report);
    } else {
      c.sofagent = { ...(c.sofagent ?? {}), harness: report };
    }
  },
};
