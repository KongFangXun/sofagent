// ============================================================
// cordis-plugin-ontology · DSH 反向插件（v1.4.0 交付五）
// ============================================================
// 每个插件干一件事、可独立安装渐进采用——只引对应 @public API 子集。
// seam 挂载：ontology_* tools + search_knowledge
// 版本同步：sofagent v1.4.0 → 各 plugin v0.1.0（DSH Cordis 协议 breaking change 时 bump major）

/** 插件元数据（DSH profile/注册表消费） */
export const pluginMeta = {
  id: 'cordis-plugin-ontology',
  version: '0.1.0',
  description: '共享语义底座 + 知识检索（seam: ontology_* tools + search_knowledge）',
  seam: 'ontology_* tools + search_knowledge',
} as const;

/** 依赖的 sofagent 能力说明（供 DSH skill 引导链展示） */
export const capability = '本体结构（业务语义底座）';

/**
 * 调用对应的 sofagent @public API（懒加载 + 降级不抛）。
 * 包装层职责：把 sofagent 能力暴露成 DSH 可调用的插件函数。
 */
export async function invoke<T = unknown>(...args: unknown[]): Promise<T> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = await import('@sofagent/ontology');
    const fn = m.generateOntologyView;
    if (typeof fn !== 'function') {
      throw new Error('generateOntologyView 不是可调用函数（@sofagent/ontology 公共 API）');
    }
    return await (fn as (...a: unknown[]) => unknown)(...args) as T;
  } catch (err) {
    // 依赖未装/能力不可用时降级返回错误信息（不抛——插件可独立安装，缺依赖时优雅提示）
    throw new Error('cordis-plugin-ontology 依赖 @sofagent/ontology 不可用：' + (err instanceof Error ? err.message : String(err)));
  }
}
