// audit-reducer.test.ts · 章十 审计留痕规约层 + PROV-O 导出测试
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const ISO_DIR = join(tmpdir(), `sofagent-reducer-test-${process.pid}`);
process.env.SOFAGENT_DATA = ISO_DIR;

const { appendHistory } = await import('../audit-history');
const { reduceAuditHistory, exportProvTurtle, exportProvJsonLd } = await import('../audit-reducer');

/** history.jsonl 路径（loadHistory 的 dataDir 解析链——SOFAGENT_DATA env） */
function historyPath(): string {
  return join(ISO_DIR, 'audit', 'history.jsonl');
}

/** 造一条最小 history 记录 */
function makeEntry(over: Partial<Parameters<typeof appendHistory>[0]> = {}) {
  return {
    timestamp: new Date().toISOString(),
    diffRange: 'HEAD~1..HEAD',
    exitCode: 0,
    ruleResults: [
      { name: 'A1 基线检查', number: 1, status: 'PASS', details: [] },
    ],
    diffFileCount: 2,
    agentId: 'agent-x',
    ...over,
  };
}

describe('章十：规约层三维过滤 + 双维度聚合', () => {
  beforeEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
    mkdirSync(join(ISO_DIR, 'audit'), { recursive: true });
  });
  afterEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
  });

  it('空数据 → 空报表（不 crash）', () => {
    const r = reduceAuditHistory({ dataDir: ISO_DIR });
    expect(r.matched).toBe(0);
    expect(r.byAgent).toEqual([]);
    expect(r.byRule).toEqual([]);
  });

  it('按 agent 过滤 + records/passes/fails 聚合', () => {
    writeFileSync(
      historyPath(),
      [
        JSON.stringify(makeEntry({ agentId: 'agent-a' })),
        JSON.stringify(makeEntry({ agentId: 'agent-a', exitCode: 2, diffFileCount: 5 })),
        JSON.stringify(makeEntry({ agentId: 'agent-b' })),
      ].join('\n') + '\n',
      'utf-8',
    );
    const r = reduceAuditHistory({ agentId: 'agent-a', dataDir: ISO_DIR });
    expect(r.matched).toBe(2);
    const rowA = r.byAgent.find((x) => x.agentId === 'agent-a')!;
    expect(rowA.records).toBe(2);
    expect(rowA.passes).toBe(1);
    expect(rowA.fails).toBe(1);
    expect(rowA.filesChanged).toBe(7);
  });

  it('按时间过滤（since/until 闭区间）', () => {
    const t1 = '2026-01-01T00:00:00Z';
    const t2 = '2026-06-01T00:00:00Z';
    const t3 = '2026-12-01T00:00:00Z';
    writeFileSync(
      historyPath(),
      [makeEntry({ timestamp: t1 }), makeEntry({ timestamp: t2 }), makeEntry({ timestamp: t3 })]
        .map((e) => JSON.stringify(e))
        .join('\n') + '\n',
      'utf-8',
    );
    const r = reduceAuditHistory({ since: '2026-02-01', until: '2026-10-01', dataDir: ISO_DIR });
    expect(r.matched).toBe(1);
    expect(r.refs[0].timestamp).toBe(t2);
  });

  it('按规则过滤 + hits/fails/warns 聚合', () => {
    writeFileSync(
      historyPath(),
      [
        JSON.stringify(
          makeEntry({
            ruleResults: [
              { name: 'A2 密钥泄漏', number: 2, status: 'FAIL', details: [] },
              { name: 'A1 基线检查', number: 1, status: 'PASS', details: [] },
            ],
          }),
        ),
        JSON.stringify(
          makeEntry({
            ruleResults: [{ name: 'A2 密钥泄漏', number: 2, status: 'WARN', details: [] }],
          }),
        ),
      ].join('\n') + '\n',
      'utf-8',
    );
    const r = reduceAuditHistory({ ruleName: 'A2 密钥泄漏', dataDir: ISO_DIR });
    expect(r.matched).toBe(2);
    const rule = r.byRule.find((x) => x.ruleName === 'A2 密钥泄漏')!;
    expect(rule.hits).toBe(2);
    expect(rule.fails).toBe(1);
    expect(rule.warns).toBe(1);
    // 过滤后 byRule 只含命中规则
    expect(r.byRule.length).toBe(1);
  });

  it('多条件 AND 语义', () => {
    writeFileSync(
      historyPath(),
      [
        JSON.stringify(makeEntry({ agentId: 'agent-a', timestamp: '2026-03-01T00:00:00Z' })),
        JSON.stringify(makeEntry({ agentId: 'agent-b', timestamp: '2026-03-02T00:00:00Z' })),
      ].join('\n') + '\n',
      'utf-8',
    );
    const r = reduceAuditHistory({ agentId: 'agent-a', since: '2026-03-02', dataDir: ISO_DIR });
    expect(r.matched).toBe(0);
  });
});

describe('章十：PROV-O 导出（薄出口）', () => {
  beforeEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
    mkdirSync(join(ISO_DIR, 'audit'), { recursive: true });
  });
  afterEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
  });

  it('Turtle 导出：前缀 + Agent + Activity 三元组', () => {
    writeFileSync(
      historyPath(),
      JSON.stringify(makeEntry({ agentId: 'agent-x' })) + '\n',
      'utf-8',
    );
    const ttl = exportProvTurtle({ dataDir: ISO_DIR });
    expect(ttl).toContain('@prefix prov: <http://www.w3.org/ns/prov#>');
    expect(ttl).toContain('a prov:Agent');
    expect(ttl).toContain('a prov:Activity');
    expect(ttl).toContain('prov:startedAtTime');
    expect(ttl).toContain('"agent-x"');
  });

  it('JSON-LD 导出：@context + @graph 结构', () => {
    writeFileSync(
      historyPath(),
      JSON.stringify(makeEntry({ agentId: 'agent-x' })) + '\n',
      'utf-8',
    );
    const jsonld = exportProvJsonLd({ dataDir: ISO_DIR });
    const doc = JSON.parse(jsonld);
    expect(doc['@context'].prov).toBe('http://www.w3.org/ns/prov#');
    expect(doc['@graph'].length).toBeGreaterThan(0);
    const agent = doc['@graph'].find((n: { '@type': string }) => n['@type'] === 'prov:Agent');
    expect(agent['sofagent:agentId']).toBe('agent-x');
  });

  it('零命中 → 空 Turtle 标注 + 空 @graph（不 crash）', () => {
    const ttl = exportProvTurtle({ agentId: 'nobody', dataDir: ISO_DIR });
    expect(ttl).toContain('零命中');
    const doc = JSON.parse(exportProvJsonLd({ agentId: 'nobody', dataDir: ISO_DIR }));
    expect(doc['@graph']).toEqual([]);
  });
});

describe('章十：写路径回归（append-only 不动）', () => {
  it('appendHistory 既有行为不变（追加写入 + 字段完整）', () => {
    rmSync(ISO_DIR, { recursive: true, force: true });
    mkdirSync(join(ISO_DIR, 'audit'), { recursive: true });
    appendHistory(makeEntry({ agentId: 'regression-agent' }), ISO_DIR);
    appendHistory(makeEntry({ agentId: 'regression-agent' }), ISO_DIR);
    // 文件面：两行追加（append 语义）+ 每行 agentId 字段完整
    const content = readFileSync(historyPath(), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines.length).toBe(2);
    for (const line of lines) {
      const e = JSON.parse(line);
      expect(e.agentId).toBe('regression-agent');
      expect(typeof e.timestamp).toBe('string');
    }
    // 规约层立即可读（写读同源）
    const r = reduceAuditHistory({ agentId: 'regression-agent', dataDir: ISO_DIR });
    expect(r.matched).toBe(2);
  });
});
