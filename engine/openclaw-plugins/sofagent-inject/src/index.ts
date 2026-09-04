// sofagent-inject · OpenClaw 原生插件（code-plugin）
// 约束注入：before_prompt_build 时把 sofagent 四层加载链注入系统上下文。
//   L1 core-rules.md（核心铁律）· L2 think.md（反思区）· L3 fde.md（用户规则）· L4 knowledge/（知识库）
// 复用 @sofagent/harness 的 buildConstrainedSystemPrompt（npm API 场景同源实现），
// 与 engine/hooks/sofagent-load-chain（OpenClaw hook 形态）职责互补、不合并。
// 品牌色 #16B8F3（sofagent 主色）。
// API 分级：/* @public */ 导出对 OpenClaw 运行时契约锁定（register 入口 + pluginMeta）。


/* @public */ export interface InjectPluginMeta {
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

/* @public */ export const pluginMeta: InjectPluginMeta = {
  id: 'sofagent-inject',
  name: 'sofagent 注入',
  version: _pkg.version ?? '0.0.0-unknown',
  description: '约束注入——before_prompt_build 注入四层加载链（core-rules/think.md/fde.md/knowledge）',
  brandColor: '#16B8F3',
};

// 宽松 API 类型——OpenClaw 运行时注入 register(api)，本地无 SDK 时避免硬类型依赖
/* eslint-disable @typescript-eslint/no-explicit-any */
type OpenClawApi = any;

/* @public */ export function register(api: OpenClawApi): void {
  const logger = api?.logger ?? console;

  // 1) before_prompt_build：注入四层加载链（会话级强制，对应 DSH tools/pre-execute 的注入形态）
  try {
    api.on?.('before_prompt_build', (_event: unknown, ctx: any) => {
      try {
        // 动态 require：依赖未装/能力不可用时降级（插件可独立安装）
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const m = require('@sofagent/harness');
        const projectRoot = ctx?.config?.plugins?.entries?.['sofagent-inject']?.config?.projectRoot ?? process.cwd();
        const injected = typeof m.buildConstrainedSystemPrompt === 'function' ? m.buildConstrainedSystemPrompt(projectRoot) : '';
        if (injected) {
          return { prependSystemContext: injected };
        }
      } catch {
        // 约束注入失败不阻断会话（软约束；审计是硬的）
      }
      return undefined;
    }, { priority: 100 });
  } catch (err) {
    logger.error?.('[sofagent-inject] before_prompt_build 注册失败:', err instanceof Error ? err.message : String(err));
  }

  // 2) registerTool：sofagent_inject——手动触发注入查询（调试/验证用）
  try {
    api.registerTool?.(
      {
        name: 'sofagent_inject',
        description: 'sofagent 约束注入查询——返回四层加载链注入内容（core-rules/think.md/fde.md/knowledge）',
        parameters: {
          type: 'object',
          properties: {},
        },
        async execute(_id: string, _params: Record<string, unknown>) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const m = require('@sofagent/harness');
            const projectRoot = process.cwd();
            const injected = typeof m.buildConstrainedSystemPrompt === 'function' ? m.buildConstrainedSystemPrompt(projectRoot) : '';
            return {
              content: [{ type: 'text', text: injected ? `已注入四层加载链（${injected.length} 字符）：\n${injected.slice(0, 500)}` : '无注入内容（项目无约束配置）' }],
            };
          } catch (err) {
            return { content: [{ type: 'text', text: `sofagent_inject 依赖 @sofagent/harness 不可用：${err instanceof Error ? err.message : String(err)}` }] };
          }
        },
      },
      { optional: false },
    );
  } catch (err) {
    logger.error?.('[sofagent-inject] registerTool 失败:', err instanceof Error ? err.message : String(err));
  }
}

/* @public */ export default register;
