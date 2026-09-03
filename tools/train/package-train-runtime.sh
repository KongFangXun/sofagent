#!/usr/bin/env bash
# ============================================================
# tools/train/package-train-runtime.sh · v1.4.3 第三章 · 训练运行时打包脚本
# ============================================================
#
# 定位：训练管线（train-submit + 数据管道 + QLoRA 配置模板 + 沙箱）
# 打包成可拷贝交付形态（U 盘/电脑）——「提供训练管线」的轻量化交付。
# 客户机房离线可训：目标机器解包 → bash setup.sh → 训练环境就绪。
#
# 打包内容（自足清单——目标机器无需 Node/npm/互联网）：
#   1. engine/orchestrator dist（训练编排控制面——train-scheduler 等）
#   2. engine/core dist（atomicWrite 等基础设施）
#   3. FDE/templates/post-training（后训练 workflow 模板）
#   4. tools/train/train-env-init.sh（环境安装脚本——目标机器首跑）
#   5. tools/train/package-train-runtime.sh 自身（解包后 setup 入口）
#   6. 基座模型缓存（可选——MODELS=1 时含 data/models/，U 盘形态默认含）
#
# 用法：
#   bash tools/train/package-train-runtime.sh [输出目录] [--with-models]
#   （缺省输出 ./dist-train-runtime/；--with-models 附带基座缓存）
#
# 产物：<输出>/sofagent-train-runtime-<date>.tar.gz + setup.sh
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

OUT_DIR="${1:-./dist-train-runtime}"
WITH_MODELS=0
if [[ "${2:-}" == "--with-models" ]]; then
  WITH_MODELS=1
fi

STAGE_DIR="${OUT_DIR}/sofagent-train-runtime"
STAMP="$(date +%Y%m%d)"
ARCHIVE="${OUT_DIR}/sofagent-train-runtime-${STAMP}.tar.gz"

log()  { printf '\033[36m[sofagent]\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m  ✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m  ⚠\033[0m %s\n' "$*"; }
fail() { printf '\033[31m  ✗\033[0m %s\n' "$*"; }

log "训练运行时打包（package-train-runtime）→ ${ARCHIVE}"

# ── 前置检查：orchestrator 必须已构建（dist 存在）──
if [[ ! -f "${REPO_ROOT}/engine/orchestrator/dist/index.js" ]]; then
  fail "engine/orchestrator/dist 不存在——先在联网机器执行 npm run build --workspace=engine/orchestrator"
  exit 1
fi
if [[ ! -f "${REPO_ROOT}/engine/core/dist/index.js" ]]; then
  fail "engine/core/dist 不存在——先在联网机器执行 npm run build --workspace=engine/core"
  exit 1
fi

# ── 组装 staging 目录 ──
rm -rf "${STAGE_DIR}"
mkdir -p "${STAGE_DIR}/engine"
mkdir -p "${STAGE_DIR}/FDE/templates"
mkdir -p "${STAGE_DIR}/tools"
mkdir -p "${STAGE_DIR}/data"

# 1. 引擎 dist（控制面 + 基础设施）
cp -R "${REPO_ROOT}/engine/orchestrator/dist" "${STAGE_DIR}/engine/orchestrator-dist"
cp -R "${REPO_ROOT}/engine/core/dist" "${STAGE_DIR}/engine/core-dist"
ok "引擎 dist 已收编（orchestrator + core）"

# 2. 后训练 workflow 模板（FDE 载体）
if [[ -d "${REPO_ROOT}/FDE/templates/post-training" ]]; then
  cp -R "${REPO_ROOT}/FDE/templates/post-training" "${STAGE_DIR}/FDE/templates/post-training"
  ok "后训练 workflow 模板已收编"
else
  warn "FDE/templates/post-training 不存在（跳过——模板非训练运行时硬依赖）"
fi

# 3. 环境安装脚本 + 自身
cp "${REPO_ROOT}/tools/train/train-env-init.sh" "${STAGE_DIR}/tools/train-env-init.sh"
chmod +x "${STAGE_DIR}/tools/train-env-init.sh"
cp "${SCRIPT_DIR}/${BASH_SOURCE[0]##*/}" "${STAGE_DIR}/tools/package-train-runtime.sh" 2>/dev/null || true
ok "安装脚本已收编（train-env-init.sh）"

# 4. 基座模型缓存（可选——U 盘交付形态默认带）
if [[ ${WITH_MODELS} -eq 1 ]]; then
  if [[ -d "${REPO_ROOT}/data/models" ]]; then
    cp -R "${REPO_ROOT}/data/models" "${STAGE_DIR}/data/models"
    ok "基座模型缓存已收编（$(ls "${REPO_ROOT}/data/models" 2>/dev/null | wc -l | tr -d ' ') 个模型）"
  else
    warn "data/models 不存在——目标机器需手动放置基座（或 model-downloader 预下载）"
  fi
fi

# 5. setup.sh（目标机器入口——解包后首跑）
cat > "${STAGE_DIR}/setup.sh" <<'SETUP'
#!/usr/bin/env bash
# 训练运行时安装入口（目标机器——离线可用，不依赖互联网与 Node）
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "[sofagent] 训练运行时安装 → ${HERE}/data"
mkdir -p "${HERE}/data/train/default"
# 环境安装（Python venv + 训练框架 + CUDA 校验——离线 pip 需现场 wheel 或内网镜像）
bash "${HERE}/tools/train-env-init.sh" "${HERE}/data" "default"
echo "[sofagent] 安装完成——训练编排控制面：${HERE}/engine/orchestrator-dist/index.js"
echo "[sofagent] 验证：node ${HERE}/engine/orchestrator-dist/cli.js train doctor"
SETUP
chmod +x "${STAGE_DIR}/setup.sh"
ok "setup.sh 已生成（目标机器入口）"

# 6. README（交付物说明——十分钟上手口径）
cat > "${STAGE_DIR}/README.txt" <<'README'
sofagent 训练运行时（v1.4.3 第三章 · 设备交付形态）

一、解包：tar -xzf sofagent-train-runtime-*.tar.gz
二、安装：bash setup.sh（Python venv + 训练框架 + CUDA 校验）
三、体检：node engine/orchestrator-dist/cli.js train doctor
四、训练：经 MCP train_submit 提交（或直接调用 orchestrator dist）

离线说明：
  - 安装阶段 pip 依赖需现场 wheel 包或内网 PyPI 镜像（setup.sh 会提示）
  - 基座模型缓存在 data/models/（--with-models 打包时含）——离线可用
  - 训练沙箱默认拦出网（白名单空=全拦）——离线训练不受影响

数据主权：
  - 数据集挂载只读（训练过程不可污染源数据）
  - 产物只写 output/ 目录（checkpoint/日志/报告）
  - 全程审计：data/train/<企业>/<jobId>/ 下 job.json/state.json/events.jsonl
README
ok "README.txt 已生成（十分钟上手口径）"

# ── 打 tar 包 ──
mkdir -p "${OUT_DIR}"
tar -czf "${ARCHIVE}" -C "${OUT_DIR}" "$(basename "${STAGE_DIR}")"
SIZE="$(du -sh "${ARCHIVE}" 2>/dev/null | cut -f1 || echo '?')"
ok "打包完成：${ARCHIVE}（${SIZE}）"

log "交付清单：tar 包 + staging 目录（${STAGE_DIR}）——拷贝 tar 包到目标机器解包即用"
