// sofagent-audit · OpenClaw 原生插件（code-plugin）
// 变更机器审阅：before_tool_call 拦截危险工具（rm -rf / git push / git reset --hard 等）
// + sofagent_audit 工具跑 25 规则 + git diff 硬证据审计（复用 @sofagent/audit 模块，平台无关零重写）。
// 对应 DSH 插件 cordis-plugin-sofagent-audit 的 OpenClaw 形态（同引擎、不同宿主 hook 事件面）。
// API 分级：/* @public */ 导出对 OpenClaw 运行时契约锁定。


/* @public */ export interface AuditPluginMeta {
  id: string;
  name: string;
  version: string;
  description: string;
  brandColor: string;
}

// v1.4.5 (T7/R4): 版本运行时读取 package.json——此前硬编码 '1.4.0'，发版 bump 后
// pluginMeta.version 落后 4 个版本（package.json 1.4.4）。tsconfig 无 resolveJsonModule
// （import json 编译不过），包输出为 CJS（无 type:module）→ 直接用 require 同步读。
// 路径相对本文件编译产物 dist/index.js → 上溯一级即 package.json。
// 读不到（打包剥离等）兜底 '0.0.0-unknown'——缺版本比错版本诚实。
const _pkg: { version?: string } = require('../package.json');

/* @public */ export const pluginMeta: AuditPluginMeta = {
  id: 'sofagent-audit',
  name: 'sofagent 审计',
  version: _pkg.version ?? '0.0.0-unknown',
  description: '给 OpenClaw 加上审计——工具调用前拦停危险操作（工具名黑名单 + 命令级检查），另提供 sofagent_audit 工具跑 25 条 git diff 硬证据规则',
  brandColor: '#16B8F3',
};

// 危险工具黑名单：拦截高破坏性命令（与审计模块 A2/A9 等规则同向）
/* @public */ export const DANGEROUS_TOOLS: ReadonlyArray<string> = [
  'rm', 'rmdir', 'git_push', 'git_reset', 'git_reset_hard', 'git_clean', 'git_checkout', 'git_revert',
  'delete_file', 'force_delete', 'fs_delete', 'fs_remove', 'drop_table', 'drop_database',
];

/**
 * 从工具参数里取命令字符串。
 *
 * 🔴 为什么需要：宿主 `before_tool_call` 事件带 `params`（工具参数），而真正的危险命令藏在
 *    参数里——只比 `toolName` 时，形如 `bash: rm -rf /` 的调用会整条穿过拦截（工具名是 `bash`，
 *    不在黑名单里）。不同工具的命令字段名不同，按 command / cmd / script / input 逐个试。
 */
/* @public */ export function extractCommand(params: unknown): string | null {
  if (!params || typeof params !== 'object') return null;
  const p = params as Record<string, unknown>;
  for (const key of ['command', 'cmd', 'script', 'input']) {
    const v = p[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type OpenClawApi = any;

/**
 * 已解析的审计工作区根（register 时从插件配置捕获）。
 *
 * 🔴 为什么需要：manifest 声明了 `configSchema.projectRoot`（描述即「审计工作区根目录」），
 * 宿主把该配置经 schema 校验后通过插件 API 顶层的 `pluginConfig` 注入（OpenClaw 插件契约
 * 字段，SDK 侧类型为 `pluginConfig?: Record<string, unknown>`）。此前硬编码
 * `process.cwd()`——用户在配置里指定 projectRoot 后，审计依然对宿主进程当前目录取 diff；
 * 「装在工作区 A、却审了目录 B」会让审计结论整体失真。
 *
 * 读点只能是 register：`api.pluginConfig` 仅在注册期可达（工具执行期拿不到 api 对象），
 * 故在注册时解析一次并缓存，工具内回落 `process.cwd()`。
 */
let configuredRoot: string | undefined;

/* @public */ export function register(api: OpenClawApi): void {
  const logger = api?.logger ?? console;
  const pluginCfg = api?.pluginConfig;
  configuredRoot = typeof pluginCfg?.projectRoot === 'string' && pluginCfg.projectRoot.trim()
    ? pluginCfg.projectRoot
    : undefined;

  // 1) before_tool_call：危险工具拦截（对应 DSH tools/pre-execute，审计硬约束）
  // 🔴 OpenClaw 拦截契约（宿主 PluginHookBeforeToolCallResult）：拦停 = 返回
  //    `{ block: true, blockReason }`。宿主 hook-runner 对 `block` 取 sticky-true、
  //    并在 `block === true` 时短路后续 handler，tool 调用随即被拒（kind:"veto"）。
  //    ⚠️ 不能返回 `{ allowed: false }`——那是 DSH/cordis 的契约形状，OpenClaw
  //    只读 `.block`，`allowed` 被静默忽略 = 拦截永不生效的能力静默失效。
  //    Blocking contract: return `{ block: true, blockReason }`; the host reads only
  //    `.block`. `{ allowed: false }` (the DSH/cordis shape) is silently ignored.
  //    放行 = 返回 void（runner 会跳过 undefined 结果 = 明确「无意见」）。
  try {
    api.on?.('before_tool_call', (event: any) => {
      const toolName = String(event?.toolName ?? event?.tool ?? '');
      if (DANGEROUS_TOOLS.includes(toolName)) {
        logger.warn?.('[sofagent-audit] 拦截危险工具:', toolName);
        return { block: true, blockReason: `sofagent 审计拦截：工具 ${toolName} 属高危操作，请改用受审计通道（sofagent_audit 先行评估）` };
      }
      // 🔴 命令级检查（v1.4.9 修复）：黑名单只比工具名，而 `rm -rf /` 这类调用藏在 params 里
      //    ——不查参数就等于拦截落空。判据复用引擎的 checkDangerousCommand（同一份，不重造）。
      const command = extractCommand(event?.params);
      if (command) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const m = require('@sofagent/orchestrator');
          const reason = typeof m.checkDangerousCommand === 'function'
            ? (m.checkDangerousCommand(command) as string | null)
            : null;
          if (reason) {
            logger.warn?.('[sofagent-audit] 拦截危险命令:', reason);
            return { block: true, blockReason: `sofagent 审计拦截：${reason}` };
          }
        } catch {
          // 为何可静默：@sofagent/orchestrator 未装时退化为「工具名黑名单」——拦截面收窄，
          // 但不阻断会话、也不谎报放行为「已检查」（该分支下确实只做了工具名那一层）。
        }
      }
      return;
    }, { priority: 100 });
  } catch (err) {
    logger.error?.('[sofagent-audit] before_tool_call 注册失败:', err instanceof Error ? err.message : String(err));
  }

  // 2) registerTool：sofagent_audit——跑 25 规则 + git diff 审计
  try {
    api.registerTool?.(
      {
        name: 'sofagent_audit',
        description: 'sofagent 变更审计——对工作区跑 25 规则（git diff 硬证据 + 敏感文件/密钥/路径规则），返回结构化审计结果',
        parameters: {
          type: 'object',
          properties: {
            scope: {
              type: 'string',
              description: '审计范围：workspace（默认，整仓 diff）/ staged（仅暂存区）',
              enum: ['workspace', 'staged'],
            },
          },
        },
        async execute(_id: string, params: { scope?: string }) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const m = require('@sofagent/audit');
            const projectRoot = configuredRoot ?? process.cwd(); // 与 register 同源：pluginConfig.projectRoot 生效
            // v1.4.5 审查 P1 修复：此前 m.runRules([], { projectRoot }) 传空 diff——
            // 空 diff 无可审内容恒 PASS（假绿），且 { projectRoot } 被误当 logEntries 位置参数。
            // 现按 scope 取真实 diff：workspace = git diff HEAD（整仓未提交变更），
            // staged = git diff --cached（仅暂存区；parseDiff 的 range 参数透传给 git diff）。
            const range = params?.scope === 'staged' ? '--cached' : 'HEAD';
            const diffFiles = typeof m.parseDiff === 'function' ? m.parseDiff(range, projectRoot) : [];
            const results = typeof m.runRules === 'function' ? m.runRules({ diffFiles }) : null;
            if (results) {
              const rules = Array.isArray(results.rules) ? results.rules : [];
              const pass = rules.filter((r: { status?: string }) => r.status === 'PASS').length;
              const fail = rules.filter((r: { status?: string }) => r.status === 'FAIL').length;
              const warn = rules.filter((r: { status?: string }) => r.status === 'WARN').length;
              return {
                content: [{
                  type: 'text',
                  text: `sofagent 审计完成：${rules.length} 规则（PASS ${pass} / FAIL ${fail} / WARN ${warn}）\n${JSON.stringify(results).slice(0, 2000)}`,
                }],
              };
            }
            return { content: [{ type: 'text', text: 'sofagent_audit：runRules 不可用（@sofagent/audit 公共 API 未导出）' }] };
          } catch (err) {
            return { content: [{ type: 'text', text: `sofagent_audit 依赖 @sofagent/audit 不可用：${err instanceof Error ? err.message : String(err)}` }] };
          }
        },
      },
      { optional: false },
    );
  } catch (err) {
    logger.error?.('[sofagent-audit] registerTool 失败:', err instanceof Error ? err.message : String(err));
  }
}

/* @public */ export default register;
