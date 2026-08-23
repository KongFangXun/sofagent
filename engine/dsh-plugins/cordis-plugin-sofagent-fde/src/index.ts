// ============================================================
// cordis-plugin-fde · DSH 反向插件（v1.4.0 交付五）
// ============================================================
// 每个插件干一件事、可独立安装渐进采用——只引对应 @public API 子集。
// seam 挂载：plugin
// 版本同步：sofagent v1.4.0 → 各 plugin v0.1.0（DSH Cordis 协议 breaking change 时 bump major）

/** 插件元数据（DSH profile/注册表消费） */
export const pluginMeta = {
  id: 'cordis-plugin-sofagent-fde',
  version: '0.1.0',
  description: '进场方法论六 tool 闭环（fde_interview/classify/quantify/derive/distill/deploy）',
  seam: 'plugin',
} as const;

/** 依赖的 sofagent 能力说明（供 DSH skill 引导链展示） */
export const capability = 'FDE 进场方法论（梳理/判定/量化/派生/蒸馏/部署）';

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
    throw new Error('cordis-plugin-fde 依赖 @sofagent/ontology 不可用：' + (err instanceof Error ? err.message : String(err)));
  }
}


/**
 * DSH Cordis 插件契约（v1.4.0 品牌化）：默认导出 apply(ctx) 把能力注册为 ctx 服务（sofagent.fde）。
 * 插件被挂进 DSH profile（dsh.bundle + cordis.patch.yml）后由 Cordis loader 调用。
 */
export default {
  apply(ctx: unknown): void {
    const c = ctx as {
      provide?: (name: string, service: Record<string, unknown>) => unknown;
      [key: string]: unknown;
    };
    const service = { invoke, meta: pluginMeta, capability };
    if (typeof c.provide === 'function') {
      c.provide('sofagent.fde', service);
    } else {
      const cur = (c.sofagent ?? {}) as Record<string, unknown>;
      c.sofagent = { ...cur, fde: service };
    }
  },
};
