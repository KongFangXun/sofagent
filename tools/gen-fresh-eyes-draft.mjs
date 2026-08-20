#!/usr/bin/env node
// ============================================================
// tools/gen-fresh-eyes-draft.mjs · fresh-eyes 16 视角审查草稿生成器（单次 LLM）
// v1.3.8 交付八 · 成本重构
// ============================================================
// 用途：fresh-eyes-loop 的「单次草稿优先、driver 兜底」分层第一层——
//   把 16 视角审查做成单次 LLM 调用（无工具循环、一次成型），
//   产出审查草稿供人工/后续 driver 复核。审查是理解型任务为主，
//   定点取证交给复核层，草稿层不需要 24 worker 的探查循环。
//
// 输入（两项，缺哪个跳过哪个并在产物头部标注）：
//   --diff      <path>   git diff 输出（如 git log -p --since=... 的产物）
//   --changelog <path>   changelog 交付清单（docs/changelog/v1.3/v1.3.8.md 或 CHANGELOG.md）
//   --out       <path>   产物路径（默认 ~/Desktop/fresh-eyes-draft-<ver>.md）
//
// LLM 配置（与 gen-abc-draft.mjs 同源）：
//   1. 环境变量 GLM_API_KEY（含 source FORGE/env.local 后）
//   2. --api-key 参数
//   模型/端点照抄 FORGE/models/glm-5.2.mjs（Coding Plan 专用端点）。
//
// 降级路径：无 key / API 失败 → 退出码 2 + 完整 prompt 写到 --out（.prompt.md
//   后缀），人工粘贴给任意 AI session 执行——SOP 不因断网/key 轮换卡死。
//
// 退出码（与 gen-abc-draft.mjs 对齐）：
//   0 = 草稿生成
//   1 = 参数或输入错误（无来源参数 / 来源路径不存在 / 版本号读不出）
//   2 = LLM 不可用（已降级输出 prompt）
// ============================================================

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

// ── GLM-5.2 Coding Plan（与 FORGE/models/glm-5.2.mjs / gen-abc-draft.mjs 同配置）──
const MODEL_CFG = {
  model: 'glm-5.2',
  baseURL: 'https://open.bigmodel.cn/api/coding/paas/v4',
  temperature: 0.5, // 审查草稿要发散发现，比分类任务（0.3）略高、比创意（0.8）低
};

// ── 参数解析 ────────────────────────────────────────────────
const args = process.argv.slice(2);
const opts = {};
for (let i = 0; i < args.length; i++) {
  const k = args[i];
  if (k === '--help' || k === '-h') {
    console.log(`gen-fresh-eyes-draft.mjs — fresh-eyes 16 视角审查草稿生成（单次 LLM）

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

退出码：0=成功 / 1=输入错误 / 2=LLM 不可用（降级输出 prompt 到 <out>.prompt.md）`);
    process.exit(0);
  }
  if (k.startsWith('--')) {
    opts[k.slice(2)] = args[i + 1];
    i++;
  }
}

// ── 当前版本号（与 gen-abc-draft.mjs 同口径）─────────────────
let CUR_VER = '';
try {
  CUR_VER = require(join(REPO_ROOT, 'engine/audit/package.json')).version;
} catch { /* 下面兜底 */ }
if (!CUR_VER) {
  console.error('❌ 无法读取 engine/audit/package.json version');
  process.exit(1);
}

// ── 读来源 ──────────────────────────────────────────────────
const SOURCES = [
  ['diff', opts.diff, 'git diff（本版变更）'],
  ['changelog', opts.changelog, 'changelog 交付清单'],
];
const changelogPath = opts.changelog || join(REPO_ROOT, 'CHANGELOG.md');

const sections = [];
const loaded = [];
const skipped = [];
for (const [key, path, label] of SOURCES) {
  if (!path) { skipped.push(label); continue; }
  if (!existsSync(path)) {
    console.error(`❌ 来源文件不存在: ${path}（${label}）`);
    process.exit(1);
  }
  const text = readFileSync(path, 'utf-8');
  // diff 截断 25k 字符（比 gen-abc-draft 的 15k 宽——patch 是审查主料；
  // 40k 实测 3min 超时，25k + 5min 是 GLM thinking 模式的稳妥窗口）
  const LIMIT = key === 'diff' ? 25000 : 15000;
  const trimmed = text.length > LIMIT
    ? text.slice(0, LIMIT) + `\n…（截断，原文 ${text.length} 字符）`
    : text;
  sections.push(`### 来源：${label}（${path}）\n\n${trimmed}`);
  loaded.push(label);
}
if (sections.length === 0) {
  console.error('❌ 至少提供一个来源（--diff / --changelog）');
  process.exit(1);
}
// --diff 缺省时自动补 CHANGELOG 当前版本行（轻量上下文）
if (!opts.changelog && !loaded.some(l => l.startsWith('changelog')) && existsSync(changelogPath)) {
  const line = readFileSync(changelogPath, 'utf-8')
    .split('\n')
    .find((l) => l.startsWith(`- **v${CUR_VER}**`));
  if (line) {
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

// ── 产物路径 ────────────────────────────────────────────────
const OUT = opts.out || join(homedir(), 'Desktop', `fresh-eyes-draft-v${CUR_VER}.md`);

// ── key 解析（env → 参数，与 gen-abc-draft.mjs 一致）─────────
const apiKey = process.env.GLM_API_KEY || opts['api-key'] || '';

if (!apiKey) {
  writeFileSync(OUT + '.prompt.md',
    `<!-- 降级产物：GLM_API_KEY 未设置——把下面 prompt 粘贴给任意 AI session 执行 -->\n\n` +
    `## System\n\n${SYSTEM_PROMPT}\n\n## User\n\n${USER_PROMPT}\n`, 'utf-8');
  console.error(`⚠️  GLM_API_KEY 未设置 → 降级：prompt 已写入 ${OUT}.prompt.md`);
  console.error('    用法：source FORGE/env.local 后重跑，或把 prompt 粘给任意 AI session');
  process.exit(2);
}

// ── 单次 LLM 调用（原生 fetch，无 SDK 无循环——与 gen-abc-draft.mjs 同体例）────
console.log(`→ 来源 ${loaded.length} 个（${loaded.join('、')}），调用 ${MODEL_CFG.model} 生成 16 视角草稿 …`);

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 300_000); // 5 分钟上限（GLM thinking 模式大输入窗口）

try {
  const res = await fetch(`${MODEL_CFG.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL_CFG.model,
      temperature: MODEL_CFG.temperature,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: USER_PROMPT },
      ],
    }),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content || content.length < 200) {
    throw new Error(`响应过短（${content ? content.length : 0} 字符）——疑似异常响应`);
  }
  // 16 视角完整性校验——缺节即拒收（草稿残缺比没有草稿更危险）
  const missing = PERSPECTIVES_16.filter(p => !content.includes(`视角${p}`));
  if (missing.length > 0) {
    throw new Error(`草稿缺 ${missing.length} 个视角节（${missing.join('、')}）——完整性校验不过`);
  }

  // 产物头部：生成元数据（可追溯）+ LLM 输出
  const header = `<!-- gen-fresh-eyes-draft 产物 · v${CUR_VER} · ${new Date().toISOString()}
     模型：${MODEL_CFG.model}（单次调用，无工具）
     来源：${loaded.join('、')}${skipped.length ? `；跳过：${skipped.join('、')}` : ''}
     分层：单次草稿优先层（v1.3.8 交付八）——「待取证」项需 driver 兜底复核
     ⚠️ 草稿须人工审核——LLM 发现是线索不是结论（fresh-eyes 纪律） -->

`;

  writeFileSync(OUT, header + content + '\n', 'utf-8');
  console.log(`✅ 16 视角草稿已生成：${OUT}（${content.length} 字符）`);
  console.log('   下一步：人工筛「待取证」项 → fresh-eyes-driver 兜底（01-review.md / 04-quality-loop.md 分层 SOP）');
  process.exit(0);
} catch (err) {
  clearTimeout(timeout);
  // API 失败 → 降级输出 prompt（SOP 不卡死）
  writeFileSync(OUT + '.prompt.md',
    `<!-- 降级产物：LLM 调用失败（${err.message}）——把下面 prompt 粘贴给任意 AI session 执行 -->\n\n` +
    `## System\n\n${SYSTEM_PROMPT}\n\n## User\n\n${USER_PROMPT}\n`, 'utf-8');
  console.error(`⚠️  LLM 调用失败（${err.message}）→ 降级：prompt 已写入 ${OUT}.prompt.md`);
  process.exit(2);
}
