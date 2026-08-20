#!/usr/bin/env node
// ============================================================
// gen-abc-draft.mjs · 阶段五 A/B/C 三类清单草稿生成器（单次 LLM）
// ============================================================
// 用途：把阶段五步骤 1「来源提取」的 A/B/C 三分类做成单次 LLM 调用——
//   无工具、无 agent 循环、一次成型（分类是理解型任务不是探查型任务）。
//
// 输入（5 个来源，缺哪个跳过哪个并在产物头部标注）：
//   --fresh-eyes <path>   fresh-eyes 报告（findings.md 或终报）
//   --bugfix    <path>    BugFix 清单
//   --features  <path>    新功能交付清单（devlog）
//   --recheck   <path>    复审报告
//   --changelog <path>    CHANGELOG.md（自动取当前版本行）
//   --out       <path>    产物路径（默认 ~/Desktop/abc-draft-<ver>.md）
//
// LLM 配置（三层来源，先到先得）：
//   1. 环境变量 GLM_API_KEY（含 source FORGE/env.local 后）
//   2. --api-key 参数
//   模型/端点照抄 FORGE/models/glm-5.2.mjs（Coding Plan 专用端点）。
//
// 降级路径：无 key / API 失败 → 退出码 2 + 把完整 prompt 写到 --out（.prompt.md 后缀），
//   人工粘贴给任意 AI session 执行——SOP 不因断网/key 轮换而卡死。
//
// 退出码：0=草稿生成 / 1=参数或输入错误 / 2=LLM 不可用（已降级输出 prompt）
// ============================================================

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

// ── GLM-5.2 Coding Plan（与 FORGE/models/glm-5.2.mjs 同配置）────
const MODEL_CFG = {
  model: 'glm-5.2',
  baseURL: 'https://open.bigmodel.cn/api/coding/paas/v4',
  // thinking 参数注意：单次分类任务不需要深度推理，关掉 thinking 省 token 提速
  temperature: 0.3, // 分类任务要稳定，不要发散
};

// ── 参数解析 ────────────────────────────────────────────────
const args = process.argv.slice(2);
const opts = {};
for (let i = 0; i < args.length; i++) {
  const k = args[i];
  if (k === '--help' || k === '-h') {
    console.log(`gen-abc-draft.mjs — 阶段五 A/B/C 三类清单草稿生成（单次 LLM）

用法：node tools/gen-abc-draft.mjs --fresh-eyes <p> --bugfix <p> --features <p> [--recheck <p>] [--out <p>]

来源参数（至少一个）：
  --fresh-eyes <path>  fresh-eyes 报告
  --bugfix    <path>   BugFix 清单
  --features  <path>   新功能清单（devlog 交付章）
  --recheck   <path>   复审报告
  --changelog <path>   CHANGELOG（缺省自动读 ./CHANGELOG.md 当前版本行）

其他：
  --out   <path>       产物路径（默认 ~/Desktop/abc-draft-<ver>.md）
  --api-key <key>      显式传 key（缺省读 GLM_API_KEY 环境变量）

退出码：0=成功 / 1=输入错误 / 2=LLM 不可用（降级输出 prompt 到 <out>.prompt.md）`);
    process.exit(0);
  }
  if (k.startsWith('--')) {
    opts[k.slice(2)] = args[i + 1];
    i++;
  }
}

// ── 当前版本号（与 check-review-system.sh 同口径）────────────
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
  ['fresh-eyes', opts['fresh-eyes'], 'fresh-eyes 报告'],
  ['bugfix', opts.bugfix, 'BugFix 清单'],
  ['features', opts.features, '新功能交付清单'],
  ['recheck', opts.recheck, '复审报告'],
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
  // 单来源截断 15k 字符（防 prompt 爆长——分类只需要发现条目，不需要全文；
  // 40k 实测 3min 超时，15k + 5min 是 GLM thinking 模式的稳妥窗口）
  const trimmed = text.length > 15000
    ? text.slice(0, 15000) + `\n…（截断，原文 ${text.length} 字符）`
    : text;
  sections.push(`### 来源：${label}（${path}）\n\n${trimmed}`);
  loaded.push(label);
}
if (sections.length === 0) {
  console.error('❌ 至少提供一个来源（--fresh-eyes / --bugfix / --features / --recheck）');
  process.exit(1);
}
// CHANGELOG 当前版本行（轻量补充源）
if (existsSync(changelogPath)) {
  const line = readFileSync(changelogPath, 'utf-8')
    .split('\n')
    .find((l) => l.startsWith(`- **v${CUR_VER}**`));
  if (line) {
    sections.push(`### 来源：CHANGELOG 当前版本行\n\n${line}`);
    loaded.push('CHANGELOG 版本行');
  }
}

// ── Prompt（分类规则内嵌——阶段五步骤 1 的 A/B/C 语义）─────────
const SYSTEM_PROMPT = `你是 sofagent 项目的审查体系管理员。任务：把下列来源中的发现与交付，分类成 A/B/C 三类清单草稿，供人工审核后分发到四份审查文档。

分类规则（来自 releasing.md 阶段五）：
- A 类【新功能审查面】：本版本新交付带来的、以前不存在的检查需求（每个新功能至少一条）
- B 类【Bug 防回归】：本轮修过的 bug——每个修复一条防复发检查
- C 类【fresh-eyes 校准】：审查方法论的改进（新视角/校准视角/历史教训），归 fresh-eyes-review.md，不加检查项

输出格式（严格遵守）：
# A/B/C 三类清单草稿 v${CUR_VER}

## A 类：新功能审查面
| # | 关键词 | 审查面一句话 | 建议落点 |
|---|--------|-------------|---------|
（每行：关键词用 grep 可命中的短语；落点=checklist/acceptance/check-version 之一）

## B 类：Bug 防回归
| # | Bug 摘要 | 防复发检查 | 建议落点 |
|---|----------|-----------|---------|

## C 类：fresh-eyes 校准
- （每条一行：校准方向 + 一句话理由）

## 无法归类（留给人工）
- （拿不准的条目放这里，说明为什么拿不准）

纪律：
- 只基于来源内容分类，不臆造来源里没有的发现
- 每条必须能定位回来源（括注来源名）
- 新功能 ≥1 条 A 类（零遗漏原则）；不确定是不是新功能的放「无法归类」`;

const USER_PROMPT = `当前版本：v${CUR_VER}
已加载来源：${loaded.join('、')}
${skipped.length ? `（跳过：${skipped.join('、')}——未提供）` : ''}

${sections.join('\n\n---\n\n')}

请按系统指令输出 A/B/C 三类清单草稿。`;

// ── 产物路径 ────────────────────────────────────────────────
const OUT = opts.out || join(homedir(), 'Desktop', `abc-draft-v${CUR_VER}.md`);

// ── key 解析（env → 参数）───────────────────────────────────
const apiKey = process.env.GLM_API_KEY || opts['api-key'] || '';

if (!apiKey) {
  writeFileSync(OUT + '.prompt.md',
    `<!-- 降级产物：GLM_API_KEY 未设置（）——把下面 prompt 粘贴给任意 AI session 执行 -->\n\n` +
    `## System\n\n${SYSTEM_PROMPT}\n\n## User\n\n${USER_PROMPT}\n`, 'utf-8');
  console.error(`⚠️  GLM_API_KEY 未设置 → 降级：prompt 已写入 ${OUT}.prompt.md`);
  console.error('    用法：source FORGE/env.local 后重跑，或把 prompt 粘给任意 AI session');
  process.exit(2);
}

// ── 单次 LLM 调用（原生 fetch，无 SDK 无循环）────────────────
console.log(`→ 来源 ${loaded.length} 个（${loaded.join('、')}），调用 ${MODEL_CFG.model} …`);

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 300_000); // 5 分钟上限（GLM thinking 模式大输入 3min 实测不够）

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

  // 产物头部：生成元数据（可追溯）+ LLM 输出
  const header = `<!-- gen-abc-draft 产物 · v${CUR_VER} · ${new Date().toISOString()}
     模型：${MODEL_CFG.model}（单次调用，无工具）
     来源：${loaded.join('、')}${skipped.length ? `；跳过：${skipped.join('、')}` : ''}
     ⚠️ 草稿须人工审核后分发——LLM 分类是草稿不是结论（阶段五纪律） -->

`;
  writeFileSync(OUT, header + content + '\n', 'utf-8');
  console.log(`✅ 草稿已生成：${OUT}（${content.length} 字符）`);
  console.log('   下一步：人工审核 → 步骤 2 分发四份文档 → 步骤 3 跑 check-review-system.sh 验零遗漏');
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
