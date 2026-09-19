// ============================================================
// device-data-push.ts · MCP tool：数据上行通道（v1.5.0 G11 · T3）
// ============================================================
//
// 设备向平台「推」数据的受控入口：设备门禁 → 采集声明校验 → 脱敏 →
// 加密入队（WAL 暂存）→ 尝试上行（游标续传）→ 审计留痕 → 计量进账。
//
// 链路顺序（fail-closed 逐层）：
//   1. gateDevice 闸门（未注册 / 吊销 / 验签失败 → 拒绝）
//   2. authorizeDeviceUpload 采集声明判定（空声明全拒 / 类别未声明拒绝）
//   3. redact 脱敏（原始数据不出设备——验收 ④ 前半）
//   4. enqueueUpload 加密入队（AES-256-GCM——验收 ④ 后半 + ③ 断网暂存）
//   5. flushUploads 传输回调（注入式——真实网络面归调用方；本 tool
//      的传输层是「回调收到密文条目返回 ack 语义」，daemon/skill 侧
//      接线 HTTP/ssh 推送。回调失败 → 条目留在 WAL 等下轮——不丢）
//   6. emitDecision 审计 + 计量（数据量/次数经 evidence 进 worklog/cost）
//
// 默认传输回调：未注入时只入队不发送（返回 queued 状态——手动/定时
// 触发面可先入队后批量冲；这本身就是「断网暂存」的常态语义）。
// ============================================================

import {
  authorizeDeviceUpload,
  redact,
  loadRedactRules,
  getDataDir,
} from '@sofagent/core';

/** 传输回调（注入式传输层——收密文条目，返回是否送达） */
export type UploadTransport = (entry: {
  seq: number;
  deviceId: string;
  category: string;
  destination?: string;
  ciphertext: string;
  iv: string;
  tag: string;
}) => boolean;

/** 推送结果（结构化） */
export interface DeviceDataPushResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  data: {
    isError: boolean;
    ok: boolean;
    reason?:
      | 'not-registered' | 'revoked' | 'invalid-identity' | 'daemon-unavailable'
      | 'empty-policy' | 'device-not-in-policy' | 'category-not-declared' | 'destination-mismatch' | 'invalid-params'
      | 'no-aes-key';
    message: string;
    /** 入队序号（ok=true 时有值） */
    seq?: number;
    /** 本次上行送达状态：sent 已送达并 ack / queued 暂存待传 / partial 部分送达 */
    delivery?: 'sent' | 'queued' | 'partial';
    /** 待传条目数（冲账后仍留在 WAL 的） */
    pending?: number;
    auditLogged: boolean;
  };
}

/**
 * 数据上行（G11）。
 *
 * @param args.identity 设备身份码（过 gateDevice 闸门）
 * @param args.category 数据类别（采集声明内的 category）
 * @param args.payload 上行内容（明文——入队前脱敏 + 加密）
 * @param args.destination 目的地（与声明核对）
 * @param args.transport 传输回调（缺省只入队不发送）
 */
export async function deviceDataPush(args: {
  identity: Record<string, unknown>;
  category: string;
  payload: string;
  destination?: string;
  transport?: UploadTransport;
}): Promise<DeviceDataPushResult> {
  // ── 参数校验 ──
  if (!args.identity || typeof args.identity !== 'object') {
    return {
      text: '[sofagent] 数据上行失败：参数缺失（identity）',
      data: { isError: true, ok: false, reason: 'invalid-params', message: '参数缺失（identity）', auditLogged: false },
    };
  }
  if (!args.category || typeof args.category !== 'string' || typeof args.payload !== 'string') {
    return {
      text: '[sofagent] 数据上行失败：参数缺失（category / payload）',
      data: { isError: true, ok: false, reason: 'invalid-params', message: '参数缺失（category / payload）', auditLogged: false },
    };
  }

  // ── 1. 设备门禁 ──
  let gate: { ok: boolean; reason?: string; message: string; record?: { identity: { agentId: string } } };
  try {
    const daemon = (await import('@sofagent/daemon')) as Record<string, unknown>;
    const fn = daemon.gateDevice;
    if (typeof fn !== 'function') throw new Error('gateDevice 不可用');
    gate = fn(args.identity as never, undefined) as typeof gate;
  } catch {
    return {
      text: '[sofagent] 数据上行失败：@sofagent/daemon 未安装或不可用',
      data: { isError: true, ok: false, reason: 'daemon-unavailable', message: '@sofagent/daemon 未安装或不可用', auditLogged: false },
    };
  }
  if (!gate.ok) {
    return {
      text: `[sofagent] 数据上行拒绝：${gate.message}`,
      data: { isError: true, ok: false, reason: gate.reason as DeviceDataPushResult['data']['reason'], message: gate.message, auditLogged: false },
    };
  }
  const deviceId = gate.record!.identity.agentId;

  // ── 2. 采集声明判定 ──
  const auth = authorizeDeviceUpload(deviceId, args.category, {
    ...(args.destination ? { destination: args.destination } : {}),
  });
  if (!auth.ok) {
    return {
      text: `[sofagent] 数据上行拒绝：${auth.message}`,
      data: { isError: true, ok: false, reason: auth.reason, message: auth.message, auditLogged: false },
    };
  }

  // ── 3. 脱敏 ──
  const rules = loadRedactRules(getDataDir(undefined));
  const redacted = redact(args.payload, rules);

  // ── 4. 加密入队（WAL 暂存——AES-256-GCM，明文不落盘）──
  let wal: {
    enqueueUpload: (deviceId: string, category: string, payload: string, opts?: Record<string, unknown>) => { ok: boolean; seq?: number; reason?: string; message: string };
    pendingUploads: () => Array<{ seq: number; deviceId: string; category: string; destination?: string; ciphertext: string; iv: string; tag: string }>;
    ackUpload: (ackedSeq: number, opts?: Record<string, unknown>) => { ok: boolean; message: string };
    failUpload: (seq: number, reason: string, opts?: Record<string, unknown>) => void;
  };
  try {
    wal = (await import('@sofagent/daemon')) as unknown as typeof wal;
    if (typeof wal.enqueueUpload !== 'function') throw new Error('upload-wal 面不可用');
  } catch {
    return {
      text: '[sofagent] 数据上行失败：upload-wal 面不可用（@sofagent/daemon）',
      data: { isError: true, ok: false, reason: 'daemon-unavailable', message: 'upload-wal 面不可用（@sofagent/daemon）', auditLogged: false },
    };
  }
  const enq = wal.enqueueUpload(deviceId, args.category, redacted.text, {
    redactHits: redacted.totalHits,
    ...(args.destination ? { destination: args.destination } : {}),
  });
  if (!enq.ok) {
    return {
      text: `[sofagent] 数据上行失败：${enq.message}`,
      data: { isError: true, ok: false, reason: enq.reason as DeviceDataPushResult['data']['reason'], message: enq.message, auditLogged: false },
    };
  }

  // ── 5. 传输（注入回调——缺省只入队）──
  let delivery: 'sent' | 'queued' | 'partial' = 'queued';
  let lastAcked = 0;
  if (args.transport) {
    const pending = wal.pendingUploads();
    let sent = 0;
    for (const entry of pending) {
      const delivered = args.transport(entry);
      if (delivered) {
        lastAcked = Math.max(lastAcked, entry.seq);
        sent += 1;
      } else {
        wal.failUpload(entry.seq, '传输回调未送达', { deviceId });
      }
    }
    if (sent > 0 && sent === pending.length) {
      wal.ackUpload(lastAcked, { deviceId });
      delivery = 'sent';
    } else if (sent > 0) {
      wal.ackUpload(lastAcked, { deviceId });
      delivery = 'partial';
    } else {
      delivery = 'queued';
    }
  }

  // ── 6. 审计 + 计量 ──
  let auditLogged = false;
  try {
    const { emitDecision } = await import('@sofagent/audit');
    emitDecision({
      agentId: `device-${deviceId.slice(0, 8)}`,
      sessionId: `device-data-push-${Date.now()}`,
      kind: 'ARTIFACT_EDIT',
      moment: 'ACT',
      category: 'select',
      why: `device_data_push 上行 ${args.category}（${Buffer.byteLength(args.payload, 'utf-8')}B → 脱敏 ${redacted.totalHits} 处 → 加密入队 seq=${enq.seq}，delivery=${delivery}）——依据声明 ${auth.declaration!.category}`,
      artifactRef: `device-upload/${deviceId.slice(0, 8)}/${args.category}`,
      evidence: [
        `category=${args.category}`,
        `payloadBytes=${Buffer.byteLength(args.payload, 'utf-8')}`,
        `redactHits=${redacted.totalHits}`,
        `seq=${enq.seq}`,
        `delivery=${delivery}`,
        `pending=${wal.pendingUploads().length}`,
      ],
    });
    auditLogged = true;
  } catch {
    auditLogged = false; // best-effort 显式标注
  }

  const pendingNow = wal.pendingUploads().length;
  return {
    text: `[sofagent] ✅ 数据上行入队（${args.category} · seq=${enq.seq} · 脱敏 ${redacted.totalHits} 处 · ${delivery === 'sent' ? '已送达' : delivery === 'partial' ? '部分送达' : '暂存待传'}）`,
    data: {
      isError: false,
      ok: true,
      message: `已入队（seq=${enq.seq}，${delivery}）`,
      seq: enq.seq,
      delivery,
      pending: pendingNow,
      auditLogged,
    },
  };
}
