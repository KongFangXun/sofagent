#!/bin/bash
# ============================================================
# prepare-fixture.sh · 准备 Task 1 测试套件
# ============================================================
# 从 github.com/cedric123123 克隆测试套件，checkout 到 baseline commit
# 在 docs/benchmark/scripts/fixture/ 下创建干净的测试副本
#
# 用法：./prepare-fixture.sh
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FIXTURE_DIR="${SCRIPT_DIR}/fixture"
REPO_URL="https://github.com/cedric123123/sofagent-test-suite.git"
BASELINE_COMMIT="56160e1"

echo "📋 准备 Task 1 测试套件..."
echo "   仓库: ${REPO_URL}"
echo "   Baseline: ${BASELINE_COMMIT}"
echo "   目标: ${FIXTURE_DIR}"
echo ""

# 如果 fixture 已存在，询问是否覆盖
if [ -d "${FIXTURE_DIR}" ]; then
  echo "⚠️  fixture 目录已存在: ${FIXTURE_DIR}"
  read -p "是否覆盖？(y/N) " -n 1 -r
  echo
  [[ $REPLY =~ ^[Yy]$ ]] || { echo "已取消"; exit 0; }
  rm -rf "${FIXTURE_DIR}"
fi

# 克隆
echo "📥 克隆仓库..."
git clone "${REPO_URL}" "${FIXTURE_DIR}"

# Checkout 到 baseline
cd "${FIXTURE_DIR}"
git checkout "${BASELINE_COMMIT}" 2>/dev/null || {
  echo "⚠️  无法 checkout 到 ${BASELINE_COMMIT}，使用最新 commit"
  echo "   请手动确认 fixture 内容符合 Task 1 定义"
}

# 初始化 git（用于实验后 git diff）
git add -A
git commit -m "baseline (Task 1 fixture)" --allow-empty

echo ""
echo "✅ fixture 准备完成: ${FIXTURE_DIR}"
echo ""
echo "Task 1 文件结构:"
ls -la "${FIXTURE_DIR}/task1-camel-to-snake/src/" 2>/dev/null || ls -la "${FIXTURE_DIR}/src/" 2>/dev/null || echo "（请手动检查 src/ 位置）"
echo ""
echo "下一步:"
echo "  1. cd 到 fixture 的 task1 目录"
echo "  2. 按 docs/benchmark/2026-06-27-skill-chain-vs-prompt.md §3 流程跑实验"
