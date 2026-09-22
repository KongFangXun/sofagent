// ============================================================
// plugin-gate.ts · 插件来源白名单 + 应用级工具策略（v1.5.1 第一/二章）
//                        + 连接器注册面（v1.5.1 G5b · T4 扩展）
// ============================================================
// 企业管控收口：
//   第一章「从哪装」——plugin_sources.allowlist 三类来源白名单
//     （Git URL / 主机模式 / 本地路径），白名单外安装拒绝；
//     allow_managed_hooks_only 托管 hook 独裁模式。
//   第二章「装了能调什么」——app_tool_policy 应用 × 工具策略矩阵，
//     未声明的 app×tool 默认拒绝（fail-closed）。
//   G5b（v1.4.9 T4）「连接器怎么注册和被发现」——连接器注册表
//     （engine/mcp/src/tools/connector-list.ts 消费），准入复用第一章
//     来源白名单校验（validatePluginSource 同源——白名单管「来源可不可信」，
//     连接器目录面管「有哪些、怎么发现」）。
//
// 接线：
//   安装侧——install.sh --policy <policy.yml> 读取后经 node 调本模块
//     validatePluginSource / validateAppToolDeclaration；
//   运行侧——app_tool_policy 判定由 orchestrator 沙箱 ToolGate 消费
//     （本模块导出纯策略数据，ToolGate 加载策略维度）；
//   连接器面——mcp connector-list tool 经 dist 产物懒加载本模块
//     registerConnector / listConnectors（@sofagent/audit 已是 mcp 的
//     直接依赖——与 audit-file / cost-query 同消费面，非新依赖边）。
//
// fail-closed 铁律：--policy 指定但校验器不可用（fresh clone 无 dist）时
//   install.sh 侧拒绝安装退出非零（见 install.sh 接线段），管控能力不得
//   静默降级为跳过。连接器注册同纪律：来源不在白名单 → 拒绝；策略
//   文件不存在 / 损坏 → 空白名单 → 全拒（拒绝是缺省态，放行是显式
//   配置的结果——与 device-data-policy T2 同源）。
// ============================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { load as yamlLoad } from 'js-yaml';

/** 三类允许的插件来源 */
export type PluginSource =
  | { kind: 'git-url'; pattern: string }   // 如 https://github.com/org/*（glob 尾通配）
  | { kind: 'host'; pattern: string }      // 如 github.com / clawhub.ai（整主机）
  | { kind: 'local-path'; pattern: string }; // 如 /opt/plugins/*（本地目录 glob）

/** policy.yml 的 plugin_sources 段 */
export interface PluginSourcesPolicy {
  /** 三类来源白名单（任一命中即放行） */
  allowlist: PluginSource[];
  /**
   * 托管 hook 独裁模式——true 时用户自定义 hook 被忽略，只跑 sofagent
   * 托管审计 hook（企业统一管控形态；等价 Codex allow_managed_hooks_only）
   */
  allowManagedHooksOnly?: boolean;
}

/** policy.yml 的 app_tool_policy 段（运行侧 ToolGate 消费） */
export interface AppToolPolicy {
  /**
   * app → 允许调用的 tool 白名单。
   * 未出现在本表的 app（或表中未列的 tool）默认拒绝（fail-closed）。
   * 例：{ 'clawhub-plugin-a': ['run_audit', 'get_think'] }
   */
  apps: Record<string, string[]>;
}

/** 完整 policy.yml 结构 */
export interface PluginPolicy {
  plugin_sources?: PluginSourcesPolicy;
  app_tool_policy?: AppToolPolicy;
}

/** 来源校验结果 */
export type SourceVerdict =
  | { allowed: true; matched: PluginSource }
  | { allowed: false; reason: string };

/** glob 尾通配匹配（仅支持尾部 *——安装来源白名单的常见形态） */
function globMatch(pattern: string, value: string): boolean {
  if (pattern.endsWith('*')) {
    return value.startsWith(pattern.slice(0, -1));
  }
  return pattern === value;
}

/** 从插件来源串识别形态（git URL / 主机 / 本地路径） */
export function classifySource(raw: string): PluginSource {
  if (/^(\.\/|\.\.\/|\/)/.test(raw)) {
    return { kind: 'local-path', pattern: raw };
  }
  if (/^git@|^https?:\/\/.*\.git$|^https?:\/\/github\.com\//.test(raw)) {
    return { kind: 'git-url', pattern: raw };
  }
  return { kind: 'host', pattern: raw };
}

/** 提取 git URL 的 host（git@github.com:org/repo.git 或 https://github.com/org/repo） */
function hostOf(raw: string): string | null {
  const ssh = raw.match(/^git@([^:]+):/);
  if (ssh) return ssh[1] ?? null;
  const https = raw.match(/^https?:\/\/([^/]+)/);
  if (https) return https[1] ?? null;
  return null;
}

/**
 * 校验插件来源是否在企业白名单内（安装前检查）。
 * 三路判定：
 *   - git-url 来源：host 或完整 URL 命中 allowlist 中 git-url/host 项即放行
 *   - host 来源（registry 名/裸主机串）：命中 host 项即放行
 *   - local-path 来源：命中 local-path 项（glob 尾通配）即放行
 * 未配置 plugin_sources（单机默认）→ 一律放行（行为与现版一致）。
 */
export function validatePluginSource(raw: string, policy?: PluginPolicy): SourceVerdict {
  if (!policy?.plugin_sources?.allowlist?.length) {
    return { allowed: true, matched: { kind: 'host', pattern: '(unconfigured)' } };
  }
  const list = policy.plugin_sources.allowlist;
  const source = classifySource(raw);

  for (const entry of list) {
    if (source.kind === 'git-url' && (entry.kind === 'git-url' || entry.kind === 'host')) {
      const host = hostOf(raw);
      if ((entry.kind === 'git-url' && globMatch(entry.pattern, raw)) ||
          (entry.kind === 'host' && host === entry.pattern)) {
        return { allowed: true, matched: entry };
      }
    }
    if (source.kind === 'host' && entry.kind === 'host' && globMatch(entry.pattern, raw)) {
      return { allowed: true, matched: entry };
    }
    if (source.kind === 'local-path' && entry.kind === 'local-path' && globMatch(entry.pattern, raw)) {
      return { allowed: true, matched: entry };
    }
  }
  return {
    allowed: false,
    reason: `来源 ${raw}（${source.kind}）不在企业白名单（${list.length} 项）——安装被拒绝`,
  };
}

/**
 * 托管 hook 独裁模式判定——true 时用户自定义 hook 被忽略。
 * 未配置 = false（单机默认不独裁）。
 */
export function managedHooksOnly(policy?: PluginPolicy): boolean {
  return policy?.plugin_sources?.allowManagedHooksOnly === true;
}

/** app×tool 策略判定结果 */
export type AppToolVerdict =
  | { allowed: true; source: string }
  | { allowed: false; reason: string; source: string };

/**
 * 校验 app 是否被策略允许调用指定 tool（运行侧 ToolGate 消费）。
 * fail-closed：配置了 app_tool_policy 时，未声明的 app（或 app 未列的 tool）默认拒绝。
 * 未配置 app_tool_policy（单机默认）→ 一律放行（行为与现版一致）。
 */
export function validateAppTool(appName: string, toolName: string, policy?: PluginPolicy): AppToolVerdict {
  const appPolicy = policy?.app_tool_policy;
  if (!appPolicy || Object.keys(appPolicy.apps ?? {}).length === 0) {
    return { allowed: true, source: '(unconfigured)' };
  }
  const tools = appPolicy.apps[appName];
  if (!tools) {
    return { allowed: false, source: 'app_tool_policy', reason: `app「${appName}」未在策略中声明（fail-closed 默认拒绝）` };
  }
  if (!tools.includes(toolName)) {
    return { allowed: false, source: 'app_tool_policy', reason: `app「${appName}」未声明调用 tool「${toolName}」（fail-closed 默认拒绝）` };
  }
  return { allowed: true, source: 'app_tool_policy' };
}

/**
 * 安装侧 app_tool_policy 声明校验——policy 里声明的 app 至少要能对上
 * 已注册插件名（防拼写错配静默失效：声明了 app 却无对应安装件）。
 * 返回警告清单（不拦截安装——新 app 可能晚于 policy 下发）。
 */
export function lintAppToolPolicy(policy: PluginPolicy, installedApps: string[]): string[] {
  const warnings: string[] = [];
  const declared = Object.keys(policy.app_tool_policy?.apps ?? {});
  for (const app of declared) {
    if (!installedApps.includes(app)) {
      warnings.push(`app_tool_policy 声明了 app「${app}」但当前无同名已安装插件——确认拼写或插件待装`);
    }
  }
  return warnings;
}

// ============================================================
// 连接器注册面（v1.4.9 G5b · T4）——准入复用第一章来源白名单
// ============================================================
// 分工（changelog 十一章）：白名单管「来源可不可信」（准入闸门——本段
// 复用 validatePluginSource 同一函数），本段管「有哪些、怎么发现」
// （注册表 + 过滤查询）。与 tool-registry 分列铁律：连接器清单 ≠ 工具
// 清单——connector_list 只读本注册表，不扫 tool-registry；tool-registry
// 不含连接器条目。租户隔离：每条连接器归属单一租户，listConnectors
// 只返回请求租户的条目（跨租户不可见）。
//
// 存储：<dataDir>/config/connectors.json（单文件清单——连接器是少量
//   目录面数据，不需要 WAL/分文件；损坏 fail-closed 视为空表 = 拒绝
//   一切新注册，但不抛错阻断服务启动）。
// ============================================================

/** 连接器类型（商业平台 §3.2 存量系统对接三类） */
export type ConnectorKind = 'db' | 'rest' | 'saas';

/** 已注册连接器条目 */
export interface ConnectorEntry {
  /** 连接器标识（注册时指定，注册表内唯一） */
  name: string;
  /** 类型（db / rest / saas） */
  kind: ConnectorKind;
  /** 来源串（Git URL / 主机 / 本地路径——准入时过白名单校验，原文留档回显） */
  source: string;
  /** 来源形态（classifySource 判定结果，注册时固化） */
  sourceKind: 'git-url' | 'host' | 'local-path';
  /** 能力标签（发现面过滤维度——如 postgres / webhook / salesforce） */
  capabilities: string[];
  /** 归属租户（隔离键——清单只对本租户可见） */
  tenant: string;
  /** 接入端点（连接形态回显——如 host:port / base URL；不含凭证） */
  endpoint?: string;
  /** 注册时间（ISO 8601） */
  registeredAt: string;
}

/** 连接器注册表文件形态 */
interface ConnectorRegistryFile {
  version: number;
  connectors: ConnectorEntry[];
}

/** 连接器注册结果 */
export type ConnectorRegisterResult =
  | { ok: true; connector: ConnectorEntry }
  | { ok: false; reason: 'invalid-params' | 'source-not-allowed' | 'duplicate-name'; message: string; matched?: undefined };

/** 数据目录缺省解析（audit 侧的 dataDir 解析链副本：显式入参 >
 *  SOFAGENT_DATA > SOFAGENT_HOME/data > ~/.sofagent/data。与 core
 *  getDataDir SSOT 语义对齐、注释互指防漂移；本文件不 import core——
 *  CLI 裸 node 直跑形态（install.sh fresh clone 校验路径）保持零负担。 */
function defaultDataDir(): string {
  if (process.env.SOFAGENT_DATA) return process.env.SOFAGENT_DATA;
  const home = process.env.SOFAGENT_HOME ?? join(process.env.HOME ?? '~', '.sofagent');
  return join(home, 'data');
}

/** 注册表默认落点（<dataDir>/config/connectors.json） */
function connectorRegistryPath(dataDir: string): string {
  return join(dataDir, 'config', 'connectors.json');
}

/**
 * 读取连接器注册表（fail-closed：不存在 / 损坏 / 结构非法 → 空表）。
 * 空表语义 = 「无已注册连接器」（发现面返回空清单）且「无白名单放行依据」
 * （注册面拒绝一切——白名单来自 policy.yml，与注册表分离，见
 * loadConnectorPolicy）。
 */
function readConnectorRegistry(dataDir: string): ConnectorRegistryFile {
  const p = connectorRegistryPath(dataDir);
  if (!existsSync(p)) return { version: 1, connectors: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(p, 'utf-8'));
  } catch (err) {
    console.warn(
      `[connector-registry] 注册表损坏（${p}）：${err instanceof Error ? err.message : String(err)}——按空表处理（fail-closed）`,
    );
    return { version: 1, connectors: [] };
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as ConnectorRegistryFile).connectors)) {
    console.warn(`[connector-registry] 注册表结构非法（${p}）——按空表处理（fail-closed）`);
    return { version: 1, connectors: [] };
  }
  // 条目级过滤（坏条目剔除不整表丢弃——同 device-data-policy 纪律）
  const connectors = (raw as ConnectorRegistryFile).connectors.filter(
    (c): c is ConnectorEntry =>
      !!c && typeof c === 'object' && typeof c.name === 'string' && typeof c.kind === 'string' &&
      typeof c.source === 'string' && Array.isArray(c.capabilities) && typeof c.tenant === 'string',
  );
  return { version: 1, connectors };
}

/** 落盘注册表（JSON 原子整写——清单小文件，无 WAL 必要） */
function writeConnectorRegistry(dataDir: string, registry: ConnectorRegistryFile): void {
  const p = connectorRegistryPath(dataDir);
  const dir = join(dataDir, 'config');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(p, JSON.stringify(registry, null, 2), 'utf-8');
}

/** 连接器名合法性（与 workflow id 同词法——防路径穿越进注册表键位） */
const CONNECTOR_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** 租户 ID 校验（与 core TENANT_PATTERN 同词法——audit 不依赖 core 版本漂移，词法对齐注释互指） */
const CONNECTOR_TENANT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * 注册第三方连接器（G5b 准入面——验收 ①②）。
 *
 * 判定链（fail-closed 逐层收口）：
 *   1. 参数缺失 / 类型非法 / name·tenant 词法非法 → invalid-params
 *   2. 来源白名单校验（validatePluginSource 同源——第一章准入闸门
 *      直接复用，不另写一套判定）→ source-not-allowed
 *   3. 同租户下重名 → duplicate-name（防静默覆盖他人注册）
 *
 * @param input 连接器注册声明
 * @param opts.dataDir 数据目录（缺省 ~/.sofagent/data——与 mcp tool 层
 *   显式入参 > SOFAGENT_DATA 解析链衔接，本函数只接受显式值）
 * @param opts.policy 来源白名单策略（缺省读 policy.yml 标准落点，
 *   传 null 显式空策略 = 全拒；见 loadConnectorPolicy）
 */
export function registerConnector(
  input: {
    name: string;
    kind: ConnectorKind;
    source: string;
    capabilities?: string[];
    tenant?: string;
    endpoint?: string;
  },
  opts?: { dataDir?: string; policy?: PluginPolicy | null },
): ConnectorRegisterResult {
  const dataDir = opts?.dataDir ?? defaultDataDir();
  if (
    !input || typeof input !== 'object' ||
    typeof input.name !== 'string' || !CONNECTOR_NAME_PATTERN.test(input.name) ||
    (input.kind !== 'db' && input.kind !== 'rest' && input.kind !== 'saas') ||
    typeof input.source !== 'string' || input.source.length === 0 ||
    (input.capabilities !== undefined && !Array.isArray(input.capabilities))
  ) {
    return {
      ok: false,
      reason: 'invalid-params',
      message: '连接器声明非法（name 1-64 位字母数字开头词法 / kind ∈ db|rest|saas / source 非空 / capabilities 数组）',
    };
  }
  const tenant = input.tenant ?? 'default';
  if (!CONNECTOR_TENANT_PATTERN.test(tenant)) {
    return { ok: false, reason: 'invalid-params', message: `租户 ID「${tenant}」非法（1-64 位字母数字开头，可含 - _）` };
  }

  // 准入：第一章来源白名单同源校验（策略缺省读 policy.yml 标准落点）。
  // null 策略不能直传 validatePluginSource 的 undefined 分支——那里是
  // 「未配置 = 单机默认放行」的插装语义；连接器注册取反语义（与设备
  // 白名单 T2/T3 同源）：无白名单依据 = 无放行依据，直接拒绝。
  const policy = opts?.policy !== undefined ? opts.policy : loadConnectorPolicy(dataDir);
  if (policy === null) {
    return {
      ok: false,
      reason: 'source-not-allowed',
      message: '无来源白名单依据（policy.yml 缺失或损坏）——fail-closed 拒绝注册（连接器准入 opt-in）',
    };
  }
  const verdict = validatePluginSource(input.source, policy);
  if (!verdict.allowed) {
    return { ok: false, reason: 'source-not-allowed', message: verdict.reason };
  }

  // 重名拒绝（同租户内唯一——跨租户同名各自独立）
  const registry = readConnectorRegistry(dataDir);
  if (registry.connectors.some((c) => c.name === input.name && c.tenant === tenant)) {
    return { ok: false, reason: 'duplicate-name', message: `连接器「${input.name}」在租户「${tenant}」下已注册` };
  }

  const entry: ConnectorEntry = {
    name: input.name,
    kind: input.kind,
    source: input.source,
    sourceKind: classifySource(input.source).kind,
    capabilities: (input.capabilities ?? []).filter((c): c is string => typeof c === 'string' && c.length > 0),
    tenant,
    ...(input.endpoint !== undefined && typeof input.endpoint === 'string' ? { endpoint: input.endpoint } : {}),
    registeredAt: new Date().toISOString(),
  };
  registry.connectors.push(entry);
  writeConnectorRegistry(dataDir, registry);
  return { ok: true, connector: entry };
}

/**
 * 连接器清单查询（G5b 发现面——验收 ③④）。
 *
 * 与 tool-registry 分列：只读连接器注册表，绝不混入 MCP 工具条目。
 * 过滤维度：type（kind）/ host（来源主机或本地路径前缀）/ capability
 * （能力标签）。租户隔离：非 default 租户请求只返回本租户条目；
 * default 租户（单机缺省态）返回 default 条目——不返回其他租户。
 *
 * @param args.tenant 租户键（缺省 default）
 * @param args.kind 类型过滤
 * @param args.host 来源过滤（git/host 类匹配主机名；local-path 类匹配路径前缀）
 * @param args.capability 能力标签过滤（单标签命中即保留）
 * @param dataDir 数据目录
 */
export function listConnectors(
  args: { tenant?: string; kind?: ConnectorKind; host?: string; capability?: string } = {},
  dataDir: string = defaultDataDir(),
): { total: number; connectors: ConnectorEntry[] } {
  const registry = readConnectorRegistry(dataDir);
  const tenant = args.tenant ?? 'default';
  const filtered = registry.connectors
    // 租户隔离（先于其余过滤——跨租户条目对请求方不可见）
    .filter((c) => c.tenant === tenant)
    .filter((c) => (args.kind ? c.kind === args.kind : true))
    .filter((c) => {
      if (!args.host) return true;
      if (c.sourceKind === 'local-path') return c.source.startsWith(args.host);
      const host = hostOf(c.source);
      return host === args.host;
    })
    .filter((c) => (args.capability ? c.capabilities.includes(args.capability) : true));
  return { total: filtered.length, connectors: filtered };
}

/**
 * 按名取单个连接器（同租户可见性判定——跨租户取不到返回 null）。
 */
export function getConnector(
  name: string,
  tenant: string = 'default',
  dataDir: string = defaultDataDir(),
): ConnectorEntry | null {
  const registry = readConnectorRegistry(dataDir);
  return registry.connectors.find((c) => c.name === name && c.tenant === tenant) ?? null;
}

/**
 * 读连接器准入策略（policy.yml 标准落点——install.sh --policy 同一文件）。
 * fail-closed：不存在 / YAML 损坏 → null（调用方按空策略 = 全拒处理）。
 * 损坏时 console.warn 留证不抛异常（服务不因策略文件坏而崩）。
 */
export function loadConnectorPolicy(dataDir: string): PluginPolicy | null {
  const p = join(dataDir, 'config', 'policy.yml');
  if (!existsSync(p)) return null;
  let raw: string;
  try {
    raw = readFileSync(p, 'utf-8');
  } catch (err) {
    console.warn(
      `[connector-policy] 策略文件不可读（${p}）：${err instanceof Error ? err.message : String(err)}——按空策略处理（全拒）`,
    );
    return null;
  }
  try {
    // 静态 import（与 rule-a14/rule-a15 同形态——commonjs 产物下零摩擦）
    const parsed = yamlLoad(raw) as PluginPolicy | null;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (err) {
    console.warn(
      `[connector-policy] 策略文件解析失败（${p}）：${err instanceof Error ? err.message : String(err)}——按空策略处理（全拒）`,
    );
    return null;
  }
}

// ============================================================
// CLI 入口（install.sh --policy 消费）——裸 node 直跑形态
// 用法：
//   node plugin-gate.js --lint <policy.yml>          # 段结构校验（exit 0/1）
//   node plugin-gate.js --summary <policy.yml>       # 一行摘要（段名清单）
//   node plugin-gate.js --check-source <policy.yml> <source>  # 安装前白名单判定
// ============================================================

async function cliMain(): Promise<void> {
  const [cmd, arg1, arg2] = process.argv.slice(2);
  if (!cmd || cmd === '--help') {
    console.log('plugin-gate · 插件来源白名单 + app_tool_policy 校验器（v1.4.8）');
    console.log('用法: node plugin-gate.js --lint <policy.yml> | --summary <policy.yml> | --check-source <policy.yml> <source>');
    process.exit(cmd ? 0 : 1);
  }
  if (!arg1) { console.error('缺参数'); process.exit(1); }
  let yaml: typeof import('js-yaml');
  let fs: typeof import('fs');
  try {
    yaml = (await import('js-yaml')).default ?? (await import('js-yaml'));
    fs = await import('fs');
  } catch {
    console.error('js-yaml 不可用'); process.exit(1);
  }
  let policy: PluginPolicy;
  try {
    policy = yaml.load(fs.readFileSync(arg1, 'utf8')) as PluginPolicy;
  } catch (e) {
    console.error(`策略文件解析失败: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  if (cmd === '--lint') {
    // 段结构宽松校验：plugin_sources.allowlist 数组 + app_tool_policy.apps 对象
    const ps = policy?.plugin_sources;
    if (ps && !Array.isArray(ps.allowlist)) { console.error('plugin_sources.allowlist 须为数组'); process.exit(1); }
    const at = policy?.app_tool_policy;
    if (at && (typeof at.apps !== 'object' || at.apps === null)) { console.error('app_tool_policy.apps 须为对象'); process.exit(1); }
    console.log('✓ 策略文件结构合法');
    process.exit(0);
  }
  if (cmd === '--summary') {
    const parts: string[] = [];
    if (policy?.plugin_sources) parts.push(`plugin_sources(${policy.plugin_sources.allowlist?.length ?? 0} 项白名单${policy.plugin_sources.allowManagedHooksOnly ? ' + 托管独裁' : ''})`);
    if (policy?.app_tool_policy) parts.push(`app_tool_policy(${Object.keys(policy.app_tool_policy.apps ?? {}).length} app)`);
    console.log(parts.join(' + ') || '(空策略)');
    process.exit(0);
  }
  if (cmd === '--check-source') {
    if (!arg2) { console.error('缺 <source> 参数'); process.exit(1); }
    const v = validatePluginSource(arg2, policy);
    if (v.allowed) { console.log(`✓ 来源 ${arg2} 在白名单`); process.exit(0); }
    console.error(`❌ ${v.reason}`); process.exit(1);
  }
  console.error(`未知子命令: ${cmd}`); process.exit(1);
}

// 裸 node 直跑（install.sh 以文件路径调用 dist 产物）
if (require.main === module) {
  void cliMain();
}
