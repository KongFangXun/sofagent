// ============================================================
// execution-state/index.ts · v1.5.5 章五 · LangGraph 惰性加载守卫
// ============================================================
// 存在理由：@langchain/langgraph 自 orchestrator dependencies 降为
//   optionalDependencies（对齐 root F-18 体例）后，「dsh-only 裁剪安装态零
//   LangGraph import」需要一条**机械可查**的守卫——否则静态 import 回潮
//   （例如有人往 barrel 里加一个 `from './loop/graph'`）会让 optional 化
//   名存实亡：包管理器仍会把整棵 LangGraph 依赖树拉进裁剪安装。
//
// 本模块提供两条能力：
//   ① dynamicLangGraph()——把 `import('@langchain/langgraph')` 收敛为单一入口，
//      统一缺失时的显式报错文案（含安装/切换指引，非 stack trace 静默）；
//   ② 静态守卫面——本文件自身**零静态 import**（可被任何路径安全引用）。
// ============================================================

/** LangGraph 缺失时的标准报错文案（两条主线路径共用——loop 子命令 / 激活链编排） */
export const LANGGRAPH_MISSING_GUIDE =
  '❌ @langchain/langgraph 未安装——本路径需要 LangGraph 编排引擎。\n' +
  '   两种解决方式（任选其一）：\n' +
  '   ① 安装：npm install @langchain/langgraph（或恢复完整安装：bash install.sh）\n' +
  '   ② 切换 DSH 执行后端：SOFAGENT_EXECUTION_BACKEND=dsh（默认；DSH 在场时编排主力路径无需 LangGraph）';

/** 判定错误是否为「模块未安装」形态（ERR_MODULE_NOT_FOUND / Cannot find package） */
export function isModuleMissing(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  const msg = err instanceof Error ? err.message : String(err);
  return code === 'ERR_MODULE_NOT_FOUND' || /Cannot find package|Module not found/i.test(msg);
}

/**
 * 动态加载 @langchain/langgraph——统一缺失语义。
 *
 * 缺失时抛 Error（message 含 LANGGRAPH_MISSING_GUIDE 全文），调用方 catch 后
 * 以非零退出上报；**不得静默降级**（对齐 cli.ts compose 既有「编排未装即报错」先例）。
 */
export async function dynamicLangGraph<T = unknown>(): Promise<T> {
  try {
    return (await import('@langchain/langgraph')) as T;
  } catch (err) {
    if (isModuleMissing(err)) {
      throw new Error(LANGGRAPH_MISSING_GUIDE);
    }
    throw err;
  }
}
