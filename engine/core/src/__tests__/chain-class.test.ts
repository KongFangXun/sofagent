// ============================================================
// chain-class.test.ts · 审计链分类原语回归锁（2026-11 写入面分段）
// ============================================================
//
// 背景：`decision-log.jsonl` 单文件混着三种结构性不同的写入面（宿主 host /
// 设备 device / 早期测试夹具 test），三类 key 结构性不同却共用一条 HMAC 链，
// 整链必然出现「不可复验」长段（实测 104,337 条中 8,333 条，已定性为非篡改）。
// 修法 = 历史原样 + 新写入面分段：core 侧提供两个原语，本文件锁死其语义。
//
// 本文件锁五件事：
//   ① `resolveChainClass` 三档优先级：显式入参 > SOFAGENT_CHAIN_CLASS > 'host'；
//   ② 非法值（含空串）**fail-loud 抛错**，禁静默降级（错链会把数据写进错的坑）；
//   ③ `getDecisionLogPath` 的 host 分支**逐字**等于加第二参之前的三档路径字符串
//      （历史链落点是全仓依赖的字符串契约，一个字符都不能漂）；
//   ④ device / test 分支落在**同一个 audit 目录**下的 `chains/<cls>/`（不另起解析链）；
//   ⑤ 显式传 'host' 与不传第二参**完全等价**（老调用方零感知）。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { resolveChainClass, getDecisionLogPath } from '../audit-history';
import { AUDIT_DECISION_LOG } from '../data-paths';

describe('resolveChainClass · 三档优先级与 fail-loud', () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.SOFAGENT_CHAIN_CLASS;
    delete process.env.SOFAGENT_CHAIN_CLASS;
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.SOFAGENT_CHAIN_CLASS;
    else process.env.SOFAGENT_CHAIN_CLASS = savedEnv;
  });

  it('无显式入参、无环境变量 → host（缺省档）', () => {
    expect(resolveChainClass()).toBe('host');
  });

  it('显式入参 > 环境变量（显式值胜出）', () => {
    process.env.SOFAGENT_CHAIN_CLASS = 'device';
    expect(resolveChainClass('test')).toBe('test');
    // 环境变量档仍在（未被读操作清掉）
    expect(process.env.SOFAGENT_CHAIN_CLASS).toBe('device');
  });

  it('环境变量 > 缺省 host（无显式入参时吃环境变量）', () => {
    process.env.SOFAGENT_CHAIN_CLASS = 'device';
    expect(resolveChainClass()).toBe('device');
    process.env.SOFAGENT_CHAIN_CLASS = 'test';
    expect(resolveChainClass(undefined)).toBe('test');
  });

  it('三值全部原样返回（不归一化大小写——Host / HOST 属非法值）', () => {
    expect(resolveChainClass('host')).toBe('host');
    expect(resolveChainClass('device')).toBe('device');
    expect(resolveChainClass('test')).toBe('test');
  });

  it('显式非法值 → 抛错（不做静默降级）', () => {
    expect(() => resolveChainClass('bogus')).toThrow(/非法审计链分类/);
    expect(() => resolveChainClass('Host')).toThrow(/非法审计链分类/);
  });

  it('环境变量非法值 → 抛错（禁止「设错了就悄悄落 host」）', () => {
    process.env.SOFAGENT_CHAIN_CLASS = 'chains/test';
    expect(() => resolveChainClass()).toThrow(/非法审计链分类/);
  });

  it('空串/纯空白 → 抛错（"设了但没值"不做猜测性兜底，请 unset）', () => {
    expect(() => resolveChainClass('')).toThrow(/非法审计链分类/);
    expect(() => resolveChainClass('   ')).toThrow(/非法审计链分类/);
  });
});

describe('getDecisionLogPath · host 分支与旧行为逐字相同', () => {
  const ISO_DIR = join('/tmp', 'sofagent-chain-class-iso');
  let savedData: string | undefined;

  beforeEach(() => {
    savedData = process.env.SOFAGENT_DATA;
    delete process.env.SOFAGENT_DATA;
  });

  afterEach(() => {
    if (savedData === undefined) delete process.env.SOFAGENT_DATA;
    else process.env.SOFAGENT_DATA = savedData;
  });

  it('三档解析链原样保留：显式 dataDir → SOFAGENT_DATA → 默认 AUDIT_DECISION_LOG', () => {
    // ① 显式 dataDir（最高优先，压过环境变量）
    process.env.SOFAGENT_DATA = join('/tmp', 'ignored-by-explicit-datadir');
    expect(getDecisionLogPath(ISO_DIR)).toBe(join(ISO_DIR, 'audit', 'decision-log.jsonl'));

    // ② 环境变量（无显式 dataDir）
    delete process.env.SOFAGENT_DATA;
    process.env.SOFAGENT_DATA = ISO_DIR;
    expect(getDecisionLogPath()).toBe(join(ISO_DIR, 'audit', 'decision-log.jsonl'));

    // ③ 默认值（无显式、无环境变量）——与 AUDIT_DECISION_LOG 常量逐字相同
    delete process.env.SOFAGENT_DATA;
    expect(getDecisionLogPath()).toBe(AUDIT_DECISION_LOG);
    expect(AUDIT_DECISION_LOG.endsWith(join('audit', 'decision-log.jsonl'))).toBe(true);
  });

  it('显式第二参 host 与不传第二参完全等价（老调用方零感知）', () => {
    expect(getDecisionLogPath(ISO_DIR, 'host')).toBe(getDecisionLogPath(ISO_DIR));
    delete process.env.SOFAGENT_DATA;
    expect(getDecisionLogPath(undefined, 'host')).toBe(getDecisionLogPath());
  });

  it('旧路径字符串逐字断言（加入分链第二参不得改动这一串）', () => {
    // 硬编码期望串：任何「顺手优化路径拼接」都会在这里撞红
    expect(getDecisionLogPath('/data/root')).toBe('/data/root/audit/decision-log.jsonl');
  });
});

describe('getDecisionLogPath · 分链分支（同一 audit 目录下 chains/<cls>/）', () => {
  const ISO_DIR = join('/tmp', 'sofagent-chain-class-iso');

  it('device / test 落在同一个 audit 目录的 chains 子目录（不另起解析链）', () => {
    expect(getDecisionLogPath(ISO_DIR, 'device')).toBe(
      join(ISO_DIR, 'audit', 'chains', 'device', 'decision-log.jsonl'),
    );
    expect(getDecisionLogPath(ISO_DIR, 'test')).toBe(
      join(ISO_DIR, 'audit', 'chains', 'test', 'decision-log.jsonl'),
    );
  });

  it('三链路径两两不同（同一条记录不可能同时落在两条链）', () => {
    const host = getDecisionLogPath(ISO_DIR, 'host');
    const device = getDecisionLogPath(ISO_DIR, 'device');
    const test = getDecisionLogPath(ISO_DIR, 'test');
    expect(new Set([host, device, test]).size).toBe(3);
  });

  it('环境变量档对分链同样生效（SOFAGENT_CHAIN_CLASS=test）', () => {
    const saved = process.env.SOFAGENT_CHAIN_CLASS;
    process.env.SOFAGENT_CHAIN_CLASS = 'test';
    try {
      expect(getDecisionLogPath(ISO_DIR)).toBe(
        join(ISO_DIR, 'audit', 'chains', 'test', 'decision-log.jsonl'),
      );
    } finally {
      if (saved === undefined) delete process.env.SOFAGENT_CHAIN_CLASS;
      else process.env.SOFAGENT_CHAIN_CLASS = saved;
    }
  });

  it('非法第二参 → 抛错（与 resolveChainClass 同一取值域）', () => {
    expect(() => getDecisionLogPath(ISO_DIR, 'all')).toThrow(/非法审计链分类/);
  });
});
