#!/usr/bin/env node
/**
 * sofagent Dashboard 本地服务器
 *
 * 用法：
 *   node tools/dashboard/serve-dashboard.mjs            # 起服务并自动打开浏览器
 *   DASHBOARD_PORT=4000 node tools/dashboard/serve-dashboard.mjs   # 指定端口
 *   DASHBOARD_HOST=0.0.0.0 node tools/dashboard/serve-dashboard.mjs # 局域网共享（默认仅本机 127.0.0.1）
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
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import net from 'node:net';

const require = createRequire(import.meta.url);

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
let DOCS_DIR, DASHBOARD_HTML_REL, IS_INSTALL_MODE = false;
try {
  if (statSync(INSTALL_WEB_HTML).isFile()) {
    // 安装态：web 目录即静态根（dashboard.html 在根）
    DOCS_DIR = INSTALL_WEB_DIR;
    DASHBOARD_HTML_REL = '/dashboard.html';
    IS_INSTALL_MODE = true;
  } else {
    throw new Error('install web not found');
  }
} catch {
  // 仓库态：tools/dashboard/ 为页面目录，仓库根为 static root（docs/assets/ 静态资源）
  DOCS_DIR = join(__dirname, '../..');
  DASHBOARD_HTML_REL = '/tools/dashboard/dashboard.html';
}
// 仓库态 /assets/* 别名的映射目标（安装态用 web/assets/，天然命中无需别名）
const ASSETS_DIR_REPO = join(__dirname, '../../docs');
const SOFAGENT_DATA = process.env.SOFAGENT_HOME
  ? join(process.env.SOFAGENT_HOME, 'data')
  : join(homedir(), '.sofagent', 'data');

const HISTORY_FILE = join(SOFAGENT_DATA, 'audit', 'history.jsonl');
const SOVEREIGNTY_DIR = join(SOFAGENT_DATA, 'audit', 'data-sovereignty');
const DAEMON_HEALTH = join(SOFAGENT_DATA, 'dashboard', 'daemon-health.json');
const GRAPH_STATE = join(SOFAGENT_DATA, 'dashboard', 'graph-state.json');

/* ────────────────────────────────
 * 治理引擎解析（v1.5.0 章一）
 * 候选链（首中即用，require 缓存保证幂等）：
 *   1. 仓库态：serve 脚本相对的 engine/audit/dist/public-api.js
 *   2. 安装态：npm 全局 @sofagent/audit（createRequire.resolve 走 node_modules 解析）
 *   3. 预留：$SOFAGENT_HOME/packages/audit（一体化部署形态，当前未启用）
 * 全部失败返回 null（端点降级 503，页面显示降级文案，不崩）
 * ──────────────────────────────── */
let __govEngineCache;
function resolveGovernanceEngine() {
  if (__govEngineCache !== undefined) return __govEngineCache;
  __govEngineCache = null;
  // 候选 1：仓库态相对路径
  const repoDist = join(__dirname, '../../engine/audit/dist/public-api.js');
  try {
    const m = require(repoDist);
    if (typeof m?.computeGovernanceKpis === 'function') { __govEngineCache = m; return m; }
  } catch { /* 下一候选 */ }
  // 候选 2：npm 全局 @sofagent/audit（安装态——sofagent-audit wrapper 同源 dist）
  try {
    const resolved = require.resolve('@sofagent/audit/public-api', {
      paths: [join(SOFAGENT_HOME_INSTALL, 'node_modules'), process.cwd()],
    });
    const m = require(resolved);
    if (typeof m?.computeGovernanceKpis === 'function') { __govEngineCache = m; return m; }
  } catch { /* 下一候选 */ }
  // 候选 3：预留一体化形态
  try {
    const p = join(SOFAGENT_HOME_INSTALL, 'packages', 'audit', 'dist', 'public-api.js');
    const m = require(p);
    if (typeof m?.computeGovernanceKpis === 'function') { __govEngineCache = m; return m; }
  } catch { /* 全链失败 */ }
  return null;
}

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
const JQ_CANDIDATES = ['jq', '/opt/homebrew/bin/jq', '/usr/local/bin/jq', '/usr/bin/jq'];
function runJq(program, input) {
  for (const jq of JQ_CANDIDATES) {
    try {
      return execFileSync(jq, ['-r', '-s', program], {
        input: input || '',
        maxBuffer: 64 * 1024 * 1024,
        timeout: 15000,
        encoding: 'utf8',
      }).trim();
    } catch {
      // 候选不可用（路径不存在或执行失败）→ 试下一个
    }
  }
  // 全部候选失败 = jq 未安装/不可执行。返回 null（非空串）：空串会被上游
  // split/parseInt 解析成「通过率 0%」，把「jq 缺失」伪装成真实审计数据。
  // 调用方据此标记 jqMissing 并置 environment.jqAvailable=false，前端显式降级告警。
  return null;
}

/* 测试记录过滤：fixture 泛化任务名（规则测试的故意违规/故意通过样本）
 * ⚠️ 不能用 envFingerprint 字段判断——它是近期真实记录也带的常规字段，会误杀全部近期数据
 * 同名任务出现上百次（"add code" 476 次、"initial commit" 121 次）即 fixture 循环 */
const TEST_TASK_RE = /^(add (env|api|code|dependency|config|file|data)( config)?|fix: update README( title)?|update (config|code|file)|remove file|init: project setup|initial commit|test: rules filtering|test: json scenario|test)$/i;
function isTestRecord(rec) {
  return TEST_TASK_RE.test(String(rec.task || '').trim());
}

/* ────────────────────────────────
 * /api/summary 结果缓存
 * 聚合要全量读 history.jsonl（已 55MB / 万级记录）+ 同步 spawn jq 6 次，单次耗时数秒且阻塞事件循环。
 * 前端固定 5s 轮询、多客户端（浏览器 + 预览面板）叠加 ⇒ 请求永远追不上 ⇒ 事件循环饱和、全站路由超时（「服务卡死」真身）。
 * 对策：TTL 缓存 + 并发去重（同一时刻只算一次，其余复用结果）。
 * 驾驶舱数字为历史累计口径、变化慢，30s TTL 不影响读数正确性。
 * ──────────────────────────────── */
const SUMMARY_TTL_MS = 30000;
let summaryCacheAt = 0;
let summaryCacheData = null;
let summaryInFlight = null;
function getSummaryCached() {
  const now = Date.now();
  if (summaryCacheData && now - summaryCacheAt < SUMMARY_TTL_MS) {
    return Promise.resolve(summaryCacheData);
  }
  if (summaryInFlight) return summaryInFlight; // 并发请求复用同一次计算
  summaryInFlight = (async () => {
    try {
      const s = aggregateSummary();
      summaryCacheData = s;
      summaryCacheAt = Date.now();
      return s;
    } finally {
      summaryInFlight = null;
    }
  })();
  return summaryInFlight;
}

function aggregateSummary() {
  // v1.5.1 J4b-①：读失败**计数并上报**，不再静默改分母。
  // 改前：`sovInput` 读单个文件失败即 `catch {}` 跳过 → 主权聚合的分母**静默变小**，
  // Dashboard 显示偏低，且页面上分不清「读失败」与「真的少」。history.jsonl 读失败
  // 更狠——`catch { return '' }` 让全部指标归零。现改为：失败逐条登记到 readErrors，
  // 与结果一起返回；`ok=false` 表示本次聚合不完整（读错误清单非空）。
  const readErrors = [];
  // v1.5.2 修复（finding-19）：jq 全候选失败时 runJq 返回 null（不再伪装成空数据集）。
  // 任一数据集遇到 null 即置 jqFailed，最终以 environment.jqAvailable=false 告知前端。
  let jqFailed = false;
  const out = {
    ok: true,
    generatedAt: new Date().toISOString(),
    rules: null,
    sovereignty: null,
    top3: [],
    recent: [],
    readErrors,
  };

  // ── 规则通过率（bash render_rules 同一 jq）──
  let historyRaw = '';
  try {
    historyRaw = readFileSync(HISTORY_FILE, 'utf8');
  } catch (err) {
    // ENOENT（从未审计）与「文件在但读不了」语义不同——后者必须显式上报
    if (err && err.code !== 'ENOENT') {
      readErrors.push({ file: 'audit/history.jsonl', error: String(err.code || err.message), effect: '本次聚合分母为空——所有指标按 0 呈现' });
      out.ok = false;
    }
  }
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
    if (passFail === null) jqFailed = true;
    const parts = (passFail === null ? '' : passFail).split(/\s+/);
    const pass = parseInt(parts[0] || 0, 10);
    const warn = parseInt(parts[1] || 0, 10);
    const fail = parseInt(parts[2] || 0, 10);
    const total = pass + warn + fail;
    out.rules = {
      pass, warn, fail, total,
      passRate: total > 0 ? Math.round((pass * 100) / total) : 0,
      jqMissing: passFail === null,
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
    out.top3 = top3Raw === null ? [] : top3Raw.split('\n').filter(Boolean).map((line) => {
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
    out.recent = recentRaw === null ? [] : recentRaw.split('\n').filter(Boolean).map((line) => {
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
    (dailyRaw === null ? '' : dailyRaw).split('\n').filter(Boolean).forEach((line) => {
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
      return execFileSync('find', [SOVEREIGNTY_DIR, '-name', '*.jsonl', '-type', 'f'], { encoding: 'utf8' }).trim();
    } catch {
      // 目录不存在/无权限——目录级失败也要留痕（否则「0 条主权记录」与「读不到」同形）
      readErrors.push({ file: 'audit/data-sovereignty/', error: 'find 失败（目录不存在或无权限）', effect: '主权聚合整段缺省' });
      out.ok = false;
      return '';
    }
  })();
  if (sovFiles) {
    let sovInput = '';
    // v1.5.1 J4b-①：逐文件读失败**计数**——改前 `catch {}` 让分母静默变小
    // （页面分不清「读失败」与「真的少」）。此处登记到 readErrors 并置 ok=false。
    let sovReadFails = 0;
    for (const f of sovFiles.split('\n')) {
      if (!f) continue;
      try {
        sovInput += readFileSync(f, 'utf8') + '\n';
      } catch (err) {
        sovReadFails++;
        readErrors.push({
          file: f,
          error: String((err && err.code) || (err && err.message) || err),
          effect: '该文件未计入主权分母',
        });
      }
    }
    if (sovReadFails > 0) out.ok = false;
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
    if (sov === null) jqFailed = true;
    const p = (sov === null ? '' : sov).split(/\s+/);
    const total = parseInt(p[0] || 0, 10);
    const cloud = parseInt(p[1] || 0, 10);
    const local = parseInt(p[2] || 0, 10);
    const outbound = parseInt(p[3] || 0, 10);
    const sensitive = parseInt(p[4] || 0, 10);
    out.sovereignty = {
      total, cloud, local, outbound, sensitive,
      localRate: total > 0 ? Math.round((local * 100) / total) : 0,
      // v1.5.1 J4b-①：分母口径显式化——`readFailed>0` 时 total 是**不完整分母**，
      // 页面可据此区分「真少」与「读失败」（不再静默偏低）。
      readFailed: sovReadFails,
      jqMissing: sov === null,
    };
  }

  // ── daemon 健康状态 ──
  try {
    const dh = JSON.parse(readFileSync(DAEMON_HEALTH, 'utf8'));
    out.daemon = { status: dh.status || dh.state || 'unknown' };
  } catch {}

  // v1.5.2 修复（finding-19）：jq 可用性显式上报——false 时前端以告警替代 0% 数字。
  out.environment = { jqAvailable: !jqFailed };

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
            const name = blk.match(/^\s*name:\s*([^\n]+)/m)?.[1]?.trim() || '';
            const input = blk.match(/input:\s*([^\n]+)/)?.[1]?.trim() || '';
            const output = blk.match(/output:\s*([^\n]+)/)?.[1]?.trim() || '';
            const agent = blk.match(/agent:\s*([^\n]+)/)?.[1]?.trim() || '';
            const loop = /loop:\s*true/.test(blk);
            if (id && name) steps.push({ id, name, input, output, agent, loop });
          }
          const wfName = content.match(/^\s*name:\s*([^\n]+)/m)?.[1]?.trim() || f;
          out.workflow.push({ file: f, name: wfName, steps });
        } catch (e) {
          // 与「没有 workflow 目录」（上方 fsDirExists 静默跳过）区分：文件在但读取/解析失败要留痕
          console.error(`[ai-nodes] workflow 文件解析失败 ${f}: ${e && e.message ? e.message : e}`);
        }
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
 * 返回：三类列表（各截断至 ONTOLOGY_LIST_LIMIT）+ 各类总数 *_Total
 * ──────────────────────────────── */
const ONTOLOGY_LIST_LIMIT = 24; // §12 列表精简：服务器端截断 + 报总数
const ONTOLOGY_RECENT_LIMIT = 6;
// 引擎自动沉淀的 source 前缀——这些是约束层自身产物，不是企业业务本体，展示时与业务实体分列
const ENGINE_SOURCE_PREFIXES = ['dream-cycle:', 'daemon:', 'evolve:', 'train:', 'auto:'];
function isEngineSource(src) {
  const s = String(src || '');
  return ENGINE_SOURCE_PREFIXES.some((p) => s.startsWith(p));
}
function aggregateOntology(full) {
  const out = { ok: true, found: false, generatedAt: new Date().toISOString(), entities: [], concepts: [], relations: [], entitiesTotal: 0, conceptsTotal: 0, relationsTotal: 0, sources: [], kindTotals: { engine: 0, business: 0 }, recent: [], thinkCount: 0, indexPages: 0 };
  const kbDir = join(SOFAGENT_DATA, 'knowledge');
  try {
    if (!fsDirExists(kbDir)) return out;
    // entities/ concepts/ relations/ 子目录——全量扫描（只读 frontmatter + mtime，百级文件毫秒级）
    // 全量用于「来源分组 / 最近更新」；列表本身按 §12 截断，明细走 /api/export-ontology
    const all = { entities: [], concepts: [], relations: [] };
    for (const sub of ['entities', 'concepts', 'relations']) {
      const subDir = join(kbDir, sub);
      if (!fsDirExists(subDir)) continue;
      const files = readdirSync(subDir).filter((f) => /\.(md|yml|yaml|json)$/.test(f)).sort();
      out[sub + 'Total'] = files.length;
      for (const f of files) {
        let title = f.replace(/\.(md|yml|yaml|json)$/, '');
        let source = '';
        let mtime = 0;
        try {
          mtime = statSync(join(subDir, f)).mtimeMs;
          const content = readFileSync(join(subDir, f), 'utf8');
          const sm = content.match(/^source:\s*(.+)$/m);
          if (sm) source = sm[1].trim();
          const m = content.match(/^(?:#|title:|name:)\s*(.+)$/m);
          if (m) title = m[1].trim();
        } catch {}
        all[sub].push({ file: f, title, source, mtime, engine: isEngineSource(source) });
      }
    }
    const pick = (list) => (full ? list : list.slice(0, ONTOLOGY_LIST_LIMIT));
    for (const sub of ['entities', 'concepts', 'relations']) {
      out[sub] = pick(all[sub]).map((it) => ({ file: it.file, title: it.title, source: it.source, updatedAt: it.mtime ? new Date(it.mtime).toISOString() : null }));
    }
    // 来源分组 + 引擎沉淀/业务实体 两类计数（针对实体）
    const bySource = new Map();
    let engine = 0;
    let business = 0;
    for (const it of all.entities) {
      const key = it.source || '(未标注来源)';
      bySource.set(key, (bySource.get(key) || 0) + 1);
      if (it.engine) engine++;
      else business++;
    }
    out.sources = [...bySource.entries()]
      .map(([name, count]) => ({ name, count, engine: isEngineSource(name) }))
      .sort((a, b) => b.count - a.count);
    out.kindTotals = { engine, business };
    // 最近更新（按 mtime 倒序）
    out.recent = all.entities
      .slice()
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, ONTOLOGY_RECENT_LIMIT)
      .map((it) => ({ title: it.title, source: it.source, engine: it.engine, updatedAt: it.mtime ? new Date(it.mtime).toISOString() : null }));
    // index.md 知识页面数（表格行）
    const indexFile = join(kbDir, 'index.md');
    try {
      const idx = readFileSync(indexFile, 'utf8');
      // 口径与前端 parseIndexRow 对齐：兼容 [[双链]]（旧）与纯文本（daemon 现行写入）两种表格行
      out.indexPages = idx.split('\n').filter((l) => {
        const t = l.trim();
        if (!t.startsWith('|')) return false;
        const name = (t.split('|')[1] || '').trim();
        return !!name && name !== '页面' && !/^[-:]+$/.test(name);
      }).length;
    } catch {}
    // think.md 经验教训数
    const thinkFile = join(SOFAGENT_DATA, 'think.md');
    try {
      const tk = readFileSync(thinkFile, 'utf8');
      out.thinkCount = tk.split('\n').filter((l) => l.startsWith('## ')).length;
    } catch {}
    out.found = out.entitiesTotal > 0 || out.conceptsTotal > 0 || out.relationsTotal > 0 || out.indexPages > 0;
  } catch {}
  return out;
}

/* ────────────────────────────────
 * HTTP Server
 * ──────────────────────────────── */
const server = createServer(async (req, res) => {
  // A-11（v1.5.2 待发版）：URI decode 守护——malformed 百分号序列（如 /%E0%A4%A）在
  // decodeURIComponent 抛 URIError，此前单请求即杀进程（长驻服务语义不可接受）。
  // 守护后返回 400 + stderr 日志一行，进程存活继续服务后续请求。
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch (err) {
    console.error(`[dashboard] ⚠️  URI decode 失败（返回 400，服务继续）: ${req.url.split('?')[0]} — ${err instanceof Error ? err.message : String(err)}`);
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request: malformed URI encoding');
    return;
  }

  // CORS + no-cache
  // v1.5.2 fresh-eyes（finding-14）：默认不再回显 CORS 头——同源访问本就不需要 CORS，
  // 本机直连使用不受影响。此前 `Access-Control-Allow-Origin: *` 一刀切作用于 /data/*、
  // /api/*（原始审计数据与历史导出），本服务又无鉴权——用户浏览器里任意网页可跨源
  // fetch 本地审计数据（drive-by 外带），与「仅本机绑定」的安全假设相抵。
  // 仅 /assets/* 静态资源默认保留（跨源引用图片等静态资源的合法场景）；
  // DASHBOARD_ALLOW_CORS=1 显式开启时恢复全端点 `*`（兼容明知风险的用户）。
  const allowAllCors = process.env.DASHBOARD_ALLOW_CORS === '1';
  if (allowAllCors || urlPath === '/assets' || urlPath.startsWith('/assets/')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  // /api/summary → bash 同口径聚合
  if (urlPath === '/api/summary') {
    const s = await getSummaryCached();
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

  // /api/governance → 治理 KPI（v1.5.0 章一 · 复用 audit 包 governance 聚合）
  if (urlPath === '/api/governance') {
    const mod = resolveGovernanceEngine();
    if (!mod) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, message: 'governance 聚合引擎不可用（audit 包未构建或未安装）' }));
      return;
    }
    const gov = mod.computeGovernanceKpis({ dataDir: SOFAGENT_DATA, days: 30 });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, report: gov }));
    return;
  }

  // /api/export-governance-weekly → 治理 KPI 周报下载（markdown · v1.5.0 章一）
  if (urlPath === '/api/export-governance-weekly') {
    const mod = resolveGovernanceEngine();
    if (!mod) {
      res.writeHead(503);
      res.end('Not available: governance engine');
      return;
    }
    const report = mod.computeGovernanceKpis({ dataDir: SOFAGENT_DATA, days: 30 });
    const md = mod.formatGovernanceWeekly(report);
    res.writeHead(200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': 'attachment; filename="governance-weekly.md"',
    });
    res.end(md);
    return;
  }

  // /api/export-dataset-lineage → 数据集 lineage 合规报告下载（markdown · v1.5.0 章一）
  if (urlPath === '/api/export-dataset-lineage') {
    const mod = resolveGovernanceEngine();
    if (!mod) {
      res.writeHead(503);
      res.end('Not available: governance engine');
      return;
    }
    const md = mod.buildDatasetLineageReport({ dataDir: SOFAGENT_DATA });
    res.writeHead(200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': 'attachment; filename="dataset-lineage.md"',
    });
    res.end(md);
    return;
  }

  // /api/ontology → 本体数据（knowledge/ 目录真实结构）
  if (urlPath === '/api/ontology') {
    const s = aggregateOntology();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(s));
    return;
  }

  // /api/export-ontology → 本体数据完整清单（§12：列表只出前 24，全量走下载）
  if (urlPath === '/api/export-ontology') {
    const s = aggregateOntology(true);
    const payload = {
      generatedAt: s.generatedAt,
      totals: { entities: s.entitiesTotal, concepts: s.conceptsTotal, relations: s.relationsTotal },
      kindTotals: s.kindTotals,
      sources: s.sources,
      entities: s.entities,
      concepts: s.concepts,
      relations: s.relations,
    };
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="ontology.json"',
    });
    res.end(JSON.stringify(payload, null, 2));
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
    // 前缀判定必须带尾分隔符——裸 startsWith 存在前缀碰撞绕过
    // （/data/../data-backup/x 解析后以 .../data 开头即可穿透到兄弟目录）
    if (filePath !== SOFAGENT_DATA && !filePath.startsWith(SOFAGENT_DATA + '/')) {
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
      // 404 不回显绝对路径（含用户名——本地面信息收敛）
      res.end('Not found');
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

  // /assets/* 别名（v1.4.4 目录同步配套）：安装态 web/assets/ 天然命中；
  // 仓库态映射 docs/assets/——两态同 URL 引用，页面写 /assets/banner.png 不再断链
  if (urlPath === '/assets' || urlPath.startsWith('/assets/')) {
    const rel = urlPath.slice('/assets'.length);
    const assetsRoot = IS_INSTALL_MODE ? DOCS_DIR : ASSETS_DIR_REPO;
    const filePath = join(assetsRoot, 'assets', normalize(rel));
    if (filePath !== join(assetsRoot, 'assets') && !filePath.startsWith(join(assetsRoot, 'assets') + '/')) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const data = await tryRead(filePath);
    if (data === null) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const mime = MIME[extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
    return;
  }

  const filePath = join(DOCS_DIR, normalize(urlPath));
  // 前缀判定带尾分隔符（防兄弟目录前缀碰撞，同 /data/* 分支）
  if (filePath !== DOCS_DIR && !filePath.startsWith(DOCS_DIR + '/')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const data = await tryRead(filePath);
  if (data === null) {
    res.writeHead(404);
    // 404 不回显（urlPath 虽非绝对路径，仍统一收敛）
    res.end('Not found');
    return;
  }

  const mime = MIME[extname(filePath)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  res.end(data);
});

// A-11（v1.5.2 待发版）：顶层兜底——dashboard 是长驻本地服务，单个未捕获异常不应杀进程
// （日志可见 + 存活，与相邻 daemon 的降级不抛语义对齐）。此前同构复现：
// GET /%E0%A4%A → URIError → 进程退出 EXIT=1，本地开发被单个畸形 URL 打死。
process.on('uncaughtException', (err) => {
  console.error('[dashboard] ⚠️  uncaughtException（已兜底，服务继续）:', err instanceof Error ? err.stack || err.message : String(err));
});
process.on('unhandledRejection', (reason) => {
  console.error('[dashboard] ⚠️  unhandledRejection（已兜底，服务继续）:', reason instanceof Error ? reason.stack || reason.message : String(reason));
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
  // v1.4.4 CI 加固：默认只绑回环地址（Node 不传 host 时绑 :: 全网卡——局域网可达）
  // 局域网共享须显式 DASHBOARD_HOST=0.0.0.0
  const host = process.env.DASHBOARD_HOST || '127.0.0.1';
  server.listen(port, host, () => {
    const url = 'http://localhost:' + port;
    console.log('');
    console.log('  sofagent Dashboard → ' + url);
    console.log('  监听：' + host + ':' + port + (host === '127.0.0.1' ? '（仅本机，局域网共享须 DASHBOARD_HOST=0.0.0.0）' : ''));
    // v1.5.1 J4b-②：`0.0.0.0` 共享面**显式告警**——此模式下 Dashboard 把审计数据
    // （history.jsonl / 数据主权记录 / 任务日志）暴露给整个局域网，且本服务**无鉴权**。
    // 改前只有一行中性「监听：0.0.0.0:3780」，读者不会意识到这是对外暴露。
    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
      console.log('');
      console.log('  ⚠️  ⚠️  数据暴露告警：已绑定 ' + host + '（非回环地址）——局域网内任何设备均可访问本 Dashboard。');
      console.log('      · 本服务**无鉴权**，审计记录 / 数据主权明细 / 任务日志对同网段完全可见');
      // v1.5.2 fresh-eyes（finding-14）③：绑定面告警处同步当前 CORS 状态——
      // 0.0.0.0 + CORS * 双开时暴露面叠加，运维需在同一处看到两个维度。
      console.log('      · CORS：' + (process.env.DASHBOARD_ALLOW_CORS === '1' ? '* 已开启' : '已关闭（跨源 fetch 将被浏览器拦截）'));
      console.log('      · 仅应在受信网络内使用；离席前请 Ctrl+C 停止，或改用默认 127.0.0.1');
      console.log('');
    }
    console.log('');
    console.log('  数据源：' + SOFAGENT_DATA);
    console.log('  页面源：' + DOCS_DIR);
    // v1.4.7 批次 M P2-14：安装态无条件优先时，若同仓存在仓库态页面且两者不一致，
    // 打一行可观测提示——开发者改了仓库态页面却看到旧安装态时能立刻定位（不改判定逻辑）
    if (IS_INSTALL_MODE) {
      const repoHtml = join(__dirname, 'dashboard.html');
      try {
        if (statSync(repoHtml).isFile()) {
          const repoBuf = readFileSync(repoHtml);
          const instBuf = readFileSync(INSTALL_WEB_HTML);
          if (!repoBuf.equals(instBuf)) {
            console.log('  ⚠️ 仓库态 dashboard.html 存在但当前服务安装态副本——开发者调试请 SOFAGENT_HOME= node tools/dashboard/serve-dashboard.mjs');
          }
        }
      } catch (err) {
        // v1.5.1 J4b-① 收口：原为「catch 空块」（静默）——一致性比对失败时开发者
        // 完全不知情，会误以为已经比对过。该降级不阻断服务启动，但必须留痕。
        console.warn('  ⚠️ 仓库态/安装态 dashboard.html 一致性比对失败，已跳过该提示: ' + (err && err.message ? err.message : err));
      }
    }
    console.log('  API：/api/summary（复用 bash dashboard jq 口径）');
    console.log('');
    console.log('  Ctrl+C 停止');
    console.log('');
    openBrowser(url);
  });
}

main();
