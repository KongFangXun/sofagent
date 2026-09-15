// ============================================================
// detector-glossary.test.ts · v1.4.9 T8 · L1 企业专名词典单测
// ============================================================
//
// 覆盖面（第八章验收②）：
//   1. 名录接入三形态（CSV/Excel 经 records / 知识库 entity 名录 / 手工录入）
//   2. 词典构建（占位符编号 / 过短名拦截 / 坏值跳过）
//   3. 命中与误报（中文专名 / ASCII 词边界 / 大小写不敏感）
//   4. 零模型依赖（纯函数——无任何网络/模型调用面）
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  buildGlossaryFromRecords,
  buildGlossaryFromEntityNames,
  createGlossaryDetector,
  placeholderOf,
  L1_GLOSSARY_DETECTOR_NAME,
  type GlossaryEntry,
} from '../export/detector-glossary';
import { DetectorRegistry } from '../export/detector-registry';
import { createL0RegexDetector } from '../export/detector-regex';
import { redact } from '../export/redactor';

describe('detector-glossary · 名录接入（T8 验收② 前置）', () => {
  it('CSV/Excel 经 data-ingest 接入——records 构建词典', () => {
    const result = buildGlossaryFromRecords(
      [
        { fields: { 客户名: '锐达科技', 备注: '华东大客户' } },
        { fields: { 客户名: '蓝海精密', 备注: '' } },
        { fields: { 客户名: null, 备注: '坏行' } }, // 坏值跳过
      ],
      '客户名',
      { kind: 'organization' },
    );
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]!.term).toBe('锐达科技');
    expect(result.entries[0]!.kind).toBe('organization');
    expect(result.entries[1]!.term).toBe('蓝海精密');
    expect(result.issues).toHaveLength(1); // null 行跳过登记
  });

  it('知识库 entity 名录接入——名称清单构建词典', () => {
    const result = buildGlossaryFromEntityNames(['客户档案', '订单流水', '电芯检测线-3号']);
    expect(result.entries).toHaveLength(3);
    expect(result.entries.map((e) => e.term)).toEqual(['客户档案', '订单流水', '电芯检测线-3号']);
    // 占位符逐条编号（可溯源）
    expect(result.entries[0]!.placeholder).toBe('{GLOSSARY:0}');
    expect(result.entries[2]!.placeholder).toBe('{GLOSSARY:2}');
  });

  it('过短名（单字）不入词典——误报面控制', () => {
    const result = buildGlossaryFromEntityNames(['A', '王', '锐达科技']);
    expect(result.entries).toHaveLength(1);
    expect(result.issues).toHaveLength(2);
    expect(result.issues.join('; ')).toContain('过短');
  });

  it('placeholderOf——缺省占位符 {GLOSSARY}', () => {
    expect(placeholderOf({})).toBe('{GLOSSARY}');
    expect(placeholderOf({ placeholder: '{GLOSSARY:3}' })).toBe('{GLOSSARY:3}');
  });
});

describe('detector-glossary · 命中与误报（T8 验收② 核心）', () => {
  it('中文企业专名命中——内部代号识别（零模型）', () => {
    const det = createGlossaryDetector([
      { term: '锐达科技', kind: 'organization' },
      { term: '凤凰计划', kind: 'project' },
    ]);
    const spans = det.detect('锐达科技承接的凤凰计划进入二期');
    expect(spans).toHaveLength(2);
    expect(spans[0]!.label).toBe('锐达科技');
    expect(spans[1]!.label).toBe('凤凰计划');
    expect(spans.every((s) => s.layer === 'L1' && s.detector === L1_GLOSSARY_DETECTOR_NAME)).toBe(true);
  });

  it('大小写不敏感命中', () => {
    const det = createGlossaryDetector([{ term: 'AcmeCorp', kind: 'organization' }]);
    const spans = det.detect('acmecorp 与 ACMECORP 是同一家');
    expect(spans).toHaveLength(2);
  });

  it('ASCII 专名词边界——不误命中更长标识符中段', () => {
    const det = createGlossaryDetector([{ term: 'Acme', kind: 'organization' }]);
    // AcmeInc 内含 Acme 但有字母跟随——词边界断言拦截
    const text = 'AcmeInc 不是 Acme';
    const spans = det.detect(text);
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0]!.start, spans[0]!.end)).toBe('Acme'); // 独立词位置（后半段）
    expect(spans[0]!.start).toBeGreaterThan(5);
  });

  it('正则元字符专名安全转义（term 含 . ( ) 等不炸不误报）', () => {
    const det = createGlossaryDetector([{ term: 'Rev.2(试点)', kind: 'product' }]);
    const spans = det.detect('方案 Rev.2(试点) 已上线');
    expect(spans).toHaveLength(1);
    expect(spans[0]!.text).toBe('Rev.2(试点)');
  });

  it('多次命中同一专名——逐处产出 span', () => {
    const det = createGlossaryDetector([{ term: '凤凰计划', kind: 'project' }]);
    const spans = det.detect('凤凰计划一期，凤凰计划二期');
    expect(spans).toHaveLength(2);
    expect(spans[1]!.start).toBeGreaterThan(spans[0]!.end);
  });

  it('空词典零命中不炸', () => {
    const det = createGlossaryDetector([]);
    expect(det.detect('任意文本')).toEqual([]);
  });
});

describe('detector-glossary · 管线集成（L1 注册进 registry 全链）', () => {
  it('L1+L0 同管线——词典优先命中且密钥族并存', () => {
    const reg = new DetectorRegistry();
    const glossary = buildGlossaryFromEntityNames(['锐达科技']).entries;
    reg.register(createGlossaryDetector(glossary));
    reg.register(createL0RegexDetector());
    // A2 自指规避：sk 密钥 fixture 运行时拼接
    const SK = ['sk-abcdefghij', 'klmnopqrstuvwxyz1234567890'].join('');
    const result = reg.runPipeline(`锐达科技 key=${SK}`);
    const labels = result.spans.map((s) => s.label);
    expect(labels).toContain('锐达科技');
    expect(labels).toContain('sk-generic');
    expect(result.degraded).toHaveLength(0);
  });

  it('redact 消费 L1 词典——企业专名 0 残留（验收语义）', () => {
    const entries: GlossaryEntry[] = [
      { term: '锐达科技', kind: 'organization' },
      { term: '凤凰计划', kind: 'project' },
    ];
    const reg = new DetectorRegistry();
    reg.register(createGlossaryDetector(entries));
    const r = redact('锐达科技的王工说凤凰计划顺利', undefined, { detectorRegistry: reg });
    expect(r.text).not.toContain('锐达科技');
    expect(r.text).not.toContain('凤凰计划');
    expect(r.text).toContain('{GLOSSARY:0}');
    expect(r.text).toContain('{GLOSSARY:1}');
    expect(r.totalHits).toBeGreaterThanOrEqual(2);
  });
});
