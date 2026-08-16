// ============================================================
// snapshot-restore.ts · MCP tool：恢复到指定快照（v1.3.5 交付 2）
// ============================================================
//
// 🔴 强制人审（破坏性操作——覆写工作区文件），交互模式与 promote_ab 同款
// confirmed 门控（delete_entity / market_retire 仓库先例；不走 hitl/pending/
// 文件通道——该通道与 LOOP checkpoint 强耦合）：
//
//   human_confirmed ≠ true（默认）：
//     不执行恢复。返回结构化 pending 结果——含目标快照的时间线上下文
//     （前后各 2 条），text 明示挂起。DSH 冒烟「未确认时挂起」覆盖路径。
//
//   human_confirmed === true：
//     执行恢复（restoreSnapshot）+ decision-log 审计留痕（kind=CONFIG_CHANGE
//     语义最接近——工作区状态回退）。
//
// 🔴 import 铁律：restoreSnapshot 从 '@sofagent/core' import（非 daemon——
//   optionalDependencies 静态 import 会在 daemon 缺失环境炸）。
// ============================================================

import { listAllSnapshots, restoreSnapshot } from '@sofagent/core';

// ============================================================
// 类型定义
// ============================================================

export interface SnapshotRestoreArgs {
  /** 目标快照 SHA（完整或 ≥4 位短前缀）（必填） */
  sha: string;
  /** 项目根目录（可选——默认 process.cwd()） */
  project_dir?: string;
  /**
   * 🔴 人工确认（破坏性操作强制人审）。
   * false/缺省 → 只返回时间线上下文挂起，不执行恢复；
   * true → 执行恢复 + 审计留痕。
   */
  human_confirmed?: boolean;
  /** 决策备注（写入 decision-log） */
  comment?: string;
}

export interface SnapshotRestoreResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  /** 结构化数据 */
  data: {
    isError: boolean;
    /** 是否已执行恢复（false = 挂起等人审或失败） */
    executed: boolean;
    /** 是否处于挂起等人审状态 */
    awaitingHuman: boolean;
    sha: string;
    projectDir: string;
    /** 恢复的文件数（executed=true 时） */
    restoredFiles?: number;
    decisionLogged: boolean;
    message?: string;
  };
}

// ============================================================
// 主函数
// ============================================================

/**
 * 恢复到指定快照（强制人审）。
 *
 * @param args 恢复参数
 * @returns 结构化结果（text + data）
 */
export async function snapshotRestore(args: SnapshotRestoreArgs): Promise<SnapshotRestoreResult> {
  const projectDir = args.project_dir ?? process.cwd();

  const fail = (message: string, sha: string = ''): SnapshotRestoreResult => ({
    text: `[sofagent] 快照恢复失败：${message}`,
    data: {
      isError: true,
      executed: false,
      awaitingHuman: false,
      sha,
      projectDir,
      decisionLogged: false,
      message,
    },
  });

  if (!args.sha) {
    return fail('缺少必填参数 sha（目标快照 SHA——用 snapshot_list 查时间线）');
  }

  // 时间线上下文（挂起返回也要给——人审决策依据）
  let timeline: ReturnType<typeof listAllSnapshots>;
  try {
    timeline = listAllSnapshots(projectDir);
  } catch (err) {
    return fail(`读取快照时间线失败: ${err instanceof Error ? err.message : String(err)}`, args.sha);
  }

  const matches = timeline.filter((s) => s.sha.startsWith(args.sha));
  if (matches.length === 0) {
    return fail(`未找到匹配的快照: ${args.sha}（时间线共 ${timeline.length} 个——用 snapshot_list 查看可用 SHA）`, args.sha);
  }
  if (matches.length > 1) {
    return fail(`多个快照匹配 "${args.sha}": ${matches.map((m) => m.shortSha).join(', ')}——请使用完整 SHA`, args.sha);
  }

  const target = matches[0]!;
  const idx = timeline.findIndex((s) => s.sha === target.sha);
  const context = timeline
    .slice(Math.max(0, idx - 2), Math.min(timeline.length, idx + 3))
    .map((s) => `  - ${s.shortSha} · ${s.timestamp} · ${s.fileCount} 文件${s.sha === target.sha ? '  ← 目标' : ''}`);

  // ── 🔴 人审门控：human_confirmed ≠ true → 挂起，绝不执行 ──
  if (args.human_confirmed !== true) {
    return {
      text: [
        '⚠️ [sofagent] snapshot_restore 挂起——破坏性操作等待人工确认，未执行任何变更。',
        `  目标快照: ${target.sha}（${target.timestamp}，${target.fileCount} 文件）`,
        `  项目目录: ${projectDir}`,
        '  时间线上下文（前后各 2 条）:',
        ...context,
        '  待执行动作: 将工作区文件恢复到目标快照状态（当前未提交的变更会被覆盖）',
        '  确认执行请带 human_confirmed=true 重新调用；放弃请忽略本消息。',
      ].join('\n'),
      data: {
        isError: false,
        executed: false,
        awaitingHuman: true,
        sha: target.sha,
        projectDir,
        decisionLogged: false,
        message: '破坏性操作未确认——挂起等待人审（human_confirmed=true 才执行）',
      },
    };
  }

  // ── 人审已确认——执行恢复 ──
  let restored: string[];
  try {
    restored = restoreSnapshot(projectDir, target.sha);
  } catch (err) {
    return fail(`恢复执行失败: ${err instanceof Error ? err.message : String(err)}`, target.sha);
  }

  // 审计留痕（kind=CONFIG_CHANGE——工作区状态回退最贴近该语义）
  let decisionLogged = false;
  try {
    const audit = (await import('@sofagent/audit')) as unknown as {
      emitDecision: (input: {
        agentId: string;
        sessionId: string;
        kind: string;
        moment: string;
        why: string;
        specRef?: string;
        artifactRef?: string;
        evidence?: string[];
      }) => unknown;
    };
    audit.emitDecision({
      agentId: 'sofagent-mcp-snapshot-restore',
      sessionId: `snapshot-restore-${Date.now()}`,
      kind: 'CONFIG_CHANGE',
      moment: 'ACT',
      why: `快照恢复已执行（人工确认）: 恢复 ${restored.length} 个文件到 ${target.shortSha}${args.comment ? ` · 备注: ${args.comment}` : ''}`,
      artifactRef: projectDir,
      evidence: [
        `target sha=${target.sha} timestamp=${target.timestamp}`,
        `restored ${restored.length} files`,
        ...(args.comment ? [`human comment: ${args.comment}`] : []),
      ],
    });
    decisionLogged = true;
  } catch {
    // best-effort——恢复已完成不回滚
  }

  return {
    text: [
      '[sofagent] ✅ 快照恢复已执行（人工确认）:',
      `  恢复到: ${target.sha}（${target.timestamp}）`,
      `  恢复文件: ${restored.length} 个`,
      decisionLogged ? '  审计留痕: decision-log（kind=CONFIG_CHANGE）已写入' : '  ⚠️ 审计留痕失败（best-effort 降级，恢复本身已完成）',
      '  建议: 恢复后运行 build + test 验证（snapshot 恢复不自动验证）。',
    ].join('\n'),
    data: {
      isError: false,
      executed: true,
      awaitingHuman: false,
      sha: target.sha,
      projectDir,
      restoredFiles: restored.length,
      decisionLogged,
    },
  };
}
