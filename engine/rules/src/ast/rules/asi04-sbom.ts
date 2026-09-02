// ============================================================
// asi04-sbom.ts · OWASP ASI04 供应链 SBOM 检测
// v1.4.4（一）：扫描依赖清单（package.json / go.mod）→ 生成 SBOM →
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

/** 依赖清单文件匹配——lockfile 优先（精确版本），manifest 兜底（range 近似） */
const MANIFEST_FILE = /(package-lock\.json|npm-shrinkwrap\.json|package\.json|go\.mod|go\.sum)$/;

/** 剥离 npm 版本前缀（^1.2.3 → 1.2.3） */
function stripPrefix(v: string): string {
  return v.replace(/^[\^~>=<\s]+/, '').split(' ')[0] ?? v;
}

/** 判断版本串是否带 range 前缀（^ / ~ / 区间），带则命中结果不确定 */
function hasRangePrefix(v: string): boolean {
  return /^[\^~<>]/.test(v);
}

/**
 * 解析 package-lock.json → SBOM 条目（精确锁定版本——v2/v3 的 packages 对象；v1 兜底 dependencies 嵌套）。
 * v1.3.9 阶段四修复（fresh-eyes 视角7）：ASI04 此前只扫 manifest 的 range（^4.17.20），
 * range 宽则误报、窄则漏报（注释自承「精确锁定版本在 lock 文件里」）。本函数用 lockfile
 * 的精确版本做漏洞匹配——消除假阳/假阴；manifest 仅作无 lockfile 时的 fallback。
 */
export function parsePackageLock(text: string): SbomEntry[] {
  let lock: {
    packages?: Record<string, { version?: string }>;
    dependencies?: Record<string, { version?: string; dependencies?: Record<string, { version?: string }> }>;
  };
  try {
    lock = JSON.parse(text) as typeof lock;
  } catch {
    return [];
  }
  const entries: SbomEntry[] = [];
  // v2/v3：packages 对象，key 如 "node_modules/foo" / ""（根）
  if (lock.packages) {
    for (const [key, meta] of Object.entries(lock.packages)) {
      if (!key || key === '' || !meta?.version) continue; // 跳过根包（""）与 workspace 链接（version 缺失）
      entries.push({ name: key.replace(/^node_modules\//, ''), version: meta.version, ecosystem: 'npm', line: 1 });
    }
    return entries;
  }
  // v1：dependencies 嵌套（含 transitive）
  const walk = (deps: Record<string, { version?: string; dependencies?: Record<string, { version?: string }> }> | undefined) => {
    if (!deps) return;
    for (const [name, meta] of Object.entries(deps)) {
      if (meta?.version) entries.push({ name, version: meta.version, ecosystem: 'npm', line: 1 });
      walk(meta?.dependencies);
    }
  };
  walk(lock.dependencies);
  return entries;
}

/**
 * 解析 package.json → SBOM 条目。
 * 版本声明形如 "^4.17.20"——无 lockfile 时剥离前缀近似（保守：命中漏洞标「range 不确定」）。
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

/** 生成 SBOM（按清单类型分派）——lockfile 优先（精确），manifest 兜底（range） */
export function buildSbom(path: string, text: string): SbomEntry[] {
  if (path.endsWith('package-lock.json') || path.endsWith('npm-shrinkwrap.json')) return parsePackageLock(text);
  if (path.endsWith('package.json')) return parsePackageJson(text);
  if (path.endsWith('go.mod')) return parseGoMod(text);
  return [];
}

export const asi04SbomRule: AstRule = {
  id: 'asi04-sbom',
  name: 'OWASP ASI04 供应链 SBOM 检测',
  severity: 'FAIL',
  description: '扫描依赖清单（lockfile 优先精确版本，manifest 兜底）生成 SBOM 并查离线样例漏洞库（受损插件注入恶意行为的供应链面）',
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
          // lockfile 精确命中 = 确定；manifest range 命中 = 不确定（区间内存在受影响版本，需核对 lockfile）
          const isLock = /package-lock\.json|npm-shrinkwrap\.json/.test(ctx.path);
          const qualifier = isLock ? '' : `（manifest range，受影响版本区间内；建议核对 ${entry.name.split('/')[0]}-lock 锁定版本）`;
          ctx.report(
            entry.line,
            `[ASI04] 依赖 ${entry.name}@${entry.version} 命中已知漏洞 ${adv.id}（${adv.summary}）${qualifier}`
          );
        }
      }
    }
  },
};
