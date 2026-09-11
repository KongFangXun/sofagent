#!/usr/bin/env node
// ============================================================
// check-silent-catch.mjs · 静默吞错门禁（v1.4.8 F-10 门禁前移）
// ============================================================
// 用法: node tools/check/check-silent-catch.mjs [--update-baseline]
//
// 扫描 engine 各子包 src 下的「catch 后空块或仅注释块」，且所在文件
// 含 audit / persist / notice / daemon / history / write / snapshot
// 关键词（关键持久化路径）的，输出 ❌ 清单。
//
// 实现说明：仓库 typescript 为 6.x（package exports 只开 ./lib/version.cjs
// 与 unstable API 面，无经典 createSourceFile 走线）——正则轻扫替代 AST：
// catch 子句的空块形态语法固定（catch (e) { } / catch { /* 注释 */ }），
// 「} 或 {」配平在同行内判定；跨行空块由「catch 行后紧跟的下一个非空行
// 是 }」覆盖。误报面：字符串字面量含 catch 字样——由关键路径文件预筛
// 收窄，且基线机制兜底。
//
// 存量豁免：首跑产出基线清单 tools/check/silent-catch-baseline.json，
// 门禁只拦**新增**空 catch（存量按节奏消化）。--update-baseline 重生成。
//
// 退出码: 0 = 无新增静默吞错 / 1 = 有新增
// ============================================================

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ENGINE = path.join(ROOT, 'engine');
const BASELINE = path.join(ROOT, 'tools/check/silent-catch-baseline.json');
const UPDATE = process.argv.includes('--update-baseline');

// 关键路径关键词（命中任一即视为「失败不可无痕」域）
const CRITICAL_FILE_HINTS = /audit|persist|notice|daemon|history|snapshot|write|crypto|hmac/i;

// 同行空 catch：catch (...) { } 或 catch { } 或 catch (...) { /* 仅注释 */ }
const SAME_LINE_EMPTY = /catch\s*(\([^)]*\))?\s*\{[\s]*(?:\/\*[^*]*\*\/|\/\/[^\n]*)?[\s]*\}/;

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
const packages = fs.readdirSync(ENGINE, { withFileTypes: true })
  .filter(e => e.isDirectory() && fs.existsSync(path.join(ENGINE, e.name, 'src')));

for (const pkg of packages) {
  const srcDir = path.join(ENGINE, pkg.name, 'src');
  for (const file of collectSources(srcDir)) {
    const rel = path.relative(ROOT, file);
    const content = fs.readFileSync(file, 'utf8');
    if (!CRITICAL_FILE_HINTS.test(rel) && !CRITICAL_FILE_HINTS.test(content.slice(0, 2000))) continue;
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

if (UPDATE) {
  fs.writeFileSync(BASELINE, JSON.stringify([...new Set(findings)].sort(), null, 2) + '\n');
  console.log(`基线已更新：${new Set(findings).size} 条存量记录 → ${path.relative(ROOT, BASELINE)}`);
  process.exit(0);
}

const uniq = [...new Set(findings)];
const newOnes = uniq.filter(f => !baseline.includes(f));
if (newOnes.length === 0) {
  console.log(`✓ 静默吞错检查通过（存量 ${baseline.length} 条按基线豁免，本轮新增 0）`);
  process.exit(0);
}

console.error(`❌ 检测到 ${newOnes.length} 处新增静默吞错（关键路径 catch 空块）：`);
for (const f of newOnes.slice(0, 20)) console.error(`  ${f}`);
if (newOnes.length > 20) console.error(`  ... 共 ${newOnes.length} 处`);
console.error('修法：失败时至少走既有 logger 输出一行 warn（降级可见），或注释「为何可静默」豁免标记。');
console.error('存量修复后收窄基线：node tools/check/check-silent-catch.mjs --update-baseline');
process.exit(1);
