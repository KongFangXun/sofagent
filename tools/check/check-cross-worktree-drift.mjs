#!/usr/bin/env node
// ============================================================
// check-cross-worktree-drift.mjs · 跨 worktree 文档漂移检测器
// ============================================================
// 动机（2026-10-07 实录）：多 session 并行开发已成常态（实测 13 个 worktree 并存），
//   同一文档（ROADMAP / devlog）在两条以上分支各自演进——收口时靠手工 git diff
//   对账（「合并算术 20281−611≈19670」曾是纯手工产物）。现有三个 drift 类工具各管
//   一摊（forge-branches 管 FORGE / seam-drift 管 seam 词表 / template-drift 管模板），
//   没有管「同一文件多分支并行改」的——本脚本补这个缺口。
//
// 算法（O(n) 锚定扫描 · 2026-10-07 二版）：
//   以主分支（main，收敛终点）为锚，每条其余分支只与锚比一次：
//     changed(branch) = diff(merge-base(main, branch)...branch)
//   文件 F 的漂移 = 改过 F 的分支数 ≥2（不含 main 自身改动时的计数规则见下）。
//   ⚠️ 首版是 O(n²) 全对扫描（13 分支 78 对 × 逐文件 diff），实测 8 分钟未跑完——
//   本版锚定后实测秒级。全对扫描的「非锚两侧是否冲突」在收敛合并时由 git 自判，
//   本工具的职责是**收敛前的发现面**，不是合并器。
//
// 报告两档：
//   · 冲突风险（红）：两侧改动在同一文件的 git merge 预演有冲突标记 ⇒ 收敛必处理
//   · 并行演进（黄）：≥2 分支改同一文件但与 main 基线无冲突 ⇒ 合得上，语义需人工过
//
// 用法：
//   node tools/check/check-cross-worktree-drift.mjs            # 漂移检测（默认）
//   node tools/check/check-cross-worktree-drift.mjs --report   # 一页纸：每分支
//               最后活动 / 领先落后 main / 独有改动文件数 / 挂载路径
//   node tools/check/check-cross-worktree-drift.mjs --stale-days 3 --report
//               一页纸 + 三桶分档（可清理/待合并/僵尸）——收敛批开工视图
//   node tools/check/check-cross-worktree-drift.mjs --paths docs/   # 漂移只看某面
//   node tools/check/check-cross-worktree-drift.mjs --json     # 机读
//
// 三桶判据（--stale-days N 时对非锚分支逐条判）：
//   可清理 = git cherry 全等（+ 计 0）——分支全部改动已在 main，worktree 纯冗余
//   待合并 = 有独有改动（cherry 有 +）且最后活动 ≤N 天——活跃工作，勿动
//   僵尸   = 有独有改动且最后活动 >N 天——收敛批优先裁定对象（合并 or 显式弃）
//
// 退出码：0 = 无漂移或仅黄档；1 = 存在红档（合并预演冲突）。
// 定性：**收敛批开工第一眼的自检工具**——不接 pre-push（多分支共存合法，漂移是
//   事实不是违规）。
// ============================================================

import { execFileSync } from 'node:child_process';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
process.chdir(ROOT);

const JSON_MODE = process.argv.includes('--json');
const REPORT_MODE = process.argv.includes('--report');
const STALE_DAYS = (() => {
  const i = process.argv.indexOf('--stale-days');
  return i >= 0 ? Number(process.argv[i + 1]) : null;
})();
const PATHS_PREFIX = (() => {
  const i = process.argv.indexOf('--paths');
  return i >= 0 ? process.argv[i + 1].replace(/\/+$/, '') : null;
})();

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    return `${e.stdout ?? ''}`;
  }
}

// ── 锚与分支清单 ──
const ANCHOR = 'main';
const branches = sh('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'])
  .split('\n').filter(Boolean);
const others = branches.filter((b) => b !== ANCHOR);

// worktree 挂载表（分支 → 路径）
const wtMap = new Map(
  sh('git', ['worktree', 'list', '--porcelain'])
    .split('\nworktree ')
    .filter(Boolean)
    .map((blk) => {
      const p = blk.split('\n')[0];
      const bl = blk.split('\n').find((l) => l.startsWith('branch '));
      return bl ? [bl.replace('branch refs/heads/', '').trim(), p] : null;
    })
    .filter(Boolean)
);

if (others.length === 0) {
  if (!JSON_MODE) console.log(`✓ 仅 ${ANCHOR} 一条分支——无漂移可言`);
  process.exit(0);
}

// ── 一页纸模式（--report）：每分支卫生视图 + 可选三桶（--stale-days N）──
if (REPORT_MODE) {
  const DAY_MS = 86400000;
  const now = Date.now();
  const rows = [];
  for (const b of branches) {
    const lastTs = Number(sh('git', ['log', '-1', '--format=%ct', b]).trim()) * 1000;
    const daysAgo = Math.floor((now - lastTs) / DAY_MS);
    const ahead = sh('git', ['rev-list', '--count', `${ANCHOR}..${b}`]).trim();
    const behind = sh('git', ['rev-list', '--count', `${b}..${ANCHOR}`]).trim();
    // 独有改动 = cherry +（补丁级）计；改动文件数用 diff merge-base
    const cherryPlus = sh('git', ['cherry', ANCHOR, b]).split('\n').filter((l) => l.startsWith('+')).length;
    const base = sh('git', ['merge-base', ANCHOR, b]).trim();
    const filesN = base ? sh('git', ['diff', '--name-only', `${base}...${b}`]).split('\n').filter(Boolean).length : 0;
    let bucket = '';
    if (b !== ANCHOR && STALE_DAYS !== null) {
      if (cherryPlus === 0) bucket = '可清理';
      else if (daysAgo <= STALE_DAYS) bucket = '待合并(活跃)';
      else bucket = '僵尸';
    }
    rows.push({ branch: b, daysAgo, ahead: Number(ahead), behind: Number(behind), uniquePatches: cherryPlus, files: filesN, wt: wtMap.get(b) ?? '', bucket });
  }
  if (JSON_MODE) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    console.log(`═══ worktree 卫生一页纸（锚=${ANCHOR} · ${branches.length} 分支）${STALE_DAYS !== null ? ` · 三桶阈值 ${STALE_DAYS} 天` : ''} ═══`);
    console.log('');
    const pad = (x, n) => String(x).padEnd(n);
    console.log(`  ${pad('分支', 30)}${pad('最后活动', 8)}${pad('领先', 5)}${pad('落后', 5)}${pad('独有补丁', 8)}${pad('改动文件', 8)}${pad('桶', 12)}挂载`);
    for (const r of rows.sort((a, b2) => b2.daysAgo - a.daysAgo)) {
      console.log(`  ${pad(r.branch, 30)}${pad(r.daysAgo + 'd', 8)}${pad(r.ahead, 5)}${pad(r.behind, 5)}${pad(r.uniquePatches, 8)}${pad(r.files, 8)}${pad(r.bucket, 12)}${r.wt ? '✓ ' + r.wt : '—'}`);
    }
    console.log('');
    if (STALE_DAYS !== null) {
      const cleanable = rows.filter((r) => r.bucket === '可清理');
      const active = rows.filter((r) => r.bucket === '待合并(活跃)');
      const zombie = rows.filter((r) => r.bucket === '僵尸');
      console.log(`  三桶汇总：可清理 ${cleanable.length}（改动已全在 main——git worktree remove + git branch -d 即可）· 待合并 ${active.length}（活跃勿动）· 僵尸 ${zombie.length}（收敛批优先裁定：合并 or 显式弃）`);
      if (zombie.length > 0) {
        console.log('  僵尸清单：');
        for (const z of zombie) console.log(`    · ${z.branch}（${z.daysAgo}d 未动 · ${z.uniquePatches} 独有补丁 · ${z.files} 文件）`);
      }
    }
    console.log('');
    console.log('  修法：可清理 ⇒ git worktree remove <path> && git branch -d <branch>；');
    console.log('  僵尸 ⇒ 逐支裁定（合并进收敛批 or git branch -D 显式弃——弃前留 diff 备份）。');
  }
  process.exit(0);
}

// ── 每条分支相对锚的改动文件集（每分支 2 次 git 调用）──
const changedOn = new Map(); // branch -> Set<file>
for (const b of others) {
  const base = sh('git', ['merge-base', ANCHOR, b]).trim();
  if (!base) { changedOn.set(b, new Set()); continue; }
  const files = sh('git', ['diff', '--name-only', `${base}...${b}`]).split('\n').filter(Boolean);
  changedOn.set(b, new Set(files));
}

// ── 文件 → 改它的分支们 ──
const fileBranches = new Map();
for (const b of others) {
  for (const f of changedOn.get(b)) {
    if (PATHS_PREFIX && !f.startsWith(PATHS_PREFIX)) continue;
    if (!fileBranches.has(f)) fileBranches.set(f, []);
    fileBranches.get(f).push(b);
  }
}

// ── 分档：红 = git merge-tree 预演有冲突；黄 = 多分支改但与锚无冲突 ──
const reds = [];
const yellows = [];
for (const [f, bs] of fileBranches) {
  const uniq = [...new Set(bs)];
  if (uniq.length === 0) continue;
  // 单分支改且该文件锚上没动 ⇒ 不构成「多分支漂移」（是正常未合并工作）——跳过
  // 多分支改 OR 锚自身也在锚后被改过且分支也改 ⇒ 进检测
  const anchorAlsoChanged = (() => {
    // main 上该文件在 max(merge-base) 之后是否有改动难以一概而论——用「任一分支的
    // merge-base 到 main HEAD 该文件有 diff」近似（多分支时取首个 merge-base 即可，
    // 判定面是提示级）
    const base = sh('git', ['merge-base', ANCHOR, uniq[0]]).trim();
    if (!base) return false;
    return sh('git', ['diff', '--name-only', `${base}..${ANCHOR}`, '--', f]).trim().length > 0;
  })();

  if (uniq.length >= 2 || anchorAlsoChanged) {
    // merge-tree 预演（git ≥2.38 无需工作区）——对首个分支与锚预演即可判「与锚冲突」
    const base = sh('git', ['merge-base', ANCHOR, uniq[0]]).trim();
    const mt = sh('git', ['merge-tree', '--write-tree', base, ANCHOR, uniq[0]]);
    const hasConflict = mt.includes('CONFLICT') || sh('git', ['merge-tree', '--write-tree', base, ANCHOR, uniq[0]], ) === '' ? false : mt.split('\n').some((l) => l.includes('CONFLICT'));
    const entry = { file: f, branches: uniq, anchorAlsoChanged, wt: uniq.map((b) => wtMap.get(b) ? '✓' : '—') };
    if (hasConflict) reds.push(entry); else yellows.push(entry);
  }
}

if (JSON_MODE) {
  console.log(JSON.stringify({ anchor: ANCHOR, branches: others.length + 1, reds, yellows }, null, 2));
} else {
  console.log(`═══ 跨分支漂移检测（锚=${ANCHOR} · 其余 ${others.length} 分支）═══`);
  console.log('');
  if (reds.length === 0 && yellows.length === 0) {
    console.log('  ✓ 无同一文件多分支并行改动');
  }
  if (reds.length > 0) {
    console.log(`  🔴 冲突风险 ${reds.length} 文件（merge 预演有冲突标记——收敛前必须裁定）：`);
    for (const d of reds) {
      console.log(`     ${d.file}  ← ${d.branches.join(' × ')}${d.anchorAlsoChanged ? '（锚上也已改动）' : ''}`);
    }
    console.log('');
  }
  if (yellows.length > 0) {
    console.log(`  🟡 并行演进 ${yellows.length} 文件（可自动合并但语义需人工过）：`);
    for (const d of yellows) {
      console.log(`     ${d.file}  ← ${d.branches.join(' × ')}${d.anchorAlsoChanged ? '（锚上也已改动）' : ''}`);
    }
    console.log('');
  }
  console.log('  修法：红档在合并前逐文件裁定保哪版（两侧作者或维护者）；黄档合并后必跑');
  console.log('  bash tools/check/check-docs-all.sh --fast（语法合得上但口径可能矛盾——六维评分抓语义）。');
}

process.exit(reds.length > 0 ? 1 : 0);
