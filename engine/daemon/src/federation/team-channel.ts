// ============================================================
// team-channel.ts · FederatedTeamSyncChannel（v1.3.4 交付 T02）
//
// daemon 实现 orchestrator 定义的 TeamSyncChannel 接口。
// 复用 v1.1.8 的 FederationChannel（AES-256-GCM 加密链路）传输
// Automerge.save() 的二进制 team-state 增量。
//
// ⚠️ 依赖方向：daemon 单向依赖 orchestrator（import type TeamSyncChannel）。
// orchestrator 绝不反向 import daemon——依赖注入模式（协议设计 §5.3）。
// ============================================================

import type { TeamSyncChannel } from '@sofagent/orchestrator';
import type { FederationChannel } from './channel';

/**
 * 联邦团队同步通道——经 FederationChannel（AES-256-GCM）传输 team-state。
 *
 * 生产路径：FederationChannel 由 OpenClaw SDK 提供（loadOpenClawChannel）。
 * payload 是 Automerge.save() 的二进制——经 channel 传输时已是密文帧
 * （query-router 加密），channel 只搬运密文，不碰明文（纵深防御）。
 *
 * 单机降级：FederationChannel 为 null 时，syncTeamState 静默 no-op
 * （与 LocalTeamSyncChannel 同语义——联邦功能不可用时降级为单机）。
 */
export class FederatedTeamSyncChannel implements TeamSyncChannel {
  private readonly channel: FederationChannel | null;
  private readonly peerId: string;
  private remoteUpdateCallbacks: Array<(binary: Uint8Array) => void> = [];

  constructor(channel: FederationChannel | null, peerId: string) {
    this.channel = channel;
    this.peerId = peerId;
  }

  /**
   * 广播 team-state 增量到团队其他成员的设备。
   *
   * FederationChannel 不可用时降级为 no-op（不抛错——联邦功能是可选增强）。
   *
   * @param binary Automerge.save() 的二进制
   */
  async syncTeamState(binary: Uint8Array): Promise<void> {
    if (!this.channel) {
      // 联邦通道不可用——降级为单机 no-op
      return;
    }
    try {
      // 经 FederationChannel 发送（帧已被 query-router 加密——AES-256-GCM）
      await this.channel.send(
        {
          peerId: this.peerId,
          frame: Buffer.from(binary),
        },
        10000, // 10s 超时
      );
    } catch (err) {
      // 同步失败不阻断本地操作——联邦是 best-effort
      console.error(
        `[team-channel] team-state 同步失败（降级单机）: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * 注册远端更新回调。
   *
   * daemon 的联邦监听线程收到远端 team-state 增量后，经此回调注入到
   * orchestrator 的 TeamManager（触发 CRDT merge）。
   *
   * @param cb 远端更新回调
   */
  onRemoteUpdate(cb: (binary: Uint8Array) => void): void {
    this.remoteUpdateCallbacks.push(cb);
  }

  /**
   * daemon 联邦监听线程调用——收到远端 team-state 增量时触发所有注册的回调。
   *
   * 此方法供 daemon 内部调用（联邦消息接收后），不由 orchestrator 调用。
   *
   * @param binary 远端 team-state 二进制
   */
  receiveRemoteUpdate(binary: Uint8Array): void {
    for (const cb of this.remoteUpdateCallbacks) {
      try {
        cb(binary);
      } catch (err) {
        console.error(
          `[team-channel] 远端更新回调出错: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
