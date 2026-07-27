// ============================================================
// session-report.ts · 审计 session 产物（P0：审计结果 session 可见性）
// 新增文件（审计结果 session 可见性，v1.1.x 开发周期内落地）
//
// 职责：把 AuditResult + 上下文序列化为 data/audit/session-report.json
// 与 session-report.md，供当前或未来任意 Agent 随时读取——这是
// "work body 可见性" 与 "未来用户 Agent 可见性" 的落点。
//
// 设计原则：
//   - 默认开启，受 --no-session 控制（不写文件）。
//   - 产物写入失败时由调用方 try/catch 吞掉，不影响审计 exit code。
//   - [sofagent] 三层签名之一：MD 产物带 [sofagent] 前缀。
// ============================================================

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import type { AuditResult } from './reporter';
import type { DiffFile } from '@sofagent/core';
import { VERSION, resolveAuditDir } from '@sofagent/core';
import { getFixSuggestion } from './fix-suggestions';

/** session 报告聚合结构（写入 data/audit/session-report.json） */
export interface SessionReport {
  timestamp: string;
  /** `sofagent-audit v${VERSION}` */
  engine: string;
  version: string;
  exitCode: number;
  status: 'PASS' | 'WARN' | 'FAIL';
  ruleCount: number;
  passCount: number;
  warnCount: number;
  failCount: number;
  skipCount: number;
  task?: string;
  commitSha?: string;
  files: { path: string; status: string }[];
  violations: { rule: string; status: string; detail: string; fix?: string }[];
}

/** 构建 session 报告聚合对象（纯函数，不落盘） */
export function buildSessionReport(
  results: AuditResult,
  diffFiles: DiffFile[],
  opts: { task?: string; commitSha?: string }
): SessionReport {
  const n = results.rules.length;
  const failCount = results.rules.filter((r) => r.status === 'FAIL').length;
  const warnCount = results.rules.filter((r) => r.status === 'WARN').length;
  const skipCount = results.rules.filter((r) => r.status === 'SKIPPED').length;
  const passCount = n - failCount - warnCount - skipCount;

  // status 由 exitCode 推导（与 printResults 判定一致）
  const status: SessionReport['status'] =
    results.exitCode === 0 ? 'PASS' : results.exitCode === 1 ? 'WARN' : 'FAIL';

  // files[]：每个 diffFile 的 path + 该文件涉及的规则最严重状态
  // 反查：规则 detail 是否提到该文件路径；拿不到则标 AFFECTED
  const files = diffFiles.map((f) => ({
    path: f.path,
    status: inferFileStatus(f, results) ?? 'AFFECTED',
  }));

  // violations[]：所有非 PASS 规则（SKIPPED 不计为违规/警告）
  const violations = results.rules
    .filter((r) => r.status !== 'PASS' && r.status !== 'SKIPPED')
    .map((r) => ({
      rule: r.name,
      status: r.status,
      detail: r.details.join(' | ') || '（无详情）',
      fix: getFixSuggestion(r.name) ?? undefined,
    }));

  return {
    timestamp: new Date().toISOString(),
    engine: `sofagent-audit v${VERSION}`,
    version: VERSION,
    exitCode: results.exitCode,
    status,
    ruleCount: n,
    passCount,
    warnCount,
    failCount,
    skipCount,
    task: opts.task,
    commitSha: opts.commitSha,
    files,
    violations,
  };
}

/** 从规则反查某文件涉及的最严重状态；无关联则 undefined（调用处降级为 AFFECTED） */
function inferFileStatus(file: DiffFile, results: AuditResult): string | undefined {
  let best: string | undefined;
  let bestRank = -1;
  for (const r of results.rules) {
    if (r.status === 'PASS') continue;
    const mentioned = r.details.some((d) => d.includes(file.path));
    if (mentioned) {
      const rank = severityRank(r.status);
      if (rank > bestRank) {
        bestRank = rank;
        best = r.status;
      }
    }
  }
  return best;
}

/** 状态严重度排序：FAIL > WARN > SKIPPED > PASS */
function severityRank(status: string): number {
  switch (status) {
    case 'FAIL':
      return 3;
    case 'WARN':
      return 2;
    case 'SKIPPED':
      return 1;
    default:
      return 0;
  }
}

/** 渲染人读 Markdown 摘要（镜像 banner 但精简，含 [sofagent] 签名） */
function renderMarkdown(report: SessionReport): string {
  const icon = report.status === 'PASS' ? '✅' : report.status === 'WARN' ? '⚠️' : '❌';
  const statusLine =
    report.status === 'PASS'
      ? '审计通过 · exit 0'
      : report.status === 'WARN'
        ? `审计 ${report.warnCount} 警告 · exit 1`
        : `审计拦截 ${report.failCount} 违规 · exit 2`;

  const lines: string[] = [];
  lines.push(`# [sofagent] 审计 session 报告`);
  lines.push('');
  lines.push(`${icon} **${statusLine}**`);
  lines.push('');
  lines.push(`- 引擎：${report.engine}`);
  lines.push(
    `- 检查数：${report.ruleCount}（通过 ${report.passCount} · 警告 ${report.warnCount} · 违规 ${report.failCount} · 跳过 ${report.skipCount}）`
  );
  if (report.task) lines.push(`- 任务：${report.task}`);
  if (report.commitSha) lines.push(`- 提交：${report.commitSha}`);
  lines.push(`- 时间：${report.timestamp}`);
  lines.push('');

  if (report.files.length > 0) {
    lines.push(`## 变更文件（${report.files.length}）`);
    lines.push('');
    lines.push(`| 文件 | 状态 |`);
    lines.push(`| --- | --- |`);
    for (const f of report.files) {
      lines.push(`| ${f.path} | ${f.status} |`);
    }
    lines.push('');
  }

  if (report.violations.length > 0) {
    lines.push(`## 违规 / 警告明细`);
    lines.push('');
    for (const v of report.violations) {
      const vIcon = v.status === 'FAIL' ? '❌' : '⚠️';
      lines.push(`### ${vIcon} [sofagent] ${v.rule} (${v.status})`);
      lines.push('');
      lines.push(`- 详情：${v.detail}`);
      if (v.fix) lines.push(`- 怎么修：${v.fix}`);
      lines.push('');
    }
  }

  lines.push(`---`);
  lines.push(`[sofagent] 判定: ${statusLine} · exit code ${report.exitCode}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * 把报告写入 projectDir/data/audit/（session-report.json + session-report.md）
 * v1.2.1：从 .sofagent/audit/ 迁移到 data/audit/
 * @returns 两个文件的绝对路径
 */
export function writeSessionReport(
  report: SessionReport,
  projectDir: string
): { jsonPath: string; mdPath: string } {
  const dir = resolveAuditDir(projectDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const jsonPath = join(dir, 'session-report.json');
  const mdPath = join(dir, 'session-report.md');
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
  writeFileSync(mdPath, renderMarkdown(report), 'utf-8');
  return { jsonPath, mdPath };
}
