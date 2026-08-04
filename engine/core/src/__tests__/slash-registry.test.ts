// slash-registry.test.ts · Slash 命令注册机制单测
// v1.2.7 新建 · 功能 ①②

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SlashCommandRegistry,
  globalSlashRegistry,
  type SlashCommand,
  type SlashCommandContext,
} from '../slash-registry';

// ── 测试用 mock 命令 ──────────────────────────────

const mockCtx: SlashCommandContext = {
  workspaceRoot: '/tmp/workspace',
  dataDir: '/tmp/data',
  session: {},
};

function makeMockCommand(name: string, output?: string): SlashCommand {
  return {
    name,
    description: `mock ${name}`,
    usage: `/${name} [args]`,
    execute: async (args: string[]) => output ?? `${name} called with: ${args.join(', ')}`,
  };
}

// ── 注册表基础功能 ──────────────────────────────

describe('SlashCommandRegistry', () => {
  let registry: SlashCommandRegistry;

  beforeEach(() => {
    registry = new SlashCommandRegistry();
  });

  describe('register / resolve', () => {
    it('注册后能通过 /name 解析到命令', () => {
      registry.register(makeMockCommand('compact'));
      const result = registry.resolve('/compact');
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe('compact');
      expect(result!.args).toEqual([]);
    });

    it('带参数的输入能正确解析命令名和参数', () => {
      registry.register(makeMockCommand('goal'));
      const result = registry.resolve('/goal 所有 P0 已修复');
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe('goal');
      expect(result!.args).toEqual(['所有', 'P0', '已修复']);
    });

    it('未注册的命令名返回 null', () => {
      registry.register(makeMockCommand('compact'));
      const result = registry.resolve('/unknown');
      expect(result).toBeNull();
    });

    it('非 / 开头的输入返回 null', () => {
      registry.register(makeMockCommand('compact'));
      const result = registry.resolve('hello world');
      expect(result).toBeNull();
    });

    it('空字符串返回 null', () => {
      const result = registry.resolve('');
      expect(result).toBeNull();
    });

    it('只有 / 的输入返回 null', () => {
      registry.register(makeMockCommand('compact'));
      const result = registry.resolve('/');
      expect(result).toBeNull();
    });
  });

  describe('register 校验', () => {
    it('注册空名命令抛出异常', () => {
      const emptyCmd = makeMockCommand('');
      expect(() => registry.register(emptyCmd)).toThrow('不能为空');
    });

    it('注册空白名命令抛出异常', () => {
      const spaceCmd = makeMockCommand('   ');
      expect(() => registry.register(spaceCmd)).toThrow('不能为空');
    });

    it('同名命令后注册者覆盖先注册者', () => {
      registry.register(makeMockCommand('compact', 'old'));
      registry.register(makeMockCommand('compact', 'new'));
      expect(registry.size).toBe(1);
      const result = registry.resolve('/compact');
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe('compact');
    });
  });

  describe('execute', () => {
    it('解析并执行已注册命令', async () => {
      registry.register(makeMockCommand('test', 'executed'));
      const output = await registry.execute('/test arg1 arg2', mockCtx);
      expect(output).toBe('executed');
    });

    it('未注册命令抛出异常', async () => {
      await expect(registry.execute('/nope', mockCtx)).rejects.toThrow('未识别');
    });

    it('非 slash 输入抛出异常', async () => {
      await expect(registry.execute('plain text', mockCtx)).rejects.toThrow('未识别');
    });

    it('参数传递给 execute 方法', async () => {
      const cmd: SlashCommand = {
        name: 'echo',
        description: 'echo args',
        usage: '/echo <text>',
        execute: async (args: string[]) => args.join(' '),
      };
      registry.register(cmd);
      const output = await registry.execute('/echo hello world', mockCtx);
      expect(output).toBe('hello world');
    });
  });

  describe('listCommands', () => {
    it('空注册表返回空数组', () => {
      expect(registry.listCommands()).toEqual([]);
    });

    it('返回所有已注册命令', () => {
      registry.register(makeMockCommand('compact'));
      registry.register(makeMockCommand('goal'));
      const list = registry.listCommands();
      expect(list).toHaveLength(2);
      const names = list.map((c) => c.name);
      expect(names).toContain('compact');
      expect(names).toContain('goal');
    });
  });

  describe('has', () => {
    it('已注册返回 true', () => {
      registry.register(makeMockCommand('compact'));
      expect(registry.has('compact')).toBe(true);
    });

    it('未注册返回 false', () => {
      expect(registry.has('nope')).toBe(false);
    });
  });

  describe('unregister', () => {
    it('注销后命令不再可用', () => {
      registry.register(makeMockCommand('compact'));
      expect(registry.has('compact')).toBe(true);
      registry.unregister('compact');
      expect(registry.has('compact')).toBe(false);
      expect(registry.resolve('/compact')).toBeNull();
    });
  });

  describe('size', () => {
    it('返回已注册命令数', () => {
      expect(registry.size).toBe(0);
      registry.register(makeMockCommand('a'));
      registry.register(makeMockCommand('b'));
      expect(registry.size).toBe(2);
    });
  });
});

// ── 全局注册表 ──────────────────────────────

describe('globalSlashRegistry', () => {
  it('是 SlashCommandRegistry 实例', () => {
    expect(globalSlashRegistry).toBeInstanceOf(SlashCommandRegistry);
  });
});
