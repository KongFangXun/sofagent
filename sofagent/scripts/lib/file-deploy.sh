#!/bin/bash
# file-deploy.sh · 文件部署（Step 4 宪法 / Step 5 Skill / Step 5b 脚本）
# 导出：deploy_constitution / deploy_skill_files / deploy_scripts

deploy_constitution() {
  info "Step 4/7 · 部署宪法文件 → $TARGET"; mkdir -p "$TARGET"
  # OpenClaw: fde.md → skills/sofagent/（~/.openclaw/fde.md 留给用户自定义）；其他平台 → $TARGET/
  if [ "$PLATFORM" = "openclaw" ]; then
    local RULES_DST_DIR="${TARGET}/skills/sofagent"; mkdir -p "$RULES_DST_DIR"
    local RULES_DST="${RULES_DST_DIR}/fde.md"
    if [ -f "$RULES_SRC" ]; then
      if [ -f "$RULES_DST" ] && cmp -s "$RULES_SRC" "$RULES_DST" 2>/dev/null; then ok "fde.md — 已存在且内容相同，跳过（${RULES_DST_DIR}）"
      else [ -f "$RULES_DST" ] && cp "$RULES_DST" "${RULES_DST}.bak"; cp "$RULES_SRC" "$RULES_DST"; ok "fde.md — 已安装到 ${RULES_DST_DIR}"; fi
    else err "fde.md — 源文件不存在: $RULES_SRC"; fi
    # v0.73: 旧路径迁移 constitution/fde.md → fde.md
    local OLD_RULES="${TARGET}/skills/sofagent/constitution/fde.md"
    if [ -f "$OLD_RULES" ]; then
      warn "检测到旧路径 constitution/fde.md，自动迁移到新路径 fde.md..."
      if cp "$OLD_RULES" "$RULES_DST" 2>/dev/null; then
        ok "已迁移到 ${RULES_DST}"
      else
        warn "迁移失败，请手动复制"
      fi
      rm -f "$OLD_RULES"; rmdir "$(dirname "$OLD_RULES")" 2>/dev/null || true; ok "旧 constitution/ 目录已清理"
    fi
    warn "$HOME/.openclaw/fde.md 保留为用户自定义文件，不会被覆盖"
  else
    local f src dst; f="fde.md"; src="${SCRIPT_DIR}/../${f}"; dst="${TARGET}/${f}"
    if [ -f "$src" ]; then
      if [ -f "$dst" ]; then
        if cmp -s "$src" "$dst" 2>/dev/null; then ok "$f — 已存在且内容相同，跳过"
        else warn "$f — 已有内容不同，已备份为 ${f}.bak → 覆盖更新"; cp "$dst" "${dst}.bak"; cp "$src" "$dst"; fi
      else cp "$src" "$dst"; ok "$f — 已安装"; fi
    else err "$f — 源文件不存在: $src"; fi
  fi
}
deploy_skill_files() {
  info "Step 5/7 · 部署 Skill 文件 → $TARGET/skills/sofagent"
  local SKILL_DST="${TARGET}/skills/sofagent"; mkdir -p "$SKILL_DST"; local copied=0 f src dst
  for f in SKILL.md entry-gate.md task-aware.md task-closure.md loop-check.md; do  # 核心 Skill 文件
    src="${SCRIPT_DIR}/../${f}"; dst="${SKILL_DST}/${f}"
    if [ -f "$src" ]; then
      [ -f "$dst" ] && cmp -s "$src" "$dst" 2>/dev/null && continue
      cp "$src" "$dst"; ((copied++)) || true
    else warn "找不到 ${f}，跳过（源: $src）"; fi
  done
  mkdir -p "${SKILL_DST}/data"
  for f in "$SCRIPT_DIR"/../data/*.md; do  # 数据模板
    [ -f "$f" ] || continue; dst="${SKILL_DST}/data/$(basename "$f")"
    [ -f "$dst" ] && cmp -s "$f" "$dst" 2>/dev/null && continue
    cp "$f" "$dst"; ((copied++)) || true
  done
  dst="${SKILL_DST}/fde.md"  # fde.md — 使 SKILL.md 的相对路径可解析
  if [ -f "$RULES_SRC" ]; then
    { [ -f "$dst" ] && cmp -s "$RULES_SRC" "$dst" 2>/dev/null; } || { cp "$RULES_SRC" "$dst"; ((copied++)) || true; }
  fi
  if [ "$copied" -gt 0 ]; then
    ok "$copied 个 Skill/数据文件已部署到 $SKILL_DST"
  else
    ok "Skill 文件全部就绪（无变更）"
  fi
  # v0.84: SKILL.md 部署后确保 disable: true（防止安装副本被平台自动加载）
  local DEPLOYED_SKILL="${SKILL_DST}/SKILL.md"
  if [ -f "$DEPLOYED_SKILL" ] && ! grep -q "^disable:" "$DEPLOYED_SKILL" 2>/dev/null; then
    if grep -q "^displayName:" "$DEPLOYED_SKILL" 2>/dev/null; then  # 在 displayName 行下方插入
      sed -i.bak '/^displayName:/a\
disable: true
' "$DEPLOYED_SKILL" 2>/dev/null && rm -f "${DEPLOYED_SKILL}.bak"
    else  # 在 name: 之后插入
      sed -i.bak '/^name:/a\
disable: true
' "$DEPLOYED_SKILL" 2>/dev/null && rm -f "${DEPLOYED_SKILL}.bak"
    fi
  fi
  # Lite 模式：创建 think.md 空模板
  if [ "${LITE_MODE:-0}" = "1" ]; then
    mkdir -p "$SOFAGENT_DATA"  # v0.90 P0-2 修复：Lite 跳过 Step 5b，需提前创建数据目录
    local THINK_DST="${SOFAGENT_DATA}/think.md"
    if [ ! -f "$THINK_DST" ]; then
      cat > "$THINK_DST" << 'T'
# 反思区（think.md）

> sofagent 反思区——自动记录每次任务的教训和经验。
> 任务闭环后由 task-closure 自动更新，30 天衰减。

（暂无反思记录）
T
      ok "think.md 模板已创建: $THINK_DST"
    else ok "think.md 已存在，跳过"; fi
  fi
}
deploy_scripts() {
  # P0-2/P0-3 修复：配套脚本和 .sofagent/ 对所有平台均执行
  [ "${LITE_MODE:-0}" = "1" ] && { info "Lite 模式：跳过配套脚本 + 数据目录"; return 0; }
  info "Step 5b/7 · 部署配套脚本 + 数据目录 → $TARGET"
  local SCRIPTS_DST="${TARGET}/scripts"; mkdir -p "$SCRIPTS_DST"; local script src dst
  for script in task-record.sh cleanup.sh audit.sh; do
    src="${SCRIPT_DIR}/${script}"; dst="${SCRIPTS_DST}/${script}"
    if [ -f "$src" ]; then cp "$src" "$dst"; chmod +x "$dst"; ok "配套脚本已部署: $dst"
    else warn "找不到 ${script}，跳过"; fi
  done
  src="${SCRIPT_DIR}/lib/config.sh"; dst="${SCRIPTS_DST}/lib/config.sh"  # 部署共享配置加载器
  if [ -f "$src" ]; then mkdir -p "$(dirname "$dst")"; cp "$src" "$dst"; ok "配置加载器已部署: $dst"
  else warn "找不到 lib/config.sh，跳过"; fi
  if [ ! -d "$SOFAGENT_DATA" ]; then  # 创建 .sofagent/ 数据目录
    mkdir -p "$SOFAGENT_DATA/task/logs" "$SOFAGENT_DATA/orchestrator/workflows"
    chmod 700 "$SOFAGENT_DATA" 2>/dev/null || true; ok "数据目录已创建: $SOFAGENT_DATA"
  else ok "数据目录已存在: $SOFAGENT_DATA"; fi
}
