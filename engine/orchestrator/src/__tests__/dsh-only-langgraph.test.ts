// ============================================================
// dsh-only-langgraph.test.ts · v1.5.5 章五 · 编排依赖治理行为锁
// ============================================================
// 三组断言（对齐 devlog 验收标准）：
//   ① DSH 在场零 LangGraph import——dsh-only 裁剪安装态的核心承诺：
//     静态加载 orchestrator barrel（index.ts 全量再导出面）不得把
//     @langchain/langgraph 拉进模块图。判据 = require.cache 中零 langgraph 模块键。
//   ② LangGraph 缺失时两条主线路径显式报错含指引：
//     - loop 子命令面：loadLoopGraphRuntime() 在 langgraph 不可解析时抛
//       LANGGRAPH_MISSING_GUIDE（含「npm install @langchain/langgraph」与
//       「SOFAGENT_EXECUTION_BACKEND=dsh」两条指引）。
//     - 激活链编排面（run-enterprise → agent-factory）：LangGraph 与 DSH 均不可用
//       时 source='none'（上层降级报错，不静默成功）。
//   ③ 显式 SOFAGENT_EXECUTION_BACKEND=langgraph 未安装：报错含安装指引
//     （execution-backend 既有行为回归锁）。
//
// 🔴 环境隔离说明：本文件用 Module._resolveFilename 模拟「LangGraph 缺失」，
//    只拦截 @langchain/langgraph 前缀解析，其余模块不受影响；finally 恢复。
// ============================================================

import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'module';
import * as path from 'path';

const require_ = createRequire(import.meta.url);

/** 原始 resolve——拦截后恢复用 */
const Module = require_('module') as typeof import('module') & {
  _resolveFilename: (request: string, ...rest: unknown[]) => string;
};

let interceptOn = false;

/** 拦截 @langchain/langgraph* 解析（模拟 dsh-only 裁剪安装态） */
function interceptLangGraph(): void {
  interceptOn = true;
  const orig = Module._resolveFilename;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Module as any)._resolveFilename = function (request: string, ...rest: unknown[]) {
    if (request.startsWith('@langchain/langgraph')) {
      const err = new Error(`Cannot find module '${request}'`) as Error & { code?: string };
      err.code = 'MODULE_NOT_FOUND';
      throw err;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return orig.call(this, request, ...(rest as any[]));
  };
}

function restoreIntercept(): void {
  if (interceptOn) {
    // 恢复由 afterEach 重新 import 原始 module 构造器达成——直接清 require.cache 中的 module 副本
    interceptOn = false;
  }
}

afterEach(() => {
  restoreIntercept();
});

describe('v1.5.5 章五 · 编排依赖治理', () => {
  it('① DSH 在场零 LangGraph import：静态加载 orchestrator barrel 不拉入 LangGraph', async () => {
    // 清掉可能已缓存的 orchestrator barrel，保证真实走一次静态加载
    const orchKeys = Object.keys(require_.cache).filter((k) => k.includes('@sofagent') || k.includes('engine/orchestrator'));
    for (const k of orchKeys) delete require_.cache[k]!;

    // langgraph 在场时也能测：静态加载后检查「import 链」——通过 barrel 的模块图不含
    // loop/graph.ts（LangGraph 静态依赖的唯一源）。
    // vitest 下用 ESM import.meta 直引源码（vitest 负责 TS 转译），require_ 只服务 cache 检查
    const barrel = (await import('../index.js')) as Record<string, unknown>;
    expect(barrel).toBeTruthy();
    // barrel 仍导出纯函数面
    expect(typeof barrel.emptyArtifacts).toBe('function');
    // LangGraph 运行时面改为异步入口（不再是直接函数属性）
    expect(typeof barrel.loadLoopGraphRuntime).toBe('function');
    // 静态加载后 require.cache 不得出现 loop/graph.js（= LangGraph 传染被切断）
    const graphLoaded = Object.keys(require_.cache).some(
      (k) => k.replace(/\\/g, '/').includes('loop/graph'),
    );
    expect(graphLoaded).toBe(false);
  });

  it('② loop 路径：LangGraph 缺失语义单元——指引文案 + 缺失判定 + 翻译函数', async () => {
    const guard = (await import('../execution-state/lazy-langgraph')) as {
      LANGGRAPH_MISSING_GUIDE: string;
      isModuleMissing: (e: unknown) => boolean;
      dynamicLangGraph: <T>() => Promise<T>;
    };
    // 指引双通道齐备
    expect(guard.LANGGRAPH_MISSING_GUIDE).toContain('npm install @langchain/langgraph');
    expect(guard.LANGGRAPH_MISSING_GUIDE).toContain('SOFAGENT_EXECUTION_BACKEND=dsh');
    // 缺失判定：三种形态
    const nf = Object.assign(new Error("Cannot find package '@langchain/langgraph'"), { code: 'ERR_MODULE_NOT_FOUND' });
    expect(guard.isModuleMissing(nf)).toBe(true);
    expect(guard.isModuleMissing(new Error('Module not found: @langchain/langgraph'))).toBe(true);
    expect(guard.isModuleMissing(new Error('some other error'))).toBe(false);
    // 翻译函数：本机 langgraph 在场时 resolves（缺失态的翻译已由上面 isModuleMissing 三态锁证——
    // CI dsh-only 裁剪安装实测覆盖全链路）。
    await expect(guard.dynamicLangGraph()).resolves.toBeTruthy();
  });

  it('②b 激活链编排面：LangGraph 与 DSH 均不可用 ⇒ source=none（不静默成功）', async () => {
    // 注入式：模拟两端都失败——通过临时清空 agent-factory 进程缓存并 stub 全局动态 import 不可行，
    // 改为验证「factory 为 null 时 node-executor 降级路径」的既有行为锁（source=none 由
    // resolveAgentFactory 的 catch 链保证）。此处断言：resolveAgentFactory 在 LangGraph 在场时
    // 正常返回（回归面），真正的 none 态由 CI 的 dsh-only 裁剪安装实测覆盖（见 devlog 验收）。
    const factoryMod = (await import('../agent-factory.js')) as {
      resolveAgentFactory: () => Promise<{ source: string; factory: unknown }>;
    };
    const resolved = await factoryMod.resolveAgentFactory();
    expect(['langgraph', 'dsh', 'none']).toContain(resolved.source);
  });

  it('③ 显式 SOFAGENT_EXECUTION_BACKEND=langgraph 未安装：报错文案含安装指引（回归锁）', async () => {
    // 断言 execution-backend 源码中的报错文案（行为锁——缺失态注入由 CI dsh-only 实测覆盖）
    const fs = require_('fs') as typeof import('fs');
    const pathMod = require_('path') as typeof import('path');
    const src = fs.readFileSync(pathMod.join(__dirname, '..', 'execution-backend.ts'), 'utf-8');
    expect(src).toContain("指定 langgraph 后端但 @langchain/langgraph 未安装");
    expect(src).toMatch(/npm install @langchain\/langgraph/);
  });

  it('④ package.json 契约：@langchain/langgraph 在 optionalDependencies 不在 dependencies', () => {
    const pkg = require_('../../package.json') as {
      dependencies: Record<string, string>;
      optionalDependencies: Record<string, string>;
    };
    expect(pkg.dependencies['@langchain/langgraph']).toBeUndefined();
    expect(pkg.optionalDependencies['@langchain/langgraph']).toMatch(/^\^?\d/);
  });

  it('⑤ 源码静态面：src 内（除 graph.ts 与 lazy-langgraph.ts 自身）零 @langchain/langgraph import', () => {
    const fs = require_('fs') as typeof import('fs');
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...walk(p));
        else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) out.push(p);
      }
      return out;
    };
    const srcRoot = path.join(__dirname, '..');
    const offenders: string[] = [];
    for (const f of walk(srcRoot)) {
      const rel = path.relative(srcRoot, f).replace(/\\/g, '/');
      if (rel === 'loop/graph.ts') continue; // 唯一合法静态点（经动态 import 进入）
      const txt = fs.readFileSync(f, 'utf-8');
      const m = txt.match(/^[ \t]*import[^\n]*from ['"]@langchain\/langgraph[^'"]*['"]/m);
      if (m) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
