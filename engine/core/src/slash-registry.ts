// ============================================================
// slash-registry.ts · Slash 命令注册公共机制
// v1.4.5 新建 · 功能 ①②
//
// 提供 SlashCommand 接口 + SlashCommandRegistry 全局注册表：
//   - register(cmd): 注册命令（名不含 /）
//   - resolve(input): 解析用户输入，匹配 /<name> 返回命令+参数
//   - execute(input, ctx): 解析并执行，返回展示给用户的 string
//   - listCommands(): 列出所有已注册命令（help 展示用）
//
// 约定：
//   - 命令名注册时不带 /（注册 "compact"，解析时匹配 "/compact"）
//   - execute 返回 string（直接展示给用户），不返回结构化数据
//   - 未识别的 /xxx 不报错——resolve 返回 null，由调用方决定是否进入正常 agent 流程
// ============================================================

/** Slash 命令上下文——执行时传入的运行时环境 */
export interface SlashCommandContext {
  /** 工作区根目录 */
  workspaceRoot: string;
  /** 数据目录（~/.sofagent/data） */
  dataDir: string;
  /** 当前会话状态（自由结构，各命令按需读取） */
  session: Record<string, unknown>;
}

/** Slash 命令接口 */
export interface SlashCommand {
  /** 命令名，不含 /（如 "compact"、"goal"） */
  name: string;
  /** help 展示用的简短描述 */
  description: string;
  /** 用法示例（如 "/compact [保留条数]"） */
  usage: string;
  /** 执行命令，返回展示给用户的文本 */
  execute(args: string[], ctx: SlashCommandContext): Promise<string>;
}

/** resolve 结果 */
export interface SlashResolveResult {
  command: SlashCommand;
  args: string[];
}

/**
 * Slash 命令注册表——全局单例模式使用。
 *
 * 用法：
 *   const registry = new SlashCommandRegistry();
 *   registry.register(new CompactCommand());
 *   const resolved = registry.resolve('/compact 10');
 *   if (resolved) {
 *     const output = await registry.execute('/compact 10', ctx);
 *   }
 */
export class SlashCommandRegistry {
  private commands = new Map<string, SlashCommand>();

  /**
   * 注册一个 slash 命令。
   * 同名命令后注册者覆盖先注册者（允许热替换/覆盖）。
   * @param cmd 实现 SlashCommand 接口的命令实例
   */
  register(cmd: SlashCommand): void {
    if (!cmd.name || cmd.name.trim() === '') {
      throw new Error('SlashCommand.name 不能为空');
    }
    this.commands.set(cmd.name, cmd);
  }

  /**
   * 注销一个 slash 命令。
   * @param name 命令名（不含 /）
   */
  unregister(name: string): void {
    this.commands.delete(name);
  }

  /**
   * 解析用户输入，判断是否为 slash 命令调用。
   *
   * 匹配规则：
   *   - 输入以 / 开头，后跟已注册的命令名 → 返回 { command, args }
   *   - 输入不以 / 开头 → 返回 null（非 slash 命令）
   *   - 输入以 / 开头但命令名未注册 → 返回 null（未识别不报错）
   *
   * 参数解析：
   *   "/compact 10"     → name="compact", args=["10"]
   *   "/goal 所有 P0"   → name="goal", args=["所有","P0"]（空格分隔）
   *   "/compact"        → name="compact", args=[]
   *
   * @param input 用户原始输入文本
   * @returns 匹配结果，或 null（非 slash 命令 / 未注册命令）
   */
  resolve(input: string): SlashResolveResult | null {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) return null;

    // 提取命令名（/ 后到第一个空格或行尾）
    const rest = trimmed.slice(1);
    const spaceIdx = rest.indexOf(' ');
    const cmdName = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);

    const command = this.commands.get(cmdName);
    if (!command) return null;

    // 解析参数：命令名之后的文本按空格分隔
    const argText = spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1).trim();
    const args = argText ? argText.split(/\s+/) : [];

    return { command, args };
  }

  /**
   * 解析并执行 slash 命令。
   *
   * 未识别的输入（resolve 返回 null）时抛出 Error——
   * 调用方应先调 resolve() 判断是否需要拦截，再决定是否调 execute()。
   *
   * @param input 用户原始输入文本
   * @param ctx 命令执行上下文
   * @returns 命令执行结果文本（展示给用户）
   * @throws Error 当输入不是已注册的 slash 命令时
   */
  async execute(input: string, ctx: SlashCommandContext): Promise<string> {
    const resolved = this.resolve(input);
    if (!resolved) {
      throw new Error(`未识别的 slash 命令: ${input.trim().split(/\s+/)[0] ?? ''}`);
    }
    return resolved.command.execute(resolved.args, ctx);
  }

  /**
   * 列出所有已注册命令（用于 help 展示）。
   * @returns 已注册的 SlashCommand 数组
   */
  listCommands(): SlashCommand[] {
    return Array.from(this.commands.values());
  }

  /**
   * 检查命令是否已注册。
   * @param name 命令名（不含 /）
   */
  has(name: string): boolean {
    return this.commands.has(name);
  }

  /**
   * 获取已注册命令数。
   */
  get size(): number {
    return this.commands.size;
  }
}

/**
 * 全局默认注册表单例（供 handler.ts 等入口处使用）。
 * 各模块 register 自己的命令到此实例。
 */
export const globalSlashRegistry = new SlashCommandRegistry();
