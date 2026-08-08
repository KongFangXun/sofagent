// ============================================================
// A10 不引毒源（安全层 · 业务底线）
// 检测依赖文件变更中是否新增非官方源依赖
// 检测文件：package.json / requirements.txt / Cargo.toml
// 非官方源：github raw URL / git+http / 个人服务器 URL
// v1.2.9: 增强 typosquatting 检测 + postinstall 脚本注入检测
// evidenceMode: git-diff
// ============================================================

import { getAddedLines } from '@sofagent/core';
import { DANGEROUS_SCRIPT_CMDS } from '@sofagent/core';
import type { AuditContext, RuleCheck } from './types';

/** 需要扫描的依赖文件名 */
const DEPENDENCY_FILES = new Set([
  'package.json',
  'requirements.txt',
  'Cargo.toml',
  'pyproject.toml',
  'Pipfile',
  'Gemfile',
]);

/** 非官方源模式 */
const POISON_PATTERNS: { pattern: RegExp; name: string }[] = [
  // GitHub raw content URLs
  { pattern: /https?:\/\/raw\.githubusercontent\.com\//i, name: 'GitHub raw URL' },
  // Git+http（非 HTTPS 的 git 协议）
  { pattern: /git\+http:\/\//i, name: 'git+http 不安全协议' },
  // 非官方域名特征（个人服务器 / 内网地址）
  { pattern: /https?:\/\/(?!registry\.npmjs\.org|pypi\.org|files\.pythonhosted\.org|crates\.io|rubygems\.org|repo1\.maven\.org|repo\.maven\.apache\.org)[^/\s"']*\/([a-zA-Z0-9._-]+?)\.(whl|tar\.gz|tgz|gem)\b/i, name: '非官方源 .whl/.tar.gz/.tgz/.gem 包' },
  // 非标准 registry 域名（npm / pip）
  { pattern: /https?:\/\/(?!registry\.npmjs\.org|registry\.yarnpkg\.com)[^/\s"']+\/(?:npm|npm-registry)\//i, name: '非官方 npm registry' },
  { pattern: /https?:\/\/(?!pypi\.org|test\.pypi\.org)[^/\s"']+\/simple\//i, name: '非官方 PyPI 源' },
];

// ============================================================
// v1.2.5: typosquatting 检测
// ============================================================

/** 知名 npm 包列表（typosquatting 参考集） */
const POPULAR_PACKAGES = [
  'lodash', 'express', 'react', 'vue', 'axios', 'commander',
  'chalk', 'debug', 'request', 'moment', 'jquery', 'async',
  'underscore', 'fs-extra', 'body-parser', 'cors', 'dotenv',
  'morgan', 'helmet', 'jsonwebtoken', 'bcrypt', 'mongoose',
  'sequelize', 'typeorm', 'prisma', 'webpack', 'babel', 'eslint',
  'typescript', 'jest', 'mocha', 'vite', 'rollup', 'parcel',
];

/**
 * 计算 Levenshtein 编辑距离
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,       // deletion
        dp[i]![j - 1]! + 1,       // insertion
        dp[i - 1]![j - 1]! + cost, // substitution
      );
    }
  }

  return dp[m]![n]!;
}

/**
 * 检测包名是否疑似 typosquatting
 * @returns 匹配的知名包名（如 `lodsh` → `lodash`），或 null
 */
function checkTyposquat(pkgName: string): string | null {
  const lower = pkgName.toLowerCase();
  for (const popular of POPULAR_PACKAGES) {
    if (lower === popular) return null; // 完全匹配 → 安全
    const dist = levenshtein(lower, popular);
    // 编辑距离 ≤2 且不是完全匹配 → 可疑
    if (dist <= 2 && dist > 0) {
      return popular;
    }
  }
  return null;
}

/**
 * 从 package.json 新增行中提取包名
 * 匹配 "pkg-name": "version" 格式
 */
function extractPackageName(line: string): string | null {
  // 匹配 "pkg-name": "version" 或 'pkg-name': 'version'
  const match = line.match(/["']([a-zA-Z@][a-zA-Z0-9@/._-]*)["']\s*:\s*["']/);
  if (match && match[1]) {
    // 排除 scripts/name/version 等 package.json 顶层字段
    if (!['scripts', 'name', 'version', 'description', 'main', 'type', 'license', 'author', 'private', 'engines', 'dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].includes(match[1])) {
      return match[1];
    }
  }

  // 匹配 dependencies 中的裸包名
  const depMatch = line.match(/^\s*["']([^"']+)["']\s*:/);
  if (depMatch && depMatch[1] && !['dependencies', 'devDependencies', 'scripts', 'name', 'version', 'description'].includes(depMatch[1])) {
    return depMatch[1];
  }

  return null;
}

// ============================================================
// v1.2.5: postinstall/preinstall 脚本注入检测
// ============================================================

/** 需要检测的危险 hook 名称 */
const DANGEROUS_HOOKS = ['preinstall', 'postinstall', 'preuninstall', 'postuninstall'];

/**
 * 检测 package.json scripts 中危险的 hook 脚本
 * @returns { hit, detail } 是否命中 + 详情
 */
function checkPostinstallHook(line: string): { hit: boolean; detail: string } {
  // 检查行是否是 hook 定义（如 "postinstall": "..."）
  for (const hookName of DANGEROUS_HOOKS) {
    const hookPattern = new RegExp(`["']${hookName}["']\\s*:\\s*["']([^"']+)["']`, 'i');
    const match = line.match(hookPattern);
    if (match && match[1]) {
      const script = match[1];
      // 检查脚本内容是否含危险命令
      if (DANGEROUS_SCRIPT_CMDS.test(script)) {
        return { hit: true, detail: `${hookName} 脚本含可疑执行命令: ${script.slice(0, 80)}` };
      }
    }
  }
  return { hit: false, detail: '' };
}

export function checkRuleA10(ctx: AuditContext): RuleCheck {
  const rule: RuleCheck = {
    name: 'A10 不引毒源',
    number: 10,
    status: 'PASS',
    details: [],
    evidenceMode: 'git-diff',
    ruleClass: '业务底线',
  };

  const { diffFiles } = ctx;

  const hits: { file: string; line: string; pattern: string }[] = [];
  const typoHits: { file: string; pkg: string; similar: string }[] = [];
  const postinstallHits: { file: string; detail: string }[] = [];

  for (const file of diffFiles) {
    const fileName = file.path.split('/').pop() || '';
    if (!DEPENDENCY_FILES.has(fileName)) continue;

    const addedLines = getAddedLines(file);
    for (const line of addedLines) {
      // 1. 非官方源检测（原有逻辑）
      for (const { pattern, name } of POISON_PATTERNS) {
        if (pattern.test(line)) {
          hits.push({ file: file.path, line: line.trim(), pattern: name });
          break;
        }
      }

      // 2. v1.2.5: typosquatting 检测（仅 package.json）
      if (fileName === 'package.json') {
        const pkgName = extractPackageName(line);
        if (pkgName) {
          const similar = checkTyposquat(pkgName);
          if (similar) {
            typoHits.push({ file: file.path, pkg: pkgName, similar });
          }
        }
      }

      // 3. v1.2.5: postinstall 脚本注入检测（仅 package.json）
      if (fileName === 'package.json') {
        const hookResult = checkPostinstallHook(line);
        if (hookResult.hit) {
          postinstallHits.push({ file: file.path, detail: hookResult.detail });
        }
      }
    }
  }

  // 汇总——非官方源 + postinstall 注入 → FAIL（安全红线）
  if (hits.length > 0) {
    rule.status = 'FAIL';
    rule.details.push(
      `检测到 ${hits.length} 处非官方源依赖: ` +
      hits.map((h) => `${h.file}: "${h.line}" (${h.pattern})`).join('; ')
    );
  }

  if (postinstallHits.length > 0) {
    rule.status = 'FAIL';
    rule.details.push(
      `检测到 ${postinstallHits.length} 处 postinstall/preinstall 脚本注入: ` +
      postinstallHits.map((h) => `${h.file}: ${h.detail}`).join('; ')
    );
  }

  // typosquatting → FAIL（供应链安全红线）
  if (typoHits.length > 0) {
    rule.status = 'FAIL';
    rule.details.push(
      `检测到 ${typoHits.length} 处疑似 typosquatting 包名: ` +
      typoHits.map((h) => `${h.file}: "${h.pkg}" (疑似仿冒 ${h.similar})`).join('; ')
    );
  }

  return rule;
}
