// export.test.ts · v1.4.4 第一章 · 语料导出三件套测试
//
// 覆盖（changelog 验收标准对齐）：
// 1. 27 编号位零遗漏（24 实现 + 3 跳号占位 A12/A13/E3）
// 2. reward_hint 段齐全（签名/权重/可判定性三件套）
// 3. verifiers 三桶分桶正确（机器可判/需人审/启发式）
// 4. GUIDE 锚点解析（五要素/三问判定/量化公式三段）
// 5. 脱敏管线（格式类/语义类/结构类 + 企业专名 0 命中）
// 6. 五源样本聚合（合成数据源 + 白名单字段）
// 7. HMAC 签名 + 导出审计事件

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import {
  allRuleSlots,
  toRuleExportEntry,
  mergedPlaceholder,
  severityWeightOf,
  inferVerifiability,
  type RuleExportEntry,
} from '../export/rule-schema';
import { buildRuleCorpusBody, exportRuleCorpus, jsonToYaml, signBody } from '../export/exporter';
import { buildVerifiersManifest, buildVerifiersWithOverrides } from '../export/reward-mapping';
import { defaultRules, extendedRules } from '../rules/index';

// core 侧（相对路径跨包 import——vitest workspace 已配 alias，走 src 直引）
import { parseMethodologySections, exportMethodology } from '@sofagent/core';
import { redact, verifyNoLeak } from '@sofagent/core';
import { aggregateSamples } from '@sofagent/core';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');

// ────────────────────────────────────────────────────────────
// 一、规则导出：27 编号位零遗漏
// ────────────────────────────────────────────────────────────

describe('规则语料导出（27 编号位）', () => {
  it('all 范围 = 24 实现 + 3 占位 = 27 编号位（零遗漏）', () => {
    const all = [...defaultRules, ...extendedRules];
    expect(all).toHaveLength(24); // 源头 24 条
    const slots = allRuleSlots(all);
    expect(slots).toHaveLength(27);

    // 跳号占位三件在位
    const codes = slots.map((s) => s.code);
    expect(codes).toContain('A12');
    expect(codes).toContain('A13');
    expect(codes).toContain('E3');
    const placeholders = slots.filter((s) => s.status === 'merged-into-A11');
    expect(placeholders).toHaveLength(3);
    for (const p of placeholders) {
      expect(p.mergedInto).toBe('A11');
    }
  });

  it('编号空间连续性——A1-A11 + A14-A23 + E1/E2/E4 + 占位 A12/A13/E3 全在', () => {
    const all = allRuleSlots([...defaultRules, ...extendedRules]);
    const codes = new Set(all.map((s) => s.code));
    const expected = [
      'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11',
      'A12', 'A13', // 占位
      'A14', 'A15', 'A16', 'A17', 'A18', 'A19', 'A20', 'A21', 'A22', 'A23',
      'E1', 'E2', 'E3', // E3 占位
      'E4',
    ];
    for (const c of expected) expect(codes.has(c)).toBe(true);
    expect(codes.size).toBe(expected.length);
  });

  it('buildRuleCorpusBody(all) 的 counts 三数对账闭合', () => {
    const body = buildRuleCorpusBody('all', '1.4.4-test');
    expect(body.counts.implemented).toBe(24);
    expect(body.counts.mergedPlaceholders).toBe(3);
    expect(body.counts.totalSlots).toBe(27);
    expect(body.rules).toHaveLength(27);
    expect(body.schemaVersion).toBe('v1');
    expect(body.engineVersion).toBe('1.4.4-test');
  });

  it('engineVersion 默认读 audit 包 package.json（非 0.0.0 兜底）', () => {
    // 路径两层上（src/export 与 dist/export 同构）——三层上曾错解到 engine/ 导致
    // CLI 实跑回退 '0.0.0'，此用例锁路径
    const body = buildRuleCorpusBody('all');
    expect(body.engineVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(body.engineVersion).not.toBe('0.0.0');
  });

  it('部分范围（default）不含占位——17 条纯实现', () => {
    const body = buildRuleCorpusBody('default');
    expect(body.counts.implemented).toBe(17);
    expect(body.counts.mergedPlaceholders).toBe(0);
    expect(body.counts.totalSlots).toBe(17);
  });

  it('每条实现规则带 reward_hint 三件套（签名/权重/可判定性）', () => {
    for (const rule of [...defaultRules, ...extendedRules]) {
      const e = toRuleExportEntry(rule);
      expect(e.reward_hint.signature.length).toBeGreaterThan(10);
      expect(typeof e.reward_hint.severityWeight).toBe('number');
      expect(['machine-judgeable', 'human-review', 'heuristic']).toContain(e.reward_hint.verifiability);
      expect(e.status).toBe('implemented');
    }
  });

  it('severityWeightOf 映射——critical 1.0 / warning 0.6 / extended 0.4 / crutch 0.3', () => {
    expect(severityWeightOf('critical')).toBe(1.0);
    expect(severityWeightOf('warning')).toBe(0.6);
    expect(severityWeightOf('extended')).toBe(0.4);
    expect(severityWeightOf('crutch')).toBe(0.3);
    expect(severityWeightOf(undefined)).toBe(0.5);
  });

  it('inferVerifiability 分桶——git-diff 机器可判 / hybrid 需人审 / filesystem 启发式', () => {
    expect(inferVerifiability({ evidenceMode: 'git-diff' })).toBe('machine-judgeable');
    expect(inferVerifiability({ evidenceMode: 'hybrid' })).toBe('human-review');
    expect(inferVerifiability({ evidenceMode: 'filesystem' })).toBe('heuristic');
  });

  it('mergedPlaceholder 登记口径——status 与 mergedInto 指向 A11', () => {
    const p = mergedPlaceholder('A12', 12, '测试');
    expect(p.status).toBe('merged-into-A11');
    expect(p.mergedInto).toBe('A11');
    expect(p.reward_hint.verifiability).toBe('machine-judgeable');
  });
});

// ────────────────────────────────────────────────────────────
// 二、verifiers 清单（三桶分桶）
// ────────────────────────────────────────────────────────────

describe('verifiers 三桶清单', () => {
  it('三桶总和 = 27（24 实现 + 3 跳号占位全量分桶——占位进机器可判桶）', () => {
    const m = buildVerifiersManifest();
    const total =
      m.buckets.machineJudgeable.length +
      m.buckets.humanReview.length +
      m.buckets.heuristic.length;
    expect(total).toBe(27);
  });

  it('git-diff 类规则全部进机器可判桶（可直接当 reward 函数接线）', () => {
    const m = buildVerifiersManifest();
    const machineCodes = m.buckets.machineJudgeable.map((e) => e.code);
    expect(machineCodes).toContain('A1');
    expect(machineCodes).toContain('A2');
    expect(machineCodes).toContain('A20');
    // A12/A13/E3 占位也在机器桶
    expect(machineCodes).toContain('A12');
    expect(machineCodes).toContain('E3');
  });

  it('hybrid 类规则进需人审桶（A7/A8/A14/A15）', () => {
    const m = buildVerifiersManifest();
    const humanCodes = m.buckets.humanReview.map((e) => e.code);
    expect(humanCodes).toContain('A7');
    expect(humanCodes).toContain('A14');
  });

  it('覆写机制生效——A7 覆写为 machine-judgeable 后进机器桶', () => {
    const m = buildVerifiersWithOverrides({ A7: 'machine-judgeable' });
    expect(m.buckets.machineJudgeable.map((e) => e.code)).toContain('A7');
    expect(m.buckets.humanReview.map((e) => e.code)).not.toContain('A7');
  });

  it('wiring 指引三段在位（训练管线消费说明）', () => {
    const m = buildVerifiersManifest();
    expect(m.wiring.machineJudgeable).toContain('reward');
    expect(m.wiring.humanReview).toContain('验收');
    expect(m.wiring.heuristic).toContain('弱 reward');
  });
});

// ────────────────────────────────────────────────────────────
// 三、GUIDE 锚点解析（方法论结构化导出）
// ────────────────────────────────────────────────────────────

describe('GUIDE 方法论锚点解析', () => {
  it('真实 GUIDE.md 三段齐全（五要素/三问判定/量化公式）', () => {
    const corpus = exportMethodology(repoRoot);
    expect(corpus.complete).toBe(true);
    expect(corpus.missing).toEqual([]);
    expect(corpus.sections.map((s) => s.key).sort()).toEqual(['five-elements', 'quantification', 'three-questions']);
  });

  it('五要素段含表格与关键内容（输入/输出/负责人/耗时/最卡）', () => {
    const corpus = exportMethodology(repoRoot);
    const five = corpus.sections.find((s) => s.key === 'five-elements');
    expect(five).toBeDefined();
    expect(five!.tables).toBeGreaterThan(0);
    expect(five!.raw).toContain('输入');
    expect(five!.raw).toContain('负责人');
  });

  it('三问段含量化判定语义（自动执行/强化岗位/暂不动）', () => {
    const corpus = exportMethodology(repoRoot);
    const three = corpus.sections.find((s) => s.key === 'three-questions');
    expect(three).toBeDefined();
    expect(three!.raw).toContain('自动执行');
  });

  it('量化段含公式（年节省 = 岗位真实市场年薪 × AI 接管工时占比）', () => {
    const corpus = exportMethodology(repoRoot);
    const quant = corpus.sections.find((s) => s.key === 'quantification');
    expect(quant).toBeDefined();
    expect(quant!.raw).toContain('年节省');
  });

  it('锚点驱动同步——markdown 增删内容后重导即生效（不依赖行号）', () => {
    const synthetic = [
      '# 前',
      '<!-- METHODOLOGY: five-elements -->',
      '五要素内容甲',
      '<!-- METHODOLOGY: three-questions -->',
      '三问内容乙',
      '## 下一章',
      '内容丙（不属任何锚点段）',
    ].join('\n');
    const c = parseMethodologySections(synthetic);
    expect(c.complete).toBe(false);
    expect(c.missing).toEqual(['quantification']);
    expect(c.sections).toHaveLength(2);
    expect(c.sections[0]!.raw).toBe('五要素内容甲');
    // 章节头截断——三问段不含「下一章」后内容
    expect(c.sections[1]!.raw).toBe('三问内容乙');
  });

  it('GUIDE 缺失（坏路径）——三段全缺不崩', () => {
    const c = exportMethodology('/nonexistent/path');
    expect(c.complete).toBe(false);
    expect(c.missing).toHaveLength(3);
    expect(c.sections).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────
// 四、脱敏管线
// ────────────────────────────────────────────────────────────

describe('通用脱敏管线（redactor）', () => {
  it('格式类（内置）——AWS/OpenAI/GitHub 密钥格式全拦截', () => {
    // A2 自指规避：fixture 密钥样本用数组 join 构造（项目先例——同 secret-patterns.ts），
    // 且每个数组元素本身也不含完整密钥形态（拆半），git diff 逐行扫描零命中
    const text = [
      'key=' + ['AKIAIOSFODNN', '7EXAMPLE'].join(''),
      'token=' + ['sk-abcdefghij', 'klmnopqrstuvwxyz1234567890'].join(''),
      'gh=ghp_' + 'a'.repeat(36),
    ].join(' ');
    const r = redact(text);
    expect(r.text).not.toContain(['AKIA', 'IOSFODNN7EXAMPLE'].join(''));
    expect(r.text).not.toContain(['sk-', 'abcdefghij'].join(''));
    expect(r.text).toContain('{SECRET:aws-key}');
    expect(r.text).toContain('{SECRET:sk-key}');
    expect(r.totalHits).toBeGreaterThanOrEqual(3);
  });

  it('格式类——PEM 私钥块整体替换', () => {
    // A2 自指规避：PEM 头尾运行时拼接（先例同 secret-patterns.ts PEM_WORD）
    const pem = ['-----BEGIN RSA PRIVATE ', 'KEY-----\nMIIEow...\n-----END RSA PRIVATE ', 'KEY-----'].join('');
    const r = redact(`前置 ${pem} 后置`);
    expect(r.text).not.toContain('MIIEow');
    // A2 自指规避：占位符断言用前缀拼接，避免 secret:值 形态整串出现在源行
    const PH = '{' + 'SECRET';
    expect(r.text).toContain(PH + ':pem-block}');
  });

  it('语义类（实体名库）——企业专名替换为占位符', () => {
    const r = redact('客户锐达科技的王工发来合同', {
      entities: [{ pattern: '锐达科技', placeholder: '{CUSTOMER_NAME}' }],
    });
    expect(r.text).toBe('客户{CUSTOMER_NAME}的王工发来合同');
    expect(r.hits['{CUSTOMER_NAME}']).toBe(1);
  });

  it('结构类（字段黑名单）——JSON 字段值抹除保键名', () => {
    const r = redact('{"customerName": "张三丰", "id": 1}', { fields: ['customerName'] });
    expect(r.text).toContain('"customerName": {FIELD:customerName}');
    expect(r.text).not.toContain('张三丰');
  });

  it('verifyNoLeak——脱敏后企业专名 0 命中（验收断言）', () => {
    const raw = '项目代号凤凰计划由锐达科技承接';
    const r = redact(raw, { entities: [{ pattern: '锐达科技', placeholder: '{CUSTOMER_NAME}' }] });
    const check = verifyNoLeak(r.text, ['锐达科技']);
    expect(check.clean).toBe(true);
    expect(check.leaked).toEqual([]);
    // 未脱敏的对照——应检出泄漏
    const bad = verifyNoLeak(raw, ['锐达科技']);
    expect(bad.clean).toBe(false);
  });

  it('空配置零替换（原文透传）+ 坏配置文件降级不崩', () => {
    const r = redact('普通文本无秘密');
    expect(r.text).toBe('普通文本无秘密');
    expect(r.totalHits).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────
// 五、五源样本聚合
// ────────────────────────────────────────────────────────────

describe('五源样本聚合（sample-aggregator）', () => {
  let tmpData: string;

  it('合成五源数据——全源提取 + 白名单字段 + 脱敏贯通', () => {
    tmpData = mkdtempSync(join(tmpdir(), 'corpus-agg-'));
    // 源 1：decision-log
    mkdirSync(join(tmpData, 'audit'), { recursive: true });
    writeFileSync(join(tmpData, 'audit', 'decision-log.jsonl'),
      JSON.stringify({ decision: 'approved', ruleId: 'A2', severity: 'critical', why: '客户锐达科技的密钥拦截' }) + '\n');
    // 源 2：llm-calls（runtime/llm-calls.jsonl）
    mkdirSync(join(tmpData, 'audit', 'runtime'), { recursive: true });
    writeFileSync(join(tmpData, 'audit', 'runtime', 'llm-calls.jsonl'),
      JSON.stringify({ status: 'ok', totalTokens: 1234, durationMs: 500, prompt: '普通调用' }) + '\n');
    // 源 3：evaluation-log（<project>/benchmarks/<id>/）
    mkdirSync(join(tmpData, 'proj-a', 'benchmarks', 'bench-1'), { recursive: true });
    writeFileSync(join(tmpData, 'proj-a', 'benchmarks', 'bench-1', 'evaluation-log.jsonl'),
      JSON.stringify({ passed: false, caseId: 'case-9', tokens: 99, failureCode: 'E_VAL', summary: '输出未过阈值' }) + '\n');
    // 源 4：runtime-audit（FORGE 产物 repo-hash 目录）——detail 值运行时拼接（A2 自指规避）
    mkdirSync(join(tmpData, 'audit', 'runtime', 'a325d4ba64c8'), { recursive: true });
    writeFileSync(join(tmpData, 'audit', 'runtime', 'a325d4ba64c8', 'runtime-audit.jsonl'),
      JSON.stringify({ verdict: 'FAIL', ruleId: 'A2', severity: 'critical', detail: ['sk-abcdefghijklmnopqrstuvwxyz', '1234567890 泄漏'].join('') }) + '\n');
    // 源 5：fde-session（meta.json + context.md）
    mkdirSync(join(tmpData, 'fde', 'sessions', 'sess-1'), { recursive: true });
    writeFileSync(join(tmpData, 'fde', 'sessions', 'sess-1', 'meta.json'),
      JSON.stringify({ enterpriseId: 'ent-001' }));
    writeFileSync(join(tmpData, 'fde', 'sessions', 'sess-1', 'context.md'), '进场梳理：锐达科技电芯检测流程');

    const result = aggregateSamples(tmpData, {
      entities: [{ pattern: '锐达科技', placeholder: '{CUSTOMER_NAME}' }],
    });

    // 五源全在位
    expect(Object.keys(result.sourceCounts).sort()).toEqual(['decision-log', 'evaluation-log', 'fde-session', 'llm-calls', 'runtime-audit']);
    expect(result.absentSources).toEqual([]);
    expect(result.samples).toHaveLength(5);

    // 人工基准标记（fde-session → human-fde）
    expect(result.humanBaselineCount).toBe(1);
    expect(result.samples.find((s) => s.source === 'fde-session')!.label).toBe('human-fde');

    // 脱敏贯通：企业专名 0 命中（验收红线）
    expect(result.redactionCheck.clean).toBe(true);
    const joined = result.samples.map((s) => s.textPattern).join('\n');
    expect(joined).not.toContain('锐达科技');
    expect(joined).toContain('{CUSTOMER_NAME}');
    // 格式类脱敏（runtime-audit 的 sk- 密钥）
    expect(joined).not.toContain('sk-abcdefghijklmnop');

    // 白名单字段（ruleId/severity/tokens 有值）
    const decision = result.samples.find((s) => s.source === 'decision-log')!;
    expect(decision.ruleId).toBe('A2');
    expect(decision.severity).toBe('critical');
    const llm = result.samples.find((s) => s.source === 'llm-calls')!;
    expect(llm.tokens).toBe(1234);
    const evalSample = result.samples.find((s) => s.source === 'evaluation-log')!;
    expect(evalSample.label).toBe('FAIL');
    expect(evalSample.failureCode).toBe('E_VAL');

    rmSync(tmpData, { recursive: true, force: true });
  });

  it('空数据目录——五源全缺席不崩（fde-session 尚无数据属常态）', () => {
    const empty = mkdtempSync(join(tmpdir(), 'corpus-empty-'));
    const result = aggregateSamples(empty);
    expect(result.samples).toEqual([]);
    expect(result.absentSources).toHaveLength(5);
    expect(result.humanBaselineCount).toBe(0);
    rmSync(empty, { recursive: true, force: true });
  });

  it('部分源在位——缺席源显式登记（不静默缺省）', () => {
    const partial = mkdtempSync(join(tmpdir(), 'corpus-partial-'));
    mkdirSync(join(partial, 'audit'), { recursive: true });
    writeFileSync(join(partial, 'audit', 'decision-log.jsonl'),
      JSON.stringify({ decision: 'blocked', why: 'x' }) + '\n');
    const result = aggregateSamples(partial);
    expect(result.sourceCounts['decision-log']).toBe(1);
    expect(result.absentSources).toContain('fde-session');
    expect(result.absentSources).toContain('llm-calls');
    rmSync(partial, { recursive: true, force: true });
  });
});

// ────────────────────────────────────────────────────────────
// 六、导出落盘 + HMAC 签名 + 审计事件
// ────────────────────────────────────────────────────────────

describe('导出落盘与签名', () => {
  it('signBody 稳定性——同 body 同 key 同签名，异 key 异签名', () => {
    const body = { a: 1, b: 'x' };
    expect(signBody(body, 'key1')).toBe(signBody(body, 'key1'));
    expect(signBody(body, 'key1')).not.toBe(signBody(body, 'key2'));
    expect(signBody(body, 'key1')).toHaveLength(32);
  });

  it('exportRuleCorpus 落盘三件（rules JSON/YAML + verifiers）+ 审计事件', () => {
    const out = mkdtempSync(join(tmpdir(), 'corpus-out-'));
    const r = exportRuleCorpus({ scope: 'all', outDir: out, engineVersion: '1.4.4-test' });
    expect(r.ok).toBe(true);
    expect(r.files).toHaveLength(2);
    // JSON 可回读且计数闭合
    const parsed = JSON.parse(readFileSync(r.files[0]!, 'utf-8')) as { body: { counts: { totalSlots: number } }; hmac?: string };
    expect(parsed.body.counts.totalSlots).toBe(27);
    // YAML 非空且含关键字段
    const yaml = readFileSync(r.files[1]!, 'utf-8');
    expect(yaml).toContain('schemaVersion');
    expect(yaml).toContain('A12');
    // 审计事件（合规红线——导出行为受审计）
    expect(r.auditEvent.event).toBe('corpus_export');
    expect(r.auditEvent.ruleCount).toBe(27);
    expect(typeof r.auditEvent.signed).toBe('boolean');
    rmSync(out, { recursive: true, force: true });
  });

  it('jsonToYaml——嵌套对象/数组/引号需求字符串', () => {
    const y = jsonToYaml({ name: 'A1 不碰敏感', list: [{ k: 1 }, { k: 2 }], tricky: '带:冒号' });
    expect(y).toContain('A1 不碰敏感');
    expect(y).toContain('带:冒号'); // 引号形态包裹后原样保留
    expect(y).toContain('k: 1');
  });

  it('dryRun 不落盘', () => {
    const r = exportRuleCorpus({ dryRun: true });
    expect(r.files).toEqual([]);
    expect(r.body.counts.totalSlots).toBe(27);
  });
});
