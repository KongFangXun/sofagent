// ============================================================
// plugin-adapter.ts · v1.2.9 插件协议适配器
// v1.4.0（一）：官方 AST 引擎以 `sofagent-ruleset-ast` 形态接入——
// 规则集 JSON 声明 type:plugin + plugin:"@sofagent/rules/ast"，
// 与 git-diff pattern 规则同管线（ruleset-loader → plugin-runner）
//
// 插件协议（与 plugin-runner.ts 对齐）：
//   ctx = { diffFiles, options }  →  PluginResult[]
//   PluginResult = { file, line?, message }
// ============================================================

import { readFileSync } from 'fs';
import { join } from 'path';
import { AstRuleEngine } from './engine';
import type { AstScanInput, AstFinding } from './types';

/** 插件上下文（与 @sofagent/audit 的 PluginContext 结构对齐，鸭子类型避免包间硬依赖） */
interface PluginContextShape {
  diffFiles: Array<{
    path: string;
    status?: string;
    lines?: string[];
    /** v1.3.9 十二：超大 diff spill 落盘后的取回定位符 */
    spillFile?: string;
  }>;
  options?: {
    /** 仓库根目录——提供时优先读磁盘上的完整文件（行号精确），否则用 diff 重建 */
    cwd?: string;
    /** 只跑这些规则 ID */
    ruleIds?: string[];
  };
}

/** 插件返回的单条检测结果（与 PluginResult 对齐） */
interface PluginResultShape {
  file: string;
  line?: number;
  message: string;
}

/**
 * 从 diff 行重建「新增内容」（+ 开头行，去掉 diff 头 +++ 行）。
 * 行号是新增行序——磁盘文件缺失时的近似定位。
 */
function reconstructFromDiff(lines: readonly string[]): string {
  return lines
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1))
    .join('\n');
}

/**
 * 插件主入口（plugin-runner 经 require('@sofagent/rules/ast') 加载）。
 * 引擎实例每次调用重建——审计是低频动作，server 启动开销可接受，
 * 换取无状态与进程卫生。
 */
function run(ctx: PluginContextShape): PluginResultShape[] {
  const options = ctx.options ?? {};
  const engine = new AstRuleEngine({ ruleIds: options.ruleIds });
  try {
    const inputs: AstScanInput[] = [];
    for (const f of ctx.diffFiles) {
      if (f.status === 'deleted') continue; // 删除的文件没有「新增内容」可审
      // 优先读磁盘完整文件（行号精确）；读不到再走 diff 重建（近似行号）
      let content: string | null = null;
      if (options.cwd) {
        try {
          content = readFileSync(join(options.cwd, f.path), 'utf-8');
        } catch {
          content = null; // 文件不在工作树（如审计历史 commit）——走重建
        }
      }
      if (content === null) {
        content = reconstructFromDiff(f.lines ?? []);
      }
      if (content.trim().length === 0) continue;
      inputs.push({ path: f.path, content });
    }
    if (inputs.length === 0) return [];
    return engine.scan(inputs).map((f: AstFinding) => ({
      file: f.file,
      line: f.line,
      message: `[${f.ruleId}] ${f.message}`,
    }));
  } finally {
    engine.close();
  }
}

export { run };

/** CommonJS 兼容导出：plugin-runner 认 function 或 { run } 两种形态 */
export default { run };
