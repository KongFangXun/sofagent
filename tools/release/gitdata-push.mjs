#!/usr/bin/env node
/**
 * gitdata-push.mjs — Git Data API 推送通道（git push 不可用时的兜底）
 *
 * 背景：WorkBuddy 环境代理端口漂移 / CONNECT 隧道 502 时，git push 反复失败，
 * 但 gh CLI 走 api.github.com 通道通常仍可用。本脚本用 Git Data API
 * （blobs → trees → commits → refs PATCH）把本地未推送的 commits 推到远端。
 *
 * 实战记录：
 *   - v1.3.8：82 commits 全量推送（四坑：base64 / eol / cat-file / tree mode 丢执行位）
 *   - v1.4.0：阶段十二收尾 2 commits 推送（本脚本由此固化）
 *
 * 用法：
 *   node tools/release/gitdata-push.mjs              # 推送 origin/main..HEAD 的所有改动
 *   node tools/release/gitdata-push.mjs -m "消息"    # 自定义 commit message（默认聚合各 commit 主题）
 *
 * 验收标准（v1.3.8 血泪铁律）：
 *   远端 tree sha == 本地 HEAD tree sha，逐字节一致才算成功。
 *   脚本内置该验收，不一致时 exit 1。
 *
 * 推送后必做（网络恢复后）：
 *   git fetch origin && git rebase --onto origin/main <本地等价点> main
 *   （API commit 与本地 commit 同内容不同 SHA，git 会识别 cherry-pick 重复自动消化；
 *    本地等价点 = git log --all --format="%h %T" | grep " <tree-sha>"）
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const REPO_SLUG = 'KongFangXun/sofagent';
const BRANCH = 'main';

// ── 参数 ──
const args = process.argv.slice(2);
const msgFlagIdx = args.indexOf('-m');
const customMsg = msgFlagIdx !== -1 ? args[msgFlagIdx + 1] : null;

// ── 工具函数 ──
const sh = (cmd, opts = {}) => execSync(cmd, { encoding: 'utf8', cwd: REPO_ROOT, ...opts }).trim();

// gh api 封装：--jq 失败时回退原始 JSON 自行解析（gh 版本差异兜底）
function ghApi(endpoint, fields) {
  const fieldArgs = fields.map(f => (f.startsWith('-F') || f.startsWith('-f') || f.startsWith('--') ? f : `-f ${f}`)).join(' ');
  const raw = sh(`gh api repos/${REPO_SLUG}/${endpoint} ${fieldArgs}`);
  return raw;
}
function jqOrParse(raw, pick) {
  const t = raw.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    return pick(JSON.parse(t));
  }
  return t;
}

console.log(`▶ Git Data API 推送通道（repo=${REPO_SLUG} branch=${BRANCH}）`);

// ── 前置检查 ──
const dirty = sh('git status --porcelain');
if (dirty) {
  console.error('🔴 工作树不干净——先 commit 或 stash 再推：\n' + dirty);
  process.exit(1);
}

// 获取远端 main 当前 SHA（fetch 失败时走 gh api 查 ref）
// ⚠️ 必须以 gh api 实时值为准：本地 origin/main 在连续 API 推送后必然陈旧，
//    且陈旧 SHA（如 27c6a071）本地有对象——会走错 git diff 路径漏掉中间变更
let remoteSha;
const liveRemote = jqOrParse(ghApi('git/refs/heads/' + BRANCH, []), j => j.object.sha);
try {
  const localRef = sh('git rev-parse origin/main');
  if (liveRemote && liveRemote !== localRef) {
    console.log(`ℹ️ 本地 origin/main(${localRef.slice(0, 8)}) 陈旧，远端实际 ${liveRemote.slice(0, 8)}——以远端为准`);
  }
} catch { /* 无本地 ref 记录 */ }
remoteSha = liveRemote;

const headSha = sh('git rev-parse HEAD');
if (remoteSha === headSha) {
  console.log('✅ 远端已与 HEAD 一致，无需推送');
  process.exit(0);
}

// 待推文件（remote..HEAD 之间的全部变更：新增/修改/删除）
// 🔴 连续 API 推送场景：remoteSha 是上次 API commit，本地对象库没有它，git diff 直接炸
//    （v1.4.0 复盘实测）。⚠️ compare API 兜底是错的——head 参数在 GitHub 侧解析为远端
//    分支头，看不见本地 commit（实测 compare/xxx...HEAD 返回 identical 假阴性）。
//    正确姿势：远端 tree API（recursive）vs 本地 git ls-tree -r HEAD 按 path→blob sha 双向对齐
let changed;
// cat-file exit 128 = 对象不在本地；sh() 会 throw——用 try 捕获而不是 `|| true`（子 shell 管道下 || true 不接住 execSync 的非零退出）
let haveRemoteObj = false;
try { sh('git cat-file -t ' + remoteSha + ' 2>/dev/null'); haveRemoteObj = true; } catch { haveRemoteObj = false; }
if (haveRemoteObj) {
  changed = sh(`git diff --name-status ${remoteSha}..HEAD`);
} else {
  console.log(`ℹ️ 本地无远端对象 ${remoteSha.slice(0, 8)}（上次 API 推送遗留）——远端 tree API 对齐兜底`);
  const remoteCommitTree = jqOrParse(ghApi(`git/commits/${remoteSha}`, []), j => j.tree.sha);
  const rtRaw = ghApi(`git/trees/${remoteCommitTree}?recursive=1`, []);
  const remoteMap = new Map(jqOrParse(rtRaw, j => j)
    .tree.filter(e => e.type === 'blob')
    .map(e => [e.path, e.sha]));
  const localMap = new Map(sh('git ls-tree -r HEAD')
    .split('\n').filter(Boolean)
    .map(l => { const m = l.match(/^(\d+)\s+blob\s+([0-9a-f]+)\t(.+)$/); return m ? [m[3], m[2]] : null; })
    .filter(Boolean));
  const lines = [];
  for (const [p, sha] of localMap) {
    if (!remoteMap.has(p)) lines.push(`A\t${p}`);
    else if (remoteMap.get(p) !== sha) lines.push(`M\t${p}`);
  }
  for (const p of remoteMap.keys()) {
    if (!localMap.has(p)) lines.push(`D\t${p}`);
  }
  changed = lines.join('\n');
}
const entries = changed.split('\n').filter(Boolean).map(line => {
  const [status, ...rest] = line.split('\t');
  // rename (R100\told\tnew) 取新路径；删除 (D) 单独标记
  const filePath = rest[rest.length - 1];
  return { status, path: filePath };
});
console.log(`待同步变更：${entries.length} 个文件`);
if (!entries.length) {
  console.log('ℹ️ 无文件变更（纯元数据 commit？）——仍继续建 commit');
}

// ── ① blobs（mode 从本地 git 读取，保 .sh 执行位——v1.3.8 第四坑）──
const treeItems = [];
for (const e of entries) {
  if (e.status === 'D') {
    treeItems.push({ path: e.path, deletion: true });
    console.log(` 🗑 删除: ${e.path}`);
    continue;
  }
  const abs = path.join(REPO_ROOT, e.path);
  if (!fs.existsSync(abs)) {
    console.error(`🔴 文件不存在：${e.path}（状态 ${e.status}）`);
    process.exit(1);
  }
  // mode + 规范内容同源：本地有跟踪时读 git ls-tree 的真实 mode，内容用
  // git cat-file blob <sha> 取 git 规范版本（非工作区文件）。
  // 🔴 ps1 eol 二坑（v1.3.8 首犯 + v1.4.2 阶段十再犯）：
  //    .gitattributes `*.ps1 text eol=crlf` 下工作区是 CRLF、git blob 是 LF 规范版；
  //    fs.readFileSync 读工作区上传 → 远端 blob sha 与本地 tree 分叉（v1.4.2 实测 11 个 .ps1）。
  //    必须走 cat-file 规范内容，blob sha 才与本地 HEAD tree 逐字节一致。
  let mode = '100644';
  let b64 = null;
  try {
    const lsLine = sh(`git ls-tree HEAD -- "${e.path}"`);
    if (lsLine) {
      mode = lsLine.slice(0, 6).trim(); // 100755 可执行 / 100644 常规（保 .sh 执行位——v1.3.8 第四坑）
      const m = lsLine.match(/blob ([0-9a-f]{40})/);
      if (m) {
        const canonical = sh(`git cat-file blob ${m[1]}`);
        b64 = Buffer.from(canonical, 'utf8').toString('base64');
      }
    }
  } catch { /* HEAD 无跟踪（理论不可达——entries 全来自 HEAD diff/ls-tree） */ }
  if (b64 === null) b64 = fs.readFileSync(abs).toString('base64'); // 兜底：仅 HEAD 未跟踪时读工作区
  const blobRaw = ghApi('git/blobs', [`content=${b64}`, 'encoding=base64']);
  const blobSha = jqOrParse(blobRaw, j => j.sha);
  treeItems.push({ path: e.path, mode, type: 'blob', sha: blobSha });
  console.log(` blob: ${e.path} ${blobSha.slice(0, 8)} (${mode})`);
}

// ── ② tree（基于远端 base tree 增量）──
const baseTree = jqOrParse(ghApi(`git/commits/${remoteSha}`, []), j => j.tree.sha);
const treeEntries = treeItems.filter(t => !t.deletion).map(t => ({
  path: t.path, mode: t.mode, type: 'blob', sha: t.sha
}));
// create-tree 无法表达删除（v1.3.8 第三坑）——删除项收集起来走 Contents API 补删
let newTree;
if (treeEntries.length) {
  // 🔴 传参方式：必须走 stdin JSON（--input -），禁命令行拼 tree[][path]=…
  //    ——17 文件 = 68 个数组参数，gh CLI「accepts 1 arg(s)」直接炸（v1.4.0 复盘实测）
  const treeBody = JSON.stringify({ base_tree: baseTree, tree: treeEntries });
  const raw = sh('gh api repos/' + REPO_SLUG + '/git/trees --input -', { input: treeBody });
  newTree = jqOrParse(raw, j => j.sha);
} else {
  newTree = baseTree; // 无增改（纯删除场景在下方处理）
}
console.log(`tree: ${newTree.slice(0, 8)}（base ${baseTree.slice(0, 8)}）`);

// ── ③ commit ──
// msg 聚合：本地有远端对象用 git log range；没有（连续推送）退化取 HEAD 一条 subject
const msg = customMsg || (() => {
  let subjects;
  try {
    subjects = sh(`git log --format=%s ${remoteSha}..HEAD`).split('\n').filter(Boolean);
  } catch {
    subjects = [sh('git log -1 --format=%s HEAD')];
  }
  return `chore: Git Data API 推送（${subjects.length} commits 聚合）——${subjects.slice(0, 3).join(' / ')}${subjects.length > 3 ? ' …' : ''}`;
})();
const commitRaw = sh(`gh api repos/${REPO_SLUG}/git/commits -f message="${msg.replace(/"/g, '\\"')}" -f tree=${newTree} -f "parents[]=${remoteSha}"`);
const newCommit = jqOrParse(commitRaw, j => j.sha);
console.log(`commit: ${newCommit.slice(0, 8)}`);

// ── ④ ref 快进 ──
const refRaw = sh(`gh api repos/${REPO_SLUG}/git/refs/heads/${BRANCH} -X PATCH -f sha=${newCommit}`);
const pushedSha = jqOrParse(refRaw, j => j.object.sha);
console.log(`远端 ${BRANCH} → ${pushedSha.slice(0, 8)}`);

// ── ⑤ 删除文件补删（Contents API——v1.3.8 第三坑：create-tree 无法表达删除）──
for (const t of treeItems) {
  if (!t.deletion) continue;
  try {
    const info = jqOrParse(ghApi(`contents/${t.path}?ref=${BRANCH}`, []), j => j.sha);
    sh(`gh api repos/${REPO_SLUG}/contents/${t.path} -X DELETE -f message="chore: remove ${t.path}" -f sha=${info}`);
    console.log(` 🗑 Contents API 补删成功: ${t.path}`);
  } catch (e) {
    console.error(`🔴 删除失败（须手动处理）：${t.path}\n${e.message}`);
    process.exit(1);
  }
}

// ── ⑥ 验收：远端 tree == 本地 HEAD tree（逐字节一致）──
const localTree = sh('git rev-parse HEAD^{tree}');
const finalTree = jqOrParse(ghApi(`git/commits/${pushedSha}`, []), j => j.tree.sha);
console.log(`local  tree: ${localTree.slice(0, 8)}`);
console.log(`remote tree: ${finalTree.slice(0, 8)}`);
if (localTree !== finalTree) {
  console.error('🔴 tree 不一致——推送不完整，人工排查（对比 git diff origin/HEAD..HEAD 与远端）');
  process.exit(1);
}

console.log('✅ 推送完成，tree 逐字节一致');
console.log(`
⏭ 网络恢复后必做（对齐双 SHA）：
  git fetch origin
  git rebase --onto origin/main ${headSha.slice(0, 8)} ${BRANCH}
  （API commit 与本地 commit 同内容不同 SHA，rebase 自动消化重复 patch）`);