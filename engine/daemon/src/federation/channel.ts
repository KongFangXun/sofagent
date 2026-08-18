// ============================================================
// channel.ts · OpenClaw channel 路由（联邦传输层）
// v1.3.7 新增
// ============================================================
//
// 联邦查询的传输抽象：
//   - 生产环境：经 OpenClaw channel 发送加密 payload 到配对 peer
//     （第 2 层防线）；payload 已由 query-router 用 AES-256-GCM 加密
//     （第 3 层防线）——channel 被窃听内容也不可读（纵深防御）
//   - 测试/降级环境：经 FederationChannel 接口注入 mock channel
//
// 依赖倒置：daemon 不直接 import OpenClaw SDK（其可用性不确定），
// channel 实例经参数注入；loadOpenClawChannel() 在生产路径做动态加载，
// OpenClaw 未启动时返回 null → query-router 按"全部 peer 离线"降级。

import type { PairedPeer } from '@sofagent/core';

/** 联邦 channel 消息（已加密的 payload 帧） */
export interface ChannelMessage {
  /** 目标 peer */
  peerId: string;
  /** 加密 payload（iv+ciphertext+tag 序列化帧） */
  frame: Buffer;
}

/** 联邦 channel 抽象（生产=OpenClaw，测试=mock） */
export interface FederationChannel {
  /** 发送消息到指定 peer，等待响应帧；超时/离线抛错 */
  send(message: ChannelMessage, timeoutMs: number): Promise<Buffer>;
  /** 探测 peer 是否在线（心跳） */
  ping(peerId: string, timeoutMs: number): Promise<boolean>;
}

/**
 * 生产路径：动态加载 OpenClaw channel。
 *
 * OpenClaw 未启动 / SDK 不可用时返回 null——调用方按离线降级，
 * 不影响本地 MCP server 运行（best-effort 原则）。
 *
 * @returns FederationChannel 实例或 null
 */
export async function loadOpenClawChannel(): Promise<FederationChannel | null> {
  try {
    // OpenClaw channel 接入点留待联调（audit 结论：本地回环 ws:// 明文无 TLS，
    // 第 3 层应用加密是唯一保密防线——因此 channel 只搬运密文帧，绝不碰明文）
    const mod = (await import(/* webpackIgnore: true */ 'openclaw' as string)) as {
      createChannel?: () => FederationChannel;
    };
    if (typeof mod.createChannel === 'function') return mod.createChannel();
    return null;
  } catch {
    return null;
  }
}

/**
 * 内存 channel（测试/双机联调基座）：帧经 handler 直接投递，无网络。
 * @param handler 收到帧后的处理函数（返回响应帧）
 */
export function createMemoryChannel(
  handler: (peerId: string, frame: Buffer) => Promise<Buffer>,
  onlinePeers?: Set<string>,
): FederationChannel {
  return {
    async send(message, _timeoutMs) {
      if (onlinePeers && !onlinePeers.has(message.peerId)) {
        throw new Error(`peer ${message.peerId} 离线`);
      }
      return handler(message.peerId, message.frame);
    },
    async ping(peerId, _timeoutMs) {
      return onlinePeers ? onlinePeers.has(peerId) : true;
    },
  };
}

/** 对已配对 peer 列表做心跳探活，返回在线子集 */
export async function filterOnlinePeers(
  peers: PairedPeer[],
  channel: FederationChannel,
  timeoutMs: number,
): Promise<PairedPeer[]> {
  const checks = await Promise.all(
    peers.map(async (p) => {
      try {
        return (await channel.ping(p.peerId, timeoutMs)) ? p : null;
      } catch {
        return null;
      }
    }),
  );
  return checks.filter((p): p is PairedPeer => p !== null);
}
