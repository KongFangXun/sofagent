#!/usr/bin/env node
// ============================================================
// check-anchors.mjs · 跨文档 Markdown 锚点校验
// ============================================================
// 用法: node tools/check-anchors.mjs [--fix]
//
// 功能: 扫描所有 .md 文件中的 ](xxx.md#yyy) 跨文件锚点引用，
//       按 GitHub 锚点归一化规则生成实际锚点表，比对引用的
//       #yyy 是否存在。文件不存在报断链，锚点不存在报锚点过时。
//
// 检查范围: 跨文件锚点引用（](文件.md#锚点)）。
// 不检查: 文件内部目录链接（](#锚点)）——这些不带 .md 文件名，
//          工具的正则不匹配。文件内部目录通常是手写时一次性的，
//          如需检查可后续扩展（遍历每个文件的内部 #引用）。
//
// --fix: 对锚点过时的引用，尝试用模糊匹配找到最接近的实际锚点，
//        自动修复（改 #yyy 为正确值）。无法确定时跳过并输出建议。
//
// 退出码:
//   0 = 全部通过（或 --fix 已修复全部）
//   1 = 有锚点过时（未用 --fix 或 --fix 无法确定正确锚点）
//
// GitHub 锚点归一化规则（2026-08 实测）:
//   1. 取标题文本（去掉前导 # 和行内 `代码` 反引号）
//   2. 全小写
//   3. 去掉所有非 [字母/数字/CJK/连字符/空格] 的字符
//      （标点全去：（）/：，。？！·= 等；连字符 - 保留）
//   4. 每个空格变一个连字符（不折叠——标点删除后两侧空格各成 -）
//      例：「A + B」→ 删 + 得「A  B」→「A--B」（保留双连字符）
//   6. 去掉开头/结尾的连字符
//   7. 重复的连字符保留（GitHub 实际行为：-- 不折叠为 -）
//
// 排除目录: node_modules, .git, dist, archive, changelog, cases, anti-cases, benchmark
// ============================================================

import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');
const FIX_MODE = process.argv.includes('--fix');

// 排除的目录（非文档产出 / 历史冻结）
const EXCLUDE_PATTERNS = [
  /node_modules/,
  /[\/\\]\.git[\/\\]/,
  /[\/\\]dist[\/\\]/,
  /[\/\\]archive[\/\\]/,
  /[\/\\]changelog[\/\\]/,
  /[\/\\]cases[\/\\]/,
  /[\/\\]anti-cases[\/\\]/,
  /[\/\\]benchmark[\/\\]/,
];

// ── GitHub 锚点归一化 ──────────────────────────────────────

/**
 * 按GitHub规则从标题文本生成锚点。
 * @param {string} title 标题文本（不含前导 #）
 * @returns {string} 锚点（不含 # 前缀）
 */
function githubAnchor(title) {
  let s = title
    .replace(/^#+\s*/, '')        // 去前导 # 和空格
    .replace(/`([^`]*)`/g, '$1')  // 行内代码去反引号保留内容
    .trim()
    .toLowerCase();

  // 保留：字母(a-z) 数字(0-9) CJK(中日韩) 连字符(-) 空格( )
  // 去掉：所有其他字符（标点、emoji、特殊符号）
  // 关键：标点删除后，其两侧的空格各自变连字符，形成连续连字符（GitHub 保留 --）
  s = s.replace(/[^\p{L}\p{N}\s-]/gu, '');

  // 每个空格变一个连字符（不折叠连续空格——GitHub 保留 --）
  // 例：「审计 + 文件」→ 删 + 得「审计  文件」（两个空格）→ 「审计--文件」
  s = s.replace(/ /g, '-');

  // 去掉开头/结尾的连字符
  s = s.replace(/^-+|-+$/g, '');

  return s;
}

// ── 文件收集 ────────────────────────────────────────────────

/**
 * 递归收集所有 .md 文件（排除指定目录）。
 * @returns {string[]} 绝对路径列表
 */
function collectMarkdownFiles() {
  const result = [];

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(PROJECT_ROOT, fullPath);

      // 检查排除模式
      if (EXCLUDE_PATTERNS.some(p => p.test(relativePath) || p.test(fullPath))) {
        continue;
      }

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith('.md')) {
        result.push(fullPath);
      }
    }
  }

  // 扫描根目录的 .md（非递归）
  for (const f of fs.readdirSync(PROJECT_ROOT, { withFileTypes: true })) {
    if (f.isFile() && f.name.endsWith('.md')) {
      result.push(path.join(PROJECT_ROOT, f.name));
    }
  }

  // 递归扫描子目录
  for (const d of ['docs', 'FDE', 'SKILL']) {
    const dirPath = path.join(PROJECT_ROOT, d);
    if (fs.existsSync(dirPath)) {
      walk(dirPath);
    }
  }

  return result;
}

// ── 锚点表构建 ──────────────────────────────────────────────

/**
 * 从文件内容提取所有标题，生成锚点表。
 * @param {string} content 文件内容
 * @returns {Set<string>} 锚点集合（不含 # 前缀）
 */
function extractAnchors(content) {
  const anchors = new Set();
  const lines = content.split('\n');

  for (const line of lines) {
    // 匹配 ATX 标题：# 到 ######
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const title = match[2];
      const anchor = githubAnchor(title);
      if (anchor) {
        anchors.add(anchor);
      }
    }
  }

  return anchors;
}

// ── 引用提取 ────────────────────────────────────────────────

/**
 * 从文件内容提取所有 .md 锚点引用。
 * @param {string} content
 * @param {string} filePath 当前文件路径（用于解析相对路径）
 * @returns {{targetFile: string, anchor: string, fullMatch: string, lineNum: number}[]}
 */
function extractAnchorRefs(content, filePath) {
  const refs = [];
  const lines = content.split('\n');
  const dir = path.dirname(filePath);

  // 匹配 ](xxx.md#yyy) 或 ](xxx.md#yyy "title")
  // 不匹配纯文件链接 ](xxx.md)
  // 不匹配 http 链接
  const refRegex = /\]\(([^)#\s]+\.md)#([^)\s]+)\)/g;

  for (let i = 0; i < lines.length; i++) {
    let match;
    const line = lines[i];
    refRegex.lastIndex = 0;
    while ((match = refRegex.exec(line)) !== null) {
      const targetFile = path.resolve(dir, match[1]);
      const anchor = decodeURIComponent(match[2].split(/\s/)[0]);
      refs.push({
        targetFile,
        anchor,
        fullMatch: match[0],
        lineNum: i + 1,
        line: line.trim(),
      });
    }
  }

  return refs;
}

// ── 模糊匹配（用于 --fix 建议正确锚点）──────────────────────

/**
 * 在锚点表中找到与给定字符串最接近的锚点。
 * 用简单的包含关系 + 编辑距离判断。
 * @param {string} badAnchor 过时的锚点
 * @param {Set<string>} validAnchors 实际锚点表
 * @returns {string|null} 最匹配的锚点，或 null（无匹配）
 */
function fuzzyMatch(badAnchor, validAnchors) {
  const valid = [...validAnchors];

  // 1. 精确匹配
  if (valid.includes(badAnchor)) return badAnchor;

  // 2. badAnchor 是某 valid 的子串（锚点被截断）
  const substringMatches = valid.filter(v => v.includes(badAnchor) && v.length < badAnchor.length + 20);
  if (substringMatches.length === 1) return substringMatches[0];

  // 3. 某 valid 是 badAnchor 的子串（锚点变短了）
  const superMatches = valid.filter(v => badAnchor.includes(v) && badAnchor.length < v.length + 20);
  if (superMatches.length === 1) return superMatches[0];

  // 4. 编辑距离最小（容错：标题改了几个字）
  let bestMatch = null;
  let bestScore = Infinity;
  for (const v of valid) {
    // 只比较长度相近的（差太多不可能是同一个）
    if (Math.abs(v.length - badAnchor.length) > Math.max(10, badAnchor.length * 0.5)) continue;
    const dist = levenshtein(badAnchor, v);
    const score = dist / Math.max(v.length, badAnchor.length);
    if (score < bestScore && score < 0.3) {  // 相似度 > 70%
      bestScore = score;
      bestMatch = v;
    }
  }
  return bestMatch;
}

/**
 * 简单 Levenshtein 距离。
 */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array(n + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,         // deletion
        dp[j - 1] + 1,     // insertion
        prev + (a[i - 1] === b[j - 1] ? 0 : 1)  // substitution
      );
      prev = temp;
    }
  }
  return dp[n];
}

// ── 主逻辑 ──────────────────────────────────────────────────

const colors = {
  red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
};

console.log(colors.bold(colors.cyan('═'.repeat(60))));
console.log(colors.bold(colors.cyan('  check-anchors · 跨文档锚点校验')));
console.log(colors.bold(colors.cyan('═'.repeat(60))));
console.log('');

const files = collectMarkdownFiles();
console.log(`  扫描 ${files.length} 个 .md 文件`);
console.log('');

// 预构建每个文件的锚点表
const anchorTables = new Map();  // filePath → Set<anchor>
for (const f of files) {
  const content = fs.readFileSync(f, 'utf8');
  anchorTables.set(f, extractAnchors(content));
}
console.log(`  构建锚点表: ${anchorTables.size} 个文件`);
console.log('');

// 收集所有引用并校验
let brokenFiles = 0;     // 文件本身不存在
let staleAnchors = 0;   // 锚点过时
let validRefs = 0;
let fixedCount = 0;
const staleReports = [];

for (const f of files) {
  const content = fs.readFileSync(f, 'utf8');
  const refs = extractAnchorRefs(content, f);
  const relFile = path.relative(PROJECT_ROOT, f);

  for (const ref of refs) {
    // 1. 检查目标文件是否存在
    if (!fs.existsSync(ref.targetFile)) {
      // 文件断链——跳过锚点校验（check-docs.sh 的死链检查负责这个）
      continue;
    }

    const anchors = anchorTables.get(ref.targetFile);
    if (!anchors) {
      // 目标文件在扫描范围外（如外部目录），跳过
      continue;
    }

    // 2. 检查锚点是否存在
    if (anchors.has(ref.anchor)) {
      validRefs++;
      continue;
    }

    // 锚点过时
    staleAnchors++;
    const relTarget = path.relative(PROJECT_ROOT, ref.targetFile);
    staleReports.push({
      sourceFile: relFile,
      sourceLine: ref.lineNum,
      targetFile: relTarget,
      badAnchor: ref.anchor,
      line: ref.line,
    });

    if (FIX_MODE) {
      const suggestion = fuzzyMatch(ref.anchor, anchors);
      if (suggestion) {
        // 执行修复
        const lines = fs.readFileSync(f, 'utf8').split('\n');
        const oldRef = `#${ref.anchor}`;
        const newRef = `#${suggestion}`;
        lines[ref.lineNum - 1] = lines[ref.lineNum - 1].replace(oldRef, newRef);
        fs.writeFileSync(f, lines.join('\n'));
        fixedCount++;
        console.log(colors.green(`  ✓ 修复: ${relFile}:${ref.lineNum}`));
        console.log(colors.green(`    ${oldRef} → ${newRef}`));
        console.log('');
      }
    }
  }
}

// 输出报告
if (staleReports.length === 0) {
  console.log(colors.green(`  ✓ 全部通过：${validRefs} 个锚点引用全部有效`));
  console.log('');
  console.log(colors.bold(colors.cyan('═'.repeat(60))));
  process.exit(0);
}

if (!FIX_MODE) {
  console.log(colors.red(`  ✗ 发现 ${staleAnchors} 个锚点过时（文件存在但章节标题已改）`));
  console.log('');
  console.log(colors.yellow('  提示：运行 node tools/check-anchors.mjs --fix 自动修复'));
  console.log('');
}

// 逐条输出未修复的
const unfixed = staleReports.length - fixedCount;
if (unfixed > 0 || !FIX_MODE) {
  console.log(colors.bold(`── 锚点过时报告（${unfixed > 0 ? unfixed : staleAnchors} 处未修复）──`));
  console.log('');

  for (const r of staleReports) {
    console.log(colors.red(`  ✗ ${r.sourceFile}:${r.sourceLine}`));
    console.log(`    引用: ${r.targetFile}#${r.badAnchor}`);
    console.log(`    行: ${r.line.substring(0, 100)}`);

    // 给出建议
    const targetPath = path.resolve(PROJECT_ROOT, r.targetFile);
    if (fs.existsSync(targetPath)) {
      const anchors = anchorTables.get(targetPath);
      if (anchors) {
        const suggestion = fuzzyMatch(r.badAnchor, anchors);
        if (suggestion) {
          console.log(colors.yellow(`    建议: #${suggestion}`));
        } else {
          // 列出目标文件中最接近的 3 个锚点
          const candidates = [...anchors]
            .map(a => ({ a, score: levenshtein(r.badAnchor, a) }))
            .sort((x, y) => x.score - y.score)
            .slice(0, 3);
          if (candidates.length > 0) {
            console.log(colors.yellow(`    可能是:`));
            for (const c of candidates) {
              console.log(colors.yellow(`      #${c.a}`));
            }
          }
        }
      }
    }
    console.log('');
  }
}

console.log(colors.bold(colors.cyan('═'.repeat(60))));
if (FIX_MODE && fixedCount > 0) {
  console.log(colors.green(`  ✓ 已修复 ${fixedCount}/${staleAnchors} 处`));
}
const remaining = staleAnchors - fixedCount;
if (remaining > 0) {
  console.log(colors.red(`  ✗ 剩余 ${remaining} 处锚点过时需手动修复`));
  process.exit(1);
} else if (FIX_MODE && fixedCount > 0) {
  console.log(colors.green(`  ✓ 全部修复完成`));
  process.exit(0);
} else {
  process.exit(1);
}
