// cordis-plugin-sofagent-audit · DSH 反向插件（v1.5.1 P2 合并批：吸收原 -gate 验收门禁面）
// seam 挂载：tools/result + tools/pre-execute + fs/write-intent + agent/turn-stopping
// # 语义：工具结果留证 + 工具执行前拦截 + 文件写入意图拦截（放行） + Turn 停止验收判定
//   （判定源 = checkDangerousCommand / check_acceptance——引擎包既有 @public，零改动）
// v1.5.1 第七章：`tools/pre-execute` / `tools/result` 两个 seamHandler 追加**调用意图留痕**
//   （@sofagent/audit.createIntentChannel → <dataDir>/audit/intent.jsonl），审计输入面由此
//   从 git diff 单通道扩为双通道。该面**零执行权限**：只读消费宿主事件 + 落盘，不参与判定、
//   不碰 next、无 deny/allow 语义（拦截能力仍归上述判定源与宿主事件位，本插件未新增）。
//   身份不可达（exec 无 agent/session）时**调用证据跳过**，但「跳过」本身落
//   `<dataDir>/audit/intent-skips.jsonl`（进盘不进链）——跳失可审计，不是黑洞。
// 清单生成源 = engine/dsh-plugins/plugins.json（生成 package.json 的 description/sofagent/dsh 段与 cordis.patch.yml）；本文件的 seam 字面量由生成器 --check 与之对账。
//
// v1.5.0 P2 吸收说明（F3）：原 -gate 独立承载 agent/turn-stopping 验收门禁，但其
// 判定源（define_acceptance / check_acceptance 两 MCP tool）与 -audit 同族（机器可判定
// 审计），拆两包造成「审计归 audit、验收归 gate」的人为割裂。本插件把验收 seam 并入
// 四值声明，settings 补 acceptanceGate 独立开关（默认开；关档即不参与 Turn 停止判定——
// 与 F2 分档同语义：档位是 settings 字段，不另造判定源）。

import {
  createSofagentPlugin,
  seamHelpers,
  type SeamHandler,
  type SeamHelpers,
} from '@sofagent/dsh-plugin-kit';

// ── 事件接线共用的环境解析与防御式取数 ────────────────────────────────────────
// 适配层红线：只做鸭子类型读取，宿主/引擎面缺席一律降级不抛——接线故障不得
// 升级成任务故障（handler 内所有失败路径都 fail-open + 可见日志）。

/** 项目根：显式环境变量优先，缺省取宿主进程工作目录（与 CLI/MCP 侧同口径） */
const projectRoot = (): string => process.env.SOFAGENT_PROJECT_ROOT ?? process.cwd();

/** 数据目录：交给 @sofagent/core 自己的解析（与 MCP/CLI 同源），不可达则交引擎兜底 */
async function resolveDataDir(helpers: SeamHelpers): Promise<string | undefined> {
  try {
    const dir = await helpers.call('@sofagent/core', 'getDataDir');
    return typeof dir === 'string' && dir !== '' ? dir : undefined;
  } catch (err) {
    helpers.log(`数据目录解析不可用（交引擎默认值）：${errMsg(err)}`);
    return undefined;
  }
}

/** 从宿主工具执行对象取命令字符串（仅命令类工具的入参带 `command`） */
function commandOf(exec: unknown): string | null {
  const args = (exec as { arguments?: unknown } | null | undefined)?.arguments;
  if (args === null || typeof args !== 'object') return null;
  const cmd = (args as Record<string, unknown>).command;
  return typeof cmd === 'string' && cmd.trim() !== '' ? cmd : null;
}

/** 留证所需的身份：从宿主 exec 上尽力取 (agentId, sessionId)，取不到即放弃留证 */
function identityOf(exec: unknown): { agentId: string; sessionId: string } | null {
  const agent = (exec as { agent?: unknown } | null | undefined)?.agent as
    | { id?: unknown; session?: { id?: unknown; header?: { id?: unknown } } }
    | undefined;
  const agentId = typeof agent?.id === 'string' ? agent.id : '';
  const rawSessionId = agent?.session?.id ?? agent?.session?.header?.id;
  const sessionId = typeof rawSessionId === 'string' ? rawSessionId : '';
  return agentId !== '' && sessionId !== '' ? { agentId, sessionId } : null;
}

/** 一次性日志表——接线自证与降级提示只打一次，避免按事件刷屏 */
const loggedOnce = new Set<string>();
function logOnce(helpers: SeamHelpers, key: string, message: string): void {
  if (loggedOnce.has(key)) return;
  loggedOnce.add(key);
  helpers.log(message);
}

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Turn 停止判定的防重表：每 (agent, turn) 至多续跑一次。
 * 必要性：宿主在每一步收尾都会再派发 `agent/turn-stopping`，若验收始终不过而
 * 每次都续跑，Turn 会被拉成无限循环——本表把它约束成「每 turn 一次」。
 */
const lastSteeredTurn = new WeakMap<object, unknown>();

/**
 * 跳失留证（v1.5.1 第七章收口）——**「跳过」本身必须可审计**。
 *
 * 为什么不能只打一行日志：日志随进程消失，而「这个宿主上意图通道到底记了几次、
 * 跳了几次、为什么跳」恰恰是**事后**（进程重启过 / 换过机器 / 翻旧账）才要问的
 * 问题——只打日志等于把答案交给运气（日志没人收就没了）。故跳失落盘
 * `<dataDir>/audit/intent-skips.jsonl`（**进盘不进链**：它是通道活性证据，
 * 不是调用证据，不做完整性声明），配 `@sofagent/audit.summarizeIntentChannel`
 * 即可**只读盘**回答上述问题。
 *
 * 隔离纪律：本函数同样只在**身份不可达**时被调用（见 recordIntent 的门），
 * 故正常运行的生产宿主不会产生跳失记录；出现记录 = 宿主身份接线有问题。
 *
 * 🔴 失败一律 fail-open + 可见日志：留证故障不得升级为宿主工具调用故障。
 */
async function recordIntentSkipEvidence(helpers: SeamHelpers, event: string, exec: unknown): Promise<void> {
  logOnce(
    helpers,
    'intent-no-identity',
    '意图留证：宿主 exec 未带 agent/session 标识——调用证据跳过（不猜测身份），跳失已落盘留证',
  );
  const name = (exec as { name?: unknown } | null | undefined)?.name;
  try {
    await helpers.call('@sofagent/audit', 'recordIntentSkip', await resolveDataDir(helpers), {
      reason: 'identity-unreachable',
      event,
      ...(typeof name === 'string' && name !== '' ? { tool: name } : {}),
    });
  } catch (err) {
    logOnce(
      helpers,
      'intent-skip-evidence-failed',
      `意图跳失留证写入失败（本次跳过只剩日志，不阻断宿主）：${errMsg(err)}`,
    );
  }
}

/**
 * 调用意图留痕（v1.5.1 第七章·审计输入双通道）——**零执行权限**：
 * 只读消费宿主事件 + 落盘留痕，不参与任何判定、不碰 `next`、不产生 deny/allow 语义
 * （拦截能力仍归上面两个判定源，本函数不拥有也未新增拦截面）。
 *
 * 身份纪律与既有 `tools/result` 留证同款：exec 不带 agent/session ⇒ **跳过**（身份不可达，
 * 不猜测）——不可归因的意图条目对审计没有价值；该纪律同时保证无身份载荷（宿主替身 /
 * 尚未接入身份的宿主）不触发**调用证据**落盘。跳过的**事实**另落 `intent-skips.jsonl`
 * （`recordIntentSkipEvidence`），故「跳过」可审计、不是黑洞。
 *
 * 通道实例按进程惰性创建一次（内建单例）；**任何失败一律 fail-open** + 可见日志——
 * 留痕故障不得升级为宿主工具调用故障（对齐本文件既有接线红线）。
 */
type IntentChannelLike = { handle: (event: string, args: unknown[]) => void };
let intentChannel: IntentChannelLike | null | undefined;

async function recordIntent(
  helpers: SeamHelpers,
  event: string,
  exec: unknown,
  result?: unknown,
): Promise<void> {
  if (identityOf(exec) === null) {
    await recordIntentSkipEvidence(helpers, event, exec);
    return;
  }
  try {
    if (intentChannel === undefined) {
      const dataDir = await resolveDataDir(helpers);
      const created = await helpers.call(
        '@sofagent/audit',
        'createIntentChannel',
        dataDir === undefined ? {} : { dataDir },
      );
      const candidate = created as IntentChannelLike | null | undefined;
      intentChannel =
        candidate !== null && candidate !== undefined && typeof candidate.handle === 'function'
          ? candidate
          : null;
      if (intentChannel === null) {
        logOnce(
          helpers,
          'intent-channel-missing',
          '意图通道不可用（@sofagent/audit 未导出 createIntentChannel）——意图留痕停用，不阻断宿主',
        );
      }
    }
    intentChannel?.handle(event, [exec, result]);
  } catch (err) {
    logOnce(helpers, 'intent-record-failed', `意图留痕写入失败（不阻断宿主工具调用）：${errMsg(err)}`);
  }
}

/**
 * seam 事件处理器（v1.5.0 章十）——四个事件位的**实现**（此前只有声明）。
 *
 * 🔴 判定逻辑零改动：全部判定都来自引擎包既有 @public API
 *    （`checkDangerousCommand` / `checkAcceptance`），插件层只负责接管子 + 转形状。
 * 🔴 失败一律 fail-open：判定源不可达时放行 + 打可见日志，绝不把接线故障
 *    变成工具执行失败或 Turn 中止。
 */
const seamHandlers: Record<string, SeamHandler> = {
  /**
   * 工具执行前——宿主 waterfall（listener 约定 `(exec, next)`，不调 next 即否决）。
   * 判定源 = `@sofagent/orchestrator.checkDangerousCommand`（与 sofagent 自家运行时
   * `wrapToolsWithGate` 同源，故 DSH 侧与自家运行时的拦截口径一致）。
   */
  'tools/pre-execute': async (...args: unknown[]) => {
    const helpers = seamHelpers(args);
    const [exec, next] = args;
    const cont = async (): Promise<unknown> =>
      typeof next === 'function' ? await (next as () => unknown)() : undefined;
    // v1.5.1 第七章：意图留痕先于命令类判定（非命令类工具的意图同样在参数里：
    // 写文件落点 / 外发 host），且**先于拦截**——被拒的操作也留痕。零执行权限：
    // 本调用不改本 handler 的返回语义（下方放行/拦截分支逐字不变）。
    await recordIntent(helpers, 'tools/pre-execute', exec);
    const command = commandOf(exec);
    if (command === null) return await cont(); // 非命令类工具不参与判定（不改变既有语义）
    try {
      const reason = await helpers.call('@sofagent/orchestrator', 'checkDangerousCommand', command);
      if (typeof reason === 'string' && reason !== '') {
        helpers.log(`工具执行前拦截：${reason}`);
        return { kind: 'deny', reason: `sofagent 工具门禁：${reason}` };
      }
    } catch (err) {
      logOnce(
        helpers,
        'pre-execute-unavailable',
        `工具执行前判定不可用（本次放行，不阻断宿主工具执行）：${errMsg(err)}`,
      );
    }
    return await cont();
  },

  /**
   * 工具结果留证——宿主 emit（listener 约定 `(exec, result)`，返回值无意义）。
   * 留证口径：**只留失败结果**（被门禁拦下的调用、工具自身报错）——成功结果已由
   * 宿主 session 日志承担，全量落库只会给决策日志灌入与判定无关的噪声。
   */
  'tools/result': async (...args: unknown[]) => {
    const helpers = seamHelpers(args);
    const [exec, result] = args;
    // v1.5.1 第七章：结果入意图通道（与 pre-execute 的意图条目同链留痕、条目类型可区分）
    // ——先于下方「只留失败结果」的留证过滤：结果通道要的是**全部**调用的结果。
    await recordIntent(helpers, 'tools/result', exec, result);
    if ((result as { isError?: unknown } | null | undefined)?.isError !== true) return;
    const id = identityOf(exec);
    if (id === null) {
      logOnce(
        helpers,
        'result-no-identity',
        '工具结果留证：宿主 exec 未带 agent/session 标识——留证跳过（身份不可达，不猜测）',
      );
      return;
    }
    const info = exec as { name?: unknown; callId?: unknown } | null | undefined;
    try {
      await helpers.call(
        '@sofagent/audit',
        'emitDecision',
        {
          agentId: id.agentId,
          sessionId: id.sessionId,
          kind: 'TOOL_GATE',
          moment: 'ACT',
          category: 'skip',
          why: `工具结果留证：${typeof info?.name === 'string' && info.name !== '' ? info.name : '未知工具'} 返回错误`,
          artifactRef:
            typeof info?.callId === 'string' && info.callId !== '' ? `tool-call/${info.callId}` : undefined,
        },
        await resolveDataDir(helpers),
      );
    } catch (err) {
      logOnce(helpers, 'result-emit-failed', `工具结果留证写入失败（不阻断宿主）：${errMsg(err)}`);
    }
  },

  /**
   * 文件写入意图——宿主 waterfall（listener 约定 `(target, actor, next)`）。
   * 🔴 本事件位当前是**放行接线**：sofagent 引擎包没有「按目标路径判定写意图」的
   *    @public 判定源，按马鞍铁律（只接线、不新造判定）不做触发式拦截——
   *    订阅真实、disposer 真实、装载状态可自证，但不假装有判定。
   */
  'fs/write-intent': async (...args: unknown[]) => {
    const helpers = seamHelpers(args);
    const next = args[2]; // waterfall 约定 (target, actor, next)
    logOnce(
      helpers,
      'fs-write-intent-passthrough',
      '文件写入意图事件已接线（放行——引擎侧无「按路径判定写意图」的既有 API，不为接线新造判定）',
    );
    return typeof next === 'function' ? await (next as () => unknown)() : undefined;
  },

  /**
   * Turn 停止验收判定——宿主 serial（listener 约定 `(payload)`，payload 含
   * `{ agent, turn, signal }`）。判定源 = `@sofagent/orchestrator.checkAcceptance`。
   *
   * 「验收不过不放行」的机制：宿主在该事件上**不使用返回值**，真正能续跑 Turn 的
   * 唯一手段是向 agent 送一条消息（宿主 Stop hook 同法：`agent.steer(...)`），
   * 宿主随后复查 inbox 决定是否继续。故本 handler 走 `agent.steer`。
   *
   * 🔴 三重保险，避免把「接上验收」变成「Turn 打不住」：
   *    ① 未定义验收（failedCount = -1）不拦——「没有验收定义」≠「验收不过」；
   *    ② 每 (agent, turn) 至多续跑一次；
   *    ③ 全程 fail-open：判定源 / 消息工厂 / steer 任一不可用只记日志，不抛。
   */
  'agent/turn-stopping': async (...args: unknown[]) => {
    const helpers = seamHelpers(args);
    const [payload] = args;
    if (helpers.flags().acceptanceGate === false) return; // 关档：不参与 Turn 停止判定
    const taskId = (process.env.SOFAGENT_TASK_ID ?? '').trim();
    if (taskId === '') return; // 无任务标识 → 无验收可判（不凭空阻断收尾）
    let verdict: unknown;
    try {
      verdict = await helpers.call(
        '@sofagent/orchestrator',
        'checkAcceptance',
        (await resolveDataDir(helpers)) ?? '',
        taskId,
        projectRoot(),
      );
    } catch (err) {
      logOnce(helpers, 'turn-stopping-unavailable', `Turn 停止验收判定不可用（不拦截本次停止）：${errMsg(err)}`);
      return;
    }
    const v = (verdict ?? {}) as { ok?: unknown; failedCount?: unknown };
    if (v.ok !== false || typeof v.failedCount !== 'number' || v.failedCount <= 0) return;
    const p = (payload ?? {}) as { agent?: unknown; turn?: unknown };
    const agent = p.agent as { steer?: unknown } | null | undefined;
    if (agent === null || agent === undefined || typeof agent.steer !== 'function') {
      logOnce(
        helpers,
        'turn-stopping-no-steer',
        'Turn 停止验收未通过，但宿主 agent 无 steer 面——本次无法续跑（记日志，不异常）',
      );
      return;
    }
    if (lastSteeredTurn.get(agent as object) === p.turn) return; // ② 每 turn 至多一次
    lastSteeredTurn.set(agent as object, p.turn);
    try {
      const message = await helpers.call('@deepseek-ai/dsh-llm', 'createUserMessage', {
        content: [
          { type: 'text', text: `sofagent 验收未通过（${v.failedCount} 条未达）——先修完再收尾。` },
        ],
        source: { kind: 'plugin', plugin: 'sofagent-audit' },
      });
      (agent.steer as (m: unknown) => unknown)(message);
      helpers.log(
        `Turn 停止验收未通过（${v.failedCount} 条）——已向宿主 agent 续跑一条修正指令（本 turn 内至多一次）`,
      );
    } catch (err) {
      logOnce(helpers, 'turn-stopping-steer-failed', `验收续跑指令构造失败（不拦截本次停止）：${errMsg(err)}`);
    }
  },
};

/** 插件声明（本文件唯一手写处；适配层红线由 kit 承担：ctx 鸭子类型 + 宿主 API 缺席降级不抛） */
const kit = createSofagentPlugin(
  {
    id: 'cordis-plugin-sofagent-audit',
    seam: 'tools/result + tools/pre-execute + fs/write-intent + agent/turn-stopping',
    seamSemantics: '工具结果留证 + 工具执行前拦截 + 文件写入意图拦截（放行） + Turn 停止验收判定（v1.4.9 P2 吸收原 -gate 验收门禁；判定源 = checkDangerousCommand/check_acceptance，不另造）',
    capability: '审计与验收（git diff 硬证据 + 24 规则 + 机器可判定验收）',
    bridgePkg: '@sofagent/audit',
    bridgeApi: 'runRules',
    description: '变更机器审阅 + 验收硬门禁——24 规则 + git diff 硬证据 + Turn 停止验收判定（验收不过不放行，开关独立可关）',
    // audit 专属 envelope（其余插件走 kit 默认值）
    purpose: 'sofagent 审计插件——24 规则 + git diff 硬证据 + 验收门禁',
    readyMessage: '审计与验收服务就绪（24 规则 + Turn 停止验收）',
    // v1.4.9 P2（F3）：rules 为既有字段；acceptanceGate = 验收门禁独立开关（默认 'true' 开）——
    // 关档即本插件的 agent/turn-stopping 面不参与 Turn 停止判定（审计三 seam 不受影响）
    settingsExtra: { rules: '24', acceptanceGate: 'true' },
    seamHandlers,
  },
  require('../package.json') as { version?: string },
);

export const pluginMeta = kit.pluginMeta; // 插件元数据（DSH profile/注册表消费）
export const capability = kit.capability; // 依赖的 sofagent 能力说明（DSH skill 引导链展示）
export const invoke = kit.invoke; // 桥接 @sofagent/* 公共 API（懒加载 + 降级不抛）
export default kit.plugin; // DSH Cordis 插件契约（apply 三段式由 kit 提供）
