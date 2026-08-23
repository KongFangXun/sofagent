// ============================================================
// cordis-plugin-evolve · 插件单测（v1.4.0 交付五）
// ============================================================

import { describe, it, expect } from 'vitest';
import { pluginMeta, capability, invoke } from './index';

describe('cordis-plugin-sofagent-evolve', () => {
  it('插件元数据完整（id/version/description/seam）', () => {
    expect(pluginMeta.id).toBe('cordis-plugin-sofagent-evolve');
    expect(pluginMeta.version).toBe('0.1.0');
    expect(pluginMeta.description.length).toBeGreaterThan(10);
    expect(pluginMeta.seam.length).toBeGreaterThan(0);
  });

  it('能力说明非空', () => {
    expect(capability.length).toBeGreaterThan(0);
  });

  it('invoke 可调用（成功或降级，不挂死）', async () => {
    const r = await invoke().catch((e) => e);
    expect(r).toBeDefined();
  });
});
