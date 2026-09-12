#!/usr/bin/env node
// ============================================================
// check-wiring-guard.mjs · 接线守卫（v1.4.8 深模块条目 11）
// ============================================================
// 职责：把「注册即有生产消费」机械化。检测三类同病里的后两类：
//   ① 死路径   —— 名字进了注册表，但没有任何分发面能到达它（注册了跑不到）
//   ② 注册漂移 —— 同一概念存在多处清单，集合不一致
//                 （分发面有而注册表无 = 孤儿分发；旁挂清单有而注册表无 = 越界引用）
//   ③ 幽灵缝   —— @public 导出零生产消费，已由 check-unwired-exports.sh 覆盖，
//                 本脚本不重造（见下方「分工边界」）。
//
// 为什么需要它（与 check-unwired-exports.sh 的分工边界）：
//   check-unwired-exports.sh 是**符号级**判定——符号在任意生产文件里被 grep 到
//   即算接线。但「被注册表 import」≠「运行时可到达」：v1.3.2 交付的
//   runAuditTrailInspector 被注册表 import 了（符号级打钩），却只挂在一张
//   已死的扁平表上，生产从未执行（audit-trail 漂移实案）。缺的正是**注册表级**
//   「分发链路是否覆盖注册项」的断言——本脚本补这一层，不与之重叠。
//
// 契约表（CONTRACTS）——脚本核心。新增受控概念只改表、不写新代码（对齐
// check-literals.sh 的「登记一行」纪律）。每条约定的形态：
//   registry：唯一注册清单（声明「有什么」）——kind 决定名字提取器。
//   dispatch：分发面清单（声明「怎么到达」）——registry 中每个名字须被
//             dispatch 面**至少一处**覆盖（并集）；optional=true 的面允许
//             不存在（迁移期过渡面，锚点缺席即跳过，不计故障）。
//   subset：  旁挂清单（声明「还必须指回注册表」）——其中每个名字须 ∈ registry。
//
// 判定口径（机械可验证，不依赖语义判断）：
//   死路径     registry ∖ ∪dispatch ≠ ∅
//   注册漂移   ∪dispatch ∖ registry ≠ ∅          （孤儿分发）
//   注册漂移   subset ∖ registry ≠ ∅             （越界引用）
//   注册漂移   registry 内部重名
//
// 纪律（对齐 check-guards.sh / check-unwired-exports.sh 家族）：
//   - 首版只提示不阻断：常态巡检恒 exit 0，命中以【提示】列出（对齐 FORGE/lessons
//     既有校准——新机制先观察，不拿未跑稳的门禁卡住发版）。
//   - 检查器失明宁可报错不假绿：契约源文件缺失 → exit 2（不静默放行）。
//   - --selftest 合成回归：临时镜像注入漂移 → 必命中 → 退出码反映自检成败
//     （红不了的门禁是装饰品；不触碰仓内真实文件，故并行 session 期间可跑）。
//
// 用法：
//   node tools/check/check-wiring-guard.mjs            # 常态巡检（只提示，恒 exit 0）
//   node tools/check/check-wiring-guard.mjs --selftest # 合成回归演示（必命中）
//   node tools/check/check-wiring-guard.mjs --help
//
// 退出码：0=巡检完成（含命中——非阻断）/ 1=--selftest 未命中（守卫是装饰品）/
//         2=检查器失明（契约源文件缺失）或脚本自身错误
//
// 依赖：仅 node 内置模块（fs/os/path）——不 import 仓内 dist，无需先 build。
// ============================================================

import fs from 'fs';
import os from 'os';
import path from 'path';

const REAL_ROOT = path.resolve(import.meta.dirname, '../..');

const ARGV = process.argv.slice(2);
if (ARGV.includes('--help') || ARGV.includes('-h')) {
  console.log('check-wiring-guard.mjs — 接线守卫（注册漂移 / 死路径）');
  console.log('  (无参数)    常态巡检：按契约表核对注册面与分发面集合（只提示，恒 exit 0）');
  console.log('  --selftest  合成回归：临时镜像注入合成漂移，验证守卫必命中');
  console.log('  --help      显示帮助');
  process.exit(0);
}
const SELFTEST = ARGV.includes('--selftest');

// ============================================================
// 契约表——受控概念登记处
// ============================================================
// 契约 1：MCP tool 注册表 ↔ 分发面（死路径 + 孤儿分发）
//   背景：v1.4.8 条目 5 把 mcp-server.ts 的 switch (toolName) 退场，改为
//   tool-registry.ts 条目内 handler 查表分发。此后「注册了跑不到」的新形态是：
//   工具进了 TOOLS 却漏写 handler → 调用落 `Unknown tool`
//   （mcp-server.ts 现状分支）。switch 面标 optional——迁移期并存时纳入并集，
//   退场后锚点缺席自动跳过（不误报、不假绿）。
// 契约 2：工具权限映射 ⊆ MCP 注册表（越界引用）
//   activate.ts 的 ACTION_TO_TOOLS 是工具名的第二处清单（§2.8 决策表）。
//   它引用的 MCP 工具名（snake_case）必须在注册表内——否则映射指向死工具
//   （Claude 原生名 Read/Glob/... 非 MCP 命名空间，按 [a-z] 形态自然排除）。
// ============================================================
const CONTRACTS = [
  {
    id: 'mcp-tool-dispatch',
    title: 'MCP tool 注册表 ↔ 分发面',
    registry: { file: 'engine/mcp/src/tool-registry.ts', kind: 'tool-registry' },
    dispatch: [
      { file: 'engine/mcp/src/tool-registry.ts', kind: 'tool-handlers', label: 'registry handler 查表分发' },
      { file: 'engine/mcp/src/mcp-server.ts', kind: 'switch-cases', anchor: 'switch (toolName)', optional: true, label: 'mcp-server switch 回退分发（v1.4.8 条目 5 已退场）' },
    ],
    subset: [],
  },
  {
    id: 'mcp-tool-name-refs',
    title: '工具权限映射（activate.ts）⊆ MCP 注册表',
    registry: { file: 'engine/mcp/src/tool-registry.ts', kind: 'tool-registry' },
    dispatch: [],
    subset: [
      { file: 'engine/orchestrator/src/activate.ts', kind: 'activate-map', label: 'ACTION_TO_TOOLS 工具名映射' },
    ],
  },
];

// ============================================================
// 提取器——kind → 名字集合
// ============================================================
function readSource(root, rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) {
    // 检查器失明：契约声明的源文件不存在 → 不得静默放行
    const err = new Error(`契约源文件缺失：${rel}`);
    err.blind = true;
    throw err;
  }
  return fs.readFileSync(p, 'utf8');
}

/** tool-registry.ts → [{name, hasHandler, roles}] */
function extractToolRegistry(text) {
  const lines = text.split('\n');
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s{2,}name: '([a-z0-9_]+)',\s*$/);
    if (!m) continue;
    const name = m[1];
    let hasHandler = false;
    const roles = [];
    // 工具条目块：从 name 行扫到 2 空格缩进的收尾 `},`
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s{2}\},?\s*$/.test(lines[j])) break;
      if (/^\s{4}handler:/.test(lines[j])) hasHandler = true;
      const rm = lines[j].match(/^\s{4}roles: \[([^\]]*)\]/);
      if (rm) {
        for (const r of rm[1].matchAll(/'([A-Za-z0-9_]+)'/g)) roles.push(r[1]);
      }
    }
    items.push({ name, hasHandler, roles });
    // 不跳过块尾——块内不会有第二个工具名（inputSchema 的 name 键非引号字面量）
  }
  return items;
}

/** mcp-server.ts → switch (anchor) 下的 case 'name' 列表；锚点缺席返回 null */
function extractSwitchCases(text, anchor) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.includes(anchor));
  if (start < 0) return null;
  const names = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*default:/.test(lines[i])) break;
    const m = lines[i].match(/^\s*case '([a-z0-9_]+)':/);
    if (m) names.push(m[1]);
  }
  return names;
}

/** activate.ts ACTION_TO_TOOLS 块内的 snake_case MCP 工具名（排除 PascalCase 原生名） */
function extractActivateMap(text) {
  const head = text.indexOf('ACTION_TO_TOOLS');
  if (head < 0) {
    const err = new Error('activate.ts 未找到 ACTION_TO_TOOLS');
    err.blind = true;
    throw err;
  }
  const tail = text.indexOf('};', head);
  const block = text.slice(head, tail < 0 ? text.length : tail);
  const names = [];
  for (const m of block.matchAll(/'([a-z][a-z0-9_]*)'/g)) names.push(m[1]);
  return [...new Set(names)];
}

/** 按 kind 提取名字集合；返回 {names, meta} */
function extract(kind, file, text, anchor) {
  switch (kind) {
    case 'tool-registry': {
      const items = extractToolRegistry(text);
      return { names: items.map((t) => t.name), items };
    }
    case 'tool-handlers': {
      const items = extractToolRegistry(text);
      return { names: items.filter((t) => t.hasHandler).map((t) => t.name), items };
    }
    case 'switch-cases':
      return { names: extractSwitchCases(text, anchor), items: [] };
    case 'activate-map':
      return { names: extractActivateMap(text), items: [] };
    default:
      throw new Error(`未知提取器 kind：${kind}`);
  }
}

// ============================================================
// 巡检核心（root 可注入——--selftest 走临时镜像）
// ============================================================
function runChecks(root) {
  const hits = [];
  const reports = [];

  for (const c of CONTRACTS) {
    const reg = extract(c.registry.kind, c.registry.file, readSource(root, c.registry.file));
    const regNames = reg.names;
    const regSet = new Set(regNames);

    // 注册表内部重名
    const dups = [];
    const seen = new Set();
    for (const n of regNames) {
      if (seen.has(n)) dups.push(n);
      seen.add(n);
    }
    for (const n of [...new Set(dups)]) {
      hits.push({ cls: '注册漂移', c: c.title, detail: `注册表内部重名 '${n}'——同一名字注册两次` });
    }

    // 分发面并集
    const dispatchSet = new Set();
    const dispatchDetail = [];
    for (const d of c.dispatch) {
      const r = extract(d.kind, d.file, readSource(root, d.file), d.anchor);
      if (r.names === null) {
        dispatchDetail.push(`${d.label}：锚点缺席（optional 跳过）`);
        if (!d.optional) {
          hits.push({ cls: '注册漂移', c: c.title, detail: `分发面「${d.label}」锚点 '${d.anchor}' 缺席——契约与实现脱节` });
        }
        continue;
      }
      for (const n of r.names) dispatchSet.add(n);
      dispatchDetail.push(`${d.label}：${r.names.length} 项`);
    }

    const dead = [];
    const orphan = [];
    if (c.dispatch.length > 0) {
      for (const n of regNames) if (!dispatchSet.has(n)) dead.push(n);
      for (const n of dispatchSet) if (!regSet.has(n)) orphan.push(n);
    }
    for (const n of dead) {
      hits.push({ cls: '死路径', c: c.title, detail: `注册项 '${n}' 在所有分发面均无落点——调用落 Unknown tool（注册了跑不到）` });
    }
    for (const n of orphan) {
      hits.push({ cls: '注册漂移', c: c.title, detail: `分发面孤儿 '${n}' 未在注册表——暴露面不列它，永不触达` });
    }

    // 旁挂清单 ⊆ 注册表
    const outside = [];
    for (const s of c.subset) {
      const r = extract(s.kind, s.file, readSource(root, s.file), s.anchor);
      for (const n of r.names) {
        if (!regSet.has(n)) {
          outside.push(n);
          hits.push({ cls: '注册漂移', c: c.title, detail: `旁挂清单「${s.label}」引用 '${n}' 未在注册表——指向死工具` });
        }
      }
    }

    reports.push({
      title: c.title,
      regCount: regNames.length,
      dispatchCount: dispatchSet.size,
      dispatchDetail,
      dead,
      orphan,
      outside,
    });
  }

  return { hits, reports };
}

// ============================================================
// 常态巡检（只提示不阻断）
// ============================================================
function main() {
  console.log('── 接线守卫（注册漂移 / 死路径 · 首版非阻断）──');
  console.log('');
  const { hits, reports } = runChecks(REAL_ROOT);
  for (const r of reports) {
    const parts = [`注册 ${r.regCount} 项`];
    if (r.dispatchDetail.length > 0) parts.push(`分发并集 ${r.dispatchCount} 项`);
    else parts.push('旁挂清单 ⊆ 注册表（无分发面要求）');
    console.log(`  契约「${r.title}」：${parts.join(' / ')}`);
    for (const d of r.dispatchDetail) console.log(`    · ${d}`);
  }
  console.log('');
  if (hits.length === 0) {
    console.log('  ✓ 无注册漂移 / 无死路径——各契约集合关系成立');
  } else {
    for (const h of hits) console.log(`  【${h.cls}】${h.c}：${h.detail}`);
  }
  const dead = hits.filter((h) => h.cls === '死路径').length;
  const drift = hits.filter((h) => h.cls === '注册漂移').length;
  console.log('');
  console.log(`  命中 ${hits.length} 处（注册漂移 ${drift} / 死路径 ${dead}）——首版只提示不阻断，exit 0`);
  console.log('  注：幽灵缝（@public 零生产消费）由 check-unwired-exports.sh 负责，本脚本不重造。');
  process.exit(0);
}

// ============================================================
// --selftest 合成回归：临时镜像注入漂移 → 必命中
// ============================================================
function selftest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wire-guard-selftest-'));
  try {
    // 1. 镜像契约声明的全部源文件到临时根
    const files = [...new Set(CONTRACTS.flatMap((c) => [
      c.registry.file,
      ...c.dispatch.map((d) => d.file),
      ...c.subset.map((s) => s.file),
    ]))];
    for (const f of files) {
      const dst = path.join(tmp, f);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(REAL_ROOT, f), dst);
    }

    // 2. 注入 A：死路径——合成 tool 进 TOOLS 但不带 handler
    const trPath = path.join(tmp, 'engine/mcp/src/tool-registry.ts');
    let tr = fs.readFileSync(trPath, 'utf8');
    const probeTool = [
      '  {',
      '    // 接线守卫 --selftest 合成探针（临时镜像，勿提交）',
      "    name: 'zzz_ghost_probe',",
      '    description: \'wiring-guard selftest probe\',',
      '    inputSchema: { type: \'object\', properties: {} },',
      '  },',
      '',
    ].join('\n');
    tr = tr.replace(/(export const TOOLS: ToolDef\[\] = \[\n)/, `$1${probeTool}`);
    fs.writeFileSync(trPath, tr);

    // 3. 注入 B：孤儿分发——临时镜像里补一张合成 switch，case 名不在注册表
    const msPath = path.join(tmp, 'engine/mcp/src/mcp-server.ts');
    let ms = fs.readFileSync(msPath, 'utf8');
    ms += [
      '',
      '// 接线守卫 --selftest 合成分发面（临时镜像，勿提交）',
      'function _wireGuardProbeSwitch(toolName: string): void {',
      '  switch (toolName) {',
      "    case 'zzz_orphan_probe': { break; }",
      '  }',
      '}',
      '',
    ].join('\n');
    fs.writeFileSync(msPath, ms);

    // 4. 注入 C：越界引用——旁挂清单加一个未注册的名字
    const acPath = path.join(tmp, 'engine/orchestrator/src/activate.ts');
    let ac = fs.readFileSync(acPath, 'utf8');
    ac = ac.replace(/(\n\s*audit: \[[^\]]*\],)/, "$1\n  selftest: ['zzz_drift_probe'],");
    fs.writeFileSync(acPath, ac);

    // 5. 跑判定
    const { hits } = runChecks(tmp);
    const hit = (cls, needle) => hits.some((h) => h.cls === cls && h.detail.includes(needle));
    const cases = [
      ['死路径', 'zzz_ghost_probe', hit('死路径', 'zzz_ghost_probe')],
      ['注册漂移（孤儿分发）', 'zzz_orphan_probe', hit('注册漂移', 'zzz_orphan_probe')],
      ['注册漂移（越界引用）', 'zzz_drift_probe', hit('注册漂移', 'zzz_drift_probe')],
    ];

    console.log('── --selftest 合成回归（临时镜像注入 → 必命中）──');
    console.log(`  临时镜像：${tmp}`);
    let fail = 0;
    for (const [label, needle, ok] of cases) {
      if (ok) {
        console.log(`  ✓ 命中 ${label}：${needle}`);
      } else {
        console.log(`  ❌ 未命中 ${label}：${needle}——守卫是装饰品`);
        fail++;
      }
    }
    console.log('');
    if (fail > 0) {
      console.log(`✗ selftest 失败 ${fail} 项——守卫未抓到注入漂移`);
      return 1;
    }
    console.log('✓ selftest 通过——三类合成漂移全命中（守卫非装饰品）');
    return 0;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ============================================================
// 入口
// ============================================================
try {
  if (SELFTEST) process.exit(selftest());
  main();
} catch (err) {
  if (err && err.blind) {
    console.error(`✗ 检查器失明：${err.message}——契约源文件不存在，拒绝假绿`);
    process.exit(2);
  }
  console.error(`✗ check-wiring-guard 自身错误：${err && err.stack ? err.stack : String(err)}`);
  process.exit(2);
}
