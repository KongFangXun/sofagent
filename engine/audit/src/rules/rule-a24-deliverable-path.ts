// ============================================================
// A24 交付物落点（安全层 · 工程规范）· v1.5.3 第三章新增
// 检测 diff 中**新增的交付物类文件**的落点是否在**声明白名单**内——
// 「交付物落盘零号铁律」（统一落约定目录、不擅自新建文件夹）从用户纪律
// 升级为产品机制（A 类节点级可判：违规载荷就在 diff 文件路径，可精确归因）。
//
// 归属裁定（devlog §三）：进**扩展集**（7→8）——本规则是「白名单默认空 =
//   全不检，声明才启用」的 opt-in fail-closed，语义与扩展集「显式开启」一致；
//   进默认集会制造「默认启用却恒不触发」的假绿形态（正是第二章要消灭的对象）。
//
// evidenceMode: git-diff（只看 diff 文件路径，纯路径前缀匹配，不读 cwd/fs/git）
// ============================================================

import type { AuditContext, RuleScan, RuleStatus } from './types';

/**
 * 交付物类文件扩展名（报告 / 文档 / 产物）——落点白名单只约束这些。
 * 覆盖常见交付文档与产物格式；企业可用 `A24.deliverable_extensions` 覆盖为自有口径。
 * ⚠️ 不含源码/配置扩展名（.ts/.js/.json/.yaml 等）——避免把普通源码提交误判为交付物。
 */
const DEFAULT_DELIVERABLE_EXTENSIONS: string[] = [
  '.md', '.txt', '.rtf',
  '.pdf', '.doc', '.docx', '.odt',
  '.xls', '.xlsx', '.csv',
  '.ppt', '.pptx',
  '.html', '.htm',
];

/** 取文件扩展名（小写，含点；无扩展名返回空串） */
function extOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

/**
 * A24 交付物落点检测。
 *
 * 判据（fail-closed opt-in）：
 *   1. `config.A24.enabled !== true` ⇒ 跳过（未启用）。
 *   2. 白名单 `allowed_dirs` 为空 ⇒ **全不检**（默认空 = 不约束落点，声明才启用）。
 *   3. 否则：diff 中**新增**（status='added'）且扩展名属交付物类的文件，
 *      其路径须落在白名单中任一目录内（段边界安全的前缀匹配，前缀同名兄弟目录
 *      不放行）；越界判违规（FAIL）并附替代路径建议。
 *
 * 落点白名单即「约定交付目录」（如 `~/Desktop` 交付面或 workflow 声明的 outputs 目录），
 * 对齐 G10 授权白名单模式（默认空 fail-closed）。
 */
export function scanA24(ctx: AuditContext): RuleScan {
  const status: RuleStatus = 'PASS';
  const details: string[] = [];

  const config = ctx.config?.A24;
  // 判据 1：未启用 → 跳过
  if (!config?.enabled) return { status, details };

  // 判据 2：白名单为空 → 全不检（默认空 = 不约束落点）
  const allowedDirs: string[] = config.allowed_dirs ?? [];
  if (allowedDirs.length === 0) {
    details.push('A24：未声明交付目录白名单（allowed_dirs 为空）——按默认「全不检」跳过落点约束。');
    return { status, details };
  }

  const deliverableExts = config.deliverable_extensions ?? DEFAULT_DELIVERABLE_EXTENSIONS;

  const violations: string[] = [];
  for (const file of ctx.diffFiles) {
    // 只约束**新增**的交付物类文件（修改既有文件不算新增交付物）
    if (file.status !== 'added') continue;
    const ext = extOf(file.path);
    if (!deliverableExts.includes(ext)) continue;
    // 落点须在白名单目录内——**段边界安全**：目录归一化后按路径段比较，
    // 防前缀同名兄弟目录绕过（经典前缀匹配失效形态：白名单 docs 放行 docs-evil/x.md）。
    const inWhitelist = allowedDirs.some((dir) => {
      const d = dir.endsWith('/') ? dir.slice(0, -1) : dir;
      return file.path === d || file.path.startsWith(`${d}/`);
    });
    if (!inWhitelist) {
      violations.push(`交付物落点越界: ${file.path}`);
    }
  }

  if (violations.length > 0) {
    const suggestion = allowedDirs.join(' / ');
    return {
      status: 'FAIL',
      details: [
        `${violations.join('; ')}。新增交付物（报告/文档/产物）须落在声明目录内——请改写到白名单目录：${suggestion}（或调整 A24.allowed_dirs 声明面）`,
      ],
    };
  }

  return { status, details };
}
