// cordis-plugin-sofagent-evolve · DSH 反向插件（v1.5.9 章七：进化面升格 RSI 独立模块）
// seam 挂载：session/event + fs/write-intent
// # 语义：① 会话事件流中的 Turn 结束（turn/end）→ 经验沉淀（think.md 反思）
//         ② 文件写入意图拦截（写面权限窄化——模型只写 memory / skill，控制面写入即拒）
// RSI 模块定位（manifest 声明含此七项）：准入门 / 晋级 / 经验池 / 考核 / 写面审计 / 能力基线 / 透明仓
//   —— 产品形态自 v1.5.9 起从 harness 主干功能**改挂**本插件（DSH 七款之一，插件位已存在，
//      零迁移成本：改的是归属标注与 manifest 声明，不是代码搬移）。沉淀留主干（数据管道），
//      进化独立成 RSI 插件（决策管道）；换掉本插件 ≠ 失去审计与沉淀（主干完整性不受插件存废影响）。
//   治理件（门禁 / 台账 / 验证器）全在插件内可独立拔插：写面边界（write-surface-boundary.ts）
//      与策展快照（curator.ts）即本节新增的两件门禁/台账件。
// 清单生成源 = engine/dsh-plugins/plugins.json（生成 package.json 的 description/sofagent/dsh 段与 cordis.patch.yml）；本文件的 seam 字面量由生成器 --check 与之对账。

import {
  createSofagentPlugin,
  seamHelpers,
  type SeamHandler,
  type SeamHelpers,
} from '@sofagent/dsh-plugin-kit';
import { guardWriteIntent, type WriteIntentVerdict } from './write-surface-boundary';

/** RSI 模块定位七项（manifest 声明面——测试对账用，单一来源即此处） */
export const RSI_MODULES = [
  '准入门',
  '晋级',
  '经验池',
  '考核',
  '写面审计',
  '能力基线',
  '透明仓',
] as const;

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
 * seam 事件处理器（v1.5.0 章十 · v1.5.9 章七扩写面窄化）——两个事件位的**实现**。
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
 *
 * 🔴 `fs/write-intent`（v1.5.9 章七）：写面权限窄化的**行为锁**——模型（被治理的执行
 *    模型）只能写 memory / skill 两类产物；策略 / 注入 / 路由 / 状态 / 审计历史属控制面，
 *    写入即拒（不调 next，返回 `{ kind: 'deny', reason }`，与 audit 插件 `tools/pre-execute`
 *    同构）。判定源 = 插件内 write-surface-boundary.guardWriteIntent（纯路径形态判定，
 *    不依赖引擎包，可独立拔插）。
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

  /**
   * 文件写入意图（宿主 waterfall；listener 约定 `(target, actor, next)`）。
   * 写面权限窄化：memory / skill 放行（调 next）；控制面 / 未分类落点拒绝（不调 next）。
   */
  'fs/write-intent': async (...args: unknown[]) => {
    const helpers = seamHelpers(args);
    const [target, actor, next] = args;
    if (typeof target !== 'string' || target === '') {
      logOnce(helpers, 'fs-write-intent-no-target', '写面窄化：写意图未带落点——按 fail-closed 拒绝');
      return { kind: 'deny', reason: '写面窄化：写意图未带落点（fail-closed）' };
    }
    const actorLabel = typeof actor === 'string' && actor !== '' ? actor : 'unknown-actor';
    const verdict: WriteIntentVerdict = guardWriteIntent(target, actorLabel);
    if (verdict.decision === 'deny') {
      helpers.log(`写面窄化拦截：${verdict.reason}（落点「${verdict.normalized}」，发起方「${actorLabel}」）`);
      return { kind: 'deny', reason: `sofagent 写面窄化：${verdict.reason}` };
    }
    return typeof next === 'function' ? await (next as () => unknown)() : undefined;
  },
};

/** 插件声明（本文件唯一手写处；适配层红线由 kit 承担：ctx 鸭子类型 + 宿主 API 缺席降级不抛） */
const kit = createSofagentPlugin(
  {
    id: 'cordis-plugin-sofagent-evolve',
    seam: 'session/event + fs/write-intent',
    seamSemantics:
      '会话事件流中的 Turn 结束（turn/end）→ 经验沉淀（think.md 反思） + 文件写入意图拦截（写面窄化：模型只写 memory / skill，控制面写入即拒）',
    capability: '进化能力（RSI 独立模块：准入门/晋级/经验池/考核/写面审计/能力基线/透明仓）',
    bridgePkg: '@sofagent/think',
    bridgeApi: 'generateThinkEntry',
    description:
      '进化面 RSI 独立模块——准入门/晋级/经验池/考核/写面审计/能力基线/透明仓；运行载体 = RSI 插件，沉淀留主干、审计链不受插件存废影响',
    seamHandlers,
  },
  require('../package.json') as { version?: string },
);

export const pluginMeta = kit.pluginMeta; // 插件元数据（DSH profile/注册表消费）
export const capability = kit.capability; // 依赖的 sofagent 能力说明（DSH skill 引导链展示）
export const invoke = kit.invoke; // 桥接 @sofagent/* 公共 API（懒加载 + 降级不抛）
export default kit.plugin; // DSH Cordis 插件契约（apply 三段式由 kit 提供）

// 治理件再导出（可在插件内独立拔插的门禁 / 台账——供消费方与测试直取）
export {
  MODEL_WRITABLE_SURFACES,
  CONTROL_PLANE_SURFACES,
  ControlPlaneWriteError,
  normalizeWriteTarget,
  classifyWriteTarget,
  isModelWritable,
  assertModelWritable,
  guardWriteIntent,
  type ModelWritableSurface,
  type ControlPlaneSurface,
  type WriteTargetClass,
  type WriteIntentVerdict,
} from './write-surface-boundary';
export {
  runCurator,
  snapshotSkillTree,
  archiveSkillItem,
  collectSkillMarkdown,
  isDisabledSkill,
  loadCuratorTrace,
  ARCHIVE_DIR_NAME,
  type CuratorRunResult,
  type CuratorArchiveAction,
  type CuratorOptions,
  type SkillSnapshotEntry,
  type SkillTreeSnapshot,
} from './curator';
