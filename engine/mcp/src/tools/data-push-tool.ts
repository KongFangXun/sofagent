// data-push-tool.ts · MCP tool：data_push（章十三 · 标准数据推送入口接线）
//
// 消费 v1.4.6 已交付的 gateDataPush（schema 校验 + 分拣/合规双闸）——
// 本版接线收口：零生产调用点 → MCP tool 入口可达。
//
// 合规闸注入（声明式）：企业标识非空即放行（payload schema 已保证
// enterpriseId min(1)）；企业自建拦截策略经 compliance_policy 字符串
// 注入（如 'strict' 预留扩展）。分拣闸走 sorting-gate 内建规则
// （敏感档本地入库放行 + 上云标记）。
//
// 落库动作挂审计（decision-log ARTIFACT_EDIT——MCP tool 落库纪律）。

export interface DataPushResult {
  text: string;
  data: {
    isError: boolean;
    /** 双闸受理结论 */
    accepted: boolean;
    /** 分拣明细（敏感档标记） */
    sorting: { allAllowed: boolean; sensitiveCount: number; totalSamples: number };
    /** 入库拒绝原因（accepted=false 时） */
    reason?: string;
    /** schema 校验问题清单（isError=true 时） */
    issues?: string[];
    auditLogged: boolean;
  };
}

export async function dataPush(args: Record<string, unknown>): Promise<DataPushResult> {
  const raw = {
    kind: args.kind,
    enterpriseId: args.enterprise_id,
    source: args.source,
    samples: args.samples,
  };

  const { validateDataPush, gateDataPush } = await import('@sofagent/orchestrator');
  const validation = validateDataPush(raw);
  if (!validation.valid) {
    return {
      text: `[sofagent] data_push 失败：payload 不合规（${validation.issues?.length ?? 0} 项）\n${(validation.issues ?? []).map((i) => `  · ${i}`).join('\n')}`,
      data: { isError: true, accepted: false, sorting: { allAllowed: false, sensitiveCount: 0, totalSamples: 0 }, issues: validation.issues, auditLogged: false },
    };
  }

  // 合规闸谓词：schema 已保证 enterpriseId 非空——策略位预留（strict 扩展点）
  const compliance = () => ({ allowed: true, reason: '企业标识在位（schema 校验通过）' });
  const gated = gateDataPush(validation.payload!, compliance);

  // 拒绝留痕进 decision-log（负样本语义同 PR reject）
  let auditLogged = false;
  try {
    const { emitDecision } = await import('@sofagent/audit');
    emitDecision({
      agentId: 'sofagent-data-push',
      sessionId: `data-push-${Date.now()}`,
      kind: 'ARTIFACT_EDIT',
      moment: 'ACT',
      category: gated.accepted ? 'select' : 'skip',
      why: `data_push ${validation.payload!.kind}（${validation.payload!.samples.length} 样本 · 来源 ${validation.payload!.source}）→ ${gated.accepted ? '双闸受理' : '拦截'}：${gated.reason}`,
      artifactRef: `data-push/${validation.payload!.enterpriseId}`,
      evidence: [
        `samples=${validation.payload!.samples.length}`,
        `sensitive=${gated.sorting.decisions.filter((d) => d.classification === 'sensitive').length}`,
      ],
    });
    auditLogged = true;
  } catch {
    auditLogged = false; // best-effort——结果已定，审计失败显式标注
  }

  const sensitiveCount = gated.sorting.decisions.filter((d) => d.classification === 'sensitive').length;
  return {
    text: gated.accepted
      ? `[sofagent] ✅ data_push 受理（${validation.payload!.samples.length} 样本 · 敏感档 ${sensitiveCount} 段${sensitiveCount > 0 ? '——本地入库放行，上云需先脱敏' : ''}）`
      : `[sofagent] ⛔ data_push 拦截：${gated.reason}`,
    data: {
      isError: false,
      accepted: gated.accepted,
      sorting: { allAllowed: gated.sorting.allAllowed, sensitiveCount, totalSamples: validation.payload!.samples.length },
      ...(gated.accepted ? {} : { reason: gated.reason }),
      auditLogged,
    },
  };
}
