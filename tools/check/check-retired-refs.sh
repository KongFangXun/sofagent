#!/usr/bin/env bash
# ============================================================
# check-retired-refs.sh · 退役名残留守卫（v1.6.0 Batch G · BUG-42）
# ============================================================
# 定位：v1.5.9 退役 12 个旧 bin 后，门禁体系无一负责「退役后谁还在引用」——
# P0 全族（action.yml 127 / install.sh 复活旧命令 / help 假承诺）皆因此逃过发版。
# 本门禁把「退役即对账」机械化：
#   - 输入：engine/capabilities.json 的 shimsRetired[].cli 全名单（SSOT 单一权威源）
#   - 扫描面：action.yml / workflows / README 双语 / docs(非冻结) / engine src+bin /
#             tools(核心脚本) / install.sh / bootstrap.sh / engine/scripts / dashboard
#   - 判红：退役 bin 名命中且行内不含「退役」语境词
#   - 豁免：check-retired-refs-exempt.json（file+anchor 行级，带理由）
# 判定引擎：python3（shell 只做包装——grep 循环在 set -u 下有变量陷阱）
# 退出码：0 绿 / 1 红
# ============================================================
set -uo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_ROOT"

python3 - <<'PYEOF'
import json, os, re, sys

exempt_path = 'tools/check/check-retired-refs-exempt.json'
exempt_by_file = {}
if os.path.exists(exempt_path):
    for e in json.load(open(exempt_path)).get('exempts', []):
        exempt_by_file.setdefault(e['file'], []).append(e['anchor'])

# SSOT 名单
try:
    retired = [s['cli'] for s in json.load(open('engine/capabilities.json')).get('shimsRetired', [])]
except Exception as err:
    print(f"❌ [retired-refs] capabilities.json shimsRetired 解析失败: {err}")
    sys.exit(1)
if not retired:
    print("❌ [retired-refs] shimsRetired 为空——SSOT 异常")
    sys.exit(1)

# 扫描面收集
files = set()
def add(p):
    if os.path.isfile(p):
        files.add(p)
add('action.yml')
add('README.md'); add('README.en.md'); add('install.sh'); add('bootstrap.sh')
add('engine/umbrella/README.md')
add('tools/check/check-version.sh')
add('tools/dashboard/dashboard.html')
for pat_dir in ['.github/workflows', 'tools/hooks', 'engine/scripts/lib']:
    if os.path.isdir(pat_dir):
        for f in os.listdir(pat_dir):
            if f.endswith(('.yml', '.yaml', '.sh')):
                files.add(os.path.join(pat_dir, f))
add('tools/audit-baseline-sync.sh')
for dirpath, dirnames, filenames in os.walk('engine'):
    dirnames[:] = [d for d in dirnames if d not in ('dist', '__tests__', 'node_modules')]
    for f in filenames:
        if f.endswith(('.ts', '.js')) and not f.endswith('.test.ts') and not f.endswith('.d.ts'):
            rel = os.path.join(dirpath, f)
            if '/src/' in rel or '/bin/' in rel:
                files.add(rel)
for dirpath, dirnames, filenames in os.walk('docs'):
    dirnames[:] = [d for d in dirnames if d not in ('archive', 'changelog', 'evidence')]
    for f in filenames:
        if f.endswith('.md'):
            files.add(os.path.join(dirpath, f))
for f in os.listdir('FDE'):
    if f.endswith('.md'):
        files.add(os.path.join('FDE', f))

CONTEXT_RE = re.compile(r'退役|retired|已于|下架|不要安装|shimsRetired|兼容期届满|旧命令|旧 bin|legacy proxy|unpublished|shim-sofagent')

fails = 0
checks = 0
for f in sorted(files):
    try:
        lines = open(f, encoding='utf-8', errors='replace').read().split('\n')
    except OSError:
        continue
    anchors = exempt_by_file.get(f, [])
    for i, line in enumerate(lines, 1):
        hit_names = [n for n in retired if n in line]
        if not hit_names:
            continue
        checks += 1
        if CONTEXT_RE.search(line):
            continue
        if any(a and a in line for a in anchors):
            continue
        name = hit_names[0]
        print(f"  ❌ [retired-refs] {f}:{i} 仍引用已退役命令「{name}」: {line.strip()[:80]}")
        fails += 1

print()
if fails:
    print(f"❌ check-retired-refs：{fails} 处退役名残留（语境豁免与行级豁免除外）")
    sys.exit(1)
print(f"✅ check-retired-refs：退役名零残留（{checks} 处命中全部为合法语境/豁免）")
sys.exit(0)
PYEOF
