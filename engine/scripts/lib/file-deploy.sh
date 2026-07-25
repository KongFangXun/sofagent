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
  local SKILL_SRC="${SCRIPT_DIR}/SKILL/harness"
  local SKILL_MAIN="${SCRIPT_DIR}/SKILL/SKILL.md"
  local SKILL_DST="${TARGET}/skills/sofagent"; mkdir -p "$SKILL_DST"; local copied=0 f src dst
  # v1.2.0: SKILL.md 在 SKILL/ 根层，其余约束底座文件在 SKILL/harness/
  if [ -f "$SKILL_MAIN" ]; then
    dst="${SKILL_DST}/SKILL.md"
    { [ -f "$dst" ] && cmp -s "$SKILL_MAIN" "$dst" 2>/dev/null; } || { cp "$SKILL_MAIN" "$dst"; ((copied++)) || true; }
  else warn "找不到 SKILL/SKILL.md，跳过"; fi
  for f in entry-gate.md task-aware.md task-closure.md loop-check.md engage.md engage-fde.md loop-evaluate.md loop-exit.md knowledge-maintain.md; do  # 约束底座文件
    src="${SKILL_SRC}/${f}"; dst="${SKILL_DST}/${f}"
    if [ -f "$src" ]; then
      [ -f "$dst" ] && cmp -s "$src" "$dst" 2>/dev/null && continue
      cp "$src" "$dst"; ((copied++)) || true
    else warn "找不到 ${f}，跳过（源: $src）"; fi
  done
  mkdir -p "${SKILL_DST}/data"
  for f in "$SKILL_SRC"/data/*.md; do  # 数据模板
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

  # v1.1.5: 同步复制 releaser Skill（发版 Agent，按需激活）
  # v1.2.0: 迁移路径 agents/SKILL/sofagent-releaser → LOOP/releaser/releaser-skill
  # 对标 LOOP/loop-install.sh 与 install.sh 的 reviewer/engineer 复制方式
  # ⚠️ 防御：用 ${VAR:-} 防止 set -u 下因罕见瞬态条件导致的 unbound variable
  local AGENT_SKILL_SRC="${SCRIPT_DIR}/../../../LOOP/releaser/releaser-skill"
  local AGENT_SKILL_DST="${TARGET:-}/LOOP/releaser/releaser-skill"
  if [ -n "${AGENT_SKILL_DST:-}" ] && [ -d "${AGENT_SKILL_SRC:-}" ]; then
    mkdir -p "$(dirname "${AGENT_SKILL_DST}")"
    if [ -d "${AGENT_SKILL_DST}" ] && diff -r "${AGENT_SKILL_SRC}" "${AGENT_SKILL_DST}" >/dev/null 2>&1; then
      ok "sofagent-releaser Skill — 已存在且内容相同，跳过"
    else
      cp -r "${AGENT_SKILL_SRC}" "${AGENT_SKILL_DST}"
      ok "sofagent-releaser Skill — 已安装到 ${AGENT_SKILL_DST}（按需激活，仅发版场景使用）"
    fi
  elif [ -z "${AGENT_SKILL_SRC:-}" ] || [ ! -d "${AGENT_SKILL_SRC:-}" ]; then
    warn "sofagent-releaser Skill 未找到: ${AGENT_SKILL_SRC:-未设置}，跳过"
  else
    warn "sofagent-releaser Skill 目标路径无效，跳过"
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
  # v1.0.1: 创建 knowledge/ 目录骨架
  _deploy_knowledge_skeleton
}

# v1.0.1: 创建 .sofagent/knowledge/ 目录结构 + 初始模板
_deploy_knowledge_skeleton() {
  local KB_DIR="${SOFAGENT_DATA}/knowledge"
  mkdir -p "${KB_DIR}/entities" "${KB_DIR}/concepts" "${KB_DIR}/comparisons" "${KB_DIR}/summaries"

  # index.md——AI 自动维护的目录页
  if [ ! -f "${KB_DIR}/index.md" ]; then
    cat > "${KB_DIR}/index.md" << 'IDX'
# 知识库目录

> 此页面由 AI 自动维护——新增知识页面时同步更新。
> daemon Ingest 和 knowledge-maintain Skill 负责写入。

| 页面 | 域 | 可访问节点 |
|------|-----|------------|
IDX
    ok "knowledge/index.md 已创建"
  fi

  # log.md——操作日志
  if [ ! -f "${KB_DIR}/log.md" ]; then
    cat > "${KB_DIR}/log.md" << 'LOG'
# 知识库操作日志

> 自动追加——Ingest / Query / Lint 操作的时间戳记录。

| 时间 | 操作 | 影响页面 | 详情 |
|------|------|---------|------|
LOG
    ok "knowledge/log.md 已创建"
  fi

  ok "knowledge/ 目录骨架就绪: ${KB_DIR}"
}
