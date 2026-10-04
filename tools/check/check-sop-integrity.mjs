#!/usr/bin/env node
// ============================================================
// check-sop-integrity.mjs · 发版 SOP 阶段文件完整性守卫
// ============================================================
// 存在理由（实测驱动）：`releasing/08-confirm.md` 曾在一份「自查补修」提交里被**静默截断**
//   （35 → 23 行）——新增一段的 hunk 连带删掉了 步骤二正文 + 步骤表三/四/五/六 + 四条铁律，
//   而**没有任何门禁看得见**：SOP 文件既不受 changelog 形态守卫管，也无结构基线。
//   后果实测：执行 session 照残文件跑完阶段八，**漏掉「Release Note body 与发布 prompt
//   同批产出」整个环节**（作者放行时看不到发布物本体），靠作者当场追问才发现。
// 故本守卫钉**结构面**（不判内容对错）：
//   A1 失明自检   扫到的文件数/阶段文件数 < 基线 ⇒ exit 2（路径漂移/目录搬家 = 假绿温床）
//   A2 锚链完整   11 个阶段文件必须各带 SOP-ANCHOR；锚内阶段号须与文件名序号一致；
//                 prev/next 为 `S<k>` 时必须存在对应阶段（端点的括号边标如 `（S1 新周期）` 合法）
//   A3 结构 pin   每份阶段文件的（步骤表行数 / 步骤标题数 / 正文小节数）**三元组**必须等于基线
//                 ——**静默删步骤行、删 `## 步骤X：` 标题、删正文小节、批量截断都会当场红**（核心断言）
//   A4 最小形态   步骤面不成形（表格行与 `## 步骤` 标题双低于下限）⇒ 疑似截断
//                 （两种编排形态皆认：`| 一 | …` 表格式 / `## 步骤一：…` 标题式）
// 附件类文件（auto-converge-protocol / troubleshooting 等非 `NN-` 前缀）A2~A4 不适用（见基线 indexExempt）。
// 维护纪律：**改阶段文件结构时同批更新基线**（与 check-forms 的 EXPECTED_COUNTS 同款；不改守卫）。
//   台账：tools/check/sop-integrity-baseline.json
// 退出码：0 = 全过；1 = 有违规；2 = 检查器失明（拒绝假绿）
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.join(ROOT, 'docs', 'changelog', 'releasing');
const BASE = path.join(ROOT, 'tools', 'check', 'sop-integrity-baseline.json');

const ROW_RE = /^\|\s*(?:—|[一二三四五六七八九十]+|\d+)\s*\|/;
const HEAD_RE = /^##\s*步骤/;
const SEC_RE = /^####\s/;

const all = fs.readdirSync(DIR).filter((f) => f.endsWith('.md')).sort();
const stage = all.filter((f) => /^\d+-/.test(f));
const baseline = JSON.parse(fs.readFileSync(BASE, 'utf8'));
const exempt = new Set(baseline.indexExempt);
const errors = [];

if (all.length < baseline.minFiles || stage.length < baseline.minStageFiles) {
  console.error(`A1 失明自检：${all.length} 文件 / ${stage.length} 阶段文件（基线 ≥${baseline.minFiles} / ≥${baseline.minStageFiles}）——拒绝判定`);
  process.exit(2);
}

for (const f of stage) {
  const lines = fs.readFileSync(path.join(DIR, f), 'utf8').split('\n');
  const rows = lines.filter((l) => ROW_RE.test(l)).length;
  const heads = lines.filter((l) => HEAD_RE.test(l)).length;
  const secs = lines.filter((l) => SEC_RE.test(l)).length;

  // A2 锚链
  const m = (lines.find((l) => l.includes('SOP-ANCHOR:')) || '')
    .match(/SOP-ANCHOR:\s*(S\d+)\s*\|\s*file:\s*(\S+)\s*\|\s*prev:\s*(.*?)\s*\|\s*next:\s*(.*?)\s*-->/);
  if (!m) {
    errors.push(`${f}：A2 缺 SOP-ANCHOR 机器锚（规约：每阶段文件必有——删锚 = 模型失明）`);
  } else {
    const [, sn, anchorFile, prev, next] = m;
    const want = 'S' + parseInt(f.slice(0, 2), 10);
    if (sn !== want) errors.push(`${f}：A2 锚内阶段号 ${sn} ≠ 文件名序号 ${want}`);
    if (anchorFile !== f) errors.push(`${f}：A2 锚内 file=${anchorFile} ≠ 文件名`);
    for (const [k, v] of [['prev', prev], ['next', next]]) {
      const vm = v.match(/^S(\d+)$/);
      if (!vm) {
        if (!/^（/.test(v)) errors.push(`${f}：A2 锚 ${k}="${v}" 既非 S<号> 也非括号边标`);
        continue;
      }
      if (!stage.some((x) => parseInt(x.slice(0, 2), 10) === parseInt(vm[1], 10))) {
        errors.push(`${f}：A2 锚 ${k}=${v} 指向不存在的阶段`);
      }
    }
  }

  // A4 最小形态（双低 = 疑似截断）
  if (rows < baseline.a4MinRows && heads < baseline.a4MinHeadings) {
    errors.push(`${f}：A4 步骤面不成形（表格 ${rows} 行 / 步骤标题 ${heads} 个，双低于下限）——疑似截断`);
  }

  // A3 结构 pin（核心）
  const pin = baseline.files[f];
  if (!pin) { errors.push(`${f}：不在基线台账内——新增阶段文件须同批登记基线`); continue; }
  if (rows !== pin.stepRows) errors.push(`${f}：A3 步骤表行数 ${rows} ≠ 基线 ${pin.stepRows}（静默增删步骤即红——改表须同批更新基线）`);
  if (heads !== pin.stepHeadings) errors.push(`${f}：A3 步骤标题数 ${heads} ≠ 基线 ${pin.stepHeadings}（静默删步骤即红）`);
  if (secs !== pin.bodySections) errors.push(`${f}：A3 正文小节数 ${secs} ≠ 基线 ${pin.bodySections}（静默删正文即红）`);
}

// 总览表收录一致性
const index = fs.readFileSync(path.join(ROOT, 'docs', 'changelog', 'releasing.md'), 'utf8');
const listed = [...index.matchAll(/\(\.\/releasing\/([a-z0-9-]+\.md)\)/g)].map((x) => x[1]);
const unlisted = all.filter((f) => !listed.includes(f) && !exempt.has(f));
if (unlisted.length) errors.push(`releasing.md 一览表未收录：${unlisted.join(', ')}（两处清单漂移）`);

console.log('════════════════════════════════════════════════════════════');
console.log('  sofagent · 发版 SOP 阶段文件完整性守卫（check-sop-integrity）');
console.log('════════════════════════════════════════════════════════════');
console.log(`  ✓ A1 扫描面 ${all.length} 文件（阶段 ${stage.length} · 附件豁免 ${exempt.size}）`);
console.log(`[check:coverage] script=check-sop-integrity asserts=4 covered=${stage.length} skipped=${exempt.size}`);
if (errors.length === 0) {
  console.log('  ✅ 全部通过：锚链完整 · 结构 pin 三元组一致 · 无截断迹象');
  process.exit(0);
}
console.log(`  ❌ ${errors.length} 处违规：`);
for (const e of errors) console.log(`     · ${e}`);
console.log('  处置：改阶段文件结构时同批更新 tools/check/sop-integrity-baseline.json（不是改守卫）');
process.exit(1);
