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
//   · kind = "suite"        ——**聚合型**插件（包名 = 裸名 cordis-plugin-sofagent）：自身零
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
/** v1.4.9 F1①：插件工具清单的单一源（roles 取值面 + 工具名全集都出自这里） */
const TOOL_REGISTRY = 'engine/mcp/src/tool-registry.ts';

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

/** 清单条目类别：bridge（桥接单个 @sofagent/* 能力包，缺省）/ suite（聚合编排兄弟插件） */
const KIND_BRIDGE = 'bridge';
const KIND_SUITE = 'suite';

/** seam 值里的非事件段前缀（`non-seam:tool-set` 这类接入形态，不参与接线对账） */
const NON_SEAM_PREFIX = 'non-seam:';

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
    // v1.4.9 P2：多包 bridges 数组校验（厚插件形态——pkg/api 必填、与单包字段并存时以 bridges 优先）
    if (e.kind !== KIND_SUITE && e.bridges !== undefined) {
      if (!Array.isArray(e.bridges) || e.bridges.length === 0 || e.bridges.some((b) => !b || typeof b.pkg !== 'string' || typeof b.api !== 'string' || b.pkg.trim() === '' || b.api.trim() === '')) {
        const err = new Error(`${MANIFEST} plugins[${i}]（${e.id}）的 bridges 必须是非空 {pkg, api} 数组（v1.4.9 P2 厚插件多包桥接形态）`);
        err.self = true;
        throw err;
      }
    }
    // v1.4.9 P2：featureGates / toolsRoles 类型校验（分档声明面——数组形态 + 档位值非空数组）
    if (e.toolsRoles !== undefined) {
      if (!Array.isArray(e.toolsRoles) || e.toolsRoles.length === 0 || e.toolsRoles.some((r) => typeof r !== 'string' || r.trim() === '')) {
        const err = new Error(`${MANIFEST} plugins[${i}]（${e.id}）的 toolsRoles 必须是非空角色字符串数组（v1.4.9 P2 多角色并集形态）`);
        err.self = true;
        throw err;
      }
    }
    if (e.featureGates !== undefined) {
      if (typeof e.featureGates !== 'object' || e.featureGates === null || Array.isArray(e.featureGates)) {
        const err = new Error(`${MANIFEST} plugins[${i}]（${e.id}）的 featureGates 必须是「档位名 → 工具名数组」对象（v1.4.9 P2 settings 分档）`);
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

/**
 * 插件短名 / 角色名（消费点：cordis.patch.yml 的条目 id 后缀）。
 *   · 原子插件 → 剥前缀：cordis-plugin-sofagent-audit → audit
 *   · 聚合插件 → 包名是**裸名** cordis-plugin-sofagent，剥完前缀为空、**无派生短名**，
 *     故取它的角色名 = 自己的 kind（`suite`）。同一个 "suite" 语义在三处同形：
 *     补丁层条目 id `sofagent-suite` / 服务名 `sofagent.suite` / SEAMS.md 词表键 `suite`
 *     ——短名标识「挂载形态」，与包身份解耦（包名换裸名不改角色）。
 */
const AGGREGATE_ID = 'cordis-plugin-sofagent';
const shortOf = (id) => (id === AGGREGATE_ID ? KIND_SUITE : id.replace(/^cordis-plugin-sofagent-/, ''));

/**
 * 描述尾段（patch / package.json 两处消费，同形）：
 *   · bridge 型 → 「桥接 <bridgePkg> <bridgeApi>」
 *   · suite  型 → 「一次性挂载 N 个原子插件」——聚合层不桥接任何单个能力包
 * 刻意不带品牌色等装饰后缀：插件描述只回答「这个插件干什么」；
 * 品牌色是**运行时配置项**（kit 注册的 settings 字段 / OpenClaw configSchema 属性），
 * 不属清单文案。
 */
function tailOf(entry) {
  if (entry.kind === KIND_SUITE) {
    return `一次性挂载 ${entry.suite.length} 个原子插件`;
  }
  // v1.4.9 P2：多包桥接斜杠并列（F1② 既有惯例）；单包保持原形态
  const bridgePkgs =
    Array.isArray(entry.bridges) && entry.bridges.length > 0
      ? entry.bridges
      : [{ pkg: entry.bridgePkg, api: entry.bridgeApi }];
  return `桥接 ${bridgePkgs.map((b) => `${b.pkg} ${b.api}`).join(' / ')}`;
}

/** 生成 cordis.patch.yml 全文 */
function renderPatch(entry, version) {
  const short = shortOf(entry.id);
  const desc = `${entry.description}——${tailOf(entry)}`;
  return [
    `# sofagent ${entry.id} bundle patch v${version}——注册为 DSH profile layer`,
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

/**
 * 生成 package.json 的生成段（description / sofagent / dsh / //optionalDependencies / optionalDependencies）
 * @param {object} entry 清单条目
 * @param {string} version 插件版本
 * @param {{name: string, roles: string[]}[]} registry tool-registry.ts 解析结果（v1.4.9 F1① / P2）
 */
function generatedSegments(entry, version, registry) {
  // optionalDependencies 的取值面按类别分流：
  //   · bridge 型 → 声明的全部桥接包（单包 bridgePkg 既有形态 / P2 多包 bridges 并集）
  //   · suite  型 → 全部兄弟插件包（懒加载逐个 import——缺哪个只记 failed，不整挂失败）
  const bridgePkgs =
    Array.isArray(entry.bridges) && entry.bridges.length > 0
      ? entry.bridges.map((b) => b.pkg)
      : [entry.bridgePkg];
  const optionalDependencies =
    entry.kind === KIND_SUITE
      ? Object.fromEntries(entry.suite.map((dep) => [dep, version]))
      : Object.fromEntries(bridgePkgs.map((p) => [p, version]));
  const optDepsNote =
    entry.kind === KIND_SUITE
      ? `v1.4.8 第8批：src/index.ts 逐个 await import('<兄弟插件 id>')（懒加载 + 逐个降级不抛——缺任一原子插件只记入 failed 数组，不整挂失败），聚合层自身零 @sofagent/* 依赖；对齐 root package.json F-18 optionalDependencies 先例。`
      : `v1.4.5 T6 (R4)：src/index.ts 惰性 await import（懒加载 + 缺依赖降级不抛；v1.4.8 起该样板由 @sofagent/dsh-plugin-kit 统一封装；v1.4.9 P2 起厚插件多包 bridges 按序解析、部分可用即部分成功），此前未声明任何依赖——对齐 root package.json F-18 optionalDependencies 先例。`;
  // v1.4.9 F1①/P2：sofagent.tools 生成段——「本插件注册哪些工具」的声明面。
  // 单角色 toolsRole（F1①）与多角色 toolsRoles（P2）二选一：多角色优先（并集）。
  // 只对声明了角色的条目生成；--check 与 tool-registry.ts 对账（幽灵角色 / 空清单 fail-loud）。
  const sofagentSegment = {
    type: 'dsh-plugin',
    family: 'cordis',
    seam: entry.seam,
    seamSemantics: entry.seamSemantics,
  };
  // v1.5.0 章十：接线实现面——声明了宿主事件 seam 的条目把真实订阅名一并写进
  // sofagent 段（npm 侧消费方能看出「挂在哪些宿主事件上」而不是只听声明）。
  // 三方一致性由 --check 的 seamHandlers 守卫负责。
  if (Array.isArray(entry.seamHandlers) && entry.seamHandlers.length > 0) {
    sofagentSegment.seamHandlers = entry.seamHandlers;
  }
  // P2 featureGates 对账：每档清单内的名字必须 ⊆ 角色并集工具名（幽灵名 = 声明了
  // registry 里不存在的工具 = 关档语义空转）；档位名不得重复出现在多个档（归属二义）。
  if (entry.featureGates !== undefined) {
    const roles = entry.toolsRoles ?? (entry.toolsRole !== undefined ? [entry.toolsRole] : []);
    if (roles.length === 0) {
      const err = new Error(
        `${MANIFEST} 条目 ${entry.id} 声明 featureGates 但未声明 toolsRole/toolsRoles——分档无角色全集可对照，属声明矛盾。`,
      );
      err.self = true;
      throw err;
    }
    const unionNames = new Set(
      registry.filter((t) => t.roles.some((r) => roles.includes(r))).map((t) => t.name),
    );
    const owner = new Map();
    for (const [gate, names] of Object.entries(entry.featureGates)) {
      if (!Array.isArray(names) || names.length === 0) {
        const err = new Error(`${MANIFEST} 条目 ${entry.id} 的 featureGates.${gate} 必须是非空工具名数组。`);
        err.self = true;
        throw err;
      }
      for (const n of names) {
        if (!unionNames.has(n)) {
          const err = new Error(
            `${MANIFEST} 条目 ${entry.id} 的 featureGates.${gate} 含工具 "${n}"，但它不在 toolsRoles=[${roles.join(',')}] 的并集内` +
              `（${TOOL_REGISTRY} 单一源查无此名或角色不符）——关档语义会空转，请核对清单。`,
          );
          err.self = true;
          throw err;
        }
        if (owner.has(n) && owner.get(n) !== gate) {
          const err = new Error(
            `${MANIFEST} 条目 ${entry.id} 的工具 "${n}" 同时被 featureGates.${owner.get(n)} 与 ${gate} 声明——档位归属二义，一个工具只能属一个档。`,
          );
          err.self = true;
          throw err;
        }
        owner.set(n, gate);
      }
    }
    sofagentSegment.featureGates = entry.featureGates;
  }
  const toolsList = toolsForRole(registry, entry.toolsRoles ?? entry.toolsRole);
  if (toolsList !== null) {
    if (toolsList.length === 0) {
      const rolesLabel = entry.toolsRoles ?? entry.toolsRole;
      const err = new Error(
        `${MANIFEST} 条目 ${entry.id} 声明 toolsRoles/toolsRole="${String(rolesLabel)}"，但 ${TOOL_REGISTRY} 里无任何工具的 roles 含其中任一值` +
          `——声明了角色却零工具可挂，请核对 roles 取值面（单一源 = tool-registry.ts）。`,
      );
      err.self = true;
      throw err;
    }
    sofagentSegment.tools = toolsList;
    if (entry.toolsRoles !== undefined) sofagentSegment.toolsRoles = entry.toolsRoles;
    else sofagentSegment.toolsRole = entry.toolsRole;
  }
  return {
    description: `${entry.description}（seam: ${entry.seam}）——${tailOf(entry)}`,
    sofagent: sofagentSegment,
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

/** seam 值 → 事件段清单（`a + b` 拆分；`non-seam:` 段是非事件接入形态，不参与接线对账） */
function seamSegments(seam) {
  return String(seam)
    .split('+')
    .map((s) => s.trim())
    .filter((s) => s !== '' && !s.startsWith(NON_SEAM_PREFIX));
}

/**
 * src/index.ts → `seamHandlers` 对象字面量的**顶层键**（= 真实订阅的宿主事件名）。
 *
 * 解析方式：从 `seamHandlers: Record<…> = {` 起逐字符扫描，维护大括号深度并跳过
 * 字符串字面量（引号内含 `{}` 的日志文案不会污染深度）；只在深度 1 处、且字符串
 * 后紧跟 `:` 的形态收录为键——即「对象直接成员」而非 handler 体内的字符串。
 *
 * @returns {string[] | null} 找不到声明处返回 null（由调用方升级为脚本自身错误）
 */
function seamHandlersFromTs(text) {
  const decl = text.match(/seamHandlers\s*:\s*Record<[^>]*>\s*=\s*\{/);
  if (!decl) return null;
  const keys = [];
  let i = decl.index + decl[0].length - 1; // 停在开括号
  let depth = 0;
  let expectingKey = true;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      let buf = '';
      while (j < text.length) {
        if (text[j] === '\\') {
          j += 2;
          continue;
        }
        if (text[j] === ch) break;
        buf += text[j];
        j++;
      }
      if (depth === 1 && expectingKey) {
        let k = j + 1;
        while (k < text.length && /\s/.test(text[k])) k++;
        if (text[k] === ':') {
          keys.push(buf);
          expectingKey = false;
        }
      }
      i = j + 1;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) break;
    } else if (ch === ',' && depth === 1) expectingKey = true;
    i++;
  }
  return keys;
}

/** 集合等价判定（顺序无关，重复项单独报） */
function sameSet(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
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

// ============================================================
// v1.4.9 F1①：sofagent.tools 生成段——插件工具清单的声明侧消费方
// ============================================================
// 单一源 = engine/mcp/src/tool-registry.ts（工具清单不手抄）。凡声明 toolsRole 的插件，
// 生成器按「roles 含 toolsRole」筛出工具名列表写进 package.json 的 sofagent.tools；
// --check 的逐字节比对 + 本处的角色校验共同构成「与 tool-registry.ts 一致」的门禁：
//   · registry 变更（改名/挪角色/删工具）→ 重算列表与落盘不一致 → --check 红；
//   · toolsRole 写错（registry 里没有这个角色）→ 生成期直接 fail-loud（exit 2）；
//   · 筛出空清单 → 同样 fail-loud（声明了角色却一个工具不挂 = 声明无意义）。
// 解析器与 tools/check/check-wiring-guard.mjs 的 extractToolRegistry 同一形态
// （行式扫描：name 行 → 块内 4 空格缩进的 roles 行），刻意不 import dist——
// 生成器零构建依赖（见头部注释「不 import 仓内 dist」约束）。

/** tool-registry.ts 全文 → [{name, roles[]}]（保 registry 声明序） */
function parseToolRegistry(text) {
  const lines = text.split('\n');
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s{2,}name: '([a-z0-9_]+)',\s*$/);
    if (!m) continue;
    const name = m[1];
    const roles = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s{2}\},?\s*$/.test(lines[j])) break;
      const rm = lines[j].match(/^\s{4}roles: \[([^\]]*)\]/);
      if (rm) {
        for (const r of rm[1].matchAll(/'([A-Za-z0-9_]+)'/g)) roles.push(r[1]);
      }
    }
    items.push({ name, roles });
  }
  return items;
}

/**
 * 按角色筛工具名（registry 声明序）——sofagent.tools 生成段的取值面。
 * v1.4.9 P2：toolsRoles 数组 = 并集（roles 含任一值）；单值 toolsRole 兼容保留。
 * @returns {string[] | null} 条目无角色声明时返回 null（不生成该键，其余插件零扰动）
 */
function toolsForRole(registry, toolsRole) {
  if (toolsRole === undefined) return null;
  const roles = Array.isArray(toolsRole) ? toolsRole : [toolsRole];
  return registry.filter((t) => t.roles.some((r) => roles.includes(r))).map((t) => t.name);
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
  // （当前只有一个聚合层，故等价于「除聚合层自身外每一项」；若将来新增第二个聚合层，
  //   本实现把「聚合层」互相排除——聚合层只编排原子插件，嵌套聚合会引入递归风险。）
  const expected = allIds.filter((id) => id !== entry.id && !plugins.find((e) => e.id === id && e.kind === KIND_SUITE));
  const tsSet = new Set(tsSuite);
  const mfSet = new Set(manifestSuite);
  const problems = [];

  // 判据 ⑤：不自挂（自挂 = 聚合层挂聚合层，无限递归）
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
  // v1.4.9 F1①：tool-registry.ts 单一源解析（有 toolsRole 声明才消费；零声明时解析一次的开销可忽略）
  const registry = parseToolRegistry(fs.readFileSync(path.join(root, TOOL_REGISTRY), 'utf8'));
  if (registry.length === 0) {
    const err = new Error(`${TOOL_REGISTRY} 解析出 0 个工具——行式解析器失效（正则与文件形态漂移），拒绝生成。`);
    err.self = true;
    throw err;
  }
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
    const next = reorder({ ...pkg, ...generatedSegments(entry, version, registry) });
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

    // ③b 附加守卫（v1.5.0 章十）：seamHandlers 三方对账
    //     seam（事件集） ↔ plugins.json.seamHandlers（声明侧） ↔ src/index.ts 的
    //     seamHandlers 顶层键（实现侧）。缺口背景：章十把 seam 从「声明」变成
    //     「实现」，三处只要有一处落后，就会出现「grep 能过、探针必挂」的假接线
    //     ——本守卫把这类静默漂移变成硬红。
    {
      const segments = seamSegments(entry.seam);
      const declared = Array.isArray(entry.seamHandlers) ? entry.seamHandlers : null;
      if (segments.length > 0 && (declared === null || declared.length === 0)) {
        const err = new Error(
          `${MANIFEST} 条目 ${entry.id} 声明了宿主事件 seam（${segments.join(', ')}）却没有 seamHandlers——\n` +
            `  章十起「声明 seam」与「接线实现」必须同时成立：声明了事件位就得把订阅写出来（否则就是 SEAMS.md §6 要治的假接线）。`,
        );
        err.self = true;
        throw err;
      }
      if (segments.length === 0 && declared !== null && declared.length > 0) {
        const err = new Error(
          `${MANIFEST} 条目 ${entry.id} 是非 seam 接入形态（${entry.seam}）却声明了 seamHandlers（${declared.join(', ')}）——\n` +
            `  非事件接入的插件不该有宿主事件订阅；要么去掉 seamHandlers，要么把 seam 改成真实事件名。`,
        );
        err.self = true;
        throw err;
      }
      if (declared !== null && declared.length > 0) {
        if (new Set(declared).size !== declared.length) {
          const err = new Error(`${MANIFEST} 条目 ${entry.id} 的 seamHandlers 有重复项：[${declared.join(', ')}]——同一事件订两次等于重复接线。`);
          err.self = true;
          throw err;
        }
        if (!sameSet(declared, segments)) {
          const err = new Error(
            `seamHandlers 与 seam 事件集不符：${entry.id}\n  seam 事件集        : [${segments.join(', ')}]\n  plugins.json 声明  : [${declared.join(', ')}]\n` +
              `  —— 每个声明的宿主事件位都必须且只能有一个订阅；不对称即「幽灵订阅」或「漏接线」。`,
          );
          err.self = true;
          throw err;
        }
        const tsHandlers = seamHandlersFromTs(fs.readFileSync(tsPath, 'utf8'));
        if (tsHandlers === null) {
          const err = new Error(
            `${DSH_PLUGINS_DIR}/${entry.id}/src/index.ts 里找不到 seamHandlers 对象字面量——\n` +
              `  plugins.json 声明了 ${declared.length} 个订阅，src 里必须有对应的 seamHandlers 实现（章十：seam 从声明到实现）。`,
          );
          err.self = true;
          throw err;
        }
        if (!sameSet(tsHandlers, declared)) {
          const err = new Error(
            `seamHandlers 双源漂移：${entry.id}\n  plugins.json.seamHandlers : [${declared.join(', ')}]\n  src/index.ts 顶层键       : [${tsHandlers.join(', ')}]\n` +
              `  —— 声明侧与实现侧必须同集合（改一处必须改另一处）。`,
          );
          err.self = true;
          throw err;
        }
      }
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
    .filter((e) => e.isDirectory() && (e.name === AGGREGATE_ID || e.name.startsWith('cordis-plugin-sofagent-')))
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
