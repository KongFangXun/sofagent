#!/usr/bin/env node
// ============================================================
// annotate-api-tiers.mjs · 一次性脚本：给所有 engine 包入口加 @public/@internal 分级标记
// v1.3.9（四）：API 分级——注释标注约定（`/* @public */` = semver 锁定，
// `/* @internal */` = 不承诺）。本脚本一次性落地基线标记，之后人工维护。
//
// 规则：
// - 每个 export 语句行首加 `/* @public */`（缺省：既有公开面全部锁定）
// - 下划线前缀 / 测试钩子（_setX/_resetX/XxxTestHook）→ `/* @internal */`
// - 已有标记的行不重复加
// ============================================================
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = new URL('../../', import.meta.url).pathname;
const PACKAGES = [
  ['engine/harness', 'src/index.ts'],
  ['engine/ontology', 'src/index.ts'],
  ['engine/core', 'src/index.ts'],
  ['engine/rules', 'src/index.ts'],
  ['engine/think', 'src/index.ts'],
  ['engine/audit', 'src/public-api.ts'],
  ['engine/eval', 'src/index.ts'],
  ['engine/skillopt', 'src/index.ts'],
  ['engine/orchestrator', 'src/index.ts'],
  ['engine/daemon', 'src/index.ts'],
  ['engine/ab-test', 'src/index.ts'],
  ['engine/mcp', 'src/index.ts'],
  ['engine/hooks/sofagent-load-chain', 'src/index.ts'],
];

/** 判断一个 export 语句（文本）是否应标 @internal */
function isInternal(stmtText) {
  // 下划线前缀导出 / 测试钩子 / 明确内部字样
  return /(^|[^.\w])_[A-Za-z]|[Tt]est[Hh]ook|internal/i.test(stmtText);
}

for (const [pkg, entry] of PACKAGES) {
  const file = join(ROOT, pkg, entry);
  let src;
  try { src = readFileSync(file, 'utf-8'); } catch { console.log(`跳过（不存在）: ${pkg}/${entry}`); continue; }

  // 已有分级标记则跳过该文件（幂等）
  if (/\/\* @public \*\//.test(src) || /\/\* @internal \*\//.test(src)) {
    console.log(`已有标记，跳过: ${pkg}/${entry}`);
    continue;
  }

  const lines = src.split('\n');
  const out = lines.map((line) => {
    const trimmed = line.trim();
    // 只处理顶层 export 语句（行首无缩进——barrel 文件惯例）
    if (!/^export[\s{]/.test(trimmed) || line.startsWith(' ')) return line;
    if (/@public|@internal/.test(line)) return line;
    const marker = isInternal(trimmed) ? '/* @internal */' : '/* @public */';
    // 保留原缩进（顶层为 0）
    return `${marker} ${line}`;
  });

  // 头部加契约说明
  const header = [
    '// ── API 分级契约（v1.3.9 四）────────────────────────────',
    '// `/* @public */`：公开 API——semver 锁定，变更必须 bump 版本 + CHANGELOG 记录',
    '//                 （外部依赖方与跨平台适配器只许 import 这一层）',
    '// `/* @internal */`：内部 API——不承诺稳定性，破坏性变更无需 bump',
    '// 未标记的导出视为 @public（保守默认：宁可多承诺不可漏承诺）',
    '// ────────────────────────────────────────────────────────',
    '',
  ].join('\n');

  writeFileSync(file, header + out.join('\n'), 'utf-8');
  const count = out.filter((l) => /^\/\* @(public|internal) \*\/ export/.test(l)).length;
  console.log(`✅ ${pkg}/${entry}：标注 ${count} 个 export 语句`);
}
console.log('完成——基线标记落地');
