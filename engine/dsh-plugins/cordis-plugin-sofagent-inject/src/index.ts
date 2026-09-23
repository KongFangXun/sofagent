// cordis-plugin-sofagent-inject · DSH 反向插件（v1.5.1：98 行样板收敛到 @sofagent/dsh-plugin-kit）
// seam 挂载：agent/pre-step    # 语义：模型看到输入前注入四层加载链约束（Turn 首步一条消息）
// 清单生成源 = engine/dsh-plugins/plugins.json（生成 package.json 的 description/sofagent/dsh 段与 cordis.patch.yml）；本文件的 seam 字面量由生成器 --check 与之对账。

import {
  createSofagentPlugin,
  seamHelpers,
  type SeamHandler,
  type SeamHelpers,
} from '@sofagent/dsh-plugin-kit';

/** 一次性日志表（接线自证 / 降级提示只打一次） */
const logged = new Set<string>();
function logOnce(helpers: SeamHelpers, key: string, message: string): void {
  if (logged.has(key)) return;
  logged.add(key);
  helpers.log(message);
}

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** 项目根：宿主 session 的 cwd 优先（对齐宿主同类 listener 的取法），缺省进程工作目录 */
function projectRootOf(payload: unknown): string {
  const agent = (payload as { agent?: unknown } | null | undefined)?.agent as
    | { session?: { header?: { cwd?: unknown } } }
    | undefined;
  const cwd = agent?.session?.header?.cwd;
  if (typeof cwd === 'string' && cwd !== '') return cwd;
  return process.env.SOFAGENT_PROJECT_ROOT ?? process.cwd();
}

/**
 * seam 事件处理器（v1.5.0 章十）——`agent/pre-step` 的**实现**（此前只有声明）。
 *
 * 宿主契约（`dsh-agent-loop.preStep`）：waterfall 派发，listener 约定
 * `(payload, next)`，payload = `{ messages, turn, step, signal }`；`next()` 给出
 * 宿主默认决策 `{ kind, messages }`，返回一个改过的决策即可改变本步交给模型的输入。
 *
 * 🔴 判定逻辑零改动：约束文本来自既有 `@sofagent/inject.buildConstrainedSystemPrompt`，
 *    插件只负责把它作为一条消息挂进本步输入。
 * 🔴 只在 Turn 首个 step 注入（对齐宿主同类 listener 的 `step === 1` 判据）——
 *    约束是常驻上下位，逐步重复注入只会白烧 token。
 * 🔴 失败一律 fail-open：约束源 / 消息工厂任一不可用即原样返回宿主决策。
 */
const seamHandlers: Record<string, SeamHandler> = {
  'agent/pre-step': async (...args: unknown[]) => {
    const helpers = seamHelpers(args);
    const [payload, next] = args;
    const decision = (typeof next === 'function' ? await (next as () => Promise<unknown>)() : undefined) as
      | { kind?: unknown; messages?: unknown }
      | undefined;
    if (decision === undefined || decision.kind === 'reject') return decision;
    const step = (payload as { step?: unknown } | null | undefined)?.step;
    if (step !== 1) return decision;
    if (!Array.isArray(decision.messages)) return decision;
    let text: unknown;
    try {
      text = await helpers.call(
        '@sofagent/inject',
        'buildConstrainedSystemPrompt',
        projectRootOf(payload),
      );
    } catch (err) {
      logOnce(helpers, 'pre-step-unavailable', `约束注入不可用（本次不注入）：${errMsg(err)}`);
      return decision;
    }
    if (typeof text !== 'string' || text.trim() === '') return decision;
    try {
      // 消息构造走宿主自己的工厂（`@deepseek-ai/dsh-llm`）而非手搓形状——
      // 插件保持零静态宿主 import，宿主面一律经 helpers.call 动态取。
      const message = await helpers.call('@deepseek-ai/dsh-llm', 'createUserMessage', {
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin: 'sofagent-inject' },
      });
      logOnce(helpers, 'pre-step-injected', '四层加载链约束已在 Turn 首步注入（agent/pre-step）');
      return { ...decision, messages: [...decision.messages, message] };
    } catch (err) {
      logOnce(helpers, 'pre-step-message-failed', `约束消息构造失败（本次不注入）：${errMsg(err)}`);
      return decision;
    }
  },
};

/** 插件声明（本文件唯一手写处；适配层红线由 kit 承担：ctx 鸭子类型 + 宿主 API 缺席降级不抛） */
const kit = createSofagentPlugin(
  {
    id: 'cordis-plugin-sofagent-inject',
    seam: 'agent/pre-step',
    seamSemantics: '模型看到输入前注入四层加载链约束（Turn 首步一条消息，判定源 = buildConstrainedSystemPrompt）',
    capability: '约束注入链（SKILL→fde→think→knowledge）',
    bridgePkg: '@sofagent/inject',
    bridgeApi: 'buildConstrainedSystemPrompt',
    description: '启动注入企业约束——四层加载链',
    seamHandlers,
  },
  require('../package.json') as { version?: string },
);

export const pluginMeta = kit.pluginMeta; // 插件元数据（DSH profile/注册表消费）
export const capability = kit.capability; // 依赖的 sofagent 能力说明（DSH skill 引导链展示）
export const invoke = kit.invoke; // 桥接 @sofagent/* 公共 API（懒加载 + 降级不抛）
export default kit.plugin; // DSH Cordis 插件契约（apply 三段式由 kit 提供）
