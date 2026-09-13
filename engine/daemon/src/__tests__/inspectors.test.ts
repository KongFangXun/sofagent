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
  const prevHome = process.env.SOFAGENT_HOME;

  beforeEach(() => {
    // v1.3.5 阶段五隔离：audit-trail/data-sovereignty 等 inspector 无隔离时
    // 会扫真实 ~/.sofagent（5MB+ history）——SOFAGENT_DATA 指向 tmp
    isoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-iso-'));
    process.env.SOFAGENT_DATA = isoDir;
    // v1.4.9 P1-14：knowledge 系巡检（conflict-check / knowledge-health /
    // knowledge-freshness / ontology-coverage）改经 resolveKnowledgeDir() 读
    // {SOFAGENT_HOME}/data/knowledge——该解析器**不认 SOFAGENT_DATA**（认 overrideHome
    // 与 SOFAGENT_HOME），只隔离 DATA 会读/写**开发机真实知识库**
    // （checkKnowledgeHealth 会 append health-report.md = 真实目录被测试写入）。
    // 故此处一并隔离 HOME。
    process.env.SOFAGENT_HOME = isoDir;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-insp-test-'));
    fs.mkdirSync(path.join(tmpDir, '.sofagent'), { recursive: true });
  }, 90_000);

  afterEach(() => {
    // 环境变量还原（防泄漏到后续测试文件——审查报告 #73 断言泄漏项）
    if (prevData === undefined) delete process.env.SOFAGENT_DATA;
    else process.env.SOFAGENT_DATA = prevData;
    if (prevHome === undefined) delete process.env.SOFAGENT_HOME;
    else process.env.SOFAGENT_HOME = prevHome;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    try { fs.rmSync(isoDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }, 90_000);

  it('返回全部注册巡检结果（v1.4.8 起 runInspectors 走注册表单源——24 执行 = 25 注册 - 1 disabled）', { timeout: 90_000 }, () => {
    const results = runInspectors(tmpDir);
    expect(results).toHaveLength(24);
    expect(results.some((r) => r.name === 'audit-trail')).toBe(true); // 漂移修复：audit-trail 首次进活路径
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
