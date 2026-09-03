#!/usr/bin/env bash
# ============================================================
# tools/train/train-env-init.sh · v1.4.2 章四 · 训练环境一键安装脚本
# ============================================================
#
# 定位：train env init 的脚本化形态——可打包进设备、可在装好系统的
# 新机器上一条命令装好训练环境（对齐 devlog 表：venv + 框架 + CUDA 校验）。
#
# 分支逻辑（与 engine/orchestrator/src/train/env-manager.ts 的
# trainEnvInit 同一套判定——单一事实源是 env-manager，本脚本是
# 「无 Node 环境也能装」的等价实现）：
#   1. 有 nvidia-smi + CUDA     → 生产分支：pip3 install verl
#   2. 无 CUDA + darwin（Mac）  → 降级分支：npm --prefix 隔离安装
#                                 @mlx-node/trl（对齐 v1.4.1
#                                 defaultMlxInstallDir）
#   3. 都没有                   → 提示装 Python 3.10+ / CUDA 驱动后重跑
#
# 用法：
#   bash tools/train/train-env-init.sh [data_dir] [enterprise_id]
#   （缺省 data_dir=./data，enterprise_id=default——与 train_doctor 同口径）
#
# 产物：{data_dir}/train/{enterprise_id}/train-env.json（版本清单——
# train job 冻结指纹引用的可复现口径；与 env-manager 写的格式一致）
# ============================================================
set -euo pipefail

DATA_DIR="${1:-./data}"
ENTERPRISE_ID="${2:-default}"
MANIFEST_DIR="${DATA_DIR}/train/${ENTERPRISE_ID}"
MANIFEST_FILE="${MANIFEST_DIR}/train-env.json"
MLX_INSTALL_DIR="${MLX_INSTALL_DIR:-${TMPDIR:-/tmp}/sofagent-train-env}"

log()  { printf '\033[36m[sofagent]\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m  ✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m  ⚠\033[0m %s\n' "$*"; }
fail() { printf '\033[31m  ✗\033[0m %s\n' "$*"; }

log "训练环境一键安装（train env init）→ ${MANIFEST_FILE}"

mkdir -p "${MANIFEST_DIR}"

# ── 1. Python 探测（两分支的前置） ─────────────────────────
PYTHON_VERSION=""
if command -v python3 >/dev/null 2>&1; then
  PYTHON_VERSION="$(python3 --version 2>/dev/null | sed -E 's/^Python[[:space:]]+//' || true)"
fi
if [[ -n "${PYTHON_VERSION}" ]]; then
  ok "python-detect: Python ${PYTHON_VERSION}"
else
  fail "python-detect: python3 不可用——先装 Python 3.10+ 再重跑本脚本"
fi

# ── 2. GPU 检测（CUDA 优先，darwin 回落 Metal） ────────────
GPU_KIND="none"
GPU_NAME=""
CUDA_VERSION=""
METAL_SUPPORT=""

if command -v nvidia-smi >/dev/null 2>&1; then
  CUDA_VERSION="$(nvidia-smi 2>/dev/null | grep -oE 'CUDA Version: *[0-9.]+' | grep -oE '[0-9.]+' | head -1 || true)"
  if [[ -n "${CUDA_VERSION}" ]]; then
    GPU_KIND="cuda"
    GPU_NAME="$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1 | tr -d ' ' || echo 'NVIDIA GPU')"
    ok "gpu-detect: ${GPU_NAME} · CUDA ${CUDA_VERSION}（生产分支）"
  fi
fi

if [[ "${GPU_KIND}" == "none" && "$(uname -s)" == "Darwin" ]]; then
  METAL_SUPPORT="$(system_profiler SPDisplaysDataType 2>/dev/null | grep -oE 'Metal Support: *Metal [0-9]+' | grep -oE 'Metal [0-9]+' | head -1 || true)"
  if [[ -n "${METAL_SUPPORT}" ]]; then
    GPU_KIND="metal"
    GPU_NAME="$(system_profiler SPDisplaysDataType 2>/dev/null | grep -m1 'Chipset Model' | sed -E 's/.*Chipset Model: *//' || echo 'Apple Silicon')"
    ok "gpu-detect: ${GPU_NAME} · ${METAL_SUPPORT}（降级分支）"
  fi
fi

if [[ "${GPU_KIND}" == "none" ]]; then
  warn "gpu-detect: 未检测到可用 GPU（CUDA / Metal 均无）"
fi

# ── 3. 框架安装（分支决定） ────────────────────────────────
FRAMEWORK_NAME=""
FRAMEWORK_VERSION=""
PACKAGE_MANAGER="pip3"

if [[ "${GPU_KIND}" == "cuda" && -n "${PYTHON_VERSION}" ]]; then
  # 生产分支：pip3 装 verl（DEFAULT_CUDA_FRAMEWORK 同名约定）
  PACKAGE_MANAGER="pip3"
  FRAMEWORK_NAME="verl"
  log "framework-install: pip3 install ${FRAMEWORK_NAME}（可能耗时数分钟）"
  if pip3 install "${FRAMEWORK_NAME}" >/dev/null 2>&1; then
    FRAMEWORK_VERSION="$(python3 -c 'import verl; print(verl.__version__)' 2>/dev/null || true)"
    if [[ -n "${FRAMEWORK_VERSION}" ]]; then
      ok "framework-verify: verl@${FRAMEWORK_VERSION}"
    else
      warn "framework-verify: 安装完成但版本探测失败——检查 python3 能否 import verl"
    fi
  else
    fail "framework-install: pip3 install verl 失败（网络/依赖问题——检查 pip 源后重跑）"
  fi
elif [[ "${GPU_KIND}" == "metal" ]]; then
  # 降级分支：npm --prefix 隔离安装（对齐 v1.4.1 defaultMlxInstallDir）
  PACKAGE_MANAGER="npm"
  FRAMEWORK_NAME="@mlx-node/trl"
  if command -v npm >/dev/null 2>&1; then
    log "framework-install: npm install ${FRAMEWORK_NAME} --prefix ${MLX_INSTALL_DIR}"
    if npm install "${FRAMEWORK_NAME}" --prefix "${MLX_INSTALL_DIR}" >/dev/null 2>&1; then
      FRAMEWORK_VERSION="$(node -e "console.log(require('${MLX_INSTALL_DIR}/node_modules/${FRAMEWORK_NAME}/package.json').version)" 2>/dev/null || true)"
      if [[ -n "${FRAMEWORK_VERSION}" ]]; then
        ok "framework-verify: ${FRAMEWORK_NAME}@${FRAMEWORK_VERSION}"
      else
        warn "framework-verify: 安装完成但版本探测失败"
      fi
    else
      fail "framework-install: npm install ${FRAMEWORK_NAME} 失败（@mlx-node/trl 是实验包——网络不可达或包未发布时属预期，生产训练走 CUDA 服务器）"
    fi
  else
    warn "framework-install: npm 不可用——降级分支需要 Node.js（先装 Node 18+ 再重跑）"
  fi
else
  warn "framework-install: 跳过（无可用 GPU 或 Python——先补齐前置再重跑）"
fi

# ── 4. 版本清单落盘（train-env.json——与 env-manager 同格式） ──
# JSON 由 python3 生成（转义安全——bash 拼接易出引号事故）
if [[ -n "${PYTHON_VERSION}" ]]; then
  PYTHON_VERSION="${PYTHON_VERSION}" GPU_KIND="${GPU_KIND}" GPU_NAME="${GPU_NAME}" \
    CUDA_VERSION="${CUDA_VERSION}" METAL_SUPPORT="${METAL_SUPPORT}" \
    FRAMEWORK_NAME="${FRAMEWORK_NAME}" FRAMEWORK_VERSION="${FRAMEWORK_VERSION}" \
    PACKAGE_MANAGER="${PACKAGE_MANAGER}" \
    python3 - "${MANIFEST_FILE}" <<'PYEOF'
import datetime
import json
import os
import sys

manifest = {
    "schemaVersion": "v1",
    "pythonVersion": os.environ.get("PYTHON_VERSION") or None,
    "framework": None,
    "cudaVersion": os.environ.get("CUDA_VERSION") or None,
    "gpu": None,
    "packageManager": os.environ.get("PACKAGE_MANAGER") or "pip3",
    "platform": {"Darwin": "darwin", "Linux": "linux"}.get(
        os.uname().sysname, os.uname().sysname.lower()
    ),
    "generatedAt": datetime.datetime.now(datetime.timezone.utc)
    .replace(microsecond=0)
    .isoformat()
    + "Z",
}
kind = os.environ.get("GPU_KIND")
name = os.environ.get("GPU_NAME")
if kind == "cuda":
    manifest["gpu"] = {
        "kind": "cuda",
        "name": name,
        "cudaVersion": os.environ.get("CUDA_VERSION") or None,
    }
elif kind == "metal":
    manifest["gpu"] = {
        "kind": "metal",
        "name": name,
        "metalSupport": os.environ.get("METAL_SUPPORT") or None,
    }
fw_name = os.environ.get("FRAMEWORK_NAME")
fw_ver = os.environ.get("FRAMEWORK_VERSION")
if fw_name and fw_ver:
    manifest["framework"] = {"name": fw_name, "version": fw_ver}

# v1.4.3 第八章：反作弊基线默认配置落盘（reward hacking 四形态双防线——
# ① 断历史回溯：数据集 .git 剥离 + 沙箱 git 禁用；② 断外联通道：出网默认
# 拦截 + 白名单放行。机制开源、阈值外部化（改 networkAllowlist 生效））
manifest["anticheat"] = {
    "stripDatasetGit": True,
    "disableGitInSandbox": True,
    "networkAllowlist": [
        "hf-mirror.com",
        ".hf-mirror.com",
        "mirrors.tuna.tsinghua.edu.cn",
        "pypi.tuna.tsinghua.edu.cn",
    ],
}

with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump(manifest, f, indent=2, ensure_ascii=False)
PYEOF
else
  # 无 python3 的兜底：bash 手写 JSON（值均为 null / 纯 ASCII——无转义风险）
  # v1.4.3 第八章：反作弊基线默认配置同样落盘（纯 ASCII 手写段）
  printf '{\n  "schemaVersion": "v1",\n  "pythonVersion": null,\n  "framework": null,\n  "cudaVersion": null,\n  "gpu": null,\n  "packageManager": "%s",\n  "platform": "%s",\n  "anticheat": {\n    "stripDatasetGit": true,\n    "disableGitInSandbox": true,\n    "networkAllowlist": ["hf-mirror.com", ".hf-mirror.com", "mirrors.tuna.tsinghua.edu.cn", "pypi.tuna.tsinghua.edu.cn"]\n  },\n  "generatedAt": "%s"\n}\n' \
    "${PACKAGE_MANAGER}" "$(uname -s | tr '[:upper:]' '[:lower:]')" \
    "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" > "${MANIFEST_FILE}"
fi

ok "manifest: ${MANIFEST_FILE}"
ok "反作弊基线已落默认配置（.git 剥离 + git 禁用 + 出网白名单——v1.4.3 第八章）"
log "完成。体检环境：MCP train_doctor（四项 + 反作弊三项——dataset_mount_path 传数据集挂载点可查 .git 可见性）"
