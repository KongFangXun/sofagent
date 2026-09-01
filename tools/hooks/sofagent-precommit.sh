#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# sofagent-precommit.sh · 跨平台 commit 审计拦截（共享入口）
# v1.4.0 新增：Cursor / Claude Code / 千问办公 / git 原生 hook 共用此脚本
#
# 设计原则：复用 engine/audit 的成熟审计引擎，不重写审计逻辑。
#   本脚本只做「适配层」——把不同平台的调用方式归一化后，转发给 sofagent-audit。
#
# 支持的调用来源：
#   1. git commit-msg hook      → 传入 $1 = commit message 文件路径
#   2. git pre-commit hook      → 无参数，审计 staged diff
#   3. Cursor PostToolUse hook  → stdin 传 JSON（含 tool_input.command）
#   4. Claude Code PreToolUse   → stdin 传 JSON（含 tool_input.command）
#   5. 千问办公自定义 Hook      → 同上 stdin JSON（预留，schema 以实测为准）
#
# 退出码约定（与 git / Claude Code 一致）：
#   0 = 放行；1 / 2 = 拦截（Claude Code 用 2 阻断，git 用 1 阻断；本脚本统一 exit 1 阻断）
# ═══════════════════════════════════════════════════════════════════════

set -uo pipefail

# ── 0. 解析 commit message（三种来源归一化）──────────────────────────────
COMMIT_MSG_FILE=""
COMMIT_SUBJECT=""
COMMIT_FULL_MSG=""

# 来源 A：git commit-msg hook 直接给文件路径
if [ -n "${1:-}" ] && [ -f "$1" ]; then
  COMMIT_MSG_FILE="$1"
  COMMIT_SUBJECT=$(head -1 "$COMMIT_MSG_FILE")
  COMMIT_FULL_MSG=$(cat "$COMMIT_MSG_FILE")
fi

# 来源 B：平台 hook 通过 stdin 传 JSON（Cursor / Claude Code / 千问办公）
# 形如 {"tool_name":"Bash","tool_input":{"command":"git commit -m '...'"}}
# 仅当没拿到文件路径时尝试解析（避免与 git 原生 hook 冲突）
if [ -z "$COMMIT_MSG_FILE" ] && [ ! -t 0 ]; then
  CMD_INPUT=$(cat 2>/dev/null || true)
  if [ -n "$CMD_INPUT" ]; then
    # v1.4.3 F-03 修复：message 抽取分两级——
    # ① node JSON 解析（主路径）：正确处理 -m/--message 的空格与等号（--message=）两种形式、
    #    单/双/嵌套引号、JSON 转义（\" \\n）、中文（Node 字符串处理无 C locale 字节级问题）；
    # ② grep 管线（fallback，node 不可用时）：在旧正则基础上补等号分支
    #    （(-m|--message)([[:space:]]+|=)）——第五轮实测：等号形式旧正则抽取为空、
    #    嵌套引号（it's）被闭引 sed 截断，此为已知 fallback 局限，node 可用时不受影响。
    if command -v node &>/dev/null; then
      MSG=$(printf '%s' "$CMD_INPUT" | node -e '
        let raw = "";
        process.stdin.on("data", d => raw += d);
        process.stdin.on("end", () => {
          try {
            const j = JSON.parse(raw);
            const cmd = (j.tool_input && j.tool_input.command) || "";
            const m = cmd.match(/(?:^|\s)(?:-m|--message)(?:\s+|=)(?:"((?:[^"\\]|\\.)*)"|\x27((?:[^\x27\\]|\\.)*)\x27|(\S+))/);
            if (m) {
              const s = m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]);
              process.stdout.write(s.replace(/\\n/g, "\n").replace(/\\"/g, "\x27").replace(/\\\\/g, "\\"));
            }
          } catch (e) { /* 非 JSON 或结构不符——静默返回空，走 grep fallback */ }
        });
      ' 2>/dev/null || true)
    fi
    if [ -z "$MSG" ]; then
      # grep fallback：提取 tool_input.command 里的 commit 命令行
      # v1.4.0 注：`[^\n]*` 在 grep 里匹配字面反斜杠n（JSON 内是 \\n 转义序列），
      # 导致命令在 -m 后截断 → message 只取到 4 字符（A19 误拦）。改 `.*`（JSON 单行无换行）。
      EXTRACTED=$(printf '%s' "$CMD_INPUT" | grep -oE "git[ ]+commit.*" | head -1 || true)
      if [ -n "$EXTRACTED" ]; then
        # F-03：补等号分支 (-m|--message)([[:space:]]+|=)——覆盖 -m "x" / -m=x / --message=x
        MSG=$(printf '%s' "$EXTRACTED" | grep -oE -- "(-m|--message)([[:space:]]+|=).{0,200}" | head -1 | sed -E "s/^(-m|--message)([[:space:]]+|=)//" | sed -E "s/^\\\\?[\"']//" | sed -E "s/\\\\?[\"'].*$//" || true)
      fi
    fi
    if [ -n "$MSG" ]; then
      COMMIT_FULL_MSG="$MSG"
      COMMIT_SUBJECT="$MSG"
    fi
  fi
fi

# ── 1. 仅对 git commit 类操作生效（平台 hook 模式下）──────────────────────
# git 原生 hook 模式（来源 A）总是审计；平台 hook 模式仅当命令是 commit 才审计
IS_GIT_COMMIT=false
if [ -n "$COMMIT_MSG_FILE" ]; then
  IS_GIT_COMMIT=true
elif [ -n "${CMD_INPUT:-}" ]; then
  if printf '%s' "$CMD_INPUT" | grep -qE "git[[:space:]]+(commit|-c )" 2>/dev/null; then
    IS_GIT_COMMIT=true
  fi
fi
if [ "$IS_GIT_COMMIT" = false ]; then
  # 平台 hook 命中了非 commit 命令——放行，不做审计（避免误伤）
  exit 0
fi

# ── 2. 暂存区 diff（commit-msg / pre-commit 场景）────────────────────────
DIFF=$(git diff --cached --name-only 2>/dev/null)
if [ -z "$DIFF" ] && [ -z "$COMMIT_MSG_FILE" ]; then
  # 平台模式下没有 staged 内容（commit 尚未产生），仍审计 message
  :
fi

# ── 3. Node.js 检测 ──────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "❌ sofagent-audit: Node.js 未找到，审计未运行"
  echo "   请安装 Node.js >= 18: https://nodejs.org"
  exit 1
fi

# ── 4. 仓库根定位（编辑器从子目录触发 hook 时仍能找到本地 dist）──────────
REPO_ROOT=""
if command -v git &>/dev/null && git rev-parse --show-toplevel &>/dev/null; then
  REPO_ROOT="$(git rev-parse --show-toplevel)"
fi

# ── 5. sofagent-audit 定位（优先仓库本地 dist，避免全局版本漂移）──────────
AUDIT_DIST="$REPO_ROOT/engine/audit/dist/index.js"
if [ -n "$REPO_ROOT" ] && [ -f "$AUDIT_DIST" ]; then
  AUDIT_CMD=(node "$AUDIT_DIST")
elif command -v sofagent-audit &>/dev/null; then
  AUDIT_CMD=(sofagent-audit)
else
  echo "❌ sofagent-audit 未安装，审计未运行"
  echo "   请运行: npm install -g @sofagent/audit"
  exit 1
fi

# ── 6. dist 完整性校验（P1-A2：防本地覆写致审计失效）─────────────────────
if [ -n "$REPO_ROOT" ] && [ -f "$AUDIT_DIST" ]; then
  SOFAGENT_HOME="${SOFAGENT_HOME:-$HOME/.sofagent}"
  HASH_RECORD="$SOFAGENT_HOME/internal/audit-hash.txt"
  if [ ! -f "$HASH_RECORD" ]; then
    # v1.4.3 F-04 修复（对齐 SECURITY.md:437 声称）：基线缺失 fail-loud exit 1，
    # 不再「正在补生成...」自动记录——防止把已被篡改的 dist 固化为合法基线
    # （信任锚必须是用户显式确认的时刻，不是 hook 顺手拍快照）。
    echo "🔴 [sofagent] 审计引擎哈希基准缺失（$HASH_RECORD 不存在）——无法保证审计引擎未被替换，本次提交终止"
    echo "   请运行: sofagent-audit --doctor --baseline 显式建立基线（在你确认 dist 可信的时刻）"
    exit 1
  else
    CURRENT_HASH=$(node -e "const c=require('crypto'),f=require('fs');process.stdout.write(c.createHash('sha256').update(f.readFileSync('$AUDIT_DIST')).digest('hex'))" 2>/dev/null)
    RECORDED_HASH=$(cat "$HASH_RECORD" 2>/dev/null | tr -d '[:space:]')
    if [ -n "$CURRENT_HASH" ] && [ -n "$RECORDED_HASH" ] && [ "$CURRENT_HASH" != "$RECORDED_HASH" ]; then
      echo "🔴 [sofagent] 审计引擎完整性校验失败（P1-A2 dist 哈希不匹配）"
      echo "   engine/audit/dist/index.js 可能被替换（影子审计器劫持风险）。"
      echo "   记录哈希: ${RECORDED_HASH:0: 12}...  当前哈希: ${CURRENT_HASH:0: 12}..."
      echo "   如需恢复，运行: npm run build --workspace=engine/audit"
      echo "   如为故意重建 dist，运行: sofagent-audit --doctor（会更新基准哈希）"
      exit 1
    fi
  fi
fi

# ── 6. .sofagent/ ignore 兜底 ────────────────────────────────────────────
if [ -f ".gitignore" ] && ! grep -q '^\.sofagent/$' ".gitignore" 2>/dev/null && ! grep -q '^\.sofagent/' ".gitignore" 2>/dev/null; then
  printf '\n# sofagent 审计数据（本地配置 + 知识库 + 审计历史）\n.sofagent/\n' >> ".gitignore"
  echo "ℹ️ [sofagent] 已自动补充 .gitignore（排除 .sofagent/）"
elif [ ! -f ".gitignore" ]; then
  printf '# sofagent 审计数据（本地配置 + 知识库 + 审计历史）\n.sofagent/\n' > ".gitignore"
  echo "ℹ️ [sofagent] 已自动创建 .gitignore（排除 .sofagent/）"
fi
# v1.4.3 F-05 修复（对齐 SECURITY.md:417 声称）：reset 失败 fail-loud 拒绝 commit，
# 不再 || true 静默放行——.sofagent/ 移不出暂存区（可能 index.lock 竞态）时，
# 宁可 false-retry 不可审计数据静默入库。
if ! git reset -q -- .sofagent/ 2>/dev/null; then
  echo "🔴 [sofagent] .sofagent/ 移出暂存区失败（可能 index.lock 竞态）——commit 终止"
  echo "   重试 commit 前先确认: git status --short | grep sofagent 应为空；持续失败查 index.lock 残留"
  exit 1
fi

# ── 7. 执行审计 ─────────────────────────────────────────────────────────
AUDIT_DIFF_ARG="--cached"
if [ -n "$COMMIT_SUBJECT" ]; then
  "${AUDIT_CMD[@]}" --diff "$AUDIT_DIFF_ARG" --silent --ci --task "$COMMIT_SUBJECT" --commit-msg "$COMMIT_FULL_MSG"
else
  "${AUDIT_CMD[@]}" --diff "$AUDIT_DIFF_ARG" --silent --ci
fi
EXIT_CODE=$?

# 退出码白名单 fail-closed：0=PASS 放行 / 1=WARN 警告放行 / 2=FAIL 拦截。
# 白名单外的退出码（OOM 137 / 段错误 139 / 命令缺失 126/127 等信号级杀死）
# 一律拒绝 commit——审计引擎崩溃不能被静默转译为「审计通过」（fail-open）。
case $EXIT_CODE in
  2)
    echo ""
    echo "❌ sofagent audit: 检测到违规，commit 已阻止。"
    echo "   请修复违规项后重新提交（或用 git commit --no-verify 跳过，后果自负）。"
    exit 1
    ;;
  1)
    echo ""
    echo "⚠️  sofagent audit: 检测到警告，但允许 commit。"
    ;;
  0)
    : # PASS 放行
    ;;
  *)
    echo ""
    echo "🔴 [sofagent] 审计引擎异常退出（exit ${EXIT_CODE}，白名单外）——无法确认审计通过，commit 终止"
    echo "   可能原因：进程被信号杀死（137=OOM / 139=段错误）或命令缺失（126/127）。"
    echo "   请单独运行: node engine/audit/dist/index.js --diff --cached 排查引擎状态；"
    echo "   确认为引擎自身故障并修复后重新提交。"
    exit 1
    ;;
esac

exit 0
