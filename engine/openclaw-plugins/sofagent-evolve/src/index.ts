// sofagent-evolve · OpenClaw 原生插件（code-plugin）
// 经验沉淀：sofagent_evolve 工具生成 think.md 反思条目（复用 @sofagent/think 的 generateThinkEntry，
// 平台无关零重写）+ before_prompt_build 注入 think.md 反思区（进化闭环的 OpenClaw 形态）。
// 对应 DSH 插件 cordis-plugin-sofagent-evolve 的 OpenClaw 形态。
// 品牌色 #16B8F3。API 分级：/* @public */ 导出对 OpenClaw 运行时契约锁定。


/* @public */ export interface EvolvePluginMeta {
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

/* @public */ export const pluginMeta: EvolvePluginMeta = {
  id: 'sofagent-evolve',
  name: 'sofagent 进化',
  version: _pkg.version ?? '0.0.0-unknown',
  description: '经验沉淀——think.md 反思条目生成 + 反思区注入（Dream Cycle + skillopt 数据源）',
  brandColor: '#16B8F3',
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type OpenClawApi = any;

/* @public */ export function register(api: OpenClawApi): void {
  const logger = api?.logger ?? console;

  // 1) before_prompt_build：注入 think.md 反思区（进化闭环上下文）
  try {
    api.on?.('before_prompt_build', (_event: unknown, ctx: any) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const m = require('@sofagent/think');
        const projectRoot = ctx?.config?.plugins?.entries?.['sofagent-evolve']?.config?.projectRoot ?? process.cwd();
        if (typeof m.generateThinkEntry === 'function') {
          // 存在性探测：能力可用即提示反思区已挂载（实际条目由 sofagent_evolve 工具生成）
          return { prependSystemContext: `[sofagent-evolve] 反思区已挂载——任务完成后调用 sofagent_evolve 沉淀经验（think.md）` };
        }
      } catch {
        // 依赖不可用时跳过（进化是增强项，不阻断会话）
      }
      return undefined;
    }, { priority: 50 });
  } catch (err) {
    logger.error?.('[sofagent-evolve] before_prompt_build 注册失败:', err instanceof Error ? err.message : String(err));
  }

  // 2) registerTool：sofagent_evolve——生成 think.md 反思条目
  try {
    api.registerTool?.(
      {
        name: 'sofagent_evolve',
        description: 'sofagent 经验沉淀——生成 think.md 反思条目（任务失败/踩坑/经验总结，进化闭环数据源）',
        parameters: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: '任务描述（反思主题）',
            },
            summary: {
              type: 'string',
              description: '经验总结（踩坑/教训/可复用方法）',
            },
          },
          required: ['task', 'summary'],
        },
        async execute(_id: string, params: { task: string; summary: string }) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const m = require('@sofagent/think');
            if (typeof m.generateThinkEntry !== 'function') {
              return { content: [{ type: 'text', text: 'sofagent_evolve：generateThinkEntry 不可用（@sofagent/think 公共 API 未导出）' }] };
            }
            m.generateThinkEntry([], { rules: [], summary: params.summary }, params.task);
            return { content: [{ type: 'text', text: `反思条目已写入 think.md：${params.task}` }] };
          } catch (err) {
            return { content: [{ type: 'text', text: `sofagent_evolve 依赖 @sofagent/think 不可用：${err instanceof Error ? err.message : String(err)}` }] };
          }
        },
      },
      { optional: true }, // 写文件副作用 → optional
    );
  } catch (err) {
    logger.error?.('[sofagent-evolve] registerTool 失败:', err instanceof Error ? err.message : String(err));
  }
}

/* @public */ export default register;
