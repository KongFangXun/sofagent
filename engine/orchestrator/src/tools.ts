// ============================================================
// tools.ts · LOOP 工具注入 + ToolGate 事前拦截
// v1.2.0 新增（骨架）· v1.2.0 正式启用（工具注入路径落地）
// v1.2.0 新增：ToolGate——接入 @sofagent/rules 做 tool call 事前拦截
//
// 设计核心——双重防御（defense-in-depth）：
//   第一层：约束通过 description 注入，让 Agent 自觉不犯（软约束）
//   第二层：toolGate 在 tool call 前做规则引擎检查（硬拦截）
//   每个工具的 description 内嵌 A1-A17 约束边界，
//   让 Agent 在"理解工具用途"时同步吸收约束，
//   而非事后再用拦截器打补丁。
//
// 工具实现基于 Node.js 内置模块（fs / child_process），
//   不依赖外部 SDK——确保 LOOP engineer/reviewer 节点
//   能在最小依赖下读写文件、跑测试、改代码。
//
// 工具子集：
//   ENGINEER_TOOLS  = 全量 6 个（读/写/改/执行/搜索/测试）
//   REVIEWER_TOOLS  = 只读 3 个（读/搜索/执行）——审查员不写
// ============================================================

import * as fs from 'fs';
import { execSync } from 'child_process';
import { basename } from 'path';
import type { StructuredToolParams } from '@langchain/core/tools';
import { RulesEngine, defaultToolRules } from '@sofagent/rules';
import type { ToolCallContext } from '@sofagent/rules';

// ────────────────────────────────
// 工具类型辅助
// ────────────────────────────────

/**
 * 简易 JSON Schema 描述——DeepAgents 接受 StructuredToolParams
 * （即 { name, description, schema }），schema 为 JSONSchema 对象。
 * 这里用宽松类型避免与 zod 强耦合。
 */
type ToolSchema = {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
};

/**
 * 工具定义——StructuredToolParams 兼容格式。
 * schema 字段使用 JSON Schema（非 zod），由 DeepAgents 运行时适配。
 */
interface LoopTool extends StructuredToolParams {
  name: string;
  description: string;
  schema: ToolSchema;
}

/**
 * 从工具生成执行器——DeepAgents 调用时传入结构化参数，
 * 这里统一封装为 (input: Record<string, unknown>) => string。
 */
interface ExecutableTool extends LoopTool {
  /** 实际执行函数（DeepAgents 通过 func 字段调用） */
  func: (input: Record<string, unknown>) => string;
}

// ────────────────────────────────
// 工具实现（Node.js 内置模块）
// ────────────────────────────────

/**
 * read_file —— 读取文件内容
 *
 * 约束注入：A7 先读再改（修改前必须先读取目标文件）。
 */
const readFileTool: ExecutableTool = {
  name: 'read_file',
  description: [
    '读取指定路径文件的内容并返回。',
    '',
    '【约束 A7 先读再改】修改任何文件之前，必须先用本工具读取目标文件，',
    '确认当前内容与预期一致——禁止盲改。',
  ].join('\n'),
  schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '要读取的文件路径（相对当前工作目录或绝对路径）',
      },
    },
    required: ['path'],
  },
  func: (input) => {
    const filePath = String(input.path ?? '');
    if (!filePath) return '错误：缺少 path 参数';
    try {
      if (!fs.existsSync(filePath)) {
        return `错误：文件不存在 → ${filePath}`;
      }
      return fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      return `读取失败：${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

/**
 * write_file —— 写入新文件
 *
 * 约束注入：
 *   A1 不碰敏感文件（.env / 密钥 / 凭证）
 *   A3 不改越界（只写任务要求的内容）
 *   A16 非授权文件不碰
 */
const writeFileTool: ExecutableTool = {
  name: 'write_file',
  description: [
    '将内容写入指定路径文件（覆盖已有内容）。',
    '',
    '【约束 A1 不碰敏感】禁止写入 .env、密钥、凭证等敏感文件。',
    '【约束 A3 不改越界】只写任务明确要求的内容，不顺便创建无关文件。',
    '【约束 A16 非授权文件不碰】任务未授权的文件路径不要写入。',
  ].join('\n'),
  schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '要写入的文件路径',
      },
      content: {
        type: 'string',
        description: '文件完整内容',
      },
    },
    required: ['path', 'content'],
  },
  func: (input) => {
    const filePath = String(input.path ?? '');
    const content = String(input.content ?? '');
    if (!filePath) return '错误：缺少 path 参数';
    try {
      // 创建父目录（如不存在）
      const dir = require('path').dirname(filePath);
      if (dir && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, content, 'utf-8');
      return `成功：已写入 ${filePath}（${content.length} 字符）`;
    } catch (err) {
      return `写入失败：${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

/**
 * edit_file —— 编辑已有文件（精确替换）
 *
 * 约束注入：同 write_file（A1 / A3 / A16）
 */
const editFileTool: ExecutableTool = {
  name: 'edit_file',
  description: [
    '通过精确字符串替换编辑已有文件。',
    '在指定文件中找到 old_string 并替换为 new_string（仅替换首次匹配）。',
    '',
    '【约束 A1 不碰敏感】禁止编辑 .env、密钥、凭证等敏感文件。',
    '【约束 A3 不改越界】只改任务明确要求的内容。',
    '【约束 A16 非授权文件不碰】任务未授权的文件路径不要编辑。',
  ].join('\n'),
  schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '要编辑的文件路径',
      },
      old_string: {
        type: 'string',
        description: '要被替换的原始文本（必须精确匹配）',
      },
      new_string: {
        type: 'string',
        description: '替换后的新文本',
      },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  func: (input) => {
    const filePath = String(input.path ?? '');
    const oldStr = String(input.old_string ?? '');
    const newStr = String(input.new_string ?? '');
    if (!filePath) return '错误：缺少 path 参数';
    if (!oldStr) return '错误：缺少 old_string 参数';
    try {
      if (!fs.existsSync(filePath)) {
        return `错误：文件不存在 → ${filePath}`;
      }
      const original = fs.readFileSync(filePath, 'utf-8');
      const idx = original.indexOf(oldStr);
      if (idx === -1) {
        return `错误：未在文件中找到 old_string（请确认精确匹配，含空白）→ ${filePath}`;
      }
      const updated = original.slice(0, idx) + newStr + original.slice(idx + oldStr.length);
      fs.writeFileSync(filePath, updated, 'utf-8');
      return `成功：已替换 ${filePath} 中的指定文本`;
    } catch (err) {
      return `编辑失败：${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

/**
 * run_bash —— 执行 shell 命令
 *
 * 约束注入：
 *   A6 不坏构建（变更后确保 build 通过）
 *   A11 不滥资源（禁止 rm -rf / 等破坏性命令）
 *
 * v1.1.4 审查加固：description 约束 + code 黑名单双层防御。
 * 黑名单只拦截明确的高危模式（rm -rf /、:(){:|:&};: fork 炸弹、
 * curl|sh / wget|sh 远程执行），避免误伤合法命令。
 */
const runBashTool: ExecutableTool = {
  name: 'run_bash',
  description: [
    '执行 shell 命令并返回 stdout。',
    '',
    '【约束 A6 不坏构建】任何代码变更后必须确保 build 仍然通过。',
    '【约束 A11 不滥资源】禁止执行破坏性命令（rm -rf /、fork 炸弹、',
    '大规模下载等）；只执行任务必需的命令。',
    '',
    '【硬拦截】以下命令会被工具直接拒绝（defense-in-depth）：',
    '  - rm -rf /（递归删根）',
    '  - :(){:|:&};:（fork 炸弹）',
    '  - curl ... | sh / wget ... | sh（远程脚本执行）',
    '  - mkfs（格式化磁盘）',
    '  - dd if=... of=/dev/（裸设备写入）',
  ].join('\n'),
  schema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: '要执行的 shell 命令',
      },
    },
    required: ['command'],
  },
  func: (input) => {
    const command = String(input.command ?? '');
    if (!command) return '错误：缺少 command 参数';

    // v1.1.4 审查加固：高危命令黑名单（defense-in-depth）
    // description 约束是第一层（让 Agent 自觉不调用），
    // 黑名单是第二层（即使 Agent 忽视 description，工具自身也拒绝执行）
    const blocked = checkDangerousCommand(command);
    if (blocked) {
      return `拒绝执行（高危命令黑名单）：${blocked}`;
    }

    try {
      const stdout = execSync(command, {
        encoding: 'utf-8',
        maxBuffer: 16 * 1024 * 1024,
        timeout: 60_000,
      });
      return stdout || '(命令执行完成，无 stdout 输出)';
    } catch (err: unknown) {
      const e = err as { stderr?: string | Buffer; message?: string; status?: number };
      const stderr = e.stderr ? (typeof e.stderr === 'string' ? e.stderr : e.stderr.toString()) : '';
      return `命令执行失败（exit ${e.status ?? '?'}）：${e.message ?? ''}\n${stderr}`;
    }
  },
};

/**
 * 高危命令黑名单检查（v1.1.4 审查加固）
 *
 * 设计原则：
 *   - 只拦截明确的高危模式，不做模糊匹配（避免误伤合法命令）
 *   - 大小写不敏感
 *   - 匹配到则返回拦截原因，未匹配返回 null
 *
 * 导出用于单元测试——测试直接调用此函数，不通过 execSync 真执行命令。
 *
 * @param command 要检查的命令
 * @returns 拦截原因（string）或 null（放行）
 */
export function checkDangerousCommand(command: string): string | null {
  const lower = command.toLowerCase();

  // rm -rf /（递归删根——允许 rm -rf ./build 这类相对路径）
  // 模式：rm -rf / 或 rm -rf ~ 或 rm -rf /* 或 rm -rf ~/*
  // 注意：/ 和 ~ 不是单词字符，不能用 \b，用 (^|[\s;|&]) 匹配命令起始或分隔符
  const rmPattern = /\brm\s+(-[a-z]*r[a-z]*f*|-[a-z]*f[a-z]*r*)\s+(\/|~\/?|\*|\/\*)/;
  if (rmPattern.test(lower)) {
    return 'rm -rf 删除根目录/家目录/通配符根路径';
  }

  // fork 炸弹：:(){:|:&};: 或变种（注意 () 在正则里要转义）
  const forkPattern = /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/;
  if (forkPattern.test(lower)) {
    return 'fork 炸弹（:(){:|:&};:）';
  }

  // 远程脚本执行：curl ... | sh / wget ... | sh / curl ... | bash
  // 允许 curl/wget 下载文件，禁止管道到 shell 执行
  if (/\b(curl|wget)\b.*\|\s*(sh|bash|zsh|fish)\b/.test(lower)) {
    return 'curl/wget 管道到 shell 远程执行（curl|sh 模式）';
  }

  // mkfs（格式化磁盘）
  if (/\bmkfs\b/.test(lower)) {
    return 'mkfs 格式化磁盘';
  }

  // dd 写裸设备：dd if=... of=/dev/...
  if (/\bdd\b.*\bof=\/dev\//.test(lower)) {
    return 'dd 写入裸设备（/dev/）';
  }

  return null;
}

/**
 * search_code —— Glob/Grep 代码搜索
 *
 * 无特殊约束——只读操作。
 */
const searchCodeTool: ExecutableTool = {
  name: 'search_code',
  description: [
    '在代码库中搜索匹配 pattern 的行（grep -rn 风格）。',
    '可选 glob 参数限定搜索的文件名模式。',
    '',
    '无特殊约束——只读搜索操作。',
  ].join('\n'),
  schema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: '搜索的正则/字符串模式',
      },
      glob: {
        type: 'string',
        description: '可选——限定搜索的文件名 glob 模式（如 *.ts）',
      },
    },
    required: ['pattern'],
  },
  func: (input) => {
    const pattern = String(input.pattern ?? '');
    const glob = input.glob ? String(input.glob) : '';
    if (!pattern) return '错误：缺少 pattern 参数';
    try {
      // 用 grep -rn 实现；glob 通过 --include 限定
      const includeFlag = glob ? ` --include='${glob.replace(/'/g, "'\\''")}'` : '';
      const cmd = `grep -rn${includeFlag} -- '${pattern.replace(/'/g, "'\\''")}' .`;
      const stdout = execSync(cmd, {
        encoding: 'utf-8',
        maxBuffer: 16 * 1024 * 1024,
        timeout: 30_000,
        // grep 无匹配时 exit 1，属正常情况
      });
      // 截断过长输出
      const lines = stdout.split('\n').filter(Boolean);
      if (lines.length === 0) return '无匹配结果';
      if (lines.length > 200) {
        return lines.slice(0, 200).join('\n') + `\n...（共 ${lines.length} 行匹配，已截断显示前 200 行）`;
      }
      return lines.join('\n');
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      // grep exit 1 = 无匹配，不是错误
      if (e.status === 1) return '无匹配结果';
      return `搜索失败：${e.message ?? String(err)}`;
    }
  },
};

/**
 * run_test —— 运行 npm test
 *
 * 约束注入：A8 不逃验证（变更后必须验证）
 */
const runTestTool: ExecutableTool = {
  name: 'run_test',
  description: [
    '运行 `npm test` 并返回输出。',
    '',
    '【约束 A8 不逃验证】任何代码变更完成后，必须运行测试验证，',
    '确认全部通过后再继续——禁止跳过验证步骤。',
  ].join('\n'),
  schema: {
    type: 'object',
    properties: {},
    required: [],
  },
  func: () => {
    try {
      const stdout = execSync('npm test', {
        encoding: 'utf-8',
        maxBuffer: 32 * 1024 * 1024,
        timeout: 300_000, // 5 分钟超时
      });
      return stdout || '(测试执行完成，无输出)';
    } catch (err: unknown) {
      const e = err as { stdout?: string; message?: string; status?: number };
      // npm test 失败时 stdout 可能含部分输出
      const partial = e.stdout ?? '';
      return `测试未通过（exit ${e.status ?? '?'}）：${e.message ?? ''}\n${partial}`;
    }
  },
};

// ────────────────────────────────
// ToolGate · 事前拦截（v1.2.0 新增）
// ────────────────────────────────

/**
 * ToolGate 配置选项
 */
export interface ToolGateOptions {
  /** 发起 tool call 的 Agent 名称（默认 'engineer'） */
  agentName?: string;
  /** 当前任务描述（默认空字符串） */
  taskDesc?: string;
  /** 工作目录（默认 process.cwd()） */
  cwd?: string;
}

/**
 * ToolGate 创建工厂——接入 @sofagent/rules 规则引擎做 tool call 事前拦截。
 *
 * 流程：
 *   1. 构造 ToolCallContext（toolName, args, agentName, taskDesc, cwd）
 *   2. RulesEngine.check(ctx) → 每条规则独立判定
 *   3. RulesEngine.aggregate(verdicts) → 聚合为单一决策
 *   4. FAIL → 返回 { allowed: false, reason }；WARN → { allowed: true, reason }；
 *      PASS → { allowed: true }
 *
 * 当前只用于 LOOP engineer SubAgent 的 tool calls 前置检查，
 * 主 Agent 仍走事后审计路径。
 *
 * @param options 可选配置（agentName / taskDesc / cwd）
 * @returns gate 函数，每次 tool call 前调用
 */
export function createToolGate(options: ToolGateOptions = {}) {
  const engine = new RulesEngine(defaultToolRules);
  const agentName = options.agentName ?? 'engineer';
  const taskDesc = options.taskDesc ?? '';
  const cwd = options.cwd ?? process.cwd();

  return function gate(
    toolName: string,
    args: Record<string, unknown>,
  ): { allowed: boolean; reason?: string } {
    const ctx: ToolCallContext = { toolName, args, agentName, taskDesc, cwd };
    const verdicts = engine.check(ctx);
    const result = engine.aggregate(verdicts);

    if (result.status === 'FAIL') {
      return {
        allowed: false,
        reason: `[${result.ruleName}] ${result.details.join('; ')}`,
      };
    }

    if (result.status === 'WARN') {
      return {
        allowed: true,
        reason: `[${result.ruleName}] ${result.details.join('; ')}`,
      };
    }

    return { allowed: true };
  };
}

/**
 * toolGate 单例——供 orchestrator 在每次 tool call 前调用。
 *
 * 用法：
 *   import { toolGate } from './tools';
 *   const check = toolGate('write_file', { path: '.env', content: '...' });
 *   if (!check.allowed) { /* 拒绝执行 * / }
 */
export const toolGate = createToolGate();

/**
 * 用 ToolGate 包装一组工具——每个 tool call 执行前先过 gate 检查。
 *
 * 包装后：FAIL → 直接返回拒绝信息（不执行原 func）；WARN → 执行但返回值前面拼警告；
 * PASS → 正常执行。
 *
 * v1.2.0 半闭环修复：之前 toolGate 只 export 了但运行时零调用，
 * 本函数让 nodes.ts 在创建 DeepAgent 时调用 wrapToolsWithGate(ENGINEER_TOOLS, gate)，
 * 真正实现 tool call 事前拦截。
 *
 * @param tools 原始工具集
 * @param gate ToolGate gate 函数（由 createToolGate 创建）
 * @returns 包装后的新工具集（不改原数组）
 */
export function wrapToolsWithGate(
  tools: ExecutableTool[],
  gate: ReturnType<typeof createToolGate>,
): ExecutableTool[] {
  return tools.map((tool) => ({
    ...tool,
    func: (input: Record<string, unknown>): string => {
      const check = gate(tool.name, input);
      if (!check.allowed) {
        return `⛔ [ToolGate 拦截] ${tool.name} 被拒绝执行：${check.reason ?? '未知原因'}`;
      }
      const result = tool.func(input);
      if (check.reason) {
        return `⚠️ [ToolGate 告警] ${check.reason}\n\n${result}`;
      }
      return result;
    },
  }));
}

// ────────────────────────────────
// 工具集导出
// ────────────────────────────────

/**
 * 工程师工具集——全量 6 个工具。
 * engineer 节点需要读写文件、跑测试、改代码。
 */
export const ENGINEER_TOOLS: ExecutableTool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  runBashTool,
  searchCodeTool,
  runTestTool,
];

/**
 * 审查员工具集——只读 3 个工具。
 * reviewer 节点只审查不写：读取、搜索、执行（看 build/test 状态）。
 */
export const REVIEWER_TOOLS: ExecutableTool[] = [
  readFileTool,
  searchCodeTool,
  runBashTool,
];
