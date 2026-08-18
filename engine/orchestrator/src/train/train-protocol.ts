// train-protocol.ts · v1.3.7 交付⑥ · 训练协议三约定（双栈契约）
//
// 背景：主流生产后训练框架（verl / TRL / NeMo RL / Oumi / open-instruct）2026 年
// 全部是 Python（PyTorch + CUDA 生态决定）。决策：双栈不可避免——
// 「Node 控制面 + Python 执行面」：编排/审计/生命周期/预算全在 Node，
// Python 只当被 spawn 的训练子进程（接口 = 进程参数 + JSON 事件 + 日志流）。
//
// 三个约定（接口即解耦 · 双栈的契约）：
//   ① 启动：Node → Python spawn——`python train.py --config <job.json>`，
//      参数收敛为一个 JSON 文件（数据路径 + 基座 + 算法 + 超参 + checkpoint +
//      产物目录 + 预算），Node 不传散参数。job.json 即训练任务完整快照，审计可读。
//   ② 回报：Python → Node stdout 事件流——只打 JSON 行
//      （progress/checkpoint/done/failed），Node 逐行解析更新状态。
//      禁止 print 非 JSON 文本（污染事件流）。
//   ③ 控制：Node → Python 信号——SIGINT → Python 存 checkpoint 优雅退出
//      （退出码 0）→ Node 记录断点 → 续跑从断点恢复。
//      硬杀（SIGKILL）仅限沙箱超时兜底。
//
// 协议即版本边界：v1.4.1 定稿后不可随意增删字段，新增字段走 schema version；
// job.json schema 向后兼容最近 3 个版本，breaking change 走 migrate 子命令 + 人审。

import { z } from 'zod';

// ════════════════════════════════════════
// 约定①：job.json schema（启动——Node → Python）
// ════════════════════════════════════════

/** 训练预算字段（交付⑦——写入 job.json，与协议同源） */
export const TrainBudgetSchema = z
  .object({
    /** 时间预算上限（分钟） */
    maxMinutes: z.number().positive().optional(),
    /** 训练步数上限 */
    maxSteps: z.number().int().positive().optional(),
    /** 估算算力成本上限（与模型网关预算控制同口径） */
    maxCost: z.number().positive().optional(),
  })
  .strict();

/** job.json schema——训练任务的完整快照（审计可读） */
export const TrainJobSchema = z
  .object({
    /** schema 版本（协议即版本边界——新增字段升版本号） */
    schemaVersion: z.literal('v1'),
    /** 训练任务标识（审计关联键） */
    jobId: z.string().min(1),
    /** 数据路径（训练集） */
    dataPath: z.string().min(1),
    /** 基座模型（企业专属模型 / 开源基座） */
    baseModel: z.string().min(1),
    /** 训练算法（SFT / GRPO / DPO 等主流生产框架算法） */
    algorithm: z.enum(['sft', 'grpo', 'dpo']),
    /** 超参（透传训练框架——Node 不解释具体键） */
    hyperparams: z.record(z.string(), z.unknown()).default({}),
    /** checkpoint 路径（断点恢复——约定③） */
    checkpointPath: z.string().min(1),
    /** 产物目录（模型 / 日志 / 报告落点） */
    outputDir: z.string().min(1),
    /** 预算（交付⑦横切——超预算 SIGINT 暂停 + 人审） */
    budget: TrainBudgetSchema.optional(),
    /** 续跑断点（约定③——SIGINT 存 checkpoint 后记录，续跑从断点恢复） */
    resumeFrom: z
      .object({
        checkpointPath: z.string().min(1),
        step: z.number().int().nonnegative(),
      })
      .optional(),
  })
  .strict();

export type TrainBudget = z.infer<typeof TrainBudgetSchema>;
export type TrainJob = z.infer<typeof TrainJobSchema>;

/** job.json 校验结果（对齐 workflow_submit 的结构化错误模式） */
export interface TrainJobValidation {
  valid: boolean;
  job?: TrainJob;
  /** 结构化错误（校验失败拒绝 spawn——对齐本版 workflow_submit 模式） */
  issues?: string[];
}

/**
 * 校验 job.json（zod）——校验失败拒绝 spawn，返回结构化错误。
 */
export function validateTrainJob(raw: unknown): TrainJobValidation {
  const result = TrainJobSchema.safeParse(raw);
  if (!result.success) {
    return {
      valid: false,
      issues: result.error.issues.map(
        (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
      ),
    };
  }
  return { valid: true, job: result.data };
}

/**
 * 构造约定①的 spawn 命令参数——`python train.py --config <job.json>`。
 * 参数收敛为一个 JSON 文件，Node 不传散参数。
 */
export function buildTrainSpawnArgs(jobJsonPath: string, trainScript = 'train.py'): string[] {
  return [trainScript, '--config', jobJsonPath];
}

// ════════════════════════════════════════
// 约定②：stdout 事件流（回报——Python → Node）
// ════════════════════════════════════════

/** Python stdout 事件类型（只打 JSON 行——禁止 print 非 JSON 文本） */
export type TrainEvent =
  | { type: 'progress'; step: number; loss?: number; reward?: number }
  | { type: 'checkpoint'; path: string; step: number }
  | { type: 'done'; reason?: string }
  | { type: 'failed'; reason: string };

/** 事件行解析结果（坏行不崩溃——错误容忍） */
export interface TrainEventParseResult {
  event?: TrainEvent;
  /** 解析失败原因（null = 解析成功） */
  error?: string;
  /** 原始行（审计留痕用） */
  rawLine: string;
}

/**
 * 解析一行 stdout JSON 事件（约定②）。
 *
 * 协议错误容忍：一行解析失败 → 返回 error（调用方记 train_protocol_error
 * 审计事件）+ 尝试续解析下一行，不整体崩溃（容忍训练库的 warn 输出）。
 */
export function parseTrainEvent(line: string): TrainEventParseResult {
  const trimmed = line.trim();
  const rawLine = line;

  if (trimmed === '') {
    return { rawLine }; // 空行静默跳过（不计错误）
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { error: 'JSON 解析失败', rawLine };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { error: '事件不是 JSON 对象', rawLine };
  }
  const obj = parsed as Record<string, unknown>;

  switch (obj.type) {
    case 'progress': {
      const step = obj.step;
      if (typeof step !== 'number') return { error: 'progress 缺 step（number）', rawLine };
      const event: TrainEvent = { type: 'progress', step };
      if (typeof obj.loss === 'number') event.loss = obj.loss;
      if (typeof obj.reward === 'number') event.reward = obj.reward;
      return { event, rawLine };
    }
    case 'checkpoint': {
      if (typeof obj.path !== 'string' || typeof obj.step !== 'number') {
        return { error: 'checkpoint 缺 path/step', rawLine };
      }
      return { event: { type: 'checkpoint', path: obj.path, step: obj.step }, rawLine };
    }
    case 'done': {
      const event: TrainEvent = { type: 'done' };
      if (typeof obj.reason === 'string') event.reason = obj.reason;
      return { event, rawLine };
    }
    case 'failed': {
      if (typeof obj.reason !== 'string') {
        return { error: 'failed 缺 reason（string）', rawLine };
      }
      return { event: { type: 'failed', reason: obj.reason }, rawLine };
    }
    default:
      return { error: `未知事件类型 "${String(obj.type)}"`, rawLine };
  }
}

/**
 * 逐行解析 stdout 流（约定②完整消费——坏行收集不中断）。
 * @returns 事件列表 + 坏行列表（坏行进 train_protocol_error 审计）
 */
export function parseTrainEventStream(lines: string[]): {
  events: TrainEvent[];
  errors: TrainEventParseResult[];
} {
  const events: TrainEvent[] = [];
  const errors: TrainEventParseResult[] = [];
  for (const line of lines) {
    const result = parseTrainEvent(line);
    if (result.event) events.push(result.event);
    else if (result.error) errors.push(result);
  }
  return { events, errors };
}

// ════════════════════════════════════════
// 约定③：信号控制（Node → Python）
// ════════════════════════════════════════

/** 信号控制决策 */
export type SignalAction =
  | { action: 'sigint' } // 优雅退出：存 checkpoint，退出码 0
  | { action: 'sigkill'; reason: string } // 硬杀兜底（超时/卡死）
  | { action: 'noop' }; // 进程已退出，无需信号

/**
 * 信号控制器（约定③ + 协议错误处理）。
 *
 * SIGINT → Python 捕获后存 checkpoint 优雅退出（退出码 0）→ Node 记录断点。
 * SIGINT 后超时（默认 30s）未退出 → 升级 SIGKILL + 记审计（进程卡死兜底）。
 *
 * 进程操作（kill/isAlive）经注入传入——测试零真实进程。
 */
export interface SignalControllerOptions {
  /** 发送信号（默认 process.kill） */
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  /** 进程存活探测（默认 process.kill(pid, 0) 不抛错即存活） */
  isAlive?: (pid: number) => boolean;
  /** SIGINT 超时（ms，默认 30000） */
  sigintTimeoutMs?: number;
}

export interface SignalController {
  /**
   * 优雅停止：先 SIGINT，超时未退出升级 SIGKILL。
   * @returns 最终执行的动作（审计留痕用）
   */
  gracefulStop(pid: number): Promise<SignalAction>;
}

export function createSignalController(opts: SignalControllerOptions = {}): SignalController {
  const kill =
    opts.kill ??
    ((pid: number, signal: NodeJS.Signals) => {
      process.kill(pid, signal);
    });
  const isAlive =
    opts.isAlive ??
    ((pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });
  const timeoutMs = opts.sigintTimeoutMs ?? 30_000;

  return {
    async gracefulStop(pid: number): Promise<SignalAction> {
      if (!isAlive(pid)) {
        return { action: 'noop' }; // 进程已退出——无需信号
      }

      kill(pid, 'SIGINT');

      // 轮询等待优雅退出（短间隔探测，避免忙等）
      const pollInterval = 200;
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, pollInterval));
        if (!isAlive(pid)) {
          return { action: 'sigint' }; // 优雅退出成功
        }
      }

      // SIGINT 超时未退出 → 升级 SIGKILL（进程卡死兜底 + 记审计由调用方做）
      kill(pid, 'SIGKILL');
      return {
        action: 'sigkill',
        reason: `SIGINT 后 ${timeoutMs}ms 未退出，升级 SIGKILL（进程卡死兜底）`,
      };
    },
  };
}
