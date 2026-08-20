#!/usr/bin/env node
// ============================================================
// tools/gen-fresh-eyes-draft.mjs · fresh-eyes 16 视角审查草稿生成器（单次 LLM）
// v1.3.8 交付八 · 成本重构
// ============================================================
// 用途：fresh-eyes-loop 的「单次草稿优先、driver 兜底」分层第一层——
//   把 16 视角审查做成单次 LLM 调用（无工具循环、一次成型），
//   产出审查草稿供人工/后续 driver 复核。
//
// 本文件只保留差异面：来源参数定义 + 16 视角 prompt 模板 + 完整性校验；
//   公共能力（模型配置/参数解析/版本号/降级/LLM 调用）在 tools/lib/gen-draft-lib.mjs。
//
// 输入（两项，缺哪个跳过哪个并在产物头部标注）：
//   --diff      <path>   git diff 输出（如 git log -p --since=... 的产物）
//   --changelog <path>   changelog 交付清单（docs/changelog/v1.3/v1.3.8.md 或 CHANGELOG.md）
//   --out       <path>   产物路径（默认 ~/Desktop/fresh-eyes-draft-<ver>.md）
//
// 退出码：0=草稿生成 / 1=参数或输入错误 / 2=LLM 不可用（已降级输出 prompt）
// ============================================================

import { join } from 'node:path';
import {
  REPO_ROOT, loadModelConfig, parseArgs, resolveVersion,
  resolveApiKey, writeDegraded, loadSources, readChangelogLine,
  callLLM, writeOutput, defaultOut,
} from './gen-draft-lib.mjs';

// 审查草稿要发散发现：比分类任务（0.3）略高、比创意（0.8）低
const MODEL_CFG = loadModelConfig({ temperature: 0.5 });

const HELP = `gen-fresh-eyes-draft.mjs — fresh-eyes 16 视角审查草稿生成（单次 LLM）

用法：node tools/gen-fresh-eyes-draft.mjs --diff <p> [--changelog <p>] [--out <p>]

来源参数（--diff / --changelog 至少一个）：
  --diff      <path>  git diff 输出（本版变更的完整 patch）
  --changelog <path>  changelog 交付清单（缺省自动读 ./CHANGELOG.md 当前版本行）

其他：
  --out      <path>   产物路径（默认 ~/Desktop/fresh-eyes-draft-<ver>.md）
  --api-key  <key>    显式传 key（缺省读 GLM_API_KEY 环境变量）

分层说明（v1.3.8 交付八）：
  本工具是「单次草稿优先」层——16 视角草稿一次成型（省 24 worker 的探查循环）；
  草稿经人工筛出可疑项后，需要定点取证的项再交 fresh-eyes-driver 兜底复核。
  完整 SOP 见 docs/changelog/releasing/01-review.md / 04-quality-loop.md。

退出码：0=成功 / 1=输入错误 / 2=LLM 不可用（降级输出 prompt 到 <out>.prompt.md）`;

const opts = parseArgs(process.argv.slice(2), HELP);
const CUR_VER = resolveVersion();

// ── 读来源（本工具差异面：diff 是审查主料，25k 截断比分类的 15k 宽）──
const { sections, loaded, skipped } = loadSources([
  ['diff', opts.diff, 'git diff（本版变更）', 25000],
  ['changelog', opts.changelog, 'changelog 交付清单', 15000],
]);
if (sections.length === 0) {
  console.error('❌ 至少提供一个来源（--diff / --changelog）');
  process.exit(1);
}
// --changelog 未显式提供时自动补 CHANGELOG 当前版本行（轻量上下文）
if (!opts.changelog) {
  const line = readChangelogLine(join(REPO_ROOT, 'CHANGELOG.md'), CUR_VER);
  if (line && !loaded.some(l => l.startsWith('changelog'))) {
    sections.push(`### 来源：CHANGELOG 当前版本行\n\n${line}`);
    loaded.push('CHANGELOG 版本行');
  }
}

// ── Prompt（16 视角零删减——与 FORGE/playbook/fresh-eyes-review.md 同源）─────
const PERSPECTIVES_16 = [
  '1 陌生人', '2 企业 IT', '3 竞品维护者', '4 npm 用户', '5 开源审查员', '6 用户旅程',
  '7 红队', '8 数字侦探', '9 感知层', '10 文档一致性', '11 代码审读者', '12 文件结构陌生人',
  '13 技术编辑', '14 对外形象分析师', '15 外部开发者通读', '16 资深架构师',
];

const SYSTEM_PROMPT = `你是 sofagent 项目的独立审查员。任务：从 16 个视角对本次变更生成审查草稿，供人工复核与 driver 兜底取证。

16 视角（完整清单，一个不减——详细指引见 FORGE/playbook/fresh-eyes-review.md）：
${PERSPECTIVES_16.map(p => `  视角${p}`).join('\n')}

每个视角的输出要求：
- 以该视角的身份与心态审视「来源」内容（不是全仓库——聚焦本次变更）
- 每视角给出 0-3 条发现（没有就写「无发现+一句理由」，禁止硬凑）
- 每条发现：视角 / 文件或位置 / 问题描述 / 优先级（P0 阻塞 / P1 应修 / P2 建议）+ 证据缺口（需要 driver 定点取证的标注「待取证」）

输出格式（严格遵守）：
# fresh-eyes 审查草稿 v${CUR_VER}（16 视角 · 单次生成）

## 视角1：陌生人
（发现列表或「无发现」）

…（16 个视角逐个成节，顺序固定）…

## 视角16：资深架构师
（发现列表或「无发现」）

## 草稿层局限声明
- 本草稿基于 diff + changelog 文本理解，未跑命令未读全文件——「待取证」项必须经 fresh-eyes-driver 或人工复核后才可当结论

纪律：
- 只基于来源内容审查，不臆造来源里没有的发现
- 发现必须能定位到 diff/changelog 中的具体位置
- 16 视角全部输出（含「无发现」），缺一个视角 = 草稿不完整`;

const USER_PROMPT = `当前版本：v${CUR_VER}
已加载来源：${loaded.join('、')}
${skipped.length ? `（跳过：${skipped.join('、')}——未提供）` : ''}

${sections.join('\n\n---\n\n')}

请按系统指令输出 16 视角审查草稿。`;

// ── 主流程：key → LLM（含 16 视角完整性校验）→ 产物；失败降级 2 ──
const OUT = opts.out || defaultOut('fresh-eyes', CUR_VER);
const apiKey = resolveApiKey({ ...opts, __out: OUT, __modelCfg: MODEL_CFG, __prompts: { system: SYSTEM_PROMPT, user: USER_PROMPT } });

console.log(`→ 来源 ${loaded.length} 个（${loaded.join('、')}），调用 ${MODEL_CFG.model} 生成 16 视角草稿 …`);
try {
  const content = await callLLM(MODEL_CFG, apiKey, SYSTEM_PROMPT, USER_PROMPT);
  // 16 视角完整性校验——缺节即拒收（草稿残缺比没有草稿更危险）
  // v1.3.9 修复：兼容三种模型输出风格——GLM「视角N 名称」/ deepseek「视角N：名称」/ 全角引号包裹。
  // 归一化：剥离引号 + 视角后允许 空格/冒号（半角全角）分隔 + 空白折叠。
  const normalized = content.replace(/[「」『』]/g, '').replace(/\s+/g, ' ');
  const missing = PERSPECTIVES_16.filter(p => {
    // p 形如 '1 陌生人' → 匹配 '视角1 陌生人' / '视角1：陌生人' / '视角1: 陌生人'
    const [num, name] = p.split(' ');
    return !new RegExp(`视角${num}[：:\\s]${name}`).test(normalized);
  });
  if (missing.length > 0) {
    throw new Error(`草稿缺 ${missing.length} 个视角节（${missing.join('、')}）——完整性校验不过`);
  }
  const header = `<!-- gen-fresh-eyes-draft 产物 · v${CUR_VER} · ${new Date().toISOString()}
     模型：${MODEL_CFG.model}（单次调用，无工具）
     来源：${loaded.join('、')}${skipped.length ? `；跳过：${skipped.join('、')}` : ''}
     分层：单次草稿优先层（v1.3.8 交付八）——「待取证」项需 driver 兜底复核
     ⚠️ 草稿须人工审核——LLM 发现是线索不是结论（fresh-eyes 纪律） -->

`;
  writeOutput(OUT, header, content);
  console.log(`✅ 16 视角草稿已生成：${OUT}（${content.length} 字符）`);
  console.log('   下一步：人工筛「待取证」项 → fresh-eyes-driver 兜底（01-review.md / 04-quality-loop.md 分层 SOP）');
  process.exit(0);
} catch (err) {
  writeDegraded(OUT, `LLM 调用失败（${err.message}）`, { system: SYSTEM_PROMPT, user: USER_PROMPT });
  process.exit(2);
}
