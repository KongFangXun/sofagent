#!/usr/bin/env node
// ============================================================
// cleanup-shadow.js · 一次性追溯脱敏脚本
// v1.3.4 交付 1（P0）配套清理
//
// 用途：扫描历史已写入的 .sofagent/.git-shadow/snapshots.json，对明文密钥做追溯脱敏。
//   - 写入前先备份（snapshots.json.bak）
//   - 对每个 snapshot 的每个 file content 跑 REDACTION_PATTERNS 脱敏
//   - 超过 MAX_SNAPSHOTS（50）的做滚动裁剪
//
// 用法：
//   node tools/cleanup-shadow.js [directory]   # 默认扫描当前目录
//   node tools/cleanup-shadow.js /path/to/repo
//   node tools/cleanup-shadow.js --all         # 扫描主仓 + engine/audit 下两份
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');

// 复用 engine/core 的脱敏正则（与 scanFiles 同源）
// 这里内联一份，避免脚本依赖 dist 产物（cleanup 可能在 build 前运行）
const REDACTION_PATTERNS = [
  { pattern: /sk-[a-zA-Z0-9_\-]{16,}/g, replacement: 'sk-***REDACTED***' },
  { pattern: /AKIA[0-9A-Z]{16}/g, replacement: 'AKIA***REDACTED***' },
  { pattern: /\b1[3-9]\d{9}\b/g, replacement: '1**REDACTED***' },
  { pattern: /gh[ps]_[a-zA-Z0-9]{36,}/g, replacement: 'gh***REDACTED***' },
];

const MAX_SNAPSHOTS = 50;

/**
 * 对单个 content 字符串做脱敏
 */
function sanitizeContent(content) {
  let sanitized = content;
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    pattern.lastIndex = 0;
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}

/**
 * 查找并处理一个目录下的 snapshots.json
 * @returns {{ backed: boolean, redacted: number, rotated: boolean, sizeBefore: number, sizeAfter: number }}
 */
function cleanSnapshotsFile(rootDir, shadowRelPath) {
  const snapshotsPath = path.join(rootDir, shadowRelPath);
  if (!fs.existsSync(snapshotsPath)) {
    return null;
  }

  const sizeBefore = fs.statSync(snapshotsPath).size;
  const raw = fs.readFileSync(snapshotsPath, 'utf-8');

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error(`  ❌ 解析失败（JSON 格式错误），跳过: ${snapshotsPath}`);
    return null;
  }

  if (!data.snapshots || !Array.isArray(data.snapshots)) {
    console.error(`  ⚠️ 无 snapshots 数组，跳过: ${snapshotsPath}`);
    return null;
  }

  // 备份
  const bakPath = snapshotsPath + '.bak';
  fs.writeFileSync(bakPath, raw, 'utf-8');
  console.log(`  ✅ 已备份 → ${bakPath}`);

  // 追溯脱敏
  let redactedCount = 0;
  for (const snapshot of data.snapshots) {
    if (!snapshot.files) continue;
    for (const filePath of Object.keys(snapshot.files)) {
      const original = snapshot.files[filePath];
      const sanitized = sanitizeContent(original);
      if (sanitized !== original) {
        snapshot.files[filePath] = sanitized;
        redactedCount++;
      }
    }
  }

  // 滚动裁剪
  let rotated = false;
  if (data.snapshots.length > MAX_SNAPSHOTS) {
    data.snapshots = data.snapshots.slice(data.snapshots.length - MAX_SNAPSHOTS);
    rotated = true;
  }

  // 写回
  fs.writeFileSync(snapshotsPath, JSON.stringify(data, null, 2), 'utf-8');
  const sizeAfter = fs.statSync(snapshotsPath).size;

  return {
    backed: true,
    redacted: redactedCount,
    rotated,
    sizeBefore,
    sizeAfter,
  };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function main() {
  const args = process.argv.slice(2);
  const rootDir = path.resolve(args[0] || process.cwd());
  const allMode = args.includes('--all');

  console.log('');
  console.log('🔧 sofagent cleanup-shadow — 追溯脱敏 + 滚动裁剪');
  console.log('');

  const targets = allMode
    ? [
        { root: rootDir, rel: path.join('.sofagent', '.git-shadow', 'snapshots.json') },
        { root: path.join(rootDir, 'engine', 'audit'), rel: path.join('.sofagent', '.git-shadow', 'snapshots.json') },
      ]
    : [{ root: rootDir, rel: path.join('.sofagent', '.git-shadow', 'snapshots.json') }];

  let totalRedacted = 0;
  let totalCleaned = 0;

  for (const target of targets) {
    console.log(`📂 扫描: ${path.join(target.root, target.rel)}`);
    const result = cleanSnapshotsFile(target.root, target.rel);
    if (!result) {
      console.log('  → 文件不存在，跳过');
      console.log('');
      continue;
    }

    totalCleaned++;
    totalRedacted += result.redacted;

    console.log(`  📝 追溯脱敏 ${result.redacted} 个字段`);
    if (result.rotated) {
      console.log(`  🔄 滚动裁剪到最近 ${MAX_SNAPSHOTS} 条快照`);
    }
    console.log(`  💾 文件大小: ${formatBytes(result.sizeBefore)} → ${formatBytes(result.sizeAfter)}`);
    console.log('');
  }

  console.log('━━━ 汇总 ━━━');
  console.log(`  处理文件: ${totalCleaned}`);
  console.log(`  脱敏字段: ${totalRedacted}`);
  console.log('');
  console.log('💡 备份文件已保存为 .bak，确认无误后可手动删除。');
  console.log('');
}

main();
