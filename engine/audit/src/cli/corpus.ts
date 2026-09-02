// ============================================================
// corpus.ts · v1.4.4 第一章 · CLI 子命令 `sofagent-audit corpus export`
//
// 双入口的 CLI 面（MCP 面 = corpus_export tool）。调用 audit 包导出三件：
//   1. 规则语料（rule-schema + exporter——JSON/YAML 双格式 + HMAC）
//   2. verifiers 清单（reward-mapping——三桶分桶）
//   3. 样本聚合 + 方法论（core 包 sample-aggregator / methodology）
//
// `sofagent corpus export` 经 CLI 桥接可达（audit 包 bin 面）。
// ============================================================

import { exportRuleCorpus } from '../export/exporter';
import { generateVerifiers, buildVerifiersManifest } from '../export/reward-mapping';

/** corpus 子命令参数 */
export interface CorpusArgs {
  /** 导出范围（rules 用） */
  scope: 'default' | 'extended' | 'all';
  /** 输出目录（缺省 data/export/corpus/） */
  outDir?: string;
  /** 数据根（样本聚合源） */
  dataDir?: string;
  /** 只导规则（跳过样本/方法论） */
  rulesOnly?: boolean;
  /** JSON 输出（机器消费） */
  json?: boolean;
}

/** 解析 `corpus export [--scope all|default|extended] [--out <dir>] [--rules-only] [--json]` */
export function parseCorpusArgs(argv: string[]): CorpusArgs {
  const args: CorpusArgs = { scope: 'all' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === 'corpus' || a === 'export') continue; // 子命令词自身
    if (a === '--scope' && argv[i + 1]) {
      i++;
      const v = argv[i] as string;
      if (v === 'default' || v === 'extended' || v === 'all') args.scope = v;
    } else if (a === '--out' && argv[i + 1]) {
      i++;
      args.outDir = argv[i] as string;
    } else if (a === '--data-dir' && argv[i + 1]) {
      i++;
      args.dataDir = argv[i] as string;
    } else if (a === '--rules-only') {
      args.rulesOnly = true;
    } else if (a === '--json') {
      args.json = true;
    }
  }
  return args;
}

/** 运行 corpus export（返回 exit code） */
export async function runCorpusExportCli(args: CorpusArgs): Promise<0 | 1> {
  // 一、规则语料（JSON/YAML 双格式 + HMAC）
  const rules = exportRuleCorpus({ scope: args.scope, outDir: args.outDir, dataDir: args.dataDir });
  // 二、verifiers 清单（同目录）
  const vers = generateVerifiers(args.outDir ?? (args.dataDir ?? 'data') + '/export/corpus');

  if (args.rulesOnly) {
    if (args.json) {
      console.log(JSON.stringify({ ok: rules.ok, files: [...rules.files, ...vers.files], hmac: rules.hmac, counts: rules.body.counts, auditEvent: rules.auditEvent }, null, 2));
    } else {
      console.log(`规则语料导出（${args.scope}）：${rules.body.counts.implemented} 实现 + ${rules.body.counts.mergedPlaceholders} 占位 = ${rules.body.counts.totalSlots} 编号位`);
      for (const f of rules.files) console.log(`  ✓ ${f}`);
      for (const f of vers.files) console.log(`  ✓ ${f}`);
      console.log(`  HMAC 签名：${rules.hmac ?? '⚠️ 未签（~/.sofagent-key 缺失——告警不阻断）'}`);
    }
    return rules.ok ? 0 : 1;
  }

  // 三、样本聚合 + 方法论（core 包——延迟 import 避免编译期循环）
  const coreMod = (await import('@sofagent/core')) as typeof import('@sofagent/core');
  const samples = coreMod.aggregateSamples(args.dataDir);
  const methodology = coreMod.exportMethodology();

  if (args.json) {
    console.log(JSON.stringify({
      ok: rules.ok,
      rules: { files: rules.files, hmac: rules.hmac, counts: rules.body.counts },
      verifiers: { files: vers.files, buckets: { machine: vers.body.buckets.machineJudgeable.length, human: vers.body.buckets.humanReview.length, heuristic: vers.body.buckets.heuristic.length } },
      samples: { sourceCounts: samples.sourceCounts, absentSources: samples.absentSources, total: samples.samples.length, humanBaseline: samples.humanBaselineCount, redactionClean: samples.redactionCheck.clean },
      methodology: { complete: methodology.complete, missing: methodology.missing, sections: methodology.sections.map((s: { key: string; length: number; tables: number }) => ({ key: s.key, length: s.length, tables: s.tables })) },
      auditEvent: rules.auditEvent,
    }, null, 2));
  } else {
    console.log(`语料导出三件套（scope=${args.scope}）`);
    console.log(`  一、规则：${rules.body.counts.implemented} 实现 + ${rules.body.counts.mergedPlaceholders} 占位 = ${rules.body.counts.totalSlots} 编号位，HMAC ${rules.hmac ? '✓' : '⚠️ 未签'}`);
    console.log(`     verifiers：机器可判 ${vers.body.buckets.machineJudgeable.length} / 需人审 ${vers.body.buckets.humanReview.length} / 启发式 ${vers.body.buckets.heuristic.length}`);
    console.log(`  二、方法论：${methodology.complete ? '✓ 三段齐全' : `⚠️ 缺 ${methodology.missing.join(', ')}`}（${methodology.sections.map((s: { key: string; length: number }) => `${s.key} ${s.length} 字`).join(' / ')}）`);
    console.log(`  三、样本：${Object.entries(samples.sourceCounts).map(([k, v]) => `${k}=${v}`).join(' ') || '（全部源空）'}；缺席源：${samples.absentSources.join(', ') || '无'}`);
    console.log(`     人工基准（human-fde）：${samples.humanBaselineCount} 条；脱敏验收：${samples.redactionCheck.clean ? '✓ 0 命中' : `❌ 泄漏 ${samples.redactionCheck.leaked.join(', ')}`}`);
    for (const f of rules.files) console.log(`  ✓ ${f}`);
    for (const f of vers.files) console.log(`  ✓ ${f}`);
  }
  return rules.ok ? 0 : 1;
}

// 消除未使用 import 告警（buildVerifiersManifest 供外部直接消费清单主体）
export { buildVerifiersManifest };
