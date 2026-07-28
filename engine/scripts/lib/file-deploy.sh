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
  # v1.2.2: agents/ Sub Agent 定义部署（fde / audit / engineer / reviewer）
  local AGENTS_SRC="${SCRIPT_DIR}/SKILL/agents"
  if [ -d "$AGENTS_SRC" ]; then
    for agent_dir in "$AGENTS_SRC"/*/; do
      [ -d "$agent_dir" ] || continue
      local agent_name
      agent_name=$(basename "$agent_dir")
      local agent_dst="${SKILL_DST}/agents/${agent_name}"; mkdir -p "$agent_dst"
      if [ -f "${agent_dir}SKILL.md" ]; then
        dst="${agent_dst}/SKILL.md"
        { [ -f "$dst" ] && cmp -s "${agent_dir}SKILL.md" "$dst" 2>/dev/null; } || { cp "${agent_dir}SKILL.md" "$dst"; ((copied++)) || true; }
      fi
    done
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

  # v1.2.x: releaser Skill 已移除（发版 SOP 迁 docs/changelog/releasing.md，版本号脚本迁 tools/bump-version.sh）

  # v1.2.1: custom/ 用户自定义层部署（P2 设计闭环——安装创建 + 升级三策略保护）
  deploy_custom_dir
}

# ============================================================
# v1.2.1: custom/ 用户自定义层部署（P2 设计闭环）
# ============================================================
# custom/ 是用户私有行为规则的藏身处——官方升级不碰这里。
# 三策略（与 custom/README.md 约定一致）：
#   安装（目标不存在）→ 创建目录 + 部署 README 操作手册
#   安全升级（默认）  → custom/ 不动（用户定制永久保留）
#   --force          → 交互确认（--yes/--quick 跳过）+ 备份 → 恢复官方文件
#   --merge          → 三路合并；冲突生成 .merge-conflict，原始文件不动
# ============================================================

deploy_custom_dir() {
  local CUSTOM_SRC="${SCRIPT_DIR}/SKILL/custom"
  local CUSTOM_DST="${TARGET}/skills/sofagent/custom"
  if [ ! -d "$CUSTOM_SRC" ]; then
    warn "custom/ 源目录不存在: ${CUSTOM_SRC}，跳过用户层部署"
    return 0
  fi

  # 安装：目标不存在 → 创建 + 部署手册
  if [ ! -d "$CUSTOM_DST" ]; then
    mkdir -p "$CUSTOM_DST"
    if [ -f "$CUSTOM_SRC/README.md" ]; then
      cp "$CUSTOM_SRC/README.md" "$CUSTOM_DST/README.md"
    fi
    ok "custom/ 用户自定义层已创建: ${CUSTOM_DST}（README 手册已部署，按命名表新增 *-overrides.md 即生效）"
    return 0
  fi

  # 升级：三策略
  if [ "${MERGE_MODE:-0}" = "1" ]; then
    _merge_custom_dir "$CUSTOM_SRC" "$CUSTOM_DST"
  elif [ "${FORCE_MODE:-0}" = "1" ]; then
    _force_overwrite_custom_dir "$CUSTOM_SRC" "$CUSTOM_DST"
  else
    ok "custom/ 已存在——安全升级策略：跳过（用户定制保留）"
  fi
}

# --force 强制覆盖：列出将被覆盖的文件 → 交互确认 → 备份 → 恢复官方版本
_force_overwrite_custom_dir() {
  local src="$1" dst="$2" f base size answer
  local targets=()
  for f in "$src"/*; do
    [ -f "$f" ] || continue
    base=$(basename "$f")
    [ -f "$dst/$base" ] && targets+=("$base")
  done

  if [ "${#targets[@]}" -gt 0 ]; then
    echo "[sofagent] 检测到 --force，以下 custom/ 文件将被覆盖："
    for base in "${targets[@]}"; do
      size=$(wc -c < "$dst/$base" 2>/dev/null | tr -d ' ')
      echo "  - $base (${size:-?}B)"
    done
    # 交互确认：--yes / --quick / 非交互 stdin 跳过（默认 N 不覆盖原则只护交互场景）
    if [ "${YES_MODE:-0}" != "1" ] && [ "${QUICK_MODE:-0}" != "1" ] && [ -t 0 ]; then
      printf "继续？[y/N] "
      read -r answer
      case "$answer" in
        y|Y|yes|YES) : ;;
        *) echo "[sofagent] 已取消——custom/ 保持原样"; return 0 ;;
      esac
    fi
  fi

  # 覆盖前自动备份到 custom/.backup/{timestamp}/
  local backup_dir
  backup_dir="${dst}/.backup/$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$backup_dir"
  for f in "$dst"/*; do
    [ -f "$f" ] || continue
    cp "$f" "$backup_dir/" 2>/dev/null || true
  done
  # 恢复官方文件（用户新增的 *-overrides.md 不在源中，不受影响——备份仍在）
  for f in "$src"/*; do
    [ -f "$f" ] || continue
    cp "$f" "$dst/$(basename "$f")"
  done
  ok "custom/ 已按 --force 恢复官方版本（备份: ${backup_dir}）"
}

# --merge 三路合并：无冲突自动合并；有冲突生成 .merge-conflict，原始文件不动
_merge_custom_dir() {
  local src="$1" dst="$2" f base merged
  for f in "$src"/*; do
    [ -f "$f" ] || continue
    base=$(basename "$f")
    if [ ! -f "$dst/$base" ]; then
      cp "$f" "$dst/$base"
      ok "custom/ 新增官方文件: $base"
    elif cmp -s "$f" "$dst/$base" 2>/dev/null; then
      : # 内容相同，跳过
    elif command -v git >/dev/null 2>&1 && merged=$(git merge-file -p "$dst/$base" /dev/null "$f" 2>/dev/null); then
      # git merge-file 干净合并（base 为空，双方非重叠新增自动合并）
      printf '%s\n' "$merged" > "$dst/$base"
      ok "custom/ 三路合并完成: $base"
    else
      # 合并冲突 → 生成 .merge-conflict（保留双方内容），不覆盖原始文件
      {
        echo "<<<<<<< 用户版本（custom/${base}）"
        cat "$dst/$base"
        echo "======="
        echo ">>>>>>> 官方版本"
        cat "$f"
      } > "$dst/${base}.merge-conflict"
      warn "custom/ 合并冲突：手动处理 ${base}.merge-conflict（原始文件未动）"
    fi
  done
}
deploy_scripts() {
  # P0-2/P0-3 修复：配套脚本和 .sofagent/ 对所有平台均执行
  [ "${LITE_MODE:-0}" = "1" ] && { info "Lite 模式：跳过配套脚本 + 数据目录"; return 0; }
  info "Step 5b/7 · 部署配套脚本 + 数据目录 → $TARGET"
  local SCRIPTS_DST="${TARGET}/scripts"; mkdir -p "$SCRIPTS_DST"; local script src dst
  for script in task-record.sh cleanup.sh audit.sh; do
    src="${SCRIPT_DIR}/engine/scripts/${script}"; dst="${SCRIPTS_DST}/${script}"
    if [ -f "$src" ]; then cp "$src" "$dst"; chmod +x "$dst"; ok "配套脚本已部署: $dst"
    else warn "找不到 ${script}，跳过"; fi
  done
  src="${SCRIPT_DIR}/engine/scripts/lib/config.sh"; dst="${SCRIPTS_DST}/lib/config.sh"  # 部署共享配置加载器
  if [ -f "$src" ]; then mkdir -p "$(dirname "$dst")"; cp "$src" "$dst"; ok "配置加载器已部署: $dst"
  else warn "找不到 lib/config.sh，跳过"; fi
  if [ ! -d "$SOFAGENT_DATA" ]; then  # 创建 .sofagent/ 数据目录
    mkdir -p "$SOFAGENT_DATA/task/logs" "$SOFAGENT_DATA/orchestrator/workflows"
    chmod 700 "$SOFAGENT_DATA" 2>/dev/null || true; ok "数据目录已创建: $SOFAGENT_DATA"
  else ok "数据目录已存在: $SOFAGENT_DATA"; fi
  # v1.0.1: 创建 knowledge/ 目录骨架
  _deploy_knowledge_skeleton
  # v1.2.1: 创建 .sofagent/custom/ 骨架（Sub Agent 经 buildConstrainedSystemPrompt 读取的位置）
  if [ ! -d "${SOFAGENT_DATA}/custom" ]; then
    mkdir -p "${SOFAGENT_DATA}/custom"
    [ -f "${SCRIPT_DIR}/SKILL/custom/README.md" ] && cp "${SCRIPT_DIR}/SKILL/custom/README.md" "${SOFAGENT_DATA}/custom/README.md"
    ok "custom/ 用户自定义层已创建: ${SOFAGENT_DATA}/custom"
  fi
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
