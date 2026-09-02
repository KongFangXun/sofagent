#!/usr/bin/env node
// check-spec-first.mjs — spec-first 硬禁令门禁（只提示不阻断）
//
// 单一事实源纪律的工程化：涉及 engine/*/src 的代码提交，commit message
// 须含 spec 关联标记（`spec: <路径>`）或显式豁免（`no-spec: <理由>`）。
// 无标记无豁免 → WARN（新机制渐进纪律，跑一个版本观察误报率再议升级 FAIL）。
//
// 识别规则：
//   - 变更文件含 engine/*/src/ 前缀的 commit 才检查（纯文档/工具/scripts 不查）
//   - message 含 `spec:` 前缀引用（workflow/fde/task 文件路径）= 合规
//   - message 含 `no-spec:` + 理由 = 显式豁免
//   - merge commit（Merge/Pull Request #）跳过（合并不是新变更语义）
//
// 用法：node tools/check/check-spec-first.mjs [--N 30]
//   缺省查最近 30 条；exit 恒 0（WARN 不阻断——观察期纪律）

import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
let n = 30;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--N' && args[i + 1]) {
    n = parseInt(args[i + 1], 10);
    i++;
  }
}

const REPO_ROOT = new URL('../..', import.meta.url).pathname;

function git(...gitArgs) {
  return execFileSync('git', gitArgs, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

console.log(`=== check-spec-first · 近 ${n} 条 commit spec 关联检查（WARN only）===`);

// 取近 N 条 commit：sha + subject 一行制（%x09 分隔）
const log = git('log', `-${n}`, '--pretty=format:%H%x09%s');
const commits = log
  .split('\n')
  .filter((l) => l.trim() !== '')
  .map((l) => {
    const idx = l.indexOf('\t');
    return { sha: l.slice(0, idx), subject: l.slice(idx + 1) };
  });

const isMerge = (s) => /^Merge (branch|pull request|remote-tracking)/i.test(s);
const hasSpecRef = (s) => /\bspec:\s*\S+/.test(s);
const hasNoSpec = (s) => /\bno-spec:\s*\S+/.test(s);

let codeCommits = 0;
let compliant = 0;
let exempted = 0;
const violations = [];

for (const c of commits) {
  if (isMerge(c.subject)) continue;
  // 变更文件是否含 engine/*/src
  let files = '';
  try {
    files = git('show', '--name-only', '--pretty=format:', c.sha);
  } catch {
    continue; // 历史对象缺失（浅克隆边缘）——跳过
  }
  const touchesEngineSrc = files
    .split('\n')
    .some((f) => /^engine\/[^/]+\/src\//.test(f.trim()));
  if (!touchesEngineSrc) continue;

  codeCommits += 1;
  if (hasSpecRef(c.subject)) {
    compliant += 1;
  } else if (hasNoSpec(c.subject)) {
    exempted += 1;
  } else {
    violations.push(c);
  }
}

console.log(`  代码提交（含 engine/*/src 变更）: ${codeCommits}`);
console.log(`  ✓ spec: 标记: ${compliant}`);
console.log(`  ✓ no-spec: 豁免: ${exempted}`);

if (violations.length > 0) {
  const rate = codeCommits > 0 ? Math.round(((codeCommits - violations.length) / codeCommits) * 100) : 100;
  console.log(`  ⚠ 无标记无豁免: ${violations.length}（覆盖率 ${rate}%）`);
  for (const v of violations.slice(0, 10)) {
    console.log(`    - ${v.sha.slice(0, 8)} ${v.subject.slice(0, 70)}`);
  }
  if (violations.length > 10) console.log(`    … 其余 ${violations.length - 10} 条省略`);
  console.log('  ⚠ spec-first 纪律（WARN only · 观察期）：代码提交建议携带 spec: <路径> 或 no-spec: <理由>');
} else {
  const rate = codeCommits > 0 ? 100 : 100;
  console.log(`  ✓ spec 关联覆盖率 ${rate}%（全部合规或豁免）`);
}

process.exit(0);
