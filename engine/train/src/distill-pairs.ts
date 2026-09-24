// distill-pairs.ts · v1.5.2 T7 第七章 · 蒸馏偏好对构造（同 prompt 双响应 → DPO）
//
// 定位：云端教师（强模型 API）好答案 vs 本地模型同题响应 → 天然 DPO 偏好对
// （chosen=教师 / rejected=本地）→ 进 dpo 数据集。同 prompt 双响应配对构造，
// 作为持续后训练（v1.4.5 三触发）的蒸馏素材源。版本台账可溯（衔接
// dataset-version——buildAndPersistDataset 内建记录，本文件产出对可直入）。
//
// 纯函数（零 I/O）——配对/过滤/构造全量可注入测试。

// ══════════════════════════════════════
// 响应记录（教师/本地双源形态）
// ══════════════════════════════════════

/** 单源响应（教师或本地模型对同一 prompt 的应答） */
export interface DistillResponse {
  /** prompt 标识（同题配对键——同 promptId 的教师/本地响应配成对） */
  promptId: string;
  /** 提示词（原文——chosen/rejected 共享） */
  prompt: string;
  /** 应答内容 */
  response: string;
  /** 来源（teacher = 云端强模型 / local = 本地模型） */
  origin: 'teacher' | 'local';
  /** 应答质量信号（可选——eval 分数；有则进质量闸判定） */
  qualityScore?: number;
}

/** 配对构造选项 */
export interface DistillPairOptions {
  /** 最低质量差（teacher.score - local.score ≥ 此值才成对——缺省 0 全配） */
  minQualityGap?: number;
  /** 响应最小长度（过短的教师答案信息量不足——缺省 10 字符） */
  minResponseLength?: number;
  /** 最大对数（缺省不限——采样控制） */
  maxPairs?: number;
}

/** DPO 偏好对（dataset-builder DpoSample 同构 + 溯源 meta） */
export interface DistillPair {
  prompt: string;
  chosen: string;
  rejected: string;
  /** 溯源（promptId + 双源标记——样本级可回溯到配对现场） */
  meta: { promptId: string; chosenOrigin: 'teacher'; rejectedOrigin: 'local'; qualityGap: number };
}

/** 配对结果 */
export interface DistillPairResult {
  pairs: DistillPair[];
  /** 成对数 */
  paired: number;
  /** 跳过统计（原因 → 数——审计与质量闸消费） */
  skipReasons: Record<string, number>;
}

/**
 * 同 prompt 双响应 → DPO 偏好对构造（核心纯函数）。
 *
 * 配对规则：
 *   - 同 promptId 的 teacher + local 各一条 → 配对（chosen=teacher /
 *     rejected=local——蒸馏方向固定，不接受反转）
 *   - 多条同源响应取 qualityScore 最高者（无分数取最长——信息量代理）
 *   - 教师响应过短（< minResponseLength）跳过（弱教师样本污染 chosen 面）
 *   - 质量差 < minQualityGap 跳过（教师不比本地好多少——偏好信号弱）
 */
export function buildDistillPairs(
  responses: readonly DistillResponse[],
  opts: DistillPairOptions = {},
): DistillPairResult {
  const minQualityGap = opts.minQualityGap ?? 0;
  const minResponseLength = opts.minResponseLength ?? 10;
  const skipReasons: Record<string, number> = {};
  const skip = (reason: string): void => {
    skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
  };

  // 按 promptId 分桶
  const byPrompt = new Map<string, { teacher: DistillResponse[]; local: DistillResponse[] }>();
  for (const r of responses) {
    const bucket = byPrompt.get(r.promptId) ?? { teacher: [], local: [] };
    if (r.origin === 'teacher') bucket.teacher.push(r);
    else bucket.local.push(r);
    byPrompt.set(r.promptId, bucket);
  }

  const pairs: DistillPair[] = [];
  for (const [promptId, bucket] of byPrompt) {
    if (bucket.teacher.length === 0) {
      skip(`缺教师响应（promptId=${promptId}）`);
      continue;
    }
    if (bucket.local.length === 0) {
      skip(`缺本地响应（promptId=${promptId}）`);
      continue;
    }
    // 每源取最优
    const best = (arr: DistillResponse[]): DistillResponse =>
      arr.reduce((a, b) => {
        if (a.qualityScore !== undefined && b.qualityScore !== undefined) {
          return b.qualityScore > a.qualityScore ? b : a;
        }
        return b.response.length > a.response.length ? b : a;
      });
    const teacher = best(bucket.teacher);
    const local = best(bucket.local);

    if (teacher.response.length < minResponseLength) {
      skip(`教师响应过短（<${minResponseLength} 字符——弱教师样本不入 chosen 面）`);
      continue;
    }
    const gap =
      teacher.qualityScore !== undefined && local.qualityScore !== undefined
        ? teacher.qualityScore - local.qualityScore
        : Number.NaN;
    if (!Number.isNaN(gap) && gap < minQualityGap) {
      skip(`质量差不足（gap=${gap.toFixed(2)} < ${minQualityGap}——偏好信号弱）`);
      continue;
    }
    pairs.push({
      prompt: teacher.prompt,
      chosen: teacher.response,
      rejected: local.response,
      meta: {
        promptId,
        chosenOrigin: 'teacher',
        rejectedOrigin: 'local',
        qualityGap: Number.isNaN(gap) ? 0 : gap,
      },
    });
    if (opts.maxPairs !== undefined && pairs.length >= opts.maxPairs) break;
  }

  return { pairs, paired: pairs.length, skipReasons };
}

// ══════════════════════════════════════
// 偏好对 → dpo 数据集入参（版本台账可溯的衔接面）
// ══════════════════════════════════════

/** IngestRecord 形态（与 session-ingest 局部声明同构——衔接 dataset-builder） */
export interface DistillIngestRecord {
  id: string;
  source: string;
  fields: Record<string, string | number | boolean | null>;
}

/**
 * 偏好对 → IngestRecord（dpo 列映射形态：prompt/chosen/rejected 三列）。
 *
 * 产出可直接进 buildAndPersistDataset({ algorithm: 'dpo' })——
 * 版本台账由其内建记录（contentHash + 样本数 + 配置——eval 可复现引用）。
 */
export function distillPairsToRecords(pairs: readonly DistillPair[]): DistillIngestRecord[] {
  return pairs.map((p, idx) => ({
    id: `distill:${p.meta.promptId}#${idx + 1}`,
    source: `distill-pairs:${p.meta.promptId}`,
    fields: {
      prompt: p.prompt,
      chosen: p.chosen,
      rejected: p.rejected,
      promptId: p.meta.promptId,
      qualityGap: p.meta.qualityGap,
      chosenOrigin: p.meta.chosenOrigin,
      rejectedOrigin: p.meta.rejectedOrigin,
    },
  }));
}
