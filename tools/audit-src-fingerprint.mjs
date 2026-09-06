#!/usr/bin/env node
// ============================================================
// audit-src-fingerprint.mjs · 审计引擎「源码指纹」计算器
// ============================================================
// 用途：为 P1-A2 影子审计器防线提供第二个信号，把「改源码后重建 dist」与
//       「不动源码、直接替换 dist」这两种成因区分开。
//
// 背景：dist/index.js 的哈希变化有两种完全不同的成因——
//   ① 合法且高频：开发者改了 engine/audit/src 并重新 build；
//   ② 恶意且隐蔽：攻击者不碰源码、直接覆写 dist 让审计放水。
// 二者产生同一个信号（dist 哈希变了），只比对 dist 就无法区分，
// 结果只能是「一律拦截」——误杀合法重建（曾导致全仓 commit 被阻塞）。
//
// 解法：追加一个与 dist 独立的信号——源码指纹。
//   src 变 + dist 变 → 合法重建，放行
//   src 变 + dist 不变 → dist 过期（改了源码没构建），告警
//   src 不变 + dist 变 → 无法用「改源码」解释 = 真劫持，fail-closed 拦截
//   src 不变 + dist 不变 → 正常
//
// 设计约束：
//   - 必须由 dist 之外的代码计算。若交给 dist/index.js 算，dist 已被篡改时
//     指纹也可被伪造，防线 self-defeating。故 hook 直接调用本脚本。
//   - 单一实现。hook（bash）与信任锚同步脚本共用本文件，避免两份算法漂移。
//   - 零依赖，纯 node 内置模块。
//
// 用法:
//   node tools/audit-src-fingerprint.mjs [repoRoot]
//   不传 repoRoot 时用 process.cwd()
// 输出: 64 位小写 sha256（stdout，无换行）
// ============================================================

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/** 递归收集文件（同步，深度优先） */
function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // 目录不存在或不可读——交给调用方判空
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      walk(p, out);
    } else if (e.isFile()) {
      out.push(p);
    }
  }
  return out;
}

/** 统一为正斜杠的相对路径，保证跨 OS 指纹一致 */
function rel(root, abs) {
  return relative(root, abs).split(sep).join('/');
}

const root = resolve(process.argv[2] || process.cwd());
const auditPkg = join(root, 'engine', 'audit');
const srcDir = join(auditPkg, 'src');

// 参与指纹的输入面：源码本体 + 构建配置。
// 不含 package.json——build 脚本本身的改动不改变 dist 产物内容，
// 计入只会制造无谓的指纹抖动。
const inputs = [];

if (existsSync(srcDir)) {
  const files = walk(srcDir)
    .filter((f) => f.endsWith('.ts'))
    // 测试文件不进 dist，不应影响指纹
    .filter((f) => !f.endsWith('.test.ts'))
    // 声明文件由编译产出，非输入
    .filter((f) => !f.endsWith('.d.ts'))
    .sort();
  for (const f of files) {
    inputs.push(rel(root, f) + '\u0000' + readFileSync(f, 'utf8'));
  }
}

for (const extra of ['engine/audit/tsconfig.json']) {
  const p = join(root, extra);
  if (existsSync(p) && statSync(p).isFile()) {
    inputs.push(extra + '\u0000' + readFileSync(p, 'utf8'));
  }
}

// 输入面为空说明不在 monorepo 内（如 npm 全局安装），输出空串让调用方走降级路径
if (inputs.length === 0) {
  process.stdout.write('');
  process.exit(0);
}

process.stdout.write(createHash('sha256').update(inputs.join('\u0001'), 'utf8').digest('hex'));
