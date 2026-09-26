#!/usr/bin/env node
// ============================================================
// check-paired-records.mjs · 判决类记录成对完整门禁（v1.5.3 第六章）
// ============================================================
// 用法: node tools/check/check-paired-records.mjs [--self-test]
//
// 第六章验收：「凡判决必成对（N 态判据）」——**声明 N 态即须落 N 态**。
// 机械普查全仓「判决类记录类型」（写出裁决/门禁/放行拦截语义的落盘面），
// 与登记表逐类对账：
//   ① 声明态 × 实落态矩阵：登记表声明每个家族的 N 态 + 各态的生产写入点；
//   ② 缺侧即红：声明的态找不到任何生产写入点（含 why.text 模板）⇒ FAIL；
//   ③ 盲区即红（未登记的判决写入点）：静态扫全仓 `kind: '...'` 写入面 +
//      egress verdict / runtime verdict 等判决模板，不在登记表 ⇒ FAIL
//      （「新增判决类记录类型必须同批声明配对侧」的机械执行）；
//   ④ 豁免显式登记：天然单边/无生产写入面的类型登记 `exempt` 并写理由——
//      静默放行即缺陷（对齐「静默即缺陷」纪律）。
//
// 扫描面与判定（避免假红的设计）：
//   - 全仓源面：自 ROOT 递归收 .ts/.mjs/.js/.sh（排除 dist/node_modules/.git/
//     .sofagent/docs/__tests__ + *.d.ts + *.test.*/*.spec.* + 本脚本自身）；
//   - 「生产写入点」判据 = 文件内出现 `kind: '<KIND>'`（对象字面量写入模板）；
//   - 态级判据 = 写入点邻近 ±6 行内出现该态的模板字面量（如 '拦截'/'放行'/'Allow'/'Deny'）。
//     判决文案多为模板拼接（`tool-gate ${...拦截/放行/告警}` / `出站裁决 Allow|Deny`），
//     邻域匹配能捕获模板内全部声明态。
//
// ── 已知盲区登记（2026-09-26 复核 + S1/S4 收口 · 「静默即缺陷」纪律）──
//   扫不到却可能报绿（仍存的残余盲区）：
//     (S2) 写入形态仅匹配单行 kind 字面量（`kind:` + 单引号大写字面量）——变量 kind /
//          DecisionKind 成员访问（kind: DecisionKind.X）/ 跨行写法 / 非大写 kind /
//          JSON 双引号形态（"kind":"X"）均不命中。当前实测全仓写入均为字面量形态，
//          故判据有效；口径收窄即缺陷面。
//     (S3) 缺侧判据 stateLandsIn 为**子串存在**判定——态词出现于注释/无关串即算「落」
//          （如 rule-a5 注释含 PASS/FAIL/SKIPPED）。现有五家族均有真实写入行佐证，但
//          仅靠注释亦可「假绿」——态级「实落」是弱证据，非「确有该态判决被发出」。
//   何时假红（越界红 / 设计内的红须区分）：
//     (F1) 新建真判决类 kind 未同批登记 ⇒ ② 红（**设计如此，非假红**）；
//     (F2) 登记的 writer 文件被改名/移动 ⇒ ① 文件在位核验红（登记表腐化检出）；
//     (F3) 非判决豁免集 kind 拼错 / 缺 reason+trigger ⇒ ③ 红（**设计如此**）；
//     (F4) 源文件内出现**非写入**的同形字面量（注释/示例文本含该字面量）⇒ ② 假红。
//
// ── S1/S4 收口记录（2026-09-26 · 属第六章「全仓普查 / 豁免不静默」规格内，非蔓延）──
//   S1（扫描面扩到全仓源面）：原只收 engine/**/*.ts + FORGE/src/**.mjs。现扩到自 ROOT
//     递归并排除运行时数据/叙事/测试面。**实测零新增红**——新增面命中只有 TOOL_GATE
//     （engine/audit/verify/verify-chain.mjs · tools/verify/verify-chain.mjs）与既有登记/
//     非判决 kind（playbook/acceptance-*.{sh,js}），均在登记或豁免内。自排除本脚本
//     （--self-test 夹具内嵌未登记 kind 字符串，扫自身会自红）。.sofagent/ 为 gitignored
//     运行时数据（.git-shadow/snapshots.json），**非写入面**故排除。
//   S4（豁免显式登记 reason+trigger）：非判决豁免集由裸 Set 改为 {kind, reason, trigger}；
//     判定③ 增断言「缺 reason/trigger ⇒ 红」——「误并入豁免集」从「无兜底」改为
//     「须带正当事由 + 改判触发条件」。**不做『是否真判决类』的语义推断**（那会引入
//     不可靠启发式——本门禁只做机械判据）。
//
// --self-test：注入「单边缺侧」的临时源文件样例 → 断言门禁判红（故障注入实证，
//   供验收与 paired-records.test.ts 复用同一机制）。
//
// 退出码: 0 = 登记表与实测一致（N 态全有写入点 / 无未登记判决写入点）
//         1 = 缺侧 / 盲区 / 登记表自身腐化（找不到声明的写入文件等）
// ============================================================

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SELF_TEST = process.argv.includes('--self-test');

// ── 判决类记录家族登记表（单一事实源——新类型必须同批登记）──────────────
// 字段：
//   family    家族名（人读）
//   kind      decision-log kind（无 kind 的落盘面用记录类型名）
//   states    声明的 N 态（该判决的全部可取值——二元对是 N=2 特例）
//   writers   生产写入点（file 相对仓根 + 行锚提示；用于①文件在位核验 + ②态级邻域匹配）
//   exempt    豁免登记：{ states: [态], reason } —— 天然单边/无生产面的态显式登记
//   blindSpot 无生产写入面的整类登记：{ reason, trigger } —— 声明了枚举但零生产写入
const REGISTRY = [
  {
    family: '工具门禁裁决（TOOL_GATE）',
    kind: 'TOOL_GATE',
    states: ['放行', '拦截', '告警', '待人工批准'],
    writers: [
      { file: 'FORGE/src/audit-middleware.mjs' },                 // why.text: tool-gate ${拦截/告警/放行/待人工批准}
      { file: 'engine/audit/src/egress-audit.ts' },               // 出站裁决 Allow|Deny（egress 面）
      { file: 'engine/orchestrator/src/middleware/dual-gate-mw.ts' },
      { file: 'engine/orchestrator/src/middleware/mandate-gate-mw.ts' },
      { file: 'engine/dsh-plugins/cordis-plugin-sofagent-audit/src/index.ts' },
      { file: 'engine/mcp/src/tools/acceptance.ts' },
    ],
    // 态级豁免：并非每个 writer 都写全四态（如 egress 面只有 Allow/Deny 语义）——
    // 成对判据按**家族聚合**判定：N 态在全部 writer 并集内可落即可（单一 writer
    // 天然只承担其面的态）。无态级豁免。
    exempt: undefined,
  },
  {
    family: '出站裁决（egress · TOOL_GATE 子面）',
    kind: 'EGRESS_VERDICT',
    states: ['Allow', 'Deny'],
    writers: [{ file: 'engine/audit/src/egress-audit.ts' }],
    exempt: undefined,
  },
  {
    family: '审计规则判定（RuleCheck.status）',
    kind: 'RULE_CHECK_STATUS',
    states: ['PASS', 'WARN', 'FAIL', 'SKIPPED'],
    writers: [
      { file: 'engine/audit/src/rules/rule-a5-honest-report.ts' },  // PASS/WARN/FAIL/SKIPPED 全谱
      { file: 'engine/audit/src/rules/rule-a1-sensitive-files.ts' }, // PASS/FAIL/SKIPPED
    ],
    exempt: undefined,
  },
  {
    family: 'HITL 挂起支路（runtime audit）',
    kind: 'HITL_BRANCH',
    states: ['HITL_PENDING', 'HITL'],
    writers: [{ file: 'FORGE/src/audit-middleware.mjs' }],
    exempt: undefined,
  },
  {
    family: '结论失效标记（INVALIDATION）',
    kind: 'INVALIDATION',
    states: ['authorization-changed', 'incompatible-compaction', 'elevated-risk', 'stale-score', 'fresh-required'],
    writers: [
      { file: 'engine/audit/src/invalidation.ts' },               // hooks 面（五 reason 全域分发）
      { file: 'engine/audit/src/index.ts' },                      // onAuthorizationChanged 消费面
    ],
    exempt: undefined,
  },
  {
    family: '规则启停（RULE_TOGGLE）',
    kind: 'RULE_TOGGLE',
    states: ['启用', '停用'],
    writers: [],
    // 🔴 盲区登记（2026-09-26 实测）：全仓零生产写入点——index.ts 关规则走
    //   INVALIDATION（authorization-changed）而非 RULE_TOGGLE；枚举自 v1.3.7 以来
    //   仅测试引用。**不造写入点**（任务书纪律：勿为凑样本造写入点）。
    blindSpot: {
      reason: '全仓零生产写入（唯一命中 = decision-schema 枚举定义 + 测试 + acceptance 夹具）；运行时规则启停的留痕实际走 kind=INVALIDATION（authorization-changed，index.ts:1270），语义已被该 kind 覆盖。',
      trigger: '当出现真实「用户/Agent 显式启停单条规则」的功能面（如 ruleset 热开关）时，在该功能写入 kind=RULE_TOGGLE 记录（含 启用/停用 两态）并删除本盲区登记；或确认永不做该功能面时把枚举值移出 DecisionKind（schema 收缩走发版纪律）。',
    },
  },
  {
    family: '升级人工（ESCALATE_REPORT）',
    kind: 'ESCALATE_REPORT',
    states: ['升级'],
    writers: [],
    // 🔴 盲区登记：escalation/policy.ts 注释声称「orchestrator/daemon 据此记
    //   ESCALATE_REPORT」，实测两侧均无该 kind 写入（读侧仅 contribution.ts
    //   把它计入「人工介入」统计 + weekly-digest 展示）。声明与实落不符——登记为盲区。
    blindSpot: {
      reason: 'core/escalation/policy.ts:11 注释声称 orchestrator/daemon 会写该 kind，实测两侧零写入（读侧 contribution.ts/weekly-digest.ts 消费它——读面在、写面缺）；升级人工的实际留痕走 daemon companion/orchestrator 的 ORCHESTRATION/ESCALATE 事件面。',
      trigger: 'orchestrator/daemon 的升级人工路径落 emitDecision 时补 kind=ESCALATE_REPORT 写入并删除本登记；或在 v1.6.0 判据章确认由 ORCHESTRATION 承载升级语义后，把该枚举值标注 deprecated-in-schema。',
    },
  },
  {
    family: '成本告警（COST）',
    kind: 'COST',
    states: ['超支告警'],
    writers: [],
    // 🔴 盲区登记：should-run gate 的 quota 五问**读** queryByKind('COST')，
    //   但全仓无人**写**——读面依赖一个永空的 kind = 五问之一恒过（可判定性存疑）。
    blindSpot: {
      reason: '读面在（orchestrator/events/should-run.ts quota 五问 + cli.ts queryCostDecisions），写面零（全仓无 kind=COST 的 emitDecision）——quota 闸门实际恒空过。这是「声明态有读无写」的成对缺陷实例，如实登记待补写面。',
      trigger: 'budget 超支告警的写入面落地时（train-budget.ts 已有预算读取面，补 emitDecision kind=COST 即闭环）删除本登记；v1.6.0 判据侧消费 COST 前必须先解决本盲区（判据不得建立在永空记录上）。',
    },
  },
];

// 非判决类 kind（观测/过程记录——天然无「两侧」语义）整类豁免。
// S4 收口（2026-09-26）：豁免**必须显式登记** {kind, reason, trigger}——
//   reason=正当事由（为何天然单边/无判决语义）· trigger=改判触发条件（何时应移出豁免、改判为判决类）。
//   「静默豁免即缺陷」：缺任一字段 ⇒ 判定③ 判红。**不做「是否真判决类」的语义推断**
//   （那会引入不可靠启发式——本门禁只做「拼写×枚举对账 + 事由/触发完备」的机械判据）。
const NON_VERDICT_KINDS = [
  { kind: 'SPEC_CHANGE', reason: '记录「需求/规格被改动」这一事实（范围变更留痕），动作本身无通过/拒绝两侧语义。', trigger: '若出现规格变更的裁决面（批准/驳回一次规格变更）→ 立新判决 kind 并声明配对侧，本条移出豁免。' },
  { kind: 'ARTIFACT_EDIT', reason: '记录产物文件（代码/文档/配置）被编辑，编辑动作无裁决态。', trigger: '若出现「产物变更的放行/拦截」硬闸 → 立新判决 kind 并声明配对侧。' },
  { kind: 'CONFIG_CHANGE', reason: '记录运行时配置被修改（如 doctor --refresh 重置），无裁决两侧。', trigger: '若配置变更引入审批闸（改前须批准/否决）→ 立新判决 kind。' },
  { kind: 'KNOWLEDGE_DISTILL', reason: '知识蒸馏/沉淀的过程记录，无裁决态。', trigger: '若蒸馏引入接纳/拒绝判定（蒸馏质量闸）→ 立新判决 kind。' },
  { kind: 'ORCHESTRATION', reason: '编排委派/图路由的「决策」留痕（category=route）——决策≠判决，无通过/拒绝两侧。', trigger: '若编排引入硬性准入裁决 → 立新判决 kind。' },
  { kind: 'EVOLUTION', reason: '进化动作留痕（优化器改经验层/回滚）；Benchmark accept-reject 记在 evidence 内，本 kind 是动作记录非判决边。', trigger: '若把 Benchmark accept/reject 提升为一等判决 kind → 移出豁免并声明配对侧。' },
  { kind: 'TEAM', reason: '团队协作动作（冲突消解/广播/反馈放大/入队）记录，无裁决成对语义。', trigger: '若冲突消解产生「裁决/上诉」成对语义 → 立新判决 kind。' },
  { kind: 'COMMONS', reason: '公地能力动作（能力发布/调用/评分/退役/SkillScan）过程记录。', trigger: '若公地引入放行/拒绝安装的成对判决 → 立新判决 kind。' },
  { kind: 'COVERAGE', reason: 'trace 三源对账结果入 log（说的和干的差在哪）——度量记录非判决。', trigger: '若覆盖率出现通过/未通过闸 → 立新判决 kind。' },
  { kind: 'FALLBACK_DEGRADE', reason: '降级执行（LLM 不可用等）过程记录，无裁决两侧。', trigger: '若降级引入「允许降级/拒绝降级」判决 → 立新判决 kind。' },
];
const NON_VERDICT_KIND_SET = new Set(NON_VERDICT_KINDS.map((e) => e.kind));

// ── 收集源文件（全仓源面 · S1 扩面 2026-09-26）────────────────────────
// 口径：自 ROOT 递归，收 .ts/.mjs/.js/.sh 源文件；排除 dist/node_modules/.git/
//   .sofagent（运行时数据，非写入面）/docs（叙事，非写入面）/__tests__；
//   跳过 *.d.ts / *.test.* / *.spec.*。**自排除本门禁脚本自身**——其 --self-test
//   夹具刻意内嵌「未登记 kind」字符串（见 self-test 段），扫描自身会自红。
// 实测依据：全仓 kind 字面量普查（2026-09-26）落在 engine/(157) · tools/(12) ·
//   playbook/(8) · FORGE/(1) · .sofagent/(109，gitignored 运行时数据)；本口径
//   覆盖前四者，排除 .sofagent。
const SELF_FILE = path.resolve(import.meta.dirname, 'check-paired-records.mjs');
const EXCLUDE_DIRS = new Set(['dist', 'node_modules', '.git', '.sofagent', 'docs', '__tests__', 'coverage', '.turbo']);
const EXTS = ['.ts', '.mjs', '.js', '.sh'];
function collectFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (EXCLUDE_DIRS.has(e.name)) continue;
        walk(p);
      } else if (path.resolve(p) !== SELF_FILE && EXTS.some((x) => e.name.endsWith(x)) && !e.name.endsWith('.d.ts')) {
        if (e.name.includes('.test.') || e.name.includes('.spec.')) continue;
        out.push(p);
      }
    }
  };
  walk(ROOT);
  return out;
}

const FILES = collectFiles();
const CONTENT = new Map(FILES.map((f) => [f, fs.readFileSync(f, 'utf8')]));

/** 文件内查找「态模板」：态字面量出现即算该态可落（含模板拼接邻域） */
function stateLandsIn(file, state) {
  const c = CONTENT.get(file);
  if (!c) return false;
  // 直接字面量（含模板内）
  if (c.includes(`'${state}'`) || c.includes(`"${state}"`) || c.includes('`' + state)) return true;
  // 中文字面量常以裸文出现（why.text 模板内「拦截」等）
  if (/[\u4e00-\u9fff]/.test(state) && c.includes(state)) return true;
  return false;
}

let failures = 0;
const fail = (msg) => { console.error(`  ❌ ${msg}`); failures++; };
const okOut = (msg) => console.log(`  ✓ ${msg}`);

// ── 判定 ①：每家族声明的 N 态在 writers 并集内可落（缺侧即红）──────────
console.log('── ① 声明态 × 实落态矩阵（N 态缺侧检查）──');
for (const fam of REGISTRY) {
  if (fam.blindSpot) {
    okOut(`${fam.family}——盲区登记在位（理由+触发条件），跳过态级检查`);
    continue;
  }
  // writer 文件在位核验（登记表腐化检测）
  for (const w of fam.writers) {
    const abs = path.join(ROOT, w.file);
    if (!fs.existsSync(abs)) { fail(`${fam.family}：登记的写入点文件不存在——${w.file}（登记表腐化）`); }
  }
  const exemptStates = new Set(fam.exempt ? fam.exempt.states : []);
  for (const state of fam.states) {
    if (exemptStates.has(state)) { okOut(`${fam.family}：态「${state}」豁免登记（${fam.exempt.reason}）`); continue; }
    const lands = fam.writers.some((w) => stateLandsIn(path.join(ROOT, w.file), state));
    if (!lands) {
      fail(`${fam.family}：声明态「${state}」在全登记写入点内零命中——缺侧（补写入点或登记豁免）`);
    }
  }
  const landed = fam.states.filter((s) => !exemptStates.has(s) && fam.writers.some((w) => stateLandsIn(path.join(ROOT, w.file), s)));
  okOut(`${fam.family}：${landed.length}/${fam.states.length} 态实落（${fam.states.filter(s=>!exemptStates.has(s)).join(' · ')}）`);
}

// ── 判定 ②：盲区扫描——全仓 kind 写入模板 vs 登记表（未登记的判决写入点即红）──
console.log('── ② 盲区扫描（未登记的判决类写入点）──');
const registeredKinds = new Set(REGISTRY.map((f) => f.kind));
const KIND_WRITE_RE = /kind:\s*'([A-Z_]+)'/g;
const unregistered = new Map(); // kind -> [file:line]
for (const [file, content] of CONTENT) {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    KIND_WRITE_RE.lastIndex = 0;
    const m = KIND_WRITE_RE.exec(lines[i]);
    if (!m) continue;
    const kind = m[1];
    if (NON_VERDICT_KIND_SET.has(kind)) continue;      // 观测/过程类——整类豁免（须带 reason/trigger）
    if (registeredKinds.has(kind)) continue;           // 已登记
    if (kind === 'TOOL_GATE' || kind === 'INVALIDATION') continue; // 已由家族覆盖
    const rel = path.relative(ROOT, file);
    if (!unregistered.has(kind)) unregistered.set(kind, []);
    unregistered.get(kind).push(`${rel}:${i + 1}`);
  }
}
if (unregistered.size === 0) {
  okOut('零未登记判决类写入点（全部 kind 在登记表或非判决豁免集内）');
} else {
  for (const [kind, locs] of unregistered) {
    fail(`未登记的判决类 kind「${kind}」出现于生产源：${locs.slice(0, 3).join(', ')}${locs.length > 3 ? ` …共${locs.length}处` : ''}——新判决类型必须同批登记配对侧（REGISTRY）`);
  }
}

// ── 判定 ③：非判决豁免集自检——① kind 真实存在于 DecisionKind 枚举（防拼错静默豁免）
//            ② 每条豁免齐备 reason（正当事由）+ trigger（改判触发条件）（S4 收口 · 不静默放行）──
console.log('── ③ 豁免集自检（拼写×枚举对账 + reason/trigger 完备）──');
const schemaPath = path.join(ROOT, 'engine/audit/src/decision-schema.ts');
const schema = fs.readFileSync(schemaPath, 'utf8');
for (const e of NON_VERDICT_KINDS) {
  const inEnum = schema.includes(`'${e.kind}'`);
  if (!inEnum) fail(`非判决豁免集含「${e.kind}」但 DecisionKind 枚举无此值（拼错=静默豁免真判决类）`);
  if (!e.reason || e.reason.trim() === '') fail(`非判决豁免「${e.kind}」缺 reason（正当事由）——静默豁免即缺陷（S4）`);
  if (!e.trigger || e.trigger.trim() === '') fail(`非判决豁免「${e.kind}」缺 trigger（改判触发条件）——静默豁免即缺陷（S4）`);
  if (inEnum && e.reason && e.trigger) okOut(`豁免「${e.kind}」：枚举对账一致 · reason+trigger 齐备`);
}

// ── --self-test：故障注入实证（单边缺侧样例 → 必红）────────────────────
if (SELF_TEST) {
  console.log('── self-test：注入「未登记判决类 kind」样例 → 门禁必须判红 ──');
  // 构造：往 CONTENT 注入一个未登记 kind 的假写入（不写盘——只污染本次判定输入）
  const fakeFile = '/injected/fake-verdict-writer.ts';
  CONTENT.set(fakeFile, `export const x = { kind: 'INJECTED_UNREGISTERED_VERDICT', moment: 'ACT' };\n`);
  // 重跑判定 ②（内联重放）
  const hits = [];
  for (const [file, content] of CONTENT) {
    for (const m of content.matchAll(/kind:\s*'([A-Z_]+)'/g)) {
      const kind = m[1];
      if (NON_VERDICT_KIND_SET.has(kind) || registeredKinds.has(kind) || kind === 'TOOL_GATE' || kind === 'INVALIDATION') continue;
      hits.push(`${file}（kind=${kind}）`);
    }
  }
  const injectedCaught = hits.some((h) => h.includes('INJECTED_UNREGISTERED_VERDICT'));
  if (injectedCaught) {
    okOut(`故障注入被捕获：${hits.find((h) => h.includes('INJECTED'))}——门禁对未登记判决类判红（负向探针 PASS）`);
  } else {
    fail('self-test 失败：注入的未登记判决类 kind 未被捕获（门禁失明）');
  }
  // 缺侧注入：声明态 '永不落盘态' 的假家族 → 必红（内联重放判定①的核心谓词）
  const fakeFamily = { family: 'SELFTEST', states: ['永不落盘态'], writers: [{ file: 'engine/audit/src/scope.ts' }] };
  const fakeLands = fakeFamily.writers.some((w) => stateLandsIn(path.join(ROOT, w.file), fakeFamily.states[0]));
  if (!fakeLands) {
    okOut("故障注入被捕获：假家族态「永不落盘态」判缺侧（负向探针 PASS）");
  } else {
    fail('self-test 失败：假家族态竟然实落（stateLandsIn 判定面失明）');
  }
}

// ── 汇总 ──
console.log('');
if (failures > 0) {
  console.error(`❌ 判决类记录成对门禁：${failures} 处失败（缺侧/盲区/登记腐化）`);
  process.exit(1);
}
console.log('✓ 判决类记录成对门禁通过（N 态全实落 · 零未登记判决写入点 · 盲区显式登记）');
process.exit(0);
