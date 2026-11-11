// ============================================================
// call-density.test.ts · v1.9.0 §五 调用密度计数器单测
// ============================================================
// 口径锁：串行与打包分报（合并即假象——devlog §五 原文「只报前者会把打包成效记成假象」）
// 第四棒①增量：生产埋点单例（attach/setTaskId/noteJudgeCall/report）四用例
// ============================================================
import { describe, it, expect, afterEach } from 'vitest';
import {
  CallDensityCounter,
  attachDensityCounter,
  setDensityTaskId,
  noteJudgeCall,
  productionDensityReport,
  resetDensityForTest,
} from '../router/call-density';

describe('v1.9.0 §五 · 判定调用密度计数器', () => {
  it('串行与打包分报（同任务两类计数互不覆盖）', () => {
    const c = new CallDensityCounter();
    c.recordSerial('t1');
    c.recordSerial('t1');
    c.recordBatch('t1', 5);
    const r = c.densityReport();
    const t1 = r.byTask.get('t1')!;
    expect(t1.serialCalls).toBe(2);
    expect(t1.batchRequests).toBe(1);
    expect(t1.questionsInBatches).toBe(5);
    expect(r.totalSerialCalls).toBe(2);
    expect(r.totalBatchRequests).toBe(1);
    expect(r.totalQuestions).toBe(7); // 2 串行 + 5 打包
  });

  it('多任务隔离 + 空计数器零读数', () => {
    const c = new CallDensityCounter();
    c.recordSerial('a');
    c.recordBatch('b', 3);
    const r = c.densityReport();
    expect(r.byTask.get('a')!.batchRequests).toBe(0);
    expect(r.byTask.get('b')!.serialCalls).toBe(0);
    const empty = new CallDensityCounter().densityReport();
    expect(empty.totalQuestions).toBe(0);
  });
});

describe('v1.9.0 §五-348 · 生产埋点单例（第四棒①）', () => {
  afterEach(() => resetDensityForTest());

  it('未挂计数器时 noteJudgeCall 静默（不抛错）且读数为 null', () => {
    resetDensityForTest();
    expect(() => noteJudgeCall(3)).not.toThrow();
    expect(productionDensityReport()).toBeNull();
  });

  it('单问 noteJudgeCall(1) 记串行、多问 noteJudgeCall(5) 记打包', () => {
    const c = new CallDensityCounter();
    attachDensityCounter(c, 't-prod');
    noteJudgeCall(1);
    noteJudgeCall(1);
    noteJudgeCall(5);
    const r = productionDensityReport()!;
    expect(r.totalSerialCalls).toBe(2);
    expect(r.totalBatchRequests).toBe(1);
    expect(r.totalQuestions).toBe(7);
  });

  it('setDensityTaskId 切任务分桶（按 taskId 分列）', () => {
    const c = new CallDensityCounter();
    attachDensityCounter(c, 'task/a');
    noteJudgeCall(1);
    setDensityTaskId('task/b');
    noteJudgeCall(3);
    const r = productionDensityReport()!;
    expect(r.byTask.get('task/a')!.serialCalls).toBe(1);
    expect(r.byTask.get('task/b')!.batchRequests).toBe(1);
  });

  it('零问调用按串行计（questionCount<=1 边界——空请求不进打包列）', () => {
    const c = new CallDensityCounter();
    attachDensityCounter(c);
    noteJudgeCall(0);
    const r = productionDensityReport()!;
    expect(r.totalSerialCalls).toBe(1);
    expect(r.totalBatchRequests).toBe(0);
  });
});
