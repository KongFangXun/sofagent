#!/usr/bin/env node
// ============================================================
// tools/check/lib/listed-badges.mjs · F-37：收录徽章对账辅助
// ============================================================
// 目的：把 README 里 `*-listed-brightgreen` 徽章的「被某 Awesome 仓收录」声称
// 变成可执行核查（假社交证明有连坐效应——一枚假徽章让其余真徽章一起被质疑）。
//
// 🔴 判据选择（实测教训）：**不用 `search/code` API**——GitHub 代码搜索对
// 超大 README（punkpeye/awesome-mcp-servers 达 1.86MB）索引不全，实测
// 「PR 已 merged 且 README 含本仓名」仍返回 total_count=0（假阴性）。
// 权威判据 = 取目标仓 README **全文 blob**（git/trees → git/blobs，base64 解码）
// 后 grep 本仓名。README 不存在/取不到时才回退 code search。
//
// 用法：node tools/check/lib/listed-badges.mjs [readmePath]
// 输出（stdout，逐行）：`<状态>\t<repo>\t<说明>`
//   状态 ∈ OK（已收录）/ MISSING（未收录 = 假声称）/ SKIP（环境限制——不假绿也不假红）
//
// 🔴 能力边界（必须与「通过」区分）：本检查依赖 gh CLI + 网络。**封闭环境（CI 无网、
//   gh 未安装、API 限流）下本检查恒为 SKIP = 断言未生效**——调用方（check-storefront）
//   会把 SKIP 计入 skipped 并显式打印，但读者不可把「门禁通过」读成「徽章已验证」。
//   真要靠它守门，需在有 gh 的环境定期跑（或人工季检 5 枚徽章的目标仓收录状态）。
// 退出码：0 = 无 MISSING；1 = 存在 MISSING
// ============================================================

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const readmePath = process.argv[2] ?? path.join(ROOT, 'README.md');

/** 抽取 README 中 *-listed-brightgreen 徽章的目标仓（去重、归一化为 owner/repo） */
function extractListedRepos(text) {
  // badge 名允许 URL 编码字符（%20 等）与括号编码；目标 URL 允许带 `/blob/...` 子路径
  const re = /badge\/[^")\s]+-listed-brightgreen\)?\]\((https:\/\/github\.com\/([^/\s)]+)\/([^\s)]+?))\)?(?=\]|\)|\s|$)/g;
  const out = new Map(); // repo → 徽章指向的具体文件路径（可为空）
  let m;
  while ((m = re.exec(text)) !== null) {
    const owner = m[2];
    const repo = m[3].replace(/\/blob\/.*$/, '').replace(/\.git$/, '').replace(/[.,;:]+$/, '');
    const key = `${owner}/${repo.split('/')[0]}`;
    // 提取 URL 全串里的 /blob/<branch>/<path> 形态（徽章可指向具体文件如 PLUGINS.md）
    const blobMatch = m[1].match(/\/blob\/[^/]+\/(.+)$/);
    if (!out.has(key) || (blobMatch && !out.get(key))) {
      out.set(key, blobMatch ? blobMatch[1] : '');
    }
  }
  return [...out.entries()];
}

function ghAvailable() {
  try {
    execFileSync('gh', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function gh(args, timeout = 30_000) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout,
    // 🔴 maxBuffer：超大 README（如 punkpeye 1.86MB）base64 后超 execFileSync
    // 默认 1MB 上限会抛错——实测根因，故显式抬高。
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** 取目标仓 README 全文（blob 形态——绕开 /readme 端点的 512KB 截断与代码搜索的索引不全） */
function readmeFullText(repo, targetPath) {
  // 先找默认分支
  let branch = '';
  try {
    branch = gh(['api', `repos/${repo}`, '--jq', '.default_branch']).trim();
  } catch {
    return null;
  }
  if (!branch) return null;
  // 徽章指向具体文件（如 PLUGINS.md）时只读该文件；否则试 README 常见三种大小写
  const candidates = targetPath ? [targetPath] : ['README.md', 'readme.md', 'README.MD'];
  for (const name of candidates) {
    let sha = '';
    try {
      sha = gh(['api', `repos/${repo}/git/trees/${branch}`, '--jq', `.tree[] | select(.path=="${name}") | .sha`]).trim();
    } catch {
      continue;
    }
    if (!sha) continue;
    try {
      const b64 = gh(['api', `repos/${repo}/git/blobs/${sha}`, '--jq', '.content']);
      return Buffer.from(b64.replace(/\s+/g, ''), 'base64').toString('utf8');
    } catch {
      continue;
    }
  }
  return null;
}

/** 回退判据：code search（README 取不到时用；已知对超大文件不全——仅作兜底） */
function codeSearchCount(repo) {
  try {
    const out = gh(['api', `search/code?q=sofagent+repo:${repo}`, '--jq', '.total_count']);
    const n = Number.parseInt(out.trim(), 10);
    return Number.isNaN(n) ? null : n;
  } catch {
    return null;
  }
}

function main() {
  let text = '';
  try {
    text = readFileSync(readmePath, 'utf8');
  } catch (e) {
    process.stdout.write(`SKIP\t-\tREADME 不可读（${e.message}）\n`);
    process.exit(0);
  }
  const repos = extractListedRepos(text);
  if (repos.length === 0) {
    process.stdout.write('SKIP\t-\tREADME 无 *-listed-brightgreen 收录徽章\n');
    process.exit(0);
  }
  if (!ghAvailable()) {
    process.stdout.write('SKIP\t-\tgh 不可用——收录徽章对账跳过（环境限制）\n');
    process.exit(0);
  }
  let missing = 0;
  for (const [repo, targetPath] of repos) {
    const full = readmeFullText(repo, targetPath);
    if (full !== null) {
      const hits = (full.match(/sofagent/gi) || []).length;
      if (hits > 0) {
        process.stdout.write(`OK\t${repo}\tREADME 全文含本仓名（${hits} 处命中）\n`);
      } else {
        process.stdout.write(`MISSING\t${repo}\tREADME 全文无本仓名——徽章为不实声称，删除或改「PR open」态\n`);
        missing++;
      }
      continue;
    }
    // README 取不到 → 回退 code search（并声明判据降级）
    const n = codeSearchCount(repo);
    if (n === null) {
      process.stdout.write(`SKIP\t${repo}\tREADME 与检索均不可得（网络/权限）\n`);
    } else if (n > 0) {
      process.stdout.write(`OK\t${repo}\t检索命中（${n}）——注：README 全文不可得，判据降级\n`);
    } else {
      // 不可复核 ≠ 假声称——记 SKIP 并提示人工复核（不判红，防假红）
      process.stdout.write(`SKIP\t${repo}\tREADME 与检索均不可得（检索 0 命中但判据不可靠）——请人工复核\n`);
    }
  }
  process.exit(missing > 0 ? 1 : 0);
}

main();
