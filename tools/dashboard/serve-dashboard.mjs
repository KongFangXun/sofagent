#!/usr/bin/env node
/**
 * sofagent Dashboard 本地服务器
 *
 * 用法：
 *   node tools/dashboard/serve-dashboard.mjs            # 起服务并自动打开浏览器
 *   DASHBOARD_PORT=4000 node tools/dashboard/serve-dashboard.mjs   # 指定端口
 *   SOFAGENT_HOME=/path node tools/dashboard/serve-dashboard.mjs   # 指定数据目录
 *
 * 提供三类接口：
 *   1. /              → dashboard.html（tools/）
 *   2. /data/*        → ~/.sofagent/data/*（原始数据文件，JSONL 截断最近 500 条）
 *   3. /api/summary   → 复用 bash dashboard 的 jq 聚合口径，返回 JSON 统计
 *                       （PASS/WARN/FAIL、本周 TOP3 违规、主权聚合）
 *                       —— 与 tools/sofagent-dashboard.sh 同一数据口径
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = process.env.DASHBOARD_PORT || 3780;
// v1.4.0 双态路径解析（交付二）：
//   安装态：dashboard.html 在 $SOFAGENT_HOME/web/，serve 脚本在 $SOFAGENT_HOME/bin/（install.sh 部署）
//   仓库态：dashboard.html 在 tools/dashboard/，serve 脚本在仓库内（开发/回归，行为不变）
// 判定：SOFAGENT_HOME 下存在 web/dashboard.html → 安装态；否则回退仓库态
const SOFAGENT_HOME_INSTALL =
  process.env.SOFAGENT_HOME || join(homedir(), '.sofagent');
const INSTALL_WEB_DIR = join(SOFAGENT_HOME_INSTALL, 'web');
const INSTALL_WEB_HTML = join(INSTALL_WEB_DIR, 'dashboard.html');
let DOCS_DIR, DASHBOARD_HTML_REL;
try {
  if (statSync(INSTALL_WEB_HTML).isFile()) {
    // 安装态：web 目录即静态根（dashboard.html 在根）
    DOCS_DIR = INSTALL_WEB_DIR;
    DASHBOARD_HTML_REL = '/dashboard.html';
  } else {
    throw new Error('install web not found');
  }
} catch {
  // 仓库态：tools/dashboard/ 为页面目录，仓库根为 static root（docs/assets/ 静态资源）
  DOCS_DIR = join(__dirname, '../..');
  DASHBOARD_HTML_REL = '/tools/dashboard/dashboard.html';
}
const SOFAGENT_DATA = process.env.SOFAGENT_HOME
  ? join(process.env.SOFAGENT_HOME, 'data')
  : join(homedir(), '.sofagent', 'data');

const HISTORY_FILE = join(SOFAGENT_DATA, 'audit', 'history.jsonl');
const SOVEREIGNTY_DIR = join(SOFAGENT_DATA, 'audit', 'data-sovereignty');
const DAEMON_HEALTH = join(SOFAGENT_DATA, 'dashboard', 'daemon-health.json');
const GRAPH_STATE = join(SOFAGENT_DATA, 'dashboard', 'graph-state.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function tryRead(filePath) {
  try {
    await stat(filePath);
    return await readFile(filePath);
  } catch {
    return null;
  }
}

/* ────────────────────────────────
 * /api/summary · 复用 bash dashboard 的 jq 聚合口径
 * 与 tools/sofagent-dashboard.sh 的 render_rules / render_sovereignty 同一逻辑
 * ──────────────────────────────── */
function runJq(program, input) {
  try {
    return execFileSync('/usr/bin/jq', ['-r', '-s', program], {
      input: input || '',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 15000,
      encoding: 'utf8',
    }).trim();
  } catch (e) {
    return '';
  }
}

/* 测试记录过滤：fixture 泛化任务名（规则测试的故意违规/故意通过样本）
 * ⚠️ 不能用 envFingerprint 字段判断——它是近期真实记录也带的常规字段，会误杀全部近期数据
 * 同名任务出现上百次（"add code" 476 次、"initial commit" 121 次）即 fixture 循环 */
const TEST_TASK_RE = /^(add (env|api|code|dependency|config|file|data)( config)?|fix: update README( title)?|update (config|code|file)|remove file|init: project setup|initial commit|test: rules filtering|test: json scenario|test)$/i;
function isTestRecord(rec) {
  return TEST_TASK_RE.test(String(rec.task || '').trim());
}

function aggregateSummary() {
  const out = { ok: true, generatedAt: new Date().toISOString(), rules: null, sovereignty: null, top3: [], recent: [] };

  // ── 规则通过率（bash render_rules 同一 jq）──
  const historyRaw = (() => {
    try { return readFileSync(HISTORY_FILE, 'utf8'); } catch { return ''; }
  })();
  if (historyRaw) {
    // 过滤测试记录——驾驶舱反映真实开发质量，不掺故意违规的 fixture
    const allRecs = [];
    for (const line of historyRaw.trim().split('\n')) {
      try { allRecs.push(JSON.parse(line)); } catch {}
    }
    const cleanRecs = allRecs.filter((r) => !isTestRecord(r));
    out.totalRecords = allRecs.length;
    out.filteredTestRecords = allRecs.length - cleanRecs.length;
    out.auditTotal = cleanRecs.length;
    const filteredRaw = cleanRecs.map((r) => JSON.stringify(r)).join('\n') + '\n';

    const passFail = runJq(
      '[.[] | .ruleResults[]? | select(.status != "SKIPPED")] as $all' +
      ' | { pass: ([$all[] | select(.status == "PASS")] | length),' +
      '     warn: ([$all[] | select(.status == "WARN")] | length),' +
      '     fail: ([$all[] | select(.status == "FAIL")] | length) }' +
      ' | "\\(.pass) \\(.warn) \\(.fail)"',
      filteredRaw
    );
    const parts = passFail.split(/\s+/);
    const pass = parseInt(parts[0] || 0, 10);
    const warn = parseInt(parts[1] || 0, 10);
    const fail = parseInt(parts[2] || 0, 10);
    const total = pass + warn + fail;
    out.rules = {
      pass, warn, fail, total,
      passRate: total > 0 ? Math.round((pass * 100) / total) : 0,
    };

    // ── 任务级聚合（与趋势图同口径：exitCode 0=PASS/1=WARN/>1=FAIL，一任务一条）──
    let tPass = 0, tWarn = 0, tFail = 0;
    for (const r of cleanRecs) {
      const ec = r.exitCode || 0;
      if (ec === 0) tPass++; else if (ec === 1) tWarn++; else tFail++;
    }
    const tTotal = tPass + tWarn + tFail;
    out.tasks = {
      pass: tPass, warn: tWarn, fail: tFail, total: tTotal,
      violations: tWarn + tFail,
      passRate: tTotal > 0 ? Math.round((tPass * 100) / tTotal) : 0,
    };

    // ── 本周违规 TOP3（bash render_rules 同一 jq）──
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 19);
    const top3Raw = runJq(
      `[.[] | select(.timestamp >= "${weekAgo}") | .ruleResults[]? | select(.status == "FAIL" or .status == "WARN")]` +
      ' | group_by(.number)' +
      ' | map({ code: ("A" + (.[0].number | tostring)), name: (.[0].name | sub("^A[0-9]+[ ]+"; "")), count: length })' +
      ' | sort_by(-.count) | .[0:3][]' +
      ' | "\\(.name)\t\\(.code)\t\\(.count)"',
      filteredRaw
    );
    out.top3 = top3Raw.split('\n').filter(Boolean).map((line) => {
      const [name, code, count] = line.split('\t');
      return { name, code, count: parseInt(count || 0, 10) };
    });

    // ── 最近 10 条审计（bash render_rules 同一 jq + 规则码）──
    const recentRaw = runJq(
      'sort_by(.timestamp) | .[-10:] | reverse[]' +
      ' | [(.ruleResults[]? | select(.status == "FAIL" or .status == "WARN") | "A" + (.number | tostring))] as $violated' +
      ' | "\\(.timestamp[5:16])\t\\(.exitCode)\t\\($violated[0] // "")\t\\((.task // .commitMsg // "")[0:40])"',
      filteredRaw
    );
    out.recent = recentRaw.split('\n').filter(Boolean).map((line) => {
      const parts = line.split('\t');
      return {
        time: parts[0] || '',
        exitCode: parseInt(parts[1] || 0, 10),
        rule: parts[2] || '',
        task: parts[3] || '',
      };
    });

    // ── 近 7 天每日任务级 PASS/WARN/FAIL + 规则级通过率（通栏趋势图）──
    // 任务级：exitCode 0=PASS / 1=WARN / >1=FAIL，一次审计只算 1 条（→ 紫黄柱）
    // 规则级：ruleResults 逐条 PASS/非PASS（→ 绿线，与顶部"审计通过率"同口径）
    const dailyRaw = runJq(
      '[.[] | select(.timestamp)]' +
      ' | group_by(.timestamp[0:10])' +
      ' | map({ day: .[0].timestamp[0:10],' +
      '     pass: ([.[] | select((.exitCode // 0) == 0)] | length),' +
      '     warn: ([.[] | select(.exitCode == 1)] | length),' +
      '     fail: ([.[] | select((.exitCode // 0) > 1)] | length),' +
      '     rulePass: ([.[] | .ruleResults[]? | select(.status == "PASS")] | length),' +
      '     ruleAll: ([.[] | .ruleResults[]? | select(.status != "SKIPPED")] | length) })' +
      ' | .[] | "\\(.day)\t\\(.pass)\t\\(.warn)\t\\(.fail)\t\\(.rulePass)\t\\(.ruleAll)"',
      filteredRaw
    );
    const byDay = {};
    dailyRaw.split('\n').filter(Boolean).forEach((line) => {
      const [day, p, w, f, rp, ra] = line.split('\t');
      byDay[day] = {
        pass: parseInt(p || 0, 10), warn: parseInt(w || 0, 10), fail: parseInt(f || 0, 10),
        rulePass: parseInt(rp || 0, 10), ruleAll: parseInt(ra || 0, 10),
      };
    });
    out.daily = [];
    for (let i = 6; i >= 0; i--) {
      const key = new Date(Date.now() - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const d = byDay[key] || { pass: 0, warn: 0, fail: 0, rulePass: 0, ruleAll: 0 };
      const total = d.pass + d.warn + d.fail;
      const violations = d.warn + d.fail;
      out.daily.push({
        day: key, ...d,
        audits: total, violations,
        rate: total > 0 ? Math.round((violations * 100) / total) : 0,
        ruleRate: d.ruleAll > 0 ? Math.round((d.rulePass * 100) / d.ruleAll) : 0,
      });
    }
    out.todayCount = (out.daily[out.daily.length - 1] || { audits: 0 }).audits;
  }

  // ── 数据主权（bash render_sovereignty 同一 jq：近 7 天全部 sovereignty jsonl）──
  const sovFiles = (() => {
    try {
      return execSync(`find "${SOVEREIGNTY_DIR}" -name '*.jsonl' -type f 2>/dev/null`, { encoding: 'utf8' }).trim();
    } catch { return ''; }
  })();
  if (sovFiles) {
    let sovInput = '';
    for (const f of sovFiles.split('\n')) {
      try { sovInput += readFileSync(f, 'utf8') + '\n'; } catch {}
    }
    const sov = runJq(
      'def is_sensitive: .dataFlow.sensitivity == "restricted" or .dataFlow.sensitivity == "confidential";' +
      'def is_cloud: .dataFlow.destination == "cloud-api";' +
      'def is_out: .dataFlow.direction == "outbound";' +
      '{ total: length, cloud: ([.[] | select(is_cloud)] | length),' +
      '  local: ([.[] | select(is_cloud | not)] | length),' +
      '  outbound: ([.[] | select(is_out)] | length),' +
      '  sensitive: ([.[] | select(is_sensitive)] | length) }' +
      ' | "\\(.total) \\(.cloud) \\(.local) \\(.outbound) \\(.sensitive)"',
      sovInput
    );
    const p = sov.split(/\s+/);
    const total = parseInt(p[0] || 0, 10);
    const cloud = parseInt(p[1] || 0, 10);
    const local = parseInt(p[2] || 0, 10);
    const outbound = parseInt(p[3] || 0, 10);
    const sensitive = parseInt(p[4] || 0, 10);
    out.sovereignty = {
      total, cloud, local, outbound, sensitive,
      localRate: total > 0 ? Math.round((local * 100) / total) : 0,
    };
  }

  // ── daemon 健康状态 ──
  try {
    const dh = JSON.parse(readFileSync(DAEMON_HEALTH, 'utf8'));
    out.daemon = { status: dh.status || dh.state || 'unknown' };
  } catch {}

  return out;
}

/* ────────────────────────────────
 * /api/release-gate · 最新 release-gate-loop 运行状态
 * 结构：forge-runs/release-gate-loop/{日期}/{run-N}/status.json + progress.jsonl
 * ──────────────────────────────── */
function aggregateReleaseGate() {
  const out = { ok: true, found: false, generatedAt: new Date().toISOString(), runs: [] };
  try {
    const base = join(SOFAGENT_DATA, 'forge-runs', 'release-gate-loop');
    if (!fsDirExists(base)) return out;
    const dates = readdirSync(base).filter((d) => d.match(/^\d{4}-\d{2}-\d{2}$/)).sort().reverse();
    for (const date of dates) {
      const dateDir = join(base, date);
      const runs = readdirSync(dateDir).filter((r) => r.startsWith('run-')).sort().reverse();
      for (const run of runs) {
        const runDir = join(dateDir, run);
        const statusFile = join(runDir, 'status.json');
        const progressFile = join(runDir, 'progress.jsonl');
        let status = null;
        try { status = JSON.parse(readFileSync(statusFile, 'utf8')); } catch {}
        let progress = [];
        try {
          progress = readFileSync(progressFile, 'utf8').trim().split('\n')
            .filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        } catch {}
        if (status) {
          out.runs.push({ date, run, status, progress });
          if (out.runs.length >= 3) return out; // 最多 3 次最近运行
        }
      }
    }
    out.found = out.runs.length > 0;
  } catch {}
  return out;
}

function fsDirExists(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

/* ────────────────────────────────
 * /api/ai-nodes · 企业 AI 节点（FDE workflow 模板 + 已注册 SubAgent）
 * ──────────────────────────────── */
function aggregateAiNodes() {
  const out = { ok: true, found: false, generatedAt: new Date().toISOString(), workflow: [], deployed: [] };
  // 1) FDE workflow 模板（~/.sofagent/fde/workflow/*.yaml，排除 template）
  try {
    const wfDir = join(SOFAGENT_DATA, '..', 'fde', 'workflow');
    if (fsDirExists(wfDir)) {
      const files = readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f));
      for (const f of files) {
        try {
          const content = readFileSync(join(wfDir, f), 'utf8');
          // 解析 steps: id/name/input/output/agent
          const steps = [];
          const stepBlocks = content.split(/\n\s*-\s*id:/).slice(1);
          for (const blk of stepBlocks) {
            const id = blk.match(/^([^\n]+)/)?.[1]?.trim() || '';
            const name = blk.match(/name:\s*([^\n]+)/)?.[1]?.trim() || '';
            const input = blk.match(/input:\s*([^\n]+)/)?.[1]?.trim() || '';
            const output = blk.match(/output:\s*([^\n]+)/)?.[1]?.trim() || '';
            const agent = blk.match(/agent:\s*([^\n]+)/)?.[1]?.trim() || '';
            const loop = /loop:\s*true/.test(blk);
            if (id && name) steps.push({ id, name, input, output, agent, loop });
          }
          const wfName = content.match(/name:\s*([^\n]+)/)?.[1]?.trim() || f;
          out.workflow.push({ file: f, name: wfName, steps });
        } catch {}
      }
      out.found = out.workflow.length > 0 || out.deployed.length > 0;
    }
  } catch {}
  // 2) 已注册 SubAgent（~/.sofagent/subagents/*.yml）
  try {
    const subDirs = [join(SOFAGENT_DATA, '..', 'subagents'), join(SOFAGENT_DATA, 'subagents')];
    for (const sd of subDirs) {
      if (fsDirExists(sd)) {
        const files = readdirSync(sd).filter((f) => /\.ya?ml$/.test(f));
        for (const f of files) {
          try {
            const content = readFileSync(join(sd, f), 'utf8');
            const name = content.match(/^name:\s*([^\n]+)/m)?.[1]?.trim() || f.replace(/\.ya?ml$/, '');
            const desc = content.match(/^description:\s*([^\n]+)/m)?.[1]?.trim() || '';
            out.deployed.push({ file: f, name, description: desc });
          } catch {}
        }
      }
    }
    if (out.deployed.length) out.found = true;
  } catch {}
  // 3) 已部署节点截断：最多返回 12 个，报总数（未来几百个节点时页面不卡）
  out.deployedTotal = out.deployed.length;
  if (out.deployed.length > 12) {
    out.deployed = out.deployed.slice(0, 12);
  }
  // 4) sustain 持续优化状态（诚实呈现：能力存在但数据可能未生成）
  out.sustain = { mode: 'sustain', implemented: true, weeklyReport: null, active: false };
  try {
    const dashDir = join(SOFAGENT_DATA, 'dashboard');
    if (fsDirExists(dashDir)) {
      const weekly = readdirSync(dashDir).filter((f) => f.startsWith('weekly-')).sort().reverse();
      if (weekly.length) {
        try {
          const w = JSON.parse(readFileSync(join(dashDir, weekly[0]), 'utf8'));
          out.sustain.weeklyReport = w;
          out.sustain.active = true;
        } catch {}
      }
    }
    // daemon 健康状态（巡检是否在跑）
    const healthFile = join(SOFAGENT_DATA, 'dashboard', 'daemon-health.json');
    try {
      const h = JSON.parse(readFileSync(healthFile, 'utf8'));
      out.sustain.daemon = h.status || h.state || null;
    } catch {}
  } catch {}
  return out;
}

/* ────────────────────────────────
 * /api/ontology · 本体数据（knowledge/ 目录真实结构）
 * 扫描 ~/.sofagent/data/knowledge/ 下的 entities/ concepts/ relations/ 文件
 * ──────────────────────────────── */
function aggregateOntology() {
  const out = { ok: true, found: false, generatedAt: new Date().toISOString(), entities: [], concepts: [], relations: [], thinkCount: 0, indexPages: 0 };
  const kbDir = join(SOFAGENT_DATA, 'knowledge');
  try {
    if (!fsDirExists(kbDir)) return out;
    // entities/ concepts/ relations/ 子目录
    for (const sub of ['entities', 'concepts', 'relations']) {
      const subDir = join(kbDir, sub);
      if (fsDirExists(subDir)) {
        const files = readdirSync(subDir).filter((f) => /\.(md|yml|yaml|json)$/.test(f)).sort();
        for (const f of files) {
          let title = f.replace(/\.(md|yml|yaml|json)$/, '');
          try {
            const content = readFileSync(join(subDir, f), 'utf8');
            const m = content.match(/^(?:#|title:|name:)\s*(.+)$/m);
            if (m) title = m[1].trim();
          } catch {}
          out[sub].push({ file: f, title });
        }
      }
    }
    // index.md 知识页面数（表格行）
    const indexFile = join(kbDir, 'index.md');
    try {
      const idx = readFileSync(indexFile, 'utf8');
      out.indexPages = idx.split('\n').filter((l) => l.trim().startsWith('|') && l.includes('[[')).length;
    } catch {}
    // think.md 经验教训数
    const thinkFile = join(SOFAGENT_DATA, 'think.md');
    try {
      const tk = readFileSync(thinkFile, 'utf8');
      out.thinkCount = tk.split('\n').filter((l) => l.startsWith('## ')).length;
    } catch {}
    out.found = out.entities.length > 0 || out.concepts.length > 0 || out.relations.length > 0 || out.indexPages > 0;
  } catch {}
  return out;
}

/* ────────────────────────────────
 * HTTP Server
 * ──────────────────────────────── */
const server = createServer(async (req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);

  // CORS + no-cache
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  // /api/summary → bash 同口径聚合
  if (urlPath === '/api/summary') {
    const s = aggregateSummary();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(s));
    return;
  }

  // /api/release-gate → 最新 release-gate-loop 运行状态
  if (urlPath === '/api/release-gate') {
    const s = aggregateReleaseGate();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(s));
    return;
  }

  // /api/ai-nodes → 企业 AI 节点（workflow 模板 + 已注册 SubAgent）
  if (urlPath === '/api/ai-nodes') {
    const s = aggregateAiNodes();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(s));
    return;
  }

  // /api/ontology → 本体数据（knowledge/ 目录真实结构）
  if (urlPath === '/api/ontology') {
    const s = aggregateOntology();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(s));
    return;
  }

  // /api/forge-latest → 最近一次真实 FORGE 运行（latest.json 被 dry-run 覆盖时兜底）
  // 倒序扫 fresh-eyes-loop 日期目录，找 stopReason != 'dry-run' 的最新运行
  if (urlPath === '/api/forge-latest') {
    const base = join(SOFAGENT_DATA, 'forge-runs', 'fresh-eyes-loop');
    let found = null;
    try {
      const dateDirs = readdirSync(base).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort().reverse();
      for (const dateDir of dateDirs) {
        const runDirs = readdirSync(join(base, dateDir)).filter((x) => /^run-\d+$/.test(x)).sort((a, b) => parseInt(a.slice(4), 10) - parseInt(b.slice(4), 10)).reverse();
        for (const runDir of runDirs) {
          const statusFile = join(base, dateDir, runDir, 'status.json');
          try { statSync(statusFile) } catch { continue }
          try {
            const st = JSON.parse(readFileSync(statusFile, 'utf8'));
            if (st && st.stopReason !== 'dry-run') {
              st.runDir = `${dateDir}/${runDir}`;
              st.updatedAt = st.lastUpdate || st.updatedAt || null;
              found = st;
              break;
            }
          } catch { /* 跳过损坏 status */ }
        }
        if (found) break;
      }
    } catch { /* 目录不存在则返回 null */ }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(found));
    return;
  }

  // /api/export-history → 下载完整审计历史（原始全量，含测试记录，不截断）
  if (urlPath === '/api/export-history') {
    const raw = await tryRead(HISTORY_FILE);
    if (raw === null) {
      res.writeHead(404);
      res.end('Not found: ' + HISTORY_FILE);
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson',
      'Content-Disposition': 'attachment; filename="audit-history.jsonl"',
    });
    res.end(raw);
    return;
  }

  // /api/export-worklog → 下载工作记录（worklog.json 全量：概况/任务/介入/周报数据源）
  if (urlPath === '/api/export-worklog') {
    let raw = null;
    try { raw = readFileSync(join(SOFAGENT_DATA, 'dashboard', 'worklog.json'), 'utf8'); } catch { /* 不存在 */ }
    if (raw === null) {
      res.writeHead(404);
      res.end('Not found: worklog.json');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="worklog.json"',
    });
    res.end(raw);
    return;
  }

  // /api/audit-recent → 审计记录分页（过滤测试记录，timestamp 倒序取窗口——summary recent 同口径）
  if (urlPath.startsWith('/api/audit-recent')) {
    const u = new URL(req.url, 'http://localhost');
    const limit = Math.min(parseInt(u.searchParams.get('limit') || '10', 10) || 10, 100);
    const offset = Math.max(parseInt(u.searchParams.get('offset') || '0', 10) || 0, 0);
    const out = { ok: true, records: [], total: 0 };
    try {
      const raw = readFileSync(HISTORY_FILE, 'utf8');
      const allRecs = [];
      for (const line of raw.trim().split('\n')) {
        try { allRecs.push(JSON.parse(line)); } catch { /* 跳过损坏行 */ }
      }
      const clean = allRecs.filter((r) => !isTestRecord(r));
      const sorted = clean.slice().sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
      out.total = sorted.length;
      out.records = sorted.slice(offset, offset + limit).map((r) => {
        const violated = (r.ruleResults || []).filter((x) => x.status === 'FAIL' || x.status === 'WARN').map((x) => 'A' + x.number);
        return {
          time: String(r.timestamp || '').slice(5, 16),
          exitCode: r.exitCode || 0,
          rule: violated[0] || '',
          task: String(r.task || r.commitMsg || '').slice(0, 40),
        };
      });
    } catch { out.ok = false; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out));
    return;
  }

  // /data/* → ~/.sofagent/data/*
  if (urlPath.startsWith('/data/')) {
    const relPath = normalize(urlPath.slice('/data/'.length));
    const filePath = join(SOFAGENT_DATA, relPath);
    if (!filePath.startsWith(SOFAGENT_DATA)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    // history.jsonl 截断最近 500 条（12MB → ~1.3MB）
    if (relPath.endsWith('history.jsonl')) {
      const raw = await tryRead(filePath);
      if (raw === null) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const lines = raw.toString().trim().split('\n');
      const recent = lines.slice(-500).join('\n') + '\n';
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.end(recent);
      return;
    }
    const data = await tryRead(filePath);
    if (data === null) {
      res.writeHead(404);
      res.end('Not found: ' + filePath);
      return;
    }
    const mime = MIME[extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
    return;
  }

  // Default route → dashboard.html（v1.4.0 双态：安装态 web/dashboard.html / 仓库态 tools/dashboard/）
  if (urlPath === '/' || urlPath === '') {
    urlPath = DASHBOARD_HTML_REL;
  }

  const filePath = join(DOCS_DIR, normalize(urlPath));
  if (!filePath.startsWith(DOCS_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const data = await tryRead(filePath);
  if (data === null) {
    res.writeHead(404);
    res.end('Not found: ' + urlPath);
    return;
  }

  const mime = MIME[extname(filePath)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  res.end(data);
});

/* ────────────────────────────────
 * 端口自动检测 + 自动打开浏览器
 * ──────────────────────────────── */
function portInUse(port) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ port, host: '127.0.0.1' });
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error', () => resolve(false));
  });
}

function openBrowser(url) {
  const platform = process.platform;
  try {
    if (platform === 'darwin') spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    else if (platform === 'win32') spawn('cmd', ['/c', 'start', url], { stdio: 'ignore', detached: true }).unref();
    else spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
  } catch {}
}

async function main() {
  let port = PORT;
  // 若默认端口被占，自动 +1 探测
  while (await portInUse(port)) {
    port++;
  }
  server.listen(port, () => {
    const url = 'http://localhost:' + port;
    console.log('');
    console.log('  sofagent Dashboard → ' + url);
    console.log('');
    console.log('  数据源：' + SOFAGENT_DATA);
    console.log('  页面源：' + DOCS_DIR);
    console.log('  API：/api/summary（复用 bash dashboard jq 口径）');
    console.log('');
    console.log('  Ctrl+C 停止');
    console.log('');
    openBrowser(url);
  });
}

main();
