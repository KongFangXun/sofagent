#!/usr/bin/env node
// ============================================================
// check-silent-catch.mjs · 静默吞错门禁（v1.4.8 F-10 门禁前移）
// ============================================================
// 用法: node tools/check/check-silent-catch.mjs [--update-baseline] [--update-prefilter-exempt]
//
// 扫描 engine 各子包 src 下的「catch 后空块或仅注释块」，且所在文件
// 含 audit / persist / notice / daemon / history / write / snapshot
// 关键词（关键持久化路径）的，输出 ❌ 清单。
// 扫描面（v1.4.8 起）：engine/ 一级包 src **＋** engine/dsh-plugins/*/src 与
// engine/openclaw-plugins/*/src（嵌套二级插件，此前为覆盖盲区）——共 28 个包。
//
// 实现说明：仓库 typescript 为 6.x（package exports 只开 ./lib/version.cjs
// 与 unstable API 面，无经典 createSourceFile 走线）——正则轻扫替代 AST：
// catch 子句的空块形态语法固定（catch (e) { } / catch { /* 注释 */ }），
// 「} 或 {」配平在同行内判定；跨行空块由「catch 行后紧跟的下一个非空行
// 是 }」覆盖。误报面：字符串字面量含 catch 字样——由关键路径文件预筛
// 收窄，且基线机制兜底。
//
// 🔴 已知误报类显式登记（下次碰撞时按已知类处理，勿当新增）：
//   类 A · TS 模板字符串内嵌 shell/文本 —— 字符串里的 catch 字样被正则扫到，
//          实际不是 TS 控制流。样例行：engine/core/src/config-template.ts:135
//          （模板字面量内的 shell 片段）。判据：命中行位于反引号模板内、
//          且不属「关键持久化路径」语义面 ⇒ 误报。
//   处置：新增命中若属此类，**勿改判定逻辑**（会削弱真命中），改为在基线登记并注明类 A。
//
// 存量豁免：首跑产出基线清单 tools/check/silent-catch-baseline.json，
// 门禁只拦**新增**空 catch（存量按节奏消化）。--update-baseline 重生成。
//
// 前置过滤豁免登记（v1.4.9 G-2① · 「门禁绿 = 增量为零 ≠ 债清零」第三层稀释修复）：
//   本脚本 :81 起有两道文件级前置过滤——**文件名/路径**不含关键路径关键词
//   （audit|persist|notice|daemon|history|snapshot|write|crypto|hmac）且**前 2000 字符**
//   也不含时，整个文件被 `continue` 跳过，其 catch 子句从不经本门禁判定。
//   实测（v1.4.9 复现，与第 3 份审查报告数字逐字吻合）：扫描面 617 个 .ts →
//   实际判定 450 个 / **前置过滤跳过 167 个（27.1%）**，其中 83 个文件含
//   **177 个 catch 子句零覆盖**（含 engine/ab-test/src/ab-runner.ts 4 处——正是 P1-5
//   「静默降级链」所在文件，恰是滤网制造的真实盲区，非理论风险）。
//   修复口径：被过滤文件**清单落盘**（tools/check/silent-catch-prefilter-exempt.json），
//   每次运行显式打印「豁免 N 个 / 其中含 catch 子句 M 个 / K 处」，并检测登记表漂移
//   （新出现的未登记跳过 / 已登记但不再跳过）。**不再静默跳过**。
//   ⚠️ 语义边界（诚实标注，勿误读为已修）：落盘的是「已知覆盖盲区」的显式承认，
//   不是「已检查」——登记表只让盲区可见可审计，把盲区收窄需逐文件把关键词纳入判定面
//   或改前置过滤为内容级判据（属门禁演进，不在 v1.4.9 批）。因此 K>0 不阻断退出码，
//   但必须打印（发版 SOP「SKIP 数逐条裁决」步骤逐条裁定）。
//   为何不阻断新跳过：前置过滤是**误报抑制**启发式（非关键路径文件默认不判），
//   任何新增非持久化文件都会合法落此名单——阻断会制造持续噪音并诱导 `--update-*`
//   一键消音，反而稀释门禁。故取「可见 + 需显式登记」而非「默认阻断」。
//
// 退出码: 0 = 无新增静默吞错 / 1 = 有新增
// ============================================================

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ENGINE = path.join(ROOT, 'engine');
const BASELINE = path.join(ROOT, 'tools/check/silent-catch-baseline.json');
// 前置过滤豁免登记表（v1.4.9 G-2①）：被文件级前置过滤跳过的文件清单，清单落盘不再静默跳过
const PREFILTER_EXEMPT = path.join(ROOT, 'tools/check/silent-catch-prefilter-exempt.json');
const UPDATE = process.argv.includes('--update-baseline');
const UPDATE_EXEMPT = process.argv.includes('--update-prefilter-exempt');

// 关键路径关键词（命中任一即视为「失败不可无痕」域）
const CRITICAL_FILE_HINTS = /audit|persist|notice|daemon|history|snapshot|write|crypto|hmac/i;

// 同行空 catch：catch (...) { } 或 catch { } 或 catch (...) { /* 仅注释 */ }
const SAME_LINE_EMPTY = /catch\s*(\([^)]*\))?\s*\{[\s]*(?:\/\*[^*]*\*\/|\/\/[^\n]*)?[\s]*\}/;

// catch 子句（用于量化被前置过滤跳过的文件的覆盖盲区规模）
const CATCH_CLAUSE = /catch\s*(\([^)]*\))?\s*\{/g;

// 覆盖度行（v1.4.9 G-2②）：与 tools/check/lib/coverage-line.sh 逐字段同格式同语义。
//   asserts = 真正做出判定的断言数（本脚本：① 新增空 catch 判定）
//   covered = 实际进入判定的文件数 · skipped = 被前置过滤跳过的文件数
function emitCoverage(asserts, covered, skipped) {
  console.log(`[check:coverage] script=check-silent-catch asserts=${asserts} covered=${covered} skipped=${skipped}`);
}

function collectSources(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['dist', 'node_modules', '__tests__'].includes(e.name)) continue;
      collectSources(p, out);
    } else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts') && !e.name.endsWith('.test.ts')) {
      out.push(p);
    }
  }
  return out;
}

const findings = [];
// 前置过滤统计（v1.4.9 G-2①）：被 continue 跳过的文件**逐个登记**，不再静默
const prefilterSkipped = [];
const skippedWithCatch = new Map(); // rel -> catch 子句数（>0 才是真覆盖盲区）
const scannedFiles = [];
// v1.4.8 补面：原实现只取 engine/ 一级（`engine/<pkg>/src`），dsh-plugins/ 与
// openclaw-plugins/ 下的插件 src **完全不经此门禁**（覆盖盲区，见审查报告 6.2）。
// 现补扫这两族的嵌套二级目录——注意 `.map(e => e.name)` 与下方 `pkgName` 的成对改动。
const packages = fs.readdirSync(ENGINE, { withFileTypes: true })
  .filter(e => e.isDirectory() && fs.existsSync(path.join(ENGINE, e.name, 'src')))
  .map(e => e.name);
for (const nested of ['dsh-plugins', 'openclaw-plugins']) {
  const nestedDir = path.join(ENGINE, nested);
  if (!fs.existsSync(nestedDir)) continue;
  for (const e of fs.readdirSync(nestedDir, { withFileTypes: true })) {
    const relDir = `${nested}/${e.name}`;
    if (e.isDirectory() && fs.existsSync(path.join(ENGINE, relDir, 'src'))) packages.push(relDir);
  }
}

for (const pkgName of packages) {
  const srcDir = path.join(ENGINE, pkgName, 'src');
  for (const file of collectSources(srcDir)) {
    const rel = path.relative(ROOT, file);
    const content = fs.readFileSync(file, 'utf8');
    if (!CRITICAL_FILE_HINTS.test(rel) && !CRITICAL_FILE_HINTS.test(content.slice(0, 2000))) {
      // 文件级前置过滤命中：本文件整体不进 catch 判定——**登记盲区**（v1.4.9 G-2①）
      prefilterSkipped.push(rel);
      const clauses = (content.match(CATCH_CLAUSE) || []).length;
      if (clauses > 0) skippedWithCatch.set(rel, clauses);
      else skippedWithCatch.set(rel, 0);
      continue;
    }
    scannedFiles.push(rel);
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes('catch')) continue;
      // 豁免：注释里写明「为何可静默」
      const ctx = lines.slice(i, i + 4).join('\n');
      if (/为何可静默/.test(ctx)) continue;
      // 形态一：同行空块
      if (SAME_LINE_EMPTY.test(line)) {
        findings.push(`${rel}:${i + 1}`);
        continue;
      }
      // 形态二：catch 行只有 {，下一非空行是 }（跨行空块，可含注释行）
      if (/catch\s*(\([^)]*\))?\s*\{\s*$/.test(line)) {
        let j = i + 1;
        while (j < lines.length && (lines[j].trim() === '' || lines[j].trim().startsWith('//') || lines[j].trim().startsWith('/*') || lines[j].trim().startsWith('*'))) j++;
        if (j < lines.length && lines[j].trim().startsWith('}')) {
          findings.push(`${rel}:${i + 1}`);
        }
      }
    }
  }
}

let baseline = [];
if (fs.existsSync(BASELINE)) {
  baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
}

// ── 前置过滤豁免登记（v1.4.9 G-2①）────────────────────────────
// 被过滤文件名/内容特征的文件整体跳过 catch 判定——清单落盘 + 每次运行显式打印。
// 登记表为「已承认的覆盖盲区」台账：新跳过未登记 = 台账漂移（打印告警）；
// 已登记但不再跳过 = 滤网条件变了（打印提示，可安全从台账移除）。
const skippedList = [...new Set(prefilterSkipped)].sort();
const skippedCatchFiles = skippedList.filter(f => (skippedWithCatch.get(f) || 0) > 0);
const skippedCatchClauses = skippedCatchFiles.reduce((a, f) => a + (skippedWithCatch.get(f) || 0), 0);

let exemptBaseline = [];
let exemptFileExists = fs.existsSync(PREFILTER_EXEMPT);
if (exemptFileExists) {
  exemptBaseline = JSON.parse(fs.readFileSync(PREFILTER_EXEMPT, 'utf8'));
}

if (UPDATE_EXEMPT) {
  fs.writeFileSync(PREFILTER_EXEMPT, JSON.stringify(skippedList, null, 2) + '\n');
  console.log(
    `前置过滤豁免表已更新：${skippedList.length} 个文件（其中含 catch 子句 ${skippedCatchFiles.length} 个 / ${skippedCatchClauses} 处）` +
      ` → ${path.relative(ROOT, PREFILTER_EXEMPT)}`,
  );
  process.exit(0);
}

const newlySkipped = skippedList.filter(f => !exemptBaseline.includes(f));
const staleExempt = exemptBaseline.filter(f => !skippedList.includes(f));

function reportPrefilterExemption() {
  console.log(
    `📊 前置过滤豁免（显式登记 · 不再静默跳过）：跳过 ${skippedList.length} 个 / 实际判定 ${scannedFiles.length} 个` +
      `（扫描面 ${skippedList.length + scannedFiles.length} 个 .ts）`,
  );
  console.log(
    `   ⚠️ 其中 ${skippedCatchFiles.length} 个文件含 ${skippedCatchClauses} 处 catch 子句**零覆盖**——本门禁从不判定它们（已知覆盖盲区，非「已检查」）`,
  );
  if (!exemptFileExists) {
    console.log(
      `   ⚠️ 豁免登记表缺失（${path.relative(ROOT, PREFILTER_EXEMPT)}）——本次视为全部未登记，` +
        `请跑 node tools/check/check-silent-catch.mjs --update-prefilter-exempt 建立台账`,
    );
  } else if (newlySkipped.length > 0) {
    console.log(`   ⚠️ 新出现的未登记跳过文件 ${newlySkipped.length} 个——台账漂移，请复核后收编：`);
    for (const f of newlySkipped.slice(0, 10)) {
      console.log(`      ${f}（catch 子句 ${skippedWithCatch.get(f) || 0} 处）`);
    }
    if (newlySkipped.length > 10) console.log(`      ... 共 ${newlySkipped.length} 个`);
  } else if (staleExempt.length > 0) {
    console.log(`   ℹ️ 台账中 ${staleExempt.length} 个文件已不再被过滤（滤网条件变或文件已删），可移除：`);
    for (const f of staleExempt.slice(0, 10)) console.log(`      ${f}`);
    if (staleExempt.length > 10) console.log(`      ... 共 ${staleExempt.length} 个`);
  } else {
    console.log(`   ✓ 豁免台账与实测一致（${skippedList.length}/${skippedList.length}，登记表 ${path.relative(ROOT, PREFILTER_EXEMPT)}）`);
  }
}

if (UPDATE) {
  fs.writeFileSync(BASELINE, JSON.stringify([...new Set(findings)].sort(), null, 2) + '\n');
  console.log(`基线已更新：${new Set(findings).size} 条存量记录 → ${path.relative(ROOT, BASELINE)}`);
  reportPrefilterExemption();
  emitCoverage(1, scannedFiles.length, skippedList.length);
  process.exit(0);
}

const uniq = [...new Set(findings)];
const newOnes = uniq.filter(f => !baseline.includes(f));
if (newOnes.length === 0) {
  console.log(`✓ 静默吞错检查通过（存量 ${baseline.length} 条按基线豁免，本轮新增 0）`);
  reportPrefilterExemption();
  emitCoverage(1, scannedFiles.length, skippedList.length);
  process.exit(0);
}

console.error(`❌ 检测到 ${newOnes.length} 处新增静默吞错（关键路径 catch 空块）：`);
for (const f of newOnes.slice(0, 20)) console.error(`  ${f}`);
if (newOnes.length > 20) console.error(`  ... 共 ${newOnes.length} 处`);
console.error('修法：失败时至少走既有 logger 输出一行 warn（降级可见），或注释「为何可静默」豁免标记。');
console.error('存量修复后收窄基线：node tools/check/check-silent-catch.mjs --update-baseline');
reportPrefilterExemption();
emitCoverage(1, scannedFiles.length, skippedList.length);
process.exit(1);
