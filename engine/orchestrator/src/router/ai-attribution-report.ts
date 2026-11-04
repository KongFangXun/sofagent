// ============================================================
// AI 参与度报告（v1.9 §六 · 生产调用点）
// ------------------------------------------------------------
// 分工：`judge-observability.computeAiParticipation` 只做**纯计算**（不碰 git）；
// 本模块负责**取数 + 渲染**，由 `cli.ts` 的 `judge-attribution` 子命令调用。
// 口径真值：`docs/AI-ATTRIBUTION.md`（S3 §十二·四 裁定）；本文件不定义口径，只消费。
// ============================================================

import { execFileSync } from 'child_process';
import {
  computeAiParticipation,
  AI_ACCOUNT_DOMAINS,
  type AiParticipation,
  type CommitMeta,
} from './judge-observability';

/** 记录分隔符（\x1e 行段 / \x1f 字段段——避免 commit message 里的换行把记录切碎） */
const REC = '\x1e';
const FLD = '\x1f';

/**
 * 从 git 读提交元数据。
 * 默认全量；`limit` 给窗口大小（判据要求「窗口」可声明）。
 */
export function readCommitMeta(cwd: string = process.cwd(), limit?: number): CommitMeta[] {
  const fmt = ['%H', '%ae', '%ce', '%B'].join(FLD);
  const args = ['log', `--format=${fmt}${REC}`];
  if (typeof limit === 'number' && limit > 0) args.push('-n', String(limit));
  const out = execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  return out
    .split(REC)
    .map((s) => s.replace(/^\n+/, '').trimEnd())
    .filter(Boolean)
    .map((rec) => {
      const parts = rec.split(FLD);
      return {
        sha: parts[0] ?? '',
        authorEmail: parts[1] ?? '',
        committerEmail: parts[2] ?? '',
        message: parts.slice(3).join(FLD),
      } satisfies CommitMeta;
    });
}

/**
 * 渲染审计报告节（Markdown）。
 * 三条纪律：① 比例与三条局限注记**同行同出**；② 分轨明细必列（否则读者无法判断分子从哪来）；
 * ③ 零样本报「无数据」不报 0（与 computeAiParticipation 同口径）。
 */
export function renderAiAttributionReport(p: AiParticipation, opts: { window: string; cwd: string }): string {
  const pct = p.ratio === null ? '无数据（窗口内 0 提交）' : `${(p.ratio * 100).toFixed(2)}%（${p.withAiSignal}/${p.total}）`;
  const lines: string[] = [];
  lines.push('## AI 参与度（代码归属）');
  lines.push('');
  lines.push(`- 统计窗口：${opts.window}`);
  lines.push(`- 仓路径：\`${opts.cwd}\``);
  lines.push(`- **AI 参与比例：${pct}**`);
  lines.push(`- 分轨：轨① author/committer 命中 AI 域 **${p.withAiAuthorDomain}** · 轨② trailer 命中 **${p.withAiTrailer}** · 并集 **${p.withAiSignal}**`);
  lines.push(`- AI 账号域清单（${AI_ACCOUNT_DOMAINS.length}）：${AI_ACCOUNT_DOMAINS.map((d) => `\`${d}\``).join(' · ')}`);
  lines.push('');
  lines.push('**局限（随读数同出，缺一条即不可用）**');
  for (const l of p.limitations) lines.push(`- ${l}`);
  lines.push('');
  lines.push('> 口径：双轨归属（邮箱域 / 协作 trailer），真值见 `docs/AI-ATTRIBUTION.md`；只观测不评判，不单独作能力声明。');
  return lines.join('\n');
}

/** 一步到位：取数 → 计算 → 渲染（CLI 与将来的定时报告共用） */
export function buildAiAttributionReport(cwd: string, limit?: number): { text: string; metrics: AiParticipation } {
  const commits = readCommitMeta(cwd, limit);
  const metrics = computeAiParticipation(commits);
  const window = typeof limit === 'number' && limit > 0 ? `最近 ${limit} 次提交` : '全量历史';
  return { text: renderAiAttributionReport(metrics, { window, cwd }), metrics };
}
