// ============================================================
// slash-commands-wiring.test.ts · v1.4.5 T3：内置 slash 命令接线测试
// ============================================================
//
// 被测契约：registerBuiltinSlashCommandsFromCore()
//   - 解析 @sofagent/core dist/slash-commands/index.js（文件路径动态引入）
//   - 注册 /compact /goal 到 globalSlashRegistry（零调用 → 有调用）
//   - 幂等：重复调用不重复注册（同名覆盖语义）
// ============================================================

import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { resolveCoreSlashCommandsPath, registerBuiltinSlashCommandsFromCore } from '../slash-commands-wiring';

describe('slash-commands-wiring（v1.4.5 T3）', () => {
  it('test_resolveCoreSlashCommandsPath_解析到core的dist产物路径', () => {
    const p = resolveCoreSlashCommandsPath();
    // 本仓库布局下应解析成功且文件存在（npm 安装布局由 require.resolve 保证）
    expect(p).not.toBeNull();
    expect(existsSync(p!)).toBe(true);
    expect(p!).toContain('slash-commands');
  });

  it('test_registerBuiltinSlashCommandsFromCore_注册compact和goal到全局', async () => {
    const names = await registerBuiltinSlashCommandsFromCore();
    // v1.4.4 core 内置两命令：compact + goal
    expect(names).toContain('compact');
    expect(names).toContain('goal');

    // 全局注册表可 resolve（此前零注册——这是 T3 修复的可观测断言）
    const registryMod = (await import(resolveCoreSlashCommandsPath()!.replace(
      /dist[\\/]slash-commands[\\/]index\.js$/,
      'dist/slash-registry.js',
    ))) as { globalSlashRegistry: { has: (n: string) => boolean; size: number } };
    expect(registryMod.globalSlashRegistry.has('compact')).toBe(true);
    expect(registryMod.globalSlashRegistry.has('goal')).toBe(true);
  }, 20000);

  it('test_registerBuiltinSlashCommandsFromCore_重复调用幂等', async () => {
    await registerBuiltinSlashCommandsFromCore();
    const registryMod = (await import(resolveCoreSlashCommandsPath()!.replace(
      /dist[\\/]slash-commands[\\/]index\.js$/,
      'dist/slash-registry.js',
    ))) as { globalSlashRegistry: { size: number } };
    const sizeAfterFirst = registryMod.globalSlashRegistry.size;
    // 第二次调用——同名覆盖，注册表不膨胀
    await registerBuiltinSlashCommandsFromCore();
    expect(registryMod.globalSlashRegistry.size).toBe(sizeAfterFirst);
  }, 20000);
});
