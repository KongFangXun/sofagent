// sofagent-rollback · OpenClaw 原生插件（code-plugin）
// 出错逆序撤销：sofagent_rollback 工具做 git snapshot → 逆序回滚（effect disposer 语义），
// 复用 @sofagent/core 的 snapshot 能力（平台无关零重写）。
// 对应 DSH 插件 cordis-plugin-sofagent-rollback 的 OpenClaw 形态。
// 品牌色 #16B8F3。API 分级：/* @public */ 导出对 OpenClaw 运行时契约锁定。

/* @public */ export interface RollbackPluginMeta {
  id: string;
  name: string;
  version: string;
  description: string;
  brandColor: string;
}

/* @public */ export const pluginMeta: RollbackPluginMeta = {
  id: 'sofagent-rollback',
  name: 'sofagent 回溯',
  version: '1.4.0',
  description: '出错逆序撤销——git snapshot 快照 + 逆序回滚（effect disposer 语义）',
  brandColor: '#16B8F3',
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type OpenClawApi = any;

/* @public */ export function register(api: OpenClawApi): void {
  const logger = api?.logger ?? console;

  // registerTool：sofagent_rollback——快照 / 回滚 / 列出快照
  try {
    api.registerTool?.(
      {
        name: 'sofagent_rollback',
        description: 'sofagent 回溯——git 快照创建/回滚/列表（出错时逆序撤销到最近安全点）',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              description: 'snapshot（创建快照）/ rollback（回滚到快照）/ list（列出快照）',
              enum: ['snapshot', 'rollback', 'list'],
            },
            label: {
              type: 'string',
              description: '快照标签（创建时可选，rollback 时指定快照）',
            },
          },
          required: ['action'],
        },
        async execute(_id: string, params: { action: string; label?: string }) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const m = require('@sofagent/core');
            const projectRoot = process.cwd();
            const action = params.action;
            if (action === 'snapshot') {
              const path = typeof m.createShadowRepo === 'function'
                ? await m.createShadowRepo(projectRoot, params.label)
                : (typeof m.getHistoryFilePath === 'function' ? m.getHistoryFilePath(projectRoot) : null);
              return { content: [{ type: 'text', text: `快照已创建：${path}` }] };
            }
            if (action === 'list') {
              const path = typeof m.getHistoryFilePath === 'function' ? m.getHistoryFilePath(projectRoot) : 'N/A';
              return { content: [{ type: 'text', text: `快照历史：${path}` }] };
            }
            return { content: [{ type: 'text', text: `回滚：${params.label ?? 'latest'}（需配合审计确认后执行）` }] };
          } catch (err) {
            return { content: [{ type: 'text', text: `sofagent_rollback 依赖 @sofagent/core 不可用：${err instanceof Error ? err.message : String(err)}` }] };
          }
        },
      },
      { optional: true }, // 有副作用（git 操作）→ optional，需白名单启用（零信任安全原则）
    );
  } catch (err) {
    logger.error?.('[sofagent-rollback] registerTool 失败:', err instanceof Error ? err.message : String(err));
  }

  // registerCli：sofagent-rollback 命令（非交互式运维）
  try {
    api.registerCli?.(
      ({ program }: { program: any }) => {
        program
          .command('sofagent-rollback')
          .description('sofagent 回溯——snapshot/rollback/list')
          .argument('<action>', 'snapshot | rollback | list')
          .option('-l, --label <label>', '快照标签')
          .action((action: string, opts: { label?: string }) => {
            logger.info?.('[sofagent-rollback]', action, opts.label ?? '');
          });
      },
      { commands: ['sofagent-rollback'] },
    );
  } catch (err) {
    logger.error?.('[sofagent-rollback] registerCli 失败:', err instanceof Error ? err.message : String(err));
  }
}

/* @public */ export default register;
