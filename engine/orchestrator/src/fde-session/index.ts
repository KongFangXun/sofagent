// ============================================================
// fde-session/ · FDE 进场记忆工程化（v1.3.6 交付 5 #2）
// ============================================================
//
// session-stop 自动捕获 context.md + 新 session 启动时自动恢复。
//
// 复用现有基建：
//   - session-isolator.ts（v1.3.2 Session 隔离）的 workspace 约定
//   - fde/ 目录（compose-interview/ontology-draft/workflow-draft 同款模式）
//
// 存储约定：
//   {dataDir}/fde/sessions/<sessionId>/context.md     ← 会话上下文（捕获+恢复）
//   {dataDir}/fde/sessions/<sessionId>/meta.json      ← 会话元数据
//   {dataDir}/fde/sessions/current.json               ← 最近一次会话指针（快速恢复）
//
// 与 session-isolator 的关系：isolator 负责「跑隔离进程」，本模块负责
// 「进场记忆」——会话结束时把关键上下文落盘，下次进场（FDE 再次进场
// 陪跑）自动带回来。数据走文件不走环境变量（与 isolator handoff 同原则）。
// ============================================================

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/** 会话上下文（context.md 的结构化形态） */
export interface FDESessionContext {
  /** 会话 ID */
  sessionId: string;
  /** 企业 ID */
  enterpriseId: string;
  /** 本场工作主题（如「工作流梳理 · 第一次访谈」） */
  topic: string;
  /** 已完成事项 */
  completed: string[];
  /** 进行中事项（含当前状态） */
  inProgress: Array<{ item: string; status: string }>;
  /** 下一步计划 */
  nextSteps: string[];
  /** 关键决策记录（决策 + 理由） */
  decisions: Array<{ decision: string; reason: string }>;
  /** 未解决问题 */
  openQuestions: string[];
  /** 会话开始时间（ISO） */
  startedAt: string;
  /** 会话结束时间（ISO，session-stop 时写入） */
  endedAt?: string;
}

/** 会话元数据 */
export interface FDESessionMeta {
  sessionId: string;
  enterpriseId: string;
  topic: string;
  startedAt: string;
  endedAt?: string;
  /** context.md 路径（相对 dataDir） */
  contextRef: string;
}

// ────────────────────────────────────────────────────────────
// 路径解析
// ────────────────────────────────────────────────────────────

/** FDE 会话根目录 */
export function fdeSessionsDir(dataDir: string): string {
  return join(dataDir, 'fde', 'sessions');
}

/** 单会话目录 */
export function fdeSessionDir(dataDir: string, sessionId: string): string {
  return join(fdeSessionsDir(dataDir), sessionId);
}

/** context.md 路径 */
export function fdeContextPath(dataDir: string, sessionId: string): string {
  return join(fdeSessionDir(dataDir, sessionId), 'context.md');
}

/** 最近会话指针路径 */
export function fdeCurrentSessionPath(dataDir: string): string {
  return join(fdeSessionsDir(dataDir), 'current.json');
}

// ────────────────────────────────────────────────────────────
// session-stop：上下文捕获
// ────────────────────────────────────────────────────────────

/**
 * 渲染 context.md（人类可读 + 结构化 frontmatter 双形态）。
 */
export function renderContextMd(ctx: FDESessionContext): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push(`sessionId: ${ctx.sessionId}`);
  lines.push(`enterpriseId: ${ctx.enterpriseId}`);
  lines.push(`topic: ${ctx.topic}`);
  lines.push(`startedAt: ${ctx.startedAt}`);
  if (ctx.endedAt) lines.push(`endedAt: ${ctx.endedAt}`);
  lines.push('---');
  lines.push('');
  lines.push(`# FDE 会话上下文 · ${ctx.topic}`);
  lines.push('');
  lines.push('## 已完成');
  lines.push('');
  for (const c of ctx.completed) lines.push(`- [x] ${c}`);
  if (ctx.completed.length === 0) lines.push('- （无）');
  lines.push('');
  lines.push('## 进行中');
  lines.push('');
  for (const p of ctx.inProgress) lines.push(`- [ ] ${p.item}（${p.status}）`);
  if (ctx.inProgress.length === 0) lines.push('- （无）');
  lines.push('');
  lines.push('## 下一步');
  lines.push('');
  for (const n of ctx.nextSteps) lines.push(`1. ${n}`);
  if (ctx.nextSteps.length === 0) lines.push('1. （无）');
  lines.push('');
  lines.push('## 关键决策');
  lines.push('');
  if (ctx.decisions.length === 0) {
    lines.push('- （无）');
  } else {
    for (const d of ctx.decisions) lines.push(`- **${d.decision}** —— ${d.reason}`);
  }
  lines.push('');
  lines.push('## 未解决问题');
  lines.push('');
  for (const q of ctx.openQuestions) lines.push(`- ? ${q}`);
  if (ctx.openQuestions.length === 0) lines.push('- （无）');
  lines.push('');
  return lines.join('\n');
}

/**
 * session-stop——捕获会话上下文到 context.md。
 *
 * 写 {dataDir}/fde/sessions/<sessionId>/context.md + meta.json，
 * 并更新 current.json 指针（下次进场快速恢复）。
 *
 * @param dataDir 数据目录
 * @param ctx 会话上下文
 */
export function captureFDESession(dataDir: string, ctx: FDESessionContext): void {
  const dir = fdeSessionDir(dataDir, ctx.sessionId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const contextPath = fdeContextPath(dataDir, ctx.sessionId);
  writeFileSync(contextPath, renderContextMd(ctx), 'utf-8');

  const meta: FDESessionMeta = {
    sessionId: ctx.sessionId,
    enterpriseId: ctx.enterpriseId,
    topic: ctx.topic,
    startedAt: ctx.startedAt,
    ...(ctx.endedAt ? { endedAt: ctx.endedAt } : {}),
    contextRef: join('fde', 'sessions', ctx.sessionId, 'context.md'),
  };
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');

  // 更新 current 指针
  const sessionsRoot = fdeSessionsDir(dataDir);
  if (!existsSync(sessionsRoot)) mkdirSync(sessionsRoot, { recursive: true });
  writeFileSync(fdeCurrentSessionPath(dataDir), JSON.stringify(meta, null, 2), 'utf-8');
}

// ────────────────────────────────────────────────────────────
// session-start：上下文恢复
// ────────────────────────────────────────────────────────────

/**
 * 解析 context.md 为结构化上下文（frontmatter + Markdown 列表双向可读）。
 * 损坏/缺字段时返回 null（调用方降级为「无记忆新进场」）。
 */
export function parseContextMd(content: string): FDESessionContext | null {
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return null;
  const fields = new Map<string, string>();
  for (const line of fm[1]!.split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) fields.set(m[1]!, m[2]!.trim());
  }
  const sessionId = fields.get('sessionId');
  if (!sessionId) return null;

  const section = (name: string): string[] => {
    const re = new RegExp(`## ${name}\\n\\n([\\s\\S]*?)(?=\\n## |$)`);
    const m = content.match(re);
    if (!m) return [];
    return m[1]!.split('\n').map((l) => l.trim()).filter(Boolean);
  };

  const stripMarker = (l: string): string =>
    l.replace(/^- \[[ x]\]\s*/, '').replace(/^\d+\.\s*/, '').replace(/^- \?\s*/, '');

  const inProgress = section('进行中').map((l) => {
    const m = l.match(/^- \[ \] (.+)（(.+)）$/);
    if (m) return { item: m[1]!, status: m[2]! };
    return { item: stripMarker(l), status: 'unknown' };
  });

  const decisions = section('关键决策').filter((l) => l.startsWith('- **')).map((l) => {
    const m = l.match(/^- \*\*(.+?)\*\* —— (.+)$/);
    return m ? { decision: m[1]!, reason: m[2]! } : { decision: stripMarker(l), reason: '' };
  });

  return {
    sessionId,
    enterpriseId: fields.get('enterpriseId') ?? '',
    topic: fields.get('topic') ?? '',
    startedAt: fields.get('startedAt') ?? '',
    ...(fields.get('endedAt') ? { endedAt: fields.get('endedAt') } : {}),
    completed: section('已完成').map(stripMarker),
    inProgress,
    nextSteps: section('下一步').map(stripMarker),
    decisions,
    openQuestions: section('未解决问题').map(stripMarker),
  };
}

/**
 * session-start——恢复最近一次会话上下文。
 *
 * 优先级：显式 sessionId > current.json 指针。
 * 不存在/损坏 → null（新进场，无记忆）。
 *
 * @param dataDir 数据目录
 * @param sessionId 可选的显式会话 ID
 * @returns 恢复的上下文，或 null
 */
export function restoreFDESession(
  dataDir: string,
  sessionId?: string,
): FDESessionContext | null {
  let targetId = sessionId;
  if (!targetId) {
    const currentPath = fdeCurrentSessionPath(dataDir);
    if (!existsSync(currentPath)) return null;
    try {
      const meta = JSON.parse(readFileSync(currentPath, 'utf-8')) as FDESessionMeta;
      targetId = meta.sessionId;
    } catch {
      return null;
    }
  }
  if (!targetId) return null;

  const contextPath = fdeContextPath(dataDir, targetId);
  if (!existsSync(contextPath)) return null;
  try {
    return parseContextMd(readFileSync(contextPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * 列出全部已捕获会话（按 meta.json 的时间倒序）。
 */
export function listFDESessions(dataDir: string): FDESessionMeta[] {
  const root = fdeSessionsDir(dataDir);
  if (!existsSync(root)) return [];
  const metas: FDESessionMeta[] = [];
  for (const entry of listSessionDirs(root)) {
    const metaPath = join(root, entry, 'meta.json');
    if (!existsSync(metaPath)) continue;
    try {
      metas.push(JSON.parse(readFileSync(metaPath, 'utf-8')) as FDESessionMeta);
    } catch {
      // 坏 meta 跳过
    }
  }
  return metas.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

/** 列目录（容错：不可读返回空） */
function listSessionDirs(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => !f.startsWith('.'));
  } catch {
    return [];
  }
}
