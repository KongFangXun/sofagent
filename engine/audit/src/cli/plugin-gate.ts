// ============================================================
// plugin-gate.ts · 插件来源白名单 + 应用级工具策略（v1.4.8 第一/二章）
// ============================================================
// 企业管控收口：
//   第一章「从哪装」——plugin_sources.allowlist 三类来源白名单
//     （Git URL / 主机模式 / 本地路径），白名单外安装拒绝；
//     allow_managed_hooks_only 托管 hook 独裁模式。
//   第二章「装了能调什么」——app_tool_policy 应用 × 工具策略矩阵，
//     未声明的 app×tool 默认拒绝（fail-closed）。
//
// 接线：
//   安装侧——install.sh --policy <policy.yml> 读取后经 node 调本模块
//     validatePluginSource / validateAppToolDeclaration；
//   运行侧——app_tool_policy 判定由 orchestrator 沙箱 ToolGate 消费
//     （本模块导出纯策略数据，ToolGate 加载策略维度）。
//
// fail-closed 铁律：--policy 指定但校验器不可用（fresh clone 无 dist）时
//   install.sh 侧拒绝安装退出非零（见 install.sh 接线段），管控能力不得
//   静默降级为跳过。
// ============================================================

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
