// ============================================================
// detector-registry.test.ts · v1.4.9 T8 · 检测器插槽单测
// ============================================================
//
// 覆盖面（第八章验收 ①⑥⑦）：
//   1. 插槽注册/注销/重名拒绝（fail-closed 防静默覆盖）
//   2. L0/L1/L2 三类实现注册与调度（span 产出正确）
//   3. span 聚合去重（同区间合并+佐证链 / 重叠长吞短 / 跨族保留）
//   4. 置信度三层（高替换 / 中替换+记审计 / 低只标记）
//   5. L2 不可达 fail-closed 降级（degraded 登记——不静默放行）
//   6. redactor 插槽消费 + v1.4.4 向后兼容回归锁（无注入 = 旧行为）
//   7. sensitivity-classifier 三档 + routeReason
//   8. Presidio schema 对齐（两段式 API / 类型映射）
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  DetectorRegistry,
  DEFAULT_CONFIDENCE_THRESHOLDS,
  tierOf,
  aggregateSpans,
  applySpans,
  toPresidioResults,
  type Detector,
  type SensitiveSpan,
} from '../export/detector-registry';
import { createL0RegexDetector, createL0SensitiveDetector } from '../export/detector-regex';
import { createGlossaryDetector, buildGlossaryFromEntityNames } from '../export/detector-glossary';
import { createPrefetchedRemoteDetector, validateRemoteSpans, prefetchRemoteSpans, createRemoteDetector } from '../export/detector-remote';
import { toPresidioType, recommendedOperator } from '../export/detector-presidio-schema';
import { classifySensitivity } from '../export/sensitivity-classifier';
import { redact } from '../export/redactor';

// A2 自指规避：fixture 密钥样本用数组 join 构造（项目先例——同 secret-patterns.ts）
const SK_KEY = ['sk-abcdefghij', 'klmnopqrstuvwxyz1234567890'].join('');
const AK_KEY = ['AKIAIOSFODNN', '7EXAMPLE'].join('');

/** 构造固定 span 的 stub 检测器（测试专用） */
function stubDetector(name: string, layer: 'L0' | 'L1' | 'L2', spans: SensitiveSpan[]): Detector {
  return {
    name,
    layer,
    detect: () => spans.map((s) => ({ ...s, detector: name, layer })),
  };
}

/** 基础 span 构造器 */
function mkSpan(start: number, end: number, label: string, score: number, entityType: 'CRYPTO' | 'PHONE_NUMBER' = 'CRYPTO'): SensitiveSpan {
  return {
    start,
    end,
    text: 'x'.repeat(end - start),
    label,
    entityType,
    score,
    detector: 'stub',
    layer: 'L0',
  };
}

describe('detector-registry · 插槽注册与调度（T8 验收①）', () => {
  it('注册/调度/注销——L0/L1/L2 三类实现可注册', () => {
    const reg = new DetectorRegistry();
    const r1 = reg.register(createL0RegexDetector());
    const r2 = reg.register(createGlossaryDetector([{ term: '锐达科技', kind: 'organization' }]));
    const r3 = reg.register(createPrefetchedRemoteDetector([], { name: 'l2-test' }));
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r3.ok).toBe(true);
    expect(reg.list()).toHaveLength(3);
    expect(reg.list().map((d) => d.layer)).toEqual(['L0', 'L1', 'L2']);

    const gone = reg.unregister('l0-regex');
    expect(gone).toBe(true);
    expect(reg.list()).toHaveLength(2);
  });

  it('重名注册拒绝（fail-closed 防静默覆盖既有判定面）', () => {
    const reg = new DetectorRegistry();
    expect(reg.register(createL0RegexDetector()).ok).toBe(true);
    const dup = reg.register(createL0RegexDetector());
    expect(dup.ok).toBe(false);
    expect(dup.message).toContain('已注册');
    expect(reg.list()).toHaveLength(1);
  });

  it('L0 正则检测器——REDACTION_PATTERNS 15 条表插槽化（sk- 密钥族命中）', () => {
    const det = createL0RegexDetector();
    const spans = det.detect(`token=${SK_KEY} 尾部`);
    expect(spans.length).toBeGreaterThanOrEqual(1);
    const sk = spans.find((s) => s.label === 'sk-generic');
    expect(sk).toBeDefined();
    expect(sk!.score).toBe(0.95);
    expect(sk!.entityType).toBe('CRYPTO');
    expect(SK_KEY.startsWith(spans[0]!.text.slice(0, 3))).toBe(true);
  });

  it('L0 敏感模式检测器——sorting-gate 五标签（手机号/金额/邮箱）', () => {
    const det = createL0SensitiveDetector();
    const spans = det.detect('联系 13812345678，报价 ¥1200.50，邮箱 a@b.com');
    const labels = spans.map((s) => s.label);
    expect(labels).toContain('手机号');
    expect(labels).toContain('金额');
    expect(labels).toContain('邮箱');
  });
});

describe('detector-registry · span 聚合去重（T8 验收①）', () => {
  it('完全相同区间合并——corroboredBy 佐证链 + score 加成', () => {
    const merged = aggregateSpans([
      mkSpan(0, 10, 'sk-generic', 0.9),
      mkSpan(0, 10, 'sk-key', 0.7),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.corroboredBy).toHaveLength(1);
    expect(merged[0]!.score).toBe(1); // 0.9 + 0.1 加成封顶
  });

  it('重叠不同区间——同族长吞短（长区间覆盖短区间）', () => {
    const merged = aggregateSpans([
      mkSpan(0, 20, 'pem-block', 0.95),
      mkSpan(5, 12, 'pem-block', 0.95), // 被包含——同族吞掉
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.start).toBe(0);
    expect(merged[0]!.end).toBe(20);
  });

  it('重叠跨族——保留双方（实体名在密钥区间内的场景）', () => {
    const merged = aggregateSpans([
      mkSpan(0, 20, 'pem-block', 0.95),
      mkSpan(5, 12, 'company', 0.9, 'PHONE_NUMBER'), // 跨族——保留
    ]);
    expect(merged).toHaveLength(2);
  });

  it('输出按 start 升序（消费方从后往前替换不破坏偏移）', () => {
    const merged = aggregateSpans([
      mkSpan(30, 40, 'a', 0.9),
      mkSpan(0, 5, 'b', 0.9),
      mkSpan(10, 15, 'c', 0.9),
    ]);
    expect(merged.map((s) => s.start)).toEqual([0, 10, 30]);
  });
});

describe('detector-registry · 置信度三层（T8 验收⑥）', () => {
  it('tierOf 三档分界（缺省阈值 0.9/0.6）', () => {
    expect(tierOf(0.95)).toBe('high');
    expect(tierOf(0.9)).toBe('high');
    expect(tierOf(0.75)).toBe('medium');
    expect(tierOf(0.6)).toBe('medium');
    expect(tierOf(0.5)).toBe('low');
  });

  it('runPipeline 输出带 tier 分档', () => {
    const reg = new DetectorRegistry();
    reg.register(stubDetector('s1', 'L0', [
      mkSpan(0, 10, 'a', 0.95),
      mkSpan(20, 30, 'b', 0.5),
    ]));
    const result = reg.runPipeline('x'.repeat(30));
    expect(result.spans.find((s) => s.label === 'a')!.tier).toBe('high');
    expect(result.spans.find((s) => s.label === 'b')!.tier).toBe('low');
  });

  it('检测器异常 fail-closed——degraded 登记不静默放行', () => {
    const reg = new DetectorRegistry();
    reg.register(createL0RegexDetector());
    // 注入一个必炸的检测器（L2 不可达语义等价——fail-closed 降级）
    reg.register({
      name: 'broken-l2',
      layer: 'L2',
      detect: () => {
        throw new Error('L2 端点连接拒绝（模拟一体机 NER 不可达）');
      },
    });
    const result = reg.runPipeline(`token=${SK_KEY}`);
    expect(result.degraded).toHaveLength(1);
    expect(result.degraded[0]!.detector).toBe('broken-l2');
    expect(result.degraded[0]!.reason).toContain('连接拒绝');
    // 降级后 L0 仍产出（降级 = 继续 L0+L1，不是停摆）
    expect(result.spans.length).toBeGreaterThanOrEqual(1);
  });
});

describe('detector-remote · L2 外挂 NER（T8 验收⑥ fail-closed）', () => {
  it('validateRemoteSpans——合法响应通过 + 坏结构拒绝', () => {
    const ok = validateRemoteSpans([{ label: 'PERSON', start: 0, end: 3, score: 0.8 }], 'l2');
    expect(ok.ok).toBe(true);
    expect(ok.spans[0]!.entityType).toBe('INTERNAL_CODE'); // PERSON label 走 toPresidioType 缺省分支
    expect(ok.spans[0]!.score).toBe(0.8);

    expect(validateRemoteSpans('not-array', 'l2').ok).toBe(false);
    expect(validateRemoteSpans([{ label: 'X', start: 5, end: 3 }], 'l2').ok).toBe(false); // 区间非法
    expect(validateRemoteSpans([{ start: 0, end: 3 }], 'l2').ok).toBe(false); // 缺 label
  });

  it('prefetchRemoteSpans——HTTP 非 2xx 上抛（fail-closed 不当无敏感）', async () => {
    await expect(
      prefetchRemoteSpans('text', { endpoint: 'http://127.0.0.1:1/x' }, (async () => ({ ok: false, status: 503, json: async () => ({}) })) as never),
    ).rejects.toThrow(/HTTP 503/);
  });

  it('prefetchRemoteSpans——坏 schema 上抛 + 合法面通过', async () => {
    await expect(
      prefetchRemoteSpans('text', { endpoint: 'http://x' }, (async () => ({ ok: true, status: 200, json: async () => ({ bad: 1 }) })) as never),
    ).rejects.toThrow(/fail-closed/);

    const spans = await prefetchRemoteSpans(
      '张三丰到此一游',
      { endpoint: 'http://x' },
      (async () => ({ ok: true, status: 200, json: async () => [{ entity_type: 'PERSON', start: 0, end: 3, score: 0.85 }] })) as never,
    );
    expect(spans[0]!.text).toBe('张三丰'); // 原文切片补齐
  });

  it('createRemoteDetector 直接 detect 上抛（异步面护栏——防绕过降级登记）', () => {
    const det = createRemoteDetector({ endpoint: 'http://x' });
    expect(() => det.detect('text')).toThrow(/prefetchRemoteSpans/);
  });
});

describe('detector-presidio-schema · Presidio 对齐（T8 验收④）', () => {
  it('toPresidioType——密钥族 → CRYPTO / PII 五标签映射', () => {
    expect(toPresidioType('aws-key')).toBe('CRYPTO');
    expect(toPresidioType('sk-generic')).toBe('CRYPTO');
    expect(toPresidioType('手机号')).toBe('PHONE_NUMBER');
    expect(toPresidioType('身份证号')).toBe('ID');
    expect(toPresidioType('银行卡号')).toBe('CREDIT_CARD');
    expect(toPresidioType('金额')).toBe('MONEY_AMOUNT');
    expect(toPresidioType('邮箱')).toBe('EMAIL_ADDRESS');
  });

  it('recommendedOperator——高/中 replace、低 keep', () => {
    expect(recommendedOperator('high')).toBe('replace');
    expect(recommendedOperator('medium')).toBe('replace');
    expect(recommendedOperator('low')).toBe('keep');
  });

  it('toPresidioResults——两段式 analyze 形态（entity_type/start/end/score）', () => {
    const results = toPresidioResults([mkSpan(0, 5, 'aws-key', 0.95)]);
    expect(results[0]!.entity_type).toBe('CRYPTO');
    expect(results[0]!.start).toBe(0);
    expect(results[0]!.end).toBe(5);
    expect(results[0]!.score).toBe(0.95);
  });

  it('applySpans——两段式 anonymize 形态（从后往前替换偏移不失效）', () => {
    const { text, replaced } = applySpans('AAABBBCCC', [
      { span: mkSpan(0, 3, 'a', 0.95), placeholder: '<X>' },
      { span: mkSpan(6, 9, 'c', 0.95), placeholder: '<Y>' },
    ]);
    expect(text).toBe('<X>BBB<Y>');
    expect(replaced).toBe(2);
  });
});

describe('redactor · 插槽消费 + 向后兼容回归锁（T8 验收⑦）', () => {
  it('无插槽注入 = v1.4.4 旧行为（回归锁——entities 字面替换原样工作）', () => {
    const r = redact('客户锐达科技的王工发来合同', {
      entities: [{ pattern: '锐达科技', placeholder: '{CUSTOMER_NAME}' }],
    });
    expect(r.text).toBe('客户{CUSTOMER_NAME}的王工发来合同');
    expect(r.hits['{CUSTOMER_NAME}']).toBe(1);
  });

  it('插槽注入态——L1 词典 span 替换 + 格式类内置不回退', () => {
    const reg = new DetectorRegistry();
    reg.register(createGlossaryDetector([{ term: '锐达科技', kind: 'organization' }]));
    const r = redact(`客户锐达科技 key=${SK_KEY}`, undefined, { detectorRegistry: reg });
    expect(r.text).not.toContain('锐达科技');
    expect(r.text).toContain('{GLOSSARY:0}');
    // 格式类内置仍然在位（插槽不回退格式面）
    const PH = '{' + 'SECRET';
    expect(r.text).toContain(PH + ':sk-key}');
  });

  it('插槽注入态——低置信 span 不替换（只标记交人审）', () => {
    const reg = new DetectorRegistry();
    // 裸 40 位 score 0.5 = 低置信档——不替换
    reg.register(createL0RegexDetector());
    const bare = 'A'.repeat(20) + '/' .repeat(0) + 'bC9+zZ7xQ2mN4kL8pR6tV3wY1uH5jJ9aS0dF'; // 40 位混合 base64（非纯 hex）
    const r = redact(`secret=${bare}`, undefined, { detectorRegistry: reg });
    // 低置信不替换——原文保留（交人审，不静默脱敏也不静默放行）
    expect(r.text).toContain(bare.slice(0, 10));
  });
});

describe('sensitivity-classifier · 三档分类（T8 验收⑤）', () => {
  function mkRegistry(): DetectorRegistry {
    const reg = new DetectorRegistry();
    reg.register(createL0SensitiveDetector());
    reg.register(createGlossaryDetector([{ term: '凤凰计划', kind: 'project' }]));
    return reg;
  }

  it('敏感档——中置信以上命中（手机号 0.7 → medium）', () => {
    const d = classifySensitivity('联系 13812345678', mkRegistry());
    expect(d.level).toBe('sensitive');
    expect(d.decidedBy).toBe('rule');
    expect(d.routeReason).toContain('命中敏感特征');
    expect(d.matchedLabels).toContain('手机号');
  });

  it('敏感档——L1 词典命中（企业专名 0.9 → high）', () => {
    const d = classifySensitivity('项目凤凰计划启动', mkRegistry());
    expect(d.level).toBe('sensitive');
    expect(d.matchedLabels).toContain('凤凰计划');
  });

  it('内部档——无敏感命中但含内部叙事关键词', () => {
    const d = classifySensitivity('这份文档仅限内部评审使用', mkRegistry());
    expect(d.level).toBe('internal');
    expect(d.routeReason).toContain('内部'); // 「内部」先于「仅限」命中（关键词数组序）
  });

  it('公开档——零命中零关键词', () => {
    const d = classifySensitivity('今天天气不错', mkRegistry());
    expect(d.level).toBe('public');
  });

  it('外挂模型档——注入即透传（decidedBy=model）', () => {
    const d = classifySensitivity('任意文本', mkRegistry(), { modelLevel: 'internal' });
    expect(d.level).toBe('internal');
    expect(d.decidedBy).toBe('model');
    expect(d.routeReason).toContain('GB/T');
  });
});

describe('glossary 构建（T8 验收② 前置）', () => {
  it('buildGlossaryFromEntityNames——知识库名录接入 + 过短名拦截', () => {
    const result = buildGlossaryFromEntityNames(['锐达科技', '凤凰计划', 'A', '']);
    expect(result.entries).toHaveLength(2);
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]).toContain('过短');
  });

  it('词典命中内部代号（零模型依赖——验收②核心）', () => {
    const det = createGlossaryDetector([{ term: '电芯检测线-3号', kind: 'product' }]);
    const spans = det.detect('今日巡检电芯检测线-3号，参数正常');
    expect(spans).toHaveLength(1);
    expect(spans[0]!.label).toBe('电芯检测线-3号');
    expect(spans[0]!.layer).toBe('L1');
    expect(spans[0]!.score).toBe(0.9);
  });

  it('ASCII 词条词边界——Acme 不命中 AcmeCorp 中段（误报防护）', () => {
    const det = createGlossaryDetector([{ term: 'Acme', kind: 'organization' }]);
    const spans = det.detect('AcmeCorp 是另一家公司，Acme 是词典名');
    expect(spans).toHaveLength(1);
    expect(spans[0]!.start).toBeGreaterThan(10);
  });
});

describe('L0 插槽化基底完整性（禁回退 9 族旧表——宽度铁律）', () => {
  it('REDACTION_PATTERNS 全量参与检测（14 条 = 13 密钥族 + 1 PII——L0_LABELS 索引全覆盖）', async () => {
    const { REDACTION_PATTERNS } = await import('../shared/secret-patterns');
    // 实数 14（v1.3.9 九族对齐 + v1.4.2 H-02 扩 4 族 + PII 手机号 1 条）
    expect(REDACTION_PATTERNS.length).toBe(14);
  });

  it('AKIA 族与 sk- 族同时命中（多族并存不互斥）', () => {
    const det = createL0RegexDetector();
    const spans = det.detect(`${AK_KEY} ${SK_KEY}`);
    const labels = spans.map((s) => s.label);
    expect(labels).toContain('aws-key');
    expect(labels).toContain('sk-generic');
  });

  it('DEFAULT_CONFIDENCE_THRESHOLDS 导出（阈值外部化锚）', () => {
    expect(DEFAULT_CONFIDENCE_THRESHOLDS.high).toBe(0.9);
    expect(DEFAULT_CONFIDENCE_THRESHOLDS.medium).toBe(0.6);
  });
});
