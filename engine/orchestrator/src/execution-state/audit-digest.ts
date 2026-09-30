// ============================================================
// execution-state/audit-digest.ts · v1.5.5 章一 · 审计摘要接线（middleware 通道）
// ============================================================
// 「轨迹可弃、行为可溯」的接线面：Rt 丢弃前，把审计摘要（动作 + ΔΣt + 因果边）
// 经 wrapToolCall 通道实时落记录。本模块提供：
//   · digestToAuditLine()——摘要转审计行（进 middleware 的 wrapToolCall 记录流）；
//   · emitAuditDigest()——面向 middleware 注册表的发射入口。
// ============================================================

import type { AuditDigest } from './protocol';

/** 审计行（对齐 middleware wrapToolCall 记录的既有字段形态——agent/tool/entry 三段） */
export interface AuditLine {
  agent: string;
  tool: string;
  entry: {
    type: 'execution-state-digest';
    node: string;
    kind: string;
    step: number;
    action: string;
    patch: AuditDigest['patch'];
    causalEdges: AuditDigest['causalEdges'];
    timestamp: string;
  };
}

/** 摘要 → 审计行（纯函数——测试面） */
export function digestToAuditLine(digest: AuditDigest, agent: string, node: string): AuditLine {
  return {
    agent,
    tool: 'execution-state',
    entry: {
      type: 'execution-state-digest',
      node,
      kind: digest.kind,
      step: digest.step,
      action: digest.action,
      patch: digest.patch,
      causalEdges: digest.causalEdges,
      timestamp: digest.timestamp,
    },
  };
}

/** 发射器注册表（middleware 接线点 setAuditSink 注入） */
type Sink = (line: AuditLine) => void;
let sink: Sink | null = null;

export function setAuditSink(fn: Sink | null): void {
  sink = fn;
}

/** 发射审计摘要（无 sink 时降级 stderr——不留存 reasoning 本体） */
export function emitAuditDigest(digest: AuditDigest, agent: string, node: string): void {
  const line = digestToAuditLine(digest, agent, node);
  if (sink) {
    try {
      sink(line);
      return;
    } catch {
      // sink 故障不阻塞执行——降级 stderr
    }
  }
  process.stderr.write(
    `[sofagent][execution-state] 审计摘要（sink 不可用，stderr 降级）: ${JSON.stringify(line.entry)}\n`,
  );
}
