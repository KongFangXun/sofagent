#!/usr/bin/env bash
# 薄包装（家族工具唯一实现住主仓 sofagent/tools/check/——各仓不持有实现副本）
# 用法：bash tools/install-hooks.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMPL="$ROOT/../sofagent/tools/check/install-hooks.sh"
if [ ! -f "$IMPL" ]; then
  echo "❌ 家族工具实现不可得：$IMPL" >&2
  echo "   实现唯一住主仓 tools/check/（定稿 §十二「家族级留总仓 tools/」+ §四 软引用范式）" >&2
  exit 2
fi
exec bash "$IMPL" "$ROOT"
