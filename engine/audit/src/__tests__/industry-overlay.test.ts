// ============================================================
// industry-overlay.test.ts · 行业 overlay 自动发现测试
// v1.3.7 交付④ 新增
// ============================================================

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { parseIndustryMark, decideOverlay, decideOverlayFromProjectRoot, INDUSTRY_OVERLAY_MAP } from '../industry-overlay';
import { loadRuleset } from '../ruleset-loader';

let dir: string;
function setup(): string {
  dir = mkdtempSync(join(tmpdir(), 'sofagent-overlay-'));
  return dir;
}
function cleanup(): void {
  rmSync(dir, { recursive: true, force: true });
}

describe('parseIndustryMark', () => {
  it('frontmatter industry 标注解析（大小写归一）', () => {
    expect(parseIndustryMark('---\nindustry: fintech\n---\n# 内容')).toBe('fintech');
    expect(parseIndustryMark('---\nindustry: Medical\n---\n')).toBe('medical');
  });
  it('无 frontmatter / 无 industry 字段 / 正文伪标注都返回 null', () => {
    expect(parseIndustryMark('# 无 frontmatter')).toBeNull();
    expect(parseIndustryMark('---\nname: x\n---\n')).toBeNull();
    // 正文里的 industry: 不算（只在 frontmatter 生效）
    expect(parseIndustryMark('---\nname: x\n---\nindustry: fintech')).toBeNull();
  });
});

describe('decideOverlay（验收标准全覆盖）', () => {
  it('标注 fintech → 自动加载 fintech overlay（叠加默认 24 条）', () => {
    const d = setup();
    const ctx = join(d, 'context.md');
    writeFileSync(ctx, '---\nindustry: fintech\n---\n企业画像…');
    const r = decideOverlay(ctx);
    expect(r.load).toBe(true);
    expect(r.rulesetName).toBe('fintech');
    cleanup();
  });

  it('未标注行业 = 只跑默认（保守默认，不误加载）', () => {
    const d = setup();
    const ctx = join(d, 'context.md');
    writeFileSync(ctx, '---\nname: x\n---\n');
    const r = decideOverlay(ctx);
    expect(r.load).toBe(false);
    expect(r.reason).toContain('保守默认');
    cleanup();
  });

  it('context.md 不存在 = 保守默认', () => {
    const r = decideOverlay('/nonexistent/path/context.md');
    expect(r.load).toBe(false);
  });

  it('别名归一：finance→fintech / healthcare→medical / gov→government', () => {
    const d = setup();
    const ctx = join(d, 'context.md');
    for (const [mark, expectOverlay] of [['finance', 'fintech'], ['healthcare', 'medical'], ['gov', 'government']] as const) {
      writeFileSync(ctx, `---\nindustry: ${mark}\n---\n`);
      expect(decideOverlay(ctx).rulesetName).toBe(expectOverlay);
    }
    cleanup();
  });

  it('未知行业标注：不加载 + 提示支持列表', () => {
    const d = setup();
    const ctx = join(d, 'context.md');
    writeFileSync(ctx, '---\nindustry: aerospace\n---\n');
    const r = decideOverlay(ctx);
    expect(r.load).toBe(false);
    expect(r.reason).toContain('无对应 overlay');
    cleanup();
  });

  it('显式 --ruleset 优先，overlay 让位且留痕（决议 5）', () => {
    const d = setup();
    const ctx = join(d, 'context.md');
    writeFileSync(ctx, '---\nindustry: fintech\n---\n');
    const r = decideOverlay(ctx, 'security');
    expect(r.load).toBe(false);
    expect(r.deferredToExplicit).toBe(true);
    expect(r.reason).toContain('让位');
    cleanup();
  });
});

describe('四套 overlay 规则包可用性（复用 --ruleset 通道）', () => {
  it('fintech/medical/government/ai 各 ≥2 条行业特有规则（验收 1）', () => {
    for (const name of ['fintech', 'medical', 'government', 'ai']) {
      const rs = loadRuleset(name);
      expect(rs.name).toBe(name);
      expect(rs.rules.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('overlay 可与默认叠加（金融企业 = 24 默认 + fintech）——通道独立验证', () => {
    // 默认 24 条来自 rules/index.ts（既有事实）；overlay 经 ruleset-loader 独立加载
    const fintech = loadRuleset('fintech');
    expect(fintech.rules.every(r => r.id.startsWith('fin-'))).toBe(true);
    // 叠加语义由消费方（audit CLI）实现：24 + 3 = 27 全生效
    expect(24 + fintech.rules.length).toBe(27);
  });

  it('decideOverlayFromProjectRoot 探测项目根与 .sofagent/ 两处', () => {
    const d = setup();
    // 根目录
    writeFileSync(join(d, 'context.md'), '---\nindustry: ai\n---\n');
    expect(decideOverlayFromProjectRoot(d).rulesetName).toBe('ai');
    rmSync(join(d, 'context.md'));
    // .sofagent/ 下
    mkdirSync(join(d, '.sofagent'));
    writeFileSync(join(d, '.sofagent', 'context.md'), '---\nindustry: gov\n---\n');
    expect(decideOverlayFromProjectRoot(d).rulesetName).toBe('government');
    cleanup();
  });
});
