// cordis-plugin-sofagent-rollback · DSH 反向插件（v1.5.1：98 行样板收敛到 @sofagent/dsh-plugin-kit）
// seam 挂载：agent/error    # 语义：Agent 出错 → git snapshot 逆序撤销（默认关档）
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

/** 项目根：显式环境变量优先，缺省取宿主进程工作目录 */
const projectRoot = (): string => process.env.SOFAGENT_PROJECT_ROOT ?? process.cwd();

/**
 * seam 事件处理器（v1.5.0 章十）——`agent/error` 的**实现**（此前只有声明）。
 *
 * 宿主契约：emit 派发，listener 约定 `(payload)`，payload 含 `{ agent, turn, step, error }`；
 * 返回值无意义（观察位）。
 *
 * 🔴 **默认关档**（settings `rollbackOnError = 'false'`）：自动撤销工作区是破坏性
 *    动作，接线本身不应改变既有行为——要恢复就必须显式开档。关档时本事件位仍
 *    真实订阅（装载状态可自证），只是不动作。
 * 🔴 判定逻辑零改动：快照定位与恢复都是既有 @public API（`listSnapshots` /
 *    `restoreSnapshot`），插件只做串联；快照序为追加序，「末尾即最新」。
 */
const seamHandlers: Record<string, SeamHandler> = {
  'agent/error': async (...args: unknown[]) => {
    const helpers = seamHelpers(args);
    if (helpers.flags().rollbackOnError !== true) {
      logOnce(
        helpers,
        'error-rollback-disarmed',
        'Agent 出错事件已接线；自动回滚档位关闭（rollbackOnError=false）——不撤销工作区（默认关，避免误伤未提交变更）',
      );
      return;
    }
    try {
      const root = projectRoot();
      const snapshots = await helpers.call('@sofagent/core', 'listSnapshots', root);
      if (!Array.isArray(snapshots) || snapshots.length === 0) {
        logOnce(helpers, 'error-no-snapshot', 'Agent 出错但无可用快照——不撤销（先跑一次审计才会建快照）');
        return;
      }
      const latest = snapshots[snapshots.length - 1] as { sha?: unknown };
      if (typeof latest?.sha !== 'string' || latest.sha === '') return;
      const restored = await helpers.call('@sofagent/core', 'restoreSnapshot', root, latest.sha);
      helpers.log(
        `出错逆序撤销：已恢复到快照 ${latest.sha.slice(0, 8)}（${Array.isArray(restored) ? restored.length : 0} 个文件）`,
      );
    } catch (err) {
      logOnce(helpers, 'error-rollback-failed', `快照回滚失败（不阻断宿主错误处理）：${errMsg(err)}`);
    }
  },
};

/** 插件声明（本文件唯一手写处；适配层红线由 kit 承担：ctx 鸭子类型 + 宿主 API 缺席降级不抛） */
const kit = createSofagentPlugin(
  {
    id: 'cordis-plugin-sofagent-rollback',
    seam: 'agent/error',
    seamSemantics: 'Agent 出错 → git snapshot 逆序撤销（默认关档，需显式开 rollbackOnError）',
    capability: '快照回溯（出事一键回滚）',
    bridgePkg: '@sofagent/core',
    bridgeApi: 'restoreSnapshot',
    description: '出错逆序撤销——git snapshot → effect disposer',
    // 默认关：自动撤销工作区是破坏性动作，接线不改变既有行为
    settingsExtra: { rollbackOnError: 'false' },
    seamHandlers,
  },
  require('../package.json') as { version?: string },
);

export const pluginMeta = kit.pluginMeta; // 插件元数据（DSH profile/注册表消费）
export const capability = kit.capability; // 依赖的 sofagent 能力说明（DSH skill 引导链展示）
export const invoke = kit.invoke; // 桥接 @sofagent/* 公共 API（懒加载 + 降级不抛）
export default kit.plugin; // DSH Cordis 插件契约（apply 三段式由 kit 提供）
