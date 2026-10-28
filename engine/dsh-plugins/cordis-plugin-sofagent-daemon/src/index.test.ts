// ============================================================
// cordis-plugin-daemon · 插件单测（v1.4.0 交付五）
// ============================================================
// 🔴 环境隔离（对齐 79e951d10 / inspector-registry.test.ts 先例）：
// invoke 用例真实桥接 @sofagent/daemon.startCron（无参）——startCron 内部
// loadInspectorsConfig 等配置面不吃入参，走 SOFAGENT_DATA 路径 SSOT；进程
// env 未隔离时会静默回落真实 ~/.sofagent/data（标记文件链），三巡检层 +
// dream-cycle「启动即首跑」全量扫描真实数据面（实测单文件挂 266.69s，全量
// 并行跑下即同族多文件超时红）。本文件显式把 SOFAGENT_DATA/SOFAGENT_HOME
// 钉到隔离 tmp（实测同用例 38ms / 全文件 205ms），不依赖外部 setup 预置态。
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pluginMeta, capability, invoke } from './index';

// —— 环境隔离（describe 级：贯穿全部用例，含 invoke 真实桥接链）——
let isoDir: string;
let prevData: string | undefined;
let prevHome: string | undefined;

beforeAll(() => {
  isoDir = mkdtempSync(join(tmpdir(), 'sofagent-dsh-daemon-test-'));
  prevData = process.env.SOFAGENT_DATA;
  prevHome = process.env.SOFAGENT_HOME;
  process.env.SOFAGENT_DATA = isoDir;
  process.env.SOFAGENT_HOME = isoDir;
});

afterAll(() => {
  if (prevData === undefined) delete process.env.SOFAGENT_DATA;
  else process.env.SOFAGENT_DATA = prevData;
  if (prevHome === undefined) delete process.env.SOFAGENT_HOME;
  else process.env.SOFAGENT_HOME = prevHome;
  try { rmSync(isoDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('cordis-plugin-sofagent-daemon', () => {
  it('插件元数据完整（id/version/description/seam）', () => {
    expect(pluginMeta.id).toBe('cordis-plugin-sofagent-daemon');
    expect(pluginMeta.version).toBe(require('../package.json').version); // SSOT 对齐：版本跟随主版本（读 package.json）
    expect(pluginMeta.description.length).toBeGreaterThan(10);
    expect(pluginMeta.seam.length).toBeGreaterThan(0);
  });

  it('能力说明非空', () => {
    expect(capability.length).toBeGreaterThan(0);
  });

  // 120s 局部超时上限（对齐 79e951d10 先例）：真实桥接链含巡检首跑，
  // 隔离态实测 <1s；上限只为兜住冷机 fork/transform 抖动，绝不放任
  // 「回落真实 HOME 扫盘」型的分钟级挂死绿过。
  it('invoke 可调用（成功或降级，不挂死）', { timeout: 120_000 }, async () => {
    const r = await invoke().catch((e) => e);
    expect(r).toBeDefined();
  });
});
