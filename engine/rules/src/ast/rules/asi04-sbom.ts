// ============================================================
// asi04-sbom.ts · OWASP ASI04 供应链 SBOM 检测
// v1.3.9（一）：扫描依赖清单（package.json / go.mod）→ 生成 SBOM →
// 查离线样例漏洞库（fixtures/vuln-db.json，不依赖 CI 联网）
//
// Microsoft AGT 启发：受损插件/子 agent 经由依赖清单注入恶意行为——
// SBOM 是把「装了什么」变成可审计事实的第一步
// ============================================================

import type { AstRule } from '../types';
import vulnDb from '../fixtures/vuln-db.json';
import { inRange } from './semver';

/** 漏洞库条目形状（fixture JSON） */
interface VulnEntry {
  ranges: string[];
  id: string;
  summary: string;
}

/** SBOM 单条依赖 */
export interface SbomEntry {
  /** 依赖名（npm 包名 / go module path） */
  name: string;
  /** 版本（清单里写的原样版本，含 ^/~ 前缀会被剥离） */
  version: string;
  /** 生态：npm / go */
  ecosystem: 'npm' | 'go';
  /** 来源行号（1-based） */
  line: number;
}

/** 依赖清单文件匹配 */
const MANIFEST_FILE = /(package\.json|go\.mod|go\.sum)$/;

/** 剥离 npm 版本前缀（^1.2.3 → 1.2.3） */
function stripPrefix(v: string): string {
  return v.replace(/^[\^~>=<\s]+/, '').split(' ')[0] ?? v;
}

/**
 * 解析 package.json → SBOM 条目。
 * 版本声明形如 "^4.17.20"——对漏洞区间匹配剥离前缀（区间语义近似的保守取舍，
 * 精确锁定版本在 lock 文件里，manifest 只声明范围）。
 */
export function parsePackageJson(text: string): SbomEntry[] {
  let manifest: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  try {
    manifest = JSON.parse(text) as typeof manifest;
  } catch {
    return [];
  }
  const entries: SbomEntry[] = [];
  const sections = [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.optionalDependencies,
  ];
  for (const section of sections) {
    if (!section) continue;
    for (const [name, version] of Object.entries(section)) {
      entries.push({ name, version: stripPrefix(version), ecosystem: 'npm', line: 1 });
    }
  }
  return entries;
}

/** 解析 go.mod → SBOM 条目（require 行 + require 块两种形态） */
export function parseGoMod(text: string): SbomEntry[] {
  const entries: SbomEntry[] = [];
  const lines = text.split('\n');
  let inRequireBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (trimmed === 'require (') { inRequireBlock = true; continue; }
    if (trimmed === ')') { inRequireBlock = false; continue; }
    const m = inRequireBlock
      ? /^([\w./~-]+)\s+(v[\w.\-+]+)/.exec(trimmed)
      : /^require\s+([\w./~-]+)\s+(v[\w.\-+]+)/.exec(trimmed);
    if (m) {
      // go.mod 版本带 v 前缀（v1.4.0）——剥掉再进区间比较
      entries.push({ name: m[1] ?? '', version: (m[2] ?? '').replace(/^v/, ''), ecosystem: 'go', line: i + 1 });
    }
  }
  return entries;
}

/** 生成 SBOM（按清单类型分派）——导出供 worklog/仪表盘等消费方复用 */
export function buildSbom(path: string, text: string): SbomEntry[] {
  if (path.endsWith('package.json')) return parsePackageJson(text);
  if (path.endsWith('go.mod')) return parseGoMod(text);
  return [];
}

export const asi04SbomRule: AstRule = {
  id: 'asi04-sbom',
  name: 'OWASP ASI04 供应链 SBOM 检测',
  severity: 'FAIL',
  description: '扫描依赖清单生成 SBOM 并查离线样例漏洞库（受损插件注入恶意行为的供应链面）',
  filePattern: MANIFEST_FILE,
  checkText(ctx) {
    const sbom = buildSbom(ctx.path, ctx.text);
    if (sbom.length === 0) return;
    const db = vulnDb as Record<'npm' | 'go', Record<string, VulnEntry[]>>;
    for (const entry of sbom) {
      const advisories = db[entry.ecosystem]?.[entry.name];
      if (!advisories) continue;
      for (const adv of advisories) {
        const hit = adv.ranges.some((range) => inRange(entry.version, range));
        if (hit) {
          ctx.report(
            entry.line,
            `[ASI04] 依赖 ${entry.name}@${entry.version} 命中已知漏洞 ${adv.id}（${adv.summary}）`
          );
        }
      }
    }
  },
};
