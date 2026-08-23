// ============================================================
// dream-sandbox.ts · Dream Sandbox 沙盒审计（P2 · v1.4.0 十一）
// ============================================================
// Agent 操作先写平行 sandbox 分支，人类 review diff 后点「合并」才生效——
// 约束从「事后审计」升级「事前模拟 + 人工放行」（Palantir AIP 启发）。
//
// 复用底座：
// - v1.3.7 沙箱（目录隔离 + 完整性自检的文件面语义）
// - v1.3.1 always-ask（dream_merge 强制人审——approver 必填 + 未审不合并）
//
// 生命周期：stage（写入 sandbox）→ previewDiff（人审）→ merge（放行）
// 或 24h 自动清理（cleanup）。
// ============================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';

/** 沙盒根目录（缺省 <dataDir>/dream-sandbox/） */
function sandboxRoot(dataDir: string): string {
  return join(dataDir, 'dream-sandbox');
}

/** 一条暂存操作 */
export interface StagedOperation {
  /** 目标文件相对路径（相对仓库根） */
  path: string;
  /** 新内容（merge 时写入目标路径） */
  content: string;
}

/** 沙盒状态 */
export interface DreamSandboxState {
  taskId: string;
  /** 暂存的操作数 */
  stagedCount: number;
  /** 创建时间（ISO） */
  createdAt: string;
  /** 是否已合并 */
  merged: boolean;
}

/** merge 结果 */
export interface DreamMergeResult {
  taskId: string;
  merged: boolean;
  /** 合并的文件数 */
  appliedFiles: number;
  /** 审批人（强制人审——必填非空才合并） */
  approver: string;
  /** 拒绝原因（merged=false 时） */
  reason?: string;
}

/**
 * Dream Sandbox——事前模拟 + 人工放行。
 * 操作写 dream-sandbox/<task-id>/（不动真实文件），diff 预览供人审，
 * dreamMerge 强制 approver 签名才落盘。
 */
export class DreamSandbox {
  constructor(private readonly options: {
    /** 仓库根（merge 写入的目标树） */
    repoRoot: string;
    /** 数据目录（sandbox 根的父级，缺省 data/） */
    dataDir?: string;
  }) {}

  /** 沙盒任务目录 */
  private taskDir(taskId: string): string {
    // taskId 消毒：只留安全字符，防路径穿越
    const safe = taskId.replace(/[^\w.-]/g, '_');
    return join(sandboxRoot(this.options.dataDir ?? process.env.SOFAGENT_DATA ?? 'data'), safe);
  }

  /** 暂存操作——写入沙盒（不动真实文件） */
  stage(taskId: string, operations: StagedOperation[]): DreamSandboxState {
    const dir = this.taskDir(taskId);
    mkdirSync(dir, { recursive: true });
    const meta = this.readMeta(taskId) ?? { taskId, createdAt: new Date().toISOString(), merged: false };
    if (meta.merged) throw new Error(`任务 ${taskId} 已合并——沙盒只读（如需重做用新 task-id）`);
    for (const op of operations) {
      const target = this.sandboxPath(taskId, op.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, op.content, 'utf-8');
    }
    const state: DreamSandboxState = {
      taskId,
      stagedCount: operations.length,
      createdAt: meta.createdAt,
      merged: false,
    };
    this.writeMeta(taskId, { ...state });
    return state;
  }

  /** diff 预览——每个暂存文件与真实文件的差异（人审面） */
  previewDiff(taskId: string): Array<{ path: string; existed: boolean; oldBytes: number; newBytes: number; preview: string }> {
    const dir = this.taskDir(taskId);
    if (!existsSync(dir)) return [];
    const out: Array<{ path: string; existed: boolean; oldBytes: number; newBytes: number; preview: string }> = [];
    for (const relPath of this.listStagedFiles(taskId)) {
      const sandboxFile = this.sandboxPath(taskId, relPath);
      const realFile = join(this.options.repoRoot, relPath);
      const existed = existsSync(realFile);
      const oldContent = existed ? readFileSync(realFile, 'utf-8') : '';
      const newContent = readFileSync(sandboxFile, 'utf-8');
      out.push({
        path: relPath,
        existed,
        oldBytes: Buffer.byteLength(oldContent),
        newBytes: Buffer.byteLength(newContent),
        preview: renderMiniDiff(oldContent, newContent),
      });
    }
    return out;
  }

  /**
   * dream_merge——强制人审后合并（复用 v1.3.1 always-ask 语义）：
   * approver 必填非空（谁审谁签名），未审不合并。
   */
  merge(taskId: string, params: { approver?: string }): DreamMergeResult {
    const dir = this.taskDir(taskId);
    if (!existsSync(dir)) {
      return { taskId, merged: false, appliedFiles: 0, approver: params.approver ?? '', reason: '沙盒不存在（任务未暂存或已清理）' };
    }
    if (!params.approver || params.approver.trim().length === 0) {
      return { taskId, merged: false, appliedFiles: 0, approver: '', reason: '强制人审：approver 必填（谁审谁签名）——未审不合并' };
    }
    const meta = this.readMeta(taskId);
    if (meta?.merged) {
      return { taskId, merged: false, appliedFiles: 0, approver: params.approver, reason: '任务已合并过（沙盒只读）' };
    }
    let applied = 0;
    for (const relPath of this.listStagedFiles(taskId)) {
      const sandboxFile = this.sandboxPath(taskId, relPath);
      const realFile = join(this.options.repoRoot, relPath);
      mkdirSync(dirname(realFile), { recursive: true });
      copyFileSync(sandboxFile, realFile);
      applied++;
    }
    this.writeMeta(taskId, { taskId, createdAt: meta?.createdAt ?? new Date().toISOString(), merged: true, mergedAt: new Date().toISOString(), mergedBy: params.approver });
    return { taskId, merged: true, appliedFiles: applied, approver: params.approver };
  }

  /** 24h 自动清理（超过 maxAgeHours 的沙盒目录删除——含未合并的） */
  cleanup(maxAgeHours = 24): number {
    const root = sandboxRoot(this.options.dataDir ?? process.env.SOFAGENT_DATA ?? 'data');
    if (!existsSync(root)) return 0;
    let removed = 0;
    const cutoff = Date.now() - maxAgeHours * 3600_000;
    for (const entry of readdirSync(root)) {
      const dir = join(root, entry);
      const stat = statSync(dir);
      if (stat.mtimeMs < cutoff) {
        rmSync(dir, { recursive: true, force: true });
        removed++;
      }
    }
    return removed;
  }

  /** 状态查询 */
  state(taskId: string): DreamSandboxState | null {
    const meta = this.readMeta(taskId);
    if (!meta) return null;
    return {
      taskId,
      stagedCount: this.listStagedFiles(taskId).length,
      createdAt: meta.createdAt,
      merged: meta.merged,
    };
  }

  // ── 内部 ──

  /** 沙盒内对应文件路径（保留相对目录结构） */
  private sandboxPath(taskId: string, relPath: string): string {
    const safeRel = relPath.replace(/\.\./g, '__'); // 防穿越
    return join(this.taskDir(taskId), safeRel);
  }

  private metaPath(taskId: string): string {
    return join(this.taskDir(taskId), '.dream-meta.json');
  }

  private readMeta(taskId: string): { taskId: string; createdAt: string; merged: boolean; mergedAt?: string; mergedBy?: string } | null {
    const p = this.metaPath(taskId);
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, 'utf-8'));
    } catch {
      return null;
    }
  }

  private writeMeta(taskId: string, meta: { taskId: string; createdAt: string; merged: boolean; mergedAt?: string; mergedBy?: string }): void {
    mkdirSync(dirname(this.metaPath(taskId)), { recursive: true });
    writeFileSync(this.metaPath(taskId), JSON.stringify(meta, null, 2), 'utf-8');
  }

  private listStagedFiles(taskId: string): string[] {
    const dir = this.taskDir(taskId);
    if (!existsSync(dir)) return [];
    const files: string[] = [];
    const walk = (d: string, prefix: string): void => {
      for (const entry of readdirSync(d)) {
        if (entry === '.dream-meta.json') continue;
        const full = join(d, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) walk(full, `${prefix}${entry}/`);
        else files.push(prefix + entry);
      }
    };
    walk(dir, '');
    return files.sort();
  }
}

/** 极简 unified diff 预览（首尾各 3 行变化——人审速览） */
function renderMiniDiff(oldContent: string, newContent: string): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const out: string[] = [];
  let i = 0;
  for (; i < Math.min(oldLines.length, newLines.length); i++) {
    if (oldLines[i] !== newLines[i]) {
      out.push(`- ${oldLines[i]}`);
      out.push(`+ ${newLines[i]}`);
    }
  }
  for (; i < oldLines.length; i++) out.push(`- ${oldLines[i]}`);
  for (; i < newLines.length; i++) out.push(`+ ${newLines[i]}`);
  return out.slice(0, 12).join('\n') + (out.length > 12 ? `\n…（共 ${out.length} 行变化）` : '');
}
