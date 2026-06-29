// ============================================================
// compress-memory.ts · think.md 合并压缩 + 日志归档
// v0.97: 从 compress-memory.sh 迁移到 TS，零外部依赖
// ============================================================
// 功能：
//   1. 归档 think.md 中 60 天前的旧反思条目到 think.archive.md
//   2. 备份当前 think.md，仅保留最近 3 份备份
//   3. 提取 think.md 摘要（最近 N 条的标签和结论）
// ============================================================

import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const VERSION = '0.97';

/** think.md 路径 */
function getThinkPath(dataBase?: string): string {
  const base = dataBase || process.env.SOFAGENT_DATA || join(homedir(), '.sofagent');
  return join(base, 'think.md');
}

/** think.archive.md 路径 */
function getArchivePath(dataBase?: string): string {
  const base = dataBase || process.env.SOFAGENT_DATA || join(homedir(), '.sofagent');
  return join(base, 'think.archive.md');
}

/** 数据目录路径 */
function getDataBase(): string {
  return process.env.SOFAGENT_DATA || join(homedir(), '.sofagent');
}

/**
 * 归档 60 天前的反思条目
 * @returns 移动的条目数
 */
export function archiveOldEntries(dataBase?: string): number {
  const thinkPath = getThinkPath(dataBase);
  if (!existsSync(thinkPath)) return 0;

  const archivePath = getArchivePath(dataBase);
  const content = readFileSync(thinkPath, 'utf-8');
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 3600 * 1000);

  const lines = content.split('\n');
  const active: string[] = [];
  const archive: string[] = [];
  let currentBlock: string[] = [];
  let currentDateStr = '';
  let moved = 0;

  for (const line of lines) {
    const dateMatch = line.match(/^##\s+(20\d{2}-\d{2}-\d{2})/);
    if (dateMatch) {
      // Output previous block
      if (currentBlock.length > 0 && currentDateStr) {
        const blockDate = new Date(currentDateStr);
        if (blockDate < sixtyDaysAgo) {
          archive.push(...currentBlock, '');
          moved++;
        } else {
          active.push(...currentBlock, '');
        }
      }
      currentDateStr = dateMatch[1]!;
      currentBlock = [line];
    } else {
      currentBlock.push(line);
    }
  }

  // Last block
  if (currentBlock.length > 0 && currentDateStr) {
    const blockDate = new Date(currentDateStr);
    if (blockDate < sixtyDaysAgo) {
      archive.push(...currentBlock);
      moved++;
    } else {
      active.push(...currentBlock);
    }
  }

  if (moved > 0 && archive.length > 0) {
    writeFileSync(thinkPath, active.join('\n'));
    const archiveContent = existsSync(archivePath)
      ? readFileSync(archivePath, 'utf-8') + '\n' + archive.join('\n')
      : archive.join('\n');
    writeFileSync(archivePath, archiveContent);
  }

  return moved;
}

/**
 * 备份 think.md，仅保留最近 3 份备份
 */
export function rotateBackups(dataBase?: string): string | null {
  const thinkPath = getThinkPath(dataBase);
  if (!existsSync(thinkPath)) return null;

  const base = dataBase || getDataBase();
  const dateStr = new Date().toISOString().slice(0, 10);
  const backupPath = join(base, `think.${dateStr}.bak`);

  copyFileSync(thinkPath, backupPath);

  // 删除超过 3 份的旧备份
  const backupFiles = readdirSync(base)
    .filter(f => f.startsWith('think.') && f.endsWith('.bak'))
    .map(f => ({ name: f, path: join(base, f), mtime: statSync(join(base, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (let i = 3; i < backupFiles.length; i++) {
    try { unlinkSync(backupFiles[i]!.path); } catch { /* */ }
  }

  return backupPath;
}

/**
 * 提取 think.md 摘要——最近 N 条反思的标签和结论
 */
export function extractSummary(dataBase?: string, limit = 10): { label: string; conclusion: string; date: string }[] {
  const thinkPath = getThinkPath(dataBase);
  if (!existsSync(thinkPath)) return [];

  const content = readFileSync(thinkPath, 'utf-8');
  const entries: { label: string; conclusion: string; date: string }[] = [];

  const dateRegex = /^##\s+(20\d{2}-\d{2}-\d{2})/;
  const labelRegex = /-?\s*#([^\s#]+)/;
  const blocks = content.split(/\n(?=## 20\d{2})/);

  for (const block of blocks) {
    if (entries.length >= limit) break;
    const dateMatch = block.match(dateRegex);
    if (!dateMatch) continue;

    const labels = block.match(labelRegex);
    const label = labels ? '#' + labels[1]! : '未分类';

    // 提取第一段非标题内容作为结论摘要
    const bodyLines = block.split('\n').filter(l => !l.startsWith('##') && l.trim());
    const conclusion = bodyLines.length > 0
      ? bodyLines[0]!.trim().slice(0, 100)
      : '无结论';

    entries.push({ label, conclusion, date: dateMatch[1]! });
  }

  return entries;
}

// ── CLI ──
function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const summaryOnly = args.includes('--summary');

  if (args.includes('--help')) {
    console.log(`sofagent compress-memory v${VERSION}`);
    console.log('  压缩 think.md 反思区 + 日志归档');
    console.log('');
    console.log('  用法:');
    console.log('    node compress-memory.js              正常压缩');
    console.log('    node compress-memory.js --dry-run    仅预览');
    console.log('    node compress-memory.js --summary    提取摘要');
    process.exit(0);
  }

  const dataBase = getDataBase();
  mkdirSync(dataBase, { recursive: true });

  if (summaryOnly) {
    const summary = extractSummary(dataBase);
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  }

  if (dryRun) {
    const thinkPath = getThinkPath(dataBase);
    if (!existsSync(thinkPath)) {
      console.log('think.md 不存在，无需压缩');
      process.exit(0);
    }
    const stats = statSync(thinkPath);
    console.log(`think.md: ${stats.size} bytes`);
    const entries = extractSummary(dataBase, 100);
    console.log(`反思条目: ${entries.length}`);
    console.log('--dry-run 完成。不加参数执行压缩。');
    process.exit(0);
  }

  const moved = archiveOldEntries(dataBase);
  const backup = rotateBackups(dataBase);

  console.log(`压缩完成。`);
  if (moved > 0) console.log(`  已归档 ${moved} 条 60 天前反思 → think.archive.md`);
  if (backup) console.log(`  已备份: ${backup}`);
}

// CLI 入口
if (require.main === module) {
  main();
}
