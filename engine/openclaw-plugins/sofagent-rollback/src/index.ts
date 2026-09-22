// sofagent-rollback · OpenClaw 原生插件（code-plugin）
// 出错逆序撤销：sofagent_rollback 工具做 git snapshot → 逆序回滚（effect disposer 语义），
// 复用 @sofagent/core 的 snapshot 能力（平台无关零重写）。
// 对应 DSH 插件 cordis-plugin-sofagent-rollback 的 OpenClaw 形态。
// API 分级：/* @public */ 导出对 OpenClaw 运行时契约锁定。


/* @public */ export interface RollbackPluginMeta {
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

/* @public */ export const pluginMeta: RollbackPluginMeta = {
  id: 'sofagent-rollback',
  name: 'sofagent 回溯',
  version: _pkg.version ?? '0.0.0-unknown',
  description: '给 OpenClaw 加上快照回溯——出错时用 sofagent_rollback 按 git 快照一键回滚本次改动',
  brandColor: '#16B8F3',
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type OpenClawApi = any;

/**
 * 已解析的项目根（register 时从插件配置捕获）。
 *
 * 🔴 为什么需要：manifest 声明了 `configSchema.projectRoot`，宿主把该配置经 schema 校验后
 * 通过插件 API 顶层的 `pluginConfig` 注入（OpenClaw 插件契约字段，SDK 侧类型为
 * `pluginConfig?: Record<string, unknown>`）。此前硬编码 `process.cwd()`——用户在配置里
 * 指定 projectRoot 后，快照 / 回滚依然落到宿主进程的当前目录而不是配置的仓库；
 * 对回滚工具而言「回滚到错误仓库」属高危面。
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
            confirm: {
              type: 'boolean',
              description: 'rollback 二次确认——首次调用返回将触及文件的预览，confirm=true 才执行恢复',
            },
          },
          required: ['action'],
        },
        async execute(_id: string, params: { action: string; label?: string; confirm?: boolean }) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const m = require('@sofagent/core');
            const projectRoot = configuredRoot ?? process.cwd(); // 与 register 同源：pluginConfig.projectRoot 生效
            const action = params.action;
            if (action === 'snapshot') {
              // v1.5.0 TASK-18: 快照走 commitSnapshot（真实快照落盘）+ label 记账——
              // 原实现只 createShadowRepo（仅建目录结构，零快照内容），快照面空转。
              const sha = typeof m.commitSnapshot === 'function'
                ? m.commitSnapshot(projectRoot, params.label)
                : null;
              if (sha === null) throw new Error('@sofagent/core 缺 commitSnapshot 导出');
              return { content: [{ type: 'text', text: `快照已创建：${sha}${params.label ? `（label: ${params.label}）` : ''}` }] };
            }
            if (action === 'list') {
              // v1.5.0 TASK-18: list 走 listSnapshots 真实清单（原实现只打 history 路径）
              if (typeof m.listSnapshots !== 'function') throw new Error('@sofagent/core 缺 listSnapshots 导出');
              const snaps = m.listSnapshots(projectRoot) as Array<{ sha: string; timestamp: string; label?: string; files: Record<string, string> }>;
              if (snaps.length === 0) {
                return { content: [{ type: 'text', text: '暂无快照（先 action=snapshot 创建）' }] };
              }
              const lines = snaps.map((s) => `  ${s.sha.slice(0, 8)}  ${s.timestamp}${s.label ? `  [${s.label}]` : ''}  (${Object.keys(s.files).length} 文件)`);
              return { content: [{ type: 'text', text: `快照历史（${snaps.length} 份，最新在末尾）:\n${lines.join('\n')}` }] };
            }
            if (action === 'rollback') {
              // v1.5.0 TASK-18: rollback 实装——原实现仅返回提示文案（零恢复调用）。
              // 两段式确认语义：首次调用展示将触及的文件（dry-run），confirm=true
              // 才执行恢复；恢复失败抛结构化错误（非裸文本）。
              if (typeof m.restoreSnapshot !== 'function' || typeof m.listSnapshots !== 'function') {
                throw new Error('@sofagent/core 缺 restoreSnapshot/listSnapshots 导出');
              }
              // 定位目标快照：label 优先（findSnapshotByLabel），缺省最新
              let targetSha: string | null = null;
              let targetInfo = 'latest';
              if (params.label) {
                const snaps = m.listSnapshots(projectRoot) as Array<{ sha: string; timestamp: string; label?: string; files: Record<string, string> }>;
                const matched = snaps.filter((s) => s.label === params.label);
                if (matched.length === 0) {
                  return { content: [{ type: 'text', text: `未找到 label 为 "${params.label}" 的快照。可用: ${snaps.filter((s) => s.label).map((s) => s.label).join(', ') || '（无带标签快照）'}` }] };
                }
                const target = matched[matched.length - 1]!;
                targetSha = target.sha;
                targetInfo = `label=${params.label} sha=${target.sha.slice(0, 8)}`;
              } else {
                const snaps = m.listSnapshots(projectRoot) as Array<{ sha: string }>;
                if (snaps.length === 0) {
                  return { content: [{ type: 'text', text: '暂无可回滚的快照' }] };
                }
                targetSha = snaps[snaps.length - 1]!.sha;
              }
              if (!params.confirm) {
                // 第一段：dry-run 展示——回滚将触及的文件（快照内全部文件），等确认
                const snaps = m.listSnapshots(projectRoot) as Array<{ sha: string; files: Record<string, string>; label?: string }>;
                const target = snaps.find((s) => s.sha === targetSha)!;
                const fileList = Object.keys(target.files).slice(0, 20).map((p) => `  ${p}`).join('\n');
                const more = Object.keys(target.files).length > 20 ? `\n  ...（共 ${Object.keys(target.files).length} 个文件）` : '';
                return { content: [{ type: 'text', text: `回滚预览（${targetInfo}）——将恢复以下文件:\n${fileList}${more}\n\n确认执行请带 confirm: true 重新调用。` }] };
              }
              // 第二段：确认后真实恢复
              const restored = m.restoreSnapshot(projectRoot, targetSha) as string[];
              return { content: [{ type: 'text', text: `已回滚到 ${targetInfo}，恢复 ${restored.length} 个文件` }] };
            }
            return { content: [{ type: 'text', text: `未知 action: ${action}（可选 snapshot / rollback / list）` }] };
          } catch (err) {
            // v1.5.0 TASK-18: 结构化错误（非裸文本）——调用方可编程处理
            return { isError: true, content: [{ type: 'text', text: `sofagent_rollback 执行失败: ${err instanceof Error ? err.message : String(err)}` }] };
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
