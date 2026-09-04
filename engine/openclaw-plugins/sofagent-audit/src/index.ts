// sofagent-audit · OpenClaw 原生插件（code-plugin）
// 变更机器审阅：before_tool_execute 拦截危险工具（rm -rf / git push / git reset --hard 等）
// + sofagent_audit 工具跑 24 规则 + git diff 硬证据审计（复用 @sofagent/audit 引擎，平台无关零重写）。
// 对应 DSH 插件 cordis-plugin-sofagent-audit 的 OpenClaw 形态（同引擎、不同宿主 hook 事件面）。
// 品牌色 #16B8F3。API 分级：/* @public */ 导出对 OpenClaw 运行时契约锁定。


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
  description: '变更机器审阅——24 规则 + git diff 硬证据 + 危险工具拦截（before_tool_execute）',
  brandColor: '#16B8F3',
};

// 危险工具黑名单：拦截高破坏性命令（与审计引擎 A2/A9 等规则同向）
/* @public */ export const DANGEROUS_TOOLS: ReadonlyArray<string> = [
  'rm', 'rmdir', 'git_push', 'git_reset', 'git_reset_hard', 'git_clean', 'git_checkout', 'git_revert',
  'delete_file', 'force_delete', 'fs_delete', 'fs_remove', 'drop_table', 'drop_database',
];

/* eslint-disable @typescript-eslint/no-explicit-any */
type OpenClawApi = any;

/* @public */ export function register(api: OpenClawApi): void {
  const logger = api?.logger ?? console;

  // 1) before_tool_execute：危险工具拦截（对应 DSH tools/pre-execute，审计硬约束）
  try {
    api.on?.('before_tool_execute', (event: any) => {
      const toolName = String(event?.toolName ?? event?.tool ?? '');
      if (DANGEROUS_TOOLS.includes(toolName)) {
        logger.warn?.('[sofagent-audit] 拦截危险工具:', toolName);
        return { allowed: false, reason: `sofagent 审计拦截：工具 ${toolName} 属高危操作，请改用受审计通道（sofagent_audit 先行评估）` };
      }
      return { allowed: true };
    }, { priority: 100 });
  } catch (err) {
    logger.error?.('[sofagent-audit] before_tool_execute 注册失败:', err instanceof Error ? err.message : String(err));
  }

  // 2) registerTool：sofagent_audit——跑 24 规则 + git diff 审计
  try {
    api.registerTool?.(
      {
        name: 'sofagent_audit',
        description: 'sofagent 变更审计——对工作区跑 24 规则（git diff 硬证据 + 敏感文件/密钥/路径规则），返回结构化审计结果',
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
            const projectRoot = process.cwd();
            const results = typeof m.runRules === 'function' ? await m.runRules([], { projectRoot }) : null;
            if (results) {
              const rules = Array.isArray(results.rules) ? results.rules : [];
              const pass = rules.filter((r: { status?: string }) => r.status === 'PASS').length;
              const fail = rules.filter((r: { status?: string }) => r.status === 'FAIL').length;
              return {
                content: [{
                  type: 'text',
                  text: `sofagent 审计完成：${rules.length} 规则（PASS ${pass} / FAIL ${fail}）\n${JSON.stringify(results).slice(0, 2000)}`,
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
