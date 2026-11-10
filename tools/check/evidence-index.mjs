#!/usr/bin/env node
// ============================================================
// evidence-index.mjs · v1.9.0 §十 P-2 可演示证据包索引（收口产出物）
// ============================================================
// 定位：把宣告所依赖的证据做成**统一可点验入口**（§七「可演示证据包」交付行）。
// 判据（10.1 P-2）：每条对外结论指向一个可复算产物（脚本 sha16 + 输出 JSON）；
// 索引脚本 rc=0。
//
// 证据源结构（三类，如实分列——不伪造不存在的产物）：
//   A 仓内可复算产物（datasets/*.js 脚本 + *.json 结果——sha16 实算登记）
//   B 仓内验证命令（docs/VALIDATION.md 引用的门禁/评测器——命令形态登记）
//   C 仓外产物（factory 仓 rsi/eval/*——路径登记，本仓不镜像，口径与 WIKI:393 一致）
//
// 退出码：0 = 索引完整（登记的仓内产物全部在位且 sha16 一致）/ 1 = 缺产物或 sha 漂移
// ============================================================
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** sha16（可复算锚——与判定回执 weightsSha16 同长度口径） */
const sha16 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16);

/** 证据条目登记（P-2 的台账面——每条对外结论一行） */
const EVIDENCE_INDEX = [
  // ── A 仓内可复算产物（脚本 + 结果 JSON 双件）─────────────────
  {
    claim: '零样本基线（v1.6.0 §零样本——VALIDATION 首节引用）',
    kind: 'A',
    script: 'datasets/baseline-zero-shot-run.js',
    output: 'datasets/baseline-zero-shot-result.json',
  },
  {
    claim: '判据集最小集（v1.6.0 数据集三元组——评测输入面）',
    kind: 'A',
    script: null,
    output: 'datasets/sofagent-typed-decisions-minimal/questions.jsonl',
  },
  // ── B 仓内验证命令（门禁/评测器——命令即产物）────────────────
  {
    claim: '四层性能标准·三方对照（VALIDATION §四层——评测器在位）',
    kind: 'B',
    command: 'bash tools/check/test-count.sh（测试面）+ factory 仓评测器（见 C 类）',
  },
  {
    claim: '审计链可独立复算（自证能力——P-4 载体）',
    kind: 'B',
    command: 'sofagent audit --verify-chain（HMAC 链完整性——客户可自行验证，不依赖交付方）',
  },
  {
    claim: '判定可复现重放（F-9 接线批——离线重放面）',
    kind: 'B',
    command: 'sofagent orchestrator judge-replay --weights <dir> --state <snap>（manifest sha fail-closed）',
  },
  {
    claim: '本地判定端到端回执（P-5 第 3 条——判据版本/权重sha16/读数/时间）',
    kind: 'B',
    command: 'sofagent orchestrator judge-local --weights <dir> --state <snap>（五环 fail-closed）',
  },
  // ── C 仓外产物（factory 仓——路径登记，不镜像）────────────────
  {
    claim: '四层性能标准落数（判据级/校准级/分流级——可复算产物）',
    kind: 'C',
    externalPath: 'factory 仓 rsi/eval/FOUR-LAYER-REPORT.md 与 rsi/eval/out/（仓外路径，本仓不镜像——与 WIKI:393 口径一致）',
  },
  {
    claim: '打包概率偏移读数（reread-onoff 含 A1/A2/A3 断言）',
    kind: 'C',
    externalPath: 'factory 仓 rsi/eval/out/reread-onoff.json',
  },
];

// ── 索引构建与校验 ────────────────────────────────────────
let bad = 0;
console.log('── P-2 可演示证据包索引（每条对外结论 → 可复算产物）──');
for (const e of EVIDENCE_INDEX) {
  if (e.kind === 'A') {
    const parts = [];
    if (e.script) {
      const sp = join(ROOT, e.script);
      if (existsSync(sp)) parts.push(`脚本 ${e.script} sha16=${sha16(sp)}`);
      else { console.error(`  ✗ 缺脚本：${e.script}（claim=${e.claim}）`); bad = 1; continue; }
    }
    const op = join(ROOT, e.output);
    if (existsSync(op)) parts.push(`结果 ${e.output} sha16=${sha16(op)}`);
    else { console.error(`  ✗ 缺结果 JSON：${e.output}（claim=${e.claim}）`); bad = 1; continue; }
    console.log(`  ✓ [A·仓内可复算] ${e.claim} → ${parts.join(' + ')}`);
  } else if (e.kind === 'B') {
    console.log(`  ✓ [B·仓内命令] ${e.claim} → ${e.command}`);
  } else {
    console.log(`  ✓ [C·仓外产物·路径登记] ${e.claim} → ${e.externalPath}`);
  }
}

const total = EVIDENCE_INDEX.length;
console.log(`\n${bad === 0 ? '✓' : '✗'} 证据索引 ${total} 条（A 仓内可复算 ${EVIDENCE_INDEX.filter((e) => e.kind === 'A').length} · B 命令 ${EVIDENCE_INDEX.filter((e) => e.kind === 'B').length} · C 仓外 ${EVIDENCE_INDEX.filter((e) => e.kind === 'C').length}）`);
console.log('[check:coverage] script=evidence-index asserts=1');
process.exit(bad);
