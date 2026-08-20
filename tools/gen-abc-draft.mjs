#!/usr/bin/env node
// ============================================================
// gen-abc-draft.mjs · 阶段五 A/B/C 三类清单草稿生成器（单次 LLM）
// ============================================================
// 用途：把阶段五步骤 1「来源提取」的 A/B/C 三分类做成单次 LLM 调用——
//   无工具、无 agent 循环、一次成型（分类是理解型任务不是探查型任务）。
//
// 本文件只保留差异面：来源参数定义 + A/B/C 分类 prompt 模板；
//   公共能力（模型配置/参数解析/版本号/降级/LLM 调用）在 tools/lib/gen-draft-lib.mjs。
//
// 输入（来源，缺哪个跳过哪个并在产物头部标注）：
//   --fresh-eyes <path>   fresh-eyes 报告（findings.md 或终报）
//   --bugfix    <path>    BugFix 清单
//   --features  <path>    新功能交付清单（devlog）
//   --recheck   <path>    复审报告
//   --changelog <path>    CHANGELOG.md（自动取当前版本行）
//   --out       <path>    产物路径（默认 ~/Desktop/abc-draft-<ver>.md）
//
// 退出码：0=草稿生成 / 1=参数或输入错误 / 2=LLM 不可用（已降级输出 prompt）
// ============================================================

import { join } from 'node:path';
import {
  REPO_ROOT, loadModelConfig, parseArgs, resolveVersion,
  resolveApiKey, writeDegraded, loadSources, readChangelogLine,
  callLLM, writeOutput, defaultOut,
} from './lib/gen-draft-lib.mjs';

// 分类任务要稳定不要发散（审查草稿 0.5 / 创意 0.8）
const MODEL_CFG = loadModelConfig({ temperature: 0.3 });

const HELP = `gen-abc-draft.mjs — 阶段五 A/B/C 三类清单草稿生成（单次 LLM）

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

退出码：0=成功 / 1=输入错误 / 2=LLM 不可用（降级输出 prompt 到 <out>.prompt.md）`;

const opts = parseArgs(process.argv.slice(2), HELP);
const CUR_VER = resolveVersion();

// ── 读来源（本工具差异面：4 来源 + 各 15k 截断上限）──────────
const { sections, loaded, skipped } = loadSources([
  ['fresh-eyes', opts['fresh-eyes'], 'fresh-eyes 报告', 15000],
  ['bugfix', opts.bugfix, 'BugFix 清单', 15000],
  ['features', opts.features, '新功能交付清单', 15000],
  ['recheck', opts.recheck, '复审报告', 15000],
]);
if (sections.length === 0) {
  console.error('❌ 至少提供一个来源（--fresh-eyes / --bugfix / --features / --recheck）');
  process.exit(1);
}
// CHANGELOG 当前版本行（轻量补充源）
const changelogLine = readChangelogLine(
  opts.changelog || join(REPO_ROOT, 'CHANGELOG.md'), CUR_VER);
if (changelogLine) {
  sections.push(`### 来源：CHANGELOG 当前版本行\n\n${changelogLine}`);
  loaded.push('CHANGELOG 版本行');
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

// ── 主流程：key → LLM → 产物；任何 LLM 侧失败降级退出 2 ──────
const OUT = opts.out || defaultOut('abc', CUR_VER);
const apiKey = resolveApiKey({ ...opts, __out: OUT, __prompts: { system: SYSTEM_PROMPT, user: USER_PROMPT } });

console.log(`→ 来源 ${loaded.length} 个（${loaded.join('、')}），调用 ${MODEL_CFG.model} …`);
try {
  const content = await callLLM(MODEL_CFG, apiKey, SYSTEM_PROMPT, USER_PROMPT);
  const header = `<!-- gen-abc-draft 产物 · v${CUR_VER} · ${new Date().toISOString()}
     模型：${MODEL_CFG.model}（单次调用，无工具）
     来源：${loaded.join('、')}${skipped.length ? `；跳过：${skipped.join('、')}` : ''}
     ⚠️ 草稿须人工审核后分发——LLM 分类是草稿不是结论（阶段五纪律） -->

`;
  writeOutput(OUT, header, content);
  console.log(`✅ 草稿已生成：${OUT}（${content.length} 字符）`);
  console.log('   下一步：人工审核 → 步骤 2 分发四份文档 → 步骤 3 跑 check-review-system.sh 验零遗漏');
  process.exit(0);
} catch (err) {
  writeDegraded(OUT, `LLM 调用失败（${err.message}）`, { system: SYSTEM_PROMPT, user: USER_PROMPT });
  process.exit(2);
}
