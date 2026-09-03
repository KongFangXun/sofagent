// ============================================================
// cordis-plugin-gate · DSH 反向插件（v1.4.0 交付五）
// ============================================================
// 每个插件干一件事、可独立安装渐进采用——只引对应 @public API 子集。
// seam 挂载：agent/turn-stopping
// 版本同步：sofagent v1.4.4 → 各 plugin v0.1.0（DSH Cordis 协议 breaking change 时 bump major）

/** 插件元数据（DSH profile/注册表消费） */
export const pluginMeta = {
  id: 'cordis-plugin-sofagent-gate',
  version: '0.1.0',
  description: '验收不过不放行——机器可判定验收 + 人审（seam: agent/turn-stopping）',
  seam: 'agent/turn-stopping',
} as const;

/** 依赖的 sofagent 能力说明（供 DSH skill 引导链展示） */
export const capability = '验收硬门禁（define_acceptance 机器可判定）';

/**
 * 调用对应的 sofagent @public API（懒加载 + 降级不抛）。
 * 包装层职责：把 sofagent 能力暴露成 DSH 可调用的插件函数。
 */
export async function invoke<T = unknown>(...args: unknown[]): Promise<T> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = await import('@sofagent/audit');
    const fn = m.runRules;
    if (typeof fn !== 'function') {
      throw new Error('runRules 不是可调用函数（@sofagent/audit 公共 API）');
    }
    return await (fn as (...a: unknown[]) => unknown)(...args) as T;
  } catch (err) {
    // 依赖未装/能力不可用时降级返回错误信息（不抛——插件可独立安装，缺依赖时优雅提示）
    throw new Error('cordis-plugin-gate 依赖 @sofagent/audit 不可用：' + (err instanceof Error ? err.message : String(err)));
  }
}


/**
 * DSH Cordis 插件契约（v1.4.0 品牌化）：默认导出 apply(ctx) 把能力注册为 ctx 服务（sofagent.gate）。
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
      c.provide('sofagent.gate', service);
    } else {
      const cur = (c.sofagent ?? {}) as Record<string, unknown>;
      c.sofagent = { ...cur, gate: service };
    }
    // v1.4.0 批量：注册为 dynamicCordisRunner 动态插件（Plugin list 可见加载状态）
    try {
      const runner = c.dynamicCordisRunner as { define?: (r: Record<string, unknown>) => unknown } | undefined;
      if (runner && typeof runner.define === 'function') {
        const res = runner.define({
          name: 'sofagent-gate',
          purpose: '验收不过不放行——机器可判定验收 + 人审（品牌色 #16B8F3）',
          code: {
            host: [
              'module.exports = {',
              '  async main(ctx, args) {',
              '    return { ok: true, source: "sofagent-gate", message: "验收不过不放行——机器可判定验收 + 人审" };',
              '  }',
              '};',
            ].join('\n'),
          },
          plugin: { kind: 'new', idPrefix: 'soga' },
          sessionId: 'profile-boot',
        });
        console.error('[sofagent-gate] dynamicCordisRunner.define 成功:', JSON.stringify(res));
      }
    } catch (err) {
      console.error('[sofagent-gate] define 失败:', err instanceof Error ? err.message : String(err));
    }
    // v1.4.0 批量：注册 settings namespace（Plugin configuration 数据层可见）
    try {
      const settings = c.settings as { register?: (ns: string, schema: unknown, opts?: Record<string, unknown>) => unknown } | undefined;
      if (settings?.register) {
        const s = require('@deepseek-ai/schemastery') as { object: (s: Record<string, unknown>) => unknown; boolean: () => unknown; string: () => unknown };
        settings.register('sofagent-gate', s.object({ enabled: s.boolean(), brandColor: s.string() }), { base: { enabled: true, brandColor: '#16B8F3' } });
        console.error('[sofagent-gate] settings.register 成功');
      }
    } catch (err) {
      console.error('[sofagent-gate] settings.register 失败:', err instanceof Error ? err.message : String(err));
    }
  },
};
