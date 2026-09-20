// ============================================================
// error-localizer-outlet.test.ts · 第三章出口接线测试（v1.5.1）
// ============================================================
//
// 覆盖：既有节点内兜底出口接异常总线——**只改出口，分类逻辑零改动**。
//   1. LLM 调用失败 → 降级启发式（分类结果与改动前一致）+ 出口上报
//   2. LLM 返回不可解析 → 同上
//   3. 未注入 onDegrade 时走默认异常总线（异常进总线即写 decision-log）
//   4. 正常路径（无差异 / LLM 可用且可解析）不上报（上报面只覆盖真实异常出口）
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { type DecisionLogEntry } from '@sofagent/audit';
import { getDecisionLogPath } from '@sofagent/core';

import { localizeError, type LocalizationContext } from '../loop-agent/error-localizer';
import { emptyDiffReport, type DiffReport } from '../loop-agent/diff-report';
import { EventBus } from '../events/bus';
import { AnomalyBus, setDefaultAnomalyBus } from '../events/error-bus';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-localizer-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** 有差异的 L2 报告（value_error 占主导 → 启发式归因 prompt，用于核实分类逻辑未变） */
function mismatchReport(): DiffReport {
  const report = emptyDiffReport();
  report.mismatches.push(
    { type: 'value_error', field: 'amount', expected: '100', actual: '9', severity: 'high' },
    { type: 'value_error', field: 'status', expected: 'paid', actual: 'unknown', severity: 'high' },
    { type: 'value_error', field: 'owner', expected: 'u1', actual: '', severity: 'med' },
  );
  return report;
}

const CONTEXT: LocalizationContext = { skillText: 'skill 定义', promptText: 'prompt 文本' };

function readDecisions(dataDir: string): DecisionLogEntry[] {
  const file = getDecisionLogPath(dataDir);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as DecisionLogEntry);
}

describe('第三章 · error-localizer 降级出口接异常总线', () => {
  it('LLM 调用失败 → 仍是原降级结果（分类逻辑零改动）+ 出口上报一次', async () => {
    const onDegrade = vi.fn();
    const failing = vi.fn().mockRejectedValue(new Error('请求超时'));
    const result = await localizeError(mismatchReport(), CONTEXT, { callLlm: failing, onDegrade });

    // 既有降级语义未变（降级启发式 + 同样的 reason 前缀）
    expect(result.reasoning).toContain('[LLM 调用失败，降级启发式]');
    expect(result.errorSource).toBe('prompt');
    expect(result.confidence).toBeCloseTo(0.55);
    expect(result.evidence.diffCount).toBe(3);
    // 出口上报
    expect(onDegrade).toHaveBeenCalledTimes(1);
    const info = onDegrade.mock.calls[0]![0] as { reason: string; error: unknown; diffCount: number };
    expect(info.reason).toContain('LLM 调用失败');
    expect(info.error).toBeInstanceOf(Error);
    expect(info.diffCount).toBe(3);
  });

  it('LLM 返回不可解析 → 原降级结果不变 + 出口上报一次', async () => {
    const onDegrade = vi.fn();
    const garbage = vi.fn().mockResolvedValue('这不是 JSON');
    const result = await localizeError(mismatchReport(), CONTEXT, { callLlm: garbage, onDegrade });

    expect(result.reasoning).toContain('[LLM 返回不可解析，降级启发式]');
    expect(onDegrade).toHaveBeenCalledTimes(1);
    expect((onDegrade.mock.calls[0]![0] as { reason: string }).reason).toContain('不可解析');
  });

  it('未注入 onDegrade → 走默认异常总线（decision-log 落 FALLBACK_DEGRADE + retryable 标签）', async () => {
    const bus = new EventBus({ dataDir: tmpDir, sleep: async () => {} });
    setDefaultAnomalyBus(new AnomalyBus({ bus, dataDir: tmpDir }));

    await localizeError(mismatchReport(), CONTEXT, {
      callLlm: vi.fn().mockRejectedValue(new Error('请求超时')),
    });

    const entries = readDecisions(tmpDir);
    expect(entries.length).toBe(1);
    expect(entries[0]!.kind).toBe('FALLBACK_DEGRADE');
    expect(entries[0]!.why.tags).toContain('retryable');
    // 异常入口同样走第一章死信通道（同一条队列）
    expect(bus.listDeadLetters().length).toBe(1);
    expect(bus.getDeadLetter(bus.listDeadLetters()[0]!.id)!.anomalyClass).toBe('retryable');
  });

  it('正常路径不上报：无差异 / LLM 可用且可解析 / 未注入 LLM', async () => {
    const bus = new EventBus({ dataDir: tmpDir, sleep: async () => {} });
    setDefaultAnomalyBus(new AnomalyBus({ bus, dataDir: tmpDir }));
    const onDegrade = vi.fn();

    // 无差异 → 无需定位（不上报）
    await localizeError(emptyDiffReport(), CONTEXT, { onDegrade });
    // 未注入 callLlm → 配置形态，不是异常（不上报）
    await localizeError(mismatchReport(), CONTEXT, { onDegrade });
    // LLM 可用且可解析 → 正常定位（不上报）
    const ok = await localizeError(mismatchReport(), CONTEXT, {
      callLlm: vi.fn().mockResolvedValue('{"errorSource":"ontology","confidence":0.9,"reasoning":"缺实体定义"}'),
      onDegrade,
    });
    expect(ok.errorSource).toBe('ontology');

    expect(onDegrade).not.toHaveBeenCalled();
    expect(readDecisions(tmpDir).length).toBe(0);
    expect(bus.listDeadLetters().length).toBe(0);
  });
});
