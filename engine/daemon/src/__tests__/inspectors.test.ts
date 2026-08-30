// ============================================================
// inspectors.test.ts · runInspectors 行为测试
// v1.4.4 第九章 #73：占位重写——原「全关返回空数组」断言
// 同义反复（Array.isArray + length>=0 永真）且测试名与行为不符
// （runInspectors 无配置过滤，恒返回 13 项），改为行为级验证。
// 隔离纪律（v1.3.5 阶段五）：SOFAGENT_DATA 指 tmp 防扫真实数据目录。
// ============================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runInspectors } from '../inspectors';

describe('runInspectors', () => {
  let isoDir: string;
  let tmpDir: string;
  const prevData = process.env.SOFAGENT_DATA;

  beforeEach(() => {
    // v1.3.5 阶段五隔离：audit-trail/data-sovereignty 等 inspector 无隔离时
    // 会扫真实 ~/.sofagent（5MB+ history）——SOFAGENT_DATA 指向 tmp
    isoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-iso-'));
    process.env.SOFAGENT_DATA = isoDir;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-insp-test-'));
    fs.mkdirSync(path.join(tmpDir, '.sofagent'), { recursive: true });
  }, 90_000);

  afterEach(() => {
    // 环境变量还原（防泄漏到后续测试文件——审查报告 #73 断言泄漏项）
    if (prevData === undefined) delete process.env.SOFAGENT_DATA;
    else process.env.SOFAGENT_DATA = prevData;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    try { fs.rmSync(isoDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }, 90_000);

  it('返回全部 12 项巡检结果（执行数组与注册清单一致）', { timeout: 90_000 }, () => {
    const results = runInspectors(tmpDir);
    // 12 = audit-history/conflict/doctor/knowledge-freshness/knowledge-health/
    //      skill-staleness/warnings/audit-trail/workspace-summary/data-sovereignty×3
    expect(results).toHaveLength(12);
  });

  it('每项结果结构完整（name/triggered/message/severity 契约）', { timeout: 90_000 }, () => {
    const results = runInspectors(tmpDir);
    for (const r of results) {
      expect(typeof r.name).toBe('string');
      expect(r.name.length).toBeGreaterThan(0);
      expect(typeof r.triggered).toBe('boolean');
      expect(typeof r.message).toBe('string');
      expect(['info', 'warning', 'critical']).toContain(r.severity);
    }
  });

  it('结果 name 无重复（巡检器注册唯一性）', { timeout: 90_000 }, () => {
    const results = runInspectors(tmpDir);
    const names = results.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('空项目目录不抛错（全 inspector 对空目录 fail-open）', { timeout: 90_000 }, () => {
    expect(() => runInspectors(tmpDir)).not.toThrow();
  });
});
