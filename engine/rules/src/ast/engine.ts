// ============================================================
// engine.ts · AST 规则引擎核心
// v1.4.4（一）：官方 AST 规则引擎参考实现（sofagent-ruleset-ast）
//
// 依赖说明（TypeScript 7 原生端 API 变迁）：
// TypeScript 7（Go 原生移植）移除了 5.x 的 createSourceFile 同步解析 API，
// 官方替代入口是 `typescript/unstable/sync` 的 API 类——
//   new API() → updateSnapshot({openFiles}) → getDefaultProjectForFile → program.getSourceFile
// 服务端要求文件真实存在于磁盘，因此引擎把扫描内容写入临时目录再解析。
// 虚拟 FS（typescript/unstable/fs）对 openFiles 的项目解析不生效（实测），
// 临时文件是 TS7 下唯一稳定的内存内容解析通道。
//
// 安全约束：
// - 临时文件名 = 序号 + 消毒后的 basename——diff 路径可能含 ../ 穿越，必须消毒
// - typescript 以 peerDependency 声明，require 失败时引擎降级为 WARN（不硬崩）
// - 引擎单例持有 API 实例（server 进程复用），close() 显式回收
// ============================================================

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, basename, extname } from 'path';
import type { AstFinding, AstRule, AstScanInput, AstNodeHost } from './types';
import { builtinAstRules } from './rules';

// ── TypeScript 7 sync API duck-typing（无官方 .d.ts，最小面）──

interface TsSnapshot {
  getProjects(): Array<{ program: { getSourceFile(file: string): unknown } }>;
  getDefaultProjectForFile(file: string):
    | { program: { getSourceFile(file: string): unknown } }
    | undefined;
}

interface TsApi {
  updateSnapshot(params: { openFiles: string[] }): TsSnapshot;
  close(): void;
}

/** 从 typescript/unstable/sync 动态加载 API 构造器（失败返回 null 走降级） */
function loadTsApi(): (new (options?: unknown) => TsApi) | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('typescript/unstable/sync') as { API?: unknown };
    return typeof mod.API === 'function' ? (mod.API as new (o?: unknown) => TsApi) : null;
  } catch {
    return null;
  }
}

/** SyntaxKind 数字→名字 映射（tree-walk 判型用） */
function loadSyntaxKind(): Record<string, number> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ast = require('typescript/unstable/ast') as { SyntaxKind?: Record<string, number> };
    return ast.SyntaxKind ?? {};
  } catch {
    return {};
  }
}

// ── 引擎选项 ──

export interface AstEngineOptions {
  /** 只跑这些规则 ID（缺省跑全部内置规则） */
  ruleIds?: string[];
  /** TS 不可用时的降级行为：返回 WARN finding（默认） */
  onTsUnavailable?: 'warn' | 'throw';
}

// ── 引擎本体 ──

/**
 * AST 规则引擎——把扫描内容落临时文件、驱动 TS7 server 解析、
 * 逐规则遍历语法树产出 finding。
 */
export class AstRuleEngine {
  private readonly rules: readonly AstRule[];
  private readonly onTsUnavailable: 'warn' | 'throw';
  private tsApi: TsApi | null = null;
  private tsApiFailed = false;
  private syntaxKind: Record<string, number> = {};
  private tmpRoot: string | null = null;
  /** extractExports 临时文件序号（每次调用唯一路径——TS7 snapshot 同路径缓存规避） */
  private extractSeq = 0;

  constructor(options: AstEngineOptions = {}) {
    const all = builtinAstRules;
    const filter = options.ruleIds;
    this.rules = filter ? all.filter((r) => filter.includes(r.id)) : all;
    this.onTsUnavailable = options.onTsUnavailable ?? 'warn';
  }

  /** 支持的代码文件后缀（TS7 可解析） */
  private static readonly CODE_EXTS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  ]);

  /**
   * 扫描一批文件——AST 规则走 TS 解析，文本规则直接消费内容。
   * 返回 findings（可能为空；TS 不可用时按策略降级）。
   */
  scan(inputs: readonly AstScanInput[]): AstFinding[] {
    const findings: AstFinding[] = [];
    const codeInputs: Array<{ input: AstScanInput; tmpPath: string }> = [];

    // 第一步：分派——代码文件准备临时落盘，其余走文本规则
    this.ensureTmpRoot();
    inputs.forEach((input, idx) => {
      const ext = extname(input.path).toLowerCase();
      if (AstRuleEngine.CODE_EXTS.has(ext)) {
        codeInputs.push({ input, tmpPath: this.makeTmpPath(idx, input.path) });
      }
    });

    // 第二步：文本规则（不依赖 TS server，先跑）
    for (const input of inputs) {
      for (const rule of this.rules) {
        if (!rule.checkText) continue;
        if (rule.filePattern && !rule.filePattern.test(input.path)) continue;
        const hits: AstFinding[] = [];
        rule.checkText({
          path: input.path,
          text: input.content,
          report: (line, message) =>
            hits.push({ ruleId: rule.id, file: input.path, line, message, severity: rule.severity }),
        });
        findings.push(...hits);
      }
    }

    // 第三步：AST 规则（需要 TS server）
    if (codeInputs.length > 0) {
      const api = this.getTsApi();
      if (!api) {
        // TS 不可用——按策略降级（默认 WARN，让盲区可见而非静默跳过）
        if (this.onTsUnavailable === 'throw') {
          throw new Error(
            '[ast-engine] typescript/unstable/sync 不可用——AST 规则无法执行。' +
            '请安装 typescript >= 7.0.0（peerDependency）。'
          );
        }
        for (const { input } of codeInputs) {
          for (const rule of this.rules) {
            if (!rule.checkCode) continue;
            findings.push({
              ruleId: rule.id,
              file: input.path,
              line: 1,
              message: 'typescript 不可用，AST 规则未执行（降级 WARN，消除盲区）',
              severity: 'WARN',
            });
          }
        }
        return findings;
      }

      // 落盘 + 单次 snapshot 批量打开（server 进程复用）
      for (const { input, tmpPath } of codeInputs) {
        writeFileSync(tmpPath, input.content, 'utf-8');
      }
      const snapshot = api.updateSnapshot({ openFiles: codeInputs.map((c) => c.tmpPath) });

      for (const { input, tmpPath } of codeInputs) {
        const project = snapshot.getDefaultProjectForFile(tmpPath);
        const sf = project?.program.getSourceFile(tmpPath) as
          | (AstNodeHost & {
              text: string;
              getLineAndCharacterOfPosition(pos: number): { line: number };
            })
          | undefined;
        if (!sf) continue;
        for (const rule of this.rules) {
          if (!rule.checkCode) continue;
          if (rule.filePattern && !rule.filePattern.test(input.path)) continue;
          const hits: AstFinding[] = [];
          rule.checkCode({
            path: input.path,
            sourceFile: sf,
            text: sf.text,
            kind: (name: string) => this.kindOf(name),
            report: (node, message) => {
              const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
              hits.push({
                ruleId: rule.id,
                file: input.path,
                line: line + 1,
                message,
                severity: rule.severity,
              });
            },
            reportLine: (line, message) =>
              hits.push({ ruleId: rule.id, file: input.path, line, message, severity: rule.severity }),
          });
          findings.push(...hits);
        }
      }
    }

    return findings;
  }

  /** 释放资源（TS server 进程 + 临时目录） */
  close(): void {
    if (this.tsApi) {
      try { this.tsApi.close(); } catch { /* server 已退出则忽略 */ }
      this.tsApi = null;
    }
    if (this.tmpRoot) {
      try { rmSync(this.tmpRoot, { recursive: true, force: true }); } catch { /* 并发清理竞态可忽略 */ }
      this.tmpRoot = null;
    }
  }

  // ── 内部工具 ──

  private getTsApi(): TsApi | null {
    if (this.tsApi) return this.tsApi;
    if (this.tsApiFailed) return null;
    const Ctor = loadTsApi();
    if (!Ctor) {
      this.tsApiFailed = true;
      return null;
    }
    this.syntaxKind = loadSyntaxKind();
    this.tsApi = new Ctor();
    return this.tsApi;
  }

  /** SyntaxKind 名字→数字（供规则判型；未加载成功时返回 -1 恒不匹配） */
  kindOf(name: string): number {
    return this.syntaxKind[name] ?? -1;
  }

  /**
   * 提取 TS 源文件的 export 符号清单（v1.3.9 四：API 语义解析复用）。
   * 覆盖形态：export {} 块 / export 声明（const·function·class·type·interface）/
   * export default / export *。
   *
   * @returns 符号名 + 语句所在行（1-based）——供 @public/@internal 分级标记对齐
   */
  extractExports(path: string, content: string): Array<{ name: string; line: number }> {
    const out: Array<{ name: string; line: number }> = [];
    const api = this.getTsApi();
    if (!api) return out; // TS 不可用——调用方自行降级（公共 API 检查用正则兜底）
    this.ensureTmpRoot();
    // 🔴 每次调用用唯一临时路径：TS7 snapshot 对同路径已打开文件缓存首次内容，
    // 复用路径会读到上一个调用者的内容（fileChanges 才能改内容——直接换路径最稳）
    const seq = ++this.extractSeq;
    const tmpPath = this.makeTmpPath(seq, `${seq}-${path}`);
    writeFileSync(tmpPath, content, 'utf-8');
    const snapshot = api.updateSnapshot({ openFiles: [tmpPath] });
    const project = snapshot.getDefaultProjectForFile(tmpPath);
    const sf = project?.program.getSourceFile(tmpPath) as
      | (AstNodeHost & {
          text: string;
          statements?: readonly AstNodeHost[];
          getLineAndCharacterOfPosition(pos: number): { line: number };
        })
      | undefined;
    if (!sf) return out;

    const kindIs = (n: AstNodeHost | undefined, k: string) => !!n && n.kind === this.kindOf(k);
    const lineOf = (n: AstNodeHost) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;

    for (const stmt of sf.statements ?? []) {
      // 形态一：export { a, b } from './x' / export { a, b }
      if (kindIs(stmt, 'ExportDeclaration')) {
        const named = (stmt as AstNodeHost & { exportClause?: AstNodeHost }).exportClause;
        if (kindIs(named, 'NamedExports')) {
          const elements = (named as AstNodeHost & { elements?: readonly AstNodeHost[] }).elements ?? [];
          for (const el of elements) {
            // ExportSpecifier：name 是对外导出名（importer 可见），propertyName 是本地名
            // （export { local as exported } → 取 exported；无 as 时 name 即导出名）
            const exported = (el as AstNodeHost & { name?: AstNodeHost; propertyName?: AstNodeHost });
            const name = exported.name?.text ?? exported.propertyName?.text;
            if (name) out.push({ name, line: lineOf(stmt) });
          }
        } else {
          out.push({ name: '*', line: lineOf(stmt) }); // export * from
        }
        continue;
      }
      // 形态二：export default
      if (kindIs(stmt, 'ExportAssignment')) {
        out.push({ name: 'default', line: lineOf(stmt) });
        continue;
      }
      // 形态三：export const/let（VariableStatement 带 export 修饰符）
      if (kindIs(stmt, 'VariableStatement')) {
        const declList = (stmt as AstNodeHost & { declarationList?: AstNodeHost }).declarationList;
        const decls = (declList as AstNodeHost & { declarations?: readonly AstNodeHost[] })?.declarations ?? [];
        for (const d of decls) {
          const name = (d as AstNodeHost & { name?: AstNodeHost }).name?.text;
          if (name) out.push({ name, line: lineOf(stmt) });
        }
        continue;
      }
      // 形态四：export function/class/type/interface/enum —— 有 name 的声明
      const name = (stmt as AstNodeHost & { name?: AstNodeHost }).name?.text;
      if (name && [
        'FunctionDeclaration', 'ClassDeclaration', 'TypeAliasDeclaration',
        'InterfaceDeclaration', 'EnumDeclaration', 'ModuleDeclaration',
      ].some((k) => kindIs(stmt, k))) {
        out.push({ name, line: lineOf(stmt) });
      }
    }
    return out;
  }

  private ensureTmpRoot(): void {
    if (!this.tmpRoot) {
      this.tmpRoot = mkdtempSync(join(tmpdir(), 'sofagent-ast-'));
    }
  }

  /**
   * 临时文件路径：序号前缀防同名冲突 + basename 消毒防路径穿越。
   * 扩展名保留（TS7 靠后缀推断 scriptKind），未知后缀归一为 .ts。
   */
  private makeTmpPath(idx: number, originalPath: string): string {
    const safeBase = basename(originalPath).replace(/[^\w.-]/g, '_') || 'file.ts';
    const ext = extname(safeBase).toLowerCase();
    const normalized = AstRuleEngine.CODE_EXTS.has(ext) ? safeBase : `${safeBase}.ts`;
    mkdirSync(this.tmpRoot!, { recursive: true });
    return join(this.tmpRoot!, `${idx}-${normalized}`);
  }
}
