// ============================================================
// call-density.test.ts · v1.9.0 §五 调用密度计数器单测
// ============================================================
// 口径锁：串行与打包分报（合并即假象——devlog §五 原文「只报前者会把打包成效记成假象」）
// ============================================================
import { describe, it, expect } from 'vitest';
import { CallDensityCounter } from '../router/call-density';

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
