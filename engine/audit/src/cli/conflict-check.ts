// ============================================================
// audit/cli/conflict-check.ts · 矛盾检测 CLI（v1.2.9 · P2）
// ============================================================
//
// 独立 CLI 供用户手动检查知识矛盾/孤儿/死链。
//   sofagent audit conflict-check [--fix]
//
// 分层边界方案（参数注入）：
//   checkConflict 核心逻辑在 daemon 中。audit 是底层包，不能反向 import daemon。
//   本 CLI 通过参数注入接收 checkConflict 函数——运行时由 index.ts 的
//   命令分发动态 import daemon 并传入。编译期 audit 不依赖 daemon。
// ============================================================

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolveKnowledgeDir } from '@sofagent/core';

/** 矛盾检测结果（与 daemon InspectorResult 结构一致，避免反向依赖） */
export interface ConflictCheckResult {
  name: string;
  triggered: boolean;
  message: string;
  severity: 'info' | 'warning' | 'critical';
}

/** 注入的矛盾检测函数签名 */
export type ConflictCheckFn = (projectDir: string) => ConflictCheckResult;

/**
 * 解析 conflict-check 命令参数
 */
export interface ConflictCheckArgs {
  /** 是否启用 --fix 模式 */
  fix: boolean;
  /** 项目目录（默认 process.cwd()） */
  projectDir: string;
  /** JSON 输出 */
  json: boolean;
}

/**
 * 运行 conflict-check CLI
 *
 * @param args 命令参数
 * @param checkFn 注入的矛盾检测函数（来自 daemon checkConflict）
 */
export function runConflictCheckCli(
  args: ConflictCheckArgs,
  checkFn: ConflictCheckFn,
): number {
  const result = checkFn(args.projectDir);

  if (args.json) {
    console.log(JSON.stringify({
      command: 'conflict-check',
      ...result,
      fix: args.fix,
    }, null, 2));
  } else {
    const icon = result.severity === 'critical' ? '❌' :
                 result.severity === 'warning' ? '⚠️' : '✅';
    console.log(`\n${icon} [conflict-check] ${result.message}`);

    if (result.triggered) {
      console.log('\n  详细说明：');
      console.log('  - 矛盾：同名 entity 在多目录有不同 domain → 人工统一');
      console.log('  - 孤儿：文件系统有页面但 index.md 未登记 → 补登记');
      console.log('  - 死链：指向不存在的 .md 文件 → 修正链接或创建文件');
      if (args.fix) {
        console.log('\n  --fix 模式：尝试自动修复孤儿条目...');
        tryAutoFix(args.projectDir);
      }
    }
  }

  // exit code: 0=healthy, 1=warning, 2=critical
  return result.severity === 'critical' ? 2 :
         result.severity === 'warning' ? 1 : 0;
}

/**
 * 尝试自动修复（当前只支持孤儿条目登记到 index.md）
 *
 * 最小实现：扫描各子目录的 .md 文件，在对应 index.md 补登记缺失的页面。
 * 矛盾/死链不自动修复（需人工判断）。
 */
function tryAutoFix(projectDir: string): void {
  const knowledgeDir = resolveKnowledgeDir();
  if (!existsSync(knowledgeDir)) return;

  const subdirs = ['entities', 'concepts', 'comparisons', 'summaries'];

  for (const subdir of subdirs) {
    const subdirAbs = join(knowledgeDir, subdir);
    if (!existsSync(subdirAbs)) continue;

    const indexPath = join(subdirAbs, 'index.md');
    let indexContent = '';
    if (existsSync(indexPath)) {
      try {
        indexContent = readFileSync(indexPath, 'utf-8');
      } catch {
        // skip
      }
    }

    // 扫描 .md 文件
    let entries: string[];
    try {
      entries = readdirSync(subdirAbs).filter(
        (n) => n.endsWith('.md') && n !== 'index.md',
      );
    } catch {
      continue;
    }

    let added = 0;
    let newContent = indexContent;
    for (const file of entries) {
      const slug = file.replace(/\.md$/, '');
      // 检查是否已在 index.md 中
      if (indexContent.includes(slug)) continue;

      // 追加到 index.md 末尾
      if (!newContent.endsWith('\n') && newContent.length > 0) {
        newContent += '\n';
      }
      newContent += `| [${slug}](${slug}.md) | 待补充 | - |\n`;
      added++;
    }

    if (added > 0) {
      try {
        writeFileSync(indexPath, newContent, 'utf-8');
        console.log(`  ✅ ${subdir}/index.md: 补登记 ${added} 个孤儿条目`);
      } catch {
        console.log(`  ⚠️  ${subdir}/index.md: 写入失败`);
      }
    }
  }
}

/**
 * 参数解析辅助：从 argv 数组中提取 conflict-check 参数
 */
export function parseConflictCheckArgs(argv: string[]): ConflictCheckArgs {
  const args: ConflictCheckArgs = {
    fix: false,
    projectDir: process.cwd(),
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--fix') {
      args.fix = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--project' && argv[i + 1]) {
      i++;
      args.projectDir = argv[i]!;
    }
  }

  return args;
}
