// ============================================================
// @sofagent/dsh-plugin-kit · DSH 适配层基座（v1.4.8 第5批 · 适配层标准化 B）
// ============================================================
// 9 个 cordis-plugin-sofagent-*> 的 src/index.ts 此前各 98 行、近乎逐字重复
// （pluginMeta 声明 / 懒加载 invoke / apply 三段式：provide + dynamicCordisRunner + settings）。
// 本包把这段样板收成一次 createSofagentPlugin() 调用，插件侧只留
// 「我是谁 / 我挂哪（seam）/ 我桥接谁」。
//
// 🔴 适配层红线（不绑宿主，靠写法守）：
//   ① 不 import cordis 包、不 import 宿主 SDK 的**类型**——`apply(ctx: unknown)`，
//      只按结构访问 ctx（运行时鸭子类型探测），上下文类型在本文件内联描述。
//   ② 宿主 API 缺席时**降级不抛**：provide / dynamicCordisRunner / settings 三者
//      任一缺席都只跳过该增强项，绝不让 profile 加载崩在适配层。
//   ③ 桥接的 @sofagent/* 能力包用**懒加载**（动态 import）+ 缺依赖降级，插件可独立安装。
//
// ⚠️ 既有形态说明：`require('@deepseek-ai/schemastery')` 是 v1.4.5 T6 起就存在于
//    9 个插件里的**惰性运行时**读取（包在 try/catch 内、非顶层静态 import）。本批
//    **未新增**任何宿主依赖面，只是把它从 9 份复制收敛成 1 份。
//
// ⚠️ 不改运行行为：服务名（sofagent.<short>）、dynamicCordisRunner.define 的入参
//    形状、settings namespace 与默认值，全部与收敛前逐项对齐；仅两处**文案**归一化
//    （见文件末 NOTE）。
// ============================================================

/** 插件清单条目——字段与 engine/dsh-plugins/plugins.json 一一对齐 */
export interface SofagentPluginEntry {
  /** 包名 / 插件 id，如 cordis-plugin-sofagent-audit（同时是服务短名的来源） */
  id: string;
  /** seam 契约值：SEAMS.md 词汇表内的宿主事件名，多个用 ` + ` 连接 */
  seam: string;
  /** seam 语义（与 seam 值成对出现，见 SEAMS.md §5） */
  seamSemantics: string;
  /** 依赖的 sofagent 能力说明（供 DSH skill 引导链展示） */
  capability: string;
  /** 桥接的 sofagent 能力包，如 @sofagent/audit */
  bridgePkg: string;
  /** 桥接包内实际调用的公共 API 函数名，如 runRules */
  bridgeApi: string;
  /** 短描述（不含 seam 与桥接后缀），如「变更机器审阅——24 规则 + git diff 硬证据 + 节点级审计」 */
  description: string;
}

/** createSofagentPlugin 入参：清单条目 + 可选的 envelope 覆盖项 */
export interface SofagentPluginOptions extends SofagentPluginEntry {
  /** 品牌色，默认 #16B8F3 */
  brandColor?: string;
  /** dynamicCordisRunner.define 的 purpose 文案，默认 = description */
  purpose?: string;
  /** 动态插件 host main() 返回的 message，默认 = description */
  readyMessage?: string;
  /** settings 面板的额外字段（值即默认值），如 audit 的 { rules: '24' } */
  settingsExtra?: Record<string, string>;
}

/** 插件自带 package.json 的最小结构——版本 SSOT 在插件自己身上，不在基座 */
export interface SofagentPluginHostPackage {
  version?: string;
}

/** 品牌色（与 9 个插件既有的 #16B8F3 一致） */
const DEFAULT_BRAND_COLOR = '#16B8F3';

/**
 * 插件声明的宿主服务依赖（与各插件 cordis.patch.yml 的 `inject:` 同值）。
 * 🔴 必须**同时**挂在插件对象上（见文件末 plugin 对象），否则宿主用 `ctx.plugin()` 挂载时
 *    拿不到就绪门控——`cordis.patch.yml` 的 `inject` 只对「宿主直接挂载该 id」生效，
 *    经聚合层转挂时不带过去。声明在对象上后两条挂载路径同语义。
 */
export const PLUGIN_INJECT = ['settings', 'dynamicCordisRunner'] as const;

/**
 * 宿主 Cordis 上下文的最小结构面。
 * 🔴 刻意**不** import cordis 的类型——只用结构描述，运行时按鸭子类型探测，
 *    这样引擎/适配层永不编译期依赖宿主 SDK（红线 C）。
 */
interface HostContext {
  provide?: (name: string, service: Record<string, unknown>) => unknown;
  dynamicCordisRunner?: { define?: (request: Record<string, unknown>) => unknown };
  settings?: { register?: (ns: string, schema: unknown, opts?: Record<string, unknown>) => unknown };
  sofagent?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * dynamicCordisRunner.define 的 host 源码（WebUI Plugin list 展示用的小 JS 模块）。
 * 用 JSON.stringify 生成 message 字面量——与手写双引号字符串等价，且自动转义。
 */
function hostCode(source: string, message: string): string {
  return [
    'module.exports = {',
    '  async main(ctx, args) {',
    `    return { ok: true, source: ${JSON.stringify(source)}, message: ${JSON.stringify(message)} };`,
    '  }',
    '};',
  ].join('\n');
}

/**
 * 创建 DSH 适配层插件（pluginMeta + 懒加载 invoke + apply 三段式一次到位）。
 *
 * @param options 插件声明（id / seam / capability / description / bridge / 可选 envelope 覆盖）
 * @param hostPkg 插件自己的 package.json（仅用 version；省略则兜底 '0.0.0-unknown'——缺版本比错版本诚实）
 * @returns { pluginMeta, capability, invoke, plugin } ——插件 src/index.ts 直接再导出即可
 */
export function createSofagentPlugin(options: SofagentPluginOptions, hostPkg?: SofagentPluginHostPackage) {
  const { id, seam, capability, description, bridgePkg, bridgeApi } = options;
  // 短名/服务名/日志前缀：cordis-plugin-sofagent-audit → audit
  const short = id.replace(/^cordis-plugin-sofagent-/, '');
  const brandColor = options.brandColor ?? DEFAULT_BRAND_COLOR;
  const purpose = options.purpose ?? description;
  const readyMessage = options.readyMessage ?? description;
  const settingsExtra = options.settingsExtra ?? {};
  const logTag = `[sofagent-${short}]`;

  /** 插件元数据（DSH profile / 注册表消费） */
  const pluginMeta = {
    id,
    version: hostPkg?.version ?? '0.0.0-unknown',
    description: `${description}（seam: ${seam}）`,
    seam,
  } as const;

  /**
   * 调用桥接的 sofagent @public API（懒加载 + 缺依赖降级）。
   * 包装层职责：把 sofagent 能力暴露成 DSH 可调用的插件函数。
   *
   * @throws 依赖未装 / 能力不可用时抛可读错误——插件可独立安装，让调用方看到原因而非静默失败
   */
  async function invoke<T = unknown>(...args: unknown[]): Promise<T> {
    try {
      // 动态导入：包名来自声明，故不能用字面量 import（缺依赖时由 catch 兜住，不阻断 profile 加载）
      const mod = (await import(bridgePkg)) as Record<string, unknown>;
      const fn = mod[bridgeApi];
      if (typeof fn !== 'function') {
        throw new Error(`${bridgeApi} 不是可调用函数（${bridgePkg} 公共 API）`);
      }
      return (await (fn as (...a: unknown[]) => unknown)(...args)) as T;
    } catch (err) {
      throw new Error(`${id} 依赖 ${bridgePkg} 不可用：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * DSH Cordis 插件契约：apply(ctx) 把 sofagent 能力注册为 ctx 服务（sofagent.<short>）。
   * 插件被挂进 DSH profile（dsh.bundle + cordis.patch.yml）后由 Cordis loader 调用。
   *
   * 🔴 卸载契约：把宿主各注册 API **返回的 disposer** 收成一条复合 disposer 并 **返回**——
   *    cordis 4.x 的 `Fiber._execute` 对「apply 返回函数」登记为 effect disposer，
   *    卸载插件 fiber 时反向执行。故经 `ctx.plugin(本插件)` 转挂时，卸载聚合会连带反注册这些服务。
   *    裸 ctx（无宿主注册 API）下无 disposer 可收，返回 undefined——不产生「跑不到的假契约」。
   *
   * @returns 复合 disposer（幂等；无可卸载面时 undefined）
   */
  function apply(ctx: unknown): undefined | (() => Promise<void>) {
    const c = (ctx ?? {}) as HostContext;
    const service: Record<string, unknown> = { invoke, meta: pluginMeta, capability };
    /** 宿主注册 API 返回的 disposer（鸭子类型：只认「返回值是函数」这一条） */
    const disposers: Array<() => unknown> = [];
    const collect = (ret: unknown): void => {
      if (typeof ret === 'function') disposers.push(ret as () => unknown);
    };

    // ① 能力注册：provide 优先；无 provide API 时挂到 ctx.sofagent.<short> 命名空间（保持可发现）
    if (typeof c.provide === 'function') {
      collect(c.provide(`sofagent.${short}`, service));
    } else {
      const cur = (c.sofagent ?? {}) as Record<string, unknown>;
      c.sofagent = { ...cur, [short]: service };
      // 命名空间分支没有宿主 disposer，自建一个「摘除本条目」的反注册
      disposers.push(() => {
        const now = (c.sofagent ?? {}) as Record<string, unknown>;
        const next: Record<string, unknown> = { ...now };
        delete next[short];
        c.sofagent = next;
      });
    }

    // ② 注册为 dynamicCordisRunner 动态插件（WebUI Plugin list 可见加载状态 + 品牌名）
    try {
      const runner = c.dynamicCordisRunner;
      if (runner && typeof runner.define === 'function') {
        const res = runner.define({
          name: `sofagent-${short}`,
          purpose,
          code: { host: hostCode(`sofagent-${short}`, readyMessage) },
          plugin: { kind: 'new', idPrefix: 'soga' },
          // sessionId 仅作记录字段（define 不校验会话真实性）——profile apply 无会话上下文，传固定标记
          sessionId: 'profile-boot',
        });
        collect(res); // 宿主若返回 disposer，随插件卸载一并撤销动态注册
        console.error(`${logTag} dynamicCordisRunner.define 成功:`, JSON.stringify(res));
      } else {
        console.error(`${logTag} dynamicCordisRunner 服务不可用（inject 未生效）`);
      }
    } catch (err) {
      // define 失败不崩——动态注册为增强项（WebUI Plugin list 显形）
      console.error(`${logTag} define 失败:`, err instanceof Error ? err.message : String(err));
    }

    // ③ 注册 settings namespace（WebUI Settings → Plugins → Plugin configuration 可见）
    try {
      const settings = c.settings;
      if (settings && typeof settings.register === 'function') {
        // 惰性运行时读取宿主 schemastery（既有形态）：缺席时走 catch 降级不崩
        const s = require('@deepseek-ai/schemastery') as {
          object: (shape: Record<string, unknown>) => unknown;
          boolean: () => unknown;
          string: () => unknown;
        };
        // 字段顺序与收敛前一致：enabled → 各 settingsExtra → brandColor
        const shape: Record<string, unknown> = { enabled: s.boolean() };
        for (const k of Object.keys(settingsExtra)) shape[k] = s.string();
        shape.brandColor = s.string();
        const base: Record<string, unknown> = { enabled: true };
        for (const [k, v] of Object.entries(settingsExtra)) base[k] = v;
        base.brandColor = brandColor;
        collect(settings.register(`sofagent-${short}`, s.object(shape), { base })); // 宿主若返回 disposer，随卸载撤销配置面板注册
        console.error(`${logTag} settings.register 成功`);
      } else {
        console.error(`${logTag} settings 服务不可用（inject 未生效）`);
      }
    } catch (err) {
      // settings 服务在 profile apply 时可能未就绪——跳过不崩（配置面板注册为增强项）
      console.error(`${logTag} settings.register 失败:`, err instanceof Error ? err.message : String(err));
    }

    // ④ 卸载契约：收集到的宿主 disposer → 幂等复合 disposer，作为 apply 返回值交宿主登记
    //    （cordis 4.x `Fiber._execute`：apply 返回函数即登记为 effect disposer，fiber 卸载时反向执行）
    if (disposers.length === 0) return undefined;
    let disposed = false;
    return async () => {
      if (disposed) return;
      disposed = true;
      for (const undo of disposers.splice(0).reverse()) {
        try {
          await undo();
        } catch (err) {
          console.error(`${logTag} 卸载失败:`, err instanceof Error ? err.message : String(err));
        }
      }
    };
  }

  return {
    pluginMeta,
    capability,
    invoke,
    // name：宿主诊断面可读；inject：宿主 `ctx.plugin()` 挂载时的就绪门控（与 cordis.patch.yml 同值）
    plugin: { name: `sofagent-${short}`, inject: PLUGIN_INJECT, apply },
  };
}

// NOTE（v1.4.8 第5批 · 收敛时的两处**文案**归一化，非行为变更）：
//   ① 错误字符串从 `cordis-plugin-audit 依赖 …`（短名残留）统一为 `<id> 依赖 …`；
//      rollback 的内层函数名从 'createShadowRepo'（与实际调用的 getHistoryFilePath
//      不符的陈旧文案）改为按 bridgeApi 动态取——两者都只影响异常提示文本。
//   ② fde 的 dynamicCordisRunner `purpose` 由「FDE 进场方法论桥接——本体数据视图生成」
//      归一为 `<description>`，与其余 8 个插件同形；WebUI 文案更完整，注册形状不变。
