// training-policy.ts · 训练期策略集加载（opt-in）+ 命中判定（v1.5.8 章五）
//
// 边界：本仓做治理与信号、不做训练引擎——训练循环由模型层跑、经 TrainChannel
// 提交；本模块产出「训练期策略合规判定 + 惩罚信号」，以数据集/reward 判据
// 形态交付。
//
// fail-closed 形态：策略集默认空 = 不启用（对齐 G10 授权白名单与出口白名单
// 先例）——声明后命中即折算惩罚。与准入门（章一）互补不互替：准入门判
// 「该不该自动进化」，本章判「训练期间有没有越界」，任一门未过即不得进下一步。

/** 训练期策略集声明（opt-in——默认空不启用） */
export interface TrainingPolicySet {
  /** 规则集版本（留痕锚点——哪个规则集版本影响了哪批数据） */
  rulesetVersion: string;
  /** 训练期生效的规则 ID 清单（引用 @sofagent/audit 规则注册表，不复制规则本体） */
  ruleIds: string[];
  /** 声明时间（ISO） */
  declaredAt: string;
}

/** 空策略集（默认态——不启用） */
export function emptyTrainingPolicySet(): TrainingPolicySet {
  return { rulesetVersion: 'none', ruleIds: [], declaredAt: '' };
}

/** 轨迹的规则命中记录（审计侧产出形态） */
export interface TrajectoryRuleHit {
  /** 轨迹 ID */
  trajectoryId: string;
  /** 命中的规则 ID */
  ruleId: string;
}

/** 策略命中判定结果 */
export interface PolicyHitVerdict {
  /** 是否命中训练期策略 */
  hit: boolean;
  /** 命中明细（轨迹 × 规则） */
  hits: Array<{ trajectoryId: string; ruleId: string }>;
  /** 未启用的显式声明（默认空集 → hit=false 且 disabled=true） */
  disabled: boolean;
}

/**
 * 命中判定纯函数：轨迹的规则命中 ∩ 训练期策略集。
 * 策略集为空（ruleIds 空或 rulesetVersion='none'）→ 恒不命中（disabled=true）。
 */
export function judgePolicyHits(
  policy: TrainingPolicySet,
  trajectoryHits: readonly TrajectoryRuleHit[],
): PolicyHitVerdict {
  const disabled = policy.ruleIds.length === 0 || policy.rulesetVersion === 'none';
  if (disabled) {
    return { hit: false, hits: [], disabled: true };
  }
  const active = new Set(policy.ruleIds);
  const hits = trajectoryHits
    .filter((t) => active.has(t.ruleId))
    .map((t) => ({ trajectoryId: t.trajectoryId, ruleId: t.ruleId }));
  return { hit: hits.length > 0, hits, disabled: false };
}

/**
 * 与准入门的关系（互补不互替——单测锁的组合覆盖载体）：
 * 两门独立判定、结论并联——任一门未过即整体不得进下一步。
 * 本函数是「组合语义」的唯一落点（两门判定各自独立实现，此处只做并联）。
 */
export function combineGates(
  admissionPassed: boolean,
  policyPassed: boolean,
): { proceed: boolean; basis: string } {
  if (admissionPassed && policyPassed) {
    return { proceed: true, basis: '准入门 ✓ + 训练期策略门 ✓——双门全过，可进下一步' };
  }
  const failed: string[] = [];
  if (!admissionPassed) failed.push('准入门（该不该自动进化——章一）');
  if (!policyPassed) failed.push('训练期策略门（训练期间有没有越界——章五）');
  // 互补语义的要点：一门失败不能被另一门的通过「代偿」——basis 逐门点名
  return { proceed: false, basis: `未过：${failed.join(' 与 ')}（两门互补不互替，任一门未过即不得进下一步——另一门的通过不代偿）` };
}
