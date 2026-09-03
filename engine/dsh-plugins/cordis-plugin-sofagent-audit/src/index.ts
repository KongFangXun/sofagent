// ============================================================
// cordis-plugin-audit · DSH 反向插件（v1.4.0 交付五）
// ============================================================
// 每个插件干一件事、可独立安装渐进采用——只引对应 @public API 子集。
// seam 挂载：tools/result + tools/pre-execute + fs/write-intent
// 版本同步：sofagent v1.4.4 → 各 plugin v0.1.0（DSH Cordis 协议 breaking change 时 bump major）

/** 插件元数据（DSH profile/注册表消费） */
export const pluginMeta = {
  id: 'cordis-plugin-sofagent-audit',
  version: '0.1.0',
  description: '变更机器审阅——24 规则 + git diff 硬证据 + 节点级审计（seam: tools/result + tools/pre-execute + fs/write-intent）',
  seam: 'tools/result + tools/pre-execute + fs/write-intent',
} as const;

/** 依赖的 sofagent 能力说明（供 DSH skill 引导链展示） */
export const capability = '审计引擎（git diff 硬证据 + 24 规则）';

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
      throw new Error('runAudit 不是可调用函数（@sofagent/audit 公共 API）');
    }
    return await (fn as (...a: unknown[]) => unknown)(...args) as T;
  } catch (err) {
    // 依赖未装/能力不可用时降级返回错误信息（不抛——插件可独立安装，缺依赖时优雅提示）
    throw new Error('cordis-plugin-audit 依赖 @sofagent/audit 不可用：' + (err instanceof Error ? err.message : String(err)));
  }
}

/**
 * DSH Cordis 插件契约（v1.4.0 补全）：默认导出 apply(ctx) 注册能力。
 * 插件被挂进 DSH profile（dsh.bundle + cordis.patch.yml）后由 Cordis loader 调用；
 * apply 把 sofagent 审计能力注册为 ctx 服务（sofagent.audit），其他插件/Agent 可经 ctx 调用。
 */
export default {
  apply(ctx: unknown): void {
    const c = ctx as {
      provide?: (name: string, service: Record<string, unknown>) => unknown;
      dynamicCordisRunner?: {
        define?: (request: Record<string, unknown>) => unknown;
      };
      [key: string]: unknown;
    };
    const service = { invoke, meta: pluginMeta, capability };
    if (typeof c.provide === 'function') {
      c.provide('sofagent.audit', service);
    } else {
      // 降级：无 provide API 时挂到 ctx 命名空间（保持可发现）
      const cur = (c.sofagent ?? {}) as Record<string, unknown>;
      c.sofagent = { ...cur, audit: service };
    }
    // v1.4.0 第二步（Dynamic Cordis Runner）：把 sofagent audit 注册为动态插件，
    // 让 WebUI Plugin list（dynamicCordisRunner/inventory）显示加载状态 + 品牌名。
    // inject: [dynamicCordisRunner] 后服务已就绪；define 是进程内 registry.add（sessionId 仅记录字段）。
    try {
      const runner = c.dynamicCordisRunner as { define?: (r: Record<string, unknown>) => unknown } | undefined;
      if (runner && typeof runner.define === 'function') {
        const res = runner.define({
          name: 'sofagent-audit',
          purpose: 'sofagent 审计插件——24 规则 + git diff 硬证据（品牌色 #16B8F3）',
          code: {
            host: [
              'module.exports = {',
              '  async main(ctx, args) {',
              '    return { ok: true, source: "sofagent-audit", message: "审计服务就绪（24 规则）" };',
              '  }',
              '};',
            ].join('\n'),
          },
          plugin: { kind: 'new', idPrefix: 'soga' },
          // sessionId 仅作记录字段（define 不校验会话真实性）——profile apply 无会话上下文，传固定标记
          sessionId: 'profile-boot',
        });
        console.error('[sofagent-audit] dynamicCordisRunner.define 成功:', JSON.stringify(res));
      } else {
        console.error('[sofagent-audit] dynamicCordisRunner 服务不可用（inject 未生效）');
      }
    } catch (err) {
      // define 失败不崩——动态注册为增强项（WebUI Plugin list 显形）
      console.error('[sofagent-audit] dynamicCordisRunner.define 失败:', err instanceof Error ? err.message : String(err));
    }
    // v1.4.0 第二步（Settings namespace）：注册 sofagent-audit 配置命名空间，
    // 让 WebUI Settings → Plugins → Plugin configuration 显示 sofagent 审计插件（可配置 + 品牌色）。
    try {
      const settings = c.settings as { register?: (ns: string, schema: unknown, opts?: Record<string, unknown>) => unknown } | undefined;
      if (settings?.register) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const s = require('@deepseek-ai/schemastery') as {
          object: (shape: Record<string, unknown>) => unknown;
          boolean: () => unknown;
          string: () => unknown;
        };
        const schema = s.object({
          enabled: s.boolean(),
          rules: s.string(),
          brandColor: s.string(),
        });
        settings.register('sofagent-audit', schema, { base: { enabled: true, rules: '24', brandColor: '#16B8F3' } });
        console.error('[sofagent-audit] settings.register 成功（Plugin configuration 可见）');
      } else {
        console.error('[sofagent-audit] settings 服务不可用（inject 未生效）');
      }
    } catch (err) {
      // settings 服务在 profile apply 时可能未就绪——跳过不崩（配置面板注册为增强项）
      console.error('[sofagent-audit] settings.register 失败:', err instanceof Error ? err.message : String(err));
    }
  },
};
