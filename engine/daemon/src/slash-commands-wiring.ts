// ============================================================
// slash-commands-wiring.ts · v1.4.5 T3：内置 slash 命令接线
// ============================================================
//
// 问题：@sofagent/core 的 registerBuiltinSlashCommands（注册 /compact /goal
// 到 globalSlashRegistry）零生产调用——命令实现存在但从未被注册，用户侧
// /compact /goal 永远 resolve 失败。
//
// 接线约束：core 包禁改（并行工作面），且 core barrel（index.ts）未导出
// registerBuiltinSlashCommands、包 exports 只开放 "."——所以经 dist 产物
// 文件路径动态引入（与 cron.ts 解析 orchestrator dist/cli.js 同范式：
// nodeRequire.resolve('@sofagent/core/package.json') 反推包根拼 dist 路径）。
//
// 幂等性：SlashCommandRegistry.register 同名覆盖（后注册者覆盖先注册者），
// 重复调用安全。返回实际注册的命令名列表（调用方打印可见反馈）。
// ============================================================

import { createRequire } from 'module';
import { join, dirname } from 'path';

const nodeRequire = createRequire(__filename);

/** core 包 dist 侧 registerBuiltinSlashCommands 的形状（运行时窄化目标） */
interface BuiltinSlashCommandsModule {
  registerBuiltinSlashCommands: (registry?: { register: (cmd: { name: string }) => void }) => void;
}

/** 最小注册表接口（结构化鸭子类型——不引 core 类型避免编译期耦合） */
interface MinimalRegistry {
  register: (cmd: { name: string }) => void;
  listCommands?: () => Array<{ name: string }>;
}

/**
 * 解析 @sofagent/core 包内 dist/slash-commands/index.js 的绝对路径。
 *
 * 兼容 monorepo workspace 提升与 npm 安装两种布局（Node 模块解析算法）。
 * 解析失败返回 null（调用方 warn 降级——如 core 极简裁剪安装）。
 */
export function resolveCoreSlashCommandsPath(): string | null {
  try {
    const coreRoot = dirname(nodeRequire.resolve('@sofagent/core/package.json'));
    const candidates = [
      join(coreRoot, 'dist', 'slash-commands', 'index.js'),
    ];
    for (const c of candidates) {
      // require.resolve 不作用于文件存在性——用 resolve + 调用方 import 兜底。
      // 此处直接返回首个候选（core 包布局由 exports 保证）。
      return c;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 注册内置 slash 命令到全局注册表（v1.4.5 T3 接线本体）。
 *
 * daemon 启动（cli.ts start 分支）调用一次。返回注册的命令名列表。
 * 失败向上抛（调用方 warn——不影响 daemon 主流程）。
 *
 * 幂等：重复调用安全（registry.register 同名覆盖语义）。
 */
export async function registerBuiltinSlashCommandsFromCore(): Promise<string[]> {
  const modulePath = resolveCoreSlashCommandsPath();
  if (!modulePath) {
    throw new Error('无法解析 @sofagent/core dist/slash-commands/index.js（core 未安装或布局异常）');
  }
  const mod = (await import(modulePath)) as Partial<BuiltinSlashCommandsModule>;
  if (typeof mod.registerBuiltinSlashCommands !== 'function') {
    throw new Error('core dist/slash-commands/index.js 未导出 registerBuiltinSlashCommands（dist 过旧——rebuild core）');
  }
  // 收集注册名（经自定义注册表代理——不污染 globalSlashRegistry 的既有状态，
  // 再把命令 register 进真正的 globalSlashRegistry）。
  const names: string[] = [];
  const proxy: MinimalRegistry = {
    register: (cmd) => { names.push(cmd.name); },
  };
  mod.registerBuiltinSlashCommands(proxy as never);

  // 真实注册到全局单例（core 模块内的 globalSlashRegistry——与
  // dist/slash-commands/index.js 同一 dist 根下的 slash-registry.js）
  const registryMod = (await import(join(dirname(modulePath), '..', 'slash-registry.js'))) as {
    globalSlashRegistry: { register: (cmd: { name: string }) => void; listCommands: () => Array<{ name: string }> };
  };
  const registry = registryMod.globalSlashRegistry;
  if (!registry || typeof registry.register !== 'function') {
    throw new Error('core globalSlashRegistry 不可用（dist 过旧）');
  }
  mod.registerBuiltinSlashCommands(registry as never);
  return names;
}
