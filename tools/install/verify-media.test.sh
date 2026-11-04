#!/usr/bin/env bash
# 三态单测：介质缺失 / 校验失败 / 正常
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
V="$HERE/verify-media.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0
chk () { # chk <期望退出码> <描述> <命令...>
  want="$1"; desc="$2"; shift 2
  "$@" >/dev/null 2>&1; got=$?
  if [ "$got" = "$want" ]; then echo "  ✓ ${desc}（exit ${got}）"; pass=$((pass+1));
  else echo "  × ${desc}（期望 exit ${want}，实得 ${got}）"; fail=$((fail+1)); fi
}

# ① 介质缺失
chk 2 "介质目录缺失 ⇒ exit 2" bash "$V" "$TMP/nope"

# ② 缺 SHA256SUMS
mkdir -p "$TMP/m2"
chk 2 "缺 SHA256SUMS ⇒ exit 2" bash "$V" "$TMP/m2"

# ③ 校验失败（清单写错 sha）
mkdir -p "$TMP/m3"
echo "hello" > "$TMP/m3/payload.txt"
printf '%s  %s\n' "0000000000000000000000000000000000000000000000000000000000000000" "payload.txt" > "$TMP/m3/SHA256SUMS"
chk 3 "sha 不符 ⇒ exit 3" bash "$V" "$TMP/m3"

# ④ 缺件（清单列了但文件不在）
mkdir -p "$TMP/m4"
printf '%s  %s\n' "aa11" "ghost.bin" > "$TMP/m4/SHA256SUMS"
chk 3 "清单列件但介质缺件 ⇒ exit 3" bash "$V" "$TMP/m4"

# ⑤ 正常（真算 sha 写清单）
mkdir -p "$TMP/m5"
echo "sofagent-media-ok" > "$TMP/m5/repo.tar"
S=$(shasum -a 256 "$TMP/m5/repo.tar" | cut -d' ' -f1)
printf '%s  %s\n' "$S" "repo.tar" > "$TMP/m5/SHA256SUMS"
chk 0 "介质完整 ⇒ exit 0" bash "$V" "$TMP/m5"

echo "—— verify-media: pass=$pass fail=$fail"
[ "$fail" -eq 0 ] || exit 1
