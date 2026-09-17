#!/usr/bin/env node
// ============================================================
// check-mjs-comment-backtick.mjs · mjs/js 注释可执行反引号守卫
// ============================================================
// 为什么需要：.mjs/.js 被 bash 误执行时（手滑把 x.mjs 喂给 bash、
// 调度器误派给 bash），注释里的反引号串会被 bash 当**命令替换真执行**。
// 实锤：check-prepush-checklist.mjs 头部注释里的反引号包住
// 'tools/release/pre-push-check.sh' 路径串，曾让 bash 完整跑了一遍 pre-push
// 防线（数分钟级）；另一形态 'tools/check/check-seam-drift.mjs' 在 macOS 报
// Permission denied，在 Linux 或带执行位时则以 node 语义真跑。
//
// 判定面（只抓真危险形态，不误伤描述性反引号）：
//   注释行（// 或 * 开头）反引号串的首 token 形似：
//   a) 仓内脚本路径：^(tools|engine|playbook|docs|FDE|FORGE|SKILL)/….(sh|mjs|js)$
//   b) 命令头：^(npm|npx|node|bash|sh)\b
// 修法：注释串改单引号或去掉反引号（代码区模板字符串不受本守卫判定）。
//
// 退出码：0 = 零违规 / 1 = 有违规 / 2 = 引擎自身错误（fail-loud）。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

let hits;
try {
  hits = [];
  const scan = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) scan(p);
      else if (/\.(mjs|js)$/.test(e.name)) {
        const lines = fs.readFileSync(p, 'utf8').split('\n');
        lines.forEach((l, i) => {
          if (!l.trim().startsWith('//') && !l.trim().startsWith('*')) return;
          const bt = l.match(/`[^`\n]*`/g) || [];
          for (const x of bt) {
            const inner = x.slice(1, -1).trim();
            const first = inner.split(/\s+/)[0];
            if (
              /^(tools|engine|playbook|docs|FDE|FORGE|SKILL)\/\S+\.(sh|mjs|js)$/.test(first) ||
              /^(npm|npx|node|bash|sh)\b/.test(first)
            ) {
              hits.push(`${path.relative(ROOT, p)}:${i + 1}: ${inner}`);
            }
          }
        });
      }
    }
  };
  scan(path.join(ROOT, 'tools'));
  scan(path.join(ROOT, 'engine'));
} catch (err) {
  console.error(`❌ 扫描引擎故障：${err.message}`);
  process.exit(2);
}

if (hits.length === 0) {
  console.log('  ✅ mjs/js 注释零可执行反引号串（bash 误跑时不会真执行注释内命令）');
  process.exit(0);
}
console.error(`❌ 发现 ${hits.length} 处注释内可执行反引号串（bash 误跑会真执行——改单引号）：`);
for (const h of hits) console.error(`  ${h}`);
process.exit(1);
