// ============================================================
// audit/cli/federation-distill.ts · 联邦蒸馏 CLI（v1.2.5 · P2）
// ============================================================
//
// 跨设备知识合并 + 去重 + 矛盾标记。
//   sofagent audit federation-distill --peers device-a,device-b
//
// 分层边界方案（参数注入）：
//   mergeFederationResults 核心逻辑在 daemon federation/merge.ts 中。
//   audit 是底层包，不能反向 import daemon。
//   本 CLI 通过参数注入接收 merge 函数——运行时由 index.ts 动态 import
//   daemon 并传入。
//
// 安全约束：
//   - 跨设备搬运知识须走已认证的配对通道
//   - 合并产物仅含去重后的派生视图，原始 Ledger 不出本机
// ============================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { loadEnvConfig, resolveKnowledgeDir } from '@sofagent/core';
import type { KnowledgeQueryResult, FederationResult, MergedKnowledge } from '@sofagent/core';

/** 注入的合并函数签名(与 core mergeFederationResults 类型对齐——静态 import 后不再 any） */
export type MergeFn = (
  local: KnowledgeQueryResult[],
  remote: FederationResult[],
) => MergedKnowledge[];

/** federation-distill CLI 参数 */
export interface FederationDistillArgs {
  /** 对端设备列表 */
  peers: string[];
  /** 项目目录 */
  projectDir: string;
  /** JSON 输出 */
  json: boolean;
  /** 输出目录（默认 {data}/federation/distilled/） */
  outputDir?: string;
  /** 标记矛盾（不自动解决） */
  markConflictsOnly: boolean;
}

/** 蒸馏结果 */
export interface DistillResult {
  /** 合并的条目总数 */
  mergedCount: number;
  /** 矛盾标记数 */
  conflictCount: number;
  /** 各来源贡献条目数 */
  sourceCounts: Record<string, number>;
  /** 输出文件路径 */
  outputPath: string;
  /** 矛盾列表 */
  conflicts: Array<{ id: string; sources: string[]; description: string }>;
}

/**
 * 运行 federation-distill CLI
 *
 * @param args 命令参数
 * @param mergeFn 注入的 CRDT 合并函数（来自 daemon federation/merge.ts）
 */
export function runFederationDistillCli(
  args: FederationDistillArgs,
  mergeFn: MergeFn,
): number {
  const env = loadEnvConfig();
  const outputDir = args.outputDir ?? join(env.dataDir, 'federation', 'distilled');

  // 1. 读本地知识（从 knowledge/ 目录扫描）
  const local = loadLocalKnowledge(args.projectDir);

  if (local.length === 0) {
    console.log('ℹ️  本地知识库为空，无需蒸馏');
    return 0;
  }

  // 2. 从各对端设备加载知识（从 USB/配对通道已同步的数据）
  const remote: FederationResult[] = [];
  for (const peerId of args.peers) {
    const peerData = loadPeerKnowledge(peerId, env.dataDir);
    if (peerData.length > 0) {
      remote.push({ peerId, results: peerData, warnings: [] });
    }
  }

  if (remote.length === 0 && args.peers.length > 0) {
    console.log(`⚠️  未找到对端设备 ${args.peers.join(', ')} 的知识数据`);
    console.log('    请先通过 USB 配对通道同步知识数据。');
  }

  // 3. CRDT 合并
  const merged = mergeFn(local, remote);

  // 4. 矛盾检测（同 id 不同来源的条目标记为矛盾）
  const sourceMap = new Map<string, Set<string>>();
  for (const item of merged) {
    const id = item.id;
    const source = item.source;
    if (!sourceMap.has(id)) sourceMap.set(id, new Set());
    sourceMap.get(id)!.add(source);
  }

  const conflicts: DistillResult['conflicts'] = [];
  for (const [id, sources] of sourceMap) {
    if (sources.size >= 2) {
      conflicts.push({
        id,
        sources: [...sources],
        description: `知识条目 ${id} 在 ${sources.size} 个来源有不同版本（${[...sources].join(' / ')}）`,
      });
    }
  }

  // 5. 来源贡献统计
  const sourceCounts: Record<string, number> = {};
  for (const item of merged) {
    sourceCounts[item.source] = (sourceCounts[item.source] ?? 0) + 1;
  }

  // 6. 写入蒸馏产物
  const result: DistillResult = {
    mergedCount: merged.length,
    conflictCount: conflicts.length,
    sourceCounts,
    outputPath: join(outputDir, 'distilled-knowledge.json'),
    conflicts,
  };

  // 确保目录存在
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // 写入合并后的派生视图（不含原始 Ledger 内容）
  const outputPath = join(outputDir, 'distilled-knowledge.json');
  writeFileSync(
    outputPath,
    JSON.stringify({ ...result, merged }, null, 2) + '\n',
    'utf-8',
  );

  // 矛盾标记文件
  if (conflicts.length > 0) {
    const conflictsPath = join(outputDir, 'conflicts.json');
    writeFileSync(conflictsPath, JSON.stringify(conflicts, null, 2) + '\n', 'utf-8');
  }

  // 输出结果
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`\n✅ 联邦蒸馏完成`);
    console.log(`  合并条目：${result.mergedCount}`);
    console.log(`  来源贡献：`);
    for (const [source, count] of Object.entries(sourceCounts)) {
      console.log(`    ${source}: ${count} 条`);
    }
    if (conflicts.length > 0) {
      console.log(`\n  ⚠️  矛盾标记 ${conflicts.length} 项（需人工确认）：`);
      for (const c of conflicts.slice(0, 5)) {
        console.log(`    - ${c.id}: ${c.description}`);
      }
      if (conflicts.length > 5) {
        console.log(`    ... 共 ${conflicts.length} 项`);
      }
    }
    console.log(`\n  产物：${outputPath}`);
    if (!args.markConflictsOnly && conflicts.length === 0) {
      console.log('  ✅ 无矛盾，蒸馏视图可直接使用');
    }
  }

  return conflicts.length > 0 ? 1 : 0;
}

/**
 * 从本地 knowledge/ 目录加载知识条目
 */
function loadLocalKnowledge(
  projectDir: string,
): KnowledgeQueryResult[] {
  const knowledgeDir = resolveKnowledgeDir();
  const items: KnowledgeQueryResult[] = [];

  if (!existsSync(knowledgeDir)) return items;

  const subdirs = ['entities', 'concepts', 'comparisons', 'summaries'];
  for (const subdir of subdirs) {
    const subdirAbs = join(knowledgeDir, subdir);
    if (!existsSync(subdirAbs)) continue;

    let entries: string[];
    try {
      entries = readdirSync(subdirAbs).filter(
        (n: string) => n.endsWith('.md') && n !== 'index.md',
      );
    } catch (err) {
      console.warn(`[sofagent] 读取本地 knowledge 子目录失败（跳过）: ${subdirAbs} → ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    for (const name of entries) {
      try {
        const content = readFileSync(join(subdirAbs, name), 'utf-8');
        const slug = name.replace(/\.md$/, '');
        const id = `${subdir}/${slug}`;
        items.push({
          id,
          title: slug,
          sensitivity: 'internal',
          trust: 'internal',
          mtime: Date.now(),
          content: content.slice(0, 500), // 只取摘要
        });
      } catch (err) {
        console.warn(`[sofagent] 读取本地 knowledge 页面失败（跳过）: ${subdirAbs}/${name} → ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return items;
}

/**
 * 从对端设备已同步的数据中加载知识条目
 *
 * 数据路径：{data}/federation/peers/{peerId}/knowledge/
 * （由 USB 配对通道同步到此处）
 */
function loadPeerKnowledge(
  peerId: string,
  dataDir: string,
): KnowledgeQueryResult[] {
  const peerDir = join(dataDir, 'federation', 'peers', peerId, 'knowledge');
  const items: KnowledgeQueryResult[] = [];

  if (!existsSync(peerDir)) return items;

  const subdirs = ['entities', 'concepts', 'comparisons', 'summaries'];
  for (const subdir of subdirs) {
    const subdirAbs = join(peerDir, subdir);
    if (!existsSync(subdirAbs)) continue;

    let entries: string[];
    try {
      entries = readdirSync(subdirAbs).filter(
        (n: string) => n.endsWith('.md') && n !== 'index.md',
      );
    } catch (err) {
      console.warn(`[sofagent] 读取 peer 知识子目录失败（跳过）: ${subdirAbs} → ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    for (const name of entries) {
      try {
        const content = readFileSync(join(subdirAbs, name), 'utf-8');
        const slug = name.replace(/\.md$/, '');
        const id = `${subdir}/${slug}`;
        items.push({
          id,
          title: slug,
          sensitivity: 'internal',
          trust: 'user',
          mtime: Date.now(),
          content: content.slice(0, 500),
        });
      } catch (err) {
        console.warn(`[sofagent] 读取 peer 知识页面失败（跳过）: ${subdirAbs}/${name} → ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return items;
}

/**
 * 参数解析辅助
 */
export function parseFederationDistillArgs(argv: string[]): FederationDistillArgs {
  const args: FederationDistillArgs = {
    peers: [],
    projectDir: process.cwd(),
    json: false,
    markConflictsOnly: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--peers' && argv[i + 1]) {
      i++;
      args.peers = argv[i]!.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--project' && argv[i + 1]) {
      i++;
      args.projectDir = argv[i]!;
    } else if (arg === '--mark-conflicts-only') {
      args.markConflictsOnly = true;
    } else if (arg === '--output' && argv[i + 1]) {
      i++;
      args.outputDir = argv[i]!;
    }
  }

  return args;
}
