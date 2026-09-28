#!/usr/bin/env node
// ============================================================
// unwired-reachability.mjs · 零接线门禁「生产可达」分析内核（v1.5.4 门禁收紧）
// ============================================================
//
// 为什么单独成件：check-unwired-exports.sh 原判定是 grep 级「引用存在」，
// 有三条能力边界（见门禁脚本文件头）。本件把「接线」升级为**生产可达**——
// 以新增 @public 符号集合 S 为起点，沿生产源码引用图做可达性分析，要求存在
// 一条路径到达 S **之外**的生产代码。三条收紧规则：
//
//   ① type-only 不计：`import type { X }` / `import { type X }` / 纯类型注解位
//      （`x: X` 注解、`as X` 断言类型位、`x is X` 类型守卫、`<X>` 泛型位、
//      `X[]` 数组类型、**`type Y = X` 类型别名右值**、interface 类型引用、
//      泛型实参列表 `Foo<A, X>` 内）**均不构成接线**。实现上**所有 import 语句
//      一律不计**（import 只是「取用声明」不是「消费点」）+ 代码行按位置剔除纯类型位。
//   ② 禁循环自证（CIRCULAR）：锚点若落在 S 内部（S 内互相引用成环）不算——
//      互指的两枚新增符号不得互相「证明」有接线。
//   ③ 禁一跳断链（ONEHOP）：锚点符号自身若「零接线」或「仅被 S 内部引用」，
//      即引用链止步于 S 内、追不到 S 之外的生产代码 ⇒ 明确报「一跳断链」
//      （与「零接线 ZERO」区分，便于定位）。
//
// 引用图边规则：barrel 再导出边、import 边、comment 边（`//` 行注释 + `/* */` 块注释，
// 含跨行块注释）、字符串字面量边**不进图**。
// 节点 = 符号名；owner(命中行) = 该行所属**最近前置定义**（函数/类/const/方法/
// 对象字面量箭头属性），无名则 `@module`。
//
// 输出（stdout，逐行）：`<符号>\t<判定>\t<证据>`；判定 ∈
//   WIRED（有接线，证据=首个 S 外的生产 owner）｜ZERO（零接线）｜
//   ONEHOP（一跳断链）｜CIRCULAR（循环自证，按零接线计红）。
//
// 模式：
//   node unwired-reachability.mjs --root <dir> --symbols a,b,c
//   node unwired-reachability.mjs --selftest        # 内建 P1–P4 探针
//
// 退出码：0=分析成功 / 1=自检失败 / 2=参数或环境错误。
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

// ── 语言关键字（防止把 `if (` / `for (` 之类误判为方法定义）──
const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'do', 'else',
  'case', 'new', 'typeof', 'await', 'yield', 'with', 'in', 'of', 'void', 'delete',
  'throw', 'class', 'const', 'let', 'var', 'import', 'export', 'from', 'as', 'is',
  'extends', 'implements', 'instanceof', 'super', 'this', 'default', 'try',
  'finally', 'break', 'continue', 'debugger', 'async', 'static', 'get', 'set',
]);

/** 递归收集生产源码文件（排除 dist / node_modules / 测试 / fixture / .d.ts）。 */
function walk(dir, out = []) {
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['dist', 'node_modules', '__tests__', 'fixtures', 'node_modules'].includes(e.name)) continue;
      walk(p, out);
    } else if (e.isFile()) {
      if (!/\.(ts|mjs)$/.test(e.name)) continue;
      if (/\.test\.(ts|mjs)$/.test(e.name)) continue;
      if (/\.d\.ts$/.test(e.name)) continue;
      out.push(p);
    }
  }
  return out;
}

/** 统计一行内某字符出现次数。 */
function countChar(s, ch) {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

/** 判断一行是否为「定义行」并取 {name, kind}（未命中返回 null）。
 *  仅把**开体**定义（函数/类/方法/箭头属性/具名函数或对象常量）算作 owner——
 *  普通值常量 `const result = call(...)` 不是 owner（其内引用应归属外层函数，
 *  否则会把引用「出口」误判到一个局部变量名上）。
 *  kind ∈ 'const'（含 let/var——初始化器随加载执行）｜'class'｜'function'｜'method'。 */
function defNameOf(raw) {
  // 先剥行首块注释（`/* @public */ export function foo`）再判定
  const line = raw.replace(/^\s*\/\*.*?\*\/\s*/, '');
  const t = line.trim();
  if (t === '' || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return null;
  let m;
  if ((m = line.match(/\bexport\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/))) return { name: m[1], kind: 'function' };
  if ((m = line.match(/\bexport\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/))) return { name: m[1], kind: 'class' };
  if ((m = line.match(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/))) return { name: m[1], kind: 'function' };
  if ((m = line.match(/^\s*(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/))) return { name: m[1], kind: 'class' };
  // 方法定义：`async vote(config?): Promise<X> {` / `before(node) {` —— 必须以 { 收尾
  if ((m = line.match(/^\s*(?:(?:public|private|protected|static|readonly|async|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*(?::[^;{}]*)?\{\s*$/))) {
    if (!KEYWORDS.has(m[1])) return { name: m[1], kind: 'method' };
  }
  // 对象字面量箭头属性：`issueCredential: (input): CredentialView => {`
  if ((m = line.match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?\(?[^;{}]*=>/))) {
    if (!KEYWORDS.has(m[1])) return { name: m[1], kind: 'method' };
  }
  // 具名函数/箭头常量（有体）：`export const NAME = (...) =>` / `= function` / `= {` / `= [`
  // ——注意 `const x = f(a, {`（多行调用实参）**不是** owner：初始化器以标识符开头即调用式，
  //    其内引用应归属外层作用域（否则会把出口误判到一个局部接收变量名上）。
  if ((m = line.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/))) {
    const eq = line.indexOf('=', line.indexOf(m[1]));
    const init = line.slice(eq + 1).trimStart();
    // 箭头/函数常量判定必须看**初始化器开头**——否则 `const x = arr.map((v) => …)`
    // 这类「含回调的调用式」会被误当成函数常量 owner（历史实锤：把 cli.ts 的
    // `const depResults = results.filter((r) => …)` 当成 owner，使 vote 的消费者
    // 归属到 depResults 而非 main ⇒ 存活分析误判）。
    // 且「以 `(` 开头」**不足以**认定箭头——必须参数表之后确有 `=>`，否则
    // `const q = (query || '').toLowerCase().trim()` 这类「括号开头的普通赋值」
    // 会被误当函数常量 owner，把 WIRED 锚点落到局部 `q`/`s` 上（历史实锤：MAX_OPTIONS
    // 等消费者锚点显示成局部变量名，判定虽对但可诊断性差）。
    const isArrow =
      /^\([\s\S]*\)\s*(?::[^=]*)?=>/.test(init) || // (a, b) => / (a): T => / ({a, b}) =>
      /^(?:async\s+)?[A-Za-z_$][\w$]*\s*=>/.test(init) || // x => / async x =>
      /^async\b/.test(init);
    const isFn = isArrow || /=\s*function\b/.test(line);
    if (isFn || init.startsWith('{') || init.startsWith('[')) return { name: m[1], kind: 'const', isFn };
    return null;
  }
  return null;
}

/** 判断 idx 是否落在**类型泛型列表** `<...>` 内。
 *  仅把「前一位是类型名/`>`」的 `<` 认作泛型开口，且要求存在**配对**的 `>`——
 *  未配对的 `<`（如无空格的值位比较 `i<count && …`）不成对、不计入，
 *  以此压住「把值位比较误判为泛型位」从而漏报真接线的风险。 */
function insideGenericArgs(line, idx) {
  let st = 'code';
  const stack = []; // 泛型开口 `<` 的位置栈
  let inside = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const p = line[i - 1];
    const n = line[i + 1];
    if (st === 'code') {
      if (c === "'") st = 'sq';
      else if (c === '"') st = 'dq';
      else if (c === '`') st = 'bt';
      else if (c === '/' && n === '/') break; // 行尾注释起，右侧不再扫描
      else if (c === '<' && p && /[A-Za-z0-9_$>]/.test(p)) stack.push(i);
      else if (c === '>' && stack.length) {
        const open = stack.pop();
        if (open < idx && idx < i) inside = true; // idx 落在该配对泛型对内
      }
    } else if (st === 'sq') {
      if (c === '\\') i++;
      else if (c === "'") st = 'code';
    } else if (st === 'dq') {
      if (c === '\\') i++;
      else if (c === '"') st = 'code';
    } else if (st === 'bt') {
      if (c === '\\') i++;
      else if (c === '`') st = 'code';
    }
  }
  return inside;
}

/** 命中行的引用类别：'value' | 'type' | 'neutral'（仅用于代码行单次出现判定）。 */
function classifyOccurrence(line, idx, sym) {
  const before = line.slice(0, idx);
  const after = line.slice(idx + sym.length);
  const nextM = after.match(/^\s*([^\s])/);
  const nextChar = nextM ? nextM[1] : '';
  const beforeTrim = before.replace(/\s+$/, '');
  const prevChar = beforeTrim === '' ? '' : beforeTrim[beforeTrim.length - 1];
  const lastWordM = beforeTrim.match(/([A-Za-z_$][\w$]*)$/);
  const prevWord = lastWordM ? lastWordM[1] : '';

  // —— 明确「值位」——
  if (nextChar === '(' || nextChar === '`') return 'value'; // 调用 / 标签模板
  if (nextChar === '.' || after.startsWith('?.')) return 'value'; // 属性访问
  if (prevWord === 'new' || prevWord === 'return' || prevWord === 'typeof') return 'value';
  if (nextChar === '=') return 'value'; // 赋值目标
  if (prevChar === '=') {
    const beforeEq = beforeTrim.slice(-2, -1) || '';
    if (!/[=<>!]/.test(beforeEq)) {
      // `type Y = X`（含 `export type`、泛型形参 `type Y<T> =`）的右值是**类型位**，
      // 不是赋值值位——历史实锤：函数体内 `type Alias = Sym;` 曾被误判 WIRED。
      if (/(?:^|[^A-Za-z0-9_$])type\s+[A-Za-z_$][\w$]*(?:\s*<[^{};=]*>)?\s*=$/.test(beforeTrim)) return 'type';
      return 'value'; // 普通赋值 `= X`
    }
  }

  // —— 泛型实参/形参列表内（须先于下方「实参位」判定，否则 `Map<K, Sym>` 会误按值位）——
  if (insideGenericArgs(line, idx)) return 'type';

  // —— 明确「类型位」——
  if (prevChar === ':') return 'type'; // `x: X` 注解
  if (prevWord === 'as' || prevWord === 'is' || prevWord === 'keyof') return 'type';
  if (prevWord === 'extends' || prevWord === 'implements') return 'type';
  if (prevChar === '<' || nextChar === '>') return 'type'; // 泛型位
  if (nextChar === '[' && /^\[\s*\]/.test(after.trimStart())) return 'type'; // 数组类型 X[]
  if (prevChar === '|' || nextChar === '|' || prevChar === '&') return 'type'; // 联合/交叉类型

  // —— 实参/数组/索引位（歧义，保守按值位，避免误伤真接线）——
  if (/[(,[]$/.test(prevChar) && /[),\]}]/.test(nextChar === '' ? ')' : nextChar)) return 'value';

  return 'neutral';
}

/** 把块注释（`/* … *​/`，含跨行延续）替换为**等长空格**，保持列位与行号不变；
 *  字符串字面量内的 `/*` 不生效。返回 {masked, inBlk}，inBlk 供下一篇续行使用。
 *  行尾 `//` 注释保持原样（交由 inStringOrComment 处理），仅块注释被抹。 */
function maskComments(line, incoming) {
  let out = '';
  let st = incoming ? 'blk' : 'code';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const n = line[i + 1];
    if (st === 'blk') {
      if (c === '*' && n === '/') {
        out += '  ';
        i++;
        st = 'code';
      } else out += ' ';
    } else if (st === 'sq' || st === 'dq') {
      out += c;
      if (c === '\\') {
        out += line[i + 1] || '';
        i++;
      } else if ((st === 'sq' && c === "'") || (st === 'dq' && c === '"')) st = 'code';
    } else if (st === 'bt') {
      out += c;
      if (c === '\\') {
        out += line[i + 1] || '';
        i++;
      } else if (c === '`') st = 'code';
    } else {
      // code
      if (c === '/' && n === '*') {
        out += '  ';
        i++;
        st = 'blk';
      } else if (c === '/' && n === '/') {
        out += line.slice(i); // 行尾注释原样保留
        break;
      } else {
        out += c;
        if (c === "'") st = 'sq';
        else if (c === '"') st = 'dq';
        else if (c === '`') st = 'bt';
      }
    }
  }
  return { masked: out, inBlk: st === 'blk' };
}

/** 判断某位置是否落在字符串字面量、行尾注释或**单行块注释**内（这些出现不构成引用）。 */
function inStringOrComment(line, idx) {
  let st = 'code';
  for (let i = 0; i < idx; i++) {
    const c = line[i];
    const n = line[i + 1];
    if (st === 'code') {
      if (c === "'") st = 'sq';
      else if (c === '"') st = 'dq';
      else if (c === '`') st = 'bt';
      else if (c === '/' && n === '/') st = 'line';
      else if (c === '/' && n === '*') {
        st = 'blk'; // 单行块注释起
        i++;
      }
    } else if (st === 'line') {
      // 行尾注释：其后全部不算引用（保持状态直至行末）
    } else if (st === 'sq') {
      if (c === '\\') i++;
      else if (c === "'") st = 'code';
    } else if (st === 'dq') {
      if (c === '\\') i++;
      else if (c === '"') st = 'code';
    } else if (st === 'bt') {
      if (c === '\\') i++;
      else if (c === '`') st = 'code';
    } else if (st === 'blk') {
      if (c === '*' && n === '/') {
        st = 'code';
        i++;
      }
    }
  }
  return st !== 'code';
}

/** 判定代码行（非 import/export/注释/定义）对 sym 的引用性质：'value'|'type'|null。 */
function classifyCodeLine(line, sym) {
  const re = new RegExp('(?<![A-Za-z0-9_$])' + sym.replace(/\$/g, '\\$') + '(?![A-Za-z0-9_$])', 'g');
  let m;
  let sawType = false;
  let sawNeutral = false;
  while ((m = re.exec(line)) !== null) {
    if (inStringOrComment(line, m.index)) continue; // 字符串/行尾注释内 → 不计
    const k = classifyOccurrence(line, m.index, sym);
    if (k === 'value') return 'value';
    if (k === 'type') sawType = true;
    else sawNeutral = true;
  }
  if (sawType) return 'type';
  if (sawNeutral) return 'value'; // 歧义位保守按值位（避免误伤真接线）
  return null; // 本行未真正出现该符号（仅出现在字符串/注释）
}

/**
 * 扫描单个文件，收集**全部**标识符的生产引用点（value 位）与 owner 归属。
 * 返回 Map<id, Set<owner>>：id 被 owner 所定义的作用域以值位引用。
 * 用于构建全局「生产引用图」（供存活分析）——不只 S。
 */
function scanFileRefs(file) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  const callers = new Map(); // id -> Set<owner>
  const moduleEnv = new Set(); // 模块级 const/class 定义名（初始化器随加载执行）
  const add = (id, owner) => {
    let s = callers.get(id);
    if (!s) {
      s = new Set();
      callers.set(id, s);
    }
    s.add(owner);
  };
  let lastDef = '@module';
  let depth = 0; // 花括号深度（模块级=0；用于判定模块级定义）
  let inBlock = null; // 'import' | 'export'
  let blockOpen = 0;
  let blk = false; // 跨行块注释状态（上一行未闭合的 `/* … ）

  for (let i = 0; i < lines.length; i++) {
    // 先把块注释（含跨行延续）抹为等长空格——块注释内的标识符不得计入引用，
    // 也不得干扰花括号深度；行尾 `//` 注释交给 inStringOrComment 处理。
    const mk = maskComments(lines[i], blk);
    blk = mk.inBlk;
    const raw = mk.masked;
    // 去行首块注释（`/* @public */ export ...`）——后续所有判定基于 stripped
    const stripped = raw.replace(/^\s*\/\*.*?\*\/\s*/, '');
    const t = stripped.trim();

    // 处于 import/export 块续行：整行不计接线；跟踪块收敛
    if (inBlock) {
      blockOpen += countChar(raw, '{') - countChar(raw, '}');
      if (blockOpen <= 0 || /\bfrom\b/.test(raw) || /\}\s*;?\s*$/.test(raw)) {
        inBlock = null;
        blockOpen = 0;
      }
      continue;
    }

    const defInfo = defNameOf(raw);
    if (defInfo) {
      const moduleLevel = depth === 0;
      // 局部对象/数组常量（非箭头）不是 owner——其内引用应归属外层作用域，
      // 否则同名的局部变量会跨文件串味（如 `merged`/`issues`/`result`），
      // 把「死调用」误判成活。箭头/函数常量是真正的函数定义，任意层级都算 owner。
      const isLocalObjConst = defInfo.kind === 'const' && !defInfo.isFn && !moduleLevel;
      if (!isLocalObjConst) lastDef = defInfo.name;
      if (moduleLevel && (defInfo.kind === 'const' || defInfo.kind === 'class')) moduleEnv.add(defInfo.name);
    }

    // 注释行
    if (t === '' || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) {
      depth += countChar(stripped, '{') - countChar(stripped, '}');
      continue;
    }

    // import 语句（单行或多行块起始）——import 边不进图
    if (/^\s*import\b/.test(stripped)) {
      const open = countChar(stripped, '{') - countChar(stripped, '}');
      if (open > 0) {
        inBlock = 'import';
        blockOpen = open;
      }
      continue;
    }

    // barrel 再导出：`export {` / `export * from` —— barrel 边不进图
    if (/^\s*export\s*\{/.test(stripped)) {
      const open = countChar(stripped, '{') - countChar(stripped, '}');
      if (open > 0) {
        inBlock = 'export';
        blockOpen = open;
      }
      continue;
    }
    if (/^\s*export\s*\*/.test(stripped)) continue;

    const tokens = stripped.match(/[A-Za-z_$][A-Za-z0-9_$]*/g);
    if (tokens) {
      const seen = new Set();
      for (const tok of tokens) {
        if (defInfo && tok === defInfo.name) continue; // 定义行排除符号自身
        if (seen.has(tok)) continue;
        seen.add(tok);
        // 字符串字面量内的出现不构成引用（粗判见 classifyCodeLine）
        const k = classifyCodeLine(stripped, tok);
        if (k === 'value') add(tok, lastDef);
      }
    }
    depth += countChar(stripped, '{') - countChar(stripped, '}');
  }
  return { callers, moduleEnv };
}

/** 带 shebang 的可执行入口文件（`#!/usr/bin/env node`）——存活分析的种子。 */
function isShebangEntry(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(64);
    const n = fs.readSync(fd, buf, 0, 64, 0);
    fs.closeSync(fd);
    return buf.slice(0, n).toString('utf8').startsWith('#!');
  } catch {
    return false;
  }
}

/**
 * 主分析：对 S 中每个符号做「生产可达」判定。
 *
 * 图模型：节点=符号名；`callers[x]` = 以值位引用 x 的 owner 集合（即 x 的消费者）。
 * 存活（live）= 从**入口种子**沿「谁被谁调用」正向可达的符号集——入口种子 =
 *   ① 在模块顶层被引用的符号（`@module` owner：随文件加载即执行）
 *   ② 带 shebang 的可执行入口文件里出现的符号
 * `wired(s)` = 存在一条消费者路径 s → … → e（可穿过 S 内节点），e ∉ S 且 e 存活。
 * 这同时封死三条盲区：① type-only/import/barrel 边不进图；② S 内互指不构成出口；
 * ③ 出口必须**存活**——「A 调 B、B 无人用」的 B 不存活 ⇒ A 判 `一跳断链`。
 *
 * @returns Map<sym, {verdict:'WIRED'|'ZERO'|'ONEHOP'|'CIRCULAR', detail:string}>
 */
export function analyze(root, symbols) {
  const S = [...new Set(symbols)].filter(Boolean);
  const Sset = new Set(S);
  const files = walk(root);

  const callers = new Map(); // id -> Set<owner>
  const callees = new Map(); // owner -> Set<id>
  const moduleEnv = new Set(); // 模块级 const/class 定义名（初始化器随加载执行 ⇒ 存活种子）
  const link = (id, owner) => {
    let cs = callers.get(id);
    if (!cs) {
      cs = new Set();
      callers.set(id, cs);
    }
    cs.add(owner);
    let cd = callees.get(owner);
    if (!cd) {
      cd = new Set();
      callees.set(owner, cd);
    }
    cd.add(id);
  };

  for (const f of files) {
    let perFile;
    try {
      perFile = scanFileRefs(f);
    } catch {
      continue;
    }
    for (const [id, owners] of perFile.callers) for (const o of owners) link(id, o);
    for (const d of perFile.moduleEnv) moduleEnv.add(d);
    // shebang 入口：其顶层引用全部作为种子（文件被执行 ⇒ 其引用的符号可达）
    if (isShebangEntry(f)) {
      for (const [id, owners] of perFile.callers) if (owners.has('@module')) link(id, '@entry');
    }
  }

  // 存活集：种子 = 模块顶层引用 ∪ 入口文件引用 ∪ 模块级常量/类定义（初始化器随加载执行），
  // 沿 callees 正向可达（调用者存活 ⇒ 被调者存活）。
  const live = new Set();
  const queue = [];
  const seed = (id) => {
    if (!live.has(id)) {
      live.add(id);
      queue.push(id);
    }
  };
  for (const id of callees.get('@module') || []) seed(id);
  for (const id of callees.get('@entry') || []) seed(id);
  for (const d of moduleEnv) seed(d);
  while (queue.length) {
    const cur = queue.shift();
    for (const id of callees.get(cur) || []) seed(id);
  }
  if (process.env.UW_DEBUG) {
    process.stderr.write('LIVE size=' + live.size + ' main=' + live.has('main') + ' vote=' + live.has('vote') + '\n');
    process.stderr.write('@module refs: ' + [...(callees.get('@module') || [])].slice(0, 30).join(',') + '\n');
    process.stderr.write('callers(vote): ' + [...(callers.get('vote') || [])].join(',') + '\n');
    process.stderr.write('callers(runMultiInstanceVote): ' + [...(callers.get('runMultiInstanceVote') || [])].join(',') + '\n');
  }

  const out = new Map();
  for (const s of S) {
    const direct = [...(callers.get(s) || new Set())];
    if (direct.length === 0) {
      out.set(s, { verdict: 'ZERO', detail: '' });
      continue;
    }
    // BFS：沿消费者边（仅穿过 S 内节点）找 S 之外且**存活**的出口；沿途检测环
    const visited = new Set([s]);
    const q = [...direct];
    let exit = '';
    let cyclic = false;
    while (q.length) {
      const o = q.shift();
      if (!Sset.has(o)) {
        if (!exit && live.has(o)) exit = o;
        continue;
      }
      if (visited.has(o)) {
        cyclic = true; // 回到已访问的 S 内节点 ⇒ 环
        continue;
      }
      visited.add(o);
      for (const nxt of callers.get(o) || []) q.push(nxt);
    }
    if (exit) {
      out.set(s, { verdict: 'WIRED', detail: exit });
    } else if (cyclic) {
      out.set(s, { verdict: 'CIRCULAR', detail: direct.slice(0, 3).join(',') });
    } else {
      out.set(s, { verdict: 'ONEHOP', detail: direct.slice(0, 3).join(',') });
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────
// 内建自检（P1–P4）——各条收紧判定 + 两条已知漏洞面（类型别名右值 / 块注释）各自探针
// ────────────────────────────────────────────────────────────
function writeFixture(dir, rel, content) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

export function selftest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unwired-selftest-'));
  const fail = [];
  try {
    // P1：新增导出只出现在 `import type` 行 ⇒ 必须 ZERO
    writeFixture(dir, 'engine/p1/app.ts', '/* @public */ export function p1NewSym(): number { return 1; }\n');
    writeFixture(dir, 'engine/p1/use.ts',
      "import type { p1NewSym } from './app';\nexport const useP1: number = null as unknown as ReturnType<p1NewSym>;\n");
    // P2：两个新增导出互指、都不接既有代码 ⇒ 必须 CIRCULAR
    writeFixture(dir, 'engine/p2/a.ts',
      '/* @public */ export function p2A(): number { return p2B(); }\n/* @public */ export function p2B(): number { return p2A(); }\n');
    // P3：新增导出 A 只被「自身也零接线的新增导出 B」引用 ⇒ 必须 ONEHOP
    writeFixture(dir, 'engine/p3/a.ts', '/* @public */ export function p3A(): number { return 1; }\n');
    writeFixture(dir, 'engine/p3/b.ts',
      "import { p3A } from './a';\n/* @public */ export function p3B(): number { return p3A(); }\n");

    // P4：新增导出 A 的**唯一**消费者是一段**死代码**（同名函数无人调用）⇒ 必须 ONEHOP。
    //     锁死「出口必须存活」这条 live 维度——若把 `if(!exit) exit=o` 的
    //     `live.has(o)` 要求去掉，A 会被误判 WIRED，本探针即转红。
    writeFixture(dir, 'engine/p4/a.ts', '/* @public */ export function p4ATotal(): number { return 1; }\n');
    writeFixture(dir, 'engine/p4/dead.ts',
      "import { p4ATotal } from './a';\nfunction p4DeadFn(): number { return p4ATotal(); }\n");

    // P5：类型别名右值 `type Alias = X`（在**存活函数体**内）不算值位引用 ⇒ X 必须 ZERO。
    //     历史实锤：`type InFnAlias = tpAliasInFn;` 曾被误判为 WIRED。
    //     宿主用「模块级箭头常量」⇒ 经 moduleEnv 判定**存活**（与 QA 的 liveFn 场景一致）。
    writeFixture(dir, 'engine/p5/app.ts', '/* @public */ export function p5AliasSym(): number { return 1; }\n');
    writeFixture(dir, 'engine/p5/use.ts',
      "import { p5AliasSym } from './app';\nexport const p5Host = (): number => {\n" +
        '  type Alias = p5AliasSym;\n  return 1;\n};\n');

    // P6：行内块注释 `/* X */`（含跨行块注释）不算引用 ⇒ X 必须 ZERO。
    //     历史实锤：`const y = 1 /* qaBlkOnly() … */;` 与 `await /*QA-REMOVED …*/(merged);`
    //     曾被误判 WIRED。
    writeFixture(dir, 'engine/p6/app.ts', '/* @public */ export function p6BlkSym(): number { return 1; }\n');
    writeFixture(dir, 'engine/p6/use.ts',
      "import { p6BlkSym } from './app';\nexport const p6Host = (): number => {\n" +
        '  const y = 1 /* p6BlkSym() QA-ONLY */;\n' +
        '  /* 跨行块注释\n     p6BlkSym();\n  */\n' +
        '  return y;\n};\n');

    // P7：正向对照——真正被**存活**代码消费的符号必须 WIRED，防上述收紧「一刀切」过度抑制。
    writeFixture(dir, 'engine/p7/app.ts', '/* @public */ export function p7Wired(): number { return 1; }\n');
    writeFixture(dir, 'engine/p7/use.ts',
      "import { p7Wired } from './app';\nexport const p7Runner = (): number => p7Wired();\n");

    const S = ['p1NewSym', 'p2A', 'p2B', 'p3A', 'p3B', 'p4ATotal', 'p5AliasSym', 'p6BlkSym', 'p7Wired'];
    const res = analyze(dir, S);
    const expect = {
      p1NewSym: 'ZERO',
      p2A: 'CIRCULAR',
      p2B: 'CIRCULAR',
      p3A: 'ONEHOP',
      p3B: 'ZERO',
      p4ATotal: 'ONEHOP',
      p5AliasSym: 'ZERO',
      p6BlkSym: 'ZERO',
      p7Wired: 'WIRED',
    };
    for (const [sym, want] of Object.entries(expect)) {
      const got = res.get(sym)?.verdict;
      if (got !== want) fail.push(`${sym}: 期望 ${want} 实得 ${got}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return fail;
}

// ── CLI（仅在作为主模块直接运行时执行）──
const _isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const argv = process.argv.slice(2);
if (_isMain && argv.includes('--selftest')) {
  const fail = selftest();
  if (fail.length) {
    process.stderr.write('自检失败：\n' + fail.map((x) => '  - ' + x).join('\n') + '\n');
    process.exit(1);
  }
  process.stdout.write('OK\n');
  process.exit(0);
}

let root = '.';
let symbols = [];
if (_isMain) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = argv[++i];
    else if (argv[i] === '--symbols') symbols = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (symbols.length === 0) {
    process.stderr.write('用法: unwired-reachability.mjs --root <dir> --symbols a,b,c | --selftest\n');
    process.exit(2);
  }
  const res = analyze(root, symbols);
  for (const s of symbols) {
    const r = res.get(s) || { verdict: 'ZERO', detail: '' };
    process.stdout.write(`${s}\t${r.verdict}\t${r.detail}\n`);
  }
  process.exit(0);
}
