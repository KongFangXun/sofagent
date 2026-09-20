#!/usr/bin/env node
// ============================================================
// check-anchors.mjs · Markdown 锚点校验（跨文件 + 文件内）
// ============================================================
// 用法: node tools/check/check-anchors.mjs [--fix]
//
// 功能: 扫描所有 .md 文件中的锚点引用：
//       ① 跨文件引用 ](xxx.md#yyy)；
//       ② 文件内部目录引用 ](#yyy)。
//       按 GitHub 锚点归一化规则生成实际锚点表，比对引用的
//       #yyy 是否存在。跨文件目标不存在报断链，锚点不存在报锚点过时。
//
// 检查范围: 跨文件锚点引用（](文件.md#锚点)）+ 文件内部目录链接（](#锚点)）。
// 文件内部引用的排除规则：跳过空锚点 ](#)；跳过被 ``` 包裹的代码块内容。
// 文件存在性断言：跨文件引用的目标文件不存在时报「文件断链」（与
//       check-docs.sh 1b 全仓死链扫描双保险——本脚本单独跑时也能抓文件死链）。
//       模板占位符白名单（与 check-docs 1b 同口径）：路径含 /vX.Y、
//       vX.Y.Z、vX.Y.md 的占位链接不视为断链（版本未定时的规划占位）。
//
// --fix: 对锚点过时的引用（含文件内部引用），尝试用模糊匹配找到
//        最接近的实际锚点，自动修复（改 #yyy 为正确值）。
//        无法确定时跳过并输出建议。
//
// 退出码:
//   0 = 全部通过（或 --fix 已修复全部）
//   1 = 有锚点过时 / 文件断链（未用 --fix 或 --fix 无法确定正确锚点）
//
// GitHub 锚点归一化规则（v1.5.1 F5 重写 · 对齐 github-slugger@2.0.0）:
//
// 【为什么重写】原实现是**手写的近似规则**，其中「去掉开头/结尾的连字符」一条
//   与 GitHub 真实行为**相反**。github-slugger README 的官方示例：
//       slugger.slug('😄 emoji') // returns '-emoji'
//   即 emoji 被删除后其**右侧空格仍变连字符**，前导 `-` 必须保留。
//   原实现把它 trim 掉 ⇒ **假红/假绿双错**：GitHub 上能跳的 `#-emoji` 被判断链，
//   而 GitHub 上跳不到的 `#emoji` 反而判通过。
//   旁证：FORGE/lessons/driver.md:273 的引用写作 `#-降级判定一票否决误伤`，
//   对应标题在同文件 L170（`#### 🔴 降级判定一票否决误伤`）——该目录写在 GitHub
//   真实行为一侧（带前导 `-`），且因长期在扫描面之外，从未被这个错误规则「纠正」过。
//
// 【规则来源】**不再手写**，逐字内联 github-slugger@2.0.0 的官方实现
//   （npm: github-slugger · ISC · repo Flet/github-slugger）：
//       slug(value) = value.toLowerCase().replace(regex, '').replace(/ /g, '-')
//   该包**未** vendored 进本仓（含 node_modules 全仓 grep「github-slugger」零命中，
//   也非本仓依赖）⇒ 只能内联，故在此标注出处与版本，便于日后升级比对。
//   ⚠️ 其中 regex 由该包 script/ 依 Unicode 13.0.0 生成，**与 \p{L}\p{N} 不等价**
//      （Unicode 13 之后新增字符的处置不同）⇒ 必须逐字内联，**不得用 \p{...} 近似重写**，
//      否则又造出第二套规则（本条目验收明确禁止）。
//
// 【同名去重】github-slugger 的 GithubSlugger 类对**同一文档内重复的标题**
//   依次追加 `-1` / `-2`（GitHub 行为）。本脚本此前用 Set，无此语义
//   ⇒ 指向 `#x-1` 的合法引用会被判假红。现按 GitHub 行为逐文件重建计数
//   （见 extractAnchors）。
//
// 【本脚本仍做的两处 Markdown 层归一】——属**渲染前**处理，不是 slug 规则：
//   ① 去行内代码反引号、保留内容（GitHub 的 slug 输入是标题**渲染后**的纯文本）；
//   ② 标题行 trim（GitHub 块级解析阶段已吃掉尾随空白，不让其成为尾部连字符）。
//
// 扫描面口径（v1.5.1 F5：硬编码三目录白名单 → 全仓递归 + 排除表）:
//   扫描面 = 全仓 .md − 有意排除（EXCLUDE_PATTERNS，每条带排除理由且逐条报命中数）
//   「全仓」= PROJECT_ROOT 下全部 .md，仅**结构性**剪掉 node_modules / .git
//   （非文档产出，且数量级会淹没口径；故不计入「有意排除」）。
//   脚本输出「扫描面 N / 全仓 M（有意排除 K）」——三数都不可省略：
//   原实现只印「扫描 88 个」，88 与仓内数百个 .md 的差额无法解释，
//   属「计数不可自解释」形态的空转。
// ============================================================

import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');
const FIX_MODE = process.argv.includes('--fix');

// 有意排除的目录（非文档产出 / 历史冻结）——**每条附排除理由**，
// 输出行会逐条打印实际命中数（清单条数须等于实测命中数，不得留死条目）。
// 判据用**带首尾斜杠的规范路径**（`/` + rel + `/`）：目录名出现在任意层级都能命中，
// **包括顶层**。此前只 walk 子目录，顶层 .git / node_modules 靠 fullPath 兜住；
// 改为根递归后必须用这个写法，否则会递归进 .git（顶层 rel 恰为 ".git"，
// 匹配不上 /[\/]\.git[\/]/）。
const EXCLUDE_PATTERNS = [
  { re: /\/dist\//, reason: 'dist（构建产物，非源文档）' },
  { re: /\/archive\//, reason: 'archive（历史冻结文档）' },
  { re: /\/changelog\//, reason: 'changelog（发版日志，锚点随版本冻结）' },
  { re: /\/cases\//, reason: 'cases（案例留痕数据）' },
  { re: /\/anti-cases\//, reason: 'anti-cases（反例留痕数据）' },
  { re: /\/benchmark\//, reason: 'benchmark（基准测试数据）' },
];

// 结构性剪枝：非文档产出，且数量级会淹没口径。
// 与 EXCLUDE_PATTERNS 的区别：这些**不算「有意排除」**，不进排除计数。
const STRUCTURAL_SKIP_NAMES = new Set(['node_modules', '.git']);

/** 把仓内相对路径规范成 `/a/b/c/` 形式，供排除判据使用。 */
function normalizeRelForMatch(rel) {
  return '/' + rel.split(path.sep).join('/') + '/';
}

/** 命中则返回该条目的排除理由，未命中返回 null。 */
function matchExclusion(rel) {
  const norm = normalizeRelForMatch(rel);
  for (const { re, reason } of EXCLUDE_PATTERNS) {
    if (re.test(norm)) return reason;
  }
  return null;
}

// ── GitHub 锚点归一化 ──────────────────────────────────────

// ── github-slugger@2.0.0 官方实现（逐字内联 · 出处见文件头「规则来源」）──────
//   来源：npm github-slugger@2.0.0 · package/regex.js + package/index.js · ISC
//   ⚠️ 该正则依 Unicode 13.0.0 生成，**不得**用 \p{...} 近似替换（会造出第二套规则）。
const GITHUB_SLUGGER_REGEX = /[\0-\x1F!-,\.\/:-@\[-\^`\{-\xA9\xAB-\xB4\xB6-\xB9\xBB-\xBF\xD7\xF7\u02C2-\u02C5\u02D2-\u02DF\u02E5-\u02EB\u02ED\u02EF-\u02FF\u0375\u0378\u0379\u037E\u0380-\u0385\u0387\u038B\u038D\u03A2\u03F6\u0482\u0530\u0557\u0558\u055A-\u055F\u0589-\u0590\u05BE\u05C0\u05C3\u05C6\u05C8-\u05CF\u05EB-\u05EE\u05F3-\u060F\u061B-\u061F\u066A-\u066D\u06D4\u06DD\u06DE\u06E9\u06FD\u06FE\u0700-\u070F\u074B\u074C\u07B2-\u07BF\u07F6-\u07F9\u07FB\u07FC\u07FE\u07FF\u082E-\u083F\u085C-\u085F\u086B-\u089F\u08B5\u08C8-\u08D2\u08E2\u0964\u0965\u0970\u0984\u098D\u098E\u0991\u0992\u09A9\u09B1\u09B3-\u09B5\u09BA\u09BB\u09C5\u09C6\u09C9\u09CA\u09CF-\u09D6\u09D8-\u09DB\u09DE\u09E4\u09E5\u09F2-\u09FB\u09FD\u09FF\u0A00\u0A04\u0A0B-\u0A0E\u0A11\u0A12\u0A29\u0A31\u0A34\u0A37\u0A3A\u0A3B\u0A3D\u0A43-\u0A46\u0A49\u0A4A\u0A4E-\u0A50\u0A52-\u0A58\u0A5D\u0A5F-\u0A65\u0A76-\u0A80\u0A84\u0A8E\u0A92\u0AA9\u0AB1\u0AB4\u0ABA\u0ABB\u0AC6\u0ACA\u0ACE\u0ACF\u0AD1-\u0ADF\u0AE4\u0AE5\u0AF0-\u0AF8\u0B00\u0B04\u0B0D\u0B0E\u0B11\u0B12\u0B29\u0B31\u0B34\u0B3A\u0B3B\u0B45\u0B46\u0B49\u0B4A\u0B4E-\u0B54\u0B58-\u0B5B\u0B5E\u0B64\u0B65\u0B70\u0B72-\u0B81\u0B84\u0B8B-\u0B8D\u0B91\u0B96-\u0B98\u0B9B\u0B9D\u0BA0-\u0BA2\u0BA5-\u0BA7\u0BAB-\u0BAD\u0BBA-\u0BBD\u0BC3-\u0BC5\u0BC9\u0BCE\u0BCF\u0BD1-\u0BD6\u0BD8-\u0BE5\u0BF0-\u0BFF\u0C0D\u0C11\u0C29\u0C3A-\u0C3C\u0C45\u0C49\u0C4E-\u0C54\u0C57\u0C5B-\u0C5F\u0C64\u0C65\u0C70-\u0C7F\u0C84\u0C8D\u0C91\u0CA9\u0CB4\u0CBA\u0CBB\u0CC5\u0CC9\u0CCE-\u0CD4\u0CD7-\u0CDD\u0CDF\u0CE4\u0CE5\u0CF0\u0CF3-\u0CFF\u0D0D\u0D11\u0D45\u0D49\u0D4F-\u0D53\u0D58-\u0D5E\u0D64\u0D65\u0D70-\u0D79\u0D80\u0D84\u0D97-\u0D99\u0DB2\u0DBC\u0DBE\u0DBF\u0DC7-\u0DC9\u0DCB-\u0DCE\u0DD5\u0DD7\u0DE0-\u0DE5\u0DF0\u0DF1\u0DF4-\u0E00\u0E3B-\u0E3F\u0E4F\u0E5A-\u0E80\u0E83\u0E85\u0E8B\u0EA4\u0EA6\u0EBE\u0EBF\u0EC5\u0EC7\u0ECE\u0ECF\u0EDA\u0EDB\u0EE0-\u0EFF\u0F01-\u0F17\u0F1A-\u0F1F\u0F2A-\u0F34\u0F36\u0F38\u0F3A-\u0F3D\u0F48\u0F6D-\u0F70\u0F85\u0F98\u0FBD-\u0FC5\u0FC7-\u0FFF\u104A-\u104F\u109E\u109F\u10C6\u10C8-\u10CC\u10CE\u10CF\u10FB\u1249\u124E\u124F\u1257\u1259\u125E\u125F\u1289\u128E\u128F\u12B1\u12B6\u12B7\u12BF\u12C1\u12C6\u12C7\u12D7\u1311\u1316\u1317\u135B\u135C\u1360-\u137F\u1390-\u139F\u13F6\u13F7\u13FE-\u1400\u166D\u166E\u1680\u169B-\u169F\u16EB-\u16ED\u16F9-\u16FF\u170D\u1715-\u171F\u1735-\u173F\u1754-\u175F\u176D\u1771\u1774-\u177F\u17D4-\u17D6\u17D8-\u17DB\u17DE\u17DF\u17EA-\u180A\u180E\u180F\u181A-\u181F\u1879-\u187F\u18AB-\u18AF\u18F6-\u18FF\u191F\u192C-\u192F\u193C-\u1945\u196E\u196F\u1975-\u197F\u19AC-\u19AF\u19CA-\u19CF\u19DA-\u19FF\u1A1C-\u1A1F\u1A5F\u1A7D\u1A7E\u1A8A-\u1A8F\u1A9A-\u1AA6\u1AA8-\u1AAF\u1AC1-\u1AFF\u1B4C-\u1B4F\u1B5A-\u1B6A\u1B74-\u1B7F\u1BF4-\u1BFF\u1C38-\u1C3F\u1C4A-\u1C4C\u1C7E\u1C7F\u1C89-\u1C8F\u1CBB\u1CBC\u1CC0-\u1CCF\u1CD3\u1CFB-\u1CFF\u1DFA\u1F16\u1F17\u1F1E\u1F1F\u1F46\u1F47\u1F4E\u1F4F\u1F58\u1F5A\u1F5C\u1F5E\u1F7E\u1F7F\u1FB5\u1FBD\u1FBF-\u1FC1\u1FC5\u1FCD-\u1FCF\u1FD4\u1FD5\u1FDC-\u1FDF\u1FED-\u1FF1\u1FF5\u1FFD-\u203E\u2041-\u2053\u2055-\u2070\u2072-\u207E\u2080-\u208F\u209D-\u20CF\u20F1-\u2101\u2103-\u2106\u2108\u2109\u2114\u2116-\u2118\u211E-\u2123\u2125\u2127\u2129\u212E\u213A\u213B\u2140-\u2144\u214A-\u214D\u214F-\u215F\u2189-\u24B5\u24EA-\u2BFF\u2C2F\u2C5F\u2CE5-\u2CEA\u2CF4-\u2CFF\u2D26\u2D28-\u2D2C\u2D2E\u2D2F\u2D68-\u2D6E\u2D70-\u2D7E\u2D97-\u2D9F\u2DA7\u2DAF\u2DB7\u2DBF\u2DC7\u2DCF\u2DD7\u2DDF\u2E00-\u2E2E\u2E30-\u3004\u3008-\u3020\u3030\u3036\u3037\u303D-\u3040\u3097\u3098\u309B\u309C\u30A0\u30FB\u3100-\u3104\u3130\u318F-\u319F\u31C0-\u31EF\u3200-\u33FF\u4DC0-\u4DFF\u9FFD-\u9FFF\uA48D-\uA4CF\uA4FE\uA4FF\uA60D-\uA60F\uA62C-\uA63F\uA673\uA67E\uA6F2-\uA716\uA720\uA721\uA789\uA78A\uA7C0\uA7C1\uA7CB-\uA7F4\uA828-\uA82B\uA82D-\uA83F\uA874-\uA87F\uA8C6-\uA8CF\uA8DA-\uA8DF\uA8F8-\uA8FA\uA8FC\uA92E\uA92F\uA954-\uA95F\uA97D-\uA97F\uA9C1-\uA9CE\uA9DA-\uA9DF\uA9FF\uAA37-\uAA3F\uAA4E\uAA4F\uAA5A-\uAA5F\uAA77-\uAA79\uAAC3-\uAADA\uAADE\uAADF\uAAF0\uAAF1\uAAF7-\uAB00\uAB07\uAB08\uAB0F\uAB10\uAB17-\uAB1F\uAB27\uAB2F\uAB5B\uAB6A-\uAB6F\uABEB\uABEE\uABEF\uABFA-\uABFF\uD7A4-\uD7AF\uD7C7-\uD7CA\uD7FC-\uD7FF\uE000-\uF8FF\uFA6E\uFA6F\uFADA-\uFAFF\uFB07-\uFB12\uFB18-\uFB1C\uFB29\uFB37\uFB3D\uFB3F\uFB42\uFB45\uFBB2-\uFBD2\uFD3E-\uFD4F\uFD90\uFD91\uFDC8-\uFDEF\uFDFC-\uFDFF\uFE10-\uFE1F\uFE30-\uFE32\uFE35-\uFE4C\uFE50-\uFE6F\uFE75\uFEFD-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF3E\uFF40\uFF5B-\uFF65\uFFBF-\uFFC1\uFFC8\uFFC9\uFFD0\uFFD1\uFFD8\uFFD9\uFFDD-\uFFFF]|\uD800[\uDC0C\uDC27\uDC3B\uDC3E\uDC4E\uDC4F\uDC5E-\uDC7F\uDCFB-\uDD3F\uDD75-\uDDFC\uDDFE-\uDE7F\uDE9D-\uDE9F\uDED1-\uDEDF\uDEE1-\uDEFF\uDF20-\uDF2C\uDF4B-\uDF4F\uDF7B-\uDF7F\uDF9E\uDF9F\uDFC4-\uDFC7\uDFD0\uDFD6-\uDFFF]|\uD801[\uDC9E\uDC9F\uDCAA-\uDCAF\uDCD4-\uDCD7\uDCFC-\uDCFF\uDD28-\uDD2F\uDD64-\uDDFF\uDF37-\uDF3F\uDF56-\uDF5F\uDF68-\uDFFF]|\uD802[\uDC06\uDC07\uDC09\uDC36\uDC39-\uDC3B\uDC3D\uDC3E\uDC56-\uDC5F\uDC77-\uDC7F\uDC9F-\uDCDF\uDCF3\uDCF6-\uDCFF\uDD16-\uDD1F\uDD3A-\uDD7F\uDDB8-\uDDBD\uDDC0-\uDDFF\uDE04\uDE07-\uDE0B\uDE14\uDE18\uDE36\uDE37\uDE3B-\uDE3E\uDE40-\uDE5F\uDE7D-\uDE7F\uDE9D-\uDEBF\uDEC8\uDEE7-\uDEFF\uDF36-\uDF3F\uDF56-\uDF5F\uDF73-\uDF7F\uDF92-\uDFFF]|\uD803[\uDC49-\uDC7F\uDCB3-\uDCBF\uDCF3-\uDCFF\uDD28-\uDD2F\uDD3A-\uDE7F\uDEAA\uDEAD-\uDEAF\uDEB2-\uDEFF\uDF1D-\uDF26\uDF28-\uDF2F\uDF51-\uDFAF\uDFC5-\uDFDF\uDFF7-\uDFFF]|\uD804[\uDC47-\uDC65\uDC70-\uDC7E\uDCBB-\uDCCF\uDCE9-\uDCEF\uDCFA-\uDCFF\uDD35\uDD40-\uDD43\uDD48-\uDD4F\uDD74\uDD75\uDD77-\uDD7F\uDDC5-\uDDC8\uDDCD\uDDDB\uDDDD-\uDDFF\uDE12\uDE38-\uDE3D\uDE3F-\uDE7F\uDE87\uDE89\uDE8E\uDE9E\uDEA9-\uDEAF\uDEEB-\uDEEF\uDEFA-\uDEFF\uDF04\uDF0D\uDF0E\uDF11\uDF12\uDF29\uDF31\uDF34\uDF3A\uDF45\uDF46\uDF49\uDF4A\uDF4E\uDF4F\uDF51-\uDF56\uDF58-\uDF5C\uDF64\uDF65\uDF6D-\uDF6F\uDF75-\uDFFF]|\uD805[\uDC4B-\uDC4F\uDC5A-\uDC5D\uDC62-\uDC7F\uDCC6\uDCC8-\uDCCF\uDCDA-\uDD7F\uDDB6\uDDB7\uDDC1-\uDDD7\uDDDE-\uDDFF\uDE41-\uDE43\uDE45-\uDE4F\uDE5A-\uDE7F\uDEB9-\uDEBF\uDECA-\uDEFF\uDF1B\uDF1C\uDF2C-\uDF2F\uDF3A-\uDFFF]|\uD806[\uDC3B-\uDC9F\uDCEA-\uDCFE\uDD07\uDD08\uDD0A\uDD0B\uDD14\uDD17\uDD36\uDD39\uDD3A\uDD44-\uDD4F\uDD5A-\uDD9F\uDDA8\uDDA9\uDDD8\uDDD9\uDDE2\uDDE5-\uDDFF\uDE3F-\uDE46\uDE48-\uDE4F\uDE9A-\uDE9C\uDE9E-\uDEBF\uDEF9-\uDFFF]|\uD807[\uDC09\uDC37\uDC41-\uDC4F\uDC5A-\uDC71\uDC90\uDC91\uDCA8\uDCB7-\uDCFF\uDD07\uDD0A\uDD37-\uDD39\uDD3B\uDD3E\uDD48-\uDD4F\uDD5A-\uDD5F\uDD66\uDD69\uDD8F\uDD92\uDD99-\uDD9F\uDDAA-\uDEDF\uDEF7-\uDFAF\uDFB1-\uDFFF]|\uD808[\uDF9A-\uDFFF]|\uD809[\uDC6F-\uDC7F\uDD44-\uDFFF]|[\uD80A\uD80B\uD80E-\uD810\uD812-\uD819\uD824-\uD82B\uD82D\uD82E\uD830-\uD833\uD837\uD839\uD83D\uD83F\uD87B-\uD87D\uD87F\uD885-\uDB3F\uDB41-\uDBFF][\uDC00-\uDFFF]|\uD80D[\uDC2F-\uDFFF]|\uD811[\uDE47-\uDFFF]|\uD81A[\uDE39-\uDE3F\uDE5F\uDE6A-\uDECF\uDEEE\uDEEF\uDEF5-\uDEFF\uDF37-\uDF3F\uDF44-\uDF4F\uDF5A-\uDF62\uDF78-\uDF7C\uDF90-\uDFFF]|\uD81B[\uDC00-\uDE3F\uDE80-\uDEFF\uDF4B-\uDF4E\uDF88-\uDF8E\uDFA0-\uDFDF\uDFE2\uDFE5-\uDFEF\uDFF2-\uDFFF]|\uD821[\uDFF8-\uDFFF]|\uD823[\uDCD6-\uDCFF\uDD09-\uDFFF]|\uD82C[\uDD1F-\uDD4F\uDD53-\uDD63\uDD68-\uDD6F\uDEFC-\uDFFF]|\uD82F[\uDC6B-\uDC6F\uDC7D-\uDC7F\uDC89-\uDC8F\uDC9A-\uDC9C\uDC9F-\uDFFF]|\uD834[\uDC00-\uDD64\uDD6A-\uDD6C\uDD73-\uDD7A\uDD83\uDD84\uDD8C-\uDDA9\uDDAE-\uDE41\uDE45-\uDFFF]|\uD835[\uDC55\uDC9D\uDCA0\uDCA1\uDCA3\uDCA4\uDCA7\uDCA8\uDCAD\uDCBA\uDCBC\uDCC4\uDD06\uDD0B\uDD0C\uDD15\uDD1D\uDD3A\uDD3F\uDD45\uDD47-\uDD49\uDD51\uDEA6\uDEA7\uDEC1\uDEDB\uDEFB\uDF15\uDF35\uDF4F\uDF6F\uDF89\uDFA9\uDFC3\uDFCC\uDFCD]|\uD836[\uDC00-\uDDFF\uDE37-\uDE3A\uDE6D-\uDE74\uDE76-\uDE83\uDE85-\uDE9A\uDEA0\uDEB0-\uDFFF]|\uD838[\uDC07\uDC19\uDC1A\uDC22\uDC25\uDC2B-\uDCFF\uDD2D-\uDD2F\uDD3E\uDD3F\uDD4A-\uDD4D\uDD4F-\uDEBF\uDEFA-\uDFFF]|\uD83A[\uDCC5-\uDCCF\uDCD7-\uDCFF\uDD4C-\uDD4F\uDD5A-\uDFFF]|\uD83B[\uDC00-\uDDFF\uDE04\uDE20\uDE23\uDE25\uDE26\uDE28\uDE33\uDE38\uDE3A\uDE3C-\uDE41\uDE43-\uDE46\uDE48\uDE4A\uDE4C\uDE50\uDE53\uDE55\uDE56\uDE58\uDE5A\uDE5C\uDE5E\uDE60\uDE63\uDE65\uDE66\uDE6B\uDE73\uDE78\uDE7D\uDE7F\uDE8A\uDE9C-\uDEA0\uDEA4\uDEAA\uDEBC-\uDFFF]|\uD83C[\uDC00-\uDD2F\uDD4A-\uDD4F\uDD6A-\uDD6F\uDD8A-\uDFFF]|\uD83E[\uDC00-\uDFEF\uDFFA-\uDFFF]|\uD869[\uDEDE-\uDEFF]|\uD86D[\uDF35-\uDF3F]|\uD86E[\uDC1E\uDC1F]|\uD873[\uDEA2-\uDEAF]|\uD87A[\uDFE1-\uDFFF]|\uD87E[\uDE1E-\uDFFF]|\uD884[\uDF4B-\uDFFF]|\uDB40[\uDC00-\uDCFF\uDDF0-\uDFFF]/g;

/** 无状态版：对齐 github-slugger 导出的 slug()。 */
function githubSlug(value) {
  if (typeof value !== 'string') return '';
  return value.toLowerCase().replace(GITHUB_SLUGGER_REGEX, '').replace(/ /g, '-');
}

/** 有状态版：对齐 github-slugger 的 GithubSlugger 类（同文档同名标题追加 -1/-2）。 */
class GithubSlugger {
  constructor() {
    this.reset();
  }

  reset() {
    this.occurrences = Object.create(null);
  }

  slug(value) {
    let result = githubSlug(value);
    const originalSlug = result;
    while (Object.prototype.hasOwnProperty.call(this.occurrences, result)) {
      this.occurrences[originalSlug]++;
      result = originalSlug + '-' + this.occurrences[originalSlug];
    }
    this.occurrences[result] = 0;
    return result;
  }
}

/**
 * 生成标题在 GitHub 上的锚点。
 * @param {string} title 标题文本（不含前导 #）
 * @param {GithubSlugger} [slugger] 传入则按「同文档去重」语义返回唯一锚点
 * @returns {string} 锚点（不含 # 前缀）
 *
 * v1.5.1 F5 实测确认（防后人误报「已修」）：
 *   - 「🧪 工程可信度」→ emoji 删除后其右侧空格成 `-` ⇒ 锚点 `-工程可信度`
 *     （原实现 trim 成 `工程可信度`，与 GitHub 相反）；
 *   - 「审计 + 文件」→ `+` 删除留两空格 ⇒ `审计--文件`（双连字符保留，不折叠）；
 *   - `STEP_RECURSION_LIMITS` ⇒ `step_recursion_limits`（下划线保留）。
 */
function githubAnchor(title, slugger) {
  // ① 行内代码去反引号保留内容；② 标题行 trim——两者都是「渲染前」归一，
  //    GitHub 的 slug 输入本就是标题渲染后的纯文本（详见文件头说明）。
  const plain = title
    .replace(/^#+\s*/, '')
    .replace(/`([^`]*)`/g, '$1')
    .trim();
  return slugger ? slugger.slug(plain) : githubSlug(plain);
}

// ── 文件收集 ────────────────────────────────────────────────

/**
 * 收集待校验的 .md 文件，并统计「扫描面 / 全仓 / 有意排除」三个数。
 *
 * v1.5.1 F5：扫描面由「硬编码三目录白名单 `['docs','FDE','SKILL']`」改为
 *   **全仓递归 + 排除表**——消除人工维护的清单（与 F7「用结构性判据替代清单」同源）。
 *   旧口径实测只覆盖 88 个 .md，从未被纳入考虑的结构性漏检目录包括
 *   FORGE/ · playbook/ · engine/ · tools/ · .github/，其中含**本审查方法论自身**
 *   （playbook/fresh-eyes-review.md）与 FORGE/SKILL/ 的内部循环协议——
 *   门禁从不检查它自己的方法论文档。
 *
 * @returns {{files: string[], total: number, excluded: number, excludedByReason: Map<string, number>}}
 *   files = 扫描面绝对路径；total = 全仓 .md 数；excluded = 有意排除数；
 *   excludedByReason = 逐条排除理由 → 命中数（清单条数须等于实测命中数）
 */
function collectMarkdownFiles() {
  const files = [];
  let total = 0;
  let excluded = 0;
  const excludedByReason = new Map();

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      // 结构性剪枝：不算「有意排除」，不计入 excluded
      if (entry.isDirectory() && STRUCTURAL_SKIP_NAMES.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.name.endsWith('.md')) continue;

      total++;
      const rel = path.relative(PROJECT_ROOT, fullPath);
      const reason = matchExclusion(rel);
      if (reason) {
        excluded++;
        excludedByReason.set(reason, (excludedByReason.get(reason) || 0) + 1);
      } else {
        files.push(fullPath);
      }
    }
  }

  walk(PROJECT_ROOT);
  return { files, total, excluded, excludedByReason };
}

// ── 锚点表构建 ──────────────────────────────────────────────

/**
 * 判断每一行是否处于围栏代码块（``` 或 ~~~）内部。
 * 代码块内的标题/链接不是真实 Markdown 结构，需整体跳过。
 * @param {string[]} lines 按行拆分的内容
 * @returns {boolean[]} 与 lines 等长，true 表示该行在代码块内（含围栏行）
 */
function computeCodeBlockMask(lines) {
  const mask = new Array(lines.length).fill(false);
  let inFence = false;
  let fenceMarker = '';

  for (let i = 0; i < lines.length; i++) {
    const fence = lines[i].match(/^\s*(```+|~~~+)/);
    if (fence) {
      if (!inFence) {
        // 进入代码块（记录围栏符类型，``` 与 ~~~ 各自配对）
        inFence = true;
        fenceMarker = fence[1][0];
        mask[i] = true;
      } else if (fence[1][0] === fenceMarker) {
        // 同类型围栏闭合，退出代码块
        inFence = false;
        fenceMarker = '';
        mask[i] = true;
      } else {
        // 代码块内部出现的异类围栏仍视为普通内容
        mask[i] = true;
      }
      continue;
    }
    mask[i] = inFence;
  }

  return mask;
}

/**
 * 从文件内容提取所有标题，生成锚点表。
 * 跳过围栏代码块内的行（代码块里的 # 开头行不是真实标题）。
 * @param {string} content 文件内容
 * @returns {Set<string>} 锚点集合（不含 # 前缀）
 */
function extractAnchors(content) {
  const anchors = new Set();
  const lines = content.split('\n');
  const mask = computeCodeBlockMask(lines);
  // 每个文件一个 slugger 实例 = GitHub 的「同文档去重」语义
  const slugger = new GithubSlugger();

  for (let i = 0; i < lines.length; i++) {
    if (mask[i]) continue;
    // 匹配 ATX 标题：# 到 ######
    const match = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const title = match[2];
      const anchor = githubAnchor(title, slugger);
      if (anchor) {
        anchors.add(anchor);
      }
    }
  }

  return anchors;
}

// ── 引用提取 ────────────────────────────────────────────────

// 模板占位符白名单（与 check-docs.sh 1b 同口径）：版本未定时的规划占位，
// 不视为断链。http(s) 协议链接本脚本不校验（只管仓内文件）。
function isPlaceholderPath(p) {
  return /\/vX\.Y/.test(p) || /vX\.Y\.Z/.test(p) || /vX\.Y\.md/.test(p);
}

/**
 * 从文件内容提取所有 .md 锚点引用（跳过围栏代码块内容）。
 * @param {string} content
 * @param {string} filePath 当前文件路径（用于解析相对路径）
 * @returns {{targetFile: string, targetRef: string, anchor: string, fullMatch: string, lineNum: number}[]}
 */
function extractAnchorRefs(content, filePath) {
  const refs = [];
  const lines = content.split('\n');
  const dir = path.dirname(filePath);
  const mask = computeCodeBlockMask(lines);

  // 匹配 ](xxx.md#yyy) 或 ](xxx.md#yyy "title")
  // 不匹配纯文件链接 ](xxx.md)
  // 不匹配 http 链接
  const refRegex = /\]\(([^)#\s]+\.md)#([^)\s]+)\)/g;

  for (let i = 0; i < lines.length; i++) {
    if (mask[i]) continue; // 跳过代码块内的内容
    let match;
    const line = lines[i];
    refRegex.lastIndex = 0;
    while ((match = refRegex.exec(line)) !== null) {
      const targetFile = path.resolve(dir, match[1]);
      const anchor = decodeURIComponent(match[2].split(/\s/)[0]);
      refs.push({
        targetFile,
        targetRef: match[1],
        anchor,
        fullMatch: match[0],
        lineNum: i + 1,
        line: line.trim(),
      });
    }
  }

  return refs;
}

/**
 * 从文件内容提取文件内部目录锚点引用（](#锚点)），
 * 排除空锚点 ](#) 与围栏代码块内的内容。
 * @param {string} content
 * @returns {{anchor: string, lineNum: number, line: string}[]}
 */
function extractInternalAnchorRefs(content) {
  const refs = [];
  const lines = content.split('\n');
  const mask = computeCodeBlockMask(lines);

  // 匹配 ](#yyy)（yyy 非空即排除空锚点 ](#)）
  const internalRegex = /\]\(#([^)\s]+)\)/g;

  for (let i = 0; i < lines.length; i++) {
    if (mask[i]) continue; // 跳过代码块内的内容
    let match;
    const line = lines[i];
    internalRegex.lastIndex = 0;
    while ((match = internalRegex.exec(line)) !== null) {
      const anchor = decodeURIComponent(match[1]);
      if (!anchor) continue; // 空锚点兜底跳过
      refs.push({
        anchor,
        lineNum: i + 1,
        line: line.trim(),
      });
    }
  }

  return refs;
}

// ── 模糊匹配（用于 --fix 建议正确锚点）──────────────────────

/**
 * 在锚点表中找到与给定字符串最接近的锚点。
 * 用简单的包含关系 + 编辑距离判断。
 * @param {string} badAnchor 过时的锚点
 * @param {Set<string>} validAnchors 实际锚点表
 * @returns {string|null} 最匹配的锚点，或 null（无匹配）
 */
function fuzzyMatch(badAnchor, validAnchors) {
  const valid = [...validAnchors];

  // 1. 精确匹配
  if (valid.includes(badAnchor)) return badAnchor;

  // 2. badAnchor 是某 valid 的子串（锚点被截断）
  const substringMatches = valid.filter(v => v.includes(badAnchor) && v.length < badAnchor.length + 20);
  if (substringMatches.length === 1) return substringMatches[0];

  // 3. 某 valid 是 badAnchor 的子串（锚点变短了）
  const superMatches = valid.filter(v => badAnchor.includes(v) && badAnchor.length < v.length + 20);
  if (superMatches.length === 1) return superMatches[0];

  // 4. 编辑距离最小（容错：标题改了几个字）
  let bestMatch = null;
  let bestScore = Infinity;
  for (const v of valid) {
    // 只比较长度相近的（差太多不可能是同一个）
    if (Math.abs(v.length - badAnchor.length) > Math.max(10, badAnchor.length * 0.5)) continue;
    const dist = levenshtein(badAnchor, v);
    const score = dist / Math.max(v.length, badAnchor.length);
    if (score < bestScore && score < 0.3) {  // 相似度 > 70%
      bestScore = score;
      bestMatch = v;
    }
  }
  return bestMatch;
}

/**
 * 简单 Levenshtein 距离。
 */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array(n + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,         // deletion
        dp[j - 1] + 1,     // insertion
        prev + (a[i - 1] === b[j - 1] ? 0 : 1)  // substitution
      );
      prev = temp;
    }
  }
  return dp[n];
}

// ── 主逻辑 ──────────────────────────────────────────────────

const colors = {
  red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
};

console.log(colors.bold(colors.cyan('═'.repeat(60))));
console.log(colors.bold(colors.cyan('  check-anchors · Markdown 锚点校验（跨文件 + 文件内）')));
console.log(colors.bold(colors.cyan('═'.repeat(60))));
console.log('');

const scan = collectMarkdownFiles();
const files = scan.files;
console.log(`  扫描面 ${files.length} / 全仓 ${scan.total} 个 .md（有意排除 ${scan.excluded}）`);
for (const [reason, n] of [...scan.excludedByReason].sort((a, b) => b[1] - a[1])) {
  console.log(`      · 排除 ${n} 个：${reason}`);
}
console.log('');

// 预构建每个文件的锚点表
const anchorTables = new Map();  // filePath → Set<anchor>
for (const f of files) {
  const content = fs.readFileSync(f, 'utf8');
  anchorTables.set(f, extractAnchors(content));
}
console.log(`  构建锚点表: ${anchorTables.size} 个文件`);
console.log('');

// 收集所有引用并校验
let brokenFiles = 0;     // 文件本身不存在（文件断链）
let staleAnchors = 0;    // 锚点过时（跨文件 + 文件内，同一口径）
let validRefs = 0;
let fixedCount = 0;
const staleReports = [];
const brokenFileReports = [];

for (const f of files) {
  const content = fs.readFileSync(f, 'utf8');
  const relFile = path.relative(PROJECT_ROOT, f);
  const fileLines = content.split('\n');
  let fileDirty = false;

  // ① 跨文件引用 ](xxx.md#锚点)
  const refs = extractAnchorRefs(content, f);
  for (const ref of refs) {
    // 1. 检查目标文件是否存在（占位符白名单豁免；与 check-docs 1b 双保险）
    if (!fs.existsSync(ref.targetFile)) {
      if (!isPlaceholderPath(ref.targetRef)) {
        brokenFiles++;
        brokenFileReports.push({
          sourceFile: relFile,
          sourceLine: ref.lineNum,
          targetRef: ref.targetRef,
          line: ref.line,
        });
      }
      continue;
    }

    const anchors = anchorTables.get(ref.targetFile);
    if (!anchors) {
      // 目标文件在扫描范围外（如外部目录），跳过
      continue;
    }

    // 2. 检查锚点是否存在
    if (anchors.has(ref.anchor)) {
      validRefs++;
      continue;
    }

    // 锚点过时
    staleAnchors++;
    const relTarget = path.relative(PROJECT_ROOT, ref.targetFile);
    staleReports.push({
      sourceFile: relFile,
      sourceLine: ref.lineNum,
      targetFile: relTarget,
      badAnchor: ref.anchor,
      line: ref.line,
    });

    if (FIX_MODE) {
      const suggestion = fuzzyMatch(ref.anchor, anchors);
      if (suggestion) {
        const oldRef = `#${ref.anchor}`;
        const newRef = `#${suggestion}`;
        fileLines[ref.lineNum - 1] = fileLines[ref.lineNum - 1].replace(oldRef, newRef);
        fileDirty = true;
        fixedCount++;
        console.log(colors.green(`  ✓ 修复: ${relFile}:${ref.lineNum}`));
        console.log(colors.green(`    ${oldRef} → ${newRef}`));
        console.log('');
      }
    }
  }

  // ② 文件内部目录引用 ](#锚点)——与跨文件引用同一统计口径
  const ownAnchors = anchorTables.get(f);
  const internalRefs = extractInternalAnchorRefs(content);
  for (const ref of internalRefs) {
    if (ownAnchors.has(ref.anchor)) {
      validRefs++;
      continue;
    }

    // 文件内锚点过时
    staleAnchors++;
    staleReports.push({
      sourceFile: relFile,
      sourceLine: ref.lineNum,
      targetFile: relFile,
      badAnchor: ref.anchor,
      line: ref.line,
    });

    if (FIX_MODE) {
      const suggestion = fuzzyMatch(ref.anchor, ownAnchors);
      if (suggestion) {
        const oldRef = `#${ref.anchor}`;
        const newRef = `#${suggestion}`;
        fileLines[ref.lineNum - 1] = fileLines[ref.lineNum - 1].replace(oldRef, newRef);
        fileDirty = true;
        fixedCount++;
        console.log(colors.green(`  ✓ 修复: ${relFile}:${ref.lineNum}（文件内）`));
        console.log(colors.green(`    ${oldRef} → ${newRef}`));
        console.log('');
      }
    }
  }

  // 该文件有修复 → 一次性写回
  if (fileDirty) {
    fs.writeFileSync(f, fileLines.join('\n'));
  }
}

// 输出报告
if (brokenFileReports.length > 0) {
  console.log(colors.red(`  ✗ 发现 ${brokenFiles} 个文件断链（目标 .md 不存在）`));
  console.log('');
  for (const r of brokenFileReports) {
    console.log(colors.red(`  ✗ ${r.sourceFile}:${r.sourceLine}`));
    console.log(`    引用: ${r.targetRef}`);
    console.log(`    行: ${r.line.substring(0, 100)}`);
    console.log('');
  }
}

if (staleReports.length === 0 && brokenFileReports.length === 0) {
  console.log(colors.green(`  ✓ 全部通过：${validRefs} 个锚点引用全部有效，无文件断链`));
  console.log('');
  console.log(colors.bold(colors.cyan('═'.repeat(60))));
  process.exit(0);
}

if (!FIX_MODE && staleReports.length > 0) {
  console.log(colors.red(`  ✗ 发现 ${staleAnchors} 个锚点过时（文件存在但章节标题已改）`));
  console.log('');
  console.log(colors.yellow('  提示：运行 node tools/check/check-anchors.mjs --fix 自动修复'));
  console.log('');
}

// 逐条输出未修复的
const unfixed = staleReports.length - fixedCount;
if (unfixed > 0) {
  console.log(colors.bold(`── 锚点过时报告（${unfixed > 0 ? unfixed : staleAnchors} 处未修复）──`));
  console.log('');

  for (const r of staleReports) {
    console.log(colors.red(`  ✗ ${r.sourceFile}:${r.sourceLine}`));
    console.log(`    引用: ${r.targetFile}#${r.badAnchor}`);
    console.log(`    行: ${r.line.substring(0, 100)}`);

    // 给出建议
    const targetPath = path.resolve(PROJECT_ROOT, r.targetFile);
    if (fs.existsSync(targetPath)) {
      const anchors = anchorTables.get(targetPath);
      if (anchors) {
        const suggestion = fuzzyMatch(r.badAnchor, anchors);
        if (suggestion) {
          console.log(colors.yellow(`    建议: #${suggestion}`));
        } else {
          // 列出目标文件中最接近的 3 个锚点
          const candidates = [...anchors]
            .map(a => ({ a, score: levenshtein(r.badAnchor, a) }))
            .sort((x, y) => x.score - y.score)
            .slice(0, 3);
          if (candidates.length > 0) {
            console.log(colors.yellow(`    可能是:`));
            for (const c of candidates) {
              console.log(colors.yellow(`      #${c.a}`));
            }
          }
        }
      }
    }
    console.log('');
  }
}

console.log(colors.bold(colors.cyan('═'.repeat(60))));
if (FIX_MODE && fixedCount > 0) {
  console.log(colors.green(`  ✓ 已修复 ${fixedCount}/${staleAnchors} 处`));
}
const remaining = staleAnchors - fixedCount;
if (remaining > 0 || brokenFiles > 0) {
  console.log(colors.red(`  ✗ 剩余 ${remaining} 处锚点过时 + ${brokenFiles} 处文件断链需手动修复`));
  process.exit(1);
} else if (FIX_MODE && fixedCount > 0) {
  console.log(colors.green(`  ✓ 全部修复完成`));
  process.exit(0);
} else {
  process.exit(1);
}
