// ============================================================
// corpus-export.ts · v1.4.4 第一章 · MCP tool: corpus_export
//
// 训练语料导出三件套的 MCP 面（CLI 面 = sofagent-audit corpus export）。
// 双入口同源：本 tool 延迟 import audit 包的导出实现 + core 包的
// 样本聚合/方法论——MCP 面只做参数适配与结果包装。
//
// 导出审计：每次导出记 corpus_export 事件（合规红线——导出行为受审计）。
// ============================================================

/** corpus_export tool 入参 */
export interface CorpusExportArgs {
  /** 导出范围（rules 用，缺省 all = 27 编号位含跳号占位） */
  scope?: 'default' | 'extended' | 'all';
  /** 输出目录（缺省 data/export/corpus/） */
  outDir?: string;
  /** 数据根（样本聚合源，缺省 SOFAGENT_DATA 或 data） */
  dataDir?: string;
  /** 只导规则（跳过样本/方法论——快速预览规则面） */
  rulesOnly?: boolean;
}

/** corpus_export tool 结果 */
export interface CorpusExportResult {
  text: string;
  data: {
    ok: boolean;
    isError?: boolean;
    rules: {
      files: string[];
      hmac: string | null;
      counts: { implemented: number; mergedPlaceholders: number; totalSlots: number };
    };
    verifiers?: {
      files: string[];
      buckets: { machine: number; human: number; heuristic: number };
    };
    samples?: {
      sourceCounts: Record<string, number>;
      absentSources: string[];
      total: number;
      humanBaseline: number;
      redactionClean: boolean;
    };
    methodology?: {
      complete: boolean;
      missing: string[];
      sections: Array<{ key: string; length: number; tables: number }>;
    };
    auditEvent: { event: string; scope: string; ruleCount: number; signed: boolean; at: string };
  };
}

/**
 * 训练语料导出三件套（规则 + 方法论 + 样本）。
 *
 * 延迟 require 策略：audit/core 包经 createRequire(__filename) 解析——
 * MCP 进程内两包不一定在依赖树上，缺包时给 isError 降级提示不崩 server。
 */
export async function corpusExport(args: CorpusExportArgs): Promise<CorpusExportResult> {
  const scope = args.scope ?? 'all';
  const createRequire = (await import('node:module')).createRequire;
  const req = createRequire(__filename);

  let exportRuleCorpus: (o: { scope?: string; outDir?: string; dataDir?: string }) => {
    ok: boolean; files: string[]; hmac: string | null;
    body: { counts: { implemented: number; mergedPlaceholders: number; totalSlots: number } };
    auditEvent: { event: string; scope: string; ruleCount: number; signed: boolean; at: string };
  };
  let generateVerifiers: (outDir?: string) => {
    files: string[];
    body: { buckets: { machineJudgeable: unknown[]; humanReview: unknown[]; heuristic: unknown[] } };
  };
  try {
    const mod = req('@sofagent/audit') as Record<string, unknown>;
    exportRuleCorpus = mod.exportRuleCorpus as typeof exportRuleCorpus;
    generateVerifiers = mod.generateVerifiers as typeof generateVerifiers;
    if (typeof exportRuleCorpus !== 'function' || typeof generateVerifiers !== 'function') throw new Error('export face missing');
  } catch {
    return {
      text: '[sofagent] corpus_export 不可用：@sofagent/audit 包未安装或导出面缺失（安装：npm install @sofagent/audit）',
      data: {
        ok: false,
        isError: true,
        rules: { files: [], hmac: null, counts: { implemented: 0, mergedPlaceholders: 0, totalSlots: 0 } },
        auditEvent: { event: 'corpus_export', scope, ruleCount: 0, signed: false, at: new Date().toISOString() },
      },
    };
  }

  // 一、规则 + verifiers（audit 包）
  const rules = exportRuleCorpus({ scope, outDir: args.outDir, dataDir: args.dataDir });
  const vers = generateVerifiers(args.outDir ?? (args.dataDir ?? 'data') + '/export/corpus');

  const base = {
    ok: rules.ok,
    rules: {
      files: rules.files,
      hmac: rules.hmac,
      counts: rules.body.counts,
    },
    verifiers: {
      files: vers.files,
      buckets: {
        machine: vers.body.buckets.machineJudgeable.length,
        human: vers.body.buckets.humanReview.length,
        heuristic: vers.body.buckets.heuristic.length,
      },
    },
    auditEvent: rules.auditEvent,
  };

  if (args.rulesOnly) {
    return {
      text: `语料导出（规则面，scope=${scope}）：${rules.body.counts.implemented} 实现 + ${rules.body.counts.mergedPlaceholders} 占位 = ${rules.body.counts.totalSlots} 编号位；verifiers 三桶 ${vers.body.buckets.machineJudgeable.length}/${vers.body.buckets.humanReview.length}/${vers.body.buckets.heuristic.length}；HMAC ${rules.hmac ? '已签' : '未签（~/.sofagent-key 缺失）'}`,
      data: base,
    };
  }

  // 二、样本 + 方法论（core 包——缺包降级不崩）
  interface SamplesShape {
    sourceCounts: Record<string, number>;
    absentSources: string[];
    samples: unknown[];
    humanBaselineCount: number;
    redactionCheck: { clean: boolean; leaked: string[] };
  }
  interface MethodologyShape {
    complete: boolean;
    missing: string[];
    sections: Array<{ key: string; length: number; tables: number }>;
  }
  let samples: SamplesShape | null = null;
  let methodology: MethodologyShape | null = null;
  try {
    const core = req('@sofagent/core') as Record<string, unknown>;
    samples = (core.aggregateSamples as (dataDir?: string) => SamplesShape)(args.dataDir);
    methodology = (core.exportMethodology as () => MethodologyShape)();
  } catch {
    // core 缺包——样本/方法论面缺席，规则面照常
  }

  const text = [
    `语料导出三件套（scope=${scope}）`,
    `一、规则：${rules.body.counts.implemented} 实现 + ${rules.body.counts.mergedPlaceholders} 占位 = ${rules.body.counts.totalSlots} 编号位（HMAC ${rules.hmac ? '✓' : '未签'}）`,
    `    verifiers：机器可判 ${vers.body.buckets.machineJudgeable.length} / 需人审 ${vers.body.buckets.humanReview.length} / 启发式 ${vers.body.buckets.heuristic.length}`,
    samples
      ? `二、样本：${Object.entries(samples.sourceCounts).map(([k, v]) => `${k}=${v}`).join(' ') || '（全部源空）'}；人工基准 ${samples.humanBaselineCount} 条；脱敏 ${samples.redactionCheck.clean ? '✓ 0 命中' : '❌ 泄漏'}`
      : `二、样本：⚠️ @sofagent/core 缺包，样本面缺席（规则面照常）`,
    methodology
      ? `三、方法论：${methodology.complete ? '✓ 三段齐全' : `⚠️ 缺 ${methodology.missing.join(', ')}`}（${methodology.sections.map((s) => `${s.key} ${s.length} 字/${s.tables} 表`).join(' / ')}）`
      : `三、方法论：⚠️ 缺包缺席`,
  ].join('\n');

  return {
    text,
    data: {
      ...base,
      ...(samples
        ? {
            samples: {
              sourceCounts: samples.sourceCounts,
              absentSources: samples.absentSources,
              total: samples.samples.length,
              humanBaseline: samples.humanBaselineCount,
              redactionClean: samples.redactionCheck.clean,
            },
          }
        : {}),
      ...(methodology
        ? {
            methodology: {
              complete: methodology.complete,
              missing: methodology.missing,
              sections: methodology.sections,
            },
          }
        : {}),
    },
  };
}
