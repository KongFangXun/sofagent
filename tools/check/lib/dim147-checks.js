// 维度 #147 专项断言内核（v1.5.7 阶段四 B 类）——由 regression-checklist.md #147 调用
// 用法：node tools/check/lib/dim147-checks.js <b4|b7|j|k>
// 退出码 0=断言过 / 1=回潮（checklist 侧转 ❌）
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, "..", "..", "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const checks = {
  // B4: decision-log 懒加载——装配后于消费者判定（剥注释行后定位）
  b4() {
    const L = R('engine/audit/src/rules/runner.ts').split('\n').filter(l => !l.trim().startsWith('//'));
    const s = L.join('\n');
    const lazy = /rulesToRun\.some\(\(r\) => r\.id === 'E7'\)/.test(s);
    return lazy && s.indexOf('loadDecisionEntries()') > s.indexOf('rulesToRun');
  },
  // B7: 归档件相对链接逐条验证（doc-slim 全目录）
  b7() {
    const dir = path.join(ROOT, 'docs/archive/doc-slim');
    let bad = 0;
    for (const f of fs.readdirSync(dir)) {
      const s = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const m of s.matchAll(/\]\((\.{2,}\/[^)#]+)/g)) {
        const t = path.normalize(path.join(dir, m[1]));
        if (!fs.existsSync(t)) { bad++; console.error('坏链:', f, m[1]); }
      }
    }
    return bad === 0;
  },
  // j（归并自 #4）: ruleClass SSOT ↔ README 归一化比对零差异
  j() {
    const raw = R('engine/audit/src/rules/index.ts').match(/name: '(A|E)[0-9]+[^\n]*ruleClass: '[^']+'/g) || [];
    const idx = raw.map(x => [x.match(/name: '((A|E)[0-9]+)/)[1], x.match(/ruleClass: '([^']+)'/)[1]].join(' ')).sort();
    const rd = R('engine/audit/README.md').split('\n')
      .filter(l => /^\| (A|E)[0-9]+ /.test(l))
      .map(l => { const c = l.split('|'); const id = c[1].trim().split(' ')[0]; const cls = c[c.length - 2].trim(); return id + ' ' + cls; }).sort();
    return idx.length > 0 && JSON.stringify(idx) === JSON.stringify(rd);
  },
  // k（归并自 #4）: 规则口径 17 默认 + 11 扩展 = 28
  k() {
    const src = R('engine/audit/src/rules/index.ts');
    const cnt = re => { const m = src.match(re); return m ? (m[0].match(/name:\s*'(A|E)[0-9]+/g) || []).length : -1; };
    return cnt(/export const defaultRules[\s\S]*?^\];/m) === 17
        && cnt(/export const extendedRules[\s\S]*?^\];/m) === 11;
  },
};

const which = process.argv[2];
if (!checks[which]) { console.error('用法: node dim147-checks.js <b4|b7|j|k>'); process.exit(2); }
process.exit(checks[which]() ? 0 : 1);
