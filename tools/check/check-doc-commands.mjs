#!/usr/bin/env node
// check-doc-commands.mjs · 文档命令 ↔ CLI 机械对账门禁（v1.7.0 BUG-39）
// ============================================================
// 职责：抽取文档中反引号包裹的 `sofagent <域>[ <动作>…]` 命令串，
// 与 umbrella 单入口 CLI 的真实命令集（help 实跑 + DOMAINS 表静态读取）
// 对账——文档教的每条命令都必须真实存在。
//
// 判定（红/绿）：
//   - 文档命令的 <域> 不在真实域集 → 红（file:line）
//   - <域> 合法但 <动作> 不在该域 help 输出中 → 红
//   - 带 flag 形态（--xxx）不校验 flag（flag 面太宽，留给人审）
//   - 豁免台账 tools/check/doc-commands-exempt.json（file+anchor+理由）
//
// 防空转：每轮必须报告「扫描 N 文档 / 提取 M 命令 / 校验 K 条」——
// 全零即判红（守卫空转防御，对齐仓内既有纪律）。
//
// reverse-probe 口径（登记于 tools/check/gate-inventory 亦可复验）：
//   注入：文档临时写 `sofagent daemon pause` → 红（daemon 域下无顶层 pause）
//   还原：删除该行 → 绿
// ============================================================

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const UMBRELLA = join(REPO, 'engine/umbrella/bin/sofagent.js');
const EXEMPT_PATH = join(REPO, 'tools/check/doc-commands-exempt.json');

// ── 一、真实命令集采集 ──────────────────────────────────────
// 保留字（产品级面，umbrella help 原文）
const RESERVED = ['status', 'where', 'version', 'dashboard', 'web', 'data', 'help'];

function collectDomains() {
  // 双源：① umbrella help 实跑（域行形态「sofagent <域> →」）② bin/sofagent.js DOMAINS 静态键
  const out = execFileSync('node', [UMBRELLA, 'help'], { encoding: 'utf-8', cwd: REPO });
  const domains = new Set(RESERVED);
  for (const m of out.matchAll(/^\s+sofagent\s+([a-z][a-z0-9-]*)\s+→/gm)) domains.add(m[1]);
  // 静态兜底：help 文案漏列的域仍可从 DOMAINS 表读出
  try {
    const src = readFileSync(UMBRELLA, 'utf-8');
    for (const m of src.matchAll(/^\s{2}'([a-z][a-z0-9-]*)':\s*\{/gm)) domains.add(m[1]);
  } catch { /* 静态源缺失时以 help 实跑为准 */ }
  return domains;
}

function collectActions(domain) {
  // 各域 --help 输出中的子命令集。两个提取面：
  //   ① Usage 行「sofagent <域> <动作>」完整形态（主入口命令教学面）
  //   ② 缩进动作名列（如 daemon help 的「  knowledge status」形态——嵌套子命令
  //     不经完整前缀打印，仅缩进+空格分列）。后者取前两词为「一级动作 二级动作」，
  //     同时登记「一级动作」本身（嵌套面的一级词——如 knowledge），
  //     使 `sofagent daemon knowledge pause` 与 `sofagent daemon knowledge` 均可对账。
  const actions = new Set();
  let out = '';
  try {
    out = execFileSync('node', [UMBRELLA, domain, '--help'], { encoding: 'utf-8', cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { /* 无 --help 的域：动作面空（只校验域存在） */ }
  for (const m of out.matchAll(new RegExp(`sofagent\\s+${domain}\\s+([a-z][a-z0-9-]*)`, 'g'))) actions.add(m[1]);
  for (const m of out.matchAll(/^\s{2,}([a-z][a-z0-9-]*)(?:\s+([a-z][a-z0-9-]*))?/gm)) {
    const first = m[1];
    // 跳过纯 flag 行（首 token 以 -- 开头不会命中；second 为 flag 时只登记一级词）
    actions.add(first);
    if (m[2] && !m[2].startsWith('--')) actions.add(`${first} ${m[2]}`);
  }
  return actions;
}

const DOMAINS = collectDomains();
const ACTION_CACHE = new Map();
function actionsOf(domain) {
  if (!ACTION_CACHE.has(domain)) ACTION_CACHE.set(domain, collectActions(domain));
  return ACTION_CACHE.get(domain);
}

// ── 二、文档扫描面 ──────────────────────────────────────────
// 核心 README 双语 + docs 主文档 + FDE 入口（对齐任务书 BUG-39 面；changelog 冻结区不扫）
const DOC_FILES = [
  'README.md', 'README.en.md',
  'docs/WIKI.md', 'docs/HANDBOOK.md', 'docs/ARCHITECTURE.md',
  'docs/PHILOSOPHY.md', 'docs/ROADMAP.md', 'docs/LIMITATIONS.md',
  'FDE/README.md', 'FDE/GUIDE.md',
];

// 命令形态：反引号内 sofagent 开头，后接域词与可选动作词（flag 跳过）
const CMD_RE = /`sofagent\s+([a-z][a-z0-9-]*)(?:\s+([a-z][a-z0-9-]*))?(?:\s[^`]*)?`/g;
// 白名单词形：命令位置出现但非「域/动作」的合法形态（占位符与子命令枚举行）
const PLACEHOLDER = new Set(['<域>', '<动作>', '<domain>', '<range>', 'audit-demo-sandbox']);

// ── 三、豁免台账 ────────────────────────────────────────────
const exempts = existsSync(EXEMPT_PATH)
  ? JSON.parse(readFileSync(EXEMPT_PATH, 'utf-8')).exempts || []
  : [];
function isExempt(file, line, anchor) {
  return exempts.some(e =>
    (e.file === file || e.file.endsWith('/' + file) || file.endsWith(e.file)) &&
    anchor.includes(e.anchor));
}

// ── 四、扫描与判定 ──────────────────────────────────────────
const violations = [];
let scanned = 0, extracted = 0, checked = 0;

for (const rel of DOC_FILES) {
  const abs = join(REPO, rel);
  if (!existsSync(abs)) continue;
  scanned += 1;
  const lines = readFileSync(abs, 'utf-8').split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(CMD_RE)) {
      const [, dom, act] = m;
      if (PLACEHOLDER.has(dom) || PLACEHOLDER.has(act)) continue;
      extracted += 1;
      // 豁免：file+anchor 命中（行级）
      if (isExempt(rel, i + 1, line)) continue;
      checked += 1;
      if (!DOMAINS.has(dom)) {
        violations.push(`${rel}:${i + 1} 未知域 \`${dom}\` —— ${line.trim().slice(0, 90)}`);
        continue;
      }
      if (act) {
        const acts = actionsOf(dom);
        // 域 help 为空（无子命令面）时不校验动作（域存在即可）。
        // 二级形态：文档命令带 <域> <一级> <二级>（如 daemon knowledge pause）——
        // 校验「一级」与「一级 二级」组合双口径；顶层单动作按单词校验。
        const rest = m[0].slice(1, -1).split(/\s+/).slice(2).filter(w => !w.startsWith('-') && !w.startsWith('<') && !w.startsWith('$') && /^[a-z][a-z0-9-]*$/.test(w));
        if (rest.length === 0) continue;
        const first = rest[0];
        const pair = rest.length >= 2 ? `${first} ${rest[1]}` : null;
        if (acts.size > 0 && !acts.has(first) && !(pair && acts.has(pair))) {
          violations.push(`${rel}:${i + 1} 域 ${dom} 下未见动作 \`${first}${pair ? ' ' + rest[1] : ''}\` —— ${line.trim().slice(0, 90)}`);
        }
      }
    }
  });
}

// ── 五、输出与退出码 ────────────────────────────────────────
console.log(`[check-doc-commands] 扫描 ${scanned} 文档 / 提取 ${extracted} 命令 / 校验 ${checked} 条（真实域集 ${DOMAINS.size}）`);
if (scanned === 0 || extracted === 0) {
  console.error('❌ 守卫空转：扫描面或提取数为零——检查文档清单与正则是否失配');
  process.exit(2);
}
if (violations.length > 0) {
  console.error(`❌ 文档命令与 CLI 真实命令树不符（${violations.length} 处）：`);
  for (const v of violations) console.error('  ' + v);
  console.error('  修法：文档命令改真实形态（node engine/umbrella/bin/sofagent.js <域> --help 核对）；确属例外的登记 tools/check/doc-commands-exempt.json');
  process.exit(1);
}
console.log('✅ check-doc-commands：文档命令与 CLI 命令树对账一致（豁免 ' + exempts.length + ' 条登记）');
