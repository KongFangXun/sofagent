#!/usr/bin/env bash
# ============================================================
# check-platform-hooks.sh · 平台 hook 配置 schema 门禁
# ============================================================
# 为什么存在：`.claude/settings.json` 与 `.cursor/hooks.json` 是 sofagent 对外
#   声称「工具调用拦截」的落地配置，但 `tools/check/` 下**无一门禁**校验它们
#   是否符合各自平台的官方 schema（`grep -rn settings.json tools/check/` 零命中）。
#   配置一旦不符 schema，平台读不到 command ⇒ 拦截**静默失效**，而门禁全绿——
#   这是「防线失明却不吭声」。本门禁把两文件的最小 schema 变成机器判据。
#
# 校验口径（最小集，非穷举）：
#   `.claude/settings.json`（Claude Code 官方 schema）：
#     hooks.PreToolUse 为数组；每条含内层 `hooks` 数组；内层每个命令对象带
#     `type: "command"`，且 command 指向 sofagent-precommit.sh。
#   `.cursor/hooks.json`（Cursor 官方 schema）：
#     顶级 `version: 1`；hooks 下事件名为 camelCase（`preToolUse` / `postToolUse`，
#     非 PascalCase）；每条含 `command`（指向 sofagent-precommit.sh）与
#     `matcher: "Shell"`（Cursor 工具名，非 "Bash"）。
#
# 用法：bash tools/check/check-platform-hooks.sh
# 退出码：0 = 两平台配置合规；2 = 不合规或无法校验（缺 node / 文件缺失）。
# ============================================================

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2

CLAUDE=".claude/settings.json"
CURSOR=".cursor/hooks.json"

if ! command -v node >/dev/null 2>&1; then
  echo "✗ node 未找到——无法校验平台 hook 配置 schema（fail-closed）"
  exit 2
fi

read -r -d '' VALIDATOR <<'NODE' || true
'use strict';
const fs = require('fs');
const files = process.argv.slice(1);
const claudePath = files[0];
const cursorPath = files[1];
const MARK = 'sofagent-precommit.sh';
const errors = [];

function load(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    errors.push(p + ': 读取或 JSON 解析失败 —— ' + e.message);
    return null;
  }
}
function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

// ── Claude Code：hooks.PreToolUse[*].hooks[*].{type,command} ──
const claude = load(claudePath);
if (claude) {
  if (!isObj(claude.hooks)) {
    errors.push(claudePath + ': 缺 hooks 对象');
  } else if (!Array.isArray(claude.hooks.PreToolUse) || claude.hooks.PreToolUse.length === 0) {
    errors.push(claudePath + ': hooks.PreToolUse 缺失或非数组');
  } else {
    let ok = false;
    for (const entry of claude.hooks.PreToolUse) {
      if (!isObj(entry)) { errors.push(claudePath + ': PreToolUse 条目非对象'); continue; }
      if (!Array.isArray(entry.hooks) || entry.hooks.length === 0) {
        errors.push(claudePath + ': PreToolUse 条目缺内层 hooks 数组（官方 schema 为 {matcher, hooks:[{type,command}]}）');
        continue;
      }
      for (const h of entry.hooks) {
        if (!isObj(h) || h.type !== 'command') {
          errors.push(claudePath + ': 内层 hook 缺 type:"command"');
          continue;
        }
        if (typeof h.command !== 'string' || !h.command.includes(MARK)) {
          errors.push(claudePath + ': 内层 command 未指向 ' + MARK);
          continue;
        }
        ok = true;
      }
    }
    if (!ok) errors.push(claudePath + ': 无合法的 {type:"command", command: …' + MARK + '} 项');
  }
}

// ── Cursor：version:1 + hooks.<camelCase event>[*].{command,matcher:"Shell"} ──
const cursor = load(cursorPath);
if (cursor) {
  if (cursor.version !== 1) errors.push(cursorPath + ': 缺 version: 1（Cursor required）');
  if (!isObj(cursor.hooks)) {
    errors.push(cursorPath + ': 缺 hooks 对象');
  } else {
    const events = Object.keys(cursor.hooks).filter((k) => /^(pre|post)ToolUse$/.test(k));
    const pascal = Object.keys(cursor.hooks).filter((k) => /^(Pre|Post)ToolUse$/.test(k));
    if (pascal.length > 0) {
      errors.push(cursorPath + ': 事件名 ' + pascal.join(', ') + ' 为 PascalCase——Cursor 用 camelCase（应为 ' + pascal.join(', ').replace(/^P/, 'p') + '）');
    }
    if (events.length === 0) {
      errors.push(cursorPath + ': 缺 preToolUse / postToolUse 事件（camelCase）');
    } else {
      let ok = false;
      for (const k of events) {
        if (!Array.isArray(cursor.hooks[k])) { errors.push(cursorPath + ': ' + k + ' 非数组'); continue; }
        for (const entry of cursor.hooks[k]) {
          if (!isObj(entry)) { errors.push(cursorPath + ': ' + k + ' 条目非对象'); continue; }
          if (entry.matcher !== 'Shell') {
            errors.push(cursorPath + ': ' + k + ' matcher 应为 "Shell"（Cursor 工具名）——实为 ' + JSON.stringify(entry.matcher));
          }
          if (typeof entry.command !== 'string' || !entry.command.includes(MARK)) {
            errors.push(cursorPath + ': ' + k + ' command 未指向 ' + MARK);
            continue;
          }
          if (entry.matcher === 'Shell') ok = true;
        }
      }
      if (!ok) errors.push(cursorPath + ': 无合法的 {command: …' + MARK + ', matcher:"Shell"} 项');
    }
  }
}

if (errors.length > 0) {
  console.log('✗ 平台 hook 配置不符合各自 schema：');
  for (const e of errors) console.log('    · ' + e);
  process.exit(2);
}
console.log('✓ 平台 hook 配置 schema 合规：' + claudePath + '（Claude PreToolUse）· ' + cursorPath + '（Cursor camelCase + Shell）');
process.exit(0);
NODE

node -e "$VALIDATOR" "$CLAUDE" "$CURSOR"
_rc=$?
[ "$_rc" -eq 0 ] || exit "$_rc"

# ── ② 脚本侧契约：平台阻断码分流（Claude exit 2 / git exit 1 / 非 commit 不误伤）──
# 为什么在这里：配置 schema 合规只证明「平台读得到 command」，不证明「脚本按平台语义阻断」。
#   Claude Code **仅 exit 2 阻断**（其余非零只记日志）——脚本若统一 exit 1，配置再合规也拦不住。
#   本步用**可控触发点**（空 SOFAGENT_HOME ⇒ 基线缺失 fail-loud，与违规判定无关）驱动同一脚本的
#   两种调用形态 + 一次非 commit 调用，把原先只靠人工实跑的契约变成机械判据。
HOOK_SH="tools/hooks/sofagent-precommit.sh"
if [ ! -f "$HOOK_SH" ]; then
  echo "✗ 平台 hook 脚本缺失：$HOOK_SH"
  exit 2
fi
_TMPH=$(mktemp -d 2>/dev/null || echo "/tmp/sofagent-ph-$$")
mkdir -p "$_TMPH"
printf 'feat: platform-hook contract probe\n' > "$_TMPH/msg"
_c_rc=0; printf '%s' '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git commit -m x"}}' | SOFAGENT_HOME="$_TMPH" bash "$HOOK_SH" >/dev/null 2>&1 || _c_rc=$?
_g_rc=0; SOFAGENT_HOME="$_TMPH" bash "$HOOK_SH" "$_TMPH/msg" >/dev/null 2>&1 || _g_rc=$?
_s_rc=0; printf '%s' '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"ls -la"}}' | SOFAGENT_HOME="$_TMPH" bash "$HOOK_SH" >/dev/null 2>&1 || _s_rc=$?
rm -rf "$_TMPH"
_ok=1
[ "$_c_rc" -eq 2 ] || { echo "✗ Claude 形态阻断码应为 2，实为 ${_c_rc}（Claude Code 仅 exit 2 阻断；取 1 = 拦截静默失效）"; _ok=0; }
[ "$_g_rc" -eq 1 ] || { echo "✗ git 形态阻断码应为 1，实为 ${_g_rc}"; _ok=0; }
[ "$_s_rc" -eq 0 ] || { echo "✗ 平台模式下非 commit 命令应放行（0），实为 ${_s_rc}（会误伤普通 Bash 调用）"; _ok=0; }
[ "$_ok" -eq 1 ] || exit 2
echo "✓ 脚本侧契约合规：Claude 形态 exit 2 · git 形态 exit 1 · 非 commit 放行 0"
exit 0
