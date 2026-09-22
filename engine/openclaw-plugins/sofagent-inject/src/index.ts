// sofagent-inject · OpenClaw 原生插件（code-plugin）
// 约束注入：before_prompt_build 时把 sofagent 四层加载链注入系统上下文。
//   L1 core-rules.md（核心铁律）· L2 think.md（反思区）· L3 fde.md（用户规则）· L4 knowledge/（知识库）
// 复用 @sofagent/inject 的 buildConstrainedSystemPrompt（npm API 场景同源实现），
// 与 engine/hooks/sofagent-load-chain（OpenClaw hook 形态）职责互补、不合并。
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
  description: '给 OpenClaw 加上约束注入——每次构建提示词前带上企业铁律 / 反思 / 用户规则 / 知识库（四层加载链）',
  brandColor: '#16B8F3',
};

// 宽松 API 类型——OpenClaw 运行时注入 register(api)，本地无 SDK 时避免硬类型依赖
/* eslint-disable @typescript-eslint/no-explicit-any */
type OpenClawApi = any;

/**
 * 已解析的项目根（register 时从插件配置捕获）。
 *
 * 🔴 为什么需要：manifest 声明了 `configSchema.projectRoot`，宿主把该配置经 schema 校验后
 * 通过插件 API 顶层的 `pluginConfig` 注入（OpenClaw 插件契约字段，SDK 侧类型为
 * `pluginConfig?: Record<string, unknown>`）。两处必须同源：hook 与工具都取本变量，
 * 都未配置时才回落 `process.cwd()`。
 *
 * 🔴 不要改读 hook 的 `ctx.config`：agent 类 hook 的 ctx 由宿主白名单构造
 * （`buildAgentHookContext` 只展开 runId / agentId / sessionKey / workspaceDir /
 * modelId 等 15 个字段），**不含 config**——照 `ctx?.config?.plugins?.entries?...` 取配置
 * 会恒得 undefined 并静默回落，表现为「配置写了不生效」。插件配置的正确读点只有
 * register 期的 `api.pluginConfig`。
 */
let configuredRoot: string | undefined;

/* @public */ export function register(api: OpenClawApi): void {
  const logger = api?.logger ?? console;
  const pluginCfg = api?.pluginConfig;
  configuredRoot = typeof pluginCfg?.projectRoot === 'string' && pluginCfg.projectRoot.trim()
    ? pluginCfg.projectRoot
    : undefined;

  // 1) before_prompt_build：注入四层加载链（会话级强制，对应 DSH tools/pre-execute 的注入形态）
  try {
    api.on?.('before_prompt_build', () => {
      try {
        // 动态 require：依赖未装/能力不可用时降级（插件可独立安装）
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const m = require('@sofagent/inject');
        const projectRoot = configuredRoot ?? process.cwd(); // 与工具同源（见 configuredRoot 说明）
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
            const m = require('@sofagent/inject');
            const projectRoot = configuredRoot ?? process.cwd(); // 与 hook 同源：pluginConfig.projectRoot 生效
            const injected = typeof m.buildConstrainedSystemPrompt === 'function' ? m.buildConstrainedSystemPrompt(projectRoot) : '';
            return {
              content: [{ type: 'text', text: injected ? `已注入四层加载链（${injected.length} 字符）：\n${injected.slice(0, 500)}` : '无注入内容（项目无约束配置）' }],
            };
          } catch (err) {
            return { content: [{ type: 'text', text: `sofagent_inject 依赖 @sofagent/inject 不可用：${err instanceof Error ? err.message : String(err)}` }] };
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
