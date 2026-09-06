// ============================================================
// semver.ts · 最小语义化版本比较（ASI04 漏洞区间匹配用）
// v1.4.5（一）：只支持 MAJOR.MINOR.PATCH 数字三元组 + 简单前缀
// （如 1.2 / 1.x），prerelease/build 忽略——漏洞库区间足够用
// ============================================================

/** 解析版本串为可比数组（非法返回 null） */
export function parseVersion(v: string): number[] | null {
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/** 比较两个版本：a<b 返回 -1，相等 0，a>b 返回 1（不可解析按相等处理） */
export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return 0;
  for (let i = 0; i < 3; i++) {
    const x = va[i] ?? 0;
    const y = vb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * 判断版本是否命中区间串。
 * 区间语法：空格分隔的多个条件（AND），每条形如 <x / <=x / >x / >=x / =x / x（等于）。
 * 例："=1.2.0" "<4.17.21" ">=1.3.0 <1.6.0"
 */
export function inRange(version: string, range: string): boolean {
  const conditions = range.trim().split(/\s+/).filter(Boolean);
  if (conditions.length === 0) return false;
  return conditions.every((cond) => {
    const m = /^(<=|>=|<|>|=)?\s*(.+)$/.exec(cond);
    if (!m || m[2] === undefined) return false;
    const op = m[1];
    const ver = m[2];
    const cmp = compareVersions(version, ver);
    switch (op) {
      case '<': return cmp < 0;
      case '<=': return cmp <= 0;
      case '>': return cmp > 0;
      case '>=': return cmp >= 0;
      case '=': default: return cmp === 0;
    }
  });
}
