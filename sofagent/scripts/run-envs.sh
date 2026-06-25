#!/usr/bin/env bash
# ============================================================
# 在本机把 check-portability.sh 丢进多个真实环境独立执行并汇总
# ============================================================
# 用法（Git Bash / Windows）:  bash sofagent/scripts/run-envs.sh
# 设计：各环境互不依赖，单独成段，方便排查；某环境缺失则跳过、不影响其他。
# ============================================================
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
CHECK="$HERE/check-portability.sh"
sep() { echo; echo "######################## $1 ########################"; }

# 1) 本机 MSYS2 / Git Bash（Windows + GNU coreutils）
sep "本机 MSYS2 (Windows/GNU)"
sh "$CHECK"; echo "[exit $?]"

# 2) WSL Ubuntu（真 Linux/GNU）—— 输出走文件，避开 wsl.exe 的 UTF-16 管道乱码
if command -v wsl.exe >/dev/null 2>&1; then
  sep "WSL Ubuntu (真 Linux/GNU)"
  WIN_TMP="${HOME}/.cpcheck.sh"; WIN_OUT="${HOME}/.cpout.txt"
  cp "$CHECK" "$WIN_TMP"
  # 重定向在 WSL 内部完成 → 输出文件是 UTF-8（直接 cat wsl.exe 的 stdout 会是 UTF-16 乱码）
  MSYS2_ARG_CONV_EXCL='*' wsl.exe -d Ubuntu sh -c "sh '/mnt${WIN_TMP}' > '/mnt${WIN_OUT}' 2>&1"
  cat "$WIN_OUT"
  rm -f "$WIN_TMP" "$WIN_OUT"
else
  sep "WSL Ubuntu"; echo "（无 wsl，跳过）"
fi

# 3) Docker Alpine（真·无 shasum 的 busybox 环境）—— 仅当 docker 引擎在跑
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  sep "Docker Alpine (真·无 shasum / busybox)"
  WINPATH="$(cygpath -w "$HERE" 2>/dev/null || echo "$HERE")"
  docker run --rm -v "${WINPATH}:/t" alpine sh /t/check-portability.sh; echo "[exit $?]"
else
  sep "Docker Alpine"; echo "（docker 引擎未启动，跳过；启动 rancher-desktop 后重跑即可补这一档）"
fi

echo; echo "######################## 汇总完毕 ########################"
