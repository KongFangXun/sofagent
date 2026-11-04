#!/usr/bin/env bash
# ============================================================
# verify-media.sh · USB A 安装器档的介质校验（fail-closed）
# ============================================================
# 职责单一：核对介质完整性，不做安装。
#
# 契约（F6.7 D-2 ③ 补齐后）：
#   介质根/
#     MANIFEST.json   权威清单（由 s1m/delivery/check-dist.mjs 产出体制；逐字节钉
#                     tools/install/manifest-pin.txt 的指纹——介质自签改不动它）
#     repo/           sofagent 源码树        ← 树聚合（trees[kind=repo]）
#     weights/        判定件权重（按 basename）← 逐件 sha256（files[kind=weights]）
#     gguf/           GGUF（可选）           ← 逐件 sha256（files[kind=gguf]）
#     dsh/            DSH 节点载荷           ← 树聚合（trees[kind=dsh]）
#     Modelfile       Ollama 模型定义        ← 逐件 sha256（files[kind=modelfile]）
#
# 校验三面：
#   ① 清单指纹：MANIFEST.json 的 sha256 必须等于 pin（介质侧无法自签）
#   ② 逐件：files[] 每条 (bytes, sha256) 与介质实际文件一致
#   ③ 集合：trees[] 每个子树重算聚合（文件数/字节数/聚合 sha256 三项全等）
#      —— 多塞一个文件、少一个文件、改一个字节，聚合值必变
#
# 退出码：0=全对 · 2=结构缺失（介质/MANIFEST/必需子树/toolchain）· 3=校验不符 · 4=清单指纹不符
# 纪律：只读介质，不改介质；不联网。
set -u

ROOT="${1:-}"
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIN_FILE="${SOFAGENT_MEDIA_PIN:-${SELF_DIR}/manifest-pin.txt}"
TREE_HASH="${SELF_DIR}/media-tree-hash.mjs"

# 指纹来源优先级：--pin <file> > 环境变量 SOFAGENT_MEDIA_PIN > 仓内 manifest-pin.txt
# （前者仅供测试/预发介质；正式路径恒用仓内 pin）
if [ "${2:-}" = "--pin" ] && [ -n "${3:-}" ]; then PIN_FILE="$3"; fi

[ -n "$ROOT" ] || { echo "用法: verify-media.sh <media-root>" >&2; exit 2; }
[ -d "$ROOT" ] || { echo "❌ 介质目录不存在：$ROOT" >&2; exit 2; }

MANIFEST="$ROOT/MANIFEST.json"
if [ ! -f "$MANIFEST" ]; then
  echo "❌ 介质缺 MANIFEST.json（fail-closed，不回退联网）：$MANIFEST" >&2
  echo "   介质必须携带权威清单；自签 SHA256SUMS 不再被接受（F6.7 D-2 ①）。" >&2
  exit 2
fi
[ -f "$PIN_FILE" ] || { echo "❌ 缺清单指纹文件：$PIN_FILE" >&2; exit 2; }
command -v node >/dev/null 2>&1 || { echo "❌ 需要 node（用于解析清单与树聚合）" >&2; exit 2; }
[ -f "$TREE_HASH" ] || { echo "❌ 缺树聚合工具：$TREE_HASH" >&2; exit 2; }

sha_of () {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else node -e "const c=require('crypto'),f=require('fs');process.stdout.write(c.createHash('sha256').update(f.readFileSync(process.argv[1])).digest('hex'))" "$1"
  fi
}

# ── ① 清单指纹 ────────────────────────────────────────────
PIN_VER="$(awk 'NR==1{print $1}' "$PIN_FILE")"
PIN_SHA="$(awk 'NR==1{print $2}' "$PIN_FILE")"
if [ -z "$PIN_VER" ] || [ -z "$PIN_SHA" ]; then
  echo "❌ 指纹文件格式错（应为「<artifactVersion> <sha256>」）：$PIN_FILE" >&2
  exit 2
fi
if [ "$PIN_VER" = "UNPINNED" ]; then
  echo "❌ 权威清单尚未钉指纹（manifest-pin.txt = UNPINNED）——介质校验不通过（fail-closed）" >&2
  echo "   出介质后用 pack-media.sh 生成 MANIFEST.json，再把其 sha256 与 artifactVersion 写进 pin 并提交。" >&2
  exit 2
fi
GOT_SHA="$(sha_of "$MANIFEST")"
if [ "$GOT_SHA" != "$PIN_SHA" ]; then
  echo "❌ 清单指纹不符——介质 MANIFEST 与权威 pin 不一致（fail-closed）" >&2
  echo "   期望 ${PIN_SHA:0:16}…（pin 记录版本 ${PIN_VER}）" >&2
  echo "   实得 ${GOT_SHA:0:16}…" >&2
  exit 4
fi

# ── ② 逐件 + ③ 集合（解析交给 node，输出「OK/FAIL 行」）──────
RESULT="$(PIN_VER="$PIN_VER" node - "$MANIFEST" "$ROOT" "$TREE_HASH" <<'NODE'
const { readFileSync, statSync, existsSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { basename, join } = require('node:path');
const { execFileSync } = require('node:child_process');

const [manifestPath, root, treeHashTool] = process.argv.slice(2);
const man = JSON.parse(readFileSync(manifestPath, 'utf8'));
const out = [];
let bad = 0;
const fail = (m) => { out.push('FAIL ' + m); bad++; };
const ok = (m) => out.push('OK ' + m);

// kind → 介质内相对位置（判定件按 basename 落 weights/、gguf/；Modelfile 落根部）
const KINDS = {
  weights: { dir: 'weights' },
  gguf: { dir: 'gguf' },
  modelfile: { dir: '' },
};

const sha256file = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

if (!Array.isArray(man.files) || man.files.length === 0) fail('清单 files[] 为空——无可校验条目');

let checkedFiles = 0;
for (const f of man.files ?? []) {
  const k = KINDS[f.kind];
  if (!k) { fail(`未知 kind：${f.kind}（${f.path}）`); continue; }
  const rel = join(k.dir, basename(f.path));
  const p = join(root, rel);
  if (!existsSync(p)) { fail(`缺件：${rel}`); continue; }
  const st = statSync(p);
  if (typeof f.bytes === 'number' && st.size !== f.bytes) {
    fail(`字节数不符：${rel}（期望 ${f.bytes} 实得 ${st.size}）`);
    continue;
  }
  const got = sha256file(p);
  if (got !== f.sha256) { fail(`校验不符：${rel}（期望 ${String(f.sha256).slice(0, 16)}… 实得 ${got.slice(0, 16)}…）`); continue; }
  checkedFiles++;
}
if (checkedFiles > 0) ok(`逐件 ${checkedFiles}/${man.files.length} 件通过`);

// ③ 树聚合：集合绑定（多件/缺件/改字节都会变）
const trees = Array.isArray(man.trees) ? man.trees : [];
if (trees.length === 0) fail('清单缺 trees[]——无法绑文件集合（D-2 ③）');
for (const t of trees) {
  const dir = join(root, t.path ?? '');
  if (!existsSync(dir) || !statSync(dir).isDirectory()) { fail(`载荷子树缺失：${t.path}（kind=${t.kind}）`); continue; }
  let line;
  try {
    line = execFileSync('node', [treeHashTool, dir], { encoding: 'utf8' }).trim();
  } catch (e) {
    fail(`树聚合失败：${t.path}（${String(e.message).split('\n')[0]}）`);
    continue;
  }
  const [files, bytes, agg] = line.split(' ');
  if (Number(files) !== t.files || Number(bytes) !== t.bytes || agg !== t.sha256) {
    fail(`集合不符：${t.path}（期望 ${t.files} 件/${t.bytes} B/${String(t.sha256).slice(0, 16)}…；实得 ${files} 件/${bytes} B/${String(agg).slice(0, 16)}…）`);
    continue;
  }
  ok(`集合 ${t.path}：${files} 件一致（聚合 ${String(agg).slice(0, 16)}…）`);
}
for (const need of ['repo', 'dsh']) {
  if (!trees.some((t) => t.kind === need)) fail(`载荷缺必需单元：${need}（L348 要求 sofagent + 判定件 + DSH 节点三面齐）`);
}

process.stdout.write(out.join('\n') + '\n');
process.exit(bad > 0 ? 3 : 0);
NODE
)"
RC=$?
[ -n "$RESULT" ] && printf '%s\n' "$RESULT" | sed 's/^OK /  ✓ /; s/^FAIL /  ❌ /' >&2

if [ "$RC" -eq 3 ] || printf '%s' "$RESULT" | grep -q '^FAIL '; then
  echo "❌ 介质校验失败——拒绝安装（fail-closed，不回退联网下载）" >&2
  exit 3
fi
echo "✅ 介质校验通过：清单指纹 + 逐件 + 集合三面全对"
exit 0
