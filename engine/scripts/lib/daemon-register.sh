#!/usr/bin/env bash
# daemon-register.sh · Hook 部署(Step 6) + 断路器注入(Step 7) + daemon(Step 6b)
# 导出：deploy_hook / inject_loopdetect / install_daemon
# OpenClaw 2026.6.x 声明式 hook：HOOK.md+handler.ts → ~/.openclaw/hooks/sofagent-load-chain/
# 在 openclaw.json hooks.internal.entries.sofagent-load-chain 注册 enabled:true 即生效
# 平台无关原则（平台无关重构）：deploy_hook / inject_loopdetect 默认跳过，
# 仅当用户显式 --platform openclaw 时才执行，且写入第三方配置前必须明确提示。

deploy_hook() {  # Step 6: 部署加载链 Hook（仅显式 --platform openclaw）
  [ "${LITE_MODE:-0}" = "1" ] && { info "Lite 模式：跳过 Hook 部署"; return 0; }
  # 平台无关重构：默认不注入——仅显式 --platform openclaw 时才部署 Hook
  if [ "$PLATFORM" != "openclaw" ]; then
    info "Step 6/7 · 平台无关模式：跳过 OpenClaw Hook 部署（如需启用请加 --platform openclaw）"
    return 0
  fi
  info "Step 6/7 · 部署加载链 Hook（OpenClaw 2026.6.x 内部 hook 架构）..."
  warn "显式 --platform openclaw 已启用：以下操作将修改 OpenClaw 配置（openclaw.json）"
  local HOOK_SRC_DIR="${SCRIPT_DIR}/engine/hooks/sofagent-load-chain"
  local HOOK_DST_DIR="${TARGET}/hooks/sofagent-load-chain"
  # v1.2.1 (DP-4): hook 已提升为正式 workspace 包，源码在 src/handler.ts，
  # 构建产出 dist/handler.js + handler.ts（根目录副本，OpenClaw 声明式系统用）
  if [ ! -d "$HOOK_SRC_DIR" ] || [ ! -f "${HOOK_SRC_DIR}/HOOK.md" ]; then
    warn "找不到 hook 源文件（$HOOK_SRC_DIR/HOOK.md），跳过部署"
    warn "  仓库结构异常？请从 https://github.com/KongFangXun/sofagent 重新拉取"; return 0; fi
  # 确保 handler.ts 已构建（开发模式下可能未 build）
  # 权威源关系：src/handler.ts 是权威源，根目录 handler.ts 是其部署副本
  # （OpenClaw 声明式系统读根副本）。缺失或与 src 不一致时以 src 为准覆盖，
  # 防两副本漂移（diff -q 判断，避免无谓重写破坏 mtime）。
  if [ ! -f "${HOOK_SRC_DIR}/handler.ts" ] || ! diff -q "${HOOK_SRC_DIR}/src/handler.ts" "${HOOK_SRC_DIR}/handler.ts" >/dev/null 2>&1; then
    if [ -f "${HOOK_SRC_DIR}/src/handler.ts" ]; then
      cp "${HOOK_SRC_DIR}/src/handler.ts" "${HOOK_SRC_DIR}/handler.ts"
    else
      warn "找不到 handler.ts 或 src/handler.ts，跳过部署"; return 0; fi
  fi
  mkdir -p "$HOOK_DST_DIR"
  cp "${HOOK_SRC_DIR}/HOOK.md" "${HOOK_DST_DIR}/HOOK.md"
  cp "${HOOK_SRC_DIR}/handler.ts" "${HOOK_DST_DIR}/handler.ts"
  # 额外部署编译产物（供直接 node 执行）
  [ -f "${HOOK_SRC_DIR}/dist/handler.js" ] && { mkdir -p "${HOOK_DST_DIR}/dist"; cp "${HOOK_SRC_DIR}/dist/handler.js" "${HOOK_DST_DIR}/dist/handler.js"; }
  ok "加载链内部 Hook 已部署: ${HOOK_DST_DIR}（HOOK.md + handler.ts）"
  # 注册到 openclaw.json（优先 OPENCLAW_CONFIG_PATH，其次 $TARGET/openclaw.json）
  HOOK_CONFIG=""
  for cfg in "${OPENCLAW_CONFIG_PATH:-}" "${TARGET}/openclaw.json"; do
    [ -n "$cfg" ] && [ -f "$cfg" ] && { HOOK_CONFIG="$cfg"; break; }; done
  [ -z "$HOOK_CONFIG" ] && HOOK_CONFIG="${TARGET}/openclaw.json"
  if [ -f "$HOOK_CONFIG" ] && grep -q '"sofagent-load-chain"' "$HOOK_CONFIG" 2>/dev/null; then ok "Hook 已注册: $HOOK_CONFIG"; return 0; fi
  info "正在注册 Hook → $HOOK_CONFIG"
  # P0-1 修复：确保配置文件存在且有有效 JSON，防止空 .tmp 覆盖
  [ -f "$HOOK_CONFIG" ] || echo '{}' > "$HOOK_CONFIG"; [ -s "$HOOK_CONFIG" ] || echo '{}' > "$HOOK_CONFIG"
  cp "$HOOK_CONFIG" "${HOOK_CONFIG}.bak" 2>/dev/null || true
  local REGISTER_OK=0
  if command -v jq &>/dev/null; then
    jq '.hooks.internal.enabled = ((.hooks.internal.enabled // false) or true) | .hooks.internal.entries = ((.hooks.internal.entries // {}) + {"sofagent-load-chain": {"enabled": true}})' \
      "$HOOK_CONFIG" > "${HOOK_CONFIG}.tmp" 2>/dev/null
    if [ -s "${HOOK_CONFIG}.tmp" ]; then
      mv "${HOOK_CONFIG}.tmp" "$HOOK_CONFIG" && REGISTER_OK=1
    else
      warn "jq 注册失败（配置已备份为 ${HOOK_CONFIG}.bak）"
    fi
  elif command -v node &>/dev/null; then
    if CONFIG_PATH="$HOOK_CONFIG" node - << 'H' 2>/dev/null; then
const fs=require('fs'),p=process.env.CONFIG_PATH;let r='{}';try{r=fs.readFileSync(p,'utf-8')}catch(e){}
let c={};try{c=JSON.parse(r.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'').replace(/,(\s*[}\]])/g,'$1')||'{}')}catch(e){c={}}
c.hooks=c.hooks||{};c.hooks.internal=c.hooks.internal||{};c.hooks.internal.enabled=true
c.hooks.internal.entries=c.hooks.internal.entries||{};c.hooks.internal.entries['sofagent-load-chain']={enabled:true}
fs.writeFileSync(p,JSON.stringify(c,null,2)+'\n')
H
      REGISTER_OK=1
    else
      warn "Node 注册失败（配置已备份为 ${HOOK_CONFIG}.bak）"
    fi
  else warn "jq 和 Node.js 均不可用——Hook 需要手动注册"; fi
  if [ "$REGISTER_OK" = "1" ]; then
    ok "Hook 已自动注册（hooks.internal.entries.sofagent-load-chain）"
  else
    warn "请手动在 $HOOK_CONFIG 添加："
    warn '  {"hooks":{"internal":{"enabled":true,"entries":{"sofagent-load-chain":{"enabled":true}}}}}'
  fi
}
inject_loopdetect() {  # Step 7: 注入 loopDetection（仅显式 --platform openclaw，写入 config.json）
  # 平台无关重构：默认不注入——仅显式 --platform openclaw 时才写入断路器配置
  if [ "$PLATFORM" != "openclaw" ]; then
    info "Step 7/7 · 平台无关模式：跳过 loopDetection 注入（如需启用请加 --platform openclaw）"
    return 0
  fi
  if [ "${NO_CONFIG_INJECT:-0}" = "1" ]; then
    info "Step 7/7 · --no-config-inject 已启用：跳过 loopDetection 注入"
    return 0
  fi
  warn "显式 --platform openclaw 已启用：以下操作将修改 OpenClaw 配置（config.json）"
  info "Step 7/7 · 注入断路器配置..."
  CONFIG_FILE="${TARGET}/config.json"
  local B='{"tools":{"loopDetection":{"enabled":true,"historySize":30,"warningThreshold":10,"criticalThreshold":20,"globalCircuitBreakerThreshold":30,"detectors":{"genericRepeat":true,"knownPollNoProgress":true,"pingPong":true}}}}'
  # 用 jq 合并（jq 不可用时降级 Node.js）
  _inject_loopdetect() {
    local config="$1"
    if ! command -v jq &>/dev/null; then
      warn "jq 未安装，尝试用 Node.js 注入..."
      if command -v node &>/dev/null; then
        [ -f "$config" ] && cp "$config" "${config}.bak"
        CONFIG_PATH="$config" NODE_INJECT_BLOCK="$B" node - << 'N'
const fs=require('fs'),p=process.env.CONFIG_PATH,b=JSON.parse(process.env.NODE_INJECT_BLOCK);let r='{}';try{r=fs.readFileSync(p,'utf-8')}catch(e){}
let c={};try{c=JSON.parse(r.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'').replace(/,(\s*[}\]])/g,'$1')||'{}')}catch(e){c={}}
c.tools=Object.assign(c.tools||{},b.tools);fs.writeFileSync(p,JSON.stringify(c,null,2)+'\n')
N
        return $?; else return 1; fi
    fi
    if [ -f "$config" ]; then
      cp "$config" "${config}.bak"; jq '. * '"$B"'' "$config" > "${config}.tmp" 2>/dev/null || {
        warn "配置文件格式异常，已备份为 ${config}.bak"; echo "$B" | jq '.' > "${config}.tmp" 2>/dev/null || return 1; }
    else echo "$B" | jq '.' > "${config}.tmp" 2>/dev/null || return 1; fi
    mv "${config}.tmp" "$config"; return 0
  }
  if [ -f "$CONFIG_FILE" ] && grep -q 'loopDetection' "$CONFIG_FILE" 2>/dev/null; then
    ok "loopDetection 配置已存在，跳过"; _log "loopdetect: already configured"
  elif _inject_loopdetect "$CONFIG_FILE"; then ok "loopDetection 安全配置已生效"; _log "loopdetect: injected into $CONFIG_FILE"
  else warn "loopDetection 注入失败"; warn "请手动将以下配置写入 $CONFIG_FILE："; warn "  https://docs.openclaw.ai/zh-CN/gateway/config-tools"; fi
}
install_daemon() {  # Step 6b: daemon 可选安装
  local OS_TYPE
  OS_TYPE="$(uname -s)"
  # v1.3.7 F-17 修复：本文件由仓库根 install.sh source（install.sh:61 SCRIPT_DIR=仓库根），
  # 故本地路径须拼 engine/scripts/ 前缀（与下行 REMOTE_MODE 的拼法一致）。
  # 原拼 ${SCRIPT_DIR}/daemon-install.sh 探测仓库根（不存在）→ daemon 安装永远静默跳过。
  local DAEMON_INSTALL_SCRIPT="${SCRIPT_DIR}/engine/scripts/daemon-install.sh"
  [ "${REMOTE_MODE:-0}" = "1" ] && DAEMON_INSTALL_SCRIPT="${REMOTE_TMP}/engine/scripts/daemon-install.sh"
  if [ -f "$DAEMON_INSTALL_SCRIPT" ] && [ -x "$DAEMON_INSTALL_SCRIPT" ]; then
    case "$OS_TYPE" in
      Darwin|Linux)
        # --quick / CI：跳过（不交互）；--no-daemon：用户明确要求跳过
        if [ "$QUICK_MODE" = "1" ] || [ "$NO_DAEMON" = "1" ]; then
          echo ""; echo "  ⏭️  跳过 daemon 安装"
          echo "  （以后可以手动运行: bash engine/scripts/daemon-install.sh）"
        else
          echo ""; echo "  ┌──────────────────────────────────────────┐"
          echo "  │  Step 6b: daemon 后台进程（可选）          │"
          echo "  └──────────────────────────────────────────┘"; echo ""
          echo "  daemon 是一个轻量后台进程，监控 think.md / fde.md 变化。"
          echo "  macOS (launchd) / Linux (systemd) 支持，Windows 自动跳过。"
          # 检测是否交互式终端——非 TTY 环境（CI/管道）自动跳过，避免挂死
          if [ -t 0 ]; then
            echo ""; echo "  是否安装 daemon？[y/N] "
            read -r INSTALL_DAEMON
          else
            echo "  ⏭️  非交互环境，自动跳过 daemon 安装"
            INSTALL_DAEMON="n"
          fi
          if [ "${INSTALL_DAEMON:-n}" = "y" ] || [ "${INSTALL_DAEMON:-n}" = "Y" ]; then bash "$DAEMON_INSTALL_SCRIPT"
          else echo "  已跳过 daemon 安装（以后可以手动运行: bash engine/scripts/daemon-install.sh）"; fi
        fi ;;
      *)
        echo ""; echo "  daemon 不支持此系统 ($OS_TYPE)，自动跳过。"
        echo "  Windows 用户：宪法层约束正常生效，daemon 后台监控跳过。" ;;
    esac
  else echo ""; echo "  daemon-install.sh 未找到，跳过 daemon 安装。"; fi
}
