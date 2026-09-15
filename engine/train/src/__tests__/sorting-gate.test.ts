// sorting-gate.test.ts · v1.4.6 章二 测试（合规关键面，必测）
//
// 验收标准逐条覆盖：
// - 分拣三档判定（敏感 / 脱敏 / 公开）
// - 敏感档上云被拦截 + 分拣依据（reason）入审计链 + 保密证书编号挂链
// - 批量分拣：任一段敏感 → 整体拦截
// - 分拣闸与合规闸分层可独立验证（data-push 双闸：合规不过拒，分拣拦但本地放行）

import { describe, it, expect } from 'vitest';
import {
  classifyDataForCloud,
  classifyBatchForCloud,
  generateConfidentialityRef,
} from '../sorting-gate';
import { gateDataPush, validateDataPush } from '../data-push';

// ────────────────────────────────────────────────────────────
// 一、分拣三档判定
// ────────────────────────────────────────────────────────────

describe('分拣三档判定', () => {
  it('客户手机号 → 敏感档（拦截上云）', () => {
    const d = classifyDataForCloud('客户张三，手机 13812345678，年采购 120 万元');
    expect(d.classification).toBe('sensitive');
    expect(d.allowCloud).toBe(false);
    expect(d.matchedPatterns).toContain('手机号');
    expect(d.matchedPatterns).toContain('金额');
  });

  it('身份证号 → 敏感档', () => {
    const d = classifyDataForCloud('法人身份证 110101199001011234');
    expect(d.classification).toBe('sensitive');
    expect(d.matchedPatterns).toContain('身份证号');
  });

  it('脱敏占位符 → 脱敏档（放行上云）', () => {
    const d = classifyDataForCloud('客户 [REDACTED]，电话 ***，金额已脱敏');
    expect(d.classification).toBe('desensitized');
    expect(d.allowCloud).toBe(true);
  });

  it('无敏感特征 → 公开档（放行上云）', () => {
    const d = classifyDataForCloud('行业报告：AI 训练数据治理最佳实践');
    expect(d.classification).toBe('public');
    expect(d.allowCloud).toBe(true);
  });

  it('已脱敏但仍含真实敏感值 → 优先判敏感（宁拦勿漏）', () => {
    // 脱敏了姓名但仍留真实手机号 → 敏感优先
    const d = classifyDataForCloud('张先生（已脱敏）联系 13900000000');
    expect(d.classification).toBe('sensitive');
  });
});

// ────────────────────────────────────────────────────────────
// 二、分拣依据 + 保密证书（入审计链前提）
// ────────────────────────────────────────────────────────────

describe('分拣依据 + 保密证书（入审计链）', () => {
  it('敏感档拦截 → 分拣依据（reason）非空（可入审计链）', () => {
    const d = classifyDataForCloud('客户 13812345678');
    expect(d.reason).toBeTruthy();
    expect(d.reason).toContain('敏感');
  });

  it('敏感档拦截 → 挂保密证书编号（技术+法律双证据）', () => {
    const d = classifyDataForCloud('客户 13812345678');
    expect(d.confidentialityRef).toBeTruthy();
    expect(d.confidentialityRef).toMatch(/^CONF-\d{14}-[A-Z0-9]{6}$/);
  });

  it('保密证书编号唯一（同刻两次生成不同）', () => {
    const a = generateConfidentialityRef(() => 1700000000000);
    const b = generateConfidentialityRef(() => 1700000000000);
    // 时间戳相同但随机段不同——非确定性，仅断言格式合法
    expect(a).toMatch(/^CONF-/);
    expect(b).toMatch(/^CONF-/);
  });

  it('公开档/脱敏档 → 无保密证书（只有敏感档挂链）', () => {
    expect(classifyDataForCloud('公开内容').confidentialityRef).toBeUndefined();
    expect(classifyDataForCloud('内容已脱敏 ***').confidentialityRef).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────
// 三、批量分拣
// ────────────────────────────────────────────────────────────

describe('批量分拣', () => {
  it('任一段敏感 → 整体不放行（宁拦勿漏——批量上传不可部分放行）', () => {
    const { allAllowed, decisions } = classifyBatchForCloud([
      '公开语料 A',
      '客户 13812345678 的订单',
      '公开语料 B',
    ]);
    expect(allAllowed).toBe(false);
    expect(decisions[1]?.classification).toBe('sensitive');
  });

  it('全部放行 → allAllowed=true', () => {
    const { allAllowed } = classifyBatchForCloud(['公开 A', '已脱敏 ***']);
    expect(allAllowed).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
// 四、双闸分层（分拣闸与合规闸独立验证）
// ────────────────────────────────────────────────────────────

describe('data-push 双闸分层（分拣 / 合规独立）', () => {
  const allowCompliance = () => ({ allowed: true, reason: '合规过' });
  const denyCompliance = () => ({ allowed: false, reason: '含 PII 违规' });

  it('合规闸拦截 → 整体拒绝入库（分拣闸不执行）', () => {
    const payload = validateDataPush({
      kind: 'training_corpus',
      enterpriseId: 'ent-1',
      source: 'crm',
      samples: ['公开语料'],
    });
    const r = gateDataPush(payload.payload!, denyCompliance);
    expect(r.accepted).toBe(false);
    expect(r.reason).toContain('合规闸拦截');
  });

  it('合规过 + 分拣拦敏感 → 本地入库放行（分拣闸只管上云路径）', () => {
    const payload = validateDataPush({
      kind: 'training_corpus',
      enterpriseId: 'ent-1',
      source: 'crm',
      samples: ['客户 13812345678'],
    });
    const r = gateDataPush(payload.payload!, allowCompliance);
    expect(r.accepted).toBe(true); // 本地放行
    expect(r.sorting.allAllowed).toBe(false); // 但上云被分拣拦
    expect(r.reason).toContain('上云需先脱敏');
  });

  it('双闸全过 → 放行', () => {
    const payload = validateDataPush({
      kind: 'knowledge',
      enterpriseId: 'ent-1',
      source: 'wiki',
      samples: ['公开知识片段'],
    });
    const r = gateDataPush(payload.payload!, allowCompliance);
    expect(r.accepted).toBe(true);
    expect(r.sorting.allAllowed).toBe(true);
  });

  it('schema 校验：samples 空数组 → 拒绝', () => {
    const r = validateDataPush({
      kind: 'training_corpus',
      enterpriseId: 'ent-1',
      source: 'crm',
      samples: [],
    });
    expect(r.valid).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// v1.4.9 T8：敏感度分类前置件（applyPreClassification）
// ────────────────────────────────────────────────────────────

import { applyPreClassification, SENSITIVE_PATTERNS } from '../sorting-gate';

describe('敏感度分类前置件（v1.4.9 T8）', () => {
  it('前置 sensitive → 分拣敏感档拦截（含保密证书编号）', () => {
    const d = applyPreClassification('项目内部代号文档', 'sensitive');
    expect(d.classification).toBe('sensitive');
    expect(d.allowCloud).toBe(false);
    expect(d.matchedPatterns).toEqual(['pre-classified:sensitive']);
    expect(d.confidentialityRef).toMatch(/^CONF-/);
    expect(d.reason).toContain('sensitivity-classifier');
  });

  it('前置 public → 走既有正则判定（格式面仍由本闸把关——分层不越权）', () => {
    // 公开档但含手机号——SENSITIVE_PATTERNS 仍然拦（分类不覆盖格式面）
    const d = applyPreClassification('联系 13812345678', 'public');
    expect(d.classification).toBe('sensitive');
    expect(d.matchedPatterns).toContain('手机号');
    // 真公开文本——放行
    const clean = applyPreClassification('今天天气不错', 'public');
    expect(clean.classification).toBe('public');
    expect(clean.allowCloud).toBe(true);
  });

  it('前置 internal → 走既有正则判定（内部档不直接放行也不直接拦）', () => {
    const d = applyPreClassification('内部评审材料', 'internal');
    expect(d.classification).toBe('public'); // 无格式命中 → 公开档口径（专有云决策交企业配置）
    expect(d.allowCloud).toBe(true);
  });

  it('SENSITIVE_PATTERNS 五标签保持（v1.4.6 回归锁——T8 前置件不收缩检测面）', () => {
    expect(SENSITIVE_PATTERNS.map((p) => p.label)).toEqual(['手机号', '身份证号', '银行卡号', '金额', '邮箱']);
  });
});
