#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# sofagent-precommit.sh · 跨平台 commit 审计拦截（共享入口）
# v1.4.0 新增：Cursor / Claude Code / 千问办公 / git 原生 hook 共用此脚本
#
# 设计原则：复用 engine/audit 的成熟审计模块，不重写审计逻辑。
#   本脚本只做「适配层」——把不同平台的调用方式归一化后，转发给 sofagent audit。
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
  # v1.5.7 F29 边界修复：MSG 先置空——node 不在 PATH / node 分支整体失败时，
  # 下方 [ -z "$MSG" ] 在 set -u 下不再炸 unbound（极简环境实测踩中）。
  MSG=""
  if [ -n "$CMD_INPUT" ]; then
    # v1.4.3 F-03 修复：message 抽取分两级——
    # ① node JSON 解析（主路径）：正确处理 -m/--message 的空格与等号（--message=）两种形式、
    #    单/双/嵌套引号、JSON 转义（\" \\n）、中文（Node 字符串处理无 C locale 字节级问题）；
    # ② grep 管线（fallback，node 不可用时）：在旧正则基础上补等号分支
    #    （(-m|--message)([[:space:]]+|=)）——第五轮实测：等号形式旧正则抽取为空、
    #    嵌套引号（it's）被闭引 sed 截断，此为已知 fallback 局限，node 可用时不受影响。
    if command -v node &>/dev/null; then
      # v1.5.7 F29 边界修复：MSG 先置空——node 分支整体失败时（管道破裂等）
      # 下方 [ -z "$MSG" ] 在 set -u 下不再炸 unbound（极简环境实测踩中）。
      MSG=""
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
  echo "❌ sofagent audit: Node.js 未找到，审计未运行"
  echo "   请安装 Node.js >= 18: https://nodejs.org"
  exit 1
fi

# ── 4. 仓库根定位（编辑器从子目录触发 hook 时仍能找到本地 dist）──────────
REPO_ROOT=""
if command -v git &>/dev/null && git rev-parse --show-toplevel &>/dev/null; then
  REPO_ROOT="$(git rev-parse --show-toplevel)"
fi

# ── 5. sofagent audit 定位（优先仓库本地 dist，避免全局版本漂移）──────────
# v1.5.7 F29：AUDIT_DIST 此前恒指 $REPO_ROOT/engine/audit/dist/index.js——
# REPO_ROOT 是**被审仓**的根，普通业务仓下该路径不存在，§6 哈希校验整段
# 静默跳过 ⇒ 主流安装形态（全局安装 + 普通仓）下审计器本体被篡改零防线。
# 现按形态分流：引擎仓自审 = 仓内 dist（原行为）；普通仓 = _resolve_audit_dist
# 三级解析，解析成功做全局口径哈希校验，解析失败打印 SKIP 行（不静默不阻断）。
AUDIT_DIST=""
_REPO_IS_SOFA=0
if [ -n "$REPO_ROOT" ] && [ -f "$REPO_ROOT/engine/audit/dist/index.js" ] \
  && [ -f "$REPO_ROOT/package.json" ] && [ -f "$REPO_ROOT/engine/audit/package.json" ]; then
  _TOP_NAME=$(node -e "try{process.stdout.write(require(process.argv[1]).name||'')}catch{}" "$REPO_ROOT/package.json" 2>/dev/null)
  _AUD_NAME=$(node -e "try{process.stdout.write(require(process.argv[1]).name||'')}catch{}" "$REPO_ROOT/engine/audit/package.json" 2>/dev/null)
  if [ "$_TOP_NAME" = "sofagent-monorepo" ] && [ "$_AUD_NAME" = "@sofagent/audit" ]; then
    _REPO_IS_SOFA=1
    AUDIT_DIST="$REPO_ROOT/engine/audit/dist/index.js"
  fi
fi

# 普通仓形态：审计器本体路径三级解析（按序取第一个成功）。
# 置 AUDIT_GLOBAL_DIST（非空 = 解析成功）+ AUDIT_GLOBAL_SRC（命中的那级，文案用）。
_resolve_audit_dist() {
  AUDIT_GLOBAL_DIST=""
  AUDIT_GLOBAL_SRC=""
  SOFAGENT_HOME="${SOFAGENT_HOME:-$HOME/.sofagent}"
  # ① $SOFAGENT_HOME/internal/ 下的安装路径记录（若存在）
  _RECORD="$SOFAGENT_HOME/internal/audit-install-path.txt"
  if [ -f "$_RECORD" ]; then
    _RECORDED=$(tr -d '[:space:]' < "$_RECORD" 2>/dev/null)
    if [ -n "$_RECORDED" ] && [ -f "$_RECORDED" ]; then
      AUDIT_GLOBAL_DIST="$_RECORDED"
      AUDIT_GLOBAL_SRC="install-record"
      return 0
    fi
  fi
  # ①.5 npm root -g 顶层安装（v1.5.7 修复，acceptance S321/S345 实测——原序 ②c 在
  #     ③ 之前，全局 sofagent 总包内嵌的旧版 @sofagent/audit 副本（实测内嵌 1.5.2 /
  #     顶层 1.5.6）先被 wrapper-resolve 命中，聚合哈希 ≠ 信任锚（锚由
  #     audit-baseline-sync --global 按**顶层**口径计算）⇒ 主流安装形态（总包+独立包
  #     并存）下正常审计被「可能被投毒」假拦。顶层 npm-root-g 与锚同口径，先试之；
  #     ②c 降为兜底，内嵌副本与锚不符时照旧拦截——宁可假拦不可假绿的语义不变）。
  _NPM_ROOT=$(npm root -g 2>/dev/null | head -1 || true)
  if [ -n "$_NPM_ROOT" ] && [ -f "$_NPM_ROOT/@sofagent/audit/dist/index.js" ]; then
    AUDIT_GLOBAL_DIST="$_NPM_ROOT/@sofagent/audit/dist/index.js"
    AUDIT_GLOBAL_SRC="npm-root-g"
    return 0
  fi
  # ② command -v 解析 bin 入口，读其包装/shebang 指向的真实 dist。
  #    按可信度排序尝试三个 bin（sofagent-audit 直链包内 dist 最干净；
  #    sofagent 总包是转发壳，实测可内嵌与顶层不同版本的依赖副本——
  #    本机实测内嵌 1.5.2 / 顶层 1.5.6，须先推导顶层再兜底内嵌解析）。
  for _CMD in sofagent-audit sofagent; do
    _BIN=$(command -v "$_CMD" 2>/dev/null || true)
    [ -n "$_BIN" ] || continue
    _BIN=$(readlink -f "$_BIN" 2>/dev/null || echo "$_BIN")
    # ②a bin 相对路径推导：
    #    @sofagent/audit 的 bin → 包根同级 dist/（bin 链接进全局 bin 前已
    #    解析为真实路径 dist/cli-quick.js → dist/index.js 同目录）
    _DIST_CANDID=$(dirname "$_BIN")/index.js
    if [ -f "$_DIST_CANDID" ]; then
      AUDIT_GLOBAL_DIST="$_DIST_CANDID"
      AUDIT_GLOBAL_SRC="bin-adjacent"
      return 0
    fi
    # ②b 全局 bin 目录标准布局推导：bin → ../lib/node_modules/@sofagent/audit/dist/index.js
    _BIN_DIR=$(dirname "$_BIN")
    for _GUESS in \
      "$_BIN_DIR/../lib/node_modules/@sofagent/audit/dist/index.js" \
      "$_BIN_DIR/../../lib/node_modules/@sofagent/audit/dist/index.js"; do
      if [ -f "$_GUESS" ]; then
        AUDIT_GLOBAL_DIST="$_GUESS"
        AUDIT_GLOBAL_SRC="bin-lib-layout"
        return 0
      fi
    done
    # ②c 转发壳内嵌 require.resolve（③ 落空后的兜底：直接安装 @sofagent/audit 且
    # 非标准布局时。注意此时命中的可能是总包内嵌副本——版本落后于顶层
    # 独立包时以基线口径为准拦截并给出刷新指引，宁可假拦不可假绿）
    _RESOLVED=$(node -e '
      const {dirname, join} = require("path");
      const {existsSync, readFileSync} = require("fs");
      try {
        const binPath = process.argv[1];
        const text = readFileSync(binPath, "utf8");
        if (/require\.resolve\((["\x27])@sofagent\/audit\1\)/.test(text)) {
          const { createRequire } = require("module");
          const req = createRequire(binPath);
          const entry = req.resolve("@sofagent/audit");
          const distIndex = join(dirname(entry), "index.js");
          if (existsSync(distIndex)) { process.stdout.write(distIndex); process.exit(0); }
        }
      } catch (x) { /* 解析失败走下一级 */ }
    ' "$_BIN" 2>/dev/null || true)
    if [ -n "$_RESOLVED" ] && [ -f "$_RESOLVED" ]; then
      AUDIT_GLOBAL_DIST="$_RESOLVED"
      AUDIT_GLOBAL_SRC="bin-wrapper-resolve"
      return 0
    fi
  done
  return 1
}

if [ "$_REPO_IS_SOFA" -eq 1 ]; then
  AUDIT_CMD=(node "$AUDIT_DIST")
elif [ -n "${SOFAGENT_AUDIT_CMD:-}" ]; then
  # 显式覆盖通道（acceptance S321/S345 测试台架专用）：解析序修复后普通仓恒走
  # 三级解析/PATH 真引擎，PATH stub 不再被命中——测试需要替换审计入口以捕获
  # --task 透传参数，经本变量显式注入（值=空格分词的命令前缀）。该通道**只降
  # 解析优先级**，不降审计语义：注入的命令照常收 --diff/--task/--commit-msg
  # 全量参数，退出码照常过白名单 fail-closed（0/1/2 之外仍拒绝 commit）。
  # shellcheck disable=SC2206
  AUDIT_CMD=($SOFAGENT_AUDIT_CMD)
else
  if _resolve_audit_dist; then
    AUDIT_DIST="$AUDIT_GLOBAL_DIST"
    AUDIT_CMD=(node "$AUDIT_DIST")
  elif command -v sofagent-audit &>/dev/null; then
    # 路径三级全落空但 PATH 上有 sofagent-audit——执行面照旧（PATH 假 binary
    # 风险由 commit-msg hook 的非 PATH 解析兜底），完整性校验走 SKIP 分支
    AUDIT_CMD=(sofagent-audit)
  else
    echo "❌ sofagent-audit 未安装，审计未运行"
    echo "   请运行: npm install -g @sofagent/audit"
    exit 1
  fi
fi

# ── 6. dist 完整性校验（P1-A2：防本地覆写致审计失效）─────────────────────
# 双形态：引擎仓自审走原双信号矩阵（不动）；普通仓走全局口径聚合哈希
# （对齐 commit-msg hook 全局分支：聚合哈希 vs audit-global-dist-hash.txt）。
if [ "$_REPO_IS_SOFA" -eq 1 ] && [ -n "$REPO_ROOT" ] && [ -f "$AUDIT_DIST" ]; then
  SOFAGENT_HOME="${SOFAGENT_HOME:-$HOME/.sofagent}"
  HASH_RECORD="$SOFAGENT_HOME/internal/audit-hash.txt"
  if [ ! -f "$HASH_RECORD" ]; then
    # v1.4.3 F-04 修复（对齐 SECURITY.md:437 声称）：基线缺失 fail-loud exit 1，
    # 不再「正在补生成...」自动记录——防止把已被篡改的 dist 固化为合法基线
    # （信任锚必须是用户显式确认的时刻，不是 hook 顺手拍快照）。
    echo "🔴 [sofagent] 审计模块哈希基准缺失（$HASH_RECORD 不存在）——无法保证审计模块未被替换，本次提交终止"
    echo "   请运行: sofagent audit --doctor --baseline 显式建立基线（在你确认 dist 可信的时刻）"
    exit 1
  else
    CURRENT_HASH=$(node -e "const c=require('crypto'),f=require('fs');process.stdout.write(c.createHash('sha256').update(f.readFileSync('$AUDIT_DIST')).digest('hex'))" 2>/dev/null)
    RECORDED_HASH=$(cat "$HASH_RECORD" 2>/dev/null | tr -d '[:space:]')

    # v1.4.6 双信号判定：dist 哈希变化有两种成因（改源码后重建 / 不动源码直接替换
    # dist），单看 dist 无法区分，只能一律拦截，结果是每次 rebuild 后全仓 commit
    # 被阻塞。追加「源码指纹」作第二信号即可分离——判定矩阵见
    # engine/audit/hooks/audit-src-fingerprint.mjs 头部注释。
    # 指纹必须由 dist 之外的代码计算：交给 dist/index.js 算则 dist 被篡改时指纹
    # 同样可伪造，防线 self-defeating。
    SRC_CHANGED=0
    CURRENT_SRC_FP=""
    RECORDED_SRC_FP=""
    SRC_RECORD="$SOFAGENT_HOME/internal/audit-src-fingerprint.txt"
    # 🔴 v1.5.4 #28 信任根修复（与 commit-msg 同款）：原 `FP_SCRIPT="$REPO_ROOT/tools/…"`
    # 是**被审仓内**的绝对路径——恶意仓放同名脚本即每次 commit 执行任意代码。
    # 改为只从可信源取：① 安装落地副本（首选）；② 本仓自审或显式注入时的仓内路径；
    # 两者皆无则跳过指纹（走更严的 fail-closed 分支，不静默放行）。
    FP_SCRIPT=""
    _FP_LANDED="$SOFAGENT_HOME/internal/audit-src-fingerprint.mjs"
    # 本仓判定（与 commit-msg 同款）：只有**确认是被审对象即本仓**时才允许读仓内脚本
    _REPO_IS_SOFA=0
    if [ -n "${REPO_ROOT:-}" ] && [ -f "$REPO_ROOT/package.json" ] && [ -f "$REPO_ROOT/engine/audit/package.json" ]; then
      _TOP_NAME=$(node -e "try{process.stdout.write(require(process.argv[1]).name||'')}catch{}" "$REPO_ROOT/package.json" 2>/dev/null)
      _AUD_NAME=$(node -e "try{process.stdout.write(require(process.argv[1]).name||'')}catch{}" "$REPO_ROOT/engine/audit/package.json" 2>/dev/null)
      if [ "$_TOP_NAME" = "sofagent-monorepo" ] && [ "$_AUD_NAME" = "@sofagent/audit" ]; then
        _REPO_IS_SOFA=1
      fi
    fi
    if [ -f "$_FP_LANDED" ]; then
      FP_SCRIPT="$_FP_LANDED"
    elif { [ "${_REPO_IS_SOFA:-0}" -eq 1 ] || [ -n "${SOFAGENT_AUDIT_ENTRY:-}" ]; } \
      && [ -n "${REPO_ROOT:-}" ] && [ -f "$REPO_ROOT/engine/audit/hooks/audit-src-fingerprint.mjs" ]; then
      FP_SCRIPT="$REPO_ROOT/engine/audit/hooks/audit-src-fingerprint.mjs"
    fi
    if [ -n "$FP_SCRIPT" ] && [ -f "$SRC_RECORD" ]; then
      CURRENT_SRC_FP=$(node "$FP_SCRIPT" "$REPO_ROOT" 2>/dev/null)
      RECORDED_SRC_FP=$(cat "$SRC_RECORD" 2>/dev/null | tr -d '[:space:]')
      if [ -n "$CURRENT_SRC_FP" ] && [ -n "$RECORDED_SRC_FP" ] && [ "$CURRENT_SRC_FP" != "$RECORDED_SRC_FP" ]; then
        SRC_CHANGED=1
      fi
    fi

    if [ "$SRC_CHANGED" -eq 1 ]; then
      if [ -n "$CURRENT_HASH" ] && [ -n "$RECORDED_HASH" ] && [ "$CURRENT_HASH" = "$RECORDED_HASH" ]; then
        echo "⚠️ [sofagent] 审计模块源码已变更，但 dist 未重建——当前审计跑的是旧代码"
        echo "   请执行: npm run build --workspace=engine/audit"
      else
        echo "ℹ️ [sofagent] 审计模块源码已变更（src 指纹 ${RECORDED_SRC_FP:0:12}... → ${CURRENT_SRC_FP:0:12}...），dist 随之变化属预期，本次提交放行"
        echo "   同步信任锚: bash tools/audit-baseline-sync.sh"
      fi
    elif [ -n "$CURRENT_HASH" ] && [ -n "$RECORDED_HASH" ] && [ "$CURRENT_HASH" != "$RECORDED_HASH" ]; then
      echo "🔴 [sofagent] 审计模块完整性校验失败（P1-A2 dist 哈希不匹配）"
      echo "   engine/audit/dist/index.js 可能被替换（影子审计器劫持风险）。"
      echo "   源码未变（src 指纹 ${CURRENT_SRC_FP:0:12}...）——dist 变化无法用「改了源码」解释。"
      echo "   记录哈希: ${RECORDED_HASH:0:12}...  当前哈希: ${CURRENT_HASH:0:12}..."
      echo "   恢复原始 dist: npm run build --workspace=engine/audit"
      echo "   确认 dist 可信后重建信任锚: bash tools/audit-baseline-sync.sh"
      echo "   （注意：sofagent audit --doctor 只体检、不覆盖已存在的基线，不能用它刷新）"
      exit 1
    fi
  fi
elif [ -n "${AUDIT_GLOBAL_DIST:-}" ]; then
  # ── 普通仓 + 全局安装形态：全局口径聚合哈希校验 ──────────────────────
  # 对齐 commit-msg hook 全局分支：聚合哈希（dist/**/*.js 排序逐文件哈希再
  # 聚合）vs audit-global-dist-hash.txt。不引入源码指纹信号——指纹基线是
  # 引擎仓源码口径，普通仓下恒不匹配，反而把真篡改洗成「属预期放行」。
  # 算法内联（与 commit-msg 的 _aggregate_dist_hash 逐字一致）：校验器不能
  # 读被审仓内脚本（可投毒）。
  _DIST_DIR=$(dirname "$AUDIT_GLOBAL_DIST")
  _GLOBAL_HASH=$(node -e '
    const {createHash}=require("crypto"),{readFileSync,readdirSync,statSync}=require("fs"),{join,relative,sep}=require("path");
    const distRoot=process.argv[1];
    let ok=false; try{ok=statSync(distRoot).isDirectory()}catch(x){}
    if(!ok){process.exit(0)}
    const out=[];
    (function walk(d){for(const e of readdirSync(d,{withFileTypes:true})){const p=join(d,e.name); if(e.isDirectory())walk(p); else if(e.isFile()&&e.name.endsWith(".js"))out.push(p);}})(distRoot);
    const files=out.map(f=>({rel:relative(distRoot,f).split(sep).join("/"),abs:f})).sort((a,b)=>a.rel<b.rel?-1:a.rel>b.rel?1:0);
    if(files.length===0){process.exit(0)}
    const inputs=files.map(f=>f.rel+"\u0000"+createHash("sha256").update(readFileSync(f.abs)).digest("hex"));
    process.stdout.write(createHash("sha256").update(inputs.join("\u0001"),"utf8").digest("hex"));
  ' "$_DIST_DIR" 2>/dev/null || true)
  _GLOBAL_HASH_RECORD="$SOFAGENT_HOME/internal/audit-global-dist-hash.txt"
  if [ -z "$_GLOBAL_HASH" ]; then
    echo "⚠️ [sofagent] 审计器本体哈希计算失败（${_DIST_DIR} 不可读）——完整性校验未执行（来源：${AUDIT_GLOBAL_SRC}）"
  elif [ ! -f "$_GLOBAL_HASH_RECORD" ]; then
    # 基线缺失 fail-loud（与既有语义一致）：不自动落锚——防止把已被篡改的
    # dist 固化为合法基线。信任锚必须是用户显式确认的时刻。
    echo "🔴 [sofagent] 全局审计引擎基准缺失（$_GLOBAL_HASH_RECORD 不存在）——无法保证审计器本体未被替换，本次提交终止"
    echo "   建立基准（任一，均为显式确认时刻）："
    echo "     · 仓库内：bash tools/audit-baseline-sync.sh --global"
    echo "     · 通用：sofagent audit --install-hook（重装 hook 时自动建立全局锚）"
    echo "     · 通用：sofagent audit --doctor --baseline"
    exit 1
  else
    _GLOBAL_RECORDED=$(tr -d '[:space:]' < "$_GLOBAL_HASH_RECORD" 2>/dev/null)
    if [ "$_GLOBAL_HASH" != "$_GLOBAL_RECORDED" ]; then
      echo "🔴 [sofagent] 全局审计引擎哈希不匹配（可能被投毒，来源：${AUDIT_GLOBAL_SRC}）: $AUDIT_GLOBAL_DIST"
      echo "   当前聚合哈希 ${_GLOBAL_HASH:0:12}... ≠ 基准 ${_GLOBAL_RECORDED:0:12}..."
      echo "   恢复（按序尝试，任选其一）："
      echo "     ① 仓库内同步信任锚：bash tools/audit-baseline-sync.sh --global"
      echo "     ② 删陈旧锚后重装 hook：rm -f \"\$HOME/.sofagent/internal/audit-global-dist-hash.txt\" && sofagent audit --install-hook"
      echo "   ⚠️ 同版本 npm install -g @sofagent/audit 无效：包内容不变 ⇒ 聚合哈希不变 ⇒ 仍被拦。"
      exit 1
    fi
  fi
else
  # ── 普通仓 + 解析失败形态：SKIP（必须打印，不得静默）─────────────────
  if [ -n "${SOFAGENT_AUDIT_CMD:-}" ]; then
    echo "⚠️ [sofagent] SKIP：SOFAGENT_AUDIT_CMD 显式旁路生效（测试台架形态）——审计器本体完整性校验不适用"
  else
    echo "⚠️ [sofagent] SKIP：未启用审计器本体完整性校验——全局审计器路径三级解析均未命中，执行面走 PATH 上的 sofagent-audit"
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
# 一律拒绝 commit——审计模块崩溃不能被静默转译为「审计通过」（fail-open）。
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
    echo "🔴 [sofagent] 审计模块异常退出（exit ${EXIT_CODE}，白名单外）——无法确认审计通过，commit 终止"
    echo "   可能原因：进程被信号杀死（137=OOM / 139=段错误）或命令缺失（126/127）。"
    echo "   请单独运行: node engine/audit/dist/index.js --diff --cached 排查引擎状态；"
    echo "   确认为引擎自身故障并修复后重新提交。"
    exit 1
    ;;
esac

exit 0
