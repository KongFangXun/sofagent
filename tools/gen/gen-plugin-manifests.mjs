#!/usr/bin/env node
// ============================================================
// gen-plugin-manifests.mjs · DSH 插件清单生成器（v1.4.8 第5批 · 适配层标准化 A）
// ============================================================
// 唯一手写源：engine/dsh-plugins/plugins.json
//
// 生成物（受版本控制，必须落盘入库）：
//   ① engine/dsh-plugins/<id>/cordis.patch.yml
//   ② engine/dsh-plugins/<id>/package.json 的
//      description / sofagent / dsh / //optionalDependencies / optionalDependencies
//      ⚠️ 被 package-lock.json 记录的字段（name/version/license/engines/devDependencies/
//         optionalDependencies 的**值**）一字不动——生成器只动文本与 sofagent 自有段。
//
// 幂等：同一份 plugins.json 跑两次 → 逐字节相同（key 顺序固定 + 2 空格缩进 + 末尾单换行）。
// 门禁：`--check` 只比对、不落盘；发现任何漂移即 exit 1（check-template-drift.sh 断言六调用）。
// 附加守卫：`--check` 同时核对每个插件 src/index.ts 的**字面量 seam** 与 plugins.json 是否一致
//           ——check-seam-contract.mjs 的正向检查读的是 src 的字面量，若只改 plugins.json
//           忘改 src，两处会静默漂移；本守卫把这种漂移变成硬红。
// 附加守卫 2（v1.4.8 第8批收口）：聚合型插件（kind = "suite"）的 src/index.ts `SUITE` 数组
//           与 plugins.json 的 `suite` 段**双向对账**（集合相等 / 无幽灵 / 无遗漏 / 不自挂 /
//           无重复）。缺口背景：SUITE 是运行时真值（决定真挂哪些），plugins.json.suite 是声明侧
//           （驱动 optionalDependencies 与描述文本）；此前两者**只有单测守着**，门禁层面对
//           「清单多、src 少」这类静默过度声明完全失明——本守卫把它变成硬红。
//           装载序（第 2 条判据）经实测**无语义**（9 个原子插件的 apply 互不读取兄弟插件服务，
//           各自只 provide 自己唯一的 `sofagent.<short>`；正序与逆序挂载的注册面完全相同），
//           故「同序」降为 WARN 不阻断——见 suiteCheck 内注释与实测依据。
//
// 两类清单条目（v1.4.8 第8批新增第二类）：
//   · kind 缺省 / "bridge" ——**桥接型**原子插件：桥接一个 @sofagent/* 能力包
//     （bridgePkg + bridgeApi 必填）→ optionalDependencies = { <bridgePkg>: version }。
//   · kind = "suite"        ——**聚合型**插件（cordis-plugin-sofagent-harness）：自身零
//     @sofagent/* 依赖、只逐个挂载 9 个原子插件 → **bridgePkg / bridgeApi 语义不适用**
//     （它不桥接任何单个能力包），改由 `suite` 字段声明「挂哪些兄弟插件」，
//     → optionalDependencies = { <每个兄弟插件 id>: version }。
//
// 用法：
//   node tools/gen/gen-plugin-manifests.mjs           # 生成 / 覆盖
//   node tools/gen/gen-plugin-manifests.mjs --check   # 只校验（门禁用，无副作用）
//   node tools/gen/gen-plugin-manifests.mjs --help
//
// 退出码：0 = 生成成功 / 校验一致（可能伴随 WARN）；1 = 校验发现漂移；2 = 脚本自身错误
//         （清单缺失 / 字段不全 / **两处手写源互相矛盾**——含 src 字面量 seam 漂移与聚合 SUITE 对账失败）
//
// 依赖：仅 node 内置模块（fs/path）——不 import 仓内 dist，无需先 build。
// ============================================================

import fs from 'fs';
import path from 'path';

const REAL_ROOT = path.resolve(import.meta.dirname, '../..');
const DSH_PLUGINS_DIR = 'engine/dsh-plugins';
const MANIFEST = `${DSH_PLUGINS_DIR}/plugins.json`;

const ARGV = process.argv.slice(2);
if (ARGV.includes('--help') || ARGV.includes('-h')) {
  console.log('gen-plugin-manifests.mjs — DSH 插件清单生成器');
  console.log('  (无参数)   从 engine/dsh-plugins/plugins.json 生成各插件的 cordis.patch.yml 与 package.json 段');
  console.log('  --check    只校验落盘内容与生成结果是否逐字节一致（+ src 字面量 seam 对账 + 聚合 SUITE 双向对账），不写盘');
  console.log('  --help     显示帮助');
  process.exit(0);
}
const CHECK_ONLY = ARGV.includes('--check');

/** 生成器直接改写的 package.json 键（其余键原样透传） */
const GENERATED_KEYS = ['description', 'sofagent', 'dsh', '//optionalDependencies', 'optionalDependencies'];

/**
 * package.json 的规范键序（确定性 = 幂等的前提）。
 * 不在本表里的键按其在原文件中的相对顺序追加到末尾——生成器不认识新键也不会吞掉它。
 */
const KEY_ORDER = [
  'name',
  'version',
  'engines',
  'description',
  'private',
  'license',
  'author',
  'main',
  'types',
  'scripts',
  'keywords',
  'sofagent',
  '//optionalDependencies',
  'optionalDependencies',
  'devDependencies',
  'dsh',
];

/** 品牌色（9 个原子插件的既有值；第8批的聚合插件 harness 同源取用，故现为 10 个插件共用此值） */
const BRAND_COLOR = '#16B8F3';

/** 清单条目类别：bridge（桥接单个 @sofagent/* 能力包，缺省）/ suite（聚合编排兄弟插件） */
const KIND_BRIDGE = 'bridge';
const KIND_SUITE = 'suite';

/** 两类条目各自的必填字段（共同字段之外的差异部分） */
const REQUIRED_COMMON = ['id', 'seam', 'seamSemantics', 'capability', 'description'];
const REQUIRED_BRIDGE = ['bridgePkg', 'bridgeApi'];
const REQUIRED_SUITE = ['suite'];

/** JSON 序列化（2 空格缩进 + 末尾单换行）——全仓统一的落盘形态 */
function serialize(obj) {
  return `${JSON.stringify(obj, null, 2)}\n`;
}

/** YAML 双引号标量的最小转义（反斜杠 → 双引号；描述里出现这两个字符时不至于破坏结构） */
function yamlDoubleQuoted(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** 规范键序重排 */
function reorder(obj) {
  const out = {};
  for (const k of KEY_ORDER) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  for (const k of Object.keys(obj)) if (!Object.prototype.hasOwnProperty.call(out, k)) out[k] = obj[k];
  return out;
}

/** 读根 SSOT 版本（新插件尚无自己的 package.json 时的兜底版本） */
function readRootVersion(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || '0.0.0-unknown';
  } catch {
    return '0.0.0-unknown';
  }
}

/** 读 plugins.json 并做字段完整性校验（缺字段 → 脚本自身错误，拒绝产出半成品） */
function loadManifest(root) {
  const p = path.join(root, MANIFEST);
  if (!fs.existsSync(p)) {
    const err = new Error(`插件清单缺失：${MANIFEST}`);
    err.self = true;
    throw err;
  }
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    const err = new Error(`${MANIFEST} 不是合法 JSON：${e.message}`);
    err.self = true;
    throw err;
  }
  const plugins = doc && Array.isArray(doc.plugins) ? doc.plugins : null;
  if (!plugins || plugins.length === 0) {
    const err = new Error(`${MANIFEST} 的 plugins 为空——拒绝生成空清单`);
    err.self = true;
    throw err;
  }
  const seen = new Set();
  for (const [i, e] of plugins.entries()) {
    // 归一化类别：缺省 = bridge（向后兼容既有 9 条），非法值直接判为脚本自身错误
    if (e && (e.kind === undefined || e.kind === KIND_BRIDGE)) e.kind = KIND_BRIDGE;
    if (!e || (e.kind !== KIND_BRIDGE && e.kind !== KIND_SUITE)) {
      const err = new Error(`${MANIFEST} plugins[${i}] 的 kind 非法（只接受 "${KIND_BRIDGE}" / "${KIND_SUITE}" 或缺省）：${e && e.kind}`);
      err.self = true;
      throw err;
    }
    const kindRequired = e.kind === KIND_SUITE ? REQUIRED_SUITE : REQUIRED_BRIDGE;
    for (const k of [...REQUIRED_COMMON, ...kindRequired]) {
      if (typeof e[k] !== 'string' || e[k].trim() === '') {
        if (e.kind === KIND_SUITE && k === 'suite') continue; // suite 是数组，单独校验
        const err = new Error(`${MANIFEST} plugins[${i}]（kind=${e.kind}）缺字段或为空：${k}`);
        err.self = true;
        throw err;
      }
    }
    // 聚合型：suite 必须是非空字符串数组，且每个元素都是本清单里的原子插件 id（防止挂到不存在的包）
    if (e.kind === KIND_SUITE) {
      if (!Array.isArray(e.suite) || e.suite.length === 0 || e.suite.some((s) => typeof s !== 'string' || s.trim() === '')) {
        const err = new Error(`${MANIFEST} plugins[${i}]（${e.id}）的 suite 必须是非空插件 id 字符串数组`);
        err.self = true;
        throw err;
      }
      if (e.suite.includes(e.id)) {
        const err = new Error(`${MANIFEST} plugins[${i}]（${e.id}）的 suite 不得包含自身——聚合层只编排原子插件`);
        err.self = true;
        throw err;
      }
    }
    if (seen.has(e.id)) {
      const err = new Error(`${MANIFEST} plugins[${i}] id 重复：${e.id}`);
      err.self = true;
      throw err;
    }
    seen.add(e.id);
  }
  // 交叉对账：suite 里出现的每个 id 都必须真的是清单内条目（挂到不存在的兄弟插件 = 生成出假依赖）
  for (const e of plugins) {
    if (e.kind !== KIND_SUITE) continue;
    for (const dep of e.suite) {
      if (!seen.has(dep)) {
        const err = new Error(`${MANIFEST} ${e.id} 的 suite 引用了清单里不存在的插件 id：${dep}`);
        err.self = true;
        throw err;
      }
    }
  }
  return plugins;
}

/** 插件短名：cordis-plugin-sofagent-audit → audit */
const shortOf = (id) => id.replace(/^cordis-plugin-sofagent-/, '');

/**
 * 描述尾段（patch / package.json 两处消费，仅品牌措辞不同）：
 *   · bridge 型 → 「桥接 <bridgePkg> <bridgeApi>（…）」
 *   · suite  型 → 「一次性挂载 N 个原子插件（…）」——聚合层不桥接任何单个能力包
 */
function tailOf(entry, brandLabel) {
  if (entry.kind === KIND_SUITE) {
    return `一次性挂载 ${entry.suite.length} 个原子插件（${brandLabel}）`;
  }
  return `桥接 ${entry.bridgePkg} ${entry.bridgeApi}（${brandLabel}）`;
}

/** 生成 cordis.patch.yml 全文 */
function renderPatch(entry, version) {
  const short = shortOf(entry.id);
  const desc = `${entry.description}——${tailOf(entry, `sofagent 品牌 · ${BRAND_COLOR}`)}`;
  return [
    `# sofagent ${entry.id} bundle patch v${version}——sofagent 品牌插件，注册为 DSH profile layer`,
    '- insert:',
    `    - id: sofagent-${short}`,
    `      name: '${entry.id}'`,
    '      inject: [settings, dynamicCordisRunner]',
    '      config:',
    `        seam: "${yamlDoubleQuoted(entry.seam)}"    # 语义：${entry.seamSemantics}`,
    `        description: "${yamlDoubleQuoted(desc)}"`,
    '',
  ].join('\n');
}

/** 生成 package.json 的生成段（description / sofagent / dsh / //optionalDependencies / optionalDependencies） */
function generatedSegments(entry, version) {
  // optionalDependencies 的取值面按类别分流：
  //   · bridge 型 → 1 个 @sofagent/* 能力包（既有 9 条，一字不变）
  //   · suite  型 → 9 个兄弟插件包（懒加载逐个 import——缺哪个只记 failed，不整挂失败）
  const optionalDependencies =
    entry.kind === KIND_SUITE
      ? Object.fromEntries(entry.suite.map((dep) => [dep, version]))
      : { [entry.bridgePkg]: version };
  const optDepsNote =
    entry.kind === KIND_SUITE
      ? `v1.4.8 第8批：src/index.ts 逐个 await import('<兄弟插件 id>')（懒加载 + 逐个降级不抛——缺任一原子插件只记入 failed 数组，不整挂失败），聚合层自身零 @sofagent/* 依赖；对齐 root package.json F-18 optionalDependencies 先例。`
      : `v1.4.5 T6 (R4)：src/index.ts 惰性 await import('${entry.bridgePkg}')（懒加载 + 缺依赖降级不抛；v1.4.8 起该样板由 @sofagent/dsh-plugin-kit 统一封装），此前未声明任何依赖——对齐 root package.json F-18 optionalDependencies 先例。`;
  return {
    description: `${entry.description}（seam: ${entry.seam}）——${tailOf(entry, `sofagent 品牌插件 · 主色 ${BRAND_COLOR}`)}`,
    sofagent: {
      type: 'dsh-plugin',
      family: 'cordis',
      seam: entry.seam,
      seamSemantics: entry.seamSemantics,
    },
    dsh: {
      bundle: {
        patch: './cordis.patch.yml',
      },
    },
    // optionalDependencies 的"为什么"注释：行号不再写死（样板已移入 plugin-kit，行号会漂）
    '//optionalDependencies': optDepsNote,
    optionalDependencies,
  };
}

/** src/index.ts → 字面量 seam（与 check-seam-contract.mjs 的 seamFromTs 同正则） */
function seamFromTs(text) {
  const m = text.match(/^\s*seam:\s*(['"])([\s\S]*?)\1\s*,?\s*$/m);
  return m ? m[2] : null;
}

/**
 * src/index.ts → SUITE 数组里的兄弟插件包名（聚合型插件的运行时编排清单唯一真值）。
 * 实测约束：`SUITE` 是 `const SUITE: ReadonlyArray<readonly [string, string]> = [ … ];`
 * 形态，每项为 `['<短名>', '<包名>']`；只取以 `cordis-plugin-sofagent-` 开头的字符串字面量，
 * 天然跳过 `[string, string]` 这类类型标注（引号是不可省略的锚点）。
 * @returns {string[] | null} 找不到 SUITE 数组时返回 null（由调用方升级为脚本自身错误）
 */
function suiteFromTs(text) {
  const m = text.match(/const\s+SUITE\b[^=]*=\s*\[([\s\S]*?)\];/);
  if (!m) return null;
  return [...m[1].matchAll(/['"](cordis-plugin-sofagent-[a-z0-9-]+)['"]/g)].map((x) => x[1]);
}

/** 重复出现的元素（保序去重）——SUITE 里出现两次同一个包 = 挂两遍，必须挡住 */
function duplicatesOf(arr) {
  const seen = new Set();
  const dups = [];
  for (const v of arr) {
    if (seen.has(v)) {
      if (!dups.includes(v)) dups.push(v);
    } else {
      seen.add(v);
    }
  }
  return dups;
}

/** 首个不同位的下标（长度不同则取短的那个长度位）——用于把「不同序」定位到具体位次 */
function firstDiffIndex(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) return i;
  }
  return -1;
}

/** 聚合 SUITE 对账产生的 WARN（不阻断）——由 main() 打印并挂在末行，避免被 check-template-drift 的 tail -1 吞掉 */
const SUITE_WARNINGS = [];

/**
 * 聚合型插件（kind = "suite"）的双源对账：src/index.ts 的 `SUITE` ↔ plugins.json 的 `suite`。
 *
 * 权威关系（不对称后果）：
 *   · src `SUITE` 是**执行侧真值**——运行时真挂哪些由它决定；
 *   · plugins.json `suite` 是**声明侧消费方**——只驱动 optionalDependencies 与描述文本。
 *   · 危险方向是「清单多、src 少」＝声明了却没加载（静默）；反向「src 多、清单少」会因
 *     `await import('<id>')` 找不到包而记入 failed[]（响的，但仍应尽早挡在生成期）。
 *
 * 五条判据（全部 fail-loud 并点名插件 id）：
 *   ① 集合相等（并分别报「哪一侧多」）② 装载序一致（WARN——见下方实测依据）
 *   ③ 无幽灵（src 项必须在清单里）④ 无遗漏（原子插件全集必须都在两侧）⑤ 不自挂（不得含自身）
 * 另加：两侧都不得有重复项（重复 = 同一插件挂两遍）。
 *
 * @param {object} entry 清单里的聚合型条目
 * @param {readonly object[]} plugins 全部清单条目（用于取原子插件全集与 id 存在性）
 * @param {string} root 仓根
 * @returns {string[]} 不一致点（空数组 = 一致）
 */
function suiteCheck(entry, plugins, root) {
  const tsPath = path.join(root, DSH_PLUGINS_DIR, entry.id, 'src', 'index.ts');
  const tsSuite = suiteFromTs(fs.readFileSync(tsPath, 'utf8'));
  if (tsSuite === null) {
    const err = new Error(
      `${DSH_PLUGINS_DIR}/${entry.id}/src/index.ts 里找不到 \`SUITE\` 数组——聚合型插件必须声明编排清单，` +
        `否则 plugins.json.suite 声明的 optionalDependencies 无人消费（声明与实际装载脱钩）。`,
    );
    err.self = true;
    throw err;
  }
  const manifestSuite = entry.suite;
  const allIds = plugins.map((e) => e.id);
  const idSet = new Set(allIds);
  // 判据 ④ 的期望集：清单里**除聚合层自身以外**的全部条目。
  // （当前只有一个聚合层，故等价于「除 harness 自身外每一项」；若将来新增第二个聚合层，
  //   本实现把「聚合层」互相排除——聚合层只编排原子插件，嵌套聚合会引入递归风险。）
  const expected = allIds.filter((id) => id !== entry.id && !plugins.find((e) => e.id === id && e.kind === KIND_SUITE));
  const tsSet = new Set(tsSuite);
  const mfSet = new Set(manifestSuite);
  const problems = [];

  // 判据 ⑤：不自挂（自挂 = harness 挂 harness，无限递归）
  if (tsSuite.includes(entry.id)) {
    problems.push(`不自挂：src SUITE 含自身「${entry.id}」——聚合层只能编排原子插件，自挂即递归`);
  }
  if (manifestSuite.includes(entry.id)) {
    problems.push(`不自挂：plugins.json.suite 含自身「${entry.id}」`);
  }

  // 判据 ③：无幽灵（src 挂到清单里不存在的包 = 生成出假依赖）
  const ghosts = tsSuite.filter((id) => !idSet.has(id));
  if (ghosts.length > 0) {
    problems.push(`幽灵项：src SUITE 含 plugins.json 里不存在的插件 id [${ghosts.join(', ')}]`);
  }

  // 判据 ①：集合相等 —— 必须分别点明「哪一侧多」（只打印非空的那侧，避免出现「多出 []」的噪声）
  const onlyManifest = [...mfSet].filter((id) => !tsSet.has(id));
  const onlyTs = [...tsSet].filter((id) => !mfSet.has(id));
  if (onlyManifest.length > 0 || onlyTs.length > 0) {
    const sides = [];
    if (onlyManifest.length > 0) {
      sides.push(`plugins.json.suite 多出 [${onlyManifest.join(', ')}]（声明了却没装载 = 静默过度声明）`);
    }
    if (onlyTs.length > 0) {
      sides.push(`src SUITE 多出 [${onlyTs.join(', ')}]（装载了但清单未声明）`);
    }
    problems.push(`集合不等：${sides.join(' / ')}`);
  }

  // 判据 ④：无遗漏 —— 原子插件全集必须都在两侧（缺哪侧点名哪侧）
  const missingInTs = expected.filter((id) => !tsSet.has(id));
  const missingInManifest = expected.filter((id) => !mfSet.has(id));
  if (missingInTs.length > 0) problems.push(`漏挂：src SUITE 缺原子插件 [${missingInTs.join(', ')}]`);
  if (missingInManifest.length > 0) problems.push(`漏声明：plugins.json.suite 缺原子插件 [${missingInManifest.join(', ')}]`);

  // 重复项：同一插件挂两遍
  const dupTs = duplicatesOf(tsSuite);
  const dupManifest = duplicatesOf(manifestSuite);
  if (dupTs.length > 0) problems.push(`重复项：src SUITE 里重复出现 [${dupTs.join(', ')}]`);
  if (dupManifest.length > 0) problems.push(`重复项：plugins.json.suite 里重复出现 [${dupManifest.join(', ')}]`);

  if (problems.length > 0) {
    const err = new Error(
      `聚合编排清单不一致：${entry.id}\n` +
        problems.map((p) => `  · ${p}\n`).join('') +
        `  src SUITE (${tsSuite.length})          : ${tsSuite.join(', ')}\n` +
        `  plugins.json.suite (${manifestSuite.length})    : ${manifestSuite.join(', ')}\n` +
        `  —— src/index.ts 的 SUITE 是运行时真值（决定真挂哪些），plugins.json.suite 是声明侧（驱动\n` +
        `     optionalDependencies 与描述文本）。两侧必须同集合、无幽灵、无遗漏、不自挂，改一处必须改另一处。`,
    );
    err.self = true;
    throw err;
  }

  // 判据 ②：装载序一致 —— **WARN 而非 FAIL**（实测无语义）
  //   依据 A（静态）：9 个原子插件的 apply 只做两件事——provide 自己唯一的 `sofagent.<short>`
  //     （或在无 provide 的宿主上 merge 进 ctx.sofagent），以及可选地注册宿主的 settings /
  //     dynamicCordisRunner（这两个来自 cordis DI 的注入，不是兄弟插件 provide 的）；
  //     **没有任何插件在 apply 期读取兄弟插件的服务**（grep 九个 src 零命中）。
  //   依据 B（动态）：把 9 个 dist 以正序与逆序各挂一遍，注册服务集合完全相同（均为
  //     sofagent.{inject,audit,gate,ontology,commons,evolve,rollback,daemon,fde} 9 个）、
  //     零抛出，两个顺序的运行面不可区分。
  //   ⇒ 「同序」不构成运行时契约，只是声明序与人读清单序的对齐；故不阻断，但要点名到具体位次。
  const at = firstDiffIndex(tsSuite, manifestSuite);
  if (at !== -1) {
    SUITE_WARNINGS.push(
      `${entry.id}：装载序与清单不同序（第 ${at + 1} 位：src SUITE=${tsSuite[at] ?? '<缺>'} / plugins.json.suite=${manifestSuite[at] ?? '<缺>'}）` +
        `——实测装载序无语义（正/逆序注册面相同），故仅告警不阻断`,
    );
  }

  return problems;
}

/**
 * 计算全部期望落盘内容（不写盘）。
 * 返回 [{ path（相对仓根）, content, kind }]
 */
function planOutputs(root) {
  const plugins = loadManifest(root);
  const rootVersion = readRootVersion(root);
  const outputs = [];
  SUITE_WARNINGS.length = 0;

  for (const entry of plugins) {
    const dir = path.join(root, DSH_PLUGINS_DIR, entry.id);
    const pkgPath = path.join(dir, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      const err = new Error(`插件目录缺 package.json：${DSH_PLUGINS_DIR}/${entry.id}/package.json`);
      err.self = true;
      throw err;
    }
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const version = pkg.version || rootVersion;

    // ① cordis.patch.yml（整文件生成）
    outputs.push({
      path: `${DSH_PLUGINS_DIR}/${entry.id}/cordis.patch.yml`,
      content: renderPatch(entry, version),
      kind: 'patch',
    });

    // ② package.json（生成段覆盖 + 规范键序）
    const next = reorder({ ...pkg, ...generatedSegments(entry, version) });
    outputs.push({ path: `${DSH_PLUGINS_DIR}/${entry.id}/package.json`, content: serialize(next), kind: 'pkg' });

    // ③ 附加守卫：src/index.ts 的字面量 seam 必须 == plugins.json（否则两处静默漂移）
    const tsPath = path.join(dir, 'src', 'index.ts');
    if (!fs.existsSync(tsPath)) {
      const err = new Error(`插件目录缺 src/index.ts：${DSH_PLUGINS_DIR}/${entry.id}/src/index.ts`);
      err.self = true;
      throw err;
    }
    const tsSeam = seamFromTs(fs.readFileSync(tsPath, 'utf8'));
    if (tsSeam === null) {
      const err = new Error(`${DSH_PLUGINS_DIR}/${entry.id}/src/index.ts 里找不到字面量 seam 赋值——seam 契约必须有两处载体之一（另一处在 plugins.json）`);
      err.self = true;
      throw err;
    }
    if (tsSeam.replace(/\s+/g, ' ').trim() !== entry.seam.replace(/\s+/g, ' ').trim()) {
      const err = new Error(
        `seam 漂移：${entry.id}\n  plugins.json    : ${entry.seam}\n  src/index.ts    : ${tsSeam}\n` +
          `  —— plugins.json 是清单的生成源，src/index.ts 是 seam 契约门禁的正向读取点；两者必须逐字一致（改一处必须改另一处）。`,
      );
      err.self = true;
      throw err;
    }
  }

  // ④ 聚合型插件：src SUITE ↔ plugins.json.suite 双向对账（第8批收口新增）
  for (const entry of plugins) {
    if (entry.kind !== KIND_SUITE) continue;
    suiteCheck(entry, plugins, root);
  }

  // ⑤ 双向往账：目录里每个 cordis-plugin-* 都必须在清单登记，反之亦然
  const dir = path.join(root, DSH_PLUGINS_DIR);
  const onDisk = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('cordis-plugin-sofagent-'))
    .map((e) => e.name)
    .sort();
  const inManifest = plugins.map((e) => e.id).sort();
  for (const d of onDisk) {
    if (!inManifest.includes(d)) {
      const err = new Error(`目录 ${DSH_PLUGINS_DIR}/${d}/ 未登记进 ${MANIFEST}——新增插件必须登记清单（否则其 manifest 不受生成器管辖）`);
      err.self = true;
      throw err;
    }
  }
  for (const id of inManifest) {
    if (!onDisk.includes(id)) {
      const err = new Error(`${MANIFEST} 登记了 ${id}，但目录 ${DSH_PLUGINS_DIR}/${id}/ 不存在`);
      err.self = true;
      throw err;
    }
  }

  return outputs;
}

// ============================================================
// 入口
// ============================================================
function main() {
  const outputs = planOutputs(REAL_ROOT);
  const drift = [];

  // 聚合 SUITE 的 WARN：先逐条打印，再把计数挂到末行——check-template-drift 断言六只回显
  // 生成器的最后一行，放在末行才不会被 `tail -1` 吞掉（WARN 不可见 = 等于没有）。
  const warnNote = SUITE_WARNINGS.length > 0 ? ` ｜ ⚠ WARN ${SUITE_WARNINGS.length}（不阻断）` : '';
  for (const w of SUITE_WARNINGS) console.log(`  ⚠ ${w}`);

  for (const o of outputs) {
    const abs = path.join(REAL_ROOT, o.path);
    const disk = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;

    if (CHECK_ONLY) {
      if (disk !== o.content) drift.push(o.path);
      continue;
    }
    if (disk === o.content) {
      console.log(`  = ${o.path}（已是最新）`);
    } else {
      fs.writeFileSync(abs, o.content);
      console.log(`  ✎ ${o.path}（${disk === null ? '新建' : '更新'}）`);
    }
  }

  if (CHECK_ONLY) {
    if (drift.length > 0) {
      console.error('✗ 生成式漂移：以下文件与 plugins.json 的生成结果不一致——请跑 `node tools/gen/gen-plugin-manifests.mjs` 并提交');
      for (const d of drift) console.error(`    · ${d}`);
      return 1;
    }
    console.log(`✓ 生成式幂等：${outputs.length} 个生成物与 plugins.json 逐字节一致（${outputs.length / 2} 个插件）${warnNote}`);
    return 0;
  }

  console.log(`✓ 生成完成：${outputs.length} 个文件（${outputs.length / 2} 个插件 × [cordis.patch.yml, package.json]）${warnNote}`);
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  if (err && err.self) {
    console.error(`✗ 生成器无法继续：${err.message}`);
    process.exit(2);
  }
  console.error(`✗ gen-plugin-manifests 自身错误：${err && err.stack ? err.stack : String(err)}`);
  process.exit(2);
}
