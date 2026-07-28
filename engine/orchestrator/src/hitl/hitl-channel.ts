// ============================================================
// hitl/hitl-channel.ts · Storage-backed HITL 异步人工确认通道
// v1.2.2 P3b 新增：把 HITL 从「readline 阻塞等终端输入」改为
// 「写请求文件 → 图挂起 → 外部信号触发 → resume」
//
// 设计（借鉴 Mastra suspend/resume）：
// - human_confirm 节点（异步模式）：
//     1. checkpoint.save(phase='before')
//     2. 写请求文件到 {dataDir}/hitl/pending/{checkpointId}.json
//     3. 返回 finalStatus='awaiting_human' → 图自然挂起（不阻塞）
// - 外部信号（Dashboard POST / CLI --resolve / daemon 轮询）：
//     写响应文件到 {dataDir}/hitl/resolved/{checkpointId}.json
// - resumeLoopGraph()：读 checkpoint → 读响应 → routeAfterHuman → 继续
//
// 兼容性：
// - {dataDir}/hitl/pending/ 目录不存在 → 自动降级为 CLI 同步模式
//   （stdin readline 阻塞，行为与 v1.2.1 一致）
// - 两条路径共享同一个 routeAfterHuman 路由函数
// ============================================================

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  copyFileSync,
  unlinkSync,
} from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

// ────────────────────────────────
// 类型定义
// ────────────────────────────────

/** HITL 决策选项（写进请求文件的 options 字段，供 Dashboard/CLI 展示） */
export const HITL_OPTIONS = ['approve', 'reject', 'aborted'] as const;

/** HITL 决策类型 */
export type HITLDecision = 'approve' | 'reject' | 'aborted';

/**
 * HITL 请求——human_confirm 节点写入 pending/ 目录。
 * 字段与 docs/changelog/v1.2/v1.2.2.md §P3b 定义的 schema 一致。
 */
export interface HITLRequest {
  /** 一次 LOOP 运行对应一个 checkpointId（与 FileCheckpointer 共享命名） */
  checkpointId: string;
  /** ISO 时间戳——请求创建时刻 */
  createdAt: string;
  /** 原始任务描述 */
  task: string;
  /** reviewer 产出摘要（给人类看的决策依据） */
  reviewReport: string;
  /** 最近一次审计判定（PASS/WARN/FAIL） */
  auditResult: string;
  /** 当前重试次数 */
  retryCount: number;
  /** 可选决策列表（Dashboard 据此渲染按钮） */
  options: string[];
}

/**
 * HITL 响应——外部信号写入 resolved/ 目录。
 * resumeLoopGraph() 读取后按 decision 走 routeAfterHuman。
 */
export interface HITLResponse {
  /** 与请求的 checkpointId 一一对应 */
  checkpointId: string;
  /** 人工决策：approve=通过 / reject=驳回回 engineer / aborted=人工中断 */
  decision: HITLDecision;
  /** ISO 时间戳——决策时刻 */
  resolvedAt: string;
  /** 可选备注（驳回原因等，追加到 humanFeedback 供 engineer 参考） */
  comment?: string;
}

// ────────────────────────────────
// 目录解析
// ────────────────────────────────

/** pending 目录路径：{dataDir}/hitl/pending */
export function pendingDir(dataDir: string): string {
  return join(dataDir, 'hitl', 'pending');
}

/** resolved 目录路径：{dataDir}/hitl/resolved */
export function resolvedDir(dataDir: string): string {
  return join(dataDir, 'hitl', 'resolved');
}

/**
 * 是否启用异步 HITL 模式。
 * 判定规则：{dataDir}/hitl/pending/ 目录存在 → 异步；
 * 不存在 → 降级 CLI 同步模式（stdin readline）。
 * 目录由 Dashboard/daemon 部署侧负责创建——存在即视为「有外部信号监听者」。
 */
export function shouldUseAsyncHITL(dataDir: string): boolean {
  return existsSync(pendingDir(dataDir));
}

// ────────────────────────────────
// 原子写入（沿用 checkpoint.ts 的 tmp+rename 范式）
// ────────────────────────────────

function atomicWriteSync(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`;
  writeFileSync(tmp, content, 'utf-8');
  try {
    renameSync(tmp, filePath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EXDEV') {
      // 跨设备场景降级为 copy+unlink
      copyFileSync(tmp, filePath);
      unlinkSync(tmp);
    } else {
      throw err;
    }
  }
}

// ────────────────────────────────
// 请求/响应读写
// ────────────────────────────────

/**
 * 写 HITL 请求到 pending/{checkpointId}.json。
 * human_confirm 节点在返回 awaiting_human 之前调用。
 * 已存在同名文件时覆盖（同一次 LOOP 重进 human_confirm 属正常重试场景）。
 */
export function writeHITLRequest(dataDir: string, request: HITLRequest): void {
  const dir = pendingDir(dataDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  atomicWriteSync(join(dir, `${request.checkpointId}.json`), JSON.stringify(request, null, 2));
}

/**
 * 读 HITL 响应：resolved/{checkpointId}.json。
 * 无响应（文件不存在/损坏）返回 null——resume 侧据此判定「仍在等待」。
 */
export function readHITLResponse(dataDir: string, checkpointId: string): HITLResponse | null {
  const filePath = join(resolvedDir(dataDir), `${checkpointId}.json`);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    if (
      typeof parsed.checkpointId !== 'string' ||
      typeof parsed.decision !== 'string' ||
      typeof parsed.resolvedAt !== 'string'
    ) {
      return null;
    }
    if (!HITL_OPTIONS.includes(parsed.decision as HITLDecision)) return null;
    return parsed as unknown as HITLResponse;
  } catch {
    return null;
  }
}

/**
 * 写 HITL 响应到 resolved/{checkpointId}.json。
 * 两个调用方：
 * 1. CLI `loop --resolve {checkpointId} --decision ...`（手动发外部信号）
 * 2. CLI 同步模式下测试/脚本模拟外部信号（writeHITLResponse + resumeLoopGraph）
 */
export function writeHITLResponse(dataDir: string, response: HITLResponse): void {
  const dir = resolvedDir(dataDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  atomicWriteSync(join(dir, `${response.checkpointId}.json`), JSON.stringify(response, null, 2));
}
