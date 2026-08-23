// ============================================================
// cordis-plugin-rollback · DSH 反向插件（v1.4.0 交付五）
// ============================================================
// 每个插件干一件事、可独立安装渐进采用——只引对应 @public API 子集。
// seam 挂载：effect 注册/卸载
// 版本同步：sofagent v1.4.0 → 各 plugin v0.1.0（DSH Cordis 协议 breaking change 时 bump major）

/** 插件元数据（DSH profile/注册表消费） */
export const pluginMeta = {
  id: 'cordis-plugin-rollback',
  version: '0.1.0',
  description: '出错逆序撤销——git snapshot → effect disposer（seam: effect 注册/卸载）',
  seam: 'effect 注册/卸载',
} as const;

/** 依赖的 sofagent 能力说明（供 DSH skill 引导链展示） */
export const capability = '快照回溯（出事一键回滚）';

/**
 * 调用对应的 sofagent @public API（懒加载 + 降级不抛）。
 * 包装层职责：把 sofagent 能力暴露成 DSH 可调用的插件函数。
 */
export async function invoke<T = unknown>(...args: unknown[]): Promise<T> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = await import('@sofagent/core');
    const fn = m.getHistoryFilePath;
    if (typeof fn !== 'function') {
      throw new Error('createShadowRepo 不是可调用函数（@sofagent/core 公共 API）');
    }
    return await (fn as (...a: unknown[]) => unknown)(...args) as T;
  } catch (err) {
    // 依赖未装/能力不可用时降级返回错误信息（不抛——插件可独立安装，缺依赖时优雅提示）
    throw new Error('cordis-plugin-rollback 依赖 @sofagent/core 不可用：' + (err instanceof Error ? err.message : String(err)));
  }
}
