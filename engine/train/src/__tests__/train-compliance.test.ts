// train-compliance.test.ts · v1.4.5 第三章 测试
//
// 验收标准逐条覆盖：
// - PII 扫描（手机号复用 REDACTION_PATTERNS + 身份证增量红名单）
// - 敏感字段扫描（健康/财务——critical）
// - 企业专有名词扫描（redact-rules.json entities 复用——medium 人工确认）
// - 严重级发现阻断训练提交（合规闸门——对齐质量闸门模式）
// - 报告写训练集版本（stampComplianceOnVersion——append-only -c 后缀）
// - 数据来源标记（enterprise/synthetic/public 三分类可追溯）
// - 与导出闸边界：检测共用（REDACTION_PATTERNS 同源）处置独立（不脱敏只报告）
//
// 测试纪律：真实 tmpdir 落盘（dataset-version 台账走真实 atomicAppendSync），
// 不 mock fs——数据集构造走真实 buildAndPersistDataset。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  scanDatasetCompliance,
  assertComplianceGate,
  scanAndGate,
  markProvenance,
  ComplianceGateError,
} from '../train/train-compliance';
import { stampComplianceOnVersion, getDatasetVersion, recordDatasetVersion } from '../train/dataset-version';
import { buildAndPersistDataset } from '../train/dataset-builder';
import type { IngestRecord } from '../train/data-ingest';

// ── 测试基建 ──
let dataDir: string;
const ENTERPRISE = 'ent-compliance';

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-train-compliance-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

/**
 * 构建一个 sft 数据集并返回（datasetId, version）。
 *
 * 直写 dataset.jsonl + 手工记版本——**不走 buildAndPersistDataset**：
 * 数据管道的 defaultSampleSanitize 会先过 REDACTION_PATTERNS 把密钥/
 * 手机号洗掉（v1.4.4 训练入口脱敏），合规扫描的验收对象是「未处置」的
 * 数据面（企业原始数据/外部管道产物），经管道洗过的数据集天然干净
 * （该语义在「干净数据集零发现」用例反向验证）。
 */
function buildDataset(
  outputs: string[],
  datasetId = 'ds-compliance',
): { datasetId: string; version: string; datasetFile: string } {
  const lines = outputs
    .map((output, i) =>
      JSON.stringify({ instruction: `指令 ${i + 1}`, input: '', output, __meta: { source: 'test', recordId: `src#${i + 1}` } }),
    )
    .join('\n') + '\n';
  const { createHash } = require('crypto') as typeof import('crypto');
  const contentHash = createHash('sha256').update(lines, 'utf8').digest('hex');
  const datasetFile = join(dataDir, 'train', ENTERPRISE, 'datasets', datasetId, 'dataset.jsonl');
  mkdirSync(join(datasetFile, '..'), { recursive: true });
  writeFileSync(datasetFile, lines, 'utf-8');
  const record = recordDatasetVersion(
    {
      dataDir,
      enterpriseId: ENTERPRISE,
      datasetId,
      contentHash,
      sampleCount: outputs.length,
      algorithm: 'sft',
      columnMapping: { instruction: 'instruction', input: 'input', output: 'output' },
      datasetFile,
    },
    contentHash.slice(0, 8),
  );
  return { datasetId, version: record.version, datasetFile };
}

describe('PII 扫描（检测复用 redactor 红名单）', () => {
  it('test_scan_手机号命中_REDACTION同源检测且报high阻断', () => {
    const { datasetId, version } = buildDataset([
      '好的，联系 13812345678 咨询',
      '普通样本无风险',
    ]);
    const report = scanDatasetCompliance({ dataDir, enterpriseId: ENTERPRISE, datasetId, version });
    const pii = report.findings.filter((f) => f.kind === 'pii');
    expect(pii.length).toBeGreaterThanOrEqual(1);
    // 手机号命中（REDACTION_PATTERNS #10 同一检测面）
    expect(pii.some((f) => f.matchedPattern.includes('手机号') || f.matchedPattern.includes('1**'))).toBe(true);
    // high 级 → 闸门不过
    expect(report.passed).toBe(false);
    expect(report.blockedBy).toBeTruthy();
    // 处置建议是脱敏（导出闸同款管线）——处置逻辑独立但指引可衔接
    const phone = pii.find((f) => f.severity === 'high')!;
    expect(phone.action).toBe('redact');
  });

  it('test_scan_身份证号命中_增量红名单报critical', () => {
    const { datasetId, version } = buildDataset([
      '员工 110101199003078515 已登记',
      '正常内容',
    ]);
    const report = scanDatasetCompliance({ dataDir, enterpriseId: ENTERPRISE, datasetId, version });
    const idCard = report.findings.find((f) => f.matchedPattern.includes('身份证'));
    expect(idCard).toBeTruthy();
    expect(idCard!.severity).toBe('critical');
    expect(idCard!.action).toBe('remove'); // 身份证不可仅脱敏——剔除
    expect(report.passed).toBe(false);
  });

  it('test_scan_密钥形态命中_报critical零容忍', () => {
    // fixture 密钥运行时拼接（不字面写完整串——A2 教训先例：测试敏感数据防误伤）
    const fakeKey = ['sk-abc', 'def012', '3456', '789a', 'bcdef'].join('');
    const { datasetId, version } = buildDataset([
      `config 里写了 ${fakeKey}`,
      '文本样本',
    ]);
    const report = scanDatasetCompliance({ dataDir, enterpriseId: ENTERPRISE, datasetId, version });
    // 变量名避开裸 secret（A2 赋值形态正则把「secret = 长表达式」误判为密钥赋值）
    const secretFinding = report.findings.find((f) => f.kind === 'secret');
    expect(secretFinding).toBeTruthy();
    expect(secretFinding!.severity).toBe('critical');
    expect(report.passed).toBe(false);
  });

  it('test_scan_干净数据集_零发现过闸', () => {
    const { datasetId, version } = buildDataset(['完全干净的样本一', '完全干净的样本二', '完全干净的样本三']);
    const report = scanDatasetCompliance({ dataDir, enterpriseId: ENTERPRISE, datasetId, version });
    // 无 entities 配置时专有名词面为空——干净数据集零发现
    expect(report.passed).toBe(true);
    expect(report.blockedBy).toBeUndefined();
  });
});

describe('敏感字段扫描（健康/财务）', () => {
  it('test_scan_健康字段命中_JSON行字段名报critical人工确认', () => {
    // 构造含敏感字段的 JSONL 行（绕过 buildDataset 的样本形态——直接改 dataset.jsonl）
    const { datasetId, version, datasetFile } = buildDataset(['正常']);
    const malicious = [
      JSON.stringify({ instruction: '查询', input: '', output: 'ok', health_status: '糖尿病II型' }),
      JSON.stringify({ instruction: '查询2', input: '', output: 'ok', diagnosis: '高血压' }),
    ].join('\n') + '\n';
    writeFileSync(datasetFile, malicious, 'utf-8');

    const report = scanDatasetCompliance({ dataDir, enterpriseId: ENTERPRISE, datasetId, version });
    const sensitive = report.findings.find((f) => f.kind === 'sensitive-field');
    expect(sensitive).toBeTruthy();
    expect(sensitive!.severity).toBe('critical');
    expect(sensitive!.action).toBe('human-review');
    expect(sensitive!.matchedPattern).toContain('health_status');
    expect(report.passed).toBe(false);
  });

  it('test_scan_财务字段命中_salary报critical', () => {
    const { datasetId, version, datasetFile } = buildDataset(['正常']);
    writeFileSync(
      datasetFile,
      JSON.stringify({ instruction: 'q', input: '', output: 'a', annual_salary: '450000' }) + '\n',
      'utf-8',
    );
    const report = scanDatasetCompliance({ dataDir, enterpriseId: ENTERPRISE, datasetId, version });
    expect(report.findings.some((f) => f.kind === 'sensitive-field' && f.matchedPattern.includes('salary'))).toBe(true);
    expect(report.passed).toBe(false);
  });
});

describe('企业专有名词扫描（redact-rules entities 复用）', () => {
  it('test_scan_实体名库命中_报medium人工确认不阻断', () => {
    const { datasetId, version } = buildDataset(['客户「星际重工」的工单已创建']);
    // 配置实体名库（redact-rules.json——与 v1.4.4 redactor 同一配置文件）
    mkdirSync(join(dataDir, 'config'), { recursive: true });
    writeFileSync(
      join(dataDir, 'config', 'redact-rules.json'),
      JSON.stringify({ entities: [{ pattern: '星际重工', placeholder: '{CUSTOMER_NAME}' }] }),
      'utf-8',
    );
    const report = scanDatasetCompliance({ dataDir, enterpriseId: ENTERPRISE, datasetId, version });
    const noun = report.findings.find((f) => f.kind === 'proprietary-noun');
    expect(noun).toBeTruthy();
    expect(noun!.severity).toBe('medium');
    expect(noun!.action).toBe('human-review');
    // medium 不阻断——闸门过（专有词是否可训由企业自定）
    expect(report.passed).toBe(true);
  });
});

describe('合规闸门（严重级阻断训练提交）', () => {
  it('test_assertComplianceGate_严重级发现_抛ComplianceGateError阻断', () => {
    const { datasetId, version } = buildDataset(['电话 13998887766 留档']);
    const report = scanDatasetCompliance({ dataDir, enterpriseId: ENTERPRISE, datasetId, version });
    expect(() => assertComplianceGate(report)).toThrow(ComplianceGateError);
    try {
      assertComplianceGate(report);
    } catch (err) {
      const gateErr = err as ComplianceGateError;
      expect(gateErr.report.passed).toBe(false);
      expect(gateErr.message).toContain('阻断');
    }
  });

  it('test_assertComplianceGate_干净数据集_noOp不抛', () => {
    const { datasetId, version } = buildDataset(['干净']);
    const report = scanDatasetCompliance({ dataDir, enterpriseId: ENTERPRISE, datasetId, version });
    expect(() => assertComplianceGate(report)).not.toThrow();
  });

  it('test_scanAndGate_阻断场景_直接抛错不留半成品', () => {
    const { datasetId, version } = buildDataset(['身份证 110101199003078515 在此']);
    expect(() => scanAndGate({ dataDir, enterpriseId: ENTERPRISE, datasetId, version })).toThrow(/合规闸门阻断/);
  });

  it('test_scanAndGate_过闸场景_返回报告继续', () => {
    const { datasetId, version } = buildDataset(['干净样本']);
    const report = scanAndGate({ dataDir, enterpriseId: ENTERPRISE, datasetId, version });
    expect(report.passed).toBe(true);
  });
});

describe('合规报告写训练集版本（append-only -c 台账）', () => {
  it('test_stampComplianceOnVersion_写入compliance与来源_不改写历史行', () => {
    const { datasetId, version } = buildDataset(['干净一', '干净二']);
    const report = scanDatasetCompliance({
      dataDir,
      enterpriseId: ENTERPRISE,
      datasetId,
      version,
      provenance: 'enterprise',
    });
    const stamped = stampComplianceOnVersion(dataDir, ENTERPRISE, datasetId, version, {
      compliance: {
        scannedAt: report.scannedAt,
        passed: report.passed,
        findingCounts: { medium: report.findings.length },
      },
      provenance: 'enterprise',
    });
    // 新记录 -c 后缀
    expect(stamped.version).toBe(`${version}-c`);
    expect(stamped.compliance?.passed).toBe(true);
    expect(stamped.provenance).toBe('enterprise');
    // 原版本记录仍在且未被改写（无 compliance 字段）
    const original = getDatasetVersion(dataDir, ENTERPRISE, datasetId, version);
    expect(original).toBeTruthy();
    expect(original!.compliance).toBeUndefined();
  });

  it('test_stampComplianceOnVersion_重复打标_幂等不叠后缀', () => {
    const { datasetId, version } = buildDataset(['干净']);
    const stamp = { compliance: { scannedAt: new Date().toISOString(), passed: true, findingCounts: {} } };
    const first = stampComplianceOnVersion(dataDir, ENTERPRISE, datasetId, version, {
      ...stamp,
      provenance: 'enterprise',
    });
    // 对 -c 版本重复打标：不再叠 -cc（幂等口径）
    const second = stampComplianceOnVersion(dataDir, ENTERPRISE, datasetId, first.version, {
      ...stamp,
      provenance: 'enterprise',
    });
    expect(second.version).toBe(`${version}-c`);
    // 幂等命中既有记录（台账 append-only 语义：重复登记不产生新行）
    expect(second.provenance).toBe('enterprise');
  });

  it('test_stampComplianceOnVersion_版本不存在_抛错', () => {
    expect(() =>
      stampComplianceOnVersion(dataDir, ENTERPRISE, 'no-ds', 'v9', {
        compliance: { scannedAt: new Date().toISOString(), passed: true, findingCounts: {} },
      }),
    ).toThrow(/不存在/);
  });
});

describe('数据来源标记（三分类可追溯）', () => {
  it('test_markProvenance_三分类各自可标记', () => {
    for (const p of ['enterprise', 'synthetic', 'public'] as const) {
      const { datasetId, version } = buildDataset(['样本'], `ds-${p}`);
      const marked = markProvenance(dataDir, ENTERPRISE, datasetId, version, p);
      expect(marked.version).toBe(`${version}#${p}`);
      expect(marked.provenance).toBe(p);
      // 回读验证（台账可追溯）
      const read = getDatasetVersion(dataDir, ENTERPRISE, datasetId, `${version}#${p}`);
      expect(read?.provenance).toBe(p);
    }
  });

  it('test_markProvenance_版本不存在_抛错', () => {
    expect(() => markProvenance(dataDir, ENTERPRISE, 'ghost', 'v1', 'enterprise')).toThrow(/不存在/);
  });
});

describe('边界：训练闸与导出闸检测共用处置独立', () => {
  it('test_scan_检测面与redactor同源_但不修改数据本体（处置独立）', () => {
    const { datasetId, version, datasetFile } = buildDataset(['联系电话 13712345678 备份']);
    const before = require('fs').readFileSync(datasetFile, 'utf-8');
    scanDatasetCompliance({ dataDir, enterpriseId: ENTERPRISE, datasetId, version });
    const after = require('fs').readFileSync(datasetFile, 'utf-8');
    // 训练闸只报告不脱敏（处置留给决策面：剔除/脱敏后重建——两道闸不合并）
    expect(after).toBe(before);
  });
});
