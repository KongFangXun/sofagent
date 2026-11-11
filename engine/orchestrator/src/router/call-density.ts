// ============================================================
// call-density.ts · v1.9.0 §五 判定调用密度计数器（随行口径的观测面）
// ============================================================
// devlog §五「第四方对照口径·五」：调用密度（每任务判定次数）当前
// not-measured——补测法 =「decision-dispatch 出口按 taskId 计数，串行
// 调用与打包请求分报」。本文件是该补测法的最小观测件：
//   recordSerial(taskId)   串行单问调用 +1
//   recordBatch(taskId, questions) 打包请求 +1 且计批内问句数
//   densityReport()        按 taskId 出 { serialCalls, batchRequests, questionsInBatches, totalQuestions }
//
// 定位：**只观测不阻断**（与 §六 探针族同纪律）；进程内计数（无落盘——
// 采集面属后续真实任务链回放，本件先给计数器与口径，读数随真实使用产生）。
// ============================================================

export interface TaskCallDensity {
  taskId: string;
  /** 串行调用次数（单问单请求） */
  serialCalls: number;
  /** 打包请求次数（一次请求多问） */
  batchRequests: number;
  /** 打包请求携带的问句总数 */
  questionsInBatches: number;
}

/** 总读数（串行+打包并列——devlog 口径：只报串行会把打包成效记成假象） */
export interface DensityReport {
  byTask: Map<string, TaskCallDensity>;
  totalSerialCalls: number;
  totalBatchRequests: number;
  totalQuestions: number;
}

export class CallDensityCounter {
  private readonly byTask = new Map<string, TaskCallDensity>();

  private entry(taskId: string): TaskCallDensity {
    let e = this.byTask.get(taskId);
    if (!e) {
      e = { taskId, serialCalls: 0, batchRequests: 0, questionsInBatches: 0 };
      this.byTask.set(taskId, e);
    }
    return e;
  }

  /** 串行单问调用（一次请求一问） */
  recordSerial(taskId: string): void {
    this.entry(taskId).serialCalls += 1;
  }

  /** 打包请求（一次请求 N 问） */
  recordBatch(taskId: string, questions: number): void {
    const e = this.entry(taskId);
    e.batchRequests += 1;
    e.questionsInBatches += questions;
  }

  /** 汇总读数（串行与打包分报） */
  densityReport(): DensityReport {
    let totalSerialCalls = 0;
    let totalBatchRequests = 0;
    let totalQuestions = 0;
    for (const e of this.byTask.values()) {
      totalSerialCalls += e.serialCalls;
      totalBatchRequests += e.batchRequests;
      totalQuestions += e.questionsInBatches + e.serialCalls;
    }
    return { byTask: new Map(this.byTask), totalSerialCalls, totalBatchRequests, totalQuestions };
  }
}

// ============================================================
// §五-348 生产埋点单例（v1.9.0 第四棒①）——judge-mode 同款模块级单例。
// 判定调用出口（JudgeRuntime.judge）按打包决策分报：
//   单问（questions.length === 1）→ recordSerial(taskId)
//   多问打包（questions.length > 1）→ recordBatch(taskId, N)
// taskId 取调用方注入（缺省 'unnamed-task'——生产建议注入真实任务 id）。
// 只观测不阻断（计数失败不影响判定主链路）；观测面 best-effort。
// ============================================================

let productionCounter: CallDensityCounter | null = null;
let currentTaskId = 'unnamed-task';

/** 挂生产密度计数器（唯一写口——挂上即开始计数） */
export function attachDensityCounter(counter: CallDensityCounter, taskId?: string): void {
  productionCounter = counter;
  if (taskId) currentTaskId = taskId;
}

/** 设置当前任务 id（任务链切换时调用——按任务分桶的键） */
export function setDensityTaskId(taskId: string): void {
  currentTaskId = taskId;
}

/** 判定出口喂点（JudgeRuntime.judge 调用——单问串行 / 多问打包分报） */
export function noteJudgeCall(questionCount: number): void {
  if (!productionCounter) return;
  if (questionCount <= 1) productionCounter.recordSerial(currentTaskId);
  else productionCounter.recordBatch(currentTaskId, questionCount);
}

/** 读生产密度读数（唯一读口——未挂计数器返回 null） */
export function productionDensityReport(): DensityReport | null {
  return productionCounter ? productionCounter.densityReport() : null;
}

/** 测试复位 */
export function resetDensityForTest(): void {
  productionCounter = null;
  currentTaskId = 'unnamed-task';
}
