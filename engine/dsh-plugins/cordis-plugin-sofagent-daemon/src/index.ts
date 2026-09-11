// ============================================================
// cordis-plugin-daemon · DSH 反向插件（v1.4.0 交付五）
// ============================================================
// 每个插件干一件事、可独立安装渐进采用——只引对应 @public API 子集。
// seam 挂载：独立调度进程
// 版本跟随主版本：运行时读取 package.json（v1.4.7 T7/R4，对齐 openclaw 侧修复）。
// 此前硬编码 '0.1.0' 与 package.json 1.4.7 永久脱节——DSH 注册表读到 0.1.0、
// npm 生态看到 1.4.7，双版本线无收敛。tsconfig 无 resolveJsonModule（import json
// 编译不过）、包输出 CJS → 用 require 同步读（路径相对 dist/index.js 上溯一级）。
// 读不到兜底 '0.0.0-unknown'——缺版本比错版本诚实。

/** 插件元数据（DSH profile/注册表消费） */
const _pkg: { version?: string } = require('../package.json');

export const pluginMeta = {
  id: 'cordis-plugin-sofagent-daemon',
  version: _pkg.version ?? '0.0.0-unknown',
  description: '7×24 巡检 + 健康监测 + webhook 推送（seam: 独立调度进程）',
  seam: '独立调度进程',
} as const;

/** 依赖的 sofagent 能力说明（供 DSH skill 引导链展示） */
export const capability = '养护（7×24 巡检 + 健康监测）';

/**
 * 调用对应的 sofagent @public API（懒加载 + 降级不抛）。
 * 包装层职责：把 sofagent 能力暴露成 DSH 可调用的插件函数。
 */
export async function invoke<T = unknown>(...args: unknown[]): Promise<T> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = await import('@sofagent/daemon');
    const fn = m.startCron;
    if (typeof fn !== 'function') {
      throw new Error('startCron 不是可调用函数（@sofagent/daemon 公共 API）');
    }
    return await (fn as (...a: unknown[]) => unknown)(...args) as T;
  } catch (err) {
    // 依赖未装/能力不可用时降级返回错误信息（不抛——插件可独立安装，缺依赖时优雅提示）
    throw new Error('cordis-plugin-daemon 依赖 @sofagent/daemon 不可用：' + (err instanceof Error ? err.message : String(err)));
  }
}


/**
 * DSH Cordis 插件契约（v1.4.0 品牌化）：默认导出 apply(ctx) 把能力注册为 ctx 服务（sofagent.daemon）。
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
      c.provide('sofagent.daemon', service);
    } else {
      const cur = (c.sofagent ?? {}) as Record<string, unknown>;
      c.sofagent = { ...cur, daemon: service };
    }
    // v1.4.0 批量：注册为 dynamicCordisRunner 动态插件（Plugin list 可见加载状态）
    try {
      const runner = c.dynamicCordisRunner as { define?: (r: Record<string, unknown>) => unknown } | undefined;
      if (runner && typeof runner.define === 'function') {
        const res = runner.define({
          name: 'sofagent-daemon',
          purpose: '7×24 巡检 + 健康监测 + webhook 推送（品牌色 #16B8F3）',
          code: {
            host: [
              'module.exports = {',
              '  async main(ctx, args) {',
              '    return { ok: true, source: "sofagent-daemon", message: "7×24 巡检 + 健康监测 + webhook 推送" };',
              '  }',
              '};',
            ].join('\n'),
          },
          plugin: { kind: 'new', idPrefix: 'soga' },
          sessionId: 'profile-boot',
        });
        console.error('[sofagent-daemon] dynamicCordisRunner.define 成功:', JSON.stringify(res));
      }
    } catch (err) {
      console.error('[sofagent-daemon] define 失败:', err instanceof Error ? err.message : String(err));
    }
    // v1.4.0 批量：注册 settings namespace（Plugin configuration 数据层可见）
    try {
      const settings = c.settings as { register?: (ns: string, schema: unknown, opts?: Record<string, unknown>) => unknown } | undefined;
      if (settings?.register) {
        const s = require('@deepseek-ai/schemastery') as { object: (s: Record<string, unknown>) => unknown; boolean: () => unknown; string: () => unknown };
        settings.register('sofagent-daemon', s.object({ enabled: s.boolean(), brandColor: s.string() }), { base: { enabled: true, brandColor: '#16B8F3' } });
        console.error('[sofagent-daemon] settings.register 成功');
      }
    } catch (err) {
      console.error('[sofagent-daemon] settings.register 失败:', err instanceof Error ? err.message : String(err));
    }
  },
};
