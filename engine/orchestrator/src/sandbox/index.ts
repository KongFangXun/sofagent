// ============================================================
// sandbox/index.ts · SubAgent 沙箱统一入口
// v1.3.6 · v1.3.7 开发① 新增
//
// 把五个组件组装成一个可整体启停的沙箱会话：
//   createSandboxSession() → { vfs, net, gate, keys, agent }
//
// 生命周期：
//   1. createSandboxSession()——启动时跑 vfs.integrityCheck()（攻击面 1 自检）
//   2. SubAgent 执行期间——写经 vfs、网经 net、工具经 gate、凭证经 keys
//   3. teardown()——deny 全部 pending 写入 + 吊销全部虚拟 key + 卸载网络 guard
// ============================================================

import { createFilesystemBackend, FilesystemBackend, FilesystemBackendOptions } from './filesystem-backend';
import { createNetworkGateway, installNetworkGuard, NetworkGateway, NetworkGatewayOptions } from './network-gateway';
import { createToolGate, ToolGate, ToolGateOptions } from './tool-gate';
import { createVirtualKeyManager, VirtualKeyManager, VirtualKeyOptions } from './virtual-key';
import { createAsyncSubAgent, AsyncSubAgent, AsyncSubAgentOptions } from './async-subagent';

export { createFilesystemBackend } from './filesystem-backend';
export { createNetworkGateway, installNetworkGuard } from './network-gateway';
export { createToolGate, gateToolExecution } from './tool-gate';
export { createVirtualKeyManager, buildSandboxEnv } from './virtual-key';
export { createAsyncSubAgent, runDual } from './async-subagent';

export interface SandboxSessionOptions {
  /** 运行时数据目录（vfs 审计日志落 <dir>/sandbox/） */
  dataDir: string;
  vfs?: FilesystemBackendOptions;
  net?: NetworkGatewayOptions;
  gate?: ToolGateOptions;
  keys?: VirtualKeyOptions;
  /** AsyncSubAgent 进程入口（不传则不启 agent——纯库用法） */
  agent?: AsyncSubAgentOptions;
}

export interface SandboxSession {
  vfs: FilesystemBackend;
  net: NetworkGateway;
  gate: ToolGate;
  keys: VirtualKeyManager;
  agent: AsyncSubAgent | null;
  /** 网络守卫是否已 monkey-patch 安装（installNetworkGuard 模式） */
  netGuardInstalled: boolean;
  /** 启动自检结果（攻击面 1）——ok=false 时调用方应拒绝启动沙箱 */
  integrity: { ok: boolean; detail: string };
  /** 安装网络 monkey-patch 守卫（返回卸载函数） */
  installNetGuard(): () => void;
  /** 拆除——pending 全 deny + key 全吊销（SubAgent 会话结束） */
  teardown(): void;
}

/**
 * 创建沙箱会话（组装五件套 + 启动完整性自检）。
 */
export function createSandboxSession(options: SandboxSessionOptions): SandboxSession {
  const vfs = createFilesystemBackend(options.dataDir, options.vfs);
  const net = createNetworkGateway(options.net);
  const gate = createToolGate(options.gate);
  const keys = createVirtualKeyManager(options.keys);
  const agent = options.agent ? createAsyncSubAgent(options.agent) : null;

  // 攻击面 1：启动时完整性自检——hook 指纹漂移 = 拒绝使用本会话
  const integrity = vfs.integrityCheck();
  if (!integrity.ok) {
    // 自检失败仍返回会话对象，但调用方必须检查 integrity.ok 并拒绝启动
    // （返回而非 throw：让调用方拿到事件证据链做审计上报）
  }

  // 网络 monkey-patch 守卫的卸载函数（installNetGuard 时填充）
  let teardownNetRestore: null | (() => void) = null;

  const session: SandboxSession = {
    vfs, net, gate, keys, agent,
    netGuardInstalled: false,
    integrity,
    installNetGuard() {
      const restore = installNetworkGuard(net);
      teardownNetRestore = restore;
      session.netGuardInstalled = true;
      return restore;
    },
    teardown() {
      // pending 写入全部 deny（未审批内容永不落盘）
      for (const w of vfs.listPending()) {
        vfs.deny(w.targetPath);
      }
      // 虚拟 key 全部吊销（凭证生命周期 = 会话生命周期——revokeAll 不暴露真 key）
      keys.revokeAll();
      // 卸载网络守卫（若安装过）
      if (teardownNetRestore) {
        teardownNetRestore();
        teardownNetRestore = null;
        session.netGuardInstalled = false;
      }
    },
  };
  return session;
}
