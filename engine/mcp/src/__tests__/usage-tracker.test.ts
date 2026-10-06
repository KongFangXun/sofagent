// ============================================================
// usage-tracker.test.ts · tool 使用率遥测测试（v1.5.7 章四）
// 覆盖：四字段完整性 / 断言不含参数内容字段 / 开关关闭零写入 /
// 无网络路径（静态断言模块源码无 fetch/http import）
// 隔离纪律：SOFAGENT_DATA 指向临时目录
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readFileSync as readSource } from 'fs';

import {
  recordToolUsage,
  isUsageTrackingEnabled,
  resolveToolUsagePath,
  TOOL_USAGE_SCHEMA_VERSION,
  usageTrackerStats,
} from '../usage-tracker';

let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'usage-tracker-'));
  process.env.SOFAGENT_DATA = dataDir;
  process.env.SOFAGENT_USAGE_TRACKING = undefined as unknown as string;
});

afterAll(() => {
  delete process.env.SOFAGENT_DATA;
  delete process.env.SOFAGENT_USAGE_TRACKING;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('四字段完整性（schemaVersion + tool + ts + sessionId）', () => {
  it('落盘一行恰含四字段——无第五个键', () => {
    recordToolUsage('list_rules', 'session-abc');
    const line = readFileSync(resolveToolUsagePath(), 'utf-8').trim().split('\n').at(-1)!;
    const rec = JSON.parse(line);
    expect(Object.keys(rec).sort()).toEqual(['schemaVersion', 'sessionId', 'tool', 'ts'].sort());
    expect(rec.schemaVersion).toBe(TOOL_USAGE_SCHEMA_VERSION);
    expect(rec.schemaVersion).toBe(1);
    expect(rec.tool).toBe('list_rules');
    expect(rec.sessionId).toBe('session-abc');
    expect(rec.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // ISO 8601
  });

  it('多次调用逐行追加（append-only）', () => {
    recordToolUsage('compose', 's1');
    recordToolUsage('compose', 's1');
    const lines = readFileSync(resolveToolUsagePath(), 'utf-8').trim().split('\n');
    expect(lines.filter((l) => JSON.parse(l).tool === 'compose').length).toBe(2);
  });

  it('空 sessionId 归一为 unknown（不猜测）', () => {
    recordToolUsage('t', '');
    const line = readFileSync(resolveToolUsagePath(), 'utf-8').trim().split('\n').at(-1)!;
    expect(JSON.parse(line).sessionId).toBe('unknown');
  });
});

describe('隐私红线：断言不含参数/内容字段', () => {
  it('遥测面无 args/params/result/text/data 等内容键', () => {
    recordToolUsage('audit_file', 'sess');
    const content = readFileSync(resolveToolUsagePath(), 'utf-8');
    for (const line of content.trim().split('\n')) {
      const rec = JSON.parse(line);
      for (const forbidden of ['args', 'params', 'arguments', 'result', 'text', 'data', 'content', 'payload', 'output', 'input']) {
        expect(rec, `遥测行不得含内容字段 ${forbidden}`).not.toHaveProperty(forbidden);
      }
    }
  });

  it('recordToolUsage 签名不接受内容参数（编译期红线——行为断言：多余实参不入盘）', () => {
    // @ts-expect-error 多传一个内容参数——运行时 JS 会忽略（函数只收 tool, sessionId），断言其不落盘
    recordToolUsage('t2', 's', { secret: 'should-not-persist' });
    const lines = readFileSync(resolveToolUsagePath(), 'utf-8').trim().split('\n');
    const last = JSON.parse(lines.at(-1)!);
    expect(JSON.stringify(last)).not.toContain('should-not-persist');
    expect(last.tool).toBe('t2');
  });
});

describe('开关生效（默认开 · SOFAGENT_USAGE_TRACKING=0 关）', () => {
  it('默认（未设置/env 清空）= 开启', () => {
    delete process.env.SOFAGENT_USAGE_TRACKING;
    expect(isUsageTrackingEnabled()).toBe(true);
  });

  it("SOFAGENT_USAGE_TRACKING='0' → 关闭且零写入", () => {
    process.env.SOFAGENT_USAGE_TRACKING = '0';
    expect(isUsageTrackingEnabled()).toBe(false);

    const before = existsSync(resolveToolUsagePath())
      ? readFileSync(resolveToolUsagePath(), 'utf-8')
      : '';
    recordToolUsage('blocked-tool', 's');
    const after = existsSync(resolveToolUsagePath())
      ? readFileSync(resolveToolUsagePath(), 'utf-8')
      : '';
    expect(after).toBe(before); // 零写入——一字节未动
    expect(after).not.toContain('blocked-tool');
    delete process.env.SOFAGENT_USAGE_TRACKING;
  });

  it("非 '0' 值（如 '1'）= 开启（显式 '0' 才关）", () => {
    process.env.SOFAGENT_USAGE_TRACKING = '1';
    expect(isUsageTrackingEnabled()).toBe(true);
    delete process.env.SOFAGENT_USAGE_TRACKING;
  });
});

describe('无网络上报路径（数据主权铁律）', () => {
  it('模块源码静态断言：无 fetch/http/https/net/tls/dgram import', () => {
    const source = readSource(join(__dirname, '..', 'usage-tracker.ts'), 'utf-8');
    // import 面扫描：网络相关模块名一律不得出现
    const netImports = source.match(/import[^;]*from\s+['"][^'"]*(node:)?(http|https|net|tls|dgram|undici|axios|node-fetch)[^'"]*['"]/g);
    expect(netImports, `usage-tracker.ts 不得有网络 import（实测命中：${netImports}）`).toBeNull();
    // fetch( 调用面扫描（含动态 import('node:http') 形态）
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/import\s*\(\s*['"]([^'"]*)(node:)?(http|https|net|tls|dgram)/);
  });

  it('写入失败静默计数不抛错（如落盘路径被文件占位）', () => {
    const before = usageTrackerStats.silentFailures;
    // 制造失败：dataDir 指向一个**存在**的目录、但 tool-usage.jsonl 落点被目录占位
    // （appendFileSync 会 EISDIR）。注意 resolveDataDir 要求 SOFAGENT_DATA 存在才生效。
    const trapDir = mkdtempSync(join(tmpdir(), 'usage-trap-'));
    process.env.SOFAGENT_DATA = trapDir;
    mkdirSync(join(trapDir, 'tool-usage.jsonl')); // 目录占位文件名 → append 必败
    expect(() => recordToolUsage('will-fail', 's')).not.toThrow();
    expect(usageTrackerStats.silentFailures).toBeGreaterThan(before);
    delete process.env.SOFAGENT_DATA;
    rmSync(trapDir, { recursive: true, force: true });
  });
});
