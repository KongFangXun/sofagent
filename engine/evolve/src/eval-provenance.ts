// eval-provenance.ts · 评测集谱系登记 + 防投毒三防线（v1.5.8 章一）
//
// 自改进循环的自评基准即攻击面（投毒基准可诱导 agent 自演化出削弱安全控制的
// 指令，且换干净基准后污染仍存活——Roesner & Kohno）。本文件是谱系防线：
//   ① 钉哈希登记谱系（来源 / 版本 / 变更权）
//   ② 留出集换代机制（换代走新建集 + 声明新旧集不可横比——冻结 ≠ 永久干净）
//   ③ 污染事前自陈（逐目标列出读数所涉公开集——污染在读数之前显式化）
// 评测环境剥离答案键由沙箱零凭证纪律承担（本文件提供 stripAnswerKey 投影工具）。

import { createHash } from 'node:crypto';

/** 单个评测集的谱系登记项 */
export interface EvalSetProvenance {
  /** 集标识（如 'heldout-code-v3'） */
  setId: string;
  /** 来源描述（谁产出的、从哪来的） */
  origin: string;
  /** 版本号（每次换代 +1——换代走新建集，旧集只冻结不删除） */
  version: number;
  /** 变更权持有者（'human-fde' = 只有人能改；Agent 不可写） */
  changeAuthority: 'human-fde';
  /** 条目内容的钉哈希（sha256） */
  contentHash: string;
  /** 逐条目污染自陈（targetId → 该读数所涉的公开集名清单） */
  contaminationSelfReport: Record<string, string[]>;
  /** 登记时间（ISO） */
  registeredAt: string;
}

/** 谱系台账文件形态 */
export interface ProvenanceLedger {
  schemaVersion: 1;
  sets: EvalSetProvenance[];
  /** 换代声明（每次新建集一条——新旧集不可横比的显式留痕） */
  successionDeclarations: Array<{
    fromSetId: string;
    toSetId: string;
    declaredAt: string;
    note: string;
  }>;
}

/** 评测集条目（谱系计算的最小载体） */
export interface EvalSetItem {
  id: string;
  /** 题面（instruction） */
  prompt: string;
  /** 期望结果（answer key——登记哈希时即参与；运行时由 stripAnswerKey 剥离） */
  expected?: string;
}

/** 计算评测集条目的钉哈希（规范序列化：id + prompt + expected） */
export function computeEvalSetHash(items: readonly EvalSetItem[]): string {
  const canonical = items
    .map((i) => JSON.stringify({ id: i.id, prompt: i.prompt, expected: i.expected ?? null }))
    .sort()
    .join('\n');
  return createHash('sha256').update(canonical).digest('hex');
}

/** 登记一个评测集的谱系（纯函数——产出登记项，落盘由调用方走受保护面） */
export function registerEvalSetProvenance(input: {
  setId: string;
  origin: string;
  version: number;
  items: readonly EvalSetItem[];
  contaminationSelfReport: Record<string, string[]>;
  now?: string;
}): EvalSetProvenance {
  return {
    setId: input.setId,
    origin: input.origin,
    version: input.version,
    changeAuthority: 'human-fde',
    contentHash: computeEvalSetHash(input.items),
    contaminationSelfReport: input.contaminationSelfReport,
    registeredAt: input.now ?? new Date().toISOString(),
  };
}

/**
 * 留出集换代（纯函数）：新建集登记 + 换代声明（新旧集不可横比——
 * 选择压力会慢慢污染公开半集，冻结的集不能永久干净，须换代且声明不可横比）。
 */
export function succeedEvalSet(
  ledger: ProvenanceLedger,
  next: EvalSetProvenance,
  note: string,
  now?: string,
): ProvenanceLedger {
  return {
    ...ledger,
    sets: [...ledger.sets.filter((s) => s.setId !== next.setId), next],
    successionDeclarations: [
      ...ledger.successionDeclarations,
      {
        fromSetId: `${next.setId}@v${Math.max(1, next.version - 1)}`,
        toSetId: `${next.setId}@v${next.version}`,
        declaredAt: now ?? new Date().toISOString(),
        note: `新旧集不可横比（换代非对比实验）——${note}`,
      },
    ],
  };
}

/**
 * 评测环境答案键剥离投影（防线 ③ 的配套工具）：产出不含 expected 的
 * 只读投题型条目——评测执行环境拿到的条目天然无答案键。
 */
export function stripAnswerKey(items: readonly EvalSetItem[]): Array<{ id: string; prompt: string }> {
  return items.map((i) => ({ id: i.id, prompt: i.prompt }));
}

/**
 * 污染事前自陈校验（防线 ③）：读数消费方在取用评测集前校验其谱系登记
 * 已含逐条目自陈——缺自陈的集按不可信处理（fail-closed）。
 */
export function verifyContaminationSelfReport(
  provenance: EvalSetProvenance,
  itemIds: readonly string[],
): { ok: boolean; missing: string[] } {
  const missing = itemIds.filter((id) => !provenance.contaminationSelfReport[id]);
  return { ok: missing.length === 0, missing };
}

/**
 * 保护面安全套件独立阻断（防线 ②）：安全套件命中结果与 evolve 分数
 **相互独立**——安全命中即硬阻断，不作为可权衡输入参与任何加权。
 */
export function safetySuiteVerdict(
  safetyHits: readonly string[],
  evolveScore: number,
): { blocked: boolean; reason: string } {
  if (safetyHits.length > 0) {
    return {
      blocked: true,
      reason: `保护面安全套件命中 ${safetyHits.length} 项——硬阻断（独立于 evolve 分数 ${evolveScore.toFixed(3)}，不作为可权衡输入）`,
    };
  }
  return { blocked: false, reason: '安全套件零命中——放行（evolve 分数另行按准入门判）' };
}
