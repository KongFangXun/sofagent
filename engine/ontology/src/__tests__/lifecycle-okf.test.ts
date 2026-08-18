// ============================================================
// lifecycle-okf.test.ts · ontology 生命周期 + OKF 三件套测试
// v1.3.7 交付⑥ 新增
//
// 覆盖 changelog §三 验收 7 项：
//   1. lifecycle 字段入 schema 缺省 branch
//   2. branch→trunk 迁移审阅门 + 非法迁移结构化错误
//   3. ontology-view 区分 trunk/branch
//   4. 与能力市场五环状态对齐
//   5. OKF ①：缺 type 拒绝写入；存量读取容忍
//   6. OKF ②：status/stale_after/verified 写入与消费
//   7. OKF ③：index.md 链接化渐进披露
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, cpSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { mergeOntology, migrateToTrunk, LIFECYCLE_TO_MARKET_RING } from '../index';
import { generateOntologyView } from '../index';

let dir: string;
let knowledgeDir: string;
let dataDir: string;
let projDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sofagent-okf-'));
  // merge 侧数据目录（生产约定：knowledge 与 ontology 产物同层）
  dataDir = join(dir, 'data');
  knowledgeDir = join(dataDir, 'knowledge');
  mkdirSync(join(knowledgeDir, 'entities'), { recursive: true });
  mkdirSync(join(knowledgeDir, 'concepts'), { recursive: true });
  // view 侧工程目录（view 读 <proj>/.sofagent/ontology/）
  projDir = join(dir, 'proj');
  mkdirSync(join(projDir, '.sofagent'), { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('验收 1：lifecycle 字段入 schema，缺省 branch', () => {
  it('frontmatter 无 lifecycle → 合并结果默认 branch（新实体默认试验态）', () => {
    writeFileSync(join(knowledgeDir, 'entities', 'plain.md'), '---\ntype: agent\nname: plain\n---\n正文');
    const merged = mergeOntology(join(dataDir, 'config'));
    const obj = merged.objects.find((o) => o.name === 'plain');
    expect(obj?.lifecycle).toBe('branch');
  });

  it('frontmatter 显式 trunk → 保留 trunk', () => {
    writeFileSync(join(knowledgeDir, 'entities', 'stable.md'), '---\ntype: agent\nname: stable\nlifecycle: trunk\n---\n正文');
    const merged = mergeOntology(join(dataDir, 'config'));
    const obj = merged.objects.find((o) => o.name === 'stable');
    expect(obj?.lifecycle).toBe('trunk');
  });

  it('OKF ② 字段透传：status/stale_after/verified 随合并输出', () => {
    writeFileSync(
      join(knowledgeDir, 'entities', 'rich.md'),
      '---\ntype: agent\nname: rich\nstatus: stable\nstale_after: 2030-01-01\nverified:\n  - by: "human:kong"\n    at: "2026-08-18T00:00:00Z"\n---\n正文',
    );
    const merged = mergeOntology(join(dataDir, 'config'));
    const obj = merged.objects.find((o) => o.name === 'rich');
    expect(obj?.status).toBe('stable');
    expect(obj?.stale_after).toBe('2030-01-01');
    expect(obj?.verified?.[0]?.by).toBe('human:kong');
  });
});

describe('验收 2：branch→trunk 迁移审阅门', () => {
  it('合法迁移：approver 必填 + lifecycle 转 trunk + verified 追加留痕', () => {
    const entityPath = join(knowledgeDir, 'entities', 'to-promote.md');
    writeFileSync(entityPath, '---\ntype: agent\nname: to-promote\n---\n正文');
    const r = migrateToTrunk(knowledgeDir, { entityName: 'to-promote', approver: 'kong', reviewNote: '已审阅' });
    expect(r.ok).toBe(true);
    expect(r.from).toBe('branch');
    expect(r.to).toBe('trunk');
    const after = readFileSync(entityPath, 'utf-8');
    expect(after).toContain('lifecycle: trunk');
    expect(after).toContain('process:kong'); // verified 留痕
    expect(after).toContain('已审阅'); // reviewNote 留痕
  });

  it('非法迁移 ①：缺 approver 返回结构化错误（审阅门——空审阅人不许过）', () => {
    writeFileSync(join(knowledgeDir, 'entities', 'x.md'), '---\ntype: agent\nname: x\n---\n正文');
    const r = migrateToTrunk(knowledgeDir, { entityName: 'x', approver: '' });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('approver');
  });

  it('非法迁移 ②：实体不存在返回结构化错误', () => {
    const r = migrateToTrunk(knowledgeDir, { entityName: 'ghost', approver: 'kong' });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('不存在');
  });

  it('非法迁移 ③：已是 trunk 幂等拒绝（回退走 git snapshot）', () => {
    writeFileSync(join(knowledgeDir, 'entities', 't.md'), '---\ntype: agent\nname: t\nlifecycle: trunk\n---\n正文');
    const r = migrateToTrunk(knowledgeDir, { entityName: 't', approver: 'kong' });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('git snapshot');
  });
});

describe('验收 3：ontology-view 区分 trunk/branch', () => {
  it('能力地图基线资产可辨（trunk 徽标 + 分层统计 + 排序）', () => {
    writeFileSync(join(knowledgeDir, 'entities', 'b1.md'), '---\ntype: agent\nname: b1\n---\n试验');
    writeFileSync(join(knowledgeDir, 'entities', 't1.md'), '---\ntype: agent\nname: t1\nlifecycle: trunk\n---\n基线');
    mergeOntology(join(dataDir, 'config'));
    // merge 产物在 <dataDir>/ontology——复制到 view 约定路径 <proj>/.sofagent/ontology
    cpSync(join(dataDir, 'ontology'), join(projDir, '.sofagent', 'ontology'), { recursive: true });
    const view = generateOntologyView(projDir);
    expect(view).toContain('🌳 trunk');
    expect(view).toContain('🌱 branch');
    expect(view).toContain('基线资产 (trunk)');
    expect(view).toContain('试验资产 (branch)');
    // trunk 排前（t1 在 b1 前）
    expect(view.indexOf('t1')).toBeLessThan(view.indexOf('b1'));
  });

  it('OKF ② 消费展示：过期标注 + 验证人', () => {
    writeFileSync(
      join(knowledgeDir, 'entities', 'old.md'),
      '---\ntype: agent\nname: old\nlifecycle: trunk\nstale_after: 2020-01-01\nverified:\n  - by: "human:admin"\n    at: "2019-01-01T00:00:00Z"\n---\n老资产',
    );
    mergeOntology(join(dataDir, 'config'));
    cpSync(join(dataDir, 'ontology'), join(projDir, '.sofagent', 'ontology'), { recursive: true });
    const view = generateOntologyView(projDir);
    expect(view).toContain('已过期');
    expect(view).toContain('human:admin');
  });
});

describe('验收 4：与能力市场五环状态对齐', () => {
  it('映射表：trunk→published+maintained / branch→pending-review（无两套并存）', () => {
    expect(LIFECYCLE_TO_MARKET_RING['trunk']).toBe('published+maintained');
    expect(LIFECYCLE_TO_MARKET_RING['branch']).toBe('pending-review');
  });
});

// 验收 5/6/7（OKF ①②③ 消费侧：create_* type 必填 / parseOkfFields / index 链接化）
// 测试在 mcp 包 src/__tests__/okf-consumption.test.ts（跨包依赖方向：mcp 不 import ontology，反向亦然）
