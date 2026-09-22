// cordis-plugin-sofagent-evolve · DSH 反向插件（v1.5.1：98 行样板收敛到 @sofagent/dsh-plugin-kit）
// seam 挂载：session/event    # 语义：会话事件流中的 Turn 结束（turn/end）→ 经验沉淀（think.md 反思）
// 清单生成源 = engine/dsh-plugins/plugins.json（生成 package.json 的 description/sofagent/dsh 段与 cordis.patch.yml）；本文件的 seam 字面量由生成器 --check 与之对账。

import {
  createSofagentPlugin,
  seamHelpers,
  type SeamHandler,
  type SeamHelpers,
} from '../../plugin-kit/dist/index.js';

/** 一次性日志表（接线自证 / 降级提示只打一次） */
const logged = new Set<string>();
function logOnce(helpers: SeamHelpers, key: string, message: string): void {
  if (logged.has(key)) return;
  logged.add(key);
  helpers.log(message);
}

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** 项目根：会话 header 的 cwd 优先，缺省进程工作目录 */
function cwdOf(session: unknown): string {
  const cwd = (session as { header?: { cwd?: unknown } } | null | undefined)?.header?.cwd;
  if (typeof cwd === 'string' && cwd !== '') return cwd;
  return process.env.SOFAGENT_PROJECT_ROOT ?? process.cwd();
}

/** 数据目录：交给 @sofagent/core 自己的解析（与 MCP/CLI 同源） */
async function resolveDataDir(helpers: SeamHelpers): Promise<string | undefined> {
  try {
    const dir = await helpers.call('@sofagent/core', 'getDataDir');
    return typeof dir === 'string' && dir !== '' ? dir : undefined;
  } catch (err) {
    helpers.log(`数据目录解析不可用（交引擎默认值）：${errMsg(err)}`);
    return undefined;
  }
}

/**
 * seam 事件处理器（v1.5.0 章十）——`turn/end` 的**实现**（此前只有声明）。
 *
 * 🔴 订阅点是 `session/event`，不是 `turn/end`：宿主把 `turn/end` 作为**会话事件
 *    类型**发布（`session.append('turn/end', { turn, reason })` → 广播到
 *    `session/event`，listener 收到 `(session, event)`），仓内/宿主均无 ctx 级
 *    `turn/end` 派发点——`ctx.on('turn/end')` 会订阅到一个永不触发的事件名。
 *    故 seam 名与订阅名都写真实可订阅的 `session/event`，收尾语义由过滤条件承载。
 *
 * 判定逻辑零改动：diff 取数 / 规则运行 / 沉淀写入全部是既有 @public API
 * （`parseDiff` → `runRules` → `generateThinkEntry`），插件只做串联。
 * 空 diff 即返回（`generateThinkEntry` 自身也判空）——工作区干净时零副作用。
 */
const seamHandlers: Record<string, SeamHandler> = {
  'session/event': async (...args: unknown[]) => {
    const helpers = seamHelpers(args);
    const [session, event] = args;
    const e = event as { type?: unknown } | null | undefined;
    if (e?.type !== 'turn/end') return; // 收尾过滤：其余会话事件不参与沉淀
    try {
      const root = cwdOf(session);
      const diffFiles = await helpers.call('@sofagent/core', 'parseDiff', 'HEAD', root);
      if (!Array.isArray(diffFiles) || diffFiles.length === 0) return; // 无变更不沉淀
      const results = await helpers.call('@sofagent/audit', 'runRules', {
        diffFiles,
        silent: true,
      });
      await helpers.call(
        '@sofagent/think',
        'generateThinkEntry',
        diffFiles,
        results,
        process.env.SOFAGENT_TASK,
        { dataDir: await resolveDataDir(helpers) },
      );
      logOnce(helpers, 'turn-end-sedimented', 'Turn 收尾经验沉淀已执行（think.md 反思条目）');
    } catch (err) {
      logOnce(helpers, 'turn-end-unavailable', `经验沉淀不可用（本次跳过，不影响 Turn 收尾）：${errMsg(err)}`);
    }
  },
};

/** 插件声明（本文件唯一手写处；适配层红线由 kit 承担：ctx 鸭子类型 + 宿主 API 缺席降级不抛） */
const kit = createSofagentPlugin(
  {
    id: 'cordis-plugin-sofagent-evolve',
    seam: 'session/event',
    seamSemantics: '会话事件流中的 Turn 结束（turn/end）→ 经验沉淀（think.md 反思）',
    capability: '进化能力（经验自动沉淀）',
    bridgePkg: '@sofagent/think',
    bridgeApi: 'generateThinkEntry',
    description: '经验沉淀——think.md 反思 + Dream Cycle + evolve + instinct→skill + refine',
    seamHandlers,
  },
  require('../package.json') as { version?: string },
);

export const pluginMeta = kit.pluginMeta; // 插件元数据（DSH profile/注册表消费）
export const capability = kit.capability; // 依赖的 sofagent 能力说明（DSH skill 引导链展示）
export const invoke = kit.invoke; // 桥接 @sofagent/* 公共 API（懒加载 + 降级不抛）
export default kit.plugin; // DSH Cordis 插件契约（apply 三段式由 kit 提供）
