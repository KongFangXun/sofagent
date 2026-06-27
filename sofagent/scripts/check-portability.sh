#!/bin/sh
# ============================================================
# sofagent 跨平台修复自检（对应上游 PR #1）
# ============================================================
# 目标：在「任意」环境独立执行，验证两处确定性修复在当前平台成立。
#   修复1  task-orchestrate.sh TASK_SLUG —— shasum 缺失时回退 sha256sum
#   修复2  verify.sh think.md mtime —— GNU `stat -c %Y` / BSD `stat -f %m` 回退
#
# 纯 POSIX sh，无 bashism，可在 Alpine(busybox) / Ubuntu / macOS / MSYS2 直接跑：
#   sh check-portability.sh
# 退出码：0=全过，1=有失败（方便 CI / 排查）
# ============================================================
set -u
pass=0; fail=0
ok() { echo "  [PASS] $1"; pass=$((pass + 1)); }
ng() { echo "  [FAIL] $1"; fail=$((fail + 1)); }
is_hex8() { case "$1" in [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) return 0 ;; *) return 1 ;; esac; }

echo "== 环境 =="
echo "  uname    : $(uname -s) $(uname -m)"
echo "  stat     : $(stat --version 2>/dev/null | head -1 || echo '非GNU（BSD/busybox）')"
echo "  shasum   : $(command -v shasum 2>/dev/null || echo 无)"
echo "  sha256sum: $(command -v sha256sum 2>/dev/null || echo 无)"
echo

echo "== 修复1：TASK_SLUG（缺 shasum 回退 sha256sum）=="
slug=$(printf '%s' "sofagent-task" | { shasum -a 256 2>/dev/null || sha256sum 2>/dev/null; } | cut -c1-8)
if is_hex8 "$slug"; then ok "正常环境 slug=$slug（8 位十六进制）"; else ng "正常环境 slug 非法：'$slug'"; fi
# 模拟 shasum 缺失：临时目录放一个必失败的 shasum stub，前插 PATH
d=$(mktemp -d 2>/dev/null || { d=/tmp/nob.$$; mkdir -p "$d"; echo "$d"; })
printf '#!/bin/sh\nexit 127\n' > "$d/shasum"; chmod +x "$d/shasum"
slug2=$(PATH="$d:$PATH" sh -c 'printf "%s" sofagent-task | { shasum -a 256 2>/dev/null || sha256sum 2>/dev/null; } | cut -c1-8')
rm -rf "$d"
if is_hex8 "$slug2"; then ok "缺 shasum 回退 slug=$slug2"; else ng "缺 shasum 回退失败：'$slug2'（这正是上游 bug）"; fi
if [ "$slug" = "$slug2" ]; then ok "回退透明（两次哈希一致）"; else ng "回退哈希不一致：$slug vs $slug2"; fi
echo

echo "== 修复2：stat 取 mtime（GNU -c%Y / BSD -f%m 回退）=="
f=$(mktemp 2>/dev/null || { f=/tmp/t.$$; echo "$f"; }); : > "$f"
now=$(date +%s)
mt=$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null || echo "")
# 对照：上游旧写法只有 BSD 语法（只取首行，避免 GNU 上 -f 吐出整块文件系统信息）
old=$(stat -f %m "$f" 2>/dev/null | head -1)
rm -f "$f"
case "$mt" in
  '' | *[!0-9]*) ng "新写法未取到数字 mtime：'$mt'" ;;
  *) age=$((now - mt)); if [ "$age" -ge 0 ] && [ "$age" -le 5 ]; then ok "新写法 mtime=$mt 年龄=${age}s（正确）"; else ng "mtime 异常 age=${age}s"; fi ;;
esac
case "$old" in
  '')        echo "  （参考）旧写法 stat -f %m：失败/无输出（本平台不支持该 BSD 语法）" ;;
  *[!0-9]*)  echo "  （参考）旧写法 stat -f %m：取不到 mtime（GNU 上 -f=--file-system）← bug 本体" ;;
  *)         echo "  （参考）旧写法 stat -f %m = $old（本平台为 BSD/macOS 风格，恰好可用）" ;;
esac
echo

echo "== 结果：$pass 通过 / $fail 失败 =="
[ "$fail" -eq 0 ]
