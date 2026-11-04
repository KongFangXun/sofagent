#!/usr/bin/env bash
# ============================================================
# verify-media.sh · USB A 安装器档的介质校验（fail-closed）
# ============================================================
# 职责单一：核对介质完整性，不做安装。
# 输入：<media-root>，要求含 SHA256SUMS（"<sha256>  <相对路径>" 每行一条）
# 退出码：0=全部通过 · 2=介质/SHA256SUMS 缺失 · 3=校验不符或缺件
# 纪律：只读介质，不改介质；不联网。
set -u

ROOT="${1:-}"
if [ -z "$ROOT" ]; then
  echo "用法: verify-media.sh <media-root>" >&2
  exit 2
fi
if [ ! -d "$ROOT" ]; then
  echo "❌ 介质目录不存在：$ROOT" >&2
  exit 2
fi
SUMS="$ROOT/SHA256SUMS"
if [ ! -f "$SUMS" ]; then
  echo "❌ 介质缺 SHA256SUMS（fail-closed，不回退联网）：$SUMS" >&2
  exit 2
fi
if [ ! -s "$SUMS" ]; then
  echo "❌ SHA256SUMS 为空（fail-closed）：$SUMS" >&2
  exit 2
fi

sha_of () {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else node -e "const c=require('crypto'),f=require('fs');process.stdout.write(c.createHash('sha256').update(f.readFileSync(process.argv[1])).digest('hex'))" "$1"
  fi
}

bad=0; n=0
while IFS= read -r line; do
  [ -z "$line" ] && continue
  case "$line" in \#*) continue;; esac
  want="${line%%  *}"
  rel="${line#*  }"
  [ -z "$want" ] || [ -z "$rel" ] && continue
  p="$ROOT/$rel"
  n=$((n+1))
  if [ ! -f "$p" ]; then
    echo "❌ 缺件：$rel" >&2; bad=$((bad+1)); continue
  fi
  got="$(sha_of "$p")"
  if [ "$got" != "$want" ]; then
    echo "❌ 校验不符：${rel}（期望 ${want:0:16}… 实得 ${got:0:16}…）" >&2
    bad=$((bad+1))
  fi
done < "$SUMS"

if [ "$n" -eq 0 ]; then
  echo "❌ SHA256SUMS 无可校验条目（fail-closed）" >&2
  exit 2
fi
if [ "$bad" -gt 0 ]; then
  echo "❌ 介质校验失败：$bad/$n 件不符——拒绝安装（fail-closed）" >&2
  exit 3
fi
echo "✅ 介质校验通过：$n/$n 件"
exit 0
