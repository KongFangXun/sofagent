#!/usr/bin/env bash
# ============================================================
# check-version-acceptance.sh · G1 机械门禁（F6.7 护栏）
# ============================================================
# 规则：任一 changelog 若已标「发版完成 / 全绿 / ✅ 已发」，则它的 `- [ ]` 未勾项
#       必须每条都带四态登记（同一行含「转出」或「not-measured」或「部分通过」），
#       否则判红——防「出口判据过了、验收清单还留白」的两把尺子。
# 用法：check-version-acceptance.sh [changelog-root]（默认 docs/changelog）
# 退出：0=通过 · 1=有未登记的留白 · 2=用法/目录问题
set -u
ROOT="${1:-docs/changelog}"
[ -d "$ROOT" ] || { echo "❌ 目录不存在：${ROOT}" >&2; exit 2; }

bad=0; files=0
while IFS= read -r f; do
  files=$((files+1))
  # 已打 tag 的版本 = 已发版 = 考古，不在本门禁范围（门禁只管「未发版却宣称完成」）
  ver="$(basename "$f" .md)"
  if git tag -l "${ver}" 2>/dev/null | grep -q .; then continue; fi

  # 只认**首部状态行**（前 25 行内的 `> 状态…` 行）——正文里出现的「全绿/✅」是历史叙述，不作判据
  if ! head -25 "$f" | grep -qE '^>[^|]*状态[^|]*[✅]|^>[^|]*(发版完成|已发版|全绿)'; then continue; fi
  total=$(grep -c '^- \[ \]' "$f" || true)
  [ "${total:-0}" -eq 0 ] && continue
  # 未勾项里，允许「同行带四态登记」的
  unregistered=$(grep -n '^- \[ \]' "$f" | grep -vcE '转出|not-measured|部分通过' || true)
  if [ "${unregistered:-0}" -gt 0 ]; then
    echo "❌ ${f}：宣称已完成，但仍有 ${unregistered}/${total} 条未勾且未做四态登记" >&2
    grep -n '^- \[ \]' "$f" | grep -vE '转出|not-measured|部分通过' | head -3 | sed 's/^/     /' >&2
    bad=$((bad+1))
  fi
done < <(find "$ROOT" -name '*.md' -type f | sort)

if [ "$bad" -gt 0 ]; then
  echo "❌ G1 门禁失败：${bad} 个文件存在未登记留白（共扫 ${files} 个）" >&2
  exit 1
fi
echo "✅ G1 门禁通过：${files} 个 changelog 无「已宣称完成但留白未登记」"
exit 0
