// ============================================================
// fde-session-mgr/ · FDE 进场记忆目录工程化（v1.4.5 第八章）
// ============================================================
//
// data/fde-sessions/<client-id>/ 标准 10 文件结构自动初始化
// （fde_interview 首次调用触发）+ session-stop 自动捕获状态文件
// + 新 session 启动检测既有客户目录 → 自动恢复上下文。
//
// 与 v1.3.5 fde-session/（引擎包内进场记忆——按 sessionId 组织，
// 供 orchestrator API 层消费）的分工：
//   - fde-session/：面向「会话」的记忆单元（context.md + meta.json），
//     API 层交付，路径在 {dataDir}/fde/sessions/<sessionId>/
//   - 本模块：面向「客户」的进场记忆目录（10 文件结构），路径在
//     {dataDir}/fde-sessions/<client-id>/，MCP fde_interview 首次
//     调用自动初始化，FDE Harness 层交付（对齐 v1.3.7 load-chain
//     hook 模式——挂载点在工具调用入口，不侵入 core）
//
// 10 文件结构（devlog 第八章定义——FDE 进场记忆标准件）：
//   ① context.md            进场上下文（行业/平台/联系人/当前阶段）
//   ② profile.json          企业画像（fde-workbench interview.json 摘要镜像）
//   ③ history.jsonl         会话历史索引（append-only——每次 session 一行）
//   ④ decisions.md          关键决策记录（人工/FDE 追加）
//   ⑤ open-questions.md     未解决问题清单
//   ⑥ next-steps.md         下一步计划
//   ⑦ deliverables.md       交付物清单（引擎产物索引）
//   ⑧ session-state.json    最近一次 session-stop 捕获的状态快照
//   ⑨ handoff.md            离场交接备忘（对齐 FDE/GUIDE §5.8 交接清单）
//   ⑩ meta.json             目录元数据（clientId/createdAt/initializedBy）
// ============================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/** 10 文件结构清单（顺序即编号） */
export const FDE_SESSION_TEN_FILES: readonly string[] = [
  'context.md',
  'profile.json',
  'history.jsonl',
  'decisions.md',
  'open-questions.md',
  'next-steps.md',
  'deliverables.md',
  'session-state.json',
  'handoff.md',
  'meta.json',
] as const;

/** 目录元数据（meta.json——⑩） */
export interface FDEClientMeta {
  schemaVersion: 'v1';
  /** 客户标识（目录名） */
  clientId: string;
  /** 初始化触发源（fde_interview / manual） */
  initializedBy: string;
  /** 初始化时间（ISO） */
  createdAt: string;
  /** 最近一次 session-stop 捕获时间（ISO——未捕获为 null） */
  lastCapturedAt: string | null;
  /** 最近一次恢复时间（ISO——未恢复为 null） */
  lastRestoredAt: string | null;
}

/** 进场上下文（context.md 的结构化形态——①） */
export interface FDEClientContext {
  clientId: string;
  /** 行业（overlay 标注——对齐 v1.3.7 行业规则包，缺省 unknown 不加载） */
  industry: string;
  /** 企业主要平台/工具 */
  platforms: string[];
  /** FDE 侧联系人 */
  contacts: string[];
  /** 当前阶段（interview → classify → quantify → derive → distill → deploy） */
  stage: string;
  updatedAt: string;
}

/** session-stop 捕获的状态快照（session-state.json——⑧） */
export interface FDESessionState {
  schemaVersion: 'v1';
  clientId: string;
  /** 会话标识（时间戳式——同 client 可多场会话） */
  sessionId: string;
  /** 捕获时间（ISO） */
  capturedAt: string;
  /** 已完成事项 */
  completed: string[];
  /** 进行中事项 */
  inProgress: string[];
  /** 下一步 */
  nextSteps: string[];
  /** 未解决问题 */
  openQuestions: string[];
  /** 累计访谈节点数（profile 镜像——0 表示尚无访谈） */
  nodeCount: number;
  /** 累计岗位分布（profile 镜像） */
  roles: string[];
}

/** 恢复结果（新 session 启动检测既有目录 → 自动恢复） */
export interface FDERestoreResult {
  /** 是否检测到既有客户目录并恢复 */
  restored: boolean;
  clientId: string;
  /** 恢复的上下文（restored=false 时为 null） */
  context: FDEClientContext | null;
  /** 恢复的最近状态（restored=false 时为 null） */
  sessionState: FDESessionState | null;
  /** 缺失的文件（健康度——10 文件应为空） */
  missingFiles: string[];
  /** 恢复提示（人读） */
  message: string;
}

// ────────────────────────────────────────────────────────────
// 路径解析
// ────────────────────────────────────────────────────────────

/** FDE 客户会话根目录（{dataDir}/fde-sessions/） */
export function fdeClientSessionsRoot(dataDir: string): string {
  return join(dataDir, 'fde-sessions');
}

/** 单客户目录（{dataDir}/fde-sessions/<client-id>/） */
export function fdeClientSessionDir(dataDir: string, clientId: string): string {
  return join(fdeClientSessionsRoot(dataDir), clientId);
}

/** 客户目录是否已初始化（meta.json 在场即视为已初始化） */
export function isFDEClientInitialized(dataDir: string, clientId: string): boolean {
  return existsSync(join(fdeClientSessionDir(dataDir, clientId), 'meta.json'));
}

/** 列出全部已初始化客户目录（跨 session 恢复的检测面） */
export function listFDEClients(dataDir: string): string[] {
  const root = fdeClientSessionsRoot(dataDir);
  if (!existsSync(root)) return [];
  try {
    return require('fs')
      .readdirSync(root, { withFileTypes: true })
      .filter((e: { isDirectory: () => boolean }) => e.isDirectory())
      .map((e: { name: string }) => e.name)
      .sort();
  } catch {
    return [];
  }
}

// ────────────────────────────────────────────────────────────
// 初始化（fde_interview 首次调用触发）
// ────────────────────────────────────────────────────────────

/**
 * 初始化客户目录——标准 10 文件结构。
 *
 * 幂等：已初始化（meta.json 在场）直接返回既有目录不重写
 * （防重复调用覆盖既有记忆）。clientId 含路径逃逸字符直接拒。
 *
 * @param dataDir 数据目录
 * @param clientId 客户标识（企业 ID——与 fde_interview 的 enterprise_id 同源）
 * @param options 初始化源与时钟（测试注入）
 * @returns 目录路径 + 是否本次新建
 */
export function initFDEClientSession(
  dataDir: string,
  clientId: string,
  options: { initializedBy?: string; now?: () => number } = {},
): { dir: string; created: boolean; files: string[] } {
  if (typeof clientId !== 'string' || clientId.trim() === '') {
    throw new Error('[fde-session-mgr] clientId 必填且非空');
  }
  // 路径段校验（对齐 train-job isSafePathSegment 纪律——../ 等构造直接拒）
  if (!/^[a-zA-Z0-9._-]+$/.test(clientId)) {
    throw new Error(
      `[fde-session-mgr] clientId 不合法：${clientId}（仅允许字母数字._-——路径逃逸拦截）`,
    );
  }

  const now = options.now ?? Date.now;
  const initializedBy = options.initializedBy ?? 'fde_interview';
  const dir = fdeClientSessionDir(dataDir, clientId);

  if (isFDEClientInitialized(dataDir, clientId)) {
    // 幂等命中——返回既有目录（10 文件以在场者为准）
    return { dir, created: false, files: FDE_SESSION_TEN_FILES.filter((f) => existsSync(join(dir, f))) };
  }

  mkdirSync(dir, { recursive: true });

  // ① context.md——进场上下文骨架
  writeFileSync(
    join(dir, 'context.md'),
    [
      '---',
      `clientId: ${clientId}`,
      'industry: unknown',
      'stage: interview',
      `updatedAt: ${new Date(now()).toISOString()}`,
      '---',
      '',
      `# FDE 进场记忆 · ${clientId}`,
      '',
      '> 首次进场自动初始化（fde_interview 触发）。行业标注后自动加载行业规则包（v1.3.7 overlay）。',
      '',
      '## 企业平台',
      '',
      '- （待访谈补充）',
      '',
      '## 联系人',
      '',
      '- （待访谈补充）',
      '',
      '## 当前阶段',
      '',
      '- interview（访谈中——六引擎第一步）',
      '',
    ].join('\n'),
    'utf-8',
  );

  // ② profile.json——企业画像镜像（fde-workbench interview 产出后回写）
  writeFileSync(
    join(dir, 'profile.json'),
    JSON.stringify(
      {
        schemaVersion: 'v1',
        clientId,
        nodeCount: 0,
        roles: [],
        painKeywords: [],
        source: 'fde-workbench/interview.json（尚未产出——首次 fde_interview 后自动镜像）',
      },
      null,
      2,
    ),
    'utf-8',
  );

  // ③ history.jsonl——会话历史索引（append-only，初始化写第一行）
  appendFileSync(
    join(dir, 'history.jsonl'),
    JSON.stringify({
      ts: new Date(now()).toISOString(),
      event: 'initialized',
      by: initializedBy,
    }) + '\n',
    'utf-8',
  );

  // ④ decisions.md
  writeFileSync(
    join(dir, 'decisions.md'),
    `# 关键决策记录 · ${clientId}\n\n> FDE 与企业共同拍板的事项（决策 + 理由——append-only）。\n\n- （尚无记录）\n`,
    'utf-8',
  );

  // ⑤ open-questions.md
  writeFileSync(
    join(dir, 'open-questions.md'),
    `# 未解决问题 · ${clientId}\n\n> 访谈中悬而未决的问题（解决后移入 decisions.md）。\n\n- （尚无记录）\n`,
    'utf-8',
  );

  // ⑥ next-steps.md
  writeFileSync(
    join(dir, 'next-steps.md'),
    `# 下一步计划 · ${clientId}\n\n> 按优先级排列（session-stop 捕获后自动更新镜像）。\n\n1. 完成首轮五要素访谈（fde_interview）\n`,
    'utf-8',
  );

  // ⑦ deliverables.md
  writeFileSync(
    join(dir, 'deliverables.md'),
    `# 交付物清单 · ${clientId}\n\n> 六引擎产物索引（生成于 data/fde/${clientId}/——本文件是索引不是本体）。\n\n| 产物 | 状态 | 路径 |\n|------|------|------|\n| 访谈记录 | 待产出 | data/fde/${clientId}/interview.json |\n`,
    'utf-8',
  );

  // ⑧ session-state.json——初始空态（首次 session-stop 前占位）
  writeFileSync(
    join(dir, 'session-state.json'),
    JSON.stringify(
      {
        schemaVersion: 'v1',
        clientId,
        sessionId: '',
        capturedAt: null,
        completed: [],
        inProgress: [],
        nextSteps: [],
        openQuestions: [],
        nodeCount: 0,
        roles: [],
      },
      null,
      2,
    ),
    'utf-8',
  );

  // ⑨ handoff.md——交接备忘骨架（对齐 FDE/GUIDE §5.8）
  writeFileSync(
    join(dir, 'handoff.md'),
    `# 离场交接备忘 · ${clientId}\n\n> FDE 离场前逐条确认（对齐 FDE/GUIDE §5.8 交接清单：企业画像 / 部署方案 / 运行规范 / 上手文档四章 + 私有化评估体系）。\n\n- [ ] 企业画像（模板填写）\n- [ ] 部署方案（业务流全景图 + 节点分类）\n- [ ] 运行规范（安装包自带）\n- [ ] 上手文档（安装包自带）\n- [ ] eval.md 初始基线 ≥5 条评分\n`,
    'utf-8',
  );

  // ⑩ meta.json——目录元数据（初始化完成标记）
  writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify(
      {
        schemaVersion: 'v1',
        clientId,
        initializedBy,
        createdAt: new Date(now()).toISOString(),
        lastCapturedAt: null,
        lastRestoredAt: null,
      } satisfies FDEClientMeta,
      null,
      2,
    ),
    'utf-8',
  );

  return { dir, created: true, files: [...FDE_SESSION_TEN_FILES] };
}

// ────────────────────────────────────────────────────────────
// session-stop：自动捕获状态文件
// ────────────────────────────────────────────────────────────

/**
 * session-stop——自动捕获状态文件（⑧ session-state.json）。
 *
 * 对齐 v1.3.7 load-chain hook 模式：捕获动作轻量（纯文件写），
 * 失败不阻断主流程（调用方 catch 降级）。同时追加 history.jsonl
 * 一行（append-only 审计索引）并更新 meta.lastCapturedAt。
 *
 * @param dataDir 数据目录
 * @param state 会话状态快照
 * @returns 写入路径（未初始化的客户目录返回 null——先 init 再 capture）
 */
export function captureFDEClientSession(
  dataDir: string,
  state: FDESessionState,
): string | null {
  if (!isFDEClientInitialized(dataDir, state.clientId)) return null;

  const dir = fdeClientSessionDir(dataDir, state.clientId);
  const statePath = join(dir, 'session-state.json');
  writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');

  // history.jsonl 追加一行（捕获事件索引）
  appendFileSync(
    join(dir, 'history.jsonl'),
    JSON.stringify({
      ts: state.capturedAt,
      event: 'session-stop',
      sessionId: state.sessionId,
      completed: state.completed.length,
      inProgress: state.inProgress.length,
    }) + '\n',
    'utf-8',
  );

  // meta.lastCapturedAt 更新（坏 meta 不阻断——兜底重写）
  const metaPath = join(dir, 'meta.json');
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as FDEClientMeta;
    meta.lastCapturedAt = state.capturedAt;
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
  } catch {
    writeFileSync(
      metaPath,
      JSON.stringify(
        {
          schemaVersion: 'v1',
          clientId: state.clientId,
          initializedBy: 'recovery',
          createdAt: state.capturedAt,
          lastCapturedAt: state.capturedAt,
          lastRestoredAt: null,
        } satisfies FDEClientMeta,
        null,
        2,
      ),
      'utf-8',
    );
  }

  return statePath;
}

// ────────────────────────────────────────────────────────────
// session-start：检测既有客户目录 → 自动恢复
// ────────────────────────────────────────────────────────────

/** 从 context.md 解析结构化上下文（frontmatter——损坏返回 null） */
export function parseFDEClientContext(content: string): FDEClientContext | null {
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return null;
  const fields = new Map<string, string>();
  for (const line of fm[1]!.split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) fields.set(m[1]!, m[2]!.trim());
  }
  const clientId = fields.get('clientId');
  if (!clientId) return null;
  const section = (name: string): string[] => {
    const re = new RegExp(`## ${name}\\n\\n([\\s\\S]*?)(?=\\n## |$)`);
    const m = content.match(re);
    if (!m) return [];
    return m[1]!
      .split('\n')
      .map((l) => l.replace(/^-\s*/, '').replace(/^\d+\.\s*/, '').trim())
      .filter((l) => l !== '' && !l.startsWith('（'));
  };
  return {
    clientId,
    industry: fields.get('industry') ?? 'unknown',
    stage: fields.get('stage') ?? 'interview',
    updatedAt: fields.get('updatedAt') ?? '',
    platforms: section('企业平台'),
    contacts: section('联系人'),
  };
}

/**
 * session-start——检测既有客户目录并自动恢复上下文。
 *
 * 未初始化 / 损坏 → restored=false（新进场，无记忆——调用方降级）。
 * 恢复成功同步更新 meta.lastRestoredAt（恢复也是一次事件）。
 *
 * @param dataDir 数据目录
 * @param clientId 客户标识（缺省取最近捕获的客户——meta.lastCapturedAt 最晚者）
 */
export function restoreFDEClientSession(
  dataDir: string,
  clientId?: string,
  options: { now?: () => number } = {},
): FDERestoreResult {
  const now = options.now ?? Date.now;

  // clientId 缺省：取 lastCapturedAt 最晚的已初始化客户
  let target = clientId;
  if (!target) {
    const clients = listFDEClients(dataDir);
    let best: { id: string; at: string } | null = null;
    for (const c of clients) {
      try {
        const meta = JSON.parse(
          readFileSync(join(fdeClientSessionDir(dataDir, c), 'meta.json'), 'utf-8'),
        ) as FDEClientMeta;
        if (meta.lastCapturedAt && (!best || meta.lastCapturedAt > best.at)) {
          best = { id: c, at: meta.lastCapturedAt };
        }
      } catch {
        // 坏 meta 跳过
      }
    }
    target = best?.id;
    if (!target) {
      return {
        restored: false,
        clientId: '',
        context: null,
        sessionState: null,
        missingFiles: [],
        message: '无已捕获的客户目录——按新进场处理（无记忆）',
      };
    }
  }

  const dir = fdeClientSessionDir(dataDir, target);
  if (!isFDEClientInitialized(dataDir, target)) {
    return {
      restored: false,
      clientId: target,
      context: null,
      sessionState: null,
      missingFiles: [],
      message: `客户目录未初始化：${target}——首次 fde_interview 调用时自动初始化`,
    };
  }

  // context.md + session-state.json 双读（损坏降级 null）
  let context: FDEClientContext | null = null;
  try {
    context = parseFDEClientContext(readFileSync(join(dir, 'context.md'), 'utf-8'));
  } catch {
    context = null;
  }
  let sessionState: FDESessionState | null = null;
  try {
    const parsed = JSON.parse(readFileSync(join(dir, 'session-state.json'), 'utf-8')) as FDESessionState;
    sessionState = parsed.capturedAt ? parsed : null;
  } catch {
    sessionState = null;
  }

  // 健康度：10 文件缺谁报谁
  const missingFiles = FDE_SESSION_TEN_FILES.filter((f) => !existsSync(join(dir, f)));

  // meta.lastRestoredAt 更新（恢复事件留痕——坏 meta 不阻断）
  if (context || sessionState) {
    try {
      const metaPath = join(dir, 'meta.json');
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as FDEClientMeta;
      meta.lastRestoredAt = new Date(now()).toISOString();
      writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
      appendFileSync(
        join(dir, 'history.jsonl'),
        JSON.stringify({ ts: new Date(now()).toISOString(), event: 'session-restore' }) + '\n',
        'utf-8',
      );
    } catch {
      // 恢复事件留痕失败不阻断恢复本身
    }
  }

  const restored = context !== null || sessionState !== null;
  const parts: string[] = [];
  if (context) {
    parts.push(`行业 ${context.industry} · 阶段 ${context.stage} · 平台 ${context.platforms.join('/') || '—'}`);
  }
  if (sessionState) {
    parts.push(
      `上次捕获 ${sessionState.capturedAt} · 进行中 ${sessionState.inProgress.length} 项 · 下一步 ${sessionState.nextSteps.length} 项`,
    );
  }

  return {
    restored,
    clientId: target,
    context,
    sessionState,
    missingFiles,
    message: restored
      ? `已恢复客户「${target}」进场记忆：${parts.join('；')}${missingFiles.length > 0 ? `（注意：${missingFiles.length} 个标准文件缺失：${missingFiles.join('、')}）` : ''}`
      : `客户目录在场但记忆文件损坏（context.md 与 session-state.json 均不可读）——按新进场处理`,
  };
}
