// ============================================================
// prompt-fork-lint.mjs · 任务书「零分支」lint（被 check-dev-prompt.sh 调用）
// ============================================================
// 规则（用户 2026-09-28 拍板）：**交给执行方的任务书不得留选择**——禁「方案 A/B」
//   「二选一」「视情况而定」「由你决定」等分支；出题方须在出题阶段比完并**选定一条**。
//   注：**沟通阶段可以给多条方案 + 推荐**（有对比性），**落盘阶段只留选定的一条**——
//   本 lint 只管落盘物（prompt 文件），不管讨论稿与汇报。
//
// 用法: node tools/check/lib/prompt-fork-lint.mjs <file.md>
// 输出（stdout，逐行，供 shell 消费）:
//   SKIP\t<原因>                        — 非 prompt 类，未扫描（显式打印，禁静默）
//   VIOLATION\t<行号>\t<命中词>\t<行摘>  — 应修
//   EXEMPT\t<行号>\t<命中词>\t<理由>     — 豁免（否定语境 / 台账）
//   SUMMARY\tviolations=N\texempt=N\tconclusion=N\tscanned=N
// 退出码: 0 = 无违规（含未扫描）/ 1 = 有违规 / 3 = 内部故障或自检失败（拒绝假绿）
//
// ── 失效模式分析（改本文件前先读）──────────────────────────────
//   ① **误报：免责声明/规则引用**——prompt 里写「无『视情况而定』」「禁「方案 A/B」」本是
//      正当表述。⇒ 规则：命中词**前 12 字符内含否定词**（无/不/禁/非/没有/不得/禁止/避免）
//      即豁免（计 EXEMPT 并打印，不静默）。实测：本 prompt 首版即被此条救下。
//   ② **误报：A/B 是本仓正当术语**（A/B 测试 / A/B 对比 / ab-test / run_ab_test）——⇒
//      正则**必须带名词上下文**（「方案/路线/路径/做法/方法/选项 + A|B」），**禁裸 A/B**。
//   ③ **误判：报告/讨论稿合法含选项**（给维护者的「① 架构变更 / ② 上限重估」）——⇒
//      按**文件名类**放行：basename 不含 `prompt`（不分大小写）即 SKIP 并打印原因。
//      ⚠️ 已知洞：若把任务书命名成不含 `prompt` 的名字会被放行 ⇒ SOP 约定任务书文件名须含
//      `prompt`，且 SKIP 行必打印（覆盖度可见）。
//   ④ **漏报：换措辞**（"你觉得哪种好"）——词表天然覆盖不到 ⇒ 人机双轨：SOP §二第 8 条
//      人工自查 + 本 lint 机械兜底。
//   ⑤ **绕过：为绿而删正当引用**——台账须逐条带理由，台账变更进 review。
//   ⑥ **模式被改坏 ⇒ 静默空扫**——内置自检测**最终判定**（含豁免），不通过即 exit 3。
//      （首版自检只测正则 ⇒ P2「无『视情况而定』」被误判为命中，自检当场抓出并于本版修正。）
// ============================================================
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── 判据：分支词（必须带上下文；禁裸 A/B —— 见失效模式 ②）──
const FORK_RE =
  /(二选一|二择一|视情况而定|视具体情况而定|由你决定|自行决定|你来定|可选项|可选方案|任选其一|任选一种|择一|(方案|路线|路径|做法|方法|选项)\s*[A-D]\b|选\s*[AB]\b|[AB]\s*(方案|路线))/g;
// ── 否定语境窗口：命中词前 N 字符内出现否定词 ⇒ 视为「自述禁则/规则引用」──
const NEG_RE = /(无|不|禁|非|没有|不得|禁止|避免)/;
const NEG_WINDOW = 12;
// ── 正向覆盖证据：结论标记（只统计不判定，证明「确实收敛过」）──
const CONCL_RE = /(无分支|已裁定|已选定|唯一结论|无待决|收敛为)/g;
// ── prompt 类判定（见失效模式 ③）──
const PROMPT_FILE_RE = /prompt/i;

/** 扫描单行的**最终判定**（正则 + 否定语境豁免）——自检与主流程共用同一谓词，防止两面走调 */
function scanLine(line) {
  const out = [];
  for (const m of line.matchAll(FORK_RE)) {
    const before = line.slice(Math.max(0, m.index - NEG_WINDOW), m.index);
    out.push({ term: m[0], exemptReason: NEG_RE.test(before) ? '否定语境（自述禁则/规则引用）' : null });
  }
  return out;
}

/** 内置自检：测**最终判定**（含豁免），任一不符即 exit 3 —— 绝不静默空扫 */
function selfCheck() {
  const cases = [
    ['方案 A：改配置 / 方案 B：改代码', 2, 0],                    // P1 真分支 ⇒ 2 违规（同行两个分支词）
    ['本 prompt 已收敛：全程无分支、无「视情况而定」。', 0, 1],     // P2 否定语境 ⇒ 0 违规 / 1 豁免
    ['复用既有 A/B 测试基建（run_ab_test）。', 0, 0],              // P3 正当术语 ⇒ 全不命中
  ];
  for (const [text, wantV, wantE] of cases) {
    const r = scanLine(text);
    const v = r.filter((x) => !x.exemptReason).length;
    const e = r.filter((x) => x.exemptReason).length;
    if (v !== wantV || e !== wantE) {
      console.error(
        `❌ prompt-fork-lint 自检失败（判据被改坏）：${JSON.stringify(text)} 期望 违规=${wantV}/豁免=${wantE} 实际 违规=${v}/豁免=${e}`,
      );
      process.exit(3);
    }
  }
}
selfCheck();

const file = process.argv[2];
if (!file) {
  console.error('用法: node tools/check/lib/prompt-fork-lint.mjs <file.md>');
  process.exit(3);
}
if (!existsSync(file)) {
  console.error(`文件不存在: ${file}`);
  process.exit(3);
}
const name = basename(file);
if (!PROMPT_FILE_RE.test(name)) {
  console.log(`SKIP\t非 prompt 类（${name}）——报告/讨论稿/开发日志允许方案对比；任务书文件名须含 prompt`);
  process.exit(0);
}

// ── 台账（行归一化 sha256 前 16 位 → 理由；**不用行号**：行号漂移会静默放行）──
const HERE = dirname(fileURLToPath(import.meta.url));
const LEDGER = join(HERE, '..', 'prompt-fork-baseline.json');
let ledger = {};
try {
  if (existsSync(LEDGER)) ledger = JSON.parse(readFileSync(LEDGER, 'utf8')).exempt ?? {};
} catch (e) {
  console.error(`❌ 台账解析失败（${LEDGER}）：${e.message}`);
  process.exit(3);
}
const sig = (line) => createHash('sha256').update(line.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 16);

const lines = readFileSync(file, 'utf8').split('\n');
let violations = 0;
let exempt = 0;
let conclusion = 0;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  for (const _ of line.matchAll(CONCL_RE)) conclusion++;
  for (const h of scanLine(line)) {
    if (h.exemptReason) {
      exempt++;
      console.log(`EXEMPT\t${i + 1}\t${h.term}\t${h.exemptReason}`);
      continue;
    }
    const s = sig(line);
    if (ledger[s]) {
      exempt++;
      console.log(`EXEMPT\t${i + 1}\t${h.term}\t台账：${ledger[s]}`);
      continue;
    }
    violations++;
    console.log(`VIOLATION\t${i + 1}\t${h.term}\t${line.trim().slice(0, 80)}`);
  }
}
console.log(`SUMMARY\tviolations=${violations}\texempt=${exempt}\tconclusion=${conclusion}\tscanned=${lines.length}`);
process.exit(violations > 0 ? 1 : 0);
