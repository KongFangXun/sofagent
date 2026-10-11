#!/usr/bin/env node
// ============================================================
// merge-claude-settings.mjs · install.sh --platform claude 专用（合并写入器）
// ============================================================
// 为什么存在：install.sh 的 claude) 分支曾用 cp 无条件覆盖用户全局
//   ~/.claude/settings.json —— 无备份 / 无合并 / 无存在性检查，用户的
//   自有 hooks 与 permissions 被静默销毁；且被拷内容用 $PWD 拼 hook 路径，
//   在非 sofagent 仓库中每次 Bash 调用都触发指向不存在脚本的 hook（exit 127）。
//
// 本脚本只做「合并」这一件事，零依赖（只用 Node 内置 node:fs / node:path）：
//   1. 读 SOFAGENT_TARGET（不存在则视为 {}），**其余字段原样保留**；
//   2. 从 SOFAGENT_SRC 取 command 含 sofagent-precommit.sh 的 PreToolUse 项，
//      重写其 command 为 bash "<SOFAGENT_HOOK_PATH>"（绝对路径，脱离安装源仓库）；
//   3. TARGET 已有同类项（command 含 sofagent-precommit.sh）→ 幂等跳过，不重复追加；
//   4. 其余字段（用户自有 hooks / permissions 等）一律不动；写回 JSON.stringify(obj, null, 2)。
//
// 用法：
//   SOFAGENT_SRC=<源 settings.json> \
//   SOFAGENT_TARGET=<目标 settings.json> \
//   SOFAGENT_HOOK_PATH=<hook 脚本绝对路径> \
//     node tools/hooks/merge-claude-settings.mjs
//
// 退出码：0 = 合并成功（含幂等跳过）；1 = 环境变量缺失 / 写入失败。
// ============================================================

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const SRC = process.env.SOFAGENT_SRC;
const TARGET = process.env.SOFAGENT_TARGET;
const HOOK_PATH = process.env.SOFAGENT_HOOK_PATH;

/** 本 hook 的标志串——判定「是否已安装」的唯一依据。 */
const HOOK_MARKER = 'sofagent-precommit.sh';

if (!TARGET || !HOOK_PATH) {
  console.error('[merge-claude-settings] 缺少 SOFAGENT_TARGET / SOFAGENT_HOOK_PATH 环境变量');
  process.exit(1);
}

/**
 * 读取并解析 JSON；文件不存在或损坏时返回空对象（调用方已负责备份损坏文件）。
 * @param {string|undefined} p 文件路径
 * @returns {Record<string, unknown>} 解析结果或 {}
 */
function readJson(p) {
  if (!p || !existsSync(p)) return {};
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * 收集一条 PreToolUse 项里出现的所有 command 字符串。
 * 兼容两类形态：新 schema（内层 `hooks: [{type, command}]`）与旧扁平结构（顶层 `command`）。
 * @param {Record<string, unknown>} entry 单个 PreToolUse 项
 * @returns {string[]} 该条目包含的 command 列表
 */
function collectCommands(entry) {
  const out = [];
  if (!entry || typeof entry !== 'object') return out;
  if (typeof entry.command === 'string') out.push(entry.command);
  if (Array.isArray(entry.hooks)) {
    for (const h of entry.hooks) {
      if (h && typeof h.command === 'string') out.push(h.command);
    }
  }
  return out;
}

const src = readJson(SRC);
const target = readJson(TARGET);

// ── 目标结构归一：确保 hooks.PreToolUse 是数组，其余字段不动 ──
const targetHooks = target.hooks && typeof target.hooks === 'object' ? target.hooks : {};
target.hooks = targetHooks;
targetHooks.PreToolUse = Array.isArray(targetHooks.PreToolUse) ? targetHooks.PreToolUse : [];

// ── 幂等：目标已存在指向本 hook 的项则跳过（不重复追加）──
const alreadyPresent = targetHooks.PreToolUse.some((e) =>
  collectCommands(e).some((c) => c.includes(HOOK_MARKER)),
);
if (alreadyPresent) {
  process.exit(0);
}

// ── 从源取 matcher（默认 "Bash"），command 重写为绝对路径形态 ──
const desiredCommand = `bash "${HOOK_PATH}"`;
let matcher = 'Bash';
const srcEntries = ((src.hooks || {}).PreToolUse) || [];
for (const e of srcEntries) {
  if (collectCommands(e).some((c) => c.includes(HOOK_MARKER))) {
    if (typeof e.matcher === 'string' && e.matcher) matcher = e.matcher;
    break;
  }
}

targetHooks.PreToolUse.push({
  matcher,
  hooks: [{ type: 'command', command: desiredCommand }],
});

writeFileSync(TARGET, JSON.stringify(target, null, 2) + '\n');
