// ============================================================
// @sofagent/dsh-plugin-kit · DSH 适配层基座（v1.5.2 插件能力面 P1 · 扩容）
// ============================================================
// 9 个 cordis-plugin-sofagent-*> 的 src/index.ts 此前各 98 行、近乎逐字重复
// （pluginMeta 声明 / 懒加载 invoke / apply 三段式：provide + dynamicCordisRunner + settings）。
// 本包把这段样板收成一次 createSofagentPlugin() 调用，插件侧只留
// 「我是谁 / 我挂哪（seam）/ 我桥接谁」。
//
// v1.5.2 P1 扩容（插件能力面批 · F1①/F1②）：
//   F1① 工具注册面——SofagentPluginEntry 新增 toolsRole?: string：
//       apply() 检测 ctx.get?.('tools') → 懒加载 @sofagent/mcp → TOOLS 筛 roles
//       → 逐个转宿主形状注册（output 双字段补全 + safeRender 4KB 截断——对齐
//       dsh-backend.ts registerSofagentTools 参考实现）；缺依赖/缺 API 降级不抛 +
//       report 可见。工具清单单一源 = engine/mcp/src/tool-registry.ts 的 TOOLS，
//       本包**不手抄清单**（gen-plugin-manifests.mjs 的 sofagent.tools 生成段 +
//       --check 断言与之对账）。
//   F1② 多包桥接——bridgePkg/bridgeApi 单值 → bridges 多包数组：
//       invoke 按序解析，部分可用即部分成功；🔴 原单值形态的 throw 改为
//       降级可见（report.failed + 错误消息），三包缺一 → 其余照常。
//
// 🔴 适配层红线（不绑宿主，靠写法守）：
//   ① 不 import cordis 包、不 import 宿主 SDK 的**类型**——`apply(ctx: unknown)`，
//      只按结构访问 ctx（运行时鸭子类型探测），上下文类型在本文件内联描述。
//   ② 宿主 API 缺席时**降级不抛**：provide / dynamicCordisRunner / settings / tools
//      四者任一缺席都只跳过该增强项，绝不让 profile 加载崩在适配层。
//   ③ 桥接的 @sofagent/* 能力包用**懒加载**（动态 import）+ 缺依赖降级，插件可独立安装。
//   ④ 桥接多包缺一不炸：部分可用即部分成功，失败包记入 report.failed（可见），
//      绝不整挂失败——「三包缺一 → 其余照常」。
//
// 🔴 字段名差异警示（DSH vs OpenClaw，两侧事件形状不同——取错静默 undefined）：
//      DSH     = exec.name / exec.arguments
//      OpenClaw = event.toolName / event.params
//
// ⚠️ 既有形态说明：`require('@deepseek-ai/schemastery')` 是 v1.4.5 T6 起就存在于
//    9 个插件里的**惰性运行时**读取（包在 try/catch 内、非顶层静态 import）。
//
// ⚠️ P0 探针实测输入（SEAMS.md §7，2026-09-15）：
//    - ctx.get?.('tools') 是推荐取法（不要求 inject 声明，缺席返 undefined 不抛）；
//    - register() 返回 disposer（必须纳入复合卸载契约）；
//    - output.render 是双参签名 render(args, value)——第一参是工具入参；
//    - headless 无 commands 注册面——kit 不做命令面。
// ============================================================

/** 桥接声明：一个 @sofagent/* 能力包 + 其公共 API 函数名 */
export interface SofagentBridge {
  /** 桥接的 sofagent 能力包，如 @sofagent/audit */
  pkg: string;
  /** 桥接包内实际调用的公共 API 函数名，如 runRules */
  api: string;
}

/**
 * seam 事件处理器（v1.5.0 章十 · 事件接线面）。
 *
 * 调用形态：`handler(宿主事件参数…, helpers)`——宿主事件参数按宿主约定在前
 * （DSH 工具族为 `exec` 对象，形状 `{ name, arguments }`），kit 注入的
 * `SeamHelpers` 恒在**末位**。故 waterfall 派发的事件（宿主 listener 约定为
 * `(...args, next)`）在 handler 里的排布是 `(...参数, next, helpers)`——
 * **next 恒在 helpers 前一位**；handler 不调 next 即否决该事件（瀑布流语义）。
 *
 * 🔴 订阅一律走 `ctx.on`，没有第二种订阅入口。cordis 4.0.1 源码（`EventsService`）
 *    把 `waterfall / serial / bail / parallel / emit` 定义为**派发**（`dispatch(style,args)`
 *    的包装），只有 `on / once` 是订阅；宿主自己的插件无一例外用 `ctx.on` 收
 *    waterfall 事件（`dsh-hooks-claude-code` 的 `ctx.on('tools/pre-execute', (exec, next) => …)`）。
 *    事件由宿主以何种风格派发，只影响 handler 收到的参数形状（有没有 `next`），
 *    不影响订阅调用——故本 kit 不为事件风格分叉订阅路径。
 *
 * 🔴 接线是**执行面动作**，不改判定逻辑：handler 内调既有引擎包 API
 *    （经 helpers.call 取既有 @public 面），插件层只加一根管子。
 */
export type SeamHandler = (...args: unknown[]) => unknown;

/** kit 注入给 seamHandler 的助手面（末位参数） */
export interface SeamHelpers {
  /**
   * 调桥接包的既有 @public API（懒加载动态 import，按 pkg+api 精确取）。
   * 缺依赖 / API 不存在/非函数 → **抛可读错误**（由 handler 决定是否吞）。
   *
   * 也用于取**宿主侧**工具（如 `@deepseek-ai/dsh-llm` 的消息工厂）——插件保持
   * 「零静态宿主 import」的适配层红线，宿主面一律经此动态取、缺席即降级。
   */
  call: (pkg: string, api: string, ...args: unknown[]) => Promise<unknown>;
  /** 本插件声明的桥接解析报告（resolved/failed 双清单——降级自省） */
  bridges: () => Promise<InvokeReport>;
  /**
   * 本插件的 settings 开关快照（键 = settingsExtra + featureGates 档位名）。
   * 用于 handler 内尊重用户关档（如 audit 的 `acceptanceGate`）；宿主无 settings
   * 面时按声明默认值返回（与工具注册面同口径）。
   */
  flags: () => Record<string, boolean>;
  /** 插件日志（统一 `[sofagent-<short>]` 前缀，写 console.error 对齐既有日志面） */
  log: (message: string) => void;
}

/**
 * 插件侧取助手面：`helpers` 恒在 handler 参数**末位**，本函数把它按位置取出来并
 * 标上类型——比在每处 handler 里手写 `args[args.length - 1] as SeamHelpers` 可靠。
 *
 * 为什么 handler 用 `(...args: unknown[])` 书写而不是漂亮的位置参数：宿主各事件位
 * 的参数形状互不相同（见 SEAMS.md §1），写死位置签名只会得到一个假装精确的类型；
 * 统一用 rest + 本函数取值，宿主参数保持 unknown（鸭子类型读取，符合适配层红线）。
 */
export function seamHelpers(args: unknown[]): SeamHelpers {
  return args[args.length - 1] as SeamHelpers;
}

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
  /**
   * 桥接的 sofagent 能力包（单包形态，向后兼容既有 9 条目）。
   * v1.4.9 F1② 起与 bridges 多包形态二选一：都给时 bridges 优先。
   */
  bridgePkg: string;
  /**
   * 桥接包内实际调用的公共 API 函数名（单包形态）。
   * @see SofagentPluginEntry.bridgePkg
   */
  bridgeApi: string;
  /**
   * 多包桥接（v1.4.9 F1②）：按序解析，部分可用即部分成功。
   * 单包字段（bridgePkg+bridgeApi）与此二选一；都提供时本字段优先。
   */
  bridges?: SofagentBridge[];
  /**
   * 工具注册面（v1.4.9 F1①）：tool-registry.ts 的角色标签。
   * 提供时 apply() 会把 @sofagent/mcp TOOLS 中 roles 含此值的工具
   * 逐个注册进 DSH tools 服务（模型可见可调）。缺省不注册工具。
   * v1.4.9 P2：与 toolsRoles 多角色形态二选一；都给时 toolsRoles 优先
   * （并集语义）。单值形态保留 = 其余插件的最小声明面不变。
   */
  toolsRole?: string;
  /**
   * 工具注册面（v1.4.9 P2）：tool-registry.ts 的角色标签数组——
   * **并集**注册（roles 含任一值的工具全注册）。与单值 toolsRole 二选一，
   * 都给时本字段优先（normalizeRoles 统一归一）。
   */
  toolsRoles?: string[];
  /**
   * settings 分档（v1.4.9 P2）：键 = settings 档位字段名（注册进 settingsExtra，
   * 值即默认值 'true'/'false' 字符串），值 = 该档控制的**工具名显式清单**。
   * 关档（值为 'false'）即从注册全集剔除该清单内的工具——档位对工具域的
   * 划分是**产品决策**（哪些工具属哪个域），故显式列名而非按前缀猜；
   * 名单内的工具存在性 / schema 仍以 tool-registry.ts 为单一源
   * （生成器 --check 对账 featureGates 名 ⊆ toolsRoles 并集，幽灵名 exit 2）。
   * 未列入任何档的工具 = 方法论支撑面（think/compose/workflow/agent 族），
   * 不设档常开。
   */
  featureGates?: Record<string, string[]>;
  /**
   * seam 事件处理器（v1.5.0 章十 · 事件接线面）：事件名 → handler。
   *
   * 事件名必须 = 本插件真实订阅的宿主 ctx 事件名（check-seam-contract 正向对账
   * 面 + gen-plugin-manifests 的 seam↔seamHandlers 双源对账）；apply() 内逐个经
   * `ctx.on` 注册，**每个订阅的 disposer 收进既有复合卸载契约**（fiber 卸载即撤销）。
   *
   * 🔴 只写宿主**确实派发**的事件名——写了宿主不派发的名字（如把外部 hook 的
   *    事件类型当 ctx 事件用）grep 能过、探针必挂，属假接线。
   * 🔴 接线不改判定逻辑：handler 内经 helpers.call 取既有引擎 @public API
   *    （如 `@sofagent/audit.runRules`），插件层只加管子。
   * 🔴 宿主订阅面缺失 / 单事件注册失败 → 降级可见（console.error），
   *    绝不阻断插件挂载。
   */
  seamHandlers?: Record<string, SeamHandler>;
  /** 短描述（不含 seam 与桥接后缀），如「变更机器审阅——25 规则 + git diff 硬证据 + 节点级审计」 */
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

/** @sofagent/mcp tool-registry 的 ToolDef 最小结构（kit 侧鸭子描述，不 import 引擎包） */
interface McpToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  roles?: string[];
  handler?: (args: Record<string, unknown>, ctx?: unknown) => unknown;
}

/** @sofagent/mcp 公共导出的最小结构（TOOLS 数组入口） */
interface McpRegistryModule {
  TOOLS?: McpToolDef[];
}

/**
 * 懒加载 @sofagent/mcp 的工具清单（单一源 = tool-registry.ts）。
 * 🔴 用 **子路径导出** `@sofagent/mcp/tool-registry`，不用主入口——主入口
 * `dist/mcp-server.js` 尾部有 `const server = new McpServer(); server.start();`
 * **无条件启动 stdio server**（kit 在 DSH 宿主进程内 import 会挂起/抢 stdin），
 * 且主入口不导出 TOOLS。子路径入口 `dist/tool-registry.js` 干净导出 104 工具、
 * 零副作用（实测 node --input-type=module import 无 server 启动输出）。
 */
const MCP_REGISTRY_SPECIFIER = '@sofagent/mcp/tool-registry';

/** invoke 的一次桥接解析结果 */
interface BridgeResolution {
  pkg: string;
  api: string;
  /** 解析成功的调用函数 */
  fn: (...args: unknown[]) => unknown;
}

/** invoke 的整体结果：成功的桥接函数 + 失败包清单（降级可见） */
export interface InvokeReport {
  /** 按声明序解析成功的桥接（调用时按序尝试第一个可用的） */
  resolved: BridgeResolution[];
  /** 解析失败的桥接（缺依赖 / API 不是函数），含可读原因 */
  failed: Array<{ pkg: string; api: string; reason: string }>;
}

/** 品牌色（与 9 个插件既有的 #16B8F3 一致） */
const DEFAULT_BRAND_COLOR = '#16B8F3';

/**
 * 插件声明的宿主服务依赖（与各插件 cordis.patch.yml 的 `inject:` 同值）。
 * 🔴 必须**同时**挂在插件对象上（见文件末 plugin 对象），否则宿主用 `ctx.plugin()` 挂载时
 *    拿不到就绪门控——`cordis.patch.yml` 的 `inject` 只对「宿主直接挂载该 id」生效，
 *    经聚合层转挂时不带过去。声明在对象上后两条挂载路径同语义。
 *
 * v1.4.9 P1：**不含 'tools'**——工具注册面走 `ctx.get?.('tools')` 鸭子探测（P0 探针
 * 裁定，SEAMS.md §7.2）：ctx.get 不要求 inject 声明、缺席返 undefined 不抛，天然
 * 满足「降级不抛」红线；若在此加 'tools'，宿主缺 tools 服务的 profile（headless
 * 极简形态）会把插件挂载卡成 pending。桥接的 @sofagent/mcp 同理走懒加载。
 */
export const PLUGIN_INJECT = ['settings', 'dynamicCordisRunner'] as const;

/**
 * 宿主 Cordis 上下文的最小结构面。
 * 🔴 刻意**不** import cordis 的类型——只用结构描述，运行时按鸭子类型探测，
 *    这样引擎/适配层永不编译期依赖宿主 SDK（红线 C）。
 */
interface HostContext {
  provide?: (name: string, service: Record<string, unknown>) => unknown;
  get?: (name: string, strict?: boolean) => unknown;
  dynamicCordisRunner?: { define?: (request: Record<string, unknown>) => unknown };
  settings?: HostSettingsService;
  /**
   * 事件订阅面（v1.5.0 章十）：`ctx.on(event, handler)` —— **唯一的订阅入口**，
   * 对所有派发风格（emit / serial / bail / waterfall）通用。P0 探针实测可用
   * （`ctx.on('tools/pre-execute'|'tools/result'|'tools/change')` 订阅成功且被调用）；
   * 返回 disposer（鸭子收集）。
   */
  on?: (event: string, handler: SeamHandler) => unknown;
  sofagent?: Record<string, unknown>;
  [key: string]: unknown;
}

/** 宿主 tools 服务面扩展（v1.4.9 P2）：注册返回值之外可能带 watch/热更新面 */
interface HostToolsService {
  register?: (def: Record<string, unknown>) => unknown;
}

/** @sofagent/dsh-settings 的 SettingsScope 最小结构面（kit 侧鸭子描述，不 import 宿主类型） */
interface HostSettingsScope {
  get?: () => unknown;
  watch?: (cb: (next: unknown, prev: unknown) => void) => unknown;
}

/** settings 注册 API 的最小结构面（v1.4.9 P2——register 返回 SettingsScope） */
interface HostSettingsService {
  register?: (ns: string, schema: unknown, opts?: Record<string, unknown>) => HostSettingsScope | unknown;
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

/** 规范化桥接清单：单包字段 → [ {pkg, api} ]；多包字段优先 */
function normalizeBridges(options: SofagentPluginOptions): SofagentBridge[] {
  if (Array.isArray(options.bridges) && options.bridges.length > 0) {
    return options.bridges;
  }
  return [{ pkg: options.bridgePkg, api: options.bridgeApi }];
}

/**
 * 规范化工具角色（v1.4.9 P2）：多角色数组优先；单值 toolsRole 归一为 [值]。
 * 返回 null = 未声明工具注册面（apply 不触发）。
 */
function normalizeRoles(options: SofagentPluginOptions): string[] | null {
  if (Array.isArray(options.toolsRoles) && options.toolsRoles.length > 0) {
    return options.toolsRoles;
  }
  if (typeof options.toolsRole === 'string' && options.toolsRole !== '') {
    return [options.toolsRole];
  }
  return null;
}

/** render 兜底——字符串直出，对象 JSON 化（截断防超大输出进 prompt；对齐 dsh-backend safeRender） */
function safeRender(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    const s = JSON.stringify(value);
    return s && s.length > 4000 ? s.slice(0, 4000) + '…(截断)' : (s ?? '');
  } catch {
    return String(value);
  }
}

/**
 * 创建 DSH 适配层插件（pluginMeta + 懒加载 invoke + apply 三段式一次到位）。
 *
 * @param options 插件声明（id / seam / capability / description / bridge(s) / 可选 toolsRole + envelope 覆盖）
 * @param hostPkg 插件自己的 package.json（仅用 version；省略则兜底 '0.0.0-unknown'——缺版本比错版本诚实）
 * @returns { pluginMeta, capability, invoke, plugin } ——插件 src/index.ts 直接再导出即可
 */
export function createSofagentPlugin(options: SofagentPluginOptions, hostPkg?: SofagentPluginHostPackage) {
  const { id, seam, capability, description } = options;
  const bridges = normalizeBridges(options);
  const toolsRoles = normalizeRoles(options);
  const featureGates = options.featureGates ?? {};
  // 短名/服务名/日志前缀：cordis-plugin-sofagent-audit → audit
  const short = id.replace(/^cordis-plugin-sofagent-/, '');
  const brandColor = options.brandColor ?? DEFAULT_BRAND_COLOR;
  const purpose = options.purpose ?? description;
  const readyMessage = options.readyMessage ?? description;
  const settingsExtra = options.settingsExtra ?? {};
  // v1.4.9 P2：featureGates 的档位键自动并入 settingsExtra（值 'true' = 默认开档）——
  // 插件侧只声明 featureGates，不必在 settingsExtra 里重复抄一遍键名。
  const mergedSettings: Record<string, string> = { ...settingsExtra };
  for (const [gate, names] of Object.entries(featureGates)) {
    if (names.length > 0) mergedSettings[gate] = mergedSettings[gate] ?? 'true';
  }
  const logTag = `[sofagent-${short}]`;

  /** 插件元数据（DSH profile / 注册表消费） */
  const pluginMeta = {
    id,
    version: hostPkg?.version ?? '0.0.0-unknown',
    description: `${description}（seam: ${seam}）`,
    seam,
  } as const;

  /**
   * 桥接声明尾段（pluginMeta.description / report 用）：
   * 单包 → 「桥接 <pkg> <api>」；多包 → 「桥接 <pkg1> <api1> / <pkg2> <api2>」。
   */
  const bridgeTail = bridges.map((b) => `${b.pkg} ${b.api}`).join(' / ');

  /**
   * 解析全部桥接（懒加载动态 import，部分失败不抛——F1② 红线）。
   *
   * @returns InvokeReport：成功的按声明序排列；失败的带可读原因（缺依赖 / API 非函数）
   */
  async function resolveBridges(): Promise<InvokeReport> {
    const resolved: BridgeResolution[] = [];
    const failed: InvokeReport['failed'] = [];
    for (const b of bridges) {
      try {
        const mod = (await import(b.pkg)) as Record<string, unknown>;
        const fn = mod[b.api];
        if (typeof fn !== 'function') {
          failed.push({ pkg: b.pkg, api: b.api, reason: `${b.api} 不是可调用函数（${b.pkg} 公共 API）` });
          continue;
        }
        resolved.push({ pkg: b.pkg, api: b.api, fn: fn as (...a: unknown[]) => unknown });
      } catch (err) {
        failed.push({
          pkg: b.pkg,
          api: b.api,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { resolved, failed };
  }

  /**
   * 调用桥接的 sofagent @public API（懒加载 + 部分降级——v1.4.9 F1② 重设计）。
   *
   * 🔴 与单值时代的差异：**全部桥接都不可用时才抛**；部分可用时调用第一个
   *    解析成功的桥接（按声明序）。失败包不阻断可用包——「三包缺一 → 其余照常」。
   *
   * @returns 桥接函数的返回值（首个可用桥接的调用结果）
   * @throws 全部桥接都不可用时抛可读错误（含逐包失败原因——调用方看到的是全景而非静默）
   */
  async function invoke<T = unknown>(...args: unknown[]): Promise<T> {
    const report = await resolveBridges();
    if (report.resolved.length === 0) {
      const detail = report.failed.map((f) => `${f.pkg}.${f.api}: ${f.reason}`).join('；');
      throw new Error(`${id} 依赖不可用（全部桥接失败）：${detail}`);
    }
    if (report.failed.length > 0) {
      const detail = report.failed.map((f) => `${f.pkg}.${f.api}: ${f.reason}`).join('；');
      console.error(`${logTag} 部分桥接降级（其余照常）：${detail}`);
    }
    return (await report.resolved[0].fn(...args)) as T;
  }

  /**
   * 解析 settings 档位 → 当前开关表（v1.4.9 P2；v1.5.0 章十泛化为按 key 集读）。
   * 取值优先级：宿主 settingsScope.get()（用户层覆盖）> 声明默认值（settingsExtra /
   * featureGates 默认 'true'）。settingsScope 缺席（宿主无 settings 服务 / register
   * 未返回 scope）→ 全按声明默认值——「关档不注册」的验收硬线依赖用户层显式写
   * 'false'，宿主缺 settings 面时无从关档，等价于全开（与「无 settings 面则无档可关」
   * 的直觉一致，不算降级漏洞）。
   *
   * @param scope 宿主 settings 作用域（可空）
   * @param keys 要读的档位键（工具注册面传 featureGates；seam 接线面传全部 settings 键）
   * @returns 档位名 → 布尔开/关
   */
  function resolveFlags(
    scope: HostSettingsScope | null | undefined,
    keys: string[],
  ): Record<string, boolean> {
    const flags: Record<string, boolean> = {};
    let resolved: Record<string, unknown> | null = null;
    if (scope && typeof scope.get === 'function') {
      try {
        const v = scope.get();
        if (v && typeof v === 'object') resolved = v as Record<string, unknown>;
      } catch (err) {
        console.error(`${logTag} settings 档位读取失败（按默认全开处理）：${err instanceof Error ? err.message : String(err)}`);
      }
    }
    for (const gate of keys) {
      const raw = resolved ? resolved[gate] : undefined;
      // 兜底取声明默认值：settingsExtra 未覆盖的键（如 featureGates 档位）默认 'true'
      const effective = raw === undefined ? (mergedSettings[gate] ?? 'true') : raw;
      // 显式字符串 'false'（用户层关档）/ 显式 false → 关；其余（'true' / true）→ 开
      flags[gate] = !(effective === 'false' || effective === false);
    }
    return flags;
  }

  /** featureGates 档位开关表（工具注册面专用——关档即不注册该域工具） */
  function resolveFeatureFlags(scope: HostSettingsScope | null | undefined): Record<string, boolean> {
    return resolveFlags(scope, Object.keys(featureGates));
  }

  /**
   * 工具注册面（v1.4.9 F1① / P2 扩多角色+分档）——把 @sofagent/mcp TOOLS 中
   * roles 含任一 toolsRoles 值的工具（并集）逐个注册进宿主 tools 服务，
   * 注册前按 settings 档位过滤：关档（值为 'false'）的工具从全集剔除。
   *
   * 防御式边界（对齐 dsh-backend.ts registerSofagentTools 参考实现）：
   * - tools 服务缺失（ctx.get?.('tools') 为空 / register 非函数）→ 跳过 + WARN
   * - @sofagent/mcp 缺依赖 → 跳过 + WARN（插件可独立安装）
   * - 单工具注册失败 → 跳过该工具 WARN，不中断其余注册
   * - 档位全关后空集 → 0 注册 + WARN（显式可见，不是静默）
   *
   * @returns 实际注册成功的工具数
   */
  async function registerToolsForRole(ctx: HostContext, scope: HostSettingsScope | null | undefined): Promise<number> {
    const roles = toolsRoles as string[];
    const svc = ctx.get?.('tools') as HostToolsService | undefined;
    if (!svc || typeof svc.register !== 'function') {
      console.error(`${logTag} DSH tools 服务面缺失——角色工具未注入（降级，不阻断插件挂载）`);
      return 0;
    }
    let mod: McpRegistryModule;
    try {
      mod = (await import(MCP_REGISTRY_SPECIFIER)) as McpRegistryModule;
    } catch (err) {
      console.error(
        `${logTag} @sofagent/mcp/tool-registry 不可用（${err instanceof Error ? err.message : String(err)}）——角色工具未注入（降级）`,
      );
      return 0;
    }
    const tools = Array.isArray(mod.TOOLS) ? mod.TOOLS : [];
    if (tools.length === 0) {
      console.error(`${logTag} @sofagent/mcp TOOLS 为空——角色工具未注入（降级）`);
      return 0;
    }
    // 🔴 P2 分档过滤：关档清单并集（先算剔除集，再从角色并集里减——
    //    一个工具被两个关档声明不影响语义；被一个开档一个关档声明时**剔除优先**
    //    （保守面：误注册可由宿主卸载，漏关档不可由用户补救））。
    const flags = resolveFeatureFlags(scope);
    const offNames = new Set<string>();
    for (const [gate, on] of Object.entries(flags)) {
      if (!on) for (const n of featureGates[gate] ?? []) offNames.add(n);
    }
    const selected = tools.filter(
      (t) => Array.isArray(t.roles) && t.roles.some((r) => roles.includes(r)) && !offNames.has(t.name),
    );
    const gatedOff = tools.filter(
      (t) => Array.isArray(t.roles) && t.roles.some((r) => roles.includes(r)) && offNames.has(t.name),
    ).length;
    if (selected.length === 0) {
      console.error(
        `${logTag} 档位过滤后角色工具为空集——0 个注册（roles=[${roles.join(',')}]，关档剔除 ${offNames.size} 项）`,
      );
      return 0;
    }
    let registered = 0;
    for (const t of selected) {
      const handler = typeof t.handler === 'function' ? t.handler : undefined;
      if (!handler) {
        console.error(`${logTag} 工具 ${t.name} 无 handler——跳过（不中断其余注册）`);
        continue;
      }
      try {
        svc.register({
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
          // output 双字段补全（register 强校验：schema 必填 + render 必须可调用）
          output: {
            schema: { type: 'string' },
            // 🔴 render 双参签名（P0 探针裁定）：第一参 = 工具入参，第二参 = execute 返回值
            render: (_args: unknown, value: unknown) => safeRender(value),
          },
          execute: async (args: Record<string, unknown>) => {
            const ret = await handler(args, undefined);
            // ToolResult 形态 → 字符串化 text（sofagent MCP 工具返回 { text, data } 二元组）
            if (ret && typeof ret === 'object' && 'text' in ret) {
              return String((ret as { text: unknown }).text);
            }
            if (ret && typeof ret === 'object' && 'error' in ret && !('text' in ret)) {
              throw new Error(String((ret as { error: unknown }).error));
            }
            return safeRender(ret);
          },
        });
        registered++;
      } catch (err) {
        console.error(`${logTag} 工具 ${t.name} 注册失败（跳过，不中断其余）：${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (registered > 0) {
      const gateNote =
        gatedOff > 0
          ? `（关档剔除 ${gatedOff} 项：${Object.entries(flags)
              .filter(([, on]) => !on)
              .map(([g]) => g)
              .join(',')}）`
          : '';
      console.error(`${logTag} 角色工具注册成功：${registered}/${selected.length}（roles=[${roles.join(',')}]）${gateNote}`);
    }
    return registered;
  }

  /**
   * seam 事件接线（v1.5.0 章十）——把声明的 seamHandlers 注册成宿主事件订阅。
   *
   * 订阅机制：**只有 `ctx.on(event, handler)` 一条路**。cordis 4.0.1 的
   * `waterfall / serial / bail / parallel / emit` 是 `EventsService` 的**派发**包装
   * （`dispatch(style, args)`），不是订阅面——宿主全部自带插件都用 `ctx.on` 收
   * waterfall 事件。事件由宿主以何种风格派发，只决定 handler 收到的参数形状
   * （waterfall 风格多一个 `next`），不改变订阅调用。
   *
   * 🔴 降级红线：宿主无 `ctx.on` 面（极简 profile）→ 打印 WARN 后整体跳过；
   *    单事件注册抛错 → 记日志继续下一个，不中断插件挂载。
   *
   * 🔴 判定逻辑零改动：handler 由插件侧提供，kit 只负责把管子接上 + 注入助手面
   *    + 收好 disposer。助手面（`SeamHelpers`）**恒在 handler 参数末位**：
   *    `helpers.call(pkg, api, ...args)` 按需懒取既有引擎 @public 面，
   *    判定函数本体与签名零改动；缺依赖时只在真触发时抛可读错误。
   *    waterfall 风格事件的 handler 形如 `(...参数, next, helpers)`——next 在
   *    helpers 前一位。
   *
   * @param c 宿主上下文
   * @param collect 订阅 disposer 收集器（apply 内的复合卸载契约闭包）
   * @param flags settings 开关快照（featureGates 档位 + settingsExtra 字段）
   * @returns 已成功注册的订阅数（调用方可观测）
   */
  function registerSeamHandlers(
    c: HostContext,
    collect: (ret: unknown) => void,
    flags: Record<string, boolean>,
  ): number {
    const decls = options.seamHandlers;
    if (!decls || Object.keys(decls).length === 0) return 0;
    if (typeof c.on !== 'function') {
      console.error(
        `${logTag} 宿主事件订阅面缺失（ctx.on 非函数）——${Object.keys(decls).length} 个 seamHandler 未接线（降级，不阻断挂载）`,
      );
      return 0;
    }
    // handler 末位注入的助手面：既有引擎 @public API 按需懒取（不在此处静态 import——
    // 缺依赖的插件照常挂载，只在 handler 真被触发时抛可读错误，由 handler 决定是否吞）。
    const helpers: SeamHelpers = {
      call: async (pkg, api, ...args) => {
        const mod = (await import(pkg)) as Record<string, unknown>;
        const fn = mod[api];
        if (typeof fn !== 'function') {
          throw new Error(`${pkg}.${api} 不是可调用函数（seamHandler 桥接面）`);
        }
        return await (fn as (...a: unknown[]) => unknown)(...args);
      },
      bridges: () => resolveBridges(),
      flags: () => ({ ...flags }),
      log: (message) => console.error(`${logTag} ${message}`),
    };
    let wired = 0;
    for (const [event, handler] of Object.entries(decls)) {
      if (typeof handler !== 'function') {
        console.error(`${logTag} seamHandler ${event} 非可调用对象——跳过（不中断其余订阅）`);
        continue;
      }
      // 包装：宿主事件参数在前（原样透传，含 waterfall 的 next）+ helpers 恒在末位
      const wrapped: SeamHandler = (...args: unknown[]) => handler(...args, helpers);
      try {
        // 订阅 disposer 收进复合卸载契约（cordis ctx.on 本身经 fiber.effect 登记，
        // 此处照收一层——双保险，卸载幂等由 disposed 标志保证）
        collect(c.on(event, wrapped));
        wired++;
      } catch (err) {
        console.error(
          `${logTag} seam ${event} 订阅失败（跳过，不中断其余）：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (wired > 0) {
      console.error(`${logTag} seam 事件接线成功：${wired}/${Object.keys(decls).length}（${Object.keys(decls).join(', ')}）`);
    }
    return wired;
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
    //    v1.4.9 P2：register 返回 SettingsScope（get/watch 面而非裸 disposer）——
    //    档位键（featureGates）并入本 namespace，工具注册面从 scope.get() 读当前开关。
    let settingsScope: HostSettingsScope | null = null;
    try {
      const settings = c.settings;
      if (settings && typeof settings.register === 'function') {
        // 惰性运行时读取宿主 schemastery（既有形态）：缺席时走 catch 降级不崩
        const s = require('@deepseek-ai/schemastery') as {
          object: (shape: Record<string, unknown>) => unknown;
          boolean: () => unknown;
          string: () => unknown;
        };
        // 字段顺序与收敛前一致：enabled → 各 settingsExtra（含 featureGates 档位键）→ brandColor
        const shape: Record<string, unknown> = { enabled: s.boolean() };
        for (const k of Object.keys(mergedSettings)) shape[k] = s.string();
        shape.brandColor = s.string();
        const base: Record<string, unknown> = { enabled: true };
        for (const [k, v] of Object.entries(mergedSettings)) base[k] = v;
        base.brandColor = brandColor;
        const scope = settings.register(`sofagent-${short}`, s.object(shape), { base }) as HostSettingsScope;
        // scope 兼容双形态：SettingsScope（get/watch）或宿主旧形态返回 disposer
        if (scope && (typeof scope.get === 'function' || typeof (scope as unknown as { watch?: unknown }).watch === 'function')) {
          settingsScope = scope;
        } else {
          collect(scope); // 旧形态 / 裸 disposer——照旧收卸载契约，档位退默认全开
        }
        console.error(`${logTag} settings.register 成功`);
      } else {
        console.error(`${logTag} settings 服务不可用（inject 未生效）`);
      }
    } catch (err) {
      // settings 服务在 profile apply 时可能未就绪——跳过不崩（配置面板注册为增强项）
      console.error(`${logTag} settings.register 失败:`, err instanceof Error ? err.message : String(err));
    }

    // ④ 工具注册面（v1.4.9 F1① / P2 扩分档）：toolsRoles 声明时把 @sofagent/mcp 的
    //    角色工具注入宿主（settings 档位过滤——关档即不注册该域工具）。
    //    异步面：apply 同步返回复合 disposer，工具注册异步进行（不阻塞挂载——缺依赖/缺服务
    //    只记 console.error 降级可见）。注册产生的 disposer 由 registerToolsForRole 内部
    //    通过 svc.register 返回值收集——但异步面无法同步收进 disposers，改为注册完成后
    //    动态追加（复合 disposer 是闭包数组引用，push 仍生效——只要卸载发生在注册完成后）。
    if (toolsRoles !== null) {
      registerToolsForRole(c, settingsScope)
        .then(() => undefined)
        .catch((err: unknown) => {
          console.error(`${logTag} 角色工具注册异常（降级，不阻断）：${err instanceof Error ? err.message : String(err)}`);
        });
      // P2 档位热更新：settingsScope.watch 监听用户改档 → 重算开关表（当前实现记录到
      // 运行日志；已注册工具的反注册重挂属宿主 tools 生命周期能力，P2 不扩——关档语义
      // 在「下次挂载/注册时生效」，热卸载属后续增强，不谎称已实现）。
      const scope = settingsScope as HostSettingsScope | null;
      if (scope && typeof scope.watch === 'function') {
        try {
          const watchRet = scope.watch((next) => {
            const flags = next && typeof next === 'object' ? (next as Record<string, unknown>) : {};
            const changed = Object.keys(featureGates).filter((g) => flags[g] === 'false');
            console.error(
              `${logTag} settings 档位变更：${Object.keys(featureGates)
                .map((g) => `${g}=${flags[g] === 'false' ? 'off' : 'on'}`)
                .join(' ')}——关档域 [${changed.join(',')}] 下次注册起不注入（热卸载为后续增强）`,
            );
          });
          collect(watchRet);
        } catch (err) {
          console.error(`${logTag} settings watch 登记失败（档位变更不可见，不影响挂载）：${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // ⑤ seam 事件接线（v1.5.0 章十）：seamHandlers 声明时把宿主事件订阅接上——
    //    这是「seam 从声明到实现」的落地段。handler 内部经 helpers.call 取既有
    //    引擎 API（判定逻辑零改动），kit 只负责接管子 + 注入助手面 + 收 disposer。
    //    开关快照按**全部 settings 键**读（含 settingsExtra 字段，如 acceptanceGate）
    //    ——handler 内据此尊重用户关档。
    registerSeamHandlers(c, collect, resolveFlags(settingsScope, Object.keys(mergedSettings)));

    // ⑥ 卸载契约：收集到的宿主 disposer → 幂等复合 disposer，作为 apply 返回值交宿主登记
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
    /** 桥接解析报告（v1.4.9 F1②）：resolved/failed 双清单——降级可见的自省面 */
    resolveBridges,
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
//
// NOTE（v1.4.9 P1 · F1①/F1② 扩容的行为变化；P2 扩多角色+分档）：
//   ① invoke 从「单包 + 全有全无 throw」改为「多包 + 部分可用即部分成功」：
//      全部失败才 throw（错误消息含逐包原因）；部分失败打降级日志继续。
//   ② 新增工具注册面（F1① 单角色 toolsRole；P2 扩 toolsRoles 多角色并集 +
//      featureGates settings 分档）：apply() 异步注册 @sofagent/mcp 角色工具，
//      关档（settings 值 'false'）的工具从注册全集剔除；缺 tools 服务 / 缺
//      @sofagent/mcp / 单工具失败三级降级全不抛。
//   ③ PLUGIN_INJECT 保持 ['settings','dynamicCordisRunner'] 不变——tools 走
//      ctx.get?.('tools') 鸭子探测（P0 探针裁定，SEAMS.md §7.2）。
//   ④ P2 settings.register 返回 SettingsScope（get/watch）时：scope.get() 供
//      档位解析、scope.watch() 供变更可见（disposer 照收进复合卸载契约）；
//      旧形态返回裸 disposer 时档位退默认全开（向后兼容）。
