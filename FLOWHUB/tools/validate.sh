#!/usr/bin/env bash
# validate.sh · Work模板市场 模板格式校验
# 用法: bash tools/validate.sh templates/制造业/应付账款审批/
set -euo pipefail

TEMPLATE_DIR="${1:-}"
if [ -z "$TEMPLATE_DIR" ]; then
  echo "用法: bash tools/validate.sh <模板目录>"
  exit 1
fi

if [ ! -d "$TEMPLATE_DIR" ]; then
  echo "❌ 目录不存在: $TEMPLATE_DIR"
  exit 1
fi

PASS=0
FAIL=0

# 检查 workflow.yml 存在
echo "=== 校验: $TEMPLATE_DIR ==="
if [ -f "$TEMPLATE_DIR/workflow.yml" ]; then
  echo "  ✅ workflow.yml 存在"
  PASS=$((PASS + 1))
else
  echo "  ❌ workflow.yml 缺失"
  FAIL=$((FAIL + 1))
fi

# 检查 README.md 存在
if [ -f "$TEMPLATE_DIR/README.md" ]; then
  echo "  ✅ README.md 存在"
  PASS=$((PASS + 1))
else
  echo "  ❌ README.md 缺失"
  FAIL=$((FAIL + 1))
fi

# 检查 workflow.yml 包含必要字段
if [ -f "$TEMPLATE_DIR/workflow.yml" ]; then
  if grep -q "nodes:" "$TEMPLATE_DIR/workflow.yml"; then
    echo "  ✅ workflow.yml 含 nodes 字段"
    PASS=$((PASS + 1))
  else
    echo "  ❌ workflow.yml 缺少 nodes 字段"
    FAIL=$((FAIL + 1))
  fi

  if grep -q "id:" "$TEMPLATE_DIR/workflow.yml"; then
    echo "  ✅ workflow.yml 含节点 id"
    PASS=$((PASS + 1))
  else
    echo "  ❌ workflow.yml 缺少节点 id"
    FAIL=$((FAIL + 1))
  fi
fi

# 检查子目录结构
for sub in skills knowledge subagents; do
  if [ -d "$TEMPLATE_DIR/$sub" ]; then
    file_count=$(find "$TEMPLATE_DIR/$sub" -type f 2>/dev/null | wc -l | tr -d ' ')
    echo "  ✅ $sub/ 存在（$file_count 个文件）"
    PASS=$((PASS + 1))
  else
    echo "  ⚠️ $sub/ 不存在（可选）"
  fi
done

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
