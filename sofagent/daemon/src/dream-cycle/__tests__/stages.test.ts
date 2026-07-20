// ============================================================
// dream-cycle/__tests__/stages.test.ts · Dream Cycle 6 阶段单元测试
// v1.1.6 新增
//
// 覆盖用例（每阶段 ≥1，共 8 case）：
//   1. extract_facts：空 Ledger → 空数组，pipeline 空转不报错
//   2. extract_facts：单条 audit history → 至少产出 1 个 fact
//   3. extract_atoms：单条 fact → 至少 1 条 atom
//   4. cluster_patterns：多条 atom → 聚成少于原数的 pattern（M < N）
//   5. synthesize_concepts：pattern → concept 写入 knowledge/entities/
//   6. skillopt_backfill：触发 fde.md 优化钩子（mock 验证被调用）
//   7. embed：产出定长向量
//   8. RealLLM：构造器抛「本版仅支持 mock，v1.1.8 接入」
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { MockLLM, RealLLM } from '../llm-mock';
import { extractFacts } from '../extract-facts';
import { extractAtoms } from '../extract-atoms';
import { clusterPatterns } from '../cluster-patterns';
import { synthesizeConcepts } from '../synthesize-concepts';
import { skilloptBackfill } from '../skillopt-backfill';
import { embedConcepts } from '../embed';
import type { Ledger } from '../types';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-dreamcycle-'));
}

describe('Dream Cycle 6 阶段', () => {
  let dir: string;
  const llm = new MockLLM();

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // 用例 1：extract_facts — 空 Ledger → 空数组，不报错
  it('extract_facts：空 Ledger → 空数组，pipeline 空转不报错', async () => {
    const ledger: Ledger = { thinkContent: '', auditEntries: [] };
    const facts = await extractFacts(ledger, llm);
    expect(Array.isArray(facts)).toBe(true);
    expect(facts.length).toBe(0);
  });

  // 用例 2：extract_facts — 单条 audit history → ≥1 fact
  it('extract_facts：单条 audit history → 至少产出 1 个 fact', async () => {
    const ledger: Ledger = {
      thinkContent: '',
      auditEntries: [
        { timestamp: '2026-07-20T00:00:00Z', rule: 'A1', status: 'FAIL', message: '越权写入' },
      ],
    };
    const facts = await extractFacts(ledger, llm);
    expect(facts.length).toBeGreaterThanOrEqual(1);
    expect(facts[0]!.source).toContain('audit:A1');
  });

  // 用例 3：extract_atoms — 单条 fact → ≥1 atom
  it('extract_atoms：单条 fact → 至少 1 条 atom', async () => {
    const facts = [{ id: 'f1', text: '教训：不要用 rm -rf', source: 'think.md' }];
    const atoms = await extractAtoms(facts, llm);
    expect(atoms.length).toBeGreaterThanOrEqual(1);
    expect(atoms[0]!.factId).toBe('f1');
  });

  // 用例 4：cluster_patterns — 多条 atom → M < N
  it('cluster_patterns：多条 atom → 聚成少于原数的 pattern（M < N）', async () => {
    const atoms = Array.from({ length: 9 }, (_, i) => ({
      id: `a${i}`,
      text: `知识点-${i}-独特的文本内容`,
      factId: `f${i}`,
    }));
    const patterns = await clusterPatterns(atoms, llm);
    expect(patterns.length).toBeGreaterThanOrEqual(1);
    expect(patterns.length).toBeLessThan(atoms.length);
  });

  // 用例 5：synthesize_concepts — pattern → concept 写入 knowledge/entities/
  it('synthesize_concepts：pattern → concept 写入 knowledge/entities/', async () => {
    const patterns = [{ id: 'p1', label: 'pattern-0', atomIds: ['a1', 'a2'] }];
    const atoms = [
      { id: 'a1', text: '教训一', factId: 'f1' },
      { id: 'a2', text: '教训二', factId: 'f1' },
    ];
    const concepts = await synthesizeConcepts(patterns, atoms, llm, dir);
    expect(concepts.length).toBe(1);
    const entitiesDir = path.join(dir, '.sofagent', 'knowledge', 'entities');
    expect(fs.existsSync(entitiesDir)).toBe(true);
    const files = fs.readdirSync(entitiesDir).filter((f) => f.endsWith('.md'));
    expect(files.length).toBe(1);
    const content = fs.readFileSync(path.join(entitiesDir, files[0]!), 'utf-8');
    expect(content).toContain('source: dream-cycle:pattern-0');
    expect(content).toContain('sensitivity: internal');
  });

  // 用例 6：skillopt_backfill — mock 钩子被调用
  it('skillopt_backfill：触发 fde.md 优化钩子（mock 验证被调用）', async () => {
    const concepts = [
      { slug: 'c1', title: 'T1', body: 'B1', source: 'dream-cycle:p', sensitivity: 'internal' as const },
    ];
    let called = 0;
    let received: unknown[] = [];
    await skilloptBackfill(concepts, llm, (cs) => {
      called += 1;
      received = cs;
    });
    expect(called).toBe(1);
    expect(received.length).toBe(1);
  });

  // 用例 7：embed — 产出定长向量
  it('embed：产出定长向量', async () => {
    const concepts = [
      { slug: 'c1', title: 'T1', body: 'B1', source: 'dream-cycle:p', sensitivity: 'internal' as const },
    ];
    const embeddings = await embedConcepts(concepts, llm);
    expect(embeddings.length).toBe(1);
    expect(embeddings[0]!.vector.length).toBe(8);
    expect(embeddings[0]!.vector.every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  // 用例 8：RealLLM — 构造器抛用户可读错
  it('RealLLM：构造器抛「本版仅支持 mock，v1.1.8 接入」', () => {
    expect(() => new RealLLM()).toThrow(/mock|v1\.1\.8/);
  });
});
