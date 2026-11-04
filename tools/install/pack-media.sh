#!/usr/bin/env bash
# ============================================================
# pack-media.sh · 组装 USB A 安装器档介质（F6.7 D-2 ②）
# ============================================================
# 职责：把一个断网可装的介质根拼出来，并写出**权威清单** MANIFEST.json。
#       verify-media.sh 只认这份清单（+ manifest-pin.txt 的指纹），介质侧
#       不再自签 SHA256SUMS。
#
# 产物布局：
#   <out>/MANIFEST.json   清单（artifactVersion + files[] + trees[] + deliveryManifest）
#   <out>/repo/           sofagent 源码快照（含 install.sh）
#   <out>/weights/        判定件权重（6 件，按 basename）
#   <out>/gguf/           GGUF（给了 --gguf 才有）
#   <out>/dsh/            DSH 节点载荷
#   <out>/Modelfile       Ollama 模型定义
#
# 用法：
#   pack-media.sh --out <dir> --repo <sofagent 树> --weights <权重目录> \
#                 --dsh <DSH 载荷目录> [--gguf <file>] [--modelfile <file>] \
#                 [--delivery-manifest <factory s1m/delivery/MANIFEST.json>] [--version <artifactVersion>]
#
# 交付清单对账（D-2 ①）：给了 --delivery-manifest 就按 kind+basename 逐件比对
#   bytes 与 sha256，**任一不符即 exit 3**（复用其 sha256 作独立真值源；介质侧不自签）。
#   未给 ⇒ 打警告并在清单记 deliveryManifest:null（只允许测试介质）。
#
# 退出：0=成功 · 2=用法/缺参/源缺失 · 3=与交付清单对账失败
# 纪律：只读源、只写 <out>；不联网。
# ============================================================
set -u

OUT=""; REPO=""; WEIGHTS=""; DSH=""; GGUF=""; MODELFILE=""; DELIV=""; VERSION="sofa-s1m-v1@f6.7-r2"
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="${2:-}"; shift 2 ;;
    --repo) REPO="${2:-}"; shift 2 ;;
    --weights) WEIGHTS="${2:-}"; shift 2 ;;
    --dsh) DSH="${2:-}"; shift 2 ;;
    --gguf) GGUF="${2:-}"; shift 2 ;;
    --modelfile) MODELFILE="${2:-}"; shift 2 ;;
    --delivery-manifest) DELIV="${2:-}"; shift 2 ;;
    --version) VERSION="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "❌ 未知参数：$1" >&2; exit 2 ;;
  esac
done

[ -n "$OUT" ] && [ -n "$REPO" ] && [ -n "$WEIGHTS" ] && [ -n "$DSH" ] || {
  echo "用法: pack-media.sh --out <dir> --repo <sofagent 树> --weights <权重目录> --dsh <DSH 载荷目录> [--gguf <f>] [--modelfile <f>] [--delivery-manifest <factory/s1m/delivery/MANIFEST.json>]" >&2
  exit 2
}
for d in "$REPO" "$WEIGHTS" "$DSH"; do
  [ -d "$d" ] || { echo "❌ 源目录不存在：$d" >&2; exit 2; }
done
if [ -n "$DELIV" ] && [ ! -f "$DELIV" ]; then
  echo "❌ 交付清单不存在：$DELIV" >&2; exit 2
fi

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TREE_HASH="${SELF_DIR}/media-tree-hash.mjs"
command -v node >/dev/null 2>&1 || { echo "❌ 需要 node" >&2; exit 2; }

rm -rf "$OUT"
mkdir -p "$OUT/weights" "$OUT/dsh"

# ── 载荷复制（rsync 优先；无 rsync 用 cp -R）────────────────
copy_tree () { # <src> <dst>；排除 .git 与 node_modules（介质不装开发依赖）
  local src="$1" dst="$2"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --exclude '.git/' --exclude 'node_modules/' "$src/" "$dst/"
  else
    ( cd "$src" && tar -cf - --exclude='.git' --exclude='node_modules' . ) | ( cd "$dst" && tar -xf - )
  fi
}
copy_tree "$REPO" "$OUT/repo"
copy_tree "$DSH" "$OUT/dsh"

# ── 判定件：权重按 basename 落 weights/ ─────────────────────
n_w=0
for f in "$WEIGHTS"/*; do
  [ -f "$f" ] || continue
  cp "$f" "$OUT/weights/"
  n_w=$((n_w + 1))
done
[ "$n_w" -gt 0 ] || { echo "❌ 权重目录为空：$WEIGHTS" >&2; exit 2; }

if [ -n "$GGUF" ]; then
  [ -f "$GGUF" ] || { echo "❌ GGUF 不存在：$GGUF" >&2; exit 2; }
  mkdir -p "$OUT/gguf"; cp "$GGUF" "$OUT/gguf/"
fi
if [ -n "$MODELFILE" ]; then
  [ -f "$MODELFILE" ] || { echo "❌ Modelfile 不存在：$MODELFILE" >&2; exit 2; }
  cp "$MODELFILE" "$OUT/Modelfile"
fi

# ── 生成 MANIFEST.json（files[] 逐件 + trees[] 集合）────────
node - "$OUT" "$VERSION" "$TREE_HASH" "$DELIV" <<'NODE'
const { readdirSync, statSync, readFileSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { basename, join } = require('node:path');
const { execFileSync } = require('node:child_process');

const [out, version, tool, deliv] = process.argv.slice(2);
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

const files = [];
const pushFiles = (dir, kind) => {
  let n = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (!statSync(p).isFile()) continue;
    files.push({ kind, path: name, bytes: statSync(p).size, sha256: sha256(p) });
    n++;
  }
  return n;
};
pushFiles(join(out, 'weights'), 'weights');
if (readdirSync(out).includes('gguf')) pushFiles(join(out, 'gguf'), 'gguf');
if (readdirSync(out).includes('Modelfile')) {
  const p = join(out, 'Modelfile');
  files.push({ kind: 'modelfile', path: 'Modelfile', bytes: statSync(p).size, sha256: sha256(p) });
}

// trees：路径相对介质根；文件数/字节数/聚合 sha256 三项即「集合指纹」
const trees = [];
// 集合绑定覆盖面（D-2 ③）：repo/dsh 是「树」，weights/gguf 也必须纳入——
// 否则多塞一个未列权重仍会全绿，而 install.sh 会整目录 cp -R 落位（=未校验载荷进生产）。
for (const [kind, rel] of [['repo', 'repo'], ['dsh', 'dsh'], ['weights', 'weights'], ['gguf', 'gguf']]) {
  if (kind === 'gguf' && !readdirSync(out).includes('gguf')) continue;
  const line = execFileSync('node', [tool, join(out, rel)], { encoding: 'utf8' }).trim();
  const [nf, nb, agg] = line.split(' ');
  trees.push({ kind, path: rel, files: Number(nf), bytes: Number(nb), sha256: agg });
}

// ── 与交付清单（factory `s1m/delivery/MANIFEST.json`）逐件对账 ──
// 复用其 sha256 作**独立真值源**：介质载荷必须与交付清单声明的字节数 + sha256 完全一致，
// 否则打包直接失败（fail-closed）。介质侧不自签，交付清单也不由介质侧改写。
let delivery = null;
if (deliv) {
  const d = JSON.parse(readFileSync(deliv, 'utf8'));
  const bad = [];
  for (const e of d.files || []) {
    const b = basename(e.path);
    let hit = null;
    if (e.kind === 'weights' || e.kind === 'gguf') hit = files.find((f) => f.kind === e.kind && f.path === b);
    else if (e.kind === 'modelfile') hit = files.find((f) => f.kind === 'modelfile');
    else { bad.push(`未知 kind：${e.kind}（${e.path}）`); continue; }
    if (!hit) { bad.push(`介质缺件：${e.kind}/${b}`); continue; }
    if (hit.sha256 !== e.sha256) bad.push(`sha 不符：${e.kind}/${b}（介质 ${String(hit.sha256).slice(0, 16)}… ≠ 交付 ${String(e.sha256).slice(0, 16)}…）`);
    else if (Number.isFinite(e.bytes) && hit.bytes !== e.bytes) bad.push(`字节数不符：${e.kind}/${b}（${hit.bytes} ≠ ${e.bytes}）`);
  }
  if (bad.length) {
    console.error(`❌ 与交付清单对账失败（fail-closed）：${bad.length} 处`);
    for (const b of bad) console.error(`   · ${b}`);
    process.exit(3);
  }
  delivery = { path: deliv, artifactVersion: d.artifactVersion ?? null, entries: (d.files || []).length, result: 'all-match' };
  console.log(`交付清单对账：${delivery.entries} 件全等（artifactVersion=${delivery.artifactVersion}）`);
} else {
  // D-2 ① 收紧（F6.7 R3）：交付清单对账从「可选」改为「必填」。
  // 为什么不能只警告：介质一旦打出，安装方无法分辨「对过账」与「没对过账」——
  // 警告在 200 行日志里等于没有。缺失即 fail-closed，测试介质也必须造一份真清单。
  console.error('❌ 缺 --delivery-manifest：正式介质必须与交付清单逐件对账（fail-closed）');
  console.error('   用法：pack-media.sh --out <dir> ... --delivery-manifest <factory>/s1m/delivery/MANIFEST.json');
  process.exit(2);
}

const man = {
  artifactVersion: version,
  generatedBy: 'tools/install/pack-media.sh',
  generatedAt: new Date().toISOString(),
  note: 'files[] 逐件；trees[] 为子树集合指纹（文件数/字节数/聚合 sha256）。清单指纹钉在 tools/install/manifest-pin.txt。',
  deliveryManifest: delivery,
  files,
  trees,
};
writeFileSync(join(out, 'MANIFEST.json'), JSON.stringify(man, null, 2) + '\n');
console.log(`MANIFEST.json 写入：files=${files.length} · trees=${trees.length}`);
for (const t of trees) console.log(`  ${t.kind}: ${t.files} 件 / ${t.bytes} B / ${t.sha256.slice(0, 16)}…`);
NODE
rc=$?
[ "$rc" -ne 0 ] && exit "$rc"

echo "✅ 介质已组装：$OUT"
echo "   下一步：把 MANIFEST.json 的 sha256 写进 ${SELF_DIR}/manifest-pin.txt（与 artifactVersion 同行）"
