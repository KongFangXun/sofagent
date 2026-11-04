#!/usr/bin/env bash
# ============================================================
# verify-media.test.sh · 介质校验十四态测试（F6.7 D-2 / D-13 / R7-2）
# ============================================================
# 覆盖：正例 · 结构缺失 · 清单指纹 · 逐件缺/改 · 集合多塞/少件 · 必需单元缺 · 未钉指纹
#       · 交付清单对账必填（pack 侧）· 对账结果必被 verify 读到
#       · weights/gguf 未列件必拒（R7-2：原先只绑 repo/dsh）
# 全部在临时目录内造件，不碰仓库、不联网。
# 退出：0 = 全部通过（pass=N fail=0）；1 = 有失败
# ============================================================
set -u
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFY="${SELF_DIR}/verify-media.sh"
PACK="${SELF_DIR}/pack-media.sh"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/media-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

pass=0; fail=0
ck () { # <描述> <期望 rc> <实际 rc>
  if [ "$2" = "$3" ]; then echo "  ✓ $1（exit $3）"; pass=$((pass+1));
  else echo "  ✗ $1（期望 exit $2 · 实得 exit $3）"; fail=$((fail+1)); fi
}

# ── 造源：repo 树 / 权重 / gguf / DSH 载荷 ──
mkdir -p "$WORK/src/repo" "$WORK/src/weights" "$WORK/src/dsh/plugins" "$WORK/src/gguf"
printf '#!/usr/bin/env bash\necho stub\n' > "$WORK/src/repo/install.sh"
printf 'readme\n' > "$WORK/src/repo/README.md"
printf 'W1\n' > "$WORK/src/weights/model.safetensors"
printf 'W2\n' > "$WORK/src/weights/tokenizer.json"
printf 'GGUF\n' > "$WORK/src/gguf/adapter.gguf"
printf 'dsh-core\n' > "$WORK/src/dsh/core.bin"
printf 'dsh-plugin\n' > "$WORK/src/dsh/plugins/a.js"

# ── 交付清单 fixture（pack 侧对账改必填后，测试介质也必须有一份真清单）──
node - "$WORK" <<'NODE'
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const W = process.argv[2];
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const mk = (kind, dir, name) => {
  const p = path.join(W, 'src', dir, name);
  return { kind, path: name, bytes: fs.statSync(p).size, sha256: sha(p) };
};
const files = [
  mk('weights', 'weights', 'model.safetensors'),
  mk('weights', 'weights', 'tokenizer.json'),
  mk('gguf', 'gguf', 'adapter.gguf'),
];
fs.writeFileSync(path.join(W, 'deliv.json'),
  JSON.stringify({ artifactVersion: 'test-deliv@1', files }, null, 2) + '\n');
NODE

pack_ok () { # pack_ok <out>
  "$PACK" --out "$1" --repo "$WORK/src/repo" --weights "$WORK/src/weights" \
    --dsh "$WORK/src/dsh" --gguf "$WORK/src/gguf/adapter.gguf" \
    --version "test-artifact@1" --delivery-manifest "$WORK/deliv.json" >/dev/null 2>&1
}

# ── 正例介质 + 临时 pin ──
if ! pack_ok "$WORK/media"; then
  echo "✗ pack-media.sh 组装失败——用例无法进行"; exit 1
fi
PIN="$WORK/pin.txt"
printf 'test-artifact@1 %s\n' "$(shasum -a 256 "$WORK/media/MANIFEST.json" | cut -d' ' -f1)" > "$PIN"

echo "── 十四态 ──"
run () { bash "$VERIFY" "$1" --pin "$PIN" >/dev/null 2>&1; echo $?; }

ck "正常介质" 0 "$(run "$WORK/media")"
ck "缺介质目录" 2 "$(run "$WORK/nope")"

cp -a "$WORK/media" "$WORK/m-nomanifest"; rm "$WORK/m-nomanifest/MANIFEST.json"
ck "缺 MANIFEST" 2 "$(run "$WORK/m-nomanifest")"

cp -a "$WORK/media" "$WORK/m-repin"
node -e "const fs=require('fs');const f='$WORK/m-repin/MANIFEST.json';const j=JSON.parse(fs.readFileSync(f,'utf8'));j.note+=' 篡改';fs.writeFileSync(f,JSON.stringify(j,null,2)+'\n')"
ck "清单被重签（指纹不符）" 4 "$(run "$WORK/m-repin")"

cp -a "$WORK/media" "$WORK/m-missing"; rm "$WORK/m-missing/weights/tokenizer.json"
ck "逐件缺件" 3 "$(run "$WORK/m-missing")"

cp -a "$WORK/media" "$WORK/m-alter"; printf 'W2-x\n' > "$WORK/m-alter/weights/tokenizer.json"
ck "逐件改字节" 3 "$(run "$WORK/m-alter")"

cp -a "$WORK/media" "$WORK/m-extra"; printf 'sneaky\n' > "$WORK/m-extra/repo/backdoor.sh"
ck "集合多塞一件（repo）" 3 "$(run "$WORK/m-extra")"

cp -a "$WORK/media" "$WORK/m-treedel"; rm "$WORK/m-treedel/dsh/plugins/a.js"
ck "集合少一件（dsh）" 3 "$(run "$WORK/m-treedel")"

cp -a "$WORK/media" "$WORK/m-nodsh"
node -e "const fs=require('fs');const f='$WORK/m-nodsh/MANIFEST.json';const j=JSON.parse(fs.readFileSync(f,'utf8'));j.trees=j.trees.filter(t=>t.kind!=='dsh');fs.writeFileSync(f,JSON.stringify(j,null,2)+'\n')"
printf 'test-artifact@1 %s\n' "$(shasum -a 256 "$WORK/m-nodsh/MANIFEST.json" | cut -d' ' -f1)" > "$WORK/pin-nodsh.txt"
bash "$VERIFY" "$WORK/m-nodsh" --pin "$WORK/pin-nodsh.txt" >/dev/null 2>&1 && _rc=0 || _rc=$?
ck "缺 dsh 必需单元" 3 "$_rc"

printf 'UNPINNED -\n' > "$WORK/pin-un.txt"
bash "$VERIFY" "$WORK/media" --pin "$WORK/pin-un.txt" >/dev/null 2>&1 && _rc2=0 || _rc2=$?
ck "未钉指纹" 2 "$_rc2"

# ── R7-2 新增四态 ──────────────────────────────────────────
"$PACK" --out "$WORK/media-nodeliv" --repo "$WORK/src/repo" --weights "$WORK/src/weights" \
  --dsh "$WORK/src/dsh" --version "test-artifact@1" >/dev/null 2>&1 && _rc3=0 || _rc3=$?
ck "pack 缺 --delivery-manifest（必填·D-2①）" 2 "$_rc3"

cp -a "$WORK/media" "$WORK/m-wextra"; printf 'sneaky\n' > "$WORK/m-wextra/weights/extra.bin"
ck "weights 多塞未列件（R7-2）" 3 "$(run "$WORK/m-wextra")"

cp -a "$WORK/media" "$WORK/m-ggufextra"; printf 'sneaky\n' > "$WORK/m-ggufextra/gguf/backdoor.gguf"
ck "gguf 多塞未列件（R7-2）" 3 "$(run "$WORK/m-ggufextra")"

cp -a "$WORK/media" "$WORK/m-nodelivrec"
node -e "const fs=require('fs');const f='$WORK/m-nodelivrec/MANIFEST.json';const j=JSON.parse(fs.readFileSync(f,'utf8'));j.deliveryManifest=null;fs.writeFileSync(f,JSON.stringify(j,null,2)+'\n')"
printf 'test-artifact@1 %s\n' "$(shasum -a 256 "$WORK/m-nodelivrec/MANIFEST.json" | cut -d' ' -f1)" > "$WORK/pin-nodeliv.txt"
bash "$VERIFY" "$WORK/m-nodelivrec" --pin "$WORK/pin-nodeliv.txt" >/dev/null 2>&1 && _rc4=0 || _rc4=$?
ck "清单无对账记录（D-2①·verify 侧）" 3 "$_rc4"

echo "—— verify-media: pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
