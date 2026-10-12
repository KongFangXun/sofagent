// ============================================================
// trunk-integrity.test.ts · 主干完整性（插件不加载时）· v1.5.9 章七
// ============================================================
// 验收章七 #2「插件不加载时：审计链、沉淀管道行为与今日一致」的可复现断言：
//   ① 主干包（core/audit/think）**不经本插件**即可导入且关键 API 在场
//      —— 审计链（runRules / emitDecision）与沉淀管道（parseDiff → generateThinkEntry）
//         的依赖面里**没有进化插件**；
//   ② 进化插件对主干是**可选件**（桥接包在 optionalDependencies，非硬依赖）；
//   ③ 伞插件逐个懒加载兄弟插件，进化缺席只记 failed[]，不整挂失败；
//   ④ 进化插件 apply 在裸宿主上下文不抛——挂载失败不升级为主干故障。
// ============================================================

import { describe, it, expect } from 'vitest';
import pluginDefault from './index';

const readJson = (rel: string): Record<string, unknown> =>
  JSON.parse(require('fs').readFileSync(require('path').join(__dirname, rel), 'utf8')) as Record<string, unknown>;

describe('主干完整性 · 插件不加载时', () => {
  it('审计链与沉淀管道的主干包不经本插件即可导入（关键 API 在场）', async () => {
    const core = (await import('@sofagent/core')) as Record<string, unknown>;
    const audit = (await import('@sofagent/audit')) as Record<string, unknown>;
    const think = (await import('@sofagent/think')) as Record<string, unknown>;
    // 沉淀管道三源 + 审计链入口——主干面自足，不依赖进化插件的存在
    expect(typeof core.parseDiff).toBe('function');
    expect(typeof core.getDataDir).toBe('function');
    expect(typeof audit.runRules).toBe('function');
    expect(typeof audit.emitDecision).toBe('function');
    expect(typeof think.generateThinkEntry).toBe('function');
  });

  it('进化插件的桥接主干包在 optionalDependencies（可选件，缺它主干照常）', () => {
    const pkg = readJson('../package.json');
    const opt = (pkg.optionalDependencies ?? {}) as Record<string, string>;
    expect(Object.keys(opt)).toContain('@sofagent/think');
    expect(Object.keys(opt)).toContain('@sofagent/audit');
    // 不是硬依赖：dependencies 里只有适配层基座，不含主干能力包
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    expect(Object.keys(deps)).not.toContain('@sofagent/audit');
    expect(Object.keys(deps)).not.toContain('@sofagent/think');
  });

  it('伞插件按兄弟插件逐个懒加载——进化缺席只记 failed，不整挂失败', () => {
    const manifest = readJson('../../plugins.json') as {
      plugins: Array<{ id: string; kind?: string; suite?: string[] }>;
    };
    const suite = manifest.plugins.find((p) => p.kind === 'suite');
    expect(suite?.suite).toContain('cordis-plugin-sofagent-evolve');
  });

  it('进化插件不反向 import 主干能力包之外的东西（插件层不耦合主干实现）', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, 'index.ts'), 'utf8') as string;
    expect(src).not.toMatch(/from '@sofagent\/evolve'/);
    expect(src).not.toMatch(/from '@sofagent\/orchestrator'/);
    expect(src).not.toMatch(/from '@sofagent\/daemon'/);
  });

  it('apply 在裸宿主上下文（无 settings/dynamicCordisRunner/tools）不抛——挂载失败不升级为主干故障', async () => {
    const subs: string[] = [];
    const bare = {
      provide: () => () => undefined,
      on: (event: string) => {
        subs.push(event);
        return () => undefined;
      },
    };
    const disposer = (pluginDefault.apply as (c: unknown) => unknown)(bare) as
      | (() => Promise<void>)
      | undefined;
    expect(typeof disposer).toBe('function');
    expect(subs.slice().sort()).toEqual(['fs/write-intent', 'session/event']);
    await disposer!();
  });
});
