// ============================================================
// commands/knowledge-status.ts · `sofagent-daemon knowledge status` 聚合命令
// v1.3.2 新增
//
// 一次性聚合输出「上次 Dream Cycle 时间 + 产出概览 / 知识健康状态 /
// sensitivity 统计」成一页可读报告（LUI 感知 B——把 A 三处的可感知产物
// 汇成一条统一入口）。
//
// 三源：
//   1. knowledge/log.md（Dream Cycle 周报）→ lastDreamCycle
//   2. knowledge/health-report.md（knowledge-health 输出）→ health
//   3. knowledge/ frontmatter sensitivity 计数 → sensitivity
//
// 铁律：
//   - 完全只读——只用 readdirSync/readFileSync/existsSync，禁任何写
//   - 降级优雅——任一源缺失 → 字段 undefined / 0，不抛异常
//   - restricted 只计数不返回内容（复用 core sensitivity 判定，防泄露）
// ============================================================

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

import { resolveSensitivity } from '@sofagent/core';

/** knowledge Views 层四个一等子目录 */
const KNOWLEDGE_SUBDIRS = ['entities', 'concepts', 'comparisons', 'summaries'] as const;

/** knowledge status 聚合报告 */
export interface KnowledgeStatusReport {
  /** 上次 Dream Cycle（缺 log.md 或无周报 → undefined） */
  lastDreamCycle?: {
    /** 周报日期（YYYY-MM-DD） */
    at: string;
    /** 本周学到的 concept 数 */
    concepts: number;
    /** 本周学到的 atom 数 */
    atoms: number;
    /** 来源 audit history 条数 */
    auditEntries: number;
  };
  /** 知识健康状态（缺 health-report.md → findings=0/triggered=false） */
  health: {
    triggered: boolean;
    findings: number;
    severity: string;
  };
  /** sensitivity 统计（缺 knowledge/ → 全 0） */
  sensitivity: {
    public: number;
    internal: number;
    restricted: number;
  };
}

/** 从 frontmatter 提取 sensitivity 字段（最小正则） */
function extractSensitivity(content: string): string | null {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  const fm = fmMatch[1] ?? '';
  const m = fm.match(/^sensitivity:\s*(.+?)\s*$/m);
  return m ? (m[1] ?? null) : null;
}

/** 解析 log.md 最近一段 Dream Cycle 周报 */
function parseLastDreamCycle(logContent: string): KnowledgeStatusReport['lastDreamCycle'] {
  // 匹配「## YYYY-MM-DD Dream Cycle 周报」+「本周学 N 个 concept / M 个 atom，来自 K 条 audit history」
  const blockRe = /##\s+(\d{4}-\d{2}-\d{2})\s+Dream Cycle 周报[\s\S]*?本周学\s+(\d+)\s+个\s+concept\s+\/\s+(\d+)\s+个\s+atom，来自\s+(\d+)\s+条\s+audit\s+history/g;
  let lastMatch: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(logContent)) !== null) {
    lastMatch = m;
  }
  if (!lastMatch) return undefined;
  return {
    at: lastMatch[1] ?? '',
    concepts: parseInt(lastMatch[2] ?? '0', 10),
    atoms: parseInt(lastMatch[3] ?? '0', 10),
    auditEntries: parseInt(lastMatch[4] ?? '0', 10),
  };
}

/** 解析 health-report.md 最近一段巡检报告 */
function parseLastHealthReport(reportContent: string): { findings: number; triggered: boolean } {
  // 每段报告以「## <ISO> knowledge-health 巡检」开头，统计最近一段的 finding 行数
  const blocks = reportContent.split(/^##\s+/m).filter((b) => b.includes('knowledge-health 巡检'));
  if (blocks.length === 0) return { findings: 0, triggered: false };
  const lastBlock = blocks[blocks.length - 1] ?? '';
  // finding 行 = 「- xxx N 项：...」计数行（排除末尾的建议行）
  const findingLines = lastBlock
    .split('\n')
    .filter((line) => /^-\s+.+\d+\s+项/.test(line.trim()));
  return { findings: findingLines.length, triggered: findingLines.length > 0 };
}

/**
 * knowledge status 聚合主入口。
 *
 * @param projectDir 项目根目录
 * @returns KnowledgeStatusReport（只读聚合，任一源缺失优雅降级）
 */
export function knowledgeStatus(projectDir: string): KnowledgeStatusReport {
  const knowledgeDir = join(projectDir, '.sofagent', 'knowledge');

  const report: KnowledgeStatusReport = {
    health: { triggered: false, findings: 0, severity: 'info' },
    sensitivity: { public: 0, internal: 0, restricted: 0 },
  };

  // ── 源 1：log.md → lastDreamCycle ──
  const logPath = join(knowledgeDir, 'log.md');
  if (existsSync(logPath)) {
    try {
      const logContent = readFileSync(logPath, 'utf-8');
      const last = parseLastDreamCycle(logContent);
      if (last) report.lastDreamCycle = last;
    } catch {
      // log.md 不可读 → lastDreamCycle 保持 undefined
    }
  }

  // ── 源 2：health-report.md → health ──
  const healthReportPath = join(knowledgeDir, 'health-report.md');
  if (existsSync(healthReportPath)) {
    try {
      const healthContent = readFileSync(healthReportPath, 'utf-8');
      const parsed = parseLastHealthReport(healthContent);
      report.health = {
        triggered: parsed.triggered,
        findings: parsed.findings,
        severity: parsed.triggered ? 'warning' : 'info',
      };
    } catch {
      // health-report.md 不可读 → 保持默认
    }
  }

  // ── 源 3：frontmatter sensitivity 计数 ──
  for (const subdir of KNOWLEDGE_SUBDIRS) {
    const subdirAbs = join(knowledgeDir, subdir);
    if (!existsSync(subdirAbs)) continue;
    let entries: string[];
    try {
      entries = readdirSync(subdirAbs);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith('.md')) continue;
      if (name === 'index.md') continue;
      let body = '';
      try {
        body = readFileSync(join(subdirAbs, name), 'utf-8');
      } catch {
        continue;
      }
      const raw = extractSensitivity(body);
      // 缺省/非法 → internal（safe-by-default）；restricted 只计数不返回内容
      const level = resolveSensitivity(raw ? { sensitivity: raw } : {});
      report.sensitivity[level] += 1;
    }
  }

  return report;
}

/**
 * 格式化输出（CLI 用）——一页可读报告。
 * restricted 只显示计数，绝不显示条目内容。
 */
export function formatKnowledgeStatus(report: KnowledgeStatusReport): string {
  const lines: string[] = [];
  lines.push('sofagent knowledge status');
  lines.push('');

  // Dream Cycle
  if (report.lastDreamCycle) {
    const dc = report.lastDreamCycle;
    lines.push(`📚 上次 Dream Cycle：${dc.at}`);
    lines.push(`   本周学 ${dc.concepts} 个 concept / ${dc.atoms} 个 atom，来自 ${dc.auditEntries} 条 audit history`);
  } else {
    lines.push('📚 上次 Dream Cycle：尚未运行（无 knowledge/log.md 周报）');
  }
  lines.push('');

  // Health
  if (report.health.triggered) {
    lines.push(`🩺 知识健康：⚠️ ${report.health.findings} 类 finding（severity=${report.health.severity}）`);
  } else {
    lines.push('🩺 知识健康：✅ 无 finding（或尚未跑 knowledge-health）');
  }
  lines.push('');

  // Sensitivity
  const s = report.sensitivity;
  const total = s.public + s.internal + s.restricted;
  lines.push(`🔒 sensitivity 统计（共 ${total} 条）：public=${s.public} / internal=${s.internal} / restricted=${s.restricted}`);
  if (s.restricted > 0) {
    lines.push('   （restricted 仅计数，内容不向未授权上下文返回）');
  }

  return lines.join('\n');
}
