#!/usr/bin/env node
/**
 * forge-runs-stats.mjs · FORGE 质量循环离线统计（纯只读，不落盘）
 *
 * 用途：解析本机 ~/.sofagent/data/forge-runs/ 下两个循环的运行数据，输出三份统计报告：
 *   一、视角生产力（fresh-eyes：每视角累计 finding 归属与覆盖 run 数）
 *   二、复发热点（跨 run 重复出现的文件路径——问题是否总在同一批文件上复发）
 *   三、运行健康度（fresh-eyes 崩溃率/有效报告率 + release-gate 裁决/延迟分布）
 *
 * 设计原则：
 *   - 纯离线只读：只读 forge-runs 数据，不写任何文件（报告走 stdout）。
 *   - 解析容错：单文件解析失败计数跳过，报告末尾标注覆盖率，不让坏数据中断统计。
 *   - 零依赖：Node 内置模块 only（fs/path/os），与 FORGE 工具链同款。
 *
 * 用法：
 *   node tools/forge/forge-runs-stats.mjs [--loop fresh-eyes|release-gate|all]
 *                                        [--top N]
 *   默认：loop=all · top=10
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ── 参数解析 ──────────────────────────────────────────────
const args = process.argv.slice(2);
function argValue(name, dflt) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : dflt;
}
const LOOP = argValue('--loop', 'all');
const TOP = Number(argValue('--top', 10)) || 10;

const ROOTS = {
  'fresh-eyes': path.join(os.homedir(), '.sofagent/data/forge-runs/fresh-eyes-loop'),
  'release-gate': path.join(os.homedir(), '.sofagent/data/forge-runs/release-gate-loop'),
};
if (LOOP !== 'all' && !ROOTS[LOOP]) {
  console.error(`未知 --loop 值：${LOOP}（支持 fresh-eyes / release-gate / all）`);
  process.exit(2);
}

// ── 通用工具 ──────────────────────────────────────────────
const covered = { parsed: 0, failed: 0, skipped: 0, legacy: 0 };
function listDir(p) {
  try {
    return fs.readdirSync(p).filter(f => !f.startsWith('.')).sort();
  } catch {
    return [];
  }
}
function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}
function safeJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// ── fresh-eyes 数据提取 ───────────────────────────────────
// 数据源：每 round 的 findings.md。三种形态（格式演进史）：
//   新格式（2026-08 下旬起）：「P1/P2 findings」表格（列：编号|视角|来源|文件路径|描述|优先级）
//   旧格式（2026-07~08）：叙述式「Fallback Findings / 问题清单 / 合并审查报告」，无表格
//   坏文件：如「[object Object]」——归 legacy 零计数，不让单文件中断统计
function extractFindings(text) {
  const out = { p1: 0, p2: 0, views: [], files: [] };
  let inP1 = false, inP2 = false;
  for (const line of text.split('\n')) {
    if (/^#{1,3}\s.*P1/i.test(line)) { inP1 = true; inP2 = false; continue; }
    if (/^#{1,3}\s.*P2/i.test(line)) { inP2 = true; inP1 = false; continue; }
    if (/^#{1,3}\s/.test(line)) { inP1 = false; inP2 = false; continue; }
    if (line.startsWith('|') && (inP1 || inP2)) {
      const cells = line.split('|').map(s => s.trim());
      if (cells.length >= 6 && /^(finding-|（需人工)/.test(cells[1] || '')) {
        out.views.push(...(cells[2] || '').split(/[／/]/).map(s => s.trim()).filter(Boolean));
        out.files.push(cells[4] || '');
        if (inP1) out.p1++; else out.p2++;
      }
    }
  }
  // 旧格式：无表格行——尝试从叙述声明行提计数（如「共发现 **10 条 P0 + 20 条 P1 + 20 条 P2**」）
  if (out.p1 === 0 && out.p2 === 0) {
    const decl = text.match(/(\d+)\s*条\s*P0[^0-9]*(\d+)\s*条\s*P1[^0-9]*(\d+)\s*条\s*P2/);
    if (decl) {
      return { legacy: true, p0: Number(decl[1]), p1: Number(decl[2]), p2: Number(decl[3]), views: [], files: [] };
    }
    return { legacy: true, p0: 0, p1: 0, p2: 0, views: [], files: [] };
  }
  return out;
}

function collectFreshEyes() {
  const rows = [];
  const root = ROOTS['fresh-eyes'];
  for (const dateDir of listDir(root)) {
    for (const runDir of listDir(path.join(root, dateDir))) {
      for (const roundDir of listDir(path.join(root, dateDir, runDir))) {
        if (roundDir.includes('.bak')) continue;  // 备份目录（ghost-restart 等）
        const roundPath = path.join(root, dateDir, runDir, roundDir);
        const text = readText(path.join(roundPath, 'findings.md'));
        if (text === null) {
          if (listDir(roundPath).length === 0) continue;  // 空 round 目录：driver 中断的常态，不计入
          covered.skipped++;
          continue;
        }
        const stats = extractFindings(text);
        if (stats.legacy) {
          covered.legacy++;
          rows.push({ date: dateDir, run: runDir, round: roundDir, text, p0: stats.p0, p1: stats.p1, p2: stats.p2, views: [], files: [] });
          continue;
        }
        covered.parsed++;
        rows.push({ date: dateDir, run: runDir, round: roundDir, text, ...stats });
      }
    }
  }
  return rows;
}

// ── 报告一：视角生产力 ────────────────────────────────────
function reportOne(rows) {
  const viewMap = new Map();
  for (const r of rows) {
    for (const v of r.views) {
      if (!viewMap.has(v)) viewMap.set(v, { findings: 0, runs: new Set() });
      const e = viewMap.get(v);
      e.findings++;
      e.runs.add(`${r.date}/${r.run}`);
    }
  }
  console.log('\n【报告一 · 视角生产力】fresh-eyes 各视角累计 finding 归属');
  console.log('（联合署名行展开——1 条 finding 可归属多视角；A/B 侧合并计）');
  console.log('  视角               findings  覆盖 run');
  console.log('  ' + '─'.repeat(46));
  for (const [v, e] of [...viewMap.entries()].sort((a, b) => b[1].findings - a[1].findings)) {
    console.log(`  ${v.padEnd(16)} ${String(e.findings).padStart(6)}   ${String(e.runs.size).padStart(5)}`);
  }
}

// ── 报告二：复发热点 ──────────────────────────────────────
// 路径归一化：剥反引号/加粗 → 截首个空白/中文括号 → 剥行号后缀（:118,144）→ 过滤非路径值
function normalizePath(raw) {
  let s = (raw || '').trim().replace(/[`*]/g, '');
  s = s.split(/[\s（(]/)[0].trim();
  s = s.replace(/:\d+(,\d+)*$/, '');        // 行号后缀 report-generator.ts:118,144
  s = s.replace(/#\d+$/, '');               // issue 引用 #123
  if (!s || s === '--' || s === 'n/a' || s === '/') return null;
  if (!/[./]/.test(s)) return null;          // 无点无斜杠的不是路径（如「全项目」）
  return s;
}
function reportTwo(rows, topN) {
  const map = new Map();
  for (const r of rows) {
    for (const f of r.files) {
      const key = normalizePath(f);
      if (!key) continue;
      if (!map.has(key)) map.set(key, { count: 0, dates: new Set() });
      const e = map.get(key);
      e.count++;
      e.dates.add(r.date);
    }
  }
  console.log(`\n【报告二 · 复发热点】跨 run 高频出现问题的文件 Top ${topN}`);
  console.log('  次数  跨天数  文件路径');
  console.log('  ' + '─'.repeat(46));
  for (const [f, e] of [...map.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, topN)) {
    console.log(`  ${String(e.count).padStart(4)}   ${String(e.dates.size).padStart(4)}   ${f}`);
  }
}

// ── 报告三：运行健康度 ─────────────────合并───────────────
function reportThree(rows) {
  console.log('\n【报告三 · 运行健康度】');
  if (rows.length > 0) {
    let crashRounds = 0, validA = 0, totalA = 0, p0Total = 0, p1Total = 0, p2Total = 0;
    for (const r of rows) {
      // 「**有效报告**：A 侧 10/12」——容忍加粗标记与全角冒号
      const m = r.text.match(/有效报告\**[：:]\s*\**A 侧\**\s*(\d+)\s*\/\s*(\d+)/);
      if (m) { validA += Number(m[1]); totalA += Number(m[2]); }
      if (/worker 崩溃|崩溃占位/.test(r.text)) crashRounds++;
      p0Total += r.p0 || 0;
      p1Total += r.p1;
      p2Total += r.p2;
    }
    const crashRate = ((crashRounds / rows.length) * 100).toFixed(1);
    const validRate = totalA ? ((validA / totalA) * 100).toFixed(1) : 'n/a';
    console.log(`  fresh-eyes：rounds=${rows.length} · 含崩溃声明=${crashRounds}（${crashRate}%）· A 侧有效报告率=${validA}/${totalA}（${validRate}%）`);
    console.log(`  findings 累计：P0=${p0Total} · P1=${p1Total} · P2=${p2Total}（新格式表格行 + 旧格式声明行口径）`);
  } else {
    console.log('  fresh-eyes：无数据');
  }

  // release-gate 侧
  const rgDir = ROOTS['release-gate'];
  let runs = 0;
  const verdicts = { PASS: 0, HOLD: 0, FAIL: 0 };
  const latencies = [];
  let stepsDone = 0, stepErrors = 0;
  for (const dateDir of listDir(rgDir)) {
    for (const runDir of listDir(path.join(rgDir, dateDir))) {
      runs++;
      const runPath = path.join(rgDir, dateDir, runDir);
      const progress = readText(path.join(runPath, 'progress.jsonl'));
      if (progress) {
        const lines = progress.trim().split('\n').map(safeJson).filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
          if (lines[i].event === 'loop-end' && lines[i].verdict) {
            verdicts[lines[i].verdict] = (verdicts[lines[i].verdict] || 0) + 1;
            break;
          }
        }
        for (const ev of lines) {
          if (ev.event === 'step-done') stepsDone++;
          if (ev.event === 'step-error') stepErrors++;
        }
      } else {
        covered.skipped++;
      }
      const usage = readText(path.join(runPath, 'usage.jsonl'));
      if (usage) {
        for (const line of usage.trim().split('\n')) {
          const ev = safeJson(line);
          if (ev && typeof ev.latency_ms === 'number') latencies.push(ev.latency_ms);
        }
      }
    }
  }
  const judged = verdicts.PASS + verdicts.HOLD + verdicts.FAIL;
  console.log(`  release-gate：runs=${runs} · 裁决 PASS=${verdicts.PASS} / HOLD=${verdicts.HOLD} / FAIL=${verdicts.FAIL}（有裁决 ${judged}/${runs}）`);
  console.log(`  步骤事件：step-done=${stepsDone} · step-error=${stepErrors}`);
  if (latencies.length > 0) {
    latencies.sort((a, b) => a - b);
    const p = q => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * q))];
    console.log(`  步骤延迟（ms）：p50=${p(0.5)} · p90=${p(0.9)} · max=${latencies[latencies.length - 1]}（n=${latencies.length}）`);
  }
}

// ── 主流程 ────────────────────────────────────────────────
const hr = '─'.repeat(64);
console.log(hr);
console.log(`FORGE 质量循环离线统计 · ${new Date().toISOString().slice(0, 10)}`);
console.log(`范围：${LOOP === 'all' ? 'fresh-eyes + release-gate' : LOOP} · ~/.sofagent/data/forge-runs/`);
console.log(hr);

const feRows = LOOP === 'all' || LOOP === 'fresh-eyes' ? collectFreshEyes() : [];
reportOne(feRows);
reportTwo(feRows, TOP);
reportThree(feRows);

console.log('\n' + hr);
console.log(`数据覆盖：新格式解析成功 ${covered.parsed} · 旧格式（叙述式，仅入健康度）${covered.legacy} · 解析失败 ${covered.failed} · 跳过（缺/空文件）${covered.skipped}`);
console.log(hr);
